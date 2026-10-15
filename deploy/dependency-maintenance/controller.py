#!/usr/bin/python3 -I
"""Dormant fixed-scope dependency promotion. Capture is read-only; apply is explicit."""
import base64, copy, datetime, fcntl, hashlib, json, os, re, signal, stat, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path, PurePosixPath
NAMES=('nanoid','postcss','source-map-js','valibot')
VERSIONS={'nanoid':'3.3.20','postcss':'8.5.30','source-map-js':'1.2.2','valibot':'1.5.0'}
GUARD_SHA='5d2b1ae9b5686c61d4182f5ac42677e6105d97b3c8309045c614d98309d6112a'
HOLDER_SHA='3c89d0b5c14a01e8a5b1fe1df329f52bcf9b7a256ef0a0015830f0a92717b8c0'
ROOT=Path('/opt/proofofwork-api'); MOD=ROOT/'node_modules'
LOCKS=('package-lock.json','node_modules/.package-lock.json')

def need(value,message):
 if not value:raise ValueError(message)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return (json.dumps(value,sort_keys=True,indent=2)+'\n').encode()
def raw(path,limit=8*1024**2):
 p=Path(path);s=p.lstat();need(p.resolve()==p and stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_size<=limit,'Unsafe regular file: '+str(p))
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb') as f:
  need(identity(os.fstat(f.fileno()))==identity(s),'Changed read');b=f.read(limit+1);need(identity(os.fstat(f.fileno()))==identity(s),'Changed read')
 need(identity(p.stat())==identity(s) and len(b)==s.st_size,'Changed file');return b
def identity(s):return [s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns]
def names(path):
 need(path.resolve()==path and path.is_dir(),'Unsafe directory');fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOATIME)
 try:return sorted(os.listdir(fd))
 finally:os.close(fd)
def inventory(root,bytes_=False):
 rows={};total=0
 def visit(p):
  nonlocal total
  s=p.lstat();rel=str(p.relative_to(root));r={'kind':'directory' if stat.S_ISDIR(s.st_mode) else 'file' if stat.S_ISREG(s.st_mode) else 'symlink' if stat.S_ISLNK(s.st_mode) else 'other','mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid,'mtimeNs':s.st_mtime_ns,'nlink':s.st_nlink}
  need(r['kind']=='symlink' or not s.st_mode&0o7022,'Unsafe permissions: '+str(p))
  if r['kind']=='directory':
   need(p.resolve()==p,'Directory symlink');rows[rel]=r
   for n in names(p):visit(p/n)
  elif r['kind']=='file':
   b=raw(p,64*1024**2);total+=len(b);need(total<=512*1024**2 and len(rows)<20000,'Inventory too large');r.update(sha256=sha(b),bytes=len(b))
   if bytes_:r['base64']=base64.b64encode(b).decode()
   rows[rel]=r
  elif r['kind']=='symlink':
   need(not bytes_,'Selected dependency contains symlink');r['target']=os.readlink(p);rows[rel]=r
  else:raise ValueError('Special file')
 visit(root);return rows

def comparable(rows):return {p:{k:v for k,v in r.items() if k not in ('base64','mtimeNs','nlink')} for p,r in rows.items()}
def protected_modules(stage=None):
 result={}
 for name in names(MOD):
  if name in NAMES or name=='.package-lock.json' or name==stage:continue
  p=MOD/name
  if p.is_symlink():result[name]={'link':os.readlink(p),'identity':identity(p.lstat())}
  elif p.is_dir():result[name]=sha(encoded(inventory(p)))
  else:result[name]=sha(raw(p))
 return result

def support(request):
 result=[]
 for field,pin in [('guards',GUARD_SHA),('holder',HOLDER_SHA)]:
  b=base64.b64decode(request[field],validate=True);need(sha(b)==pin,'Support hash differs');ns={'__name__':'_reviewed_dependency_support'};exec(compile(b,field+'.py','exec'),ns);result.append(ns)
 return result

def source_pins():
 paths={'package.json','WORK_MARKET_V1_REFUNDS_959061.json','WORK_MARKET_V2_STALE_REFUND_REVIEW_959301.json'}
 for directory in ('server','scripts','src/shared/protocol','src/features/identity'):
  root=ROOT/directory
  def walk(p):
   for name in names(p):
    child=p/name;s=child.lstat()
    if stat.S_ISDIR(s.st_mode):walk(child)
    elif child.suffix in ('.mjs','.js','.json','.sql') and stat.S_ISREG(s.st_mode):paths.add(str(child.relative_to(ROOT)))
  walk(root)
 need(len(paths)<=2500,'Too many source files')
 return {name:{'sha256':sha(raw(ROOT/name)),'metadata':{k:inventory_file(ROOT/name)[k] for k in ('uid','gid','mode')}} for name in sorted(paths)}
def inventory_file(p):
 s=p.stat();return {'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode)}
def capture(G,H):
 services=G['states'](G['UNITS']);need(all(s['ActiveState']=='active' and s['WorkingDirectory']==str(ROOT) and int(s['MainPID'])>0 for s in services.values()),'Services not active')
 node=Path(os.readlink('/proc/'+services[G['UNITS'][0]]['MainPID']+'/exe'));need(str(node).startswith('/opt/node-'),'Wrong Node')
 locks={}
 for p in LOCKS:
  if not (ROOT/p).exists():continue
  b=raw(ROOT/p);locks[p]={'base64':base64.b64encode(b).decode(),'sha256':sha(b),'metadata':inventory_file(ROOT/p)}
 units=set(G['UNITS']+G['GATEWAY']+G['SEARCH'])
 result={'format':'pow-cef-node-dependency-capture-v1','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'root':str(ROOT),'head':subprocess.check_output(['/usr/bin/git','-c',f'safe.directory={ROOT}','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip(),'nodePath':str(node),'nodeSha256':sha(raw(node,200*1024**2)),'services':services,'authority':G['states'](G['AUTHORITY']),'searchBaseline':H['baseline'](),'gateway':G['gateway_states'](),'unitHashes':{u:sha(raw(Path('/etc/systemd/system')/u,65536)) for u in units},'sources':source_pins(),'packages':{n:inventory(MOD/n,True) for n in NAMES},'otherModules':protected_modules(),'locks':locks,'holdExists':os.path.lexists(G['HOLD'])}
 need(not result['holdExists'],'Existing hold');return result

def validate_payload(m):
 need(m.get('format')=='pow-cef-node-dependency-plan-v1' and m.get('executable') is True,'Nonexecutable or wrong plan')
 need(re.fullmatch('[0-9a-f]{40}',m.get('sourceCommit','')) is not None,'Wrong commit')
 need(re.fullmatch(m['sourceCommit'][:12]+r'-[0-9]{8}T[0-9]{6}Z',m.get('releaseId','')) is not None,'Wrong release')
 need(set(m['candidatePackages'])==set(NAMES),'Wrong package allowlist')
 before=m['capture'];need(before['format']=='pow-cef-node-dependency-capture-v1' and before['root']==str(ROOT),'Wrong baseline')
 need(set(before['packages'])==set(NAMES),'Wrong baseline package set')
 for name,rows in before['packages'].items():
  owner=rows['.'];need(owner['kind']=='directory' and owner['mode']==0o750,'Unqualified baseline package root')
  for row in rows.values():
   need(row['uid']==owner['uid'] and row['gid']==owner['gid'] and (row['kind']=='directory' and row['mode']==0o750 or row['kind']=='file' and row['mode'] in (0o640,0o750)),'Unqualified baseline package permissions')
 need(set(m['candidateLocks'])==set(before['locks']) and set(before['locks'])<=set(LOCKS) and 'package-lock.json' in before['locks'],'Wrong lock allowlist')
 total=0
 for name,rows in m['candidatePackages'].items():
  need('.' in rows and 'package.json' in rows and rows['.']['kind']=='directory','Missing package root')
  for rel,r in rows.items():
   q=PurePosixPath(rel);need(rel=='.' or str(q)==rel and not q.is_absolute() and all(x not in ('..','') for x in q.parts) and '\\' not in rel and not any(ord(c)<32 or ord(c)==127 for c in rel),'Unsafe member')
   need(r['kind'] in ('file','directory') and r['mode'] in (0o644,0o755),'Unsafe candidate kind/mode')
   if r['kind']=='file':
    b=base64.b64decode(r['base64'],validate=True);total+=len(b);need(len(b)==r['bytes'] and sha(b)==r['sha256'],'Candidate bytes differ')
  data=json.loads(base64.b64decode(rows['package.json']['base64']));need(data['name']==name and data['version']==VERSIONS[name],'Wrong candidate version')
  need(not data.get('dependencies') or name=='postcss' and data['dependencies']=={'nanoid':'^3.3.20','picocolors':'^1.1.1','source-map-js':'^1.2.2'},'Unexpected dependency closure')
 need(total<8*1024**2,'Candidate oversized')
 for path,row in m['candidateLocks'].items():
  b=base64.b64decode(row['base64'],validate=True);need(sha(b)==row['sha256'],'Lock pin differs');old=json.loads(base64.b64decode(before['locks'][path]['base64']));new=json.loads(b)
  old_other=copy.deepcopy(old);new_other=copy.deepcopy(new)
  for name in NAMES:
   k='node_modules/'+name;need(new['packages'][k]['version']==VERSIONS[name],'Wrong locked version');old_other['packages'].pop(k);new_other['packages'].pop(k)
  need(old_other==new_other,'Unrelated lock entry changed')
 return m

def fence(m,G,H,stage=None,after=False):
 b=m['capture'];need(source_pins()==b['sources'],'Accepted source or metadata changed')
 need(protected_modules(stage)==b['otherModules'],'Unrelated installed dependency changed')
 need(subprocess.check_output(['/usr/bin/git','-c',f'safe.directory={ROOT}','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip()==b['head'],'Git changed')
 need(sha(raw(Path(b['nodePath']),200*1024**2))==b['nodeSha256'],'Node binary changed')
 need(G['states'](G['AUTHORITY'])==b['authority'] and H['baseline']()==b['searchBaseline'],'Authority or timers changed')
 for u,h in b['unitHashes'].items():need(sha(raw(Path('/etc/systemd/system')/u,65536))==h,'Unit changed')
 for name in NAMES:
  actual=inventory(MOD/name)
  expected=m['candidatePackages'][name] if after else b['packages'][name]
  if after:
   expected=copy.deepcopy(expected);owner=b['packages'][name]['.']
   for r in expected.values():r['uid']=owner['uid'];r['gid']=owner['gid'];r['mode']=0o750 if r['kind']=='directory' else (0o750 if r['mode']&0o111 else 0o640)
   need(comparable(actual)==comparable(expected),'Installed candidate differs: '+name)
  else:need(actual=={p:{k:v for k,v in r.items() if k!='base64'} for p,r in expected.items()},'Baseline package changed: '+name)
 for p,row in (m['candidateLocks'] if after else b['locks']).items():need(sha(raw(ROOT/p))==row['sha256'],'Lock changed')

def durable(path,b,G):G['durable'](path,b);G['sync'](path.parent)
def materialize(path,rows,owner,G):
 need(not os.path.lexists(path),'Candidate exists');path.mkdir(mode=0o700)
 for rel,r in sorted(rows.items(),key=lambda x:(len(PurePosixPath(x[0]).parts),x[0])):
  p=path if rel=='.' else path/rel
  if r['kind']=='directory':
   if rel!='.':p.mkdir(mode=0o700)
  else:durable(p,base64.b64decode(r['base64']),G)
  os.chown(p,owner['uid'],owner['gid']);os.chmod(p,0o750 if r['kind']=='directory' else (0o750 if r['mode']&0o111 else 0o640))
 for rel,r in sorted(rows.items(),reverse=True):
  if r['kind']=='directory':G['sync'](path if rel=='.' else path/rel)
 G['sync'](path.parent)
def write_lock(p,b,meta,G,stage,phase):
 if raw(p)==b and inventory_file(p)==meta:return
 temp=stage/'locks'/(p.name+'-'+phase+'-'+str(time.monotonic_ns()));durable(temp,b,G);os.chown(temp,meta['uid'],meta['gid']);os.chmod(temp,meta['mode']);os.replace(temp,p);G['sync'](p.parent)
def resolve_and_probe(node):
 code="const{createRequire}=require('node:module');const r=createRequire('/opt/proofofwork-api/package.json');const b=r('bitcoinjs-lib');const names=['nanoid','postcss','source-map-js','valibot'];let x={};for(const n of names){let p=r.resolve(n);let fs=require('node:fs'),path=require('node:path'),d=path.dirname(p);while(!fs.existsSync(path.join(d,'package.json')))d=path.dirname(d);x[n]={entry:p,version:JSON.parse(fs.readFileSync(path.join(d,'package.json'))).version}}const br=createRequire(r.resolve('bitcoinjs-lib'));if(br.resolve('valibot')!==r.resolve('valibot'))throw Error('Nested Valibot differs');const fs=require('node:fs');const bin='/opt/proofofwork-api/node_modules/.bin/nanoid';if(fs.realpathSync(bin)!=='/opt/proofofwork-api/node_modules/nanoid/bin/nanoid.cjs')throw Error('NanoID bin differs');fs.accessSync(bin,fs.constants.X_OK);x.bitcoinjsValibot=br.resolve('valibot');x.nanoidBin=fs.realpathSync(bin);let t=new b.Transaction();t.addInput(Buffer.alloc(32,1),0);t.addOutput(Buffer.from('6a','hex'),0n);if(b.Transaction.fromHex(t.toHex()).getId()!==t.getId())throw Error('roundtrip');console.log(JSON.stringify(x))"
 result=subprocess.run([node,'-e',code],capture_output=True,text=True,timeout=30);need(result.returncode==0,'Runtime import/transaction probe: '+result.stderr[-2000:]);value=json.loads(result.stdout);need({n:value[n]['version'] for n in NAMES}==VERSIONS,'Wrong runtime resolution')
 esm="import * as b from 'bitcoinjs-lib';import * as v from 'valibot';let t=new b.Transaction();t.addInput(Buffer.alloc(32,1),0);t.addOutput(Buffer.from('6a','hex'),0n);if(b.Transaction.fromHex(t.toHex()).getId()!==t.getId())throw Error('ESM roundtrip');if(v.parse(v.number(),7)!==7)throw Error('ESM schema');console.log('ESM transaction/schema passed')"
 check=subprocess.run([node,'--input-type=module','-e',esm],cwd=ROOT,capture_output=True,text=True,timeout=30);need(check.returncode==0,'ESM probe: '+check.stderr[-2000:]);value['esmProbe']=check.stdout.strip();return value

def swap_package(stage,name,receipt,save,G):
 need(name in NAMES and not (stage/'before'/name).exists(),'Wrong or occupied swap path')
 receipt['swaps'].append({'name':name,'beforeMoved':False,'candidateMoved':False});save()
 os.rename(MOD/name,stage/'before'/name);receipt['swaps'][-1]['beforeMoved']=True;G['sync'](MOD);G['sync'](stage/'before');save()
 os.rename(stage/'candidate'/name,MOD/name);receipt['swaps'][-1]['candidateMoved']=True;G['sync'](MOD);save()

def rollback_packages(m,stage,receipt,G):
 for item in reversed(receipt['swaps']):
  name=item['name'];need(name in NAMES,'Unexpected rollback package')
  prior=stage/'before'/name;target=MOD/name;candidate=stage/'candidate'/name
  expected={p:{k:v for k,v in r.items() if k!='base64'} for p,r in m['capture']['packages'][name].items()}
  if prior.exists():
   need(inventory(prior)==expected,'Rollback custody differs')
   if target.exists():
    need(not candidate.exists(),'Ambiguous package rollback topology');need(comparable(inventory(target))==comparable_expected(m,name),'Unexpected package during rollback');os.rename(target,candidate)
   os.rename(prior,target);G['sync'](MOD);G['sync'](stage/'before')
  else:need(inventory(target)==expected,'Missing rollback custody')

def comparable_expected(m,name):
 expected=copy.deepcopy(m['candidatePackages'][name]);owner=m['capture']['packages'][name]['.']
 for r in expected.values():r['uid']=owner['uid'];r['gid']=owner['gid'];r['mode']=0o750 if r['kind']=='directory' else (0o750 if r['mode']&0o111 else 0o640)
 return comparable(expected)

def health_probe(route,required):
 last={}
 for attempt in range(12 if required else 1):
  try:
   try:response=urllib.request.urlopen('http://127.0.0.1:8081'+route,timeout=5)
   except urllib.error.HTTPError as e:response=e
   with response:
    b=response.read(1024*1024+1);need(len(b)<=1024*1024,'Health response oversized');last={'httpStatus':response.status,'body':json.loads(b)}
   if not required or last['httpStatus']==200 and last['body'].get('available') is True:return last
  except (OSError,ValueError) as e:last={'error':str(e)[:1000]}
  if required:time.sleep(1)
 need(not required,'Availability did not return: '+str(last)[:2000]);return last

def safe_roots(G,H):
 for path in (ROOT,MOD,G['BACKUPS']):
  details=path.lstat();need(path.resolve(strict=True)==path and stat.S_ISDIR(details.st_mode) and not details.st_mode&0o7022,'Unsafe runtime/backup root')
 H['safe_directory'](H['BASE'])

def acquire_locks(G,H):
 need(G['LOCK'].resolve(strict=True)==G['LOCK'] and stat.S_ISREG(G['LOCK'].lstat().st_mode),'Unsafe ops lock path')
 fd=os.open(G['LOCK'],os.O_RDONLY|os.O_NOFOLLOW);need((os.fstat(fd).st_uid,os.fstat(fd).st_gid,stat.S_IMODE(os.fstat(fd).st_mode),os.fstat(fd).st_nlink)==(0,0,0o600,1),'Unsafe ops lock');fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);need(identity(os.fstat(fd))==identity(G['LOCK'].stat()),'Ops lock changed')
 searchfd=os.open(H['LOCK'],os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600);H['safe_read'](H['LOCK']);fcntl.flock(searchfd,fcntl.LOCK_EX|fcntl.LOCK_NB);need(identity(os.fstat(searchfd))==identity(H['LOCK'].stat()),'Search lock changed')
 return fd,searchfd

def apply(m,G,H):
 validate_payload(m);need(os.geteuid()==0 and sys.flags.isolated,'Root isolated Python required')
 b=m['capture'];stage_name='.pow-dependency-'+m['releaseId'];stage=MOD/stage_name;backup=G['BACKUPS']/('cef-dependencies-'+m['releaseId'])
 need(not stage.exists() and not backup.exists(),'Release namespace exists');need(ROOT.stat().st_dev==MOD.stat().st_dev,'Runtime lock/package mount differs')
 need(0<=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(b['at'])).total_seconds()<180,'Capture outside the fresh180second window')
 safe_roots(G,H);fd,searchfd=acquire_locks(G,H)
 need(not os.path.lexists(H['HOLD']),'Another Search hold');fence(m,G,H);need(G['states'](G['UNITS'])==b['services'],'Protected service PID changed');need(G['gateway_states']()==b['gateway'],'Gateway changed')
 for p in (MOD,G['BACKUPS']):
  s=os.statvfs(p);need(s.f_bavail*s.f_frsize>2*1024**3 and s.f_favail>10000,'Insufficient allocation headroom')
 backup.mkdir(mode=0o700);durable(backup/'manifest.json',encoded(m),G);stage.mkdir(mode=0o700);(stage/'candidate').mkdir(mode=0o700);(stage/'before').mkdir(mode=0o700);(stage/'locks').mkdir(mode=0o700)
 receipt={'format':'pow-cef-node-dependency-result-v1','releaseId':m['releaseId'],'sourceCommit':m['sourceCommit'],'manifestSha256':sha(encoded(m)),'backup':str(backup),'retainedBeforePackages':str(stage/'before'),'installed':False,'rolledBack':False,'swaps':[]}
 sequence=0
 def save():
  nonlocal sequence
  sequence+=1;p=backup/('receipt.next-'+str(sequence));durable(p,encoded(receipt),G);os.replace(p,backup/'receipt.json');G['sync'](backup)
 def best_effort_save():
  try:save()
  except BaseException as journal_error:
   receipt.setdefault('journalErrors',[]).append(str(journal_error)[:1000]);print(json.dumps({'journalWriteFailed':str(journal_error)[:1000],'rollbackContinues':True}),file=sys.stderr,flush=True)
 save()
 for name in NAMES:materialize(stage/'candidate'/name,m['candidatePackages'][name],b['packages'][name]['.'],G)
 durable(backup/'before-packages.json',encoded(b['packages']),G)
 for p,row in b['locks'].items():durable(backup/('before-'+p.replace('/','_')),base64.b64decode(row['base64']),G)
 bindings={'releaseId':m['releaseId'],'attempt':'dependencies','files':{u:b['unitHashes'][u] for u in G['SEARCH']}};holdroot=H['BASE']/('search-timer-hold-'+m['releaseId']+'-dependencies')
 held=False;drained=False;rollback_verified=False;install_verified=False;hold_raw=None
 def quiet():
  need(held and hold_raw is not None,'Search hold not acquired');G['require_search_held'](G['states'](G['SEARCH']));need(raw(H['HOLD'],65536)==hold_raw,'Search hold marker changed')
 try:
  receipt['searchHold']=H['apply']('hold',holdroot,bindings);held=True;save();hold_raw=raw(H['HOLD'],65536);quiet()
  fence(m,G,H,stage_name);need(G['states'](G['UNITS'])==b['services'],'Protected service PID changed before drain')
  receipt['drainAttempted']=True;save();drained=True;G['drain_apps']();receipt['drained']=True;save();fence(m,G,H,stage_name);quiet()
  for name in NAMES:swap_package(stage,name,receipt,save,G)
  for p,row in m['candidateLocks'].items():write_lock(ROOT/p,base64.b64decode(row['base64']),b['locks'][p]['metadata'],G,stage,'candidate')
  fence(m,G,H,stage_name,True);quiet();receipt['runtimeResolution']=resolve_and_probe(b['nodePath']);receipt['installed']=True;save()
  gateway={'active':{k:v['ActiveState'] for k,v in b['gateway'].items()},'unitFileStates':{k:v['UnitFileState'] for k,v in b['gateway'].items()}}
  quiet();G['restore_apps'](gateway);drained=False;need(raw(H['HOLD'],65536)==hold_raw,'Hold changed');fence(m,G,H,stage_name,True)
  receipt['servicesRestored']=True;save()
  receipt['availability']=health_probe('/health/live',required=True);receipt['readinessAtInstall']=health_probe('/health',required=False);install_verified=True;save()
  receipt['searchRestore']=H['apply']('restore',holdroot,bindings);held=False;save()
  receipt['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();receipt['status']='installed-services-restored-awaiting-ordinary-readiness';save();return receipt
 except BaseException as e:
  receipt['errorClass']=type(e).__name__;receipt['error']=str(e)[:4000]
  if install_verified:
   receipt['recoveryIncomplete']=True;receipt['searchHeld']=held;receipt['status']='installed-verified-follow-up-required';best_effort_save();print(json.dumps(receipt),flush=True);raise
  best_effort_save()
  try:
   if drained or receipt['swaps']:
    quiet();G['drain_apps']();drained=True
    rollback_packages(m,stage,receipt,G)
    for p,row in b['locks'].items():write_lock(ROOT/p,base64.b64decode(row['base64']),row['metadata'],G,stage,'rollback')
   fence(m,G,H,stage_name)
   if drained:
    quiet();G['restore_apps']({'active':{k:v['ActiveState'] for k,v in b['gateway'].items()},'unitFileStates':{k:v['UnitFileState'] for k,v in b['gateway'].items()}});drained=False
   rollback_verified=True;receipt['rolledBack']=True
  except BaseException as recovery:receipt['recoveryIncomplete']=True;receipt['recoveryError']=str(recovery)[:4000]
  if held and rollback_verified:
   try:receipt['searchRestore']=H['apply']('restore',holdroot,bindings);held=False
   except BaseException as recovery:receipt['searchRestoreError']=str(recovery)[:4000]
  receipt['searchHeld']=held;best_effort_save();print(json.dumps(receipt),flush=True);raise
 finally:os.close(searchfd);os.close(fd)

def main():
 def interrupted(signum,frame):raise InterruptedError('Signal '+str(signum))
 for sig in (signal.SIGTERM,signal.SIGHUP):signal.signal(sig,interrupted)
 os.umask(0o077);wire=sys.stdin.buffer.read(32*1024**2+1);need(len(wire)<=32*1024**2,'Oversized request');request=json.loads(wire);G,H=support(request)
 if request['action']=='capture':print(json.dumps(capture(G,H)))
 elif request['action']=='apply':print(json.dumps(apply(request['plan'],G,H)))
 else:raise ValueError('Unknown action')
if __name__=='__main__':main()
