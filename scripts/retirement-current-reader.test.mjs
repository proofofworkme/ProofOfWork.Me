import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {retirementCurrentReadProgram,retirementReadProgram} from './retirement-evidence.mjs';
test('current publication reader preserves native path/hash/metadata fences in isolated namespace',()=>{
 const py=String.raw`
import json,sys,tempfile,pathlib,os,hashlib,io
program=json.load(sys.stdin)['program']
# Execute only unchanged byte reader functions, not production collection.
start=program.index('seen={}')
end=program.index('result={}')
reader=program[start:end]
for case in ('valid','hash','mode','private','sticky','foreign','symlink'):
 with tempfile.TemporaryDirectory() as tmp:
  top=pathlib.Path(tmp);sticky=top/'sticky';sticky.mkdir();sticky.chmod(0o1777)
  private=sticky/'proofofwork-deploy';private.mkdir();private.chmod(0o700)
  directory=private/'recovery-publish-c22e585baa9d-20261116T013245Z-pay-c1';directory.mkdir();directory.chmod(0o700)
  p=directory/'receipt.json';raw=b'{}'+b' '*3237;p.write_bytes(raw);p.chmod(0o600)
  digest=hashlib.sha256(raw).hexdigest()
  code=reader.replace('/var/tmp',str(sticky)).replace('abea00973596077de663de98435abb222945eadaa5a8b10c40c9a03a2616baf2',digest)
  # Namespace owner/ancestor mapping only; unchanged mode/path/hash assertions.
  code=code.replace('s.st_uid==s.st_gid==0','s.st_uid==os.getuid() and s.st_gid==os.getgid()').replace('before.st_uid==before.st_gid==0','before.st_uid==os.getuid() and before.st_gid==os.getgid()')
  code=code.replace('for parent in p.parents:', 'for parent in [x for x in p.parents if x==pathlib.Path('+repr(str(top))+') or pathlib.Path('+repr(str(top))+') in x.parents]:')
  ns={};exec('import base64,hashlib,json,os,pathlib,re,stat,sys\n'+code,ns)
  expected=digest
  if case=='hash':expected='0'*64
  if case=='mode':p.chmod(0o644)
  if case=='private':directory.chmod(0o755)
  if case=='sticky':sticky.chmod(0o777)
  if case=='foreign':q=p.with_name('foreign.json');p.rename(q);p=q
  if case=='symlink':q=p.with_name('target');p.rename(q);p.symlink_to(q)
  failed=False
  try:ns['read'](str(p),expected)
  except (AssertionError,FileNotFoundError):failed=True
  assert failed==(case!='valid'),case
`;
 execFileSync('/usr/bin/python3',['-I','-B','-c',py],{input:JSON.stringify({program:retirementCurrentReadProgram}),timeout:15000});
});
test('embedded native repair bytes require exact installed manifest identity before execution',()=>{
 const py=String.raw`
import json,sys,base64,hashlib
program=json.load(sys.stdin)['program']
bootstrap=program[program.index('repair_source=base64.b64decode('):program.index("result['lifecycleEvidence']=[]")]
check=program[program.index("assert config['package']['path']=="):program.index('absent_allowed=')]
for case in ('valid','bytes','hash','path'):
 ns={'base64':base64,'hashlib':hashlib};exec(bootstrap,ns)
 source=ns['repair_source'];entry={'bytes':len(source),'sha256':hashlib.sha256(source).hexdigest()}
 if case=='bytes':entry['bytes']+=1
 if case=='hash':entry['sha256']='0'*64
 root='/var/backups/proofofwork-ui/cleanup-evidence/';sha='a'*64
 ns.update(root=root,config={'package':{'path':root+'ui-lifecycle-tools-'+sha,'sha256':sha}},read=lambda p,h:({}, {'files':{'deploy/ui-retention/failed_prepare_repair.py':entry}}))
 if case=='path':ns['config']['package']['path']='/foreign'
 failed=False
 try:exec(check,ns)
 except AssertionError:failed=True
 assert failed==(case!='valid'),case
 assert ('verify_edge' in ns['repair_namespace'])==(case=='valid')
`;
 execFileSync('/usr/bin/python3',['-I','-B','-c',py],{input:JSON.stringify({program:retirementCurrentReadProgram}),timeout:15000});
});
test('current aggregate envelope expands only measured totals; historical and individual bounds remain exact',()=>{
 const py=String.raw`
import json,sys,base64,hashlib,pathlib
r=json.load(sys.stdin)
for name,cap in [('historical',16*1024**2),('current',64*1024**2)]:
 code=r[name];start=code.index('def charge(');end=code.index('def ancestor(')
 ns={'encoded_budget':0};exec(code[start:end],ns)
 ns['charge']('x',12582912 if name=='current' else 1)
 ns['encoded_budget']=cap-261;ns['charge']('x',1);assert ns['encoded_budget']==cap
 try:ns['charge']('x',1)
 except AssertionError:pass
 else:raise AssertionError('aggregate overflow accepted')
 assert '0<before.st_size<=16*1024**2' in code and 'stream.read(16*1024**2+1)' in code
assert "len(lifecycle_rows)<=100" in r['current'] and 'range(16)' in r['current']
assert 'len(raw.encode())<=64*1024**2' in r['current'] and 'len(raw.encode())<=16*1024**2' in r['historical']
source=pathlib.Path(r['consumer']).read_text();start=source.index(' def read(row,');end=source.index(' def obj(',start)
# Exact production decoding function with only surrounding immutable helper setup.
ns={'Path':pathlib.Path,'base64':base64,'binascii':__import__('binascii'),'need':lambda value,message:None if value else (_ for _ in ()).throw(ValueError(message)),'RET_hash_value':lambda x:None,'RET_digest':lambda b:hashlib.sha256(b).hexdigest()}
exec('def factory():\n total=0\n'+source[start:end]+' return read\n',ns)
def row(n):
 b=b'x'*n;return {'path':'/fixture','base64':base64.b64encode(b).decode(),'sha256':hashlib.sha256(b).hexdigest()}
read=ns['factory']()
for n in (13314957,11944133,16*1024**2,1478863):read(row(n))
# Measured raw total=43,515,169; exact48MiB aggregate accepts, nextbyte refuses.
read(row(48*1024**2-43515169))
try:read(row(1))
except ValueError:pass
else:raise AssertionError('decoded aggregate overflow accepted')
read=ns['factory']()
try:read(row(16*1024**2+1))
except ValueError:pass
else:raise AssertionError('individual overflow accepted')
bad=row(1);bad['sha256']='0'*64
try:read(bad)
except ValueError:pass
else:raise AssertionError('hash mismatch accepted')
`;
 execFileSync('/usr/bin/python3',['-I','-B','-c',py],{input:JSON.stringify({current:retirementCurrentReadProgram,historical:retirementReadProgram,consumer:new URL('./retirement-current-evidence.py',import.meta.url).pathname}),timeout:30000});
});

test('closed current consumer repaired chain and ordinary seal regressions',()=>{
 execFileSync('/usr/bin/python3',['-I','-B',new URL('./check-retirement-current-repair.test.py',import.meta.url).pathname],{timeout:30000});
});
