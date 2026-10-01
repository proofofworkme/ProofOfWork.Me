#!/usr/bin/python3
"""Exercise the monitor with a private psql fixture; never contact a database."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "deploy/proofofwork-postgres-query-health.sh"
ACTIVITY = "8|0|0|0|8|1|2|1|0|0|0|0"
PLACEMENT = "1|1|2|2|2|18|18|14|0|0|0|37203542016|38493395991|37203542016|8192|9771|2"


class QueryHealthTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="postgres-health-fixture-")
        self.root = Path(self.temporary.name)
        self.calls = self.root / "calls.jsonl"
        self.psql = self.root / "psql"
        self.psql.write_text(
            "#!/usr/bin/python3\n"
            "import json, os, sys\n"
            "sql = next(x.removeprefix('--command=') for x in sys.argv if x.startswith('--command='))\n"
            "with open(os.environ['FIXTURE_CALLS'], 'a') as f: f.write(json.dumps(sql) + '\\n')\n"
            "assert 'BEGIN READ ONLY;' in sql\n"
            "assert \"SET LOCAL statement_timeout = '5s';\" in sql\n"
            "assert \"SET LOCAL lock_timeout = '2s';\" in sql\n"
            "assert sql.strip().endswith('ROLLBACK;')\n"
            "kind = 'placement' if 'expected_parents' in sql else 'activity'\n"
            "if os.environ.get('FIXTURE_FAIL') == kind:\n"
            "    print('ERROR: canceling statement due to statement timeout', file=sys.stderr)\n"
            "    sys.exit(1)\n"
            "print(os.environ['FIXTURE_' + kind.upper()])\n"
        )
        self.psql.chmod(0o700)
        self.script = self.root / "monitor.sh"
        # Only the private fixture changes the executable; production exposes
        # no alternate psql/timeout path or test-mode environment option.
        self.script.write_text(SOURCE.read_text().replace("/usr/bin/psql", str(self.psql)))

    def tearDown(self):
        self.temporary.cleanup()

    def run_monitor(self, activity=ACTIVITY, placement=PLACEMENT, **extra):
        environment = {
            **os.environ,
            "FIXTURE_CALLS": str(self.calls),
            "FIXTURE_ACTIVITY": activity,
            "FIXTURE_PLACEMENT": placement,
            **extra,
        }
        return subprocess.run(
            ["/usr/bin/bash", str(self.script)],
            capture_output=True, text=True, env=environment, timeout=5,
        )

    def test_exact_allocations_and_catalog_estimates_are_reported(self):
        result = self.run_monitor()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("database_bytes=38493395991", result.stdout)
        self.assertIn("transition_total_bytes=37203542016", result.stdout)
        self.assertIn("snapshot_total_bytes=8192", result.stdout)
        self.assertIn("transition_rows_estimated=9771", result.stdout)
        self.assertIn("row_estimate_source=pg_class.reltuples", result.stdout)
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        self.assertEqual(len(calls), 2)
        for sql in calls:
            self.assertIn("BEGIN READ ONLY;", sql)
            self.assertIn("SET LOCAL lock_timeout = '2s';", sql)
        storage = calls[1]
        self.assertIn("pg_database_size(current_database())", storage)
        self.assertIn("SELECT reltuples::bigint FROM parents", storage)
        self.assertNotIn("FROM proof_indexer.", storage)

    def test_above_javascript_precision_and_bigint_boundary_remain_exact(self):
        values = PLACEMENT.split("|")
        values[11:15] = ["9007199254740993", "9223372036854775807", "9007199254740993", "7"]
        result = self.run_monitor(placement="|".join(values))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("database_bytes=9223372036854775807", result.stdout)
        self.assertIn("transition_total_bytes=9007199254740993", result.stdout)

    def test_unknown_catalog_estimate_is_explicit(self):
        values = PLACEMENT.split("|")
        values[-2:] = ["-1", "-1"]
        result = self.run_monitor(placement="|".join(values))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("transition_rows_estimated=-1 snapshot_rows_estimated=-1", result.stdout)

    def test_malformed_or_overflowing_allocations_fail_without_health_output(self):
        for value in ("-1", "1.5", "01", "9223372036854775808", "18446744073709551616", "nan"):
            with self.subTest(value=value):
                values = PLACEMENT.split("|")
                values[12] = value
                result = self.run_monitor(placement="|".join(values))
                self.assertEqual(result.returncode, 65)
                self.assertEqual(result.stdout, "")

    def test_estimates_accept_only_unknown_or_nonnegative_bigint(self):
        for value in ("-2", "9771.5", "00", "9223372036854775808"):
            with self.subTest(value=value):
                values = PLACEMENT.split("|")
                values[-1] = value
                result = self.run_monitor(placement="|".join(values))
                self.assertEqual(result.returncode, 65)
                self.assertEqual(result.stdout, "")

    def test_wrong_row_or_column_count_is_not_silently_truncated(self):
        for activity, placement in (
            (ACTIVITY + "|0", PLACEMENT),
            (ACTIVITY + "\n" + ACTIVITY, PLACEMENT),
            (ACTIVITY, PLACEMENT + "|0"),
            (ACTIVITY, PLACEMENT + "\n" + PLACEMENT),
        ):
            with self.subTest(activity=activity, placement=placement):
                result = self.run_monitor(activity, placement)
                self.assertEqual(result.returncode, 65)
                self.assertEqual(result.stdout, "")

    def test_query_timeouts_fail_closed_without_success_receipt(self):
        for kind in ("activity", "placement"):
            with self.subTest(kind=kind):
                result = self.run_monitor(FIXTURE_FAIL=kind)
                self.assertEqual(result.returncode, 1)
                self.assertIn("statement timeout", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_unsafe_thresholds_and_metrics_do_not_overflow_bash(self):
        for threshold in ("0", "08", "-1", "99999999999999999999"):
            with self.subTest(threshold=threshold):
                result = self.run_monitor(POW_POSTGRES_WARN_QUERY_FANOUT=threshold)
                self.assertEqual(result.returncode, 64)
                self.assertEqual(result.stdout, "")
        values = ACTIVITY.split("|")
        values[0] = "9223372036854775808"
        self.assertEqual(self.run_monitor(activity="|".join(values)).returncode, 65)

    def test_existing_placement_and_contention_failures_remain_visible(self):
        placement = PLACEMENT.split("|")
        placement[8] = "1"
        result = self.run_monitor(placement="|".join(placement))
        self.assertEqual(result.returncode, 2)
        self.assertIn("large-state tablespace placement differs", result.stderr)
        activity = ACTIVITY.split("|")
        activity[7] = "4"
        self.assertEqual(self.run_monitor(activity="|".join(activity)).returncode, 1)
        activity[7] = "8"
        self.assertEqual(self.run_monitor(activity="|".join(activity)).returncode, 2)


if __name__ == "__main__":
    unittest.main()
