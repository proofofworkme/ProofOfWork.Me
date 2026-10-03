#!/usr/bin/python3 -I
"""Real frozen-storage predicates offline; no native/root/SQL/slot acceptance."""
import ast,hashlib,json,types,unittest
from pathlib import Path
from unittest.mock import patch
OLD=Path('/home/sixer/ProofOfWork.Me/deploy/audit30/recovery/recovery-controller-v2.py')
NEW=Path('/tmp/pow-audit30-recovery-controller-capacity-v3.py')
OLD_RAW=OLD.read_bytes();NEW_RAW=NEW.read_bytes()
assert hashlib.sha256(OLD_RAW).hexdigest()=='b16ee1a596e0b33ef921dad7f8778019e906c7b1261d3d251089a21e1670acf2'
assert hashlib.sha256(NEW_RAW).hexdigest()=='40a44c52f13f90a764287c689d5d175d8b5fd895131a624f74cd06dfcd3f9e80'
def module(path,raw):
 m=types.ModuleType('capacity_'+path.stem);m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__);return m
C=module(NEW,NEW_RAW);O=module(OLD,OLD_RAW);GIB=1024**3
class Capacity(unittest.TestCase):
 def sample(self,c=C,available=293*GIB,root=10*GIB,base=0,wal=0,total=0,admission=True,require_receiver=False):
  fs=lambda p:types.SimpleNamespace(f_bavail=available if p=='/data' else root,f_frsize=1)
  with patch.object(c,'roots_fence')as roots,patch.object(c,'authority_fence')as authority,patch.object(c,'bounded_allocation',side_effect=[base,wal,total])as allocation,patch.object(c.os,'statvfs',side_effect=fs),patch.object(c,'cluster_fence',return_value={})as cluster,patch.object(c,'wal_inventory',return_value=[])as archive,patch.object(c,'closed_coverage',return_value={'closed':True})as coverage:
   value=c.storage({},admission=admission,require_receiver=require_receiver)
   roots.assert_called_once_with({});authority.assert_called_once_with({})
   self.assertEqual(allocation.call_args_list[0].args,(c.ROOT/'bases',));self.assertEqual(allocation.call_args_list[1].args,(c.ROOT/'wal',));self.assertEqual(allocation.call_args_list[2].args,(c.ROOT,))
   cluster.assert_called_once_with({},require_receiver);archive.assert_called_once_with({})
   self.assertEqual(coverage.call_count,int(require_receiver));return value
 def test_exact_two_edit_reversal_preserves_original(self):
  restored=NEW_RAW.replace(b'BASE_MAX = 80*GIB\nPRIVATE_RECOVERY_MAX = 80*GIB\n',b'BASE_MAX = 80*GIB\n').replace(b'available<DATA_MIN+(BASE_MAX+PRIVATE_RECOVERY_MAX+WAL_MAX+GIB if admission else 0)',b'available<DATA_MIN+(BASE_MAX+WAL_MAX if admission else 0)')
  self.assertEqual(restored,OLD_RAW)
 def test_all_other_functions_ast_identical(self):
  def functions(raw):return {n.name:ast.dump(n,include_attributes=False)for n in ast.parse(raw).body if isinstance(n,(ast.FunctionDef,ast.ClassDef))}
  old=functions(OLD_RAW);new=functions(NEW_RAW);self.assertEqual(set(old),set(new));self.assertEqual({k:v for k,v in old.items()if k!='storage'},{k:v for k,v in new.items()if k!='storage'})
 def test_actual242_snapshot_refuses_and_old212_guard_passed(self):
  p=Path('/tmp/pow-audit30-oct3-restore-capacity-running-observation-v2.json');raw=p.read_bytes()
  self.assertEqual(hashlib.sha256(raw).hexdigest(),'f4c8da6e852661d3fe875e398071a15d22288f7144a3bd2b0b3a023531c93000')
  available=next(x['availableBytes']for x in json.loads(raw)['filesystems']if x['target']=='/data');self.assertEqual(available,259876732928)
  self.sample(c=O,available=available)
  with self.assertRaisesRegex(ValueError,'Monitored recovery allocation/reserve exceeded'):self.sample(available=available)
 def test_prior249_snapshot_also_refuses(self):
  with self.assertRaises(ValueError):self.sample(available=268355457024)
 def test_admission293_exact_boundary(self):
  self.assertEqual(self.sample()['dataAvailableBytes'],293*GIB)
  with self.assertRaises(ValueError):self.sample(available=293*GIB-1)
  self.sample(available=293*GIB+1)
 def test_former212_admission_threshold_no_longer_sufficient(self):
  self.sample(c=O,available=212*GIB)
  with self.assertRaises(ValueError):self.sample(available=212*GIB)
 def test_failed_admission_occurs_before_cluster_sql(self):
  with patch.object(C,'roots_fence')as roots,patch.object(C,'authority_fence')as authority,patch.object(C,'bounded_allocation',return_value=0),patch.object(C.os,'statvfs',return_value=types.SimpleNamespace(f_bavail=212*GIB,f_frsize=1)),patch.object(C,'cluster_fence')as cluster,patch.object(C,'wal_inventory')as archive,self.assertRaises(ValueError):C.storage({},admission=True)
  roots.assert_called_once();authority.assert_called_once();cluster.assert_not_called();archive.assert_not_called()
 def test_runtime100_boundary_is_unchanged(self):
  for c in(C,O):
   self.sample(c=c,available=100*GIB,admission=False)
   with self.assertRaises(ValueError):self.sample(c=c,available=100*GIB-1,admission=False)
 def test_root10_boundary_is_unchanged(self):
  self.sample(root=10*GIB)
  with self.assertRaises(ValueError):self.sample(root=10*GIB-1)
 def test_base80_cap_is_unchanged(self):
  self.sample(base=80*GIB,total=80*GIB)
  with self.assertRaises(ValueError):self.sample(base=80*GIB+1,total=80*GIB+1)
 def test_wal32_cap_is_unchanged(self):
  self.sample(wal=32*GIB,total=32*GIB)
  with self.assertRaises(ValueError):self.sample(wal=32*GIB+1,total=32*GIB+1)
 def test_aggregate113_evidence_cap_is_unchanged(self):
  self.sample(base=80*GIB,wal=32*GIB,total=113*GIB)
  with self.assertRaises(ValueError):self.sample(base=80*GIB,wal=32*GIB,total=113*GIB+1)
 def test_receiver_continuity_call_contract_is_unchanged(self):
  self.assertEqual(self.sample(require_receiver=True)['closedWalContinuity'],{'closed':True})
 def test_cap_constants_are_not_reduced_or_native_private_limit_claimed(self):
  self.assertEqual((C.BASE_MAX,C.PRIVATE_RECOVERY_MAX,C.WAL_MAX,C.DATA_MIN,C.ROOT_MIN),(80*GIB,80*GIB,32*GIB,100*GIB,10*GIB))
  self.assertEqual(C.DATA_MIN+C.BASE_MAX+C.PRIVATE_RECOVERY_MAX+C.WAL_MAX+C.GIB,293*GIB)
if __name__=='__main__':unittest.main()
