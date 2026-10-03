import hashlib,json,pathlib,shlex,subprocess
SOURCE=pathlib.Path('/tmp/pow-audit30-production-v2-passive-read-v1.py')
PIN='e1d55acf04681c4925086f4d02ba8d2b94e1a95bfcff7b45ffb96ea8383366e5'
raw=SOURCE.read_bytes();assert len(raw)==20582 and hashlib.sha256(raw).hexdigest()==PIN
compile(raw,str(SOURCE),'exec')
ssh=['/usr/bin/ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','powadmin@65.108.122.87']
paths={n:pathlib.Path('/tmp/pow-audit30-production-v2-passive-read-native-v1.'+n) for n in ['stdout','stderr','json']};assert not any(p.exists() for p in paths.values())
with paths['stdout'].open('xb') as out,paths['stderr'].open('xb') as err:
 r=subprocess.run(ssh+[shlex.join(['/usr/bin/sudo','-n','/usr/bin/python3','-I','-B','-c',raw.decode()])],stdout=out,stderr=err,timeout=115)
result={'schema':'pow-audit30-production-v2-passive-read-transport-v1','exitCode':r.returncode,'sourceSHA256':PIN,'automaticRetry':False,'remoteMutations':False,'captures':{}}
for n in ['stdout','stderr']:
 b=paths[n].read_bytes();assert len(b)<=262144;result['captures'][n]={'path':str(paths[n]),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
paths['json'].open('x').write(json.dumps(result,sort_keys=True)+'\n');print(json.dumps(result,sort_keys=True));raise SystemExit(r.returncode)
