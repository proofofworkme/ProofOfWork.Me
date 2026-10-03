#!/usr/bin/python3 -I
"""Offline capacity predicates only; native root/slot/SQL fences are not exercised."""
import hashlib,json,types,unittest
from pathlib import Path
from unittest.mock import patch
SOURCE=Path('/home/sixer/ProofOfWork.Me/deploy/audit30/recovery/recovery-controller-v2.py')
RAW=SOURCE.read_bytes()
assert hashlib.sha256(RAW).hexdigest()=='b16ee1a596e0b33ef921dad7f8778019e906c7b1261d3d251089a21e1670acf2'
C=types.ModuleType('frozen_recovery_capacity');C.__file__=str(SOURCE)
exec(compile(RAW,str(SOURCE),'exec'),C.__dict__)
GIB=1024**3;AVAILABLE=268355457024;ROOT_AVAILABLE=67003904000
class Capacity(unittest.TestCase):
 def sample(self,available=AVAILABLE,root=ROOT_AVAILABLE,base=0,wal=0,total=0,admission=False):
  fs=lambda p:types.SimpleNamespace(f_bavail=available if p=='/data' else root,f_frsize=1)
  with patch.object(C,'roots_fence'),patch.object(C,'authority_fence'),patch.object(C,'bounded_allocation',side_effect=[base,wal,total]),patch.object(C.os,'statvfs',side_effect=fs),patch.object(C,'cluster_fence',return_value={}),patch.object(C,'wal_inventory',return_value=[]):
   return C.storage({},admission=admission)
 def test_current_initial_guard_is_not_whole_workflow_admission(self):
  self.assertEqual(self.sample(admission=True)['dataAvailableBytes'],AVAILABLE)
  self.assertGreater(293*GIB,AVAILABLE)
  self.assertEqual(293*GIB-AVAILABLE,46250897408)
 def test_actual_initial_guard_exact_boundary(self):
  self.sample(available=212*GIB,admission=True)
  with self.assertRaisesRegex(ValueError,'Monitored recovery allocation/reserve exceeded'):self.sample(available=212*GIB-1,admission=True)
 def test_runtime_data_reserve_boundary(self):
  self.sample(available=100*GIB)
  with self.assertRaises(ValueError):self.sample(available=100*GIB-1)
 def test_runtime_root_reserve_boundary(self):
  self.sample(root=10*GIB)
  with self.assertRaises(ValueError):self.sample(root=10*GIB-1)
 def test_base_ceiling_strict_overflow(self):
  self.sample(base=80*GIB,total=80*GIB)
  with self.assertRaises(ValueError):self.sample(base=80*GIB+1,total=80*GIB+1)
 def test_wal_ceiling_strict_overflow(self):
  self.sample(wal=32*GIB,total=32*GIB)
  with self.assertRaises(ValueError):self.sample(wal=32*GIB+1,total=32*GIB+1)
 def test_evidence_is_in_aggregate113_ceiling_not_initial_reservation(self):
  self.sample(base=80*GIB,wal=32*GIB,total=113*GIB)
  with self.assertRaises(ValueError):self.sample(base=80*GIB,wal=32*GIB,total=113*GIB+1)
  self.assertEqual(C.DATA_MIN+C.BASE_MAX+C.WAL_MAX,212*GIB)
 def test_peak_remaining_is_below_required_reserve(self):
  remaining=AVAILABLE-193*GIB
  self.assertEqual(remaining,61123284992)
  self.assertLess(remaining,C.DATA_MIN)
  with self.assertRaises(ValueError):self.sample(available=remaining)
 def test_measured_roots_sum_without_wal_double_count(self):
  p=Path('/tmp/pow-audit30-production-physical-sizing-native-104000-v3.stdout');raw=p.read_bytes()
  self.assertEqual(len(raw),12721)
  self.assertEqual(hashlib.sha256(raw).hexdigest(),'8ff3cf502b4ebeb3722d6b859396f985883397fb47514f9b3acd7f962bcaf132')
  v=json.loads(raw);s=v['result']['snapshot'];self.assertTrue(s['walIncludedInPgdataSameFilesystemTotal'])
  d=s['duSizes']['allocatedBytes'];self.assertEqual(d['/var/lib/postgresql/16/main']+d['/data/proofofwork-postgres-tablespaces/proof_indexer_large_state_v1'],s['physicalRootsTotals']['allocatedBytes'])
  self.assertEqual(s['physicalRootsTotals']['allocatedBytes'],40149663744)
  self.assertEqual(d['/var/lib/postgresql/16/main/pg_wal'],83963904)
  self.assertFalse(s['pageIntegrityVerified']);self.assertFalse(s['backupCreated'])
 def test_planning_bound_has_no_small_cap_admission(self):
  combined=AVAILABLE-(32+1+100)*GIB
  self.assertEqual(combined,125547794432)
  self.assertEqual(combined//2,62773897216)
  self.assertEqual((C.BASE_MAX,C.WAL_MAX,C.DATA_MIN,C.ROOT_MIN),(80*GIB,32*GIB,100*GIB,10*GIB))
if __name__=='__main__':unittest.main()
