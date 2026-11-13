import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
for(const file of ['check.test.py','coordinator.test.py','qualification.test.py','preinstall.test.py']){
 test('linked Publish deployment '+file,{timeout:30_000},()=>{
  const result=spawnSync('python3',['-I','-B','deploy/linked-publish/'+file],{cwd:root,encoding:'utf8',timeout:25_000,maxBuffer:1_000_000});
  assert.ifError(result.error);assert.equal(result.signal,null);assert.equal(result.status,0,result.stdout+result.stderr);
 });
}
test('linked Publish serving-pin guards',{timeout:30_000},()=>{
 const result=spawnSync(process.execPath,['--test','deploy/linked-publish/pin-serving.test.mjs','deploy/linked-publish/census.test.mjs'],{cwd:root,encoding:'utf8',timeout:25_000,maxBuffer:1_000_000});
 assert.ifError(result.error);assert.equal(result.signal,null);assert.equal(result.status,0,result.stdout+result.stderr);
});
