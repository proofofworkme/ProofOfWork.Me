import hashlib,json,pathlib,shlex,subprocess
SOURCE=pathlib.Path('/tmp/pow-audit30-production-strict-v1-failure-read-v1.py')
PIN='4209946cc9753a40f796134e5a18b5719a0e1f9d822ea2e810f97a2ac85b93ba'
raw=SOURCE.read_bytes();assert len(raw)==11716 and hashlib.sha256(raw).hexdigest()==PIN
compile(raw,str(SOURCE),'exec')
ssh=['/usr/bin/ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','powadmin@65.108.122.87']
paths={n:pathlib.Path('/tmp/pow-audit30-production-failure-read-native-v1.'+n) for n in ['stdout','stderr','json']};assert not any(p.exists() for p in paths.values())
with paths['stdout'].open('xb') as out,paths['stderr'].open('xb') as err:
 r=subprocess.run(ssh+[shlex.join(['/usr/bin/sudo','-n','/usr/bin/python3','-I','-B','-c',raw.decode()])],stdout=out,stderr=err,timeout=115)
result={'schema':'pow-audit30-production-failure-read-transport-v1','exitCode':r.returncode,'sourceSHA256':PIN,'automaticRetry':False,'remoteMutations':False,'captures':{}}
for n in ['stdout','stderr']:
 b=paths[n].read_bytes();assert len(b)<=262144;result['captures'][n]={'path':str(paths[n]),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
paths['json'].open('x').write(json.dumps(result,sort_keys=True)+'\n');print(json.dumps(result,sort_keys=True));raise SystemExit(r.returncode)
