#!/usr/bin/python3 -I
"""Apply the pinned canonical relation/mail delta; never edit source events."""
import concurrent.futures,gzip,hashlib,json,os,pathlib,runpy,sys
HELPER=pathlib.Path('/var/tmp/proofofwork-deploy/audit17-tools/repair-aux-raw-v3.py')
assert hashlib.sha256(HELPER.read_bytes()).hexdigest()=='89eaebdaf5d8b62184259960527a6b8bc360f7b607347a9de7d63e467953b832'
h=runpy.run_path(str(HELPER),run_name='helpers')
core,sql,literal,encoded,save=(h[k] for k in ('core','sql','literal','encoded','save'))
ROOT=pathlib.Path('/data/proofofwork-audit17-relations-mail-20260919T155300Z')
PLAN_SHA='fa2ae7d30907f6a60056571bd4967cd4df9b4946d414a7c7888c9c02f15fcac4'
def proof(event):
 txid=event['txid'];blockhash=core('getblockhash',event['height']);assert blockhash==event['hash']
 block=json.loads(core('getblock',blockhash,1));assert block['confirmations']>=6 and block['tx'][event['index']]==txid
 rawtext=core('getrawtransaction',txid,2,blockhash);raw=json.loads(rawtext)
 assert raw['hex']==event['rawHex'] and h['raw_txid'](raw['hex'])==txid and raw['blockhash']==blockhash
 with gzip.open(ROOT/(event['event_id']+'.core.json.gz'),'xb') as f:f.write(rawtext.encode())
 return {'eventId':event['event_id'],'txid':txid,'height':event['height'],'hash':blockhash,'coreSha256':hashlib.sha256(rawtext.encode()).hexdigest()}
def statements(plan):
 start="BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; LOCK TABLE proof_indexer.events,proof_indexer.event_participants,proof_indexer.event_refs,proof_indexer.mail_items,proof_indexer.blocks IN SHARE ROW EXCLUSIVE MODE;\nDO $delta$ BEGIN\n"
 forward=[];reverse=[]
 for e in plan['targets']:
  forward.append("IF NOT EXISTS(SELECT 1 FROM proof_indexer.events e WHERE event_id="+e['event_id']+" AND encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex')="+literal(e['rowHash'])+") THEN RAISE EXCEPTION 'source event changed'; END IF;")
  forward.append("IF NOT EXISTS(SELECT 1 FROM proof_indexer.blocks WHERE network='livenet' AND height="+str(e['height'])+" AND block_hash="+literal(e['hash'])+" AND canonical) THEN RAISE EXCEPTION 'block changed'; END IF;")
 for kind,d in plan['delta'].items():
  table='event_participants' if kind=='participants' else 'event_refs'
  columns=['event_id','address','role','powid'] if kind=='participants' else ['event_id','ref_type','ref_value']
  for action,rows in d.items():
   for row in rows:
    values=[row.get(k) for k in columns]
    if kind=='participants' and values[-1]=='':values[-1]=None
    vals=[('NULL' if v is None else literal(str(v))) for v in values]
    where=' AND '.join(k+' IS NOT DISTINCT FROM '+v+('::bigint' if k=='event_id' else '') for k,v in zip(columns,vals))
    insert='INSERT INTO proof_indexer.'+table+' ('+','.join(columns)+') VALUES ('+','.join(vals)+');'
    delete='DELETE FROM proof_indexer.'+table+' WHERE '+where+"; IF NOT FOUND THEN RAISE EXCEPTION 'relation changed'; END IF;"
    forward.append(delete if action=='remove' else insert)
    reverse.insert(0,insert if action=='remove' else delete)
 for m in plan['mailDelta']:
  txid=literal(m['txid']);before=m['before'];old=literal(encoded(before['message']))+'::jsonb'
  event=next(e for e in plan['targets'] if e['txid']==m['txid'] and e['protocol']=='pwm1')
  forward.append("IF NOT EXISTS(SELECT 1 FROM proof_indexer.mail_items m WHERE network='livenet' AND txid="+txid+" AND encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex')="+literal(before['rowHash'])+") THEN RAISE EXCEPTION 'mail changed'; END IF;")
  forward.append("IF NOT EXISTS(SELECT 1 FROM proof_indexer.mail_items m JOIN proof_indexer.events e ON e.event_id="+event['event_id']+" WHERE m.network='livenet' AND m.txid="+txid+" AND m.message-'attachedCredits'=e.payload-'attachedCredits') THEN RAISE EXCEPTION 'mail difference beyond attachments'; END IF;")
  forward.append("UPDATE proof_indexer.mail_items m SET message=e.payload FROM proof_indexer.events e WHERE e.event_id="+event['event_id']+" AND m.network='livenet' AND m.txid="+txid+';')
  reverse.insert(0,"UPDATE proof_indexer.mail_items m SET message="+old+" FROM proof_indexer.events e WHERE e.event_id="+event['event_id']+" AND m.network='livenet' AND m.txid="+txid+" AND m.message=e.payload; IF NOT FOUND THEN RAISE EXCEPTION 'mail rollback changed'; END IF;")
 assert all('$delta$' not in s for s in forward+reverse)
 # Rollback also requires the exact unchanged event sources.
 guards=forward[:len(plan['targets'])*2]
 return start+'\n'.join(forward)+'\nEND $delta$;\n', start+'\n'.join(guards+reverse)+'\nEND $delta$;\n','\n'.join(reverse)
def snapshot(plan):
 ids=','.join(e['event_id'] for e in plan['targets'])
 return json.loads(sql("SET statement_timeout='15s'; SELECT jsonb_build_object('events',(SELECT jsonb_agg(jsonb_build_array(event_id,encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex')) ORDER BY event_id) FROM proof_indexer.events e WHERE event_id IN ("+ids+")),'participants',(SELECT jsonb_agg(to_jsonb(p) ORDER BY event_id,address,role) FROM proof_indexer.event_participants p WHERE event_id IN ("+ids+")),'refs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY event_id,ref_type,ref_value) FROM proof_indexer.event_refs r WHERE event_id IN ("+ids+")),'mail',(SELECT jsonb_agg(to_jsonb(m) ORDER BY txid) FROM proof_indexer.mail_items m WHERE network='livenet' AND txid IN (SELECT txid FROM proof_indexer.events WHERE event_id IN ("+ids+"))));"))
def main():
 assert sys.flags.isolated and os.geteuid()==0 and len(sys.argv)==2 and sys.argv[1] in ('prove','check','apply')
 assert h['command'](['git','-c','safe.directory=/opt/proofofwork-api','-C','/opt/proofofwork-api','rev-parse','HEAD'])=='07929dd3c6e422fa1955c6cbf07007330eca0519'
 os.umask(0o077);assert ROOT.is_dir() and not ROOT.is_symlink() and ROOT.stat().st_uid==0
 assert hashlib.sha256((ROOT/'plan.json').read_bytes()).hexdigest()==PLAN_SHA
 p=json.loads((ROOT/'plan.json').read_text());mode=sys.argv[1]
 assert len(p['targets'])==49 and len(p['mailDelta'])==46
 assert [len(p['delta'][kind][op]) for kind in ('participants','refs') for op in ('add','remove')]==[2,45,3,0]
 for m in p['mailDelta']:
  old=m['before']['message'].get('attachedCredits',[]);new=m['expected']['message'].get('attachedCredits',[]);assert isinstance(old,list) and isinstance(new,list) and len(old)==len(new)
  for a,b in zip(old,new):
   assert {k:v for k,v in a.items() if k not in ('paidSats','registryAddress')}==b,'Economic attachment change refused'
 if mode=='prove':
  save(ROOT/'before-apply.json',snapshot(p))
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:proofs=list(pool.map(proof,p['targets']))
  save(ROOT/'core-proofs.json',proofs);print(encoded({'ok':True,'mode':mode,'events':49}));return
 proofs=json.loads((ROOT/'core-proofs.json').read_text());assert len(proofs)==49
 for height,blockhash in set((r['height'],r['hash']) for r in proofs):assert core('getblockhash',height)==blockhash
 before=json.loads((ROOT/'before-apply.json').read_text());assert snapshot(p)==before
 forward,rollback,reverse=statements(p)
 if mode=='check':
  # Run real forward and reverse operations inside one rolled-back transaction.
  checks='\n'.join("IF NOT EXISTS(SELECT 1 FROM proof_indexer.mail_items m WHERE network='livenet' AND txid="+literal(m['txid'])+" AND encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex')="+literal(m['before']['rowHash'])+") THEN RAISE EXCEPTION 'reverse did not restore exact mail'; END IF;" for m in p['mailDelta'])
  sql(forward.removesuffix('END $delta$;\n')+reverse+'\n'+checks+'\nEND $delta$; ROLLBACK;')
  assert snapshot(p)==before
  save(ROOT/'check.json',{'ok':True,'controllerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()});print(encoded({'ok':True,'mode':mode,'rolledBack':True}));return
 checked=json.loads((ROOT/'check.json').read_text());assert checked['ok'] and checked['controllerSha256']==hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
 for name,content in [('apply.sql',forward),('rollback.sql',rollback)]:
  with (ROOT/name).open('x') as f:f.write(content+'COMMIT;\n');f.flush();os.fsync(f.fileno())
 os.sync();sql(forward+'COMMIT;');after=snapshot(p);save(ROOT/'after.json',after);assert after['events']==before['events']
 result={'ok':True,'mode':mode,'removedParticipants':45,'addedParticipants':2,'addedRefs':3,'mailMessages':46,'sourceEventsUnchanged':True}
 save(ROOT/'receipt.json',result);print(encoded(result))
if __name__=='__main__':main()
