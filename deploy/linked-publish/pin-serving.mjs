#!/usr/bin/env node
// Additive retention only. Never switches readers, enables writes, or removes pins.
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createProofIndexPool} from '../../server/db/postgres.mjs';
export const LEGACY_VERSION='proof-search-v5-powcat-files';
const need=(ok,message)=>{if(!ok)throw new Error(message);};
export function assertHeld(states) {
  for(const name of ['proofofwork-search-index.service','proofofwork-search-index.timer']) {
    const row=states[name];
    need(row && row.ActiveState==='inactive' && row.SubState==='dead' && (name.endsWith('.timer') || row.MainPID==='0'),
      'Search timer and builder must be fully stopped by the existing pinned hold controller.');
  }
}
export async function pinServing({client,network='livenet',runId,releaseId,assertHold}) {
  need(network==='livenet' && typeof runId==='string' && /^[a-zA-Z0-9-]{1,80}$/.test(runId) &&
    typeof releaseId==='string' && /^[a-zA-Z0-9-]{1,80}$/.test(releaseId),'Exact mainnet run/release identity required.');
  await assertHold();
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='1s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    const lock=await client.query("SELECT pg_try_advisory_xact_lock(hashtext('proof-search-v1'),hashtext($1)) AS locked",[network]);
    need(lock.rows[0]?.locked===true,'Search builder is still running.');
    const run=(await client.query(`SELECT run_id,index_version,state,checkpoint_height,checkpoint_hash FROM proof_indexer.search_runs
      WHERE network=$1 AND index_version=$2 AND state='ready' ORDER BY completed_at DESC LIMIT 1 FOR SHARE`,[network,LEGACY_VERSION])).rows[0];
    need(run?.run_id===runId,'Selected run is not the current ready legacy serving generation.');
    const reason='linked-publish-prebuild:'+releaseId;
    const existing=(await client.query('SELECT run_id,reason FROM proof_indexer.search_serving_pins WHERE network=$1 FOR UPDATE',[network])).rows[0];
    need(!existing || (existing.run_id===runId && existing.reason===reason),'A different serving pin already exists; never replace it implicitly.');
    if(!existing)await client.query('INSERT INTO proof_indexer.search_serving_pins(network,run_id,reason) VALUES($1,$2,$3)',[network,runId,reason]);
    await assertHold();
    await client.query('COMMIT');
    return {ok:true,network,releaseId,pinned:run,reason,alreadyPinned:Boolean(existing),
      readerSwitch:false,writerEnabled:false,pinRemoval:false};
  } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;}
}
async function cli() {
  const [runId,releaseId,holdSha,...extra]=process.argv.slice(2);
  need(!extra.length && /^[0-9a-f]{64}$/.test(holdSha??''),'Usage: pin-serving.mjs RUN_ID RELEASE_ID HOLD_MARKER_SHA256');
  const assertHold=async()=>{
    const raw=await readFile('/run/proofofwork-search-release.hold');
    need(createHash('sha256').update(raw).digest('hex')===holdSha,'Search hold marker changed.');
    need(JSON.parse(raw).releaseId===releaseId,'Search hold belongs to another release.');
    const states={};
    for(const unit of ['proofofwork-search-index.service','proofofwork-search-index.timer']) {
      const text=execFileSync('/usr/bin/systemctl',['show',unit,'--property=ActiveState','--property=SubState','--property=MainPID'],
        {encoding:'utf8',timeout:5000,maxBuffer:8192});
      states[unit]=Object.fromEntries(text.trim().split('\n').map(line=>line.split('=')));
    }
    assertHeld(states);
  };
  const pool=createProofIndexPool({env:{...process.env,POW_INDEX_DB_POOL_MAX:'1',POW_INDEX_DB_STATEMENT_TIMEOUT_MS:'15000',POW_INDEX_DB_APP_NAME:'linked-publish-serving-pin'}});
  const client=await pool.connect();
  try {console.log(JSON.stringify(await pinServing({client,runId,releaseId,assertHold})));}finally{client.release();await pool.end();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)cli().catch(error=>{console.error(error.message);process.exitCode=1;});
