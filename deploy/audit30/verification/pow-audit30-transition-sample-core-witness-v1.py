#!/usr/bin/python3 -I
import datetime,hashlib,json,os,pathlib,re,selectors,signal,subprocess,time
ROWS=[{'height':960600,'hash':'00000000000000000001ec938998cde4fd86ee6e3c672a6d3d95200cd8a984ac'},{'height':960601,'hash':'000000000000000000020205d5b0aa2d74e2eb5ec6d14dd3abf91132cffde4a2'},{'height':969526,'hash':'00000000000000000001c495201991943ae88860aeaca7db34c37e210e765ee0'}]
SERVICES=['bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service']
RUN='20261003T023000Z'
JOB=pathlib.Path('/data/proofofwork-release-backups/audit30-transition-core-witness-'+RUN)
SOURCE_INVENTORY='f30301ca4f4769cfbbd995dc7627580be543e6cddfc1f5b3ff4aba033a48f572'
SOURCE_FENCE='d9c08752be9e8e7c8d9ce4409b20496783901f116becbb26e205904dc676564b'
def need(ok):
 if not ok:raise ValueError('Witness refused')
def digest(b):return hashlib.sha256(b).hexdigest()
def timeout(*_):raise TimeoutError('Witness deadline')
def bounded(argv,seconds=8):
 p=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True);sel=selectors.DefaultSelector();sel.register(p.stdout,selectors.EVENT_READ);out=bytearray();started=time.monotonic()
 try:
  while sel.get_map():
   need(time.monotonic()-started<=seconds)
   for key,_ in sel.select(.1):
    b=os.read(key.fileobj.fileno(),4096)
    if not b:sel.unregister(key.fileobj);continue
    out.extend(b);need(len(out)<=65536)
  need(p.wait(timeout=1)==0);return bytes(out)
 finally:
  if p.poll()is None:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=2)
  sel.close();p.stdout.close()
def rpc(method,*args):
 need(method in ('getblockchaininfo','getblockhash','getblockheader'))
 b=bounded(['/usr/bin/sudo','-n','-u','bitcoin','/usr/local/bin/bitcoin-cli','-conf=/etc/bitcoin/bitcoin.conf',method,*map(str,args)])
 if method=='getblockchaininfo':return json.loads(b)
 text=b.decode('ascii').strip();need(re.fullmatch('[0-9a-f]+',text)is not None);need(len(text)==(64 if method=='getblockhash' else 160));return text
def live():
 b=bounded(['/usr/bin/systemctl','show',*SERVICES,'-p','Id','-p','ActiveState','-p','MainPID','-p','InvocationID'],4)
 rows={}
 for block in b.decode().strip().split('\n\n'):
  d=dict(line.split('=',1)for line in block.splitlines());name=d.pop('Id');need(name in SERVICES and name not in rows and d.get('ActiveState')=='active'and int(d.get('MainPID','0'))>0 and re.fullmatch('[0-9a-f]{32}',d.get('InvocationID',''))is not None);rows[name]=d
 need(set(rows)==set(SERVICES));return rows

def header_check(raw,height,h):
 need(re.fullmatch('[0-9a-f]{160}',raw)is not None);b=bytes.fromhex(raw);need(hashlib.sha256(hashlib.sha256(b).digest()).digest()[::-1].hex()==h);return {'height':height,'hash':h,'headerHex':raw,'headerSha256':digest(b),'previousBlockHash':b[4:36][::-1].hex()}
def chain_shape(v):
 need(v.get('chain')=='main'and v.get('initialblockdownload')is False and v.get('pruned')is False and type(v.get('blocks'))is int and v['blocks']==v.get('headers')and re.fullmatch('[0-9a-f]{64}',v.get('bestblockhash',''))is not None);return {'height':v['blocks'],'hash':v['bestblockhash']}
def durable(name,value):
 raw=(json.dumps(value,sort_keys=True,indent=2)+'\n').encode();fd=os.open(JOB/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 fd=os.open(JOB,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd);return raw

def main():
 need(os.geteuid()==0 and __import__('sys').flags.isolated);os.umask(0o077);signal.signal(signal.SIGALRM,timeout);signal.setitimer(signal.ITIMER_REAL,60);JOB.mkdir(mode=0o700);fd=os.open(JOB.parent,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
 try:
  before_live=live();before=chain_shape(rpc('getblockchaininfo'));need(before['height']>=ROWS[-1]['height']);rows=[]
  for r in ROWS:
   need(rpc('getblockhash',r['height'])==r['hash']);rows.append(header_check(rpc('getblockheader',r['hash'],'false'),r['height'],r['hash']))
  need(rows[1]['previousBlockHash']==rows[0]['hash'])
  for r in ROWS:need(rpc('getblockhash',r['height'])==r['hash'])
  after=chain_shape(rpc('getblockchaininfo'));need(after==before and live()==before_live)
  v={'schema':'pow-audit30-transition-sample-core-witness-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sampleRows':rows,'checkpoint':ROWS[-1],'sourceInventorySha256':SOURCE_INVENTORY,'sourceFenceSha256':SOURCE_FENCE,'chainBefore':before,'chainAfter':after,'liveFive':before_live,'liveFiveUnchanged':True,'canonicalConfirmed':True,'productionMutation':False,'rpcCalls':11,'qualification':'Three named canonical header/height witnesses only; native copy/parser/arithmetic and skipped historical intervals remain separate acceptance gates.'};raw=durable('receipt.json',v);print(raw.decode(),end='')
 except BaseException as e:
  durable('failed.json',{'schema':'pow-audit30-transition-sample-core-witness-failed-v1','status':'failed','errorClass':type(e).__name__,'productionMutation':False,'automaticRetry':False});raise
if __name__=='__main__':main()
