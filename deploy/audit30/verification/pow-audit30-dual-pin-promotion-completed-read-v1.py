"""Fixed public promotion receipt and exact two installed files; read only."""
import base64,datetime,hashlib,json,os,resource,signal,stat,sys
from pathlib import Path
RECEIPT=Path('/usr/local/lib/proofofwork-audit30-pin-promotion/20261003T144000Z/evidence/completed.json')
PIN=Path('/etc/proofofwork-postgres-logical-backup.pins');CHECKER=Path('/usr/local/sbin/proofofwork-retention-protection')
PINS={'planSha256':'7d50940fe5c2087cdc169fc14e27c006220dce12b91d2b15bcbb2bc4b9a6c2ee','callerSha256':'dfa403996e776a8ed192a024848b06f71b5fa041a24bf5b9687ff04ce3714535','approvalReceiptSha256':'46c60e55ab4b95a4b0f51d2efa17969466417c0ad53b8542a0de26667825b089','scopeSha256':'fe09d0ba6c9c1e561a569fb425c9812f9b077cb646fbdd615768e0546ead0437','humanApprovalSourceSha256':'d93213cc5dec29d6c4aaf3178f76597665211100423e41d61d60fd163dfb5dcf'}
NEW_PIN=b'proof_indexer-20260929T031853Z.dumpset\nproof_indexer-20261003T031852Z.dumpset\n'
EXPECTED={PIN:(78,0o644,'22f66cac8419985c544d4b41c6ea9cd400fc99805c588694a9a619a3f120d09b'),CHECKER:(20718,0o755,'795f1308b74ddc69a022ce7e1413fb4698a82e6cfb14265931d1951ee603c908')}
class ObservationInterrupted(RuntimeError):pass
def need(v,c):
 if not v:raise ValueError(c)
def sha(b):return hashlib.sha256(b).hexdigest()
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'DUPLICATE_PUBLIC_RECEIPT_KEY');d[k]=v
 return d
def metadata(s):return dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns)
def read(path,cap,mode,pin=None):
 s=path.lstat();m=metadata(s);need(path.resolve(strict=True)==path and stat.S_ISREG(s.st_mode)and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink)==(0,0,mode,1)and 0<s.st_size<=cap,'FIXED_PUBLIC_FILE_AUTHORITY')
 for parent in path.parents:
  x=parent.lstat();need(parent.resolve(strict=True)==parent and stat.S_ISDIR(x.st_mode)and x.st_uid==0 and not stat.S_IMODE(x.st_mode)&0o022,'ROOT_SAFE_PUBLIC_ANCESTRY')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:
  need(metadata(os.fstat(f.fileno()))==m and not os.listxattr(f.fileno()),'PUBLIC_FILE_FD_OR_XATTR_DRIFT');raw=f.read(cap+1);need(metadata(os.fstat(f.fileno()))==m and not os.listxattr(f.fileno()),'PUBLIC_FILE_CHANGED_DURING_READ')
 need(metadata(path.lstat())==m and len(raw)==m['bytes']and (pin is None or sha(raw)==pin),'PUBLIC_FILE_BYTES_OR_PATH_DRIFT');return raw,m
def validate(raw,current):
 v=json.loads(raw,object_pairs_hook=pairs);need(canonical(v)==raw,'CANONICAL_PRODUCER_RECEIPT_BYTES')
 keys={'schema','status','atUtc',*PINS,'pinPath','oldPin','newPin','checkerPath','oldCheckerSha256','newCheckerSha256','pinAndCheckerCoupled','oldPinBytesPreserved','holdAndMasksUnchanged','ordinaryTimersUnchanged','deletionAuthorized','installed','individualAtomicReplacements','jointAtomicTransaction','knownHeldAbsencesUnresolved','timersAndHoldsUnchanged','automaticDeletion','recoveryActivation'}
 need(set(v)==keys and v['schema']=='pow-audit30-logical-pin-checker-promotion-completed-v1'and v['status']=='completed'and all(v[k]==h for k,h in PINS.items()),'EXACT_AUTHENTICATED_COMPLETION_PINS')
 need(v['pinPath']==str(PIN)and v['checkerPath']==str(CHECKER)and v['oldPin']=='proof_indexer-20260929T031853Z.dumpset'and v['newPin']==NEW_PIN.decode().rstrip('\n')and v['oldCheckerSha256']=='da5d1336ce857acc571ba0849c2b0150ef5fc6dfdacf80e65b9f1d3611c48e8a'and v['newCheckerSha256']==EXPECTED[CHECKER][2],'EXACT_TWO_REPLACEMENTS')
 need(all(v[k]is True for k in('pinAndCheckerCoupled','oldPinBytesPreserved','holdAndMasksUnchanged','ordinaryTimersUnchanged','timersAndHoldsUnchanged','individualAtomicReplacements'))and all(v[k]is False for k in('deletionAuthorized','jointAtomicTransaction','automaticDeletion','recoveryActivation'))and type(v['knownHeldAbsencesUnresolved'])is int and v['knownHeldAbsencesUnresolved']==18,'UNCHANGED_SCOPE_AND_LIMITS')
 when=datetime.datetime.fromisoformat(v['atUtc']);need(when.tzinfo is not None and when<=datetime.datetime.now(datetime.timezone.utc),'ACTUAL_COMPLETION_TIMESTAMP')
 need(isinstance(v['installed'],list)and len(v['installed'])==2 and [r['path']for r in v['installed']]==list(map(str,EXPECTED)),'EXACT_ORDERED_INSTALLED_ROWS')
 for row in v['installed']:
  p=Path(row['path']);need(set(row)=={'path','sha256','mode','metadata'}and row['sha256']==EXPECTED[p][2]and row['mode']==EXPECTED[p][1]and row['metadata']==current[str(p)]['metadata'],'CURRENT_INSTALLED_METADATA_MATCHES_COMPLETION')
 return v
def main():
 need(sys.flags.isolated and sys.dont_write_bytecode and len(sys.argv)==1 and os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01','FIXED_ISOLATED_ROOT_READ')
 resource.setrlimit(resource.RLIMIT_AS,(128*1024**2,128*1024**2));resource.setrlimit(resource.RLIMIT_CPU,(10,10))
 def interrupted(n,_f):raise ObservationInterrupted('Fixed read-only observation '+str(n))
 for n in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM):signal.signal(n,interrupted)
 signal.setitimer(signal.ITIMER_REAL,30)
 raw,rm=read(RECEIPT,32768,0o600);current={}
 for p,(size,mode,pin)in EXPECTED.items():
  b,m=read(p,size,mode,pin);need(len(b)==size and (p!=PIN or b==NEW_PIN),'INSTALLED_EXACT_SIZE_AND_ORDERED_PIN');current[str(p)]={'metadata':m,'sha256':sha(b)}
 v=validate(raw,current)
 for p,(size,mode,pin)in EXPECTED.items():b,m=read(p,size,mode,pin);need(current[str(p)]=={'metadata':m,'sha256':sha(b)},'INSTALLED_ENDPOINT_DRIFT')
 again,am=read(RECEIPT,32768,0o600,sha(raw));need(again==raw and am==rm,'PUBLIC_COMPLETION_ENDPOINT_DRIFT')
 out={'schema':'pow-audit30-dual-pin-promotion-public-verification-v1','status':'passed-fixed-receipt-and-installed-byte-verification','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'receipt':{'path':str(RECEIPT),'bytes':len(raw),'sha256':sha(raw),'metadata':rm,'rawBase64':base64.b64encode(raw).decode()},'authenticatedCompletionPins':PINS,'installed':current,'exactOrderedSep29AndOct3Pin':True,'completedReceiptAndInstalledEndpointsEqual':True,'knownHeldAbsencesUnresolved':18,'readOnlyObservation':True,'configurationChangedByObserver':False,'productionDataMutation':False,'deletionAuthorized':False,'recoveryActivated':False,'qualification':'Exact public completed receipt plus current two installed bytes/modes/root ownership and their repeated endpoint custody. Other static/unit/known18 checks are producer-declared completion properties, not freshly repeated here. Two individual atomic replacements are not a joint transaction; no continuous state or retirement/PITR/deletion proof.'}
 encoded=canonical(out)+b'\n';need(len(encoded)<=65536,'PUBLIC_OUTPUT_CAP');signal.setitimer(signal.ITIMER_REAL,0);sys.stdout.buffer.write(encoded);sys.stdout.buffer.flush()
if __name__=='__main__':main()
