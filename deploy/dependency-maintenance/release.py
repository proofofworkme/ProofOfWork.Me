#!/usr/bin/env python3
"""Read-only capture, local hash-bound plan, explicit apply of four dependencies."""
import argparse,base64,copy,datetime,hashlib,io,json,os,re,shlex,subprocess,tarfile
from pathlib import Path,PurePosixPath
HERE=Path(__file__).resolve().parent
SSH=['ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','powadmin@65.108.122.87']
NAMES=('nanoid','postcss','source-map-js','valibot')
def need(v,msg):
 if not v:raise ValueError(msg)
def sha(b):return hashlib.sha256(b).hexdigest()
def encode(v):return (json.dumps(v,sort_keys=True,indent=2)+'\n').encode()
def output_path(path):
 need(path.is_absolute() and path.parent.is_dir() and path.parent.resolve()==path.parent and not os.path.lexists(path),'Output must be new canonical path')
def save(path,b):
 output_path(path);fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
 parentfd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(parentfd)
 finally:os.close(parentfd)
def supports():
 if (HERE/'accepted-runtime-guards.py').exists():return HERE/'accepted-runtime-guards.py',HERE/'accepted-search-holder.py'
 return HERE.parent/'id-pending-recovery/scoped-node.py',HERE.parent/'search/hold-node-timer.py'
def request(action,plan=None):
 g,h=supports();return {'action':action,'guards':base64.b64encode(g.read_bytes()).decode(),'holder':base64.b64encode(h.read_bytes()).decode(),**({'plan':plan} if plan else {})}
def dispatch(payload,timeout):
 code=(HERE/'controller.py').read_text();return subprocess.run(SSH+[shlex.join(['sudo','-n','/usr/bin/nice','-n','15','/usr/bin/ionice','-c','3','/usr/bin/python3','-I','-B','-c',code])],input=encode(payload),capture_output=True,timeout=timeout)
def capture(args):
 output_path(args.output);output_path(args.output.with_suffix('.stderr'))
 r=dispatch(request('capture'),180);save(args.output.with_suffix('.stderr'),r.stderr);need(r.returncode==0,'Capture refused: '+r.stderr[-4000:].decode(errors='replace'));save(args.output,r.stdout);print(json.dumps({'path':str(args.output),'sha256':sha(r.stdout),'bytes':len(r.stdout)}))
def tree_from_tar(path,locked):
 b=path.read_bytes();need('sha512-'+base64.b64encode(hashlib.sha512(b).digest()).decode()==locked['integrity'],'Registry tarball integrity differs')
 rows={'.':{'kind':'directory','mode':0o755,'uid':0,'gid':0,'mtimeNs':0,'nlink':2}}
 with tarfile.open(fileobj=io.BytesIO(b),mode='r:gz') as archive:
  for member in archive.getmembers():
   q=PurePosixPath(member.name);need(str(q)==member.name and len(q.parts)>1 and q.parts[0]=='package' and all(x not in ('..','') for x in q.parts),'Unsafe tar member')
   rel=str(PurePosixPath(*q.parts[1:]));need(not member.issym() and not member.islnk() and (member.isfile() or member.isdir()),'Unsupported archive member')
   need(rel not in rows,'Duplicate archive member')
   mode=member.mode&0o777;need(mode in (0o644,0o755),'Unsupported archive mode')
   r={'kind':'directory' if member.isdir() else 'file','mode':mode,'uid':0,'gid':0,'mtimeNs':int(member.mtime)*1000000000,'nlink':2 if member.isdir() else 1}
   if member.isfile():
    need(member.size<8*1024**2,'Oversized member');data=archive.extractfile(member).read();r.update(base64=base64.b64encode(data).decode(),sha256=sha(data),bytes=len(data))
   rows[rel]=r
   parent=PurePosixPath(rel).parent
   while str(parent)!='.':
    rows.setdefault(str(parent),{'kind':'directory','mode':0o755,'uid':0,'gid':0,'mtimeNs':0,'nlink':2});parent=parent.parent
 return rows,{'path':str(path),'sha256':sha(b),'bytes':len(b),'integrity':locked['integrity']}
def plan(args):
 snapshot=json.loads(args.capture.read_text());lockraw=(args.repository/'package-lock.json').read_bytes();lock=json.loads(lockraw)
 if not args.draft:
  need(re.fullmatch('[0-9a-f]{40}',args.commit or '') is not None,'Exact commit required')
  git=lambda *x:subprocess.check_output(['git','-C',str(args.repository),*x])
  need(git('rev-parse','HEAD').decode().strip()==args.commit and not git('status','--porcelain','--untracked-files=all'),'Clean committed candidate required')
  need(git('show',args.commit+':package-lock.json')==lockraw,'Committed lock differs')
  for relative in ['controller.py','release.py']:
   need(git('show',args.commit+':deploy/dependency-maintenance/'+relative)==(HERE/relative).read_bytes(),'Controller not committed')
 release=(args.commit[:12] if args.commit else '000000000000')+'-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 packages={};archives={}
 for name in NAMES:
  locked=lock['packages']['node_modules/'+name];packages[name],archives[name]=tree_from_tar(args.archives/(name+'-'+locked['version']+'.tgz'),locked)
 locks={}
 for path,row in snapshot['locks'].items():
  old=json.loads(base64.b64decode(row['base64']));new=copy.deepcopy(old)
  for name in NAMES:new['packages']['node_modules/'+name]=copy.deepcopy(lock['packages']['node_modules/'+name])
  b=encode(new);locks[path]={'base64':base64.b64encode(b).decode(),'sha256':sha(b)}
 g,h=supports();value={'format':'pow-cef-node-dependency-plan-v1','executable':not args.draft,'sourceCommit':args.commit,'releaseId':release,'captureSha256':sha(args.capture.read_bytes()),'sourceLockSha256':sha(lockraw),'controllerSha256':sha((HERE/'controller.py').read_bytes()),'driverSha256':sha((HERE/'release.py').read_bytes()),'guardsSha256':sha(g.read_bytes()),'holderSha256':sha(h.read_bytes()),'capture':snapshot,'candidatePackages':packages,'candidateLocks':locks,'registryArchives':archives,'scope':'Only four fixed package directories and their entries in present lockfiles. Preserve package.json, font package, source overlays, all other dependencies, authority/configuration and history.'}
 save(args.output,encode(value));print(json.dumps({'path':str(args.output),'sha256':sha(encode(value)),'bytes':len(encode(value)),'executable':value['executable']}))
def apply(args):
 output_path(args.receipt)
 wire=args.plan.read_bytes();need(sha(wire)==args.plan_sha256,'Reviewed plan hash differs');value=json.loads(wire);g,h=supports()
 for key,p in [('controllerSha256',HERE/'controller.py'),('driverSha256',HERE/'release.py'),('guardsSha256',g),('holderSha256',h)]:need(sha(p.read_bytes())==value[key],'Tool pin differs')
 need(value['executable'] is True,'Draft is not executable');need(not args.receipt.exists(),'Receipt already exists')
 try:
  r=dispatch(request('apply',value),1200);receipt={'planSha256':sha(wire),'exitCode':r.returncode,'stdout':r.stdout.decode(errors='replace'),'stderr':r.stderr.decode(errors='replace'),'uncertain':False}
 except subprocess.TimeoutExpired as e:
  receipt={'planSha256':sha(wire),'exitCode':None,'stdout':(e.stdout or b'').decode(errors='replace'),'stderr':(e.stderr or b'').decode(errors='replace'),'uncertain':True,'instruction':'Do not retry. Reconcile remote receipt, exact hold, operations lock and package paths first.'}
 save(args.receipt,encode(receipt));need(receipt['exitCode']==0,'Apply incomplete; original output preserved in '+str(args.receipt));print(json.dumps({'receipt':str(args.receipt),'status':'controller-finished; ordinary readiness verification still required'}))
def main():
 p=argparse.ArgumentParser(description=__doc__);s=p.add_subparsers(required=True)
 c=s.add_parser('capture');c.add_argument('output',type=Path);c.set_defaults(fn=capture)
 q=s.add_parser('plan');q.add_argument('repository',type=Path);q.add_argument('capture',type=Path);q.add_argument('archives',type=Path);q.add_argument('output',type=Path);q.add_argument('--commit');q.add_argument('--draft',action='store_true');q.set_defaults(fn=plan)
 a=s.add_parser('apply');a.add_argument('plan',type=Path);a.add_argument('plan_sha256');a.add_argument('receipt',type=Path);a.set_defaults(fn=apply)
 args=p.parse_args();os.umask(0o077);args.fn(args)
if __name__=='__main__':main()
