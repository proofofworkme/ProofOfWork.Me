#!/usr/bin/python3 -I
"""Core-proven raw-evidence repair for the four H9-03 auxiliary transactions.
Plan is read-only; apply re-proves Core evidence and compare-and-swaps exact rows.
Only raw_tx/raw_hex/updated_at may change. No events or economic rows are edited.
"""
import datetime, decimal, hashlib, json, os, pathlib, re, subprocess, sys
IDS = ('8601e0b83423e9f51aeb128b7d401d211828df9c623db7e55b5eb6b6332df9cf',
'939366d09f6af994dae3a5b848c490fdd7524c95e3e6db30d55e585df0a4d76c',
'4ca4fa5b03f871ee90863cf283696c692db7287ef672f8d815bc0ecf9695f212',
'4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359')
ENV={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'}
def command(args, data=None):
    result=subprocess.run(args,input=data,text=True,capture_output=True,env=ENV,timeout=60)
    if result.returncode: raise RuntimeError(result.stderr[:1000])
    return result.stdout.strip()
def core(method,*args):
    return command(['sudo','-n','-u','bitcoin','/usr/local/bin/bitcoin-cli','-conf=/etc/bitcoin/bitcoin.conf',method,*map(str,args)])
def sql(query):
    return command(['sudo','-n','-u','postgres','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-d','proof_indexer'],query)
def literal(value):
    # Dollar quoting with a deterministic delimiter absent from the payload.
    tag='$audit17_'+hashlib.sha256(value.encode()).hexdigest()+'$'
    assert tag not in value
    return tag+value+tag
def encoded(value): return json.dumps(value,sort_keys=True,separators=(',',':'))
def readrow(txid):
    return json.loads(sql("SET statement_timeout='10s'; SELECT jsonb_build_object('transaction',to_jsonb(t),"
        "'inputs',(SELECT jsonb_agg(to_jsonb(i) ORDER BY vin) FROM proof_indexer.tx_inputs i WHERE i.network=t.network AND i.txid=t.txid),"
        "'outputs',(SELECT jsonb_agg(to_jsonb(o) ORDER BY vout) FROM proof_indexer.tx_outputs o WHERE o.network=t.network AND o.txid=t.txid),"
        "'events',(SELECT count(*) FROM proof_indexer.events e WHERE e.network=t.network AND e.txid=t.txid)) "
        "FROM proof_indexer.transactions t WHERE network='livenet' AND txid="+literal(txid)+';'))
def sats(value):
    n=decimal.Decimal(str(value))*100000000
    assert n==n.to_integral_value() and 0<=n<=2100000000000000
    return int(n)
def raw_txid(rawhex):
    b=bytes.fromhex(rawhex); pos=4; witness=b[pos:pos+2]==b'\x00\x01'
    if witness:pos+=2
    start=pos
    def varint():
        nonlocal pos
        n=b[pos];pos+=1
        if n>=253:
            size={253:2,254:4,255:8}[n];n=int.from_bytes(b[pos:pos+size],'little');pos+=size
        assert n<=1000000 and pos<=len(b)
        return n
    count=varint();assert count>0
    for _ in range(count):
        pos+=36;size=varint();pos+=size+4;assert pos<=len(b)
    outputs=varint();assert outputs>0
    for _ in range(outputs):
        pos+=8;size=varint();pos+=size;assert pos<=len(b)
    end=pos
    if witness:
        for _ in range(count):
            for _ in range(varint()):
                size=varint();pos+=size;assert pos<=len(b)
    assert pos+4==len(b)
    stripped=b[:4]+b[start:end]+b[pos:]
    return hashlib.sha256(hashlib.sha256(stripped).digest()).digest()[::-1].hex()
def prove(txid,before):
    t=before['transaction']; assert t['txid']==txid and t['network']=='livenet'
    assert t['status']=='confirmed' and t['source']=='canonical-listing-outpoint-scan'
    assert t['raw_tx'] in (None,{}) and t['raw_hex'] in (None,'') and before['events']==0
    blockhash=core('getblockhash',t['block_height'])
    assert blockhash==t['block_hash']
    block=json.loads(core('getblock',blockhash,1)); assert block['confirmations']>=6
    assert block['height']==t['block_height'] and block['tx'][t['block_index']]==txid
    rawtext=core('getrawtransaction',txid,2,blockhash)
    raw=json.loads(rawtext,parse_float=decimal.Decimal)
    assert raw['txid']==txid and raw['blockhash']==blockhash and raw_txid(raw['hex'])==txid
    assert len(raw['vin'])==len(before['inputs']) and len(raw['vout'])==len(before['outputs'])
    assert datetime.datetime.fromisoformat(t['block_time']).timestamp()==block['time']
    additions=[]; input_sum=0; output_sum=0
    for index,(v,row) in enumerate(zip(raw['vin'],before['inputs'])):
        prev=v['prevout']; value=sats(prev['value']); input_sum+=value
        assert (row['vin'],row['prev_txid'],row['prev_vout'],row['value_sats'],row['sequence'],row['script_sig'] or '',row['witness'] or []) == (index,v['txid'],v['vout'],value,v['sequence'],v.get('scriptSig',{}).get('hex') or '',v.get('txinwitness',[]))
        assert (row['address'] or '')==prev['scriptPubKey'].get('address','')
        additions.append((index,value))
    for index,(v,row) in enumerate(zip(raw['vout'],before['outputs'])):
        value=sats(v['value']);output_sum+=value;spk=v['scriptPubKey']
        assert (row['vout'],row['value_sats'],row['scriptpubkey'],row['address'] or '')==(index,value,spk['hex'],spk.get('address',''))
    assert input_sum-output_sum==t['fee_sats']==sats(raw['fee'])
    assert all(raw[k]==t[k] for k in ('version','locktime','vsize','weight'))
    expression=literal(rawtext)+'::jsonb'
    for index,value in additions:
        expression="jsonb_set("+expression+",'{vin,"+str(index)+",prevout,valueSats}', '"+str(value)+"'::jsonb)"
    expression+=' || '+literal(encoded({'_powBlockIndex':t['block_index']}))+'::jsonb'
    return {'txid':txid,'before':before,'blockHash':blockhash,'height':block['height'],
            'rawCore':rawtext,'rawHexSha256':hashlib.sha256(bytes.fromhex(raw['hex'])).hexdigest(),
            'inputProofs':input_sum,'outputProofs':output_sum,'feeProofs':t['fee_sats'],
            'rawExpression':expression,'rawHex':raw['hex']}
def save(path,value):
    with path.open('x') as f:json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
def main():
    assert sys.flags.isolated and os.geteuid()==0
    assert len(sys.argv)==3 and sys.argv[1] in ('plan','check','apply')
    mode=sys.argv[1];root=pathlib.Path(sys.argv[2])
    assert command(['git','-c','safe.directory=/opt/proofofwork-api','-C','/opt/proofofwork-api','rev-parse','HEAD'])=='07929dd3c6e422fa1955c6cbf07007330eca0519'
    assert re.fullmatch(r'/data/proofofwork-audit17-aux-raw-[0-9TZ]+',str(root))
    os.umask(0o077)
    if mode=='plan':
        root.mkdir(mode=0o700)
        snapshots=[readrow(txid) for txid in IDS]
        save(root/'before.json',snapshots)
        try:
            rows=[prove(txid,row) for txid,row in zip(IDS,snapshots)]
        except Exception as error:
            save(root/'failure.json',{'phase':'read-only-plan','error':str(error) or type(error).__name__});raise
        save(root/'plan.json',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rows':rows})
        print(encoded({'ok':True,'mode':mode,'rows':len(rows),'planSha256':hashlib.sha256((root/'plan.json').read_bytes()).hexdigest(),'root':str(root)}));return
    assert root.is_dir() and not root.is_symlink() and root.stat().st_uid==0
    plan=json.loads((root/'plan.json').read_text()); rows=plan['rows'];assert tuple(r['txid'] for r in rows)==IDS
    verified=[]
    for row in rows:
        before=readrow(row['txid']);assert before==row['before'],'DB evidence changed'
        fresh=prove(row['txid'],before);assert fresh['rawHexSha256']==row['rawHexSha256']
        verified.append(fresh)
    save(root/(mode+'-proof.json'),verified)
    forward=["BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';",'DO $repair$ BEGIN', 'LOCK TABLE proof_indexer.blocks, proof_indexer.transactions, proof_indexer.events, proof_indexer.tx_inputs, proof_indexer.tx_outputs IN SHARE ROW EXCLUSIVE MODE;']
    rollback=["BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';",'DO $repair$ BEGIN', 'LOCK TABLE proof_indexer.blocks, proof_indexer.transactions, proof_indexer.events, proof_indexer.tx_inputs, proof_indexer.tx_outputs IN SHARE ROW EXCLUSIVE MODE;']
    for row in verified:
        txid=literal(row['txid']); before=literal(encoded(row['before']['transaction']))+'::jsonb'
        raw='('+row['rawExpression']+')'; rawhex=literal(row['rawHex'])
        forward += [f"IF NOT EXISTS (SELECT 1 FROM proof_indexer.blocks WHERE network='livenet' AND block_hash={literal(row['blockHash'])} AND height={row['height']} AND canonical) THEN RAISE EXCEPTION 'canonical block changed'; END IF;",
          f"IF (SELECT jsonb_agg(to_jsonb(i) ORDER BY vin) FROM proof_indexer.tx_inputs i WHERE network='livenet' AND txid={txid}) IS DISTINCT FROM {literal(encoded(row['before']['inputs']))}::jsonb THEN RAISE EXCEPTION 'inputs changed'; END IF;",
          f"IF (SELECT jsonb_agg(to_jsonb(o) ORDER BY vout) FROM proof_indexer.tx_outputs o WHERE network='livenet' AND txid={txid}) IS DISTINCT FROM {literal(encoded(row['before']['outputs']))}::jsonb THEN RAISE EXCEPTION 'outputs changed'; END IF;",
          f"PERFORM 1 FROM proof_indexer.transactions t WHERE network='livenet' AND txid={txid} AND to_jsonb(t)={before} FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'before mismatch'; END IF;",
          f"IF EXISTS (SELECT 1 FROM proof_indexer.events WHERE network='livenet' AND txid={txid}) THEN RAISE EXCEPTION 'event dependency appeared'; END IF;",
          f"UPDATE proof_indexer.transactions SET raw_tx={raw},raw_hex={rawhex},updated_at=now() WHERE network='livenet' AND txid={txid};"]
        old=row['before']['transaction']
        # Exact metadata rollback; refusal if restored raw evidence has changed.
        oldraw='NULL' if old['raw_tx'] is None else literal(encoded(old['raw_tx']))+'::jsonb'
        oldhex='NULL' if old['raw_hex'] is None else literal(old['raw_hex'])
        rollback += [f"UPDATE proof_indexer.transactions SET raw_tx={oldraw}, raw_hex={oldhex}, updated_at={literal(old['updated_at'])}::timestamptz WHERE network='livenet' AND txid={txid} AND raw_tx={raw} AND raw_hex={rawhex} AND (to_jsonb(proof_indexer.transactions)-'raw_tx'-'raw_hex'-'updated_at')=({before}-'raw_tx'-'raw_hex'-'updated_at'); IF NOT FOUND THEN RAISE EXCEPTION 'rollback guard mismatch'; END IF;"]
    forward+=['END $repair$; COMMIT;'];rollback+=['END $repair$; COMMIT;']
    assert all('$repair$' not in line for lines in (forward,rollback) for line in lines[2:-1])
    if mode=='check':
        sql('\n'.join(forward).removesuffix('COMMIT;')+'ROLLBACK;')
        assert [readrow(txid) for txid in IDS]==[r['before'] for r in rows]
        save(root/'check-receipt.json',{'ok':True,'controllerSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()})
        print(encoded({'ok':True,'mode':mode,'rows':4,'rolledBack':True}));return
    check=json.loads((root/'check-receipt.json').read_text())
    assert check['ok'] and check['controllerSha256']==hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
    for filename,lines in [('apply.sql',forward),('rollback.sql',rollback)]:
        with (root/filename).open('x') as f:f.write('\n'.join(lines)+'\n');f.flush();os.fsync(f.fileno())
    # All raw sources and rollback SQL are durable before the transaction.
    os.sync()
    sql('\n'.join(forward))
    after=[readrow(txid) for txid in IDS];save(root/'after.json',after)
    for prior,current in zip(verified,after):
        assert current['inputs']==prior['before']['inputs'] and current['outputs']==prior['before']['outputs'] and current['events']==0
        for key,value in prior['before']['transaction'].items():
            if key not in ('raw_tx','raw_hex','updated_at'):assert current['transaction'][key]==value
        assert raw_txid(current['transaction']['raw_hex'])==prior['txid']
    save(root/'receipt.json',{'ok':True,'rows':4,'changedFields':['raw_tx','raw_hex','updated_at'],'at':datetime.datetime.now(datetime.timezone.utc).isoformat()})
    print(encoded({'ok':True,'mode':mode,'rows':4,'root':str(root)}))
if __name__=='__main__': main()
