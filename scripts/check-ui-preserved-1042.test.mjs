import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
for(const file of ['check-preserved-1042.test.py','check-preserved-1042-integration.test.py']){
 test('exact1042 preservation '+file,{timeout:90_000},()=>{
  const result=spawnSync('python3',['-I','-B','deploy/ui-retention/'+file],{
   cwd:root,encoding:'utf8',timeout:80_000,maxBuffer:1_000_000,
   env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}
  });
  assert.ifError(result.error);
  assert.equal(result.signal,null);
  assert.equal(result.status,0,result.stdout+result.stderr);
 });
}
