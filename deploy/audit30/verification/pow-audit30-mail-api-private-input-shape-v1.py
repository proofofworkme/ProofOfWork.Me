import hashlib, json, os, pathlib, shlex, subprocess

SOURCE = r'''
import base64, collections, hashlib, json, os, pathlib, signal, stat, sys
signal.alarm(15)
def need(v):
    if not v: raise ValueError('fixed private capture refused')
def pairs(rows):
    out={}
    for k,v in rows: need(k not in out);out[k]=v
    return out
def parse(b):return json.loads(b,object_pairs_hook=pairs)
def sha(b):return hashlib.sha256(b).hexdigest()
def stamp(s):return(s.st_dev,s.st_ino,s.st_uid,s.st_gid,s.st_mode,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
try:
    need(os.geteuid()==os.getegid()==0 and sys.flags.isolated and os.uname().nodename=='pow-bitcoin-01')
    p=pathlib.Path('/data/proofofwork-release-backups/audit30-mail-body-census-20261003T011506Z/preimages.jsonl')
    s=p.lstat();need(p.resolve()==p and stat.S_ISREG(s.st_mode) and (s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink)==(0,0,0o600,1) and s.st_size==8321455)
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
    with os.fdopen(fd,'rb') as f:
        need(stamp(os.fstat(f.fileno()))==stamp(s));raw=f.read(16*1024**2+1);need(stamp(os.fstat(f.fileno()))==stamp(s)==stamp(p.lstat()))
    need(len(raw)==8321455 and sha(raw)=='d71dc1d0cc7a490442092471a30ca388392c9e0ce6a8c33b6c1be22ebedabbe7')
    records=[parse(line)for line in raw.splitlines()];need(len(records)<=1000)
    phases=collections.Counter();rows=[];footer=None;actors=set();direct_fields=collections.Counter();kinds=collections.Counter();statuses=collections.Counter();keys=set()
    for r in records:
        phases[r['phase']]+=1
        if r['phase']=='private-capture-footer':footer=r
        if r['phase']=='private-sql-line':
            line=base64.b64decode(r['recordBase64'],validate=True);need(sha(line)==r['recordSHA256']);v=parse(line)
            if v['phase']=='row':
                need(len(v['events'])==1 and v['mail'] is not None);rows.append(v);e=v['events'][0];payload=e['payload'];kinds[e['kind']]+=1;statuses[e['status']]+=1;keys.update(payload)
                for field in ('body','message','memo'):
                    if payload.get(field) is not None:direct_fields[field+':'+type(payload[field]).__name__]+=1;break
                actor=''
                for candidate in (payload.get('actor'),payload.get('senderAddress'),v['mail'].get('sender_address')):
                    need(candidate is None or isinstance(candidate,str))
                    text=(candidate or '').strip()
                    if text and text.lower()!='unknown':actor=text;break
                need(actor and len(actor)<=100);actors.add(actor)
    need(footer is not None and footer['status']=='complete' and footer['records']==620 and len(rows)==619)
    census=base64.b64decode(footer['publicCensusBase64'],validate=True);need(sha(census)==footer['publicCensusSHA256']);value=parse(census);need(value['ok'] is True and value['coreVerified'] is True and len(value['rows'])==619)
    print(json.dumps({'schema':'pow-audit30-mail-api-private-input-shape-v1','privateCaptureSHA256':sha(raw),'privateCaptureBytes':len(raw),'privateCaptureUnchanged':True,'phases':dict(phases),'rowCount':len(rows),'uniqueActorCount':len(actors),'directFieldTypes':dict(direct_fields),'kinds':dict(kinds),'statuses':dict(statuses),'payloadFieldNames':sorted(keys),'publicFooterCensusSHA256':sha(census),'publicFooterCounts':value['counts'],'publicFooterCoreVerified':True,'coreSqlApiCalls':0,'privateContentExported':False,'productionMutation':False},sort_keys=True))
except BaseException as ex:
    print(json.dumps({'schema':'pow-audit30-mail-api-private-input-shape-refusal-v1','errorClass':type(ex).__name__,'privateContentExported':False,'productionMutation':False}));sys.exit(1)
'''

if __name__ == '__main__':
    ssh=['ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15','powadmin@65.108.122.87']
    result=subprocess.run(ssh+[shlex.join(['sudo','-n','/usr/bin/python3','-I','-B','-'])],input=SOURCE.encode(),capture_output=True,timeout=40)
    need=lambda condition:None if condition else (_ for _ in ()).throw(ValueError('bounded metadata transport refused'))
    need(len(result.stdout)<=65536 and len(result.stderr)<=65536)
    for suffix,data in [('stdout',result.stdout),('stderr',result.stderr)]:
        p=pathlib.Path('/tmp/pow-audit30-mail-api-private-input-shape-native-v1.'+suffix)
        fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
    print(json.dumps({'returncode':result.returncode,'sourceSHA256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'result':json.loads(result.stdout),'stderrBytes':len(result.stderr)}))
    raise SystemExit(result.returncode)
