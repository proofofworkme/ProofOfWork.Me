import { chmodSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";

const ifUnset = process.argv.includes("--if-unset");

function git(args, allowFailure = false) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result;
}

const rootResult = git(["rev-parse", "--show-toplevel"], true);
if (rootResult.status !== 0) {
  console.log("Repository hooks skipped: this install is not inside a Git checkout.");
  process.exit(0);
}

const repositoryRoot = rootResult.stdout.trim();
if (realpathSync(repositoryRoot) !== realpathSync(process.cwd())) {
  console.log(
    "Repository hooks skipped: package install is not running at the Git root.",
  );
  process.exit(0);
}
if (!existsSync(`${repositoryRoot}/.git`)) {
  console.log("Repository hooks skipped: no local .git directory is available.");
  process.exit(0);
}

const hooksDirectory = `${repositoryRoot}/.githooks`;
if (!existsSync(hooksDirectory)) {
  throw new Error("Tracked hooks directory is missing: .githooks");
}
const hooksDirectoryInfo = lstatSync(hooksDirectory);
if (
  hooksDirectoryInfo.isSymbolicLink() ||
  !hooksDirectoryInfo.isDirectory() ||
  realpathSync(hooksDirectory) !== `${realpathSync(repositoryRoot)}/.githooks`
) {
  throw new Error("Tracked .githooks must be a real in-repository directory.");
}

for (const hook of ["pre-commit", "prepare-commit-msg", "commit-msg"]) {
  const hookPath = `${repositoryRoot}/.githooks/${hook}`;
  if (!existsSync(hookPath)) {
    throw new Error(`Tracked hook is missing: .githooks/${hook}`);
  }
  const hookInfo = lstatSync(hookPath);
  if (hookInfo.isSymbolicLink() || !hookInfo.isFile()) {
    throw new Error(`Tracked hook must be a regular file: .githooks/${hook}`);
  }
  chmodSync(hookPath, 0o755);
}

const currentResult = git(["config", "--get", "core.hooksPath"], true);
const current = currentResult.status === 0 ? currentResult.stdout.trim() : "";

if (current && current !== ".githooks") {
  const message =
    `Repository hooks not installed: core.hooksPath is already '${current}'. ` +
    "Review and integrate the ProofOfWork.Me hooks manually.";
  if (ifUnset) {
    console.warn(message);
    process.exit(0);
  }
  throw new Error(message);
}

if (current !== ".githooks") {
  git(["config", "--local", "core.hooksPath", ".githooks"]);
}

console.log("Repository hooks active: core.hooksPath=.githooks");
