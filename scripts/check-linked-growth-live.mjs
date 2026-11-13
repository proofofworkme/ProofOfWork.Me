#!/usr/bin/env node
// Read-only composition: retain both independent release gates, never activate writes.
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
export function runLinkedGrowthLive({env=process.env,run=spawnSync}={}) {
  const root=fileURLToPath(new URL("../",import.meta.url));
  for (const script of ["check-publish-linked-live.mjs","check-current-growth-live.mjs","check-activity-fee-factor-live.mjs"]) {
    const childEnv={...env};
    // Only the existing linked checker may receive private loopback verification settings.
    if(script!=="check-publish-linked-live.mjs") {
      delete childEnv.POW_INTERNAL_VERIFIER_TOKEN;
      delete childEnv.POW_PUBLISH_CHECK_ORIGIN;
      delete childEnv.POW_PUBLISH_CHECK_MODE;
    }
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
