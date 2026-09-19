#!/usr/bin/python3 -I
"""Normalize only inconsistent INCB decimal aliases; never change exact issuance."""
import concurrent.futures, decimal, gzip, hashlib, json, os, pathlib, re, runpy, sys
HELPER=pathlib.Path('/var/tmp/proofofwork-deploy/audit17-tools/repair-aux-raw-v3.py')
assert hashlib.sha256(HELPER.read_bytes()).hexdigest()=='89eaebdaf5d8b62184259960527a6b8bc360f7b607347a9de7d63e467953b832'
h=runpy.run_path(str(HELPER),run_name='helpers')
core,sql,literal,encoded,save=(h[k] for k in ('core','sql','literal','encoded','save'))
TOKEN='3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d'
NAMES=['attachedWorkLiveFloorAtSend','attachedWorkLiveValueAtSend','issuanceDust','issuanceNetworkValue','issuanceValueSnapshotWorkNetworkValue']
KEYS=[n+'Sats' for n in NAMES]
KEYSQL='ARRAY['+','.join(literal(k) for k in KEYS)+']::text[]'
def readrows():
 return json.loads(sql("SET statement_timeout='15s'; SELECT jsonb_agg(jsonb_build_object('eventId',e.event_id::text,'txid',e.txid,'payload',e.payload,'updatedAt',e.updated_at,'height',t.block_height,'index',t.block_index,'hash',t.block_hash,'rawHex',COALESCE(t.raw_hex,t.raw_tx->>'hex'),'rowHash',encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex'),'invariantHash',encode(sha256(convert_to((to_jsonb(e)-'payload'-'updated_at')::text || (e.payload-"+KEYSQL+")::text,'UTF8')),'hex')) ORDER BY e.event_id) FROM proof_indexer.events e JOIN proof_indexer.transactions t USING(network,txid) WHERE e.network='livenet' AND e.status='confirmed' AND t.status='confirmed' AND e.valid AND e.kind='token-mint' AND e.payload->>'tokenId'="+literal(TOKEN)+';'))
def integer(value):
 assert isinstance(value,(str,int)) and re.fullmatch(r'0|[1-9][0-9]*',str(value));return int(value)
def text(q):
 whole,fraction=divmod(q,100000000);return str(whole)+(('.'+str(fraction).zfill(8).rstrip('0')) if fraction else '')
def prove(row,root):
 p=row['payload']; txid=row['txid']; assert p['txid']==txid and p['sourceBondTxid']==txid
 assert p['confirmed'] is True and p['valid'] is True and p['tokenId']==TOKEN
 issuance=integer(p['issuanceNetworkValueQ8']); amount=integer(p['amount']);dust=integer(p['issuanceDustQ8']);payment=integer(p['proofPaymentSats'])
 assert issuance==payment*100000000+integer(p['attachedWorkLiveValueAtSendQ8'])
 assert divmod(issuance,100000000)==(amount,dust) and integer(p['confirmedIssuanceUnits'])==amount
 assert p['issuanceCheckpointBlockHash']==row['hash'] and integer(p['issuanceCheckpointBlockHeight'])==row['height'] and integer(p['issuanceCheckpointBlockIndex'])==row['index']
 assert core('getblockhash',row['height'])==row['hash']
 block=json.loads(core('getblock',row['hash'],1));assert block['confirmations']>=6 and block['tx'][row['index']]==txid
 rawtext=core('getrawtransaction',txid,2,row['hash']);raw=json.loads(rawtext,parse_float=decimal.Decimal)
 assert raw['hex']==row['rawHex'] and h['raw_txid'](raw['hex'])==txid and raw['blockhash']==row['hash']
 output=raw['vout'][integer(p['bondRecipientVout'])]
 assert output['scriptPubKey']['address']==p['bondRecipientAddress'] and h['sats'](output['value'])==payment
 with gzip.open(root/(txid+'.core.json.gz'),'xb') as f:f.write(rawtext.encode())
 patch={};old={};absent=[]
 for name in NAMES:
  exact=integer(p[name+'Q8']);key=name+'Sats'
  try:equivalent=decimal.Decimal(str(p.get(key)))*100000000==exact
  except decimal.InvalidOperation:equivalent=False
  if not equivalent:
   patch[key]=text(exact)
   if key in p:old[key]=p[key]
   else:absent.append(key)
 return {**row,'patch':patch,'oldAliases':old,'absentAliases':absent}
def statements(rows):
 data=[{k:v for k,v in r.items() if k not in ('payload','rawHex')} for r in rows]
 start="BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; LOCK TABLE proof_indexer.events,proof_indexer.transactions,proof_indexer.blocks IN SHARE ROW EXCLUSIVE MODE; CREATE TEMP TABLE audit17_aliases ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset("+literal(encoded(data))+"::jsonb) AS r(\"eventId\" text,\"rowHash\" text,\"invariantHash\" text,patch jsonb,\"oldAliases\" jsonb,\"absentAliases\" jsonb,\"updatedAt\" timestamptz,hash text,height integer);\n"
 guard="DO $aliases$ BEGIN IF (SELECT count(*) FROM proof_indexer.events e JOIN audit17_aliases r ON e.event_id=r.\"eventId\"::bigint WHERE encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex')=r.\"rowHash\")<>"+str(len(rows))+" THEN RAISE EXCEPTION 'snapshot changed'; END IF; IF EXISTS(SELECT 1 FROM audit17_aliases r LEFT JOIN proof_indexer.blocks b ON b.network='livenet' AND b.height=r.height AND b.block_hash=r.hash AND b.canonical WHERE b.block_hash IS NULL) THEN RAISE EXCEPTION 'canonical block changed'; END IF; END $aliases$;\n"
 update='UPDATE proof_indexer.events e SET payload=e.payload || r.patch,updated_at=now() FROM audit17_aliases r WHERE e.event_id=r."eventId"::bigint;\n'
 reverse="DO $aliases$ BEGIN IF (SELECT count(*) FROM proof_indexer.events e JOIN audit17_aliases r ON e.event_id=r.\"eventId\"::bigint WHERE encode(sha256(convert_to((to_jsonb(e)-'payload'-'updated_at')::text || (e.payload-"+KEYSQL+")::text,'UTF8')),'hex')=r.\"invariantHash\" AND e.payload @> r.patch)<>"+str(len(rows))+" THEN RAISE EXCEPTION 'rollback guard changed'; END IF; END $aliases$;\nUPDATE proof_indexer.events e SET payload=(e.payload-ARRAY(SELECT jsonb_array_elements_text(r.\"absentAliases\"))) || r.\"oldAliases\",updated_at=r.\"updatedAt\" FROM audit17_aliases r WHERE e.event_id=r.\"eventId\"::bigint;\n"
 return start+guard+update,start+reverse,reverse

def main():
 assert sys.flags.isolated and os.geteuid()==0 and len(sys.argv)==3 and sys.argv[1] in ('plan','check','apply')
 assert h['command'](['git','-c','safe.directory=/opt/proofofwork-api','-C','/opt/proofofwork-api','rev-parse','HEAD'])=='07929dd3c6e422fa1955c6cbf07007330eca0519'
 mode=sys.argv[1];root=pathlib.Path(sys.argv[2]);os.umask(0o077)
 assert re.fullmatch(r'/data/proofofwork-audit17-incb-aliases-[0-9TZ]+',str(root))
 if mode=='plan':
  root.mkdir(mode=0o700);before=readrows();assert 0<len(before)<=100;save(root/'before.json',before)
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:rows=list(pool.map(lambda r:prove(r,root),before))
  save(root/'plan.json',{'rows':[r for r in rows if r['patch']],'checked':len(rows)})
  print(encoded({'ok':True,'mode':mode,'checked':len(rows),'rows':sum(bool(r['patch']) for r in rows),'planSha256':hashlib.sha256((root/'plan.json').read_bytes()).hexdigest()}));return
 assert root.is_dir() and not root.is_symlink() and root.stat().st_uid==0
 rows=json.loads((root/'plan.json').read_text())['rows'];assert 0<len(rows)<=100
 current={r['eventId']:r for r in readrows()}
 assert all(current[r['eventId']]['rowHash']==r['rowHash'] for r in rows)
 for height,blockhash in set((r['height'],r['hash']) for r in rows):assert core('getblockhash',height)==blockhash
 forward,rollback,reverse=statements(rows)
 if mode=='check':
  sql(forward+reverse+'ROLLBACK;');assert readrows()==list(current.values())
  save(root/'check.json',{'ok':True,'controllerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()});print(encoded({'ok':True,'mode':mode,'rows':len(rows),'rolledBack':True}));return
 checked=json.loads((root/'check.json').read_text());assert checked['ok'] and checked['controllerSha256']==hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
 for name,content in [('apply.sql',forward),('rollback.sql',rollback)]:
  with (root/name).open('x') as f:f.write(content+'COMMIT;\n');f.flush();os.fsync(f.fileno())
 os.sync();sql(forward+'COMMIT;');after=readrows();save(root/'after.json',after);byid={r['eventId']:r for r in after}
 for row in rows:
  a=byid[row['eventId']];assert a['invariantHash']==row['invariantHash'] and all(a['payload'][k]==v for k,v in row['patch'].items())
 result={'ok':True,'mode':mode,'rows':len(rows),'changedAliases':sum(len(r['patch']) for r in rows),'exactEconomicFieldsUnchanged':True}
 save(root/'receipt.json',result);print(encoded(result))
if __name__=='__main__':main()
