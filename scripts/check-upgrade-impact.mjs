// Validate the staged index or the exact tree CI is reviewing, never a dirty
// working copy. Git paths are NUL-delimited and revision input is SHA-only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const surfaceHosts = {
  activity: "log", boost: "boost", browser: "browser", code: "code", computer: "computer", desktop: "desktop",
  dns: "dns", growth: "growth", id: "id", inception: "inception", infinity: "infinity", jobs: "jobs",
  landing: "www", marketplace: "amo", nft: "computer", pages: "pages", permission: "permission",
  publish: "publish", search: "search", token: "credit", wallet: "wallet", work: "work",
};
const lanes = ["wire", "indexer", "api", "backfill-reorg", "accounting", "local-signing", "files", "mail", "notifications", "compatibility"];
const slug = /^[a-z0-9][a-z0-9-]*$/u;
export function functional(path) {
  if (/(?:^|\/)(?:tests?|__tests__|fixtures)\/|\.(?:test|spec)\.[^/]+$|\.(?:md|mdc)$/u.test(path)) return false;
  if (/^(?:src|server|public|deploy)\//u.test(path)) return true;
  if (path.startsWith("scripts/")) return !/^scripts\/(?:check-|test-)/u.test(path);
  return /^(?:[^/]+\.(?:html|mjs|cjs|js|ts)|package(?:-lock)?\.json)$/u.test(path);
}
export function validateImpact(impact, has, managed = Object.keys(surfaceHosts)) {
  assert.equal(impact?.format, "pow-upgrade-impact-v1");
  assert(slug.test(impact.upgrade ?? ""), "Name the functional upgrade.");
  assert.deepEqual([...managed].sort(),Object.keys(surfaceHosts).sort(),"Update the surface inventory for the managed release family.");
  assert(Array.isArray(impact.ciTests) && impact.ciTests.length && impact.ciTests.every(path =>
    /^(?:src|server|scripts)\/[\w./-]+\.test\.mjs$/u.test(path) && !path.split("/").includes("..") && has(path)), "Declare runnable integration/regression tests.");
  const expected = [...managed,...lanes], seen = [];
  assert(Array.isArray(impact.reviews) && impact.reviews.length, "Missing impact reviews.");
  for (const row of impact.reviews) {
    assert(["affected","compatible"].includes(row.disposition), "Review each surface and dependency.");
    assert(typeof row.reason === "string" && row.reason.trim().length >= 24, "Explain the effect or compatibility boundary.");
    assert(Array.isArray(row.targets) && row.targets.length && Array.isArray(row.evidence) && row.evidence.length, "Name targets and executable evidence.");
    for (const path of row.evidence) assert(/^(?:scripts|tests|server|src|deploy)\/[\w./-]+\.(?:mjs|py|tsx?)$/u.test(path) && !path.split("/").includes("..") && has(path), "Missing evidence: " + path);
    seen.push(...row.targets);
  }
  assert.deepEqual(seen.sort(), expected.sort(), "Every managed surface and functional lane must appear exactly once.");
  assert(/^scripts\/check-[a-z0-9-]+-live\.mjs$/u.test(impact.liveCheck) && has(impact.liveCheck), "Missing executable production check.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const git = (...args) => execFileSync("git", args, {encoding:"utf8"});
  const [mode, base, head] = process.argv.slice(2);
  if (mode === "--ci-tests") {
    const impact = JSON.parse(git("show","HEAD:release-impact.json"));
    validateImpact(impact, name => git("cat-file","-t","HEAD:"+name).trim() === "blob");
    execFileSync(process.execPath,["--test",...impact.ciTests],{stdio:"inherit"});
    process.exit(0);
  }
  assert(mode === "--staged" || mode === "--range" && [base,head].every(id => /^[0-9a-f]{40}$/u.test(id)), "Use --staged or --range BASE_SHA HEAD_SHA.");
  const spec = mode === "--staged" ? ":" : head+":";
  const diff = ["diff","--name-only","--no-renames","-z",...(mode === "--staged" ? ["--cached"] : [base,head]),"--"];
  const paths = git(...diff).split("\0").filter(Boolean);
  if (paths.some(functional)) assert(paths.includes("release-impact.json"), "Functional change: update release-impact.json with cross-surface evidence.");
  if (paths.includes("release-impact.json") || paths.some(functional)) {
    const manifest = JSON.parse(git("show",spec+"release-impact.json"));
    if (paths.some(functional)) {
      const priorRef = mode === "--staged" ? "HEAD" : base;
      const prior = git("ls-tree","--name-only",priorRef,"--","release-impact.json").trim() ?
        JSON.parse(git("show",priorRef+":release-impact.json")) : null;
      if (prior) assert.notDeepEqual(manifest,prior,"Update the impact evidence; reformatting the prior release is insufficient.");
    }
    const source = git("show",spec+"deploy/publish/release.py");
    const managed = [...source.matchAll(/^SURFACES = '([^']+)'\.split\(\)|^\w+_SURFACES = \[\*\w+, '([^']+)'\]/gmu)]
      .flatMap(match => (match[1] ?? match[2]).split(" "));
    validateImpact(manifest, name => {try { return git("cat-file","-t",spec+name).trim()==="blob"; } catch { return false; }}, managed);
  }
}
