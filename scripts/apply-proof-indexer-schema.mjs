import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createProofIndexPool } from "../server/db/postgres.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const schemaPath = path.join(repoRoot, "server/sql/proof-indexer-v1.sql");

const dryRun = process.argv.includes("--dry-run");
const schemaSql = await readFile(schemaPath, "utf8");

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        dryRun: true,
        schemaPath,
        statements: schemaSql
          .split(";")
          .map((statement) => statement.trim())
          .filter(Boolean).length,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const pool = createProofIndexPool({
  env: {
    ...process.env,
    POW_INDEX_DB_APP_NAME:
      process.env.POW_INDEX_DB_APP_NAME ?? "proof-indexer-schema",
  },
});

try {
  await pool.query(schemaSql);
  await pool.query(
    `
      INSERT INTO proof_indexer.meta (key, value, updated_at)
      VALUES (
        'schema',
        jsonb_build_object(
          'name', 'proof-indexer-v1',
          'path', $1::text,
          'appliedAt', now()
        ),
        now()
      )
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [path.relative(repoRoot, schemaPath)],
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        schema: "proof-indexer-v1",
        schemaPath,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
