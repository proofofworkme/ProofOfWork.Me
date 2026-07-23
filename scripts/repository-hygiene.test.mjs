import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { cleanCandidate } from './repository-hygiene.mjs';

const CLI_PATH = fileURLToPath(
  new URL('./repository-hygiene.mjs', import.meta.url),
);
const SOURCE_ROOT = resolve(dirname(CLI_PATH), '..');
const INSTALLER_PATH = join(
  SOURCE_ROOT,
  'scripts',
  'install-repository-hooks.mjs',
);

const FIXTURE_CONFIG = {
  version: 1,
  requiredDocuments: [
    'SOUL.md',
    'README.md',
    'PROOFOFWORK_IDS.md',
    'MARKETPLACE.md',
    'OP_RETURN_INFRASTRUCTURE.md',
    'MAIL_ORGANIZATION.md',
    'REPOSITORY_HYGIENE.md',
  ],
  agentInstructionFiles: [
    'AGENTS.md',
    'CLAUDE.md',
    '.cursorrules',
    '.cursor/rules/proofofwork-soul.mdc',
    '.github/copilot-instructions.md',
  ],
  noteInventory: {
    canonical: [
      'SOUL.md',
      'README.md',
      'PROOFOFWORK_IDS.md',
      'MARKETPLACE.md',
      'OP_RETURN_INFRASTRUCTURE.md',
      'MAIL_ORGANIZATION.md',
      'REPOSITORY_HYGIENE.md',
    ],
    'agent-instructions': [
      'AGENTS.md',
      'CLAUDE.md',
      '.cursorrules',
      '.cursor/rules/proofofwork-soul.mdc',
      '.github/copilot-instructions.md',
    ],
    'ledger-and-audit-evidence': [],
    'staged-or-future-protocol-notes': [],
    'presentation-and-generated-notes': [
      'PROOFOFWORK_GENERAL_DECK.md',
      'output/proofofwork-computer-agent-adoption-model.md',
    ],
    'support-notes': [],
  },
  safeCleanupPaths: [
    'dist',
    '.vite',
    '.pow-api-cache',
    'node_modules/.vite',
    'node_modules/.vite-temp',
    'coverage',
    'playwright-report',
    'test-results',
  ],
  safeCleanupRootPatterns: [
    '^npm-debug\\.log.*$',
    '^dev-server\\..*\\.log$',
  ],
  forbiddenTrackedPrefixes: [
    'dist/',
    '.vite/',
    '.pow-api-cache/',
    'node_modules/',
    'coverage/',
    'playwright-report/',
    'test-results/',
    'output/screenshots/',
    'output/id-map/',
  ],
  forbiddenTrackedBasenames: ['.DS_Store', 'Thumbs.db'],
  forbiddenTrackedExtensions: [
    '.tmp',
    '.temp',
    '.bak',
    '.old',
    '.orig',
    '.rej',
    '.log',
  ],
  protectedTrackedPaths: [
    'WORK_MARKET_V1_REFUNDS_959061.json',
    'BUG_BOUNTY_LEDGER.md',
    'ID_REFUNDS.md',
    'TREASURY_LEDGER.md',
  ],
  protectedTrackedPrefixes: ['output/', 'public/', 'deploy/'],
  generatedArtifacts: [
    {
      generator: 'scripts/build-general-deck.mjs',
      inputs: ['PROOFOFWORK_GENERAL_DECK.md'],
      outputs: [
        'output/proofofwork-general-deck.pptx',
        'public/proofofwork-general-deck.pptx',
      ],
    },
    {
      generator: 'scripts/generate-proofofwork-computer-model.mjs',
      outputs: [
        'output/proofofwork-computer-agent-adoption-model.md',
        'output/proofofwork-computer-growth-model.json',
        'output/proofofwork-computer-model-blockspace.svg',
        'output/proofofwork-computer-model-compounding.svg',
        'output/proofofwork-computer-model-dollar-growth.svg',
        'output/proofofwork-computer-model-product-split.svg',
        'output/proofofwork-computer-model-volatility.svg',
      ],
    },
  ],
};

function write(root, relativePath, contents, mode) {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
  if (mode !== undefined) {
    chmodSync(absolutePath, mode);
  }
  return absolutePath;
}

function run(command, args, cwd, extraEnv = {}) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      LC_ALL: 'C',
      NO_COLOR: '1',
      ...extraEnv,
    },
  });
}

function describeResult(result) {
  return [
    `status: ${String(result.status)}`,
    result.error ? `error: ${result.error.message}` : '',
    result.stdout ? `stdout:\n${result.stdout}` : '',
    result.stderr ? `stderr:\n${result.stderr}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function expectSuccess(result, context) {
  assert.equal(
    result.status,
    0,
    `${context} should succeed\n${describeResult(result)}`,
  );
}

function expectFailure(result, context) {
  assert.notEqual(
    result.status,
    0,
    `${context} should fail\n${describeResult(result)}`,
  );
}

function git(root, ...args) {
  const result = run('git', args, root);
  expectSuccess(result, `git ${args.join(' ')}`);
  return result.stdout.trim();
}

function cli(root, ...args) {
  return run(process.execPath, [CLI_PATH, ...args], root);
}

function createFixture(t, { withObsoleteFile = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'repository-hygiene-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Repository Hygiene Test');
  git(root, 'config', 'user.email', 'hygiene@example.invalid');
  git(root, 'config', 'core.autocrlf', 'false');

  write(
    root,
    '.gitignore',
    [
      '/dist/',
      '/.vite/',
      '/.pow-api-cache/',
      '/node_modules/',
      '/coverage/',
      '/coverage',
      '/playwright-report/',
      '/test-results/',
      '/npm-debug.log*',
      '/dev-server.*.log',
      '/.env',
      '',
    ].join('\n'),
  );
  write(
    root,
    'repository-hygiene.json',
    `${JSON.stringify(FIXTURE_CONFIG, null, 2)}\n`,
  );
  write(root, 'SOUL.md', '# Fixture operating memory\n');
  write(
    root,
    'README.md',
    [
      '# Hygiene fixture',
      '',
      'See [repository hygiene](REPOSITORY_HYGIENE.md).',
      '',
    ].join('\n'),
  );
  write(root, 'REPOSITORY_HYGIENE.md', '# Repository Hygiene\n');
  write(
    root,
    'AGENTS.md',
    [
      '# Fixture agent instructions',
      '',
      'Read `REPOSITORY_HYGIENE.md` before finalizing changes.',
      '',
    ].join('\n'),
  );
  for (const document of [
    'PROOFOFWORK_IDS.md',
    'MARKETPLACE.md',
    'OP_RETURN_INFRASTRUCTURE.md',
    'MAIL_ORGANIZATION.md',
  ]) {
    write(root, document, `# ${document}\n`);
  }
  for (const instruction of [
    'CLAUDE.md',
    '.cursorrules',
    '.cursor/rules/proofofwork-soul.mdc',
    '.github/copilot-instructions.md',
  ]) {
    write(
      root,
      instruction,
      'Follow `AGENTS.md` and read `REPOSITORY_HYGIENE.md`.\n',
    );
  }
  write(root, 'PROOFOFWORK_GENERAL_DECK.md', '# Fixture deck\n');
  write(root, 'src/app.js', 'export const answer = 42;\n');
  write(root, 'output/state.json', '{"preserve":true}\n');
  write(root, 'WORK_MARKET_V1_REFUNDS_959061.json', '{"preserve":true}\n');
  for (const relativePath of [
    'scripts/repository-hygiene.mjs',
    'scripts/install-repository-hooks.mjs',
    'scripts/repository-hygiene.test.mjs',
  ]) {
    write(
      root,
      relativePath,
      readFileSync(join(SOURCE_ROOT, relativePath)),
      relativePath.endsWith('repository-hygiene.test.mjs') ? 0o644 : 0o755,
    );
  }
  write(
    root,
    'scripts/build-general-deck.mjs',
    [
      "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
      "const data = readFileSync('PROOFOFWORK_GENERAL_DECK.md');",
      "mkdirSync('output', { recursive: true });",
      "mkdirSync('public', { recursive: true });",
      "writeFileSync('output/proofofwork-general-deck.pptx', data);",
      "writeFileSync('public/proofofwork-general-deck.pptx', data);",
      '',
    ].join('\n'),
  );
  const modelOutputs =
    FIXTURE_CONFIG.generatedArtifacts[1].outputs;
  write(
    root,
    'scripts/generate-proofofwork-computer-model.mjs',
    [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "mkdirSync('output', { recursive: true });",
      `for (const output of ${JSON.stringify(modelOutputs)}) {`,
      "  writeFileSync(output, 'fixture-generated\\n');",
      '}',
      '',
    ].join('\n'),
  );
  write(
    root,
    'output/proofofwork-general-deck.pptx',
    '# Fixture deck\n',
  );
  write(
    root,
    'public/proofofwork-general-deck.pptx',
    '# Fixture deck\n',
  );
  for (const output of modelOutputs) {
    write(root, output, 'fixture-generated\n');
  }
  for (const hook of ['pre-commit', 'prepare-commit-msg', 'commit-msg']) {
    write(
      root,
      `.githooks/${hook}`,
      readFileSync(join(SOURCE_ROOT, '.githooks', hook)),
      0o755,
    );
  }

  if (withObsoleteFile) {
    write(root, 'obsolete.txt', 'retire me\n');
  }

  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture baseline');
  git(root, 'config', 'core.hooksPath', '.githooks');

  return root;
}

function stageCodeChange(root) {
  write(root, 'src/app.js', 'export const answer = 43;\n');
  git(root, 'add', 'src/app.js');
}

function writeCommitMessage(root, contents) {
  return write(root, '.git/HYGIENE_COMMIT_MSG', contents);
}

function commitStagedWithoutHooks(
  root,
  subject,
  {
    documentationImpact = 'reviewed-no-change',
    removed = [],
    protectedRemoval = [],
  } = {},
) {
  const message = writeCommitMessage(
    root,
    [
      subject,
      '',
      `Documentation-Impact: ${documentationImpact}`,
      'Repository-Hygiene: reviewed',
      ...removed.map((file) => `Repository-Hygiene-Removed: ${file}`),
      ...protectedRemoval.map(
        (file) => `Repository-Hygiene-Protected-Removal: ${file}`,
      ),
      '',
    ].join('\n'),
  );
  git(root, 'commit', '--no-verify', '-q', '-F', message);
}

test('clean removes only allowlisted ignored state and preserves sensitive or protected state', (t) => {
  const root = createFixture(t);

  const removablePaths = [
    'dist/assets/app.js',
    '.vite/deps/cache.json',
    '.pow-api-cache/index.json',
    'node_modules/.vite/deps/package.json',
    'node_modules/.vite-temp/chunk.js',
    'coverage/coverage-final.json',
    'playwright-report/index.html',
    'test-results/results.json',
    'npm-debug.log.1',
    'dev-server.8094.log',
  ];
  for (const relativePath of removablePaths) {
    write(root, relativePath, 'disposable\n');
  }

  const preservedPaths = [
    '.env',
    'node_modules/example-package/index.js',
    'output/state.json',
  ];
  for (const relativePath of preservedPaths) {
    write(root, relativePath, 'preserve\n');
  }

  const result = cli(root, 'clean');
  expectSuccess(result, 'allowlisted cleanup');

  for (const relativePath of removablePaths) {
    assert.equal(
      existsSync(join(root, relativePath)),
      false,
      `${relativePath} should be removed`,
    );
  }
  for (const relativePath of preservedPaths) {
    assert.equal(
      existsSync(join(root, relativePath)),
      true,
      `${relativePath} should be preserved`,
    );
  }
});

test('clean refuses an allowlisted path when the path is a symlink', (t) => {
  const root = createFixture(t);
  const outside = mkdtempSync(join(tmpdir(), 'repository-hygiene-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  write(outside, 'sentinel.txt', 'must survive\n');

  symlinkSync(outside, join(root, 'coverage'), 'dir');
  assert.equal(lstatSync(join(root, 'coverage')).isSymbolicLink(), true);

  const result = cli(root, 'clean');
  expectFailure(result, 'cleanup of an allowlisted symlink');
  assert.equal(
    lstatSync(join(root, 'coverage')).isSymbolicLink(),
    true,
    'the symlink itself should remain',
  );
  assert.equal(
    existsSync(join(outside, 'sentinel.txt')),
    true,
    'the symlink target should remain untouched',
  );
});

test('clean refuses an allowlisted path at a mount boundary', (t) => {
  const root = createFixture(t);
  const mountedPath = write(
    root,
    'coverage/mounted-evidence.txt',
    'must survive\n',
  );

  const removed = [];
  const errors = [];
  cleanCandidate(
    root,
    'coverage',
    removed,
    errors,
    new Set([join(root, 'coverage')]),
  );
  assert.deepEqual(removed, []);
  assert.deepEqual(errors, [
    'Refusing cleanup because it contains a mount boundary: coverage',
  ]);
  assert.equal(
    existsSync(mountedPath),
    true,
    'the mounted tree should remain untouched',
  );
});

test('clean refuses configuration that expands the hardcoded deletion ceiling', (t) => {
  const root = createFixture(t);
  const sensitivePath = write(root, '.env', 'SECRET=preserve-me\n');
  const expandedConfig = {
    ...FIXTURE_CONFIG,
    safeCleanupPaths: [...FIXTURE_CONFIG.safeCleanupPaths, '.env'],
  };
  write(
    root,
    'repository-hygiene.json',
    `${JSON.stringify(expandedConfig, null, 2)}\n`,
  );

  const result = cli(root, 'clean');
  expectFailure(result, 'cleanup configuration containing .env');
  assert.equal(
    existsSync(sensitivePath),
    true,
    'a config edit must never expand the cleaner beyond its code-level ceiling',
  );
});

test('clean refuses configuration that disables a mandatory cleanup target', (t) => {
  const root = createFixture(t);
  const disabledConfig = {
    ...FIXTURE_CONFIG,
    safeCleanupPaths: FIXTURE_CONFIG.safeCleanupPaths.filter(
      (entry) => entry !== 'dist',
    ),
  };
  write(
    root,
    'repository-hygiene.json',
    `${JSON.stringify(disabledConfig, null, 2)}\n`,
  );
  write(root, 'dist/app.js', 'must be reported, not bypassed\n');

  const result = cli(root, 'clean');
  expectFailure(result, 'cleanup configuration omitting dist');
  assert.equal(
    existsSync(join(root, 'dist/app.js')),
    true,
    'policy removal must fail before cleanup begins',
  );
});

test('hook installer refuses a symlinked tracked hook', (t) => {
  const root = createFixture(t);
  const outside = mkdtempSync(join(tmpdir(), 'repository-hook-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const outsideHook = write(outside, 'pre-commit', '#!/bin/sh\nexit 0\n', 0o600);

  unlinkSync(join(root, '.githooks/pre-commit'));
  symlinkSync(outsideHook, join(root, '.githooks/pre-commit'));
  const result = run(process.execPath, [INSTALLER_PATH], root);

  expectFailure(result, 'hook installation through a symlink');
  assert.equal(
    statSync(outsideHook).mode & 0o777,
    0o600,
    'the installer must not chmod an external symlink target',
  );
});

test('hook installer does not shadow an effective custom global hook path', (t) => {
  const root = createFixture(t);
  git(root, 'config', '--local', '--unset', 'core.hooksPath');
  const globalConfig = write(
    root,
    'test-global.gitconfig',
    '[core]\n\thooksPath = /tmp/custom-global-hooks\n',
  );

  const result = run(process.execPath, [INSTALLER_PATH], root, {
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: '1',
  });
  expectFailure(result, 'installation over an effective custom global hook path');

  const local = run(
    'git',
    ['config', '--local', '--get', 'core.hooksPath'],
    root,
    {
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_CONFIG_NOSYSTEM: '1',
    },
  );
  assert.notEqual(
    local.status,
    0,
    'the installer must not write a shadowing local hook path',
  );
});

test('commit-msg requires the review trailers and accepts reviewed-no-change for code-only work', (t) => {
  const root = createFixture(t);
  stageCodeChange(root);

  const missingTrailers = writeCommitMessage(root, 'change code\n');
  expectFailure(
    cli(root, 'commit-msg', missingTrailers),
    'a message without hygiene trailers',
  );

  const reviewedNoChange = writeCommitMessage(
    root,
    [
      'change code',
      '',
      'Documentation-Impact: reviewed-no-change',
      'Repository-Hygiene: reviewed',
      '',
    ].join('\n'),
  );
  expectSuccess(
    cli(root, 'commit-msg', reviewedNoChange),
    'reviewed-no-change for a code-only staged diff',
  );
});

test('commit-msg ignores magic text outside the terminal Git trailer block', (t) => {
  const root = createFixture(t);
  stageCodeChange(root);
  const bodyOnly = writeCommitMessage(
    root,
    [
      'change code',
      '',
      'Documentation-Impact: reviewed-no-change',
      'Repository-Hygiene: reviewed',
      '',
      'These lines above are examples in the message body, not attestations.',
      '',
    ].join('\n'),
  );

  expectFailure(
    cli(root, 'commit-msg', bodyOnly),
    'body-only hygiene magic text',
  );
});

test('commit-msg requires a staged note when Documentation-Impact is updated', (t) => {
  const root = createFixture(t);
  stageCodeChange(root);

  const updated = writeCommitMessage(
    root,
    [
      'update code and docs',
      '',
      'Documentation-Impact: updated',
      'Repository-Hygiene: reviewed',
      '',
    ].join('\n'),
  );
  expectFailure(
    cli(root, 'commit-msg', updated),
    'Documentation-Impact updated without a staged note',
  );

  write(
    root,
    'README.md',
    [
      '# Hygiene fixture',
      '',
      'See [repository hygiene](REPOSITORY_HYGIENE.md).',
      '',
      'The answer is now 43.',
      '',
    ].join('\n'),
  );
  git(root, 'add', 'README.md');
  expectSuccess(
    cli(root, 'commit-msg', updated),
    'Documentation-Impact updated with a staged note',
  );
});

test('commit-msg requires exact removal trailers for tracked deletions', (t) => {
  const root = createFixture(t, { withObsoleteFile: true });
  unlinkSync(join(root, 'obsolete.txt'));
  git(root, 'add', '-u', '--', 'obsolete.txt');

  const noRemoval = writeCommitMessage(
    root,
    [
      'remove obsolete file',
      '',
      'Documentation-Impact: reviewed-no-change',
      'Repository-Hygiene: reviewed',
      '',
    ].join('\n'),
  );
  expectFailure(
    cli(root, 'commit-msg', noRemoval),
    'a tracked deletion without a removal trailer',
  );

  const wrongRemoval = writeCommitMessage(
    root,
    [
      'remove obsolete file',
      '',
      'Documentation-Impact: reviewed-no-change',
      'Repository-Hygiene: reviewed',
      'Repository-Hygiene-Removed: another-file.txt',
      '',
    ].join('\n'),
  );
  expectFailure(
    cli(root, 'commit-msg', wrongRemoval),
    'a tracked deletion with a mismatched removal trailer',
  );

  const exactRemoval = writeCommitMessage(
    root,
    [
      'remove obsolete file',
      '',
      'Documentation-Impact: reviewed-no-change',
      'Repository-Hygiene: reviewed',
      'Repository-Hygiene-Removed: obsolete.txt',
      '',
    ].join('\n'),
  );
  expectSuccess(
    cli(root, 'commit-msg', exactRemoval),
    'a tracked deletion with its exact removal trailer',
  );
});

test('commit-msg requires explicit protected-removal attestation', (t) => {
  const root = createFixture(t);
  unlinkSync(join(root, 'output/state.json'));
  git(root, 'add', '-u', '--', 'output/state.json');

  const ordinaryRemoval = writeCommitMessage(
    root,
    [
      'remove protected output',
      '',
      'Documentation-Impact: reviewed-no-change',
      'Repository-Hygiene: reviewed',
      'Repository-Hygiene-Removed: output/state.json',
      '',
    ].join('\n'),
  );
  expectFailure(
    cli(root, 'commit-msg', ordinaryRemoval),
    'protected deletion without explicit protected-removal attestation',
  );

  const approvedRemoval = writeCommitMessage(
    root,
    [
      'remove protected output',
      '',
      'Documentation-Impact: reviewed-no-change',
      'Repository-Hygiene: reviewed',
      'Repository-Hygiene-Removed: output/state.json',
      'Repository-Hygiene-Protected-Removal: output/state.json',
      '',
    ].join('\n'),
  );
  expectSuccess(
    cli(root, 'commit-msg', approvedRemoval),
    'protected deletion with exact explicit attestation',
  );
});

test('commit-msg protects an exact configured audit snapshot path', (t) => {
  const root = createFixture(t);
  const protectedPath = 'WORK_MARKET_V1_REFUNDS_959061.json';
  unlinkSync(join(root, protectedPath));
  git(root, 'add', '-u', '--', protectedPath);

  const ordinaryRemoval = writeCommitMessage(
    root,
    [
      'remove protected refund snapshot',
      '',
      'Documentation-Impact: reviewed-no-change',
      'Repository-Hygiene: reviewed',
      `Repository-Hygiene-Removed: ${protectedPath}`,
      '',
    ].join('\n'),
  );
  expectFailure(
    cli(root, 'commit-msg', ordinaryRemoval),
    'exact protected path deletion without explicit attestation',
  );

  const approvedRemoval = writeCommitMessage(
    root,
    [
      'remove protected refund snapshot',
      '',
      'Documentation-Impact: reviewed-no-change',
      'Repository-Hygiene: reviewed',
      `Repository-Hygiene-Removed: ${protectedPath}`,
      `Repository-Hygiene-Protected-Removal: ${protectedPath}`,
      '',
    ].join('\n'),
  );
  expectSuccess(
    cli(root, 'commit-msg', approvedRemoval),
    'exact protected path deletion with explicit attestation',
  );
});

test('commit-msg treats a protected rename as retirement of the old path', (t) => {
  const root = createFixture(t);
  renameSync(join(root, 'output/state.json'), join(root, 'state.json'));
  git(root, 'add', '-A', '--', 'output/state.json', 'state.json');

  const noAttestation = writeCommitMessage(
    root,
    [
      'move protected output',
      '',
      'Documentation-Impact: reviewed-no-change',
      'Repository-Hygiene: reviewed',
      '',
    ].join('\n'),
  );
  expectFailure(
    cli(root, 'commit-msg', noAttestation),
    'a protected path rename without retirement attestation',
  );

  const attested = writeCommitMessage(
    root,
    [
      'move protected output',
      '',
      'Documentation-Impact: reviewed-no-change',
      'Repository-Hygiene: reviewed',
      'Repository-Hygiene-Protected-Removal: output/state.json',
      '',
    ].join('\n'),
  );
  expectSuccess(
    cli(root, 'commit-msg', attested),
    'a protected path rename with exact retirement attestation',
  );
});

test('tracked hooks preserve the original diff contract during amend', (t) => {
  const root = createFixture(t);
  write(
    root,
    'README.md',
    [
      '# Hygiene fixture',
      '',
      'See [repository hygiene](REPOSITORY_HYGIENE.md).',
      '',
      'Durable amended documentation.',
      '',
    ].join('\n'),
  );
  git(root, 'add', 'README.md');
  const message = writeCommitMessage(
    root,
    [
      'document amend behavior',
      '',
      'Documentation-Impact: updated',
      'Repository-Hygiene: reviewed',
      '',
    ].join('\n'),
  );
  git(root, 'commit', '-q', '-F', message);
  const beforeAmend = git(root, 'rev-parse', 'HEAD');

  write(root, 'src/amended.js', 'export const amended = true;\n');
  git(root, 'add', 'src/amended.js');
  git(root, 'commit', '--amend', '--no-edit', '-q');
  const afterAmend = git(root, 'rev-parse', 'HEAD');
  assert.notEqual(afterAmend, beforeAmend, 'amend should replace the commit');
});

test('pre-commit rejects a staged transient artifact even when it is ignored', (t) => {
  const root = createFixture(t);
  write(root, 'dist/bundle.js', 'generated\n');
  git(root, 'add', '-f', 'dist/bundle.js');

  const result = cli(root, 'pre-commit');
  expectFailure(result, 'a staged dist artifact');
  assert.equal(
    existsSync(join(root, 'dist/bundle.js')),
    true,
    'cleanup must not delete a path already tracked in the index',
  );
});

test('pre-commit rejects a broken relative Markdown link', (t) => {
  const root = createFixture(t);
  write(
    root,
    'README.md',
    [
      '# Hygiene fixture',
      '',
      'See [repository hygiene](REPOSITORY_HYGIENE.md).',
      '',
      'This [missing note](notes/does-not-exist.md) is broken.',
      '',
    ].join('\n'),
  );
  git(root, 'add', 'README.md');

  expectFailure(
    cli(root, 'pre-commit'),
    'a staged note with a broken relative link',
  );
});

test('pre-commit inventories uppercase Markdown extensions', (t) => {
  const root = createFixture(t);
  write(root, 'STALE_NOTES.MD', '# Unclassified note\n');
  git(root, 'add', 'STALE_NOTES.MD');

  expectFailure(
    cli(root, 'pre-commit'),
    'an unclassified uppercase Markdown note',
  );
});

test('check rejects an unstaged tracked-file symlink type change', (t) => {
  const root = createFixture(t);
  unlinkSync(join(root, 'src/app.js'));
  symlinkSync('missing-app-target.js', join(root, 'src/app.js'));

  expectFailure(
    cli(root, 'check', '--ci'),
    'a tracked file replaced by a dangling worktree symlink',
  );
});

test('pre-commit and range reject a staged tracked-file symlink type change', (t) => {
  const root = createFixture(t);
  const base = git(root, 'rev-parse', 'HEAD');
  unlinkSync(join(root, 'src/app.js'));
  symlinkSync('missing-app-target.js', join(root, 'src/app.js'));
  git(root, 'add', 'src/app.js');

  expectFailure(
    cli(root, 'pre-commit'),
    'a staged tracked-file symlink type change',
  );

  commitStagedWithoutHooks(root, 'replace tracked file with a symlink');
  const head = git(root, 'rev-parse', 'HEAD');
  expectFailure(
    cli(root, 'range', base, head, '--ci', '--require-ancestor'),
    'a committed tracked-file symlink type change',
  );
});

test('pre-commit rejects partially staged hygiene control code', (t) => {
  const root = createFixture(t);
  const controlPath = join(root, 'scripts/repository-hygiene.mjs');
  const original = readFileSync(controlPath, 'utf8');
  write(root, 'scripts/repository-hygiene.mjs', `${original}\n// staged\n`);
  git(root, 'add', 'scripts/repository-hygiene.mjs');
  write(
    root,
    'scripts/repository-hygiene.mjs',
    `${original}\n// staged\n// unstaged\n`,
  );

  expectFailure(
    cli(root, 'pre-commit'),
    'partially staged repository hygiene code',
  );
});

test('pre-commit rejects a no-op replacement for a tracked hook wrapper', (t) => {
  const root = createFixture(t);
  write(root, '.githooks/pre-commit', '#!/bin/sh\nexit 0\n', 0o755);
  git(root, 'add', '.githooks/pre-commit');

  expectFailure(
    cli(root, 'pre-commit'),
    'a staged no-op hook replacement',
  );
});

test('check rejects generated output that does not match its declared source', (t) => {
  const root = createFixture(t);
  const generatedOutput =
    'output/proofofwork-computer-growth-model.json';
  write(root, generatedOutput, 'stale\n');

  expectFailure(
    cli(root, 'check', '--ci'),
    'a stale declared generated artifact',
  );

  write(root, generatedOutput, 'fixture-generated\n');
  expectSuccess(
    cli(root, 'check', '--ci'),
    'a generated artifact matching its declared source',
  );
});

test('check refuses removal of a mandatory generated-artifact policy', (t) => {
  const root = createFixture(t);
  write(
    root,
    'repository-hygiene.json',
    `${JSON.stringify({ ...FIXTURE_CONFIG, generatedArtifacts: [] }, null, 2)}\n`,
  );

  expectFailure(
    cli(root, 'check', '--ci'),
    'a disabled generated-artifact manifest',
  );
});

test('general deck generator fails instead of truncating slide content', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'repository-deck-overflow-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(
    root,
    'scripts/build-general-deck.mjs',
    readFileSync(join(SOURCE_ROOT, 'scripts/build-general-deck.mjs')),
  );
  write(
    root,
    'PROOFOFWORK_GENERAL_DECK.md',
    [
      '# Overflow deck',
      '',
      'Deck source and product surface updated on 2026-07-23.',
      '',
      '## Slide 1: Overflow',
      '',
      ...Array.from({ length: 14 }, (_, index) => `Line ${index + 1}`),
      '',
    ].join('\n'),
  );

  expectFailure(
    run(
      process.execPath,
      [join(root, 'scripts/build-general-deck.mjs')],
      root,
    ),
    'a generated slide with more than thirteen body lines',
  );
});

test('range rejects a non-merge commit without hygiene trailers', (t) => {
  const root = createFixture(t);
  const base = git(root, 'rev-parse', 'HEAD');

  stageCodeChange(root);
  git(root, 'commit', '--no-verify', '-q', '-m', 'invalid update');
  const head = git(root, 'rev-parse', 'HEAD');

  expectFailure(
    cli(root, 'range', base, head, '--ci'),
    'a commit range containing an unreviewed commit',
  );
});

test('range accepts a fully reviewed commit with a valid repository state', (t) => {
  const root = createFixture(t);
  const base = git(root, 'rev-parse', 'HEAD');
  stageCodeChange(root);
  commitStagedWithoutHooks(root, 'valid update');
  const head = git(root, 'rev-parse', 'HEAD');

  expectSuccess(
    cli(root, 'range', base, head, '--ci', '--require-ancestor'),
    'a reviewed fast-forward commit range',
  );
});

test('range fails closed for an unavailable base and a backward push', (t) => {
  const root = createFixture(t);
  const oldHead = git(root, 'rev-parse', 'HEAD');
  stageCodeChange(root);
  commitStagedWithoutHooks(root, 'valid forward update');
  const newHead = git(root, 'rev-parse', 'HEAD');

  expectFailure(
    cli(root, 'range', '0000000000000000000000000000000000000000', newHead, '--ci'),
    'an all-zero unavailable base',
  );
  expectFailure(
    cli(root, 'range', newHead, oldHead, '--ci', '--require-ancestor'),
    'a backward non-fast-forward push range',
  );
});

test('range validates the complete state of every intermediate commit', (t) => {
  const root = createFixture(t);
  const base = git(root, 'rev-parse', 'HEAD');
  const validReadme = readFileSync(join(root, 'README.md'));

  write(
    root,
    'README.md',
    '# Hygiene fixture\n\n[Broken](missing-intermediate.md)\n',
  );
  git(root, 'add', 'README.md');
  commitStagedWithoutHooks(root, 'temporarily break docs', {
    documentationImpact: 'updated',
  });

  write(root, 'README.md', validReadme);
  git(root, 'add', 'README.md');
  commitStagedWithoutHooks(root, 'repair docs', {
    documentationImpact: 'updated',
  });
  const head = git(root, 'rev-parse', 'HEAD');

  expectFailure(
    cli(root, 'range', base, head, '--ci', '--require-ancestor'),
    'a range with an invalid intermediate durable handoff',
  );
});

test('range validates merge commits instead of skipping them', (t) => {
  const root = createFixture(t);
  const base = git(root, 'rev-parse', 'HEAD');
  const primaryBranch = git(root, 'rev-parse', '--abbrev-ref', 'HEAD');

  git(root, 'checkout', '-q', '-b', 'feature');
  write(root, 'src/feature.js', 'export const feature = true;\n');
  git(root, 'add', 'src/feature.js');
  commitStagedWithoutHooks(root, 'feature update');

  git(root, 'checkout', '-q', primaryBranch);
  write(root, 'src/main.js', 'export const main = true;\n');
  git(root, 'add', 'src/main.js');
  commitStagedWithoutHooks(root, 'main update');
  git(
    root,
    'merge',
    '--no-ff',
    '--no-verify',
    '-q',
    '-m',
    'merge feature without attestations',
    'feature',
  );
  const head = git(root, 'rev-parse', 'HEAD');

  expectFailure(
    cli(root, 'range', base, head, '--ci', '--require-ancestor'),
    'an unattested merge commit',
  );
});
