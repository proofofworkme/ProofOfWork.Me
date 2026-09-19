import {pathToFileURL} from 'node:url';
const root='/opt/proofofwork-api';
const {readonlyDatabaseUrl,verifyReadOnlySettings}=await import(pathToFileURL(root+'/deploy/audit5/shadow-entry.mjs'));
process.env.POW_INDEX_DATABASE_URL=readonlyDatabaseUrl(process.env);
const {createProofIndexPool}=await import(pathToFileURL(root+'/server/db/postgres.mjs'));
const pool=createProofIndexPool();
try {
 const client=await pool.connect();
 try {
  const settings={};
  for(const name of ['transaction_read_only','default_transaction_read_only','search_path'])settings[name]=(await client.query('SHOW '+name)).rows[0][name];
  settings.database=(await client.query('SELECT current_database() AS database')).rows[0].database;
  verifyReadOnlySettings(settings);
 }finally{client.release();}
}finally{await pool.end();}
console.log('event_audit readonly_pool=verified database=verified');
await import(pathToFileURL(root+'/scripts/audit-computer-events.mjs'));
