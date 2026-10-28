import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWorkMailBatchDeclarationPins } from "./work-mail-batch-declaration.mjs";
import { completeWorkMailBatchDeclarationDiscovery, discoverWorkMailBatchDeclaration, verifyWorkMailBatchDeclarationSelection } from "./work-mail-batch-selection.mjs";

const hash = "a".repeat(64);
const candidates = Array.from({ length: 80 }, (_, index) => ({
  txid: (index + 1).toString(16).padStart(64, "0"), blockHeight: 1000000,
  blockHash: hash, blockTransactionIndex: index,
}));
const pins = { ...candidates[75], activationHeight: 1000001 };
function fixture({ unavailable = -1, validIndex = 75, cache = new Map() } = {}) {
  const requests = []; const checked = [];
  const readCandidates = async options => {
    requests.push(options);
    const start = options.after ? options.after.blockTransactionIndex + 1 : 0;
    const rows = candidates.slice(start, start + options.limit);
    const overflow = start + rows.length < candidates.length;
    const last = rows.at(-1);
    return { candidates: rows, complete: !overflow, overflow,
      nextCursor: overflow ? { blockHeight: last.blockHeight,
        blockTransactionIndex: last.blockTransactionIndex, txid: last.txid } : null,
      scan: { complete: true, indexedThroughBlock: 1000000, blockHash: hash } };
  };
  return { requests, checked, cache, run: overrides => verifyWorkMailBatchDeclarationSelection({
    pins, cache, readCandidates,
    validateCandidate: async row => {
      checked.push(row.blockTransactionIndex);
      if (row.blockTransactionIndex === unavailable) throw new Error("Core unavailable");
      return row.blockTransactionIndex === validIndex ? { ...row, activationHeight: 1000001 } : null;
    },
    ...overrides,
  }) };
}

test("more than32 public copies cannot permanently prevent the earliest valid declaration", async () => {
  const f = fixture();
  await assert.rejects(f.run(), /discovery-in-progress/u);
  assert.equal(f.checked.length, 64);
  assert.equal(await f.run(), true);
  assert.deepEqual(f.checked, Array.from({ length: 76 }, (_, i) => i));
  const count = f.requests.length;
  assert.equal(await f.run(), true);
  assert.equal(f.requests.length, count);
});

test("unavailable candidate does not advance past missing evidence", async () => {
  const f = fixture({ unavailable: 18 });
  await assert.rejects(f.run(), /Core unavailable/u);
  assert.equal([...f.cache.values()][0].after.blockTransactionIndex, 15);
  const recovered = fixture({ cache: f.cache });
  assert.equal(await recovered.run(), true);
  assert.equal(recovered.checked[0], 16);
});

test("earlier authority declaration, wrong checkpoint and stalled cursor fail closed", async () => {
  await assert.rejects(fixture({ validIndex: 4 }).run(), /not-earliest/u);
  const f = fixture();
  await assert.rejects(f.run({ readCandidates: async () => ({
    candidates: [], complete: true, scan: { complete: true, indexedThroughBlock: 1000000, blockHash: "b".repeat(64) },
  }) }), /selection-incomplete/u);
  await assert.rejects(f.run({ readCandidates: async () => ({
    candidates: candidates.slice(0, 16), complete: false, overflow: true, nextCursor: candidates[0],
    scan: { complete: true, indexedThroughBlock: 1000000, blockHash: hash },
  }) }), /cursor-invalid/u);
});

test("duplicate or unordered positions are not canonical progress", async () => {
  const f = fixture();
  await assert.rejects(f.run({ readCandidates: async () => ({
    candidates: [candidates[1], candidates[1]], complete: true, overflow: false,
    scan: { complete: true, indexedThroughBlock: 1000000, blockHash: hash },
  }) }), /candidate-order-invalid/u);
});

function discoveryFixture({ rows = candidates, cache = new Map(), validIndex = -1 } = {}) {
  const requests = [], checked = [], verified = [];
  return { requests, checked, verified, cache,
    run: (checkpoint, overrides = {}) => discoverWorkMailBatchDeclaration({ checkpoint, cache,
      verifyCheckpoint: async value => { verified.push(value); return true; },
      readCandidates: async options => {
        requests.push(options);
        const selected = rows.filter(row => row.blockHeight <= options.expectedTipHeight &&
          (!options.after || row.blockHeight > options.after.blockHeight ||
          (row.blockHeight === options.after.blockHeight && row.blockTransactionIndex > options.after.blockTransactionIndex)));
        const page = selected.slice(0, options.limit), overflow = selected.length > page.length;
        const last = page.at(-1);
        return { candidates: page, complete: !overflow, overflow,
          nextCursor: overflow ? { blockHeight: last.blockHeight,
            blockTransactionIndex: last.blockTransactionIndex, txid: last.txid } : null,
          scan: { complete: true, indexedThroughBlock: options.expectedTipHeight, blockHash: options.expectedTipHash } };
      },
      validateCandidate: async row => { checked.push(row.blockTransactionIndex);
        return row.blockTransactionIndex === validIndex ? row : null; },
      ...overrides,
    }) };
}

test("automatic discovery progresses across bounded passes and growing canonical prefixes", async () => {
  const f = discoveryFixture({ validIndex: 75 });
  await assert.rejects(f.run({ blockHeight: 1000000, blockHash: hash }), /discovery-in-progress/u);
  const found = await f.run({ blockHeight: 1000001, blockHash: "b".repeat(64) });
  assert.equal(found.txid, candidates[75].txid);
  assert.deepEqual(f.checked, Array.from({ length: 76 }, (_, i) => i));
  assert.equal(f.verified[0].blockHash, hash);
});

test("completed negative prefixes resume after the sealed block and remain bounded", async () => {
  const f = discoveryFixture({ rows: candidates.slice(0, 5) });
  assert.equal(await f.run({ blockHeight: 1000000, blockHash: hash }), null);
  const firstQueries = f.requests.length;
  assert.equal(await f.run({ blockHeight: 1000000, blockHash: hash }), null);
  assert.equal(f.requests.length, firstQueries);
  assert.equal(await f.run({ blockHeight: 1000001, blockHash: "b".repeat(64) }), null);
  assert.deepEqual(f.requests.at(-1).after, { blockHeight: 1000000,
    blockTransactionIndex: 2147483647, txid: "f".repeat(64) });
  assert.deepEqual(f.checked, [0, 1, 2, 3, 4]);
});

test("a reorged negative prefix never skips replacement candidates", async () => {
  const f = discoveryFixture({ rows: candidates.slice(0, 5) });
  await f.run({ blockHeight: 1000000, blockHash: hash });
  const found = await f.run({ blockHeight: 1000001, blockHash: "b".repeat(64) }, {
    verifyCheckpoint: async () => false, validateCandidate: async row => row,
  });
  assert.equal(found.txid, candidates[0].txid);
  assert.equal(f.requests.at(-1).after, undefined);
});

test("pre-floor history has no declaration and incomplete evidence cannot become negative progress", async () => {
  const f = discoveryFixture();
  assert.equal(await f.run({ blockHeight: 972964, blockHash: hash }), null);
  assert.equal(f.requests.length, 0);
  await assert.rejects(f.run({ blockHeight: 1000000, blockHash: hash }, {
    readCandidates: async () => ({ candidates: [], complete: true,
      scan: { complete: false, indexedThroughBlock: 1000000, blockHash: hash } }),
  }), /selection-incomplete/u);
  assert.equal(f.cache.size, 0);
  await assert.rejects(f.run({ blockHeight: 1000000, blockHash: hash }, {
    readCandidates: async () => ({ candidates: [{ ...candidates[0], blockHeight: 972964 }], complete: true,
      scan: { complete: true, indexedThroughBlock: 1000000, blockHash: hash } }),
  }), /candidate-order-invalid/u);
});

test("one canonical replay invocation completes beyond64 copies with fresh process-local state", async () => {
  // Each attempt deliberately starts without any cache from the previous one,
  // matching fresh verifier child processes or a restarted API.
  for (let attempt = 0; attempt < 2; attempt++) {
    let yields = 0, checked = 0;
    const found = await completeWorkMailBatchDeclarationDiscovery({
      checkpoint: { blockHeight: 1000000, blockHash: hash },
      yieldControl: async () => { yields++; },
      readCandidates: async options => {
        const start = options.after ? options.after.blockTransactionIndex + 1 : 0;
        const page = candidates.slice(start, start + options.limit);
        const overflow = start + page.length < candidates.length;
        const last = page.at(-1);
        return { candidates: page, complete: !overflow, overflow,
          nextCursor: overflow ? { blockHeight: last.blockHeight,
            blockTransactionIndex: last.blockTransactionIndex, txid: last.txid } : null,
          scan: { complete: true, indexedThroughBlock: 1000000, blockHash: hash } };
      },
      validateCandidate: async row => { checked++; return row.blockTransactionIndex === 75 ? row : null; },
    });
    assert.equal(found.txid, candidates[75].txid);
    assert.equal(checked, 76); assert.equal(yields, 1);
  }
  await assert.rejects(completeWorkMailBatchDeclarationDiscovery({
    checkpoint: { blockHeight: 1000000, blockHash: hash },
    readCandidates: async () => { throw new Error("Core unavailable"); },
  }), /Core unavailable/u);
});


test("attached-signal ordering never overrides an earlier valid declaration", async () => {
  const earlier = normalizeWorkMailBatchDeclarationPins({ txid: "d".repeat(64), blockHash: hash,
    blockHeight: 1000000, blockTransactionIndex: 1, protocolVout: 1,
    registryPaymentVout: 0, recordOrdinal: 0, activationHeight: 1000001 });
  const compatible = normalizeWorkMailBatchDeclarationPins({ ...earlier,
    txid: "e".repeat(64), protocolVout: 1, registryPaymentVout: 2, blockTransactionIndex: 2 });
  const run = rows => verifyWorkMailBatchDeclarationSelection({ pins: compatible,
    readCandidates: async () => ({ candidates: rows, complete: true, overflow: false,
      scan: { complete: true, indexedThroughBlock: 1000000, blockHash: hash } }),
    validateCandidate: async row => normalizeWorkMailBatchDeclarationPins(row),
  });
  await assert.rejects(run([earlier, compatible]), /not-earliest/u);
  assert.equal(await run([compatible]), true);
});
