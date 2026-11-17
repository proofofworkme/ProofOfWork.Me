import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {fileURLToPath,pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {requireIdentityProof,createIdentityProof} from "./release-identity-proof.mjs";

import {collectRetirementEvidence,validateRetainedHolds,attestInstalledRetentionPackage,bindInstalledRetentionPackage,
 attestCurrentRetentionPackage,collectCurrentRetirementEvidence,validateCurrentRetainedHolds} from "./retirement-evidence.mjs";
import {validateCurrentVerifierProof} from "./current-verifier-proof.mjs";
import {consumeActivityLifecycle} from "./lifecycle-status-witness.mjs";
const identityGit=(...args)=>execFileSync("/usr/bin/git",["--no-replace-objects","-c","core.fsmonitor=false",...args],{encoding:"utf8",timeout:15000,env:{PATH:"/usr/bin:/bin",HOME:"/nonexistent",LC_ALL:"C",GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null",GIT_OPTIONAL_LOCKS:"0"}}).trim();
export function validateActivityIdentity(identityProof) {
 const proof=requireIdentityProof(identityProof);
 assert.equal(resolve(proof.repository),fileURLToPath(new URL("../",import.meta.url)).replace(/\/$/u,""));
 assert.equal(resolve(process.cwd()),proof.repository);
 assert.equal(identityGit("rev-parse","HEAD"),proof.operator.commit);
 return proof;
}
export async function runActivityFeeFactorLive({identityProof,lifecycleWitness,currentVerifierProof}={}) {
assert(!(currentVerifierProof!==undefined&&(identityProof!==undefined||lifecycleWitness!==undefined)),"Current verifier proof cannot mix with historical identity/witness");
const currentIdentity=currentVerifierProof===undefined?undefined:validateCurrentVerifierProof(currentVerifierProof,{repository:fileURLToPath(new URL("../",import.meta.url)).replace(/\/$/u,"")});
if(identityProof!==undefined) validateActivityIdentity(identityProof);
else assert.equal(resolve(process.cwd()),fileURLToPath(new URL("../",import.meta.url)).replace(/\/$/u,""));
const witnessedLifecycle=lifecycleWitness===undefined?undefined:consumeActivityLifecycle(lifecycleWitness,identityProof);
const activityExec=(command,args,options)=>execFileSync(identityProof===undefined?command:"/usr/bin/"+command,args,
 {...options,...(identityProof===undefined?{}:{env:{PATH:"/usr/bin:/bin",HOME:"/nonexistent"}})});
// Public on-chain holder only. This check neither signs nor broadcasts.
const address = "1447TsdXtFSnVrWawSamyyQKPDNW4ALtBT";
const tokenId = "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const base = identityProof===undefined ? (process.env.POW_API_BASE || "https://computer.proofofwork.me") : "https://computer.proofofwork.me";
async function read(path) {
  const started = performance.now();
  const response = await fetch(new URL(path, base), {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200, `${path.split("?")[0]} unavailable (${response.status})`);
  const bytes = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    assert.ok(length <= 8 * 1024 ** 2, "Unexpected verification response size");
    bytes.push(chunk);
  }
  return { body: JSON.parse(Buffer.concat(bytes).toString("utf8")), elapsedMs: Math.round(performance.now() - started) };
}
const before = (await read("/health")).body;
assert.equal(before.ready, true, "Production must be ready before the stable-checkpoint probe");
const { tipHeight: height, bestBlockHash: hash } = before.checks.node;
assert.ok(Number.isSafeInteger(height));
assert.match(hash, /^[0-9a-f]{64}$/u);
const registry = await read("/api/v1/registry-summary?network=livenet&fresh=1");
assert.equal(registry.body.indexedThroughBlock, height);
assert.equal(registry.body.indexedThroughBlockHash, hash);
const wallet = await read("/api/v1/token?" + new URLSearchParams({ network: "livenet", tokenId, address, wallet: "1", fresh: "1" }));
assert.equal(wallet.body.indexedThroughBlock, height);
assert.equal(wallet.body.indexedThroughBlockHash, hash);
const capacities = wallet.body.canonicalWorkCapacities;
assert.ok(Array.isArray(capacities) && capacities.length === 1, "Fresh wallet must include exact WORK capacity proof");
const [capacity] = capacities;
assert.equal(capacity.model, "canonical-work-wallet-capacity-v1");
assert.equal(capacity.address, address);
assert.equal(capacity.tokenId, tokenId);
assert.equal(capacity.indexedThroughBlock, height);
assert.equal(capacity.indexedThroughBlockHash, hash);
for (const name of ["confirmedBalanceSubatoms", "reservedBalanceSubatoms", "transferableBalanceSubatoms"]) {
  assert.match(capacity[name], /^(?:0|[1-9][0-9]*)$/u);
}
assert.equal(BigInt(capacity.confirmedBalanceSubatoms) - BigInt(capacity.reservedBalanceSubatoms), BigInt(capacity.transferableBalanceSubatoms));
assert.ok(BigInt(capacity.confirmedBalanceSubatoms) > 0n, "Public wallet must exercise a positive WORK holding");
const holders = wallet.body.holders.filter(holder => holder.address === address && holder.tokenId === tokenId);
assert.equal(holders.length, 1, "Fresh wallet must include its exact positive holder row");
assert.equal(holders[0].amountStorageModel, "work-subatoms-v2");
assert.equal(holders[0].balanceSubatoms, capacity.confirmedBalanceSubatoms);
assert.match(capacity.tokenStateCommitment?.sha256, /^[0-9a-f]{64}$/u);
const after = (await read("/health")).body;
assert.equal(after.ready, true);
assert.equal(after.checks.node.tipHeight, height, "Core advanced; repeat the complete probe at a stable tip");
assert.equal(after.checks.node.bestBlockHash, hash, "Core changed; repeat the complete probe at a stable tip");

const expectedRuntime = JSON.parse(activityExec("python3", ["-I", "-B", "-c", `import ast,json,pathlib,re,hashlib,sys
values={}
for path in ('deploy/audit-remediation/profile.py','deploy/activity-fee-factor/profile.py'):
 module=ast.parse(pathlib.Path(path).read_text())
 for name in ('AFTER','PRESERVED'):
  assignments=[node for node in module.body if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id==name for t in node.targets)]
  assert len(assignments)==1
  if path.endswith('activity-fee-factor/profile.py') and name=='PRESERVED': continue
  values.update(ast.literal_eval(assignments[0].value))
# The accepted linked release supersedes exactly these three historical pins.
# Read reviewed source constants, never learn expected hashes from the live host.
expected={'server/proof-api.mjs','server/db/proof-index-reader.mjs','server/db/read-only-snapshot.mjs',
          'server/wallet-read-observation.mjs','scripts/backfill-proof-indexer.mjs','server/pwid-rejection-projection.mjs'}
replaced={'server/proof-api.mjs','server/db/proof-index-reader.mjs','scripts/backfill-proof-indexer.mjs'}
assert set(values)==expected
module=ast.parse(pathlib.Path('deploy/linked-publish/profile.py').read_text())
assignments=[node for node in module.body if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='AFTER' for t in node.targets)]
assert len(assignments)==1
linked=ast.literal_eval(assignments[0].value)
assert isinstance(linked,dict) and set(linked)&expected==replaced
values.update({path:linked[path] for path in replaced})
assert set(values)==expected and all(isinstance(value,str) and re.fullmatch('[0-9a-f]{64}',value) for value in values.values())
mode=sys.argv[1] if len(sys.argv)>1 else 'historical'
assert mode in ('historical','current')
if mode=='current':
 profile=json.loads(pathlib.Path('deploy/pay/runtime-profile.json').read_text())
 assert profile['format']=='pay-reviewed-runtime-profile-v1'
 assert re.fullmatch('[0-9a-f]{40}',profile['sourceCommit'])
 for key in ('planSha256','mergedRuntimeTestReceiptSha256','overlayReceiptSha256'):
  assert re.fullmatch('[0-9a-f]{64}',profile[key])
 pay={'scripts/backfill-proof-indexer.mjs','server/candidate-discovery-reorg.mjs','server/db/jobs-reader.mjs',
      'server/db/mail-work-settlement-reader.mjs','server/db/pay-reader.mjs','server/db/proof-index-reader.mjs',
      'server/jobs.mjs','server/mail-work-settlement.mjs','server/notifications.mjs','server/pay.mjs',
      'server/proof-api.mjs','server/proof-index-event-relations.mjs','src/shared/protocol/pay.mjs'}
 added={'server/db/mail-work-settlement-reader.mjs','server/db/pay-reader.mjs',
        'server/mail-work-settlement.mjs','server/pay.mjs','src/shared/protocol/pay.mjs'}
 assert set(profile['sources'])==pay and pay&expected==replaced
 for path,row in profile['sources'].items():
  assert set(row)==({'before','after','source'} if path in replaced else {'before','after'})
  assert row['before'] is None if path in added else isinstance(row['before'],str) and re.fullmatch('[0-9a-f]{64}',row['before'])
  assert re.fullmatch('[0-9a-f]{64}',row['after'])
  if path in replaced: assert row['before']==values[path] and re.fullmatch('[0-9a-f]{64}',row['source'])
  # Preserve native-overlay bytes as reviewed; all canonical inputs must still match.
  assert hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()==row.get('source',row['after']),path+' source differs'
  values[path]=row['after']
 assert len(values)==16
print(json.dumps(values))`, identityProof===undefined?"current":"historical"], { encoding: "utf8", timeout: 15_000 }));
assert.equal(Object.keys(expectedRuntime).length, identityProof===undefined?16:6);
const monitorHash = createHash("sha256").update(readFileSync("deploy/proofofwork-postgres-query-health.sh")).digest("hex");
const program = `import hashlib,json,pathlib,subprocess,sys
r=json.load(sys.stdin)
for path,digest in r['runtime'].items():
 assert path in ('server/proof-api.mjs','server/db/proof-index-reader.mjs','server/db/read-only-snapshot.mjs','server/wallet-read-observation.mjs','scripts/backfill-proof-indexer.mjs','server/pwid-rejection-projection.mjs','server/candidate-discovery-reorg.mjs','server/db/jobs-reader.mjs','server/db/mail-work-settlement-reader.mjs','server/db/pay-reader.mjs','server/jobs.mjs','server/mail-work-settlement.mjs','server/notifications.mjs','server/pay.mjs','server/proof-index-event-relations.mjs','src/shared/protocol/pay.mjs')
 assert hashlib.sha256((pathlib.Path('/opt/proofofwork-api')/path).read_bytes()).hexdigest()==digest,path+' differs'
monitor=pathlib.Path('/usr/local/sbin/proofofwork-postgres-query-health')
assert hashlib.sha256(monitor.read_bytes()).hexdigest()==r['monitor'],'Monitor differs'
result=subprocess.run(['/usr/sbin/runuser','-u','postgres','--',str(monitor)],capture_output=True,text=True,timeout=60)
assert result.returncode==0,result.stdout+result.stderr
print(json.dumps({'runtimeFiles':len(r['runtime']),'monitorExit':result.returncode}))
`;
const command = "sudo -n python3 -I -B -c '" + program.replaceAll("'", "'\\''") + "'";
const installed = JSON.parse(activityExec("ssh", ["-i", "/home/sixer/.ssh/proofofwork_node_ed25519", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=15", "powadmin@65.108.122.87", command], {
  input: JSON.stringify({ runtime: expectedRuntime, monitor: monitorHash }), encoding: "utf8", timeout: 90_000,
}));
const implementationCommit = identityGit("rev-parse","HEAD");
let lifecycle,retirementEvidence,currentPackageAttestation;
if(witnessedLifecycle) {
 lifecycle=witnessedLifecycle;retirementEvidence=witnessedLifecycle.retirementEvidence;
} else {
const packageAttestation=identityProof===undefined?undefined:attestInstalledRetentionPackage(identityProof);
if(identityProof===undefined) currentPackageAttestation=attestCurrentRetentionPackage({
 repository:fileURLToPath(new URL("../",import.meta.url)).replace(/\/$/u,""),
 commit:currentIdentity?.artifact.commit??implementationCommit,tree:currentIdentity?.artifact.tree??identityGit("rev-parse","HEAD^{tree}"),...(currentVerifierProof===undefined?{}:{currentVerifierProof})});
lifecycle = JSON.parse(activityExec("python3", [
  "-I", "-B", "deploy/ui-retention/lifecycle.py", "status", "--require-complete",
], { encoding: "utf8", timeout: 480_000, maxBuffer: 8 * 1024 ** 2 }));
if(packageAttestation)bindInstalledRetentionPackage(lifecycle,packageAttestation);
retirementEvidence=currentPackageAttestation?collectCurrentRetirementEvidence(lifecycle,currentPackageAttestation):
 lifecycle.verifiedRetiredPayloads ? collectRetirementEvidence(lifecycle) : undefined;
}
let commit=currentIdentity?.artifact.commit??implementationCommit;
if(identityProof!==undefined) {
 const proof=requireIdentityProof(identityProof);
 assert.equal(resolve(proof.repository),fileURLToPath(new URL("../",import.meta.url)).replace(/\/$/u,""));
 assert.equal(proof.operator.commit,implementationCommit);
 commit=proof.artifact.commit;
}
assert.equal(lifecycle.publicationHealthy, true);
assert.equal(lifecycle.retentionComplete, true);
assert(lifecycle.pair.current.startsWith(commit.slice(0, 12) + "-"));
// The rolling previous release may advance; the historical hold must remain verified.
if(currentPackageAttestation)validateCurrentRetainedHolds(lifecycle,retirementEvidence,currentPackageAttestation);
else validateRetainedHolds(lifecycle,retirementEvidence);
assert.deepEqual(lifecycle.unfinishedIntents, []);

assert.equal(lifecycle.verifiedCapacityFloor.rootReserveBytes, 8 * 1024 ** 3);
assert.equal(lifecycle.verifiedCapacityFloor.growthReserveBytes, 64 * 1024 ** 2);
// console.log(JSON.stringify({ ok: true: legacy assertion-block test boundary.
const result = { ok: true, height, hash, registryElapsedMs: registry.elapsedMs,
  walletElapsedMs: wallet.elapsedMs, ...installed, retentionComplete: true, pair: lifecycle.pair,
  scope: "stable-checkpoint reads, exact combined activity-reader runtime and completed UI lifecycle; transition measurements remain separate" };
if(lifecycleWitness!==undefined) result.lifecycleEvidence={mode:"same-collection-before-full-scan",finalIndependentFullScanRequired:true};
if(retirementEvidence) result.retirementReceiptSha256=lifecycle.verifiedRetiredPayloads.receiptSha256;
if(identityProof!==undefined) {
 assert.equal(identityGit("rev-parse","HEAD"),implementationCommit,"Implementation changed during live check");
 const after=createIdentityProof({repository:identityProof.repository});
 assert.deepEqual(after.operator,identityProof.operator);
 result.qualificationSubject={...identityProof.artifact};
}
if(currentVerifierProof!==undefined){validateCurrentVerifierProof(currentVerifierProof);result.compatibilityQualification=true;}
return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 console.log(JSON.stringify(await runActivityFeeFactorLive()));
}
