"""Local binding-only preparation; never invokes the native observer or transport."""
import ast,datetime,difflib,hashlib,json,os,re,sys,types
from pathlib import Path
OLD=Path('/tmp/pow-audit30-coupled-promotion-state-observer-v1.py');OLD_SHA='47b822552521ccff65a8e1b32157091d01d0a68130971bd2da402102b20c5dec'
FULL=Path('/tmp/pow-audit30-promotion-full-read-native-144000-v2.stdout')
BASE=Path('/tmp')
def sha(b):return hashlib.sha256(b).hexdigest()
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def pairs(rows):
 v={}
 for k,x in rows:
  if k in v:raise ValueError('Duplicate public input key')
  v[k]=x
 return v
def norm(v):
 out={('device'if k=='dev'else'inode'if k=='ino'else k):x for k,x in v.items()}
 assert set(out)=={'device','inode','mode','uid','gid','nlink','bytes','mtimeNs','ctimeNs'}and all(type(x)is int and x>=0 for x in out.values())
 return out
def build(raw,context_path):
 old=OLD.read_bytes();assert len(old)==43767 and sha(old)==OLD_SHA
 v=json.loads(raw,object_pairs_hook=pairs);assert v['schema']=='pow-audit30-oct3-full-read-native-outcome-v1'and v['status']=='passed'and v['unitStopVerified']is True and v['productionMutation']is False and v['deletionAuthorized']is False
 r=v['result'];assert r['allThreeMemberHashesVerified']is True and r['fullDumpHashReverified']is True and r['fullTocDiscoveredAndVerified']is True and r['liveBeforeAfterEqual']is True and r['pinAndCheckerRemainOriginal']is True
 files={p:{'metadata':norm(row['metadata']),'sha256':row['sha256']}for p,row in r['protectionAfter']['files'].items()}
 units=dict(r['liveAfter']);units['proofofwork-postgres-logical-backup.service']=r['backupAfter']['service'];units['proofofwork-postgres-logical-backup.timer']=r['backupAfter']['timer'];units.update(r['protectionAfter']['units'])
 expected={'files':files,'mask':{'metadata':norm(r['protectionAfter']['mask']['metadata']),'target':r['protectionAfter']['mask']['target']},'units':units,'backupLockMetadata':norm(r['inputsAfter']['backupLock'])}
 context={'path':str(context_path),'bytes':len(raw),'sha256':sha(raw)}
 source=old.decode();tree=ast.parse(source);replacements=[]
 for n in tree.body:
  if isinstance(n,ast.Assign)and len(n.targets)==1 and isinstance(n.targets[0],ast.Name)and n.targets[0].id in('EXPECTED_SHA','CONTEXT_BINDING'):
   value=sha(canonical(expected))if n.targets[0].id=='EXPECTED_SHA'else context
   old_segment=ast.get_source_segment(source,n);new_segment=n.targets[0].id+'='+repr(value);assert source.count(old_segment)==1;replacements.append((old_segment,new_segment))
 assert len(replacements)==2
 for a,b in replacements:source=source.replace(a,b,1)
 reverse=source
 for a,b in reversed(replacements):reverse=reverse.replace(b,a,1)
 assert reverse.encode()==old
 defs=lambda t:{n.name:ast.dump(n,include_attributes=False)for n in t.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))}
 assert defs(ast.parse(source))==defs(tree)
 m=types.ModuleType('inert_state_binding_review');m.__file__='<readonly-state-v2>';exec(compile(source,m.__file__,'exec'),m.__dict__);m.M=m.load_v5()
 request={'schema':'pow-audit30-coupled-promotion-state-observer-request-v1','contextBinding':context,'expected':expected,'productionActionApproved':False};assert m.validate_request(request)==expected
 return source.encode(),(json.dumps(request,sort_keys=True,indent=2)+'\n').encode(),context,len(defs(tree))
def create(name,b):
 p=BASE/name;fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb')as f:f.write(b);f.flush();os.fsync(f.fileno())
 fd=os.open(BASE,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
 assert p.read_bytes()==b
 return dict(path=str(p),bytes=len(b),sha256=sha(b))
def main():
 assert sys.flags.isolated and sys.dont_write_bytecode and len(sys.argv)==2 and re.fullmatch('[0-9a-f]{64}',sys.argv[1])
 raw=FULL.read_bytes();assert len(raw)<=2*1024**2 and sha(raw)==sys.argv[1]
 source,request,context,count=build(raw,FULL)
 v=json.loads(raw);assert v['result']['proofFile']['path']=='/var/tmp/proofofwork-audit30-pin-promotion-20261003T144000Z-preflight/full-read.json'
 age=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(v['result']['freshFullReadAtUtc'])).total_seconds();assert 0<=age<=900
 s=create('pow-audit30-coupled-promotion-state-observer-v2.py',source);r=create('pow-audit30-coupled-promotion-state-observer-request-v2.json',request)
 diff=create('pow-audit30-coupled-promotion-state-observer-v2.diff',''.join(difflib.unified_diff(OLD.read_text().splitlines(True),source.decode().splitlines(True),fromfile='state-observer-v1.py',tofile='state-observer-v2.py')).encode())
 caller=f'''import hashlib,json,sys,types
from pathlib import Path
T=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');TH='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
S=Path({s['path']!r});SH={s['sha256']!r}
R=Path({r['path']!r});RH={r['sha256']!r}
C=Path({str(FULL)!r});CH={context['sha256']!r}
def main():
 assert sys.flags.isolated and sys.dont_write_bytecode and len(sys.argv)==1
 raw=T.read_bytes();assert len(raw)==8396 and hashlib.sha256(raw).hexdigest()==TH
 m=types.ModuleType('owned_transport');m.__file__=str(T);exec(compile(raw,str(T),'exec'),m.__dict__)
 source=m.bound(S,SH,65536);request=m.bound(R,RH,32768);m.bound(C,CH,2097152)
 d=types.ModuleType('readonly_state_definitions');d.__file__=str(S);exec(compile(source,str(S),'exec'),d.__dict__);d.M=d.load_v5();d.validate_request(json.loads(request))
 result=m.execute(m.remote_command(source),request,'/tmp/pow-audit30-coupled-promotion-state-observer-native-144000-v2',90,stdout_cap=65536,stderr_cap=65536,bindings={{'sourceSha256':SH,'requestSha256':RH,'contextStdoutSha256':CH,'wholeSeconds':60,'checkerSeconds':20,'cpuSeconds':30,'addressSpaceBytes':268435456,'definitionsOnlyV5':True,'singlePinV5ActionWithdrawn':True,'productionMutation':False,'promotionAuthorized':False,'additionalDeletion':False,'recoveryActivation':False}})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
'''.encode();compile(caller,'caller','exec');c=create('pow-audit30-coupled-promotion-state-observer-transport-v2.py',caller)
 p=create('pow-audit30-coupled-promotion-state-observer-local-preparation-v2.json',(json.dumps(dict(schema='pow-audit30-state-observer-binding-preparation-v2',atUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),source=s,request=r,caller=c,diff=diff,actualFullReadContext=context,functionClassASTsUnchanged=count,onlyContextAndExpectedHashLiteralsChanged=True,byteExactOriginalSourceReversal=True,sourceBindingDecodePassed=True,baseMetadataObservationAdded=False,humanApprovalOrActionCreated=False,nativeCallPerformed=False,repositoryChange=False),sort_keys=True,indent=2)+'\n').encode());print(json.dumps(p))
if __name__=='__main__':main()
