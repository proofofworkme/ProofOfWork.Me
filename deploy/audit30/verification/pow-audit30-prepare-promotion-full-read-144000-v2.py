import ast,base64,datetime,difflib,hashlib,json,os,types
from pathlib import Path
BASE=Path('/tmp');RID='20261003T144000Z'
def digest(b):return hashlib.sha256(b).hexdigest()
def read(name,h):
 p=BASE/name;b=p.read_bytes();assert digest(b)==h,(name,digest(b));return b
def create(name,b):
 p=BASE/name;fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 try:
  with os.fdopen(fd,'wb')as f:f.write(b);f.flush();os.fsync(f.fileno())
  d=os.open(BASE,os.O_RDONLY|os.O_DIRECTORY);os.fsync(d);os.close(d)
 except BaseException:raise
 assert p.read_bytes()==b
 return {'path':str(p),'bytes':len(b),'sha256':digest(b)}
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
old=read('pow-audit30-promotion-full-read-native-v1.py','d07cb8d37eb2920578a2db009030b79ab27100345258e5b72f341f3d88ed54e8')
assert old.count(b"RID='20261003T120000Z'")==1
new=old.replace(b"RID='20261003T120000Z'",b"RID='20261003T144000Z'")
assert new.replace(b"RID='20261003T144000Z'",b"RID='20261003T120000Z'")==old
oldtree=ast.parse(old);newtree=ast.parse(new)
func=lambda t:{n.name:ast.dump(n,include_attributes=False)for n in t.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))}
assert func(oldtree)==func(newtree)and len(func(newtree))==26
assert ast.dump(ast.parse(new.replace(b"RID='20261003T144000Z'",b"RID='20261003T120000Z'")),include_attributes=False)==ast.dump(oldtree,include_attributes=False)
source=create('pow-audit30-promotion-full-read-native-v2.py',new)
diff=create('pow-audit30-promotion-full-read-native-v2.diff',''.join(difflib.unified_diff(old.decode().splitlines(True),new.decode().splitlines(True),fromfile='promotion-full-read-native-v1.py',tofile='promotion-full-read-native-v2.py')).encode())
oldtemplate=read('pow-audit30-promotion-full-read-request-template-v1.json','14dca513bb975a98a0c12d76d86c1ef5f4c53b7e97c13fe0f8cb92e391ac07b0');template=json.loads(oldtemplate)
assert template['expectedLive']is None and template['expectedProtection']is None
for k in('unit','directory'):template[k]=template[k].replace('20261003T120000Z',RID)
leaf=read('pow-audit30-oct3-latest-backup-full-read-v1.py','01b80fd9b4a3a92893c06f288b3d3bdc90e05b7ed6f7c6f25bebc21c1ecc56a3')
assert base64.b64decode(template['sourceBase64'],validate=True)==leaf
nullrow=create('pow-audit30-promotion-full-read-request-template-v2.json',(json.dumps(template,sort_keys=True,indent=2)+'\n').encode())
cb=read('pow-audit30-retained-repair-context-native-142900-v1.stdout','fd12f5bfb20ee9532facf54b0798888790911cdc5f007b616bddaf57a2b6d48e');context=json.loads(cb)
assert len(cb)==5210 and context['atUtc']=='2026-10-03T14:29:52.063576+00:00'and context['liveBeforeAfterEqual']is True and context['protectedEndpointEquality']is True
request=dict(template);request['expectedLive']=context['expectedLive'];request['expectedProtection']=context['expectedProtection']
rb=(json.dumps(request,sort_keys=True,indent=2)+'\n').encode();reqrow=create('pow-audit30-promotion-full-read-request-144000-v2.json',rb)
m=types.ModuleType('namespace_review_only');m.__file__=source['path'];exec(compile(new,m.__file__,'exec'),m.__dict__);decoded=m.decode_request(rb);assert decoded[1]==leaf
cases=[]
for k,value in [('unit',json.loads(oldtemplate)['unit']),('directory',json.loads(oldtemplate)['directory'])]:
 bad=dict(request);bad[k]=value
 try:m.decode_request(canonical(bad))
 except (AssertionError,ValueError):cases.append('old-'+k+'-refuses')
 else:raise AssertionError('oldnamespace accepted')
try:m.decode_request(canonical(template))
except (AssertionError,ValueError):cases.append('null-current-guards-refuse')
else:raise AssertionError('null accepted')
assert {k:v for k,v in request.items()if k not in('expectedLive','expectedProtection')}==template|{} if False else True
assert set(request)==set(template)and all(request[k]==template[k]for k in template if k not in('expectedLive','expectedProtection'))
shared=read('pow-audit30-readonly-owned-transport-v3.py','1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e');assert len(shared)==8396
caller=f'''import hashlib,json,sys,types
from pathlib import Path
T=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');TH='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
N=Path({source['path']!r});NH={source['sha256']!r}
R=Path({reqrow['path']!r});RH={reqrow['sha256']!r}
C=Path('/tmp/pow-audit30-retained-repair-context-native-142900-v1.stdout');CH='fd12f5bfb20ee9532facf54b0798888790911cdc5f007b616bddaf57a2b6d48e'
def main():
 assert sys.flags.isolated and sys.dont_write_bytecode and len(sys.argv)==1
 raw=T.read_bytes();assert len(raw)==8396 and hashlib.sha256(raw).hexdigest()==TH
 m=types.ModuleType('exact_owned_transport');m.__file__=str(T);exec(compile(raw,str(T),'exec'),m.__dict__)
 source=m.bound(N,NH,32768);request=m.bound(R,RH,32768);context=m.bound(C,CH,8192)
 v=json.loads(context);r=json.loads(request);assert r['expectedLive']==v['expectedLive']and r['expectedProtection']==v['expectedProtection']
 d=types.ModuleType('exact_promotion_full_read');d.__file__=str(N);exec(compile(source,str(N),'exec'),d.__dict__);d.decode_request(request)
 result=m.execute(m.remote_command(source,RH),request,'/tmp/pow-audit30-promotion-full-read-native-144000-v2',480,stdout_cap=2097152,stderr_cap=65536,bindings={{'sourceSha256':NH,'requestSha256':RH,'actualContextStdoutSha256':CH,'unitSeconds':360,'rootSeconds':420,'unitCpuPercent':25,'unitMemoryMaxBytes':134217728,'unitSwapMaxBytes':0,'fullReadLeafSha256':d.SOURCE_SHA,'pinChangeRequested':False,'checkerChangeRequested':False,'recoveryActivationRequested':False,'additionalDeletionAuthorized':False,'productionMutation':False}})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':raise SystemExit(main())
'''.encode();compile(caller,'caller','exec');callerrow=create('pow-audit30-promotion-full-read-transport-preparation-v2.py',caller)
ct=ast.parse(caller);calls=[n for n in ast.walk(ct)if isinstance(n,ast.Call)and isinstance(n.func,ast.Attribute)and n.func.attr=='remote_command'];assert len(calls)==1 and len(calls[0].args)==2 and isinstance(calls[0].args[1],ast.Name)and calls[0].args[1].id=='RH'
result={'schema':'pow-audit30-promotion-full-read-source-preparation-v2','status':'source-and-actual-context-request-prepared-not-executed','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'run':RID,'source':source,'sourceDiff':diff,'nullTemplate':nullrow,'actualRequest':reqrow,'caller':callerrow,'actualContext':{'path':'/tmp/pow-audit30-retained-repair-context-native-142900-v1.stdout','bytes':len(cb),'sha256':digest(cb),'observedAtUtc':context['atUtc']},'preservedOriginalSourceSha256':digest(old),'leafUnchangedSha256':digest(leaf),'checks':{'all26FunctionsClassesASTEqual':True,'allOtherModuleASTExactAfterSingleLiteralReversal':True,'byteExactSingleRIDReversal':True,'nullTemplateOnlyUnitDirectoryChanged':True,'requestOnlyTwoNullFieldsFilledFromExactActualContext':True,'inertDecodePassed':True,'negativeCases':cases,'callerPassesRequestSHAArgv':True,'callerBoundExactSharedTransport':True,'newNamespaceNativeAbsenceObserved':False},'nativeActionPerformed':False,'humanApprovalCreated':False,'pinOrCheckerChanged':False,'authority':'Root must full-review source/request/caller then issue a separate once read-only native admission. Source fixtures prove no current or future native unit/path absence; runtime checks both before creation.'}
pr=create('pow-audit30-promotion-full-read-source-preparation-v2.json',(json.dumps(result,sort_keys=True,indent=2)+'\n').encode());print(json.dumps(result,sort_keys=True,indent=2));print(json.dumps({'preparation':pr}))
