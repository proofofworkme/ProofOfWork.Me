#!/usr/bin/python3 -I
"""Run only Jobs discovery online using the existing worker's server config.

The worker environment is reused inside this root helper and never printed,
serialized, persisted or put on a command line. No wallet material is involved.
"""
import base64, hashlib, json, os, subprocess, sys
from pathlib import Path

def bootstrap(plan):
    if os.geteuid() != 0 or not sys.flags.isolated or plan.get('format') != 'proof-of-work-jobs-rollout-plan-v1':
        raise ValueError('Exact rollout plan, root and isolated Python required')
    code = base64.b64decode(plan['controllerBase64'], validate=True)
    if hashlib.sha256(code).hexdigest() != plan['controllerSha256']: raise ValueError('Controller changed')
    ns = {'__name__':'_jobs_online_bootstrap'}; exec(compile(code,'jobs-scoped-node.py','exec'),ns)
    require, read, root = ns['require'], ns['safe_read'], ns['ROOT']; m = plan['runtimeManifestTemplate']
    after = {row['path']:row['after'] for row in m['sources']}
    for name, expected in {**m['dependencies'],**after}.items():
        require(ns['sha'](read(root/name)) == expected, 'Installed runtime changed: '+name)
    require(ns['sha'](read(Path(plan['nodePath']),200*1024**2)) == m['nodeSha256'], 'Node changed')
    require(ns['sha'](read(Path('/etc/systemd/system/proofofwork-indexer-worker.service'))) == plan['workerUnitSha256'], 'Worker unit changed')
    services = ns['states'](ns['UNITS'])
    require(all(row['ActiveState'] == 'active' and row['WorkingDirectory'] == str(root) for row in services.values()), 'Runtime services unavailable')
    require(not os.path.lexists(ns['HOLD']), 'Search was not restored')
    pid = services[ns['UNITS'][1]]['MainPID']; proc = Path('/proc')/pid
    before = proc.stat(); require(before.st_uid != 0, 'Worker must remain unprivileged')
    # The same configured DB/RPC/verification environment enters the child;
    # only its discovery budget is overridden. Do not expose this dictionary.
    raw = (proc/'environ').read_bytes(); require(len(raw) <= 256*1024, 'Oversized worker environment')
    env = {k.decode():v.decode() for item in raw.split(b'\0') if item for k,v in [item.split(b'=',1)]}
    require(env.get('NETWORK') == 'livenet', 'Wrong worker network')
    env['POW_INDEX_JOBS_BOOTSTRAP_MAX_BLOCKS'] = '1000'
    require(proc.stat().st_ino == before.st_ino and ns['states'](ns['UNITS'])[ns['UNITS'][1]]['MainPID'] == pid, 'Worker changed before bootstrap')
    result = subprocess.run([plan['nodePath'],str(root/'scripts/backfill-proof-indexer.mjs'),'--bootstrap-jobs-candidates'],
        cwd=root,env=env,user=before.st_uid,group=before.st_gid,extra_groups=(),capture_output=True,timeout=120)
    require(len(result.stdout) <= 1024*1024 and len(result.stderr) <= 1024*1024, 'Bootstrap output exceeds evidence bound')
    require(result.returncode == 0, 'Jobs bootstrap refused; existing public services remain online')
    output = json.loads(result.stdout); witness = output.get('jobsDiscovery',{})
    require(output.get('ok') is True and output.get('network') == 'livenet' and witness.get('complete') is True,
        'Jobs discovery is incomplete; preserve progress and repeat online after review')
    require(witness.get('fromHeight') == 970404 and witness.get('indexedThroughBlock',0) >= 970403 and
        witness.get('blockedCandidates',[]) == [], 'Jobs witness boundary or closure differs')
    require(all(row['ActiveState'] == 'active' for row in ns['states'](ns['UNITS']).values()), 'Public services changed')
    return {'format':'proof-of-work-jobs-bootstrap-result-v1','releaseId':plan['releaseId'],
        'discovery':witness,'servicesOnline':True,'walletSigningExercised':False}

def main():
    raw = sys.stdin.buffer.read(20*1024**2+1)
    if len(raw) > 20*1024**2: raise ValueError('Oversized rollout plan')
    print(json.dumps(bootstrap(json.loads(raw))),flush=True)

if __name__ == '__main__': main()
