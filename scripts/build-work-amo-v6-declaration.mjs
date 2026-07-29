import {
  workAmoV6DeclarationCommitment,
} from "../server/work-amo-v6-declaration.mjs";

const oraclePublicKey = String(process.argv[2] ?? "").trim();
const oracleKeyId = String(process.argv[3] ?? "").trim();

if (!oraclePublicKey || !oracleKeyId) {
  console.error(
    "Usage: node scripts/build-work-amo-v6-declaration.mjs <oracle-public-key> <oracle-key-id>",
  );
  process.exitCode = 1;
} else {
  const declaration = workAmoV6DeclarationCommitment({
    oracleKeyId,
    oraclePublicKey,
  });
  process.stdout.write(declaration.text);
  process.stderr.write(
    [
      `declarationTextBytes=${declaration.payloadBytes}`,
      `declarationTextSha256=${declaration.payloadSha256}`,
      `expectedProtocolRecordBytes=${declaration.protocolRecordBytes}`,
      `expectedProtocolRecordSha256=${declaration.protocolRecordSha256}`,
      "",
    ].join("\n"),
  );
}
