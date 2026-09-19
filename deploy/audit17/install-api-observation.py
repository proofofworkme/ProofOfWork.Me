#!/usr/bin/python3 -I
"""Install the reviewed additive journal-only API monitor after release verification."""
import hashlib,json,os,pathlib,subprocess,sys
assert sys.flags.isolated and os.geteuid()==0 and len(sys.argv)==1
os.umask(0o077)
root=pathlib.Path('/opt/proofofwork-api')
commit=subprocess.check_output(['git','-c','safe.directory='+str(root),'-C',str(root),'rev-parse','HEAD'],text=True).strip()
assert commit=='005a4e582f5887c51865fbedc757d4597be9df4b'
expected={'proofofwork-api-observation-health.py': '50c254471eaa68f9986606eacc155bfe8fbd31dae4c54c5e1c630e11a060ff06', 'proofofwork-api-observation-health.service': 'fb90290b5a685f4112fed615bc4927fe299bed294e038f68586a18af3919ae5e', 'proofofwork-api-observation-health.timer': '0f4c8411f4f2a739a80f84c6dacb68b24e5364afc0196c96d14dcfd2dbafab2e'}
files={name:pathlib.Path('/usr/local/sbin/proofofwork-api-observation-health' if name.endswith('.py') else '/etc/systemd/system/'+name) for name in expected}
for name,target in files.items():
 assert not target.exists() and not target.is_symlink()
 assert hashlib.sha256((root/'deploy'/name).read_bytes()).hexdigest()==expected[name]
out=pathlib.Path('/data/proofofwork-audit17-api-observation-005a4e5');out.mkdir(mode=0o700)
for name,target in files.items():
 data=(root/'deploy'/name).read_bytes()
 with (out/name).open('xb') as f:f.write(data)
 with target.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
 target.chmod(0o755 if name.endswith('.py') else 0o644)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','proofofwork-api-observation-health.timer'],check=True)
subprocess.run(['systemctl','start','--no-block','proofofwork-api-observation-health.service'],check=True)
receipt={'files':expected,'commit':commit,'evidence':str(out),'result':'installed; monitor health assessed separately'}
with (out/'installation.json').open('x') as f:json.dump(receipt,f,indent=2);f.write('\n')
print(json.dumps(receipt))
