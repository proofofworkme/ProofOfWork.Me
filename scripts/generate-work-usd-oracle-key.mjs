import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import {
  deriveWorkUsdOracleIdentity,
} from "../server/work-usd-oracle.mjs";

const requestedPath = String(process.argv[2] ?? "").trim();
if (!requestedPath) {
  console.error(
    "Usage: node scripts/generate-work-usd-oracle-key.mjs /absolute/private/path",
  );
  process.exitCode = 1;
} else {
  const outputPath = resolve(requestedPath);
  let privateKey;
  let identity;
  while (!identity) {
    privateKey?.fill(0);
    privateKey = randomBytes(32);
    try {
      identity = deriveWorkUsdOracleIdentity(privateKey);
    } catch {
      // A uniformly random 32-byte string is invalid only when it is
      // zero or outside the secp256k1 scalar range. Draw again.
    }
  }
  let handle;
  try {
    handle = await open(
      outputPath,
      fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(`${privateKey.toString("hex")}\n`, "utf8");
    await handle.sync();
    console.log(`Oracle credential created: ${outputPath}`);
    console.log(`Oracle public key: ${identity.publicKey}`);
    console.log(`Oracle key ID: ${identity.oracleKeyId}`);
  } finally {
    privateKey?.fill(0);
    await handle?.close();
  }
}
