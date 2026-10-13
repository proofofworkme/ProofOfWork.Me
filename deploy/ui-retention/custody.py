#!/usr/bin/env python3
"""Explicit custody-qualified UI retirement; no age-based deletion or hold removal.

qualify PLAN; preserve PLAN CUSTODY; retire PLAN CUSTODY RESULT.
Every operation rechecks the current and immediate-prior release and holds.
Archives and complete independently restored copies remain on the operator host.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import types
import zlib

ROOT = Path(__file__).resolve().parents[2]
SSH = ['ssh', '-i', '/home/sixer/.ssh/proofofwork_me_ed25519', '-o', 'BatchMode=yes',
       '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', 'root@77.42.91.106']
BASE = Path('/var/backups/proofofwork-ui')
SOURCES = {'E': 'deploy/ui-retention/inventory.py', 'W': 'deploy/ui-retention/removal.py',
           'R': 'deploy/proofofwork-ui-verified-retention.py'}


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def digest(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def save(path, value):
    with Path(path).open('xb') as f:
        f.write(encoded(value)); f.flush(); os.fsync(f.fileno())


def load_helpers():
    for name, relative in SOURCES.items():
        spec = importlib.util.spec_from_file_location('retention_' + name, ROOT / relative)
        module = importlib.util.module_from_spec(spec)
        module._BOUND_EXPORTER = globals().get('E')
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        globals()[name] = module


def scope(path, plan):
    p = Path(path)
    allowed = (p.parent == BASE / 'rollback-roots' and re.fullmatch(r'proofofwork-www-pre-[0-9a-f]+-\d{8}T\d{6}Z', p.name)
        or p.parent == Path('/var/tmp/proofofwork-deploy') and re.fullmatch(r'proofofwork-www-stage-[0-9a-f]+-\d{8}T\d{6}Z', p.name)
        or p.parent == BASE / 'transport-evidence' and p.name.startswith('historical-archives-')
        or p.parent.parent == BASE / 'transport-evidence' and p.name == 'proofofwork-ui-source-' + p.parent.name
            and re.fullmatch(r'[0-9a-f]+-\d{8}T\d{6}Z', p.parent.name))
    if not allowed or p.resolve(strict=True) != p:
        raise ValueError('Outside custody retirement allowlist')
    if p == Path(plan['priorRoot']):
        raise ValueError('Latest rollback is protected')
    if p.parent != BASE / 'rollback-roots' and any(plan[k]['release_id'] in p.name for k in ('current', 'prior')):
        raise ValueError('Current/prior release dependency is protected')
    held = json.loads(E.read_regular('/etc/proofofwork-retention/audit28-held-review.json', 16*1024**2)[0])['retain']
    for row in held:
        h = Path(row['path'])
        if row['role'] == 'ui' and (p == h or p in h.parents or h in p.parents):
            raise ValueError('Individually held path intersection')


def fence(plan, full=False):
    if E.hold_snapshot() != plan['holds'] or E.timer_snapshot() != plan['timers']:
        raise ValueError('Retention holds/timers changed')
    for path, sha in plan['protectedManifests'].items():
        if E.digest(E.read_regular(Path(path) / '.proofofwork-ui-release')[0]) != sha:
            raise ValueError('Protected release changed; qualify again')
    if full:
        if R.verified_release(Path('/var/www'), BASE/'releases') != plan['current']:
            raise ValueError('Live release differs')
        if R.verified_release(Path(plan['priorRoot']), BASE/'releases') != plan['prior']:
            raise ValueError('Last verified rollback differs')


def expected(row):
    return dict(row['inventory']['fingerprint'], inventory=row['inventory']['records'])


def qualify(output):
    # Discovery creates a read-only proposal, never deletion authority by age.
    script = launcher('qualify', {})
    result = subprocess.run([*SSH, 'nice -n 15 ionice -c 3 python3 -I -B -'],
                            input=script, capture_output=True, check=True, timeout=1800)
    save(output, json.loads(result.stdout))


def remote_qualify():
    current=R.verified_release(Path('/var/www'),BASE/'releases')
    priorroot=BASE/'rollback-roots'/('proofofwork-www-pre-'+current['release_id'])
    prior=R.verified_release(priorroot,BASE/'releases')
    plan={'current':current,'prior':prior,'priorRoot':str(priorroot),'holds':E.hold_snapshot(),
          'timers':E.timer_snapshot(),'candidates':[],
          'protectedManifests':{str(p):E.digest(E.read_regular(p/'.proofofwork-ui-release')[0])
                                for p in [Path('/var/www'),priorroot]}}
    roots=list(Path('/var/tmp/proofofwork-deploy').glob('proofofwork-www-stage-*'))
    roots += [p for p in (BASE/'rollback-roots').iterdir() if p!=priorroot]
    roots += list((BASE/'transport-evidence').glob('historical-archives-*'))
    roots += list((BASE/'transport-evidence').glob('*/proofofwork-ui-source-*'))
    for path in sorted(roots):
        row={'path':str(path),'eligible':False};plan['candidates'].append(row)
        try:
            scope(path,plan)
            row['references']=W.check_references([path],config_roots=(*W.DEFAULT_CONFIG_ROOTS,'/var/spool/cron'))
            inventory=E.inventory(path,require_manifest=False,allow_symlinks=True)
            row['inventory']=inventory;groups={}
            for item in inventory['records']:
                if item['kind']=='file':
                    info=item['identity'];groups.setdefault((info['st_dev'],info['st_ino']),[]).append(item)
            if not all(len(rows)==rows[0]['identity']['st_nlink'] for rows in groups.values()):
                raise ValueError('External hardlinks prevent retirement')
            row['allocatedBytes']=sum(rows[0]['identity']['st_blocks']*512 for rows in groups.values())
            row['eligible']=True
        except Exception as error:row['reason']=str(error)
    fence(plan,full=True);print(json.dumps(plan))


def remote_operation(operation, frame):
    if os.geteuid() != 0:
        raise ValueError('Remote operation requires root')
    lock = E.lock_existing()
    try:
        if operation == 'qualify':
            remote_qualify(); return
        plan = frame['plan']; row = frame['row']; path = Path(row['path'])
        scope(path, plan); fence(plan, full=True)
        W.check_references([path], config_roots=(*W.DEFAULT_CONFIG_ROOTS, '/var/spool/cron'))
        E.assert_inventory(E.inventory(path, require_manifest=False, allow_symlinks=True), expected(row))
        if operation == 'export':
            result = E.archive_root(path, expected(row), sys.stdout.buffer, require_manifest=False, allow_symlinks=True)
            fence(plan); print(json.dumps(result), file=sys.stderr)
            return
        if operation != 'retire':
            raise ValueError('Unknown operation')
        custody = frame['custody']
        if not custody.get('ok') or custody['sourcePath'] != str(path) or custody['inventorySha256'] != E.inventory_sha(row['inventory']['records']):
            raise ValueError('Custody does not bind exact root')
        if not all(custody['restoration'][k] for k in ('ownerRestored','modeTimesXattrsRestored','internalHardlinksRestored')):
            raise ValueError('Full independent restoration is required')
        receipt = BASE/'cleanup-evidence'/('bounded-retention-' + frame['operationId'])
        if receipt.exists():
            raise ValueError('Prior intent exists; reconcile manually, never retry blindly')
        # Small durable receipt/journal envelope; existing reserve is never lowered.
        subprocess.run(['/usr/bin/python3','-I','-B','/usr/local/sbin/proofofwork-ui-capacity',
                        'check-retirement','--path',str(receipt.parent)], check=True, stdout=subprocess.DEVNULL)
        before = os.statvfs(BASE); receipt.mkdir(mode=0o700); W.sync_directory(receipt.parent)
        E.save_new(receipt/'intent.json', encoded(frame)); journal = W.Journal(receipt/'actions.jsonl')
        parent = os.open(path.parent, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOATIME)
        try:
            fence(plan)
            count = W.delete_tree(parent, path.name, expected(row), journal)
            fence(plan, full=True)
            after = os.statvfs(BASE)
            result = {'ok':True,'path':str(path),'actions':count,'custody':custody,
                      'beforeAvailableBytes':before.f_bavail*before.f_frsize,
                      'afterAvailableBytes':after.f_bavail*after.f_frsize,
                      'receipt':str(receipt),'protectedPairVerified':True}
            E.save_new(receipt/'completed.json',encoded(result)); print(json.dumps(result))
        except BaseException as error:
            E.save_new(receipt/'failure.json',encoded({'error':str(error),'manualReconciliationRequired':True}))
            raise
        finally:
            os.close(parent); journal.close()
    finally:
        os.close(lock)


def launcher(operation, frame):
    code = 'import base64,zlib,types,sys,json\n'
    for name, relative in SOURCES.items():
        raw = (ROOT/relative).read_bytes()
        code += f"m=types.ModuleType('bound_{name}');sys.modules[m.__name__]=m;m._BOUND_EXPORTER=globals().get('E')\n"
        code += f"exec(compile(base64.b64decode({base64.b64encode(raw).decode()!r}),{relative!r},'exec'),m.__dict__);{name}=m\n"
    own = Path(__file__).read_bytes()
    code += f"ns={{'__name__':'bound_controller','__file__':'/bound/deploy/ui-retention/custody.py','E':E,'W':W,'R':R}}\nexec(compile(base64.b64decode({base64.b64encode(own).decode()!r}),'custody.py','exec'),ns)\n"
    packed = base64.b64encode(zlib.compress(encoded(frame))).decode()
    code += f"ns['remote_operation']({operation!r},json.loads(zlib.decompress(base64.b64decode({packed!r}))))\n"
    return code.encode()


def preserve(plan_path, custody, resume=False):
    plan = json.loads(plan_path.read_bytes()); custody.mkdir(mode=0o700, exist_ok=resume)
    restore = Path('/tmp')/('pow-ui-custody-restore-'+hashlib.sha256(str(custody).encode()).hexdigest()[:16])
    restore.mkdir(mode=0o700, exist_ok=resume)
    for index, row in enumerate(plan['candidates']):
        if not row['eligible']:continue
        key = hashlib.sha256(row['path'].encode()).hexdigest()[:16]
        archive = custody/(key+'.tgz'); errors = custody/(key+'.stderr')
        if resume and (custody/(key+'.json')).exists():
            record=json.loads((custody/(key+'.json')).read_bytes())
            assert record['ok'] and record['sourcePath']==row['path'] and record['planSha256']==digest(plan_path)
            assert digest(archive)==record['archiveSha256']
            print(json.dumps({'alreadyPreserved':row['path']}),flush=True);continue
        if archive.exists() or errors.exists():
            raise ValueError('Partial custody requires manual reconciliation: '+str(archive))
        frame = {'plan':{k:v for k,v in plan.items() if k!='candidates'},'row':row}
        with archive.open('xb') as out, errors.open('xb') as err:
            subprocess.run([*SSH,'nice -n 15 ionice -c 3 python3 -I -B -'],input=launcher('export',frame),stdout=out,stderr=err,check=True,timeout=900)
            out.flush(); os.fsync(out.fileno())
        exported = json.loads(errors.read_text()); assert digest(archive)==exported['archiveSha256']
        inventory_path=custody/(key+'.inventory.json');save(inventory_path,expected(row))
        script="import importlib.util,json,sys;from pathlib import Path;s=importlib.util.spec_from_file_location('E',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.extract_verify(Path(sys.argv[2]),json.loads(Path(sys.argv[3]).read_text()),Path(sys.argv[4]))))"
        result=subprocess.run(['unshare','--user','--map-root-user','python3','-I','-B','-c',script,str(ROOT/SOURCES['E']),str(archive),str(inventory_path),str(restore/key)],capture_output=True,text=True,timeout=900)
        save(custody/(key+'.restore-log.json'),{'exitCode':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
        result.check_returncode()
        restored=json.loads(result.stdout)
        record={'ok':True,'sourcePath':row['path'],'archivePath':str(archive),'archiveSha256':digest(archive),
                'inventorySha256':E.inventory_sha(row['inventory']['records']),'restoration':restored,'planSha256':digest(plan_path)}
        save(custody/(key+'.json'),record);print(json.dumps({'preserved':row['path'],'bytes':archive.stat().st_size}),flush=True)


def retire(plan_path,custody,output):
    plan=json.loads(plan_path.read_bytes()); completed=[]
    if output.exists():raise ValueError('Result exists; inspect prior operation')
    for row in plan['candidates']:
        if not row['eligible']:continue
        key=hashlib.sha256(row['path'].encode()).hexdigest()[:16];record=json.loads((custody/(key+'.json')).read_bytes())
        assert record['planSha256']==digest(plan_path) and digest(record['archivePath'])==record['archiveSha256']
        # Reverify every restored byte, mode, owner, time, attribute and link now.
        script="import importlib.util,json,sys;from pathlib import Path;s=importlib.util.spec_from_file_location('E',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.verify_restored(Path(sys.argv[2]),json.loads(Path(sys.argv[3]).read_text()))))"
        subprocess.run(['unshare','--user','--map-root-user','python3','-I','-B','-c',script,str(ROOT/SOURCES['E']),record['restoration']['restoredPath'],str(custody/(key+'.inventory.json'))],check=True,stdout=subprocess.DEVNULL)
        frame={'plan':{k:v for k,v in plan.items() if k!='candidates'},'row':row,'custody':record,'operationId':digest(plan_path)[:12]+'-'+key,
               'authorization':'2026-10-13: Go ahead with the safe UI VPS cleanup and implement bounded retention and disk reserve checks. Keep the last verified rollback and all unique audit evidence, and verify everything still works.'}
        result=subprocess.run([*SSH,'nice -n 15 ionice -c 3 python3 -I -B -'],input=launcher('retire',frame),capture_output=True,check=True,timeout=900)
        value=json.loads(result.stdout);completed.append(value);save(Path(str(output)+'.'+key+'.json'),value)
        print(json.dumps({'retired':row['path'],'availableBytes':value['afterAvailableBytes']}),flush=True)
    save(output,{'ok':True,'completed':completed,'planSha256':digest(plan_path)})


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation',choices=['qualify','preserve','retire']);parser.add_argument('plan',type=Path);parser.add_argument('custody',nargs='?',type=Path);parser.add_argument('output',nargs='?',type=Path)
    parser.add_argument('--resume',action='store_true',help='Skip only complete, hash-verified preservation receipts; partial attempts refuse')
    args=parser.parse_args();os.umask(0o077);load_helpers()
    if args.operation=='qualify':qualify(args.plan)
    elif args.operation=='preserve':
        if args.custody is None:parser.error('preserve requires custody')
        preserve(args.plan,args.custody,args.resume)
    else:
        if args.output is None or args.custody is None:parser.error('retire requires custody and output')
        retire(args.plan,args.custody,args.output)

if __name__=='__main__':main()
