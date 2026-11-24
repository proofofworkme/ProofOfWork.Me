#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { isBuiltin } from "node:module";
import { isDeepStrictEqual as equal } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Transaction } from "bitcoinjs-lib";
import pg from "pg";
import { exactTip, hydrateRawTransaction } from "../work-batch-activation/probe.mjs";
import { boundedJsonResponse, readDatabaseIdentity as bindPeerSession, RESOURCE_LIMITS } from "../work-batch-replay/preflight.mjs";
import { assertNativeTransitionStorageContract } from "../../server/db/native-transition-storage.mjs";
import { MAX_GOVERNED_ROWS_PER_BLOCK, GOVERNED_RELATIONAL_BINDINGS_SQL, readRelationalEvidence } from "./relations.mjs";
import { DECLARATION_PINS, qualifyExpandedLiquidityReplay, verifyReplayDeclaration } from "./qualify.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
const baselineCommit = "2084747c3f8c2a9928b0698254641b312edf1d1d";
const firstCandidate = "9c77adea1bc3860828b0c2556b717803df1811c7";
const rawReplay = "server/work-amo-v5-raw.mjs";
// These consumers authenticate the selected and original native generations.
const runtimeEntries = [rawReplay, "server/db/native-transition-storage.mjs", "server/db/permission-reader.mjs",
  "server/db/work-batch-reader.mjs", "server/db/work-mail-batch-reader.mjs"];
const activeRoot = "/opt/proofofwork-api";
const format = "work-amo-expanded-liquidity-replay-sources-v1";
const sha = data => createHash("sha256").update(data).digest("hex");
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
function check(condition, code) { if (!condition) throw new Error(code); }
const digest = data => sha(JSON.stringify(data));
const sorted = map => Object.fromEntries([...map.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));

function regularBytes(file, maximum) {
  check(path.isAbsolute(file) && fs.realpathSync(file) === file, "source path is not canonical");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    check(before.isFile() && before.size <= BigInt(maximum), "source file exceeds bound");
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    check(BigInt(bytes.length) === before.size && after.ctimeNs === before.ctimeNs &&
      after.ino === fs.lstatSync(file, { bigint: true }).ino, "source changed while reading");
    return bytes;
  } finally { fs.closeSync(fd); }
}
const git = (...args) => execFileSync("/usr/bin/git", ["--no-optional-locks", "--no-replace-objects", "-C", repository, ...args],
  { timeout: 20000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const revision = ref => git("rev-parse", "--verify", ref).toString().trim();
function gitDigest(ref, name) {
  if (!git("ls-tree", ref, "--", name).length) return null;
  return sha(git("show", ref + ":" + name));
}

const dependencyCache = new Map();
function staticSpecifiers(bytes, id) {
  if (!dependencyCache.has(id)) {
    // Ask Node's own ES module parser for static imports/re-exports without
    // executing either stage. Scope admits no dynamic module resolution.
    check(!/\b(?:require|import)(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*\(/u.test(bytes.toString("utf8")),
      "dynamic module dependency outside replay scope");
    const probe = "const vm=require('node:vm'),fs=require('node:fs');" +
      "process.stdout.write(JSON.stringify(new vm.SourceTextModule(fs.readFileSync(0,'utf8')).dependencySpecifiers))";
    const raw = execFileSync(process.execPath, ["--experimental-vm-modules","-e",probe], {
      input:bytes, timeout:10000, maxBuffer:1024*1024, env:{}, stdio:["pipe","pipe","pipe"],
    });
    dependencyCache.set(id, JSON.parse(raw));
  }
  return dependencyCache.get(id);
}
export function sourceClosure(root, entry) {
  const files = new Map(), imports = new Map(), pending = Array.isArray(entry) ? [...entry] : [entry];
  while (pending.length) {
    const name = pending.pop();
    if (files.has(name)) continue;
    check(files.size < 256 && !name.startsWith("..") && !path.isAbsolute(name), "source closure invalid");
    const bytes = regularBytes(path.join(root, name), 4 * 1024 * 1024);
    const id = sha(bytes);
    files.set(name, id);
    for (const specifier of staticSpecifiers(bytes, id)) {
      if (isBuiltin(specifier)) continue;
      if (specifier.startsWith(".")) {
        check(specifier.endsWith(".mjs") && !/[%?#\\]/u.test(specifier), "unexpected first-party dependency");
        pending.push(path.normalize(path.join(path.dirname(name), specifier)));
      } else {
        check(["bitcoinjs-lib", "@bitcoinerlab/secp256k1"].includes(specifier), "unexpected external replay import");
        imports.set(name + ":" + specifier, [path.dirname(path.join(root, name)), specifier]);
      }
    }
  }
  return { files, imports };
}

// Hash installed bytes, including both ESM/CJS entrypoints and transitive packages.
// A lockfile alone cannot identify a modified installed module.
function packageRoot(directory, name) {
  check(/^(?:@[a-z0-9][-a-z0-9.]*\/)?[a-z0-9][-a-z0-9.]*$/u.test(name), "invalid dependency name");
  for (let current = directory;; current = path.dirname(current)) {
    const dir = path.join(current, "node_modules", name);
    if (fs.existsSync(path.join(dir, "package.json"))) return fs.realpathSync(dir);
    if (current === path.dirname(current)) return null;
  }
}
export function installedDependencies(requests) {
  const packages = new Map(), resolved = new Map();
  let count = 0, bytes = 0;
  function visit(dir) {
    if (packages.has(dir)) return;
    check(packages.size < 128, "installed dependency count exceeds bound");
    const pkg = JSON.parse(regularBytes(path.join(dir, "package.json"), 1024 * 1024));
    const files = new Map();
    function walk(subdir) {
      for (const item of fs.readdirSync(path.join(dir, subdir), { withFileTypes: true })) {
        if (item.name === "node_modules") continue;
        const relative = path.join(subdir, item.name);
        if (item.isDirectory()) walk(relative);
        else {
          check(item.isFile() && ++count <= 20000, "invalid installed dependency file");
          const data = regularBytes(path.join(dir, relative), 32 * 1024 * 1024);
          bytes += data.length;
          check(bytes <= 256 * 1024 * 1024, "installed dependency byte ceiling");
          files.set(relative, sha(data));
        }
      }
    }
    walk("");
    packages.set(dir, digest(sorted(files)));
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies }).sort()) {
      const resolvedDir = packageRoot(dir, name);
      if (resolvedDir) visit(resolvedDir);
      else check(pkg.optionalDependencies?.[name] || pkg.peerDependenciesMeta?.[name]?.optional === true, "installed dependency missing");
      resolved.set(path.join(dir, "node_modules", name), resolvedDir);
    }
  }
  for (const [source, name] of requests) {
    const dir = packageRoot(source, name);
    check(dir, "replay package unavailable");
    visit(dir);
    resolved.set(path.join(source, "node_modules", name), dir);
  }
  return digest({ packages: sorted(packages), resolutions: sorted(resolved) });
}

export function checkComposition(entry) {
  const { base, repositoryCandidate, active, composed } = entry;
  if (entry.activeLoaded === false && entry.composedLoaded === true && active === null && hash(base)) {
    check(hash(repositoryCandidate) && composed === repositoryCandidate, "newly imported tracked source differs");
    return;
  }
  if (base === null && repositoryCandidate === null) {
    check(hash(active) && active === composed, "untracked overlay changed");
    return;
  }
  if (base === null) {
    check(active === null && hash(repositoryCandidate) && composed === repositoryCandidate, "new source composition differs");
    return;
  }
  check([base, repositoryCandidate, active, composed].every(hash), "source provenance incomplete");
  if (active === base) check(composed === repositoryCandidate, "candidate changed without an active overlay");
  else if (base === repositoryCandidate) check(composed === active, "unchanged active overlay not preserved");
  else check(composed !== active, "candidate delta missing in composed source");
}

// Inspect only emits a proposal. Qualification additionally requires the independently
// reviewed digest of this exact manifest, including every four-way file identity.
export function inspectSources(baselineRoot, candidateRoot, sourceCommit, sourceTree) {
  check(!process.env.NODE_OPTIONS && !process.env.NODE_PATH && !process.execArgv.length &&
    !Object.keys(process.env).some(key => /^(?:GIT_(?:DIR|WORK_TREE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|REPLACE_REF_BASE|CONFIG.*)|LD_PRELOAD)$/u.test(key)),
    "source verification requires an unmodified Node and Git environment");
  check([sourceCommit, sourceTree].every(value => /^[0-9a-f]{40}$/u.test(value)), "committed source pins required");
  check(revision("HEAD") === sourceCommit && revision("HEAD^{tree}") === sourceTree, "qualifier checkout differs");
  git("merge-base", "--is-ancestor", firstCandidate, sourceCommit);
  check(!git("status", "--porcelain", "--untracked-files=no").length, "qualifier checkout has tracked changes");
  for (const root of [candidateRoot, baselineRoot]) {
    check(path.isAbsolute(root) && fs.realpathSync(root) === root && fs.statSync(root).isDirectory(), "canonical module root required");
  }
  check(new Set([baselineRoot, candidateRoot, activeRoot]).size === 3, "retained stages must be distinct from live root");
  const active = sourceClosure(baselineRoot, runtimeEntries), composed = sourceClosure(candidateRoot, runtimeEntries);
  const verifierClosure = sourceClosure(repository, runtimeEntries);
  const paths = [...new Set([...active.files.keys(), ...composed.files.keys(), "package.json"])].sort();
  const files = {};
  for (const name of paths) {
    const get = (closure, root) => {
      if (closure.files.has(name)) return closure.files.get(name);
      return fs.existsSync(path.join(root, name)) ? sha(regularBytes(path.join(root, name), 4 * 1024 * 1024)) : null;
    };
    const entry = { base: gitDigest(baselineCommit, name), repositoryCandidate: gitDigest(sourceCommit, name),
      active: get(active, baselineRoot), composed: get(composed, candidateRoot),
      activeLoaded: name === "package.json" || active.files.has(name), composedLoaded: name === "package.json" || composed.files.has(name) };
    checkComposition(entry);
    if (entry.base && entry.active && entry.repositoryCandidate !== entry.base && entry.active !== entry.base) {
      // Supply the committed Git base via an anonymous in-memory file. -p writes
      // the merge to stdout. Conflicts cannot qualify through a new manifest.
      const merge = "import os,sys; f=os.memfd_create('amo-base',0); b=sys.stdin.buffer.read(); " +
        "w=os.fdopen(os.dup(f),'wb'); w.write(b); w.close(); os.lseek(f,0,0); os.set_inheritable(f,True); " +
        "os.execv('/usr/bin/git',['git','merge-file','-p',sys.argv[1],'/proc/self/fd/'+str(f),sys.argv[2]])";
      const merged = execFileSync("/usr/bin/python3", ["-I", "-c", merge, path.join(baselineRoot, name), path.join(repository, name)],
        { input: git("show", baselineCommit + ":" + name), timeout: 20000, maxBuffer: 8 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
      check(sha(merged) === entry.composed, "composed source differs from clean three-way merge");
    }
    files[name] = entry;
  }
  // Bind the committed qualifier and its SQL/storage/validation helpers as well.
  const verifierFiles = ["deploy/amo-expanded-liquidity-replay/preflight.mjs", "deploy/amo-expanded-liquidity-replay/qualify.mjs",
    "deploy/work-batch-activation/probe.mjs", "deploy/work-batch-replay/preflight.mjs", "server/db/native-transition-storage.mjs",
    "deploy/amo-expanded-liquidity-replay/publish-cli.mjs", "deploy/amo-expanded-liquidity-replay/publish.mjs",
    "deploy/amo-expanded-liquidity-replay/records.mjs", "deploy/amo-expanded-liquidity-replay/relations.mjs",
    "deploy/amo-expanded-liquidity-replay/native-witnesses.sql", "deploy/amo-expanded-liquidity-replay/storage.mjs", "deploy/amo-expanded-liquidity-replay/extension.sql",
    "deploy/amo-expanded-liquidity-replay/publish.sql", "deploy/work-batch-replay/catalog-after.json", ...verifierClosure.files.keys(),
    ...sourceClosure(repository, "server/work-amo-expanded-liquidity.mjs").files.keys()];
  const verifier = {};
  for (const name of new Set(verifierFiles)) {
    verifier[name] = sha(regularBytes(path.join(repository, name), 4 * 1024 * 1024));
    check(verifier[name] === gitDigest(sourceCommit, name), "qualifier helper differs from committed source");
  }
  const requests = [...active.imports.values(), ...composed.imports.values(),
    ...verifierClosure.imports.values(), [path.dirname(fileURLToPath(import.meta.url)), "pg"]];
  const locks = [repository, baselineRoot, candidateRoot].map(root => ({
    lock: sha(regularBytes(path.join(root, "package-lock.json"), 8 * 1024 * 1024)),
    installed: sha(regularBytes(fs.realpathSync(path.join(root, "node_modules/.package-lock.json")), 8 * 1024 * 1024)),
  }));
  return { format, activeRoot, baselineCommit, sourceCommit, sourceTree, baselineRoot, candidateRoot, files, verifier,
    dependencySha256: digest({ locks, node: sha(regularBytes(fs.realpathSync(process.execPath), 256 * 1024 * 1024)),
      versions: process.versions, installed: installedDependencies(requests) }) };
}

function matchInstalledSource(m, phase) {
  const actual = sourceClosure(activeRoot, runtimeEntries);
  actual.files.set("package.json", sha(regularBytes(path.join(activeRoot, "package.json"), 1024 * 1024)));
  const expected = Object.entries(m.files).filter(([, e]) => e[phase + "Loaded"]);
  check(actual.files.size === expected.length && expected.every(([name, e]) => actual.files.get(name) === e[phase]),
    "installed replay source differs from reviewed stage");
  const stage = phase === "active" ? m.baselineRoot : m.candidateRoot;
  check(fs.realpathSync(path.join(stage, "node_modules")) === fs.realpathSync(path.join(activeRoot, "node_modules")) &&
    sha(regularBytes(path.join(stage, "package-lock.json"), 8 * 1024 * 1024)) ===
    sha(regularBytes(path.join(activeRoot, "package-lock.json"), 8 * 1024 * 1024)), "installed dependency source differs from stage");
  for (const [name, [, pkg]] of actual.imports) {
    const parent = path.dirname(name.slice(0, name.lastIndexOf(":")));
    check(packageRoot(path.join(activeRoot, parent), pkg) === packageRoot(path.join(stage, parent), pkg), "runtime dependency resolution differs");
  }
}

function reviewedManifest(file, expectedSha) {
  check(hash(expectedSha), "independently reviewed source-manifest SHA-256 required");
  const bytes = regularBytes(file, 2 * 1024 * 1024);
  check(sha(bytes) === expectedSha, "source manifest digest differs");
  const m = JSON.parse(bytes);
  check(m.activeRoot === activeRoot && m.format === format, "unexpected runtime or source format");
  return m;
}
function observedBinding(m, expectedSha, phase) {
  check(["active", "composed"].includes(phase), "explicit installed source phase required");
  const observed = inspectSources(m.baselineRoot, m.candidateRoot, m.sourceCommit, m.sourceTree);
  check(equal(observed, m), "retained sources differ from reviewed composition");
  matchInstalledSource(m, phase);
  return { sourceCommit: m.sourceCommit, sourceTree: m.sourceTree, baselineCommit, sourceManifestSha256: expectedSha,
    baselineSourceSha256: digest(Object.entries(m.files).map(([name, e]) => [name, e.active])),
    candidateSourceSha256: digest(Object.entries(m.files).map(([name, e]) => [name, e.composed])),
    dependencySha256: m.dependencySha256 };
}
export function verifySourceBinding(file, expectedSha, expectedBinding, phase) {
  return equal(observedBinding(reviewedManifest(file, expectedSha), expectedSha, phase), expectedBinding);
}
export async function openSources(file, expectedSha) {
  const m = reviewedManifest(file, expectedSha);
  const readBinding = () => observedBinding(reviewedManifest(file, expectedSha), expectedSha, "active");
  const binding = readBinding();
  const [baselineRaw, candidateRaw] = await Promise.all([m.baselineRoot, m.candidateRoot].map(root => import(pathToFileURL(path.join(root, rawReplay)).href)));
  check(equal(readBinding(), binding), "source changed during module load");
  return { binding, readBinding, baselineRaw, candidateRaw };
}

const scalarColumns = ["network", "block_height", "block_hash", "previous_block_hash", "model", "state_commitment_model",
  "work_token_state_model", "opening_network_value_q8", "closing_network_value_q8", "opening_state_sha256", "closing_state_sha256",
  "opening_state_payload_bytes", "closing_state_payload_bytes", "protocol_record_count", "raw_protocol_candidate_count",
  "transaction_count", "event_count", "event_set_model", "event_set_sha256", "event_set_payload_bytes",
  "block_atomic", "fee_once", "invalid_zero", "complete"];
const HEADER = "SELECT " + scalarColumns.map(name => "t." + name).join(",") +
  ",jsonb_build_object('__powNativeStorage',jsonb_build_object('model',t.payload#>>'{__powNativeStorage,model}'," +
  "'sha256',t.payload#>>'{__powNativeStorage,sha256}')) AS payload," +
  " encode(sha256(jsonb_send(to_jsonb(t))),'hex') AS current_main_row_sha256," +
  " a.payload->>'bytes' AS native_bytes,a.payload->>'sha256' AS native_sha256 FROM proof_indexer.work_amo_block_transitions t" +
  " JOIN proof_indexer.blocks b ON b.network=t.network AND b.height=t.block_height AND b.block_hash=t.block_hash AND b.canonical" +
  " JOIN proof_indexer.work_transition_archive_v1 a ON a.network=t.network AND a.block_height=t.block_height AND a.block_hash=t.block_hash" +
  " WHERE t.network='livenet' AND t.block_height=$1 AND t.block_hash=$2 AND t.payload ? '__powNativeStorage'";
const one = async (client, sql, values = []) => {
  const result = await client.query(sql, values);
  check(result.rows.length === 1, "expected one evidence row");
  return result.rows[0];
};
// The API role supplies its own backend stamp. A local postgres peer must see
// that exact live connection before its cluster identifier can be trusted.
const peerIdentitySql = api => {
  check(Number.isSafeInteger(api.backend_pid) && api.backend_pid > 0, "invalid backend PID");
  return "SELECT json_build_object('databaseName',current_database(),'port',current_setting('port')::int," +
    "'unixSocketDirectories',current_setting('unix_socket_directories'),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system())," +
    "'postmasterStartedUs',(extract(epoch FROM pg_postmaster_start_time())*1000000)::numeric::text," +
    "'apiBackend',(SELECT json_build_object('pid',pid,'databaseName',datname,'role',usename,'startedUs'," +
    "(extract(epoch FROM backend_start)*1000000)::numeric::text,'clientAddress',host(client_addr)) FROM pg_stat_activity WHERE pid=" +
    api.backend_pid + ")) AS evidence";
};
export async function readPeerDatabaseIdentity(adminPeerClient, api) {
  return (await one(adminPeerClient, peerIdentitySql(api))).evidence;
}
function localPostgresPeer(api) {
  const port = Number(api.port), directory = "/var/run/postgresql";
  check(process.getuid() === 0 && /^[A-Za-z_][A-Za-z0-9_-]{0,62}$/u.test(api.name) &&
    Number.isSafeInteger(port) && port > 0 && port <= 65535, "local postgres peer unavailable");
  const socket = fs.lstatSync(path.join(directory, ".s.PGSQL." + port));
  const uid = Number(execFileSync("/usr/bin/id", ["-u", "postgres"], { encoding:"utf8", timeout:5000 }).trim());
  check(socket.isSocket() && !socket.isSymbolicLink() && socket.uid === uid, "local postgres socket differs");
  const raw = execFileSync("/usr/sbin/runuser", ["-u","postgres","--","/usr/bin/psql","-X","-qAt","--no-password",
    "-h",directory,"-p",String(port),"--dbname",api.name,"--set=ON_ERROR_STOP=1","--command",
    "BEGIN READ ONLY; " + peerIdentitySql(api) + "; ROLLBACK"], {
    encoding:"utf8", timeout:15000, maxBuffer:65536, stdio:["ignore","pipe","pipe"],
    env:{ PATH:"/usr/sbin:/usr/bin:/sbin:/bin", LC_ALL:"C", PGOPTIONS:"-c default_transaction_read_only=on -c search_path=pg_catalog,pg_temp -c statement_timeout=5000" },
  });
  return JSON.parse(raw.trim());
}
export async function readDatabaseIdentity(client, readPeer = localPostgresPeer) {
  let peer;
  const bound = await bindPeerSession(client, async api => (peer = await readPeer(api)));
  check(typeof peer.systemIdentifier === "string" && /^[1-9]\d{0,19}$/u.test(peer.systemIdentifier), "database system identifier unavailable");
  return { databaseName: bound.databaseName, systemIdentifier: peer.systemIdentifier, port: bound.databaseEndpoint.port,
    unixSocketDirectories: bound.databaseEndpoint.unixSocketDirectories, postmasterStartedUs: bound.databaseIdentityEvidence.postmasterStartedUs };
}
export async function readIndexTip(client) {
  const row = await one(client, "SELECT r.value AS rebuild,b.height,b.block_hash FROM proof_indexer.meta r JOIN proof_indexer.blocks b" +
    " ON b.network='livenet' AND b.canonical AND b.height=(r.value->>'indexedThroughBlock')::int AND b.block_hash=r.value->>'indexedThroughBlockHash'" +
    " WHERE r.key='canonical:rebuild' AND b.height=(SELECT max(height) FROM proof_indexer.blocks WHERE network='livenet' AND canonical)" +
    " AND b.height=(SELECT max(block_height) FROM proof_indexer.work_amo_block_transitions WHERE network='livenet') AND NOT EXISTS(SELECT 1 FROM proof_indexer.meta WHERE key='canonical:fault' AND value IS DISTINCT FROM 'null'::jsonb)");
  check(row.rebuild?.complete === true && row.rebuild.status === "complete" && row.rebuild.active === false && row.rebuild.network === "livenet" &&
    Number.isSafeInteger(row.height) && row.height === row.rebuild.indexedThroughBlock && row.block_hash === row.rebuild.indexedThroughBlockHash && hash(row.block_hash), "index checkpoint incomplete");
  return { height: row.height, hash: row.block_hash };
}

export function replayEvidence({ client, freshClient, rpc }) {
  const readCanonicalHash = async height => {
    const result = await rpc("getblockhash", [height]);
    check(hash(result), "invalid Core block hash"); return result;
  };
  async function readTip() {
    const tip = exactTip(await rpc("getblockchaininfo", []));
    const indexed = await readIndexTip(freshClient);
    check(tip.height === indexed.height && tip.blockHash === indexed.hash, "fresh Core/index tip differs");
    return indexed;
  }
  async function readDeclarationEvidence() {
    const p = DECLARATION_PINS;
    const raw = await rpc("getrawtransaction", [p.txid, true, p.blockHash]);
    const transaction = hydrateRawTransaction(raw, p.txid, Transaction);
    check(transaction.status.confirmed && transaction.status.block_hash === p.blockHash && transaction.vin.length === 1, "declaration source differs");
    transaction.status.block_height = p.blockHeight;
    const parentId = transaction.vin[0].txid;
    const parent = hydrateRawTransaction(await rpc("getrawtransaction", [parentId, true]), parentId, Transaction);
    const indexedPosition = await one(client, "SELECT t.txid,t.block_index AS \"blockIndex\",t.block_height AS \"blockHeight\",t.block_hash AS \"blockHash\"" +
      " FROM proof_indexer.transactions t JOIN proof_indexer.blocks b ON b.network=t.network AND b.height=t.block_height AND b.block_hash=t.block_hash AND b.canonical" +
      " WHERE t.network='livenet' AND t.txid=$1 AND t.status='confirmed'", [p.txid]);
    return { transaction, prevoutTransactionHex: parent.hex, indexedPosition, canonicalHash: await readCanonicalHash(p.blockHeight),
      canonicalBlock: await rpc("getblock", [p.blockHash, 1]) };
  }
  let totalBytes = 0;
  async function readTransition(height, blockHash) {
    const row = await one(client, HEADER, [height, blockHash]);
    const bytes = Number(row.native_bytes);
    check(Number.isSafeInteger(bytes) && bytes > 0 && bytes <= RESOURCE_LIMITS.maxNativePayloadBytesPerBlock &&
      row.complete && row.block_atomic && row.fee_once && row.invalid_zero && hash(row.native_sha256) &&
      row.payload?.__powNativeStorage?.sha256 === row.native_sha256, "invalid native frame");
    const { protocol_record_count: records, raw_protocol_candidate_count: candidates, transaction_count: transactions, event_count: events } = row;
    check([records, candidates, transactions, events].every(n => Number.isSafeInteger(n) && n >= 0 && n <= MAX_GOVERNED_ROWS_PER_BLOCK) &&
      records <= RESOURCE_LIMITS.maxOrdinaryRecords && transactions <= records && records <= candidates && records <= events &&
      (records === 0 ? candidates === 0 && events === 0 : transactions > 0), "governed record counts incomplete or outside replay bounds");
    totalBytes += bytes;
    check(totalBytes <= RESOURCE_LIMITS.maxNativePayloadBytes, "native suffix exceeds bound");
    const { decoded } = await one(client, "SELECT proof_indexer.read_work_transition_payload_v1(t.network,t.block_height,t.block_hash,t.payload) AS decoded" +
      " FROM proof_indexer.work_amo_block_transitions t WHERE t.network='livenet' AND t.block_height=$1 AND t.block_hash=$2", [height, blockHash]);
    return { ...row, decoded };
  }
  return { readTip, readCanonicalHash, readDeclarationEvidence, readRawBlock: blockHash => rpc("getblock", [blockHash, 0]), readTransition,
    readParentTransaction: txid => rpc("getrawtransaction", [txid, false]),
    readRelations: (height, blockHash) => readRelationalEvidence(client, height, blockHash),
    nativeDigest: value => one(client, "SELECT encode(sha256(jsonb_send($1::jsonb)),'hex') AS sha256,octet_length(jsonb_send($1::jsonb)) AS bytes", [JSON.stringify(value)]) };
}

export function coreRpc(env) {
  const url = new URL(env.BITCOIN_RPC_URL);
  check(["http:", "https:"].includes(url.protocol) && ["localhost","127.0.0.1","[::1]"].includes(url.hostname) &&
    !url.username && !url.password && !url.search && !url.hash && url.pathname === "/" &&
    env.BITCOIN_RPC_USER && env.BITCOIN_RPC_PASSWORD, "local Core credentials required");
  return async (method, params) => {
    check(["getblockchaininfo","getblockhash","getblock","getrawtransaction"].includes(method), "Core method outside read scope");
    const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { "content-type": "application/json", authorization: "Basic " + Buffer.from(env.BITCOIN_RPC_USER + ":" + env.BITCOIN_RPC_PASSWORD).toString("base64") },
      body: JSON.stringify({ jsonrpc: "2.0", id: "expanded-liquidity-read", method, params }) });
    const body = await boundedJsonResponse(response, method === "getblock" ? 9000000 : 8 * 1024 * 1024);
    check(body.id === "expanded-liquidity-read" && !body.error, "Core evidence unavailable");
    return body.result;
  };
}

export function databaseClient(env) {
  const url = new URL(env.POW_INDEX_DATABASE_URL);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const socket = !url.hostname && url.searchParams.get("host") === "/var/run/postgresql";
  check(["postgres:", "postgresql:"].includes(url.protocol) && (local || socket) &&
    [...url.searchParams.keys()].every(key => socket && key === "host"), "local index connection required");
  return new pg.Client({ host: socket ? "/var/run/postgresql" : url.hostname.replace(/^\[|\]$/gu,""), port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.slice(1)), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    application_name: "amo-expanded-replay-read", connectionTimeoutMillis: 5000, query_timeout: 45000,
    options: "-c default_transaction_read_only=on -c statement_timeout=40000 -c lock_timeout=1000 -c search_path=pg_catalog,pg_temp -c timezone=UTC" });
}

export function plannedTip(height, blockHash) {
  const n = Number(height);
  check(String(n) === String(height) && Number.isSafeInteger(n) && n > DECLARATION_PINS.blockHeight &&
    n <= DECLARATION_PINS.blockHeight + 512 && hash(blockHash), "reviewed suffix tip required");
  return { height: n, hash: blockHash };
}

export async function verifyOriginalRange(client, qualification) {
  for (const bound of [qualification.anchor, ...qualification.blocks]) {
    const args = [bound.height, bound.hash];
    const row = await one(client, HEADER, args);
    check(row.current_main_row_sha256 === bound.currentMainRowSha256 && row.native_sha256 === bound.oldNativeSha256 &&
      row.payload?.__powNativeStorage?.sha256 === bound.oldNativeSha256, "original native evidence changed");
    if (bound.relationalBindings) check(equal(await one(client, GOVERNED_RELATIONAL_BINDINGS_SQL, args), bound.relationalBindings),
      "original relational evidence changed");
  }
}

export async function runReadOnlyQualification({ client, freshClient, rpc, sources, tip, readPeer }) {
  plannedTip(tip?.height, tip?.hash);
  await client.connect();
  try {
    await freshClient.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      for (const connection of [client, freshClient])
        check((await one(connection, "SHOW transaction_read_only")).transaction_read_only === "on", "database not read-only");
      await assertNativeTransitionStorageContract(client);
      const databaseIdentity = await readDatabaseIdentity(client, readPeer);
      check(equal(databaseIdentity, await readDatabaseIdentity(freshClient, readPeer)), "database sessions differ");
      const adapter = replayEvidence({ client, freshClient, rpc });
      check(equal(tip, await adapter.readTip()) && equal(tip, await readIndexTip(client)), "reviewed tip differs from Core or index");
      const qualification = await qualifyExpandedLiquidityReplay({ tip, sources, ...adapter });
      await client.query("ROLLBACK");
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      check(equal(tip, await readIndexTip(client)) && equal(databaseIdentity, await readDatabaseIdentity(client, readPeer)),
        "fresh database snapshot differs");
      await verifyOriginalRange(client, qualification);
      check(equal(verifyReplayDeclaration(await adapter.readDeclarationEvidence()), qualification.declaration), "declaration changed in fresh snapshot");
      await client.query("ROLLBACK");
      check(equal(databaseIdentity, await readDatabaseIdentity(freshClient, readPeer)) && equal(await adapter.readTip(), tip) &&
        equal(await sources.readBinding(), qualification.sourceBinding), "final source checkpoint changed");
      return { ...qualification, databaseIdentity };
    } finally { await freshClient.end(); }
  } finally { await client.end(); }
}

export async function main(args) {
  if (args[0] === "inspect-sources" && args.length === 5) {
    const proposal = inspectSources(args[1], args[2], args[3], args[4]);
    process.stdout.write(JSON.stringify(proposal, null, 2) + "\n");
    return;
  }
  check(args[0] === "qualify" && args.length === 6, "use inspect-sources RETAINED_BASELINE_ROOT CANDIDATE_ROOT COMMIT TREE or qualify SOURCE_MANIFEST SOURCE_SHA256 TIP_HEIGHT TIP_HASH NEW_RECEIPT");
  const sources = await openSources(args[1], args[2]);
  const result = await runReadOnlyQualification({ client: databaseClient(process.env), freshClient: databaseClient(process.env),
    rpc: coreRpc(process.env), sources, tip: plannedTip(args[3], args[4]) });
  const bytes = Buffer.from(JSON.stringify(result, null, 2) + "\n");
  check(bytes.length <= RESOURCE_LIMITS.maxQualificationReceiptBytes, "qualification receipt too large");
  const output = args[5];
  check(path.isAbsolute(output) && fs.realpathSync(path.dirname(output)) === path.dirname(output) &&
    !(fs.statSync(path.dirname(output)).mode & 0o022), "private on-host receipt directory required");
  const fd = fs.openSync(output, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  console.log(JSON.stringify({ qualified: true, tip: result.tip, blocks: result.blocks.length, receiptSha256: sha(bytes) }));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main(process.argv.slice(2)).catch(error => {
    const reason = /^[a-zA-Z][a-zA-Z0-9 _:-]{0,200}$/u.test(error.message) ? error.message : "invalid or unavailable evidence";
    console.error("Read-only AMO preflight failed:", reason); process.exitCode = 1;
  });
