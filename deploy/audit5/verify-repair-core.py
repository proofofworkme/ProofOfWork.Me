#!/usr/bin/python3 -I
"""Read-only full-node proof for exactly the four approved audit-5 repair targets.

Run privately on the node before the stopped-writer repair window. Uses only
SELECT and fixed read-only bitcoin-cli methods; requires existing root/sudo access.
This preflight does not replace the stopped-writer before/after invariant gate.
"""
import datetime,decimal,hashlib,json,subprocess
D=decimal.Decimal
aux='4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359'
expected={3607561:'6ac53aca33541d60d6d58af03d4c27d09bbeaab3e3c016ee10d270aad578957c',3621078:'8eaa4098c631bded37ce40d88778cce53a6d00b2d4f3eb783d2b9713fc9951cc',3747805:'9e202c0fae0f3ab500325fc7a5326dda1d68c8500c85fe51cb18385e7d8aeab0'}
environment={'PATH':'/usr/local/bin:/usr/bin:/bin','LANG':'C.UTF-8'}
def run(argv):
 r=subprocess.run(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=30,env=environment)
 if r.returncode:raise RuntimeError('Read-only preflight command failed: '+argv[0])
 return r.stdout
def core(method,*args):
 assert method in ('getblockchaininfo','getblockhash','getblock','getblockheader','getrawtransaction')
 raw=run(['/usr/bin/sudo','-n','-u','bitcoin','/usr/local/bin/bitcoin-cli','-conf=/etc/bitcoin/bitcoin.conf',method,*map(str,args)])
 if method=='getblockhash':
  value=raw.strip();assert len(value)==64 and all(c in '0123456789abcdef' for c in value);return value
 return json.loads(raw,parse_float=D)
def sats(value):
 n=D(value)*D(100000000);assert n==n.to_integral_value() and n>=0;return str(int(n))
def fingerprint(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),default=str).encode()).hexdigest()
sql="""BEGIN READ ONLY; SET LOCAL statement_timeout='15s'; SELECT jsonb_build_object(
'aux',(SELECT to_jsonb(t)-'raw_tx' FROM proof_indexer.transactions t WHERE network='livenet' AND txid='4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359'),
'events',(SELECT jsonb_agg(to_jsonb(e) || jsonb_build_object('block_hash',t.block_hash,'transaction_block_height',t.block_height,'transaction_block_index',t.block_index) ORDER BY e.event_id) FROM proof_indexer.events e JOIN proof_indexer.transactions t ON t.network=e.network AND t.txid=e.txid WHERE e.network='livenet' AND e.event_id IN(3607561,3621078,3747805)),
'anchors',(SELECT jsonb_agg(jsonb_build_object('txid',txid,'vout',vout,'spentByVin',spent_by_vin,'spentByTxid',spent_by_txid,'valueSats',value_sats::text,'scriptPubKey',scriptpubkey) ORDER BY txid,vout) FROM proof_indexer.tx_outputs WHERE network='livenet' AND spent_by_txid='4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359'));
COMMIT;"""
db=json.loads(run(['/usr/bin/sudo','-n','-u','postgres','/usr/bin/psql','-X','-qAt','-v','ON_ERROR_STOP=1','-d','proof_indexer','-c',sql]),parse_float=D)
before=core('getblockchaininfo');assert not before['initialblockdownload']
assert db['aux']['txid']==aux and db['aux']['block_height']==962992 and db['aux']['block_index']==1161 and len(db['anchors'])==5
assert db['aux']['block_hash']=='00000000000000000000635d4ae72706ed6d6f4a17299714a3014074d441824b'
assert len(db['events'])==3 and {r['event_id']:r['txid'] for r in db['events']}==expected
for e in db['events']:
 assert e['valid'] is False and e['status']=='confirmed' and e['kind']=='token-listing-sealed-invalid' and e['amount_sats']==0
 assert e['block_height']==e['transaction_block_height'] and e['block_index']==e['transaction_block_index']
 p=e['payload'];assert p['amount']=='0' and type(p['amountSats']) is int and p['amountSats']==0 and p['reasonCode']=='work-amo-v6-listing-already-sealed'
 assert p['saleAuthorization']['version']=='pwt-sale-v8' and all(k not in p for k in ['amountSubatoms','decimals','unitScale','amountStorageModel','precisionModel'])
records=[];raw_aux=None
for row in [db['aux'],*db['events']]:
 txid=row['txid'];raw=core('getrawtransaction',txid,'true');assert raw['txid']==txid and raw['confirmations']>0 and raw['blockhash']==row['block_hash']
 header=core('getblockheader',raw['blockhash']);height=header['height'];assert height==row['block_height']
 assert core('getblockhash',height)==raw['blockhash']
 block=core('getblock',raw['blockhash'],1);index=block['tx'].index(txid)
 if row.get('block_index') is not None:assert index==row['block_index']
 carriers=[{'vout':v['n'],'script':v['scriptPubKey']['hex']} for v in raw['vout'] if v['scriptPubKey']['hex'].startswith('6a')]
 assert carriers
 records.append({'txid':txid,'height':height,'blockHash':raw['blockhash'],'blockIndex':index,'coreVerboseResponseSha256':fingerprint(raw),'transactionHexSha256':hashlib.sha256(bytes.fromhex(raw['hex'])).hexdigest(),'opReturns':carriers,'joinedDatabaseProofRowSha256':fingerprint(row)})
 if txid==aux:raw_aux=raw
assert len(raw_aux['vin'])==6 and len(raw_aux['vout'])==2
inputs=[]
for vin,item in enumerate(raw_aux['vin']):
 parent=core('getrawtransaction',item['txid'],'true');output=parent['vout'][item['vout']];assert output['n']==item['vout']
 inputs.append({'vin':vin,'prevTxid':item['txid'],'prevVout':item['vout'],'valueSats':sats(output['value']),'scriptPubKey':output['scriptPubKey']['hex'],'parentCoreVerboseResponseSha256':fingerprint(parent),'parentTransactionHexSha256':hashlib.sha256(bytes.fromhex(parent['hex'])).hexdigest()})
for link in db['anchors']:
 item=inputs[link['spentByVin']];assert (link['txid'],link['vout'],link['valueSats'],link['scriptPubKey'])==(item['prevTxid'],item['prevVout'],item['valueSats'],item['scriptPubKey'])
outputs=[{'vout':v['n'],'valueSats':sats(v['value']),'scriptPubKey':v['scriptPubKey']['hex']} for v in raw_aux['vout']]
total_in=sum(int(v['valueSats']) for v in inputs);total_out=sum(int(v['valueSats']) for v in outputs)
assert total_out==3118 and total_in>=total_out
after=core('getblockchaininfo')
report={'format':'audit5-four-target-core-preflight-v1','ok':True,'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'coreBefore':{'height':before['blocks'],'hash':before['bestblockhash']},'coreAfter':{'height':after['blocks'],'hash':after['bestblockhash']},'targets':records,'auxiliaryInputs':inputs,'auxiliaryOutputs':outputs,'auxiliaryInputProofs':str(total_in),'auxiliaryOutputProofs':str(total_out),'auxiliaryMinerFeeProofs':str(total_in-total_out),'preservedAnchors':db['anchors'],'invalidZeroEvents':[{'eventId':e['event_id'],'txid':e['txid'],'valid':e['valid'],'amountSats':str(e['amount_sats']),'rowSha256':fingerprint(e)} for e in db['events']],'qualification':'Read-only historical canonical target and parent proofs; stopped-writer before/after invariants and repair writer Core verification remain required.'}
print(json.dumps(report,indent=2,default=str))
