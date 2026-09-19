#!/usr/bin/python3 -I
"""Remove only two documented duplicate transport files after verified publication."""
import fcntl,hashlib,json,os,pathlib,sys
assert sys.flags.isolated and os.geteuid()==0 and len(sys.argv)==1
os.umask(0o077)
release='6eb4a1e07131-20260919T161919Z'
root=pathlib.Path('/var/tmp/proofofwork-deploy')
expected={'proofofwork-ui-source-'+release+'.tgz':'8a5059a98737ac278fac59fdff5a7681886dad8aa9401bafcaf9d81a0f233ca4','proofofwork-ui-surfaces-'+release+'.tgz':'96967fc6b246a1466bfc2a1711c7db81ef7dccd7d20bb3a75245d5a04e85d830'}
with open('/run/proofofwork-ui/deploy.lock','rb') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 marker=pathlib.Path('/var/www/.proofofwork-ui-release').read_text()
 assert 'commit=6eb4a1e07131fc0b27d381dda52986f9d1bf3398\n' in marker
 archive=pathlib.Path('/var/backups/proofofwork-ui/releases/proofofwork-ui-release-'+release+'.tgz')
 assert hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()=='641d7ea865ec15f11523ed8265c407f77a1117e9e6afdc4b1b3bb694cd1a130a'
 copies=json.loads((root/'audit17-node-transport-copies.json').read_text())
 assert {pathlib.Path(x['path']).name:x['sha256'] for x in copies}==expected
 assert all(x['path'].startswith('/data/proofofwork-audit17-ui-upload-copies-6eb4a1e/') for x in copies)
 paths=[root/name for name in expected];identities={}
 for p in paths:
  st=p.lstat();assert p.is_file() and not p.is_symlink() and p.resolve()==p and st.st_uid==0 and st.st_nlink==1
  assert hashlib.file_digest(p.open('rb'),'sha256').hexdigest()==expected[p.name]
  assert next(x['bytes'] for x in copies if pathlib.Path(x['path']).name==p.name)==st.st_size
  identities[str(p)]=(st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns)
 # Reject a live open descriptor or process command referencing either exact file.
 for proc in pathlib.Path('/proc').iterdir():
  if not proc.name.isdigit():continue
  try:
   cmd=(proc/'cmdline').read_bytes()
   assert not any(str(p).encode() in cmd for p in paths),'Live command reference'
   for fd in (proc/'fd').iterdir():
    try:target=os.readlink(fd)
    except FileNotFoundError:continue
    assert target not in identities,'Live file descriptor reference'
  except (FileNotFoundError,ProcessLookupError):continue
 for conf in (pathlib.Path('/etc/systemd/system'),pathlib.Path('/etc/caddy')):
  if not conf.exists():continue
  for p in conf.rglob('*'):
   if p.is_file() and not p.is_symlink():
    body=p.read_bytes()
    assert not any(str(candidate).encode() in body for candidate in paths),'Configuration reference'
 for line in pathlib.Path('/proc/self/mountinfo').read_text().splitlines():
  assert line.split()[4] not in identities,'Mounted transport file'
 out=pathlib.Path('/var/backups/proofofwork-ui/recovery-evidence/audit17-transport-cleanup-6eb4a1e');out.mkdir(mode=0o700)
 before={'files':identities,'sha256':expected,'independentNodeCopies':copies,'freeBytes':os.statvfs('/').f_bavail*os.statvfs('/').f_frsize}
 with (out/'before.json').open('x') as f:json.dump(before,f,indent=2);f.flush();os.fsync(f.fileno())
 for p in paths:
  st=p.lstat();assert (st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns)==identities[str(p)]
  p.unlink()
 after={'removed':list(identities),'freeBytes':os.statvfs('/').f_bavail*os.statvfs('/').f_frsize,'evidence':str(out),'protected':'All release archives, source checkouts, rollback roots, logs and recovery evidence retained'}
 with (out/'after.json').open('x') as f:json.dump(after,f,indent=2);f.write('\n')
 print(json.dumps(after))
