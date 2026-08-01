import {
  workAmoV8DeclarationCommitment,
} from "../server/work-amo-v8-declaration.mjs";

const declaration = workAmoV8DeclarationCommitment();
process.stderr.write(
  [
    `declarationTextBytes=${declaration.payloadBytes}`,
    `declarationTextSha256=${declaration.payloadSha256}`,
    `expectedProtocolRecordBytes=${declaration.protocolRecordBytes}`,
    `expectedProtocolRecordSha256=${declaration.protocolRecordSha256}`,
    "",
  ].join("\n"),
);
// The presentation newline is not part of declaration.text or either hash.
process.stdout.write(`${declaration.text}\n`);
