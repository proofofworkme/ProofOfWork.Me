"""One source-fenced producer/consumer contract for public linked stage bytes."""
import hashlib,json,os,re,stat
from pathlib import Path,PurePosixPath
LINKED_STAGE_ROOT=Path('/data/proofofwork-linked-publish-stage-v2')
LINKED_STAGE_FORMAT='linked-publish-stage-v1'
def linked_stage_need(value,message):
 if not value:raise ValueError(message)
def linked_stage_sha(value):return isinstance(value,str) and re.fullmatch('[0-9a-f]{64}',value) is not None
def linked_stage_directory(path,exact=False):
 info=path.lstat()
 linked_stage_need(path.resolve(strict=True)==path and stat.S_ISDIR(info.st_mode) and info.st_uid==info.st_gid==0
  and not info.st_mode&0o7022 and info.st_mode&0o005==0o005,'Unsafe linked stage directory')
 if exact:linked_stage_need(stat.S_IMODE(info.st_mode)==0o755,'Wrong linked stage directory mode')
def linked_stage_read(path,limit):
 info=path.lstat()
 linked_stage_need(path.resolve(strict=True)==path and stat.S_ISREG(info.st_mode) and info.st_nlink==1
  and info.st_uid==info.st_gid==0 and stat.S_IMODE(info.st_mode)==0o644 and info.st_size<=limit,'Unsafe linked stage source')
 identity=lambda i:(i.st_dev,i.st_ino,i.st_mode,i.st_uid,i.st_gid,i.st_nlink,i.st_size,i.st_mtime_ns,i.st_ctime_ns)
 with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK),'rb') as f:
  linked_stage_need(identity(os.fstat(f.fileno()))==identity(info),'Stage source changed')
  raw=f.read(limit+1)
  linked_stage_need(identity(os.fstat(f.fileno()))==identity(info),'Stage source changed')
 linked_stage_need(identity(path.lstat())==identity(info) and len(raw)==info.st_size,'Stage source changed')
 return raw
def linked_stage_modules(runtime_root):
 path=runtime_root/'node_modules';info=path.lstat()
 linked_stage_need(path.resolve(strict=True)==path and stat.S_ISDIR(info.st_mode) and not info.st_mode&0o7022,'Unsafe runtime modules target')
 return {'path':str(path),'device':info.st_dev,'inode':info.st_ino,'uid':info.st_uid,'gid':info.st_gid,'mode':stat.S_IMODE(info.st_mode)}
def validate_linked_stage(binding,commit,expected_plan_sha,runtime_root):
 linked_stage_need(isinstance(binding,dict) and set(binding)=={'path','sha256','planSha256','sourceHashes','nodeModules'},'Wrong linked stage binding')
 linked_stage_need(linked_stage_sha(expected_plan_sha) and binding['planSha256']==expected_plan_sha and linked_stage_sha(binding['sha256']),'Wrong linked stage plan binding')
 linked_stage_need(isinstance(commit,str) and re.fullmatch('[0-9a-f]{40}',commit),'Wrong linked source commit')
 modules_binding=binding['nodeModules']
 linked_stage_need(isinstance(modules_binding,dict) and set(modules_binding)=={'path','device','inode','uid','gid','mode'}
  and isinstance(modules_binding['path'],str) and all(type(modules_binding[k]) is int and modules_binding[k]>=0
  for k in ('device','inode','uid','gid','mode')),'Wrong runtime modules identity')
 linked_stage_need(isinstance(binding['path'],str),'Wrong linked stage path')
 root=Path(binding['path'])
 linked_stage_need(root.is_absolute() and str(root)==binding['path'] and root.parent==LINKED_STAGE_ROOT and root.name==expected_plan_sha,'Missing bound linked stage')
 for ancestor in reversed(root.parents):linked_stage_directory(ancestor,ancestor==LINKED_STAGE_ROOT)
 linked_stage_directory(root,True)
 proof_raw=linked_stage_read(root/'stage.json',4*1024**2)
 linked_stage_need(hashlib.sha256(proof_raw).hexdigest()==binding['sha256'],'Linked stage proof changed')
 proof=json.loads(proof_raw)
 linked_stage_need(isinstance(proof,dict) and set(proof)=={'format','commit','planSha256','sourceHashes'}
  and proof['format']==LINKED_STAGE_FORMAT and proof['commit']==commit and proof['planSha256']==expected_plan_sha,'Linked stage source identity differs')
 hashes=proof['sourceHashes']
 linked_stage_need(isinstance(hashes,dict) and 1<=len(hashes)<=320 and hashes==binding['sourceHashes'],'Linked stage inventory differs')
 expected_dirs={root};total=0
 for name,digest in hashes.items():
  linked_stage_need(isinstance(name,str) and str(PurePosixPath(name))==name and not name.startswith('/') and '\\' not in name
   and all(part not in ('','.','..') for part in name.split('/')) and all(ord(c)>=32 and ord(c)!=127 for c in name)
   and name not in ('stage.json','node_modules') and linked_stage_sha(digest),'Unsafe linked stage source path')
  path=root/name
  for parent in path.parents:
   if parent==root:break
   linked_stage_directory(parent,True);expected_dirs.add(parent)
  raw=linked_stage_read(path,48*1024**2);total+=len(raw)
  linked_stage_need(total<48*1024**2 and hashlib.sha256(raw).hexdigest()==digest,'Changed linked stage bytes')
 observed=set();observed_dirs=set()
 for parent,dirs,files in os.walk(root,followlinks=False):
  parent=Path(parent);observed_dirs.add(parent);linked_stage_directory(parent,True)
  for name in dirs:
   child=parent/name
   if child.is_symlink():linked_stage_need(child==root/'node_modules','Unexpected stage symlink')
  observed.update(str((parent/name).relative_to(root)) for name in files)
 linked_stage_need(observed==set(hashes)|{'stage.json'} and observed_dirs==expected_dirs,'Unexpected linked stage closure')
 modules=linked_stage_modules(runtime_root);link_info=(root/'node_modules').lstat()
 linked_stage_need(stat.S_ISLNK(link_info.st_mode) and link_info.st_uid==link_info.st_gid==0 and link_info.st_nlink==1,'Unsafe stage modules symlink')
 linked_stage_need(binding['nodeModules']==modules and (root/'node_modules').is_symlink()
  and os.readlink(root/'node_modules')==modules['path'],'Linked stage modules changed')
 return root,proof
