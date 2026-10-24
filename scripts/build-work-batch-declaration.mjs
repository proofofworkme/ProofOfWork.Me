import { workBatchDeclarationCommitment } from "../server/work-batch-declaration.mjs";

const declaration = workBatchDeclarationCommitment();
process.stderr.write([
  `declarationTextBytes=${declaration.payloadBytes}`,
  `declarationTextSha256=${declaration.payloadSha256}`,
  `expectedProtocolRecordBytes=${declaration.protocolRecordBytes}`,
  `expectedProtocolRecordSha256=${declaration.protocolRecordSha256}`,
  "",
].join("\n"));
// The display newline is not part of the canonical text or either commitment.
process.stdout.write(`${declaration.text}\n`);
