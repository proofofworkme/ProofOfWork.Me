import base64,copy,hashlib,importlib.util,json,os,signal,stat,sys,tempfile,threading,time,types,unittest
from pathlib import Path
from unittest.mock import patch

def module(path,name):
 sp=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);return m
R=module('/tmp/pow-audit30-treasury-final-outcome-read-v1.py','read_final')
T=module('/tmp/pow-audit30-treasury-final-closure-native-v1.test.py','old_wrapper_test');M=T.B

def request():return dict(schema='pow-audit30-treasury-final-outcome-read-request-v1',runId=R.RUN,outcomeName='completed.json',outcomeSha256='a850e98deb0600c5943b6f4baeee699d49868f9b65a46ce9ca1759d4868ad50c',outcomeBytes=138003,utilityRawBase64=base64.b64encode(Path('/tmp/pow-audit30-treasury-final-closure-native-v1.py').read_bytes()).decode())
def outcome():
 old=json.loads(Path('/tmp/pow-audit30-treasury-final-closure-prepare-request-v1.json').read_bytes());b=T.row(R.UNIT);args=M.fixed_argv(R.PACKAGE);typed=dict(argvSha256=R.sha(json.dumps(args,separators=(',',':')).encode()),fixedCodeSha256=R.sha(args[-1].encode()));gc={k:'' for k in M.FIELDS};gc.update(LoadState='not-found',MainPID='0',InvocationID='',ActiveState='inactive',SubState='dead');stdout=dict(path=str(R.E/'corpus.json'),sha256='a'*64,bytes=12,metadata=[1,2,stat.S_IFREG|0o600,0,0,1,12,3,3]);stderr=dict(path=str(R.E/'stderr.log'),sha256=R.sha(b''),bytes=0,metadata=[1,3,stat.S_IFREG|0o600,0,0,1,0,3,3]);result=dict(status='discovered-history-closure-complete-with-closing-fences',closingFencesAccepted=True,stdout=stdout,stderr=stderr,coverage=dict(requestedParents=2569,acquiredParents=2569,remainingParents=0,targetCount=10232,canonicalTargetProofs=10232,blockGroups=567,batchProofs=644,derivedUnspentCount=1,coreCalls=6134,coreBytes=1200000,electrsCalls=20,electrsBytes=900000,openingPrefixCoreCalls=3,closingReservedCoreCalls=571),feeSummary=dict(targetCount=10232,coinbaseCount=0,nonCoinbaseFeeProofs=1,requiredParentCount=22264,uniquePrevoutCount=32516,feeRowsSha256='b'*64),scopedVerification={k:True for k in R.TRUE_FLAGS});window=dict(service='inactive',timer=dict(ActiveState='active',NextElapseUSecRealtime='Sun 2026-10-04 03:18:48 UTC'),observedAtUtc='2026-10-03T09:18:22+00:00')
 return dict(schema='pow-audit30-treasury-native-outcome-v1',runId=R.RUN,retainedUnitProbeSha256=M.RETAINED_PROBE_SHA,outputPropertyProbeSha256=M.OUTPUT_PROPERTY_PROBE_SHA,transportAccepted=True,failure=None,originalFailedCorpusAndPriorPackageUnchanged=True,inputRawDeltaOriginalUnchanged=True,inputRawDeltaSha256=M.SEED_SHA,selectedParentCount=2569,selectedParentSetSha256='608eed04fff7e8e28c6396fc743dd15834219adebfc2c8fef7e03efe8251dbff',remainingParentsAfterComplete=0,liveBefore=old['liveServices'],liveAfter=old['liveServices'],cleanup=dict(attempted=True,before=b,after=gc,typedExecStart=typed),result=result,captureFiles={'corpus.json':stdout,'stderr.log':stderr},backupWindowBefore=window,backupWindowAfter=window,unitSnapshots=[dict(properties=copy.deepcopy(b),typedExecStart=typed)],**{k:False for k in('futureChunksAuthorized','productionDataMutation','financialReconciliationComplete','may9TransactionIDsRequested','automaticNextChunk','autoRetry')})
class Tests(unittest.TestCase):
 def test_exact_actual_typed_request_compiles_only_inert_frozen_module(self):
  m=R.validate_request(request());self.assertEqual(m.PINS,M.PINS);self.assertEqual(m.Observer.observe.__code__.co_code,M.Observer.observe.__code__.co_code)
  for kind in('hash','bytes','path','run','source','extra'):
   v=request()
   if kind=='hash':v['outcomeSha256']='0'*64
   elif kind=='bytes':v['outcomeBytes']=138004
   elif kind=='path':v['outcomeName']='corpus.json'
   elif kind=='run':v['runId']='20261003T083000Z'
   elif kind=='source':v['utilityRawBase64']=base64.b64encode(b'arbitrary').decode()
   else:v['retry']=True
   with self.subTest(kind=kind),self.assertRaises(ValueError):R.validate_request(v)
 def test_duplicate_json_refuses(self):
  with self.assertRaises(ValueError):json.loads('{"runId":1,"runId":2}',object_pairs_hook=R.pairs)
 def test_saved_complete_coverage_and_stopped_context_accept_only_scoped(self):
  v=outcome();o,r=R.outcome(v,M,True);self.assertEqual(o.owned,v['cleanup']['before']['InvocationID']);self.assertEqual(r['coverage']['canonicalTargetProofs'],10232);self.assertFalse(v['financialReconciliationComplete'])
 def test_partial_calls_missing_closing_false_scope_refuse(self):
  for kind in('partial','calls','closing','scope','falseStop','inv','caps','source'):
   v=outcome()
   if kind=='partial':v['result']['coverage']['remainingParents']=1
   elif kind=='calls':v['result']['coverage']['coreCalls']-=1
   elif kind=='closing':v['result']['closingFencesAccepted']=False
   elif kind=='scope':v['financialReconciliationComplete']=True
   elif kind=='falseStop':v['cleanup']['after']['MainPID']='1'
   elif kind=='inv':v['unitSnapshots'][0]['properties']['InvocationID']='b'*32
   elif kind=='caps':v['unitSnapshots'][0]['properties']['MemoryMax']='infinity'
   else:v['inputRawDeltaSha256']='0'*64
   with self.subTest(kind=kind),self.assertRaises(ValueError):R.outcome(v,M,True)
 def test_failed_custody_is_preserved_never_complete(self):
  v=outcome();v.update(transportAccepted=False,failure=dict(errorClass='ValueError',privateReasonSha256='a'*64));o,r=R.outcome(v,M,False);self.assertIsNone(r)
 def test_current_gc_is_qualified_only_zero_pid_empty_invocation(self):
  v=outcome();o,_=R.outcome(v,M,True);d=v['cleanup']['after']
  with patch.object(M,'live_snapshot',return_value=v['liveBefore']),patch.object(o,'show',return_value=d):c=R.current(o,M,v['liveBefore']);self.assertTrue(c['ownedStopped']);self.assertTrue(c['qualifiedTransientGc']);self.assertIsNone(c['typedExecStart'])
  for k,x in(('MainPID','1'),('InvocationID','b'*32),('ActiveState','active')):
   with patch.object(M,'live_snapshot',return_value=v['liveBefore']),patch.object(o,'show',return_value=dict(d,**{k:x})),self.assertRaises(ValueError):R.current(o,M,v['liveBefore'])
 def test_current_loaded_zero_pid_requires_same_typed_command_role_invocation(self):
  v=outcome();o,_=R.outcome(v,M,True);d=dict(v['cleanup']['before'],ActiveState='inactive',SubState='dead',ControlGroup='')
  with patch.object(M,'live_snapshot',return_value=v['liveBefore']),patch.object(o,'show',return_value=d),patch.object(o,'typed_start',return_value={'fixtureOnly':True}):c=R.current(o,M,v['liveBefore']);self.assertFalse(c['qualifiedTransientGc'])
  d['InvocationID']='b'*32
  with patch.object(M,'live_snapshot',return_value=v['liveBefore']),patch.object(o,'show',return_value=d),self.assertRaises(ValueError):R.current(o,M,v['liveBefore'])
 def test_execute_reads_only_public_completed_twice_no_private_corpus_or_control(self):
  v=outcome();raw=json.dumps(v).encode();proof=dict(path=str(R.E/'completed.json'),sha256='a'*64,bytes=len(raw),metadata=[1,2,3]);seen=[]
  def read(p,*a):seen.append(p);return raw,proof
  with patch.object(R,'stable',side_effect=read),patch.object(M,'live_snapshot',return_value=v['liveBefore']),patch.object(M.Observer,'show',return_value=v['cleanup']['after']),patch.object(M,'check_window',return_value={'fixtureOnly':True}),patch.object(M.Observer,'command',side_effect=AssertionError('no native call')):
   r=R.execute(request(),M)
  self.assertEqual(seen,[R.E/'completed.json']*2);self.assertFalse(r['privateCorpusRehashed']);self.assertFalse(r['serviceControlPerformed']);self.assertFalse(r['rawTransactionsExported']);self.assertEqual(r['rpcCalls'],0);self.assertEqual(r['result']['coverage'],v['result']['coverage'])
 def test_execute_second_live_drift_refuses(self):
  v=outcome();raw=json.dumps(v).encode();changed=copy.deepcopy(v['liveBefore']);next(iter(changed.values()))['MainPID']='999999'
  with patch.object(R,'stable',return_value=(raw,dict(metadata=[1,2]))),patch.object(M,'live_snapshot',side_effect=[v['liveBefore'],changed]),patch.object(M.Observer,'show',return_value=v['cleanup']['after']),self.assertRaisesRegex(ValueError,'CURRENT_FIVE_DRIFT'):R.execute(request(),M)
 def test_real_noatime_fd_read_hash_metadata_hardlink_and_xattr_guards(self):
  with tempfile.TemporaryDirectory()as t:
   p=Path(t)/'public';p.write_bytes(b'public-safe');p.chmod(0o600);orig_lstat=Path.lstat;orig_stamp=R.stamp
   def owned(path,*a,**k):
    st=orig_lstat(path,*a,**k);d={n:getattr(st,n)for n in dir(st)if n.startswith('st_')};d['st_uid']=d['st_gid']=0;return types.SimpleNamespace(**d)
   def stamps(st):v=orig_stamp(st);v[3]=v[4]=0;return v
   with patch.object(Path,'lstat',owned),patch.object(R,'stamp',side_effect=stamps):
    raw,m=R.stable(p,R.sha(b'public-safe'),11);self.assertEqual(raw,b'public-safe');self.assertEqual(R.stable(p,R.sha(raw),11,m['metadata'])[1],m)
    with self.assertRaises(ValueError):R.stable(p,'0'*64,11)
    os.link(p,Path(t)/'alias')
    with self.assertRaises(ValueError):R.stable(p,R.sha(raw),11)
 def test_real_custom_signal_propagates_through_unchanged_observer_and_reaps_child(self):
  for sig in(signal.SIGINT,signal.SIGTERM):
   old=signal.signal(sig,lambda n,f:(_ for _ in ()).throw(R.ReadInterrupted('fixture-signal')))
   with tempfile.TemporaryDirectory()as t:
    marker=Path(t)/'ready';o=M.Observer(R.UNIT,R.E,time.monotonic()+3);errors=[]
    def send():
     end=time.monotonic()+2
     while not marker.exists()and time.monotonic()<end:time.sleep(.005)
     if not marker.exists():errors.append('missing');return
     os.kill(os.getpid(),sig)
    thread=threading.Thread(target=send);thread.start()
    try:
     with self.assertRaises(R.ReadInterrupted):o.command([sys.executable,'-I','-B','-c','import os,pathlib,sys,time;pathlib.Path(sys.argv[1]).write_text(str(os.getpid()));time.sleep(4)',str(marker)])
     thread.join();self.assertEqual(errors,[])
     with self.assertRaises(ProcessLookupError):os.kill(int(marker.read_text()),0)
    finally:thread.join();signal.signal(sig,old)
if __name__=='__main__':unittest.main()
