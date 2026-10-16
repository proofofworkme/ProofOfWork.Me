#!/usr/bin/env python3
"""Finish verified UI releases with bounded retention and independently restored custody.

The operator host keeps custody. The pinned VPS controller owns lifecycle state
and ordinary policy changes; custody.py owns descriptor-relative retirement.
Every local cycle is creation-only. Partial work requires exact reconciliation.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
CONFIG = '/etc/proofofwork-retention/ui-lifecycle.json'
CUSTODY = Path('/home/sixer/ProofOfWork.Me.release-custody-ui-retention')
EVIDENCE = '/var/backups/proofofwork-ui/cleanup-evidence'
SSH = ['ssh', '-i', '/home/sixer/.ssh/proofofwork_me_ed25519', '-o', 'BatchMode=yes',
       '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', 'root@77.42.91.106']
SHA = re.compile(r'[0-9a-f]{64}\Z')
APPROVAL_SHA = 'df166edb2d9817dd4f8af24819880b6bf08b396b6aa483adaa141415fc709379'
LOCAL_SOURCES = ('deploy/ui-retention/lifecycle.py', 'deploy/ui-retention/custody.py',
                 'deploy/ui-retention/inventory.py', 'deploy/ui-retention/removal.py',
                 'deploy/proofofwork-ui-verified-retention.py',
                 'deploy/audit30/ui-storage.py', 'deploy/audit30/ui-release-policy.py')


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def save(path, value):
    with path.open('xb') as stream:
        stream.write(encoded(value)); stream.flush(); os.fsync(stream.fileno())
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)


def blob(path):
    raw = Path(path).read_bytes()
    assert len(raw) <= 64*1024**2
    return {'base64': base64.b64encode(raw).decode(), 'sha256': sha(raw)}


def remote(argv, data=None, timeout=1800):
    result = subprocess.run([*SSH, shlex.join(argv)], input=data, capture_output=True,
                            timeout=timeout)
    if result.returncode:
        sys.stderr.buffer.write(result.stderr)
        raise RuntimeError('Lifecycle '+argv[-1]+' failed; inspect durable phase evidence before reconciliation')
    return json.loads(result.stdout)


DISCOVER = r'''
import hashlib,json,os,pathlib,re,stat
p=pathlib.Path('/etc/proofofwork-retention/ui-lifecycle.json');s=p.lstat()
assert p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0
assert s.st_nlink==1 and not s.st_mode & 0o7022 and s.st_size<=65536
fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
with os.fdopen(fd,'rb') as f:
 assert os.fstat(f.fileno())==s;raw=f.read(65537);assert os.fstat(f.fileno())==s
assert p.lstat()==s and len(raw)==s.st_size
v=json.loads(raw);assert v['schema']=='pow-ui-retention-lifecycle-config-v1'
assert re.fullmatch('/var/backups/proofofwork-ui/cleanup-evidence/ui-lifecycle-tools-[0-9a-f]{64}/deploy/ui-retention/lifecycle_remote.py',v['controller']['path'])
package=pathlib.Path(v['package']['path'])
assert package.parent==pathlib.Path('/var/backups/proofofwork-ui/cleanup-evidence') and package.name=='ui-lifecycle-tools-'+v['package']['sha256']
manifest=package/'package.json';ms=manifest.lstat()
assert manifest.resolve(strict=True)==manifest and stat.S_ISREG(ms.st_mode) and ms.st_uid==ms.st_gid==0 and ms.st_nlink==1 and not ms.st_mode & 0o7022 and ms.st_size<=65536
with os.fdopen(os.open(manifest,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME),'rb') as f:
 assert os.fstat(f.fileno())==ms;mr=f.read(65537);assert os.fstat(f.fileno())==ms
assert manifest.lstat()==ms and len(mr)==ms.st_size and hashlib.sha256(mr).hexdigest()==v['package']['sha256']
mv=json.loads(mr)
assert mv['sourceCommit']==v['sourceCommit'] and mv['sourceTree']==v['sourceTree']
print(json.dumps({'config':{'path':str(p),'sha256':hashlib.sha256(raw).hexdigest()},'controller':v['controller'],'value':v,'packageManifest':mv}))
'''


def discover():
    return remote(['/usr/bin/python3', '-I', '-B', '-c', DISCOVER], timeout=60)


def call(binding, operation, frame):
    assert binding['config']['path'] == CONFIG and SHA.fullmatch(binding['config']['sha256'])
    controller = binding['controller']
    assert re.fullmatch(r'/var/backups/proofofwork-ui/cleanup-evidence/ui-lifecycle-tools-[0-9a-f]{64}/deploy/ui-retention/lifecycle_remote.py', controller['path'])
    assert SHA.fullmatch(controller['sha256'])
    # Validate exact controller bytes before executing any code from its package.
    guard = "import hashlib,os,pathlib,stat,sys;p=pathlib.Path(sys.argv[1]);s=p.lstat();assert p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and not s.st_mode & 0o7022 and s.st_size<=2*1024**2;assert hashlib.sha256(p.read_bytes()).hexdigest()==sys.argv[2];os.execv('/usr/bin/python3',['/usr/bin/python3','-I','-B',str(p),*sys.argv[3:]])"
    command = ['/usr/bin/python3', '-I', '-B', '-c', guard,
               controller['path'], controller['sha256'], CONFIG,
               binding['config']['sha256'], operation]
    if operation != 'status':
        operation_id=frame['operationId']
        assert re.fullmatch(r'[a-z0-9][A-Za-z0-9-]{0,63}',operation_id)
        unit='proofofwork-ui-lifecycle-'+operation_id+'.service'
        launch="import os,subprocess,sys;v=dict(line.split('=',1) for line in subprocess.check_output(['/usr/bin/systemctl','show',sys.argv[1],'-p','LoadState','-p','ActiveState','-p','MainPID'],text=True,timeout=10).splitlines());assert v=={'LoadState':'not-found','ActiveState':'inactive','MainPID':'0'},'Prior lifecycle unit requires reconciliation';os.execv(sys.argv[2],sys.argv[2:])"
        command=['/usr/bin/python3','-I','-B','-c',launch,unit,'/usr/bin/systemd-run',
                 '--unit='+unit,'--service-type=exec','--wait','--pipe',
                 '--property=User=root','--property=Group=root','--property=KillMode=control-group',
                 '--property=RuntimeMaxSec=90min','--property=TimeoutStopSec=30s',
                 '--property=CPUQuota=50%','--property=MemoryMax=2G','--property=MemorySwapMax=0',
                 '--property=TasksMax=128','--property=UMask=0077','--property=Nice=15',
                 '/usr/bin/ionice','-c','3',*command]
    return remote(command, encoded(frame), timeout=5520 if operation!='status' else 600)


def status(require_complete=False):
    discovery = discover()
    for path in LOCAL_SOURCES:
        assert sha((ROOT/path).read_bytes()) == discovery['packageManifest']['files'][path]['sha256'], 'Local retention source differs from installed reviewed package: '+path
    result = call(discovery, 'status', {'requireComplete': require_complete})
    assert result['binding']['config'] == discovery['config']
    assert result['binding']['controller'] == discovery['controller']
    if require_complete:
        assert result['retentionComplete'] is True and result['publicationHealthy'] is True
    return result


def custody_module():
    spec = importlib.util.spec_from_file_location('release_custody', ROOT/'deploy/ui-retention/custody.py')
    module = importlib.util.module_from_spec(spec); sys.modules[spec.name] = module
    spec.loader.exec_module(module); module.load_helpers()
    return module


def ordinary_proof(plan, custody_plan, custody_root, module):
    qualified = json.loads(custody_plan.read_bytes())
    rows = [r for r in qualified['candidates'] if r.get('eligible') and r.get('retirementMethod') == 'ordinary-policy']
    records, objects = {}, []
    for frozen in plan['delete']:
        path = frozen['path']; matching = []
        for row in rows:
            root = row['path']
            if path == root or (row['artifactClass'] == 'managed-archive-group' and path in (root+'.sha256', root+'.provenance')):
                matching.append(row)
        assert len(matching) == 1, 'No unique custody group for planned ordinary object'
        row = matching[0]; key = hashlib.sha256(row['path'].encode()).hexdigest()[:16]
        record_path = custody_root/(key+'.json'); record = json.loads(record_path.read_bytes())
        archive = module.verify_custody(row, record, custody_plan, custody_root)
        if key not in records:
            module.restored_check(archive, custody_root/(key+'.inventory.json'),
                                  Path(record['restoration']['restoredPath'])).check_returncode()
            records[key] = blob(record_path)
        binding = {'path': EVIDENCE+'/ui-retention-custody-record-'+records[key]['sha256']+'.json',
                   'sha256': records[key]['sha256']}
        objects.append({'path': path, 'snapshotSha256': frozen['snapshot']['sha256'],
                        'custody': binding, 'sourceMember': Path(path).name if row['artifactClass']=='managed-archive-group' else '.',
                        'archiveSha256': record['archiveSha256'], 'inventorySha256': record['inventorySha256'],
                        'custodyPlanSha256': record['planSha256'], 'independentRestorationVerified': True})
    return {'schema': 'pow-ui-retention-ordinary-custody-proof-v1', 'scopeApprovalSha256': APPROVAL_SHA,
            'admissionIndex': plan['policyScope']['admissionIndex'],
            'planSha256': sha(encoded(plan).rstrip(b'\n')),
            'protectedReleaseIds': sorted(plan['protected'][k]['fields']['release_id'] for k in ('current','previous')),
            'objects': objects}, list(records.values())


def publication_binding(plan, publish_log):
    rows = []
    for line in Path(publish_log).read_text().splitlines():
        try: value = json.loads(line)
        except json.JSONDecodeError: continue
        if isinstance(value, dict) and value.get('releaseId') == plan['releaseId'] and 'exitCode' in value: rows.append(value)
    assert len(rows)==1 and rows[0]['exitCode']==0 and rows[0]['failure'] is None
    assert rows[0]['commit']==plan['commit'] and rows[0]['tree']==plan['tree']
    return {'path': '/var/tmp/proofofwork-deploy/recovery-publish-'+plan['releaseId']+'-'+plan['publicationAttempt']+'/receipt.json',
            'value': rows[0]}


def complete(plan_path, publish_log, https_receipt, destination):
    plan = json.loads(plan_path.read_bytes()); rid = plan['releaseId']
    if 'retentionLocalSources' in plan:
        assert set(plan['retentionLocalSources']) == set(LOCAL_SOURCES)
        for path, expected in plan['retentionLocalSources'].items():
            assert sha((ROOT/path).read_bytes()) == expected, 'Retention local source changed after admission'
    assert re.fullmatch(r'[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', rid)
    destination.mkdir(mode=0o700)
    current = status(); binding=current['binding']
    assert current['pair']['current']==rid
    if 'retentionLifecycle' in plan:
        for key in ('config','controller'):
            assert plan['retentionLifecycle'][key]==binding[key], 'Installed lifecycle changed after release admission'
    frame={'expectedStateSha256':current['stateSha256'], 'expectedPair':current['pair'],
           'operationId':'release-'+rid, 'httpsReceipt':blob(https_receipt),
           'publicationReceipt':publication_binding(plan,publish_log)}
    prepared=call(binding,'prepare-cycle',frame);save(destination/'prepared.json',prepared)
    assert prepared['lifecycleBinding']['approval']['sha256']==APPROVAL_SHA
    module=custody_module()
    ordinary=destination/'ordinary-qualified.json';module.qualify(ordinary,prepared['lifecycleBinding'])
    value=json.loads(ordinary.read_bytes())
    value['candidates']=[r for r in value['candidates'] if r.get('eligible') and r.get('retirementMethod')=='ordinary-policy']
    narrowed=destination/'ordinary-custody-plan.json';save(narrowed,value)
    CUSTODY.mkdir(mode=0o700,exist_ok=True)
    assert CUSTODY.resolve()==CUSTODY and not CUSTODY.stat().st_mode & 0o077
    cycle_custody=CUSTODY/rid;cycle_custody.mkdir(mode=0o700)
    ordinary_custody=cycle_custody/'ordinary';module.preserve(narrowed,ordinary_custody)
    proof,records=ordinary_proof(prepared['ordinaryPlan']['value'],narrowed,ordinary_custody,module)
    proof_path=destination/'ordinary-custody-proof.json';save(proof_path,proof)
    mutation={'expectedStateSha256':prepared['stateSha256'],'expectedPair':current['pair'],
              'operationId':'ordinary-'+rid,'cycleId':prepared['cycleId'],'pendingToken':prepared['pendingToken'],
              'custodyProof':blob(proof_path),'custodyRecords':records}
    applied=call(binding,'apply-ordinary',mutation);save(destination/'ordinary-applied.json',applied)
    # Ordinary deletion changes the admission closure. Always qualify anew.
    qualified=destination/'custody-qualified.json';module.qualify(qualified,applied['lifecycleBinding'])
    bulk=cycle_custody/'bulk';module.preserve(qualified,bulk)
    retired=destination/'custody-completed.json';module.retire(qualified,bulk,retired)
    final=call(binding,'complete-cycle',{'expectedStateSha256':applied['stateSha256'],
        'expectedPair':current['pair'],'operationId':'complete-'+rid,
        'cycleId':prepared['cycleId'],'pendingToken':prepared['pendingToken'],
        'custodyPlan':blob(qualified),'custodyResult':blob(retired)})
    save(destination/'completed.json',final)
    assert final['retentionComplete'] is True
    print(json.dumps({'retentionComplete':True,'releaseId':rid,'evidence':str(destination),
                      'custody':str(cycle_custody),'result':final}),flush=True)
    return final


def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='op',required=True)
    p=sub.add_parser('status');p.add_argument('--require-complete',action='store_true')
    p=sub.add_parser('complete')
    for name in ('plan','publish_log','https_receipt','destination'):p.add_argument(name,type=Path)
    args=parser.parse_args()
    if args.op=='status':print(json.dumps(status(args.require_complete)))
    else:complete(args.plan,args.publish_log,args.https_receipt,args.destination)


if __name__=='__main__':main()
