import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// These are isolated schema and disposable-inode fixtures, not native installation
// or protected-root qualification. No production entry point is invoked.
function boundedPython(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-I', '-B', file], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { PATH: process.env.PATH, HOME: '/nonexistent', LANG: 'C.UTF-8',
        GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
      detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = ''; let bytes = 0; let stopped = false; let closed = false;
    let code; let killFinished = false; let timer; let grace;
    const signal = (name) => { try { process.kill(-child.pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
    const finish = () => {
      if (!closed || (stopped && !killFinished)) return;
      clearTimeout(timer); clearTimeout(grace);
      if (stopped || code !== 0) reject(new Error(`${file}: ${stopped ? 'bounded fixture stopped' : `exit ${code}`}\n${output}`));
      else resolve(output);
    };
    const stop = () => {
      if (stopped) return; stopped = true;
      signal('SIGTERM');
      // Kill the whole group even if the immediate child exits during the grace.
      grace = setTimeout(() => { signal('SIGKILL'); killFinished = true; finish(); }, 1000);
    };
    timer = setTimeout(stop, 120_000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes <= 2 * 1024 * 1024) output += chunk.toString(); else stop();
    });
    child.once('error', (error) => { clearTimeout(timer); clearTimeout(grace); reject(error); });
    child.once('close', (status) => { code = status; closed = true; finish(); });
  });
}

for (const file of ['deploy/ui-retention/check-scratch-authority.test.py',
  'deploy/ui-scratch-capacity/check-installer.test.py']) {
  test(`isolated scratch migration: ${file}`, { timeout: 125_000 }, async () => {
    assert.match(await boundedPython(file), /\bOK\b/);
  });
}
