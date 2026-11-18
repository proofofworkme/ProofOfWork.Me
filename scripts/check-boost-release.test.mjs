import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
for (const file of ['deploy/audit30/check-ui-storage.test.py','deploy/publish/check-preservation-admission.test.py','deploy/ui-retention/check-retirement-package-upgrade.test.py','deploy/ui-retention/check-publication-completion-bridge.test.py']) {
  test(file, () => {
    // Isolated source fixtures retain secure canonical modes without changing the checkout.
    let fixture;
    try {
      let source=file, args=[];
      if (file === 'deploy/audit30/check-ui-storage.test.py') {
        fixture=mkdtempSync(join(tmpdir(),'pow-boost-admission-test-'));
        for (const name of [file,'deploy/audit30/ui-storage.py','deploy/audit30/ui-release-policy.py','deploy/publish/publication_admission.py']) {
          const target=join(fixture,name); mkdirSync(dirname(target),{recursive:true,mode:0o700});
          writeFileSync(target,readFileSync(name),{mode:0o600});
        }
        source=join(fixture,file); args=['-k','boost_9f18_a4d2'];
      }
      const result = spawnSync('python3', ['-I', '-B', source,...args], { encoding: 'utf8', timeout: 600000, maxBuffer: 8*1024*1024 });
      assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
    } finally { if(fixture) rmSync(fixture,{recursive:true,force:true}); }
  });
}
