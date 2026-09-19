#!/usr/bin/python3 -I
"""Expose deployment scratch read-only inside the monitor's private tmp mount."""
import hashlib,json,os,pathlib,subprocess,sys
assert sys.flags.isolated and os.geteuid()==0 and sys.argv[1:] in (['ui'],['node'])
os.umask(0o077)
role=sys.argv[1];target=pathlib.Path('/etc/systemd/system/proofofwork-storage-trend@.service')
before=target.read_bytes();assert hashlib.sha256(before).hexdigest()=='9a51d87a4eeb48f208446a292870a8fd5260b8d3ad4ba5448bf3e31a3a3f2889'
after=before.replace(b'PrivateTmp=true\n',b'PrivateTmp=true\nBindReadOnlyPaths=-/var/tmp/proofofwork-deploy\n')
assert hashlib.sha256(after).hexdigest()=='eb12995d9f322860035b672dce4c19ec8623c1ac7d0b4ea4ec7a625c51f7f157'
root=pathlib.Path('/var/backups/proofofwork-ui/recovery-evidence' if role=='ui' else '/data')
out=root/'proofofwork-audit17-storage-trend-mount-20260919';out.mkdir(mode=0o700)
(out/'before.service').write_bytes(before);(out/'after.service').write_bytes(after)
tmp=target.with_suffix('.service.audit17-new')
with tmp.open('xb') as f:f.write(after);f.flush();os.fsync(f.fileno())
tmp.chmod(0o644);os.replace(tmp,target)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','start','--no-block','proofofwork-storage-trend@'+role+'.service'],check=True)
print(json.dumps({'role':role,'evidence':str(out),'sha256':hashlib.sha256(after).hexdigest()}))
