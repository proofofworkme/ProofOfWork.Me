#!/usr/bin/python3 -I -B
"""Local-only explicit public evidence manifest preview/preservation; no tracker or git action."""
import argparse,hashlib,json,os,pathlib,re,stat
REPO=pathlib.Path('/home/sixer/ProofOfWork.Me');ROOT=REPO/'deploy/audit30/verification'
def need(v,c):
 if not v:raise ValueError(c)
def stamp(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def read(p,maximum=4*1024**2):
 p=pathlib.Path(p);s=p.lstat();need(p.is_absolute() and p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_size<=maximum,'PUBLIC_SOURCE_SHAPE')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  need(stamp(os.fstat(f.fileno()))==stamp(s),'SOURCE_OPEN_DRIFT');raw=f.read(maximum+1)
  need(len(raw)==s.st_size and stamp(os.fstat(f.fileno()))==stamp(s)==stamp(p.lstat()),'SOURCE_READ_DRIFT')
 return raw
def sync(p):
 fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def main():
 a=argparse.ArgumentParser();a.add_argument('--manifest',required=True);a.add_argument('--manifest-sha256',required=True);a.add_argument('--apply',action='store_true');a.add_argument('--root-reviewed',action='store_true');a.add_argument('--receipt');p=a.parse_args()
 need(re.fullmatch('[0-9a-f]{64}',p.manifest_sha256),'MANIFEST_PIN');raw=read(p.manifest);need(hashlib.sha256(raw).hexdigest()==p.manifest_sha256,'MANIFEST_DRIFT');m=json.loads(raw)
 need(m['schema']=='pow-audit30-action73-proposed-public-custody-manifest-v1' and m['privateCapturesBodiesOrRawAddressesIncluded']is False and m['deletionRequested']is False,'PUBLIC_MANIFEST_SCOPE')
 need(not p.apply or p.root_reviewed,'ROOT_REVIEW_REQUIRED');need(not p.apply or p.receipt,'CREATION_ONLY_RECEIPT_REQUIRED')
 prepared=[];targets=set();sources=set()
 for row in m['members']:
  r=row['original'];source=pathlib.Path(r['path']);target=REPO/row['proposedRepositoryPath']
  need(source.parent==pathlib.Path('/tmp') and source.name.startswith('pow-audit30-'),'EXPLICIT_TMP_SOURCE_ONLY')
  need(target.parent==ROOT and target.name.startswith('pow-audit30-') and target not in targets and source not in sources,'EXPLICIT_VERIFICATION_TARGET_ONLY');targets.add(target);sources.add(source)
  payload=read(source);need(len(payload)==r['bytes'] and hashlib.sha256(payload).hexdigest()==r['sha256'],'SOURCE_MANIFEST_DRIFT')
  if os.path.lexists(target):need(read(target)==payload,'EXISTING_TARGET_MUST_MATCH')
  prepared.append((source,target,payload,r))
 receipt=None
 if p.apply:
  receipt=pathlib.Path(p.receipt);need(receipt.parent==ROOT and receipt.name.startswith('pow-audit30-action73-public-custody-preserved-')and receipt.resolve(strict=False)==receipt and not os.path.lexists(receipt),'RECEIPT_SCOPE_COLLISION')
 records=[]
 for source,target,payload,r in prepared:
  existed=os.path.lexists(target)
  if p.apply and not existed:
   need(read(source)==payload,'SOURCE_CHANGED_BEFORE_COPY');fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
   with os.fdopen(fd,'wb')as f:f.write(payload);f.flush();os.fsync(f.fileno())
   sync(ROOT);need(read(target)==payload,'TARGET_VERIFY_FAILED')
  records.append({'sourcePath':str(source),'repositoryPath':str(target.relative_to(REPO)),'bytes':len(payload),'sha256':r['sha256'],'alreadyExisted':existed,'copied':p.apply and not existed})
 result={'schema':'pow-audit30-action73-public-custody-preserved-v1','status':'preserved'if p.apply else'preview-only','manifest':{'path':p.manifest,'sha256':p.manifest_sha256,'bytes':len(raw)},'members':records,'allExact':True,'privateCapturesBodiesOrRawAddressesIncluded':False,'deletionPerformed':False,'trackerChanged':False,'gitChanged':False,'productionCalls':False}
 if p.apply:
  data=(json.dumps(result,indent=2)+'\n').encode();fd=os.open(receipt,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
  with os.fdopen(fd,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
  sync(ROOT)
 print(json.dumps({'status':result['status'],'memberCount':len(records),'allExact':True,'receipt':str(receipt)if receipt else None,'productionCalls':False},sort_keys=True))
if __name__=='__main__':main()
