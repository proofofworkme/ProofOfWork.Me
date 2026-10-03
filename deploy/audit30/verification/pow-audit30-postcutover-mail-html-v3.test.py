import ast,base64,hashlib,json,pathlib,subprocess,types,unittest
from unittest.mock import patch
ROOT=pathlib.Path('/home/sixer/ProofOfWork.Me');COL=pathlib.Path('/tmp/pow-audit30-postcutover-mail-html-collector-v3.py');NATIVE=pathlib.Path('/tmp/pow-audit30-postcutover-mail-html-native-v3.py');LEAF=pathlib.Path('/tmp/pow-audit30-postcutover-mail-html-leaf-v1.mjs')
def module(p):
 n={'__name__':'_mail_fixture','__file__':str(p)};exec(compile(p.read_bytes(),str(p),'exec'),n);return types.SimpleNamespace(**n)
def rows():
 out=[]
 for i in range(619):
  memo='  <!doctype html>\n<html><body>雪  </body></html>\n  'if i<3 else'\n<div> café 🛠 </div>  'if i==3 else'ordinary message';b=memo.encode();out.append({'txid':format(i,'064x'),'memo':memo,'rawBody':{'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()},'hasExplicitAttachment':i==2})
 return out
def leaf_run(data):return subprocess.run(['/usr/bin/node','--max-old-space-size=128','--input-type=module','--eval',LEAF.read_text()],input=json.dumps(data).encode(),cwd=ROOT,env={'PATH':'/usr/bin:/bin','LC_ALL':'C'},capture_output=True,timeout=15)
class Tests(unittest.TestCase):
 def test_exact_unicode_whitespace_html_bytes_and_explicit_exclusion(self):
  r=leaf_run(rows());self.assertEqual(r.returncode,0,r.stderr.decode());v=json.loads(r.stdout);self.assertEqual(v['htmlBodiesClassified'],4);self.assertEqual(v['derivedBodyAttachmentsVerified'],3);self.assertEqual(v['explicitAttachmentHtmlBodiesExcluded'],1);self.assertTrue(v['rawBytesPreserved']);self.assertEqual(v['rows'][0]['bytes'],52);self.assertNotIn('memo',v['rows'][0]);self.assertNotIn('name',v['rows'][0])
 def test_body_hash_population_and_duplicate_refused(self):
  for change in ['hash','count','duplicate']:
   with self.subTest(change=change):
    data=rows()
    if change=='hash':data[0]['rawBody']['sha256']='f'*64
    elif change=='count':data.pop()
    else:data[1]['txid']=data[0]['txid']
    r=leaf_run(data);self.assertNotEqual(r.returncode,0)
 def test_full619_33actor_integration_and_latency(self):
  m=module(COL);data=rows();witnesses=[];groups={}
  for i,message in enumerate(data):
   actor='1'+'A'*24+str(i%33).zfill(2);w={'txid':message['txid'],'kind':'mail','status':'confirmed','actor':actor,'rawBody':message['rawBody']};witnesses.append(w);groups.setdefault(actor,[]).append(dict(txid=w['txid'],from_=actor,network='livenet',protocolKind='mail',status='confirmed',memo=message['memo'],attachment={}if message['hasExplicitAttachment']else None))
  def getter(actor,deadline,budget):
   budget.charge(1);messages=[{('from'if k=='from_'else k):v for k,v in row.items()}for row in groups[actor]];return {'address':actor,'network':'livenet','historyCoverage':{'complete':True,'model':'proof-index-address-mail-complete-v1'},'sentMessages':messages},{'bytes':1,'sha256':'a'*64,'seconds':.01}
  original_run=subprocess.run
  def runner(argv,**kw):return original_run(['/usr/bin/node',*argv[1:]],**(kw|{'cwd':str(ROOT)}))
  # The integration exercises canonical collect/getter/helper composition; production FS/UID are separate root-review gates.
  fn=m.html_and_https_collect;g=fn.__globals__;g['helper_source']=lambda *a:('fixed-fixture',);g['get_mail']=getter
  with patch('pwd.getpwnam',return_value=types.SimpleNamespace(pw_uid=1000)),patch.object(g['subprocess'],'run',side_effect=runner):result=fn(witnesses,m.time.monotonic()+60)
  self.assertTrue(result['publicHTTPSAll619Verified']);self.assertEqual(result['rowsMatchingRawAndIdentity'],619);self.assertEqual(result['actorCount'],33);self.assertEqual(result['derivedHTML']['derivedBodyAttachmentsVerified'],3);self.assertEqual(result['latencySeconds']['requests'],33);self.assertEqual(result['latencySeconds']['p95'],.01);self.assertFalse(result['privatePayloadExported'])
 def test_only_after_canonical_request_allowed(self):
  m=module(NATIVE);utility=(ROOT/'deploy/audit30/verification/pow-audit30-treasury-native-v7.py').read_bytes();child={'schema':'pow-audit30-mail-api-population-request-v1','approvalSha256':m.APPROVAL,'stage':'after','runId':'20261003T203000Z','sourceSha256':m.COLLECTOR_SHA,'liveFive':{u:{'MainPID':'42','InvocationID':'a'*32}for u in ['bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service']}}
  def envelope(child):
   raw=m.encoded(child);return {'schema':'pow-audit30-mail-api-native-request-v1','approvalSha256':m.APPROVAL,'mode':'run','collectorBase64':base64.b64encode(COL.read_bytes()).decode(),'utilityBase64':base64.b64encode(utility).decode(),'collectorRequestBase64':base64.b64encode(raw).decode(),'collectorRequestSha256':m.sha(raw)}
  m.request(envelope(child));child['stage']='baseline';self.assertRaisesRegex(ValueError,'approved scope',m.request,envelope(child));self.assertIn('mail-api-html-population',str(m.BASE))
 def test_original_owned_cleanup_runtime_and_canonical_proof_functions_unchanged(self):
  def functions(p):return {n.name:ast.dump(n,include_attributes=False)for n in ast.parse(p.read_bytes()).body if isinstance(n,ast.FunctionDef)}
  a=functions(ROOT/'deploy/audit30/verification/pow-audit30-mail-api-native-v2.py');b=functions(NATIVE)
  for name in ['owner_class','main','state','capture_identity','capture','package_proof','prepare','command','launch_properties','validate_properties']:self.assertEqual(a[name],b[name],name)
  a=functions(ROOT/'deploy/audit30/verification/pow-audit30-mail-api-population-v2.py');b=functions(COL)
  for name in ['capture_rows','read_authority','compare_response','collect','live_five','body_digest']:self.assertEqual(a[name],b[name],name)
 def test_https_fixed_origin_original_bounds_and_no_credentials(self):
  s=COL.read_text();self.assertIn("http.client.HTTPSConnection('computer.proofofwork.me', 443,",s);self.assertNotIn("http.client.HTTPConnection('127.0.0.1'",s)
  for token in ["response.read1",'ABSOLUTE_REQUEST_DEADLINE','CUMULATIVE_HTTP_BOUND','MAX_HTTP_TOTAL = 128 * 1024**2','REQUEST_SECONDS = 30','WALL_SECONDS = 600','UI_SOURCE_FINAL_DRIFT',"env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}"]:self.assertIn(token,s)
  for token in ['/environ','RPC_PASSWORD','Authorization','getblockchaininfo','pg.Client']:self.assertNotIn(token,s)
if __name__=='__main__':unittest.main()
