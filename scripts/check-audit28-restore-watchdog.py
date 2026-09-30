#!/usr/bin/env python3
import pathlib,re,subprocess,tempfile,unittest
SOURCE=(pathlib.Path(__file__).resolve().parents[1]/'deploy/audit28/restore-logical-storage-guarded.sh').read_text()
def function(name):
    start=SOURCE.index(name+'() {');end=SOURCE.index('\n}',start)+2;return SOURCE[start:end]
class Watchdog(unittest.TestCase):
    def run_reader(self,behavior):
        with tempfile.TemporaryDirectory() as tmp:
            script='set -Eeuo pipefail\njob='+repr(tmp)+'\ncalls=0\n'+behavior+'\nsleep() { :; }\n'+function('read_job_allocated_bytes')+'\nread_job_allocated_bytes'
            return subprocess.run(['bash','-c',script],capture_output=True,text=True,timeout=2)
    def test_transient_wal_disappearance_is_retried(self):
        r=self.run_reader('du() { if [[ ! -e "$job/attempt" ]]; then touch "$job/attempt"; echo "WAL disappeared" >&2; return 1; fi; printf "12345\\t%s\\n" "$job"; }')
        self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(r.stdout,'12345\n')
    def test_repeated_allocation_failures_fail_closed(self):
        r=self.run_reader('du() { return 1; }');self.assertNotEqual(r.returncode,0)
    def test_malformed_allocation_output_is_rejected(self):
        r=self.run_reader('du() { printf "bad\\tjob\\n"; }');self.assertNotEqual(r.returncode,0)
    def test_unexpected_watchdog_exit_records_failure_and_signals_parent(self):
        with tempfile.TemporaryDirectory() as tmp:
            script='set -Eeuo pipefail\njob='+repr(tmp)+'\nbin=/fixture\nowner_pid=123\nkill() { printf "%s\\n" "$*"; }\n'+function('stop_for_watchdog_failure')+'\nstop_for_watchdog_failure unexpected-watchdog-exit'
            r=subprocess.run(['bash','-c',script],capture_output=True,text=True,timeout=2)
            self.assertEqual(r.returncode,0);self.assertIn('-TERM 123',r.stdout)
            self.assertIn('unexpected-watchdog-exit',(pathlib.Path(tmp)/'resource-bound.txt').read_text())
    def test_completed_restore_cannot_pass_after_watchdog_death(self):
        with tempfile.TemporaryDirectory() as tmp:
            script='job='+repr(tmp)+'\nmonitor_pid=999999999\n'+function('assert_storage_watchdog')+'\nassert_storage_watchdog'
            r=subprocess.run(['bash','-c',script],capture_output=True,text=True,timeout=2);self.assertNotEqual(r.returncode,0)
    def test_unexpected_exit_trap_fails_closed(self):
        trap_line=next(line.strip() for line in SOURCE.splitlines() if line.strip().startswith("trap '") and 'unexpected-watchdog-exit' in line)
        with tempfile.TemporaryDirectory() as tmp:
            script='set -Eeuo pipefail\njob='+repr(tmp)+'\nbin=/fixture\nowner_pid=123\nkill() { printf "%s\\n" "$*"; }\n'+function('stop_for_watchdog_failure')+'\n'+trap_line+'\nfalse'
            r=subprocess.run(['bash','-c',script],capture_output=True,text=True,timeout=2)
            self.assertNotEqual(r.returncode,0);self.assertIn('-TERM 123',r.stdout)
            self.assertTrue((pathlib.Path(tmp)/'resource-bound.txt').exists())
    def test_intentional_stop_does_not_signal_parent_or_poison_results(self):
        trap_line=next(line.strip() for line in SOURCE.splitlines() if line.strip().startswith("trap '") and 'unexpected-watchdog-exit' in line)
        with tempfile.TemporaryDirectory() as tmp:
            script='set -Eeuo pipefail\njob='+repr(tmp)+'\nbin=/fixture\nowner_pid=123\nkill() { printf "%s\\n" "$*"; }\n'+function('stop_for_watchdog_failure')+'\n: >"${job}/monitor-stop-requested"\n'+trap_line+'\ntrue'
            r=subprocess.run(['bash','-c',script],capture_output=True,text=True,timeout=2)
            self.assertEqual(r.returncode,0);self.assertEqual(r.stdout,'')
            self.assertFalse((pathlib.Path(tmp)/'resource-bound.txt').exists())
if __name__=='__main__':unittest.main()
