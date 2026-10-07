#!/usr/bin/env python3
"""Exact UI frontend release preparation and launch, including Publish and Search.

Subcommands do exactly the named phase. Plans and local logs are creation-only.
Transport/publish retain the installed capacity gates and all rollback roots.
"""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import tarfile
from pathlib import PurePosixPath

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
SSH = ['ssh', '-i', '/home/sixer/.ssh/proofofwork_me_ed25519',
       '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
       '-o', 'ConnectTimeout=10', 'root@77.42.91.106']
HEX40 = re.compile('[0-9a-f]{40}')
HEX64 = re.compile('[0-9a-f]{64}')
RELEASE = re.compile('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z')
SURFACES = 'activity boost browser code computer desktop dns growth id inception infinity jobs landing marketplace nft publish search token wallet work'.split()
DEPLOYMENT_ONLY_PATHS = frozenset({
    'deploy/proofofwork-ui-release-stage.py',
    'deploy/proofofwork-ui-release-provenance.sh',
    'deploy/proofofwork-ui-release-publish.sh',
    'deploy/publish/release.py', 'deploy/publish/remote_transport.py',
    'deploy/publish/transport_preserve.py', 'deploy/publish/publish.py',
    'deploy/publish/check-ui-release.test.py', 'deploy/publish/phase_capacity.py',
    'scripts/check-ui-stage-dedup.py',
    'scripts/check-ui-preserved-paths.py',
    'OP_RETURN_INFRASTRUCTURE.md', 'repository-hygiene.json',
})


def artifact_tooling_binding(commit, tree):
    """A later tooling commit may reuse artifacts only for this exact repair scope."""
    head = subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], text=True).strip()
    head_tree = subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD^{tree}'], text=True).strip()
    artifact_tree = subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', commit + '^{tree}'], text=True).strip()
    assert artifact_tree == tree, 'Artifact tree differs from its commit'
    subprocess.check_output(['git', '-C', str(REPO), 'merge-base', '--is-ancestor', commit, head])
    changed = subprocess.check_output(['git', '-C', str(REPO), 'diff', '--name-only', '--no-renames',
                                       commit, head, '--'], text=True).splitlines()
    assert set(changed) <= DEPLOYMENT_ONLY_PATHS, 'Artifact reuse includes changes outside deployment-only repair'
    assert not subprocess.check_output(['git', '-C', str(REPO), 'status', '--porcelain', '--untracked-files=all'])
    return {'toolingCommit': head, 'toolingTree': head_tree, 'deploymentOnlyChanges': changed}


def bundle_payload_fingerprint(path, release):
    """Independently bind extracted bytes/modes to the already SHA-pinned local tar."""
    prefix = 'proofofwork-ui-surfaces-' + release
    rows, seen, total = [], set(), 0
    with tarfile.open(path, 'r:gz') as archive:
        for member in archive:
            name = member.name.rstrip('/')
            relative = PurePosixPath(name)
            assert name and name == relative.as_posix() and not relative.is_absolute()
            assert relative.parts[0] == prefix and '..' not in relative.parts and '\\' not in name
            assert all(ord(c) >= 32 and ord(c) != 127 for c in name)
            assert name not in seen and not member.issparse() and member.size >= 0
            assert member.isdir() or member.isfile()
            assert not member.mode & 0o7022 and member.size <= 96*1024**2
            seen.add(name); total += member.size
            assert len(seen) <= 30000 and total <= 512*1024**2
            digest_value = None
            if member.isfile():
                with archive.extractfile(member) as source:
                    digest_value = hashlib.file_digest(source, 'sha256').hexdigest()
            else:
                assert member.size == 0
            rel = relative.relative_to(prefix).as_posix()
            rows.append([rel, 'directory' if member.isdir() else 'file', member.mode,
                         0, 0, member.size if member.isfile() else 0, digest_value])
    by_path = {row[0]: row for row in rows}
    assert by_path.get('.', [None, None])[1] == 'directory'
    assert by_path.get('surfaces', [None, None])[1] == 'directory'
    assert {row[0].split('/')[1] for row in rows if row[0].startswith('surfaces/')} == set(SURFACES)
    assert all(row[0] in ('.', 'surfaces') or row[0].startswith('surfaces/') for row in rows)
    for row in rows:
        if row[0] != '.':
            assert by_path[PurePosixPath(row[0]).parent.as_posix()][1] == 'directory'
    rows.sort(key=lambda row: (row[0] != '.', PurePosixPath(row[0]).parts))
    return {'sha256': hashlib.sha256(json.dumps(rows, separators=(',', ':')).encode()).hexdigest(),
            'entries': len(rows), 'regularBytes': sum(row[5] for row in rows)}


def surface_resume_binding(args, current):
    original, original_sha, _ = load_plan(args.resume_plan)
    evidence = json.loads(Path(args.resume_evidence).read_bytes())
    inventory = json.loads(Path(args.resume_inventory).read_bytes())
    assert original['publicationAttempt'] != current['publicationAttempt'], 'Resume requires a fresh attempt'
    for key in ('releaseId', 'commit', 'tree', 'source', 'surfaces', 'oldLiveManifestSha256', 'oldFullRootTreeSha256', 'retainedRoots'):
        assert original[key] == current[key], 'Resume changes the received artifact binding'
    failed_root = '/var/tmp/proofofwork-deploy/recovery-transport-' + current['releaseId'] + '-surfaces-stage'
    assert evidence['evidence'] == failed_root
    receipt = inventory['surfaceReceiverReceipt']
    assert receipt['status'] == 'verified' and receipt['kind'] == 'surfaces'
    assert receipt['releaseId'] == current['releaseId']
    assert receipt['archiveSha256'] == current['surfaces']['sha256']
    assert receipt['compressedBytes'] == current['surfaces']['compressedBytes']
    assert receipt['entries'] == current['surfacesPayloadFingerprint']['entries']
    assert receipt['logicalBytes'] == current['surfacesPayloadFingerprint']['regularBytes']
    assert inventory['stageExists'] is False and inventory['sourceExists'] is False
    records = evidence['records']
    assert records['intent.json']['value']['planSha256'] == original_sha
    failure = records['stage-check-scratch.json']['value']
    assert failure.startswith('UI deployment scratch review required ')
    refusal = json.loads(failure[len('UI deployment scratch review required '):])
    assert refusal['maximumBytes'] == 5*1024**3 and refusal['cleanupApproved'] is False
    assert refusal['phase'] == 'recovery-stage'
    assert 'stager.log' not in records and 'receipt.json' not in records
    pins = {name: {'sha256': records[name]['sha256'], 'bytes': records[name]['bytes']}
            for name in ('intent.json', 'receive-admission.log', 'receiver.log',
                         'stage-model.json', 'stage-check-scratch.json')}
    for pin in pins.values(): assert HEX64.fullmatch(pin['sha256']) and 0 < pin['bytes'] <= 65536
    assert HEX64.fullmatch(inventory['receiverReceiptSha256'])
    return {'failedPlanPath': remote_plan(original), 'failedPlanSha256': original_sha,
            'failedEvidence': failed_root, 'failedRecords': pins,
            'receiverReceiptPath': '/var/tmp/proofofwork-deploy/audit5-stream-surfaces-' + current['releaseId'] + '.json',
            'receiverReceiptSha256': inventory['receiverReceiptSha256']}

def preserved_stage_binding(args, current):
    """Resume only the exact preserved-input full-copy scratch refusal."""
    original, original_sha, _ = load_plan(args.preserved_plan)
    evidence = json.loads(Path(args.preserved_evidence).read_bytes())
    incoming = json.loads(Path(args.preserved_incoming_receipt).read_bytes())
    inventory = json.loads(Path(args.preserved_inventory).read_bytes())
    assert original['publicationAttempt'] != current['publicationAttempt'], 'Preserved stage requires a fresh attempt'
    assert original['inputStorage'] == 'release-evidence-v1'
    assert 'preservedStageResume' not in original
    initial = 'resumeSurfaces' not in original
    if initial: assert original['publicationAttempt'] == 'initial'
    else: assert original['resumeSurfaces']
    failed_phase = 'surfaces-stage' if initial else 'surfaces-stage-resume'
    for key in ('releaseId', 'commit', 'tree', 'source', 'surfaces', 'surfacesPayloadFingerprint',
                'preservedSurfacesRoot', 'preservedSourceCheckout', 'oldLiveManifestSha256', 'oldFullRootTreeSha256', 'retainedRoots'):
        assert original[key] == current[key], 'Preserved stage changes the artifact binding'
    failed_root = '/var/tmp/proofofwork-deploy/recovery-transport-' + current['releaseId'] + '-' + failed_phase + '-' + original['publicationAttempt']
    assert evidence['evidence'] == failed_root
    assert evidence['stageExists'] is False and evidence['sourceExists'] is False and evidence['privateStages'] == []
    assert evidence['preservedInputExists'] is True
    assert inventory['stageExists'] is False and inventory['sourceExists'] is False and inventory['privateStages'] == []
    assert inventory['allLiveAndRetainedRootsUnchanged'] is True
    assert inventory['live']['manifestSha256'] == current['oldLiveManifestSha256']
    assert inventory['live']['treeSha256'] == current['oldFullRootTreeSha256']
    assert inventory['retained'] == current['retainedRoots']
    names = {'intent.json', 'input-evidence-check.json', 'stage-model.json', 'stage-check-scratch.json', 'stage-check.json', 'stager.log'}
    if initial: names |= {'receive-admission.log', 'receiver.log'}
    records = evidence['records']; assert set(records) == names
    assert records['intent.json']['value']['planSha256'] == original_sha
    assert records['intent.json']['value']['phase'] == failed_phase
    refusal_raw = records['stager.log']['value']; prefix = 'UI deployment scratch review required '
    assert refusal_raw.startswith(prefix)
    refusal = json.loads(refusal_raw[len(prefix):])
    assert refusal['phase'] == 'stage-private-root' and refusal['path'] == '/var/tmp/proofofwork-deploy'
    assert refusal['maximumBytes'] == 5*1024**3 and refusal['cleanupApproved'] is False
    assert refusal['allocatedBytes'] + refusal['additionalBytes'] > refusal['maximumBytes']
    assert records['stage-check-scratch.json']['value']['status'] == 'sufficient'
    assert records['stage-check.json']['value']['status'] == 'sufficient'
    assert records['stage-model.json']['value']['inputStabilityVerified'] is True
    pins = {name: {'sha256': records[name]['sha256'], 'bytes': records[name]['bytes']} for name in names}
    for name, pin in pins.items():
        assert HEX64.fullmatch(pin['sha256']) and 0 < pin['bytes'] <= 65536
        raw = records[name]['value'].encode() if isinstance(records[name]['value'], str) else None
        if raw is not None: assert hashlib.sha256(raw).hexdigest() == pin['sha256'] and len(raw) == pin['bytes']
    receipt_path = '/var/backups/proofofwork-ui/transport-evidence/' + current['releaseId'] + '/incoming-receipt.json'
    assert incoming['path'] == receipt_path and HEX64.fullmatch(incoming['sha256']) and 0 < incoming['bytes'] <= 65536
    value = incoming['value']
    assert value['format'] == 'proof-of-work-ui-incoming-evidence-v1'
    assert value['releaseId'] == current['releaseId'] and value['commit'] == current['commit'] and value['tree'] == current['tree']
    assert value['planSha256'] == original_sha and value['payloadFingerprint'] == current['surfacesPayloadFingerprint']
    assert value['preservedPath'] == str(Path(current['preservedSurfacesRoot']).parent)
    assert value['movePreservedInodes'] is True and value['historicalDeletion'] is False
    receiver_binding = {}
    if initial:
        receiver = inventory['surfaceReceiverReceipt']
        assert receiver == records['receiver.log']['value'] == value['receiverReceipt']
        assert receiver['status'] == 'verified' and receiver['kind'] == 'surfaces'
        assert receiver['releaseId'] == current['releaseId']
        assert receiver['archiveSha256'] == current['surfaces']['sha256']
        assert receiver['compressedBytes'] == current['surfaces']['compressedBytes']
        assert receiver['entries'] == current['surfacesPayloadFingerprint']['entries']
        assert receiver['logicalBytes'] == current['surfacesPayloadFingerprint']['regularBytes']
        assert receiver['extractedRoot'] == '/var/tmp/proofofwork-deploy/proofofwork-ui-surfaces-' + current['releaseId']
        assert HEX64.fullmatch(inventory['receiverReceiptSha256'])
        receiver_binding = {
            'receiverReceiptPath': '/var/tmp/proofofwork-deploy/audit5-stream-surfaces-' + current['releaseId'] + '.json',
            'receiverReceiptSha256': inventory['receiverReceiptSha256']}
    return {'failedPlanPath': remote_plan(original), 'failedPlanSha256': original_sha,
            'failedEvidence': failed_root, 'failedRecords': pins, **receiver_binding,
            'incomingReceiptPath': receipt_path, 'incomingReceiptSha256': incoming['sha256'],
            'incomingReceiptBytes': incoming['bytes'], 'fullCopyRefusal': refusal,
            'candidateStorage': 'release-evidence-v1',
            'privateCandidateParent': '/var/backups/proofofwork-ui/transport-evidence/' + current['releaseId'] +
                '/.proofofwork-ui-stage-' + current['releaseId'] + '.' + current['publicationAttempt']}

def digest(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()

def create(path, raw):
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path or not str(path).startswith('/tmp/'):
        raise ValueError('Local release evidence must use a canonical /tmp path')
    with path.open('xb') as output:
        output.write(raw); output.flush(); os.fsync(output.fileno())

def remote(argv, *, data=None, stdin=None, stdout=None, timeout=1200):
    return subprocess.run(SSH + [shlex.join(argv)], input=data, stdin=stdin,
                          stdout=stdout, stderr=subprocess.STDOUT,
                          timeout=timeout, check=True)

def load_plan(path):
    path = Path(path).resolve(strict=True)
    raw = path.read_bytes()
    if len(raw) > 65536: raise ValueError('Plan exceeds 64 KiB')
    p = json.loads(raw)
    assert p['schema'] == 'proof-of-work-audit29-ui-transport-plan-v1'
    assert RELEASE.fullmatch(p['releaseId']) and HEX40.fullmatch(p['commit']) and HEX40.fullmatch(p['tree'])
    assert p['releaseId'].startswith(p['commit'][:12] + '-')
    assert re.fullmatch('[a-z0-9][a-z0-9-]{0,30}', p['publicationAttempt'])
    return p, hashlib.sha256(raw).hexdigest(), raw

def preflight(args):
    script = (ROOT / 'preflight.py').read_bytes(); ast.parse(script)
    result = remote(['/usr/bin/python3', '-I', '-B', '-'], data=script,
                    stdout=subprocess.PIPE, timeout=600)
    p = json.loads(result.stdout)
    assert all(item['exitCode'] == 0 for item in p['checks'])
    assert p['retentionDeferred'] is True
    create(args.output, result.stdout)
    print(json.dumps({'status': 'preflight-recorded', 'output': args.output,
                      'sha256': digest(args.output), 'activeManifest': p['activeManifest'],
                      'rollbackRoots': len(p['retained'])}))

def committed_wrapper_sources():
    """Bind local orchestration bytes to the exact release source tree."""
    names = ('build.py', 'release.py', 'preflight.py', 'remote_transport.py', 'transport_preserve.py',
             'publish.py', 'collect_verify.py', 'https_smoke.py', 'phase_capacity.py')
    result = {}
    for name in names:
        path = ROOT / name
        assert path.is_file() and not path.is_symlink() and path.resolve() == path
        code = path.read_bytes()
        ast.parse(code)
        expected = subprocess.check_output(['git', '-C', str(REPO), 'show',
                                            'HEAD:deploy/publish/' + name])
        assert code == expected, 'Release wrapper differs from committed source: ' + name
        result[name] = hashlib.sha256(code).hexdigest()
    return result


def make_plan(args):
    b = json.loads(Path(args.build_receipt).read_bytes())
    p = json.loads(Path(args.preflight).read_bytes())
    assert HEX40.fullmatch(b['commit']) and HEX40.fullmatch(b['tree']) and RELEASE.fullmatch(b['releaseId'])
    assert b['releaseId'].startswith(b['commit'][:12] + '-') and p['retentionDeferred'] is True
    assert all(item['exitCode'] == 0 for item in p['checks'])
    tooling_binding = artifact_tooling_binding(b['commit'], b['tree'])
    wrapper_sources = committed_wrapper_sources()
    assert 0 < b['sourceAllocatedBytes'] <= 1024**3
    assert len(p['retained']) <= 16
    pub = ROOT / 'publish.py'; ast.parse(pub.read_bytes())
    c = {'schema': 'proof-of-work-audit29-ui-transport-plan-v1', 'releaseId': b['releaseId'],
         'commit': b['commit'], 'tree': b['tree'], 'sourceAllocatedBytes': b['sourceAllocatedBytes'],
         'admissions': {}, 'helperSha256': {k: p['helpers'][k]['sha256'] for k in
             ['controller', 'receiver', 'stage-shell', 'phase-capacity', 'capacity', 'retained']},
         'oldLiveManifestSha256': p['live']['manifestSha256'],
         'oldFullRootTreeSha256': p['live']['treeSha256'],
         'installedStagerSha256': p['helpers']['stager']['sha256'], 'stageInodes': 10000,
         'retainedRoots': p['retained'], 'controllerUsage': 'reviewed installed admit-ui only',
         'publicationHelpers': {k: p['helpers'][k] for k in ['retained', 'capacity', 'publisher', 'stager', 'provenance']},
         'publicationWrapperSha256': digest(pub), 'publicationAttempt': args.attempt,
         'transportHelper': p['helpers']['transport'],
         'localBundles': {k: v['path'] for k, v in b['bundles'].items()},
         'wrapperSourceSha256': wrapper_sources,
         'preflightSha256': digest(args.preflight), 'buildReceiptSha256': digest(args.build_receipt),
         'preservingTransportSha256': digest(ROOT / 'remote_transport.py'),
         'httpsSmokeSha256': digest(ROOT / 'https_smoke.py'),
         'phaseCapacity': {'sha256': digest(ROOT / 'phase_capacity.py'),
                           'source': (ROOT / 'phase_capacity.py').read_text()},
         'retentionDeferred': True, 'frontendOnly': True,
         **tooling_binding,
         'inputStorage': 'release-evidence-v1',
         'preservedSourceCheckout': '/var/backups/proofofwork-ui/transport-evidence/' + b['releaseId'] + '/proofofwork-ui-source-' + b['releaseId'],
         'preservedSurfacesRoot': '/var/backups/proofofwork-ui/transport-evidence/' + b['releaseId'] + '/proofofwork-ui-surfaces-' + b['releaseId'] + '/surfaces'}
    logical = {}; entries = {}
    for kind, record in b['bundles'].items():
        assert kind in ('source', 'surfaces')
        path = Path(record['path']); assert path.is_file() and not path.is_symlink()
        assert path.stat().st_size == record['bytes'] and digest(path) == record['sha256']
        with tarfile.open(path, 'r:gz') as archive: members = archive.getmembers()
        logical[kind] = sum(v.size for v in members); entries[kind] = len(members)
        rounded = sum((v.size+4095)//4096*4096 if v.isfile() else 4096 for v in members)
        if kind == 'surfaces':
            assert all(v.isdir() or v.isfile() for v in members)
            expected = 'proofofwork-ui-surfaces-' + b['releaseId'] + '/surfaces/'
            roots = {v.name[len(expected):].split('/')[0] for v in members if v.name.startswith(expected)}
            assert roots == set(SURFACES)
        c[kind] = {'compressedBytes': record['bytes'], 'sha256': record['sha256']}
        if kind == 'surfaces':
            c['surfacesPayloadFingerprint'] = bundle_payload_fingerprint(path, b['releaseId'])
        inode_budget = max(15000 if kind == 'source' else 4000,
                           len(members) + (256 if kind == 'source' else 128))
        assert inode_budget <= 100000
        c['admissions'][kind+'-receive'] = {'bytes': rounded + len(members)*4096 + 16*1024**2,
                                         'inodes': inode_budget}
    assert set(logical) == {'source', 'surfaces'}
    resume_args = [getattr(args, name, None) for name in ('resume_plan', 'resume_evidence', 'resume_inventory')]
    assert all(resume_args) or not any(resume_args), 'Resume requires plan, failed evidence and inventory'
    preserved_args = [getattr(args, name, None) for name in ('preserved_plan', 'preserved_evidence', 'preserved_incoming_receipt', 'preserved_inventory')]
    assert all(preserved_args) or not any(preserved_args), 'Preserved stage requires plan, refusal, incoming receipt and inventory'
    assert not (any(resume_args) and any(preserved_args)), 'Choose one explicit resume phase'
    if all(resume_args): c['resumeSurfaces'] = surface_resume_binding(args, c)
    if all(preserved_args): c['preservedStageResume'] = preserved_stage_binding(args, c)
    old = p['oldManaged']
    c['stageArchiveUpperBoundBytes'] = old['logicalBytes'] + logical['surfaces'] + (old['entries']+entries['surfaces'])*2048 + 32*1024**2
    c['allocationDerivation'] = {'oldManaged': old, 'newLogicalBytes': logical, 'newEntries': entries,
        'receiveMetadataBytesPerEntry': 4096, 'receiveFixedMarginBytes': 16*1024**2,
        'archiveFixedMarginBytes': 32*1024**2, 'archivePaddingBytesPerEntry': 2048}
    raw = (json.dumps(c, indent=2)+'\n').encode(); assert len(raw) <= 65536
    create(args.output, raw)
    print(json.dumps({'status': 'plan-created', 'output': args.output, 'sha256': digest(args.output),
                      'releaseId': c['releaseId'], 'commit': c['commit'], 'tree': c['tree'],
                      'retainedRoots': len(c['retainedRoots']), 'admissions': c['admissions'],
                      'archiveUpperBoundBytes': c['stageArchiveUpperBoundBytes']}))

UPLOAD = r'''
import fcntl,hashlib,os,pathlib,stat,subprocess,sys
sha,target=sys.argv[1:]; raw=sys.stdin.buffer.read(65537)
assert len(raw)<=65536 and hashlib.sha256(raw).hexdigest()==sha
lock='/run/proofofwork-ui/deploy.lock'; info=os.lstat(lock)
assert stat.S_ISREG(info.st_mode) and info.st_uid==info.st_gid==0 and info.st_nlink==1 and not info.st_mode & 0o7022
fd=os.open(lock,os.O_RDONLY|os.O_NOFOLLOW); assert os.fstat(fd).st_ino==info.st_ino
fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','POW_UI_DEPLOY_LOCK_FD':str(fd)}
for kind in ['check-scratch','check']:
 subprocess.run(['/usr/bin/python3','-I','-B','/usr/local/sbin/proofofwork-ui-capacity',kind,'--path','/var/tmp/proofofwork-deploy','--additional-bytes','65536','--additional-inodes','4','--phase','recovery-plan-install'],env=env,pass_fds=(fd,),timeout=60,check=True,stdout=subprocess.DEVNULL)
p=pathlib.Path(target); assert p.parent.resolve()==p.parent and p.parent.stat().st_uid==0 and (p.parent.stat().st_mode & 0o777)==0o700
os.umask(0o077)
with p.open('xb') as f: f.write(raw);f.flush();os.fsync(f.fileno())
pfd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY);os.fsync(pfd);os.close(pfd)
print('plan_installed sha256='+sha+' path='+str(p))
'''

def remote_plan(p):
    return '/var/tmp/proofofwork-deploy/recovery-plan-' + p['releaseId'] + '-' + p['publicationAttempt'] + '.json'

def upload_plan(args):
    p, sha, raw = load_plan(args.plan)
    remote(['/usr/bin/python3', '-I', '-B', '-c', UPLOAD, sha, remote_plan(p)], data=raw, timeout=180)

def transport(args):
    p, sha, _ = load_plan(args.plan)
    kind = 'surfaces' if args.phase == 'surfaces-stage' else 'source'
    bundle = Path(p['localBundles'][kind]); assert bundle.stat().st_size == p[kind]['compressedBytes'] and digest(bundle) == p[kind]['sha256']
    h = p['transportHelper']; assert h['path'] == '/var/tmp/proofofwork-deploy/audit29-tools/ui-transport.py'
    assert HEX64.fullmatch(h['sha256'])
    argv = ['systemd-run', '--unit=proofofwork-audit29-ui-transport-'+p['releaseId']+'-'+args.phase,
        '--service-type=exec', '--wait', '--pipe', '--property=User=root', '--property=Group=root',
        '--property=KillMode=control-group', '--property=RuntimeMaxSec=20min', '--property=TimeoutStopSec=30s',
        '--property=MemoryMax=4G', '--property=MemorySwapMax=0', '--property=TasksMax=128', '--property=UMask=0077',
        '/usr/bin/python3', '-I', '-B', h['path'], remote_plan(p), '--config-sha256', sha, '--phase', args.phase]
    guard = "import hashlib,os,pathlib,stat,sys; p=pathlib.Path(sys.argv[1]); s=p.lstat(); assert p.resolve()==p and stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and not s.st_mode & 0o7022 and s.st_size<=2*1024**2; assert hashlib.sha256(p.read_bytes()).hexdigest()==sys.argv[2]; os.execv('/usr/bin/systemd-run',sys.argv[3:])"
    with bundle.open('rb') as source, Path(args.log).open('xb') as log:
        remote(['/usr/bin/python3','-I','-B','-c',guard,h['path'],h['sha256'],*argv], stdin=source, stdout=log, timeout=1260)

def publish(args):
    p, sha, _ = load_plan(args.plan)
    script = (ROOT / 'publish.py').read_bytes(); ast.parse(script)
    assert hashlib.sha256(script).hexdigest() == p['publicationWrapperSha256']
    argv = ['systemd-run', '--unit=proofofwork-recovery-release-'+p['releaseId']+'-ui-'+p['publicationAttempt'],
        '--service-type=exec', '--wait', '--pipe', '--property=User=root', '--property=Group=root',
        '--property=KillMode=control-group', '--property=RuntimeMaxSec=30min', '--property=TimeoutStopSec=30s',
        '--property=MemoryMax=4G', '--property=MemorySwapMax=0', '--property=TasksMax=128', '--property=UMask=0077',
        '/usr/bin/python3', '-I', '-B', '-', remote_plan(p), sha, p['commit'], p['tree'], p['publicationAttempt']]
    with Path(args.log).open('xb') as log:
        remote(argv, data=script, stdout=log, timeout=1860)

def main():
    global REPO
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=REPO, help='Exact clean committed release checkout')
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('preflight'); p.add_argument('output'); p.set_defaults(fn=preflight)
    p = sub.add_parser('make-plan'); p.add_argument('build_receipt'); p.add_argument('preflight'); p.add_argument('output'); p.add_argument('--attempt', default='initial')
    p.add_argument('--resume-plan'); p.add_argument('--resume-evidence'); p.add_argument('--resume-inventory'); p.add_argument('--preserved-plan'); p.add_argument('--preserved-evidence'); p.add_argument('--preserved-incoming-receipt'); p.add_argument('--preserved-inventory'); p.set_defaults(fn=make_plan)
    p = sub.add_parser('upload-plan'); p.add_argument('plan'); p.set_defaults(fn=upload_plan)
    p = sub.add_parser('publish'); p.add_argument('plan'); p.add_argument('log'); p.set_defaults(fn=publish)
    args = parser.parse_args()
    REPO = args.repo.resolve(strict=True)
    args.fn(args)

if __name__ == '__main__': main()
