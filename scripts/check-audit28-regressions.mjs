import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { test } from 'node:test';
import { electrumAddressHistoryCoverage } from '../server/address-chain-pagination.mjs';
const source = readFileSync(new URL('../server/proof-api.mjs', import.meta.url), 'utf8');
function functionText(name) {
 const start = source.indexOf(`async function ${name}(`);
 const end = source.indexOf('\nasync function ', start + 1);
 return source.slice(start, end);
}
function dnsReader({ changedTip = false, changedHistory = false, hydrationFailure = false } = {}) {
 let reads = 0, historyReads = 0;
 const hash = 'a'.repeat(64), txid = 'b'.repeat(64);
 const checkpoint = { height: 100, blockHash: hash };
 const globals = {
  dnsRegistryAddressForNetwork: () => 'dns-address',
  bitcoinRpc: async () => (++reads === 2 && changedTip ? { ...checkpoint, height: 101 } : checkpoint),
  exactCoreTipFromBlockchainInfo: value => value,
  registryAuditElectrumCheckpoint: async value => assert.equal(value.blockHash, hash),
  electrumAddressHistoryCoverage,
  fetchExactAddressHistoryFromElectrum: async () => [{tx_hash: txid, height: ++historyReads === 2 && changedHistory ? 99 : 90}],
  hydrateExactConfirmedRegistryHistory: async (_, network, options) => {
   assert.equal(options.registryAddress, 'dns-address');
   if (hydrationFailure) throw new Error('missing canonical transaction');
   return [{txid, status: {confirmed:true, block_height:90}}];
  },
  mapWithConcurrency: async (entries, _, fn) => Promise.all(entries.map(fn)),
  hydrateExactPendingRegistryTransaction: async () => {throw new Error('unexpected pending');},
  idRegistryStateFromTransactions: () => ({records:[],listings:[]}),
  dnsActivityItemsFromEvents: () => [], parseDnsEventPayload: () => null,
  DNS_PROTOCOL_PREFIX:'pwdns1:', DNS_SALE_AUTH_VERSION_TICKET:'pwdns-sale-v1',
  filterSpendableListings: async value => value,
  registryPayloadFromState: (state, options) => ({...state, ...options}),
  mempoolBase: () => 'first-party', indexedThroughBlockFromTransactions: () => 90,
  ID_MUTATION_PRICE_SATS:546, ID_REGISTRATION_PRICE_SATS:1000, DNS_REGISTRY_ID:'dns',
 };
 return vm.runInNewContext(`(${functionText('dnsRegistryPayload')})`, globals);
}
test('DNS coverage uses a stable Core/Electrum checkpoint separately from latest event', async () => {
 const payload = await dnsReader()('livenet');
 assert.equal(payload.indexedThroughBlock,100);
 assert.equal(payload.latestEventBlock,90);
 assert.equal(payload.checkpointHash,'a'.repeat(64));
 assert.equal(payload.coverage.complete,true);
});
for (const option of ['changedTip','changedHistory','hydrationFailure']) {
 test(`DNS coverage rejects ${option}`, async () => {
  await assert.rejects(dnsReader({[option]:true})('livenet'));
 });
}
test('mail activity preserves exact canonical HTML bytes for Desktop', () => {
 const start=source.indexOf('function mailActivityItemFromMailMessage(');
 const end=source.indexOf('\nfunction ',start+1);
 const fn=vm.runInNewContext(`(${source.slice(start,end)})`,{
  dateIso:value=>value, isValidBitcoinAddress:()=>false,
  numericValue:value=>Number(value)||0, bondConfigForKind:()=>null,
  bondConfigForMemo:()=>null, mailAttachedCreditsFromRecord:()=>[],
  compactText:value=>value, shortAddress:value=>value,
  activityStatusTag:()=> 'Confirmed', networkLabel:()=> 'livenet',
 });
 const memo='<html>canonical bytes</html>\n';
 const result=fn({txid:'b'.repeat(64), memo, confirmed:true, from:'sender', to:'receiver'}, 'receiver','livenet');
 assert.equal(result.memo,memo);
 assert.equal(Buffer.from(result.memo).length,Buffer.from(memo).length);
});
test('DNS surface count accepts the DNS schema and rejects inconsistent counts', () => {
 const audit=readFileSync(new URL('./audit-production-surfaces.mjs',import.meta.url),'utf8');
 const start=audit.indexOf('function validateDnsRegistrySummary('),end=audit.indexOf('\nfunction ',start+1);
 const validate=vm.runInNewContext(`(${audit.slice(start,end)})`,{
  validateIndexedJson:()=>{}, firstNonNegativeInteger:json=>json.stats?.total ?? null,
  assertCondition:(condition,message)=>assert.ok(condition,message),
 });
 const fence={coverage:{complete:true},checkpointHash:'a'.repeat(64)};
 validate({...fence,records:[{}],stats:{total:1}});
 assert.throws(()=>validate({...fence,records:[{}],stats:{total:0}}));
 assert.throws(()=>validate({...fence,records:[{}],stats:{}}));
 assert.throws(()=>validate({records:[],stats:{total:0}}));
});

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
function welcomeLoader(fetchBrowserPage) {
 const start = appSource.indexOf('async function fetchDesktopWelcomeReference(');
 const end = appSource.indexOf('\nfunction publicDesktopMail(', start);
 const javascript = ts.transpile(appSource.slice(start, end), {target: ts.ScriptTarget.ES2022});
 return vm.runInNewContext(`${javascript}; fetchDesktopWelcomeReference`, {
  fetchBrowserPage, CANONICAL_WELCOME_TXID: 'welcome-tx',
 });
}
test('Desktop welcome uses fetched bytes and original metadata without assigning address ownership', async () => {
 const page = {confirmed:true, html:'<html>welcome</html>\n', txid:'welcome-tx',
  attachment:{data:'exact',sha256:'hash',size:21,mime:'text/html',name:'body.html'},
  amountSats:546,createdAt:'original-time',sender:'original-sender',network:'livenet'};
 const load = welcomeLoader(async (txid, network) => {
  assert.equal(txid,'welcome-tx'); assert.equal(network,'livenet'); return page;
 });
 const result = await load('livenet');
 assert.equal(result.memo,page.html);
 assert.equal(result.attachment.data,page.attachment.data);
 assert.equal(result.attachment.sha256,page.attachment.sha256);
 assert.equal(result.from,page.sender);
 assert.equal(result.createdAt,page.createdAt);
 assert.equal(result.to,'');
 assert.equal(result.systemReference,true);
});
test('Desktop welcome rejects pending or unavailable evidence and does not fetch mainnet on testnets', async () => {
 await assert.rejects(welcomeLoader(async () => ({confirmed:false}))('livenet'), /not confirmed/);
 await assert.rejects(welcomeLoader(async () => {throw new Error('unavailable');})('livenet'), /unavailable/);
 assert.equal(await welcomeLoader(async () => {throw new Error('must not fetch');})('testnet4'),undefined);
});
