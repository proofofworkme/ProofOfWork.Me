#!/usr/bin/python3 -I
import ast,copy,json,signal,subprocess,time,types,unittest
from pathlib import Path
from unittest.mock import patch
P=Path('/tmp/pow-audit30-production-pg-identity-readonly-v1.py');D=types.ModuleType('identity_fixture');exec(compile(P.read_bytes(),str(P),'exec'),D.__dict__);RAW=Path('/tmp/pow-audit30-production-pg-identity-readonly-request-v1.json').read_bytes();R,D.M=D.decode(RAW)
def identity():return {'readOnly':'on','dataDirectory':'/var/lib/postgresql/16/main','serverVersionNum':'160010','systemIdentifier':'1234567890123456789','timeline':1,'backendPid':12345,'port':'5432','sessionUser':'postgres','currentUser':'postgres','socket':'/var/run/postgresql','serverAddress':None,'database':'postgres'}
class Tests(unittest.TestCase):
 def test_exact_managed(self):self.assertEqual(R['managedSha256'],D.MANAGED_SHA)
 def test_current_request_no_nulls(self):self.assertEqual(set(R['expectedLive']),set(D.OLD_FIVE))
 def test_null_template_refuses(self):
  with self.assertRaisesRegex(ValueError,'FRESH_ORIGINAL'):D.decode(Path('/tmp/pow-audit30-production-pg-identity-readonly-request-template-v1.json').read_bytes())
 def test_wrong_original_five(self):
  v=copy.deepcopy(R);v['expectedLive']['bitcoind.service']['MainPID']='1'
  with self.assertRaisesRegex(ValueError,'EXACT_ORIGINAL'):D.decode(json.dumps(v).encode())
 def test_extra_request_refuses(self):
  v=dict(R,sql='SELECT 1')
  with self.assertRaises(ValueError):D.decode(json.dumps(v).encode())
 def test_duplicate_request_refuses(self):
  with self.assertRaisesRegex(ValueError,'DUPLICATE'):D.decode(b'{"schema":1,"schema":2}')
 def test_observed_unknown_identifier_preserved(self):self.assertEqual(D.identity(json.dumps(identity()).encode())['systemIdentifier'],'1234567890123456789');self.assertNotIn('7692221671691040144',P.read_text())
 def test_readonly_off_refuses(self):
  v=identity();v['readOnly']='off'
  with self.assertRaises(ValueError):D.identity(json.dumps(v).encode())
 def test_production_path_refuses(self):
  v=identity();v['dataDirectory']='/data/private/cluster'
  with self.assertRaises(ValueError):D.identity(json.dumps(v).encode())
 def test_remote_address_refuses(self):
  v=identity();v['serverAddress']='127.0.0.1'
  with self.assertRaises(ValueError):D.identity(json.dumps(v).encode())
 def test_non_postgres_role_refuses(self):
  v=identity();v['sessionUser']='other'
  with self.assertRaises(ValueError):D.identity(json.dumps(v).encode())
 def test_bad_system_identifier_refuses(self):
  for ident in('0','00','1;SQL',str(2**64)):
   v=identity();v['systemIdentifier']=ident
   with self.assertRaises(ValueError):D.identity(json.dumps(v).encode())
 def test_timeline_bool_refuses(self):
  v=identity();v['timeline']=True
  with self.assertRaises(ValueError):D.identity(json.dumps(v).encode())
 def test_pid_bool_refuses(self):
  v=identity();v['backendPid']=True
  with self.assertRaises(ValueError):D.identity(json.dumps(v).encode())
 def test_fields_extra_refuse(self):
  v=dict(identity(),body='secret')
  with self.assertRaises(ValueError):D.identity(json.dumps(v).encode())
 def test_sql_source_limits(self):
  self.assertTrue(D.SQL.startswith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'));self.assertIn("statement_timeout='5s'",D.SQL);self.assertIn("lock_timeout='2s'",D.SQL);self.assertIn("idle_in_transaction_session_timeout='10s'",D.SQL);self.assertNotIn('pg_database_size',D.SQL);self.assertNotIn('pg_tablespace_size',D.SQL)
 def test_clean_fixed_sudo_sql_argv(self):self.assertEqual(D.SQL_ARGV[:9],['/usr/bin/sudo','-n','-u','postgres','-g','postgres','--','/usr/bin/env','-i']);self.assertEqual(D.SQL_ARGV[-2:],['-c',D.SQL]);self.assertIn('PGOPTIONS=-c default_transaction_read_only=on',D.SQL_ARGV)
 def test_no_unit_control_or_creation(self):
  calls=[ast.unparse(x.func)for x in ast.walk(ast.parse(P.read_bytes()))if isinstance(x,ast.Call)];self.assertFalse(any(x in calls for x in('M.main','M.durable','M.owned_stop','M.backup_metadata','os.mkdir','Path.mkdir')));self.assertNotIn('systemd-run',P.read_text())
 def test_fixed_metadata_only(self):
  with self.assertRaisesRegex(ValueError,'ONLY_FIXED'):D.command(['/usr/bin/systemctl','stop','bitcoind.service'])
 def test_once_sql_and_unchanged_fences(self):
  q={'service':{},'timer':{}};prot=R['expectedProtection'];seen=[]
  def captured(a,s):seen.append((a,s));return 0,json.dumps(identity()).encode(),b''
  with patch.object(D.M,'live',return_value=R['expectedLive']),patch.object(D.M,'quiet',return_value=q),patch.object(D,'protection',return_value=prot),patch.object(D,'captured',side_effect=captured):v=D.observe(R)
  self.assertEqual(seen,[(D.SQL_ARGV,20)]);self.assertTrue(v['identityCommand']['identityAccepted']);self.assertFalse(v['unitCreationOrControlPerformed'])
 def test_sql_stderr_hash_only(self):
  with patch.object(D.M,'live',return_value=R['expectedLive']),patch.object(D.M,'quiet',return_value={}),patch.object(D,'protection',return_value=R['expectedProtection']),patch.object(D,'captured',return_value=(1,b'',b'private secret')):v=D.observe(R)
  self.assertIsNone(v['productionIdentity']);self.assertNotIn('secret',json.dumps(v));self.assertFalse(v['identityCommand']['identityAccepted'])
 def test_real_parent_alarm_reaps_owned_child(self):
  real=subprocess.Popen;children=[];old=signal.getsignal(signal.SIGALRM)
  def spawn(*a,**kw):
   p=real(['/usr/bin/python3','-I','-B','-c','import time;time.sleep(20)'],**kw);children.append(p);return p
  def interrupted(*_):raise D.IdentityObservationInterrupted('actual alarm')
  D.DEADLINE=time.monotonic()+60;signal.signal(signal.SIGALRM,interrupted);signal.setitimer(signal.ITIMER_REAL,.03)
  try:
   with patch.object(D.subprocess,'Popen',spawn):
    with self.assertRaises(D.IdentityObservationInterrupted):D.captured(D.SQL_ARGV,20)
   self.assertTrue(D.LAST_CLIENT_REAP);self.assertIsNotNone(children[0].poll())
  finally:signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,old)
 def test_real_ignored_term_kill_reap(self):
  D.DEADLINE=time.monotonic()+60
  with self.assertRaises(subprocess.TimeoutExpired):D.captured(['/usr/bin/python3','-I','-B','-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(20)'],.1)
  self.assertTrue(D.LAST_CLIENT_REAP)
 def test_wrong_role_before_stdin(self):
  with patch.object(D.os,'geteuid',return_value=1000),patch.object(D.os,'getegid',return_value=1000):
   with self.assertRaisesRegex(ValueError,'FIXED_ISOLATED'):D.main()
if __name__=='__main__':unittest.main()
