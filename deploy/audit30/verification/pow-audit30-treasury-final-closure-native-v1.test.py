#!/usr/bin/python3 -I
"""Affected final closure wrapper fixtures; native custody mocked, local FS/signal genuine.
The unchanged302 Observer/resources are compared byte-for-byte rather than rerun.
No fixture calls SSH/Core/Electrs/systemd or changes frozen collector authority.
"""
import ast,base64,copy,hashlib,importlib.util,json,os,signal,stat,subprocess,sys,tempfile,time,types,unittest
from pathlib import Path
from unittest.mock import patch
SOURCE=Path('/tmp/pow-audit30-treasury-final-closure-native-v1.py')
sp=importlib.util.spec_from_file_location('B',SOURCE);B=importlib.util.module_from_spec(sp);sp.loader.exec_module(B)
PACKAGE=json.loads(Path('/tmp/pow-audit30-treasury-final-closure-package-request-v1.json').read_bytes())
SELECTED={'selected':[f'{i:064x}'for i in range(2569)],'priorPackageMetadata':[1,2],'priorPackageFiles':{'fixtureOnly':[3]}}
SELECTED['selectedSha256']=B.sha(json.dumps(SELECTED['selected'],separators=(',',':')).encode())
PRIOR={'originalFailedCorpusSha256':'8eeb467bf3468734beee934d884148b7045ed28803045a2b66ac51ca0f1e2596','qualifiedMock':True}
def request(mode='run'):
 v=json.loads(Path('/tmp/pow-audit30-treasury-final-closure-prepare-request-v1.json').read_bytes());v['mode']=mode
 v['backupWindow']={'observedAtUtc':B.utc(),'nextBackupUtc':(B.dt.datetime.now(B.dt.timezone.utc)+B.dt.timedelta(hours=2)).replace(microsecond=0).isoformat()};return v
def delta():
 return dict(schema='pow-audit30-treasury-final-discovered-history-closure-v1',status='discovered-history-closure-complete-with-closing-fences',coverage=dict(derivedUnspentCount=1,coreCalls=6134),closingFencesAccepted=True,feeSummary=dict(targetCount=10232),**{k:True for k in('parentValuesComplete','targetCanonicalMembershipComplete','knownHistoryFeeAndDirectSpendCoverageAccepted','derivedUnspentCoreChecksComplete','knownHistoryBalanceComparisonAccepted')})

def row(unit):
 d={k:''for k in B.FIELDS};d.update(LoadState='loaded',ActiveState='active',SubState='exited',MainPID='0',InvocationID='a'*32,Result='success',ExecMainCode='1',ExecMainStatus='0',User='bitcoin',Group='bitcoin',MemoryMax=str(1024**3),MemoryHigh=str(512*1024**2),MemorySwapMax='0',CPUQuotaPerSecUSec='250ms',CPUWeight='10',IOWeight='10',Nice='15',TasksMax='32',RuntimeMaxUSec='22min',TimeoutStopUSec='30s',KillMode='control-group',Restart='no',NoNewPrivileges='yes',ProtectSystem='strict',ProtectHome='yes',PrivateTmp='yes',PrivateDevices='yes',PrivateIPC='yes',PrivateNetwork='no',RestrictAddressFamilies='AF_UNIX AF_INET AF_INET6',ReadOnlyPaths='/etc/bitcoin /data/bitcoin',InaccessiblePaths='/var/lib/postgresql /run/postgresql /data/proofofwork-postgres-tablespaces /etc/proofofwork-api',StandardInput='null',StandardOutput='append',StandardError='append',UMask='0077',ControlGroup='/system.slice/'+unit,RemainAfterExit='yes',Type='exec',Transient='yes',FragmentPath='/run/systemd/transient/'+unit);return d
class Tests(unittest.TestCase):
 def test_unchanged_observer_resource_and_native_command_bytes(self):
  a=Path('/tmp/pow-audit30-treasury-missing-parents-native-v1.py').read_text();b=SOURCE.read_text()
  self.assertEqual(a[a.index('class Observer:'):a.index('def live_snapshot')],b[b.index('class Observer:'):b.index('def live_snapshot')])
  for name in ('fixed_argv','require_absent','main','read_file','seed_read','live_snapshot','check_window','durable'):
   def node(s):return ast.dump(next(n for n in ast.parse(s).body if isinstance(n,ast.FunctionDef)and n.name==name),include_attributes=False)
   self.assertEqual(node(a),node(b),name)
  old=types.ModuleType('old');exec(compile(a,'inert-old','exec'),old.__dict__);self.assertEqual(B.PROPS,old.PROPS);self.assertEqual(B.FIELDS,old.FIELDS);self.assertEqual((B.MAX_OUT,B.MAX_ERR,B.DEADLINE),(old.MAX_OUT,old.MAX_ERR,old.DEADLINE))
 def test_exact_real_typed_request_two_members_only(self):
  rid,files=B.validate_request(request());self.assertEqual(rid,'20261003T090000Z');self.assertEqual(set(files),{'collector.py'});self.assertEqual({n:(B.sha(r),len(r))for n,r in files.items()},B.PINS);self.assertEqual(str(B.SEED),'/data/proofofwork-release-backups/audit30-treasury-parent-chunk1-20261003T083000Z/corpus.json')
  for kind in ('rawpath','rawhash','rawinode','extra','cap','calendar','member','body','launch','packageSHA'):
   v=request()
   if kind=='rawpath':v['seedSource']['path']='/tmp/else'
   elif kind=='rawhash':v['seedSource']['sha256']='0'*64
   elif kind=='rawinode':v['seedSource']['metadata']['uid']=988
   elif kind=='extra':v['chunk']=2
   elif kind=='cap':v['rpcCap']=12000
   elif kind=='calendar':v['runId']='20260230T083000Z'
   elif kind=='member':v['packageRequest']['members'].append(copy.deepcopy(v['packageRequest']['members'][0]))
   elif kind=='body':v['packageRequest']['members'][0]['rawBase64']=base64.b64encode(b'arbitrary').decode()
   elif kind=='launch':v['packageRequest']['launchRequested']=True
   else:v['packageRequestSha256']='0'*64
   with self.subTest(kind=kind),self.assertRaises(ValueError):B.validate_request(v)
 def test_null_future_run_template_is_not_executable(self):
  v=json.loads(Path('/tmp/pow-audit30-treasury-final-closure-run-request-template-v1.json').read_bytes())
  with self.assertRaises(ValueError):B.validate_request(v)
 def test_duplicate_json_key_refuses(self):
  with self.assertRaises(ValueError):json.loads('{"mode":"run","mode":"prepare"}',object_pairs_hook=B.pairs)
 def test_root_saved_raw_delta_metadata_exact(self):
  v=request();B.validate_seed_authority(v);m=v['seedSource']['metadata'];self.assertEqual((m['device'],m['inode'],m['bytes'],m['mtimeNs'],m['ctimeNs']),(64514,76809547,14436219,1791016131950998104,1791016131950998104))
 def test_original_source_reader_restores_fixed_constants_after_failure(self):
  original=(B.SEED,B.SEED_SHA,B.SEED_BYTES)
  with patch.object(B,'read_file',return_value=(b'collector',None)),patch.object(B,'sha',return_value='02fc3a54c231c85bd1beab9307a9959bf2092bb169bdc603de64960830781130'),patch.object(B,'seed_read',side_effect=RuntimeError('fixture')):
   with self.assertRaises(RuntimeError):B.prior_authority()
  self.assertEqual((B.SEED,B.SEED_SHA,B.SEED_BYTES),original)
 def test_prepare_before_after_old_package_and_delta_fences(self):
  with tempfile.TemporaryDirectory()as t:
   base=Path(t)/'parents';v=request('prepare');v['packageRequest']['packagePath']=str(base/v['runId']);v['packageRequestSha256']=B.sha((json.dumps(v['packageRequest'],sort_keys=True,indent=2)+'\n').encode());calls=[]
   def chosen(p,d,source=None):
    calls.append(source is not None)
    if source is not None:self.assertFalse(p.exists());self.assertEqual((B.sha(source),len(source)),B.PINS['collector.py'])
    else:self.assertTrue(p.exists())
    return SELECTED
   with patch.object(B,'BASE',base),patch.object(B,'canonical_dir'),patch.object(B.os,'chown'),patch.object(B.os,'fchown'),patch.object(B.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_gid=os.getgid())),patch.object(B,'package_proof',return_value={'fixtureOnly':True}),patch.object(B,'selection_authority',side_effect=chosen),patch.object(B,'seed_read',return_value=b'fixture-private-delta'),patch.object(B,'prior_authority',return_value=PRIOR):
    out=B.prepare(v);self.assertFalse(out['nativeUnitLaunched']);self.assertTrue(out['originalFailedCorpusUnchanged']);self.assertEqual(calls,[True,False]);p=base/v['runId'];self.assertEqual(set(x.name for x in p.iterdir()),{'collector.py','parent-chunk1-corpus.json'});self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o750)
    for member in p.iterdir():self.assertEqual(stat.S_IMODE(member.stat().st_mode),0o440)
    self.assertEqual((p/'parent-chunk1-corpus.json').read_bytes(),b'fixture-private-delta')
    with self.assertRaises(ValueError):B.prepare(v)
 def test_precreation_old_package_refusal_creates_no_package(self):
  with tempfile.TemporaryDirectory()as t:
   base=Path(t)/'parents';v=request('prepare');v['packageRequest']['packagePath']=str(base/v['runId']);v['packageRequestSha256']=B.sha((json.dumps(v['packageRequest'],sort_keys=True,indent=2)+'\n').encode())
   with patch.object(B,'BASE',base),patch.object(B,'canonical_dir'),patch.object(B,'seed_read',return_value=b'delta'),patch.object(B,'prior_authority',return_value=PRIOR),patch.object(B,'selection_authority',side_effect=ValueError('old package drift')),patch.object(B.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_gid=os.getgid())):
    with self.assertRaises(ValueError):B.prepare(v)
   self.assertFalse((base/v['runId']).exists())
 def test_postcreation_old_package_drift_refuses_preserves_partial(self):
  with tempfile.TemporaryDirectory()as t:
   base=Path(t)/'parents';v=request('prepare');v['packageRequest']['packagePath']=str(base/v['runId']);v['packageRequestSha256']=B.sha((json.dumps(v['packageRequest'],sort_keys=True,indent=2)+'\n').encode())
   with patch.object(B,'BASE',base),patch.object(B,'canonical_dir'),patch.object(B.os,'chown'),patch.object(B.os,'fchown'),patch.object(B.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_gid=os.getgid())),patch.object(B,'package_proof',return_value={}),patch.object(B,'seed_read',return_value=b'delta'),patch.object(B,'prior_authority',return_value=PRIOR),patch.object(B,'selection_authority',side_effect=[SELECTED,dict(SELECTED,priorPackageMetadata=['drift'])]):
    with self.assertRaises(ValueError):B.prepare(v)
   self.assertEqual(set(x.name for x in(base/v['runId']).iterdir()),{'collector.py','parent-chunk1-corpus.json'})
 def exercise(self,fault=None):
  t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup);parent=Path(t.name);base=parent/'packages';base.mkdir();v=request();v['packageRequest']['packagePath']=str(base/v['runId']);v['packageRequestSha256']=B.sha((json.dumps(v['packageRequest'],sort_keys=True,indent=2)+'\n').encode());e=parent/('audit30-treasury-final-closure-'+v['runId']);state={'stops':0,'args':None};seedcalls=0;priorcalls=0;selectedcalls=0
  def seed(_):
   nonlocal seedcalls;seedcalls+=1;return b'drift'if fault=='deltaDrift'and seedcalls>=3 else b'delta'
  def prior():
   nonlocal priorcalls;priorcalls+=1;return dict(PRIOR,changed=True)if fault=='priorDrift'and priorcalls>=2 else PRIOR
  def selected(*args):
   nonlocal selectedcalls;selectedcalls+=1;return dict(SELECTED,priorPackageMetadata=['drift'])if fault=='packageDrift'and selectedcalls>=2 else SELECTED
  def command(o,args,cleanup=False):
   if args[0]=='/usr/bin/systemd-run':state['args']=args;(e/'corpus.json').write_text(json.dumps(delta()));return b''
   if args[1]=='stop':state['stops']+=1;return b''
   raise AssertionError('no actual systemd in fixture')
  def show(o,cleanup=False):
   d=row(o.unit)
   if state['stops']:d.update(ActiveState='inactive',SubState='dead')
   return d
  def capture(p,bound):
   raw=p.read_bytes();B.need(len(raw)<=bound,'fixture-bound');return {'path':str(p),'bytes':len(raw),'sha256':B.sha(raw)},raw
  with patch.object(B,'BASE',base),patch.object(B,'EVIDENCE',parent),patch.object(B,'canonical_dir'),patch.object(B,'package_proof',return_value={'fixtureOnly':True}),patch.object(B,'prior_authority',side_effect=prior),patch.object(B,'selection_authority',side_effect=selected),patch.object(B,'seed_read',side_effect=seed),patch.object(B,'require_absent',return_value={'fixtureOnly':True}),patch.object(B,'live_snapshot',return_value=v['liveServices']),patch.object(B,'check_window',return_value={'fixtureOnly':True}),patch.object(B.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_gid=os.getgid())),patch.object(B.Observer,'command',command),patch.object(B.Observer,'show',show),patch.object(B.Observer,'typed_start',return_value={'fixtureOnly':True}),patch.object(B.Observer,'output_proof',return_value={'fixtureOnly':True}),patch.object(B,'capture_proof',capture),patch.object(B,'validate_delta',side_effect=lambda v,s:v):
   if fault:
    with self.assertRaises(ValueError):B.run(v)
   else:self.assertTrue(B.run(v)['nativeUnitStopped'])
  r=json.loads((e/('failed.json'if fault else'completed.json')).read_bytes());return r,state,e
 def test_success_scoped_flags_never_claim_financial_or_next_chunk_authority(self):
  r,s,e=self.exercise();self.assertEqual(s['stops'],1);self.assertTrue(r['transportAccepted']);self.assertTrue(r['originalFailedCorpusAndPriorPackageUnchanged']);self.assertEqual(r['remainingParentsAfterComplete'],0);self.assertFalse(r['futureChunksAuthorized']);self.assertFalse(r['financialReconciliationComplete']);self.assertNotIn('--collect',s['args'])
 def test_actual_launch_output_setters_and_only_new_fixed_parent_collector(self):
  r,s,e=self.exercise();args=s['args'];props={args[i+1].split('=',1)[0]:args[i+1].split('=',1)[1]for i,x in enumerate(args)if x=='--property'};self.assertEqual(props['StandardOutput'],'append:'+str(e/'corpus.json'));self.assertEqual(props['StandardError'],'append:'+str(e/'stderr.log'));self.assertIn('/collector.py',args[-1]);self.assertNotIn('seed-collector.py',args[-1]);self.assertEqual(props['MemoryMax'],'1G')
 def test_false_final_delta_equality_never_completed(self):
  r,s,e=self.exercise('deltaDrift');self.assertFalse(r['transportAccepted']);self.assertFalse(r['originalFailedCorpusAndPriorPackageUnchanged']);self.assertEqual(r['failure']['phase'],'original-seed-final-fence');self.assertFalse((e/'completed.json').exists());self.assertEqual(s['stops'],1)
 def test_false_final_original_equality_never_completed(self):
  r,s,e=self.exercise('priorDrift');self.assertFalse(r['transportAccepted']);self.assertFalse(r['inputRawDeltaOriginalUnchanged']);self.assertFalse((e/'completed.json').exists())
 def test_false_final_old_package_equality_never_completed(self):
  r,s,e=self.exercise('packageDrift');self.assertFalse(r['transportAccepted']);self.assertFalse((e/'completed.json').exists());self.assertEqual(s['stops'],1)
 def test_real_interrupted_helper_reaped_repeated_cleanup_signal_preserves_failure(self):
  with tempfile.TemporaryDirectory(dir='/tmp')as t:
   folder=Path(t);code=r'''
import importlib.util,pathlib,time,types,sys,json
folder=pathlib.Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('T','/tmp/pow-audit30-treasury-final-closure-native-v1.test.py');T=importlib.util.module_from_spec(spec);spec.loader.exec_module(T);B=T.B
B.BASE=folder/'tools';B.BASE.mkdir();B.EVIDENCE=folder;v=T.request();v['packageRequest']['packagePath']=str(B.BASE/v['runId']);v['packageRequestSha256']=B.sha((json.dumps(v['packageRequest'],sort_keys=True,indent=2)+'\n').encode())
B.pwd.getpwnam=lambda _:types.SimpleNamespace(pw_gid=1000);B.canonical_dir=lambda *_a,**_k:None;B.package_proof=lambda *_:{'fixtureOnly':True};B.require_absent=lambda *_:{};B.seed_read=lambda _:b'delta';B.prior_authority=lambda:T.PRIOR;B.selection_authority=lambda *_:T.SELECTED;B.check_window=lambda *_:{};B.live_snapshot=lambda *_:v['liveServices']
Original=B.Observer
class LocalOwner(Original):
 def command(self,args,cleanup=False):
  if args[0]=='/usr/bin/systemd-run':return super().command([sys.executable,'-I','-B','-c','import pathlib,sys,time,os;pathlib.Path(sys.argv[1]).write_text(str(os.getpid()));time.sleep(10)',str(folder/'blocking')])
  raise AssertionError('no native commands in literal fixture')
 def show(self,cleanup=False):return T.row(self.unit)
 def typed_start(self,cleanup=False):return {'fixtureOnly':True}
 def output_proof(self,d):return {'fixtureOnly':True}
 def stop_owned(self):(folder/'cleanup').write_text('ready');time.sleep(.1);return {'attempted':True,'fixtureOnly':True}
B.Observer=LocalOwner
try:B.run(v)
except BaseException as e:print(json.dumps({'errorClass':type(e).__name__}),flush=True)
'''
   p=subprocess.Popen([sys.executable,'-I','-B','-c',code,t],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
   try:
    start=time.monotonic()
    while not(folder/'blocking').exists()and p.poll()is None and time.monotonic()-start<3:time.sleep(.005)
    self.assertTrue((folder/'blocking').exists());p.send_signal(signal.SIGTERM)
    while not(folder/'cleanup').exists()and p.poll()is None and time.monotonic()-start<3:time.sleep(.005)
    self.assertTrue((folder/'cleanup').exists());p.send_signal(signal.SIGINT);out,err=p.communicate(timeout=3);self.assertEqual(p.returncode,0);self.assertEqual(err,b'');self.assertEqual(json.loads(out)['errorClass'],'ValueError');r=json.loads(next(folder.glob('audit30-treasury-final-closure-*/failed.json')).read_bytes());self.assertEqual(r['failure']['errorClass'],'NativeInterrupted');self.assertTrue(r['cleanup']['attempted']);self.assertFalse(r['transportAccepted']);self.assertFalse(list(folder.glob('audit30-treasury-final-closure-*/completed.json')))
    with self.assertRaises(ProcessLookupError):os.kill(int((folder/'blocking').read_text()),0)
   finally:
    if p.poll()is None:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=3)
    p.stdout.close();p.stderr.close()

# The root result gate runs the real c37 raw/header/partialMerkle parser on this
# synthetic full-size population. No actual stored corpus or RPC is used.
def full_result():
 import struct
 sp=importlib.util.spec_from_file_location('L','/tmp/pow-audit30-item8-ledger-corpus-collector-v2.py');L=importlib.util.module_from_spec(sp);sp.loader.exec_module(L)
 parents={}
 for i in range(2569):
  raw=bytes.fromhex('0100000001')+b'\0'*32+b'\xff'*4+b'\0'+b'\xff'*4+b'\x01'+struct.pack('<Q',i+1)+b'\x01\x51'+b'\0'*4;t=L.parse_raw(raw.hex());parents[t['txid']]=t
 selected=dict(selected=sorted(parents));selected['selectedSha256']=B.sha(json.dumps(selected['selected'],separators=(',',':')).encode());selected['expectedHeights']={}
 blocks={};proofs={};allids=[];next_=0
 for g in range(567):
  count=65 if g<77 else 11 if g<404 else 10
  ids=sorted(hashlib.sha256(('target-'+str(i)).encode()).hexdigest()for i in range(next_,next_+count));next_+=count;allids.extend(ids);leaves=[bytes.fromhex(t)[::-1]for t in ids]
  def width(h):return(len(ids)+(1<<h)-1)>>h
  def hnode(h,p):
   if h==0:return leaves[p]
   left=hnode(h-1,p*2);right=hnode(h-1,p*2+1)if p*2+1<width(h-1)else left;return L.dsha(left+right)
  height=0
  while width(height)>1:height+=1
  header=bytes.fromhex('01000000')+b'\0'*32+hnode(height,0)+struct.pack('<III',g,0,0);block=L.header_proof(header.hex());blocks[block]=dict(height=g+1,headerHex=header.hex(),canonicalHashAtCapture=block,canonicalHashAfter=block);selected['expectedHeights'][block]=g+1
  for offset in range(0,count,64):
   chosen=set(range(offset,min(count,offset+64)));bits=[];hashes=[]
   def walk(h,p):
    matched=any(i in chosen for i in range(p<<h,min((p+1)<<h,count)));bits.append(int(matched))
    if h==0 or not matched:hashes.append(hnode(h,p));return
    walk(h-1,p*2)
    if p*2+1<width(h-1):walk(h-1,p*2+1)
   walk(height,0);flags=bytearray((len(bits)+7)//8)
   for i,v in enumerate(bits):flags[i//8]|=v<<(i%8)
   proof=(header+struct.pack('<I',count)+bytes([len(hashes)])+b''.join(hashes)+bytes([len(flags)])+flags).hex();batch=ids[offset:offset+64];proofs[block+':'+str(offset//64)]=dict(blockHash=block,targetTxids=batch,proofHex=proof,coreVerifiedTxids=list(reversed(batch)))
 selected['targetSetSha256']=B.sha(json.dumps(sorted(allids),separators=(',',':')).encode())
 value=dict(schema='pow-audit30-treasury-final-discovered-history-closure-v1',status='discovered-history-closure-complete-with-closing-fences',newParents=parents,blocks=blocks,membershipProofs=proofs,coverage=dict(requestedParents=2569,acquiredParents=2569,remainingParents=0,targetCount=10232,canonicalTargetProofs=10232,blockGroups=567,batchProofs=644,derivedUnspentCount=1,coreCalls=6134,coreBytes=1234567,electrsCalls=20,electrsBytes=234567,openingPrefixCoreCalls=3,closingReservedCoreCalls=571),seedCorpusSha256='8eeb467bf3468734beee934d884148b7045ed28803045a2b66ac51ca0f1e2596',sourceTargetRawDeltaSha256='e5e2b45bc4156bb1e018809ed047a336fb55183c6934c3836c345a5d1231caaf',sourceParentChunk1Sha256=B.SEED_SHA,requestedParentCount=2569,requestedParentSetSha256=selected['selectedSha256'],unionHistoryTargetCount=10232,unionHistoryTargetSetSha256=selected['targetSetSha256'],closingFencesAccepted=True,captureFailures=[],may9OperatorSettlementPreserved=True,chainBefore=dict(height=969700,hash='f'*64),balanceSnapshot=dict(height=969700,hash='f'*64),feeSummary=dict(targetCount=10232,coinbaseCount=3,nonCoinbaseFeeProofs=1000,feeRowsSha256='a'*64,requiredParentCount=22264,uniquePrevoutCount=32516),**{k:True for k in('parentValuesComplete','targetCanonicalMembershipComplete','knownHistoryFeeAndDirectSpendCoverageAccepted','derivedUnspentCoreChecksComplete','knownHistoryBalanceComparisonAccepted')},**{k:False for k in('productionMutation','financialReconciliationComplete','obligationReconciliationComplete','independentWholeChainAddressHistoryComplete','signingEligibilityVerified','automaticNextChunk','automaticRetry','nextChunkAuthorized','may9TransactionIDsRequested')})
 return value,selected
class FullClosureTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.value,cls.selected=full_result();cls.ledger=Path('/tmp/pow-audit30-item8-ledger-corpus-collector-v2.py').read_bytes()
 def check(self,v):
  with patch.object(B,'read_file',return_value=(self.ledger,None)):return B.validate_delta(v,self.selected)
 def test_real_full_size_raw_header_merkle_population_is_accepted_only_scoped(self):
  self.assertEqual(len(self.value['newParents']),2569);self.assertEqual(len(self.value['membershipProofs']),644);self.assertEqual(len(self.value['blocks']),567);out=self.check(copy.deepcopy(self.value));self.assertTrue(out['knownHistoryFeeAndDirectSpendCoverageAccepted']);self.assertFalse(out['financialReconciliationComplete'])
 def test_changed_raw_parent_semantics_refused(self):
  v=copy.deepcopy(self.value);next(iter(v['newParents'].values()))['outputs'][0]['proofs']+=1
  with self.assertRaisesRegex(ValueError,'Root final parent raw parser'):self.check(v)
 def test_changed_header_or_closing_hash_refused(self):
  for field in('headerHex','canonicalHashAfter'):
   v=copy.deepcopy(self.value);b=next(iter(v['blocks'].values()));b[field]=('00' if field=='headerHex' else '0')*len(b[field])
   with self.assertRaises(ValueError):self.check(v)
 def test_missing_extra_duplicate_core_targets_and_merkle_trailing_bytes_refuse(self):
  for kind in('missing','duplicateCore','extraCore','trailingProof','duplicateTarget'):
   v=copy.deepcopy(self.value);key=next(iter(v['membershipProofs']));p=v['membershipProofs'][key]
   if kind=='missing':v['membershipProofs'].pop(key)
   elif kind=='duplicateCore':p['coreVerifiedTxids'][-1]=p['coreVerifiedTxids'][0]
   elif kind=='extraCore':p['coreVerifiedTxids'].append('f'*64)
   elif kind=='trailingProof':p['proofHex']+='00'
   else:p['targetTxids'][-1]=p['targetTxids'][0]
   with self.subTest(kind=kind),self.assertRaises(ValueError):self.check(v)
 def test_exact_call_arithmetic_closing_and_false_financial_authority(self):
  for kind in('calls','callcap','closing','bytes','booleanCount','scope','source','snapshot'):
   v=copy.deepcopy(self.value)
   if kind=='calls':v['coverage']['coreCalls']-=1
   elif kind=='callcap':v['coverage'].update(derivedUnspentCount=1935,coreCalls=10002)
   elif kind=='closing':v['coverage']['closingReservedCoreCalls']=570
   elif kind=='bytes':v['coverage']['coreBytes']=B.MAX_OUT+1
   elif kind=='booleanCount':v['coverage']['derivedUnspentCount']=True
   elif kind=='scope':v['financialReconciliationComplete']=True
   elif kind=='source':v['sourceParentChunk1Sha256']='0'*64
   else:v['balanceSnapshot']['height']+=1
   with self.subTest(kind=kind),self.assertRaises(ValueError):self.check(v)
 def test_omitted_parent_or_changed_fee_population_refuses(self):
  for kind in('parent','target','prevout'):
   v=copy.deepcopy(self.value)
   if kind=='parent':v['newParents'].pop(next(iter(v['newParents'])))
   elif kind=='target':v['feeSummary']['targetCount']=10231
   else:v['feeSummary']['uniquePrevoutCount']=32515
   with self.subTest(kind=kind),self.assertRaises(ValueError):self.check(v)
if __name__=='__main__':unittest.main()
