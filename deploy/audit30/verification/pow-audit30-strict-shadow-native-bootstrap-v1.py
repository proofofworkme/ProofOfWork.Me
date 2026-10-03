#!/usr/bin/env python3
"""Fixed creation-only custody for the approved installed strict verifier; explicit root GO required."""
import base64,hashlib,json,os,pathlib,stat,sys
ROOT=pathlib.Path('/data/proofofwork-release-backups/audit30-node-release-38ac6e2bff2a-20261003T042000Z');PACKAGE=ROOT/'strict-native-tools-v1'
PINS={'assembly.py':'b3c71c2a48ffb59a297c0fa7264fd417b498b0464d34577859c6bb0ee17fb1c9','fresh-capture.py':'62e8c972a492fd22ebfb90a64396bec1a38466279aadbeb9439dbbb879d1ef68'}
def need(v,m):
 if not v:raise ValueError(m)
def fsync_dir(p):
 fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def source_bytes(request):
 need(set(request)=={'schema','releaseId','sources','operation'}and request['schema']=='pow-audit30-strict-shadow-native-request-v1'and request['releaseId']=='38ac6e2bff2a-20261003T042000Z'and request['operation']=='capture-and-installed-strict-shadow-verifier','REQUEST_SHAPE')
 need(type(request['sources'])is dict and set(request['sources'])==set(PINS),'SOURCE_SCOPE');out={}
 for name,pin in PINS.items():
  row=request['sources'][name];need(set(row)=={'sha256','base64'}and row['sha256']==pin and type(row['base64'])is str and len(row['base64'])<=128*1024,'SOURCE_SHAPE');raw=base64.b64decode(row['base64'],validate=True);need(0<len(raw)<=96*1024 and hashlib.sha256(raw).hexdigest()==pin,'SOURCE_PIN');compile(raw,str(PACKAGE/name),'exec');out[name]=raw
 return out
def create_file(p,raw):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 fsync_dir(p.parent)
def main(raw):
 need(os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0,'ROOT');os.umask(0o077);need(0<len(raw)<=256*1024,'REQUEST_BOUND');r=json.loads(raw);sources=source_bytes(r);s=ROOT.lstat();need(ROOT.resolve()==ROOT and stat.S_ISDIR(s.st_mode)and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700,'ROOT_DIR');need(not os.path.lexists(PACKAGE),'PACKAGE_EXISTS');PACKAGE.mkdir(mode=0o700);fsync_dir(ROOT)
 for name,content in sources.items():create_file(PACKAGE/name,content)
 create_file(PACKAGE/'request.json',raw)
 create_file(PACKAGE/'custody.json',(json.dumps({'schema':'pow-audit30-strict-native-source-custody-v1','requestSHA256':hashlib.sha256(raw).hexdigest(),'sources':{k:hashlib.sha256(v).hexdigest()for k,v in sources.items()},'installedHelpersReplaced':False},sort_keys=True)+'\n').encode())
 n={'__name__':'_reviewed_strict_native','__file__':str(PACKAGE/'assembly.py')};exec(compile(sources['assembly.py'],n['__file__'],'exec'),n);report=n['main'](sources['fresh-capture.py']);print(json.dumps(report,sort_keys=True));return 0
if __name__=='__main__':
 try:code=main(sys.stdin.buffer.read(256*1024+1))
 except BaseException as e:print(json.dumps({'schema':'pow-audit30-strict-native-bootstrap-refused-v1','errorClass':type(e).__name__,'privateContentsExported':False,'automaticRetry':False},sort_keys=True),file=sys.stderr);code=1
 sys.exit(code)
