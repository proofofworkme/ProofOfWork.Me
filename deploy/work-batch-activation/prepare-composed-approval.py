#!/usr/bin/python3 -I
'''Derive activation approval from the exact ordered, successful release receipts.
The old dormant-only generator remains unchanged. No live runtime hashes are read.
The runtime status digest is a separate, explicitly reviewed input.
'''
import argparse,base64,hashlib,json,os,re,stat,subprocess
from pathlib import Path,PurePosixPath
SHA=re.compile(r'[0-9a-f]{64}\Z');COMMIT=re.compile(r'[0-9a-f]{40}\Z')
B3='bca2efcbdb20bb8db811a0ac189fc6e37d1f1ac3';A3='eb0a2cf01b5173e14c710ed48c1a98b8d0a9ddee';BASE='c43cd395cf24701b080a2cf2a5c965d9c008a120'
TX='b7c620e48c2d725a143cecd7f7808036d89907124d410ba57d272d34e650cc28'
D_HASH='00000000000000000001fd3a7d7509d540d5e764e413d16acf9d07e090b8f47b'
HISTORICAL_PINS=(('bd6eb441fe9cad7547b434a728d762c9f4e7f42bc6ba2cd5b5be43af4fb08291','0f5656e337b7a6012a9c11cbe6b409552a377f689033f8a77967bd4339f674ca'),('6b06afd88c47f9c17057278e2ccb5329bf8af199e3698f870a89c88d685f8d87','1f1160c00c5e0305d2f31399dd3877d95c09be2a54c6c62bfb9ddb51c21be2f1'))
SCOPES=(frozenset({'server/proof-api.mjs','server/db/proof-index-reader.mjs','server/work-amo-v5-raw.mjs','scripts/backfill-proof-indexer.mjs','server/work-batch-declaration.mjs','server/work-batch-runtime.mjs','server/work-batch-selection.mjs','server/work-batch-transaction.mjs','server/db/work-batch-reader.mjs','src/shared/protocol/workBatch.mjs'}),frozenset({'server/proof-api.mjs','server/amo-browse-snapshot.mjs'}),frozenset({'scripts/backfill-proof-indexer.mjs','server/db/native-transition-storage.mjs','server/db/work-batch-reader.mjs','server/proof-api.mjs','server/work-amo-v5-raw.mjs','server/work-batch-declaration.mjs'}))
FORMATS=('proof-of-work-work-batch-sends-scoped-runtime-v1','proof-of-work-amo-browse-scoped-runtime-v1','proof-of-work-work-batch-replay-scoped-runtime-v1')
NEW=(frozenset({'server/work-batch-declaration.mjs','server/work-batch-runtime.mjs','server/work-batch-selection.mjs','server/work-batch-transaction.mjs','server/db/work-batch-reader.mjs','src/shared/protocol/workBatch.mjs'}),frozenset({'server/amo-browse-snapshot.mjs'}),frozenset())
SOURCE_FILES={'controllerSha256':'deploy/work-batch-activation/controller.py','probeSha256':'deploy/work-batch-activation/probe.mjs','dormantControllerSha256':'deploy/work-batch-sends/scoped-node.py','replayControllerSha256':'deploy/work-batch-replay/scoped-node.py'}
def require(v,m):
 if not v:raise ValueError(m)
def sha(b):return hashlib.sha256(b).hexdigest()
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def source_path(v):
 require(isinstance(v,str) and str(PurePosixPath(v))==v and not PurePosixPath(v).is_absolute() and not any(x in ('','.','..')for x in v.split('/')) and '\\'not in v and not any(ord(x)<32 for x in v),'Unsafe runtime path');return v
def metadata(v):
 require(isinstance(v,dict) and set(v)=={'uid','gid','mode'} and all(type(v[k])is int and v[k]>=0 for k in v) and v['mode']<=0o777 and not v['mode']&0o022,'Unsafe runtime metadata');return dict(v)
def read_pin(pin,limit=32*1024**2):
 require(isinstance(pin,dict) and isinstance(pin.get('path'),str) and SHA.fullmatch(pin.get('sha256','')),'Missing immutable input pin');p=Path(pin['path']);require(p.is_absolute() and p.resolve()==p,'Noncanonical evidence path')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  before=os.fstat(fd);require(stat.S_ISREG(before.st_mode) and before.st_uid==0 and not before.st_mode&0o022 and before.st_size<=limit,'Unsafe evidence file')
  with os.fdopen(fd,'rb',closefd=False)as f:b=f.read(limit+1)
  require(os.fstat(fd)==before and len(b)<=limit and sha(b)==pin['sha256'],'Evidence byte pin changed');return b
 finally:os.close(fd)
def successful(m,r,raw):
 require(r.get('format')==m['format'] and r.get('manifestSha256')==sha(raw) and all(r.get(k)==m.get(k)for k in ('sourceCommit','baselineHead','releaseId','baseSourceCommit')),'Release receipt identity differs')
 require(r.get('installed')is True and r.get('rolledBack')is False and isinstance(r.get('completedAt'),str) and r['completedAt'] and r.get('sourceWritesStarted')is True and not any(r.get(k)for k in ('errorClass','recoveryIncomplete','recoveryErrorClass','forwardRecoveryRequired','sourceRollbackProhibited')),'Release not successfully complete')
 require(r.get('sources')==[{k:x[k]for k in ('path','before','after')}for x in m['sources']] and r.get('sourceMetadata')==m['sourceMetadata'] and r.get('dependencyCount')==len(m['dependencies']),'Receipt source scope differs')
 if 'dependencyMetadata'in r:require(r['dependencyMetadata']==m['dependencyMetadata'],'Receipt dependency metadata differs')
 services=r.get('servicesAfter',{});require(set(services)=={'proofofwork-api.service','proofofwork-indexer-worker.service'} and all(x.get('ActiveState')=='active' and x.get('WorkingDirectory')=='/opt/proofofwork-api' and str(x.get('MainPID','')).isdigit() and int(x['MainPID'])>0 for x in services.values()),'Services not restored')
def validate_late(m,r,native_raw,qualification_raw,prior_raw,prepared_raw,replay_validator):
 pub=r.get('replayPublication',{});ref=r.get('boundaryAfterDrain',{});n=json.loads(native_raw);q=json.loads(qualification_raw);prior=json.loads(prior_raw);prepared=json.loads(prepared_raw)
 require(pub.get('sha256')==sha(native_raw) and pub.get('committed')is True and pub.get('postconditionsVerified')is True and ref.get('sha256')==sha(qualification_raw) and pub.get('qualificationSha256')==sha(qualification_raw),'Late native evidence pins differ')
 prepare_ref=r.get('publicationPrepared',{});require(prepare_ref.get('sha256')==sha(prepared_raw) and prepared.get('format')=='work-batch-native-supersession-dispatch-v1' and prepared.get('status')=='rendered-only' and prepared.get('committed')is False and SHA.fullmatch(prepared.get('manifestSha256','')) and SHA.fullmatch(prepared.get('sqlSha256','')) and all(prepare_ref.get(k)==prepared[k] and n.get(k)==prepared[k] for k in ('manifestSha256','sqlSha256')),'Prepared publication differs')
 require(n.get('format')=='work-batch-native-supersession-dispatch-v1' and n.get('status')=='committed' and n.get('committed')is True and n.get('postconditionsVerified')is True and n.get('commitSent')is True and n.get('returncode')==0 and n.get('fenceError')is None and n.get('manifestSha256')==pub.get('manifestSha256'),'Native commit not verified')
 native=n.get('result',{});require(native.get('format')=='work-batch-native-supersession-result-v1' and native.get('manifestSha256')==pub['manifestSha256'] and native.get('qualificationSha256')==sha(qualification_raw) and all(native.get(k)is True for k in ('originalArchivesRetained','oldChunksRetained','currentMetadataVerified','markerVerified')),'Native postconditions incomplete')
 require(q.get('format')=='work-batch-bounded-reseal-qualification-v3' and q.get('mode')=='after-drain' and q.get('sourceState')=='committed' and q.get('qualified')is True and q.get('readOnly')is True and q.get('liveModified')is False and q.get('earliestSelection',{}).get('verified')is True and q.get('fixedPrefixRemainsCanonical')is True,'Late qualification incomplete')
 require(q.get('sourceCommit')==m['sourceCommit'] and q.get('sourceTree')==m['sourceTree'] and q.get('runtimeSources')=={x['path']:x['after']for x in m['sources']} and q.get('sourceManifestSha256')==m['replaySourceManifest']['sha256'],'Late qualification source differs')
 require(q.get('priorManifestSha256')==r.get('boundaryBefore',{}).get('sha256')==sha(prior_raw) and prior.get('format')==q['format'] and prior.get('mode')=='before-drain' and prior.get('qualified')is True and prior.get('sourceState')=='committed','Before/after qualification binding missing')
 replay_validator['validate_cached_prefix'](prior,q,sha(prior_raw))
 marker=q.get('proposedMarker',{});decl=marker.get('declaration',{});expected={'txid':TX,'blockHeight':973103,'blockHash':D_HASH,'blockTransactionIndex':1621,'protocolVout':1,'recordOrdinal':0,'registryPaymentVout':2,'activationHeight':973104,'authorityScriptPubKey':'76a91499b91dd27a616a71c0a1e9db6a86ceb8cff284c588ac','registryAddress':'1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV','minimumPaymentSats':546,'payloadBytes':5965,'payloadSha256':'f1527f240dcc7210ef7bb5ebd33417fbecb1c8ea8dcc1b2bf2917f42b7e20ae4'}
 require(marker==native.get('marker') and marker.get('model')=='canonical-work-batch-v1-activation-marker-v1' and marker.get('network')=='livenet' and marker.get('activationHeight')==973104 and decl==expected and all(q.get('declaration',{}).get(k)==v for k,v in expected.items()),'Original declaration marker differs')
 require(q.get('declaration',{}).get('signatureVerified')is True and type(q['declaration'].get('inputPrevoutsVerified'))is int and q['declaration']['inputPrevoutsVerified']>0 and marker.get('evidenceCommitment')==q['declaration'].get('evidenceCommitment')=={'model':'canonical-work-batch-v1-authority-commitment-v1','payloadBytes':651,'sha256':'7304382c42414dfd4b37a289b19b7e23cf0c02d32fd681acaeeef7956f79c1bc'},'Declaration authority evidence missing')
 blocks=replay_validator['validate_qualification_bounds'](q);prefix=q['fixedPrefix'];require(pub.get('through')==prefix['through'] and pub.get('blocks')==len(blocks) and len(native.get('blocks',[]))==len(blocks),'Native suffix differs')
 for row,actual in zip(blocks,native['blocks']):
  require(all(actual.get(k)==row.get(k)for k in ('height','hash','oldNativeSha256','newNativeSha256')) and all(actual.get(k)is True for k in ('originalArchiveRetained','hotSlotVerified','currentMetadataVerified','originalScalarsVerified','historicalReadVerified','relationalRowsVerified')) and actual.get('cacheMode')==('hot'if row['height']>=prefix['through']-127 else 'cold'),'Published block differs')
 require(prefix.get('hash')==blocks[-1]['hash'],'Suffix final hash differs')
 require(marker.get('activationBlock',{}).get('height')==973104 and marker['activationBlock'].get('hash')==blocks[0]['hash'] and marker['activationBlock'].get('previousBlockHash')==D_HASH and marker['activationBlock'].get('transitionChainCommitment')==blocks[0]['replacementFields']['transitionChainCommitment'],'Activation block seal differs')
 status=r.get('writesDisabledStatus',{});require(status.get('protocol')=='work-batch-v1' and status.get('network')=='livenet' and status.get('active')is True and status.get('writeEnabled')is False and status.get('ready')is False and status.get('declarationTxid')==TX and status.get('activationHeight')==973104 and status.get('limits')=={'minRecipients':2,'maxRecipients':256,'maxPayloadBytes':65536} and status.get('registryFeeProofs')==546 and status.get('reasonCode')in('work-batch-writes-disabled','work-batch-work-writes-paused') and type(status.get('checkedTipHeight'))is int and status['checkedTipHeight']>=prefix['through'] and SHA.fullmatch(status.get('checkedTipHash','')),'Late postflight not active with writes disabled')
 if status['checkedTipHeight']==prefix['through']:require(status['checkedTipHash']==prefix['hash'],'Postflight tip differs')
 return {'publicationReceiptSha256':sha(native_raw),'qualificationSha256':sha(qualification_raw),'marker':marker,'through':prefix['through'],'postflight':status}
def derive(layers,source_commit,source_tree,source_hashes,status_sha,node_path,trees,is_ancestor,native_raw,qualification_raw,prior_raw,prepared_raw,replay_validator):
 require(len(layers)==3 and COMMIT.fullmatch(source_commit) and COMMIT.fullmatch(source_tree),'Exact three-layer composition required')
 require(SHA.fullmatch(status_sha) and re.fullmatch(r'/opt/node-[A-Za-z0-9._-]+/bin/node',node_path),'Separately reviewed status and Node path required')
 require(set(source_hashes)==set(SOURCE_FILES) and all(SHA.fullmatch(v)for v in source_hashes.values()),'Controller source pins incomplete')
 runtime={};evidence=[];head=node=None;previous=None;late=None
 for i,(mraw,rraw)in enumerate(layers):
  m=json.loads(mraw);r=json.loads(rraw);expected=(B3,A3,source_commit)[i];require(m.get('format')==FORMATS[i] and m.get('sourceCommit')==expected and m.get('baseSourceCommit')==(BASE if i<2 else A3),'Wrong ordered release layer')
  require(trees.get(expected) and COMMIT.fullmatch(trees[expected]) and (m.get('sourceTree')is None or m['sourceTree']==trees[expected]),'Release source tree differs')
  if i==2:require(m.get('sourceTree')==source_tree and r.get('sourceTree')==source_tree,'Late C/T differs')
  require(is_ancestor(BASE,expected) and (previous is None or is_ancestor(previous,expected)),'Source commits are not in release order');previous=expected
  require(COMMIT.fullmatch(m.get('baselineHead','')) and SHA.fullmatch(m.get('nodeSha256','')),'Runtime identity invalid')
  if i==0:head=m['baselineHead'];node=m['nodeSha256']
  require(m['baselineHead']==head and m['nodeSha256']==node,'Runtime HEAD or Node changed across layers')
  rows=m.get('sources',[]);require(len(rows)==len(SCOPES[i]) and {x.get('path')for x in rows}==SCOPES[i] and set(m.get('sourceMetadata',{}))==SCOPES[i],'Mutation scope differs')
  deps=m.get('dependencies',{});dm=m.get('dependencyMetadata',{});require(isinstance(deps,dict) and 1<=len(deps)<=2000 and set(deps)==set(dm) and {'package.json','package-lock.json'}<=set(deps),'Dependency closure incomplete')
  for name,pin in deps.items():
   source_path(name);require(SHA.fullmatch(pin),'Bad dependency digest');entry={'sha256':pin,**metadata(dm[name])}
   if i:require(name in runtime and runtime[name]==entry,'Dependency before closure diverges from approved after closure: '+name)
   else:runtime[name]=entry
  for row in rows:
   name=source_path(row['path']);meta=metadata(m['sourceMetadata'][name]);require(SHA.fullmatch(row.get('after','')),'Bad after digest');raw=base64.b64decode(row.get('base64',''),validate=True);require(len(raw)<=12*1024**2 and sha(raw)==row['after'],'Manifest candidate bytes differ')
   if name in NEW[i]:require(row.get('before')is None and name not in runtime,'Creation was not absent')
   else:require(isinstance(row.get('before'),str) and SHA.fullmatch(row['before']) and runtime.get(name)=={'sha256':row['before'],**meta},'Source before hash/metadata diverges: '+name)
   runtime[name]={'sha256':row['after'],**meta}
  successful(m,r,mraw)
  evidence.append({'format':m['format'],'sourceCommit':expected,'sourceTree':trees[expected],'manifestSha256':sha(mraw),'receiptSha256':sha(rraw),'releaseId':m['releaseId'],'scope':sorted(SCOPES[i])})
  if i==2:late=validate_late(m,r,native_raw,qualification_raw,prior_raw,prepared_raw,replay_validator)
 require(trees[source_commit]==source_tree,'Final source tree differs')
 return {'format':'work-batch-activation-approval-v1','sourceCommit':source_commit,'sourceTree':source_tree,'runtimeHead':head,'runtimeStatusSha256':status_sha,'deploymentManifestSha256':evidence[-1]['manifestSha256'],'deploymentReceiptSha256':evidence[-1]['receiptSha256'],**source_hashes,'node':{'path':node_path,'sha256':node},'runtime':dict(sorted(runtime.items())),'composition':{'model':'work-batch-activation-ordered-release-composition-v1','layers':evidence,'sha256':sha(canonical(evidence)),'replay':late}}
def validate_chain_references(chain):
 refs=chain.get('layers',[]);require(chain.get('format')=='work-batch-activation-composition-input-v1' and len(refs)==3,'Wrong chain input')
 for ref,(msha,rsha)in zip(refs,HISTORICAL_PINS):require(ref.get('manifest',{}).get('sha256')==msha and ref.get('receipt',{}).get('sha256')==rsha,'Historical release pins differ')
 return refs
def main():
 p=argparse.ArgumentParser()
 for name in ('chain','source-root','output'):p.add_argument('--'+name,type=Path,required=True)
 for name in ('chain-sha256','source-commit','source-tree','runtime-status-sha256','node-path'):p.add_argument('--'+name,required=True)
 a=p.parse_args();raw=read_pin({'path':str(a.chain),'sha256':a.chain_sha256},1024**2);chain=json.loads(raw);refs=validate_chain_references(chain)
 layers=[(read_pin(x['manifest']),read_pin(x['receipt']))for x in refs];late=json.loads(layers[-1][1]);native=read_pin(late['replayPublication'],2*1024**2);qualification=read_pin(late['boundaryAfterDrain'],32*1024**2);prior=read_pin(late['boundaryBefore'],32*1024**2);prepared=read_pin(late['publicationPrepared'],2*1024**2)
 repo=a.source_root;require(repo.is_absolute() and repo.resolve()==repo,'Canonical source root required')
 def git(*args):return subprocess.check_output(['/usr/bin/git','--no-optional-locks','-C',str(repo),*args],timeout=15)
 require(git('rev-parse','HEAD').decode().strip()==a.source_commit and git('rev-parse','HEAD^{tree}').decode().strip()==a.source_tree and not git('status','--porcelain','--untracked-files=no').strip(),'Final committed source changed')
 trees={commit:git('rev-parse',commit+'^{tree}').decode().strip()for commit in (B3,A3,a.source_commit)}
 def ancestor(old,new):return subprocess.run(['/usr/bin/git','--no-optional-locks','-C',str(repo),'merge-base','--is-ancestor',old,new],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15).returncode==0
 hashes={}
 for key,name in SOURCE_FILES.items():
  b=git('show',a.source_commit+':'+name);require(b==(repo/name).read_bytes(),'Activation source differs from committed bytes');hashes[key]=sha(b)
 require(git('show',B3+':'+SOURCE_FILES['dormantControllerSha256'])==git('show',a.source_commit+':'+SOURCE_FILES['dormantControllerSha256']),'Dormant helper changed')
 self_name='deploy/work-batch-activation/prepare-composed-approval.py';require(git('show',a.source_commit+':'+self_name)==Path(__file__).read_bytes(),'Approval preparer differs from committed source')
 validator_path=repo/SOURCE_FILES['replayControllerSha256'];validator_bytes=git('show',a.source_commit+':'+SOURCE_FILES['replayControllerSha256']);require(sha(validator_bytes)==hashes['replayControllerSha256'],'Replay validator pin differs');replay_validator={'__name__':'_composed_approval_replay_validator','__file__':str(validator_path)};exec(compile(validator_bytes,str(validator_path),'exec'),replay_validator)
 value=derive(layers,a.source_commit,a.source_tree,hashes,a.runtime_status_sha256,a.node_path,trees,ancestor,native,qualification,prior,prepared,replay_validator);value['composition']['inputSha256']=sha(raw);value['composition']['preparerSha256']=sha(Path(__file__).read_bytes())
 for ref,(mraw,rraw)in zip(refs,layers):require(read_pin(ref['manifest'])==mraw and read_pin(ref['receipt'])==rraw,'Release evidence changed during derivation')
 require(read_pin(late['replayPublication'],2*1024**2)==native and read_pin(late['boundaryAfterDrain'],32*1024**2)==qualification and read_pin(late['boundaryBefore'],32*1024**2)==prior and read_pin(late['publicationPrepared'],2*1024**2)==prepared,'Native evidence changed during derivation')
 require(git('rev-parse','HEAD').decode().strip()==a.source_commit and git('rev-parse','HEAD^{tree}').decode().strip()==a.source_tree and not git('status','--porcelain','--untracked-files=no').strip(),'Final source changed during derivation')
 require(all(sha((repo/name).read_bytes())==hashes[key] for key,name in SOURCE_FILES.items()) and git('show',a.source_commit+':'+self_name)==Path(__file__).read_bytes(),'Controller source changed during derivation')
 require(a.output.is_absolute() and a.output.parent.resolve()==a.output.parent and a.output.parent.stat().st_uid==0 and not a.output.parent.stat().st_mode&0o077,'Private output required');data=json.dumps(value,sort_keys=True,indent=2).encode()+b'\n';fd=os.open(a.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  with os.fdopen(fd,'wb',closefd=False)as f:f.write(data);f.flush();os.fsync(fd)
 finally:os.close(fd)
 print(json.dumps({'path':str(a.output),'sha256':sha(data),'sourceCommit':a.source_commit,'sourceTree':a.source_tree,'runtimeFiles':len(value['runtime']),'productionMutation':False},sort_keys=True))
if __name__=='__main__':main()
