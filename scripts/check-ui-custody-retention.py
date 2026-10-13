import importlib.util,sys,tempfile,os,io,json
from pathlib import Path
os.umask(0o077)
r=Path(__file__).resolve().parents[1]
def load(n,p):
 s=importlib.util.spec_from_file_location(n,r/p);m=importlib.util.module_from_spec(s);sys.modules[n]=m;s.loader.exec_module(m);return m
E=load('custodyE','deploy/ui-retention/inventory.py');W=load('custodyW','deploy/ui-retention/removal.py')
with tempfile.TemporaryDirectory() as t:
 root=Path(t);p=root/'source';p.mkdir();(p/'a').write_bytes(b'unique');(p/'link').symlink_to('a')
 try:E.inventory(p,os.geteuid());raise AssertionError('strict allowed missing manifest/link')
 except ValueError:pass
 # First read stabilizes atime for intentionally exercised symlink.
 os.readlink(p/'link')
 inv=E.inventory(p,os.geteuid(),require_manifest=False,allow_symlinks=True);expected=dict(inv['fingerprint'],inventory=inv['records'])
 archive=root/'custody.tgz'
 with archive.open('wb') as out:E.archive_root(p,expected,out,os.geteuid(),require_manifest=False,allow_symlinks=True)
 got=E.extract_verify(archive,expected,root/'restored');assert got['modeTimesXattrsRestored']; E.verify_restored(root/'restored',expected)
 fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY);actions=[]
 try:W.delete_tree(fd,p.name,expected,lambda stage,row:actions.append([stage,row]))
 finally:os.close(fd)
 assert not p.exists() and (root/'restored/a').read_bytes()==b'unique'
 p.mkdir();(p/'escape').symlink_to('/etc/passwd')
 try:E.inventory(p,os.geteuid(),require_manifest=False,allow_symlinks=True);raise AssertionError('escape accepted')
 except ValueError:pass
 print('Generic custody restore, deletion, strict default and escaping-link refusal passed')

# Exercise the new modules with the established byte/metadata, adversarial
# archive, ancestor replacement and dependency-reference fixtures as well.
import unittest
suite_module=load('retention_safety_fixtures','deploy/pages/check-ui-storage.test.py')
suite_module.export=E
suite_module.load=lambda name,filename: W if filename=='ui-storage.py' else E
suite=unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(getattr(suite_module,name))
                         for name in ('ArchiveTests','DeleteTests','ReferenceTests','LoadedUnitTests'))
result=unittest.TextTestRunner(verbosity=1).run(suite)
if not result.wasSuccessful():raise SystemExit(1)
