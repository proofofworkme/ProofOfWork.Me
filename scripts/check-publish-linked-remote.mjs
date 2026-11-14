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

CHECK_NAMES=("disabled-writer reader/indexer/Search/capacity readiness","public writer remains disabled","complete article feed","existing article exact body","existing article detail")
ERROR_CODES={"Disabled-writer preactivation readiness is not fully verified.":"READINESS_NOT_VERIFIED","Writer must remain disabled after preactivation.":"WRITER_NOT_DISABLED","Article feed is incomplete":"ARTICLE_FEED_INCOMPLETE","Existing article detail proof mismatch":"ARTICLE_DETAIL_MISMATCH","Response bound exceeded":"RESPONSE_BOUND_EXCEEDED"}
def sanitize_failure(stdout,overflow=False):
 out={"stdoutStatus":"missing","checks":[],"unknownCheckCount":0,"checkerCode":"UNCLASSIFIED","httpStatus":None}
 if overflow or len(stdout)>2*1024**2:out["stdoutStatus"]="oversized";return out,None
 if not stdout:return out,None
 def unique(rows):
  value={}
  for key,item in rows:
   if key in value:raise ValueError("duplicate")
   value[key]=item
  return value
 try:
  value=json.loads(stdout.decode("utf8"),object_pairs_hook=unique)
  if not isinstance(value,dict) or value.get("mode")!="preactivation" or value.get("newLinkedWriteVerified") is not False:raise ValueError("shape")
  checks=value.get("checks")
  if not isinstance(checks,list) or len(checks)>8:raise ValueError("checks")
  seen=set();safe=[];unknown=0
  for row in checks:
   if not isinstance(row,dict) or not isinstance(row.get("name"),str) or (row.get("pass") is not None and type(row.get("pass")) is not bool) or "pass" not in row:raise ValueError("check")
   name=row["name"]
   if name in seen:raise ValueError("duplicate check")
   seen.add(name)
   if name in CHECK_NAMES:safe.append({"name":name,"pass":row["pass"]})
   else:unknown+=1
  error=value.get("error")
  out.update(stdoutStatus="valid",checks=safe,unknownCheckCount=unknown)
  if isinstance(error,str):
   out["checkerCode"]=ERROR_CODES.get(error,"UNCLASSIFIED")
   match=re.fullmatch(r"Read unavailable: ([1-5][0-9]{2})",error)
   if match:out.update(checkerCode="HTTP_UNAVAILABLE",httpStatus=int(match[1]))
  return out,value
 except (ValueError,TypeError,UnicodeError,RecursionError):
  out.update(stdoutStatus="invalid",checks=[],unknownCheckCount=0)
  return out,None

def capture_probe(args,env,timeout=330):
 # No raw stderr is collected. Stdout memory stays bounded even for hostile output.
 import selectors,time
 process=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env)
 selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ)
 chunks=[];size=0;overflow=False;timed_out=False;deadline=time.monotonic()+timeout
 try:
  while selector.get_map():
   remaining=deadline-time.monotonic()
   if remaining<=0:timed_out=True;break
   for key,_ in selector.select(min(remaining,0.2)):
    chunk=os.read(key.fileobj.fileno(),65536)
    if not chunk:selector.unregister(key.fileobj);continue
    keep=min(len(chunk),max(0,2*1024**2-size))
    if keep:chunks.append(chunk[:keep])
    size+=keep
    if keep<len(chunk):overflow=True
  if not timed_out:
   try:process.wait(timeout=max(0.001,deadline-time.monotonic()))
   except subprocess.TimeoutExpired:timed_out=True
  if timed_out:
   process.kill()
   try:process.wait(timeout=5)
   except subprocess.TimeoutExpired:pass
 finally:selector.close();process.stdout.close()
 return process.returncode,b"".join(chunks),overflow,timed_out

def terminal_state():
 state={"loadState":"unknown","activeState":"unknown","mainPid":None,"cgroupAbsent":False,"verified":False}
 try:
  text=subprocess.check_output(["systemctl","show",unit,"-p","LoadState","-p","ActiveState","-p","MainPID"],text=True,stderr=subprocess.DEVNULL,timeout=15)
  values=dict(line.split("=",1) for line in text.splitlines())
  state["loadState"]=values.get("LoadState") if values.get("LoadState") in ("loaded","not-found","masked","error","stub") else "unknown"
  state["activeState"]=values.get("ActiveState") if values.get("ActiveState") in ("active","inactive","failed","activating","deactivating","reloading") else "unknown"
  pid=values.get("MainPID","")
  if re.fullmatch(r"[0-9]{1,10}",pid):state["mainPid"]=int(pid)
  state["cgroupAbsent"]=not (pathlib.Path("/sys/fs/cgroup/system.slice")/unit).exists()
  state["verified"]=state["mainPid"]==0 and state["activeState"]=="inactive" and state["cgroupAbsent"]
 except (OSError,ValueError,subprocess.SubprocessError):pass
 return state

try:exit_code,stdout,overflow,timed_out=capture_probe(argv,environment)
except OSError:exit_code,stdout,overflow,timed_out=None,b"",False,False
terminal_info=terminal_state()
safe,value=sanitize_failure(stdout,overflow)
# Do not spend the remaining transport deadline re-fencing a failed probe.
# False here means NOT VERIFIED, never a claim that source necessarily changed.
source_ok=False
code=None
if timed_out:code="PROBE_TIMEOUT"
elif not terminal_info["verified"]:code="TERMINAL_UNVERIFIED"
elif safe["stdoutStatus"]!="valid":code="CHECKER_OUTPUT_"+safe["stdoutStatus"].upper()
elif exit_code!=0:code=safe["checkerCode"] if safe["checkerCode"]!="UNCLASSIFIED" else "CHILD_EXIT_NONZERO"
elif value.get("error"):code=safe["checkerCode"] if safe["checkerCode"]!="UNCLASSIFIED" else "CHECKER_REPORTED_ERROR"
if code is None:
 try:fence();need(read(source.parent/"build-receipt.json")==receipt_raw,"Build receipt changed");source_ok=True
 except Exception:code="SOURCE_FENCE_FAILED"
if code:
 print(json.dumps({"format":"publish-linked-remote-failure-v1","ok":False,"unit":unit,"commit":request["commit"],"tree":request["tree"],"source":str(source),"outcome":"failed" if terminal_info["verified"] else "uncertain","code":code,"checkerExitCode":exit_code,"terminal":terminal_info,"checks":safe["checks"],"unknownCheckCount":safe["unknownCheckCount"],"stdoutStatus":safe["stdoutStatus"],"httpStatus":safe["httpStatus"],"sourceFenceVerified":source_ok},sort_keys=True,separators=(",",":")));sys.exit(1)
raw=stdout.decode();terminal="LoadState="+terminal_info["loadState"]+"\nActiveState="+terminal_info["activeState"]+"\nMainPID="+str(terminal_info["mainPid"])+"\n"
absent=terminal_info["cgroupAbsent"]
print(json.dumps({"format":"publish-linked-remote-preactivation-v1","ok":True,"commit":request["commit"],"tree":request["tree"],"source":str(source),"checkerHashes":request["hashes"],"buildReceiptSha256":digest(receipt_raw),"unit":unit,"exitCode":exit_code,"terminal":terminal,"cgroupAbsent":absent,"rawResult":raw,"rawResultSha256":digest(stdout),"noTokenTransferred":True,"productionMutation":False},sort_keys=True))
`;

const diagnosticChecks = Object.freeze(["disabled-writer reader/indexer/Search/capacity readiness","public writer remains disabled","complete article feed","existing article exact body","existing article detail"]);
const diagnosticCodes = new Set(["PROBE_TIMEOUT","TERMINAL_UNVERIFIED","SOURCE_FENCE_FAILED","CHECKER_OUTPUT_MISSING","CHECKER_OUTPUT_INVALID","CHECKER_OUTPUT_OVERSIZED","CHILD_EXIT_NONZERO","CHECKER_REPORTED_ERROR","READINESS_NOT_VERIFIED","WRITER_NOT_DISABLED","ARTICLE_FEED_INCOMPLETE","ARTICLE_DETAIL_MISMATCH","RESPONSE_BOUND_EXCEEDED","HTTP_UNAVAILABLE"]);
const keysExactly = (value, keys) => {
  assert(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
};
const canonicalDiagnostic = value => JSON.stringify(value, function(_key, item) {
  return item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item;
});
export function validateRemoteFailure(raw, expected) {
  assert.equal(typeof raw, "string"); assert(Buffer.byteLength(raw) <= 16384);
  const value=JSON.parse(raw);
  // The node emits canonical JSON. This also rejects duplicate/escaped property aliases.
  assert.equal(raw.trim(),canonicalDiagnostic(value));
  keysExactly(value,["format","ok","unit","commit","tree","source","outcome","code","checkerExitCode","terminal","checks","unknownCheckCount","stdoutStatus","httpStatus","sourceFenceVerified"]);
  assert.equal(value.format,"publish-linked-remote-failure-v1");assert.equal(value.ok,false);
  for(const key of ["unit","commit","tree","source"])assert.equal(value[key],expected[key]);
  assert(diagnosticCodes.has(value.code));
  assert(value.checkerExitCode===null || Number.isInteger(value.checkerExitCode)&&value.checkerExitCode>=-64&&value.checkerExitCode<=255);
  assert(["valid","invalid","missing","oversized"].includes(value.stdoutStatus));
  assert(value.httpStatus===null || Number.isInteger(value.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599);
  assert.equal(typeof value.sourceFenceVerified,"boolean");
  keysExactly(value.terminal,["loadState","activeState","mainPid","cgroupAbsent","verified"]);
  const terminal=value.terminal;
  assert(["loaded","not-found","masked","error","stub","unknown"].includes(terminal.loadState));
  assert(["active","inactive","failed","activating","deactivating","reloading","unknown"].includes(terminal.activeState));
  assert(terminal.mainPid===null || Number.isInteger(terminal.mainPid)&&terminal.mainPid>=0&&terminal.mainPid<=9999999999);
  assert.equal(typeof terminal.cgroupAbsent,"boolean");assert.equal(typeof terminal.verified,"boolean");
  assert.equal(terminal.verified,terminal.mainPid===0&&terminal.activeState==="inactive"&&terminal.cgroupAbsent);
  assert.equal(value.outcome,terminal.verified?"failed":"uncertain");
  assert(Array.isArray(value.checks)&&value.checks.length<=diagnosticChecks.length);
  const seen=new Set();
  for(const check of value.checks){keysExactly(check,["name","pass"]);assert(diagnosticChecks.includes(check.name)&&!seen.has(check.name));seen.add(check.name);assert(check.pass===null||typeof check.pass==="boolean");}
  assert(Number.isInteger(value.unknownCheckCount)&&value.unknownCheckCount>=0&&value.unknownCheckCount<=8);
  return value;
}
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
  // Only a complete validated failure envelope may improve a nonzero-exit report.
  // Transport errors/truncation remain uncertain; never expose arbitrary SSH stderr.
  if (!result.error && !result.signal && result.status === 1) {
    let diagnostic;
    try { diagnostic=validateRemoteFailure(result.stdout,{unit,commit:remoteBinding.commit,tree:remoteBinding.tree,source}); } catch {}
    if (diagnostic) {
      const error=new Error("Remote preactivation failed; reconcile " + unit + " before retrying. Safe diagnostic: " + JSON.stringify(diagnostic));
      error.name="RemotePreactivationFailure";error.diagnostic=diagnostic;throw error;
    }
  }
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
