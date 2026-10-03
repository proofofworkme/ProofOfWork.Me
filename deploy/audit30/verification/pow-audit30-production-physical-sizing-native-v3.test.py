import base64,copy,datetime,importlib.util,json,os,types,unittest
from pathlib import Path
from unittest.mock import patch
p=Path('/tmp/pow-audit30-production-physical-sizing-native-v3.py');sp=importlib.util.spec_from_file_location('N',p);N=importlib.util.module_from_spec(sp);sp.loader.exec_module(N)
LEAF=Path('/tmp/pow-audit30-production-physical-sizing-leaf-v3.py').read_bytes();MANAGED=Path('/tmp/pow-audit30-oct2-full-read-native-v2.py').read_bytes()
def request():
 m=types.ModuleType('fixture_managed');exec(compile(MANAGED,'/reviewed/managed.py','exec'),m.__dict__)
 live={name:dict(LoadState='loaded',ActiveState='active',SubState='running',MainPID='777',InvocationID='a'*32)for name in m.LIVE}
 files={str(p):{'metadata':dict(m.LOCK_EXPECTED),'sha256':m.FIXED_HASHES.get(str(p),'b'*64)}for p in m.STATIC}
 protection={'files':files,'mask':{'metadata':dict(m.LOCK_EXPECTED),'target':'/dev/null'},'units':{name:{k:''for k in m.PROTECTED_FIELDS_BY_UNIT[name]}for name in m.PROTECTED}}
 return dict(schema='pow-audit30-production-physical-sizing-native-request-v3',identityObservationSha256=N.IDENTITY_OBSERVATION_SHA,approvalSha256=N.APPROVAL,managedSha256=N.MANAGED_SHA,managedBase64=base64.b64encode(MANAGED).decode(),leafSha256=N.LEAF_SHA,leafBase64=base64.b64encode(LEAF).decode(),unit=N.UNIT,directory=str(N.DIRECTORY),expectedLive=live,expectedProtection=protection)
def row(M):
 d={k:''for k in M.FIELDS};d.update(LoadState='loaded',ActiveState='active',SubState='running',MainPID='777',InvocationID='a'*32,Type='exec',Transient='yes',RemainAfterExit='yes',User='postgres',Group='postgres',ControlGroup='/system.slice/'+M.UNIT,Result='success',ExecMainStatus='0',CPUQuotaPerSecUSec='250ms',CPUWeight='10',IOWeight='10',Nice='15',MemoryHigh=str(96*1024**2),MemoryMax=str(128*1024**2),MemorySwapMax='0',TasksMax='16',RuntimeMaxUSec='6min',TimeoutStopUSec='30s',LimitFSIZE=str(32*1024**2))
 for k in('KillMode','Restart','NoNewPrivileges','CapabilityBoundingSet','AmbientCapabilities','ProtectSystem','ProtectHome','PrivateTmp','PrivateDevices','PrivateIPC','PrivateNetwork','RestrictAddressFamilies','ReadOnlyPaths','ReadWritePaths','InaccessiblePaths','StandardInput','UMask'):d[k]=M.PROPS[k]
 d.update(StandardOutput='append',StandardError='append',FragmentPath='/run/systemd/transient/'+M.UNIT);return d
def result():
 L=types.ModuleType('fixture_leaf');exec(compile(LEAF,'/reviewed/leaf.py','exec'),L.__dict__)
 cat={'readOnly':'on','dataDirectory':str(L.PGDATA),'serverVersionNum':'160015','systemIdentifier':'7652445986754609384','timeline':1,'databaseCount':1,'databases':[{'oid':16385,'name':'proof_indexer','bytes':100}],'tablespaceCount':2,'tablespaces':[{'oid':1663,'name':'pg_default','path':'','bytes':100},{'oid':1664,'name':'pg_global','path':'','bytes':100}]}
 data=str(L.PGDATA);wal=data+'/pg_wal';tbl=data+'/pg_tblspc';meta=dict(device=1,inode=1,uid=108,gid=112,mode=0o700,nlink=2,bytes=4096,mtimeNs=1,ctimeNs=1)
 fs={'roots':[data],'walPath':wal,'walDifferentDevice':False,'directoryMetadata':{data:meta,wal:meta|{'inode':2},tbl:meta|{'inode':3}},'tablespaceSymlinks':{},'selectedMounts':[],'mountinfoSha256':'0'*64}
 now=datetime.datetime.now(datetime.timezone.utc).isoformat()
 return dict(schema='pow-audit30-production-physical-sizing-snapshot-v1',status='measured-readonly-snapshot',startedAtUtc=now,atUtc=now,sqlSha256=N.sha(L.SQL.encode()),catalogBefore=cat,catalogAfter=copy.deepcopy(cat),filesystemBefore=fs,filesystemAfter=copy.deepcopy(fs),duSizes={'allocatedBytes':{data:100,wal:20},'apparentBytes':{data:200,wal:30}},physicalRootsTotals={'allocatedBytes':100,'apparentBytes':200},walIncludedInPgdataSameFilesystemTotal=True,walSeparateSampleQualification='Separate snapshots.',activeTreeGrowthQualification='Active tree, not atomic or future capacity.',backendResourceQualification='Client caps do not bind production backends.',pageIntegrityVerified=False,backupCreated=False,slotCreated=False,productionMutation=False)
class Tests(unittest.TestCase):
 def test_observation_authority_required(self):
  v=request();v['identityObservationSha256']='0'*64
  with self.assertRaisesRegex(ValueError,'FIXED_SIZING_REQUEST'):N.decode(N.encoded(v))
 def test_idle_static_monitor_role_split_preserves_static_authority(self):
  v=request();_,M,_=N.decode(N.encoded(v));name='proofofwork-retention-protection.service';v['expectedProtection']['units'][name].update(LoadState='loaded',ActiveState='inactive',SubState='dead',MainPID='0',InvocationID='a'*32,UnitFileState='static');new=dict(v['expectedProtection']['units'][name],InvocationID='b'*32)
  with patch.object(M,'show',return_value=new),patch.object(M,'protection',side_effect=lambda x:x):actual=N.current_protection(M,v['expectedProtection'])
  self.assertEqual(actual['units'][name],new);self.assertEqual(N.static_protection(actual),N.static_protection(v['expectedProtection']));self.assertNotEqual(actual,v['expectedProtection'])
 def test_monitor_active_or_nonstatic_refuses(self):
  v=request();_,M,_=N.decode(N.encoded(v));name='proofofwork-retention-protection.service';v['expectedProtection']['units'][name].update(LoadState='loaded',ActiveState='inactive',SubState='dead',MainPID='0',InvocationID='a'*32,UnitFileState='static');base=v['expectedProtection']['units'][name]
  for change in({'MainPID':'99','ActiveState':'active','SubState':'running'},{'UnitFileState':'enabled'},{'InvocationID':'invalid'}):
   with patch.object(M,'show',return_value=base|change),patch.object(M,'protection')as guard,self.assertRaisesRegex(ValueError,'CURRENT_IDLE'):N.current_protection(M,v['expectedProtection'])
   guard.assert_not_called()
 def test_exact_definition_reuse_and_clean_native_argv(self):
  r,M,leaf=N.decode(N.encoded(request()));self.assertEqual(leaf,LEAF);self.assertEqual(M.UNIT,N.UNIT);self.assertEqual(M.ARGV[:7],['/usr/bin/env','-i','PATH=/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL=C','LANG=C','TZ=UTC','/usr/bin/python3']);self.assertEqual(M.ARGV[7:10],['-I','-B','-c']);self.assertEqual(M.ARGV[-1].encode(),LEAF);self.assertEqual(M.PROPS['ReadWritePaths'],'');self.assertEqual(M.RO,N.RO);self.assertIn('/run/postgresql',M.RO)
 def test_null_fresh_guard_and_extra_schema_refuse(self):
  for key in('expectedLive','expectedProtection'):
   v=request();v[key]=None
   with self.subTest(key=key),self.assertRaises(ValueError):N.decode(N.encoded(v))
  v=request();v['extra']=True
  with self.assertRaises(ValueError):N.decode(N.encoded(v))
 def test_tampered_scope_source_and_authority_refuse(self):
  for k,v in [('approvalSha256','0'*64),('managedSha256','0'*64),('leafSha256','0'*64),('unit','postgresql@16-main.service'),('directory','/etc'),('leafBase64',base64.b64encode(b'other').decode()),('managedBase64',base64.b64encode(b'other').decode())]:
   r=request();r[k]=v
   with self.subTest(key=k),self.assertRaises(ValueError):N.decode(N.encoded(r))
 def test_live_identity_and_protection_open_or_spoofed_authority_refuse(self):
  cases=[];v=request();v['expectedLive'][next(iter(v['expectedLive']))]['MainPID']='0';cases.append(v);v=request();v['expectedProtection']['mask']['metadata']['nlink']=True;cases.append(v);v=request();v['expectedProtection']['files'][next(iter(v['expectedProtection']['files']))]['sha256']='0'*64;cases.append(v);v=request();v['expectedProtection']['files']['/extra']={};cases.append(v)
  for v in cases:
   with self.assertRaises(ValueError):N.decode(N.encoded(v))
 def test_actual_timer_five_fields_admitted_without_fabricated_mainpid(self):
  v=request();actual=json.loads(Path('/tmp/pow-audit30-oct2-prune-timer-actual-response-fixture-v1.json').read_bytes());v['expectedProtection']['units'][actual['unit']]=actual['returnedProperties'];_,M,_=N.decode(N.encoded(v));self.assertEqual(set(M.PROTECTED_FIELDS_BY_UNIT[M.PRUNE]),set(actual['returnedProperties']));self.assertNotIn('MainPID',actual['returnedProperties'])
  for name in('pg_receivewal@16-main.service','proofofwork-retention-protection.service'):self.assertIn('MainPID',M.PROTECTED_FIELDS_BY_UNIT[name])
 def test_timer_service_field_confusion_never_filtered_or_defaulted(self):
  v=request();timer=next(k for k in v['expectedProtection']['units']if k.endswith('.timer'));v['expectedProtection']['units'][timer]['MainPID']='0'
  with self.assertRaisesRegex(ValueError,'PER_UNIT'):N.decode(N.encoded(v))
  for service in('pg_receivewal@16-main.service','proofofwork-retention-protection.service'):
   v=request();del v['expectedProtection']['units'][service]['MainPID']
   with self.subTest(service=service),self.assertRaisesRegex(ValueError,'PER_UNIT'):N.decode(N.encoded(v))
 def test_duplicate_request_keys_refuse(self):
  raw=N.encoded(request());raw=b'{"schema":"bad",'+raw[1:]
  with self.assertRaisesRegex(ValueError,'DUPLICATE'):N.decode(raw)
 def test_selected_unit_resources_and_namespace_are_exact(self):
  _,M,_=N.decode(N.encoded(request()));d=row(M);M.validate_resources(d)
  for k,v in [('ReadOnlyPaths','/data'),('ReadWritePaths','/data'),('PrivateNetwork','no'),('CapabilityBoundingSet','cap_sys_admin'),('MemoryMax','999999999'),('RuntimeMaxUSec','20min')]:
   with self.subTest(key=k),self.assertRaises(ValueError):M.validate_resources(d|{k:v})
 def test_exact_typed_execstart_rejects_env_or_source_change(self):
  _,M,_=N.decode(N.encoded(request()));obj='/org/freedesktop/systemd1/unit/'+''.join(c if c.isascii()and c.isalnum()else'_'+format(ord(c),'02x')for c in M.UNIT);mgr={'type':'o','data':[obj]};cmd={'type':'a(sasbttttuii)','data':[[M.ARGV[0],M.ARGV,False,0,0,0,0,0,0,0]]}
  with patch.object(M,'command',side_effect=[M.encoded(mgr),M.encoded(cmd)]):M.typed()
  cmd['data'][0][1]=M.ARGV[:-1]+['other']
  with patch.object(M,'command',side_effect=[M.encoded(mgr),M.encoded(cmd)]),self.assertRaises(ValueError):M.typed()
 def test_wrong_owned_invocation_cleanup_never_stops(self):
  _,M,_=N.decode(N.encoded(request()));M.OWNED='a'*32
  with patch.object(M,'show',return_value=row(M)|{'InvocationID':'b'*32}),patch.object(M,'command')as cmd,self.assertRaises(ValueError):M.owned_stop()
  cmd.assert_not_called()
 def test_preexisting_unit_refuses_before_evidence_or_launch(self):
  raw=N.encoded(request());_,M,_=N.decode(raw)
  with patch.object(N,'decode',return_value=(request(),M,LEAF)),patch.object(N.os,'geteuid',return_value=0),patch.object(N.os,'getegid',return_value=0),patch.object(N.os,'uname',return_value=types.SimpleNamespace(nodename='pow-bitcoin-01')),patch.object(N.sys,'argv',['source',N.sha(raw)]),patch.object(N.sys,'stdin',types.SimpleNamespace(buffer=types.SimpleNamespace(read=lambda _:raw))),patch.object(M,'show',return_value=row(M)),patch.object(M,'command')as cmd,patch.object(N.Path,'mkdir')as mkdir,self.assertRaisesRegex(ValueError,'Preexisting'):N.main()
  cmd.assert_not_called();mkdir.assert_not_called()
 def test_valid_result_never_subtracts_separate_wal_or_claims_certificate(self):
  v=result();N.validate_result(v,LEAF);wal=v['filesystemBefore']['walPath']
  for f in('filesystemBefore','filesystemAfter'):v[f]['walDifferentDevice']=True
  v['walIncludedInPgdataSameFilesystemTotal']=False;v['physicalRootsTotals']['allocatedBytes']+=v['duSizes']['allocatedBytes'][wal];v['physicalRootsTotals']['apparentBytes']+=v['duSizes']['apparentBytes'][wal];N.validate_result(v,LEAF)
 def test_topology_membership_totals_stale_and_certificate_spoofs_refuse(self):
  for key in('total','mutation','integrity','topology','missing','age','boolean'):
   v=result()
   if key=='total':v['physicalRootsTotals']['allocatedBytes']-=20
   elif key=='mutation':v['productionMutation']=True
   elif key=='integrity':v['pageIntegrityVerified']=True
   elif key=='topology':v['catalogAfter']['databases'][0]['name']='changed'
   elif key=='missing':del v['duSizes']['allocatedBytes'][v['filesystemBefore']['walPath']]
   elif key=='age':v['atUtc']=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=421)).isoformat()
   else:v['physicalRootsTotals']['allocatedBytes']=True
   with self.subTest(key=key),self.assertRaises(ValueError):N.validate_result(v,LEAF)
 def test_root_tool_fullbyte_metadata_hash_drift_and_mode_refuse(self):
  _,M,_=N.decode(N.encoded(request()));meta=dict(M.LOCK_EXPECTED,mode=0o755)
  with patch.object(M,'read_file',return_value=(b'fixed',meta))as read:before=N.tool_fence(M);self.assertEqual(N.tool_fence(M,before),before)
  self.assertEqual(set(before),{'/usr/lib/postgresql/16/bin/psql','/usr/bin/du'});self.assertEqual(read.call_count,4)
  for data,m in((b'changed',meta),(b'fixed',meta|{'ino':42}),(b'fixed',meta|{'mode':0o777})):
   with patch.object(M,'read_file',return_value=(data,m)),self.assertRaises(ValueError):N.tool_fence(M,before)
if __name__=='__main__':unittest.main()
