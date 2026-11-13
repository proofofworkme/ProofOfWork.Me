import { createHash } from "node:crypto";
import { lstatSync, readdirSync, openSync, closeSync, readSync, fstatSync, constants } from "node:fs";
import { lstat, readdir, open } from "node:fs/promises";
import { resolve, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Operational source envelope only, never a canonical acceptance rule.
export const LINKED_SOURCE_ROOTS = Object.freeze(["server", "src/shared"]);
export const LINKED_SOURCE_FILES = Object.freeze(["scripts/backfill-proof-indexer.mjs",
  "scripts/backfill-proof-search.mjs", "package.json", "package-lock.json"]);
const base = fileURLToPath(new URL("../", import.meta.url));
const identity = stat => [stat.dev,stat.ino,stat.size,stat.mode,stat.mtimeNs,stat.ctimeNs].map(String).join(":");
function* scan(root) {
  const directory=resolve(root), entries=[], observed=new Map();
  let total=0, byteCount=0, visited=0;
  function* inspect(path) {
    const stat=yield ["stat",path];
    if(stat.isSymbolicLink()) throw new Error("Linked source symlink is not allowed.");
    const previous=observed.get(path);
    // Ancestors outside this source own unrelated siblings. Their content churn
    // is not source mutation; still pin ownership, permissions and inode.
    const outside=path!==directory && !path.startsWith(directory+sep);
    const fingerprint=outside
      ? [stat.dev,stat.ino,stat.mode,stat.uid,stat.gid].map(String).join(":")
      : identity(stat);
    if(previous && previous.identity!==fingerprint) throw new Error("Linked source changed while reading.");
    if(!previous) observed.set(path,{identity:fingerprint,directory:stat.isDirectory()});
    return stat;
  }
  // A source-root symlink and symlinked parents are just as unsafe as leaf links.
  for(let path=directory;;path=dirname(path)) {
    const stat=yield* inspect(path);
    if(!stat.isDirectory()) throw new Error("Linked source ancestor is not a directory.");
    if(dirname(path)===path) break;
  }
  function* visit(name) {
    if(++visited>4096 || name.split("/").length>16) throw new Error("Linked source traversal bound exceeded.");
    const path=resolve(directory,name), rel=relative(directory,path);
    if(!rel || rel.startsWith(".."+sep) || rel==="..") throw new Error("Linked source path escaped root.");
    // Include intermediate source parents not otherwise recursively visited.
    for(let parent=dirname(path);parent!==directory;parent=dirname(parent)) yield* inspect(parent);
    const stat=yield* inspect(path);
    if(stat.isDirectory()) {
      const names=(yield ["names",path]).sort();observed.get(path).names=JSON.stringify(names);
      for(const item of names) yield* visit(name+"/"+item);
      return;
    }
    if(!stat.isFile()) throw new Error("Linked source must be a regular file.");
    const size=Number(stat.size);
    if(++total>1024 || size>8_000_000) throw new Error("Linked source file bound exceeded.");
    byteCount+=size;
    if(byteCount>32_000_000) throw new Error("Linked source total byte bound exceeded.");
    const bytes=yield ["read",path];
    yield* inspect(path);
    if(bytes.length!==size) throw new Error("Linked source changed while reading.");
    const digest=createHash("sha256").update(bytes).digest("hex");
    observed.get(path).digest=digest;
    entries.push([name,bytes.length,digest]);
  }
  for(const name of LINKED_SOURCE_ROOTS) yield* visit(name);
  for(const name of LINKED_SOURCE_FILES) yield* visit(name);
  // Detect edits of an earlier file or directory while a later one was read.
  for(const [path,saved] of observed) {
    yield* inspect(path);
    if(saved.digest!==undefined) {
      const bytes=yield ["read",path];
      yield* inspect(path);
      if(createHash("sha256").update(bytes).digest("hex")!==saved.digest) throw new Error("Linked source content changed while reading.");
    }
    if(saved.names!==undefined && JSON.stringify((yield ["names",path]).sort())!==saved.names)
      throw new Error("Linked source directory changed while reading.");
  }
  entries.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  return {model:"publish-linked-source-closure-v1",files:String(entries.length),bytes:String(byteCount),
    sha256:createHash("sha256").update(JSON.stringify(entries)).digest("hex")};
}
function fileBuffer(stat) {
  if(!stat.isFile() || stat.size>8_000_000n) throw new Error("Linked source file bound exceeded.");
  return Buffer.alloc(Number(stat.size)+1);
}
function boundedRead(path) {
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const before=fstatSync(fd,{bigint:true}),buffer=fileBuffer(before);let used=0,count;
    while(used<buffer.length && (count=readSync(fd,buffer,used,buffer.length-used,null))>0) used+=count;
    if(used!==Number(before.size) || identity(fstatSync(fd,{bigint:true}))!==identity(before)) throw new Error("Linked source changed while reading.");
    return buffer.subarray(0,used);
  }finally{closeSync(fd);}
}
async function boundedReadAsync(path) {
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const before=await fd.stat({bigint:true}),buffer=fileBuffer(before);let used=0;
    while(used<buffer.length){const {bytesRead}=await fd.read(buffer,used,buffer.length-used,null);if(!bytesRead)break;used+=bytesRead;}
    if(used!==Number(before.size) || identity(await fd.stat({bigint:true}))!==identity(before)) throw new Error("Linked source changed while reading.");
    return buffer.subarray(0,used);
  }finally{await fd.close();}
}
const syncOps={stat:path=>lstatSync(path,{bigint:true}),names:readdirSync,read:boundedRead};
const asyncOps={stat:path=>lstat(path,{bigint:true}),names:readdir,read:boundedReadAsync};
export function linkedSourceClosure(root=base, operations=syncOps) {
  const iterator=scan(root);let next=iterator.next();
  while(!next.done){const [op,path]=next.value;next=iterator.next(operations[op](path));}
  return next.value;
}
export async function linkedSourceClosureAsync(root=base, operations=asyncOps) {
  const iterator=scan(root);let next=iterator.next();
  while(!next.done){const [op,path]=next.value;next=iterator.next(await operations[op](path));}
  return next.value;
}

// Share only active work. No enabled response survives as a completed cache.
export function createBoundedCapabilityProbe(probe,{maxWaiters=16,timeoutMs=5000,minIntervalMs=1000}={}) {
  if(typeof probe!=="function" || !Number.isInteger(maxWaiters) || maxWaiters<1 || maxWaiters>16 ||
    !Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>5000 ||
    !Number.isInteger(minIntervalMs) || minIntervalMs<1 || minIntervalMs>5000) throw new TypeError("Invalid capability probe bounds.");
  let job=null,lastStart=-Infinity;
  return async function read() {
    if(!job) {
      const delay=Math.max(0,minIntervalMs-(Date.now()-lastStart));
      const current={waiters:0};job=current;
      let timer;
      // A legitimate immediate next workflow step waits for one fresh slot.
      // This is the same bounded job, not an unbounded request queue.
      const actual=Promise.resolve().then(async()=>{
        if(delay) await new Promise(resolve=>setTimeout(resolve,delay));
        lastStart=Date.now();return probe();
      });
      const timed=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Capability probe timed out.")),timeoutMs);});
      current.result=Promise.race([actual,timed]);
      actual.then(()=>{clearTimeout(timer);if(job===current)job=null;},()=>{clearTimeout(timer);if(job===current)job=null;});
    }
    const current=job;
    if(current.waiters>=maxWaiters) throw new Error("Capability probe waiter bound exceeded.");
    current.waiters++;
    try{return await current.result;}finally{current.waiters--;}
  };
}
