#!/usr/bin/python3 -I
import importlib.util,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
s=importlib.util.spec_from_file_location('S','/tmp/pow-audit30-fresh-resource-sampler-v1.py');S=importlib.util.module_from_spec(s);s.loader.exec_module(S)
class Tests(unittest.TestCase):
 def test_guest_not_counted_twice(self):
  a=S.cpu('cpu 10 20 30 40 50 60 70 80 5 2\n');b=S.cpu('cpu 20 30 40 50 60 70 80 90 10 4\n');d=S.delta(a,b)
  self.assertEqual(d['totalJiffiesExcludingDuplicateGuest'],80);self.assertEqual(d['busyPercentExcludingIdleAndIOWait'],75);self.assertEqual(d['iowaitPercent'],12.5);self.assertEqual(d['jiffies']['guest'],5)
 def test_nonmonotonic_and_zero_yield_no_percentage(self):
  a=S.cpu('cpu 1 1 1 1 1 1 1 1\n')
  for b in (a,a|{'user':0}):
   d=S.delta(a,b);self.assertFalse(d['validPercentageSample']);self.assertIsNone(d['busyPercentExcludingIdleAndIOWait'])
 def test_online_ranges_exact(self):
  self.assertEqual(S.online('0-3,6,8-9\n')['logicalCpuCount'],7)
  for b in ('0-2,2','2-1','1--3','','0,','65536','0 1'):
   with self.subTest(b=b),self.assertRaises(ValueError):S.online(b)
 def memory(self,extra=''):
  values={k:10 for k in S.MEM_FIELDS};values.update(MemTotal=100,MemFree=20,MemAvailable=50,SwapTotal=0,SwapFree=0)
  return '\n'.join(k+': '+str(v)+' kB'for k,v in values.items())+extra
 def test_current_memory_unit_available_and_no_swap(self):
  d=S.mem(self.memory());self.assertEqual(d['bytes']['MemTotal'],102400);self.assertEqual(d['usedRamAgainstAvailableBytes'],51200);self.assertEqual(d['availableRamPercent'],50);self.assertEqual(d['swapUsedBytes'],0);self.assertIsNone(d['swapAvailablePercent'])
 def test_memory_duplicate_missing_units_and_bounds_refuse(self):
  for t in (self.memory('\nMemTotal: 100 kB'),self.memory().replace('MemTotal: 100 kB','MemTotal: 100 B'),self.memory().replace('MemAvailable: 50 kB','MemAvailable: 101 kB'),self.memory().replace('MemTotal: 100 kB','')):
   with self.assertRaises(ValueError):S.mem(t)
 def test_pressure_fields_and_bounds(self):
  good='some avg10=0.00 avg60=1.23 avg300=2.00 total=123\nfull avg10=0.00 avg60=0.01 avg300=0.00 total=7\n'
  self.assertEqual(S.pressure(good)['some']['total'],'123')
  for t in (good+'some avg10=0 avg60=0 avg300=0 total=0',good.replace('avg10=0.00','avg10=101.00',1),good.replace('total=123','total=bad'),good.replace('avg300=2.00','avg300=2.00 avg10=0')):
   with self.assertRaises(ValueError):S.pressure(t)
 def test_cpu_shape_malformed_refuses(self):
  for t in ('cpu0 1 2 3 4 5 6 7 8','cpu 1 2 3','cpu -1 2 3 4 5 6 7 8','cpu 1 2 x 4 5 6 7 8'):
   with self.assertRaises(ValueError):S.cpu(t)
 def test_capacity_units_reserved_and_inode_values(self):
  with tempfile.TemporaryDirectory()as t:
   v=types.SimpleNamespace(f_frsize=4096,f_bavail=3,f_bfree=5,f_blocks=10,f_files=100,f_ffree=90,f_favail=89)
   with patch.object(S.os,'statvfs',return_value=v):d=S.capacity(t)
   self.assertEqual(d['availableBytes'],12288);self.assertEqual(d['reservedFreeBytes'],8192);self.assertEqual(d['allocatedBytes'],20480);self.assertEqual(d['inodesAvailable'],89)
   v.f_bavail=6
   with patch.object(S.os,'statvfs',return_value=v),self.assertRaises(ValueError):S.capacity(t)
 def test_capacity_symlink_refuses(self):
  with tempfile.TemporaryDirectory()as t:
   p=Path(t)/'link';p.symlink_to(t)
   with self.assertRaises(ValueError):S.capacity(str(p))
 def test_fixed_role_and_readonly_source_scope(self):
  with patch.object(S.sys,'argv',['sampler','other']),self.assertRaises(ValueError):S.main()
  text=Path(S.__file__).read_text();self.assertNotIn('subprocess',text);self.assertNotIn('systemctl',text);self.assertNotIn('environ',text.replace('environment',''))
 def test_read_bounded(self):
  with tempfile.NamedTemporaryFile()as f:
   f.write(b'a'*5);f.flush()
   with self.assertRaises(ValueError):S.read(f.name,4)
if __name__=='__main__':unittest.main()
