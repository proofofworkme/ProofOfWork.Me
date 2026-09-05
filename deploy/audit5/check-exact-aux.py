#!/usr/bin/python3 -I
"""Offline exact-four-target and approved funding-link outer check.
No subprocess, network, or writes.
Usage: python3 -I check-exact-aux.py CORE BASE_BEFORE EXTRA_BEFORE
       [BASE_INTERMEDIATE EXTRA_INTERMEDIATE [BASE_AFTER EXTRA_AFTER]]
Run in addition to the reviewed standard before/after comparator.
"""
import copy, datetime, decimal, hashlib, json, sys
D = decimal.Decimal
AUX = '4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359'
RAW_SHA = 'c2649f4cda14af58ae35d69a6fbe09786de4b4485f9a0ce8f5a3990d453130b3'
PAYMENT_SCRIPT = '76a9144752142b83faf13d526a59212f3f228012890dbe88ac'
RETURN_SCRIPT = '6a5d081600ff7f8184ec02'
AUX_BLOCK_HEADER_HEX = '00807b29b456988c43a8e892b4ab7ace9651bb4047f900dc66590000000000000000000072c7f85858b1013eb6f54544f386029470275179a116bdd0f08974b9161f5f2c01e9836a3d3502176d04b681'
ADDITIONS = dict(amountSubatoms='0', decimals=16, unitScale='10000000000000000', amountStorageModel='work-subatoms-v2', precisionModel='canonical-work-subatoms-v2')
def need(ok, label):
    if not ok: raise ValueError(label)
def equal(a, b, label):
    # JSON type equality matters for numeric zero versus boolean/string.
    need(json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str), label)
def sha(value): return hashlib.sha256(value).hexdigest()
def fp(value): return sha(json.dumps(value, sort_keys=True, separators=(',', ':'), default=str).encode())
def load(path):
    with open(path) as stream: return json.load(stream, parse_float=D)
def parse_transaction(raw):
    data = bytes.fromhex(raw); need(10 <= len(data) <= 20000, 'raw length')
    cursor = 0
    def take(n):
        nonlocal cursor
        need(n >= 0 and cursor+n <= len(data), 'raw truncation')
        part=data[cursor:cursor+n]; cursor+=n; return part
    def varint():
        first=take(1)[0]
        if first < 253: return first
        size={253:2,254:4,255:8}[first]; value=int.from_bytes(take(size),'little')
        need(value >= {2:253,4:65536,8:4294967296}[size], 'nonminimal varint'); return value
    version_bytes=take(4); version=int.from_bytes(version_bytes,'little',signed=True)
    witness = data[cursor:cursor+2] == b'\x00\x01'
    if witness: take(2)
    body_start=cursor; count=varint(); need(count==6,'vin count'); inputs=[]
    for vin in range(count):
        prev=take(32)[::-1].hex(); vout=int.from_bytes(take(4),'little')
        script=take(varint()).hex(); sequence=int.from_bytes(take(4),'little')
        inputs.append(dict(vin=vin,prev_txid=prev,prev_vout=vout,script_sig=script or None,sequence=sequence,witness=[]))
    count=varint(); need(count==2,'vout count'); outputs=[]
    for vout in range(count):
        value=int.from_bytes(take(8),'little'); script=take(varint()).hex()
        outputs.append(dict(vout=vout,value_sats=value,scriptpubkey=script))
    body_end=cursor
    if witness:
        for item in inputs:
            count=varint(); need(count<=100,'witness bound')
            item['witness']=[take(varint()).hex() for _ in range(count)]
    locktime_bytes=take(4); need(cursor==len(data),'raw trailing bytes')
    stripped=version_bytes+data[body_start:body_end]+locktime_bytes
    need(hashlib.sha256(hashlib.sha256(stripped).digest()).digest()[::-1].hex()==AUX,'raw txid')
    weight=len(stripped)*3+len(data)
    return dict(inputs=inputs,outputs=outputs,version=version,locktime=int.from_bytes(locktime_bytes,'little'),weight=weight,vsize=(weight+3)//4)
def p2pkh_address(script):
    need(script==PAYMENT_SCRIPT,'approved P2PKH script')
    payload=b'\x00'+bytes.fromhex(script[6:-4]); payload+=hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; number=int.from_bytes(payload,'big'); result=''
    while number: number,rem=divmod(number,58); result=alphabet[rem]+result
    return '1'*(len(payload)-len(payload.lstrip(b'\x00')))+result

def raw_hex(extra):
    t=extra['transaction']; r=t['raw_tx']; possibilities=[t.get('raw_hex'),r.get('hex'),r.get('rawCore',{}).get('hex')]
    values=[v.lower() for v in possibilities if isinstance(v,str) and v]
    need(values and len(set(values))==1,'one consistent saved raw hex')
    need(sha(bytes.fromhex(values[0]))==RAW_SHA,'Core raw-hex SHA binding')
    return values[0]
def normalized_inputs(extra):
    return [{k:r[k] for k in ('vin','prev_txid','prev_vout','address','value_sats','sequence','script_sig','witness')} for r in extra['inputs']]
def normalized_outputs(extra):
    return [{k:r[k] for k in ('vout','value_sats','address','scriptpubkey','scriptpubkey_asm','scriptpubkey_type')} for r in extra['outputs']]
def sort_outputs(rows): return sorted(rows,key=lambda r:(r['txid'],r['vout']))
def verify_optional_raw_blocktime(raw, block_epoch):
    # Core getblock verbosity 2 omits per-transaction blocktime. The independently
    # hash-bound block header and transaction.block_time are always required.
    containers=[raw]
    if 'rawCore' in raw:
        need(isinstance(raw['rawCore'],dict),'raw Core transaction object')
        containers.append(raw['rawCore'])
    for container in containers:
        if 'blocktime' in container:
            value=container['blocktime']
            need(type(value) is int and value==block_epoch,'provided raw Core blocktime agrees with canonical header timestamp')
def base_extra_bind(base, extra):
    need(base['format']=='proofofwork-audit5-repair-evidence-v1' and extra['format']=='audit5-exact-aux-fields-v1','evidence format')
    for r in (base,extra): need(r['database']=='proof_indexer' and r['otherDatabaseSessions']==0,'stopped-writer database guard')
    t=extra['transaction']; need(t['network']=='livenet' and t['txid']==AUX and t['status']=='confirmed','aux identity')
    equal({k:base['aux'][k] for k in ('txid','status','height','blockHash','blockIndex')},dict(txid=t['txid'],status=t['status'],height=t['block_height'],blockHash=t['block_hash'],blockIndex=t['block_index']),'base/extra transaction bind')
    equal(base['aux']['inputs'],[dict(vin=r['vin'],prevTxid=r['prev_txid'],prevVout=r['prev_vout'],valueSats=None if r['value_sats'] is None else str(r['value_sats'])) for r in extra['inputs']],'base/extra input bind')
    equal(base['aux']['outputs'],[dict(vout=r['vout'],valueSats=str(r['value_sats']),scriptPubKey=r['scriptpubkey']) for r in extra['outputs']],'base/extra output bind')
    need(base['aux']['opReturnCount']==len(extra['opReturns']),'base/extra OP_RETURN bind')
    equal(base['aux']['anchorLinks'],[dict(txid=r['txid'],vout=r['vout'],spentByTxid=r['spent_by_txid'],spentByVin=r['spent_by_vin'],valueSats=str(r['value_sats']),scriptPubKey=r['scriptpubkey']) for r in extra['anchors']],'base/extra spend-link bind')
    for rows in (extra['inputs'],extra['outputs'],extra['opReturns']):
        need(all(r['network']=='livenet' and r['txid']==AUX for r in rows),'row scope')
    return t

def validate(core, pairs):
    core=core.get('coreProof',core); need(core['ok'] is True,'Core preflight success')
    need(core['coreBefore']==core['coreAfter'],'Core historical preflight checkpoint')
    target={r['txid']:r for r in core['targets']}; need(len(target)==4 and target[AUX]['transactionHexSha256']==RAW_SHA,'four-target Core identity')
    need((core['auxiliaryInputProofs'],core['auxiliaryOutputProofs'],core['auxiliaryMinerFeeProofs'])==('3593','3118','475'),'Core exact sums')
    before, before_extra=pairs[0]; tx=base_extra_bind(before,before_extra)
    raw=raw_hex(before_extra); parsed=parse_transaction(raw); address=p2pkh_address(PAYMENT_SCRIPT)
    expected_inputs=[]
    need(len(core['auxiliaryInputs'])==6,'six parent proofs')
    for item,parent in zip(parsed['inputs'],core['auxiliaryInputs']):
        equal((item['vin'],item['prev_txid'],item['prev_vout']),(parent['vin'],parent['prevTxid'],parent['prevVout']),'raw/Core prevout relation')
        need(parent['scriptPubKey']==PAYMENT_SCRIPT,'Core parent script')
        expected_inputs.append(dict(item,address=address,value_sats=int(parent['valueSats'])))
    expected_outputs=[]
    need(len(core['auxiliaryOutputs'])==2,'two Core output proofs')
    for item,parent in zip(parsed['outputs'],core['auxiliaryOutputs']):
        equal((item['vout'],str(item['value_sats']),item['scriptpubkey']),(parent['vout'],parent['valueSats'],parent['scriptPubKey']),'raw/Core output relation')
        if item['vout']==0:
            need(item['scriptpubkey']==PAYMENT_SCRIPT,'payment script'); fields=dict(address=address,scriptpubkey_asm='OP_DUP OP_HASH160 '+PAYMENT_SCRIPT[6:-4]+' OP_EQUALVERIFY OP_CHECKSIG',scriptpubkey_type='pubkeyhash')
        else:
            need(item['scriptpubkey']==RETURN_SCRIPT,'complete OP_13 script'); fields=dict(address=None,scriptpubkey_asm='OP_RETURN 13 1600ff7f8184ec02',scriptpubkey_type='nulldata')
        expected_outputs.append(dict(item,**fields))
    need(sum(r['value_sats'] for r in expected_inputs)==3593 and sum(r['value_sats'] for r in expected_outputs)==3118,'exact decoded economics')
    equal(before['aux']['anchorLinks'],core['preservedAnchors'],'five saved Core anchors')
    need(len(before_extra['anchors'])==5,'five complete anchor rows')
    funding=expected_inputs[0]
    need(funding['prev_txid']=='fc57450c502e054ecf23469d88f5249a578799da59d111fe234e50ca593c20e5' and funding['prev_vout']==3 and funding['value_sats']==863,'only approved funding prevout')
    funding_before=dict(network='livenet',txid=funding['prev_txid'],vout=3,value_sats=863,address=address,scriptpubkey=PAYMENT_SCRIPT,scriptpubkey_asm=expected_outputs[0]['scriptpubkey_asm'],scriptpubkey_type='pubkeyhash',spent_by_txid=None,spent_by_vin=None,spent_at=None)
    parents_before=sort_outputs(before_extra['anchors']+[funding_before])
    equal(before_extra['parentOutputs'],parents_before,'baseline must contain only five existing anchors and the exact approved unlinked funding row')
    block_time=tx['block_time']; need(isinstance(block_time,str),'existing transaction block_time')
    parsed_time=datetime.datetime.fromisoformat(block_time)
    need(parsed_time.tzinfo is not None and parsed_time.microsecond==0,'canonical whole-second timestamp with timezone')
    block_epoch=int(parsed_time.timestamp())
    header=bytes.fromhex(AUX_BLOCK_HEADER_HEX)
    need(len(header)==80 and hashlib.sha256(hashlib.sha256(header).digest()).digest()[::-1].hex()==target[AUX]['blockHash'],'canonical Core header hash binding')
    need(block_epoch==int.from_bytes(header[68:72],'little'),'exact canonical header timestamp')
    verify_optional_raw_blocktime(tx['raw_tx'],block_epoch)
    funding_after=dict(funding_before,spent_by_txid=AUX,spent_by_vin=0,spent_at=block_time)
    parents_after=sort_outputs(before_extra['anchors']+[funding_after])
    for r in before_extra['anchors']:
        equal(r['spent_at'],block_time,'existing anchor spent_at must already equal canonical transaction block_time')
        parent=expected_inputs[r['spent_by_vin']]
        equal((r['txid'],r['vout'],r['spent_by_txid'],r['value_sats'],r['scriptpubkey']),(parent['prev_txid'],parent['prev_vout'],AUX,parent['value_sats'],PAYMENT_SCRIPT),'full anchor Core binding')
    need(len(before['targetEvents'])==3 and {e['txid'] for e in before['targetEvents']}==set(target)-{AUX},'exact three metadata identities')
    for e in before['targetEvents']:
        t=target[e['txid']]; joined=dict(e,block_hash=t['blockHash'],transaction_block_height=t['height'],transaction_block_index=t['blockIndex'])
        need(fp(joined)==t['joinedDatabaseProofRowSha256'],'exact event saved preflight row hash')
        carriers=t['opReturns']; need(len(carriers)==1 and carriers[0]['vout']==e['op_return_vout']==1 and e['record_ordinal']==0,'event carrier identity')
        script=bytes.fromhex(carriers[0]['script']); need(script[:2]==b'\x6a\x4d' and int.from_bytes(script[2:4],'little')==len(script)-4,'event exact push carrier')
        need(script[4:].decode('utf-8')==e['raw_payload'],'event raw payload/Core bytes')
    for index,(base,extra) in enumerate(pairs):
        current=base_extra_bind(base,extra); need(raw_hex(extra)==raw,'raw transaction bytes preserved')
        verify_optional_raw_blocktime(current['raw_tx'],block_epoch)
        equal(extra['anchors'],before_extra['anchors'] if index==0 else parents_after,'five complete anchors unchanged plus only the approved funding spend link')
        equal(extra['parentOutputs'],parents_before if index==0 else parents_after,'only three approved funding spend fields may change on six exact parent rows')
        for field in ('invariants','protectedSnapshots'): equal(base[field],before[field],'unchanged '+field)
        if index==0:
            need(len(extra['inputs'])==5 and len(extra['outputs'])==0 and extra['opReturns']==[] and all(r['value_sats'] is None for r in extra['inputs']),'known sparse baseline')
            continue
        equal(normalized_inputs(extra),expected_inputs,'exact persisted six inputs including address/sequence/scriptSig/witness')
        equal(normalized_outputs(extra),expected_outputs,'exact persisted two outputs including address/ASM/type')
        equal(extra['opReturns'],[],'OP_13 carrier has no push-only protocol row')
        need(current['fee_sats']==475 and current['source']=='canonical-block-scan','persisted fee/source')
        for field in ('version','locktime','vsize','weight'): equal(current[field],parsed[field],'raw exact transaction '+field)
        for column in ('txid','status','block_hash','block_height','block_index','block_time','network','first_seen_at','raw_hex','dropped_at','dropped_reason','replaced_by_txid'):
            equal(current[column],tx[column],'transaction preserved '+column)
        if index==1:
            equal(base['targetEvents'],before['targetEvents'],'canonical repair must not change metadata events')
            equal(base['missingZeroMetadataTxids'],before['missingZeroMetadataTxids'],'metadata not yet repaired')
        else:
            for field in ('transaction','inputs','outputs','opReturns','anchors','parentOutputs'): equal(extra[field],pairs[1][1][field],'metadata writer must not change auxiliary '+field)
            need(base['missingZeroMetadataTxids']==[],'no remaining approved metadata omissions')
            expected=copy.deepcopy(before['targetEvents'])
            for e,actual in zip(expected,base['targetEvents']): e['payload'].update(ADDITIONS); e['updated_at']=actual['updated_at']
            equal(base['targetEvents'],expected,'only approved five metadata keys and updated_at')
    return dict(ok=True,phase=['before','intermediate','after'][len(pairs)-1],exactRawSha256=RAW_SHA,expectedInputRows=6,expectedOutputRows=2,persistedInputRows=len(pairs[-1][1]['inputs']),persistedOutputRows=len(pairs[-1][1]['outputs']),inputProofs='3593',outputProofs='3118',persistedFeeProofs='475' if len(pairs)>1 else None,parsedOpReturnRows=0,rawOpReturnScript=RETURN_SCRIPT,existingAnchorRows=5,approvedFundingLinks=1 if len(pairs)>1 else 0,metadataRecords=3,qualification='Saved canonical Core bytes/parents and stopped SQL phases; the standard comparator and quiescence guard remain mandatory. Exactly three funding spend fields are approved; no spendability claim for newly restored auxiliary outputs.')
if __name__=='__main__':
    need(len(sys.argv) in (4,6,8),'expected CORE plus one/two/three BASE EXTRA pairs')
    values=[load(p) for p in sys.argv[1:]]
    print(json.dumps(validate(values[0],list(zip(values[1::2],values[2::2]))),indent=2))
