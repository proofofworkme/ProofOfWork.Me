import builtins,hashlib,importlib.util,json,sys,types,unittest
from pathlib import Path
from unittest.mock import patch
MODES=['install','prepare','run']
def module(mode):
 p=Path('/tmp/pow-audit30-body-'+mode+'-owned-caller-v1.py');s=importlib.util.spec_from_file_location('local_'+mode,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class Cases(unittest.TestCase):
 def run_main(self,m,result):
  calls=[];realexec=builtins.exec
  def inert_exec(code,globals_,locals_=None):
   realexec(code,globals_,locals_)
   if globals_.get('__file__')==str(m.T_PATH):
    globals_['execute']=lambda argv,request,prefix,deadline,**kwargs:(calls.append((argv,request,prefix,deadline,kwargs))or result)
  with patch.object(sys,'argv',[m.__file__]),patch('builtins.exec',side_effect=inert_exec),patch('builtins.print'):
   rc=m.main()
  return rc,calls
 def test_exact_shared_interface_success_allthree(self):
  for mode in MODES:
   m=module(mode);rc,calls=self.run_main(m,{'exitCode':0,'failure':None});self.assertEqual(rc,0);self.assertEqual(len(calls),1);argv,request,prefix,deadline,kwargs=calls[0];self.assertEqual(hashlib.sha256(request).hexdigest(),m.REQUEST_SHA);self.assertEqual(deadline,90 if mode=='install'else 420);self.assertEqual(kwargs['stdout_cap'],65536);self.assertEqual(kwargs['stderr_cap'],65536);self.assertEqual(prefix,m.PREFIX);self.assertNotIn(m.REQUEST_SHA,argv[-1]);self.assertEqual(kwargs['bindings']['sourceSHA256'],m.SOURCE_SHA)
 def test_shared_failure_or_exit_refusal(self):
  for mode in MODES:
   for result in [{'exitCode':1,'failure':None},{'exitCode':0,'failure':'TransportInterrupted'}]:
    rc,calls=self.run_main(module(mode),result);self.assertEqual(rc,1);self.assertEqual(len(calls),1)
 def test_extraargv_refuses_beforetransport(self):
  for mode in MODES:
   m=module(mode)
   with patch.object(sys,'argv',[m.__file__,'unapproved']):
    with self.assertRaisesRegex(ValueError,'NO_EXTRA_ARGV'):m.main()
 def test_actualsource_request_and_emptyoutputs(self):
  for mode in MODES:
   m=module(mode);self.assertEqual(hashlib.sha256(m.SOURCE.read_bytes()).hexdigest(),m.SOURCE_SHA);self.assertEqual(hashlib.sha256(m.REQUEST.read_bytes()).hexdigest(),m.REQUEST_SHA)
   for suffix in ['.stdout','.stderr','.json']:self.assertFalse(Path(str(m.PREFIX)+suffix).exists())
if __name__=='__main__':unittest.main()
