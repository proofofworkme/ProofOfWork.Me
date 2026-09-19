#!/usr/bin/python3 -I
"""Receive exact locally built archives into fresh paths; never publish a site."""
import sys,os,pathlib,tarfile,hashlib,json,posixpath
assert sys.flags.isolated and os.geteuid()==0 and len(sys.argv)==2
kind=sys.argv[1];assert kind in ('surfaces','source')
release='6eb4a1e07131-20260919T161919Z'
expected={'surfaces':'96967fc6b246a1466bfc2a1711c7db81ef7dccd7d20bb3a75245d5a04e85d830','source':'8a5059a98737ac278fac59fdff5a7681886dad8aa9401bafcaf9d81a0f233ca4'}
root=pathlib.Path('/var/tmp/proofofwork-deploy');name='proofofwork-ui-'+kind+'-'+release
archive=root/(name+'.tgz');destination=root/name
assert root.resolve()==root and not destination.exists() and not destination.is_symlink()
assert archive.is_file() and not archive.is_symlink() and archive.stat().st_uid==0 and archive.stat().st_nlink==1
before=archive.stat();digest=hashlib.file_digest(archive.open('rb'),'sha256').hexdigest();assert digest==expected[kind]
if kind=='source':assert (root/('proofofwork-www-stage-'+release)).is_dir() and pathlib.Path('/var/backups/proofofwork-ui/releases/proofofwork-ui-release-'+release+'.tgz').is_file()
with tarfile.open(archive,'r:gz') as tar:
 members=tar.getmembers();total=0;seen=set()
 for member in members:
  p=pathlib.PurePosixPath(member.name)
  assert not p.is_absolute() and '..' not in p.parts and p.parts[0]==name and str(p) not in seen
  seen.add(str(p));assert member.isdir() or member.isfile() or (kind=='source' and member.issym())
  if member.issym():
   target=pathlib.PurePosixPath(posixpath.normpath(str(p.parent/member.linkname)))
   assert not pathlib.PurePosixPath(member.linkname).is_absolute() and target.parts[0]==name and '..' not in target.parts
  assert 0<=member.size<=512*1024**2
  total+=member.size+8192
 assert total<=512*1024**2
 free=os.statvfs(root).f_bavail*os.statvfs(root).f_frsize
 assert free>=10737418240+67108864+total
 os.umask(0o077);tar.extractall(root,filter='data')
 # data_filter intentionally omits directory modes; restore the exact reviewed
 # surface modes, or Caddy cannot traverse directories created under umask 077.
 if kind=='surfaces':
  for member in members:
   path=root/member.name
   assert member.mode & 0o7777 == (0o755 if member.isdir() else 0o644)
   path.chmod(member.mode & 0o777)
after=archive.stat();assert (before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_ino,after.st_size,after.st_mtime_ns)
receipt={'kind':kind,'release':release,'sha256':digest,'sourceBytes':before.st_size,'entries':len(members),'conservativeExtractBytes':total,'freeBefore':free,'destination':str(destination)}
with (root/('audit17-boost-receive-'+kind+'.json')).open('x') as f:json.dump(receipt,f,indent=2);f.write('\n')
print(json.dumps(receipt))
