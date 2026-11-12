import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('current storage writer replays its actual receipt and only the approved predecessor pair', () => {
  execFileSync('python3', ['-I', '-B', 'deploy/audit30/check-ui-storage.test.py',
    'StorageTests.test_current_writer_actual_completed_receipt_replays',
    'StorageTests.test_approved_037_d9fa_forecast_is_exact_in_both_gates'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'pipe', timeout: 60_000,
  });
});
