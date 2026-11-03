import hashlib
from pathlib import Path
import runpy
import unittest

S = runpy.run_path(str(Path(__file__).with_name("stage.py")))


class NativeStaging(unittest.TestCase):
    def test_rehearsal_commands_have_only_derived_db_work_and_limited_privileges(self):
        root = Path("/var/lib/proofofwork-powcat-stage") / ("a" * 64)
        for mode, last in [("files", "--bootstrap-powcat"), ("search", "--budget-ms=30000"),
                           ("verify", str(root / S["PROOF"]))]:
            cmd = S["command"](mode, root)
            self.assertIn("--property=User=powadmin", cmd)
            self.assertIn("--property=ProtectSystem=strict", cmd)
            self.assertIn("--property=MemoryMax=512M", cmd)
            self.assertIn("--property=NoNewPrivileges=true", cmd)
            self.assertEqual(cmd[-1], last)
            self.assertFalse(any("internal-verifier.env" in a or "schema" in a for a in cmd))

    def test_unpinned_native_dependency_or_omitted_sharing_fails_closed(self):
        path = "server/runtime.mjs"
        manifest = {"dependencies": {path: "0"*64}}
        ns = {"dependency_closure": lambda *_: {path}, "ROOT_JSON": set(),
              "safe_read":lambda _: b"active", "sha":lambda b: hashlib.sha256(b).hexdigest()}
        with self.assertRaisesRegex(ValueError, "native staging closure"):
            S["module_sources"](ns, {}, manifest)
        ns["dependency_closure"] = lambda *_: set(S["NATIVE"]) | {path}
        with self.assertRaisesRegex(ValueError, "Unpinned staged dependency"):
            S["module_sources"](ns, {}, manifest)


if __name__ == "__main__":
    unittest.main()
