#!/usr/bin/env python3
import runpy,unittest,subprocess
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
phase=runpy.run_path(str(HERE/'phases.py'));stage=runpy.run_path(str(HERE/'stage.py'))
class RolledBack(Exception):pass
class Ops:
 def __init__(self,fail=None,error=RuntimeError):self.calls=[];self.fail=fail;self.error=error
 def call(self,name,value=None):
  self.calls.append(name)
  if self.fail==name:raise self.error(name)
  return value or {'ok':True}
 def hold(self):return self.call('hold')
 def stage(self,name,run_id=None):return self.call(name,{'ok':True,'pinned':{'run_id':'run'}} if name=='pin' else None)
 def prebuild(self):return self.call('build')
 def install(self):return self.call('install')
 def baseline(self):return self.call('baseline')
 def restore(self):return self.call('restore')
class Phases(unittest.TestCase):
 def runops(self,ops):return phase['execute_phases'](ops,RolledBack,{},stage['StageUncertain'])
 def test_success_one_hold_and_restore_keeps_pin(self):
  o=Ops();self.runops(o);self.assertEqual(o.calls,['hold','schema','pin','build','install','restore'])
 def test_schema_failure_restores_without_pin_change(self):
  o=Ops('schema')
  with self.assertRaises(RuntimeError):self.runops(o)
  self.assertEqual(o.calls,['hold','schema','restore'])
 def test_unknown_pin_commit_recovers_by_release_before_restore(self):
  o=Ops('pin')
  with self.assertRaises(RuntimeError):self.runops(o)
  self.assertEqual(o.calls,['hold','schema','pin','baseline','unpin','restore'])
 def test_prebuild_failure_unpins_after_exact_baseline(self):
  o=Ops('build')
  with self.assertRaises(RuntimeError):self.runops(o)
  self.assertEqual(o.calls[-3:],['baseline','unpin','restore'])
 def test_verified_overlay_rollback_unpins_before_restore(self):
  o=Ops('install',RolledBack)
  with self.assertRaises(RolledBack):self.runops(o)
  self.assertEqual(o.calls[-3:],['baseline','unpin','restore'])
 def test_unverified_overlay_retains_pin_and_hold(self):
  o=Ops('install')
  with self.assertRaises(RuntimeError):self.runops(o)
  self.assertNotIn('restore',o.calls);self.assertNotIn('unpin',o.calls)
 def test_uncertain_staged_children_retain_hold(self):
  for mode in ['schema','pin','build']:
   o=Ops(mode,stage['StageUncertain'])
   with self.subTest(mode=mode),self.assertRaises(stage['StageUncertain']):self.runops(o)
   self.assertNotIn('restore',o.calls);self.assertNotIn('unpin',o.calls)
 def test_baseline_change_preserves_hold_and_pin(self):
  o=Ops('build');original=o.baseline
  o.baseline=lambda:(_ for _ in ()).throw(ValueError('baseline changed'))
  with self.assertRaises(ValueError):self.runops(o)
  self.assertNotIn('unpin',o.calls);self.assertNotIn('restore',o.calls)
 def test_pin_recovery_failure_keeps_hold(self):
  o=Ops('build');original=o.stage
  def st(name,run_id=None):
   if name=='unpin':raise ValueError('pin changed')
   return original(name,run_id)
  o.stage=st
  with self.assertRaises(ValueError):self.runops(o)
  self.assertNotIn('restore',o.calls)
 def test_hold_failure_never_launches_or_guesses_restore(self):
  o=Ops('hold')
  with self.assertRaises(RuntimeError):self.runops(o)
  self.assertEqual(o.calls,['hold'])
 def test_resource_envelope_and_no_secrets(self):
  cmd=stage['command'](Path('/data/stage'),'build','release','unit')
  for item in ['--property=MemoryMax=512M','--property=CPUQuota=100%','--property=RuntimeMaxSec=300','--setenv=POW_INDEX_DB_STATEMENT_TIMEOUT_MS=15000']:self.assertIn(item,cmd)
  self.assertNotIn('PUBLISH_LINKED_WRITES_ENABLED=1',' '.join(cmd))
 def test_stage_timeout_requires_verified_stop(self):
  func=stage['run_stage'];g=func.__globals__;calls=[]
  def run(cmd,**kw):
   calls.append(cmd)
   if cmd[0]=='/usr/bin/systemd-run':raise subprocess.TimeoutExpired(cmd,330)
   return subprocess.CompletedProcess(cmd,0,b'',b'')
  with patch.dict(g,{'stopped':lambda _:True}),patch.object(g['subprocess'],'run',run):
   with self.assertRaisesRegex(RuntimeError,'stopped after interruption'):func(Path('/data/stage'),'build','release','a'*64,1,lambda:None)
  self.assertEqual(calls[-1][0:2],['/usr/bin/systemctl','stop'])
 def test_failed_child_stop_is_uncertain(self):
  func=stage['run_stage'];g=func.__globals__
  def run(cmd,**kw):raise subprocess.TimeoutExpired(cmd,330)
  with patch.dict(g,{'stopped':lambda _:True}),patch.object(g['subprocess'],'run',run):
   with self.assertRaises(stage['StageUncertain']):func(Path('/data/stage'),'build','release','a'*64,1,lambda:None)
 def test_terminal_observation_error_is_uncertain(self):
  func=stage['run_stage'];g=func.__globals__;observations=iter([True,OSError('systemctl unavailable')])
  def stopped(_):
   value=next(observations)
   if isinstance(value,Exception):raise value
   return value
  with patch.dict(g,{'stopped':stopped}),patch.object(g['subprocess'],'run',lambda *a,**k:subprocess.CompletedProcess([],0,b'{"ok":true}',b'')):
   with self.assertRaises(stage['StageUncertain']):func(Path('/data/stage'),'build','release','a'*64,1,lambda:None)
if __name__=='__main__':unittest.main()
