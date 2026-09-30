#!/usr/bin/python3 -I
"""Read-only check of the prepared persistent Audit 28 retention pause."""
import argparse,json,pathlib,stat,subprocess,datetime,hashlib,pwd

EXPECTED_LOGICAL_BACKUP_TOOL_SHA256 = "a2781c0db1a8350734eebdc964a883ddedba67c3632bc8664b87f6e9261273d4"
EXPECTED_LOGICAL_PIN = 'proof_indexer-20260929T031853Z.dumpset'

def file_facts(path):
    try:
        info=path.lstat()
        return dict(exists=True,regular=stat.S_ISREG(info.st_mode),symlink=stat.S_ISLNK(info.st_mode),canonical=path.resolve()==path,uid=info.st_uid,mode=stat.S_IMODE(info.st_mode),bytes=info.st_size)
    except OSError:
        return dict(exists=False)

def logical_pin_protection_is_valid(pin, names, tool, digest):
    safe=lambda row: row.get('exists') and row.get('regular') and not row.get('symlink') and row.get('canonical') and row.get('uid')==0
    return bool(safe(pin) and pin.get('mode')==0o644 and pin.get('bytes',4097)<=4096 and names==[EXPECTED_LOGICAL_PIN] and safe(tool) and tool.get('mode')==0o755 and digest==EXPECTED_LOGICAL_BACKUP_TOOL_SHA256)

def evaluate(role, marker, units, logical_pin_protected=False):
    problems=[]
    if not marker.get('exists') or marker.get('symlink') or not marker.get('regular') or not marker.get('canonical') or marker.get('uid')!=0 or marker.get('mode',0)&0o7022:
        problems.append('retention-hold-marker-missing-or-unsafe')
    for name,row in units.items():
        if row.get('LoadState')!='masked' or row.get('ActiveState')!='inactive' or not row.get('persistentMask'):
            problems.append('retention-timer-not-persistently-paused:'+name)
    if role=='node' and not logical_pin_protected:
        problems.append('pinned-logical-restore-backup-not-protected')
    return dict(role=role,ok=not problems,issues=problems,units=units)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--role',choices=['ui','node'],required=True);args=parser.parse_args()
    path=pathlib.Path('/etc/proofofwork-retention/audit28.hold')
    try:
        info=path.lstat();marker=dict(exists=True,symlink=stat.S_ISLNK(info.st_mode),regular=stat.S_ISREG(info.st_mode),canonical=path.resolve()==path,uid=info.st_uid,mode=stat.S_IMODE(info.st_mode))
    except FileNotFoundError:marker=dict(exists=False)
    names=['proofofwork-ui-release-prune.timer','proofofwork-ui-storage-prune.timer'] if args.role=='ui' else ['proofofwork-node-release-prune.timer']
    units={}
    for name in names:
        result=subprocess.run(['systemctl','show',name,'-p','LoadState','-p','ActiveState'],capture_output=True,text=True,timeout=5)
        units[name]=dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
        mask=pathlib.Path('/etc/systemd/system')/name
        try:
            info=mask.lstat()
            units[name]['persistentMask']=stat.S_ISLNK(info.st_mode) and info.st_uid==0 and mask.readlink()==pathlib.Path('/dev/null')
        except FileNotFoundError:
            units[name]['persistentMask']=False
    logical_protected=False
    if args.role=='node':
        pins=pathlib.Path('/etc/proofofwork-postgres-logical-backup.pins')
        tool=pathlib.Path('/usr/local/sbin/proofofwork-postgres-logical-backup')
        pin_info=file_facts(pins);tool_info=file_facts(tool);names=[];digest=''
        try:
            if pin_info.get('regular') and pin_info.get('bytes',4097)<=4096:names=pins.read_text().splitlines()
            if tool_info.get('regular') and tool_info.get('bytes',131073)<=131072:digest=hashlib.sha256(tool.read_bytes()).hexdigest()
        except OSError:pass
        logical_protected=logical_pin_protection_is_valid(pin_info,names,tool_info,digest)
        source=pathlib.Path('/data/proofofwork-postgres-backups/logical')/EXPECTED_LOGICAL_PIN
        directory=file_facts(source);dump=file_facts(source/'proof_indexer.dump')
        try: postgres_uid=pwd.getpwnam('postgres').pw_uid
        except KeyError: postgres_uid=-1
        logical_protected=bool(logical_protected and directory.get('exists') and not directory.get('symlink') and directory.get('canonical') and directory.get('uid')==postgres_uid and directory.get('mode')==0o700 and dump.get('regular') and not dump.get('symlink') and dump.get('canonical') and dump.get('uid')==postgres_uid and dump.get('bytes')==19363782935)
    result=evaluate(args.role,marker,units,logical_protected);result['checkedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    print(json.dumps(result));return 0 if result['ok'] else 1
if __name__=='__main__':raise SystemExit(main())
