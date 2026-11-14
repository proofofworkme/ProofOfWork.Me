import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, existsSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const fixed = Object.freeze({
 artifact: {commit:"064b6991ae2a48e2069baedc767cd918d28ba052",tree:"e6f76332d26f88c3f7df98dc689d013193729c83"},
 baselineOperator: {commit:"c7cfa32ae01ae70042bac0539ddf74d816ae474a",tree:"fe7a2f82097c925235c1bfca3d3281584d3e7ab4"},
 backend: {commit:"609d5a10a07a83bb5f1e858e7f6c1d706e741ee1",tree:"cae54e036af5254698c5cd45020b382cb0982052"},
});
const backendArtifactDelta = [
  {
    "path": "OP_RETURN_INFRASTRUCTURE.md",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "1373aa1836bd4748ac48008924b26d9da3dd1b76"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "c1de1160fc9c544de788d942eb720d34665a50ed"
    }
  },
  {
    "path": "deploy/linked-publish/REMOTE_VERIFICATION.md",
    "before": null,
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "404235c8d905160bb2ed00c0cf88ec27eefadc86"
    }
  },
  {
    "path": "deploy/publish/check-ui-release.test.py",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "67f3f2b6c379093baf60e02feaaac7d4f261379c"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "7e060a8e186103ff5de51523bb525e80e4c24e4a"
    }
  },
  {
    "path": "deploy/publish/release.py",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "c01ce102dd792a9a8d7269c19e7b7bee8fdf9b28"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "82db0450717a63416757405dff08ec87b77bc2be"
    }
  },
  {
    "path": "deploy/publish/remote_transport.py",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "8ee3ccadad6976e32407021738e0c0a973803c4f"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "197f2a3f445ec35d51dfa342e0edcdc5fa167ad8"
    }
  },
  {
    "path": "deploy/publish/transport_preserve.py",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "e39ed4913309e607e2b27159f216acba3c0106e3"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "553451e666eeac8095d03b002194b241c623a592"
    }
  },
  {
    "path": "release-impact.json",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "71758665fe9d2d64712ec6b67ae67c9da1cf4257"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "19f008458289dff5bccbad007b730456ec6fd948"
    }
  },
  {
    "path": "repository-hygiene.json",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "b7a5e550e0d333788cc476567adb842dd0e9931f"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "945a2b4e0b377ee234955bc3ba41929d975979d5"
    }
  },
  {
    "path": "scripts/check-activity-fee-factor-live.mjs",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "9297785cbbbe3c6f44ac5365062a7c250b0fd0c1"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "abe4fcb988360646cd261d12cfba00b7edc77185"
    }
  },
  {
    "path": "scripts/check-activity-runtime-release.test.mjs",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "6329f858497f8dcef4eede2b17c27948c7d6e5be"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "2bebc65996ee4d6fe693bd6f517cebfa6f1b0ef3"
    }
  },
  {
    "path": "scripts/check-linked-growth-live.mjs",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "c02cc04a0a03fdad40cbed32cf7e5ccc5ff10ac5"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "e259ecd9bd964a6bdeb7ff2d8a9d45b1e43fe0d9"
    }
  },
  {
    "path": "scripts/check-linked-growth-live.test.mjs",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "573bde839d33169dae60e6ff9b240fd4b3d91130"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "1cd35f6e2aa9bccc95707bf1a2ec276deca2f9d3"
    }
  },
  {
    "path": "scripts/check-publish-linked-live.mjs",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "4764b6ea5b1126c5375832f81abc5a370cc0e14a"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "4bfd18a737ff0bfe33e672bfba66ee30b78bd228"
    }
  },
  {
    "path": "scripts/check-publish-linked-remote.mjs",
    "before": null,
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "d79050097e1fed7fdf77f7dfe8d2dd991049fc69"
    }
  },
  {
    "path": "scripts/check-publish-linked-remote.test.mjs",
    "before": null,
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "12be2b48ba818704da36e90b8a7b5f4454e8fcf7"
    }
  }
];
const baselineDelta = [
  {
    "path": "REPOSITORY_HYGIENE.md",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "330ee5838a80348a1c58b0d802a3806e05578cb2"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "eef0d32fbbd2128bdc2712e03deb24c052679973"
    }
  },
  {
    "path": "deploy/linked-publish/REMOTE_VERIFICATION.md",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "404235c8d905160bb2ed00c0cf88ec27eefadc86"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "2d5279e0a93ddb94f2b6a82c80dd4d275a42e952"
    }
  },
  {
    "path": "deploy/ui-retention/check-preserved-1042-integration.test.py",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "28a7e5682e03205931fdbbf8e33ea0f30ad74e3e"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "7b52b697c4b84906cb6522deb1373544ca084881"
    }
  },
  {
    "path": "deploy/ui-retention/fixtures/README.md",
    "before": null,
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "fc9c8004c7a117fb3f891dd12e2776fd0a6d29f7"
    }
  },
  {
    "path": "deploy/ui-retention/fixtures/prior-ui-release-policy-e99e149.py",
    "before": null,
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "92f407a264910e85e5d36b9e55c05c06d3e3e8ca"
    }
  },
  {
    "path": "release-impact.json",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "19f008458289dff5bccbad007b730456ec6fd948"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "4f01c5b41333e984d42597d83592b49c69732756"
    }
  },
  {
    "path": "repository-hygiene.json",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "945a2b4e0b377ee234955bc3ba41929d975979d5"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "75d67f0c4d1a725215c9e5a878182ce433c8348a"
    }
  },
  {
    "path": "scripts/check-activity-fee-factor-live.mjs",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "abe4fcb988360646cd261d12cfba00b7edc77185"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "684f54a5f3e7eb3b4d961aeb8415ecc5c30e3bb2"
    }
  },
  {
    "path": "scripts/check-activity-retention-live.test.mjs",
    "before": null,
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "8b522702f21acf0af7ecae37ad33e3025b826ed0"
    }
  },
  {
    "path": "scripts/check-publish-linked-remote.mjs",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "d79050097e1fed7fdf77f7dfe8d2dd991049fc69"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "68b934e4326a4f820feea1d732d49045f99a3649"
    }
  },
  {
    "path": "scripts/check-publish-linked-remote.test.mjs",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "12be2b48ba818704da36e90b8a7b5f4454e8fcf7"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "af7066923c2a942cdd92c76d77dddf2fc6281d3e"
    }
  },
  {
    "path": "scripts/check-ui-release-sequence-capacity.py",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "5207895922452251be3ca9da413fc4da0657b658"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "592e124f8826faecc9c173cf3b4721ceeb23b318"
    }
  },
  {
    "path": "scripts/repository-hygiene.mjs",
    "before": {
      "mode": "100755",
      "type": "blob",
      "blob": "799a39c1725c2b23e97da1949b0ddbb866eab5fe"
    },
    "after": {
      "mode": "100755",
      "type": "blob",
      "blob": "87f96b8a39acb70337b082a5f2b9b283cef62d4b"
    }
  },
  {
    "path": "scripts/repository-hygiene.test.mjs",
    "before": {
      "mode": "100644",
      "type": "blob",
      "blob": "13e559dbe6d956e948264bde5a2d54ceb205a6ab"
    },
    "after": {
      "mode": "100644",
      "type": "blob",
      "blob": "97b8dacb22df9ccdf20cd05032ee74fb62ffb1b9"
    }
  }
];
const operatorPaths = new Set([
 "scripts/fixtures/dual-release/native609.json", "scripts/fixtures/dual-release/browser609.json",
 "scripts/collect-dual-release-evidence.mjs", "scripts/collect-dual-release-evidence.test.mjs",
  "scripts/release-identity-proof.mjs",
  "scripts/release-identity-proof.test.mjs",
  "scripts/check-dual-release-qualification.mjs",
  "scripts/check-dual-release-qualification.test.mjs",
  "scripts/check-publish-linked-remote.mjs",
  "scripts/check-publish-linked-remote.test.mjs",
  "scripts/check-activity-fee-factor-live.mjs",
  "scripts/check-activity-retention-live.test.mjs",
  "deploy/linked-publish/qualification.py",
  "deploy/linked-publish/qualification.test.py",
  "deploy/linked-publish/DUAL_QUALIFICATION.md",
  "release-impact.json",
  "repository-hygiene.json"
]);
const closurePaths = [
 "deploy/proofofwork-postgres-query-health.sh",
 "deploy/linked-publish/profile.py",
 "deploy/activity-fee-factor/profile.py",
 "deploy/audit-remediation/profile.py",
 "scripts/collect-dual-release-evidence.mjs",
  "scripts/check-dual-release-qualification.mjs",
  "scripts/release-identity-proof.mjs",
  "scripts/check-publish-linked-remote.mjs",
  "scripts/check-activity-fee-factor-live.mjs",
  "deploy/linked-publish/qualification.py",
  "deploy/ui-retention/lifecycle.py",
  "package.json",
  "package-lock.json"
];
const proofs = new WeakSet();
const sha = value => createHash("sha256").update(value).digest("hex");
const digest = value => sha(JSON.stringify(value));
const deepFreeze = value => {
 if(value && typeof value === "object") { for(const item of Object.values(value)) deepFreeze(item); Object.freeze(value); }
 return value;
};
function git(root,...args) {
 const env={PATH:"/usr/bin:/bin",HOME:"/nonexistent",GIT_OPTIONAL_LOCKS:"0",GIT_NO_REPLACE_OBJECTS:"1",
  GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_NOSYSTEM:"1",GIT_GRAFT_FILE:"/dev/null"};
 return execFileSync("/usr/bin/git",["--no-replace-objects","-c","core.fsmonitor=false","-c","advice.graftFileDeprecated=false","-c","core.untrackedCache=false","-C",root,...args],{encoding:"utf8",env,timeout:45000,maxBuffer:64*1024**2});
}
function canonicalRoot(repository) {
 assert.equal(typeof repository,"string","Explicit repository required");
 const root=resolve(repository);
 assert.equal(realpathSync(root),root,"Repository path must be canonical");
 assert.equal(git(root,"rev-parse","--show-toplevel").trim(),root,"Repository must be its exact root");
 return root;
}
export function readIdentityTree(repository,commit) {
 assert.match(commit,/^[0-9a-f]{40}$/u,"Full commit identity required");
 const result=new Map();
 for(const row of git(repository,"ls-tree","-rz",commit).split("\0").filter(Boolean)) {
  const tab=row.indexOf("\t"); assert(tab>0,"Malformed tree row");
  const [mode,type,blob]=row.slice(0,tab).split(" "),path=row.slice(tab+1);
  assert(!result.has(path),"Duplicate tree path");
  result.set(path,{mode,type,blob});
 }
 return result;
}
// Pure, unbranded validation helpers support synthetic adversarial fixtures.
// They cannot construct a proof or alter the production identity constants.
export function identityTreeDelta(before,after,allowed) {
 const rows=[];
 for(const path of [...new Set([...before.keys(),...after.keys()])].sort()) {
  const left=before.get(path)??null,right=after.get(path)??null;
  if(JSON.stringify(left)!==JSON.stringify(right)) {
   assert(allowed.has(path),"Unapproved source delta: "+path);
   rows.push({path,before:left,after:right});
  }
 }
 return rows;
}
export function assertIdentityAncestor(repository,ancestor,descendant) {
 assert.match(ancestor,/^[0-9a-f]{40}$/u);assert.match(descendant,/^[0-9a-f]{40}$/u);
 git(repository,"merge-base","--is-ancestor",ancestor,descendant);
}
export function inspectIdentitySource(repository,commit,paths) {
 const root=canonicalRoot(repository);
 assert.equal(git(root,"rev-parse","HEAD").trim(),commit,"Concurrent or mismatched HEAD");
 assert.equal(git(root,"status","--porcelain","--untracked-files=no").trim(),"","Tracked source must be clean");
 for(const row of git(root,"ls-files","-v","-z").split("\0").filter(Boolean))
  assert(!/^[a-zS]/u.test(row),"Hidden index flags forbidden");
 const tree=readIdentityTree(root,commit),files=[];
 for(const name of paths) {
  assert(!name.split("/").includes("..")&&!name.startsWith("/"),"Invalid closure path");
  const entry=tree.get(name);
  assert(entry&&entry.type==="blob"&&["100644","100755"].includes(entry.mode),"Closure must be committed regular files: "+name);
  const path=resolve(root,name);
  assert.equal(realpathSync(path),path,"Symlink in executable closure: "+name);
  const stat=lstatSync(path);
  assert(stat.isFile(),"Nonregular executable closure");
  assert.equal((stat.mode&0o111)?"100755":"100644",entry.mode,"Executable mode differs from HEAD");
  const bytes=readFileSync(path);
  const blob=createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
  assert.equal(blob,entry.blob,"Executable bytes differ from HEAD: "+name);
  // An untracked nested manifest can redirect package imports/resolution.
  for(let directory=dirname(path);directory!==root;directory=dirname(directory)) {
   const manifest=resolve(directory,"package.json");
   if(existsSync(manifest)) {
    const rel=relative(root,manifest);
    assert(paths.includes(rel),"Unexpected package scope in executable closure: "+rel);
   }
  }
  files.push({path:name,...entry,sha256:sha(bytes)});
 }
 assert.equal(git(root,"rev-parse","HEAD").trim(),commit,"Concurrent HEAD changed");
 return {commit,tree:git(root,"rev-parse",commit+"^{tree}").trim(),files};
}
export function assertIdentityStable(before,after) {
 assert.deepEqual(after,before,"Source identity changed during qualification");
}
export function createIdentityProof({repository,now=Date.now()}={}) {
 const root=canonicalRoot(repository);
 assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,"Executable Node preload environment forbidden");
 assert(!process.execArgv.some(arg=>/^(?:--(?:import|require|loader|experimental-loader)(?:=|$)|-r)/u.test(arg)),"Executable Node preload arguments forbidden");
 assert.equal(resolve(root,"scripts/release-identity-proof.mjs"),fileURLToPath(import.meta.url),"Executing verifier is outside requested repository");
 for(const identity of Object.values(fixed)) {
  assert.equal(git(root,"rev-parse",identity.commit+"^{commit}").trim(),identity.commit);
  assert.equal(git(root,"rev-parse",identity.commit+"^{tree}").trim(),identity.tree,"Pinned tree mismatch");
 }
 const commit=git(root,"rev-parse","HEAD").trim();
 assertIdentityAncestor(root,fixed.backend.commit,fixed.artifact.commit);
 assertIdentityAncestor(root,fixed.artifact.commit,fixed.baselineOperator.commit);
 assertIdentityAncestor(root,fixed.baselineOperator.commit,commit);
 const artifact=readIdentityTree(root,fixed.artifact.commit);
 const backend=readIdentityTree(root,fixed.backend.commit);
 const backendDelta=identityTreeDelta(backend,artifact,new Set(backendArtifactDelta.map(r=>r.path)));
 assert.deepEqual(backendDelta,backendArtifactDelta,"Pinned backend/artifact delta mismatch");
 const baselineOperatorTree=readIdentityTree(root,fixed.baselineOperator.commit);
 const baseline=identityTreeDelta(artifact,baselineOperatorTree,new Set(baselineDelta.map(r=>r.path)));
 assert.deepEqual(baseline,baselineDelta,"Pinned baseline delta mismatch");
 const operatorTree=readIdentityTree(root,commit);
 const delta=identityTreeDelta(baselineOperatorTree,operatorTree,operatorPaths);
 for(const row of delta) assert(row.after&&row.after.type==="blob"&&["100644","100755"].includes(row.after.mode),"Operator may not remove or change file type");
 const before=inspectIdentitySource(root,commit,closurePaths);
 const verifiedAt=new Date(now).toISOString();
 const result={
  format:"proof-of-work-explicit-release-identities-v1",repository:root,verifiedAt,
  artifact:{...fixed.artifact},baselineOperator:{...fixed.baselineOperator},backend:{...fixed.backend},
  operator:{commit,tree:before.tree},
  backendArtifactDelta:backendDelta,baselineDelta:baseline,operatorDelta:delta,
  digests:{backendArtifactDeltaSha256:digest(backendDelta),baselineDeltaSha256:digest(baseline),operatorDeltaSha256:digest(delta),executableClosureSha256:digest(before.files)},
 };
 assertIdentityStable(before,inspectIdentitySource(root,commit,closurePaths));
 deepFreeze(result);proofs.add(result);return result;
}
export function requireIdentityProof(proof) {
 assert(proof&&proofs.has(proof),"Authentic in-process identity proof required");
 return proof;
}
export function publicIdentityProof(proof) {
 return JSON.parse(JSON.stringify(requireIdentityProof(proof)));
}
