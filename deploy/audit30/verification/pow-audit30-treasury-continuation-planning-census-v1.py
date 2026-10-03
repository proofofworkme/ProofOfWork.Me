#!/usr/bin/python3 -I
"""Fixed saved-corpus counts for planning; no RPC, raw export or continuation."""
import collections,hashlib,json,os,pathlib,re,resource,signal,stat,sys,types
P=pathlib.Path
CORPUS=P('/data/proofofwork-release-backups/audit30-treasury-address-20261003T031100Z/corpus.json')
CORPUS_SHA='8eeb467bf3468734beee934d884148b7045ed28803045a2b66ac51ca0f1e2596'
LEDGER=P('/usr/local/lib/proofofwork-audit30-treasury-address/20261003T031100Z/ledger-corpus-v2.py')
LEDGER_SHA='c37fb22836172254baaa8d2da125ff97fa25d7c955a0afa4c6b72accbe29cef7'
ADDRESSES=('1447TsdXtFSnVrWawSamyyQKPDNW4ALtBT','1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x','1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv')
def need(v):
 if not v:raise ValueError('SAVED_TREASURY_PLANNING_CENSUS_REFUSED')
def sha(b):return hashlib.sha256(b).hexdigest()
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def digest_set(v):return sha(enc(sorted(v)))
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d);d[k]=v
 return d
def metadata(s):return dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns,nlink=s.st_nlink)
def read_fixed(p,h,size,mode,gid=None):
 need(p.resolve(strict=True)==p and not os.listxattr(p,follow_symlinks=False));s=p.lstat();m=metadata(s)
 need(stat.S_ISREG(s.st_mode)and s.st_uid==0 and stat.S_IMODE(s.st_mode)==mode and s.st_nlink==1 and s.st_size==size and(gid is None or s.st_gid==gid))
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:
  need(metadata(os.fstat(f.fileno()))==m);raw=f.read(size+1);need(metadata(os.fstat(f.fileno()))==m)
 need(metadata(p.lstat())==m and len(raw)==size and sha(raw)==h);return raw,m
def summarize(v,L):
 need(v['schema']=='pow-audit30-treasury-address-corpus-v1'and v['addresses']==list(ADDRESSES)and v['productionMutation']is False and v['status']=='partial-integrity-refused')
 cp=v['chainBefore'];need(cp==v['electrsBefore']and type(cp['height'])is int and cp['height']>=0 and L.TXID.fullmatch(cp['hash']))
 targets=set();histories=[]
 for address in ADDRESSES:
  d=v['discovery'][address];rows=d['history'];need(isinstance(rows,list)and len(rows)<=5000);ids=set()
  for r in rows:need(set(r)=={'tx_hash','height'}and L.TXID.fullmatch(r['tx_hash'])and type(r['height'])is int and 0<r['height']<=cp['height']and r['tx_hash']not in ids);ids.add(r['tx_hash'])
  targets|=ids;histories.append(dict(rows=len(rows),txidSetSha256=digest_set(ids),storedUnspentRows=len(d['unspent']),storedUnspentProofs=sum(r['value']for r in d['unspent']),indexReportedConfirmedBalanceProofs=d['balance']['confirmed']))
 need(len(targets)<=12000);combined={};raw_keys={k:set(v[k])for k in('transactions','parents')}
 for key in('transactions','parents'):
  for txid,t in v[key].items():
   need(L.TXID.fullmatch(txid));p=L.parse_raw(t['rawHex']);need(p['txid']==txid==t['txid']and p['inputs']==t['inputs']and p['outputs']==t['outputs']and p['rawBytesSha256']==t['rawBytesSha256'])
   if txid in combined:need(combined[txid]['rawHex']==t['rawHex'])
   else:combined[txid]=t
 cached_targets=targets&set(combined);missing_targets=targets-set(combined);required_parents=set();prevouts=set();treasury_outputs=set();groups=collections.defaultdict(set);proof_present=set();source_block_missing=set();referenced_parent_missing=set()
 scripts={L.address_script(a)for a in ADDRESSES}
 for txid in cached_targets:
  t=combined[txid]
  for i in t['inputs']:
   if i['txid']=='0'*64:continue
   required_parents.add(i['txid']);prevouts.add((i['txid'],i['vout']))
   if i['txid']in combined:need(type(i['vout'])is int and 0<=i['vout']<len(combined[i['txid']]['outputs']))
   else:referenced_parent_missing.add(i['txid'])
  for o in t['outputs']:
   if o['scriptPubKey']in scripts:treasury_outputs.add((txid,o['vout']))
  block=t.get('blockHash');need(L.TXID.fullmatch(block or '')and type(t.get('confirmationsAtCapture'))is int and t['confirmationsAtCapture']>0);groups[block].add(txid)
  if block not in v['blocks']:source_block_missing.add(block);continue
  b=v['blocks'][block];need(type(b['height'])is int and 0<=b['height']<=cp['height']and L.header_proof(b['headerHex'])==block==b['canonicalHashAtCapture'])
  if 'coreInclusionProofHex'in t:
   proof=L.merkle_inclusion(t['coreInclusionProofHex']);need(proof['blockHash']==block and proof['matchedTxids']==t['coreVerifiedIncludedTxids']==[txid]);proof_present.add(txid)
 missing_after=sum('canonicalHashAfter'not in b for b in v['blocks'].values());batch64=sum((len(t)+63)//64 for t in groups.values())
 return dict(schema='pow-audit30-saved-treasury-continuation-planning-census-v1',checkpoint=cp,historyResponses=histories,unionTargetCount=len(targets),unionTargetSetSha256=digest_set(targets),cachedTargetRows=len(raw_keys['transactions']),cachedParentRows=len(raw_keys['parents']),duplicateRawCacheKeys=len(raw_keys['transactions']&raw_keys['parents']),allUniqueRawCacheRows=len(combined),allUniqueRawCacheSetSha256=digest_set(combined),targetIdsAlreadyInParentCache=len(targets&raw_keys['parents']),rawTargetsReusableAfterNewMembershipGate=len(cached_targets),missingTargetRawRows=len(missing_targets),missingTargetRawSetSha256=digest_set(missing_targets),knownTargetRequiredUniqueParentTxids=len(required_parents),knownTargetRequiredUniquePrevouts=len(prevouts),knownTargetRequiredParentsCached=len(required_parents&set(combined)),knownTargetRequiredParentsMissing=len(referenced_parent_missing),knownTargetRequiredParentsMissingSetSha256=digest_set(referenced_parent_missing),cachedTargetTreasuryOutputCount=len(treasury_outputs),cachedTargetTreasuryOutputSetSha256=sha(enc(sorted(treasury_outputs))),cachedTargetConfirmedBlockGroups=len(groups),cachedTargetBlockGroupSizeHistogram=[dict(size=n,groups=c)for n,c in sorted(collections.Counter(len(g)for g in groups.values()).items())],cachedTargetOfflineSingleMerkleProofs=len(proof_present),cachedTargetsRequiringMerkleProof=len(cached_targets-proof_present),cachedBlockHeaderRows=len(v['blocks']),cachedTargetGroupsWithoutHeader=len(source_block_missing),originalBlocksWithoutClosingHash=missing_after,upperBound64TargetMembershipProofCallsForCachedTargets=2*batch64,actualMissingParentsForUncapturedTargetsUnknown=True,planningOnly=True,currentBalanceClaim=False,financialReconciliationComplete=False,obligationReconciliationComplete=False,independentWholeChainAddressHistoryComplete=False,may9OperatorSettlementPreserved=True,may9TransactionIDsRequested=False,productionMutation=False,rawTransactionsExported=False,rpcCalls=0)
class CensusInterrupted(RuntimeError):pass
def main():
 need(sys.flags.isolated and len(sys.argv)==1 and os.geteuid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01');resource.setrlimit(resource.RLIMIT_AS,(512*1024**2,512*1024**2));resource.setrlimit(resource.RLIMIT_CPU,(40,40));signal.signal(signal.SIGALRM,lambda *_:(_ for _ in()).throw(CensusInterrupted()));signal.alarm(60)
 raw,m=read_fixed(CORPUS,CORPUS_SHA,17672203,0o600,0);code,lm=read_fixed(LEDGER,LEDGER_SHA,34250,0o440);L=types.ModuleType('frozen-c37f');exec(compile(code,str(LEDGER),'exec'),L.__dict__);out=summarize(json.loads(raw,object_pairs_hook=pairs),L)
 need(metadata(CORPUS.lstat())==m and metadata(LEDGER.lstat())==lm);out.update(rawCorpusSha256=CORPUS_SHA,rawCorpusMetadata=m,ledgerUtilitySha256=LEDGER_SHA,rawCorpusPreserved=True);signal.alarm(0);print(json.dumps(out,sort_keys=True))
if __name__=='__main__':
 try:main()
 except BaseException as e:print(json.dumps(dict(status='refused',errorClass=type(e).__name__,rawDetailsSuppressed=True,rpcCalls=0,productionMutation=False)),file=sys.stderr);raise SystemExit(1)
