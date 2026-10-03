import base64,hashlib,json,pathlib,shlex,subprocess
SOURCE=pathlib.Path('/tmp/pow-audit30-production-strict-v1-failure-read-v1.py');PIN='4728fce5b6e7eb1d82915975f8ce10cf835315c23486664ccf2a19efed9bf11b'
raw=SOURCE.read_bytes();assert len(raw)==11850 and hashlib.sha256(raw).hexdigest()==PIN
bootstrap="import base64,hashlib,json; s=base64.b64decode("+repr(base64.b64encode(raw).decode())+"); assert hashlib.sha256(s).hexdigest()=="+repr(PIN)+"; m={'__name__':'_fixed_primary_diagnostic'}; exec(compile(s,'/reviewed/4728-failure-projection.py','exec'),m); result={};\nfor key,path,projection in [('strict',m['OUTPUT'],m['driver']),('positive',m['POSITIVE_OUTPUT'],m['positive'])]:\n v,meta=m['read'](path); result[key]={**meta,'publicProjection':projection(v)}\nresult['states']={u:m['state'](u) for u in [m['UNIT'],m['POSITIVE_UNIT'],*m['LIVE']]}; result['privateContentsExported']=False; result['serviceControl']=False; print(json.dumps(result,sort_keys=True))"
ssh=['/usr/bin/ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','powadmin@65.108.122.87']
paths={n:pathlib.Path('/tmp/pow-audit30-production-primary-failure-native-v1.'+n) for n in ['stdout','stderr','json']};assert not any(p.exists() for p in paths.values())
with paths['stdout'].open('xb') as out,paths['stderr'].open('xb') as err:
 r=subprocess.run(ssh+[shlex.join(['/usr/bin/sudo','-n','/usr/bin/python3','-I','-B','-c',bootstrap])],stdout=out,stderr=err,timeout=90)
result={'schema':'pow-audit30-production-primary-failure-read-transport-v1','exitCode':r.returncode,'sourceSHA256':PIN,'automaticRetry':False,'remoteMutations':False,'captures':{}}
for n in ['stdout','stderr']:
 b=paths[n].read_bytes();assert len(b)<=262144;result['captures'][n]={'path':str(paths[n]),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
paths['json'].open('x').write(json.dumps(result,sort_keys=True)+'\n');print(json.dumps(result,sort_keys=True));raise SystemExit(r.returncode)
