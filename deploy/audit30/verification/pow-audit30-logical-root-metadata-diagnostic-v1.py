import datetime,hashlib,json,os,re,resource,signal,stat,sys
from pathlib import Path
if not(sys.flags.isolated and len(sys.argv)==1 and os.geteuid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01'):raise RuntimeError('Fixed metadata diagnostic root role')
resource.setrlimit(resource.RLIMIT_AS,(67108864,67108864));resource.setrlimit(resource.RLIMIT_CPU,(5,5))
def interrupted(*_):raise RuntimeError('Fixed10s metadata diagnostic deadline')
signal.signal(signal.SIGALRM,interrupted);signal.alarm(10)
root=Path('/data/proofofwork-postgres-backups/logical')
def one(p):
 try:s=p.lstat()
 except FileNotFoundError:return {'path':str(p),'exists':False}
 return {'path':str(p),'exists':True,'kind':'directory'if stat.S_ISDIR(s.st_mode)else'file'if stat.S_ISREG(s.st_mode)else'symlink'if stat.S_ISLNK(s.st_mode)else'other','metadata':{'device':s.st_dev,'inode':s.st_ino,'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'nlink':s.st_nlink,'bytes':s.st_size,'mtimeNs':s.st_mtime_ns,'ctimeNs':s.st_ctime_ns},'canonicalPath':p.resolve(strict=True)==p,'xattrNames':os.listxattr(p,follow_symlinks=False)}
before=one(root)
if not(before['exists'] and before['kind']=='directory' and before['canonicalPath']):raise RuntimeError('Fixed root diagnostic topology refuses')
names=sorted(os.listdir(root))
if len(names)>64 or any(not re.fullmatch('[A-Za-z0-9_.-]{1,128}',n)for n in names):raise RuntimeError('Fixed bounded public root names')
rows=[one(root/n)for n in names]
after=one(root)
if after!=before or sorted(os.listdir(root))!=names:raise RuntimeError('Diagnostic endpoint drift')
signal.alarm(0)
print(json.dumps({'schema':'pow-audit30-logical-root-metadata-diagnostic-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'root':before,'entries':rows,'directoryContentsOnlyNamesRead':True,'anyFileContentsRead':False,'canonicalBackupAuthorityApproved':False,'productionMutation':False,'qualification':'Named metadata observations only; diagnoses refusal without relaxing accepted ownership, backup hash, restore or promotion gates.'},sort_keys=True))
