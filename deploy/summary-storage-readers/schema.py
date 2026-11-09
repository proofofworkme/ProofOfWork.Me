"""Physical and catalog checks for the additive projection-page migration."""
import json
import os
from pathlib import Path
import subprocess

TABLE = "proof_indexer.work_transfer_projection_pages"
PARENT = "proof_indexer.ledger_snapshots"
TABLESPACE = "proof_indexer_large_state_v1"
STORAGE = Path("/data/proofofwork-postgres-tablespaces/proof_indexer_large_state_v1")
MIGRATION = "server/sql/work-transfer-projection-pages-v1.sql"
MIGRATION_SHA = "1ce1aa3bbd1fe8b72b03f34c81f0d8e5c7a27449bf6f906aa57f296932569473"


def psql(sql):
    result = subprocess.run(["/usr/sbin/runuser", "-u", "postgres", "--", "/usr/bin/psql", "-X", "-qAt",
        "--set", "ON_ERROR_STOP=1", "--dbname=proof_indexer"], input=sql, text=True, capture_output=True,
        timeout=55, check=True, env={"PATH": "/usr/bin:/bin", "PGAPPNAME": "summary-storage-readers-schema"})
    return result.stdout.strip()


def select(sql):
    return json.loads(psql("BEGIN READ ONLY; SET LOCAL statement_timeout='8s'; " + sql + "; ROLLBACK;"))


def storage_state():
    row = select("""SELECT json_build_object('name',t.spcname,'path',pg_tablespace_location(t.oid),'oid',t.oid::text,
      'parent',pg_relation_filepath(c.oid),'exists',to_regclass('proof_indexer.work_transfer_projection_pages') IS NOT NULL,
      'db',current_database(),'admin',current_user,'login',r.rolcanlogin,'super',r.rolsuper,'createRole',r.rolcreaterole)
      FROM pg_class c JOIN pg_database d ON d.datname=current_database()
      JOIN pg_tablespace t ON t.oid=CASE WHEN c.reltablespace=0 THEN d.dattablespace ELSE c.reltablespace END
      JOIN pg_roles r ON r.rolname='proof_indexer' WHERE c.oid='proof_indexer.ledger_snapshots'::regclass""")
    need(row["name"] == TABLESPACE and row["path"] == str(STORAGE) and row["parent"].startswith("pg_tblspc/" + row["oid"] + "/")
         and row["db"] == "proof_indexer" and row["admin"] == "postgres" and row["login"] and not row["super"] and not row["createRole"],
         "Unexpected data tablespace, login, administrator, or legacy parent")
    need(STORAGE.resolve(strict=True) == STORAGE and STORAGE.stat().st_dev == Path("/data").stat().st_dev,
         "Data tablespace does not reside on the /data volume")
    stat = os.statvfs(STORAGE)
    row["freeBytes"] = stat.f_bavail * stat.f_frsize
    need(row["freeBytes"] >= 5 * 1024**3, "Insufficient data tablespace headroom")
    if row["exists"]:
        row["schema"] = validate_schema(row["oid"])
    return row


def validate_schema(tablespace_oid):
    row = select("""SELECT jsonb_build_object(
      'owner',pg_get_userbyid(c.relowner),'kind',c.relkind,'persistence',c.relpersistence,'rls',c.relrowsecurity OR c.relforcerowsecurity,
      'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attgenerated,
           pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
           WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
      'constraints',(SELECT jsonb_agg(jsonb_build_array(contype,pg_get_constraintdef(oid),convalidated,condeferrable) ORDER BY contype,conname)
           FROM pg_constraint WHERE conrelid=c.oid),
      'indexes',(SELECT jsonb_agg(jsonb_build_array(indisvalid,indisready,indisprimary,pg_get_indexdef(indexrelid))) FROM pg_index WHERE indrelid=c.oid),
      'rights',(SELECT jsonb_agg(jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
           ORDER BY a.grantee,a.privilege_type) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner),
      'tablespaces',(SELECT jsonb_agg(jsonb_build_array(k.relname,k.reltablespace::text,pg_relation_filepath(k.oid))) FROM pg_class k
           WHERE k.oid IN (c.oid,c.reltoastrelid) OR k.oid IN (SELECT indexrelid FROM pg_index WHERE indrelid IN (c.oid,c.reltoastrelid))),
      'extraTriggers',(SELECT count(*) FROM pg_trigger tg WHERE tg.tgrelid=c.oid AND NOT tgisinternal),
      'extraRules',(SELECT count(*) FROM pg_rewrite WHERE ev_class=c.oid),
      'columnACL',(SELECT count(*) FROM pg_attribute WHERE attrelid=c.oid AND attacl IS NOT NULL))
      FROM pg_class c WHERE c.oid='proof_indexer.work_transfer_projection_pages'::regclass""")
    need(row["owner"] == "postgres" and row["kind"] == "r" and row["persistence"] == "p" and not row["rls"] and
         not any(row[k] for k in ("extraTriggers","extraRules","columnACL")), "Unexpected page storage owner or table features")
    expect = [["network","text",True,"",None],["snapshot_id","text",True,"",None],["page_index","integer",True,"",None],
              ["payload","bytea",True,"",None],["page_bytes","integer",False,"s","octet_length(payload)"],
              ["page_sha256","bytea",False,"s","sha256(payload)"]]
    need(row["columns"] == expect, "Unexpected projection page columns or generated expressions")
    constraints = {(k, definition) for k,definition,valid,deferred in row["constraints"] if valid and not deferred}
    need(len(row["constraints"]) == 4 and constraints == {
        ("p","PRIMARY KEY (network, snapshot_id, page_index) INCLUDE (page_bytes)"),
        ("f","FOREIGN KEY (network, snapshot_id) REFERENCES proof_indexer.ledger_snapshots(network, snapshot_id) ON DELETE CASCADE"),
        ("c","CHECK ((page_index >= 0))"),("c","CHECK (((octet_length(payload) >= 1) AND (octet_length(payload) <= 262144)))")},
        "Unexpected page constraints, key or foreign-key deletion behavior")
    need(len(row["indexes"]) == 1 and all(row["indexes"][0][:3]) and row["indexes"][0][3].endswith(
        "USING btree (network, snapshot_id, page_index) INCLUDE (page_bytes)"), "Unexpected page index")
    need(row["rights"] == [["proof_indexer","INSERT",False],["proof_indexer","SELECT",False]], "Unexpected nonowner page grants")
    physical = row["tablespaces"]
    need(len(physical) == 4 and all(oid == tablespace_oid and path.startswith("pg_tblspc/" + oid + "/")
                                    for _,oid,path in physical), "Page heap/index/TOAST are not all in the qualified data tablespace")
    return row


def migrate(raw):
    before = storage_state()
    if not before["exists"]:
        psql(raw.decode("utf-8"))
    after = storage_state()
    need(after["exists"], "Additive projection-page migration failed")
    return {"alreadyInstalled": before["exists"], "sha256": sha(raw), "schema": after}
