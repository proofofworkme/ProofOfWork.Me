#!/usr/bin/env python3
"""Exact UI frontend release preparation and launch, including Publish.

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

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
SSH = ['ssh', '-i', '/home/sixer/.ssh/proofofwork_me_ed25519',
       '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
       '-o', 'ConnectTimeout=10', 'root@77.42.91.106']
HEX40 = re.compile('[0-9a-f]{40}')
HEX64 = re.compile('[0-9a-f]{64}')
RELEASE = re.compile('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z')
SURFACES = 'activity boost browser computer desktop dns growth id inception infinity landing marketplace nft publish token wallet work'.split()

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
    assert subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], text=True).strip() == b['commit']
    assert subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD^{tree}'], text=True).strip() == b['tree']
    assert not subprocess.check_output(['git', '-C', str(REPO), 'status', '--porcelain', '--untracked-files=all'])
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
         'retentionDeferred': True, 'frontendOnly': True}
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
        inode_budget = max(15000 if kind == 'source' else 4000,
                           len(members) + (256 if kind == 'source' else 128))
        assert inode_budget <= 100000
        c['admissions'][kind+'-receive'] = {'bytes': rounded + len(members)*4096 + 16*1024**2,
                                         'inodes': inode_budget}
    assert set(logical) == {'source', 'surfaces'}
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
    p = sub.add_parser('make-plan'); p.add_argument('build_receipt'); p.add_argument('preflight'); p.add_argument('output'); p.add_argument('--attempt', default='initial'); p.set_defaults(fn=make_plan)
    p = sub.add_parser('upload-plan'); p.add_argument('plan'); p.set_defaults(fn=upload_plan)
    p = sub.add_parser('publish'); p.add_argument('plan'); p.add_argument('log'); p.set_defaults(fn=publish)
    args = parser.parse_args()
    REPO = args.repo.resolve(strict=True)
    args.fn(args)

if __name__ == '__main__': main()
