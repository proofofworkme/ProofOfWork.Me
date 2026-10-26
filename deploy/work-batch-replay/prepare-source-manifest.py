#!/usr/bin/python3 -I
# Stage only a fresh minimal import closure. No live runtime hash approval.
import argparse,hashlib,json,os,re,stat,subprocess
from pathlib import Path,PurePosixPath
SHA=re.compile(r'[0-9a-f]{64}\Z');COMMIT=re.compile(r'[0-9a-f]{40}\Z')
BASE='eb0a2cf01b5173e14c710ed48c1a98b8d0a9ddee'
OLD_HELPER='7e3393953864a68cdd72f43b7f3ae8e7eb4a24502ff2b260320790ee9be7f584'
OLD_CONTRACT='ac97a8a4892c710aa712975fde9cc1a926c0ba20ef54722def9b1e6b827dec94'
TARGETS={'scripts/backfill-proof-indexer.mjs','server/db/native-transition-storage.mjs','server/db/work-batch-reader.mjs','server/proof-api.mjs','server/work-amo-v5-raw.mjs','server/work-batch-declaration.mjs'}
ROLES={'baselineRaw':('baseline','server/work-amo-v5-raw.mjs'),'compatibleRaw':('compatible','server/work-amo-v5-raw.mjs'),'declaration':('compatible','server/work-batch-declaration.mjs'),'canonicalRecords':('compatible','server/canonical-op-return.mjs'),'canonicalState':('compatible','server/work-amo-v5.mjs'),'canonicalWork8':('compatible','server/work-amo-v8.mjs'),'owner':('compatible','src/shared/protocol/ownerOutputCommitment.mjs'),'hydrator':('compatible','deploy/work-batch-activation/probe.mjs'),'selection':('compatible','server/work-batch-selection.mjs'),'reader':('compatible','server/db/work-batch-reader.mjs')}
IMPORT=re.compile(r'''(?:\bfrom\s*|\bimport\s*\(|\bimport\s*)["'](\.[^"']+)["']''')
def require(v,m):
 if not v:raise ValueError(m)
def sha(b):return hashlib.sha256(b).hexdigest()
def read(p,expected=None,limit=64*1024**2):
 p=Path(p);require(p.is_absolute() and p.resolve()==p,'Noncanonical input');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  before=os.fstat(fd);require(stat.S_ISREG(before.st_mode) and before.st_size<=limit,'Unsafe input')
  with os.fdopen(fd,'rb',closefd=False)as f:b=f.read(limit+1)
  require(os.fstat(fd)==before and len(b)<=limit and (expected is None or sha(b)==expected),'Input changed');return b
 finally:os.close(fd)
def relative(v):
 require(isinstance(v,str) and str(PurePosixPath(v))==v and not PurePosixPath(v).is_absolute()
  and not any(x in ('','.','..')for x in v.split('/')) and chr(92) not in v
  and not any(ord(c)<32 or ord(c)==127 for c in v),'Unsafe path');return v

def save(p,b):
 p.parent.mkdir(parents=True,exist_ok=True,mode=0o700);fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  with os.fdopen(fd,'wb',closefd=False)as f:f.write(b);f.flush();os.fsync(fd)
 finally:os.close(fd)
# One accepted A3 font-only discrepancy; never infer compatibility from live hashes.
A3_LOCK_PINS={'source': '77170945a8cbc8a94c3e6d63b2faef6516317de6a1ad3e894ec363f77c243b14', 'runtime': '1f6d39daa9d62f3ce75e804333f04031a934f6f50690734df7f00effb7f3f4b6', 'installed': '2463141898c4cbc3b775420a89e8ae71b12e9d82cf0bc39fd154922a332256aa'}
A3_LOCK_EVIDENCE={'plan': {'path': '/tmp/proofofwork-amo-browse-release-20261025T180738Z/runtime-plan/plan.json', 'sha256': '08e65c5f6268978926e394c5b08c64a84f8e33c6488b33814739edd7c06d0f0f'}, 'postInstall': {'path': '/tmp/proofofwork-amo-browse-release-20261025T180738Z/runtime-post-install.json', 'sha256': '3ed3e517a41184c0df718ab79bc673f89ce16bcd9661b615b774e0dd3ba49ed4'}, 'completion': {'path': '/data/proofofwork-release-backups/runtime-latest-eb0a2cf01b51-20261025T183504Z/completion.json', 'sha256': 'b763018f4a599807440db3bc75a67f88d26b51668e823425e516a7a9c9aa4651'}}
FONT='@fontsource-variable/space-grotesk'
def font_only_lock_semantics(source,runtime,installed):
 source=json.loads(json.dumps(source));runtime=json.loads(json.dumps(runtime));installed=json.loads(json.dumps(installed));font='node_modules/'+FONT
 require(font not in source['packages'] and runtime['packages'].get(font,{}).get('version')=='5.3.0','Unexpected font package')
 require(runtime['packages']['']['dependencies'].pop(FONT,None)=='^5.3.0' and source['packages'][''].get('license')=='MIT' and 'license' not in runtime['packages'][''],'Unexpected font root metadata')
 runtime['packages']['']['license']='MIT';font_row=runtime['packages'].pop(font)
 require(runtime==source,'Non-font dependency/root metadata differs')
 require({k:v for k,v in installed.items() if k!='packages'}=={k:v for k,v in source.items() if k!='packages'} and '' not in installed['packages'] and installed['packages'].get(font)==font_row,'Installed dependency metadata differs')
 require(all(k==font or k in source['packages'] and v==source['packages'][k] for k,v in installed['packages'].items()),'Installed non-font package differs')
 require(all('node_modules/'+name in installed['packages'] for name in source['packages']['']['dependencies']),'Installed direct dependency missing')
 return True
def dependency_lock_evidence(lock,runtime,active,node_modules,capture):
 if sha(runtime)==sha(lock):return None
 require(sha(lock)==A3_LOCK_PINS['source'] and sha(runtime)==A3_LOCK_PINS['runtime'],'Dependency lock differs')
 require(capture['sources'].get('package-lock.json',{}).get('sha256')==A3_LOCK_PINS['runtime'],'Captured dependency lock differs')
 require(str(node_modules)=='/opt/proofofwork-api/node_modules' and node_modules.resolve()==node_modules,'Installed dependency root differs')
 installed_path=node_modules/'.package-lock.json';installed=read(installed_path,A3_LOCK_PINS['installed'],1024*1024)
 records={key:json.loads(read(v['path'],v['sha256'],8*1024**2)) for key,v in A3_LOCK_EVIDENCE.items()}
 require(records['plan']['sourceCommit']==BASE and records['plan']['runtimeManifestTemplate']['dependencies']['package-lock.json']==A3_LOCK_PINS['runtime'],'Accepted A3 plan differs')
 require(records['postInstall']['sourceCommit']==BASE and records['postInstall']['planSha256']==A3_LOCK_EVIDENCE['plan']['sha256'] and records['postInstall'].get('completeImportClosureVerified') is True and records['postInstall'].get('sourceMetadataVerified') is True,'Accepted A3 install differs')
 require(records['completion']['sourceCommit']==BASE and records['completion'].get('runtimeSourceModified') is False,'Accepted A3 completion differs')
 font_only_lock_semantics(json.loads(lock),json.loads(runtime),json.loads(installed))
 return {'model':'accepted-a3-font-only-lock-v1','reason':'Accepted A3 adds only Space Grotesk 5.3.0 and its root dependency while omitting root MIT metadata; replay dependencies are identical.','sourceLockSha256':sha(lock),'runtimeLock':{'path':str(active/'package-lock.json'),'sha256':sha(runtime)},'installedLock':{'path':str(installed_path),'sha256':sha(installed)},'nodeModulesPath':str(node_modules),'acceptedEvidence':A3_LOCK_EVIDENCE,'nonFontPackagesAndRootFieldsEqual':True,'installedNonFontPackagesEqual':True}

def build(a):
 repo=a.source_root.resolve();require(repo==a.source_root and COMMIT.fullmatch(a.source_commit) and COMMIT.fullmatch(a.source_tree),'Exact source required')
 def git(*args):return subprocess.check_output(['/usr/bin/git','--no-optional-locks','-C',str(repo),*args],timeout=15)
 require(git('rev-parse','HEAD').decode().strip()==a.source_commit and git('rev-parse','HEAD^{tree}').decode().strip()==a.source_tree and not git('status','--porcelain','--untracked-files=no').strip(),'Committed source changed')
 subprocess.run(['/usr/bin/git','--no-optional-locks','-C',str(repo),'merge-base','--is-ancestor',BASE,a.source_commit],check=True,timeout=15)
 raw=read(a.composition,a.composition_sha256,2*1024**2);c=json.loads(raw);require(c.get('format')=='proof-of-work-work-batch-replay-composition-v1' and c.get('sourceCommit')==a.source_commit and c.get('sourceTree')==a.source_tree and c.get('baseSourceCommit')==BASE,'Composition identity')
 capraw=read(a.capture,c['captureSha256'],90*1024**2);cap=json.loads(capraw)
 require(cap.get('format')=='proof-of-work-work-batch-replay-runtime-capture-v1' and cap.get('root')=='/opt/proofofwork-api' and isinstance(cap.get('sources'),dict),'Capture identity')
 require(cap.get('nodePath')==str(a.node_path) and cap.get('nodeSha256')==sha(read(a.node_path,limit=200*1024**2)),'Node capture changed')
 rows={x['path']:x for x in c['sources']};reviews={x['path']:x for x in c['reviews']};require(len(c['sources'])==6 and set(rows)==TARGETS and len(c['reviews'])==6 and set(reviews)==TARGETS and set(c['candidates'])==TARGETS,'Composition scope');active=a.composition.parent/'captured-runtime'
 for name,row in rows.items():
  relative(name);v=reviews[name];require(all(SHA.fullmatch(row[k])for k in ('before','after')) and v['before']==row['before'] and v['after']==row['after'] and v.get('syntaxVerified')is True and v.get('creationOnly')is False and (v.get('cleanThreeWayMerge')is True or isinstance(v.get('explicitResolution'),dict)),'Incomplete merge review')
  require(cap['sources'].get(name,{}).get('sha256')==row['before'],'Composition/capture before pin differs')
  base_sha=OLD_HELPER if name=='server/db/native-transition-storage.mjs' else sha(git('show',BASE+':'+name))
  require(v.get('baseSha256')==base_sha,'Composition base provenance')
  if name=='server/db/native-transition-storage.mjs':
   require(not git('ls-tree','--name-only',BASE,'--',name) and row['before']==OLD_HELPER,'Fixed existing native overlay base differs')
  require(sha(git('show',a.source_commit+':'+name))==v['repositoryCandidateSha256'],'Candidate Git provenance')
  resolution=v.get('explicitResolution')
  if resolution is not None:
   require(isinstance(resolution,dict) and all(resolution.get(key)==expected for key,expected in (
    ('path',name),('activeSha256',row['before']),('baseSha256',base_sha),
    ('repositoryCandidateSha256',v['repositoryCandidateSha256']),('mergedSha256',row['after']))),
    'Explicit merge provenance differs')
  read(active/name,row['before']);item=c['candidates'][name];require(item['sha256']==row['after'],'Candidate pin');read(Path(item['path']),row['after'])
 root=a.output_root;require(root.is_absolute() and root.parent.resolve()==root.parent and not root.exists(),'Fresh output root required');parent=root.parent.stat();require(parent.st_uid==os.getuid() and not parent.st_mode&0o077,'Private parent required');root.mkdir(mode=0o700)
 files={};todo=list(set(ROLES.values()))
 while todo:
  group,name=todo.pop();relative(name);key=group+'/'+name
  if key in files:continue
  require(len(files)<256,'Closure limit');commit=BASE if group=='baseline' else a.source_commit;b=git('show',commit+':'+name);require(len(b)<=4*1024**2,'Source size')
  if not name.startswith('deploy/') and name!='package.json' and name.endswith(('.mjs','.js','.json')):
   expected=rows[name]['after'] if group=='compatible' and name in rows else cap['sources'][name]['sha256'];require(sha(b)==expected,'Replay import differs from committed/captured bytes: '+key)
  save(root/key,b);files[key]={'sha256':sha(b),'bytes':len(b),'origin':{'commit':commit,'blob':git('rev-parse',commit+':'+name).decode().strip(),'path':name}}
  for m in IMPORT.finditer(b.decode()):
   dep=os.path.normpath(os.path.join(os.path.dirname(name),m[1]));relative(dep)
   if dep.endswith(('.mjs','.js','.json')):todo.append((group,dep))
 for group,commit in [('baseline',BASE),('compatible',a.source_commit)]:
  name='package.json';b=git('show',commit+':'+name)
  if group+'/'+name not in files:save(root/group/name,b)
  else:require(files[group+'/'+name]['sha256']==sha(b),'Package source differs')
  files[group+'/'+name]={'sha256':sha(b),'bytes':len(b),'origin':{'commit':commit,'blob':git('rev-parse',commit+':'+name).decode().strip(),'path':name}}
 old=read(active/'server/db/native-transition-storage.mjs',OLD_HELPER);key='accepted-overlay/server/db/native-transition-storage.mjs';save(root/key,old);files[key]={'sha256':OLD_HELPER,'bytes':len(old),'origin':{'acceptedOverlay':True,'expectedCatalogSha256':OLD_CONTRACT}}
 lock=git('show',a.source_commit+':package-lock.json');runtime_lock=read(active/'package-lock.json');dependency_evidence=dependency_lock_evidence(lock,runtime_lock,active,a.node_modules,cap);save(root/'package-lock.json',lock)
 require(a.node_modules.is_absolute() and a.node_modules.resolve()==a.node_modules and a.node_modules.is_dir(),'Canonical installed dependencies required');os.symlink(a.node_modules,root/'node_modules')
 roles={k:g+'/'+n for k,(g,n)in ROLES.items()};roles['nativeStorage']=key
 manifest={'format':'work-batch-replay-source-manifest-v1','sourceState':'committed','sourceRoot':str(repo),'sourceCommit':a.source_commit,'sourceTree':a.source_tree,'baselineSourceCommit':BASE,'root':str(root),'modules':roles,'files':dict(sorted(files.items())),'node':{'path':str(a.node_path),'sha256':cap['nodeSha256']},'packageRoot':str(root/'compatible'),'packageLock':{'path':str(root/'package-lock.json'),'sha256':sha(lock)},'nativeCatalogSha256':OLD_CONTRACT,'maxSuffixBlocks':512,'resourceLimits':{'maxNativePayloadBytes':8*1024**3,'maxRawBlockBytes':2*1024**3,'maxNativePayloadBytesPerBlock':128*1024**2,'maxQualificationReceiptBytes':32*1024**2,'maxOrdinaryRecords':1024},'runtimeSources':{n:r['after']for n,r in sorted(rows.items())},'compositionManifestSha256':sha(raw),'lineage':[{'path':str(a.composition),'sha256':sha(raw)}]}
 if dependency_evidence is not None:manifest['dependencyEvidence']=dependency_evidence
 require(read(a.composition,a.composition_sha256)==raw and read(a.capture,c['captureSha256'])==capraw,'Evidence changed');require(git('rev-parse','HEAD').decode().strip()==a.source_commit and not git('status','--porcelain','--untracked-files=no').strip(),'Source changed')
 data=(json.dumps(manifest,sort_keys=True,indent=2)+'\n').encode();save(root/'source-manifest.json',data);return {'path':str(root/'source-manifest.json'),'sha256':sha(data),'files':len(files),'productionMutation':False}
def main():
 p=argparse.ArgumentParser()
 for n in ('source-root','composition','capture','node-path','node-modules','output-root'):p.add_argument('--'+n,type=Path,required=True)
 for n in ('source-commit','source-tree','composition-sha256'):p.add_argument('--'+n,required=True)
 a=p.parse_args();require(SHA.fullmatch(a.composition_sha256),'Composition pin required');print(json.dumps(build(a),sort_keys=True))
if __name__=='__main__':main()
