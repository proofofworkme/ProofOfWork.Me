#!/usr/bin/python3 -I -B
"""Fixed bounded read-only classification of prior driver check schema only."""
import hashlib,json,os,pathlib,pwd,re,stat
PATH=pathlib.Path('/data/proofofwork-audit29-verify-output-38ac6e2bff2a-20261003T042000Z-shadow-strict-v2/attempt/receipt.json');PIN='0f77ed860b40e4762f4ad0962dbc66faded888d6db865bd44e542842eff5689c';CAP=4*1024**2

def need(v,c):
 if not v:raise ValueError(c)
def stamp(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def bounded(value,maximum):
 return value if isinstance(value,(bool,int))or value is None else value[:maximum]if isinstance(value,str)else {'type':type(value).__name__}
def main():
 need(os.geteuid()==os.getegid()==0,'ROOT');account=pwd.getpwnam('powadmin');s=PATH.lstat();need(PATH.resolve()==PATH and stat.S_ISREG(s.st_mode)and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink)==(account.pw_uid,account.pw_gid,0o600,1)and 0<s.st_size<=CAP,'DRIVER_FILE_SHAPE');fd=os.open(PATH,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  raw=b''
  while len(raw)<=CAP:
   b=os.read(fd,min(65536,CAP+1-len(raw)))
   if not b:break
   raw+=b
  need(len(raw)==s.st_size and stamp(os.fstat(fd))==stamp(s)==stamp(PATH.lstat())and hashlib.sha256(raw).hexdigest()==PIN,'DRIVER_BYTES_BINDING')
 finally:os.close(fd)
 v=json.loads(raw);need(v.get('failure')=='STRICT_GATE_FAILED'and v.get('gates')=={'ids':True,'events':True,'parity':False},'PRIOR_FAILURE_BINDING');out={}
 for gate in ['events','parity']:
  g=v['gateReceipts'][gate];checks=g['checks'];need(type(checks)is list and len(checks)==(49 if gate=='events'else 102),'PRIOR_CHECK_COUNT');invalid=[]
  for ordinal,c in enumerate(checks):
   shape=type(c)is dict;name_ok=shape and re.fullmatch('[a-z0-9-]{1,128}',str(c.get('name','')))is not None;ok_ok=shape and type(c.get('ok'))is bool;severity_ok=shape and c.get('severity')in ['error','warning']
   if not(shape and name_ok and ok_ok and severity_ok):
    need(len(invalid)<102,'OUTPUT_BOUND');invalid.append({'ordinal':ordinal,'entryIsObject':shape,'nameAllowedByDraft':name_ok,'okIsBoolean':ok_ok,'severityAllowedByDraft':severity_ok,'name':bounded(c.get('name'),180)if shape else None,'ok':bounded(c.get('ok'),32)if shape else None,'severity':bounded(c.get('severity'),32)if shape else None})
  out[gate]={'checkCount':len(checks),'invalidUnderDraftCount':len(invalid),'invalidUnderDraft':invalid}
 print(json.dumps({'schema':'audit30-prior-check-shape-readonly-v1','receiptPath':str(PATH),'receiptSHA256':PIN,'gates':out,'productionMutation':False,'serviceControl':False,'privateContentsExported':False,'rawChildLogsExported':False},sort_keys=True))
if __name__=='__main__':main()
