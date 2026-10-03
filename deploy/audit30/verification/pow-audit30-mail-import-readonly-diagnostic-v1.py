#!/usr/bin/python3 -I
"""Fixed native108:112 static-import diagnostic. Never invokes the mail reader."""
import ast,datetime,hashlib,json,os,pathlib,pwd,signal,stat,subprocess,time
ROOT_PIN='16bdda32ccc3be64d3fcd5897173803b7c582075f94cbba6f92216b84185e75f'
LEAF_PIN='47f48b568f08f1f51978bf5c9d23c9495a2481bd296fa1131f6f2565a69bbd85'
NODE='/opt/node-v24.18.0-linux-x64/bin/node'
NODE_SHA='41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c'
LABELS={'ROOT','B3_SHAPE','B3_PIN','STRICT_RUNNING','BACKUP_ACTIVE','OUTPUT_EXISTS','ACCOUNT','SAVED_RECEIPT_PIN','SAVED_SCOPE','SAVED_COUNT','SAVED_FAILURE_SCOPE','TARGET_SCOPE','CURRENT_ENV_PIN','NATIVE_PG_ACCOUNT','API_IDENTITY_CHANGED','PRIVATE_SHAPE','PRIVATE_DRIFT'}
APPEND=b'\nif(process.getuid()!==108||process.getgid()!==112)throw Error("NATIVE_PG_IDENTITY");console.log(JSON.stringify({schema:"pow-audit30-static-import-readable-v1",nativeUid:process.getuid(),nativeGid:process.getgid(),graphReadable:true,databaseCalls:0}));\n'
ENV={'PATH':'/opt/node-v24.18.0-linux-x64/bin:/usr/bin:/bin','LC_ALL':'C','TZ':'UTC','NETWORK':'livenet','NODE_DISABLE_COMPILE_CACHE':'1'}
def need(v,label):
 if not v:raise ValueError(label)
def stamp(p):
 s=pathlib.Path(p).lstat();return [s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns]
def classify(returncode,stderr):
 if returncode==0 and not stderr:return 'IMPORT_COMPLETED'
 for code in [b'EACCES',b'ERR_MODULE_NOT_FOUND',b'ERR_REQUIRE_ESM',b'NATIVE_PG_IDENTITY']:
  if code in stderr:return code.decode()
 return 'IMPORT_REFUSED_OTHER'
def context(source):
 need(hashlib.sha256(source).hexdigest()==ROOT_PIN,'ROOT_SOURCE_PIN');tree=ast.parse(source);fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='main');stop=next(i for i,n in enumerate(fn.body)if isinstance(n,ast.Expr)and isinstance(n.value,ast.Call)and isinstance(n.value.func,ast.Attribute)and n.value.func.attr=='mkdir');fn.body=fn.body[:stop];fn.name='pre_import_only'
 names=['a','h','original','account','database_account','source_identity','before','timer','severities'];fn.body.append(ast.Return(ast.Dict(keys=[ast.Constant(x)for x in names],values=[ast.Name(id=x,ctx=ast.Load())for x in names])))
 n={'__name__':'_fixed_mail_import','__file__':'exact-reviewed-focused-root-v2.py'};exec(compile(source,n['__file__'],'exec'),n);observed=[]
 def diagnostic_need(v,label):
  need(label in LABELS,'UNKNOWN_PREFIX_GUARD');observed.append({'label':label,'ok':bool(v)})
  if label!='OUTPUT_EXISTS':need(v,label)
 n['need']=diagnostic_need;probe=ast.Module(body=[fn],type_ignores=[]);ast.fix_missing_locations(probe);exec(compile(probe,'fixed-no-write-prefix','exec'),n);return n,n['pre_import_only'](b''),observed
def child_probe(leaf,cwd):
 need(hashlib.sha256(leaf).hexdigest()==LEAF_PIN,'LEAF_PIN');p=None;stdout=stderr=b'';cleanup=[];failure=None;start=time.monotonic();old={s:signal.getsignal(s)for s in [signal.SIGTERM,signal.SIGINT]}
 def interrupted(s,f):raise RuntimeError('IMPORT_DIAGNOSTIC_SIGNAL')
 for s in old:signal.signal(s,interrupted)
 try:
  p=subprocess.Popen([NODE,'--max-old-space-size=128','--input-type=module','-'],cwd=cwd,env=ENV,user=108,group=112,extra_groups=[],umask=0o077,start_new_session=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  stdout,stderr=p.communicate(leaf+APPEND,timeout=10);need(len(stdout)<=65536 and len(stderr)<=65536,'OUTPUT_CAP')
 except BaseException as e:
  failure='IMPORT_DEADLINE'if isinstance(e,subprocess.TimeoutExpired)else 'IMPORT_SIGNAL'if str(e)=='IMPORT_DIAGNOSTIC_SIGNAL'else 'IMPORT_DIAGNOSTIC_REFUSED';stdout=getattr(e,'output',None)or stdout;stderr=getattr(e,'stderr',None)or stderr
  for s in old:signal.signal(s,signal.SIG_IGN)
  if p is not None:
   try:
    if p.poll()is None:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   except BaseException as e:cleanup.append(type(e).__name__)
   try:p.wait(timeout=5)
   except BaseException as e:cleanup.append(type(e).__name__)
 finally:
  if p is not None:
   for stream in [p.stdin,p.stdout,p.stderr]:
    if stream is not None:stream.close()
  for s,h in old.items():signal.signal(s,h)
 stopped=p is not None and p.poll()is not None;rc=p.returncode if stopped else None;classification=failure or classify(rc,stderr);graph=False
 if classification=='IMPORT_COMPLETED':
  try:graph=json.loads(stdout)=={'schema':'pow-audit30-static-import-readable-v1','nativeUid':108,'nativeGid':112,'graphReadable':True,'databaseCalls':0}
  except Exception:graph=False
  if not graph:classification='IMPORT_OUTPUT_REFUSED'
 return {'classification':classification,'graphReadable':graph,'childExitCode':rc,'childStopped':stopped,'cleanupErrors':cleanup,'seconds':round(time.monotonic()-start,3),'stdoutBytes':len(stdout),'stdoutSHA256':hashlib.sha256(stdout).hexdigest(),'stderrBytes':len(stderr),'stderrSHA256':hashlib.sha256(stderr).hexdigest()}
def main(source,leaf):
 need(os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0,'ROOT');need(hashlib.sha256(leaf).hexdigest()==LEAF_PIN,'LEAF_PIN');n,c,predicates=context(source);need((c['database_account'].pw_uid,c['database_account'].pw_gid)==(108,112),'NATIVE_PG_ACCOUNT');paths=[n['CWD'],pathlib.Path(NODE),n['CWD']/'server/db/postgres.mjs',n['CWD']/'server/proof-index-mail-projection.mjs'];metadata=[stamp(p)for p in paths];result=child_probe(leaf,n['CWD'])
 need([stamp(p)for p in paths]==metadata,'IMPORT_SOURCE_METADATA_CHANGED');need(c['a']['live']()==c['before']and c['a']['timer_shape']()==c['timer']and c['original']['proc_identity']('api',c['account'])==c['source_identity'],'LIVE_DRIFT');need(hashlib.sha256(pathlib.Path('/proc/'+str(c['source_identity']['pid'])+'/environ').read_bytes()).hexdigest()==n['ENV_SHA'],'FINAL_ENV_DRIFT')
 c['h']['read'](pathlib.Path(NODE),limit=128*1024**2,expected=NODE_SHA,group=0)
 for name,pin in [('server/db/postgres.mjs','2b959860e0513907447459c1b196bfaaf81fba5131bfa050e528f911c18e616c'),('server/proof-index-mail-projection.mjs','bc3c4efa87e3a9b7c0918d340d5626ca08491d7c6695f8951ce2c817c88f900c')]:c['h']['read'](n['CWD']/name,c['account'].pw_uid,expected=pin)
 print(json.dumps({'schema':'pow-audit30-mail-static-import-diagnostic-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceSHA256':ROOT_PIN,'leafSHA256':LEAF_PIN,'nativeNodeSHA256':NODE_SHA,'closedPrefixPredicates':predicates,'savedStrictCheckSeverities':c['severities'],'nativeImport':result,'sourceMetadataAndBytesUnchanged':True,'liveFiveUnchanged':True,'timerUnchanged':True,'databaseUrlProvided':False,'sqlCalls':0,'apiCalls':0,'coreCalls':0,'filesystemMutation':False,'originalFocusedFailureCauseReconstructed':False,'automaticRetry':False,'qualification':'New static-import diagnostic only, not a repeat of the failed mail census. Exact pinned leaf defines run() but never invokes it; fixed clean environment contains no DSN. Native108:112 imports and role marker only. Raw streams are hashed and never exported. A readable graph cannot reconstruct discarded earlier child error details.'},sort_keys=True))
