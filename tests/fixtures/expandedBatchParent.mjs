import assert from "node:assert/strict";
import { normalizeExpandedLiquidityPins } from "../../server/work-amo-expanded-liquidity.mjs";

const declaration = normalizeExpandedLiquidityPins({ txid: "57eb549372f2318bfc3ade62c62e9e1092cd42702e9ffb5e2733659acc241f33",
  blockHeight: 977229, blockHash: "0000000000000000000113f979011a14bdcecdb509671b763fc60a02ebaccbc9", blockTransactionIndex: 591,
  protocolVout: 1, recordOrdinal: 0, registryPaymentVout: null, firstEligibleBlockOffset: 1, firstEligibleTransactionIndex: 0 });

export function expandedBatchFixture(evidence) {
  const parent = evidence.parent_records[0], position = parent.position;
  const archived = [{ ...parent, protocol: "pwt1" }, ...(evidence.mail_records ?? []).map(record => ({
    ...record, derived: [], transitionChainCommitmentAfter: { ...parent.transitionChainCommitmentAfter, sha256: "8".repeat(64) },
  }))];
  const selected = structuredClone(archived);
  for (const [i, record] of selected.entries()) {
    record.transitionChainCommitmentAfter = { ...record.transitionChainCommitmentAfter, sha256: (i + 1).toString().repeat(64) };
    for (const child of record.derived) child.parentTransitionChainCommitmentAfter = record.transitionChainCommitmentAfter;
  }
  return {
    initial: { ...evidence, parent_records: null, mail_records: null, expanded_declaration: declaration,
      selected_storage: { model: "proof-indexer-native-transition-chunks-v1", sha256: "e".repeat(64) },
      selected_height: position.blockHeight, selected_hash: position.blockHash,
      selected_family: { id: String(evidence.parent_event_id), txid: parent.txid, index: position.blockTransactionIndex, vout: position.protocolVout } },
    current: { ...evidence, selected_records: selected, archived_records: archived, resealed: true },
  };
}

// Reuse each product's real wire/parent/recipient fixture. The first result names the compact selected pointer.
// The second simulates the restricted same-snapshot SQL, including all siblings even for a one-event page.
export async function checkExpandedBatchFamily(reader, evidence, requested) {
  const { initial, current } = expandedBatchFixture(evidence);
  async function read(fresh, first = initial, page = requested) {
    const calls = [];
    const result = await reader({ query: async (sql, params) => {
      calls.push(params);
      if (calls.length === 1) return { rows: [first] };
      assert.match(sql, /expanded_batch_accepted_families/u);
      assert.deepEqual(params, ["livenet", initial.selected_height, initial.selected_hash, initial.selected_storage.sha256,
        JSON.stringify(declaration), JSON.stringify([initial.selected_family])]);
      return { rows: fresh ? [fresh] : [] };
    } }, page, "livenet");
    assert.equal(calls.length, 2);
    return result;
  }
  assert.deepEqual([...await read(current)], requested.map(row => Number(row.event_id)));
  const newBlock = structuredClone(current);
  newBlock.resealed = false; newBlock.selected_records = newBlock.archived_records; newBlock.archived_records = null;
  assert.deepEqual([...await read(newBlock)], requested.map(row => Number(row.event_id)));
  await assert.rejects(() => read(null), /provenance/u);
  await assert.rejects(() => read({ ...current, archived_records: null }), /provenance/u);
  await assert.rejects(() => read({ ...current, resealed: false }), /provenance/u);
  const corrupt = structuredClone(current);
  const child = corrupt.selected_records[0].derived[0];
  child.amountSubatoms = String(BigInt(child.amountSubatoms) + 1n);
  await assert.rejects(() => read(corrupt), /provenance/u);
  const detached = structuredClone(current);
  detached.selected_records[0].derived[0].parentTransitionChainCommitmentAfter = current.archived_records[0].transitionChainCommitmentAfter;
  await assert.rejects(() => read(detached), /provenance/u);
  const nested = structuredClone(current);
  const sibling = nested.siblings.at(-1);
  const descriptor = sibling.payload.workAmoV5ReplayRawWitness.descriptor;
  sibling.payload.workAmoV5ReplayOutput = { projection: { ...descriptor, position: descriptor.projectionPosition,
    derived: true, protocol: "pwt1", reasonCode: "", txid: nested.parent_payload.txid, valid: true } };
  const nestedPage = requested.map(row => String(row.event_id) === String(sibling.event_id) ? { ...row, payload: sibling.payload } : row);
  assert.deepEqual([...await read(nested, initial, nestedPage)], nestedPage.map(row => Number(row.event_id)));
  sibling.payload.workAmoV5ReplayOutput.projection.parentTransitionChainCommitmentAfter = nested.selected_records[0].transitionChainCommitmentAfter;
  await assert.rejects(() => read(nested, initial, nestedPage), /provenance/u);
  const mixed = structuredClone(current);
  mixed.siblings.at(-1).payload.parentTransitionChainCommitmentAfter = current.selected_records[0].transitionChainCommitmentAfter;
  await assert.rejects(() => read(mixed));
  await assert.rejects(() => read(current, { ...initial, expanded_declaration: { ...declaration, firstEligibleBlockOffset: 0 } }), /provenance/u);
}
