#!/usr/bin/python3 -I
"""Fixed audit-owned 5-second retained unit probe. No Core/SQL/app file access."""
import hashlib,json,os,re,signal,subprocess,sys,time
UNIT='proofofwork-audit30-retained-codeonly-probe-20261003T033000Z.service'
CODE='import json,time;time.sleep(0.3);print(json.dumps({"audit30CodeOnlyProbe":True}),flush=True)'
ARGV=['/usr/bin/python3','-I','-B','-c',CODE]
FIELDS=('LoadState','ActiveState','SubState','Type','Transient','RemainAfterExit','User','Group','MainPID','InvocationID','ControlGroup','Result','ExecMainStatus','MemoryMax','MemorySwapMax','CPUQuotaPerSecUSec','TasksMax','RuntimeMaxUSec','TimeoutStopUSec','NoNewPrivileges','PrivateNetwork','ProtectSystem','ProtectHome','CapabilityBoundingSet')

def need(v,m):
 if not v:raise ValueError(m)
def sha(v):return hashlib.sha256(v).hexdigest()
def cmd(a):
 r=subprocess.run(a,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'},cwd='/');need(r.returncode==0 and len(r.stdout)<=65536 and len(r.stderr)<=65536,'Fixed bounded command refused '+sha(r.stderr));return r.stdout

def props():
 d={}
 for line in cmd(['/usr/bin/systemctl','show',UNIT,'--no-pager',*['--property='+k for k in FIELDS]]).decode().splitlines():
  k,sep,v=line.partition('=');need(sep and k not in d,'Unit shape');d[k]=v
 need(set(d)==set(FIELDS),'Missing unit property');return d

def typed():
 m=json.loads(cmd(['/usr/bin/busctl','--system','--json=short','call','org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager','GetUnit','s',UNIT]));need(m.get('type')=='o'and isinstance(m.get('data'),list)and len(m['data'])==1 and isinstance(m['data'][0],str)and re.fullmatch('/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+',m['data'][0]),'Typed manager');e=json.loads(cmd(['/usr/bin/busctl','--system','--json=short','get-property','org.freedesktop.systemd1',m['data'][0],'org.freedesktop.systemd1.Service','ExecStart']));need(e.get('type')=='a(sasbttttuii)'and isinstance(e.get('data'),list)and len(e['data'])==1 and len(e['data'][0])==10 and e['data'][0][0]==ARGV[0]and e['data'][0][1]==ARGV and e['data'][0][2]is False,'Typed literal fixed command');return{'objectPath':m['data'][0],'argvSha256':sha(json.dumps(ARGV,separators=(',',':')).encode())}

def identity(v,owned=None):
 need(v['LoadState']=='loaded'and v['Type']=='exec'and v['Transient']=='yes'and v['RemainAfterExit']=='yes'and v['User']==v['Group']=='bitcoin'and re.fullmatch('[0-9a-f]{32}',v['InvocationID'])and(owned is None or v['InvocationID']==owned),'Probe-owned identity');return typed()

def main():
 need(os.geteuid()==0 and sys.flags.isolated and len(sys.argv)==1 and os.uname().nodename=='pow-bitcoin-01','Isolated fixed root host');initial=props();need(initial['LoadState']=='not-found'and initial['MainPID']=='0'and initial['InvocationID']=='','Preexisting probe unit');owned=None;rows=[];cleanup=None;error=None;old={s:signal.getsignal(s)for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
 def interrupt(s,f):raise InterruptedError('Probe interrupted')
 for s in old:signal.signal(s,interrupt)
 try:
  properties={'Type':'exec','RemainAfterExit':'yes','User':'bitcoin','Group':'bitcoin','RuntimeMaxSec':'5s','TimeoutStopSec':'5s','MemoryMax':'32M','MemorySwapMax':'0','CPUQuota':'10%','TasksMax':'8','NoNewPrivileges':'yes','PrivateNetwork':'yes','RestrictAddressFamilies':'AF_UNIX','ProtectSystem':'strict','ProtectHome':'yes','PrivateTmp':'yes','PrivateDevices':'yes','CapabilityBoundingSet':'','AmbientCapabilities':'','StandardInput':'null','StandardOutput':'journal','StandardError':'journal','KillMode':'control-group','Restart':'no'};a=['/usr/bin/systemd-run','--quiet','--no-block','--unit='+UNIT]
  for k,v in properties.items():a.extend(['--property',k+'='+v])
  cmd(a+['--',*ARGV]);deadline=time.monotonic()+8
  while True:
   v=props();t=identity(v,owned);owned=v['InvocationID'];need(v['MemoryMax']==str(32*1024**2)and v['MemorySwapMax']=='0'and v['CPUQuotaPerSecUSec']=='100ms'and v['TasksMax']=='8'and v['RuntimeMaxUSec']=='5s'and v['TimeoutStopUSec']=='5s'and v['NoNewPrivileges']=='yes'and v['PrivateNetwork']=='yes'and v['ProtectSystem']=='strict'and v['ProtectHome']=='yes'and v['CapabilityBoundingSet']=='','Probe resource/namespace drift');rows.append({'properties':v,'typedCommand':t});need(len(rows)<=180 and time.monotonic()<deadline,'Probe deadline')
   if v['MainPID']=='0'and v['ActiveState']=='active'and v['SubState']=='exited':need(v['Result']=='success'and v['ExecMainStatus']=='0','Probe literal child did not succeed');break
   time.sleep(.05)
 except BaseException as ex:error={'errorClass':type(ex).__name__,'reasonSha256':sha(str(ex).encode())}
 finally:
  for s in old:signal.signal(s,signal.SIG_IGN)
  try:
   if owned:
    before=props();identity(before,owned);cmd(['/usr/bin/systemctl','stop',UNIT]);after=props();need(after['MainPID']=='0'and(after['LoadState']=='not-found'and after['InvocationID']==''or after['InvocationID']==owned and after['ActiveState']in('inactive','failed')),'Own probe stop unverified');cleanup={'ownedInvocation':owned,'before':before,'after':after,'verified':True}
  except BaseException as ex:cleanup={'errorClass':type(ex).__name__,'reasonSha256':sha(str(ex).encode()),'verified':False}
  finally:
   for s,h in old.items():signal.signal(s,h)
 result={'schema':'pow-audit30-retained-unit-codeonly-probe-v1','unit':UNIT,'initial':initial,'observations':rows,'cleanup':cleanup,'failure':error,'codeSha256':sha(CODE.encode()),'productionDataAccess':False,'coreCalls':0,'sqlCalls':0,'appStateAccess':False,'liveUnitActions':False};print(json.dumps(result,sort_keys=True));need(error is None and cleanup and cleanup['verified'],'Probe failed')
if __name__=='__main__':
 try:main()
 except BaseException as ex:print(json.dumps({'status':'refused','errorClass':type(ex).__name__,'reasonSha256':sha(str(ex).encode())}),file=sys.stderr);raise SystemExit(1)
