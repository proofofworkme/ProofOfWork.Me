#!/usr/bin/python3 -I
"""Install additive read-only storage forecasting, preserving exact evidence."""
import datetime,hashlib,json,os,pathlib,subprocess,sys
assert sys.flags.isolated and os.geteuid()==0 and sys.argv[1:] in (['ui'],['node'])
os.umask(0o077)
role=sys.argv[1]
source=pathlib.Path('/var/tmp/proofofwork-deploy/audit17-storage-trend')
expected={'proofofwork-storage-trend.py': '5fab2ce50c495219057a125b98a011487f6ac3cb142baffc052dc906cfd100cb', 'proofofwork-storage-trend@.service': '9a51d87a4eeb48f208446a292870a8fd5260b8d3ad4ba5448bf3e31a3a3f2889', 'proofofwork-storage-trend@.timer': '9c34cd6fc5db46059a30b43b1c6b11620c46d531f64c45c8b6f3638060838db4'}
root=pathlib.Path('/var/backups/proofofwork-ui/recovery-evidence' if role=='ui' else '/data')
out=root/('proofofwork-audit17-storage-trend-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
files={name:pathlib.Path('/usr/local/sbin/proofofwork-storage-trend' if name.endswith('.py') else '/etc/systemd/system/'+name) for name in expected}
for name,target in files.items():
 assert not target.exists() and not target.is_symlink(), 'Existing monitor requires separate baseline review'
 assert hashlib.sha256((source/name).read_bytes()).hexdigest()==expected[name]
subprocess.run(['systemd-analyze','verify',str(source/'proofofwork-storage-trend@.service'),str(source/'proofofwork-storage-trend@.timer')],check=True)
out.mkdir(mode=0o700)
for name,target in files.items():
 data=(source/name).read_bytes()
 with (out/name).open('xb') as f:f.write(data)
 with target.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
 target.chmod(0o755 if name.endswith('.py') else 0o644)
 assert hashlib.sha256(target.read_bytes()).hexdigest()==expected[name]
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','proofofwork-storage-trend@'+role+'.timer'],check=True)
subprocess.run(['systemctl','start','--no-block','proofofwork-storage-trend@'+role+'.service'],check=True)
receipt={'role':role,'files':expected,'evidence':str(out),'priorFiles':'absent','verification':'service results pending; never implies healthy storage'}
with (out/'installation.json').open('x') as f:json.dump(receipt,f,indent=2);f.write('\n')
print(json.dumps(receipt))
