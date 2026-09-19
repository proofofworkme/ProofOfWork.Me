#!/usr/bin/python3 -I
"""Compare every served release file across all public UI hosts, bounded to four reads."""
import concurrent.futures,hashlib,json,pathlib,tarfile,time,urllib.parse,urllib.request
RELEASE='6eb4a1e07131-20260919T161919Z'
ARCHIVE=pathlib.Path('/var/backups/proofofwork-ui/releases/proofofwork-ui-release-'+RELEASE+'.tgz')
HOSTS={'activity':'log','boost':'boost','browser':'browser','computer':'computer','desktop':'desktop','growth':'growth','id':'id','inception':'inception','infinity':'infinity','landing':'www','marketplace':'amo','token':'credit','wallet':'wallet','work':'work'}
started=time.monotonic(); jobs=[];indices={}
with tarfile.open(ARCHIVE,'r:gz') as tar:
    for entry in tar.getmembers():
        if entry.isdir():continue
        parts=entry.name.split('/')
        assert entry.isfile() and len(parts)>=3 and parts[0]=='surfaces'
        surface=parts[1]
        if surface=='nft':continue
        assert surface in HOSTS
        relative='/'.join(parts[2:]);assert '..' not in parts and entry.size<=64*1024**2
        body=tar.extractfile(entry).read()
        if relative=='index.html':indices[surface]=hashlib.sha256(body).hexdigest()
        jobs.append(('https://'+HOSTS[surface]+'.proofofwork.me/'+urllib.parse.quote(relative,safe='/'),len(body),hashlib.sha256(body).hexdigest()))
assert set(indices)==set(HOSTS)
for surface,host in HOSTS.items():jobs.append(('https://'+host+'.proofofwork.me/',None,indices[surface]))
jobs.append(('https://proofofwork.me/',None,indices['landing']))
def check(job):
    url,size,digest=job
    assert time.monotonic()-started<900
    with urllib.request.urlopen(url,timeout=30) as response:
        assert response.status==200
        if url=='https://proofofwork.me/':assert response.url=='https://www.proofofwork.me/'
        data=response.read(64*1024**2+1)
        assert len(data)<=64*1024**2 and (size is None or len(data)==size)
        assert hashlib.sha256(data).hexdigest()==digest, url
    return {'url':url,'bytes':len(data),'sha256':digest}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: results=list(pool.map(check,jobs))
print(json.dumps({'ok':True,'release':RELEASE,'surfaces':len(HOSTS),'requests':len(results),'bytes':sum(x['bytes'] for x in results),'elapsedSeconds':round(time.monotonic()-started,3),'results':results},indent=2))
