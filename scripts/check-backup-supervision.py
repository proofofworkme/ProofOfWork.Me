#!/usr/bin/env python3
"""Private-process fault injection for the real logical backup watchdog."""
from pathlib import Path
import importlib.util
import os
import signal
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'deploy/proofofwork-postgres-logical-backup.sh').read_text()
spec = importlib.util.spec_from_file_location('backup_state', ROOT / 'deploy/proofofwork-postgres-logical-backup-state.py')
state = importlib.util.module_from_spec(spec)
spec.loader.exec_module(state)


class BackupSupervisionTests(unittest.TestCase):
    def test_actual_unit_and_writer_preflight_fails_closed(self):
        quiet = {'Type': 'oneshot', 'LoadState': 'loaded', 'ActiveState': 'inactive', 'MainPID': '0'}
        self.assertTrue(state.classify_state(quiet, [], [], True)['quiet'])
        for unit, pids, sets, lock in (({}, [], [], True),
                                      ({**quiet, 'MainPID': '99'}, [], [], True),
                                      ({**quiet, 'ActiveState': 'activating'}, [], [], True),
                                      (quiet, [10], [], True), (quiet, [], ['failed.tmp'], True),
                                      (quiet, [], [], False)):
            self.assertFalse(state.classify_state(unit, pids, sets, lock)['quiet'])

    def test_unmanaged_creation_refused_before_writer_or_lock(self):
        with tempfile.TemporaryDirectory(prefix='pow-backup-unmanaged-') as temporary:
            root = Path(temporary); backup = root / 'backups'; backup.mkdir(mode=0o700)
            cgroup = root / 'cgroup'; cgroup.write_text('0::/user.slice/unauthorized.scope\n')
            script = root / 'backup.sh'
            script.write_text(SOURCE.replace('/proc/self/cgroup', str(cgroup)).replace(
                'backup_root="/data/proofofwork-postgres-backups/logical"', 'backup_root="'+str(backup)+'"'))
            result = subprocess.run(['bash', str(script)],capture_output=True,text=True,timeout=3)
            self.assertEqual(result.returncode,77,result.stderr)
            self.assertEqual(list(backup.iterdir()), [])
            self.assertIn('instead of unmanaged --apply',result.stderr)

    def exercise(self, fault, phase='dump'):
        with tempfile.TemporaryDirectory(prefix='pow-backup-watchdog-') as temporary:
            root = Path(temporary); backups = root / 'backups'; backups.mkdir(mode=0o700)
            commands = root / 'commands'; commands.mkdir(); called = root / 'called'
            def command(name, body):
                path = commands / name
                path.write_text('#!/bin/bash\nset -eu\n' + body + '\n'); path.chmod(0o700)
                return str(path)
            df = command('df', '''if [[ -e "${TEST_CALLED}" && "${TEST_FAULT}" == df ]]; then exit 39; fi
printf 'Avail\\n1000000000000\\n' ''')
            stat = command('stat', '''if [[ "${1:-}" == -c && "${2:-}" == %s && -e "${TEST_CALLED}" && "${TEST_FAULT}" == stat ]]; then exit 38; fi
exec /usr/bin/stat "$@"''')
            sql = command('psql', 'echo 1000000')
            write = '''for arg in "$@"; do case "$arg" in --file=*) output="${arg#--file=}";; esac; done
printf fixture >"${output}"
'''
            dump = command('pg_dump', write + (''': >"${TEST_CALLED}"
if [[ "${TEST_FAULT}" == watcher ]]; then kill -KILL "$(pgrep -P "$PPID" bash | head -1)"; fi
exec sleep 30''' if phase == 'dump' else 'exit 0'))
            globals_command = command('pg_dumpall', write + (''': >"${TEST_CALLED}"
exec sleep 30''' if phase == 'globals' else 'exit 0'))
            restore = command('pg_restore', 'exit 0')
            fuser = command('fuser', 'exit 1')
            text = SOURCE.replace('backup_root="/data/proofofwork-postgres-backups/logical"', 'backup_root="' + str(backups) + '"')
            cgroup = root / 'cgroup'; cgroup.write_text('0::/system.slice/proofofwork-postgres-logical-backup.service\n')
            text = text.replace('/proc/self/cgroup', str(cgroup))
            text = text.replace('sleep 5', 'sleep 0.05')
            if fault == 'watcher-exit':
                text = text.replace('  while true; do', '  false\n  while true; do', 1)
            if fault == 'runtime':
                text = text.replace('maximum_runtime_seconds=5400', 'maximum_runtime_seconds=1')
            for original, replacement in [('df', df), ('stat', stat), ('psql', sql), ('pg_dump', dump), ('pg_dumpall', globals_command), ('pg_restore', restore), ('fuser', fuser)]:
                text = text.replace('/usr/bin/' + original + ' ', replacement + ' ').replace('/usr/bin/' + original + ' \\\n', replacement + ' \\\n')
            script = root / 'backup.sh'; script.write_text(text)
            env = {**os.environ, 'TEST_CALLED': str(called), 'TEST_FAULT': fault,
                   'POW_POSTGRES_BACKUP_MIN_FREE_BYTES': '10737418240'}
            result = subprocess.run(['bash', str(script)], env=env, text=True, capture_output=True, timeout=8)
            self.assertNotEqual(result.returncode, 0, result.stdout)
            incomplete = list(backups.glob('.*.dumpset.tmp'))
            self.assertEqual(len(incomplete), 1)
            failure = incomplete[0] / '.watchdog-failed'
            self.assertTrue(failure.exists(), result.stderr)
            self.assertEqual(list(backups.glob('proof_indexer-*.dumpset')), [])
            return failure.read_text(), result.stderr

    def test_failed_free_space_measurement_stops_dump(self):
        self.assertIn('free-space-read-failed', self.exercise('df')[0])

    def test_failed_size_measurement_stops_dump(self):
        self.assertIn('dump-size-read-failed', self.exercise('stat')[0])

    def test_unexpected_watcher_death_stops_dump(self):
        self.assertIn('watchdog-not-running', self.exercise('watcher')[0])

    def test_unexpected_shell_exit_stops_dump(self):
        self.assertIn('unexpected-watchdog-exit', self.exercise('watcher-exit')[0])

    def test_free_space_failure_stops_globals_too(self):
        self.assertIn('free-space-read-failed', self.exercise('df', 'globals')[0])

    def test_runtime_bound_stops_globals_too(self):
        self.assertIn('runtime-bound-exceeded', self.exercise('runtime', 'globals')[0])


if __name__ == '__main__':
    unittest.main(verbosity=2)
