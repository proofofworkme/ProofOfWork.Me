#!/usr/bin/python3 -I
"""Offline checks for the guarded source, schema and rehearsal phases."""
import copy
import json
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
release = runpy.run_path(str(HERE/"release.py"))
ns = release["engine"]["namespace"](release["controller"]())
schema = release["schema"]


class SummaryStorageRelease(unittest.TestCase):
    def test_allowed_composition_and_accepted_roots(self):
        self.assertEqual(set(ns["EXPECTED_AFTER"]), ns["ALLOWED"])
        self.assertEqual(release["sha"]((HERE.parents[1]/schema["MIGRATION"]).read_bytes()),schema["MIGRATION_SHA"])
        self.assertEqual(len(ns["ALLOWED"]),10)
        self.assertEqual(set(ns["INSTALL_ORDER"][:len(ns["NEW"])]),ns["NEW"])
        self.assertEqual(ns["INSTALL_ORDER"][-2:],["scripts/backfill-proof-indexer.mjs","server/proof-api.mjs"])
        self.assertTrue(all(ns["SHA"].fullmatch(v) for v in ns["EXPECTED_AFTER"].values()))
        self.assertEqual(ns["ACCEPTED_SHA"],"96213da3e3bdc800be17967cbf977a9ac9ec65adf89e972ca17005da598f1899")
        self.assertEqual(release["COMPLETION_SHA"],"4c82a1bfad023872bdafbcb9b03241da4158c520f19ebf5042e83f1141cbd18e")
        self.assertFalse(any(n.endswith(".sql") for n in ns["ALLOWED"]))
        self.assertEqual(ns["BASE_SOURCE_COMMIT"],"ac0d4373a09178228b36f51dc6f4dde4b8d9bc28")

    def test_separate_idempotent_schema_phase(self):
        raw=b"qualified DDL"
        inv={"exists":True,"schema":{"owner":"postgres"}}
        ran=[]
        with patch.dict(schema,{"storage_state":lambda:inv,"psql":lambda sql:ran.append(sql)}):
            self.assertTrue(schema["migrate"](raw)["alreadyInstalled"])
            self.assertEqual(ran,[])
        calls=iter([{"exists":False},inv])
        with patch.dict(schema,{"storage_state":lambda:next(calls),"psql":lambda sql:ran.append(sql)}):
            self.assertFalse(schema["migrate"](raw)["alreadyInstalled"])
            self.assertEqual(ran,["qualified DDL"])
        with patch.dict(schema,{"storage_state":lambda:(_ for _ in ()).throw(ValueError("wrong existing schema")),"psql":lambda _:self.fail("unsafe migration")}):
            with self.assertRaises(ValueError): schema["migrate"](raw)

    def test_exact_fork_and_projection_proof_cannot_be_shortened(self):
        js=(HERE/"proof.mjs").read_text()
        for n in ("prepareWorkTransferProjection","decodeWorkTransferProjection","internalCanonicalSummaryPayload",
                  "canonicalSummaryAccountingModelsCurrent","exactWorkQ16CanonicalSummaryState","recoverCandidateDiscoveryReorg",
                  "actualValue.totalQ8","Number(row.minerFeeSats) === 0","recipientCount === 256","20971520","23592960"):
            self.assertIn(n,js)
        self.assertIn("dryRun:true",js)
        self.assertIn("published:false",js)
        self.assertNotIn("storeWorkTransferProjection(",js)
        self.assertEqual(len(release["DROP_INS"]),2)
        self.assertEqual(set(release["RECEIPTS"]),{"preflight.json","applied.json","postflight.json"})

    def test_catalog_rejects_structural_and_privilege_drift(self):
        oid="486390"
        row={"owner":"postgres","kind":"r","persistence":"p","rls":False,"extraTriggers":0,"extraRules":0,"columnACL":0,
            "columns":[["network","text",True,"",None],["snapshot_id","text",True,"",None],["page_index","integer",True,"",None],
              ["payload","bytea",True,"",None],["page_bytes","integer",False,"s","octet_length(payload)"],
              ["page_sha256","bytea",False,"s","sha256(payload)"]],
            "constraints":[[k,c,True,False] for k,c in [
                ("p","PRIMARY KEY (network, snapshot_id, page_index) INCLUDE (page_bytes)"),
                ("f","FOREIGN KEY (network, snapshot_id) REFERENCES proof_indexer.ledger_snapshots(network, snapshot_id) ON DELETE CASCADE"),
                ("c","CHECK ((page_index >= 0))"),("c","CHECK (((octet_length(payload) >= 1) AND (octet_length(payload) <= 262144)))")]],
            "indexes":[[True,True,True,"CREATE UNIQUE INDEX p ON proof_indexer.work_transfer_projection_pages USING btree (network, snapshot_id, page_index) INCLUDE (page_bytes)"]],
            "rights":[["proof_indexer","INSERT",False],["proof_indexer","SELECT",False]],
            "tablespaces":[["r"+str(i),oid,"pg_tblspc/"+oid+"/some/path"+str(i)] for i in range(4)]}
        with patch.dict(schema,{"select":lambda _:row}):
            self.assertEqual(schema["validate_schema"](oid),row)
        for key,replacement in (("owner","proof_indexer"),("kind","p"),("extraTriggers",1),("rls",True),
             ("rights",[["PUBLIC","SELECT",False]]),("columns",row["columns"][:-1]),("constraints",row["constraints"][:-1]),
             ("indexes",[]),("tablespaces",row["tablespaces"][:-1]),("tablespaces",[["x","0","base/1"]]*4)):
            altered={**copy.deepcopy(row),key:replacement}
            with patch.dict(schema,{"select":lambda _:altered}):
                with self.assertRaises(ValueError): schema["validate_schema"](oid)


if __name__=="__main__":
    unittest.main()
