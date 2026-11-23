#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { Duplex } from "node:stream";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual as equal } from "node:util";
import pg from "pg";
import * as preflight from "./preflight.mjs";
import { publishExpandedLiquidityReplay } from "./publish.mjs";
import { verifyReplayDeclaration } from "./qualify.mjs";
import { sha256 } from "./storage.mjs";

const hash = value => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const holdFile = "/run/proofofwork-search-release.hold";
const units = ["proofofwork-api.service","proofofwork-indexer-worker.service","proofofwork-api-wg.service",
  "proofofwork-api-wg.socket","proofofwork-search-index.service","proofofwork-search-index.timer"];

function requireInput(ok, reason) {
  if (!ok) throw Error(reason);
}

export function parsePublicationArgs(args) {
  const [mode,sourceManifest,sourceSha,qualification,qualificationSha,receipt,holdSha] = args;
  requireInput(["rehearse","publish","verify"].includes(mode) && args.length === (mode === "publish" ? 7 : 6) &&
    [sourceSha,qualificationSha].every(hash) && (mode !== "publish" || hash(holdSha)) &&
    [sourceManifest,qualification,receipt].every(p => typeof p === "string" && path.isAbsolute(p) && path.normalize(p) === p),
    "Use MODE SOURCE_MANIFEST SOURCE_SHA256 QUALIFICATION QUAL_SHA256 NEW_RECEIPT [SEARCH_HOLD_SHA256 for publish]");
  return {mode,sourceManifest,sourceSha,qualification,qualificationSha,receipt,holdSha};
}

function pinned(file, digest, max) {
  requireInput(fs.realpathSync(file) === file, "Canonical pinned path required");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const s = fs.fstatSync(fd,{bigint:true});
    requireInput(s.isFile() && s.nlink === 1n && s.size > 0n && s.size <= BigInt(max) && !(s.mode & 0o022n),
      "Unexpected pinned file metadata");
    const bytes = fs.readFileSync(fd);
    const now = fs.fstatSync(fd,{bigint:true});
    requireInput(s.ctimeNs === now.ctimeNs && s.mtimeNs === now.mtimeNs && sha256(bytes) === digest, "Pinned file changed");
    return bytes;
  } finally { fs.closeSync(fd); }
}

function receiptFile(name,value) {
  const dir = path.dirname(name);
  requireInput(fs.realpathSync(dir) === dir, "Use a canonical on-host receipt directory");
  for (let parent = dir;;parent = path.dirname(parent)) {
    const info = fs.statSync(parent);
    const stickyTmp = parent === "/tmp" && info.uid === 0 && (info.mode & 0o1000);
    requireInput((info.uid === 0 || info.uid === process.getuid()) && (!(info.mode & 0o022) || stickyTmp) &&
      (parent !== dir || !(info.mode & 0o022)), "Use a private on-host receipt directory");
    if (parent === path.dirname(parent)) break;
  }
  const fd = fs.openSync(name,fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,0o600);
  try { fs.writeFileSync(fd,JSON.stringify(value,null,2)+"\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const d = fs.openSync(dir,fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(d); } finally { fs.closeSync(d); }
}

function ensureDrained(holdSha, sourceCommit) {
  requireInput(fs.lstatSync(holdFile).uid === 0, "Search hold ownership changed");
  const hold = JSON.parse(pinned(holdFile,holdSha,65536));
  requireInput(typeof hold.releaseId === "string" && hold.releaseId.split("-")[0] === sourceCommit.slice(0,12),
    "Search hold belongs to a different source");
  for (const unit of units) {
    const fields = execFileSync("/usr/bin/systemctl",["show","--property=LoadState,ActiveState",unit],
      {encoding:"utf8",timeout:4000,maxBuffer:4096}).trim().split("\n");
    requireInput(fields.includes("LoadState=loaded") && fields.includes("ActiveState=inactive"),"Runtime has not been drained: "+unit);
  }
}

// Tunnels PostgreSQL wire bytes through a process running under the postgres
// Unix identity. The supervisor retains private evidence and Core credentials.
// The relay can connect only to this machine's PostgreSQL Unix socket.
const relay = `use strict; use warnings; use IO::Socket::UNIX;
  my ($port)=@ARGV; die "invalid port" unless $port =~ /\\A[1-9][0-9]{0,4}\\z/ && $port<=65535;
  my $s=IO::Socket::UNIX->new(Peer => "/var/run/postgresql/.s.PGSQL.$port") or die "postgres socket unavailable";
  my $pid=fork(); die "cannot fork" unless defined $pid;
  my ($in,$out)=$pid ? (\\*STDIN,$s) : ($s,\\*STDOUT);
  while (1) { my $n=sysread($in,my $buf,65536); die "relay read" unless defined $n; last if !$n;
    for (my $offset=0;$offset<$n;) { my $w=syswrite($out,$buf,$n-$offset,$offset); die "relay write" unless $w; $offset+=$w; } }
  if ($pid) { shutdown($s,1); waitpid($pid,0); }`;

function postgresSocketIdentity(port) {
  const owner = Number(execFileSync("/usr/bin/id",["-u","postgres"],{timeout:2000,encoding:"utf8"}).trim());
  const stat = fs.lstatSync("/var/run/postgresql/.s.PGSQL."+port,{bigint:true});
  requireInput(Number.isSafeInteger(owner) && stat.isSocket() && stat.uid === BigInt(owner), "PostgreSQL socket identity differs");
  return [stat.dev, stat.ino, stat.uid, stat.mode, stat.ctimeNs];
}

function startPostgresPeer(program, port) {
  requireInput(process.getuid() === 0, "Run with the established on-host postgres peer supervisor");
  postgresSocketIdentity(port);
  return spawn("/usr/bin/sudo",["-n","-u","postgres","--","/usr/bin/perl","-e",program,String(port)],
    {stdio:["pipe","pipe","inherit"],env:{PATH:"/usr/bin:/bin",LANG:"C"}});
}

export function publicationPeerClient(database, port, startRelay = startPostgresPeer) {
  requireInput(Number.isInteger(port) && port > 0 && port <= 65535 && /^[A-Za-z_][A-Za-z0-9_-]{0,62}$/u.test(database),
    "Invalid qualified postgres peer endpoint");
  const child = startRelay(relay,port);
  const stream = Duplex.from({writable:child.stdin,readable:child.stdout});
  child.on("error", error => stream.destroy(error));
  stream.setNoDelay = () => {};
  stream.connect = () => queueMicrotask(()=>stream.emit("connect"));
  return new pg.Client({stream,host:"/var/run/postgresql",port,user:"postgres",database,ssl:false,
    application_name:"amo-expanded-native-publication",connectionTimeoutMillis:5000,
    options:"-c search_path=pg_catalog,pg_temp -c timezone=UTC"});
}

export async function checkRawQualification(q, evidence) {
  requireInput(equal(verifyReplayDeclaration(await evidence.readDeclarationEvidence()),q.declaration),
    "Current declaration bytes, prevout or indexed position differ");
  for (const b of q.blocks) {
    const hex = await evidence.readRawBlock(b.hash);
    requireInput(typeof hex === "string" && Number.isSafeInteger(b.rawBlockBytes) && b.rawBlockBytes>0 && b.rawBlockBytes<=4000000 &&
      hex.length===2*b.rawBlockBytes && /^[0-9a-f]+$/u.test(hex) && sha256(Buffer.from(hex,"hex"))===b.rawBlockSha256,
      "Qualified Core block bytes differ at "+b.height);
  }
}

export async function main(argv) {
  const a = parsePublicationArgs(argv);
  const bytes = pinned(a.qualification,a.qualificationSha,32*1024**2);
  const q = JSON.parse(bytes);
  requireInput(q.sourceBinding?.sourceManifestSha256 === a.sourceSha && Array.isArray(q.blocks) && q.blocks.length>0 && q.blocks.length<=512,
    "Qualification source manifest or range differs");
  const read = preflight.databaseClient(process.env);
  const rpc = preflight.coreRpc(process.env);

  const intent = {mode:a.mode,qualificationSha256:a.qualificationSha,sourceManifestSha256:a.sourceSha,
    sourceCommit:q.sourceBinding.sourceCommit,tip:q.tip};
  requireInput(!fs.existsSync(a.receipt+".result.json"), "Terminal receipt path already exists");
  receiptFile(a.receipt,{...intent,status:"started",committed:"unverified"});
  let admin;
  let outcome;
  try {
    const port = Number(read.connectionParameters.port);
    requireInput(port === q.databaseIdentity.port, "Qualified socket port differs");
    const socketIdentity = postgresSocketIdentity(port);
    admin = publicationPeerClient(q.databaseIdentity.databaseName,port);
    await read.connect(); await admin.connect();
    const peer = await admin.query("SELECT session_user='postgres' AND inet_server_addr() IS NULL AS local_admin");
    requireInput(peer.rows[0]?.local_admin === true,"Local peer administrator required");
    const readIdentity = () => preflight.readDatabaseIdentity(read,api => preflight.readPeerDatabaseIdentity(admin,api));
    requireInput(equal(await readIdentity(),q.databaseIdentity),"Read session identity changed");
    const e = preflight.replayEvidence({client:read,freshClient:read,rpc});
    const verifySource = async expected => {
      pinned(a.qualification,a.qualificationSha,32*1024**2);
      requireInput(equal(postgresSocketIdentity(port),socketIdentity) &&
        equal(await readIdentity(),q.databaseIdentity), "Live database backend or socket changed");
      if (a.mode === "publish") ensureDrained(a.holdSha,expected.sourceCommit);
      await checkRawQualification(q,e);
      return await preflight.verifySourceBinding(a.sourceManifest,a.sourceSha,expected,
        a.mode === "rehearse" ? "active" : "composed");
    };
    outcome = await publishExpandedLiquidityReplay({client:admin,qualificationBytes:bytes,qualificationSha256:a.qualificationSha,
      readTip:e.readTip,readCanonicalHash:e.readCanonicalHash,verifySource,mode:a.mode});
    receiptFile(a.receipt+".result.json",{...intent,...outcome});
    console.log(JSON.stringify(outcome));
  } catch (error) {
    if (!outcome) receiptFile(a.receipt+".result.json",{...intent,status:"unsuccessful",
      committed:"unverified",verifyWithQualificationSha256:a.qualificationSha});
    throw error;
  } finally { await Promise.allSettled([admin?.end(),read.end()]); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    console.error("AMO replay publication:",String(error.message).replace(/postgres(?:ql)?:\/\/\S+/giu,"[database]"));
    process.exitCode=1;
  });
}
