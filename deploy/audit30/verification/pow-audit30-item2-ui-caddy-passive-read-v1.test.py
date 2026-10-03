"""Local negative and custody fixtures. No SSH, HTTP, systemctl or production calls."""
import ast, hashlib, importlib.util, io, json, pathlib, tempfile, time, unittest
from unittest.mock import patch

def module(path, name):
 spec = importlib.util.spec_from_file_location(name, path); result = importlib.util.module_from_spec(spec)
 spec.loader.exec_module(result); return result

R = module('/tmp/pow-audit30-item2-ui-caddy-passive-read-v1.py', '_caddy_passive_test')
T = module('/tmp/pow-audit30-item2-ui-caddy-passive-read-local-v1.py', '_caddy_transport_test')

def unit_values():
 return {'MainPID': str(R.PID), 'InvocationID': R.INVOCATION, 'NRestarts': '0', 'LoadState': 'loaded',
 'ActiveState': 'active', 'SubState': 'running', 'Result': 'success', 'ExecMainStatus': '0',
 'ExecMainStartTimestampMonotonic': R.START_MONOTONIC, 'FragmentPath': '/usr/lib/systemd/system/caddy.service',
 'DropInPaths': '/etc/systemd/system/caddy.service.d/hardening.conf'}

def unit_raw(values): return ''.join(k + '=' + v + '\n' for k,v in values.items()).encode()

def manifest(commit=None, extra=''):
 return ('release_id=' + R.RELEASE + '\ncommit=' + (commit or R.COMMIT) + '\nsource_tree=' + R.TREE
         + '\narchive_sha256=' + 'a'*64 + '\n' + extra).encode()

class Response:
 status = 200
 def __init__(self, raw, url='http://127.0.0.1:2019/config/', headers=None):
  self.raw, self.url, self.headers = raw, url, headers or {}
 def __enter__(self): return self
 def __exit__(self, *args): pass
 def geturl(self): return self.url
 def read(self, size): return self.raw[:size]

class Fixtures(unittest.TestCase):
 def test_exact_unit_and_process_accept(self):
  self.assertEqual(R.unit_projection(unit_raw(unit_values())), unit_values())
  data = (str(R.PID) + ' (caddy) ' + ' '.join(['S'] + ['0']*18 + [str(R.START_TICKS)] + ['0']*4)).encode()
  self.assertEqual(R.proc_start(data), R.START_TICKS)

 def test_unit_identity_state_and_restart_refuse(self):
  for key,value in [('MainPID','1'),('InvocationID','a'*32),('NRestarts','1'),('LoadState','not-found'),
                    ('ActiveState','inactive'),('Result','timeout'),('DropInPaths','/tmp/extra.conf')]:
   current = unit_values(); current[key] = value
   with self.assertRaisesRegex(ValueError,'CADDY_UNIT_BASELINE_DRIFT'): R.unit_projection(unit_raw(current))
  with self.assertRaises(ValueError): R.unit_projection(unit_raw(unit_values()) + b'MainPID=3092586\n')

 def test_process_reuse_refuses(self):
  raw = (str(R.PID) + ' (caddy) ' + ' '.join(['S'] + ['0']*18 + [str(R.START_TICKS+1)])).encode()
  with self.assertRaisesRegex(ValueError,'CADDY_PROCESS_BASELINE_DRIFT'): R.proc_start(raw)

 def test_manifest_release_digest_and_duplicate(self):
  raw = manifest(); self.assertEqual(R.manifest_projection(raw,R.digest(raw))['releaseId'],R.RELEASE)
  with self.assertRaisesRegex(ValueError,'ACTIVE_MANIFEST_DIGEST'): R.manifest_projection(raw,'b'*64)
  raw = manifest(commit='b'*40)
  with self.assertRaisesRegex(ValueError,'ACTIVE_MANIFEST_RELEASE_BINDING'): R.manifest_projection(raw,R.digest(raw))
  raw = manifest(extra='release_id='+R.RELEASE+'\n')
  with self.assertRaisesRegex(ValueError,'ACTIVE_MANIFEST_DUPLICATE'): R.manifest_projection(raw,R.digest(raw))

 def test_runtime_hash_only_and_network_allowlist(self):
  raw = b'{"privateConfiguration":"never exported"}\n'
  R.DEADLINE = time.monotonic()+10
  with patch.object(R,'CONFIG_BYTES',len(raw)), patch.object(R,'CONFIG_SHA',R.digest(raw)), \
       patch.object(R.urllib.request,'build_opener') as builder:
   builder.return_value.open.return_value = Response(raw)
   result = R.runtime_config()
   self.assertEqual(result,{'bytes':len(raw),'sha256':R.digest(raw),'httpStatus':200})
   self.assertNotIn('privateConfiguration',json.dumps(result))
   request = builder.return_value.open.call_args.args[0]
   self.assertEqual(request.full_url,'http://127.0.0.1:2019/config/');self.assertEqual(request.method,'GET')
   self.assertEqual(builder.call_args.args[0].proxies,{})

 def test_runtime_drift_redirect_encoding_length_refuse(self):
  good = b'{}\n'; R.DEADLINE = time.monotonic()+10
  with patch.object(R,'CONFIG_BYTES',len(good)), patch.object(R,'CONFIG_SHA',R.digest(good)), \
       patch.object(R.urllib.request,'build_opener') as builder:
   for response in [Response(b'bad'),Response(good,url='http://evil.invalid/'),
                    Response(good,headers={'Content-Encoding':'gzip'}),
                    Response(good,headers={'Content-Length':'999'}),Response(b'x'*(1024**2+1))]:
    builder.return_value.open.return_value = response
    with self.assertRaises(ValueError): R.runtime_config()
  with self.assertRaisesRegex(ValueError,'CADDY_CONFIG_REDIRECT'):
   R.NoRedirect().redirect_request(None,None,302,None,None,'http://evil.invalid/')

 def test_no_remote_mutations_or_raw_config_exports(self):
  source = pathlib.Path(R.__file__).read_text(); tree = ast.parse(source)
  functions = {n.name:n for n in tree.body if isinstance(n,ast.FunctionDef)}
  subprocess_calls = [n for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute)
                      and isinstance(n.func.value,ast.Name) and n.func.value.id=='subprocess']
  self.assertEqual(len(subprocess_calls),1)
  for verb in ('reset-failed','start','stop','restart','reload','set-property','mkdir','unlink','rename','rmtree'):
   self.assertNotIn("'"+verb+"'",source)
  returned = [n.value for n in ast.walk(functions['runtime_config']) if isinstance(n,ast.Return)][0]
  self.assertEqual([k.value for k in returned.keys],['bytes','sha256','httpStatus'])
  self.assertFalse(any(isinstance(v,ast.Name) and v.id=='raw' for v in returned.values))
  self.assertIn('fcntl.LOCK_SH | fcntl.LOCK_NB',source)

 def test_publication_binding_requires_single_actual_success(self):
  receipt = {'releaseId':T.RELEASE,'commit':T.COMMIT,'tree':T.TREE,'exitCode':0,'failure':None}
  proof = {'ok':True,'allPriorRootsPreserved':True,'archiveSha256':'a'*64,'manifestSha256':'b'*64}
  raw = (json.dumps(receipt)+'\n'+json.dumps(proof)+'\n').encode()
  self.assertEqual(T.publication_binding(raw),'b'*64)
  with self.assertRaises(AssertionError): T.publication_binding(raw+json.dumps(proof).encode())
  receipt['exitCode']=False
  with self.assertRaises(AssertionError): T.publication_binding((json.dumps(receipt)+'\n'+json.dumps(proof)).encode())
  receipt['exitCode']=1
  with self.assertRaises(AssertionError): T.publication_binding((json.dumps(receipt)+'\n'+json.dumps(proof)).encode())

 def test_local_source_binding_and_noncanonical_capture_refuse(self):
  raw = T.read_stable(pathlib.Path(R.__file__),T.SOURCE_BYTES)
  self.assertEqual(len(raw),T.SOURCE_BYTES);self.assertEqual(hashlib.sha256(raw).hexdigest(),T.SOURCE_SHA)
  with tempfile.TemporaryDirectory() as folder:
   path = pathlib.Path(folder)/'payload';path.write_bytes(b'x');link=pathlib.Path(folder)/'link';link.symlink_to(path)
   with self.assertRaises(AssertionError):T.read_stable(link,32)
   path.chmod(0o666)
   with self.assertRaises(AssertionError):T.read_stable(path,32)

if __name__=='__main__': unittest.main()
