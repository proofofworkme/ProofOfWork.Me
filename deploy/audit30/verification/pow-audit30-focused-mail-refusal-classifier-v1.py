#!/usr/bin/python3 -I
"""Fixed existing focused attempt guard classifier. No SQL/API/Core/child or filesystem mutation."""
import ast,hashlib,json,os,pathlib,stat
ROOT=pathlib.Path('/data/proofofwork-release-backups/audit30-node-release-38ac6e2bff2a-20261003T042000Z')
SOURCE_PIN='16bdda32ccc3be64d3fcd5897173803b7c582075f94cbba6f92216b84185e75f'
LABELS={'ROOT','B3_SHAPE','B3_PIN','STRICT_RUNNING','BACKUP_ACTIVE','OUTPUT_EXISTS','ACCOUNT','SAVED_RECEIPT_PIN','SAVED_SCOPE','SAVED_COUNT','SAVED_FAILURE_SCOPE','TARGET_SCOPE','CURRENT_ENV_PIN','NATIVE_PG_ACCOUNT','API_IDENTITY_CHANGED','PRIVATE_SHAPE','PRIVATE_DRIFT'}
def main(source):
 if os.getuid()!=0 or hashlib.sha256(source).hexdigest()!=SOURCE_PIN:raise ValueError('CLASSIFIER_SCOPE')
 tree=ast.parse(source);fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='main');stop=next(i for i,n in enumerate(fn.body)if isinstance(n,ast.Expr)and isinstance(n.value,ast.Call)and isinstance(n.value.func,ast.Attribute)and n.value.func.attr=='mkdir');fn.body=fn.body[:stop];fn.name='pre_child_only';fn.body.append(ast.Return(ast.Dict(keys=[ast.Constant('classification'),ast.Constant('savedStrictCheckSeverities')],values=[ast.Constant('PRECHILD_ALL_PASSED'),ast.Name(id='severities',ctx=ast.Load())])))
 n={'__name__':'_focused_refusal','__file__':'exact-reviewed-focused-root-v2.py'};exec(compile(source,n['__file__'],'exec'),n)
 predicates=[]
 def observed_need(v,label):
  if label not in LABELS:raise ValueError('UNKNOWN_GUARD')
  predicates.append({'label':label,'ok':bool(v)})
  if label=='OUTPUT_EXISTS':return # Diagnostic reports collision, never mkdir/launches/retries.
  if not v:raise ValueError(label)
 n['need']=observed_need;probe=ast.Module(body=[fn],type_ignores=[]);ast.fix_missing_locations(probe);exec(compile(probe,'_fixed_no_child_prefix','exec'),n)
 classification=None
 try:classification=n['pre_child_only'](b'')
 except Exception as e:classification=str(e)if str(e)in LABELS else {'errorClass':type(e).__name__,'reasonSHA256':hashlib.sha256(str(e).encode()).hexdigest()}
 job=ROOT/'focused-mail-projection-v2';files={name:os.path.lexists(job/name)for name in ['intent.json','failed.json','completed.json']};failure=None
 if files['failed.json']:
  p=job/'failed.json';s=p.lstat()
  if not(p.resolve()==p and stat.S_ISREG(s.st_mode)and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1 and s.st_size<8192):raise ValueError('FAILED_RECEIPT_SHAPE')
  b=p.read_bytes();v=json.loads(b)
  if v.get('schema')!='pow-audit30-focused-mail-readonly-failed-v2':raise ValueError('FAILED_RECEIPT_SCOPE')
  failure={'sha256':hashlib.sha256(b).hexdigest(),'errorClass':v.get('errorClass'),'cleanupErrors':v.get('cleanupErrors'),'automaticRetry':v.get('automaticRetry')}
 print(json.dumps({'schema':'pow-audit30-focused-mail-refusal-classifier-v1','sourceSHA256':SOURCE_PIN,'freshPreChildClassification':classification,'closedPredicates':predicates,'originalAttemptFiles':files,'originalAttemptFailure':failure,'sameAttemptReasonPreserved':False,'sqlCalls':0,'apiCalls':0,'coreCalls':0,'childLaunches':0,'filesystemMutation':False,'qualification':'Fresh source-identical pre-child predicates only. OUTPUT_EXISTS is observed but does not stop this read-only classifier; AST ends before mkdir/intent/child. All other predicates unchanged. Original discarded child stderr cannot be reconstructed.'},sort_keys=True))
