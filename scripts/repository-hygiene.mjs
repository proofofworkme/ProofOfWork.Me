#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_PATH = "repository-hygiene.json";
const NOTE_EXTENSIONS = new Set([".md", ".mdc"]);
const TRAILER_DOCUMENTATION = "Documentation-Impact";
const TRAILER_HYGIENE = "Repository-Hygiene";
const TRAILER_REMOVED = "Repository-Hygiene-Removed";
const TRAILER_PROTECTED_REMOVAL = "Repository-Hygiene-Protected-Removal";
const REQUIRED_SAFE_CLEANUP_PATHS = new Set([
  "dist",
  ".vite",
  ".pow-api-cache",
  "node_modules/.vite",
  "node_modules/.vite-temp",
  "coverage",
  "playwright-report",
  "test-results",
]);
const REQUIRED_SAFE_CLEANUP_ROOT_PATTERNS = new Set([
  "^npm-debug\\.log.*$",
  "^dev-server\\..*\\.log$",
]);
const REQUIRED_DOCUMENTS = new Set([
  "SOUL.md",
  "README.md",
  "PROOFOFWORK_IDS.md",
  "MARKETPLACE.md",
  "OP_RETURN_INFRASTRUCTURE.md",
  "MAIL_ORGANIZATION.md",
  "REPOSITORY_HYGIENE.md",
]);
const REQUIRED_AGENT_INSTRUCTION_FILES = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
  ".cursor/rules/proofofwork-soul.mdc",
  ".github/copilot-instructions.md",
]);
const REQUIRED_FORBIDDEN_TRACKED_PREFIXES = new Set([
  "dist/",
  ".vite/",
  ".pow-api-cache/",
  "node_modules/",
  "coverage/",
  "playwright-report/",
  "test-results/",
  "output/screenshots/",
  "output/id-map/",
]);
const REQUIRED_FORBIDDEN_TRACKED_BASENAMES = new Set([
  ".DS_Store",
  "Thumbs.db",
]);
const REQUIRED_FORBIDDEN_TRACKED_EXTENSIONS = new Set([
  ".tmp",
  ".temp",
  ".bak",
  ".old",
  ".orig",
  ".rej",
  ".log",
]);
const REQUIRED_PROTECTED_TRACKED_PATHS = new Set([
  "WORK_MARKET_V1_REFUNDS_959061.json",
  "BUG_BOUNTY_LEDGER.md",
  "ID_REFUNDS.md",
  "TREASURY_LEDGER.md",
]);
const REQUIRED_PROTECTED_TRACKED_PREFIXES = new Set([
  "output/",
  "public/",
  "deploy/",
]);
const REQUIRED_GENERATED_ARTIFACTS = new Set([
  [
    "scripts/build-general-deck.mjs",
    "PROOFOFWORK_GENERAL_DECK.md",
    "output/proofofwork-general-deck.pptx," +
      "public/proofofwork-general-deck.pptx",
  ].join("|"),
  [
    "scripts/generate-proofofwork-computer-model.mjs",
    "",
    "output/proofofwork-computer-agent-adoption-model.md," +
      "output/proofofwork-computer-growth-model.json," +
      "output/proofofwork-computer-model-blockspace.svg," +
      "output/proofofwork-computer-model-compounding.svg," +
      "output/proofofwork-computer-model-dollar-growth.svg," +
      "output/proofofwork-computer-model-product-split.svg," +
      "output/proofofwork-computer-model-volatility.svg",
  ].join("|"),
]);
const REQUIRED_HOOK_CONTENT = new Map([
  [
    ".githooks/pre-commit",
    [
      "#!/bin/sh",
      "set -eu",
      "",
      "repository_root=$(git rev-parse --show-toplevel)",
      'cd "$repository_root"',
      "exec node scripts/repository-hygiene.mjs pre-commit",
      "",
    ].join("\n"),
  ],
  [
    ".githooks/prepare-commit-msg",
    [
      "#!/bin/sh",
      "set -eu",
      "",
      "repository_root=$(git rev-parse --show-toplevel)",
      'cd "$repository_root"',
      'exec node scripts/repository-hygiene.mjs prepare-commit-msg "$@"',
      "",
    ].join("\n"),
  ],
  [
    ".githooks/commit-msg",
    [
      "#!/bin/sh",
      "set -eu",
      "",
      "repository_root=$(git rev-parse --show-toplevel)",
      'cd "$repository_root"',
      'exec node scripts/repository-hygiene.mjs commit-msg "$1"',
      "",
    ].join("\n"),
  ],
]);
const REQUIRED_HYGIENE_CONTROL_FILES = [
  "scripts/repository-hygiene.mjs",
  "scripts/install-repository-hooks.mjs",
  "scripts/repository-hygiene.test.mjs",
];
const INDEX_PARITY_FILES = [
  CONFIG_PATH,
  "REPOSITORY_HYGIENE.md",
  ...REQUIRED_HYGIENE_CONTROL_FILES,
  ...REQUIRED_HOOK_CONTENT.keys(),
];

function runGit(root, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: options.encoding === null ? null : "utf8",
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.status !== 0 && !options.allowFailure) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8").trim()
      : result.stderr.trim();
    throw new Error(stderr || `git ${args.join(" ")} failed`);
  }

  return result;
}

function findRepositoryRoot() {
  const result = runGit(process.cwd(), ["rev-parse", "--show-toplevel"], {
    allowFailure: true,
  });
  if (result.status !== 0) {
    throw new Error("Repository hygiene must run inside a Git checkout.");
  }
  return realpathSync(result.stdout.trim());
}

function splitNull(value) {
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : value;
  return text.split("\0").filter(Boolean);
}

function repositoryPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    path.posix.isAbsolute(value) ||
    value.includes("\\")
  ) {
    throw new Error(`Invalid repository-relative path: ${String(value)}`);
  }

  const normalized = path.posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Path escapes the repository: ${value}`);
  }
  return normalized.replace(/^\.\//, "");
}

function isNote(file) {
  return (
    file === ".cursorrules" ||
    NOTE_EXTENSIONS.has(path.posix.extname(file).toLowerCase())
  );
}

function pathEntryExists(target) {
  try {
    lstatSync(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

function workingTreeFiles(root) {
  const candidates = splitNull(
    runGit(root, [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ]).stdout,
  );
  return candidates.filter((file) => pathEntryExists(path.join(root, file)));
}

function indexFiles(root) {
  return splitNull(runGit(root, ["ls-files", "-z"]).stdout);
}

function commitFiles(root, revision) {
  return splitNull(
    runGit(root, ["ls-tree", "-r", "--name-only", "-z", revision]).stdout,
  );
}

function trackedWorkingFiles(root) {
  return indexFiles(root).filter((file) =>
    pathEntryExists(path.join(root, file)),
  );
}

function readStateBuffer(root, mode, file, revision) {
  if (mode === "index") {
    const result = runGit(root, ["show", `:${file}`], {
      allowFailure: true,
      encoding: null,
    });
    if (result.status !== 0) {
      throw new Error(`Missing from staged tree: ${file}`);
    }
    return result.stdout;
  }
  if (mode === "commit") {
    const result = runGit(root, ["show", `${revision}:${file}`], {
      allowFailure: true,
      encoding: null,
    });
    if (result.status !== 0) {
      throw new Error(`Missing from commit ${revision}: ${file}`);
    }
    return result.stdout;
  }
  return readFileSync(path.join(root, file));
}

function readStateText(root, mode, file, revision) {
  return readStateBuffer(root, mode, file, revision).toString("utf8");
}

function stateFileMode(root, mode, file, revision) {
  if (mode === "worktree") {
    const info = lstatSync(path.join(root, file));
    if (info.isSymbolicLink()) return "120000";
    if (info.isDirectory()) return "040000";
    return (info.mode & 0o111) !== 0 ? "100755" : "100644";
  }
  const args =
    mode === "index"
      ? ["ls-files", "--stage", "--", file]
      : ["ls-tree", revision, "--", file];
  return runGit(root, args, { allowFailure: true })
    .stdout.trim()
    .split(/\s+/, 1)[0];
}

function stateFor(root, mode, revision) {
  const files =
    mode === "index"
      ? indexFiles(root)
      : mode === "commit"
        ? commitFiles(root, revision)
        : workingTreeFiles(root);
  return {
    files: new Set(files),
    trackedFiles: new Set(
      mode === "worktree" ? trackedWorkingFiles(root) : files,
    ),
    readBuffer(file) {
      return readStateBuffer(root, mode, file, revision);
    },
    readText(file) {
      return readStateText(root, mode, file, revision);
    },
    fileMode(file) {
      return stateFileMode(root, mode, file, revision);
    },
  };
}

function loadConfig(root, mode, revision) {
  let parsed;
  try {
    parsed = JSON.parse(readStateText(root, mode, CONFIG_PATH, revision));
  } catch (error) {
    throw new Error(`Cannot load ${CONFIG_PATH}: ${error.message}`);
  }

  if (parsed.version !== 1) {
    throw new Error(`${CONFIG_PATH} has unsupported version '${parsed.version}'.`);
  }
  return parsed;
}

function pathMatchesPrefix(file, prefix) {
  const normalizedPrefix = repositoryPath(prefix).replace(/\/?$/, "/");
  return (
    file === normalizedPrefix.slice(0, -1) || file.startsWith(normalizedPrefix)
  );
}

function extractMarkdownTargets(text) {
  const targets = [];
  const inline = /!?\[[^\]]*]\(([^)\n]+)\)/g;
  const reference = /^\s*\[[^\]]+]:\s*(\S+)/gm;
  let match;

  while ((match = inline.exec(text))) {
    let target = match[1].trim();
    if (target.startsWith("<")) {
      const close = target.indexOf(">");
      target = close === -1 ? target : target.slice(1, close);
    } else {
      target = target.split(/\s+["'(]/, 1)[0];
    }
    targets.push(target);
  }

  while ((match = reference.exec(text))) {
    targets.push(match[1].replace(/^<|>$/g, ""));
  }
  return targets;
}

function localMarkdownTarget(source, rawTarget) {
  const target = rawTarget.trim();
  if (
    !target ||
    target.startsWith("#") ||
    target.startsWith("/") ||
    target.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  ) {
    return null;
  }

  const withoutFragment = target.split("#", 1)[0].split("?", 1)[0];
  if (!withoutFragment) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    decoded = withoutFragment;
  }

  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(source), decoded),
  );
  if (resolved === ".." || resolved.startsWith("../")) {
    return { error: `target escapes the repository: ${rawTarget}` };
  }
  return { file: resolved.replace(/^\.\//, "") };
}

function validateInventory(config, state, errors) {
  const classified = new Map();

  for (const [category, entries] of Object.entries(config.noteInventory ?? {})) {
    if (!Array.isArray(entries)) {
      errors.push(`noteInventory.${category} must be an array.`);
      continue;
    }
    for (const rawFile of entries) {
      let file;
      try {
        file = repositoryPath(rawFile);
      } catch (error) {
        errors.push(error.message);
        continue;
      }
      const categories = classified.get(file) ?? [];
      categories.push(category);
      classified.set(file, categories);
    }
  }

  for (const file of [...state.files].filter(isNote).sort()) {
    const categories = classified.get(file) ?? [];
    if (categories.length === 0) {
      errors.push(`Unclassified tracked note: ${file}`);
    } else if (categories.length > 1) {
      errors.push(
        `Note is classified more than once (${categories.join(", ")}): ${file}`,
      );
    }
  }

  for (const [file, categories] of [...classified].sort()) {
    if (!state.files.has(file)) {
      errors.push(
        `Note inventory points to a missing file (${categories.join(", ")}): ${file}`,
      );
    }
  }
}

function validateRequiredDocuments(config, state, errors) {
  for (const rawFile of config.requiredDocuments ?? []) {
    const file = repositoryPath(rawFile);
    if (!state.files.has(file)) {
      errors.push(`Required document is missing: ${file}`);
    }
  }
}

function validateAgentInstructions(config, state, errors) {
  for (const rawFile of config.agentInstructionFiles ?? []) {
    const file = repositoryPath(rawFile);
    if (!state.files.has(file)) {
      errors.push(`Agent instruction file is missing: ${file}`);
      continue;
    }
    if (!state.readText(file).includes("REPOSITORY_HYGIENE.md")) {
      errors.push(
        `Agent instruction file does not require REPOSITORY_HYGIENE.md: ${file}`,
      );
    }
  }
}

function validateMarkdownLinks(state, errors) {
  for (const source of [...state.files].filter(isNote).sort()) {
    const text = state.readText(source);
    for (const rawTarget of extractMarkdownTargets(text)) {
      const local = localMarkdownTarget(source, rawTarget);
      if (!local) continue;
      if (local.error) {
        errors.push(`${source}: ${local.error}`);
        continue;
      }

      const target = local.file;
      const targetIsDirectory = [...state.files].some((file) =>
        file.startsWith(`${target.replace(/\/$/, "")}/`),
      );
      if (!state.files.has(target) && !targetIsDirectory) {
        errors.push(`${source}: broken relative link '${rawTarget}'`);
      }
    }
  }
}

function validateTrackedTransientFiles(config, state, errors) {
  const prefixes = config.forbiddenTrackedPrefixes ?? [];
  const basenames = new Set(config.forbiddenTrackedBasenames ?? []);
  const extensions = new Set(config.forbiddenTrackedExtensions ?? []);

  for (const file of [...state.trackedFiles].sort()) {
    const prefix = prefixes.find((candidate) =>
      pathMatchesPrefix(file, candidate),
    );
    if (prefix) {
      errors.push(`Tracked rebuildable/transient path is forbidden: ${file}`);
      continue;
    }
    if (basenames.has(path.posix.basename(file))) {
      errors.push(`Tracked transient filename is forbidden: ${file}`);
      continue;
    }
    if (extensions.has(path.posix.extname(file).toLowerCase())) {
      errors.push(`Tracked transient extension is forbidden: ${file}`);
    }
  }
}

function validateTrackedSymlinks(state, errors) {
  for (const file of [...state.trackedFiles].sort()) {
    if (state.fileMode(file) === "120000") {
      errors.push(`Tracked symbolic links are forbidden: ${file}`);
    }
  }
}

function exactConfiguredSetErrors(name, configured, required, normalize) {
  const errors = [];
  if (!Array.isArray(configured)) {
    return [`${name} must be an array.`];
  }

  const values = [];
  for (const rawValue of configured) {
    try {
      values.push(normalize(rawValue));
    } catch (error) {
      errors.push(error.message);
    }
  }

  const duplicates = values.filter(
    (value, index) => values.indexOf(value) !== index,
  );
  const actual = [...new Set(values)].sort();
  const expected = [...required].sort();
  if (duplicates.length > 0 || !arraysEqual(actual, expected)) {
    errors.push(
      `${name} must exactly match the hardcoded policy. Expected ` +
        `[${expected.join(", ")}], received [${actual.join(", ")}].`,
    );
  }
  return errors;
}

function normalizeGeneratedArtifactPolicy(group) {
  if (!group || typeof group !== "object" || Array.isArray(group)) {
    throw new Error("Each generatedArtifacts entry must be an object.");
  }
  if (!Array.isArray(group.inputs ?? []) || !Array.isArray(group.outputs)) {
    throw new Error(
      "Each generatedArtifacts entry needs inputs and outputs arrays.",
    );
  }
  const generator = repositoryPath(group.generator);
  const inputs = (group.inputs ?? []).map(repositoryPath);
  const outputs = group.outputs.map(repositoryPath);
  if (
    new Set(inputs).size !== inputs.length ||
    new Set(outputs).size !== outputs.length
  ) {
    throw new Error(`Generated artifact paths must be unique: ${generator}`);
  }
  return [
    generator,
    [...inputs].sort().join(","),
    [...outputs].sort().join(","),
  ].join("|");
}

function policyConfigurationErrors(config) {
  return [
    ...exactConfiguredSetErrors(
      "requiredDocuments",
      config.requiredDocuments,
      REQUIRED_DOCUMENTS,
      repositoryPath,
    ),
    ...exactConfiguredSetErrors(
      "agentInstructionFiles",
      config.agentInstructionFiles,
      REQUIRED_AGENT_INSTRUCTION_FILES,
      repositoryPath,
    ),
    ...exactConfiguredSetErrors(
      "safeCleanupPaths",
      config.safeCleanupPaths,
      REQUIRED_SAFE_CLEANUP_PATHS,
      repositoryPath,
    ),
    ...exactConfiguredSetErrors(
      "safeCleanupRootPatterns",
      config.safeCleanupRootPatterns,
      REQUIRED_SAFE_CLEANUP_ROOT_PATTERNS,
      (value) => {
        if (typeof value !== "string") {
          throw new Error(`Invalid cleanup pattern: ${String(value)}`);
        }
        return value;
      },
    ),
    ...exactConfiguredSetErrors(
      "forbiddenTrackedPrefixes",
      config.forbiddenTrackedPrefixes,
      REQUIRED_FORBIDDEN_TRACKED_PREFIXES,
      (value) => `${repositoryPath(value).replace(/\/+$/, "")}/`,
    ),
    ...exactConfiguredSetErrors(
      "forbiddenTrackedBasenames",
      config.forbiddenTrackedBasenames,
      REQUIRED_FORBIDDEN_TRACKED_BASENAMES,
      (value) => {
        if (typeof value !== "string" || value.includes("/")) {
          throw new Error(`Invalid forbidden basename: ${String(value)}`);
        }
        return value;
      },
    ),
    ...exactConfiguredSetErrors(
      "forbiddenTrackedExtensions",
      config.forbiddenTrackedExtensions,
      REQUIRED_FORBIDDEN_TRACKED_EXTENSIONS,
      (value) => {
        if (typeof value !== "string" || !value.startsWith(".")) {
          throw new Error(`Invalid forbidden extension: ${String(value)}`);
        }
        return value.toLowerCase();
      },
    ),
    ...exactConfiguredSetErrors(
      "protectedTrackedPaths",
      config.protectedTrackedPaths,
      REQUIRED_PROTECTED_TRACKED_PATHS,
      repositoryPath,
    ),
    ...exactConfiguredSetErrors(
      "protectedTrackedPrefixes",
      config.protectedTrackedPrefixes,
      REQUIRED_PROTECTED_TRACKED_PREFIXES,
      (value) => `${repositoryPath(value).replace(/\/+$/, "")}/`,
    ),
    ...exactConfiguredSetErrors(
      "generatedArtifacts",
      config.generatedArtifacts,
      REQUIRED_GENERATED_ARTIFACTS,
      normalizeGeneratedArtifactPolicy,
    ),
  ];
}

function validateHookFiles(state, errors) {
  for (const [file, expectedContent] of REQUIRED_HOOK_CONTENT) {
    if (!state.files.has(file)) {
      errors.push(`Tracked Git hook is missing: ${file}`);
      continue;
    }
    if (state.fileMode(file) !== "100755") {
      errors.push(`Tracked Git hook is not executable: ${file}`);
    }
    if (state.readText(file) !== expectedContent) {
      errors.push(`Tracked Git hook wrapper has unexpected content: ${file}`);
    }
  }
}

function validateControlPlaneSyntax(state, errors) {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "proofofwork-control-plane-"),
  );
  try {
    for (const file of REQUIRED_HYGIENE_CONTROL_FILES) {
      if (!state.files.has(file)) {
        errors.push(`Repository hygiene control file is missing: ${file}`);
        continue;
      }
      const temporaryFile = path.join(
        temporaryRoot,
        file.replaceAll("/", "__"),
      );
      writeFileSync(temporaryFile, state.readBuffer(file));
      const checked = spawnSync(process.execPath, ["--check", temporaryFile], {
        encoding: "utf8",
      });
      if (checked.status !== 0) {
        errors.push(
          `Repository hygiene control file has invalid syntax: ${file}: ` +
            `${checked.stderr.trim() || checked.stdout.trim()}`,
        );
      }
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function validateControlPlaneIndexParity(root) {
  const result = runGit(
    root,
    ["diff", "--quiet", "--", ...INDEX_PARITY_FILES],
    { allowFailure: true },
  );
  if (result.status === 1) {
    throw new Error(
      "Repository hygiene control files are partially staged. Stage their " +
        "complete working-tree versions before committing.",
    );
  }
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() ||
        "Unable to compare repository hygiene control files with the index.",
    );
  }
}

function validateLocalHookConfiguration(root, errors) {
  const result = runGit(
    root,
    ["config", "--local", "--get", "core.hooksPath"],
    { allowFailure: true },
  );
  const configured = result.status === 0 ? result.stdout.trim() : "";
  if (configured !== ".githooks") {
    errors.push(
      "Local Git hooks are not active; run `npm run hooks:install`.",
    );
  }
}

function validateGeneratedArtifacts(root, mode, config, state, errors) {
  for (const group of config.generatedArtifacts ?? []) {
    const generator = repositoryPath(group.generator);
    if (!state.files.has(generator)) {
      errors.push(`Generated-artifact source is missing: ${generator}`);
      continue;
    }

    const temporaryRoot = mkdtempSync(
      path.join(tmpdir(), "proofofwork-hygiene-"),
    );
    try {
      const temporaryGenerator = path.join(temporaryRoot, generator);
      mkdirSync(path.dirname(temporaryGenerator), { recursive: true });
      writeFileSync(temporaryGenerator, state.readBuffer(generator));

      let missingInput = false;
      for (const rawInput of group.inputs ?? []) {
        const input = repositoryPath(rawInput);
        if (!state.files.has(input)) {
          errors.push(`Generated-artifact input is missing: ${input}`);
          missingInput = true;
          continue;
        }
        const temporaryInput = path.join(temporaryRoot, input);
        mkdirSync(path.dirname(temporaryInput), { recursive: true });
        writeFileSync(temporaryInput, state.readBuffer(input));
      }
      if (missingInput) continue;

      for (const rawOutput of group.outputs ?? []) {
        const output = repositoryPath(rawOutput);
        mkdirSync(path.dirname(path.join(temporaryRoot, output)), {
          recursive: true,
        });
      }

      const generated = spawnSync(process.execPath, [generator], {
        cwd: temporaryRoot,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      if (generated.status !== 0) {
        errors.push(
          `Generated-artifact check failed for ${generator}: ${
            generated.stderr.trim() || generated.stdout.trim()
          }`,
        );
        continue;
      }

      for (const rawOutput of group.outputs ?? []) {
        const output = repositoryPath(rawOutput);
        const temporaryOutput = path.join(temporaryRoot, output);
        if (!existsSync(temporaryOutput)) {
          errors.push(`${generator} did not produce declared output: ${output}`);
          continue;
        }
        if (!state.files.has(output)) {
          errors.push(`Generated output is missing: ${output}`);
          continue;
        }

        const expected = readFileSync(temporaryOutput);
        const actual = state.readBuffer(output);
        if (!expected.equals(actual)) {
          errors.push(
            `Generated output is stale: ${output} (run node ${generator})`,
          );
        }
      }
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}

function validateRepositoryState(
  root,
  mode,
  { ci = false, revision } = {},
) {
  const state = stateFor(root, mode, revision);
  const errors = [];
  validateTrackedSymlinks(state, errors);
  if (errors.length > 0) return errors;

  const config = loadConfig(root, mode, revision);
  validateRequiredDocuments(config, state, errors);
  validateInventory(config, state, errors);
  validateAgentInstructions(config, state, errors);
  validateMarkdownLinks(state, errors);
  validateTrackedTransientFiles(config, state, errors);
  errors.push(...policyConfigurationErrors(config));
  validateHookFiles(state, errors);
  validateControlPlaneSyntax(state, errors);
  validateGeneratedArtifacts(root, mode, config, state, errors);
  if (!ci && mode === "worktree") {
    validateLocalHookConfiguration(root, errors);
  }

  return errors;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function decodeMountInfoPath(value) {
  return value.replace(/\\([0-7]{3})/g, (_match, octal) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  );
}

function cleanupMountPoints() {
  const mountPoints = new Set();
  const mountInfoPath = "/proc/self/mountinfo";

  if (existsSync(mountInfoPath)) {
    const mountInfo = readFileSync(mountInfoPath, "utf8");
    for (const line of mountInfo.split("\n")) {
      if (!line) continue;
      const separator = line.indexOf(" - ");
      if (separator === -1) {
        throw new Error(`Cannot parse mount information: ${line}`);
      }
      const fields = line.slice(0, separator).split(" ");
      if (fields.length < 5) {
        throw new Error(`Cannot parse mount information: ${line}`);
      }
      mountPoints.add(path.resolve(decodeMountInfoPath(fields[4])));
    }
  }

  return mountPoints;
}

function inspectTree(target, expectedDevice, mountPoints) {
  const info = lstatSync(target);
  if (info.isSymbolicLink()) {
    return { bytes: 0, unsafe: target, reason: "symlink" };
  }
  if (info.dev !== expectedDevice || mountPoints.has(path.resolve(target))) {
    return { bytes: 0, unsafe: target, reason: "mount boundary" };
  }
  if (!info.isDirectory()) {
    return { bytes: info.size, unsafe: null, reason: null };
  }

  let bytes = 0;
  for (const entry of readdirSync(target)) {
    const child = inspectTree(
      path.join(target, entry),
      expectedDevice,
      mountPoints,
    );
    if (child.unsafe) return child;
    bytes += child.bytes;
  }
  return { bytes, unsafe: null, reason: null };
}

function removeInspectedTree(target, expectedDevice, mountPoints) {
  const info = lstatSync(target);
  if (
    info.isSymbolicLink() ||
    info.dev !== expectedDevice ||
    mountPoints.has(path.resolve(target))
  ) {
    throw new Error(`Cleanup boundary changed while removing ${target}`);
  }
  if (!info.isDirectory()) {
    unlinkSync(target);
    return;
  }

  for (const entry of readdirSync(target)) {
    removeInspectedTree(
      path.join(target, entry),
      expectedDevice,
      mountPoints,
    );
  }
  rmdirSync(target);
}

function pathHasSymlink(root, target) {
  const relative = path.relative(root, target);
  let current = root;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      return current;
    }
  }
  return null;
}

function cleanCandidate(
  root,
  relative,
  removed,
  errors,
  mountPoints = cleanupMountPoints(),
) {
  let file;
  try {
    file = repositoryPath(relative);
  } catch (error) {
    errors.push(error.message);
    return;
  }

  const target = path.resolve(root, file);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    errors.push(`Cleanup target is outside the repository: ${file}`);
    return;
  }
  if (!existsSync(target)) return;

  const parentSymlink = pathHasSymlink(root, target);
  if (parentSymlink) {
    errors.push(
      `Refusing cleanup through symlink: ${path.relative(root, parentSymlink)}`,
    );
    return;
  }

  const tracked = runGit(root, ["ls-files", "-z", "--", file]).stdout;
  if (tracked.length > 0) {
    errors.push(`Refusing cleanup of tracked path: ${file}`);
    return;
  }

  const ignored = runGit(
    root,
    ["check-ignore", "-q", "--no-index", "--", file],
    { allowFailure: true },
  );
  if (ignored.status !== 0) {
    errors.push(`Refusing cleanup of non-ignored path: ${file}`);
    return;
  }

  const expectedDevice = lstatSync(root).dev;
  const inspected = inspectTree(target, expectedDevice, mountPoints);
  if (inspected.unsafe) {
    errors.push(
      `Refusing cleanup because it contains a ${inspected.reason}: ${path.relative(
        root,
        inspected.unsafe,
      )}`,
    );
    return;
  }

  removeInspectedTree(target, expectedDevice, mountPoints);
  removed.push({ file, bytes: inspected.bytes });
}

function cleanRepository(root, config) {
  const removed = [];
  const errors = [];
  const configurationErrors = policyConfigurationErrors(config);
  if (configurationErrors.length > 0) {
    throw new Error(configurationErrors.join("\n"));
  }

  const candidates = new Set(REQUIRED_SAFE_CLEANUP_PATHS);

  for (const expression of REQUIRED_SAFE_CLEANUP_ROOT_PATTERNS) {
    let pattern;
    try {
      pattern = new RegExp(expression);
    } catch (error) {
      errors.push(`Invalid cleanup pattern '${expression}': ${error.message}`);
      continue;
    }
    for (const entry of readdirSync(root)) {
      if (pattern.test(entry)) candidates.add(entry);
    }
  }

  for (const candidate of [...candidates].sort()) {
    cleanCandidate(root, candidate, removed, errors);
  }

  if (removed.length === 0) {
    console.log("Repository hygiene: no allowlisted rebuildable state found.");
  } else {
    const total = removed.reduce((sum, item) => sum + item.bytes, 0);
    for (const item of removed) {
      console.log(`Removed ${item.file} (${formatBytes(item.bytes)})`);
    }
    console.log(
      `Repository hygiene removed ${removed.length} path(s), ${formatBytes(total)} total.`,
    );
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}

function changedPathsFromIndex(
  root,
  filter,
  { findRenames = true, base } = {},
) {
  const args = [
    "diff",
    "--cached",
    "--name-only",
    "-z",
  ];
  args.push(findRenames ? "--find-renames" : "--no-renames");
  if (filter) args.push(`--diff-filter=${filter}`);
  if (base) args.push(base);
  args.push("--");
  return splitNull(runGit(root, args).stdout);
}

function commitContextPath(root) {
  const result = runGit(root, [
    "rev-parse",
    "--git-path",
    "REPOSITORY_HYGIENE_COMMIT_CONTEXT",
  ]);
  const gitPath = result.stdout.trim();
  return path.isAbsolute(gitPath) ? gitPath : path.join(root, gitPath);
}

function prepareCommitMessageContext(root, source, revision) {
  const contextPath = commitContextPath(root);
  rmSync(contextPath, { force: true });
  if (source !== "commit" || !revision) return;

  const head = runGit(root, ["rev-parse", "HEAD"]).stdout.trim();
  const reused = runGit(root, ["rev-parse", revision]).stdout.trim();
  if (head !== reused) return;

  const parent = runGit(root, ["rev-parse", `${head}^`], {
    allowFailure: true,
  });
  if (parent.status !== 0) {
    throw new Error(
      "Amending the repository root commit is not supported by the hygiene hook.",
    );
  }
  writeFileSync(
    contextPath,
    `${JSON.stringify({ mode: "amend", base: parent.stdout.trim() })}\n`,
    { mode: 0o600 },
  );
}

function consumeCommitContext(root) {
  const contextPath = commitContextPath(root);
  if (!existsSync(contextPath)) return null;
  try {
    const context = JSON.parse(readFileSync(contextPath, "utf8"));
    if (
      context?.mode !== "amend" ||
      typeof context.base !== "string" ||
      !validCommit(root, context.base)
    ) {
      throw new Error("Invalid repository hygiene commit context.");
    }
    return context;
  } finally {
    rmSync(contextPath, { force: true });
  }
}

function parsedTrailers(root, message) {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "proofofwork-trailers-"),
  );
  const messagePath = path.join(temporaryRoot, "message.txt");
  let parsed;
  try {
    writeFileSync(messagePath, message);
    parsed = runGit(root, [
      "interpret-trailers",
      "--parse",
      messagePath,
    ]).stdout;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
  const trailers = new Map();
  for (const line of parsed.split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const values = trailers.get(key) ?? [];
    values.push(match[2].trim());
    trailers.set(key, values);
  }
  return trailers;
}

function trailerValues(trailers, name) {
  return trailers.get(name.toLowerCase()) ?? [];
}

function arraysEqual(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isProtectedTrackedPath(file) {
  return (
    REQUIRED_PROTECTED_TRACKED_PATHS.has(file) ||
    [...REQUIRED_PROTECTED_TRACKED_PREFIXES].some((prefix) =>
      pathMatchesPrefix(file, prefix),
    )
  );
}

function validateCommitContract(
  root,
  message,
  changed,
  deleted,
  protectedDepartures,
  label,
) {
  const errors = [];
  const trailers = parsedTrailers(root, message);
  const hygiene = trailerValues(trailers, TRAILER_HYGIENE);
  const documentation = trailerValues(trailers, TRAILER_DOCUMENTATION);
  const removed = trailerValues(trailers, TRAILER_REMOVED).sort();
  const protectedRemoval = trailerValues(
    trailers,
    TRAILER_PROTECTED_REMOVAL,
  ).sort();
  const expectedRemoved = [...deleted].sort();
  const expectedProtectedRemoval = protectedDepartures
    .filter(isProtectedTrackedPath)
    .sort();

  if (hygiene.length !== 1 || hygiene[0] !== "reviewed") {
    errors.push(
      `${label}: requires exactly '${TRAILER_HYGIENE}: reviewed'.`,
    );
  }

  if (
    documentation.length !== 1 ||
    !["updated", "reviewed-no-change"].includes(documentation[0])
  ) {
    errors.push(
      `${label}: requires exactly one '${TRAILER_DOCUMENTATION}: updated' or ` +
        `'${TRAILER_DOCUMENTATION}: reviewed-no-change'.`,
    );
  }

  const noteChanged = changed.some(isNote);
  if (documentation[0] === "updated" && !noteChanged) {
    errors.push(
      `${label}: '${TRAILER_DOCUMENTATION}: updated' requires a note/document change.`,
    );
  }
  if (documentation[0] === "reviewed-no-change" && noteChanged) {
    errors.push(
      `${label}: note/document changes require '${TRAILER_DOCUMENTATION}: updated'.`,
    );
  }

  if (!arraysEqual(removed, expectedRemoved)) {
    errors.push(
      `${label}: '${TRAILER_REMOVED}' trailers must exactly match deleted tracked ` +
        `paths. Expected [${expectedRemoved.join(", ")}], received [${removed.join(", ")}].`,
    );
  }

  if (!arraysEqual(protectedRemoval, expectedProtectedRemoval)) {
    errors.push(
      `${label}: '${TRAILER_PROTECTED_REMOVAL}' trailers must exactly match ` +
        `deleted protected paths and attest explicit user approval. Expected ` +
        `[${expectedProtectedRemoval.join(", ")}], received ` +
        `[${protectedRemoval.join(", ")}].`,
    );
  }

  return errors;
}

function validateCommitMessageFile(root, messageFile) {
  const context = consumeCommitContext(root);
  validateControlPlaneIndexParity(root);
  const message = readFileSync(path.resolve(root, messageFile), "utf8");
  const base = context?.base;
  const changed = changedPathsFromIndex(root, undefined, { base });
  const deleted = changedPathsFromIndex(root, "D", { base });
  const protectedDepartures = changedPathsFromIndex(root, "D", {
    findRenames: false,
    base,
  });
  const errors = validateCommitContract(
    root,
    message,
    changed,
    deleted,
    protectedDepartures,
    "Commit message",
  );
  if (errors.length > 0) throw new Error(errors.join("\n"));
  console.log("Repository hygiene: commit handoff trailers verified.");
}

function commitParents(root, commit) {
  return runGit(root, ["rev-list", "--parents", "-n", "1", commit])
    .stdout.trim()
    .split(/\s+/)
    .slice(1);
}

function commitChangedPaths(
  root,
  commit,
  filter,
  { findRenames = true } = {},
) {
  const parents = commitParents(root, commit);
  const options = [
    "--name-only",
    "-z",
    findRenames ? "--find-renames" : "--no-renames",
  ];
  if (filter) options.push(`--diff-filter=${filter}`);
  const args =
    parents.length === 0
      ? [
          "diff-tree",
          "--root",
          "--no-commit-id",
          "-r",
          ...options,
          commit,
        ]
      : ["diff", ...options, parents[0], commit, "--"];
  return splitNull(runGit(root, args).stdout);
}

function validCommit(root, value) {
  if (!value) return false;
  return (
    runGit(root, ["cat-file", "-e", `${value}^{commit}`], {
      allowFailure: true,
    }).status === 0
  );
}

function validateCommitRange(
  root,
  base,
  head,
  { requireAncestor = false } = {},
) {
  if (!validCommit(root, head)) {
    throw new Error(`Hygiene range head is not a commit: ${head}`);
  }
  if (!base || /^0+$/.test(base) || !validCommit(root, base)) {
    throw new Error(
      "Hygiene range base is unavailable; refusing a partial head-only check.",
    );
  }

  if (
    requireAncestor &&
    runGit(root, ["merge-base", "--is-ancestor", base, head], {
      allowFailure: true,
    }).status !== 0
  ) {
    throw new Error(
      "Hygiene push range is not a fast-forward; the base is not an ancestor of the head.",
    );
  }

  const commits = runGit(root, ["rev-list", "--reverse", `${base}..${head}`])
    .stdout.trim()
    .split(/\s+/)
    .filter(Boolean);
  if (commits.length === 0 && base !== head) {
    throw new Error(
      "Hygiene range contains no forward commits; refusing a backward or unrelated range.",
    );
  }

  const errors = [];
  let checked = 0;

  for (const commit of commits) {
    checked += 1;
    const message = runGit(root, ["show", "-s", "--format=%B", commit]).stdout;
    const changed = commitChangedPaths(root, commit);
    const deleted = commitChangedPaths(root, commit, "D");
    const protectedDepartures = commitChangedPaths(root, commit, "D", {
      findRenames: false,
    });
    const label = `Commit ${commit.slice(0, 12)}`;
    errors.push(
      ...validateCommitContract(
        root,
        message,
        changed,
        deleted,
        protectedDepartures,
        label,
      ),
    );

    try {
      const stateErrors = validateRepositoryState(root, "commit", {
        ci: true,
        revision: commit,
      });
      errors.push(
        ...stateErrors.map((error) => `${label} state: ${error}`),
      );
    } catch (error) {
      errors.push(`${label} state: ${error.message}`);
    }
  }

  if (errors.length > 0) throw new Error(errors.join("\n"));
  console.log(
    `Repository hygiene: verified ${checked} commit(s) in range.`,
  );
}

function printValidationResult(errors, label) {
  if (errors.length > 0) {
    throw new Error(errors.map((error) => `- ${error}`).join("\n"));
  }
  console.log(`Repository hygiene: ${label} passed.`);
}

function usage() {
  console.error(
    "Usage: node scripts/repository-hygiene.mjs " +
      "check [--ci] | clean | pre-commit | " +
      "prepare-commit-msg <file> [source] [revision] | commit-msg <file> | " +
      "range <base> <head> [--ci] [--require-ancestor]",
  );
}

function main() {
  const root = findRepositoryRoot();
  const [command, ...args] = process.argv.slice(2);
  const ci = args.includes("--ci");
  const requireAncestor =
    args.includes("--require-ancestor") ||
    process.env.HYGIENE_REQUIRE_ANCESTOR === "1";
  const positional = args.filter(
    (argument) =>
      argument !== "--ci" && argument !== "--require-ancestor",
  );

  switch (command) {
    case "check": {
      printValidationResult(
        validateRepositoryState(root, "worktree", { ci }),
        "repository state check",
      );
      break;
    }
    case "clean": {
      cleanRepository(root, loadConfig(root, "worktree"));
      break;
    }
    case "pre-commit": {
      validateControlPlaneIndexParity(root);
      cleanRepository(root, loadConfig(root, "index"));
      const diffCheck = runGit(root, ["diff", "--cached", "--check"], {
        allowFailure: true,
      });
      if (diffCheck.status !== 0) {
        throw new Error(
          diffCheck.stdout.trim() ||
            diffCheck.stderr.trim() ||
            "Staged diff whitespace check failed.",
        );
      }
      printValidationResult(
        validateRepositoryState(root, "index", { ci: true }),
        "staged tree check",
      );
      break;
    }
    case "commit-msg": {
      if (positional.length !== 1) {
        usage();
        process.exitCode = 2;
        return;
      }
      validateCommitMessageFile(root, positional[0]);
      break;
    }
    case "prepare-commit-msg": {
      if (positional.length < 1 || positional.length > 3) {
        usage();
        process.exitCode = 2;
        return;
      }
      prepareCommitMessageContext(root, positional[1], positional[2]);
      break;
    }
    case "range": {
      if (positional.length !== 2) {
        usage();
        process.exitCode = 2;
        return;
      }
      validateCommitRange(root, positional[0], positional[1], {
        requireAncestor,
      });
      break;
    }
    default:
      usage();
      process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    main();
  } catch (error) {
    console.error(`Repository hygiene failed:\n${error.message}`);
    process.exitCode = 1;
  }
}

export { cleanCandidate, inspectTree };
