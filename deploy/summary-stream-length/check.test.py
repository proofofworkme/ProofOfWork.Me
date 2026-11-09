#!/usr/bin/python3 -I
import base64
import copy
from pathlib import Path
import runpy
import unittest

HERE=Path(__file__).resolve().parent
release=runpy.run_path(str(HERE/"release.py"))
ns=release["engine"]["namespace"](release["controller"]())
STREAM=ns["STREAM"]
RAW=(HERE.parents[1]/STREAM).read_bytes()
H="1"*64


def manifest():
    commit="a"*40
    release_id=commit[:12]+"-20261109T030000Z"
    return {"format":ns["FAMILY"],"baselineHead":ns["BASELINE_HEAD"],"baseSourceCommit":ns["BASE_SOURCE_COMMIT"],
        "sourceCommit":commit,"releaseId":release_id,"acceptedInventorySha256":ns["ACCEPTED_SHA"],
        "services":list(ns["UNITS"]),
        "sources":[{"path":STREAM,"before":ns["EXISTING"][STREAM],"after":ns["STREAM_AFTER"],"base64":base64.b64encode(RAW).decode()}],
        "sourceMetadata":{STREAM:{"uid":0,"gid":0,"mode":0o644}},
        "dependencies":{"package.json":H,"package-lock.json":H,"server/proof-api.mjs":ns["API_SHA"],STREAM:ns["EXISTING"][STREAM]},
        "nodeSha256":H,"protectedServices":{"files":dict.fromkeys(ns["PROTECTED"],H),
            "states":{k:{"ActiveState":"active","MainPID":"123","WorkingDirectory":str(ns["ROOT"])} for k in ns["PROTECTED"]}},
        "gateway":{"files":dict.fromkeys(ns["GATEWAY"],H),"active":dict.fromkeys(ns["GATEWAY"],"active"),
            "unitFileStates":dict.fromkeys(ns["GATEWAY"],"enabled")},
        "searchHold":{"markerSha256":H,"bindings":{"releaseId":release_id,"files":dict.fromkeys(ns["SEARCH"],H)}}}


class Successor(unittest.TestCase):
    def test_one_existing_stream_only(self):
        self.assertFalse(ns["NEW"])
        self.assertEqual(ns["ALLOWED"],{STREAM})
        self.assertEqual(ns["INSTALL_ORDER"],[STREAM])
        self.assertEqual(ns["validate_manifest"](manifest()),{STREAM:RAW})

    def test_cannot_widen_scope_change_api_or_install_unreviewed_bytes(self):
        original=manifest()
        mutations=[lambda m:m["sources"].append(dict(m["sources"][0],path="server/proof-api.mjs")),
            lambda m:m["sources"][0].update(before=None),
            lambda m:m["sources"][0].update(before=H),
            lambda m:m["sources"][0].update(after=H),
            lambda m:m["sources"][0].update(base64=base64.b64encode(b"x").decode()),
            lambda m:m["dependencies"].update({"server/proof-api.mjs":H}),
            lambda m:m.update(acceptedInventorySha256=H),
            lambda m:m.update(baseSourceCommit="b"*40)]
        for mutate in mutations:
            m=copy.deepcopy(original);mutate(m)
            with self.assertRaises(ValueError): ns["validate_manifest"](m)

    def test_retained_archive_and_live_response_gates_are_required(self):
        import inspect
        pred=inspect.getsource(release["predecessor"])
        for gate in ("receipt_sources","previous_archive","source-acceptance.json",'archive["inventory"]',"safe_read","completed 42f99"):
            self.assertIn(gate,pred)
        probe=inspect.getsource(release["live_probe"])
        self.assertIn("prior[\"live_postflight\"]",probe)
        self.assertIn("http-response-observation",probe)
        self.assertIn('event.get("payloadBytes")==probe["contentLength"]',probe)
        self.assertIn("No corresponding HTTP 200 byte observation",probe)


if __name__=="__main__":
    unittest.main()
