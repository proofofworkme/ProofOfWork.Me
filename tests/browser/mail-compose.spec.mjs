import { expect, test } from "@playwright/test";
import * as bitcoin from "bitcoinjs-lib";

const NOW = "2026-08-01T12:00:00.000Z";
const HASH = "1".repeat(64);
const SENDER = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
const RECIPIENT = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const WORK_REGISTRY = "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
const WORK_PRECISION_MODEL = "canonical-work-subatoms-v2";
const WORK_STORAGE_MODEL = "work-subatoms-v2";
const WORK_UNIT_SCALE = "10000000000000000";
const WORK_NETWORK_VALUE_MODEL = "canonical-exact-work-network-q8-v1";
const NETWORK_VALUE_Q8 = "2100000000000000";
const NETWORK_VALUE = "21000000";
const FLOOR_Q8 = "100000000";
const FLOOR = "1";
const V8_LISTING_TXID =
  "07c9ca719adf7a7e94ff17c917e599e872ae1c0348f282219907c060a72b8043";
const SECOND_V8_LISTING_TXID =
  "e299613d222222222222222222222222222222222222222222222222114691e0";

const fundingTransaction = new bitcoin.Transaction();
fundingTransaction.version = 2;
fundingTransaction.addInput(Buffer.alloc(32), 0xffffffff);
fundingTransaction.addOutput(
  bitcoin.address.toOutputScript(SENDER, bitcoin.networks.bitcoin),
  100_000n,
);
const FUNDING_TXID = fundingTransaction.getId();
const FUNDING_HEX = fundingTransaction.toHex();

function workTokenDefinition() {
  return {
    amountStorageModel: WORK_STORAGE_MODEL,
    confirmed: true,
    createdAt: NOW,
    creationFeeSats: 1_000,
    creatorAddress: "1L4xrDurN9VghknrbsSju2vQb6oXZe1Pbn",
    decimals: 16,
    maxSupply: 21_000_000,
    maxSupplySubatoms: "210000000000000000000000",
    mintAmount: 1_000,
    mintAmountSubatoms: "10000000000000000000",
    mintPriceSats: 1_000,
    network: "livenet",
    precisionModel: WORK_PRECISION_MODEL,
    registryAddress: WORK_REGISTRY,
    ticker: "WORK",
    tokenId: WORK_TOKEN_ID,
    txid: WORK_TOKEN_ID,
    unitScale: WORK_UNIT_SCALE,
  };
}

function v8AmoListing({
  createdAt = NOW,
  includeFrozenTerms = true,
  listingId = V8_LISTING_TXID,
  nonce = "browser-v8-listing",
  sellerAddress = SENDER,
} = {}) {
  return {
    amount: "0.0000000752009741",
    amountAtoms: "752009741",
    amountStorageModel: WORK_STORAGE_MODEL,
    amountSubatoms: "752009741",
    confirmed: true,
    createdAt,
    dataBytes: 994,
    decimals: 16,
    ...(includeFrozenTerms
      ? {
          frozenTerms: {
            amountModel: "canonical-work-amo-proof-unit-amount-v3",
            blockSequencerModel:
              "canonical-work-amo-full-position-block-sequencer-v4",
            bondTransitionModel: "canonical-compute-then-bond-v1",
            listingBlockHash:
              "000000000000000000006589e2b946b1ab0f6e36ee69f337601fbf0397111c34",
            listingBlockHeight: 962_104,
            listingBlockIndex: 567,
            listingBondContributionQ8: "2969148577200",
            listingNetworkValueAfterQ8: "698129253763347407892080965",
            listingNetworkValueBeforeQ8: "698129253763344438743503765",
            listingProtocolVout: 1,
            listingRecordOrdinal: 0,
            stateOrderModel: "canonical-proof-state-order-v1",
            unitAmountSubatoms: "752009741",
            unitFaceProofs: 25_000,
            unitMinimumPriceSats: "25000",
            unitModel: "canonical-work-amo-proof-unit-v3",
            unitPriceSats: "25000",
            unitWorkOracleModel: "canonical-work-prefix-before-action-v1",
            version: "pwt-sale-v8",
          },
        }
      : {}),
    listingId,
    network: "livenet",
    precisionModel: WORK_PRECISION_MODEL,
    priceSats: 25_000,
    registryAddress: WORK_REGISTRY,
    saleAuthorization: {
      amountModel: "canonical-work-amo-proof-unit-amount-v3",
      anchorScriptPubKey: "76a9144752142b83faf13d526a59212f3f228012890dbe88ac",
      anchorSigHashType: 131,
      anchorType: "sale-ticket-v1",
      anchorValueSats: 546,
      anchorVout: 2,
      blockSequencerModel: "canonical-work-amo-full-position-block-sequencer-v4",
      bondTransitionModel: "canonical-compute-then-bond-v1",
      buyerAddress: "",
      expiresAt: "",
      network: "livenet",
      nonce,
      registryAddress: WORK_REGISTRY,
      sellerAddress,
      sellerPublicKey:
        "02777b8fd3dc524694c52f2b505d14eacf289430f42b5785c48b7cb4948db8499b",
      stateOrderModel: "canonical-proof-state-order-v1",
      ticker: "WORK",
      tokenId: WORK_TOKEN_ID,
      unitFaceProofs: 25_000,
      unitModel: "canonical-work-amo-proof-unit-v3",
      unitWorkOracleModel: "canonical-work-prefix-before-action-v1",
      version: "pwt-sale-v8",
    },
    sellerAddress,
    ticker: "WORK",
    tokenId: WORK_TOKEN_ID,
    unitScale: WORK_UNIT_SCALE,
    ...(includeFrozenTerms
      ? {
          workAmoFrozenTerms: {
            amountModel: "canonical-work-amo-proof-unit-amount-v3",
            blockSequencerModel:
              "canonical-work-amo-full-position-block-sequencer-v4",
            bondTransitionModel: "canonical-compute-then-bond-v1",
            listingBlockHash:
              "000000000000000000006589e2b946b1ab0f6e36ee69f337601fbf0397111c34",
            listingBlockHeight: 962_104,
            listingBlockIndex: 567,
            listingBondContributionQ8: "2969148577200",
            listingNetworkValueAfterQ8: "698129253763347407892080965",
            listingNetworkValueBeforeQ8: "698129253763344438743503765",
            listingProtocolVout: 1,
            listingRecordOrdinal: 0,
            stateOrderModel: "canonical-proof-state-order-v1",
            unitAmountSubatoms: "752009741",
            unitFaceProofs: 25_000,
            unitMinimumPriceSats: "25000",
            unitModel: "canonical-work-amo-proof-unit-v3",
            unitPriceSats: "25000",
            unitWorkOracleModel: "canonical-work-prefix-before-action-v1",
            version: "pwt-sale-v8",
          },
        }
      : {}),
  };
}

function staleInvalidListingEvent() {
  return {
    amount: "0.0000000752009741",
    amountStorageModel: WORK_STORAGE_MODEL,
    amountSubatoms: "752009741",
    attemptedKind: "listing",
    confirmed: true,
    createdAt: NOW,
    network: "livenet",
    participants: [SENDER],
    precisionModel: WORK_PRECISION_MODEL,
    reason: "work-market-v2-version-required",
    recipientAddress: "",
    senderAddress: SENDER,
    ticker: "WORK",
    tokenId: WORK_TOKEN_ID,
    txid: V8_LISTING_TXID,
    unitScale: WORK_UNIT_SCALE,
    valid: false,
  };
}

function authoritativeWorkState({ repairedV8Listing = false } = {}) {
  const listing = repairedV8Listing ? v8AmoListing() : undefined;
  return {
    amountStorageModel: WORK_STORAGE_MODEL,
    authoritativeWallet: true,
    closedListings: [],
    confirmedSupplySubatoms: "10000000000000000000",
    creationSats: 1_000,
    decimals: 16,
    holders: [
      {
        address: SENDER,
        balanceSubatoms: repairedV8Listing
          ? "20000000000000000"
          : "1000000000000000000",
        pendingDeltaSubatoms: "0",
        ticker: "WORK",
        tokenId: WORK_TOKEN_ID,
      },
    ],
    invalidEvents: repairedV8Listing ? [staleInvalidListingEvent()] : [],
    listings: listing ? [listing] : [],
    mints: [],
    pendingSupplySubatoms: "0",
    precisionModel: WORK_PRECISION_MODEL,
    sales: [],
    source: "proof-indexer-wallet-token-overlay-browser-fixture",
    summaryOnly: true,
    tokens: [workTokenDefinition()],
    transfers: [],
    unitScale: WORK_UNIT_SCALE,
    walletScoped: true,
  };
}

function canonicalActualValue() {
  return {
    baseNetworkValueQ8: NETWORK_VALUE_Q8,
    baseNetworkValueSats: Number(NETWORK_VALUE),
    baseNetworkValueSatsExact: NETWORK_VALUE,
    baseTotalQ8: NETWORK_VALUE_Q8,
    baseTotalSats: Number(NETWORK_VALUE),
    baseTotalSatsExact: NETWORK_VALUE,
    creditMinerFeeAccountingModel: "canonical-unique-tx-input-output-v1",
    creditMinerFeeCoverage: {
      complete: true,
      confirmedEvents: 1,
      confirmedTransactions: 1,
      coveredConfirmedEvents: 1,
      coveredConfirmedTransactions: 1,
      missingConfirmedEvents: 0,
      missingConfirmedTransactions: 0,
      missingConfirmedTxids: [],
      source: "proof-indexer-normalized-input-output-totals",
    },
    floorQ8: FLOOR_Q8,
    floorSats: Number(FLOOR),
    floorSatsExact: FLOOR,
    frozenFloorQ8: FLOOR_Q8,
    frozenFloorSats: Number(FLOOR),
    frozenFloorSatsExact: FLOOR,
    frozenNetworkValueQ8: NETWORK_VALUE_Q8,
    frozenNetworkValueSats: Number(NETWORK_VALUE),
    frozenNetworkValueSatsExact: NETWORK_VALUE,
    frozenTotalQ8: NETWORK_VALUE_Q8,
    frozenTotalSats: Number(NETWORK_VALUE),
    frozenTotalSatsExact: NETWORK_VALUE,
    liveFloorQ8: FLOOR_Q8,
    liveFloorSats: Number(FLOOR),
    liveFloorSatsExact: FLOOR,
    liveNetworkValueQ8: NETWORK_VALUE_Q8,
    liveNetworkValueSats: Number(NETWORK_VALUE),
    liveNetworkValueSatsExact: NETWORK_VALUE,
    liveTotalQ8: NETWORK_VALUE_Q8,
    liveTotalSats: Number(NETWORK_VALUE),
    liveTotalSatsExact: NETWORK_VALUE,
    networkValueQ8: NETWORK_VALUE_Q8,
    networkValueSats: Number(NETWORK_VALUE),
    networkValueSatsExact: NETWORK_VALUE,
    totalQ8: NETWORK_VALUE_Q8,
    totalSats: Number(NETWORK_VALUE),
    totalSatsExact: NETWORK_VALUE,
    workNetworkValueAccountingModel: WORK_NETWORK_VALUE_MODEL,
  };
}

function workFloor(mode) {
  const preV8 = mode === "pre-v8";
  const precisionPaused = mode === "precision-paused";
  const paused = mode === "paused" || precisionPaused;
  const activationReady = !paused || precisionPaused;
  return {
    actualValue: canonicalActualValue(),
    floorQ8: FLOOR_Q8,
    floorSats: Number(FLOOR),
    floorSatsExact: FLOOR,
    frozenFloorQ8: FLOOR_Q8,
    frozenFloorSats: Number(FLOOR),
    frozenFloorSatsExact: FLOOR,
    frozenNetworkValueQ8: NETWORK_VALUE_Q8,
    frozenNetworkValueSats: Number(NETWORK_VALUE),
    frozenNetworkValueSatsExact: NETWORK_VALUE,
    indexedAt: NOW,
    indexedThroughBlock: preV8 ? 960_218 : 960_220,
    indexedThroughBlockHash: HASH,
    liveFloorQ8: FLOOR_Q8,
    liveFloorSats: Number(FLOOR),
    liveFloorSatsExact: FLOOR,
    liveNetworkValueQ8: NETWORK_VALUE_Q8,
    liveNetworkValueSats: Number(NETWORK_VALUE),
    liveNetworkValueSatsExact: NETWORK_VALUE,
    network: "livenet",
    networkValueQ8: NETWORK_VALUE_Q8,
    networkValueSats: Number(NETWORK_VALUE),
    networkValueSatsExact: NETWORK_VALUE,
    snapshotId: `mail-compose-${mode}`,
    stats: { indexedThroughBlock: preV8 ? 960_218 : 960_220 },
    totalQ8: NETWORK_VALUE_Q8,
    workAmoV6: {
      activation: {
        active: true,
        evidenceComplete: true,
      },
      version: "pwt-sale-v6",
    },
    workAmoV8: preV8
      ? {
          activation: {
            active: false,
            confirmed: false,
            declarationConfirmed: false,
            evidenceComplete: false,
            reached: false,
            tipVerified: false,
          },
          legacyWriteEmbargo: false,
          pinsConfigured: false,
          pinsRequested: false,
          protocolReady: false,
          reasonCode: "",
          version: "pwt-sale-v8",
          writeAdmission: false,
        }
      : {
          activation: {
            activationHeight: 960_219,
            active: activationReady,
            confirmed: true,
            declarationConfirmed: true,
            declarationHeight: 960_218,
            evidenceComplete: activationReady,
            reached: true,
            tipVerified: true,
          },
          legacyWriteEmbargo: true,
          listingWritesEnabled: !paused,
          pinsConfigured: true,
          pinsRequested: true,
          protocolReady: !paused,
          protocolWritesEnabled: !paused,
          ready: !paused,
          reasonCode: precisionPaused
            ? "work-amo-v8-precision-migration-not-ready"
            : paused
              ? "work-amo-v8-writes-paused"
              : "",
          settlementWritesEnabled: !paused,
          version: "pwt-sale-v8",
          writeAdmission: !paused,
        },
    workNetworkValueAccountingModel: WORK_NETWORK_VALUE_MODEL,
  };
}

function registryState() {
  return {
    activity: [],
    listings: [],
    pendingEvents: [],
    records: [],
    sales: [],
  };
}

async function installWallet(page) {
  await page.addInitScript(({ sender }) => {
    const listeners = new Map();
    window.__mailComposeFixture = {
      psbtHexes: [],
      signCalls: 0,
    };
    window.confirm = () => true;
    window.unisat = {
      getAccounts: async () => [sender],
      getChain: async () => ({ enum: "BITCOIN_MAINNET" }),
      getNetwork: async () => "livenet",
      on: (event, listener) => listeners.set(event, listener),
      removeListener: (event) => listeners.delete(event),
      requestAccounts: async () => [sender],
      signPsbt: async (psbtHex) => {
        window.__mailComposeFixture.signCalls += 1;
        window.__mailComposeFixture.psbtHexes.push(psbtHex);
        return new Promise(() => {});
      },
    };
  }, { sender: SENDER });
}

async function installApiFixtures(
  page,
  {
    floorFailure = false,
    freshMarketLogFailure = false,
    freshWorkWalletFailure = false,
    holdInitialFloor = false,
    inboxMessage = false,
    mode = "post-v8",
    repairedV8Listing = false,
    remoteV8MarketListings = false,
  } = {},
) {
  const requests = [];
  let releaseInitialFloor;
  const initialFloorGate = new Promise((resolve) => {
    releaseInitialFloor = resolve;
  });
  let initialFloorHeld = false;

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.toString());
    const { pathname, searchParams } = url;
    let json = {};
    let status = 200;

    if (pathname.endsWith(`/address/${SENDER}/mail`)) {
      json = {
        inboxMessages: inboxMessage
          ? [
              {
                amountSats: 546,
                confirmed: true,
                createdAt: NOW,
                from: RECIPIENT,
                memo: "Confirmed Inbox reply fixture",
                network: "livenet",
                recipients: [
                  {
                    address: SENDER,
                    amountSats: 546,
                    display: SENDER,
                  },
                ],
                replyTo: RECIPIENT,
                subject: "Confirmed WORK reply fixture",
                to: SENDER,
                txid: "3".repeat(64),
              },
            ]
          : [],
        sentMessages: [],
      };
    } else if (pathname.endsWith(`/address/${SENDER}/utxo`)) {
      json = [
        {
          status: {
            block_hash: HASH,
            block_height: 960_000,
            confirmed: true,
          },
          txid: FUNDING_TXID,
          value: 100_000,
          vout: 0,
        },
      ];
    } else if (pathname === `/api/v1/tx/${FUNDING_TXID}/hex`) {
      json = { hex: FUNDING_HEX };
    } else if (pathname === `/api/v1/tx/${FUNDING_TXID}/status`) {
      json = {
        blockHash: HASH,
        blockHeight: 960_000,
        confirmed: true,
        status: "confirmed",
      };
    } else if (pathname === "/api/v1/marketplace-summary") {
      json = {
        indexedAt: NOW,
        network: "livenet",
        registry: registryState(),
        summaryOnly: true,
        token: authoritativeWorkState(),
        workFloor: workFloor(mode),
      };
    } else if (pathname === "/api/v1/token-history") {
      const kind = searchParams.get("kind");
      if (remoteV8MarketListings && kind === "market-log") {
        if (freshMarketLogFailure && searchParams.get("fresh") === "1") {
          json = {
            error: "The canonical ProofOfWork index is catching up.",
            network: "livenet",
            ok: false,
          };
          return route.fulfill({
            body: JSON.stringify(json),
            contentType: "application/json",
            status,
          });
        }
        const listings = [
          v8AmoListing({
            createdAt: "2026-08-12T06:37:00.000Z",
            includeFrozenTerms: false,
            listingId: V8_LISTING_TXID,
            nonce: "browser-v8-listing-one",
          }),
          v8AmoListing({
            createdAt: "2026-08-12T15:38:00.000Z",
            includeFrozenTerms: false,
            listingId: SECOND_V8_LISTING_TXID,
            nonce: "browser-v8-listing-two",
            sellerAddress: RECIPIENT,
          }),
        ];
        json = {
          indexedAt: NOW,
          items: listings.map((listing) => ({
            createdAt: listing.createdAt,
            kind: "listing",
            listing,
            txid: listing.listingId,
          })),
          network: "livenet",
          page: Number(searchParams.get("page") ?? 0),
          pageSize: Number(searchParams.get("limit") ?? listings.length),
          totalCount: listings.length,
        };
      } else {
        json = {
          indexedAt: NOW,
          items: [],
          network: "livenet",
          page: Number(searchParams.get("page") ?? 0),
          pageSize: Number(searchParams.get("limit") ?? 0),
          totalCount: 0,
        };
      }
    } else if (
      pathname === "/api/v1/token" ||
      pathname === "/api/v1/token-summary"
    ) {
      if (
        freshWorkWalletFailure &&
        pathname === "/api/v1/token" &&
        searchParams.get("asset") === WORK_TOKEN_ID &&
        searchParams.get("fresh") === "1" &&
        searchParams.get("wallet") === "1"
      ) {
        json = {
          error: "Fresh wallet credit state is temporarily unavailable for WORK.",
          network: "livenet",
          ok: false,
        };
        status = 503;
      } else {
        json = authoritativeWorkState({ repairedV8Listing });
      }
    } else if (
      pathname === "/api/v1/registry" ||
      pathname === "/api/v1/registry-summary"
    ) {
      json = registryState();
    } else if (pathname === "/api/v1/work-floor") {
      if (floorFailure) {
        json = { error: "WORK admission fixture unavailable" };
        status = 503;
      } else {
        if (holdInitialFloor && !initialFloorHeld) {
          initialFloorHeld = true;
          await initialFloorGate;
        }
        json = workFloor(mode);
      }
    } else if (pathname === "/api/v1/prices/btc-usd") {
      json = { USD: 100_000, usd: 100_000 };
    } else if (pathname.endsWith("/status")) {
      json = {
        blockHash: HASH,
        blockHeight: 960_000,
        confirmed: true,
        status: "confirmed",
      };
    }

    await route.fulfill({
      body: JSON.stringify(json),
      contentType: "application/json",
      status,
    });
  });

  return {
    releaseInitialFloor: () => releaseInitialFloor(),
    requests,
  };
}

async function openConnectedCompose(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page
    .locator(".onboarding-pane")
    .getByRole("button", { name: "Connect UniSat" })
    .click();
  await expect(page.locator(".topbar-wallet-button")).toContainText("1BPVvi1G");
  await page.locator(".compose-button").first().click();
  await expect(page.getByRole("heading", { name: "New Message" })).toBeVisible();
  await expect(page.getByLabel("From")).toHaveValue(SENDER);
  await expect(page.getByLabel("WORK each")).toBeVisible();
}

async function openConnectedWallet(page) {
  await page.goto("/?wallet=1", { waitUntil: "domcontentloaded" });
  const connect = page
    .getByRole("button", { name: /Connect (UniSat|wallet)/u })
    .first();
  if (await connect.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await connect.click();
  }
  await expect(page.locator(".topbar-wallet-button")).toContainText("1BPVvi1G");
  await expect(page.locator(".token-wallet-workspace")).toBeVisible();
}

async function openConnectedInboxReply(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page
    .locator(".onboarding-pane")
    .getByRole("button", { name: "Connect UniSat" })
    .click();
  await expect(page.locator(".topbar-wallet-button")).toContainText("1BPVvi1G");

  const confirmedMessage = page
    .locator(".message-row")
    .filter({ hasText: "Confirmed WORK reply fixture" });
  await expect(confirmedMessage).toBeVisible();
  await confirmedMessage.click();
  await expect(
    page.locator(".reader").getByRole("heading", {
      name: "Confirmed WORK reply fixture",
    }),
  ).toBeVisible();
  await page
    .locator(".reader")
    .getByRole("button", { exact: true, name: "Reply" })
    .click();

  await expect(page.getByRole("heading", { name: "Reply" })).toBeVisible();
  await expect(page.getByLabel("From")).toHaveValue(SENDER);
  await expect(
    page.getByRole("combobox", { exact: true, name: "To" }),
  ).toHaveValue(RECIPIENT);
  await expect(page.getByLabel("WORK each")).toBeVisible();
}

async function fillReadyMail(page, workAmount) {
  await page
    .getByRole("combobox", { exact: true, name: "To" })
    .fill(RECIPIENT);
  await page.getByLabel("Message").fill("Mail admission browser contract");
  await page.getByLabel("WORK each").fill(workAmount);
}

function opReturnPayloads(psbtHex) {
  const psbt = bitcoin.Psbt.fromHex(psbtHex, {
    network: bitcoin.networks.bitcoin,
  });
  return psbt.txOutputs.flatMap((output) => {
    const chunks = bitcoin.script.decompile(output.script);
    if (!chunks || chunks[0] !== bitcoin.opcodes.OP_RETURN) {
      return [];
    }
    return chunks.slice(1).flatMap((chunk) =>
      typeof chunk === "number" ? [] : [Buffer.from(chunk).toString("utf8")],
    );
  });
}

function rgbChannels(value) {
  const match = value.match(
    /^rgba?\(\s*([0-9.]+)[, ]+\s*([0-9.]+)[, ]+\s*([0-9.]+)/u,
  );
  if (!match) {
    throw new Error(`Unsupported computed color: ${value}`);
  }
  return match.slice(1, 4).map(Number);
}

function relativeLuminance(value) {
  const channels = rgbChannels(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

async function expectReadableButton(locator, state) {
  await expect
    .poll(
      async () => {
        const styles = await locator.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            backgroundColor: style.backgroundColor,
            color: style.color,
          };
        });
        const foreground = relativeLuminance(styles.color);
        const background = relativeLuminance(styles.backgroundColor);
        return (
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05)
        );
      },
      {
        message: `${state} Send must settle at 4.5:1 contrast or better`,
      },
    )
    .toBeGreaterThanOrEqual(4.5);
}

async function capturedPsbt(page) {
  await expect
    .poll(() =>
      page.evaluate(() => window.__mailComposeFixture?.signCalls ?? 0),
    )
    .toBe(1);
  return page.evaluate(() => window.__mailComposeFixture.psbtHexes[0]);
}

test("Inbox WORK admission hydrates fresh authority and explains a paused send", async ({
  page,
}) => {
  await installWallet(page);
  const fixture = await installApiFixtures(page, {
    holdInitialFloor: true,
    inboxMessage: true,
    mode: "paused",
  });
  await openConnectedInboxReply(page);

  const send = page.locator(".mail-send-button");
  const recipient = page.getByRole("combobox", {
    exact: true,
    name: "To",
  });
  await recipient.fill("");
  await expect(send).toHaveAttribute("data-state", "disabled");
  await expect(send).toBeDisabled();
  await expectReadableButton(send, "disabled");
  const disabledBackground = await send.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await send.hover({ force: true });
  await expect
    .poll(() =>
      send.evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .toBe(disabledBackground);

  await recipient.fill(RECIPIENT);
  await page.getByLabel("Message").fill("Proofs-only mail stays independent.");
  await expect(send).toHaveAttribute("data-state", "ready");
  await expect(send).toBeEnabled();
  await expectReadableButton(send, "ready");

  const readyBackground = await send.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await send.hover();
  await expect
    .poll(() =>
      send.evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .not.toBe(readyBackground);
  await send.focus();
  await expect
    .poll(() =>
      send.evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          element.matches(":focus-visible") &&
          (style.boxShadow !== "none" || style.outlineStyle !== "none")
        );
      }),
    )
    .toBe(true);

  await page.getByLabel("WORK each").fill("0.00000000000000001");
  await expect(page.locator("#compose-send-status")).toContainText(
    "up to 16 decimal places",
  );
  await expect(send).toBeDisabled();

  await page.getByLabel("WORK each").fill("0.00000001");
  await expect(page.locator("#compose-send-status")).toContainText(
    "Checking the current WORK transfer protocol",
  );
  await expect(send).toHaveAttribute("data-state", "disabled");

  fixture.releaseInitialFloor();
  await expect(page.locator("#compose-send-status")).toContainText(
    "work-amo-v8-writes-paused",
  );
  await expect(send).toBeDisabled();
  await expectReadableButton(send, "paused");

  await expect
    .poll(
      () =>
        fixture.requests.filter((requestUrl) => {
          const url = new URL(requestUrl);
          return (
            url.pathname === "/api/v1/work-floor" &&
            url.searchParams.get("fresh") === "1"
          );
        }).length,
    )
    .toBeGreaterThan(0);

  const freshWalletReads = fixture.requests.filter((requestUrl) => {
    const url = new URL(requestUrl);
    return (
      url.pathname === "/api/v1/token" &&
      url.searchParams.get("asset") === WORK_TOKEN_ID &&
      url.searchParams.get("address") === SENDER &&
      url.searchParams.get("fresh") === "1" &&
      url.searchParams.get("wallet") === "1"
    );
  });
  expect(freshWalletReads.length).toBeGreaterThan(0);
});

test("failed initial WORK admission becomes an explicit unavailable state", async ({
  page,
}) => {
  await installWallet(page);
  const fixture = await installApiFixtures(page, { floorFailure: true });
  await openConnectedCompose(page);
  await fillReadyMail(page, "0.00000001");

  const send = page.locator(".mail-send-button");
  await expect(page.locator("#compose-send-status")).toContainText(
    "Verified WORK transfer admission is unavailable",
  );
  await expect(send).toHaveAttribute("data-state", "disabled");
  await expect(send).toBeDisabled();
  await expectReadableButton(send, "unavailable");

  await expect
    .poll(
      () =>
        fixture.requests.filter((requestUrl) => {
          const url = new URL(requestUrl);
          return (
            url.pathname === "/api/v1/work-floor" &&
            url.searchParams.get("fresh") === "1"
          );
        }).length,
    )
    .toBeGreaterThan(0);
});

test("proofs-only mail fails closed when fresh WORK anchor proof is unavailable", async ({
  page,
}) => {
  await installWallet(page);
  const fixture = await installApiFixtures(page, {
    freshWorkWalletFailure: true,
  });
  await openConnectedCompose(page);
  await fillReadyMail(page, "0");

  const send = page.locator(".mail-send-button");
  await expect(send).toHaveAttribute("data-state", "ready");
  await send.click();
  await expect(page.getByRole("alert")).toContainText(
    "No transaction was created",
    { timeout: 30_000 },
  );
  await expect
    .poll(
      () =>
        page.evaluate(() => window.__mailComposeFixture?.signCalls ?? 0),
    )
    .toBe(0);
  expect(
    fixture.requests.some((requestUrl) => {
      const url = new URL(requestUrl);
      return (
        url.pathname === "/api/v1/token" &&
        url.searchParams.get("asset") === WORK_TOKEN_ID &&
        url.searchParams.get("fresh") === "1" &&
        url.searchParams.get("wallet") === "1"
      );
    }),
  ).toBe(true);
  expect(
    fixture.requests.some((requestUrl) => {
      const url = new URL(requestUrl);
      return (
        url.pathname === "/api/v1/token" &&
        url.searchParams.get("asset") === WORK_TOKEN_ID &&
        url.searchParams.get("fresh") !== "1" &&
        url.searchParams.get("wallet") === "1"
      );
    }),
  ).toBe(true);
});

test("wallet V8 AMO repair hides stale invalid rows and reserves spendable WORK", async ({
  page,
}) => {
  await installWallet(page);
  await installApiFixtures(page, { mode: "post-v8", repairedV8Listing: true });
  await openConnectedWallet(page);

  await expect(page.getByText("25,000 proofs AMO unit")).toBeVisible();
  await expect(
    page.getByText("0.0000000752009741 WORK · 25,000 frozen proofs"),
  ).toBeVisible();
  await expect(page.getByText("Attempted listing")).toHaveCount(0);
  await expect(page.getByText("Pre-V8 relic")).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "Seal" })).toBeVisible();
  const balancesPanel = page
    .locator(".token-mint-panel")
    .filter({ hasText: "Balances" });
  await expect(
    balancesPanel.getByText("1.9999999247990259 WORK"),
  ).toBeVisible();
  await expect(balancesPanel.getByText("0.0000000752009741 reserved")).toBeVisible();
});

test("wallet V8 AMO seal can retry during exact-tip catch-up", async ({
  page,
}) => {
  await installWallet(page);
  await installApiFixtures(page, {
    mode: "precision-paused",
    repairedV8Listing: true,
  });
  await openConnectedWallet(page);

  const listing = page
    .locator(".token-list-item")
    .filter({ hasText: "25,000 proofs AMO unit" });
  await expect(listing).toBeVisible();
  await expect(
    listing.getByText("0.0000000752009741 WORK · 25,000 frozen proofs"),
  ).toBeVisible();
  await expect(listing.getByText("Pre-V8 relic")).toHaveCount(0);
  await expect(listing.getByText("Relic")).toHaveCount(0);
  const seal = listing.getByRole("button", { exact: true, name: "Seal" });
  await expect(seal).toBeVisible();
  await expect(seal).toBeEnabled();

  await seal.click();
  await expect(
    page
      .locator(".field-note.bad")
      .filter({ hasText: "work-amo-v8-precision-migration-not-ready" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.__mailComposeFixture?.signCalls ?? 0),
    )
    .toBe(0);
});

test("AMO order book counts remote unsealed V8 listings", async ({ page }) => {
  await installWallet(page);
  await installApiFixtures(page, {
    freshMarketLogFailure: true,
    mode: "precision-paused",
    remoteV8MarketListings: true,
  });

  await page.goto(`/?marketplace=1&asset=${WORK_TOKEN_ID}`, {
    waitUntil: "domcontentloaded",
  });
  const amoUnits = page
    .locator(".token-market-card")
    .filter({ has: page.getByRole("heading", { name: "AMO Units" }) })
    .first();
  await expect(amoUnits).toBeVisible();
  await expect(amoUnits.getByText("No credit listings yet")).toHaveCount(0);
  await expect(
    amoUnits.getByRole("button", { name: "All 2" }),
  ).toContainText("2");
  await expect(
    amoUnits.getByRole("button", { name: "Sealed 0" }),
  ).toContainText("0");
  await expect(
    amoUnits.getByRole("button", { name: "Unsealed 2" }),
  ).toContainText("2");
  const amoRows = amoUnits.locator(".token-market-grid .token-market-row");
  await expect(amoRows.filter({ hasText: "Waiting for seal" })).toHaveCount(2);
  await expect(
    amoRows.filter({ hasText: "0.0000000752009741 WORK" }),
  ).toHaveCount(2);
  await expect(amoUnits.getByText("Pending confirmation")).toHaveCount(0);
  await expect(amoUnits.getByText("Pre-V8 relic")).toHaveCount(0);
  await expect(amoRows).toHaveCount(2);

  await page.getByRole("button", { name: "Refresh" }).first().click();
  await expect(
    amoUnits.getByRole("button", { name: "All 2" }),
  ).toContainText("2");
  await expect(
    amoUnits.getByRole("button", { name: "Unsealed 2" }),
  ).toContainText("2");
  await expect(amoUnits.getByText("Pre-V8 relic")).toHaveCount(0);
});

test("pre-V8 mail prepares send2 once and exposes the busy state", async ({
  page,
}) => {
  await installWallet(page);
  await installApiFixtures(page, { mode: "pre-v8" });
  await openConnectedCompose(page);
  await fillReadyMail(page, "100.00000001");

  const send = page.locator(".mail-send-button");
  await expect(page.locator("#compose-send-status")).toContainText(
    "exceeds 100.0000000000000000 spendable WORK",
  );
  await expect(send).toBeDisabled();

  await page.getByLabel("WORK each").fill("0.00000001");
  await expect(send).toHaveAttribute("data-state", "ready");
  await page.locator("form.compose-pane").evaluate((form) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  const psbtHex = await capturedPsbt(page);
  await expect(send).toHaveAttribute("data-state", "busy");
  await expect(send).toHaveAttribute("aria-busy", "true");
  await expect(send).toBeDisabled();
  await expect(send).toContainText("Sending");
  await expectReadableButton(send, "busy");

  await page.locator("form.compose-pane").evaluate((form) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await page.waitForTimeout(100);
  await expect
    .poll(() =>
      page.evaluate(() => window.__mailComposeFixture?.signCalls ?? 0),
    )
    .toBe(1);

  expect(opReturnPayloads(psbtHex)).toContain(
    `pwt1:send2:${WORK_TOKEN_ID}:1:${RECIPIENT}`,
  );
});

test("post-V8 mail prepares an exact one-subatom send3", async ({ page }) => {
  await installWallet(page);
  await installApiFixtures(page, { mode: "post-v8" });
  await openConnectedCompose(page);
  await fillReadyMail(page, "0.0000000000000001");

  const send = page.locator(".mail-send-button");
  await expect(send).toHaveAttribute("data-state", "ready");
  await send.click();
  const psbtHex = await capturedPsbt(page);

  expect(opReturnPayloads(psbtHex)).toContain(
    `pwt1:send3:${WORK_TOKEN_ID}:1:${RECIPIENT}`,
  );
  expect(
    opReturnPayloads(psbtHex).some((payload) =>
      payload.startsWith("pwt1:send2:"),
    ),
  ).toBe(false);
});
