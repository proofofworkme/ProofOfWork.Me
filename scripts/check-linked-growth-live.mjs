#!/usr/bin/env node
// Read-only composition: retain independent release gates, never activate writes.
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { publicVerificationEnvironment } from "./check-publish-linked-remote.mjs";
export function runLinkedGrowthLive({env=process.env,run=spawnSync}={}) {
  const root=fileURLToPath(new URL("../",import.meta.url));
  const linked=env.POW_PUBLISH_CHECK_MODE==="preactivation"
    ? "check-publish-linked-remote.mjs" : "check-publish-linked-live.mjs";
  for (const script of [linked,"check-current-growth-live.mjs","check-activity-fee-factor-live.mjs"]) {
    // Only the linked verifier receives mode/source configuration. Public children
    // never receive a private token, loopback origin, or remote source settings.
    const childEnv=script===linked ? {...env,GIT_OPTIONAL_LOCKS:"0"} : publicVerificationEnvironment(env);
    const result=run(process.execPath,["scripts/"+script],{
      cwd:root,env:childEnv,stdio:"inherit",timeout:600_000
    });
    if(result.error||result.signal||result.status!==0)
      throw new Error(script+" failed; combined release verification incomplete");
  }
  return {ok:true,scope:"read-only linked, current Growth and retained emergency fee gates; no activation or publication"};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {console.log(JSON.stringify(runLinkedGrowthLive()));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
