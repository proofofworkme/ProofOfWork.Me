#!/usr/bin/python3
"""Named historical transaction census and offline integer oracle; never signs/writes."""
import argparse, collections, pwd, datetime, decimal, hashlib, json, os, pathlib, re, selectors, signal, stat, struct, subprocess, sys, time

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
_OPERATOR_INTERRUPTED=None
class RPCFailure(Exception):
    def __init__(self,category,method,args,stderr_sha=None,stdout_sha=None,exit_code=None,core_code=None):
        super().__init__('Typed read-only RPC '+category);self.row=dict(category=category,method=method,argumentsSha256=sha(json.dumps(list(map(str,args)),separators=(',',':')).encode()),stderrSha256=stderr_sha,stdoutSha256=stdout_sha,exitCode=exit_code,coreErrorCode=core_code)
    @property
    def resource(self):return self.row['category'] in ('overall-deadline','call-count','response-bound','cumulative-bound','operator-interrupted')
class RPC:
    def __init__(self):self.calls=0;self.bytes=0;self.deadline=time.monotonic()+1200
    def call(self,method,*args):
        if _OPERATOR_INTERRUPTED is not None:raise RPCFailure('operator-interrupted',method,args)
        require(method in ('getblockchaininfo','getrawtransaction','getblockheader','getblockhash','gettxoutproof','verifytxoutproof'),'RPC method not read-only admitted')
        if self.calls>=MAX_CALLS:raise RPCFailure('call-count',method,args)
        self.calls+=1
        if time.monotonic()>=self.deadline:raise RPCFailure('overall-deadline',method,args)
        cli=['/usr/local/bin/bitcoin-cli','-conf=/etc/bitcoin/bitcoin.conf',method,*map(str,args)]
        if os.geteuid()==pwd.getpwnam('bitcoin').pw_uid:cmd=cli
        else:
            require(os.geteuid()==0,'Native bitcoin or privileged read-only observer required');cmd=['/usr/bin/sudo','-n','-u','bitcoin',*cli]
        try:p=subprocess.Popen(cmd,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'},cwd='/')
        except OSError as ex:raise RPCFailure('transport-os-error',method,args) from ex
        sel=selectors.DefaultSelector();out=bytearray();err=bytearray();deadline=min(self.deadline,time.monotonic()+20)
        try:
            for s,b in ((p.stdout,out),(p.stderr,err)):os.set_blocking(s.fileno(),False);sel.register(s,selectors.EVENT_READ,b)
            while sel.get_map():
                if _OPERATOR_INTERRUPTED is not None:raise RPCFailure('operator-interrupted',method,args,sha(err),sha(out))
                if time.monotonic()>=deadline:raise RPCFailure('overall-deadline' if time.monotonic()>=self.deadline else 'call-timeout',method,args,sha(err),sha(out))
                for k,_ in sel.select(.2):
                    block=os.read(k.fd,65536)
                    if not block:sel.unregister(k.fileobj)
                    else:
                        self.bytes+=len(block);k.data.extend(block)
                        if self.bytes>MAX_TOTAL_BYTES:raise RPCFailure('cumulative-bound',method,args,sha(err),sha(out))
                        if len(k.data)>MAX_RPC_BYTES:raise RPCFailure('response-bound',method,args,sha(err),sha(out))
            code=p.wait(timeout=max(.01,deadline-time.monotonic()))
            if code:
                m=re.search(rb'error code:\s*(-?[0-9]+)',err);core=int(m.group(1)) if m else None
                raise RPCFailure('core-refusal',method,args,sha(err),sha(out),code,core)
            try:value=json.loads(out,parse_float=decimal.Decimal)
            except json.JSONDecodeError:
                try:value=out.decode().strip()
                except UnicodeError as ex:raise RPCFailure('response-decoding',method,args,sha(err),sha(out)) from ex
            return value,sha(out)
        except OSError as e:raise RPCFailure('transport-os-error',method,args,sha(err),sha(out)) from e
        except subprocess.TimeoutExpired as e:raise RPCFailure('call-timeout',method,args,sha(err),sha(out)) from e
        finally:
            if p.poll() is None:
                try:os.killpg(p.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                p.wait()
            sel.close();p.stdout.close();p.stderr.close()

def target_rows(expectations,stage):
    names=list(expectations['stages']) if stage=='all' else [stage];rows=[]
    for name in names:
        for index,e in enumerate(expectations['stages'][name]):
            require(TXID.fullmatch(e['txid']) is not None,'Expectation txid invalid');rows.append((e,dict(expectationStage=name,expectationIndex=index)))
    require(len(rows)<=166 and len({e['txid'] for e,_ in rows})==len(rows),'Expectation target coverage/duplicates');return rows

def failure(result,e,origin,phase,exc,parent=None):
    if isinstance(exc,RPCFailure):row=dict(kind='integrity-refused' if exc.row['category']=='response-decoding' else 'rpc-unavailable',**exc.row)
    else:row=dict(kind='integrity-refused',category='raw-chain-proof-or-arithmetic-invalid',errorClass=type(exc).__name__,reason=str(exc)[:256])
    row.update(txid=e['txid'] if e else None,phase=phase,**origin)
    if parent:row['parentTxid']=parent
    result['captureFailures'].append(row);return row

def collect_impl(expectations,stage):
    rpc=RPC();targets=target_rows(expectations,stage);result=dict(schema='audit30-item8-ledger-corpus-v2',atUtc=utc(),stage=stage,expectationsSha256=EXPECTATIONS_SHA,productionMutation=False,chainBefore=None,chainAfter=None,transactions={},parents={},blocks={},targetCapture=[],captureFailures=[],invalidRawCaptures={},rpcCalls=0,rpcBytes=0,qualifications=expectations['qualifications'])
    before_ok=False;global_stop=False
    try:
        before,_=rpc.call('getblockchaininfo');require(before['chain']=='main','Wrong chain');result['chainBefore']=dict(height=before['blocks'],hash=before['bestblockhash']);before_ok=True
    except (RPCFailure,ValueError,KeyError,TypeError,ArithmeticError,UnicodeError,struct.error) as ex:
        failure(result,None,{},'chain-before',ex);global_stop=True
    for e,origin in targets:
        state=dict(txid=e['txid'],kind=e['kind'],**origin,status='not-attempted',phase='raw');result['targetCapture'].append(state)
        if global_stop:continue
        verbose=None;response_sha=None
        try:
            verbose,response_sha=rpc.call('getrawtransaction',e['txid'],'true');tx=normalize_verbose(verbose);require(tx['txid']==e['txid'],'Requested/Core txid differs')
            tx['coreResponseSha256']=response_sha;result['transactions'][e['txid']]=tx
            require(tx['blockHash'] and tx['confirmationsAtCapture']>0,'Target unconfirmed/mempool');block=tx['blockHash'];state['phase']='canonical-header'
            if block not in result['blocks']:
                h,_=rpc.call('getblockheader',block,'true');raw,_=rpc.call('getblockheader',block,'false');canon,_=rpc.call('getblockhash',h['height']);require(canon==block==header_proof(raw) and h['confirmations']>0,'Target block not canonical');result['blocks'][block]=dict(height=h['height'],headerHex=raw,canonicalHashAtCapture=canon)
            state['phase']='merkle-inclusion';proof,proof_sha=rpc.call('gettxoutproof',json.dumps([tx['txid']],separators=(',',':')),block);verified,_=rpc.call('verifytxoutproof',proof);require(verified==[tx['txid']] and header_proof(proof[:160])==block,'Core inclusion proof readback differs');independent=merkle_inclusion(proof);require(independent['blockHash']==block and independent['matchedTxids']==[tx['txid']],'Independent Merkle inclusion differs')
            tx.update(coreInclusionProofHex=proof,coreInclusionProofResponseSha256=proof_sha,coreVerifiedIncludedTxids=verified);state['status']='canonical-captured';state['phase']='parents'
            for inp in tx['inputs']:
                require(inp['txid']!='0'*64,'Named corpus cannot be a coinbase')
                if inp['txid'] not in result['parents'] and inp['txid'] not in result['transactions']:
                    try:
                        pv,ph=rpc.call('getrawtransaction',inp['txid'],'true');pt=normalize_verbose(pv);require(pt['txid']==inp['txid'],'Requested parent/Core txid differs');pt['coreResponseSha256']=ph;result['parents'][inp['txid']]=pt
                    except (RPCFailure,ValueError,KeyError,TypeError,ArithmeticError,UnicodeError,struct.error) as ex:
                        failure(result,e,origin,'parent-raw',ex,inp['txid'])
                        if isinstance(ex,RPCFailure) and ex.resource:global_stop=True;break
            state['phase']='captured'
        except (RPCFailure,ValueError,KeyError,TypeError,ArithmeticError,UnicodeError,struct.error) as ex:
            row=failure(result,e,origin,state['phase'],ex);state['status']=row['kind'];state['failureIndex']=len(result['captureFailures'])-1
            if isinstance(ex,RPCFailure) and ex.resource:global_stop=True
            if state['phase']=='raw' and isinstance(verbose,dict):
                rawhex=verbose.get('hex')
                if isinstance(rawhex,str) and len(rawhex)<=2*MAX_RPC_BYTES:result['invalidRawCaptures'][e['txid']]=dict(rawHex=rawhex,coreResponseSha256=response_sha)
    # Recheck every captured historical block. Missing fence stays explicitly partial.
    for block,b in result['blocks'].items():
        try:
            after,_=rpc.call('getblockhash',b['height']);b['canonicalHashAfter']=after;require(after==block,'Historical block changed during census')
        except (RPCFailure,ValueError,KeyError,TypeError,ArithmeticError,UnicodeError,struct.error) as ex:failure(result,None,{},'canonical-after',ex);b['afterFencePassed']=False
    try:
        after,_=rpc.call('getblockchaininfo');require(after['chain']=='main','Final chain differs');result['chainAfter']=dict(height=after['blocks'],hash=after['bestblockhash'])
    except (RPCFailure,ValueError,KeyError,TypeError,ArithmeticError,UnicodeError,struct.error) as ex:failure(result,None,{},'chain-after',ex)
    result.update(atUtc=utc(),rpcCalls=rpc.calls,rpcBytes=rpc.bytes);result['oracle']=verify(result,expectations);result['status']=result['oracle']['status'];return result
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
    global _OPERATOR_INTERRUPTED
    _OPERATOR_INTERRUPTED=None
    def interrupted(signum,_frame):
        global _OPERATOR_INTERRUPTED
        _OPERATOR_INTERRUPTED=signum
    previous={s:signal.signal(s,interrupted) for s in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
    try:
        result=collect_impl(expectations,stage)
        if _OPERATOR_INTERRUPTED is not None and not any(f.get('category')=='operator-interrupted' for f in result['captureFailures']):
            failure(result,None,{},'operator-signal',RPCFailure('operator-interrupted','local-signal',(_OPERATOR_INTERRUPTED,)));result['oracle']=verify(result,expectations);result['status']=result['oracle']['status']
        return result
    finally:
        for s,handler in previous.items():signal.signal(s,handler)

def verify(corpus,expectations):
    require(corpus['schema']=='audit30-item8-ledger-corpus-v2' and corpus['expectationsSha256']==EXPECTATIONS_SHA,'Corpus scope/hash differs');targets=target_rows(expectations,corpus['stage']);wanted=[e['txid'] for e,_ in targets]
    states=corpus['targetCapture'];require(len(states)==len(wanted) and [r['txid'] for r in states]==wanted,'Complete ordered target coverage differs');require(set(corpus['transactions'])<=set(wanted),'Unknown captured target')
    alltx={**corpus['parents'],**corpus['transactions']};invalid={};findings=[];rows=[];bytx={}
    for txid,t in alltx.items():
        try:
            actual=parse_raw(t['rawHex']);require(actual['txid']==txid==t['txid'] and actual['inputs']==t['inputs'] and actual['outputs']==t['outputs'] and actual['rawBytesSha256']==t['rawBytesSha256'],'Captured raw identity/output drift')
        except (ValueError,KeyError,TypeError,ArithmeticError,UnicodeError,struct.error) as ex:invalid[txid]=dict(txid=txid,phase='offline-raw',reason=str(ex)[:256],errorClass=type(ex).__name__)
    def discrepancy(e,origin,field,expected,actual):
        if actual!=expected:findings.append(dict(txid=e['txid'],kind=e['kind'],field=field,expected=expected,actual=actual,source='Frozen expectations441b '+origin['expectationStage']+'['+str(origin['expectationIndex'])+'].'+field,**origin))
    for (e,origin),state in zip(targets,states):
        row=dict(txid=e['txid'],kind=e['kind'],**origin,status='unverified',canonicalVerified=False,parentValuesComplete=False)
        rows.append(row);bytx[e['txid']]=row
        if e['txid'] not in corpus['transactions']:row['status']=state['status'];continue
        t=corpus['transactions'][e['txid']]
        if e['txid'] not in invalid and (not corpus.get('chainBefore') or not corpus.get('chainAfter')):row['status']='chain-fence-incomplete';continue
        if e['txid'] not in invalid and (t.get('blockHash') not in corpus['blocks'] or 'canonicalHashAfter' not in corpus['blocks'].get(t.get('blockHash'),{}) or not all(k in t for k in ('coreInclusionProofHex','coreVerifiedIncludedTxids'))):row['status']='canonical-proof-or-fence-incomplete';continue
        try:
            require(e['txid'] not in invalid,'Invalid captured target raw');b=corpus['blocks'][t['blockHash']]
            require(corpus.get('chainBefore') and corpus.get('chainAfter'),'Required chain fences absent')
            require(t['confirmationsAtCapture']>0 and header_proof(b['headerHex'])==t['blockHash']==b['canonicalHashAtCapture']==b.get('canonicalHashAfter'),'Canonical block/header binding')
            inclusion=merkle_inclusion(t['coreInclusionProofHex']);require(t['coreVerifiedIncludedTxids']==[e['txid']] and inclusion['blockHash']==t['blockHash'] and inclusion['matchedTxids']==[e['txid']],'Independent Merkle/Core inclusion/readback binding')
            row.update(canonicalVerified=True,height=b['height'],blockHash=t['blockHash'],rawBytesSha256=t['rawBytesSha256'],inputCount=len(t['inputs']),outputProofs=sum(o['proofs'] for o in t['outputs']))
            if 'height' in e:discrepancy(e,origin,'height',e['height'],b['height'])
            if 'inputCount' in e:discrepancy(e,origin,'inputCount',e['inputCount'],len(t['inputs']))
            if 'components' in e:discrepancy(e,origin,'componentsSum',e['paidProofs'],sum(e['components']))
            if 'recipient' in e:
                paid=sum(o['proofs'] for o in t['outputs'] if o['scriptPubKey']==address_script(e['recipient']));row['paidToExpectedScriptProofs']=paid;discrepancy(e,origin,'paidProofs',e['paidProofs'],paid)
            if 'registryPaymentProofs' in e:
                paid=sum(o['proofs'] for o in t['outputs'] if o['scriptPubKey']==address_script(e.get('registryAddress',expectations['registryAddress'])));row['registryPaymentProofs']=paid;discrepancy(e,origin,'registryPaymentProofs',e['registryPaymentProofs'],paid)
            if 'memo' in e:discrepancy(e,origin,'memoPresent',True,any(e['memo'].encode() in op_return_payload(o['scriptPubKey']) for o in t['outputs']))
            seen=set();ins=[];missing=[]
            for i in t['inputs']:
                key=(i['txid'],i['vout']);require(key not in seen,'Duplicate input');seen.add(key)
                if i['txid'] not in alltx or i['txid'] in invalid:missing.append(i['txid']);continue
                outs=alltx[i['txid']]['outputs'];require(0<=i['vout']<len(outs),'Missing prevout');ins.append(outs[i['vout']])
            row['missingOrInvalidParentTxids']=sorted(set(missing));row['status']='canonical-verified-parent-incomplete' if missing else 'canonical-verified'
            if not missing:
                totalin=sum(x['proofs'] for x in ins);fee=totalin-row['outputProofs'];require(fee>=0,'Negative fee');row.update(parentValuesComplete=True,inputProofs=totalin,feeProofs=fee)
                for key,actual in [('inputProofs',totalin),('feeProofs',fee)]:
                    if key in e:discrepancy(e,origin,key,e[key],actual)
                if 'expectedInputValueCounts' in e:discrepancy(e,origin,'expectedInputValueCounts',e['expectedInputValueCounts'],dict(collections.Counter(str(i['proofs']) for i in ins)))
                if 'expectedInputAddress' in e:discrepancy(e,origin,'expectedInputAddressScriptsMatch',True,all(x['scriptPubKey']==address_script(e['expectedInputAddress']) for x in ins))
        except (ValueError,KeyError,TypeError,ArithmeticError,UnicodeError,struct.error) as ex:row.update(status='integrity-refused',canonicalVerified=False,integrityFailure=dict(errorClass=type(ex).__name__,reason=str(ex)[:256]))
    counts=dict(expectedTargets=len(wanted),targetCaptureRows=len(states),rawTargetCaptures=len(corpus['transactions']),canonicalVerified=sum(r['canonicalVerified'] for r in rows),completeParentValueRows=sum(r['parentValuesComplete'] for r in rows),missingTargetRows=sum(e['txid'] not in corpus['transactions'] for e,_ in targets),notAttemptedRows=sum(s['status']=='not-attempted' for s in states),rpcFailures=sum(r['kind']=='rpc-unavailable' for r in corpus['captureFailures']),integrityCaptureFailures=sum(r['kind']=='integrity-refused' for r in corpus['captureFailures']),offlineIntegrityRefusedRows=sum(r['status']=='integrity-refused' for r in rows),invalidRawObjects=len(invalid),documentationFindings=len(findings))
    hard=counts['integrityCaptureFailures']>0 or counts['offlineIntegrityRefusedRows']>0 or bool(invalid) or any(f.get('category') in ('overall-deadline','call-count','response-bound','cumulative-bound','operator-interrupted') for f in corpus['captureFailures'])
    complete=counts['canonicalVerified']==len(wanted) and counts['completeParentValueRows']==len(wanted) and not corpus['captureFailures'] and not hard
    status='complete-with-documentation-discrepancies' if complete and findings else 'complete' if complete else 'partial-integrity-refused' if hard else 'partial-rpc-or-parent-coverage'
    return dict(status=status,coverage=counts,rows=rows,documentationFindings=findings,offlineRawFailures=list(invalid.values()),namedTransactionRawAndCoreCanonicalChecksPass=counts['canonicalVerified']==len(wanted),independentRawTxidAndMerkleInclusionPass=counts['canonicalVerified']==len(wanted),allNamedFeeAndInputValuesVerified=counts['completeParentValueRows']==len(wanted),hardIntegrityRefusal=hard,snapshotArithmetic=snapshot_math(expectations),unresolvedPayoutAssociations=expectations['unresolvedPayoutAssociations'],financialReconciliationComplete=False,qualification='Exact canonical raw/Merkle checks and integer output/prevout fee evidence per covered target. Frozen documentary discrepancies are findings; missing RPC/parent/proof coverage is explicit. No historical records edited. Unknown payouts, full liabilities/address histories and complete balances remain separate.')

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
    require(len(lines)<=32*1024*1024,'Projection byte bound');objects=[json.loads(line) for line in lines.splitlines() if line.strip()];by={x['kind']:x for x in objects};require(len(objects)==3 and len(by)==3 and set(by)=={'fence','treasuryWorkProjection','namedTransactionProjection'},'Projection framing/set differs');require(by['fence']['readOnly']=='on','Projection transaction not read-only')
    rows=by['namedTransactionProjection']['rows'];mapping={r['txid']:r for r in rows};require(len(mapping)==len(rows)==by['namedTransactionProjection']['targetCount'],'Projection duplicate/count differs');checks=[];findings=[];parents={**corpus['parents'],**corpus['transactions']};oracle=corpus['oracle'];unknown=set(mapping)-{r['txid'] for r in oracle['rows']}
    # A stage corpus may use the full166 projection; nonstage names are outside this comparison.
    for row in oracle['rows']:
        txid=row['txid'];t=corpus['transactions'].get(txid);p=mapping.get(txid);issues=[]
        if p is None:issues.append(dict(field='transactionPresent',expected=True,actual=False))
        if not row['canonicalVerified']:checks.append(dict(txid=txid,status='unverified-canonical-corpus',projectionPresent=p is not None));continue
        b=corpus['blocks'][t['blockHash']]
        def compare(field,expected,actual):
            if expected!=actual:issues.append(dict(field=field,expected=expected,actual=actual))
        if p is not None:
            compare('status','confirmed',p.get('status'));compare('blockHeight',b['height'],p.get('blockHeight'));compare('blockHash',t['blockHash'],p.get('blockHash'));ins=p.get('inputs');outs=p.get('outputs');compare('inputCount',len(t['inputs']),len(ins) if isinstance(ins,list) else None);compare('outputCount',len(t['outputs']),len(outs) if isinstance(outs,list) else None)
            if isinstance(ins,list) and len(ins)==len(t['inputs']):
                for n,(a,i) in enumerate(zip(ins,t['inputs'])):
                    compare('input'+str(n)+'.identity',[n,i['txid'],i['vout']],[a.get('vin'),a.get('prevTxid'),a.get('prevVout')])
                    if i['txid'] in parents and 0<=i['vout']<len(parents[i['txid']]['outputs']):compare('input'+str(n)+'.valueProofs',str(parents[i['txid']]['outputs'][i['vout']]['proofs']),a.get('valueProofs'))
            if isinstance(outs,list) and len(outs)==len(t['outputs']):
                for n,(a,o) in enumerate(zip(outs,t['outputs'])):compare('output'+str(n),[o['vout'],str(o['proofs']),o['scriptPubKey']],[a.get('vout'),a.get('valueProofs'),a.get('scriptPubKey')])
            if row['parentValuesComplete']:compare('feeProofs',str(row['feeProofs']),p.get('feeProofs'))
        findings.extend(dict(txid=txid,source='Current read-only indexed transaction projection',**issue) for issue in issues);checks.append(dict(txid=txid,status='discrepancy' if issues else 'compared',issues=len(issues),parentValuesComplete=row['parentValuesComplete']))
    balance=by['treasuryWorkProjection'];require(balance['confirmedUnit']=='WORK subatoms (10^16 per WORK)','Treasury unit label differs');require(len(balance['rows'])==3 and {r['address'] for r in balance['rows']}==set(TREASURY_ADDRESSES),'Treasury exact address projection set differs')
    for r in balance['rows']:require(re.fullmatch(r'0|[1-9][0-9]*',r['confirmedBalanceSubatoms']) is not None and re.fullmatch(r'-?(0|[1-9][0-9]*)',r['pendingDeltaSubatoms']) is not None,'Noncanonical treasury integer')
    return dict(namedRawProjectionChecksPass=not findings and all(r['status']=='compared' and r.get('parentValuesComplete') for r in checks),comparisonRows=checks,findings=findings,projectionTargetCount=len(mapping),outsideStageProjectionCount=len(unknown),projectionFence=by['fence'],treasuryWorkProjection=balance,financialReconciliationComplete=False,qualification='Per-target indexed projection compared against covered canonical corpus; disagreements remain findings. Missing canonical/parent coverage stays unverified. Treasury WORK integers observed, not independently replayed balances.')

def main():
    p=argparse.ArgumentParser();p.add_argument('--stage',choices=('legacy','work-v1','work-v2-review','all'));p.add_argument('--expectations',required=True);p.add_argument('--expectations-sha256',required=True);p.add_argument('--verify-corpus');p.add_argument('--verify-projection');a=p.parse_args();require(sys.flags.isolated,'Isolated Python required')
    raw=sys.stdin.buffer.read(1024*1024+1) if a.expectations=='-' else pathlib.Path(a.expectations).read_bytes();require(len(raw)<=1024*1024 and a.expectations_sha256==sha(raw)==EXPECTATIONS_SHA,'Frozen expectations hash differs');expectations=json.loads(raw);snapshot_math(expectations)
    if a.verify_corpus:
        raw=pathlib.Path(a.verify_corpus).read_bytes();require(len(raw)<=MAX_TOTAL_BYTES,'Corpus bound');corpus=json.loads(raw);out=verify(corpus,expectations);corpus['oracle']=out
        if a.verify_projection:out['projectionComparison']=verify_projection(corpus,pathlib.Path(a.verify_projection).read_bytes())
    else:
        require(a.stage and os.geteuid() in (0,pwd.getpwnam('bitcoin').pw_uid),'Native bitcoin or root read-only collection role required');out=collect(expectations,a.stage)
    print(json.dumps(out,sort_keys=True));return 2 if (out.get('oracle',out)).get('hardIntegrityRefusal') else 0
if __name__=='__main__':
    try:code=main()
    except BaseException as exc:
        print(json.dumps(dict(schema='audit30-item8-ledger-refusal-v2',productionMutation=False,errorClass=type(exc).__name__,reason='Read-only collector admission failed before a bounded corpus; no private RPC stderr emitted'),sort_keys=True),file=sys.stderr);code=1
    raise SystemExit(code)
