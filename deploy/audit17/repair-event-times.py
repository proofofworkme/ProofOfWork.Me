#!/usr/bin/python3 -I
"""Restore only missing event timestamps from Core-proven parent block positions."""
import concurrent.futures, datetime, gzip, hashlib, json, os, pathlib, re, runpy, sys
HELPER=pathlib.Path('/var/tmp/proofofwork-deploy/audit17-tools/repair-aux-raw-v3.py')
assert hashlib.sha256(HELPER.read_bytes()).hexdigest()=='89eaebdaf5d8b62184259960527a6b8bc360f7b607347a9de7d63e467953b832'
h=runpy.run_path(str(HELPER),run_name='helpers')
core,sql,literal,encoded,save=(h[k] for k in ('core','sql','literal','encoded','save'))
FIELDS="""jsonb_build_object('eventId',e.event_id::text,'txid',e.txid,
'kind',e.kind,'status',e.status,'valid',e.valid,'height',e.block_height,'index',e.block_index,
'blockTime',e.block_time,'eventTime',e.event_time,'updatedAt',e.updated_at,
'rowHash',encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex'),
'invariantHash',encode(sha256(convert_to((to_jsonb(e)-'block_time'-'event_time'-'updated_at')::text,'UTF8')),'hex'),
'parentHash',t.block_hash,'parentHeight',t.block_height,'parentIndex',t.block_index,
'parentTime',t.block_time,'parentStatus',t.status)"""
def readrows(ids=None):
    condition="e.valid AND e.status='confirmed' AND (e.block_time IS NULL OR e.event_time IS NULL)" if ids is None else "e.event_id=ANY(ARRAY["+','.join(str(int(x)) for x in ids)+"]::bigint[])"
    return json.loads(sql("SET statement_timeout='15s'; SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'eventId')::bigint),'[]'::jsonb) FROM (SELECT "+FIELDS+" AS row FROM proof_indexer.events e JOIN proof_indexer.transactions t ON t.network=e.network AND t.txid=e.txid WHERE e.network='livenet' AND "+condition+") s;"))
def epoch(text):return datetime.datetime.fromisoformat(text).timestamp()
def checkblock(group,root):
    height,rows=group; blockhash=core('getblockhash',height)
    raw=core('getblock',blockhash,1);block=json.loads(raw)
    assert block['height']==height and block['hash']==blockhash and block['confirmations']>=6
    with gzip.open(root/(str(height)+'.core.json.gz'),'xb') as f:f.write(raw.encode())
    for row in rows:
        assert row['kind'] in ('token-listing','token-listing-sealed') and row['valid'] and row['status']=='confirmed'
        assert row['parentStatus']=='confirmed' and row['parentHash']==blockhash
        assert row['height']==row['parentHeight']==height and row['index']==row['parentIndex']
        assert block['tx'][row['index']]==row['txid'] and epoch(row['parentTime'])==block['time']
        assert all(row[k] is None or epoch(row[k])==block['time'] for k in ('blockTime','eventTime'))
        row['canonicalTime']=datetime.datetime.fromtimestamp(block['time'],datetime.timezone.utc).isoformat()
    return {'height':height,'hash':blockhash,'time':block['time'],'coreSha256':hashlib.sha256(raw.encode()).hexdigest(),'rows':len(rows)}
def prepare(rows):
    data=literal(encoded(rows))
    start="""BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
LOCK TABLE proof_indexer.blocks,proof_indexer.transactions,proof_indexer.events IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE audit17_times ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset("""+data+"""::jsonb) AS r("eventId" text,"rowHash" text,"invariantHash" text,"canonicalTime" timestamptz,"blockTime" timestamptz,"eventTime" timestamptz,"updatedAt" timestamptz,"parentHash" text,height integer);
"""
    guard="""DO $times$ BEGIN
IF (SELECT count(*) FROM proof_indexer.events e JOIN audit17_times r ON e.event_id=r."eventId"::bigint WHERE encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex')=r."rowHash") <> """+str(len(rows))+""" THEN RAISE EXCEPTION 'event snapshot changed'; END IF;
IF EXISTS(SELECT 1 FROM audit17_times r LEFT JOIN proof_indexer.blocks b ON b.network='livenet' AND b.height=r.height AND b.block_hash=r."parentHash" AND b.canonical WHERE b.block_hash IS NULL) THEN RAISE EXCEPTION 'canonical block changed'; END IF;
END $times$;
"""
    update="""UPDATE proof_indexer.events e SET block_time=COALESCE(e.block_time,r."canonicalTime"),event_time=COALESCE(e.event_time,r."canonicalTime"),updated_at=now() FROM audit17_times r WHERE e.event_id=r."eventId"::bigint;
"""
    restore="""DO $times$ BEGIN
IF (SELECT count(*) FROM proof_indexer.events e JOIN audit17_times r ON e.event_id=r."eventId"::bigint WHERE encode(sha256(convert_to((to_jsonb(e)-'block_time'-'event_time'-'updated_at')::text,'UTF8')),'hex')=r."invariantHash" AND e.block_time=r."canonicalTime" AND e.event_time=r."canonicalTime") <> """+str(len(rows))+""" THEN RAISE EXCEPTION 'rollback guard changed'; END IF;
END $times$;
UPDATE proof_indexer.events e SET block_time=r."blockTime",event_time=r."eventTime",updated_at=r."updatedAt" FROM audit17_times r WHERE e.event_id=r."eventId"::bigint;
"""
    return start+guard+update, start+restore, restore

def main():
    assert sys.flags.isolated and os.geteuid()==0 and len(sys.argv)==3 and sys.argv[1] in ('plan','check','apply')
    assert h['command'](['git','-c','safe.directory=/opt/proofofwork-api','-C','/opt/proofofwork-api','rev-parse','HEAD'])=='07929dd3c6e422fa1955c6cbf07007330eca0519'
    mode=sys.argv[1];root=pathlib.Path(sys.argv[2]);os.umask(0o077)
    assert re.fullmatch(r'/data/proofofwork-audit17-event-times-[0-9TZ]+',str(root))
    if mode=='plan':
        root.mkdir(mode=0o700);rows=readrows();assert 0<len(rows)<=2000
        save(root/'before.json',rows);groups={}
        for row in rows:groups.setdefault(row['height'],[]).append(row)
        assert len(groups)<=500
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            proofs=list(pool.map(lambda group:checkblock(group,root),sorted(groups.items())))
        save(root/'plan.json',{'rows':rows,'blocks':proofs})
        print(encoded({'ok':True,'mode':mode,'rows':len(rows),'blocks':len(proofs),'planSha256':hashlib.sha256((root/'plan.json').read_bytes()).hexdigest()}));return
    assert root.is_dir() and not root.is_symlink() and root.stat().st_uid==0
    plan=json.loads((root/'plan.json').read_text());rows=plan['rows'];ids=[r['eventId'] for r in rows]
    assert readrows(ids)==[{k:v for k,v in row.items() if k!='canonicalTime'} for row in rows]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        hashes=list(pool.map(lambda b:core('getblockhash',b['height']),plan['blocks']))
    assert hashes==[b['hash'] for b in plan['blocks']]
    forward,rollback,restore=prepare(rows)
    if mode=='check':
        # Exercise forward and guarded reverse statements in a rolled-back transaction.
        sql(forward+restore+'ROLLBACK;')
        assert readrows(ids)==[{k:v for k,v in row.items() if k!='canonicalTime'} for row in rows]
        save(root/'check.json',{'ok':True,'controllerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()})
        print(encoded({'ok':True,'mode':mode,'rows':len(rows),'rolledBack':True}));return
    checked=json.loads((root/'check.json').read_text());assert checked['ok'] and checked['controllerSha256']==hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
    for name,content in [('apply.sql',forward),('rollback.sql',rollback)]:
        with (root/name).open('x') as f:f.write(content+'COMMIT;\n');f.flush();os.fsync(f.fileno())
    os.sync();sql(forward+'COMMIT;')
    after=readrows(ids);save(root/'after.json',after)
    for a,b in zip(rows,after):
        assert b['invariantHash']==a['invariantHash'] and epoch(b['blockTime'])==epoch(a['canonicalTime'])==epoch(b['eventTime'])
    result={'ok':True,'mode':mode,'rows':len(rows),'blocks':len(plan['blocks']),'remainingMissing':len(readrows())}
    save(root/'receipt.json',result);print(encoded(result))
if __name__=='__main__':main()
