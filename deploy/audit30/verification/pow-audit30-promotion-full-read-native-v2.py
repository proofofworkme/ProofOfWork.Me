#!/usr/bin/python3 -I
"""Fixed read-only fresh Oct3 member/TOC proof for the coupled-promotion namespace.
No SQL/private PG/Core/service configuration/pin/retirement changes.
Only its exact newly admitted audit unit and evidence may be created/stopped.
"""
import ast,base64,datetime,hashlib,json,os,re,signal,stat,subprocess,sys,time
from pathlib import Path
SOURCE_SHA='01b80fd9b4a3a92893c06f288b3d3bdc90e05b7ed6f7c6f25bebc21c1ecc56a3'
APPROVAL='6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
RID='20261003T144000Z';UNIT='proofofwork-audit30-pin-promotion-full-read-'+RID+'.service';DIRECTORY=Path('/var/tmp/proofofwork-audit30-pin-promotion-'+RID+'-preflight');OUT=DIRECTORY/'full-read.json';ERR=DIRECTORY/'stderr.log';HOST='pow-bitcoin-01'
JOBS=('/data/proofofwork-audit30-restore-20261002T234651Z','/data/proofofwork-audit30-inspect-20261003T005512Z','/data/proofofwork-audit30-inspect-20261003T014100Z')
BACKUP=Path('/data/proofofwork-postgres-backups/logical/proof_indexer-20261003T031852Z.dumpset')
LOCK=BACKUP.parent/'.proofofwork-postgres-logical-backup.lock'
RO=(str(BACKUP),str(LOCK));DENIED=('/var/lib/postgresql','/run/postgresql','/data/proofofwork-postgres-tablespaces','/etc/proofofwork-api','/data/bitcoin',*JOBS)
PIN=Path('/etc/proofofwork-postgres-logical-backup.pins');CHECKER=Path('/usr/local/sbin/proofofwork-retention-protection')
STATIC=(PIN,CHECKER,Path('/etc/proofofwork-retention/audit28.hold'),Path('/etc/proofofwork-retention/audit28-held-review.json'),Path('/usr/local/sbin/proofofwork-postgres-logical-backup'),Path('/etc/systemd/system/proofofwork-retention-protection.service'),Path('/etc/systemd/system/proofofwork-postgres-logical-backup.service'),Path('/etc/systemd/system/proofofwork-postgres-logical-backup.timer'))
FIXED_HASHES={str(PIN):'821b5bbfecee75ffb3c4565d3867eb62ac33e65eeb83c0e603c08aa478ff957b',str(CHECKER):'da5d1336ce857acc571ba0849c2b0150ef5fc6dfdacf80e65b9f1d3611c48e8a',str(STATIC[2]):'e9aca6e22b1dc36b714ed663051f8bc20d9479efa4173474e0b6b771958ca6a4',str(STATIC[3]):'c3bd35740d7fcc135839274c8228e38f7a45c23e33567743e0d77151b32451d9',str(STATIC[4]):'4e5252ed8fcc8ce4ec863d6e027d429f146348f30be23d4eb5fe77cfd013a754',str(STATIC[5]):'8f9c54b522961e26d8f02ed33ad065af70906f1e95ca2ad65edd322c8f758448'}
PRUNE='proofofwork-node-release-prune.timer';MASK=Path('/etc/systemd/system')/PRUNE
PROTECTED=(PRUNE,'pg_receivewal@16-main.service','proofofwork-retention-protection.service')
PROTECTED_FIELDS=('LoadState','ActiveState','SubState','MainPID','InvocationID','UnitFileState')
PROTECTED_FIELDS_BY_UNIT={name:tuple(k for k in PROTECTED_FIELDS if k!='MainPID')if name==PRUNE else PROTECTED_FIELDS for name in PROTECTED}
LOCK_EXPECTED={'dev':64514,'ino':7471419,'uid':108,'gid':112,'mode':0o600,'nlink':1,'bytes':0,'mtimeNs':1790997532936269129,'ctimeNs':1790997532936269129}
class Oct3ReadInterrupted(RuntimeError):pass
LIVE=('bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service')
FIELDS=('LoadState','ActiveState','SubState','MainPID','InvocationID','Type','Transient','RemainAfterExit','User','Group','ControlGroup','Result','ExecMainStatus','CPUQuotaPerSecUSec','CPUWeight','IOWeight','Nice','MemoryHigh','MemoryMax','MemorySwapMax','TasksMax','RuntimeMaxUSec','TimeoutStopUSec','KillMode','Restart','NoNewPrivileges','CapabilityBoundingSet','AmbientCapabilities','ProtectSystem','ProtectHome','PrivateTmp','PrivateDevices','PrivateIPC','PrivateNetwork','RestrictAddressFamilies','ReadOnlyPaths','ReadWritePaths','InaccessiblePaths','StandardInput','StandardOutput','StandardError','LimitFSIZE','UMask','FragmentPath','DropInPaths','SourcePath')
PROPS={'Type':'exec','RemainAfterExit':'yes','User':'postgres','Group':'postgres','CPUQuota':'25%','CPUWeight':'10','IOWeight':'10','Nice':'15','MemoryHigh':'96M','MemoryMax':'128M','MemorySwapMax':'0','TasksMax':'16','RuntimeMaxSec':'6min','TimeoutStopSec':'30s','KillMode':'control-group','Restart':'no','NoNewPrivileges':'yes','CapabilityBoundingSet':'','AmbientCapabilities':'','ProtectSystem':'strict','ProtectHome':'yes','PrivateTmp':'yes','PrivateDevices':'yes','PrivateIPC':'yes','PrivateNetwork':'yes','RestrictAddressFamilies':'AF_UNIX','ReadOnlyPaths':' '.join(RO),'ReadWritePaths':'','InaccessiblePaths':' '.join(DENIED),'StandardInput':'null','StandardOutput':'append:'+str(OUT),'StandardError':'append:'+str(ERR),'LimitFSIZE':'32M','UMask':'0077'}
DEADLINE=0;OWNED=None;LAUNCHED=False;ARGV=None

def need(v,m):
 if not v:raise ValueError(m)
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'Duplicate key');d[k]=v
 return d
def parse(b):return json.loads(b,object_pairs_hook=pairs)
def metadata(s):return {'dev':s.st_dev,'ino':s.st_ino,'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'nlink':s.st_nlink,'bytes':s.st_size,'mtimeNs':s.st_mtime_ns,'ctimeNs':s.st_ctime_ns}
def durable(path,value):
 raw=encoded(value);fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
 return {'path':str(path),'bytes':len(raw),'sha256':sha(raw)}
def command(argv,cleanup=False):
 need(cleanup or time.monotonic()<DEADLINE,'Root whole420s deadline');r=subprocess.run(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15 if cleanup else min(15,max(.01,DEADLINE-time.monotonic())),env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'},cwd='/');need(r.returncode==0 and len(r.stdout)<=131072 and len(r.stderr)<=131072,'Fixed command refused '+sha(r.stderr));return r.stdout

def show(unit,fields,cleanup=False):
 b=command(['/usr/bin/systemctl','show',unit,'--no-pager',*['--property='+k for k in fields]],cleanup);d={}
 for line in b.decode().splitlines():
  k,sep,v=line.partition('=');need(sep and k not in d,'Unit property shape');d[k]=v
 need(set(d)==set(fields),'Unit fields missing');return d

def absent(v):need(v['LoadState']=='not-found'and v['ActiveState']=='inactive'and v['SubState']=='dead'and v['MainPID']=='0'and v['InvocationID']=='','Preexisting audit unit')
def identity(v,owned=None,cleanup=False):
 fixed=v['ControlGroup']=='/system.slice/'+UNIT;empty=v['ControlGroup']==''and v['MainPID']=='0'and v['ActiveState']=='active'and v['SubState']=='exited'and v['Result']=='success'and v['ExecMainStatus']=='0'
 failed=cleanup and owned is not None and v['ControlGroup']==''and v['MainPID']=='0'and v['ActiveState']=='failed'and v['SubState']=='failed'
 need(v['LoadState']=='loaded'and v['Type']=='exec'and v['Transient']=='yes'and v['RemainAfterExit']=='yes'and v['User']==v['Group']=='postgres'and v['MainPID'].isdigit()and re.fullmatch('[a-f0-9]{32}',v['InvocationID'])and(owned is None or v['InvocationID']==owned)and(fixed or empty or failed),'Exact owned audit unit identity')

def typed(cleanup=False):
 m=parse(command(['/usr/bin/busctl','--system','--json=short','call','org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager','GetUnit','s',UNIT],cleanup));need(isinstance(m,dict)and set(m)=={'type','data'}and m['type']=='o'and isinstance(m['data'],list)and len(m['data'])==1 and isinstance(m['data'][0],str)and m['data'][0]=='/org/freedesktop/systemd1/unit/'+''.join(c if c.isascii()and c.isalnum()else'_'+format(ord(c),'02x')for c in UNIT),'Typed manager unit object');v=parse(command(['/usr/bin/busctl','--system','--json=short','get-property','org.freedesktop.systemd1',m['data'][0],'org.freedesktop.systemd1.Service','ExecStart'],cleanup));need(isinstance(v,dict)and set(v)=={'type','data'}and v['type']=='a(sasbttttuii)'and isinstance(v['data'],list)and len(v['data'])==1,'Typed single ExecStart');e=v['data'][0];need(isinstance(e,list)and len(e)==10 and e[0]==ARGV[0]and e[1]==ARGV and e[2]is False and all(type(n)is int and n>=0 for n in e[3:]),'Fixed exact nativePG collector command');return {'objectPath':m['data'][0],'argvSha256':sha(encoded(ARGV))}

def validate_resources(v):
 expected={'CPUQuotaPerSecUSec':'250ms','CPUWeight':'10','IOWeight':'10','Nice':'15','MemoryHigh':str(96*1024**2),'MemoryMax':str(128*1024**2),'MemorySwapMax':'0','TasksMax':'16','RuntimeMaxUSec':'6min','TimeoutStopUSec':'30s','LimitFSIZE':str(32*1024**2)}
 expected|={k:PROPS[k]for k in('KillMode','Restart','NoNewPrivileges','CapabilityBoundingSet','AmbientCapabilities','ProtectSystem','ProtectHome','PrivateTmp','PrivateDevices','PrivateIPC','PrivateNetwork','RestrictAddressFamilies','ReadOnlyPaths','ReadWritePaths','InaccessiblePaths','StandardInput','UMask')}
 expected|={'StandardOutput':'append','StandardError':'append'}
 need(all(v[k]==x for k,x in expected.items()),'Actual fixed resource/namespace/output enum drift')

def read_file(path,cap,initial=None):
 s=path.lstat();m=metadata(s);need(path.resolve(strict=True)==path and stat.S_ISREG(s.st_mode)and s.st_uid==s.st_gid==0 and s.st_nlink==1 and not s.st_mode&0o022 and not os.listxattr(path,follow_symlinks=False)and s.st_size<=cap,'Fixed root regular proof file')
 if initial is not None:need(all(m[k]==initial[k]for k in('dev','ino','uid','gid','mode','nlink')),'Capture inode/authority drift')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:need(metadata(os.fstat(f.fileno()))==m,'Read FD mismatch');b=f.read(cap+1);need(metadata(os.fstat(f.fileno()))==m,'Read FD changed')
 need(metadata(path.lstat())==m and len(b)==s.st_size,'Read path changed');return b,m

def fragment(v):
 p=Path('/run/systemd/transient')/UNIT;need(v['FragmentPath']==str(p)and v['DropInPaths']==v['SourcePath']=='','Exact root transient fragment');raw,m=read_file(p,65536);section='';found={};want={k:PROPS[k]for k in('StandardInput','StandardOutput','StandardError')}
 for line in raw.decode().splitlines():
  line=line.strip()
  if not line or line.startswith(('#',';')):continue
  need(not line.endswith('\\'),'Continuation refused')
  if line.startswith('['):need(line.endswith(']'),'Section malformed');section=line[1:-1];continue
  k,sep,value=line.partition('=')
  if k in want:need(sep and section=='Service'and k not in found and value==want[k],'Exact output directive drift');found[k]=value
 need(found==want,'Output directives missing');return {'path':str(p),'sha256':sha(raw),'metadata':m,'selectedDirectives':found}

def live():
 out={}
 for name in LIVE:
  v=show(name,('LoadState','ActiveState','SubState','MainPID','InvocationID'));need(v['LoadState']=='loaded'and v['ActiveState']=='active'and v['SubState']=='running'and v['MainPID'].isdigit()and int(v['MainPID'])>0 and re.fullmatch('[a-f0-9]{32}',v['InvocationID']),'Live baseline unavailable');out[name]=v
 return out

def quiet():
 s=show('proofofwork-postgres-logical-backup.service',('LoadState','ActiveState','SubState','MainPID','InvocationID'));need(s['LoadState']=='loaded'and s['ActiveState']=='inactive'and s['MainPID']=='0','Backup active');t=show('proofofwork-postgres-logical-backup.timer',('LoadState','ActiveState','SubState','UnitFileState','InvocationID','NextElapseUSecRealtime'));need(t['LoadState']=='loaded'and t['ActiveState']=='active'and t['SubState']=='waiting'and t['UnitFileState']=='enabled','Backup timer unavailable');next_=datetime.datetime.strptime(t['NextElapseUSecRealtime'],'%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=datetime.timezone.utc);need((next_-datetime.datetime.now(datetime.timezone.utc)).total_seconds()>900,'Backup window shorter than15min');return {'service':s,'timer':t}

def owned_stop():
 global OWNED
 v=show(UNIT,FIELDS,True)
 if v['LoadState']=='not-found':absent(v);return {'verified':True,'alreadyAbsent':True,'ownedInvocation':OWNED}
 identity(v,OWNED,True);t=typed(True)
 if OWNED is None:OWNED=v['InvocationID']
 command(['/usr/bin/systemctl','stop',UNIT],True);after=show(UNIT,FIELDS,True);need(after['MainPID']=='0'and((after['LoadState']=='not-found'and after['InvocationID']=='')or(after['InvocationID']==OWNED and after['ActiveState']in('inactive','failed'))),'Owned unit stop unverified');return {'verified':True,'ownedInvocation':OWNED,'before':v,'typed':t,'after':after}

def decode_request(raw):
 r=parse(raw);need(isinstance(r,dict)and set(r)=={'schema','approvalSha256','sourceSha256','sourceBase64','unit','directory','expectedLive','expectedProtection'}and r['schema']=='pow-audit30-oct3-full-read-native-request-v1'and r['approvalSha256']==APPROVAL and r['sourceSha256']==SOURCE_SHA and r['unit']==UNIT and r['directory']==str(DIRECTORY),'Exact Oct3 readonly scope')
 need(isinstance(r['expectedLive'],dict)and set(r['expectedLive'])==set(LIVE),'Fresh chosen-action five still required')
 for name,row in r['expectedLive'].items():
  need(isinstance(row,dict)and set(row)=={'LoadState','ActiveState','SubState','MainPID','InvocationID'}and row['LoadState']=='loaded'and row['ActiveState']=='active'and row['SubState']=='running'and isinstance(row['MainPID'],str)and row['MainPID'].isdigit()and int(row['MainPID'])>0 and isinstance(row['InvocationID'],str)and re.fullmatch('[a-f0-9]{32}',row['InvocationID']),'Exact fresh live tuple')
 p=r['expectedProtection'];need(isinstance(p,dict)and set(p)=={'files','mask','units'}and isinstance(p['files'],dict)and set(p['files'])==set(map(str,STATIC))and isinstance(p['units'],dict)and set(p['units'])==set(PROTECTED),'Fresh protection authority still required')
 for name,row in p['files'].items():
  need(isinstance(row,dict)and set(row)=={'metadata','sha256'}and isinstance(row['metadata'],dict)and set(row['metadata'])==set(LOCK_EXPECTED)and all(type(n)is int and n>=0 for n in row['metadata'].values())and isinstance(row['sha256'],str)and re.fullmatch('[a-f0-9]{64}',row['sha256']),'Closed protected file authority')
  need(name not in FIXED_HASHES or row['sha256']==FIXED_HASHES[name],'Fixed installed old protection bytes')
 need(isinstance(p['mask'],dict)and set(p['mask'])=={'metadata','target'}and p['mask']['target']=='/dev/null'and isinstance(p['mask']['metadata'],dict)and set(p['mask']['metadata'])==set(LOCK_EXPECTED)and all(type(n)is int and n>=0 for n in p['mask']['metadata'].values()),'Exact mask authority')
 for name,row in p['units'].items():need(isinstance(row,dict)and set(row)==set(PROTECTED_FIELDS_BY_UNIT[name])and all(isinstance(x,str)for x in row.values()),'Closed exact per-unit protection fields')
 source=base64.b64decode(r['sourceBase64'],validate=True);need(len(source)==6197 and sha(source)==SOURCE_SHA,'Exact frozenOct3 Oct3 source bytes');return r,source

def protection(expected):
 files={}
 for p in STATIC:
  b,m=read_file(p,2097152);need(m['mode']==(0o755 if p in(CHECKER,STATIC[4])else 0o600 if p==STATIC[2]else 0o644),'Fixed installed protection file mode');files[str(p)]={'metadata':m,'sha256':sha(b)}
  need(files[str(p)]==expected['files'][str(p)],'Installed protection bytes or metadata drift')
  if p==PIN:need(b==b'proof_indexer-20260929T031853Z.dumpset\n','Old pin remains installed')
 s=MASK.lstat();need(MASK.parent.resolve(strict=True)==MASK.parent and stat.S_ISLNK(s.st_mode)and s.st_uid==s.st_gid==0 and os.readlink(MASK)=='/dev/null'and not os.listxattr(MASK,follow_symlinks=False),'Exact root prune mask')
 mask={'metadata':metadata(s),'target':'/dev/null'};need(mask==expected['mask'],'Exact mask identity drift')
 units={name:show(name,PROTECTED_FIELDS_BY_UNIT[name])for name in PROTECTED};need(units==expected['units'],'Protection unit drift')
 need(units[PRUNE]['LoadState']=='masked'and units[PRUNE]['ActiveState']=='inactive'and units[PRUNE]['SubState']=='dead'and units[PRUNE]['UnitFileState']=='masked'and units[PRUNE]['InvocationID']=='','Exact inactive persistent prune timer')
 wal=units['pg_receivewal@16-main.service'];need(wal['LoadState']=='loaded'and wal['ActiveState']=='inactive'and wal['MainPID']=='0','Existing WAL receiver remains inactive')
 return {'files':files,'mask':mask,'units':units}

def chosen_protection(r):
 expected=parse(encoded(r['expectedProtection']));mon='proofofwork-retention-protection.service';current=show(mon,PROTECTED_FIELDS_BY_UNIT[mon]);need(set(current)==set(PROTECTED_FIELDS_BY_UNIT[mon])and all(isinstance(v,str)for v in current.values())and current['LoadState']=='loaded'and current['MainPID']=='0'and(current['ActiveState'],current['SubState'])in(('inactive','dead'),('failed','failed'))and current['UnitFileState']==expected['units'][mon]['UnitFileState']=='static'and(current['InvocationID']==''or re.fullmatch('[a-f0-9]{32}',current['InvocationID'])),'Fresh idle static monitor role');expected['units'][mon]=current;return protection(expected)

def static_protection(v):return dict(files=v['files'],mask=v['mask'],units={name:row for name,row in v['units'].items()if name!='proofofwork-retention-protection.service'})

def backup_metadata(source):
 tree=ast.parse(source);nodes=[x.value for x in tree.body if isinstance(x,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='EXPECTED'for t in x.targets)];need(len(nodes)==1,'Exact leaf metadata literal');expected=ast.literal_eval(nodes[0]);need(expected['path']==str(BACKUP),'Exact Oct3 directory literal')
 def one(p,old,directory=False):
  s=p.lstat();need(p.resolve(strict=True)==p and(stat.S_ISDIR(s.st_mode)if directory else stat.S_ISREG(s.st_mode))and not os.listxattr(p,follow_symlinks=False),'Canonical complete safe Oct3 input');m=metadata(s)
  need(all(m[new]==old[oldkey]for new,oldkey in(('dev','device'),('ino','inode'),('uid','uid'),('gid','gid'),('bytes','bytes'),('mtimeNs','mtimeNs'),('ctimeNs','ctimeNs')))and m['mode']==int(old['mode'],8)and m['nlink']==(2 if directory else 1),'Oct3 fixed full input identity');return m
 root=one(BACKUP,expected,True);need(set(os.listdir(BACKUP))=={'proof_indexer.dump','globals.sql','SHA256SUMS'},'Exact three Oct3 children');members={Path(x['path']).name:one(Path(x['path']),x)for x in expected['members']}
 s=LOCK.lstat();need(LOCK.resolve(strict=True)==LOCK and stat.S_ISREG(s.st_mode)and metadata(s)==LOCK_EXPECTED and not os.listxattr(LOCK,follow_symlinks=False),'Exact existing backup lock identity');return {'directory':root,'members':members,'backupLock':LOCK_EXPECTED}

def proof_result(value,before):
 need(isinstance(value,dict)and set(value)=={'schema','atUtc','backup','backupLock','toc','checksumManifest','globalsStatementCategoryCounts','globalsContentsEmitted','fullDumpHashReverified','productionDataMutation','qualification'}and value['schema']=='pow-audit30-latest-backup-full-read-v1'and value['globalsContentsEmitted']is False and value['fullDumpHashReverified']is True and value['productionDataMutation']is False,'Exact Oct3 full-read qualification')
 when=datetime.datetime.fromisoformat(value['atUtc']);need(when.tzinfo is not None and 0<=(datetime.datetime.now(datetime.timezone.utc)-when).total_seconds()<=900,'Fresh full-read proof')
 def normalized(m):return {('dev'if k=='device'else'ino'if k=='inode'else k):v for k,v in m.items()}
 b=value['backup'];need(set(b)=={'path','directory','members'}and b['path']==str(BACKUP)and normalized(b['directory'])==before['directory']and set(b['members'])==set(before['members']),'Exact Oct3 result tree')
 hashes={'proof_indexer.dump':'1fd052a6f4aa8b02faeb3c46a3ff186de224a37c276bdfbc780850e9696f08f6','globals.sql':'ae3c770e540348966326a1a0da0e2a003ec59918b3ca609de70f9ae302850bfa','SHA256SUMS':'303c15ad27e464abafe2561299d3f5470bc2efb2f873c03f3b924092a21f0683'}
 for name,h in hashes.items():row=dict(b['members'][name]);need(row.pop('sha256',None)==h and normalized(row)==before['members'][name],'Oct3 all member hashes/identity')
 need(normalized(value['backupLock'])==before['backupLock'],'Result lock identity')
 toc=value['toc'];need(isinstance(toc,dict)and set(toc)=={'sha256','bytes','entries','text'}and isinstance(toc['sha256'],str)and re.fullmatch('[a-f0-9]{64}',toc['sha256'])and type(toc['bytes'])is int and 0<toc['bytes']<1024**2 and type(toc['entries'])is int and 0<toc['entries']<=10000 and isinstance(toc['text'],str)and len(toc['text'].encode())==toc['bytes']and sha(toc['text'].encode())==toc['sha256']and sum(bool(re.match(r'^\d+;',line))for line in toc['text'].splitlines())==toc['entries'],'First discovered full bounded TOC')
 need(isinstance(value['checksumManifest'],str)and sha(value['checksumManifest'].encode())==hashes['SHA256SUMS'],'Exact checksum manifest bytes')
 return {'fullDumpHashReverified':True,'allThreeMemberHashesVerified':True,'fullTocDiscoveredAndVerified':True,'globalsContentsEmitted':False}

def main():
 global ARGV,DEADLINE,LAUNCHED,OWNED
 need(os.geteuid()==os.getegid()==0 and sys.flags.isolated and len(sys.argv)==2 and re.fullmatch('[a-f0-9]{64}',sys.argv[1])and os.uname().nodename==HOST,'Fixed isolated root role');DEADLINE=time.monotonic()+420;raw=sys.stdin.buffer.read(65537);need(len(raw)<=65536 and sha(raw)==sys.argv[1],'Exact typed request raw SHA');r,source=decode_request(raw)
 prefix='import os\nfor _p in '+repr(RO)+':\n if not os.statvfs(_p).f_flag & os.ST_RDONLY: raise ValueError("Required actual readonly mount")\nfor _p in '+repr(DENIED)+':\n try: os.listdir(_p)\n except (PermissionError,FileNotFoundError): continue\n raise ValueError("Live namespace accessible")\n'
 ARGV=['/usr/bin/python3','-I','-B','-c',prefix+source.decode()];absence=show(UNIT,FIELDS);absent(absence);backup=quiet();before=live();need(before==r['expectedLive'],'Fresh chosen-action live tuple drift');protectedBefore=chosen_protection(r);inputsBefore=backup_metadata(source);need(not os.path.lexists(DIRECTORY)and DIRECTORY.parent.resolve()==DIRECTORY.parent,'New private evidence collision');os.mkdir(DIRECTORY,0o700);durable(DIRECTORY/'intent.json',{'schema':r['schema'],'requestSha256':sha(raw),'sourceSha256':SOURCE_SHA,'unit':UNIT,'argvSha256':sha(encoded(ARGV)),'prelaunchUnitAbsence':absence,'backupBefore':backup,'liveBefore':before,'protectionBefore':protectedBefore,'inputsBefore':inputsBefore,'chosenActionMayPrecedeCutover':True,'knownHeldAbsencesUnresolved':18,'productionMutation':False});stamps={}
 for p in(OUT,ERR):fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.fsync(fd);os.close(fd);stamps[p.name]=metadata(p.lstat())
 old={s:signal.getsignal(s)for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP,signal.SIGALRM)}
 def interrupted(s,f):raise Oct3ReadInterrupted('Readonly native420s deadline/signal')
 for s in old:signal.signal(s,interrupted)
 signal.setitimer(signal.ITIMER_REAL,420);failure=None;cleanup=None;observed=[];result=None
 try:
  args=['/usr/bin/systemd-run','--quiet','--no-block','--unit='+UNIT,*['--property='+k+'='+v for k,v in PROPS.items()],'--',*ARGV];LAUNCHED=True;need(command(args)==b'','Unexpected launch output')
  while True:
   v=show(UNIT,FIELDS);identity(v,OWNED);t=typed();OWNED=v['InvocationID'];validate_resources(v);f=fragment(v);observed.append({'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'properties':v,'typed':t,'fragment':f});need(len(observed)<=500,'Resource snapshots bound');need(OUT.stat().st_size<=32*1024**2 and ERR.stat().st_size<=1024**2,'Native file capture bound')
   if v['MainPID']=='0'and v['ActiveState']=='active'and v['SubState']=='exited':need(v['Result']=='success'and v['ExecMainStatus']=='0','Collector failed');break
   time.sleep(1)
  proof,pm=read_file(OUT,32*1024**2,stamps[OUT.name]);err,em=read_file(ERR,1024**2,stamps[ERR.name]);need(not err,'Collector stderr');value=parse(proof);accepted=proof_result(value,inputsBefore);after=live();need(after==before==r['expectedLive'],'Live service changed during readonly proof');backupAfter=quiet();need(backupAfter==backup,'Ordinary backup timer/service identity drift');protectedAfter=chosen_protection(r);need(static_protection(protectedAfter)==static_protection(protectedBefore),'Static8/pin/checker/hold/mask/WAL/prune endpoint drift');inputsAfter=backup_metadata(source);need(inputsAfter==inputsBefore,'Oct3 full input/lock endpoint drift');result={'proofFile':{'path':str(OUT),'sha256':sha(proof),'metadata':pm},'stderr':{'path':str(ERR),'sha256':sha(err),'metadata':em},**accepted,'freshFullReadAtUtc':value['atUtc'],'toc':value['toc'],'checksumManifest':value['checksumManifest'],'globalsStatementCategoryCounts':value['globalsStatementCategoryCounts'],'liveBeforeAfterEqual':True,'liveBefore':before,'liveAfter':after,'backupBefore':backup,'backupAfter':backupAfter,'protectionBefore':protectedBefore,'protectionAfter':protectedAfter,'monitorOperationalBefore':protectedBefore['units']['proofofwork-retention-protection.service'],'monitorOperationalAfter':protectedAfter['units']['proofofwork-retention-protection.service'],'monitorOperationalTupleUnchanged':protectedBefore['units']['proofofwork-retention-protection.service']==protectedAfter['units']['proofofwork-retention-protection.service'],'monitorObservedSeparatelyFromStaticAuthority':True,'inputsBefore':inputsBefore,'inputsAfter':inputsAfter,'pinAndCheckerRemainOriginal':True,'knownHeldAbsencesUnresolved':18,'financialOrCustodyAbsencesResolved':False,'qualification':'Full Oct3 three-member content hash and first bounded TOC discovery only; no isolated restore/equivalence or pin/checker promotion. Monitor operational idle tuples are separately observed before/after and may differ; static8 bytes/mask/WAL/prune and originalfive remain exact. Existing18 held absence findings remain unresolved.'}
 except BaseException as ex:failure={'errorClass':type(ex).__name__,'reasonSha256':sha(str(ex).encode())}
 finally:
  signal.setitimer(signal.ITIMER_REAL,0)
  for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(s,signal.SIG_IGN)
  try:
   if LAUNCHED:cleanup=owned_stop()
  except BaseException as ex:cleanup={'verified':False,'errorClass':type(ex).__name__,'reasonSha256':sha(str(ex).encode())}
  outcome={'schema':'pow-audit30-oct3-full-read-native-outcome-v1','status':'passed'if failure is None and cleanup and cleanup['verified']else'failed','requestSha256':sha(raw),'sourceSha256':SOURCE_SHA,'unit':UNIT,'failure':failure,'cleanup':cleanup,'actualResourceSnapshots':observed,'result':result,'productionMutation':False,'pinChanged':False,'deletionAuthorized':False,'autoRetry':False};binding=durable(DIRECTORY/('completed.json'if outcome['status']=='passed'else'failed.json'),outcome)
  for s,h in old.items():signal.signal(s,h)
 need(outcome['status']=='passed','Readonly proof failed with durable evidence');return {'schema':outcome['schema'],'status':outcome['status'],'outcome':binding,'result':result,'unitStopVerified':True,'productionMutation':False,'deletionAuthorized':False}
if __name__=='__main__':
 try:v=main()
 except BaseException as ex:print(json.dumps({'schema':'pow-audit30-oct3-full-read-native-refusal-v1','errorClass':type(ex).__name__,'reasonSha256':sha(str(ex).encode()),'productionMutation':False}),file=sys.stderr);raise SystemExit(1)
 print(json.dumps(v,sort_keys=True,separators=(',',':')))
