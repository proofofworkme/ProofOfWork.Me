#!/usr/bin/python3 -I
"""Fixed ten-second host CPU/RAM/pressure/capacity read-only observation.
No SQL, service operations, dumps, environment or application state read.
"""
import datetime,json,os,re,sys,time
from pathlib import Path
CPU_FIELDS=('user','nice','system','idle','iowait','irq','softirq','steal','guest','guestNice')
MEM_FIELDS=('MemTotal','MemFree','MemAvailable','Buffers','Cached','SwapTotal','SwapFree','SwapCached','Dirty','Writeback','Slab','SReclaimable')

def need(v,m):
 if not v:raise ValueError(m)
def read(path,limit=1024**2):
 with open(path,'rb')as f:b=f.read(limit+1)
 need(len(b)<=limit,'Fixed proc metadata bound');return b.decode('ascii')
def cpu(text):
 lines=text.splitlines();need(lines and lines[0].startswith('cpu '),'Aggregate CPU record');parts=lines[0].split()[1:];need(8<=len(parts)<=10 and all(re.fullmatch('[0-9]+',v)for v in parts),'CPU field shape');return dict(zip(CPU_FIELDS,[int(v)for v in parts]+[0]*(10-len(parts))))
def delta(before,after):
 d={k:after[k]-before[k]for k in CPU_FIELDS};total=sum(d[k]for k in CPU_FIELDS[:8]);valid=all(v>=0 for v in d.values())and total>0
 return {'jiffies':d,'totalJiffiesExcludingDuplicateGuest':total,'countersMonotonic':all(v>=0 for v in d.values()),'validPercentageSample':valid,'busyPercentExcludingIdleAndIOWait':100*(total-d['idle']-d['iowait'])/total if valid else None,'nonIdlePercentIncludingIOWait':100*(total-d['idle'])/total if valid else None,'iowaitPercent':100*d['iowait']/total if valid else None,'stealPercent':100*d['steal']/total if valid else None,'qualification':'First eight kernel CPU counters form the denominator; guest counters are already included in user/nice and are not added again. Nonmonotonic/zero counters yield no derived percentage.'}
def online(text):
 v=text.strip();need(re.fullmatch('[0-9,-]+',v),'Online CPU list');seen=set()
 for token in v.split(','):
  parts=token.split('-');need(1<=len(parts)<=2 and all(p.isdecimal()for p in parts),'Online CPU token');a=int(parts[0]);b=int(parts[-1]);need(0<=a<=b<=65535,'Online CPU range');rows=set(range(a,b+1));need(not seen.intersection(rows),'Duplicate online CPU range');seen.update(rows)
 return {'list':v,'logicalCpuCount':len(seen)}
def mem(text):
 values={}
 for line in text.splitlines():
  if not ':'in line:continue
  k,raw=line.split(':',1)
  if k not in MEM_FIELDS:continue
  need(k not in values,'Duplicate memory record');parts=raw.split();need(len(parts)==2 and parts[0].isdecimal()and parts[1]=='kB','Memory KiB record');values[k]=int(parts[0])*1024
 need(set(values)==set(MEM_FIELDS)and 0<=values['MemFree']<=values['MemTotal']and 0<=values['MemAvailable']<=values['MemTotal']and 0<=values['SwapFree']<=values['SwapTotal'],'Memory bounds/availability');return {'bytes':values,'usedRamAgainstAvailableBytes':values['MemTotal']-values['MemAvailable'],'availableRamPercent':100*values['MemAvailable']/values['MemTotal']if values['MemTotal']else None,'swapUsedBytes':values['SwapTotal']-values['SwapFree'],'swapAvailablePercent':100*values['SwapFree']/values['SwapTotal']if values['SwapTotal']else None,'qualification':'MemAvailable is the current kernel reclaimability estimate; this is a host RAM snapshot, not process RSS or a MemoryPeak observation.'}
def pressure(text):
 values={}
 for line in text.splitlines():
  parts=line.split();need(parts and parts[0]in('some','full')and parts[0]not in values,'Pressure surface');r={}
  for token in parts[1:]:
   k,sep,v=token.partition('=');need(sep and k not in r,'Pressure duplicate field');r[k]=v
  need(set(r)=={'avg10','avg60','avg300','total'}and all(re.fullmatch(r'[0-9]+(?:\.[0-9]+)?',r[k])for k in('avg10','avg60','avg300'))and r['total'].isdecimal(),'Pressure record');need(all(0<=float(r[k])<=100 for k in('avg10','avg60','avg300')),'Pressure percentage bound');values[parts[0]]=r
 need('some'in values,'Pressure some missing');return values
def capacity(path):
 p=Path(path);need(p.resolve(strict=True)==p and p.is_dir(),'Fixed filesystem root alias');v=os.statvfs(p);need(v.f_frsize>0 and 0<=v.f_bavail<=v.f_bfree<=v.f_blocks,'Filesystem block bounds');return {'path':path,'device':p.stat().st_dev,'fragmentBytes':v.f_frsize,'totalBytes':v.f_blocks*v.f_frsize,'freeBytesIncludingReserved':v.f_bfree*v.f_frsize,'availableBytes':v.f_bavail*v.f_frsize,'allocatedBytes':(v.f_blocks-v.f_bfree)*v.f_frsize,'reservedFreeBytes':(v.f_bfree-v.f_bavail)*v.f_frsize,'inodesTotal':v.f_files,'inodesFree':v.f_ffree,'inodesAvailable':v.f_favail}
def snapshot():
 return {'cpu':cpu(read('/proc/stat')),'online':online(read('/sys/devices/system/cpu/online',4096)),'memory':mem(read('/proc/meminfo',65536)),'pressure':{k:pressure(read('/proc/pressure/'+k,65536))for k in('cpu','memory','io')}}
def main():
 need(sys.flags.isolated and len(sys.argv)==2 and sys.argv[1]in('ui','node'),'Fixed isolated role');role=sys.argv[1];began=datetime.datetime.now(datetime.timezone.utc).isoformat();start=time.monotonic();a=snapshot();time.sleep(10);b=snapshot();elapsed=time.monotonic()-start;need(9.5<=elapsed<=20,'Ten-second sample elapsed bound');data=None;data_qualification='Not admitted for UI role; no /data capacity inferred.'
 if role=='node':
  mountinfo=read('/proc/self/mountinfo');known=any(len(line.split())>=6 and line.split()[4]=='/data'for line in mountinfo.splitlines())
  if known:data=capacity('/data');data_qualification='Exact known /data kernel mountpoint observed.'
  else:data_qualification='Node /data is not an exact kernel mountpoint; no data capacity inferred.'
 print(json.dumps({'schema':'pow-audit30-fresh-resource-sampler-v1','role':role,'hostname':os.uname().nodename,'startedAtUtc':began,'completedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sampleDurationSeconds':elapsed,'clockTicksPerSecond':os.sysconf('SC_CLK_TCK'),'cpu':delta(a['cpu'],b['cpu']),'onlineBefore':a['online'],'onlineAfter':b['online'],'memoryBefore':a['memory'],'memoryAfter':b['memory'],'pressureBefore':a['pressure'],'pressureAfter':b['pressure'],'rootFilesystem':capacity('/'),'dataFilesystem':data,'dataFilesystemQualification':data_qualification,'productionMutation':False,'sqlOrServiceOperations':False,'dumpBodyEnvironmentReads':False,'qualification':'Ten-second current host utilization and current memory/capacity only; not sustained load, growth forecast, chain/data/math health or backup completion. Concurrent routine backup/deployment context must be recorded separately.'},sort_keys=True,separators=(',',':')))
if __name__=='__main__':
 try:main()
 except BaseException as ex:print(json.dumps({'schema':'pow-audit30-fresh-resource-sampler-refusal-v1','errorClass':type(ex).__name__,'productionMutation':False}),file=sys.stderr);raise SystemExit(1)
