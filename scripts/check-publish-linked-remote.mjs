#!/usr/bin/env node
// Read-only remote loopback verification. The protected token never leaves the node.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { requireIdentityProof, publicIdentityProof } from "./release-identity-proof.mjs";

export const publishCheckerFiles = Object.freeze([
  "scripts/check-publish-linked-live.mjs", "src/shared/protocol/publishLinkedCapability.mjs",
  "src/shared/protocol/publishArticleMetadata.mjs",
  "src/shared/protocol/powcatLimits.mjs", "package.json", "package-lock.json",
]);
const sha = raw => createHash("sha256").update(raw).digest("hex");
// publish-linked-checker-closure-v1: exact reviewed dependency-free module bytes.
// Untracked local evidence is not an input. A future checker/module edit must
// explicitly review and update this contract, not expand runtime module resolution.
const reviewedCheckerModuleHashes = Object.freeze({
  "scripts/check-publish-linked-live.mjs": "6ee77c9cd9a7ea8467cf20f9930a18560f92a49fa9d4b2ad7e7c8968c48b5cd3",
  "src/shared/protocol/publishLinkedCapability.mjs": "317b5a053700b0b3a957a746f29ce4106cbce1d98beb7a3bd6d021fa0a88dcd5",
  "src/shared/protocol/publishArticleMetadata.mjs": "dfa44b1612c8ae6058b514067b891dbcc43dac0141369bd3041f4de7d49eddbc",
  "src/shared/protocol/powcatLimits.mjs": "d8c8d1b262961562a74ac50760a0ac0f66a68081cd82f98f9514c0419159562e",
});
export function assertPublishCheckerClosure(files) {
  assert.deepEqual([...files.keys()].filter(name => name.endsWith(".mjs")).sort(),
    Object.keys(reviewedCheckerModuleHashes).sort(), "Reviewed checker closure scope differs.");
  for (const [name, expected] of Object.entries(reviewedCheckerModuleHashes))
    assert.equal(sha(files.get(name)), expected, "Reviewed checker closure bytes differ: " + name);
}
function canonicalLocalFile(root, name) {
  const path = resolve(root, name);
  assert.equal(realpathSync(path), path, "Local checker path must not contain symlinks.");
  assert.ok(lstatSync(path).isFile(), "Local checker must be a regular file.");
  return readFileSync(path);
}
export function publicVerificationEnvironment(env) {
  const result = { ...env, GIT_OPTIONAL_LOCKS: "0" };
  for (const key of ["POW_INTERNAL_VERIFIER_TOKEN", "POW_PUBLISH_CHECK_ORIGIN",
    "POW_PUBLISH_CHECK_MODE", "POW_PUBLISH_CHECK_NODE_SOURCE"]) delete result[key];
  return result;
}
export function validateNodeBuildSource(value) {
  assert.equal(typeof value, "string", "Preactivation requires POW_PUBLISH_CHECK_NODE_SOURCE.");
  assert.match(value, /^\/data\/proofofwork-ui-builds\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/proofofwork-ui-source-[a-f0-9]{12}-[0-9]{8}T[0-9]{6}Z$/u,
    "Expected a canonical node build source checkout.");
  assert.equal(resolve(value), value);
  return value;
}
export function localPublishSource(root, env = process.env) {
  const options = { cwd: root, env: publicVerificationEnvironment(env), encoding: "utf8", timeout: 30_000 };
  const git = (...args) => execFileSync("git", args, options).trim();
  const commit = git("rev-parse", "HEAD"), tree = git("rev-parse", "HEAD^{tree}");
  assert.match(commit, /^[a-f0-9]{40}$/u); assert.match(tree, /^[a-f0-9]{40}$/u);
  assert.equal(realpathSync(root), resolve(root), "Local verification root must be canonical.");
  // Historical audit/working artifacts are not executable verification inputs.
  // Match release-sync's tracked-clean contract; bind the actual input closure below.
  assert.equal(git("status", "--porcelain", "--untracked-files=no"), "", "Local verification source must be clean.");
  const files = new Map();
  const hashes = Object.fromEntries(publishCheckerFiles.map(name => {
    const bytes = canonicalLocalFile(resolve(root), name);
    files.set(name, bytes);
    assert.deepEqual(bytes, execFileSync("git", ["show", commit + ":" + name], { ...options, encoding: undefined }), "Local checker file differs from commit.");
    return [name, sha(bytes)];
  }));
  assertPublishCheckerClosure(files);
  return { commit, tree, hashes };
}
export const remotePreactivationProgram = String.raw`
import hashlib,json,os,pathlib,pwd,re,stat,subprocess,sys
def need(value,message):
 if not value:raise ValueError(message)
def digest(raw):return hashlib.sha256(raw).hexdigest()
request=json.load(sys.stdin)
need(set(request)=={"source","commit","tree","hashes","unit"},"Wrong verification request")
need(re.fullmatch(r"[a-f0-9]{40}",request["commit"]) and re.fullmatch(r"[a-f0-9]{40}",request["tree"]),"Wrong source identity")
need(re.fullmatch(r"/data/proofofwork-ui-builds/[A-Za-z0-9][A-Za-z0-9._-]{0,127}/proofofwork-ui-source-[a-f0-9]{12}-[0-9]{8}T[0-9]{6}Z",request["source"]),"Unsafe source path")
source=pathlib.Path(request["source"])
need(source.resolve(strict=True)==source,"Source path is not canonical")
allowed_owners={0,pwd.getpwnam("powadmin").pw_uid}
for parent in (source,*source.parents):
 info=parent.lstat();need(stat.S_ISDIR(info.st_mode) and info.st_uid in allowed_owners and not info.st_mode&0o022,"Unsafe source ancestry")
files={"scripts/check-publish-linked-live.mjs","src/shared/protocol/publishLinkedCapability.mjs","src/shared/protocol/publishArticleMetadata.mjs","src/shared/protocol/powcatLimits.mjs","package.json","package-lock.json"}
need(set(request["hashes"])==files and all(re.fullmatch(r"[a-f0-9]{64}",h) for h in request["hashes"].values()),"Wrong checker closure")
unit=request["unit"];need(re.fullmatch(r"pow-linked-verify-[a-f0-9]{12}-[a-f0-9]{12}\.service",unit),"Unsafe unit")
environment={**os.environ,"GIT_OPTIONAL_LOCKS":"0"}
def git(*args):return subprocess.check_output(["git","-c","safe.directory="+str(source),"-C",str(source),*args],env=environment,text=True,timeout=30).strip()
def read(path):
 info=path.lstat();need(path.resolve(strict=True)==path and stat.S_ISREG(info.st_mode) and info.st_uid in allowed_owners and info.st_nlink==1 and not info.st_mode&0o022 and info.st_size<8*1024**2,"Unsafe source file")
 raw=path.read_bytes();after=path.lstat();need((info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),"Source changed")
 return raw
receipt_raw=read(source.parent/"build-receipt.json");receipt=json.loads(receipt_raw)
need(receipt["sourceCheckout"]==str(source) and receipt["commit"]==request["commit"] and receipt["tree"]==request["tree"],"Build receipt identity differs")
def fence():
 need(git("rev-parse","HEAD")==request["commit"] and git("rev-parse","HEAD^{tree}")==request["tree"] and not git("status","--porcelain","--untracked-files=all"),"Remote checkout identity or cleanliness differs")
 for name,expected in request["hashes"].items():need(digest(read(source/name))==expected,"Remote checker closure differs")
fence()
before=subprocess.run(["systemctl","show",unit,"-p","LoadState","-p","MainPID"],capture_output=True,text=True,timeout=15)
need("LoadState=not-found" in before.stdout and "MainPID=0" in before.stdout,"Existing verification unit requires reconciliation")
argv=["systemd-run","--unit="+unit,"--wait","--collect","--pipe","--property=CPUQuota=100%","--property=MemoryMax=256M","--property=MemorySwapMax=0","--property=RuntimeMaxSec=300","--property=NoNewPrivileges=yes","--property=PrivateTmp=yes","--property=ProtectSystem=strict","--property=EnvironmentFile=/etc/proofofwork-api/internal-verifier.env","--property=UnsetEnvironment=NODE_OPTIONS NODE_PATH","--setenv=GIT_OPTIONAL_LOCKS=0","--setenv=POW_PUBLISH_CHECK_MODE=preactivation","--setenv=POW_PUBLISH_CHECK_ORIGIN=http://127.0.0.1:8081","/opt/node-v24.18.0-linux-x64/bin/node",str(source/"scripts/check-publish-linked-live.mjs")]
try:result=subprocess.run(argv,capture_output=True,env=environment,timeout=330)
except subprocess.TimeoutExpired:
 print(json.dumps({"ok":False,"outcome":"uncertain","unit":unit,"message":"Reconcile this bounded verification unit before retrying."}));sys.exit(1)
terminal=subprocess.check_output(["systemctl","show",unit,"-p","LoadState","-p","ActiveState","-p","MainPID"],text=True,timeout=15)
absent=not (pathlib.Path("/sys/fs/cgroup/system.slice")/unit).exists()
need("MainPID=0" in terminal and "ActiveState=inactive" in terminal and absent,"Verification unit not confirmed stopped; reconcile before retry")
need(result.returncode==0,"Unchanged publish checker failed")
need(len(result.stdout)<=2*1024**2,"Checker output too large")
raw=result.stdout.decode();value=json.loads(raw)
need(value.get("mode")=="preactivation" and not value.get("error") and value.get("newLinkedWriteVerified") is False,"Preactivation failed")
fence();need(read(source.parent/"build-receipt.json")==receipt_raw,"Build receipt changed")
print(json.dumps({"format":"publish-linked-remote-preactivation-v1","ok":True,"commit":request["commit"],"tree":request["tree"],"source":str(source),"checkerHashes":request["hashes"],"buildReceiptSha256":digest(receipt_raw),"unit":unit,"exitCode":result.returncode,"terminal":terminal,"cgroupAbsent":absent,"rawResult":raw,"rawResultSha256":digest(result.stdout),"noTokenTransferred":True,"productionMutation":False},sort_keys=True))
`;
export function runRemotePublishPreactivation({
  env = process.env, root = fileURLToPath(new URL("../", import.meta.url)),
  identityProof, collect = localPublishSource, run = spawnSync, nonce = () => randomUUID().replaceAll("-", "").slice(0, 12),
} = {}) {
  assert.equal(env.POW_PUBLISH_CHECK_MODE, "preactivation");
  assert.ok(!env.POW_INTERNAL_VERIFIER_TOKEN && !env.POW_PUBLISH_CHECK_ORIGIN,
    "Remote preactivation uses only the protected node environment, not local token/origin overrides.");
  const source = validateNodeBuildSource(env.POW_PUBLISH_CHECK_NODE_SOURCE);
  const proof = identityProof === undefined ? undefined : requireIdentityProof(identityProof);
  if (proof) assert.equal(realpathSync(root), proof.repository, "Identity proof repository differs from local verification source.");
  // Typed collection cannot inherit Git redirection, replacements or executable status hooks.
  const collectionEnv = proof ? { PATH: "/usr/bin:/bin", GIT_NO_REPLACE_OBJECTS: "1",
    GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.fsmonitor", GIT_CONFIG_VALUE_0: "false",
    GIT_CONFIG_KEY_1: "core.untrackedCache", GIT_CONFIG_VALUE_1: "false" } : env;
  const binding = collect(root, collectionEnv);
  if (proof) assert.deepEqual({ commit: binding.commit, tree: binding.tree }, proof.operator,
    "Local verification source differs from proof operator.");
  // Keep the sealed artifact receipt honest; only the outer wrapper names newer tooling.
  const remoteBinding = proof ? { ...binding, commit: proof.artifact.commit, tree: proof.artifact.tree } : binding;
  const unit = "pow-linked-verify-" + binding.commit.slice(0, 12) + "-" + nonce() + ".service";
  assert.match(unit, /^pow-linked-verify-[a-f0-9]{12}-[a-f0-9]{12}\.service$/u);
  const request = { source, ...remoteBinding, unit };
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const args = ["-i", "/home/sixer/.ssh/proofofwork_node_ed25519", "-o", "BatchMode=yes",
    "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=15",
    "powadmin@65.108.122.87", "sudo -n /usr/bin/python3 -I -B -c " + quote(remotePreactivationProgram)];
  const result = run("ssh", args, { input: JSON.stringify(request), encoding: "utf8",
    env: proof ? { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0" } : publicVerificationEnvironment(env), timeout: 360_000, maxBuffer: 2 * 1024 ** 2 });
  if (result.error || result.signal || result.status !== 0)
    throw new Error("Remote preactivation failed or is uncertain; reconcile " + unit + " before retrying.");
  const value = JSON.parse(result.stdout);
  assert.equal(value.format, "publish-linked-remote-preactivation-v1"); assert.equal(value.ok, true);
  assert.equal(value.commit, remoteBinding.commit); assert.equal(value.tree, remoteBinding.tree); assert.equal(value.source, source);
  assert.deepEqual(value.checkerHashes, binding.hashes); assert.equal(value.unit, unit);
  assert.equal(value.exitCode, 0); assert.equal(value.cgroupAbsent, true);
  assert.equal(value.noTokenTransferred, true); assert.equal(value.productionMutation, false);
  assert.equal(sha(value.rawResult), value.rawResultSha256);
  const raw = JSON.parse(value.rawResult);
  assert.equal(raw.mode, "preactivation"); assert.equal(raw.newLinkedWriteVerified, false); assert.ok(!raw.error);
  for (const name of ["disabled-writer reader/indexer/Search/capacity readiness", "public writer remains disabled", "complete article feed"])
    assert.equal(raw.checks?.find(check => check.name === name)?.pass, true, name);
  assert.deepEqual(collect(root, collectionEnv), binding, "Local source changed during remote verification.");
  if (proof) {
    requireIdentityProof(proof);
    const { baselineOperator, artifact, operator } = publicIdentityProof(proof);
    return { format: "publish-linked-dual-preactivation-v1", baselineOperator, artifact, operator, remoteReceipt: value };
  }
  return value;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(runRemotePublishPreactivation())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
