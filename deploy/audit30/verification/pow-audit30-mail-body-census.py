#!/usr/bin/python3 -I
"""Read-only bounded mail-body census. Public output has hashes/lengths only.

Root may execute this later, after the private restore has stopped. No writes to
PostgreSQL, services, source, ledgers, cache or mail bodies. The SQL snapshot is
coherent; optional Core proof binds each confirmed mail transaction to exact
canonical block position and script bytes. It is not a full event replay.
"""
import argparse, collections, datetime, hashlib, json, os, pathlib, re, selectors, signal, subprocess, sys, time
NETWORK='livenet'; MAX_ROWS=10000; MAX_LINE=8*1024**2; MAX_TOTAL=256*1024**2; DEADLINE=900
KINDS=['attachment','browser','file','inception-bond','infinity-bond','mail','reply']
ES_TRIM='\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
def h(b):return hashlib.sha256(b).hexdigest()
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def body_digest(v):
    if v is not None and not isinstance(v,str):raise ValueError('BODY_TYPE')
    b=b'' if v is None else v.encode('utf-8',errors='strict')
    return dict(isNull=v is None,bytes=len(b),sha256=h(b))
def selected_direct(payload):
    for k in ('body','message','memo'):
        if payload.get(k) is not None:
            if not isinstance(payload[k],str):raise ValueError('DIRECT_BODY_TYPE')
            return k,payload[k]
    return 'absent',''
def is_subject(v):return bool(re.match(r'^Subject:\s*',v.strip(ES_TRIM),re.I))
def projection_body(payload,trim):
    _,direct=selected_direct(payload)
    if trim:direct=direct.strip(ES_TRIM)
    if direct!='':return direct
    detail=payload.get('detail') or ''
    if not isinstance(detail,str):raise ValueError('DETAIL_TYPE')
    if trim:detail=detail.strip(ES_TRIM)
    return detail if detail!='' and not is_subject(detail) else None
def reader_body(row,payload,trim):
    _,direct=selected_direct(payload)
    if trim:direct=direct.strip(ES_TRIM)
    if direct!='':return direct
    stored=row.get('body_text') or ''
    if trim:stored=stored.strip(ES_TRIM)
    if stored!='' and not is_subject(stored):return stored
    detail=payload.get('detail') or ''
    if not isinstance(detail,str):raise ValueError('DETAIL_TYPE')
    if trim:detail=detail.strip(ES_TRIM)
    return detail if detail!='' and not is_subject(detail) else ''
def decode_script(script_hex):
    b=bytes.fromhex(script_hex)
    if b[:1]!=b'\x6a':raise ValueError('NOT_OP_RETURN')
    at=1;out=[]
    while at<len(b):
        op=b[at];at+=1
        if op<=75:n=op
        elif op in (76,77,78):
            width={76:1,77:2,78:4}[op]
            if at+width>len(b):raise ValueError('TRUNCATED_PUSH_LENGTH')
            n=int.from_bytes(b[at:at+width],'little');at+=width
        else:raise ValueError('NON_PUSH_OP_RETURN')
        if at+n>len(b):raise ValueError('TRUNCATED_PUSH')
        out.append(b[at:at+n]);at+=n
    return b''.join(out)
def raw_body(ops):
    grouped=collections.defaultdict(list)
    for op in ops:grouped[op['vout']].append(op)
    chunks=[];positions=[];carriers=[]
    for vout,rows in sorted(grouped.items()):
        rows=sorted(rows,key=lambda x:x['output_index'])
        if len({r['output_index'] for r in rows})!=len(rows):raise ValueError('DUPLICATE_OP_RETURN_ORDINAL')
        script=rows[0]['scriptpubkey']
        if any(r['scriptpubkey']!=script for r in rows):raise ValueError('SCRIPT_ROW_DISAGREEMENT')
        payload=decode_script(script)
        stored=b''.join(bytes.fromhex(r['payload_hex']) for r in rows)
        if payload!=stored:raise ValueError('SCRIPT_PAYLOAD_BYTES_DIFFER')
        for r in rows:
            rb=bytes.fromhex(r['payload_hex'])
            if len(rb)!=r['data_bytes'] or rb.decode('utf-8',errors='strict')!=r['payload_text']:raise ValueError('OP_RETURN_TEXT_OR_SIZE_DIFFER')
        if payload.startswith(b'pwm1:'):
            text=payload.decode('utf-8',errors='strict')
            if '\x00' in text:raise ValueError('POSTGRES_UNREPRESENTABLE_BODY')
            carriers.append(dict(vout=vout,scriptSha256=h(bytes.fromhex(script)),payloadSha256=h(payload),bytes=len(payload)))
            if payload.startswith(b'pwm1:m:'):
                chunks.append(payload[7:]);positions.append(vout)
    if carriers:
        first,last=carriers[0]['vout'],carriers[-1]['vout']
        for vout,rows in grouped.items():
            if first<vout<last and decode_script(rows[0]['scriptpubkey']).startswith((b'pwa1:',b'pwid1:',b'pwdns1:',b'pwb1:',b'pwt1:')):raise ValueError('PWM_ENVELOPE_NONCONTIGUOUS')
    body=b''.join(chunks);body.decode('utf-8',errors='strict')
    return body,positions,carriers
SQL="""BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='3s'; SET LOCAL temp_file_limit='32MB';
SELECT jsonb_build_object('phase','snapshot','transactionReadOnly',current_setting('transaction_read_only'),'snapshot',txid_current_snapshot()::text,'atUtc',clock_timestamp(),'canonicalTip',(SELECT jsonb_build_object('height',height,'hash',block_hash) FROM proof_indexer.blocks WHERE network='livenet' AND canonical ORDER BY height DESC LIMIT 1),'meta',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY key),'[]'::jsonb) FROM proof_indexer.meta x WHERE key LIKE '%checkpoint%' OR key LIKE '%worker%' OR key LIKE '%precision%'),'mailRows',(SELECT count(*) FROM proof_indexer.mail_items WHERE network='livenet'),'renderedEventRows',(SELECT count(*) FROM proof_indexer.events WHERE network='livenet' AND protocol='pwm1' AND valid AND kind=ANY(ARRAY['attachment','browser','file','inception-bond','infinity-bond','mail','reply']::text[])));
WITH keys AS (SELECT network,txid FROM proof_indexer.mail_items WHERE network='livenet' UNION SELECT network,txid FROM proof_indexer.events WHERE network='livenet' AND protocol='pwm1' AND valid AND kind=ANY(ARRAY['attachment','browser','file','inception-bond','infinity-bond','mail','reply']::text[]))
SELECT jsonb_build_object('phase','row','network',k.network,'txid',k.txid,'mail',to_jsonb(m),'transaction',jsonb_build_object('status',t.status,'blockHash',t.block_hash,'blockHeight',t.block_height,'blockIndex',t.block_index),'canonicalBlock',b.canonical IS TRUE,'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.op_return_vout,e.record_ordinal,e.event_id),'[]'::jsonb) FROM proof_indexer.events e WHERE e.network=k.network AND e.txid=k.txid AND e.protocol='pwm1' AND e.valid AND e.kind=ANY(ARRAY['attachment','browser','file','inception-bond','infinity-bond','mail','reply']::text[])),'opReturns',(SELECT coalesce(jsonb_agg(jsonb_build_object('vout',o.vout,'output_index',o.output_index,'payload_hex',o.payload_hex,'payload_text',o.payload_text,'data_bytes',o.data_bytes,'scriptpubkey',x.scriptpubkey) ORDER BY o.vout,o.output_index),'[]'::jsonb) FROM proof_indexer.op_returns o JOIN proof_indexer.tx_outputs x USING(network,txid,vout) WHERE o.network=k.network AND o.txid=k.txid)) FROM keys k LEFT JOIN proof_indexer.mail_items m USING(network,txid) LEFT JOIN proof_indexer.transactions t USING(network,txid) LEFT JOIN proof_indexer.blocks b ON b.network=t.network AND b.block_hash=t.block_hash AND b.height=t.block_height ORDER BY k.txid LIMIT 10001;
COMMIT;
"""
def sql_stream(start):
    # No custom shell, inherited .psqlrc, live writes or source-file creation.
    p=subprocess.Popen(['/usr/sbin/runuser','-u','postgres','--','/usr/bin/psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-d','proof_indexer'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    p.stdin.write(SQL.encode());p.stdin.close();sel=selectors.DefaultSelector();sel.register(p.stdout,selectors.EVENT_READ,'out');sel.register(p.stderr,selectors.EVENT_READ,'err');buf=b'';total=0;err=0
    try:
        while sel.get_map():
            if time.monotonic()-start>DEADLINE:raise TimeoutError('CENSUS_DEADLINE')
            for key,_ in sel.select(1):
                data=os.read(key.fileobj.fileno(),65536)
                if not data:sel.unregister(key.fileobj);continue
                if key.data=='err':
                    err+=len(data)
                    if err>8192:raise ValueError('SQL_ERROR_BOUND')
                    continue
                total+=len(data);buf+=data
                if total>MAX_TOTAL:raise ValueError('EXPORT_TOTAL_BOUND')
                while b'\n' in buf:
                    line,buf=buf.split(b'\n',1)
                    if len(line)>MAX_LINE:raise ValueError('EXPORT_ROW_BOUND')
                    if line.strip():yield json.loads(line)
                if len(buf)>MAX_LINE:raise ValueError('EXPORT_ROW_BOUND')
        if buf.strip():raise ValueError('EXPORT_UNTERMINATED_ROW')
        if p.wait(timeout=3)!=0 or err:raise ValueError('SQL_READ_FAILED')
    finally:
        if p.poll() is None:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=3)
        for f in (p.stdout,p.stderr):f.close()
        sel.close()
class Core:
    ALLOWED={'getblockchaininfo','getblockhash','getblock','getrawtransaction'}
    def __init__(self,exe,datadir,start,conf=None):self.exe=exe;self.datadir=datadir;self.start=start;self.conf=conf;self.blocks={};self.calls=0
    def rpc(self,method,*params):
        if method not in self.ALLOWED:raise ValueError('RPC_NOT_READ_ONLY')
        if time.monotonic()-self.start>DEADLINE:raise TimeoutError('CENSUS_DEADLINE')
        p=subprocess.Popen([self.exe,'-datadir='+self.datadir,*(['-conf='+self.conf] if self.conf else []),method,*[str(v) for v in params]],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        out=bytearray();rpc_start=time.monotonic();sel=selectors.DefaultSelector();sel.register(p.stdout,selectors.EVENT_READ)
        try:
            while sel.get_map():
                if time.monotonic()-rpc_start>30 or time.monotonic()-self.start>DEADLINE:raise TimeoutError('CORE_READ_DEADLINE')
                for key,_ in sel.select(0.5):
                    chunk=os.read(key.fileobj.fileno(),65536)
                    if not chunk:sel.unregister(key.fileobj);continue
                    out.extend(chunk)
                    if len(out)>16*1024**2:raise ValueError('CORE_READ_BOUND')
            if p.wait(timeout=3):raise ValueError('CORE_READ_FAILED')
        finally:
            if p.poll() is None:p.kill();p.wait(timeout=3)
            p.stdout.close();sel.close()
        self.calls+=1;return json.loads(out)
    def verify(self,row,ops):
        t=row['transaction'];txid=row['txid'];height=t['blockHeight'];blockhash=t['blockHash'];index=t['blockIndex']
        if type(height) is not int or type(index) is not int or index<0 or not re.fullmatch('[0-9a-f]{64}',str(blockhash)):raise ValueError('CONFIRMED_POSITION_MISSING')
        if blockhash not in self.blocks:
            if self.rpc('getblockhash',height)!=blockhash:raise ValueError('CORE_BLOCK_NOT_CANONICAL')
            block=self.rpc('getblock',blockhash,1)
            if block['height']!=height or block['hash']!=blockhash:raise ValueError('CORE_BLOCK_IDENTITY')
            self.blocks[blockhash]=(height,block['tx'])
        if index>=len(self.blocks[blockhash][1]) or self.blocks[blockhash][1][index]!=txid:raise ValueError('CORE_BLOCK_POSITION')
        raw=self.rpc('getrawtransaction',txid,'true',blockhash)
        if raw['txid']!=txid or raw.get('blockhash')!=blockhash:raise ValueError('CORE_TX_IDENTITY')
        grouped=collections.defaultdict(list)
        for op in ops:grouped[op['vout']].append(op)
        for vout,rows in grouped.items():
            if vout>=len(raw['vout']) or any(r['scriptpubkey']!=raw['vout'][vout]['scriptPubKey']['hex'] for r in rows):raise ValueError('CORE_SCRIPT_BYTES')
        expected=[i for i,x in enumerate(raw['vout']) if x['scriptPubKey']['hex'].startswith('6a') and decode_script(x['scriptPubKey']['hex']).startswith(b'pwm1:')]
        indexed=[v for v,rows in grouped.items() if decode_script(rows[0]['scriptpubkey']).startswith(b'pwm1:')]
        if expected!=sorted(indexed):raise ValueError('CORE_PWM_CARRIER_COVERAGE')
        return dict(blockHash=blockhash,blockHeight=height,blockIndex=index,coreScriptsBound=True)
    def fence(self):
        for blockhash,(height,_) in self.blocks.items():
            if self.rpc('getblockhash',height)!=blockhash:raise ValueError('CORE_REORG_FENCE')
def census_record(row,core=None):
    m=row['mail'];events=row['events'];out=dict(network=row['network'],txid=row['txid'])
    if m is None:raise ValueError('MISSING_MAIL_PROJECTION')
    if len(events)!=1:raise ValueError('RENDERED_EVENT_NOT_UNIQUE')
    e=events[0];payload=e['payload'];status=e['status']
    for key,expected in [('network',row['network']),('txid',row['txid']),('protocol','pwm1'),('kind',e['kind']),('status',status)]:
        if key in payload and payload[key]!=expected:raise ValueError('EVENT_PAYLOAD_IDENTITY')
    for key,expected in [('confirmed',status=='confirmed'),('dropped',status=='dropped')]:
        if key in payload and (type(payload[key]) is not bool or payload[key]!=expected):raise ValueError('EVENT_PAYLOAD_STATUS')
    out.update(status=status,kind=e['kind'],eventId=e['event_id'],eventKey=e['event_key'],opReturnVout=e['op_return_vout'],recordOrdinal=e['record_ordinal'])
    if m['status']!=status or row['transaction']['status']!=status:raise ValueError('STATUS_PARITY')
    if status=='confirmed' and (not row['canonicalBlock'] or e['block_height']!=row['transaction']['blockHeight'] or e['block_index']!=row['transaction']['blockIndex']):raise ValueError('CANONICAL_RELATIONAL_POSITION')
    body,positions,carriers=raw_body(row['opReturns'])
    if not carriers or e['op_return_vout']!=carriers[0]['vout'] or e['record_ordinal']!=0:raise ValueError('CANONICAL_PWM_EVENT_CARRIER_POSITION')
    raw=body.decode('utf-8');stored=m['body_text'];directKey,direct=selected_direct(payload)
    oldProjection=projection_body(payload,True);fixedProjection=projection_body(payload,False);oldReader=reader_body(m,payload,True);fixedReader=reader_body(m,payload,False)
    other={k:v for k,v in m.items() if k!='body_text'}
    out.update(rawBody=body_digest(raw),rawBodyCarrierVouts=positions,carriers=carriers,storedBody=body_digest(stored),payloadDirectField=directKey,payloadDirectBody=body_digest(direct),legacyProjectionBody=body_digest(oldProjection),preservingProjectionBody=body_digest(fixedProjection),legacyApiMemo=body_digest(oldReader),preservingApiMemo=body_digest(fixedReader),nonBodyMailRowSha256=h(canonical(other)),wholeMailRowSha256=h(canonical(m)),eventSha256=h(canonical(e)))
    out['storedBytesEqualRaw']=body_digest(stored)['sha256']==h(body) and body_digest(stored)['bytes']==len(body)
    out['nullEmptyByteEquivalent']=stored is None and body==b''
    out['storedTrimEquivalent']=('' if stored is None else stored)==raw.strip(ES_TRIM)
    out['whitespaceOnlyNonemptyRaw']=len(body)>0 and raw.strip(ES_TRIM)==''
    out['payloadDirectEqualsRaw']=direct==raw
    out['preservingApiEqualsRaw']=fixedReader==raw
    out['preservingProjectionEqualsRaw']=fixedProjection==raw or (fixedProjection is None and body==b'')
    if status=='confirmed' and core:out['canonicalCore']=core.verify(row,row['opReturns'])
    out['bodyOnlyRepairCandidate']=bool(status=='confirmed' and core and out['payloadDirectEqualsRaw'] and out['preservingApiEqualsRaw'] and out['preservingProjectionEqualsRaw'] and not out['storedBytesEqualRaw'] and out['storedTrimEquivalent'] and len(body)>0 and positions)
    return out

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--core-cli');ap.add_argument('--core-datadir');ap.add_argument('--core-conf');args=ap.parse_args()
    if not sys.flags.isolated or os.geteuid()!=0:raise ValueError('ROOT_ISOLATED_REQUIRED')
    if bool(args.core_cli)!=bool(args.core_datadir) or (args.core_conf and not args.core_cli):raise ValueError('CORE_ARGUMENT_PAIR')
    start=time.monotonic();core=Core(args.core_cli,args.core_datadir,start,args.core_conf) if args.core_cli else None;before=core.rpc('getblockchaininfo') if core else None
    snapshot=None;rows=[];errors=[];seen=set();totals=collections.Counter()
    for record in sql_stream(start):
        if record['phase']=='snapshot':
            if snapshot is not None or record['transactionReadOnly']!='on':raise ValueError('SQL_SNAPSHOT_SHAPE')
            snapshot={k:v for k,v in record.items() if k!='meta'};snapshot['metaSha256']=h(canonical(record['meta']))
            if record['mailRows']>MAX_ROWS or record['renderedEventRows']>MAX_ROWS:raise ValueError('POPULATION_BOUND')
        elif record['phase']=='row':
            if snapshot is None or len(seen)>=MAX_ROWS or record['txid'] in seen:raise ValueError('POPULATION_OR_DUPLICATE_BOUND')
            seen.add(record['txid'])
            try:r=census_record(record,core);rows.append(r);totals[r['status']]+=1;totals['repairCandidates']+=int(r['bodyOnlyRepairCandidate']);totals['byteDifferences']+=int(not r['storedBytesEqualRaw']);totals['nullEmptyEquivalent']+=int(r['nullEmptyByteEquivalent'])
            except Exception as e:errors.append(dict(txid=record['txid'],errorClass=type(e).__name__,code=str(e) if re.fullmatch('[A-Z_]+',str(e)) else 'DETAIL_REDACTED'))
        else:raise ValueError('UNEXPECTED_EXPORT_PHASE')
    if snapshot is None or snapshot['mailRows']!=len(seen):raise ValueError('FULL_MAIL_POPULATION_COUNT')
    if core:core.fence()
    after=core.rpc('getblockchaininfo') if core else None
    result=dict(schema='pow-audit30-mail-body-census-v1',atUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),ok=not errors,snapshot=snapshot,rows=rows,counts=dict(totals),allStoredBodiesByteExact=totals['byteDifferences']==0,errors=errors,sourceSha256=h(pathlib.Path(__file__).read_bytes()),elapsedSeconds=round(time.monotonic()-start,3),coreVerified=core is not None,coreCalls=core.calls if core else 0,coreTipBefore={k:before[k] for k in ('blocks','bestblockhash')} if before else None,coreTipAfter={k:after[k] for k in ('blocks','bestblockhash')} if after else None,limits=dict(rows=MAX_ROWS,lineBytes=MAX_LINE,totalBytes=MAX_TOTAL,wallSeconds=DEADLINE,statementSeconds=60,lockSeconds=3,tempFileBytes=32*1024**2),qualification='All current mail projection keys and rendered PWM event keys at one read-only repeatable-read snapshot. Exact raw-script/UTF8 m-chunk body comparison; optional Core proof covers confirmed row canonical block position and exact carrier scripts, with final per-source-block reorg fence. No full semantic event replay, no pending Core/mempool certification, no attachments reconstruction, no data writes. Empty/null byte equivalence is explicitly separate and never a repair candidate; mismatch rows with missing/duplicate events or source disagreements refuse eligibility. Historical 16 witnesses are not the current population definition.')
    print(json.dumps(result,sort_keys=True,separators=(',',':')))
    return 0 if result['ok'] else 1
if __name__=='__main__':
    try:sys.exit(main())
    except Exception as e:
        print(json.dumps(dict(schema='pow-audit30-mail-body-census-failure-v1',ok=False,errorClass=type(e).__name__,code=str(e) if re.fullmatch('[A-Z_]+',str(e)) else 'DETAIL_REDACTED')));sys.exit(1)
