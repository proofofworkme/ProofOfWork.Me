import { WORK_TOKEN_ID } from "./work-units.mjs";
import {
  WORK_AMO_V8_AMOUNT_MODEL,
  WORK_AMO_V8_AUTH_VERSION,
  WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
  WORK_AMO_V8_BOND_TRANSITION_MODEL,
  WORK_AMO_V8_STATE_ORDER_MODEL,
  WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
  WORK_AMO_V8_UNIT_MODEL,
  WORK_AMO_V8_UNIT_WORK_ORACLE_MODEL,
} from "./work-amo-v8.mjs";

function constraintText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

const WORK_AMO_V8_FROZEN_TERM_KEYS = Object.freeze([
  "version",
  "unitModel",
  "stateOrderModel",
  "amountModel",
  "blockSequencerModel",
  "bondTransitionModel",
  "unitWorkOracleModel",
  "unitFaceProofs",
  "listingBlockHeight",
  "listingBlockHash",
  "listingBlockIndex",
  "listingProtocolVout",
  "listingRecordOrdinal",
  "listingNetworkValueBeforeQ8",
  "unitAmountSubatoms",
  "unitPriceSats",
  "unitMinimumPriceSats",
  "listingBondContributionQ8",
  "listingNetworkValueAfterQ8",
]);

const WORK_AMO_V8_FROZEN_TERM_TYPES = Object.freeze({
  amountModel: "string",
  blockSequencerModel: "string",
  bondTransitionModel: "string",
  listingBlockHash: "string",
  listingBlockHeight: "number",
  listingBlockIndex: "number",
  listingBondContributionQ8: "string",
  listingNetworkValueAfterQ8: "string",
  listingNetworkValueBeforeQ8: "string",
  listingProtocolVout: "number",
  listingRecordOrdinal: "number",
  stateOrderModel: "string",
  unitAmountSubatoms: "string",
  unitFaceProofs: "number",
  unitMinimumPriceSats: "string",
  unitModel: "string",
  unitPriceSats: "string",
  unitWorkOracleModel: "string",
  version: "string",
});

const WORK_AMO_V8_FROZEN_BINDINGS = Object.freeze([
  ["version", "authorization_version"],
  ["unitModel", pgText(WORK_AMO_V8_UNIT_MODEL)],
  ["stateOrderModel", pgText(WORK_AMO_V8_STATE_ORDER_MODEL)],
  ["amountModel", pgText(WORK_AMO_V8_AMOUNT_MODEL)],
  ["blockSequencerModel", pgText(WORK_AMO_V8_BLOCK_SEQUENCER_MODEL)],
  ["bondTransitionModel", pgText(WORK_AMO_V8_BOND_TRANSITION_MODEL)],
  ["unitWorkOracleModel", pgText(WORK_AMO_V8_UNIT_WORK_ORACLE_MODEL)],
  ["unitFaceProofs", "(unit_face_proofs)::text"],
  [
    "listingNetworkValueBeforeQ8",
    "(listing_network_value_before_q8)::text",
  ],
  ["listingBlockHeight", "(listing_block_height)::text"],
  ["listingBlockHash", "listing_block_hash"],
  ["listingBlockIndex", "(listing_block_index)::text"],
  ["listingProtocolVout", "(listing_protocol_vout)::text"],
  ["listingRecordOrdinal", "(listing_record_ordinal)::text"],
  ["unitAmountSubatoms", "(unit_amount_subatoms)::text"],
  ["unitPriceSats", "(unit_price_sats)::text"],
  ["unitMinimumPriceSats", "(unit_minimum_price_sats)::text"],
  ["listingBondContributionQ8", "(listing_bond_contribution_q8)::text"],
  ["listingNetworkValueAfterQ8", "(listing_network_value_after_q8)::text"],
]);

function pgText(value) {
  return `'${String(value).replaceAll("'", "''")}'::text`;
}

function pgTextArray(values) {
  return `ARRAY[${values.map((value) => pgText(value)).join(", ")}]`;
}

function workAmoV8FrozenConstraintDefinition() {
  const keyArray = pgTextArray(WORK_AMO_V8_FROZEN_TERM_KEYS);
  const clauses = [
    `(jsonb_typeof(frozen_terms) = ${pgText("object")})`,
    `(frozen_terms ?& ${keyArray})`,
    `((frozen_terms - ${keyArray}) = '{}'::jsonb)`,
    ...WORK_AMO_V8_FROZEN_TERM_KEYS.map(
      (key) =>
        `(jsonb_typeof((frozen_terms -> ${pgText(key)})) = ${pgText(
          WORK_AMO_V8_FROZEN_TERM_TYPES[key],
        )})`,
    ),
    ...WORK_AMO_V8_FROZEN_BINDINGS.map(
      ([key, value]) =>
        `((frozen_terms ->> ${pgText(key)}) = ${value})`,
    ),
  ];
  return `CHECK (((${clauses.join(" AND ")}) IS TRUE))`;
}

// These are the exact whitespace-normalized PostgreSQL 16
// pg_get_constraintdef outputs for the additive V8 schema. PostgreSQL 17
// emits the same forms for this SQL. Readiness deliberately accepts no
// logically equivalent aliases: a changed parse tree requires an explicit,
// reviewed schema upgrade instead of silently weakening the attestation.
export const WORK_PRECISION_V2_STATIC_CONSTRAINT_DEFINITIONS = Object.freeze({
  definitionPrecision: constraintText(
    `CHECK (((token_id <> '${WORK_TOKEN_ID}'::text) OR ((max_supply = ('2100000000000000'::bigint)::numeric) AND (mint_amount = ('100000000000'::bigint)::numeric) AND ((metadata ->> 'amountStorageModel'::text) = 'work-atoms-v1'::text) AND ((metadata ->> 'decimals'::text) = '8'::text) AND ((metadata ->> 'unitScale'::text) = '100000000'::text)) OR ((max_supply = '210000000000000000000000'::numeric) AND (mint_amount = '10000000000000000000'::numeric) AND ((metadata ->> 'amountStorageModel'::text) = 'work-subatoms-v2'::text) AND ((metadata ->> 'decimals'::text) = '16'::text) AND ((metadata ->> 'unitScale'::text) = '10000000000000000'::text) AND ((metadata ->> 'precisionModel'::text) = 'canonical-work-subatoms-v2'::text))))`,
  ),
  transitionModels: constraintText(
    `CHECK (((model = ANY (ARRAY['canonical-work-amo-full-position-block-sequencer-v1'::text, 'canonical-work-amo-full-position-block-sequencer-v2'::text, 'canonical-work-amo-full-position-block-sequencer-v3'::text, '${WORK_AMO_V8_BLOCK_SEQUENCER_MODEL}'::text])) AND (state_commitment_model = 'canonical-work-amo-sufficient-state-sha256-v1'::text) AND (((model = ANY (ARRAY['canonical-work-amo-full-position-block-sequencer-v1'::text, 'canonical-work-amo-full-position-block-sequencer-v2'::text])) AND (work_token_state_model IS NULL)) OR ((model = 'canonical-work-amo-full-position-block-sequencer-v3'::text) AND (work_token_state_model = 'canonical-work-token-state-subatoms-v2'::text)) OR ((model = '${WORK_AMO_V8_BLOCK_SEQUENCER_MODEL}'::text) AND (work_token_state_model = '${WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL}'::text))) AND (event_set_model = 'canonical-work-amo-event-set-sha256-v1'::text)))`,
  ),
  v6Values: constraintText(
    `CHECK (((unit_face_proofs = ANY (ARRAY[20000, 50000, 100000])) AND ((unit_amount_atoms)::text ~ '^[1-9][0-9]*$'::text) AND (unit_amount_atoms <= ('2100000000000000'::bigint)::numeric) AND (unit_price_sats = unit_face_proofs) AND (unit_minimum_price_sats > 0) AND (unit_minimum_price_sats <= unit_price_sats) AND ((listing_network_value_before_q8)::text ~ '^[1-9][0-9]*$'::text) AND ((listing_bond_contribution_q8)::text ~ '^[1-9][0-9]*$'::text) AND ((listing_network_value_after_q8)::text ~ '^[1-9][0-9]*$'::text) AND (listing_network_value_after_q8 = (listing_network_value_before_q8 + listing_bond_contribution_q8)) AND (unit_amount_atoms = trunc((((((unit_face_proofs)::numeric * (21000000)::numeric) * (100000000)::numeric) * (100000000)::numeric) / listing_network_value_before_q8))) AND ((unit_minimum_price_sats)::numeric = ceil(((unit_amount_atoms * listing_network_value_before_q8) / (((21000000)::numeric * (100000000)::numeric) * (100000000)::numeric))))))`,
  ),
  v8Frozen: workAmoV8FrozenConstraintDefinition(),
  v8Identity: constraintText(
    `CHECK (((network = 'livenet'::text) AND (listing_id = listing_txid) AND (listing_id ~ '^[0-9a-f]{64}$'::text) AND (token_id = '${WORK_TOKEN_ID}'::text) AND (authorization_version = '${WORK_AMO_V8_AUTH_VERSION}'::text) AND (listing_block_hash ~ '^[0-9a-f]{64}$'::text)))`,
  ),
  v8Positions: constraintText(
    "CHECK (((listing_block_height > 0) AND (listing_block_index >= 0) AND (listing_protocol_vout >= 0) AND (listing_record_ordinal >= 0)))",
  ),
  v8Values: constraintText(
    `CHECK (((unit_face_proofs = 25000) AND ((unit_amount_subatoms)::text ~ '^[1-9][0-9]*$'::text) AND (unit_amount_subatoms <= '210000000000000000000000'::numeric) AND (unit_price_sats = unit_face_proofs) AND (unit_minimum_price_sats > 0) AND (unit_minimum_price_sats <= unit_price_sats) AND ((listing_network_value_before_q8)::text ~ '^[1-9][0-9]*$'::text) AND ((listing_bond_contribution_q8)::text ~ '^[1-9][0-9]*$'::text) AND ((listing_network_value_after_q8)::text ~ '^[1-9][0-9]*$'::text) AND (listing_network_value_after_q8 = (listing_network_value_before_q8 + listing_bond_contribution_q8)) AND (unit_amount_subatoms = trunc((((((unit_face_proofs)::numeric * (21000000)::numeric) * ('10000000000000000'::bigint)::numeric) * (100000000)::numeric) / listing_network_value_before_q8))) AND ((unit_minimum_price_sats)::numeric = ceil(((unit_amount_subatoms * listing_network_value_before_q8) / (((21000000)::numeric * ('10000000000000000'::bigint)::numeric) * (100000000)::numeric))))))`,
  ),
});

function exactStaticConstraint(definition, key) {
  return (
    constraintText(definition) ===
    WORK_PRECISION_V2_STATIC_CONSTRAINT_DEFINITIONS[key]
  );
}

function exactV6DeactivationConstraint(definition) {
  return /^CHECK \(\(listing_block_height < [1-9][0-9]*\)\)$/u.test(
    constraintText(definition),
  );
}

export function workPrecisionV2ConstraintAudit(definitions = {}) {
  const v8Values = definitions.v8Values ?? definitions.v7Values;
  const definitionPrecisionReady = exactStaticConstraint(
    definitions.definitionPrecision,
    "definitionPrecision",
  );
  const transitionReady = exactStaticConstraint(
    definitions.transitionModels,
    "transitionModels",
  );
  const v6Q8Ready = exactStaticConstraint(definitions.v6Values, "v6Values");
  const v8ValuesReady = exactStaticConstraint(v8Values, "v8Values");
  const v8IdentityReady = exactStaticConstraint(
    definitions.v8Identity,
    "v8Identity",
  );
  const v8PositionsReady = exactStaticConstraint(
    definitions.v8Positions,
    "v8Positions",
  );
  const v8FrozenReady = exactStaticConstraint(
    definitions.v8Frozen,
    "v8Frozen",
  );
  return Object.freeze({
    definitionPrecisionReady,
    transitionReady,
    v6DeactivationInstalled: exactV6DeactivationConstraint(
      definitions.v6Deactivation,
    ),
    v6Q8Ready,
    // Compatibility aliases remain read-only while all V8 callers migrate to
    // the canonical names below. They do not attest the historical V7 table.
    v7Q16Ready: v8ValuesReady,
    v7TransitionReady: transitionReady,
    v8FrozenReady,
    v8IdentityReady,
    v8PositionsReady,
    v8Q16Ready: v8ValuesReady,
    v8TransitionReady: transitionReady,
    v8ValuesReady,
  });
}
