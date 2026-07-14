import assert from "node:assert/strict";
import { verifyBitcoinMessageSignature as verify } from "../server/bitcoin-message-verifier.mjs";

// BIP-322 basic vectors from bitcoin/bips, bip-0322/basic-test-vectors.json.
const P2WPKH_ADDRESS = "bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l";
const P2WPKH_MESSAGE = "Hello World";
const P2WPKH_SIGNATURE =
  "smpAkcwRAIgZRfIY3p7/DoVTty6YZbWS71bc5Vct9p9Fia83eRmw2QCICK/ENGfwLtptFluMGs2KsqoNSk89pO7F29zJLUx9a/sASECx/EgAxlkQpQ9hYjgGu6EBCPMVPwVIVJqO4XCsMvViHI=";
const P2TR_ADDRESS =
  "bc1pss0zhytly75awhm6x2hhvd5lnzv3vssgrf9axfheq8ldyzn88ges79fler";
const P2TR_MESSAGE = "No prefix fallback";
const P2TR_SIGNATURE =
  "AUCJYOwOjxYAvatTAGYaVlNXBVyFuc4MwNQkOuK2tl8xhfKDONd0NjfYyNSYcRqeCp8hsAnCEPHAVEkO9h6vbQ/R";

// Compatibility vector produced by bip322-js 3.0.0 before its removal.
const P2SH_ADDRESS = "37qyp7jQAzqb2rCBpMvVtLDuuzKAUCVnJb";
const P2SH_SIGNATURE =
  "AkcwRAIgRfq2Gfv9guFcXAf2vQEJSHX8FP5OuiHs1DSK1I0wk/0CIGPzqm6QNPTDJuki148OQ2DbJtXyrr71s4xYPwogQUupASECx/EgAxlkQpQ9hYjgGu6EBCPMVPwVIVJqO4XCsMvViHI=";

// Deterministic BIP-137 vectors for one key and message. The four headers
// cover uncompressed/compressed P2PKH, P2SH-P2WPKH and native P2WPKH.
const LEGACY_MESSAGE = "ProofOfWork legacy sale authorization";
const BIP137_VECTORS = [
  [
    "169ojqRJ3d4f7aNMu86nAAwGJyeykmByFU",
    "HLktysuv44MhDTJdBwL4xYiEgQ9dpA4qQPn8w5T5WDyjATUlbuR2jBkyFK9/I8x4G+f7Rk53bvRyBaSUDWSToGA=",
  ],
  [
    "14vV3aCHBeStb5bkenkNHbe2YAFinYdXgc",
    "ILktysuv44MhDTJdBwL4xYiEgQ9dpA4qQPn8w5T5WDyjATUlbuR2jBkyFK9/I8x4G+f7Rk53bvRyBaSUDWSToGA=",
  ],
  [
    P2SH_ADDRESS,
    "JLktysuv44MhDTJdBwL4xYiEgQ9dpA4qQPn8w5T5WDyjATUlbuR2jBkyFK9/I8x4G+f7Rk53bvRyBaSUDWSToGA=",
  ],
  [
    P2WPKH_ADDRESS,
    "KLktysuv44MhDTJdBwL4xYiEgQ9dpA4qQPn8w5T5WDyjATUlbuR2jBkyFK9/I8x4G+f7Rk53bvRyBaSUDWSToGA=",
  ],
];
const LEGACY_SALE_MESSAGE = [
  "ProofOfWork.Me ID Sale",
  "version:pwid-sale-v1",
  "id:compatibility@proofofwork.me",
  "seller:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
  "priceSats:12345",
  "buyer:*",
  "receiver:*",
  "nonce:compatibility-vector",
  "expiresAt:",
].join("\n");
const LEGACY_SALE_SIGNATURE =
  "KEZcvmgO3GNFJccn1KiH98ZZczREnxcNet5cvskiTat3VlltyyzkVqls5thSk8juqviOnhmiyo+7euuJwj0rDJ0=";

let assertions = 0;
function accepted(address, message, signature, label) {
  assert.equal(verify(address, message, signature), true, label);
  assertions += 1;
}
function rejected(address, message, signature, label) {
  assert.equal(verify(address, message, signature), false, label);
  assertions += 1;
}

accepted(P2WPKH_ADDRESS, P2WPKH_MESSAGE, P2WPKH_SIGNATURE, "official P2WPKH");
accepted(
  P2WPKH_ADDRESS,
  P2WPKH_MESSAGE,
  P2WPKH_SIGNATURE.slice(3),
  "pre-finalization unprefixed P2WPKH",
);
accepted(P2TR_ADDRESS, P2TR_MESSAGE, P2TR_SIGNATURE, "official P2TR");
accepted(P2SH_ADDRESS, P2WPKH_MESSAGE, P2SH_SIGNATURE, "nested P2SH-P2WPKH");
for (const [address, signature] of BIP137_VECTORS) {
  accepted(address, LEGACY_MESSAGE, signature, `BIP-137 ${address}`);
}
accepted(
  "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
  LEGACY_SALE_MESSAGE,
  LEGACY_SALE_SIGNATURE,
  "legacy pwid-sale-v1 authorization",
);

rejected(P2WPKH_ADDRESS, "wrong message", P2WPKH_SIGNATURE, "wrong message");
rejected(P2TR_ADDRESS, "wrong message", P2TR_SIGNATURE, "wrong P2TR message");
rejected(P2SH_ADDRESS, "wrong message", P2SH_SIGNATURE, "wrong nested message");
rejected(
  "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e",
  P2WPKH_MESSAGE,
  P2WPKH_SIGNATURE,
  "wrong address",
);
accepted(
  P2WPKH_ADDRESS,
  LEGACY_MESSAGE,
  BIP137_VECTORS[2][1],
  "historical loose BIP-137 address header",
);
accepted(
  P2WPKH_ADDRESS,
  LEGACY_MESSAGE,
  BIP137_VECTORS[0][1],
  "historical loose uncompressed BIP-137 header",
);
accepted(
  BIP137_VECTORS[1][0],
  LEGACY_MESSAGE,
  BIP137_VECTORS[3][1],
  "historical loose BIP-137 header for P2PKH",
);
rejected(
  P2TR_ADDRESS,
  LEGACY_MESSAGE,
  BIP137_VECTORS[3][1],
  "BIP-137 cannot authorize Taproot",
);

for (const malformed of [
  "",
  "not-valid-base64!!!",
  `${P2WPKH_SIGNATURE} `,
  `${P2WPKH_SIGNATURE}=`,
  "smpAA==",
  "smpAw==",
  "smp/QIA",
  `smp${Buffer.concat([
    Buffer.from([0xfd, 0x02, 0x00]),
    Buffer.from(P2WPKH_SIGNATURE.slice(3), "base64").subarray(1),
  ]).toString("base64")}`,
  `smp${Buffer.concat([
    Buffer.from(P2WPKH_SIGNATURE.slice(3), "base64"),
    Buffer.from([0]),
  ]).toString("base64")}`,
  "A".repeat(512),
  "A".repeat(513),
]) {
  rejected(P2WPKH_ADDRESS, P2WPKH_MESSAGE, malformed, "malformed witness");
}

const p2trRaw = Buffer.from(P2TR_SIGNATURE, "base64");
const explicitDefaultP2tr = Buffer.concat([
  Buffer.from([0x01, 0x41]),
  p2trRaw.subarray(2),
  Buffer.from([0x00]),
]).toString("base64");
rejected(
  P2TR_ADDRESS,
  P2TR_MESSAGE,
  explicitDefaultP2tr,
  "65-byte Taproot signature cannot encode SIGHASH_DEFAULT",
);
const invalidLegacyHeader = Buffer.from(BIP137_VECTORS[3][1], "base64");
invalidLegacyHeader[0] = 43;
rejected(
  P2WPKH_ADDRESS,
  LEGACY_MESSAGE,
  invalidLegacyHeader.toString("base64"),
  "undefined BIP-137 header",
);
rejected(
  P2WPKH_ADDRESS,
  LEGACY_MESSAGE,
  Buffer.concat([Buffer.from([39]), Buffer.alloc(64)]).toString("base64"),
  "invalid compact ECDSA scalar",
);
rejected(
  "bc1qp0ahvfh83088w49k405szqgg4f3pptr7p2g06tdxfjcd40z4lh4q95lsz9",
  P2WPKH_MESSAGE,
  P2WPKH_SIGNATURE,
  "unsupported P2WSH",
);
rejected(
  P2WPKH_ADDRESS,
  "x".repeat(100_001),
  P2WPKH_SIGNATURE,
  "oversized message",
);

console.log(`Bitcoin message signature checks passed (${assertions} assertions).`);
