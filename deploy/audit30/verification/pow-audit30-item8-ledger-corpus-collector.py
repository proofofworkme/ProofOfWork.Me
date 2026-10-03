#!/usr/bin/python3
"""Named historical transaction census and offline integer oracle; never signs/writes."""
import argparse, collections, datetime, decimal, hashlib, json, os, pathlib, re, selectors, signal, stat, struct, subprocess, sys, time

EXPECTATIONS_SHA='441b79cd6ee0071ec8e5497cba1eacdf73613e642d08f3301cfdbe117f6a5ce5'
MAX_RPC_BYTES=8*1024*1024
MAX_TOTAL_BYTES=256*1024*1024
MAX_CALLS=2000
TXID=re.compile(r'[0-9a-f]{64}\Z')
TREASURY_ADDRESSES=('1447TsdXtFSnVrWawSamyyQKPDNW4ALtBT','1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x','1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv')
def sha(x):return hashlib.sha256(x).hexdigest()
def dsha(x):return hashlib.sha256(hashlib.sha256(x).digest()).digest()
def require(ok,msg):
    if not ok:raise ValueError(msg)
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def proofs(value):
    require(isinstance(value,(decimal.Decimal,int,str)) and not isinstance(value,bool),'Nonexact proof amount')
    n=decimal.Decimal(value)*100000000
    require(n.is_finite() and n==n.to_integral_value() and 0<=n<=2100000000000000,'Invalid/fractional proof amount')
    return int(n)
def compact_size(raw,pos):
    require(pos<len(raw),'Truncated CompactSize');n=raw[pos];pos+=1
    if n<253:return n,pos
    width={253:2,254:4,255:8}[n];require(pos+width<=len(raw),'Truncated CompactSize body');v=int.from_bytes(raw[pos:pos+width],'little')
    require(v>={253:253,254:65536,255:4294967296}[n],'Noncanonical CompactSize')
    return v,pos+width
def parse_raw(rawhex):
    require(isinstance(rawhex,str) and len(rawhex)%2==0 and len(rawhex)<=2*MAX_RPC_BYTES,'Raw transaction hex bound')
    raw=bytes.fromhex(rawhex);require(len(raw)>=10,'Short transaction');pos=4;version=raw[:4];witness=False
    if raw[pos]==0:
        require(raw[pos+1]==1,'Unsupported witness flags');pos+=2;witness=True
    start=pos;n,pos=compact_size(raw,pos);require(0<n<=100000,'Input count bound');inputs=[]
    for _ in range(n):
        require(pos+36<=len(raw),'Short input');t=raw[pos:pos+32][::-1].hex();v=int.from_bytes(raw[pos+32:pos+36],'little');pos+=36
        length,pos=compact_size(raw,pos);require(pos+length+4<=len(raw),'Short input script');pos+=length+4
        inputs.append({'txid':t,'vout':v})
    ni,pos=compact_size(raw,pos);require(0<ni<=100000,'Output count bound');outputs=[]
    for i in range(ni):
        require(pos+8<=len(raw),'Short output');amount=int.from_bytes(raw[pos:pos+8],'little');pos+=8
        length,pos=compact_size(raw,pos);require(pos+length<=len(raw),'Short output script');script=raw[pos:pos+length].hex();pos+=length
        require(amount<=2100000000000000,'Out-of-range output');outputs.append({'vout':i,'proofs':amount,'scriptPubKey':script})
    end=pos
    if witness:
        for _ in inputs:
            k,pos=compact_size(raw,pos);require(k<=100000,'Witness item bound')
            for __ in range(k):
                z,pos=compact_size(raw,pos);require(pos+z<=len(raw),'Short witness');pos+=z
    require(pos+4==len(raw),'Trailing/truncated locktime')
    base=version+raw[start:end]+raw[pos:pos+4]
    return {'txid':dsha(base)[::-1].hex(),'rawHex':rawhex,'rawBytesSha256':sha(raw),'inputs':inputs,'outputs':outputs,'hasWitness':witness}
def address_script(address):
    if address.startswith(('1','3')):
        alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';n=0
        for ch in address:require(ch in alphabet,'Invalid Base58 address');n=n*58+alphabet.index(ch)
        b=n.to_bytes((n.bit_length()+7)//8,'big');b=b'\0'*(len(address)-len(address.lstrip('1')))+b
        require(len(b)==25 and dsha(b[:-4])[:4]==b[-4:],'Base58 address checksum')
        if b[0]==0:return '76a914'+b[1:21].hex()+'88ac'
        require(b[0]==5,'Wrong address network');return 'a914'+b[1:21].hex()+'87'
    require(address.startswith('bc1') and address==address.lower(),'Unsupported address/network')
    alphabet='qpzry9x8gf2tvdw0s3jn54khce6mua7l';data=[]
    for ch in address[3:]:require(ch in alphabet,'Invalid Bech32');data.append(alphabet.index(ch))
    require(len(data)>=7,'Short Bech32');check=1;generators=(0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3)
    for val in [3,3,0,2,3]+data:
        top=check>>25;check=((check&0x1ffffff)<<5)^val
        for i,g in enumerate(generators):
            if (top>>i)&1:check^=g
    version=data[0];require(version<=16 and check==(1 if version==0 else 0x2bc830a3),'Bech32 version/checksum')
    acc=bits=0;out=bytearray()
    for v in data[1:-6]:
        acc=(acc<<5)|v;bits+=5
        while bits>=8:bits-=8;out.append((acc>>bits)&255)
    require(bits<5 and ((acc<<(8-bits))&255)==0,'Bech32 noncanonical padding')
    require(2<=len(out)<=40 and (version!=0 or len(out) in (20,32)),'Witness program size')
    return bytes([0 if version==0 else 0x50+version,len(out)]).hex()+out.hex()
def normalize_verbose(value):
    r=parse_raw(value['hex']);require(r['txid']==value['txid'],'Raw/Core txid differs')
    require(len(value['vin'])==len(r['inputs']) and len(value['vout'])==len(r['outputs']),'Raw/Core count differs')
    for a,b in zip(r['inputs'],value['vin']):
        if a['txid']=='0'*64:require('coinbase' in b,'Raw/Core coinbase differs')
        else:require((a['txid'],a['vout'])==(b['txid'],b['vout']),'Raw/Core prevout differs')
    for a,b in zip(r['outputs'],value['vout']):require((a['vout'],a['proofs'],a['scriptPubKey'])==(b['n'],proofs(b['value']),b['scriptPubKey']['hex']),'Raw/Core output differs')
    r['blockHash']=value.get('blockhash');r['confirmationsAtCapture']=value.get('confirmations',0);return r
def op_return_payload(script):
    raw=bytes.fromhex(script)
    if not raw or raw[0]!=0x6a:return b''
    pos=1;out=bytearray()
    while pos<len(raw):
        n=raw[pos];pos+=1
        if n==0:continue
        if n==76:require(pos<len(raw),'Short OP_RETURN push');n=raw[pos];pos+=1
        elif n==77:require(pos+2<=len(raw),'Short OP_RETURN push2');n=int.from_bytes(raw[pos:pos+2],'little');pos+=2
        elif n==78:require(pos+4<=len(raw),'Short OP_RETURN push4');n=int.from_bytes(raw[pos:pos+4],'little');pos+=4
        else:require(n<=75,'Nonpush OP_RETURN opcode')
        require(pos+n<=len(raw),'Truncated OP_RETURN data');out.extend(raw[pos:pos+n]);pos+=n
    return bytes(out)
class RPC:
    def __init__(self):self.calls=0;self.bytes=0;self.deadline=time.monotonic()+1200
    def call(self,method,*args):
        require(method in ('getblockchaininfo','getrawtransaction','getblockheader','getblockhash','gettxoutproof','verifytxoutproof'),'RPC method not read-only admitted')
        self.calls+=1;require(self.calls<=MAX_CALLS and time.monotonic()<self.deadline,'RPC count/overall deadline')
        cmd=['/usr/bin/sudo','-n','-u','bitcoin','/usr/local/bin/bitcoin-cli','-conf=/etc/bitcoin/bitcoin.conf',method,*map(str,args)]
        p=subprocess.Popen(cmd,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'},cwd='/');sel=selectors.DefaultSelector();out=bytearray();err=bytearray();deadline=min(self.deadline,time.monotonic()+20)
        try:
            for s,b in ((p.stdout,out),(p.stderr,err)):os.set_blocking(s.fileno(),False);sel.register(s,selectors.EVENT_READ,b)
            while sel.get_map():
                require(time.monotonic()<deadline,'RPC call deadline')
                for k,_ in sel.select(.2):
                    block=os.read(k.fd,65536)
                    if not block:sel.unregister(k.fileobj)
                    else:k.data.extend(block);require(len(k.data)<=MAX_RPC_BYTES,'RPC response bound')
            code=p.wait(timeout=max(.01,deadline-time.monotonic()));require(code==0,'Core RPC refusal (stderr omitted; SHA='+sha(err)+')')
            self.bytes+=len(out);require(self.bytes<=MAX_TOTAL_BYTES,'RPC cumulative byte bound')
            try:value=json.loads(out,parse_float=decimal.Decimal)
            except json.JSONDecodeError:value=out.decode().strip()
            return value,sha(out)
        finally:
            if p.poll() is None:
                try:os.killpg(p.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                p.wait()
            sel.close();p.stdout.close();p.stderr.close()
def header_proof(header):
    require(isinstance(header,str) and len(header)==160,'Block header byte count')
    raw=bytes.fromhex(header);return dsha(raw)[::-1].hex()
def merkle_inclusion(proofhex):
    require(isinstance(proofhex,str) and len(proofhex)<=2*MAX_RPC_BYTES,'Merkle proof bound')
    raw=bytes.fromhex(proofhex);require(len(raw)>=86,'Short Merkle proof');total=int.from_bytes(raw[80:84],'little');require(0<total<=1000000,'Merkle transaction count bound')
    nh,pos=compact_size(raw,84);require(0<nh<=total and pos+32*nh<=len(raw),'Merkle hash count/body')
    hashes=[raw[pos+i*32:pos+(i+1)*32] for i in range(nh)];pos+=32*nh;nb,pos=compact_size(raw,pos);require(0<nb<=((total*2+7)//8) and pos+nb==len(raw),'Merkle flag framing')
    flags=raw[pos:];bitsused=hashused=0;matched=[]
    def width(height):return (total+(1<<height)-1)>>height
    def walk(height,position):
        nonlocal bitsused,hashused
        require(bitsused<len(flags)*8,'Merkle flag exhaustion');bit=(flags[bitsused//8]>>(bitsused%8))&1;bitsused+=1
        if height==0 or not bit:
            require(hashused<len(hashes),'Merkle hash exhaustion');h=hashes[hashused];hashused+=1
            if height==0 and bit:matched.append(h[::-1].hex())
            return h
        left=walk(height-1,position*2)
        if position*2+1<width(height-1):
            right=walk(height-1,position*2+1);require(left!=right,'Mutated Merkle tree')
        else:right=left
        return dsha(left+right)
    height=0
    while width(height)>1:height+=1
    root=walk(height,0);require(hashused==len(hashes) and (bitsused+7)//8==len(flags) and root==raw[36:68],'Merkle root/consumption differs')
    return {'blockHash':header_proof(raw[:80].hex()),'matchedTxids':matched,'totalTransactions':total}
def collect(expectations,stage):
    rpc=RPC();before,_=rpc.call('getblockchaininfo');require(before['chain']=='main','Wrong chain')
    targets=expectations['stages'][stage];primary={};parents={};blocks={}
    for e in targets:
        v,response_sha=rpc.call('getrawtransaction',e['txid'],'true');tx=normalize_verbose(v);require(tx['blockHash'] and tx['confirmationsAtCapture']>0,'Target unconfirmed/mempool')
        tx['coreResponseSha256']=response_sha;primary[tx['txid']]=tx
        block=tx['blockHash']
        if block not in blocks:
            h,_=rpc.call('getblockheader',block,'true');raw,_=rpc.call('getblockheader',block,'false');canon,_=rpc.call('getblockhash',h['height'])
            require(canon==block==header_proof(raw) and h['confirmations']>0,'Target block not canonical');blocks[block]={'height':h['height'],'headerHex':raw,'canonicalHashAtCapture':canon}
        proof,proof_sha=rpc.call('gettxoutproof',json.dumps([tx['txid']],separators=(',',':')),block);verified,_=rpc.call('verifytxoutproof',proof)
        require(verified==[tx['txid']] and header_proof(proof[:160])==block,'Core inclusion proof readback differs')
        tx['coreInclusionProofHex']=proof;tx['coreInclusionProofResponseSha256']=proof_sha;tx['coreVerifiedIncludedTxids']=verified
        for inp in tx['inputs']:
            require(inp['txid']!='0'*64,'Named corpus cannot be a coinbase')
            if inp['txid'] not in parents and inp['txid'] not in primary:
                pv,ph=rpc.call('getrawtransaction',inp['txid'],'true');pt=normalize_verbose(pv);pt['coreResponseSha256']=ph;parents[inp['txid']]=pt
    # Fence historical target canonical blocks again; live tip may legitimately advance.
    for block,b in blocks.items():b['canonicalHashAfter'],_=rpc.call('getblockhash',b['height']);require(b['canonicalHashAfter']==block,'Historical block changed during census')
    after,_=rpc.call('getblockchaininfo')
    result={'schema':'audit30-item8-ledger-corpus-v1','atUtc':utc(),'stage':stage,'expectationsSha256':EXPECTATIONS_SHA,'productionMutation':False,'chainBefore':{'height':before['blocks'],'hash':before['bestblockhash']},'chainAfter':{'height':after['blocks'],'hash':after['bestblockhash']},'transactions':primary,'parents':parents,'blocks':blocks,'rpcCalls':rpc.calls,'rpcBytes':rpc.bytes,'qualifications':expectations['qualifications']}
    result['oracle']=verify(result,expectations);return result
def verify(corpus,expectations):
    require(corpus['schema']=='audit30-item8-ledger-corpus-v1' and corpus['expectationsSha256']==EXPECTATIONS_SHA,'Corpus scope/hash differs')
    targets=expectations['stages'][corpus['stage']];require(set(corpus['transactions'])=={e['txid'] for e in targets},'Target set differs');alltx={**corpus['parents'],**corpus['transactions']};proofrows=[]
    for txid,t in alltx.items():
        actual=parse_raw(t['rawHex']);require(actual['txid']==txid==t['txid'] and actual['inputs']==t['inputs'] and actual['outputs']==t['outputs'] and actual['rawBytesSha256']==t['rawBytesSha256'],'Captured raw identity/output drift')
    for e in targets:
        t=corpus['transactions'][e['txid']];b=corpus['blocks'][t['blockHash']]
        require(t['confirmationsAtCapture']>0 and header_proof(b['headerHex'])==t['blockHash']==b['canonicalHashAtCapture']==b['canonicalHashAfter'],'Canonical block/header binding')
        inclusion=merkle_inclusion(t['coreInclusionProofHex']);require(t['coreVerifiedIncludedTxids']==[e['txid']] and inclusion['blockHash']==t['blockHash'] and inclusion['matchedTxids']==[e['txid']],'Independent Merkle/Core inclusion/readback binding')
        if 'height' in e:require(b['height']==e['height'],'Documented height differs')
        seen=set();ins=[]
        for i in t['inputs']:
            key=(i['txid'],i['vout']);require(key not in seen,'Duplicate input');seen.add(key);require(i['txid'] in alltx,'Missing parent raw proof')
            outs=alltx[i['txid']]['outputs'];require(0<=i['vout']<len(outs),'Missing prevout');ins.append(outs[i['vout']])
        totalin=sum(x['proofs'] for x in ins);totalout=sum(x['proofs'] for x in t['outputs']);fee=totalin-totalout;require(fee>=0,'Negative fee')
        for key,actual in [('inputProofs',totalin),('feeProofs',fee),('inputCount',len(ins))]:
            if key in e:require(actual==e[key],'Historical '+key+' differs')
        if 'expectedInputValueCounts' in e:require(dict(collections.Counter(str(i['proofs']) for i in ins))==e['expectedInputValueCounts'],'Treasury sweep input denomination census differs')
        if 'expectedInputAddress' in e:require(all(x['scriptPubKey']==address_script(e['expectedInputAddress']) for x in ins),'Sweep input custody script differs')
        paid=None
        if 'recipient' in e:
            paid=sum(o['proofs'] for o in t['outputs'] if o['scriptPubKey']==address_script(e['recipient']));require(paid==e['paidProofs'],'Payout script/amount differs')
        if 'components' in e:require(sum(e['components'])==e['paidProofs'],'Documented payout arithmetic differs')
        if 'registryPaymentProofs' in e:require(sum(o['proofs'] for o in t['outputs'] if o['scriptPubKey']==address_script(e.get('registryAddress',expectations['registryAddress'])))==e['registryPaymentProofs'],'Registry payment differs')
        if 'memo' in e:require(any(e['memo'].encode() in op_return_payload(o['scriptPubKey']) for o in t['outputs']),'Documented OP_RETURN marker not found')
        proofrows.append({'txid':e['txid'],'kind':e['kind'],'height':b['height'],'inputProofs':totalin,'outputProofs':totalout,'feeProofs':fee,'paidToExpectedScriptProofs':paid,'rawBytesSha256':t['rawBytesSha256']})
    sums=snapshot_math(expectations)
    return {'namedTransactionRawAndCoreCanonicalChecksPass':True,'independentRawTxidAndMerkleInclusionPass':True,'rows':proofrows,'snapshotArithmetic':sums,'unresolvedPayoutAssociations':expectations['unresolvedPayoutAssociations'],'financialReconciliationComplete':False,'qualification':'Named raw transaction/partial-Merkle checks plus Core canonical block readback. Historical eligibility, payout association, address-wide balances and complete liabilities remain separate.'}
def snapshot_math(e):
    v=e['workV1Snapshot'];ls=v['listings'];ss=v['sellers'];require(len({l['listingId'] for l in ls})==len(ls),'Duplicate V1 listing snapshot')
    for l in ls:
        require(all(type(l[k]) is int and l[k]>=0 for k in ('listingMinerFeeSats','sealMinerFeeSats','sealPaymentSats','refundSats')),'Invalid snapshot integer')
        require(l['refundSats']==l['listingMinerFeeSats']+l['sealMinerFeeSats']+l['sealPaymentSats'],'V1 refund formula')
        require(l['sealPaymentSats']==(546 if l['sealed'] else 0),'V1 seal payment formula')
    byseller=collections.defaultdict(list)
    for l in ls:byseller[l['sellerAddress']].append(l)
    require(len(ss)==len(byseller) and len({s['sellerAddress'] for s in ss})==len(ss),'V1 seller set')
    for s in ss:
        rows=byseller[s['sellerAddress']];require(set(s['listingIds'])=={l['listingId'] for l in rows} and len(s['listingIds'])==len(rows),'V1 seller listing association')
        require(s['listingCount']==len(rows) and s['sealedListingCount']==sum(l['sealed'] for l in rows),'V1 seller counts')
        for k in ('listingMinerFeeSats','sealMinerFeeSats','sealPaymentSats','refundSats'):require(s[k]==sum(l[k] for l in rows),'V1 seller total '+k)
    totals={'listingCount':len(ls),'sellerCount':len(ss),'sealedListingCount':sum(l['sealed'] for l in ls),**{k:sum(l[k] for l in ls) for k in ('listingMinerFeeSats','sealMinerFeeSats','sealPaymentSats','refundSats')}};require(totals==v['totals'],'V1 global totals')
    w=e['workV2Review'];require(w['status']=='review-only-not-paid' and w['signingPerformed'] is False and w['payoutPerformed'] is False,'V2 review changed payment status')
    for r in w['events']:require(r['refundReviewSats']==r['registryFeeSats']+r['minerFeeSats'] and r['ticket']['excludedFromRefund'] is True,'V2 review/ticket formula')
    require(sum(r['refundReviewSats'] for r in w['events'])==w['totals']['refundReviewSats'],'V2 review totals')
    return {'v1':totals,'v2ReviewOnlyProofs':w['totals']['refundReviewSats'],'v2PayoutClaim':False}
def verify_projection(corpus,lines):
    require(len(lines)<=32*1024*1024,'Projection byte bound')
    objects=[json.loads(line) for line in lines.splitlines() if line.strip()];by={x['kind']:x for x in objects}
    require(len(objects)==3 and len(by)==3 and set(by)=={'fence','treasuryWorkProjection','namedTransactionProjection'},'Projection framing/set differs')
    require(by['fence']['readOnly']=='on','Projection transaction not read-only')
    rows=by['namedTransactionProjection']['rows'];mapping={r['txid']:r for r in rows};require(len(mapping)==len(rows)==by['namedTransactionProjection']['targetCount'],'Projection duplicate/count differs')
    checks=0
    for txid,t in corpus['transactions'].items():
        require(txid in mapping,'Named transaction missing from projection');r=mapping[txid];b=corpus['blocks'][t['blockHash']]
        require((r['status'],r['blockHeight'],r['blockHash'])==('confirmed',b['height'],t['blockHash']),'Projection canonical state differs: '+txid)
        ins=r['inputs'];outs=r['outputs'];require(ins is not None and outs is not None and len(ins)==len(t['inputs']) and len(outs)==len(t['outputs']),'Projection row count differs: '+txid)
        parents={**corpus['parents'],**corpus['transactions']};totalin=0
        for n,(a,i) in enumerate(zip(ins,t['inputs'])):
            expected=parents[i['txid']]['outputs'][i['vout']]['proofs'];require((a['vin'],a['prevTxid'],a['prevVout'],a['valueProofs'])==(n,i['txid'],i['vout'],str(expected)),'Projection input differs: '+txid);totalin+=expected
        for a,o in zip(outs,t['outputs']):require((a['vout'],a['valueProofs'],a['scriptPubKey'])==(o['vout'],str(o['proofs']),o['scriptPubKey']),'Projection output differs: '+txid)
        require(r['feeProofs']==str(totalin-sum(o['proofs'] for o in t['outputs'])),'Projection fee differs: '+txid);checks+=len(ins)+len(outs)+2
    balance=by['treasuryWorkProjection'];require(balance['confirmedUnit']=='WORK subatoms (10^16 per WORK)','Treasury unit label differs')
    require(len(balance['rows'])==3 and {r['address'] for r in balance['rows']}==set(TREASURY_ADDRESSES),'Treasury exact address projection set differs')
    for r in balance['rows']:
        require(re.fullmatch(r'0|[1-9][0-9]*',r['confirmedBalanceSubatoms']) is not None and re.fullmatch(r'-?(0|[1-9][0-9]*)',r['pendingDeltaSubatoms']) is not None,'Noncanonical treasury integer')
    return {'namedRawProjectionChecksPass':True,'checks':checks,'projectionFence':by['fence'],'treasuryWorkProjection':balance,'qualification':'Exact bounded named transaction projections match Core raw proofs. Treasury WORK projection integers are observed, not independently replayed balances. Current proof-wallet UTXOs, all address histories, unknown May9 payouts, unenumerated liabilities and historical cutover eligibility remain open.'}
def main():
    p=argparse.ArgumentParser();p.add_argument('--stage',choices=('legacy','work-v1','work-v2-review'));p.add_argument('--expectations',required=True);p.add_argument('--expectations-sha256',required=True);p.add_argument('--verify-corpus');p.add_argument('--verify-projection');a=p.parse_args()
    require(sys.flags.isolated,'Isolated Python required')
    if a.expectations=='-':raw=sys.stdin.buffer.read(1024*1024+1)
    else:
        with open(a.expectations,'rb') as f:raw=f.read(1024*1024+1)
    require(len(raw)<=1024*1024 and a.expectations_sha256==sha(raw)==EXPECTATIONS_SHA,'Frozen expectations hash differs');e=json.loads(raw);snapshot_math(e)
    if a.verify_corpus:
        raw=pathlib.Path(a.verify_corpus).read_bytes();require(len(raw)<=MAX_TOTAL_BYTES,'Corpus bound');corpus=json.loads(raw);out=verify(corpus,e)
        if a.verify_projection:out['projectionComparison']=verify_projection(corpus,pathlib.Path(a.verify_projection).read_bytes())
    else:
        require(os.geteuid()==0 and a.stage,'Root read-only corpus collection requires stage');out=collect(e,a.stage)
    print(json.dumps(out,sort_keys=True))
if __name__=='__main__':
    try:main()
    except BaseException as e:print(json.dumps({'schema':'audit30-item8-ledger-refusal-v1','productionMutation':False,'errorClass':type(e).__name__,'error':str(e)}),file=sys.stderr);raise SystemExit(1)
