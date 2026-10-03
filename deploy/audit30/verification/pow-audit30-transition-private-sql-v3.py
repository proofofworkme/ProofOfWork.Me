#!/usr/bin/python3 -I
"""Emit only: bounded private PG16 capture/side-schema scripts; never connect."""
import argparse, datetime, hashlib, json, os, pathlib, re, sqlite3, stat, types
BUILDER_SHA='4c08151c0d3cfb5757c0056fef8facf578e57e023bc1bc29f49fdaf7c5e34e9a'
def load_builder():
    # Load only already-hashed adjacent bytes; importlib reopening a writable path
    # could execute bytes other than those attested. Outer package ownership is
    # separately enforced by the reviewed isolated controller.
    path=pathlib.Path(__file__).absolute().with_name('pow-audit30-transition-chunk-prototype.py')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        before=os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or not 1<=before.st_size<=1048576:raise ValueError('Adjacent builder shape refusal')
        raw=os.read(fd,1048577);after=os.fstat(fd)
        identity=lambda s:(s.st_dev,s.st_ino,s.st_uid,s.st_gid,s.st_mode,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        if identity(before)!=identity(after) or len(raw)!=before.st_size or hashlib.sha256(raw).hexdigest()!=BUILDER_SHA:raise ValueError('Adjacent builder hash/identity refusal')
    finally:os.close(fd)
    module=types.ModuleType('audit30_transition_chunks');module.__file__=str(path)
    exec(compile(raw,str(path),'exec'),module.__dict__)
    return module
C=load_builder()
HEX=re.compile(r'^[0-9a-f]{64}$');JOB=re.compile(r'^/data/proofofwork-audit30-transition-[A-Za-z0-9-]+$');INSPECT_JOB=re.compile(r'^/data/proofofwork-audit30-inspect-([0-9]{8}T[0-9]{6}Z)$')
SCHEMA='audit30_transition_chunks_v1';SQL_MAX=160*1024**2
def h(raw):return hashlib.sha256(raw).hexdigest()
def literal(value):return "'"+value.replace("'","''")+"'"
def private_identity(job,port):
    if not isinstance(job,str) or type(port) is not int:return False
    if JOB.fullmatch(job):return port==55433
    match=INSPECT_JOB.fullmatch(job)
    if not match or port!=55432:return False
    try:return datetime.datetime.strptime(match[1],'%Y%m%dT%H%M%SZ').strftime('%Y%m%dT%H%M%SZ')==match[1]
    except ValueError:return False
def validate(plan):
    if set(plan)!={'schema','privateJob','privateSocket','privatePort','sourceDatabase','network','checkpoint','sourceFenceSha256','sampleRows','columns','precisionMarkerJsonbSendSha256'} or plan['schema']!='pow-audit30-private-transition-prototype-plan-v1':raise ValueError('Exact admitted plan shape required')
    job=plan['privateJob']
    if not private_identity(job,plan['privatePort']) or plan['privateSocket']!=job+'/socket' or plan['sourceDatabase']!='proof_indexer' or plan['network']!='livenet':raise ValueError('Private PG identity required')
    cp=plan['checkpoint'];rows=plan['sampleRows']
    if not isinstance(cp,dict) or set(cp)!={'height','hash','transitionHeight','transitionHash'} or type(cp['height']) is not int or type(cp['transitionHeight']) is not int or not 960601<=cp['transitionHeight']<=cp['height'] or any(not isinstance(cp[k],str) or not HEX.fullmatch(cp[k]) for k in ('hash','transitionHash')):raise ValueError('Saved Q16 source checkpoint required')
    if not isinstance(rows,list) or not 3<=len(rows)<=16 or any(not isinstance(x,dict) or set(x)!={'height','hash'} or type(x['height']) is not int or not 1<=x['height']<=cp['transitionHeight'] or not isinstance(x['hash'],str) or not HEX.fullmatch(x['hash']) for x in rows):raise ValueError('Bounded exact source rows required')
    heights=[x['height'] for x in rows]
    if heights!=sorted(set(heights)) or 960600 not in heights or 960601 not in heights or rows[-1]!={'height':cp['transitionHeight'],'hash':cp['transitionHash']}:raise ValueError('Declaration/activation/latest sample and exact ordering required')
    if any(not isinstance(plan[k],str) or not HEX.fullmatch(plan[k]) for k in ('sourceFenceSha256','precisionMarkerJsonbSendSha256')):raise ValueError('Saved fence and immutable marker bindings required')
    columns_raw=json.dumps(plan['columns'],separators=(',',':')).encode();pin=json.dumps(dict(network='livenet',height=cp['height'],hash=cp['hash'],sourceFenceSha256=plan['sourceFenceSha256'],sampleRowKeysSha256=h(json.dumps(rows,separators=(',',':')).encode()))).encode()
    payload_index=next((i for i,x in enumerate(plan['columns']) if x.get('name')=='payload'),-1);C.validate_metadata(columns_raw,pin,payload_index)
    return columns_raw,pin,payload_index
def guard(plan,readonly):
    return "\\set ON_ERROR_STOP on\n\\pset tuples_only on\n\\pset format unaligned\nBEGIN"+(' ISOLATION LEVEL REPEATABLE READ READ ONLY' if readonly else ' READ WRITE')+";\nSET LOCAL search_path=pg_catalog,pg_temp; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='1s'; SET LOCAL temp_file_limit='32MB'; SET LOCAL work_mem='8MB';\nDO $guard$ BEGIN\n IF current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999 OR current_setting('listen_addresses')<>'' OR current_setting('unix_socket_directories')<>"+literal(plan['privateSocket'])+" OR current_setting('port')<>"+literal(str(plan['privatePort']))+" OR current_setting('data_directory')<>"+literal(plan['privateJob']+'/cluster')+" OR current_setting('transaction_read_only')<>"+literal('on' if readonly else 'off')+" OR current_database()<>'proof_indexer' OR current_user<>'postgres' OR current_setting('server_encoding')<>'UTF8' THEN RAISE EXCEPTION 'PRIVATE_PG_IDENTITY_REFUSAL'; END IF;\nEND $guard$;\n"
def capture(plan):
    columns_raw,pin,payload_index=validate(plan);job=plan['privateJob'];cp=plan['checkpoint'];values=','.join('('+str(r['height'])+','+literal(r['hash'])+')' for r in plan['sampleRows'])
    selection="SELECT t.* FROM proof_indexer.work_amo_block_transitions t JOIN (VALUES "+values+") AS wanted(height,hash) ON t.block_height=wanted.height AND t.block_hash=wanted.hash WHERE t.network='livenet' ORDER BY t.network,t.block_height,t.block_hash"
    sql=guard(plan,True)+"DO $source$ DECLARE n integer; layout jsonb; BEGIN\n"
    sql+=" IF NOT EXISTS(SELECT 1 FROM proof_indexer.blocks WHERE network='livenet' AND canonical AND height="+str(cp['height'])+" AND block_hash="+literal(cp['hash'])+") OR (SELECT max(height) FROM proof_indexer.blocks WHERE network='livenet' AND canonical)<>"+str(cp['height'])+" OR NOT EXISTS(SELECT 1 FROM proof_indexer.work_amo_block_transitions WHERE network='livenet' AND block_height="+str(cp['transitionHeight'])+" AND block_hash="+literal(cp['transitionHash'])+") OR (SELECT max(block_height) FROM proof_indexer.work_amo_block_transitions WHERE network='livenet')<>"+str(cp['transitionHeight'])+" THEN RAISE EXCEPTION 'SAVED_CHECKPOINT_REFUSAL'; END IF;\n"
    sql+=" SELECT jsonb_agg(jsonb_build_object('name',attname,'typeOid',atttypid::integer,'typeName',format_type(atttypid,atttypmod)) ORDER BY attnum) INTO layout FROM pg_attribute WHERE attrelid='proof_indexer.work_amo_block_transitions'::regclass AND attnum>0 AND NOT attisdropped; IF layout<>"+literal(columns_raw.decode())+"::jsonb THEN RAISE EXCEPTION 'COLUMN_TYPE_LAYOUT_REFUSAL'; END IF;\n"
    sql+=" IF (SELECT encode(sha256(jsonb_send(value)),'hex') FROM proof_indexer.meta WHERE key='workPrecisionV2Migration:livenet') IS DISTINCT FROM "+literal(plan['precisionMarkerJsonbSendSha256'])+" OR NOT EXISTS(SELECT 1 FROM proof_indexer.meta WHERE key='workPrecisionV2Migration:livenet' AND value->>'status'='complete' AND value->>'activationHeight'='960601') THEN RAISE EXCEPTION 'IMMUTABLE_MARKER_REFUSAL'; END IF;\n"
    sql+=" IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='proof_indexer.work_amo_block_transitions'::regclass AND tgname='work_amo_block_transitions_immutable' AND NOT tgisinternal AND tgenabled='O') OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='proof_indexer.meta'::regclass AND tgname='work_precision_v2_marker_immutable' AND NOT tgisinternal AND tgenabled='O') THEN RAISE EXCEPTION 'ORIGINAL_IMMUTABILITY_TRIGGER_REFUSAL'; END IF;\n"
    sql+=" SELECT count(*) INTO n FROM ("+selection+") x; IF n<>"+str(len(plan['sampleRows']))+" THEN RAISE EXCEPTION 'SAMPLE_MEMBERSHIP_REFUSAL'; END IF;\n"
    sql+=" IF EXISTS(SELECT 1 FROM ("+selection+") x WHERE octet_length(record_send(x))+32>33554432) OR (SELECT coalesce(sum(octet_length(record_send(x))+32),0) FROM ("+selection+") x)>67108864 THEN RAISE EXCEPTION 'CAPTURE_BYTE_CAP'; END IF;\nEND $source$;\n"
    sql+='\\o '+job+'/capture-context.json\n'+"SELECT jsonb_build_object('transactionReadOnly',current_setting('transaction_read_only'),'snapshot',txid_current_snapshot()::text,'checkpoint',"+literal(json.dumps(cp,separators=(',',':')))+"::jsonb,'columnLayout',"+literal(columns_raw.decode())+"::jsonb,'sampleRows',"+literal(json.dumps(plan['sampleRows'],separators=(',',':')))+"::jsonb,'originalTriggers',(SELECT jsonb_agg(jsonb_build_object('table',tgrelid::regclass::text,'name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid),'functionDefinition',pg_get_functiondef(tgfoid)) ORDER BY tgrelid::regclass::text,tgname) FROM pg_trigger WHERE (tgrelid='proof_indexer.work_amo_block_transitions'::regclass AND tgname='work_amo_block_transitions_immutable') OR (tgrelid='proof_indexer.meta'::regclass AND tgname='work_precision_v2_marker_immutable')));\n\\o\n"
    sql+='\\o '+job+'/columns.json\nSELECT '+literal(columns_raw.decode())+'::text;\n\\o\n'
    sql+='\\o '+job+'/checkpoint.json\nSELECT '+literal(pin.decode())+'::text;\n\\o\n'
    sql+='\\copy ('+selection+') TO '+literal(job+'/transitions-source.copy')+' WITH (FORMAT binary)\n'
    sql+='\\copy (SELECT * FROM proof_indexer.meta WHERE key=\'workPrecisionV2Migration:livenet\' ORDER BY key) TO '+literal(job+'/precision-marker-source.copy')+' WITH (FORMAT binary)\n'
    sql+='\\o '+job+'/precision-marker-value.json\nSELECT value FROM proof_indexer.meta WHERE key=\'workPrecisionV2Migration:livenet\';\n\\o\n'
    sql+='COMMIT;\n'
    return sql
def side(plan,target):
    columns_raw,pin,payload_index=validate(plan)
    raw=C.reconstruct(pathlib.Path(target));db=sqlite3.connect(pathlib.Path(target).as_uri()+'?mode=ro',uri=True)
    cap=db.execute('SELECT * FROM capture').fetchone()
    if json.loads(cap[3])!=json.loads(columns_raw) or json.loads(cap[7])!=json.loads(pin) or cap[5]!=payload_index:raise ValueError('Side store metadata differs from admitted source plan')
    # New schema only. No original-table mutation, migration, replacement, or deletion.
    sql=guard(plan,False)+f'''CREATE SCHEMA {SCHEMA};
CREATE TABLE {SCHEMA}.chunks(sha bytea PRIMARY KEY CHECK(octet_length(sha)=32),bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 65536),body bytea NOT NULL CHECK(bytes=octet_length(body) AND sha256(body)=sha));
CREATE TABLE {SCHEMA}.parts(ordinal integer PRIMARY KEY CHECK(ordinal BETWEEN 0 AND 199999),sha bytea NOT NULL REFERENCES {SCHEMA}.chunks(sha));
CREATE TABLE {SCHEMA}.capture(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),source_sha bytea NOT NULL CHECK(octet_length(source_sha)=32),source_bytes integer NOT NULL CHECK(source_bytes BETWEEN 1 AND 67108864),columns_raw bytea NOT NULL,columns_sha bytea NOT NULL CHECK(sha256(columns_raw)=columns_sha),checkpoint_raw bytea NOT NULL,checkpoint_sha bytea NOT NULL CHECK(sha256(checkpoint_raw)=checkpoint_sha),payload_index integer NOT NULL CHECK(payload_index BETWEEN 0 AND 127),part_count integer NOT NULL CHECK(part_count BETWEEN 1 AND 200000));
CREATE FUNCTION {SCHEMA}.reconstructed() RETURNS bytea LANGUAGE SQL STABLE SET search_path=pg_catalog AS $reconstruct$
 SELECT decode(string_agg(encode(c.body,'hex'),'' ORDER BY p.ordinal),'hex') FROM {SCHEMA}.parts p JOIN {SCHEMA}.chunks c USING(sha)
$reconstruct$;
CREATE FUNCTION {SCHEMA}.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $immutable$ BEGIN RAISE EXCEPTION 'IMMUTABLE_SIDE_STORE'; END $immutable$;
CREATE FUNCTION {SCHEMA}.unsealed() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $unsealed$ BEGIN IF EXISTS(SELECT 1 FROM {SCHEMA}.capture) THEN RAISE EXCEPTION 'SEALED_SIDE_STORE'; END IF; RETURN NEW; END $unsealed$;
CREATE FUNCTION {SCHEMA}.seal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $seal$ DECLARE n integer; a integer; z integer; b bytea; BEGIN
 IF EXISTS(SELECT 1 FROM {SCHEMA}.capture) THEN RAISE EXCEPTION 'SEALED_SIDE_STORE'; END IF;
 SELECT count(*),min(ordinal),max(ordinal) INTO n,a,z FROM {SCHEMA}.parts;
 IF n<>NEW.part_count OR a<>0 OR z<>n-1 THEN RAISE EXCEPTION 'ORDERED_MANIFEST_REFUSAL'; END IF;
 b:={SCHEMA}.reconstructed(); IF octet_length(b)<>NEW.source_bytes OR sha256(b)<>NEW.source_sha THEN RAISE EXCEPTION 'FULL_SOURCE_BYTES_REFUSAL'; END IF;
 RETURN NEW; END $seal$;
CREATE TRIGGER chunks_immutable BEFORE UPDATE OR DELETE ON {SCHEMA}.chunks FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.immutable();
CREATE TRIGGER parts_immutable BEFORE UPDATE OR DELETE ON {SCHEMA}.parts FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.immutable();
CREATE TRIGGER capture_immutable BEFORE UPDATE OR DELETE ON {SCHEMA}.capture FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.immutable();
CREATE TRIGGER chunks_unsealed BEFORE INSERT ON {SCHEMA}.chunks FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.unsealed();
CREATE TRIGGER parts_unsealed BEFORE INSERT ON {SCHEMA}.parts FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.unsealed();
CREATE TRIGGER capture_seal BEFORE INSERT ON {SCHEMA}.capture FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.seal();
'''
    for sha,size,body in db.execute('SELECT sha256,bytes,body FROM chunks ORDER BY sha256'):
        if h(body)!=sha or len(body)!=size:raise ValueError('Chunk corrupt')
        sql+=f"INSERT INTO {SCHEMA}.chunks VALUES(decode('{sha}','hex'),{size},decode('{body.hex()}','hex'));\n"
    for ordinal,sha in db.execute('SELECT ordinal,sha256 FROM parts ORDER BY ordinal'):sql+=f"INSERT INTO {SCHEMA}.parts VALUES({ordinal},decode('{sha}','hex'));\n"
    db.close()
    sql+=f"INSERT INTO {SCHEMA}.capture VALUES(true,decode('{h(raw)}','hex'),{len(raw)},decode('{cap[3].hex()}','hex'),decode('{h(cap[3])}','hex'),decode('{cap[7].hex()}','hex'),decode('{h(cap[7])}','hex'),{cap[5]},{cap[6]});\n"
    sql+=f"DO $capacity$ DECLARE n bigint; BEGIN SELECT sum(pg_total_relation_size(c.oid)) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='{SCHEMA}' AND c.relkind='r'; IF n>134217728 THEN RAISE EXCEPTION 'SIDE_STORE_PHYSICAL_CAP'; END IF; END $capacity$;\n"
    sql+='\\o '+plan['privateJob']+'/side-store-measurements.json\n'+f"SELECT jsonb_build_object('sourceBytes',(SELECT source_bytes FROM {SCHEMA}.capture),'sourceSha256',(SELECT encode(source_sha,'hex') FROM {SCHEMA}.capture),'reconstructedBytes',octet_length({SCHEMA}.reconstructed()),'reconstructedSha256',encode(sha256({SCHEMA}.reconstructed()),'hex'),'uniqueChunkBytes',(SELECT sum(bytes) FROM {SCHEMA}.chunks),'chunkCount',(SELECT count(*) FROM {SCHEMA}.chunks),'partCount',(SELECT count(*) FROM {SCHEMA}.parts),'relations',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'heapBytes',pg_relation_size(c.oid),'indexesBytes',pg_indexes_size(c.oid),'tableWithToastBytes',pg_table_size(c.oid),'totalBytes',pg_total_relation_size(c.oid)) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='{SCHEMA}' AND c.relkind='r'),'schemaTotalBytes',(SELECT sum(pg_total_relation_size(c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='{SCHEMA}' AND c.relkind='r'),'qualification','Sample-only native PostgreSQL heap/TOAST/index measurement; source originals preserved, catalog/WAL/temp/filesystem allocation require outer job evidence.');\n\\o\n"
    sql+='\\copy (SELECT encode('+SCHEMA+'.reconstructed(),\'hex\')) TO '+literal(plan['privateJob']+'/side-reconstructed.hex')+' WITH (FORMAT text)\nCOMMIT;\n'
    if len(sql.encode())>SQL_MAX:raise ValueError('Generated SQL ceiling')
    return sql
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('mode',choices=['capture','side']);p.add_argument('--plan',required=True);p.add_argument('--plan-sha256',required=True);p.add_argument('--side-store');p.add_argument('--output',required=True);a=p.parse_args()
    raw=pathlib.Path(a.plan).read_bytes()
    if len(raw)>65536 or h(raw)!=a.plan_sha256:raise ValueError('Plan raw hash/size refusal')
    plan=json.loads(raw,object_pairs_hook=C.pairs);sql=capture(plan) if a.mode=='capture' else side(plan,a.side_store)
    fd=os.open(a.output,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as f:f.write(sql.encode());f.flush();os.fsync(f.fileno())
    print(json.dumps(dict(status='emit-only-private-pg-script',mode=a.mode,planSha256=h(raw),sqlSha256=h(sql.encode()),sqlBytes=len(sql.encode()),productionExecuted=False,qualification='Outer approved new-job guard/PID/credential/absence/capacity/cleanup and immutable sealed-source clone admission are mandatory before any execution.')))
if __name__=='__main__':main()
