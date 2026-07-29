import {
  workAmoV6DeclarationCommitment,
} from "../server/work-amo-v6-declaration.mjs";

const declaration = workAmoV6DeclarationCommitment();
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
