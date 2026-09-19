#!/usr/bin/env python3
"""Exercise archive-path and concatenated-gzip handling without any database."""
import runpy,tarfile,io,tempfile,pathlib,gzip
m=runpy.run_path('deploy/audit17/restore-physical.py');m['extract'].__globals__['FLOOR']=0
for name in ('../escape','/escape','a/../../escape'):
 try:m['checked_path'](name)
 except ValueError:pass
 else:raise AssertionError(name)
with tempfile.TemporaryDirectory() as root:
 p=pathlib.Path(root);d=p/'dest';d.mkdir();buf=io.BytesIO()
 with tarfile.open(fileobj=buf,mode='w') as t:
  a=tarfile.TarInfo('base/ok');a.size=2;t.addfile(a,io.BytesIO(b'ok'))
 (p/'multi.gz').write_bytes(gzip.compress(b'')+gzip.compress(buf.getvalue()))
 m['extract'](p/'multi.gz',d);assert (d/'base/ok').read_bytes()==b'ok'
 for kind in (tarfile.SYMTYPE,tarfile.LNKTYPE,tarfile.FIFOTYPE):
  with tarfile.open(p/'unsafe.gz','w:gz') as t:
   a=tarfile.TarInfo('link');a.type=kind;a.linkname='/etc';t.addfile(a)
  try:m['extract'](p/'unsafe.gz',d)
  except ValueError:pass
  else:raise AssertionError('accepted special member')
print('Archive traversal, special-member and concatenated-gzip recovery checks passed')
