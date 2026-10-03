#!/usr/bin/python3 -I
"""Repair-first read-only normal-worker observation. No strictaccepted prerequisite or repair authority."""
import base64,hashlib,json,os,pathlib,stat,sys
ROOT=pathlib.Path('/data/proofofwork-release-backups/audit30-node-release-38ac6e2bff2a-20261003T042000Z');RUN='20261003T070500Z'
ASSEMBLY_SHA='b3c71c2a48ffb59a297c0fa7264fd417b498b0464d34577859c6bb0ee17fb1c9';GUARD_SHA='48001283affb80b3b027dcc93831074aee872fbee649fb14482c32b00eb1c76c';UNIT='proofofwork-audit30-worker-mail-guard-v3-'+RUN+'.service'
def need(v,m):
 if not v:raise ValueError(m)
def decode_request(raw):
 need(0<len(raw)<=65536,'REQUEST_BOUND');request=json.loads(raw);need(set(request)=={'schema','runId','sourceBase64','sourceSHA256'}and request['schema']=='pow-audit30-worker-mail-exclusion-native-request-v1'and request['runId']==RUN and request['sourceSHA256']==GUARD_SHA,'REQUEST_SCOPE');guard=base64.b64decode(request['sourceBase64'],validate=True);need(len(guard)<=32768 and hashlib.sha256(guard).hexdigest()==GUARD_SHA,'GUARD_PIN');return guard
def main(raw):
 need(os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0,'ROOT');os.umask(0o077);guard=decode_request(raw)
 p=ROOT/'strict-native-tools-v1'/'assembly.py';m=p.lstat();need(p.resolve()==p and stat.S_ISREG(m.st_mode)and m.st_uid==m.st_gid==0 and stat.S_IMODE(m.st_mode)==0o600 and m.st_nlink==1 and m.st_size<=32768,'ASSEMBLY_SHAPE');source=p.read_bytes();need(hashlib.sha256(source).hexdigest()==ASSEMBLY_SHA,'ASSEMBLY_PIN');a={'__name__':'_reviewed_readonly_admission','__file__':str(p)};exec(compile(source,str(p),'exec'),a);read=a['read'];state=a['state'];before=a['live']();need(state('proofofwork-postgres-logical-backup.service').get('MainPID','0')=='0','BACKUP_RUNNING');need(state(UNIT).get('LoadState')=='not-found','WORKER_GUARD_EXISTS')
 package=ROOT/'repair-first-worker-observation-tools-v1';need(not os.path.lexists(package),'PACKAGE_EXISTS');package.mkdir(mode=0o700)
 def fsync_dir(p):
  fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  try:os.fsync(fd)
  finally:os.close(fd)
 def write(name,data):
  fd=os.open(package/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
  fsync_dir(package)
 fsync_dir(ROOT);write('guard.py',guard);write('request.json',raw);write('intent.json',(json.dumps({'schema':'pow-audit30-repair-first-worker-observation-intent-v1','sourceSHA256':GUARD_SHA,'unit':UNIT,'strictAcceptanceRequired':False,'productionDataMutation':False},sort_keys=True)+'\n').encode())
 g={'__name__':'_reviewed_worker_exclusion','__file__':str(package/'guard.py')};exec(compile(guard,g['__file__'],'exec'),g)
 try:
  result=g['execute'](RUN);need(result['ok']is True and result['liveServicesUnchanged']is True and a['live']()==before and state(UNIT).get('MainPID','0')=='0','WORKER_GUARD_FAILED');write('completed.json',(json.dumps(result,sort_keys=True)+'\n').encode());print(json.dumps(result,sort_keys=True));return 0
 except BaseException as e:
  write('failed.json',(json.dumps({'schema':'pow-audit30-repair-first-worker-observation-failed-v1','errorClass':type(e).__name__,'automaticRetry':False,'productionMutation':False},sort_keys=True)+'\n').encode());raise
if __name__=='__main__':
 try:code=main(sys.stdin.buffer.read(65537))
 except BaseException as e:print(json.dumps({'ok':False,'errorClass':type(e).__name__,'automaticRetry':False,'privateDetailsExported':False},sort_keys=True),file=sys.stderr);code=1
 sys.exit(code)
