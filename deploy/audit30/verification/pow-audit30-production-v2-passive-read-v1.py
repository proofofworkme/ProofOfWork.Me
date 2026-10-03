#!/usr/bin/python3 -I -B
"""Fixed passive production-strict-v2 reconciliation; no raw output or environment export."""
import datetime,hashlib,json,os,pathlib,pwd,re,stat,subprocess,time

RELEASE='38ac6e2bff2a-20261003T042000Z'
TOKEN=RELEASE+'-production-production-strict-v2'
ROOT=pathlib.Path('/data/proofofwork-release-backups/audit30-node-release-'+RELEASE)
LAUNCH=pathlib.Path('/data/proofofwork-audit29-verify-launch-'+TOKEN)
OUTPUT=pathlib.Path('/data/proofofwork-audit29-verify-output-'+TOKEN+'/attempt/receipt.json')
UNIT='proofofwork-audit29-verify-'+TOKEN+'.service'
POSITIVE=pathlib.Path('/data/proofofwork-audit30-positive-scoped-'+RELEASE+'-production-v2')
POSITIVE_OUTPUT=pathlib.Path('/data/proofofwork-audit30-positive-scoped-output-'+RELEASE+'-production-v2/receipt.json')
POSITIVE_UNIT='proofofwork-audit30-positive-scoped-'+RELEASE+'-production-v2.service'
LIVE={'bitcoind.service':('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),
 'electrs.service':('1324320','72418b1c7ab245e4a37685ed868a1084'),
 'postgresql@16-main.service':('1537429','e0bf545f0ad944e89fe1005577e61b9c'),
 'proofofwork-api.service':('3372731','546739c810df48d4956961b0931b6fc5'),
 'proofofwork-indexer-worker.service':('3372743','b2dc36ef816c4311b4c9aa0740d781a9')}
ENV={'PATH':'/usr/bin:/bin','LC_ALL':'C'}
HEX=re.compile('[0-9a-f]{64}\\Z')
GATES=('ids','events','parity')
CANDIDATE={'commit':'38ac6e2bff2ac16890724e5213346ef8a3ebd186','tree':'8b9b5e3cd47aa8e4204da717350a629176e30da6','runtimeSha256':'13035b6d1fbca1be9c03b1833f3abe578d4ae28331a341b3dea4301cc72b535c'}

def need(value,code):
 if not value:raise ValueError(code)
def stamp(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def read(path):
 p=pathlib.Path(path);s=p.lstat();a=pwd.getpwnam('powadmin');owner=(a.pw_uid,a.pw_gid)if p in(OUTPUT,POSITIVE_OUTPUT)else(0,0)
 need(p.resolve()==p and stat.S_ISREG(s.st_mode)and(s.st_uid,s.st_gid)==owner and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and 0<s.st_size<=4*1024**2,'FILE_SHAPE')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  chunks=[];total=0
  while True:
   block=os.read(fd,65536)
   if not block:break
   chunks.append(block);total+=len(block);need(total<=4*1024**2,'FILE_CAP')
  raw=b''.join(chunks);need(len(raw)==s.st_size and stamp(os.fstat(fd))==stamp(s)==stamp(p.lstat()),'FILE_DRIFT')
 finally:os.close(fd)
 return json.loads(raw),{'path':str(p),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
def code(value,kind='failure'):
 if value is None:return None
 pattern='[A-Z0-9_]{1,120}'if kind=='failure'else'[A-Za-z][A-Za-z0-9_]{0,80}'
 need(type(value)is str and re.fullmatch(pattern,value),'PUBLIC_CODE_SHAPE');return value
def integer(value):
 need(type(value)is int and -2147483648<=value<=9007199254740991,'INTEGER_SHAPE');return value
def optional_flag(value):
 need(value is None or type(value)is bool,'OPTIONAL_FLAG_SHAPE');return value
def tip(value):
 if value is None:return None
 need(type(value)is dict and type(value.get('height'))is int and 0<=value['height']<=9007199254740991 and HEX.fullmatch(str(value.get('hash',''))),'CHECKPOINT_SHAPE')
 return {'height':value['height'],'hash':value['hash']}
def child(value):
 if value is None:return None
 need(type(value)is dict,'CHILD_SHAPE');row={'exitCode':integer(value['exitCode']),'errorClass':code(value.get('errorClass'),'class')}
 for stream in ('stdout','stderr'):
  data=value[stream];need(type(data)is dict and HEX.fullmatch(str(data.get('sha256',''))),'CHILD_DIGEST')
  row[stream]={'bytes':integer(data['bytes']),'sha256':data['sha256']};need(row[stream]['bytes']>=0,'CHILD_BYTES')
 return row
def gate(value):
 need(type(value)is dict,'GATE_SHAPE');row={}
 for key in ('exitCode','stdoutBytes','stderrBytes','checkCount'):
  if key in value:row[key]=integer(value[key])
 for key in ('stdoutSha256','scriptSha256'):
  if key in value:need(HEX.fullmatch(str(value[key])),'GATE_DIGEST');row[key]=value[key]
 for key in ('before','after'):
  if key in value:row[key]=tip(value[key])
 for key in ('checkpointStable','outputNotJson'):
  if key in value:need(type(value[key])is bool,'GATE_FLAG');row[key]=value[key]
 if 'counts'in value:
  labels=('Fetched transactions','Confirmed winners','Pending candidates','Covered confirmed registry transactions','Covered pending registry transactions')
  need(type(value['counts'])is dict and set(value['counts'])==set(labels),'ID_COUNT_LABELS')
  row['counts']={key:integer(value['counts'][key])for key in labels}
 if 'checks'in value:
  checks=value['checks'];need(type(checks)is list and len(checks)<=256,'CHECK_COUNT');failed=[]
  for check in checks:
   need(type(check)is dict and type(check.get('ok'))is bool and check.get('severity')in ('error','warning'),'CHECK_SHAPE')
   if check['ok']is False:
    name=check.get('name');need(type(name)is str and 0<len(name)<=1024,'CHECK_NAME')
    public={'ok':False,'severity':check['severity']}
    if re.fullmatch('[A-Za-z0-9 -]{1,180}',name):public['name']=name
    else:public['nameSha256']=hashlib.sha256(name.encode()).hexdigest();public['nameExported']=False
    failed.append(public)
  row['observedCheckCount']=len(checks);row['failedChecks']=failed
 return row
def driver(value):
 need(value.get('format')=='audit29-candidate-readonly-v1'and value.get('candidate')==CANDIDATE and value.get('mode')=='production'and value.get('network')=='livenet'and value.get('base')=='https://computer.proofofwork.me'and value.get('authority')=='http://127.0.0.1:8081','DRIVER_BINDING')
 need(type(value.get('ok'))is bool and type(value.get('gates'))is dict and set(value['gates'])==set(GATES)and all(type(x)is bool for x in value['gates'].values()),'DRIVER_GATES')
 row={'format':value['format'],'ok':value['ok'],'mode':'production','gates':value['gates'],'failure':code(value.get('failure')),'originalFailure':code(value.get('originalFailure')),'checkpointBefore':tip(value.get('checkpointBefore')),'checkpointAfter':tip(value.get('checkpointAfter')),'stableCheckpoint':tip(value.get('stableCheckpoint')),'gateReceipts':{}}
 for key,receipt in value.get('gateReceipts',{}).items():need(key in GATES,'GATE_NAME');row['gateReceipts'][key]=gate(receipt)
 attention=value.get('needsAttention');need(attention in(None,'moving-checkpoint-preserve-attempt-before-bounded-retry','review-preserved-receipt'),'ATTENTION_SHAPE');row['needsAttention']=attention
 row['reads']=reads(value.get('reads',[]));return row
def reads(value):
 need(type(value)is list and len(value)<=96,'READ_METADATA_COUNT');rows=[]
 for item in value:
  need(type(item)is dict and type(item.get('route'))is str and re.fullmatch('/api/v1/[A-Za-z0-9/_-]{1,100}',item['route'])and HEX.fullmatch(str(item.get('sha256',''))),'READ_METADATA_SHAPE')
  status=integer(item['status']);size=integer(item['bytes']);need(100<=status<=599 and size>=0,'READ_METADATA_BOUNDS')
  rows.append({'route':item['route'],'status':status,'bytes':size,'sha256':item['sha256']})
 return rows
def positive(value):
 need(value.get('schema')=='pow-audit30-positive-work-complete-scoped-listings-v1'and value.get('candidate')==CANDIDATE and value.get('mode')=='production'and value.get('network')=='livenet'and value.get('base')=='https://computer.proofofwork.me'and value.get('authority')=='http://127.0.0.1:8081'and value.get('privateContentsExported')is False,'POSITIVE_LEAF_BINDING')
 need(type(value.get('ok'))is bool,'POSITIVE_LEAF_FLAG')
 row={'ok':value['ok'],'failure':code(value.get('failure')),'errorClass':code(value.get('errorClass'),'class'),'reads':reads(value.get('reads',[])),'completedWalletReadCount':len(value.get('positiveWork',[])),'completedScopedListingCount':len(value.get('scopedListings',[]))}
 return row
PREDICATES=('http-200-required','livenet-scope','authoritative-wallet','complete-checkpoint','stable-core-fence','exact-current-checkpoint','snapshot-present','envelope-q16-model','one-canonical-q16-token','one-exact-holder','one-exact-capacity','capacity-scope-model-checkpoint','positive-confirmed-exact-holder','exact-q16-conservation','holder-decimals-match-subatoms','exact-unique-reservation-conservation')
ASSETS={'POWB':'a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562','INCB':'3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d'}
def digest(value):
 need(type(value)is str and HEX.fullmatch(value),'PUBLIC_DIGEST');return value
def text_decimal(value,signed=False):
 need(type(value)is str and re.fullmatch(('-?'if signed else'')+'(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,16})?',value)and len(value)<=128,'PUBLIC_DECIMAL');return value
def checkpoint(value):
 need(type(value)is dict and type(value.get('stable'))is bool,'FENCE_SHAPE');return {'before':tip(value.get('before')),'after':tip(value.get('after')),'stable':value['stable']}
def wallet(value,positive=False):
 need(type(value)is dict,'WALLET_SHAPE');row={key:optional_flag(value.get(key))for key in ('ready','balanceVerified','capacityVerified')};row['status']=integer(value['status']);need(100<=row['status']<=599,'WALLET_STATUS');row['checkpoint']=checkpoint(value['checkpoint']);row['payloadSha256']=digest(value['payloadSha256'])
 for key in ('confirmedBalanceSubatoms','spendableBalanceSubatoms','reservedBalanceSubatoms','pendingDeltaSubatoms'):
  if key in value:row[key]=text_decimal(value[key],key=='pendingDeltaSubatoms');need('.'not in row[key],'SUBATOM_INTEGER')
 if 'code'in value:row['code']=code(value['code'])
 if positive:
  need(value.get('label')in('first-request','second-request'),'WALLET_LABEL');row['label']=value['label'];row['positiveConfirmed']=optional_flag(value.get('positiveConfirmed'));row['predicateCount']=integer(value['predicateCount']);pred=value.get('predicates');need(type(pred)is dict and set(pred)==set(PREDICATES)and all(type(v)is bool for v in pred.values()),'PREDICATE_SET');row['predicates']=pred
  for key in ('holderBalanceDecimal','holderPendingDeltaDecimal'):row[key]=text_decimal(value[key],key=='holderPendingDeltaDecimal')
  row['reservationCount']=integer(value['reservationCount']);row['reservationMembershipSha256']=digest(value['reservationMembershipSha256']);need(type(value['snapshotId'])is str and re.fullmatch('[0-9a-f]{24,64}',value['snapshotId']),'WALLET_SNAPSHOT');row['snapshotId']=value['snapshotId']
 return row
def counters(value):
 need(type(value)is dict,'COUNTERS_SHAPE');return {key:integer(value[key])for key in ('httpCalls','coreCalls','bytes')}
def strict_detail(value):
 row=driver(value)
 if 'wallet'in value:row['wallet']=wallet(value['wallet'])
 if 'book'in value:
  b=value['book'];need(type(b)is dict,'BOOK_SHAPE');row['book']={key:integer(b[key])for key in ('listings','savedRowBytes','fullPages','displayPages','historicalAuditBaseline','deltaFromAuditBaseline','independentCoreAnchors')};row['book'].update({key:digest(b[key])for key in ('fullRowsSha256','independentCoreSha256')});row['book']['membershipRecheckedAfterCore']=optional_flag(b.get('membershipRecheckedAfterCore'))
 if 'pendingDates'in value:
  b=value['pendingDates'];row['pendingDates']={key:integer(b[key])for key in ('pendingRecords','confirmedRecords','historicalAuditBaseline','deltaFromAuditBaseline')};row['pendingDates']['recordsSha256']=digest(b['recordsSha256'])
 if 'counters'in value:row['counters']=counters(value['counters'])
 if 'privateLauncher'in value:
  b=value['privateLauncher'];need(type(b)is dict and b.get('unit')==UNIT and b.get('scriptSha256')=='bbded71fa88cfc108c611b3beddd3a6c693b38477c356b682caed8985976abda','ACCEPTED_DRIVER_BINDING');i=b.get('sourceIdentity');need(type(i)is dict and i.get('unit')=='proofofwork-api.service'and i.get('pid')==3372731 and i.get('uid')==i.get('gid')==1000 and i.get('exe')=='/opt/node-v24.18.0-linux-x64/bin/node'and i.get('cwd')=='/opt/proofofwork-api','ACCEPTED_SOURCE_BINDING');row['privateLauncher']={'unit':UNIT,'scriptSha256':b['scriptSha256'],'driverReceiptSha256':digest(b['driverReceiptSha256']),'captureApiSha256':digest(b['captureApiSha256']),'sourcePID':3372731,'sourceUID':1000,'sourceGID':1000,'sourceExe':i['exe'],'sourceCwd':i['cwd']}
 return row
def positive_detail(value):
 row=positive(value);wallets=value.get('positiveWork',[]);scopes=value.get('scopedListings',[]);need(type(wallets)is list and len(wallets)<=2 and type(scopes)is list and len(scopes)<=2,'POSITIVE_COUNTS');row['positiveWork']=[wallet(w,True)for w in wallets];row['scopedListings']=[]
 for b in scopes:
  need(type(b)is dict and b.get('symbol')in ASSETS and b.get('asset')==ASSETS[b['symbol']],'SCOPE_BINDING');s={'symbol':b['symbol'],'asset':b['asset'],'complete':optional_flag(b.get('complete')),'ready':optional_flag(b.get('ready')),'totalCount':integer(b['totalCount']),'checkpoint':tip(b['checkpoint']),'coreBefore':tip(b['coreBefore']),'coreAfter':tip(b['coreAfter']),'snapshotId':digest(b['snapshotId']),'listingIdsSha256':digest(b['listingIdsSha256'])};pages=b['pages'];need(type(pages)is list and 0<len(pages)<=100,'SCOPE_PAGE_CAP');s['pages']=[{'complete':optional_flag(p.get('complete')),'verifiedThrough':integer(p['verifiedThrough']),'totalCount':integer(p['totalCount']),'checkpoint':tip(p['checkpoint'])}for p in pages];s['pageCount']=len(pages);row['scopedListings'].append(s)
 if 'counters'in value:row['counters']=counters(value['counters'])
 if 'elapsedMilliseconds'in value:row['elapsedMilliseconds']=integer(value['elapsedMilliseconds'])
 return row

STATE_DEADLINE=None
def state(unit):
 p=subprocess.run(['/usr/bin/systemctl','show',unit,'--property=LoadState,ActiveState,SubState,MainPID,InvocationID,Result,UnitFileState'],env=ENV,capture_output=True,timeout=min(8,max(.001,STATE_DEADLINE-time.monotonic()))if STATE_DEADLINE is not None else 8)
 need(p.returncode==0 and not p.stderr and len(p.stdout)<=8192,'STATE_READ');return dict(line.split('=',1)for line in p.stdout.decode().splitlines()if '='in line)
def main():
 global STATE_DEADLINE
 need(os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0,'ROOT_READONLY');started=time.monotonic();STATE_DEADLINE=started+90;files={}
 fixed=[ROOT/'production-strict-v2-intent.json',ROOT/'production-strict-v2-failed.json',ROOT/'production-strict-v2-completed.json',LAUNCH/'intent.json',LAUNCH/'child-result.json',LAUNCH/'launcher-final.json',LAUNCH/'accepted-receipt.json',OUTPUT,POSITIVE/'intent.json',POSITIVE/'failed.json',POSITIVE/'completed.json',POSITIVE/'child-result.json',POSITIVE_OUTPUT]
 for path in fixed:
  key='driver-receipt.json'if path==OUTPUT else('positive-leaf-receipt.json'if path==POSITIVE_OUTPUT else('launcher-'+path.name if path.parent==LAUNCH else('positive-'+path.name if path.parent==POSITIVE else path.name)))
  if not os.path.lexists(path):files[key]={'path':str(path),'absent':True};continue
  value,meta=read(path);projection={}
  if path==OUTPUT or path==LAUNCH/'accepted-receipt.json':projection=strict_detail(value)
  elif path==POSITIVE_OUTPUT:projection=positive_detail(value)
  elif path.name=='child-result.json':projection=child(value)
  elif path.name=='launcher-final.json':
   need(type(value.get('ok'))is bool and value.get('rawEnvironmentOrErrorsExported')is False and value.get('outputRoot')==str(OUTPUT.parent.parent),'LAUNCHER_FINAL_BINDING')
   projection={'ok':value['ok'],'errorClass':code(value.get('errorClass'),'class'),'childResult':child(value.get('childResult')),'rawEnvironmentOrErrorsExported':False}
  elif path==ROOT/'production-strict-v2-failed.json':
   need(value.get('schema')=='pow-audit30-production-strict-failed-v1'and value.get('unit')==UNIT and value.get('automaticRetry')is False,'FAILURE_BINDING')
   projection={'errorClass':code(value.get('errorClass'),'class'),'timerRestored':optional_flag(value.get('timerRestored')),'cleanupErrors':[code(x,'class')for x in value.get('cleanupErrors',[])],'automaticRetry':False}
  elif path==POSITIVE/'failed.json':
   need(value.get('schema')=='pow-audit30-positive-scoped-owner-completed-v1'and value.get('mode')=='production'and value.get('unit')==POSITIVE_UNIT and value.get('ok')is False and value.get('privateContentsExported')is False and value.get('automaticRetry')is False,'POSITIVE_OWNER_BINDING')
   projection={'ok':False,'errorClass':code(value.get('errorClass'),'class'),'timerRestored':optional_flag(value.get('timerRestored')),'childResult':child(value.get('childResult')),'automaticRetry':False}
  if path==ROOT/'production-strict-v2-completed.json':
   need(value.get('schema')=='pow-audit30-production-strict-completed-v1'and value.get('unit')==UNIT and value.get('returncode')==0 and value.get('stopped')is True and value.get('acceptedReceiptPath')==str(LAUNCH/'accepted-receipt.json'),'STRICT_COMPLETED_BINDING')
   projection={'returncode':0,'stopped':True,'unit':UNIT,'acceptedReceiptSHA256':digest(value['acceptedReceiptSHA256']),'timerRestoredReceiptSHA256':digest(value['timerRestoredReceiptSHA256']),'timerRestored':optional_flag(value.get('timerRestored')),'liveFiveUnchanged':optional_flag(value.get('liveFiveUnchanged')),'productionStop':optional_flag(value.get('productionStop')),'directDatabaseWrites':optional_flag(value.get('directDatabaseWrites'))}
  if path==POSITIVE/'completed.json':
   need(value.get('schema')=='pow-audit30-positive-scoped-owner-completed-v1'and value.get('unit')==POSITIVE_UNIT and value.get('mode')=='production'and value.get('ok')is True and value.get('receiptPath')==str(POSITIVE_OUTPUT)and value.get('privateContentsExported')is False and value.get('automaticRetry')is False,'POSITIVE_COMPLETED_BINDING')
   projection={'ok':True,'unit':POSITIVE_UNIT,'receiptSHA256':digest(value['receiptSHA256']),'timerRestoredReceiptSHA256':digest(value['timerRestoredReceiptSHA256']),'timerRestored':optional_flag(value.get('timerRestored')),'liveFiveUnchanged':optional_flag(value.get('liveFiveUnchanged')),'childResult':child(value.get('childResult')),'privateContentsExported':False,'automaticRetry':False}
  files[key]={**meta,'publicProjection':projection}
 restored=[]
 for directory in(LAUNCH,POSITIVE):
  rows=list(directory.glob('backup-window-*.restored.json'))if directory.exists()else[];need(len(rows)<=1,'TIMER_RECEIPT_COUNT');restored.extend(rows)
 for path in restored:
  need(re.fullmatch('backup-window-[0-9]{8}T[0-9]{6}\\.[0-9]{6}Z\\.restored\\.json',path.name),'TIMER_RECEIPT_NAME');value,meta=read(path)
  need(type(value.get('restored'))is bool,'TIMER_RECEIPT_SHAPE')
  files[('positive-'if path.parent==POSITIVE else'launcher-')+path.name]={**meta,'publicProjection':{'restored':value['restored'],'beforeEqualsAfter':value.get('before')==value.get('after')}}
 final=pathlib.Path('/data/proofofwork-audit29-cutover-'+RELEASE+'-item2-v3/177-final.json');v,meta=read(final);need(meta['sha256']=='c61ddaac5d1b3e47c880806010f41f8d16a1de0817d4654c9c238705f21a2d80'and v.get('ok')is True and v.get('phase')=='complete'and v.get('commit')==CANDIDATE['commit']and v.get('authorityServicesModified')is False and v.get('recoveryRemoved')is False,'NODE_FINAL_BINDING');files['node-cutover-final.json']={**meta,'publicProjection':{'ok':True,'phase':'complete','commit':CANDIDATE['commit'],'authorityServicesModified':False,'recoveryRemoved':False}}
 controls=['proofofwork-audit29-shadow-'+RELEASE+'.service','proofofwork-audit29-shadow-'+RELEASE+'-lease-v3.service',*['proofofwork-audit29-verify-'+RELEASE+'-shadow-strict-'+v+'.service'for v in ('v2','v3')],'proofofwork-audit29-verify-'+RELEASE+'-production-production-strict-v1.service',*['proofofwork-audit30-positive-scoped-'+RELEASE+'-'+v+'.service'for v in ('shadow-v1','production-v1')],*['proofofwork-audit29-release-'+RELEASE+'-node-item2-'+v+'.service'for v in ('v1','v2','v3')]]
 states={unit:state(unit)for unit in(UNIT,POSITIVE_UNIT,*LIVE,'proofofwork-postgres-logical-backup.service','proofofwork-postgres-logical-backup.timer',*controls)}
 controller_quiet={u:states[u].get('MainPID','0')=='0'and(states[u].get('LoadState')=='not-found'or states[u].get('ActiveState')in ('inactive','failed'))for u in(UNIT,POSITIVE_UNIT,*controls)}
 need(time.monotonic()-started<=90,'READONLY_TOTAL_BUDGET')
 unchanged=all(states[unit].get('ActiveState')=='active'and(states[unit].get('MainPID'),states[unit].get('InvocationID'))==pair for unit,pair in LIVE.items())
 print(json.dumps({'schema':'pow-audit30-production-v2-passive-read-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':files,'states':states,'liveFiveMatchSuccessfulCutover':unchanged,'controllerQuiet':controller_quiet,'serviceControl':False,'privateContentsExported':False,'rawChildOutputExported':False,'automaticRetry':False},sort_keys=True))
if __name__=='__main__':main()
