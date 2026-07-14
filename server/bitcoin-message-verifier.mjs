import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";

bitcoin.initEccLib(ecc);

const BIP322_SIMPLE_PREFIX = "smp";
const BITCOIN_MESSAGE_PREFIX = Buffer.from("\u0018Bitcoin Signed Message:\n", "utf8");
const MAX_MESSAGE_BYTES = 100_000;
const MAX_SIGNATURE_TEXT_BYTES = 512;
const MAX_WITNESS_BYTES = 256;
const MAX_WITNESS_ITEMS = 2;
const MAX_WITNESS_ITEM_BYTES = 80;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function equalBytes(left, right) {
  return (
    left?.byteLength === right?.byteLength &&
    Buffer.from(left).equals(Buffer.from(right))
  );
}

function canonicalBase64Bytes(value, maxBytes) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SIGNATURE_TEXT_BYTES ||
    !BASE64_PATTERN.test(value)
  ) {
    return null;
  }

  const decoded = Buffer.from(value, "base64");
  if (
    decoded.length === 0 ||
    decoded.length > maxBytes ||
    decoded.toString("base64") !== value
  ) {
    return null;
  }
  return decoded;
}

function compactSizeAt(buffer, offset) {
  if (offset >= buffer.length) {
    return null;
  }

  const prefix = buffer[offset];
  if (prefix < 0xfd) {
    return { bytes: 1, value: prefix };
  }
  if (prefix === 0xfd) {
    if (offset + 3 > buffer.length) return null;
    const value = buffer.readUInt16LE(offset + 1);
    return value >= 0xfd ? { bytes: 3, value } : null;
  }
  if (prefix === 0xfe) {
    if (offset + 5 > buffer.length) return null;
    const value = buffer.readUInt32LE(offset + 1);
    return value > 0xffff ? { bytes: 5, value } : null;
  }
  if (offset + 9 > buffer.length) return null;
  const value = buffer.readBigUInt64LE(offset + 1);
  if (value <= 0xffffffffn || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return { bytes: 9, value: Number(value) };
}

function parseCanonicalWitness(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_WITNESS_BYTES) {
    return null;
  }

  const count = compactSizeAt(buffer, 0);
  if (!count || count.value < 1 || count.value > MAX_WITNESS_ITEMS) {
    return null;
  }

  const items = [];
  let offset = count.bytes;
  for (let index = 0; index < count.value; index += 1) {
    const size = compactSizeAt(buffer, offset);
    if (!size || size.value > MAX_WITNESS_ITEM_BYTES) {
      return null;
    }
    offset += size.bytes;
    if (offset + size.value > buffer.length) {
      return null;
    }
    items.push(buffer.subarray(offset, offset + size.value));
    offset += size.value;
  }

  return offset === buffer.length ? items : null;
}

function addressDetails(address) {
  if (typeof address !== "string" || address.length < 14 || address.length > 90) {
    return null;
  }

  for (const network of [
    bitcoin.networks.bitcoin,
    bitcoin.networks.testnet,
    bitcoin.networks.regtest,
  ]) {
    try {
      const script = Buffer.from(bitcoin.address.toOutputScript(address, network));
      if (
        script.length === 25 &&
        script[0] === bitcoin.opcodes.OP_DUP &&
        script[1] === bitcoin.opcodes.OP_HASH160 &&
        script[2] === 0x14 &&
        script[23] === bitcoin.opcodes.OP_EQUALVERIFY &&
        script[24] === bitcoin.opcodes.OP_CHECKSIG
      ) {
        return { network, script, type: "p2pkh" };
      }
      if (
        script.length === 23 &&
        script[0] === bitcoin.opcodes.OP_HASH160 &&
        script[1] === 0x14 &&
        script[22] === bitcoin.opcodes.OP_EQUAL
      ) {
        return { network, script, type: "p2sh-p2wpkh" };
      }
      if (script.length === 22 && script[0] === 0x00 && script[1] === 0x14) {
        return { network, script, type: "p2wpkh" };
      }
      if (
        script.length === 34 &&
        script[0] === bitcoin.opcodes.OP_1 &&
        script[1] === 0x20
      ) {
        return { network, script, type: "p2tr" };
      }
    } catch {
      // Try the next network. Unsupported scripts fail closed below.
    }
  }
  return null;
}

function messageBytes(message) {
  if (typeof message !== "string") {
    return null;
  }
  const bytes = Buffer.from(message, "utf8");
  return bytes.length <= MAX_MESSAGE_BYTES ? bytes : null;
}

function compactSize(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid compact-size value.");
  }
  if (value < 0xfd) return Buffer.from([value]);
  if (value <= 0xffff) {
    const encoded = Buffer.alloc(3);
    encoded[0] = 0xfd;
    encoded.writeUInt16LE(value, 1);
    return encoded;
  }
  if (value <= 0xffffffff) {
    const encoded = Buffer.alloc(5);
    encoded[0] = 0xfe;
    encoded.writeUInt32LE(value, 1);
    return encoded;
  }
  const encoded = Buffer.alloc(9);
  encoded[0] = 0xff;
  encoded.writeBigUInt64LE(BigInt(value), 1);
  return encoded;
}

function bitcoinMessageHash(bytes) {
  return bitcoin.crypto.hash256(
    Buffer.concat([BITCOIN_MESSAGE_PREFIX, compactSize(bytes.length), bytes]),
  );
}

function bip322Transactions(bytes, challengeScript) {
  const tagHash = bitcoin.crypto.sha256(
    Buffer.from("BIP0322-signed-message", "utf8"),
  );
  const messageHash = bitcoin.crypto.sha256(
    Buffer.concat([Buffer.from(tagHash), Buffer.from(tagHash), bytes]),
  );
  const toSpend = new bitcoin.Transaction();
  toSpend.version = 0;
  toSpend.locktime = 0;
  toSpend.addInput(
    Buffer.alloc(32),
    0xffffffff,
    0,
    Buffer.concat([Buffer.from([bitcoin.opcodes.OP_0, 0x20]), messageHash]),
  );
  toSpend.addOutput(challengeScript, 0n);

  const toSign = new bitcoin.Transaction();
  toSign.version = 0;
  toSign.locktime = 0;
  toSign.addInput(toSpend.getHash(), 0, 0, Buffer.alloc(0));
  toSign.addOutput(Buffer.from([bitcoin.opcodes.OP_RETURN]), 0n);
  return { toSign, toSpend };
}

function verifyBip137(details, bytes, signature) {
  if (signature.length !== 65 || details.type === "p2tr") {
    return false;
  }

  const header = signature[0];
  let compressed;
  let recovery;
  if (header >= 27 && header <= 30) {
    compressed = false;
    recovery = header - 27;
  } else if (header >= 31 && header <= 34) {
    compressed = true;
    recovery = header - 31;
  } else if (header >= 35 && header <= 38) {
    compressed = true;
    recovery = header - 35;
  } else if (header >= 39 && header <= 42) {
    compressed = true;
    recovery = header - 39;
  } else {
    return false;
  }

  const compactSignature = signature.subarray(1);
  const publicKey = ecc.recover(
    bitcoinMessageHash(bytes),
    compactSignature,
    recovery,
    compressed,
  );
  if (!publicKey) {
    return false;
  }

  let derivedScript;
  if (details.type === "p2pkh") {
    const compressedPublicKey = ecc.pointCompress(publicKey, true);
    const uncompressedPublicKey = ecc.pointCompress(publicKey, false);
    return [compressedPublicKey, uncompressedPublicKey].some((candidate) =>
      equalBytes(
        bitcoin.payments.p2pkh({
          network: details.network,
          pubkey: candidate,
        }).output,
        details.script,
      ),
    );
  } else if (details.type === "p2sh-p2wpkh") {
    const redeem = bitcoin.payments.p2wpkh({
      network: details.network,
      pubkey: ecc.pointCompress(publicKey, true),
    });
    derivedScript = bitcoin.payments.p2sh({
      network: details.network,
      redeem,
    }).output;
  } else {
    derivedScript = bitcoin.payments.p2wpkh({
      network: details.network,
      pubkey: ecc.pointCompress(publicKey, true),
    }).output;
  }
  return equalBytes(derivedScript, details.script);
}

function verifyBip322(details, bytes, signatureText) {
  if (details.type === "p2pkh") {
    return false;
  }
  const encoded = signatureText.startsWith(BIP322_SIMPLE_PREFIX)
    ? signatureText.slice(BIP322_SIMPLE_PREFIX.length)
    : signatureText;
  const serializedWitness = canonicalBase64Bytes(encoded, MAX_WITNESS_BYTES);
  const witness = serializedWitness
    ? parseCanonicalWitness(serializedWitness)
    : null;
  if (!witness) {
    return false;
  }

  const { toSign } = bip322Transactions(bytes, details.script);
  if (details.type === "p2tr") {
    if (witness.length !== 1) {
      return false;
    }
    const encodedSignature = witness[0];
    let hashType;
    let schnorrSignature;
    if (encodedSignature.length === 64) {
      hashType = bitcoin.Transaction.SIGHASH_DEFAULT;
      schnorrSignature = encodedSignature;
    } else if (
      encodedSignature.length === 65 &&
      encodedSignature[64] === bitcoin.Transaction.SIGHASH_ALL
    ) {
      hashType = bitcoin.Transaction.SIGHASH_ALL;
      schnorrSignature = encodedSignature.subarray(0, 64);
    } else {
      return false;
    }
    const hash = toSign.hashForWitnessV1(
      0,
      [details.script],
      [0n],
      hashType,
    );
    return ecc.verifySchnorr(hash, details.script.subarray(2), schnorrSignature);
  }

  if (witness.length !== 2) {
    return false;
  }
  const [encodedSignature, publicKey] = witness;
  if (
    publicKey.length !== 33 ||
    (publicKey[0] !== 0x02 && publicKey[0] !== 0x03)
  ) {
    return false;
  }

  const publicKeyHash = bitcoin.crypto.hash160(publicKey);
  if (details.type === "p2wpkh") {
    if (!equalBytes(publicKeyHash, details.script.subarray(2))) {
      return false;
    }
  } else {
    const redeemScript = Buffer.concat([Buffer.from([0x00, 0x14]), publicKeyHash]);
    if (
      !equalBytes(bitcoin.crypto.hash160(redeemScript), details.script.subarray(2, 22))
    ) {
      return false;
    }
  }

  const decoded = bitcoin.script.signature.decode(encodedSignature);
  if (decoded.hashType !== bitcoin.Transaction.SIGHASH_ALL) {
    return false;
  }
  const scriptCode = bitcoin.payments.p2pkh({ hash: publicKeyHash }).output;
  if (!scriptCode) {
    return false;
  }
  const hash = toSign.hashForWitnessV0(
    0,
    scriptCode,
    0n,
    bitcoin.Transaction.SIGHASH_ALL,
  );
  return ecc.verify(hash, publicKey, decoded.signature, true);
}

/**
 * Verify the address-bound message formats used by historical PowID sales.
 *
 * Supported inputs are strict BIP-137 compact signatures for P2PKH,
 * P2SH-P2WPKH and P2WPKH, plus simple BIP-322 witnesses for P2WPKH,
 * P2SH-P2WPKH and single-key P2TR. Both the current `smp` prefix and the
 * pre-finalization unprefixed BIP-322 form are accepted for compatibility.
 * Historical BIP-137 address-header mismatches are also accepted when the
 * recovered key derives the claimed non-Taproot address, matching the prior
 * buy2 verifier's behavior.
 */
export function verifyBitcoinMessageSignature(address, message, signatureText) {
  try {
    const details = addressDetails(address);
    const bytes = messageBytes(message);
    if (
      !details ||
      !bytes ||
      typeof signatureText !== "string" ||
      signatureText.length > MAX_SIGNATURE_TEXT_BYTES
    ) {
      return false;
    }

    // A canonical 65-byte encoding is unambiguously BIP-137. Trying it before
    // the `smp` prefix also avoids misclassifying a rare legacy base64 string
    // whose first three characters happen to be "smp".
    const legacySignature = canonicalBase64Bytes(signatureText, 65);
    if (legacySignature?.length === 65) {
      return verifyBip137(details, bytes, legacySignature);
    }
    return verifyBip322(details, bytes, signatureText);
  } catch {
    return false;
  }
}
