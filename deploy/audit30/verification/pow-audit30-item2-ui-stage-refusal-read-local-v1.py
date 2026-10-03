
import json,base64,hashlib,pathlib,shlex,subprocess
source=r"""
import pathlib,stat,os,json,base64,hashlib,subprocess
root=pathlib.Path('/var/tmp/proofofwork-deploy/recovery-transport-38ac6e2bff2a-20261003T190512Z-surfaces-stage');rows={}
for name in ['intent.json','stage-model.json','stage-check-scratch.json','receiver.log','receive-admission.log']:
 p=root/name;s=p.lstat();assert p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode)and s.st_uid==s.st_gid==0 and s.st_nlink==1 and s.st_size<=65536
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW);raw=os.read(fd,65537);t=os.fstat(fd);os.close(fd);assert len(raw)==s.st_size and s.st_ino==t.st_ino==p.lstat().st_ino and s.st_mtime_ns==t.st_mtime_ns==p.lstat().st_mtime_ns
 rows[name]={'path':str(p),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'base64':base64.b64encode(raw).decode()}
p=pathlib.Path('/var/www/.proofofwork-ui-release');raw=p.read_bytes();assert len(raw)<=65536
rows['live-manifest']={'path':str(p),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'base64':base64.b64encode(raw).decode()}
unit='proofofwork-recovery-ui-transport-38ac6e2bff2a-20261003T190512Z-surfaces-stage.service';r=subprocess.run(['/usr/bin/systemctl','show',unit,'--property=LoadState,MainPID,ActiveState,SubState,Result,InvocationID'],env={'PATH':'/usr/bin:/bin','LC_ALL':'C'},capture_output=True,timeout=10,check=True);assert not r.stderr
print(json.dumps({'schema':'pow-audit30-item2-ui-stage-refusal-public-read-v1','receipts':rows,'unitState':r.stdout.decode(),'privateContentsExported':False,'productionWrites':False},sort_keys=True))
"""
ssh=['/usr/bin/ssh','-i','/home/sixer/.ssh/proofofwork_me_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','root@77.42.91.106',shlex.join(['/usr/bin/python3','-I','-B','-c',source])];r=subprocess.run(ssh,capture_output=True,timeout=60);assert r.returncode==0 and not r.stderr,(r.returncode,r.stderr.decode());q=json.loads(r.stdout)
for name,row in q['receipts'].items():
 raw=base64.b64decode(row.pop('base64'),validate=True);assert len(raw)==row['bytes']and hashlib.sha256(raw).hexdigest()==row['sha256'];p=pathlib.Path('/tmp/pow-audit30-item2-ui-refusal-exact-'+name);p.open('xb').write(raw);row['localPath']=str(p)
pathlib.Path('/tmp/pow-audit30-item2-ui-stage-refusal-public-read-v1.json').open('x').write(json.dumps(q,indent=2)+'\n');print(json.dumps(q,indent=2))
for name in ['stage-model.json','stage-check-scratch.json']:
 print(name);print(pathlib.Path(q['receipts'][name]['localPath']).read_text())
