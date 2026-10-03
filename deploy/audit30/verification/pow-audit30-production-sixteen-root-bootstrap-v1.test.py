#!/usr/bin/python3 -I -B
import base64,hashlib,importlib.util,io,json,signal,sys,types,unittest
from pathlib import Path
from unittest.mock import patch
P=Path('/tmp/pow-audit30-production-sixteen-root-bootstrap-v1.py');spec=importlib.util.spec_from_file_location('root_bootstrap',P);M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)
SOURCE=Path('/tmp/pow-audit30-production-sixteen-root-control-v1.py')
def envelope():return json.dumps(dict(schema=M.SCHEMA,rootControlBase64=base64.b64encode(SOURCE.read_bytes()).decode(),request={'rootControlSHA256':M.ROOT_SHA})).encode()
class Bootstrap(unittest.TestCase):
 def test_decodes_exact_control_without_invoking(self):
  source,data=M.decode(envelope());self.assertEqual(source,SOURCE.read_bytes());self.assertEqual(json.loads(data),{'rootControlSHA256':M.ROOT_SHA})
 def test_tampered_source_is_refused_before_compile(self):
  v=json.loads(envelope());v['rootControlBase64']=base64.b64encode(SOURCE.read_bytes()+b'\n# drift').decode()
  with self.assertRaisesRegex(ValueError,'ROOT_CONTROL_EXACT_BYTES'):M.decode(json.dumps(v).encode())
 def test_control_request_binding_cannot_change(self):
  v=json.loads(envelope());v['request']['rootControlSHA256']='0'*64
  with self.assertRaisesRegex(ValueError,'REQUEST_CONTROL_BINDING'):M.decode(json.dumps(v).encode())
 def test_duplicate_nested_operation_is_refused(self):
  raw=envelope().replace(b'"rootControlSHA256":',b'"operation":"apply","operation":"inverse","rootControlSHA256":')
  with self.assertRaisesRegex(ValueError,'DUPLICATE_ENVELOPE_KEY'):M.decode(raw)
 def test_outer_bound_and_unknown_fields(self):
  with self.assertRaisesRegex(ValueError,'ROOT_ENVELOPE_CAP'):M.decode(b'0'*393217)
  v=json.loads(envelope());v['command']='arbitrary'
  with self.assertRaisesRegex(ValueError,'ROOT_ENVELOPE_SCHEMA'):M.decode(json.dumps(v).encode())
 def test_inner_bound_prevents_compile(self):
  v=json.loads(envelope());v['request']['unbounded']='x'*262145
  with self.assertRaisesRegex(ValueError,'ROOT_REQUEST_CAP'):M.decode(json.dumps(v).encode())
 def test_exact_stdin_and_source_authority_and_handler_restore(self):
  # Genuine compiled in-memory stub ONLY: no production module, authority or action.
  source=b"import sys\nclass Interrupted(RuntimeError):pass\ndef main():\n print(ROOT_SOURCE_SHA256+':'+sys.stdin.buffer.read().decode())\n";out=io.StringIO();old={s:signal.getsignal(s)for s in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP)};original=sys.stdin
  with patch('sys.stdout',new=out):M.execute(source,b'fixture')
  self.assertEqual(out.getvalue(),M.ROOT_SHA+':fixture\n');self.assertIs(sys.stdin,original);self.assertEqual({s:signal.getsignal(s)for s in old},old)
 def test_exception_and_signal_propagate_with_handlers_restored(self):
  old={s:signal.getsignal(s)for s in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP)}
  source=b"import os,signal\nclass Interrupted(RuntimeError):pass\ndef main():os.kill(os.getpid(),signal.SIGTERM)\n"
  with self.assertRaisesRegex(RuntimeError,'Root production control interrupted'):M.execute(source,b'fixture')
  self.assertEqual({s:signal.getsignal(s)for s in old},old)
 def test_source_does_not_materialize_any_approval_or_writer(self):
  s=P.read_text();self.assertNotIn('open(',s);self.assertNotIn('systemd-run',s);self.assertNotIn('writeExactSixteen',s);self.assertNotIn('SystemExit',s)
if __name__=='__main__':unittest.main()
