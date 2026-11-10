import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Browser evidence stays on the build VPS, including when release-sync runs
// from the operator's primary checkout. The test source must match this release.
const root = process.env.POW_UI_REVIEW_CHECK_ROOT;
if (!root || !/^\/var\/tmp\/[a-zA-Z0-9_-]+$/u.test(root)) {
  throw new Error("Set POW_UI_REVIEW_CHECK_ROOT to the prepared acceptance checkout on the build VPS.");
}
const files = ["src/features/boost/BoostText.tsx", "src/features/boost/boostWebLinks.mjs",
  "src/shared/components/ActionTransactionReview.tsx", "src/shared/components/TransactionReview.tsx",
  "src/features/publish/PublishComposer.tsx", ...["boost-text-links", "boost-tips", "code-ui", "jobs-ui", "permission-ui"].map(name => `tests/browser/${name}.spec.mjs`)];
const hashes = Object.fromEntries(files.map(file => [file, createHash("sha256").update(readFileSync(file)).digest("hex")]));
const program = `import hashlib,json,os,pathlib,subprocess,sys
request=json.load(sys.stdin); root=pathlib.Path(request['root']); assert root.is_dir()
for name,digest in request['hashes'].items():
 assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest, name+' differs from the release'
env={**os.environ,'PATH':'/opt/node-v24.18.0-linux-x64/bin:/usr/bin:/bin',
 'PLAYWRIGHT_BROWSERS_PATH':str(root/'browsers'),'POW_PLAYWRIGHT_CHANNEL':'chromium',
 'LD_LIBRARY_PATH':str(root/'libs/usr/lib/x86_64-linux-gnu')}
for host,specs in [('boost',['boost-text-links','boost-tips']),('code',['code-ui']),('jobs',['jobs-ui']),('permission',['permission-ui']),('computer',['boost-text-links','boost-tips','code-ui','jobs-ui','permission-ui'])]:
 env['POW_UI_BASE_URL']='https://'+host+'.proofofwork.me'
 env['POW_PLAYWRIGHT_OUTPUT_DIR']=str(root/('live-'+host))
 subprocess.run(['node','node_modules/@playwright/test/cli.js','test','--config','playwright.ui.config.mjs',*[s+'.spec.mjs' for s in specs],'--grep','web URL opens independently|review dismisses while|custom tip reviews exact','--workers=1'],cwd=root,env=env,check=True)
`;
execFileSync("ssh", ["-i", "/home/sixer/.ssh/proofofwork_node_ed25519", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=15", "powadmin@65.108.122.87",
  "sudo -n python3 -c '" + program.replaceAll("'", "'\\''") + "'"], {
  input: JSON.stringify({ root, hashes }), stdio: ["pipe", "inherit", "inherit"], timeout: 540_000,
});
