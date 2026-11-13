#!/usr/bin/env python3
import hashlib,json,runpy,subprocess,unittest,io,re
from types import SimpleNamespace
from pathlib import Path
HERE=Path(__file__).resolve().parent
class Hook(unittest.TestCase):
 def namespace(self):
  calls=[]
  def require(ok,message):
   if not ok:raise ValueError(message)
  ns={'install':lambda *a:calls.append('install'),'restore_verified_apps':lambda *a:calls.append('restore'),'require':require}
  exec(compile((HERE/'preinstall.py').read_text(),str(HERE/'preinstall.py'),'exec'),ns)
  return ns,calls
 def test_census_precedes_any_candidate_install(self):
  ns,calls=self.namespace();ns['linked_preinstall_census']=lambda _:calls.append('census')
  ns['install'](None,None,None,None,True,None);self.assertEqual(calls,['census','install'])
 def test_legacy_restore_does_not_run_candidate_census(self):
  ns,calls=self.namespace();ns['linked_preinstall_census']=lambda _:calls.append('census')
  ns['install'](None,None,None,None,False,None);self.assertEqual(calls,['install'])
 def test_census_refusal_never_installs(self):
  ns,calls=self.namespace()
  def refuse(_):raise ValueError('preexisting raw v2')
  ns['linked_preinstall_census']=refuse
  with self.assertRaises(ValueError):ns['install'](None,None,None,None,True,None)
  self.assertEqual(calls,[])
 def test_controller_orders_drain_before_census_before_writes(self):
  release=runpy.run_path(str(HERE/'release.py'));raw=release['controller']().decode()
  body=raw[raw.index("receipt['stopRequested']"):raw.index("receipt['completedAt']")]
  self.assertLess(body.index('drain_apps()'),body.index('install(ROOT'))
  self.assertIn("linked_preinstall_census(backup)\n    return linked_engine_install",raw)
 def test_restarted_writer_on_is_rejected(self):
  ns,calls=self.namespace()
  ns['UNITS']=['api','worker'];ns['states']=lambda _: {'api':{'ActiveState':'active','MainPID':'101'}}
  ns['open']=lambda *a:io.BytesIO(b'PUBLISH_LINKED_WRITES_ENABLED=1\0OTHER=hidden')
  with self.assertRaises(ValueError):ns['require_linked_writer_off']()
  ns['open']=lambda *a:io.BytesIO(b'PUBLISH_LINKED_WRITES_ENABLED=0\0OTHER=hidden')
  ns['require_linked_writer_off']()
 def test_new_process_fence_before_gateway(self):
  release=runpy.run_path(str(HERE/'release.py'));raw=release['controller']().decode()
  body=raw[raw.index('def restore_apps('):raw.index('def restore_verified_apps(')]
  self.assertLess(body.index('require_linked_writer_off()'),body.index('for unit in GATEWAY:'))
 def test_successful_child_with_failed_terminal_observation_blocks_restore(self):
  ns,calls=self.namespace();digest=lambda b:hashlib.sha256(b).hexdigest()
  root=runpy.run_path(str(HERE/'stage-contract.py'))['LINKED_STAGE_ROOT']/('a'*64);hold=Path('/run/hold')
  proof={'commit':'b'*40,'planSha256':'a'*64,'sourceHashes':{'helper.mjs':digest(b'source')}}
  proof_raw=json.dumps(proof).encode()
  manifest={'sourceCommit':'b'*40,'releaseId':'release','linkedStage':{'path':str(root),'sha256':digest(proof_raw)},'searchHold':{'markerSha256':digest(b'hold')},'nodeSha256':digest(b'node')}
  values={'manifest.json':json.dumps(manifest).encode(),'stage.json':proof_raw,'helper.mjs':b'source','hold':b'hold','node':b'node'}
  def bad(*args,**kwargs):raise OSError('systemctl failed')
  ns.update(ROOT=Path('/runtime'),validate_linked_stage=lambda *args:(root,proof),json=json,Path=Path,SHA=re.compile(r'[0-9a-f]{64}\Z'),sha=digest,HOLD=hold,
   safe_read=lambda p,*a:values[p.name],require_apps_drained=lambda:None,
   subprocess=SimpleNamespace(run=lambda *a,**k:subprocess.CompletedProcess([],0,b'{"ok":true}',b''),check_output=bad),
   durable=lambda *a:None)
  with self.assertRaises(OSError):ns['linked_preinstall_census'](Path('/backup'))
  self.assertTrue(ns['linked_census_uncertain'])
  with self.assertRaises(ValueError):ns['restore_verified_apps'](None,None,None,None)
  self.assertNotIn('restore',calls)
if __name__=='__main__':unittest.main()
