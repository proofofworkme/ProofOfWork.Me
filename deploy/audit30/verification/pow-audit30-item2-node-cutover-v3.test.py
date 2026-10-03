"""Pure local scheduling and binding tests. No service, SQL, or native calls."""
import ast
import datetime
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SOURCE=Path('/tmp/pow-audit30-item2-node-cutover-v3.py').read_bytes()
N={'__name__':'_pure_item2_cutover_tests','__file__':'/tmp/pow-audit30-item2-node-cutover-v3.py'}
exec(compile(SOURCE,N['__file__'],'exec'),N)

class CutoverTests(unittest.TestCase):
 def test_scheduler_ignores_running_missing_phase_and_stale_idle(self):
  now=datetime.datetime.now(datetime.timezone.utc)
  rows=[{'state':'running','backfillPhases':None,'finishedAt':None},
        {'state':'canonical-phase-complete','backfillPhases':None,'finishedAt':now.isoformat()},
        {'state':'idle','backfillPhases':N['IDLE_EXPECTED'],'finishedAt':(now-datetime.timedelta(seconds=20)).isoformat()},
        {'state':'idle','backfillPhases':N['IDLE_EXPECTED'],'finishedAt':now.isoformat()}]
  seen=[]
  def run(argv,**kw):
   seen.append(argv)
   self.assertEqual(kw['input'],N['IDLE_SQL'].encode())
   self.assertIn('PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000',argv)
   self.assertEqual(kw['timeout'],8)
   return SimpleNamespace(stdout=json.dumps(rows.pop(0)).encode(),stderr=b'')
  with patch.object(N['subprocess'],'run',side_effect=run),patch.object(N['time'],'sleep'):
   result=N['idle_window']()
  self.assertEqual(result['samples'],4)
  self.assertEqual(result['guardInvocationsSoFar'],0)
  self.assertEqual(result['cutoverInvocationsSoFar'],0)

 def test_scheduler_deadline_refuses_without_launch(self):
  with patch.object(N['time'],'monotonic',side_effect=[0,180]),patch.object(N['subprocess'],'run')as run:
   with self.assertRaisesRegex(ValueError,'READONLY_IDLE_WINDOW_UNAVAILABLE_CUTOVER_NOT_INVOKED'):N['idle_window']()
   run.assert_not_called()

 def test_scheduler_exact_historical_sql(self):
  tree=ast.parse(Path('/tmp/pow-audit30-resume-mail16-launch.py').read_text())
  sql=next(v.value.value for v in tree.body if isinstance(v,ast.Assign) and any(isinstance(t,ast.Name)and t.id=='SQL'for t in v.targets))
  self.assertEqual(N['IDLE_SQL'],sql)

 def test_remaining_lifetime_uses_actual_service_start(self):
  with patch.dict(N,{'service_state':lambda u,k:{'ActiveState':'active','MainPID':str(N['os'].getpid()),'ExecMainStartTimestampMonotonic':'1000000'}}),patch.object(N['time'],'monotonic',return_value=56):
   self.assertEqual(N['remaining_unit_seconds']('unit'),1745)

 def test_canonical_release_and_guard_pins(self):
  root=Path('/home/sixer/ProofOfWork.Me')
  self.assertEqual(hashlib.sha256((root/'deploy/audit29/release.py').read_bytes()).hexdigest(),N['RELEASE_SHA'])
  import base64
  envelope=json.loads(Path('/tmp/pow-audit30-resume-mail16-envelope.json').read_text())
  guard=base64.b64decode(envelope['request']['guardBase64'],validate=True)
  self.assertEqual(len(guard),13199)
  self.assertEqual(hashlib.sha256(guard).hexdigest(),N['GUARD_SHA'])
  tree=ast.parse(SOURCE)
  mains=[c for c in ast.walk(tree)if isinstance(c,ast.Call)and isinstance(c.func,ast.Attribute)
         and isinstance(c.func.value,ast.Name)and c.func.value.id=='R'and c.func.attr=='main']
  self.assertEqual(len(mains),1)

class PriorLeaseStopTests(unittest.TestCase):
 def fixtures(self):
  import copy
  q=json.loads(Path('/tmp/pow-audit30-item2-cutover-v1-exact-request.json').read_text())
  q['schema']='pow-audit30-item2-node-cutover-request-v2';q['attempt']='item2-v2';q['guardRunId']='20261003T194500Z'
  records={k:json.loads(Path('/tmp/pow-audit30-item2-cutover-v1-exact-'+{'observation':'failure-observation'}.get(k,k)+'.json').read_text())for k in N['PRIOR_PINS']}
  return q,records
 def test_exact_prior_failure_and_request(self):
  q,records=self.fixtures();v=N['prior_lease_stop_evidence'](q,records,'lease-unit')
  self.assertEqual(v['priorRequestSHA256'],N['PRIOR_REQUEST_SHA']);self.assertEqual(v['mode'],'bound-already-stopped-no-second-stop')
 def test_prior_wrong_phase_refused(self):
  q,r=self.fixtures();r['failed']['phase']='delegating-frozen-controller'
  with self.assertRaisesRegex(ValueError,'PRIOR_FAILURE_PHASE'):N['prior_lease_stop_evidence'](q,r,'lease-unit')
 def test_differently_loaded_observation_refused(self):
  q,r=self.fixtures();r['observation']['observedOwnedLeaseState']['LoadState']='loaded'
  with self.assertRaisesRegex(ValueError,'PRIOR_STOP_OBSERVATION'):N['prior_lease_stop_evidence'](q,r,'lease-unit')
 def test_changed_acceptance_refused(self):
  q,r=self.fixtures();q['strictAccepted']['sha256']='0'*64
  with self.assertRaisesRegex(ValueError,'PRIOR_ACCEPTANCE_BINDING_DRIFT'):N['prior_lease_stop_evidence'](q,r,'lease-unit')
 def test_changed_prior_request_refused(self):
  q,r=self.fixtures();r['request']['guardRunId']='20261003T194500Z'
  with self.assertRaisesRegex(ValueError,'PRIOR_EXECUTED_REQUEST_SHA'):N['prior_lease_stop_evidence'](q,r,'lease-unit')
 def test_current_absent_requires_success(self):
  s={'LoadState':'not-found','ActiveState':'inactive','SubState':'dead','MainPID':'0','InvocationID':'','Result':'success'}
  self.assertTrue(N['stopped_lease_absent'](s,True))
  for key,value in [('LoadState','loaded'),('ActiveState','active'),('MainPID','123'),('InvocationID','a'*32),('Result','exit-code')]:
   copy=dict(s);copy[key]=value;self.assertFalse(N['stopped_lease_absent'](copy,True))
 def test_active_shadow_successor_refused(self):
  unit='proofofwork-audit29-shadow-'+N['RELEASE']+'-lease-v4.service'
  output=SimpleNamespace(returncode=0,stdout=(unit+' loaded active running shadow\n').encode(),stderr=b'')
  with patch.object(N['subprocess'],'run',return_value=output),patch.dict(N,{'service_state':lambda u,k:{'ActiveState':'active','MainPID':'123'}}):
   with self.assertRaisesRegex(ValueError,'ACTIVE_SHADOW_SUCCESSOR'):N['no_active_shadow_successor']()

class CanonicalFailedShadowTests(unittest.TestCase):
 def native(self):
  return {k:json.loads(Path('/tmp/pow-audit30-node-v2-exact-v2-'+name).read_text())for k,(name,pin)in N['NATIVE_V2_PINS'].items()}
 def encoded(self):
  import base64
  raw=Path('/tmp/pow-audit30-canonical-old-shadow-state-v1.json').read_bytes()
  return {'sha256':N['CANONICAL_FAILED_SHA'],'base64':base64.b64encode(raw).decode()}
 def test_exact_native_failure_restore_and_encoded_state(self):
  self.assertEqual(N['prior_native_v2_evidence'](self.native())['position']['position'],'unchanged')
  v=N['canonical_failed_evidence'](self.encoded());self.assertEqual(v['properties']['InvocationID'],'8203629fb6ae40ed91dbc7de42c98df0')
 def test_already_exchanged_prior_refused(self):
  r=self.native();r['position']['position']='exchanged'
  with self.assertRaisesRegex(ValueError,'PRIOR_NATIVE_FAILURE_POSITION'):N['prior_native_v2_evidence'](r)
 def test_unrestored_prior_timers_refused(self):
  r=self.native();r['restored']['timers']['proofofwork-postgres-logical-backup.timer']['ActiveState']='inactive'
  with self.assertRaisesRegex(ValueError,'PRIOR_NATIVE_TIMER_RESTORATION'):N['prior_native_v2_evidence'](r)
 def test_wrong_encoded_old_unit_refused(self):
  e=self.encoded();e['sha256']='0'*64
  with self.assertRaisesRegex(ValueError,'CANONICAL_FAILED_BOUND_SHA'):N['canonical_failed_evidence'](e)
 def test_one_exact_reset_and_unchanged_main(self):
  tree=ast.parse(SOURCE)
  reset=[n for n in ast.walk(tree)if isinstance(n,ast.Constant)and n.value=='reset-failed']
  self.assertEqual(len(reset),1)
  self.assertIn("need(current==failed_shadow['properties'],'CANONICAL_FAILED_INVOCATION_DRIFT')",SOURCE.decode())
  self.assertIn("pre.run(['/usr/bin/systemctl','reset-failed',CANONICAL_SHADOW],10)",SOURCE.decode())
  self.assertIn("need(stopped_lease_absent(after_reset,True),'CANONICAL_RESET_NOT_QUIET_ABSENT')",SOURCE.decode())

if __name__=='__main__':unittest.main()
