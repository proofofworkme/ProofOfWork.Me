"""Pure local scheduling and binding tests. No service, SQL, or native calls."""
import ast
import datetime
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SOURCE=Path('/tmp/pow-audit30-item2-node-cutover.py').read_bytes()
N={'__name__':'_pure_item2_cutover_tests','__file__':'/tmp/pow-audit30-item2-node-cutover.py'}
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

if __name__=='__main__':unittest.main()
