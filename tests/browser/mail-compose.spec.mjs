import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";

const NOW = "2026-08-01T12:00:00.000Z";
const HASH = "1".repeat(64);
const SENDER = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
const RECIPIENT = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const POWB_TOKEN_ID =
  "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";
const INCB_TOKEN_ID =
  "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
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
const V8_SEAL_TXID = "9".repeat(64);
const V8_ANCHOR_SIGNATURE = "aa".repeat(64);
const LISTING_CHECKPOINT_HEIGHT = 960_220;
const LISTING_SNAPSHOT_ID = "2".repeat(64);
const LISTING_AUTHORITY_DIGEST = "3".repeat(64);
const LISTING_PROJECTION_DIGEST = "4".repeat(64);
const LISTING_PAGE_CURSOR = "opaque-complete-listings-page-2";
const TOKEN_HISTORY_PAGE_SIZE = 200;

const fundingTransaction = new bitcoin.Transaction();
fundingTransaction.version = 2;
fundingTransaction.addInput(Buffer.alloc(32), 0xffffffff);
fundingTransaction.addOutput(
  bitcoin.address.toOutputScript(SENDER, bitcoin.networks.bitcoin),
  100_000n,
);
const FUNDING_TXID = fundingTransaction.getId();
const FUNDING_HEX = fundingTransaction.toHex();

test("Mail Compose opens the shared Publish page and restores the complete private Mail draft", async ({ page }) => {
  await installWallet(page);
  await installApiFixtures(page);
  await openConnectedCompose(page);
  await page.getByLabel("To", { exact: true }).fill(RECIPIENT);
  await page.getByLabel("CC", { exact: true }).fill(SENDER);
  await page.getByLabel("Subject", { exact: true }).fill("Private Mail subject");
  await page.getByLabel("Message", { exact: true }).fill("Private message stays in Mail.  \n");
  await page.getByLabel("Proofs each", { exact: true }).fill("765");
  await page.getByLabel("WORK each", { exact: true }).fill("0.1234567890123456");
  await page.locator('form.compose-pane input[type="file"]').setInputFiles({
    name: "mail-only.txt", mimeType: "text/plain", buffer: Buffer.from("Private attachment"),
  });
  await expect(page.locator(".compose-pane")).toContainText("mail-only.txt");
  await page.evaluate(sender => localStorage.setItem(`proofofwork.publish.draft.v1:livenet:${sender}`,
    JSON.stringify({title:"Existing article",body:"Article draft stays separate",signal:546,feeRate:1})), SENDER);
  await page.getByLabel("Compose type").selectOption("publish");
  await expect(page).toHaveURL(/folder=publish.*write=1/);
  await expect(page.getByLabel("Article title", { exact: true })).toHaveValue("Existing article");
  await expect(page.getByLabel("Article text", { exact: true })).toHaveValue("Article draft stays separate");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Article text", { exact: true }).fill("Article draft revised.  \n");
  await page.getByRole("button", { name: "Back to Mail", exact: true }).click();
  await expect(page.getByLabel("Compose type")).toHaveValue("mail");
  await expect(page.getByLabel("To", { exact: true })).toHaveValue(RECIPIENT);
  await expect(page.getByLabel("CC", { exact: true })).toHaveValue(SENDER);
  await expect(page.getByLabel("Subject", { exact: true })).toHaveValue("Private Mail subject");
  await expect(page.locator(".compose-pane textarea")).toHaveValue("Private message stays in Mail.  \n");
  await expect(page.getByLabel("Proofs each", { exact: true })).toHaveValue("765");
  await expect(page.getByLabel("WORK each", { exact: true })).toHaveValue("0.1234567890123456");
  await expect(page.locator(".compose-pane")).toContainText("mail-only.txt");
  await expect(page).not.toHaveURL(/write=1/);
  await page.goForward();
  await expect(page.getByLabel("Article text", { exact: true })).toHaveValue("Article draft revised.  \n");
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
});

test("Mail Compose keeps Boost self-send mode and refuses Publish handoff when saving fails", async ({ page }) => {
  await installWallet(page); await installApiFixtures(page); await openConnectedCompose(page);
  await page.getByLabel("Compose type").selectOption("boost");
  await expect(page.getByLabel("To", { exact: true })).toHaveValue(SENDER);
  await expect(page.getByLabel("To", { exact: true })).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Message", { exact: true })).toHaveAttribute("maxlength", "140");
  await page.getByLabel("Compose type").selectOption("mail");
  await page.getByLabel("Message", { exact: true }).fill("Keep this unsaved Mail text");
  await page.evaluate(() => { const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key,value) {
      if(key.startsWith("proofofwork.draft.v1:")) throw new Error("Fixture storage full");
      return original.call(this,key,value);
    };
  });
  await page.getByLabel("Compose type").selectOption("publish");
  await expect(page.locator(".compose-pane textarea")).toHaveValue("Keep this unsaved Mail text");
  await expect(page).not.toHaveURL(/folder=publish/);
  await expect(page.locator(".status-text")).toContainText("Fixture storage full");
});

for (const corruption of ["none", "body", "network"]) test(`Mail Publish reader ${corruption === "none" ? "shows verified full article in Inbox and Sent" : `refuses changed ${corruption} evidence`}`, async ({page}) => {
  await installWallet(page); await installApiFixtures(page);
  const body = "  Article body with café and 東京.\n\nFull text.  \n";
  const article = {v:1,title:"Canonical article title",source:"same-tx-pwm1-message",
    size:Buffer.byteLength(body),sha256:createHash("sha256").update(body).digest("hex")};
  const txid = "e".repeat(64);
  const mail = {txid,from:SENDER,to:SENDER,recipients:[{address:SENDER,amountSats:546}],network:"livenet",
    createdAt:NOW,memo:body,amountSats:546,socialMode:true,article,
    articleVerification:"canonical-same-tx-pwm1-message-v1",replyTo:SENDER};
  await page.route(`**/api/v1/address/${SENDER}/mail*`,route=>route.fulfill({contentType:"application/json",body:JSON.stringify({
    address:SENDER,network:"livenet",inboxMessages:[{...mail,confirmed:true}],sentMessages:[{...mail,status:"confirmed",feeRate:1}],
    historyCoverage:{complete:true,model:"proof-index-address-mail-complete-v1"},
  })}));
  await page.route("**/api/v1/boost?**",route=>route.fulfill({contentType:"application/json",body:JSON.stringify({
    complete:true,mode:"detail",snapshotId:HASH,network:corruption === "network" ? "testnet4" : "livenet",post:{...mail,kind:"boost-post",confirmed:true,
      authorAddress:SENDER,text:article.title,articleBody:corruption === "body"?body+"changed":body},items:[],totalCount:0,
  })}));
  await page.goto("/");
  await page.locator(".onboarding-pane").getByRole("button",{name:"Connect UniSat"}).click();
  await page.locator(".message-row").filter({hasText:article.title}).first().click();
  await expect(page.locator(".reader h2")).toHaveText(article.title);
  await expect(page.getByRole("link",{name:"Open Publish",exact:true})).toHaveAttribute("href",new RegExp(`article=${txid}`));
  if(corruption !== "none"){
    await expect(page.locator(".reader [role=alert]")).toContainText("Article text unavailable");
    await expect(page.locator(".reader > pre")).toHaveCount(0);
  }else{
    await expect(page.locator(".reader > pre")).toHaveText(body);
    await page.locator(".sidebar").getByRole("button",{name:/^Sent/}).click();
    await page.locator(".message-row").filter({hasText:article.title}).first().click();
    await expect(page.locator(".reader > pre")).toHaveText(body);
  }
});

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

test("Mail to Publish history restores only the current account's draft", async ({page}) => {
  await installWallet(page); await installApiFixtures(page); await openConnectedCompose(page);
  await page.getByLabel("Message", {exact:true}).fill("Original account private draft");
  await page.getByLabel("Compose type").selectOption("publish");
  await expect(page.getByLabel("Article title", {exact:true})).toBeVisible();
  await page.evaluate(({sender, next}) => {
    localStorage.setItem(`proofofwork.draft.v1:livenet:${next}`, JSON.stringify({
      from:next,network:"livenet",recipient:sender,ccRecipient:"",subject:"Other account",memo:"Other account draft",
      amountSats:546,feeRate:1,workAmount:"0",updatedAt:new Date().toISOString(),
    }));
    window.unisat.getAccounts = async () => [next];
    window.__mailComposeFixture.emit("accountsChanged");
  }, {sender:SENDER,next:RECIPIENT});
  await expect(page.locator(".topbar-wallet-button")).toContainText("1F1p9UEH");
  await page.getByRole("button",{name:"Back to Mail",exact:true}).click();
  await expect(page.locator(".compose-pane textarea")).toHaveValue("Other account draft");
  expect(await page.evaluate(sender=>JSON.parse(localStorage.getItem(`proofofwork.draft.v1:livenet:${sender}`)).memo,SENDER))
    .toBe("Original account private draft");
});

test("Mail raw article fallback verifies multichunk UTF-8 and refuses malformed or ambiguous envelopes", async ({page}) => {
  await installApiFixtures(page); await page.goto("/?publish=1");
  const body = "  First paragraph café.\n\n東京 🧭 trailing.  \n";
  const article = {v:1,title:"Raw article",source:"same-tx-pwm1-message",size:Buffer.byteLength(body),
    sha256:createHash("sha256").update(body).digest("hex")};
  const post = `pwb1:post:${Buffer.from(JSON.stringify({v:1,text:article.title,article})).toString("base64url")}`;
  const output = text => ({scriptpubkey:Buffer.from(bitcoin.payments.embed({data:[Buffer.from(text)]}).output).toString("hex")});
  const tx = {status:{confirmed:true},vout:[output(post),output(`pwm1:m:${body.slice(0,23)}`),output(`pwm1:m:${body.slice(23)}`)]};
  const cases = [tx,{...tx,status:{confirmed:false}}, {...tx,vout:[...tx.vout,output(post)]},
    {...tx,vout:[...tx.vout,output("pwm1:a:extra")]},
    {...tx,vout:[tx.vout[0],tx.vout[1],output("pwb1:like:unrelated"),tx.vout[2]]},
    {...tx,vout:[tx.vout[0],tx.vout[1],output("pwm1:m:bad"),tx.vout[2]]},
    {...tx,vout:[output("\uFEFF"+post),tx.vout[1],tx.vout[2]]}];
  const unrelated = {...tx,vout:[tx.vout[0],tx.vout[1],{scriptpubkey:"6a01ff"},
    {scriptpubkey:"6a"},output("unrelated text"),tx.vout[2]]};
  const results = await page.evaluate(async cases => {
    const {mailArticleFromTransaction} = await import("/src/features/publish/publishMail.ts");
    return cases.map(tx=>mailArticleFromTransaction(tx));
  }, cases);
  expect(results[0].article).toEqual(article);
  for(const result of results.slice(1)) expect(result).toEqual({});
  expect(await page.evaluate(async tx => {
    const {mailArticleFromTransaction} = await import("/src/features/publish/publishMail.ts");
    return mailArticleFromTransaction(tx).article;
  },unrelated)).toEqual(article);
});

test("Publish round trip preserves a Mail reply draft and an intentionally empty new composition", async ({page}) => {
  await installWallet(page); await installApiFixtures(page); await openConnectedCompose(page);
  await page.evaluate(sender => localStorage.setItem(`proofofwork.draft.v1:livenet:${sender}`, JSON.stringify({
    from:sender,network:"livenet",recipient:sender,amountSats:546,feeRate:0.5,workAmount:"0",
    memo:"Reply draft",subject:"Reply subject",parentTxid:"7".repeat(64),updatedAt:new Date().toISOString(),
  })), SENDER);
  await page.locator(".sidebar").getByRole("button",{name:/^Drafts/}).click();
  await expect(page.locator(".reply-banner")).toContainText("7".repeat(64));
  await page.getByLabel("Compose type").selectOption("publish");
  await page.getByRole("button",{name:"Back to Mail",exact:true}).click();
  await expect(page.locator(".reply-banner")).toContainText("7".repeat(64));
  await expect(page.getByLabel("Fee proofs/vB",{exact:true})).toHaveValue("0.5");
  await page.locator(".sidebar").getByRole("button",{name:"Compose",exact:true}).click();
  await expect(page.locator(".compose-pane textarea")).toHaveValue("");
  await page.getByLabel("Compose type").selectOption("publish");
  await page.getByRole("button",{name:"Back to Mail",exact:true}).click();
  await expect(page.locator(".compose-pane textarea")).toHaveValue("");
  await expect(page.getByLabel("Subject",{exact:true})).toHaveValue("");
  await expect(page.locator(".reply-banner")).toHaveCount(0);
});

function v8AmoListing({
  createdAt = NOW,
  includeFrozenTerms = true,
  listingId = V8_LISTING_TXID,
  nonce = "browser-v8-listing",
  sealed = false,
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
    displayEvidence: {
      fullDetailPath: `/api/v1/token-history?kind=listings&projection=full&q=${listingId}&listingId=${listingId}`,
      fullRecordSha256: HASH,
      model: "proof-token-listing-display-v1",
      omittedFields: [],
    },
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
      anchorSignature: sealed ? V8_ANCHOR_SIGNATURE : "",
      anchorScriptPubKey: "76a9144752142b83faf13d526a59212f3f228012890dbe88ac",
      anchorSigHashType: 131,
      anchorTxid: sealed ? listingId : "",
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
    ...(sealed
      ? {
          sealConfirmed: true,
          sealTxid: V8_SEAL_TXID,
        }
      : {}),
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

function remoteV8Listings() {
  return [
    v8AmoListing({
      createdAt: "2026-08-12T06:37:00.000Z",
      listingId: V8_LISTING_TXID,
      nonce: "browser-v8-listing-one",
      sealed: true,
    }),
    v8AmoListing({
      createdAt: "2026-08-12T15:38:00.000Z",
      includeFrozenTerms: false,
      listingId: SECOND_V8_LISTING_TXID,
      nonce: "browser-v8-listing-two",
      sellerAddress: RECIPIENT,
    }),
  ];
}

function completeListingHistoryPage({
  allListings = remoteV8Listings(),
  cursor = "",
}) {
  const start = cursor ? 1 : 0;
  const items = allListings.slice(start, start + 1);
  const end = start + items.length;
  const totalCount = allListings.length;
  const hasMore = end < totalCount;
  return {
    cursor,
    end,
    hasMore,
    indexedAt: NOW,
    indexedThroughBlock: LISTING_CHECKPOINT_HEIGHT,
    indexedThroughBlockHash: HASH,
    items,
    itemProjection: {
      fullMembershipSha256: HASH,
      fullSourceSha256: HASH,
      model: "proof-token-listing-display-v1",
    },
    kind: "listings",
    limit: TOKEN_HISTORY_PAGE_SIZE,
    listingAuthority: {
      checkedListingCount: totalCount,
      checkedOutpointsSha256: LISTING_AUTHORITY_DIGEST,
      checkpoint: {
        blockHash: HASH,
        height: LISTING_CHECKPOINT_HEIGHT,
      },
      includeMempool: true,
      inputListingCount: totalCount,
      model: "proof-token-market-core-gettxout-v1",
      outputListingCount: totalCount,
      spentListingCount: 0,
      unspentListingCount: totalCount,
    },
    listingProjection: {
      activeListingCount: totalCount,
      coreUnspentListingCount: totalCount,
      excludedByProtocolCount: 0,
      membershipSha256: LISTING_PROJECTION_DIGEST,
      model: "proof-token-market-cutover-after-core-v1",
    },
    network: "livenet",
    nextCursor: hasMore ? LISTING_PAGE_CURSOR : "",
    page: 0,
    pageCount: 1,
    snapshotId: LISTING_SNAPSHOT_ID,
    source: "proof-indexer-complete-core-reconciled-token-listings",
    start,
    totalCount,
  };
}

function bondTokenState({ listingSummaryMismatch = false } = {}) {
  return {
    ...authoritativeWorkState(),
    authoritativeWallet: false,
    collectionHasMore: { listings: false },
    hasMore: false,
    holders: [],
    indexedAt: NOW,
    indexedThroughBlock: listingSummaryMismatch
      ? LISTING_CHECKPOINT_HEIGHT - 1
      : LISTING_CHECKPOINT_HEIGHT,
    indexedThroughBlockHash: HASH,
    listings: [],
    snapshotId: LISTING_SNAPSHOT_ID,
    source: "proof-indexer-bond-summary-browser-fixture",
    tokens: [],
    totalCounts: { listings: listingSummaryMismatch ? 1 : 0 },
    walletScoped: false,
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

function authoritativeWorkState({ repairedV8Listing = false, pendingV8Listing = false } = {}) {
  const listing = repairedV8Listing || pendingV8Listing ? v8AmoListing() : undefined;
  if (pendingV8Listing) {
    Object.assign(listing, { confirmed: false, sealConfirmed: false, amount: 0,
      amountSubatoms: undefined, frozenTerms: undefined, createdAt: new Date().toISOString() });
  }
  const balanceSubatoms = pendingV8Listing ? "1000000000000000000000" : repairedV8Listing
    ? "20000000000000000"
    : "1000000000000000000";
  const reservedSubatoms = listing?.amountSubatoms ?? "0";
  const commitment = {
    model: "canonical-work-amo-payload-sha256-v1",
    payloadBytes: 1,
    sha256: "5".repeat(64),
  };
  return {
    amountStorageModel: WORK_STORAGE_MODEL,
    authoritativeWallet: true,
    canonicalWorkCapacities: [
      {
        address: SENDER,
        confirmedBalanceSubatoms: balanceSubatoms,
        indexedThroughBlock: LISTING_CHECKPOINT_HEIGHT,
        indexedThroughBlockHash: HASH,
        model: "canonical-work-wallet-capacity-v1",
        network: "livenet",
        pendingListingNetworkValueQ8: NETWORK_VALUE_Q8,
        pendingListingReserveSubatoms: "250000000000000000000",
        reservations: listing?.confirmed
          ? [{
              amountSubatoms: listing.amountSubatoms,
              listingId: listing.listingId,
            }]
          : [],
        reservedBalanceSubatoms: reservedSubatoms,
        tokenId: WORK_TOKEN_ID,
        tokenStateCommitment: commitment,
        transferableBalanceSubatoms: (
          BigInt(balanceSubatoms) - BigInt(reservedSubatoms)
        ).toString(),
      },
    ],
    closedListings: [],
    indexedThroughBlock: LISTING_CHECKPOINT_HEIGHT,
    indexedThroughBlockHash: HASH,
    confirmedSupplySubatoms: "10000000000000000000",
    creationSats: 1_000,
    decimals: 16,
    holders: [
      {
        address: SENDER,
        balanceSubatoms,
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
    creditEventFrozenValueQ8: "0",
    creditEventLiveValueQ8: "0",
    creditFrozenNetworkValueQ8: "0",
    creditLiveNetworkValueQ8: "0",
    creditMovementFrozenValueQ8: "0",
    creditMovementLiveValueQ8: "0",
    creditNetworkValueQ8: "0",
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
      emit: (event) => { for (const listener of [...(listeners.get(event) ?? [])]) listener(); },
    };
    window.confirm = () => true;
    window.unisat = {
      getAccounts: async () => [sender],
      getChain: async () => ({ enum: "BITCOIN_MAINNET" }),
      getNetwork: async () => "livenet",
      on: (event, listener) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(listener);
      },
      removeListener: (event, listener) => listeners.get(event)?.delete(listener),
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
    compactZeroListingSummary = false,
    completeListingHistoryFailure = false,
    floorFailure = false,
    freshMarketLogFailure = false,
    freshWorkWalletFailure = false,
    holdInitialFloor = false,
    holdWalletBalanceReads = false,
    walletBalanceSubatoms,
    inboxMessage = false,
    listingSummaryMismatch = false,
    mode = "post-v8",
    repairedV8Listing = false,
    pendingV8Listing = false,
    remoteV8MarketListings = false,
    marketRegistryState,
  } = {},
) {
  const requests = [];
  let releaseInitialFloor;
  const initialFloorGate = new Promise((resolve) => {
    releaseInitialFloor = resolve;
  });
  let initialFloorHeld = false;
  let releaseWalletBalanceReads;
  const walletBalanceGate = new Promise((resolve) => { releaseWalletBalanceReads = resolve; });

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.toString());
    const { pathname, searchParams } = url;
    let json = {};
    let status = 200;

    if (pathname.endsWith(`/address/${SENDER}/mail`)) {
      json = {
        address: SENDER,
        network: "livenet",
        historyCoverage: { complete: true, model: "proof-index-address-mail-complete-v1" },
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
      const token = authoritativeWorkState();
      if (remoteV8MarketListings) {
        Object.assign(token, {
          collectionHasMore: {
            listings: compactZeroListingSummary ? false : true,
          },
          hasMore: false,
          indexedAt: NOW,
          indexedThroughBlock: listingSummaryMismatch
            ? LISTING_CHECKPOINT_HEIGHT - 1
            : LISTING_CHECKPOINT_HEIGHT,
          indexedThroughBlockHash: HASH,
          listings: compactZeroListingSummary
            ? []
            : remoteV8Listings().slice(0, 1),
          snapshotId: LISTING_SNAPSHOT_ID,
          totalCounts: {
            listings: compactZeroListingSummary
              ? 0
              : listingSummaryMismatch
                ? remoteV8Listings().length + 1
                : remoteV8Listings().length,
          },
        });
      }
      json = {
        indexedAt: NOW,
        network: "livenet",
        registry: marketRegistryState ?? registryState(),
        summaryOnly: true,
        token,
        workFloor: workFloor(mode),
      };
    } else if (
      pathname === "/api/v1/infinity-summary" ||
      pathname === "/api/v1/inception-summary"
    ) {
      const inception = pathname === "/api/v1/inception-summary";
      json = {
        actualValue: {},
        indexedAt: NOW,
        network: "livenet",
        stats: {},
        ticker: inception ? "INCB" : "POWB",
        token: bondTokenState({ listingSummaryMismatch }),
        tokenId: inception ? INCB_TOKEN_ID : POWB_TOKEN_ID,
      };
    } else if (pathname === "/api/v1/token-history") {
      const kind = searchParams.get("kind");
      if (remoteV8MarketListings && kind === "listings") {
        if (completeListingHistoryFailure) {
          json = {
            error: "The complete Core-reconciled listing book is unavailable.",
            network: "livenet",
            ok: false,
          };
          status = 503;
        } else {
          const cursor = searchParams.get("cursor") ?? "";
          const tokenScope = searchParams.get("asset") ?? "";
          json = completeListingHistoryPage({
            allListings:
              tokenScope === POWB_TOKEN_ID || tokenScope === INCB_TOKEN_ID
                ? []
                : remoteV8Listings(),
            cursor,
          });
        }
      } else if (remoteV8MarketListings && kind === "market-log") {
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
        const listings = remoteV8Listings();
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
      if (holdWalletBalanceReads && searchParams.get("wallet") === "1") await walletBalanceGate;
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
        json = authoritativeWorkState({ repairedV8Listing, pendingV8Listing });
        if (walletBalanceSubatoms && searchParams.get("wallet") === "1") {
          json.holders[0].balanceSubatoms = walletBalanceSubatoms;
          json.canonicalWorkCapacities[0].confirmedBalanceSubatoms = walletBalanceSubatoms;
          json.canonicalWorkCapacities[0].transferableBalanceSubatoms = (
            BigInt(walletBalanceSubatoms) - BigInt(json.canonicalWorkCapacities[0].reservedBalanceSubatoms)
          ).toString();
        }
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
    releaseWalletBalanceReads: () => releaseWalletBalanceReads(),
    releaseInitialFloor: () => releaseInitialFloor(),
    requests,
  };
}

async function openConnectedCompose(page, route = "/") {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page
    .locator(".onboarding-pane")
    .getByRole("button", { name: "Connect UniSat" })
    .click();
  await expect(page.locator(".topbar-wallet-button")).toContainText("1BPVvi1G");
  await page.locator(".compose-button:visible").first().click();
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
  await page.getByRole("dialog", { name: "Review mail transaction" }).getByRole("button", { name: "Continue to wallet" }).click();
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

for (const route of ["/?marketplace=1", "/?folder=marketplace"]) {
test(`AMO directory reads confirmed wallet balance from the account lane despite compact empty movement history: ${route}`, async ({ page }) => {
  await installWallet(page);
  const fixture = await installApiFixtures(page, {
    holdWalletBalanceReads: true,
    remoteV8MarketListings: true,
    walletBalanceSubatoms: "9999997003878536",
  });
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".marketplace-summary-read-state").first()).toHaveAttribute("data-state", "ready");
  const card = page.locator("article.token-market-row").filter({ has: page.getByText("WORK", { exact: true }) });
  await expect(card).toContainText("Your confirmed balance Loading WORK");
  await expect(card).not.toContainText("Your confirmed balance 0.0000000000000000 WORK");
  fixture.releaseWalletBalanceReads();
  await expect(card).toContainText("Your confirmed balance 0.9999997003878536 WORK");
  const tokenReads = fixture.requests.map((request) => new URL(request))
    .filter((url) => url.pathname === "/api/v1/token");
  expect(tokenReads.every((url) => url.searchParams.get("wallet") === "1" && url.searchParams.get("address") === SENDER)).toBe(true);
  expect(tokenReads.some((url) => url.searchParams.get("asset") === WORK_TOKEN_ID)).toBe(true);
  let releaseNextWallet;
  const nextWalletGate = new Promise((resolve) => { releaseNextWallet = resolve; });
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("wallet") !== "1" || url.searchParams.get("address") !== RECIPIENT) return route.fallback();
    await nextWalletGate;
    const next = authoritativeWorkState();
    next.holders[0].address = RECIPIENT;
    next.holders[0].balanceSubatoms = "2500000000000000";
    Object.assign(next.canonicalWorkCapacities[0], { address: RECIPIENT,
      confirmedBalanceSubatoms: "2500000000000000", transferableBalanceSubatoms: "2500000000000000" });
    return route.fulfill({ json: next });
  });
  await page.evaluate((next) => {
    window.unisat.getAccounts = async () => [next];
    window.__mailComposeFixture.emit("accountsChanged");
  }, RECIPIENT);
  await expect(card).toContainText("Your confirmed balance Loading WORK");
  await expect(card).not.toContainText("0.9999997003878536 WORK");
  releaseNextWallet();
  await expect(card).toContainText("Your confirmed balance 0.2500000000000000 WORK");
});
}

test("AMO directory uses the clean all-account fallback when the dedicated fresh capacity read fails", async ({ page }) => {
  await installWallet(page);
  await installApiFixtures(page, { freshWorkWalletFailure: true,
    remoteV8MarketListings: true, walletBalanceSubatoms: "9999997003878536" });
  await page.goto("/?marketplace=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".marketplace-summary-read-state").first()).toHaveAttribute("data-state", "ready");
  const card = page.locator("article.token-market-row").filter({ has: page.getByText("WORK", { exact: true }) });
  await expect(card).toContainText("Your confirmed balance 0.9999997003878536 WORK");
  await expect(card).not.toContainText("Your confirmed balance 0.0000000000000000 WORK");
});

test("AMO order book counts sealed and unsealed V8 listings with exact buyer arb", async ({
  page,
}) => {
  await installWallet(page);
  const fixture = await installApiFixtures(page, {
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
  // The public AMO read hydrates the exact book before exposing the market,
  // including when wallet connection changes the account during that read.
  await expect(page.locator(".marketplace-summary-read-state").first()).toHaveAttribute("data-state", "ready");
  await expect(amoUnits.getByRole("button", { name: "Load complete sale-ticket history" })).toHaveCount(0);
  await expect(
    amoUnits.getByRole("button", { name: "All 2" }),
  ).toContainText("2");
  await expect(
    amoUnits.getByRole("button", { exact: true, name: "Sealed 1" }),
  ).toContainText("1");
  await expect(
    amoUnits.getByRole("button", { exact: true, name: "Unsealed 1" }),
  ).toContainText("1");
  const amoRows = amoUnits.locator(".token-market-grid .token-market-row");
  await expect(amoRows.getByText("Sealed", { exact: true })).toHaveCount(1);
  await expect(
    amoRows.getByText("Waiting for seal", { exact: true }),
  ).toHaveCount(1);
  await expect(
    amoRows.filter({ hasText: "0.0000000752009741 WORK" }),
  ).toHaveCount(2);
  await expect(amoRows.getByTestId("work-buyer-arb")).toHaveText(
    "-24,999.9999999247990259 proofs",
  );
  await expect(amoUnits.getByText("Pending confirmation")).toHaveCount(0);
  await expect(amoUnits.getByText("Pre-V8 relic")).toHaveCount(0);
  await expect(amoRows).toHaveCount(2);
  await expect
    .poll(() =>
      fixture.requests.some((request) => {
        const url = new URL(request);
        return (
          url.pathname === "/api/v1/token-history" &&
          url.searchParams.get("kind") === "listings" &&
          url.searchParams.get("cursor") === LISTING_PAGE_CURSOR &&
          !url.searchParams.has("page")
        );
      }),
    )
    .toBe(true);

  await page.getByRole("button", { name: "Refresh" }).first().click();
  await expect(
    amoUnits.getByRole("button", { name: "All 2" }),
  ).toContainText("2");
  await expect(
    amoUnits.getByRole("button", { exact: true, name: "Sealed 1" }),
  ).toContainText("1");
  await expect(
    amoUnits.getByRole("button", { exact: true, name: "Unsealed 1" }),
  ).toContainText("1");
  await expect(amoRows.getByTestId("work-buyer-arb")).toHaveText(
    "-24,999.9999999247990259 proofs",
  );
  await expect(amoUnits.getByText("Pre-V8 relic")).toHaveCount(0);
});

for (const scenario of [
  { name: "mismatched exact listing evidence", options: { listingSummaryMismatch: true, mode: "precision-paused" } },
  { name: "unverified zero compact inventory", options: { compactZeroListingSummary: true, completeListingHistoryFailure: true } },
]) {
  test(`AMO withholds inventory and offers retry for ${scenario.name}`, async ({ page }) => {
    const fixture = await installApiFixtures(page, { ...scenario.options, remoteV8MarketListings: true });
    await page.goto(`/?marketplace=1&asset=${WORK_TOKEN_ID}`, { waitUntil: "domcontentloaded" });
    const state = page.locator(".marketplace-summary-read-state").first();
    await expect(state).toHaveAttribute("data-state", "unavailable");
    await expect(page.getByRole("heading", { name: "AMO inventory unavailable" })).toBeVisible();
    await expect(page.locator(".marketplace-summary-gate")).toContainText("Totals and empty-book claims are withheld");
    await expect(page.getByText("No credit listings yet", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "AMO Units", exact: true })).toHaveCount(0);
    const countReads = () => fixture.requests.filter(request => new URL(request).pathname === "/api/v1/marketplace-summary").length;
    const before = countReads();
    await state.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(countReads).toBeGreaterThan(before);
    await expect(state).toHaveAttribute("data-state", "unavailable");
    await expect(page.getByRole("heading", { name: "AMO inventory unavailable" })).toBeVisible();
  });
}

test("standalone INCB clears its compact preview after filtering the exact global listing book", async ({
  page,
}) => {
  const fixture = await installApiFixtures(page, {
    remoteV8MarketListings: true,
  });

  await page.goto("/?inception=1", { waitUntil: "domcontentloaded" });
  const incbBook = page
    .locator(".token-market-card")
    .filter({ has: page.getByRole("heading", { name: "INCB Sale Tickets" }) })
    .first();
  await expect(incbBook).toBeVisible();
  await expect(incbBook.getByText(/Showing a verified AMO preview/u)).toBeVisible();
  await expect(
    incbBook.getByRole("heading", {
      name: "Complete INCB history not loaded",
    }),
  ).toBeVisible();
  expect(
    fixture.requests.some((request) => {
      const url = new URL(request);
      return url.pathname === "/api/v1/token-history" && url.searchParams.get("kind") === "listings";
    }),
  ).toBe(false);
  await incbBook
    .getByRole("button", { name: "Load complete INCB history" })
    .click();
  await expect(incbBook.getByText(/Showing a verified AMO preview/u)).toHaveCount(0);
  await expect(
    incbBook.getByRole("heading", { name: "No INCB sale tickets yet" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Refresh" }).first().click();
  await expect(page.locator(".desktop-route-status.status.good")).toContainText(
    "Inception Bond loaded.",
  );
  await expect(incbBook.getByText(/Showing a verified AMO preview/u)).toHaveCount(0);
  await expect(incbBook.getByRole("button", { name: "Load complete INCB history" })).toHaveCount(0);
});

test("standalone INCB stays idle with a labeled preview on scoped checkpoint and count mismatch", async ({
  page,
}) => {
  await installApiFixtures(page, {
    listingSummaryMismatch: true,
    remoteV8MarketListings: true,
  });

  await page.goto("/?inception=1", { waitUntil: "domcontentloaded" });
  const incbBook = page
    .locator(".token-market-card")
    .filter({ has: page.getByRole("heading", { name: "INCB Sale Tickets" }) })
    .first();
  await expect(incbBook).toBeVisible();
  await expect(
    incbBook.getByText(
      /0 INCB tickets visible; 1 total credit and bond tickets declared/u,
    ),
  ).toBeVisible();
  await expect(
    incbBook.getByRole("heading", {
      name: "Complete INCB history not loaded",
    }),
  ).toBeVisible();
  await incbBook
    .getByRole("button", { name: "Load complete INCB history" })
    .click();
  await expect(
    incbBook.locator(".listing-history-load-controls .field-note.bad"),
  ).toContainText("exact indexed summary snapshot");
  await expect(incbBook.getByText(/Showing a verified AMO preview/u)).toBeVisible();

  await page.getByRole("button", { name: "Refresh" }).first().click();
  await expect(page.locator(".desktop-route-status.status.idle")).toContainText(
    "Inception Bond summary loaded. The verified INCB preview is ready. Load complete Core-reconciled sale-ticket history when you need full search or inventory.",
  );
  await expect(page.locator(".desktop-route-status.status.good")).toHaveCount(0);
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

test("Mail reviews exact payments and WORK before any wallet invocation; cancel preserves draft and focus", async ({ page }) => {
  await installWallet(page);
  await installApiFixtures(page);
  await openConnectedCompose(page);
  await fillReadyMail(page, "0.1234567890123456");
  const send = page.locator(".mail-send-button");
  await send.click();
  const review = page.getByRole("dialog", { name: "Review mail transaction" });
  await expect(review).toBeVisible();
  await expect(review.locator(".review-work").getByText("0.1234567890123456 WORK", { exact: true })).toBeVisible();
  await expect(review.getByText(RECIPIENT, { exact: true }).first()).toBeVisible();
  await expect(review.locator(".review-fields").getByText("546 proofs", { exact: true })).toBeVisible();
  await expect(review.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
  await page.keyboard.press("Escape");
  await expect(review).toHaveCount(0);
  await expect(send).toBeFocused();
  await expect(send).toBeEnabled();
  await expect(page.getByLabel("Message")).toHaveValue("Mail admission browser contract");
  await expect(page.getByLabel("WORK each")).toHaveValue("0.1234567890123456");
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
});

test("Mail signing rejection retains draft and permits a newly prepared review", async ({ page }) => {
  await installWallet(page);
  await installApiFixtures(page);
  await openConnectedCompose(page);
  await fillReadyMail(page, "0");
  await page.evaluate(() => { window.unisat.signPsbt = async () => { window.__mailComposeFixture.signCalls++; throw new Error("User rejected request"); }; });
  await page.locator(".mail-send-button").click();
  await page.getByRole("dialog").getByRole("button", { name: "Continue to wallet" }).click();
  await expect(page.locator(".status-text").getByText("Signature rejected or canceled. Draft preserved; review again when ready.")).toBeVisible();
  await expect(page.getByLabel("Message")).toHaveValue("Mail admission browser contract");
  await expect(page.locator(".mail-send-button")).toBeEnabled();
  await page.locator(".mail-send-button").click();
  await expect(page.getByRole("dialog", { name: "Review mail transaction" })).toBeVisible();
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(1);
});

test("Wallet events invalidate an open Mail review without signing", async ({ page }) => {
  await installWallet(page);
  await installApiFixtures(page);
  await openConnectedCompose(page);
  await fillReadyMail(page, "0");
  await page.locator(".mail-send-button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() => window.__mailComposeFixture.emit("accountsChanged"));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
});

test("Changing a draft during preparation invalidates its signing review", async ({ page }) => {
  await installWallet(page); await installApiFixtures(page); await openConnectedCompose(page, "/?folder=inbox");
  await fillReadyMail(page, "0");
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let waiting = false;
  await page.route(`**/api/v1/tx/${FUNDING_TXID}/hex*`, async route => {
    waiting = true; await gate;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ hex: FUNDING_HEX }) });
  });
  await page.locator(".mail-send-button").click();
  await expect.poll(() => waiting).toBe(true);
  await page.getByLabel("Message").fill("Changed while preparing");
  release();
  await expect(page.locator(".status-text")).toContainText("Mail or wallet context changed");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
});

test("Mail stops before signing when a reviewed funding input is no longer available", async ({ page }) => {
  await installWallet(page); await installApiFixtures(page); await openConnectedCompose(page);
  await fillReadyMail(page, "0"); await page.locator(".mail-send-button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.route(`**/api/v1/address/${SENDER}/utxo*`, route => route.fulfill({ contentType: "application/json", body: '[]' }));
  await page.getByRole("dialog").getByRole("button", { name: "Continue to wallet" }).click();
  await expect(page.locator(".status-text")).toContainText("Prepared funding changed or is unavailable");
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
  await expect(page.getByLabel("Message")).toHaveValue("Mail admission browser contract");
});

test("Mail review separates To and CC, exact WORK each, registry total, and file evidence", async ({ page }) => {
  await installWallet(page); await installApiFixtures(page); await openConnectedCompose(page);
  await fillReadyMail(page, "0.0000000000000001");
  await page.getByRole("combobox", { name: "CC", exact: true }).fill(WORK_REGISTRY);
  await page.locator('form.compose-pane input[type="file"]').setInputFiles({ name: "evidence.txt", mimeType: "text/plain", buffer: Buffer.from("Verified file fixture") });
  await expect(page.getByText("evidence.txt", { exact: true })).toBeVisible();
  await page.locator(".mail-send-button").click();
  const review = page.getByRole("dialog");
  await expect(review.locator(".review-work")).toHaveCount(2);
  await expect(review.locator(".review-work").first()).toContainText("0.0000000000000001 WORK");
  await expect(review.locator(".review-fields").getByText("1092 proofs", { exact: true })).toBeVisible();
  await expect(review.locator(".review-value-row").getByText("CC", { exact: true })).toBeVisible();
  await review.getByText("Inspect message and transaction evidence", { exact: true }).click();
  await expect(review.getByText(/File: evidence.txt · 21 bytes/)).toBeVisible();
  await expect(review.getByText(/SHA-256: [0-9a-f]{64}/)).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async text => { window.__copiedReview = text; },
  }}));
  await review.getByRole("button", { name: "Copy review evidence" }).click();
  const copied = await page.evaluate(() => JSON.parse(window.__copiedReview));
  expect(copied.recipients[0].work).toBe("0.0000000000000001");
  expect(copied.totalWork).toBe("0.0000000000000002");
  expect(copied.evidence.records.some(record => record.startsWith("pwt1:send3:"))).toBe(true);
  expect(copied.registry.proofs).toBe("1092");
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
});

test("Unknown Mail broadcast persists its txid and draft until a status check resolves it", async ({ page }) => {
  await installWallet(page); await installApiFixtures(page); await openConnectedCompose(page);
  await fillReadyMail(page, "0");
  await page.exposeFunction("fixtureFinalizeMail", hex => {
    const psbt = bitcoin.Psbt.fromHex(hex);
    // Structurally finalized fixture only; broadcast is intercepted and never reaches a node.
    for (let index = 0; index < psbt.inputCount; index++) psbt.updateInput(index, {
      finalScriptSig: bitcoin.script.compile([Buffer.alloc(72, 1), Buffer.alloc(33, 2)]),
    });
    return psbt.toHex();
  });
  await page.evaluate(() => { window.unisat.signPsbt = async hex => {
    window.__mailComposeFixture.signCalls++; return window.fixtureFinalizeMail(hex);
  }; });
  let broadcastCalls = 0;
  let resolved = false;
  await page.route("**/api/v1/broadcast/tx*", async route => {
    broadcastCalls++;
    await route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"fixture result unavailable"}' });
  });
  await page.route("**/api/v1/tx/*/status*", async route => {
    if (route.request().url().includes(FUNDING_TXID)) return route.fulfill({ contentType: "application/json", body: '{"status":"confirmed","confirmed":true}' });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: resolved ? "dropped" : "unknown" }) });
  });
  await page.locator(".mail-send-button").click();
  await page.getByRole("dialog").getByRole("button", { name: "Continue to wallet" }).click();
  await expect(page.locator(".status-text")).toContainText("Broadcast outcome unknown");
  expect(broadcastCalls).toBe(1);
  await expect(page.locator(".mail-send-button")).toBeDisabled();
  await expect(page.getByLabel("Message")).toHaveValue("Mail admission browser contract");
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem("proofofwork.sent.v5")));
  expect(records).toHaveLength(1); expect(records[0].status).toBe("unknown"); expect(records[0].txid).toMatch(/^[0-9a-f]{64}$/);
  resolved = true;
  await page.locator(".list-toolbar").getByRole("button", { name: "Refresh", exact: true }).click();
  await page.locator(".compose-button").first().click();
  await fillReadyMail(page, "0");
  await expect(page.locator(".mail-send-button")).toBeEnabled();
  const checked = await page.evaluate(() => JSON.parse(localStorage.getItem("proofofwork.sent.v5")));
  expect(checked[0].status).toBe("dropped"); expect(broadcastCalls).toBe(1);
});

for (const viewport of [{ width: 320, height: 568 }, { width: 320, height: 180 }, { width: 768, height: 512 }, { width: 1440, height: 360 }]) {
  test(`Mail review reflows and keeps controls reachable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installWallet(page); await installApiFixtures(page); await openConnectedCompose(page);
    await fillReadyMail(page, "0.1234567890123456");
    await page.locator(".mail-send-button").click();
    const review = page.getByRole("dialog");
    await expect(review).toBeVisible();

    const geometry = await review.evaluate(element => ({ width: element.getBoundingClientRect().width, client: element.clientWidth, scroll: element.scrollWidth }));
    expect(geometry.width).toBeLessThanOrEqual(viewport.width);
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
    const approve = review.getByRole("button", { name: "Continue to wallet" });
    await approve.scrollIntoViewIfNeeded();
    await expect(approve).toBeInViewport();
    const target = await approve.boundingBox();
    expect(target.height).toBeGreaterThanOrEqual(44); expect(target.width).toBeGreaterThanOrEqual(44);
    if (viewport.width === 320) await page.screenshot({ path: "/tmp/pow-batch-two-mail-review-320.png" });
    await review.getByRole("button", { name: "Back to compose" }).click();
    expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
  });
}


test("wallet keeps remaining WORK and a second listing available while the first V8 intent is pending", async ({ page }) => {
  await installWallet(page);
  await installApiFixtures(page, { pendingV8Listing: true });
  await openConnectedWallet(page);
  const form = page.locator("#wallet-list");
  await expect(form.getByText("75,000.0000000000000000 WORK", { exact: true })).toBeVisible();
  await expect(form.getByRole("button", { name: "Create 25,000 proofs AMO intent" })).toBeEnabled();
  await expect(page.getByText(/Additional WORK spending stays paused/)).toHaveCount(0);
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
});

test("Computer Wallet preserves remaining WORK with a pending V8 listing", async ({ page }) => {
  await installWallet(page);
  await installApiFixtures(page, { pendingV8Listing: true });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator(".onboarding-pane").getByRole("button", { name: "Connect UniSat" }).click();
  await page.locator(".sidebar").getByRole("button", { name: /^Wallet/u }).click();
  const form = page.locator("#wallet-list");
  await expect(form.getByText("75,000.0000000000000000 WORK", { exact: true })).toBeVisible();
  await expect(form.getByRole("button", { name: "Create 25,000 proofs AMO intent" })).toBeEnabled();
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
});

for (const rate of ["0.35", "0.45", "0.12345678"]) {
  test(`AMO listing submits custom fee ${rate} and shares it with seal controls`, async ({ page }) => {
    await installWallet(page);
    await installApiFixtures(page, { pendingV8Listing: true });
    await openConnectedWallet(page);
    const form = page.locator("#wallet-list");
    const fee = form.locator("form").getByLabel("Fee proofs/vB");
    await fee.fill(rate);
    expect(await fee.evaluate(el => el.checkValidity())).toBe(true);
    await expect(form.getByLabel("Fee proofs/vB").last()).toHaveValue(rate);
    await form.locator("form").evaluate(el => {
      el.addEventListener("submit", event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        el.dataset.testSubmitted = "true";
      }, { capture: true });
    });
    await form.getByRole("button", { name: "Create 25,000 proofs AMO intent" }).click();
    await expect(form.locator("form")).toHaveAttribute("data-test-submitted", "true");
    await fee.fill("0.123456789");
    expect(await fee.evaluate(el => el.checkValidity())).toBe(false);
  });
}


for (const route of ["/?marketplace=1", "/?folder=marketplace"]) {
  test(`DNS AMO loads independently and never reports an unverified empty registry: ${route}`, async ({ page }) => {
    await installApiFixtures(page);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let dnsReads = 0;
    let dnsFailed = true;
    let dnsMalformed = false;
    await page.route("**/api/v1/dns*", async request => {
      dnsReads++;
      await gate;
      await request.fulfill({ status: dnsFailed ? 503 : 200, contentType: "application/json",
        body: JSON.stringify(dnsFailed ? {error:"DNS temporarily unavailable"} : dnsMalformed ? {records:[],listings:[]} : {
          records: [], listings: [], pendingEvents: [], activity: [], sales: [],
          coverage: {complete:true}, checkpointHash: HASH, indexedThroughBlock:960220, indexedAt:NOW,
        }) });
    });
    await page.goto(route);
    const tabs = page.getByLabel("AMO asset tabs");
    await tabs.getByRole("button", { name: /^DNS/ }).click();
    await expect(page.getByRole("heading", { name: "DNS loading", exact: true })).toBeVisible();
    await expect(tabs.getByRole("button", { name: /^DNS/ })).toContainText("—");
    await expect(page.getByText("No confirmed DNS records found yet.", {exact:true})).toHaveCount(0);
    expect(dnsReads).toBeGreaterThan(0);
    release();
    await expect(page.getByRole("heading", { name: "DNS unavailable", exact: true })).toBeVisible();
    await expect(page.getByText("No confirmed DNS records found yet.", {exact:true})).toHaveCount(0);
    dnsFailed = false;
    dnsMalformed = true;
    await page.getByRole("button", {name:"Refresh DNS",exact:true}).click();
    await expect(page.getByRole("heading", { name: "DNS unavailable", exact: true })).toBeVisible();
    await expect(page.getByText("No confirmed DNS records found yet.", {exact:true})).toHaveCount(0);
    dnsMalformed = false;
    await page.getByRole("button", {name:"Refresh DNS",exact:true}).click();
    await expect(page.getByText("No confirmed DNS records found yet.", {exact:true})).toBeVisible();
    await expect(tabs.getByRole("button", {name:/^DNS/})).toContainText("0");
  });
}

async function openActionRegistration(page, dns = false) {
  await installWallet(page); await installApiFixtures(page);
  await page.route("**/api/v1/ids/*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(registryState()) }));
  await page.route("**/api/v1/dns**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(registryState()) }));
  await page.goto(dns ? '/?dns-launch=1' : '/?id-launch=1');
  const connect = page.getByRole('button', { name: /Connect (UniSat|wallet)/ }).first();
  if (await connect.isVisible({ timeout: 1000 }).catch(() => false)) await connect.click();
  await expect(page.locator('.topbar-wallet-button')).toContainText('1BPVvi1G');
  const form = page.locator(dns ? '#dns-register' : '#id-register');
  await form.getByPlaceholder(dns ? 'alice' : 'user', { exact: true }).fill('reviewfixture');
  await form.getByLabel(dns ? 'Resolves to' : 'Receive address', { exact: true }).fill(RECIPIENT);
  await form.locator('button[type=submit]').click();
  return form;
}
for (const dns of [false, true]) {
  test(`Action review: ${dns ? 'DNS' : 'ID'} registration preserves task on cancel and rejected signing`, async ({ page }) => {
    const form = await openActionRegistration(page, dns);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible(); await expect(dialog).toContainText('1000 proofs');
    await expect(dialog).toContainText(RECIPIENT);
    expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
    await page.keyboard.press('Escape');
    await expect(form.getByPlaceholder(dns ? 'alice' : 'user', { exact: true })).toHaveValue('reviewfixture');
    await page.evaluate(() => { window.unisat.signPsbt = async () => { window.__mailComposeFixture.signCalls++; throw new Error('User rejected signing'); }; });
    await form.locator('button[type=submit]').click();
    await dialog.getByRole('button', { name: 'Continue to wallet' }).click();
    await expect(page.locator('.status-text')).toContainText('User rejected signing');
    await expect(form.getByPlaceholder(dns ? 'alice' : 'user', { exact: true })).toHaveValue('reviewfixture');
    expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(1);
  });
}

test('Action recovery retains unknown broadcast across reload and releases retry only on explicit dropped evidence', async ({ page }) => {
  const form = await openActionRegistration(page);
  await page.exposeFunction('fixtureFinalizeAction', hex => {
    const psbt = bitcoin.Psbt.fromHex(hex);
    for (let index = 0; index < psbt.inputCount; index++) psbt.updateInput(index, { finalScriptSig: bitcoin.script.compile([Buffer.alloc(72, 1), Buffer.alloc(33, 2)]) });
    return psbt.toHex();
  });
  await page.evaluate(() => { window.unisat.signPsbt = async hex => { window.__mailComposeFixture.signCalls++; return window.fixtureFinalizeAction(hex); }; });
  let broadcastCalls = 0; let state = 'unknown';
  await page.route('**/api/v1/broadcast/tx*', async route => { broadcastCalls++; await route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"fixture unavailable"}' }); });
  await page.route('**/api/v1/tx/*/status*', async route => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: route.request().url().includes(FUNDING_TXID) ? 'confirmed' : state }) });
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Continue to wallet' }).click();
  await expect(page.getByRole('region', { name: 'Transaction recovery' })).toContainText('Broadcast outcome unknown');
  await expect(form.getByPlaceholder('user', { exact: true })).toHaveValue('reviewfixture');
  await form.locator('button[type=submit]').click();
  await expect(page.locator('.status-text')).toContainText('earlier transaction');
  expect(broadcastCalls).toBe(1);
  await page.reload();
  const connect = page.getByRole('button', { name: /Connect (UniSat|wallet)/ }).first();
  if (await connect.isVisible({ timeout: 1000 }).catch(() => false)) await connect.click();
  await expect(page.locator('.topbar-wallet-button')).toContainText('1BPVvi1G');
  await expect(page.getByRole('region', { name: 'Transaction recovery' })).toContainText('reviewfixture');
  await revealActionRecovery(page);
  await page.getByRole('button', { name: 'Check transaction status' }).click();
  await expect(page.getByRole('region', { name: 'Transaction recovery' })).toContainText('Broadcast outcome unknown');
  state = 'dropped'; await page.getByRole('button', { name: 'Check transaction status' }).click();
  await expect(page.getByRole('region', { name: 'Transaction recovery' })).toContainText('Dropped transaction');
  await page.locator('.action-recovery-history > summary').click();
  await page.getByRole('button', { name: 'Restore task fields' }).click();
  await expect(page.locator('#id-register').getByPlaceholder('user', { exact: true })).toHaveValue('reviewfixture');
  expect(broadcastCalls).toBe(1);
});

const ACTION_RECOVERY_STORAGE_KEY = "proofofwork-action-receipts-v1";

function actionRecoveryReceipt(txid, overrides = {}) {
  return {
    address: SENDER,
    createdAt: NOW,
    fields: [["Listing transaction", txid], ["Asset", "WORK"]],
    key: `marketplace:${txid}`,
    network: "livenet",
    status: "pending",
    title: "Review marketplace seal publication",
    txid,
    ...overrides,
  };
}

async function seedActionRecovery(page, receipts) {
  await page.addInitScript(({ key, receipts }) => {
    // Reload must exercise persisted status changes, not reinstall the seed.
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify(receipts));
    }
  }, { key: ACTION_RECOVERY_STORAGE_KEY, receipts });
}

async function savedActionRecovery(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "[]"), ACTION_RECOVERY_STORAGE_KEY);
}

async function revealActionRecovery(page) {
  const region = page.getByRole("region", { name: "Transaction recovery" });
  const disclosure = region.locator(".action-recovery-disclosure");
  if (await disclosure.getAttribute("open") === null) {
    await disclosure.locator(":scope > summary").click();
  }
  return region;
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`Action recovery: Wallet keeps compact recovery below its header and retains resolved history at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installWallet(page);
    await installApiFixtures(page);
    const pending = actionRecoveryReceipt("a".repeat(64));
    const confirmed = actionRecoveryReceipt("b".repeat(64), { status: "confirmed" });
    const dropped = actionRecoveryReceipt("c".repeat(64), { status: "dropped" });
    const foreign = actionRecoveryReceipt("d".repeat(64), { address: RECIPIENT });
    const statusChecks = [];
    await seedActionRecovery(page, [pending, confirmed, dropped, foreign]);
    await page.route(`**/api/v1/tx/${pending.txid}/status*`, async route => {
      statusChecks.push(route.request().url());
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "pending" }) });
    });
    await openConnectedWallet(page);
    await expect.poll(() => statusChecks.length).toBeGreaterThan(0);
    const region = page.getByRole("region", { name: "Transaction recovery" });
    await expect(region).toBeVisible();
    await expect(region.locator(".action-recovery-disclosure > summary")).toContainText("1 unresolved");
    await expect(region.locator(".action-recovery-disclosure")).not.toHaveAttribute("open", "");
    await expect(region.getByText(pending.txid, { exact: true }).first()).not.toBeVisible();
    const headerBox = await page.locator(".app-header-stack").boundingBox();
    const recoveryBox = await region.boundingBox();
    expect(recoveryBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
    expect(await page.locator(".app-header-stack").evaluate(node => getComputedStyle(node).position)).toBe("sticky");
    expect(await page.locator(".app-header-stack + .action-recovery-panel + .app-status-row").evaluate(node => getComputedStyle(node).position)).toBe("sticky");
    expect(recoveryBox.height).toBeLessThan(160);
    expect(recoveryBox.x).toBeGreaterThanOrEqual(0);
    expect(recoveryBox.x + recoveryBox.width).toBeLessThanOrEqual(viewport.width + 1);

    await revealActionRecovery(page);
    await expect(region.getByText(pending.txid, { exact: true }).first()).toBeVisible();
    const history = region.locator(".action-recovery-history");
    await expect(history.locator(":scope > summary")).toHaveText("Resolved transaction history (2)");
    await expect(history).not.toHaveAttribute("open", "");
    await expect(history.getByText(confirmed.txid, { exact: true }).first()).not.toBeVisible();
    await expect(history.getByText(dropped.txid, { exact: true }).first()).not.toBeVisible();
    await history.locator(":scope > summary").click();
    await expect(history.getByText(confirmed.txid, { exact: true }).first()).toBeVisible();
    await expect(history.getByText(dropped.txid, { exact: true }).first()).toBeVisible();
    await expect(history).toContainText("Confirmed transaction");
    await expect(history).toContainText("Dropped transaction");
    await expect(region.getByText(foreign.txid, { exact: true })).toHaveCount(0);
    expect(await savedActionRecovery(page)).toEqual([pending, confirmed, dropped, foreign]);
    expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
  });
}

test("Action recovery: short Computer viewports keep recovery, header and status in document flow", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await installWallet(page);
  await installApiFixtures(page);
  const receipt = actionRecoveryReceipt("5".repeat(64));
  await seedActionRecovery(page, [receipt]);
  await page.route(`**/api/v1/tx/${receipt.txid}/status*`, route => route.fulfill({ contentType: "application/json", body: '{"status":"pending"}' }));
  await page.goto("/?folder=wallet");
  const connect = page.getByRole("button", { name: "Connect UniSat", exact: true }).first();
  if (await connect.isVisible({ timeout: 1000 }).catch(() => false)) await connect.click();
  await expect(page.locator(".topbar-wallet-button")).toContainText("1BPVvi1G");
  const region = page.getByRole("region", { name: "Transaction recovery" });
  await expect(region).toBeVisible();
  expect(await page.locator(".mail-app > .app-header-stack").evaluate(node => getComputedStyle(node).position)).toBe("static");
  expect(await page.locator(".mail-app > .app-header-stack + .action-recovery-panel + .app-status-row").evaluate(node => getComputedStyle(node).position)).toBe("static");
  const headerBox = await page.locator(".mail-app > .app-header-stack").boundingBox();
  const recoveryBox = await region.boundingBox();
  expect(recoveryBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
  await revealActionRecovery(page);
  await expect(region.getByText(receipt.txid, { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
});

test("Action recovery: checks every receipt beyond ten with two requests and coalesces Refresh", async ({ page }) => {
  await installWallet(page);
  await installApiFixtures(page);
  const unresolved = Array.from({ length: 12 }, (_, index) => actionRecoveryReceipt((index + 32).toString(16).padStart(64, "0"), {
    status: index % 2 ? "unknown" : "pending",
  }));
  const historical = [
    actionRecoveryReceipt("3".repeat(64), { status: "confirmed" }),
    actionRecoveryReceipt("4".repeat(64), { status: "dropped" }),
  ];
  const foreign = actionRecoveryReceipt("2".repeat(64), { address: RECIPIENT });
  const receipts = [...unresolved, ...historical, foreign];
  const targetTxids = new Set(unresolved.map(receipt => receipt.txid));
  let releaseStatus;
  const statusGate = new Promise(resolve => { releaseStatus = resolve; });
  const calls = [];
  let active = 0;
  let maximumActive = 0;
  await seedActionRecovery(page, receipts);
  await page.route("**/api/v1/tx/*/status*", async route => {
    const txid = new URL(route.request().url()).pathname.split("/")[4];
    if (!targetTxids.has(txid)) return route.fallback();
    calls.push(txid);
    active++;
    maximumActive = Math.max(maximumActive, active);
    await statusGate;
    await route.fulfill({ contentType: "application/json", body: '{"status":"confirmed"}' });
    active--;
  });
  await openConnectedWallet(page);
  await expect.poll(() => calls.length).toBe(2);
  const region = await revealActionRecovery(page);
  await expect(region.locator(".action-recovery-disclosure > summary")).toContainText("12 unresolved");
  await expect(region.locator(".action-recovery-content > .review-recovery")).toHaveCount(12);
  await page.locator(".topbar-refresh-button").click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(calls).toHaveLength(2);
  await expect(region).toHaveAttribute("aria-busy", "true");
  releaseStatus();
  await expect.poll(async () => (await savedActionRecovery(page)).filter(receipt => targetTxids.has(receipt.txid) && receipt.status === "confirmed").length).toBe(12);
  await expect(region).toHaveAttribute("aria-busy", "false");
  expect(calls).toHaveLength(12);
  expect(new Set(calls)).toEqual(targetTxids);
  expect(maximumActive).toBe(2);
  await expect(region.locator(".action-recovery-history > summary")).toHaveText("Resolved transaction history (14)");
  const saved = await savedActionRecovery(page);
  expect(saved).toHaveLength(receipts.length);
  for (const receipt of receipts) {
    expect(saved.find(item => item.txid === receipt.txid)).toEqual(targetTxids.has(receipt.txid) ? { ...receipt, status: "confirmed" } : receipt);
  }
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
});

test("Action recovery: entry automatically reconciles pending receipts into retained confirmed history", async ({ page }) => {
  await installWallet(page);
  await installApiFixtures(page);
  const receipt = actionRecoveryReceipt("e".repeat(64));
  let statusChecks = 0;
  await seedActionRecovery(page, [receipt]);
  await page.route(`**/api/v1/tx/${receipt.txid}/status*`, async route => {
    statusChecks++;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "confirmed" }) });
  });
  await openConnectedWallet(page);
  await expect.poll(async () => (await savedActionRecovery(page))[0]?.status).toBe("confirmed");
  expect(statusChecks).toBeGreaterThan(0);
  const region = await revealActionRecovery(page);
  await expect(region.locator(".action-recovery-disclosure > summary")).toContainText("0 unresolved");
  const history = region.locator(".action-recovery-history");
  await expect(history.locator(":scope > summary")).toHaveText("Resolved transaction history (1)");
  await expect(history.getByText(receipt.txid, { exact: true }).first()).not.toBeVisible();
  await history.locator(":scope > summary").click();
  await expect(history.getByText(receipt.txid, { exact: true }).first()).toBeVisible();
  await expect(history).toContainText("Confirmed transaction");
  expect(await savedActionRecovery(page)).toEqual([{ ...receipt, status: "confirmed" }]);
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
});

test("Action recovery: Wallet Refresh reconciles unresolved receipts without opening recovery or signing", async ({ page }) => {
  await installWallet(page);
  await installApiFixtures(page);
  const receipt = actionRecoveryReceipt("f".repeat(64));
  let status = "pending";
  let statusChecks = 0;
  await seedActionRecovery(page, [receipt]);
  await page.route(`**/api/v1/tx/${receipt.txid}/status*`, async route => {
    statusChecks++;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status }) });
  });
  await openConnectedWallet(page);
  await expect.poll(() => statusChecks).toBeGreaterThan(0);
  const region = page.getByRole("region", { name: "Transaction recovery" });
  await expect(region.locator(".action-recovery-disclosure > summary")).toContainText("1 unresolved");
  await expect(region.locator(".action-recovery-disclosure")).not.toHaveAttribute("open", "");
  const initialChecks = statusChecks;
  status = "confirmed";
  await page.locator(".topbar-refresh-button").click();
  await expect.poll(async () => (await savedActionRecovery(page))[0]?.status).toBe("confirmed");
  expect(statusChecks).toBeGreaterThan(initialChecks);
  await expect(region.locator(".action-recovery-disclosure > summary")).toContainText("0 unresolved");
  await expect(region.locator(".action-recovery-disclosure")).not.toHaveAttribute("open", "");
  await page.reload();
  await expect(page.getByRole("region", { name: "Transaction recovery" })).toContainText("Resolved transaction history (1)");
  expect(await savedActionRecovery(page)).toEqual([{ ...receipt, status: "confirmed" }]);
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
});

test("Action recovery: a late status response cannot update receipts after the wallet disconnects", async ({ page }) => {
  await installWallet(page);
  await installApiFixtures(page);
  const receipt = actionRecoveryReceipt("6".repeat(64));
  let statusStarted = false;
  let statusFinished = false;
  let releaseStatus;
  const statusGate = new Promise(resolve => { releaseStatus = resolve; });
  await seedActionRecovery(page, [receipt]);
  await page.route(`**/api/v1/tx/${receipt.txid}/status*`, async route => {
    statusStarted = true;
    await statusGate;
    await route.fulfill({ contentType: "application/json", body: '{"status":"confirmed"}' }).catch(() => {});
    statusFinished = true;
  });
  await openConnectedWallet(page);
  await expect.poll(() => statusStarted).toBe(true);
  await page.getByRole("button", { name: "Disconnect UniSat", exact: true }).click();
  await expect(page.locator(".topbar-wallet-button")).toContainText("Connect UniSat");
  releaseStatus();
  await expect.poll(() => statusFinished).toBe(true);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByRole("region", { name: "Transaction recovery" })).toHaveCount(0);
  expect(await savedActionRecovery(page)).toEqual([receipt]);
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
});

for (const status of ["unknown", "pending"]) {
  test(`Action recovery: unavailable status retains ${status} receipt and duplicate signing protection`, async ({ page }) => {
    await installWallet(page);
    await installApiFixtures(page);
    const receipt = actionRecoveryReceipt(status === "unknown" ? "7".repeat(64) : "8".repeat(64), {
      fields: [["ID", "reviewfixture"], ["Mail receiver", RECIPIENT]],
      key: "registerId:reviewfixture",
      status,
      title: "Review ID registration",
    });
    let statusChecks = 0;
    let broadcasts = 0;
    await seedActionRecovery(page, [receipt]);
    await page.route("**/api/v1/ids/*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(registryState()) }));
    await page.route(`**/api/v1/tx/${receipt.txid}/status*`, async route => {
      statusChecks++;
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Recovery status temporarily unavailable"}' });
    });
    await page.route("**/api/v1/broadcast/tx*", async route => {
      broadcasts++;
      await route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"Unexpected fixture broadcast"}' });
    });
    await page.goto("/?id-launch=1");
    const connect = page.getByRole("button", { name: "Connect UniSat", exact: true }).first();
    if (await connect.isVisible({ timeout: 1000 }).catch(() => false)) await connect.click();
    await expect(page.locator(".topbar-wallet-button")).toContainText("1BPVvi1G");
    await expect.poll(() => statusChecks).toBeGreaterThan(0);
    const initialChecks = statusChecks;
    await page.locator(".topbar-refresh-button").click();
    await expect.poll(() => statusChecks).toBeGreaterThan(initialChecks);
    expect(await savedActionRecovery(page)).toEqual([receipt]);
    const region = await revealActionRecovery(page);
    await expect(region.locator(".action-recovery-disclosure > summary")).toContainText("1 unresolved");
    await expect(region).toContainText(status === "unknown" ? "Broadcast outcome unknown" : "Pending confirmation");
    const form = page.locator("#id-register");
    await form.getByPlaceholder("user", { exact: true }).fill("reviewfixture");
    await form.getByLabel("Receive address", { exact: true }).fill(RECIPIENT);
    await form.locator("button[type=submit]").click();
    await expect(page.locator(".status-text")).toContainText("earlier transaction");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
    expect(broadcasts).toBe(0);
    expect(await savedActionRecovery(page)).toEqual([receipt]);
  });
}

for (const transfer of [false, true]) {
  test(`Action review: Computer ID ${transfer ? 'ownership transfer' : 'receiver update'} retains destinations on rejection`, async ({ page }) => {
    await installWallet(page); await installApiFixtures(page);
    const record = { id: 'ownedfixture', ownerAddress: SENDER, receiveAddress: SENDER, confirmed: true, network: 'livenet', txid: HASH, amountSats: 1000, createdAt: NOW };
    const state = { ...registryState(), records: [record], record };
    await page.route('**/api/v1/registry*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) }));
    await page.route('**/api/v1/ids/*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) }));
    await page.goto('/');
    await page.locator('.onboarding-pane').getByRole('button', { name: 'Connect UniSat' }).click();
    await page.locator('.sidebar').getByRole('button', { name: /^IDs/ }).click();
    const label = transfer ? 'New owner address or ID' : 'New receive address or ID';
    await page.getByLabel(label, { exact: true }).fill(RECIPIENT);
    await page.evaluate(() => { window.unisat.signPsbt = async () => { window.__mailComposeFixture.signCalls++; throw new Error('User rejected signing'); }; });
    await page.getByRole('button', { name: transfer ? 'Transfer ID' : 'Update Receiver', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('546 proofs'); await expect(dialog).toContainText(RECIPIENT);
    await dialog.getByRole('button', { name: 'Continue to wallet' }).click();
    await expect(page.locator('.status-text')).toContainText('User rejected signing');
    await expect(page.getByLabel(label, { exact: true })).toHaveValue(RECIPIENT);
  });
}
for (const computer of [false, true]) {
  test(`Action review: ${computer ? 'Computer' : 'standalone'} Wallet preserves exact Q16 WORK and cancels safely`, async ({ page }) => {
    await installWallet(page); await installApiFixtures(page);
    if (computer) {
      await page.goto('/'); await page.locator('.onboarding-pane').getByRole('button', { name: 'Connect UniSat' }).click();
      await page.locator('.sidebar').getByRole('button', { name: /^Wallet/ }).click();
    } else await openConnectedWallet(page);
    const form = page.locator('#wallet-send');
    await form.getByLabel('Amount', { exact: true }).fill('0.0000000000000001');
    await form.getByLabel('Recipient address', { exact: true }).fill(RECIPIENT);
    await form.getByRole('button', { name: 'Transfer credit', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('0.0000000000000001 WORK'); await expect(dialog).toContainText('546 proofs');
    await dialog.getByRole('button', { name: 'Back to task' }).click();
    await expect(form.getByLabel('Amount', { exact: true })).toHaveValue('0.0000000000000001');
    expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
  });
}

test('Action review fails closed on unavailable fresh registry and wallet context changes', async ({ page }) => {
  const form = await openActionRegistration(page);
  await page.route('**/api/v1/ids/*', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.getByRole('dialog').getByRole('button', { name: 'Continue to wallet' }).click();
  await expect(page.locator('.status-text')).toContainText('registry evidence is incomplete');
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
  await page.unroute('**/api/v1/ids/*');
  await page.route('**/api/v1/ids/*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(registryState()) }));
  await form.locator('button[type=submit]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => window.__mailComposeFixture.emit('accountsChanged'));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
});
for (const viewport of [{ width: 320, height: 180 }, { width: 768, height: 512 }, { width: 1440, height: 360 }]) {
  test(`Action review remains keyboard reachable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); const form = await openActionRegistration(page);
    const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    const approve = dialog.getByRole('button', { name: 'Continue to wallet' });
    await expect(approve).toBeFocused(); await expect(approve).toBeInViewport();
    expect((await approve.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/pow-batch4a-review-${viewport.width}x${viewport.height}.png` });
    await page.keyboard.press('Escape');
    await expect(form.getByPlaceholder('user', { exact: true })).toHaveValue('reviewfixture');
    expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
  });
}

test('Action recovery storage failure prevents broadcast after fixture signing', async ({ page }) => {
  await openActionRegistration(page);
  await page.exposeFunction('fixtureFinalizeStorageAction', hex => {
    const psbt = bitcoin.Psbt.fromHex(hex);
    for (let index = 0; index < psbt.inputCount; index++) psbt.updateInput(index, { finalScriptSig: bitcoin.script.compile([Buffer.alloc(72, 1), Buffer.alloc(33, 2)]) });
    return psbt.toHex();
  });
  await page.evaluate(() => {
    window.unisat.signPsbt = async hex => window.fixtureFinalizeStorageAction(hex);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'proofofwork-action-receipts-v1') throw new Error('Recovery storage unavailable'); return original.call(this, key, value); };
  });
  let calls = 0; await page.route('**/api/v1/broadcast/tx*', async route => { calls++; await route.abort(); });
  await page.getByRole('dialog').getByRole('button', { name: 'Continue to wallet' }).click();
  await expect(page.locator('.status-text')).toContainText('Recovery storage unavailable');
  expect(calls).toBe(0);
  await expect(page.locator('#id-register').getByPlaceholder('user', { exact: true })).toHaveValue('reviewfixture');
});

test('Action review rechecks confirmed funding before requesting a signature', async ({ page }) => {
  await openActionRegistration(page);
  await page.route(`**/api/v1/address/${SENDER}/utxo*`, route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.getByRole('dialog').getByRole('button', { name: 'Continue to wallet' }).click();
  await expect(page.locator('.status-text')).toContainText('Prepared funding changed');
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
});

test('Action review retains exact whole bond quantity beyond Number precision', async ({ page }) => {
  await installWallet(page); await installApiFixtures(page);
  const amount = '9007199254740993';
  const token = { ...workTokenDefinition(), ticker: 'POWB', tokenId: POWB_TOKEN_ID, txid: POWB_TOKEN_ID, decimals: 0, uncapped: true, maxSupply: null, mintAmount: '1', registryAddress: RECIPIENT };
  const state = { ...authoritativeWorkState(), tokens: [token], holders: [{ address: SENDER, ticker: 'POWB', tokenId: POWB_TOKEN_ID, balance: amount, pendingDelta: '0' }], hasMore: false, collectionHasMore: { tokens: false }, totalCounts: { tokens: 1 } };
  await page.route('**/api/v1/token?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) }));
  await page.route('**/api/v1/token-summary?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) }));
  await openConnectedWallet(page);
  const form = page.locator('#wallet-send');
  await form.getByRole('combobox', { name: 'Credit', exact: true }).selectOption(POWB_TOKEN_ID);
  await form.getByLabel('Amount', { exact: true }).fill(amount);
  await form.getByLabel('Recipient address', { exact: true }).fill(RECIPIENT);
  await form.getByRole('button', { name: 'Transfer credit', exact: true }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toContainText(amount + ' POWB');
  await page.evaluate(() => { window.unisat.signPsbt = async () => { window.__mailComposeFixture.signCalls++; throw new Error('User rejected signing'); }; });
  await dialog.getByRole('button', { name: 'Continue to wallet' }).click();
  await expect(page.locator('.status-text')).toContainText('User rejected signing');
  await expect(form.getByLabel('Amount', { exact: true })).toHaveValue(amount);
});

test('Action review checks funding again after signing and prevents an obsolete broadcast', async ({ page }) => {
  await openActionRegistration(page);
  let fundingAvailable = true;
  await page.route(`**/api/v1/address/${SENDER}/utxo*`, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(fundingAvailable ? [{ txid: FUNDING_TXID, vout: 0, value: 100000, status: { confirmed: true } }] : []) }));
  await page.exposeFunction('fixtureFinalizeStaleAction', hex => {
    fundingAvailable = false;
    const psbt = bitcoin.Psbt.fromHex(hex);
    for (let index = 0; index < psbt.inputCount; index++) psbt.updateInput(index, { finalScriptSig: bitcoin.script.compile([Buffer.alloc(72, 1), Buffer.alloc(33, 2)]) });
    return psbt.toHex();
  });
  await page.evaluate(() => { window.unisat.signPsbt = async hex => { window.__mailComposeFixture.signCalls++; return window.fixtureFinalizeStaleAction(hex); }; });
  let calls = 0; await page.route('**/api/v1/broadcast/tx*', async route => { calls++; await route.abort(); });
  await page.getByRole('dialog').getByRole('button', { name: 'Continue to wallet' }).click();
  await expect(page.locator('.status-text')).toContainText('Prepared funding changed');
  expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(1);
  expect(calls).toBe(0);
});

for (const [ticker, id, surface] of [['POWB', POWB_TOKEN_ID, 'infinity'], ['INCB', INCB_TOKEN_ID, 'inception']]) {
  for (const computer of [false, true]) for (const viewport of [
    { width: 320, height: 180 }, { width: 768, height: 512 },
    { width: 1280, height: 720 },
  ]) {
    test(`Action review: ${computer ? 'Computer' : 'standalone'} ${ticker} transfer opens before signing at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await installWallet(page); await installApiFixtures(page);
      const token = { ...workTokenDefinition(), ticker, tokenId: id, txid: id, decimals: 0, uncapped: true, maxSupply: null, mintAmount: '1', registryAddress: RECIPIENT };
      const state = { ...authoritativeWorkState(), tokens: [token], holders: [{ address: SENDER, ticker, tokenId: id, balance: '100', pendingDelta: '0' }], hasMore: false, collectionHasMore: { tokens: false }, totalCounts: { tokens: 1 } };
      await page.route('**/api/v1/token?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) }));
      await page.route('**/api/v1/token-summary?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) }));
      await page.goto(computer ? `/?folder=${surface}` : `/?${surface}=1`);
      const connect = page.getByRole('button', { name: /Connect (UniSat|wallet)/ }).first();
      if (await connect.isVisible({ timeout: 1000 }).catch(() => false)) await connect.click();
      await expect(page.locator('.topbar-wallet-button')).toContainText('1BPVvi1G');
      const form = page.locator('#wallet-send');
      await form.getByLabel('Amount', { exact: true }).fill('2');
      await form.getByLabel('Recipient address', { exact: true }).fill(RECIPIENT);
      const submit = form.locator('button[type=submit]').first();
      await submit.click();
      const bounds = await submit.boundingBox();
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      await expect(page.getByRole('dialog')).toContainText('2 ' + ticker);
      await page.getByRole('dialog').getByRole('button', { name: 'Back to task' }).click();
      await submit.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toContainText('2 ' + ticker);
      await page.getByRole('dialog').getByRole('button', { name: 'Back to task' }).click();
      expect(await page.evaluate(() => window.__mailComposeFixture.signCalls)).toBe(0);
    });
  }
}

const MARKET_PUBLIC_KEY = '02777b8fd3dc524694c52f2b505d14eacf289430f42b5785c48b7cb4948db8499b';
async function installMarketPublicKey(page) {
  await page.addInitScript(key => { window.unisat.getPublicKey = async () => key; }, MARKET_PUBLIC_KEY);
}
for (const computer of [false, true]) for (const dns of [false, true]) {
  test(`Marketplace review: ${computer ? 'Computer' : 'standalone AMO'} ${dns ? 'DNS' : 'ID'} listing cancels and retains rejected terms`, async ({ page }) => {
    test.setTimeout(25000);
    await installWallet(page); await installMarketPublicKey(page);
    const record = {id:'ownedfixture', ownerAddress:SENDER, receiveAddress:SENDER, confirmed:true, network:'livenet', txid:HASH, amountSats:1000, createdAt:NOW};
    const state = {...registryState(), records:[record], record, coverage:{complete:true}, indexedThroughBlock:960220, checkpointHash:HASH};
    await installApiFixtures(page, {marketRegistryState:state,remoteV8MarketListings:true});
    for (const path of ['**/api/v1/registry*', '**/api/v1/ids/*', '**/api/v1/dns*','**/api/v1/dns/**']) await page.route(path, route => route.fulfill({contentType:'application/json', body:JSON.stringify(state)}));
    await page.goto(computer ? '/?folder=marketplace' : '/?marketplace=1');
    const connect = page.getByRole('button',{name:/Connect (UniSat|wallet)/}).first();
    if (await connect.isVisible({timeout:1000}).catch(()=>false)) await connect.click();
    await expect(page.locator('.topbar-wallet-button')).toContainText('1BPVvi1G');
    await page.getByLabel('AMO asset tabs').getByRole('button',{name:dns ? /^DNS/ : /^IDs/}).click();
    await page.getByLabel('Seller price proofs',{exact:true}).fill('12345');
    await page.getByRole('button',{name:'Publish On-Chain',exact:true}).click();
    const review = page.getByRole('dialog');
    await expect(review).toContainText('12345 proofs'); await expect(review).toContainText('Seller-controlled ticket locked');
    await expect(review).toContainText('546 proofs');
    expect(await page.evaluate(()=>window.__mailComposeFixture.signCalls)).toBe(0);
    await review.getByRole('button',{name:'Back to task'}).click();
    await expect(page.getByLabel('Seller price proofs',{exact:true})).toHaveValue('12345');
    await page.evaluate(()=>{window.unisat.signPsbt=async()=>{window.__mailComposeFixture.signCalls++;throw new Error('User rejected marketplace signing');};});
    await page.getByRole('button',{name:'Publish On-Chain',exact:true}).click();
    await review.getByRole('button',{name:'Continue to wallet'}).click();
    await expect(page.getByText('User rejected marketplace signing',{exact:true}).first()).toBeVisible();
    await expect(page.getByLabel('Seller price proofs',{exact:true})).toHaveValue('12345');
    expect(await page.evaluate(()=>window.__mailComposeFixture.signCalls)).toBe(1);
  });
}
for(const viewport of [{width:320,height:180},{width:768,height:512}]) {
  test(`Marketplace review: WORK intent is estimated and keyboard reachable at ${viewport.width}×${viewport.height}`,async({page})=>{
    await page.setViewportSize(viewport); await installWallet(page); await installMarketPublicKey(page); await installApiFixtures(page,{pendingV8Listing:true});
    await openConnectedWallet(page);
    await page.locator('#wallet-list').getByRole('button',{name:'Create 25,000 proofs AMO intent'}).click();
    const review=page.getByRole('dialog'); await expect(review).toContainText('Derived and frozen only at confirmation');
    await expect(review).toContainText('25000 proofs'); await expect(review).toContainText('Seller-controlled ticket locked');
    expect(await page.evaluate(()=>window.__mailComposeFixture.signCalls)).toBe(0);
    for (let i=0;i<6;i++) await page.keyboard.press('Tab');
    expect(await review.evaluate(el=>el.contains(document.activeElement))).toBe(true);
    await page.screenshot({path:`/tmp/pow-batch4b-work-${viewport.width}x${viewport.height}.png`});
    await page.keyboard.press('Escape'); await expect(review).toHaveCount(0);
  });
}

async function openMarketWorkTicket(page, {computer=false, sealed=false, seller=SENDER, market=false}={}) {
  await installWallet(page); await installApiFixtures(page,{repairedV8Listing:true});
  const sellerPublicKey = seller === SENDER ? MARKET_PUBLIC_KEY : "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
  if (seller !== SENDER) seller = bitcoin.payments.p2pkh({pubkey:Buffer.from(sellerPublicKey,"hex")}).address;
  const tx=new bitcoin.Transaction(); tx.addInput(Buffer.alloc(32,7),0);
  tx.addOutput(bitcoin.address.toOutputScript(WORK_REGISTRY),546n);
  tx.addOutput(bitcoin.payments.embed({data:[Buffer.from('fixture listing')]}).output,0n);
  tx.addOutput(bitcoin.address.toOutputScript(seller),546n);
  const listing=v8AmoListing({listingId:tx.getId(),sealed,sellerAddress:seller});
  listing.saleAuthorization.sellerPublicKey=sellerPublicKey;
  listing.saleAuthorization.anchorScriptPubKey=Buffer.from(bitcoin.address.toOutputScript(seller)).toString('hex');
  if(sealed) listing.saleAuthorization.anchorSignature=Buffer.from(bitcoin.script.signature.encode(Buffer.alloc(64,1),131)).toString('hex');
  listing.displayEvidence.fullDetailPath=`/api/v1/token-history?kind=listings&projection=full&q=${listing.listingId}&listingId=${listing.listingId}`;
  const state=authoritativeWorkState({repairedV8Listing:true}); state.listings=[listing];state.invalidEvents=[];
  Object.assign(state,{indexedAt:NOW,snapshotId:LISTING_SNAPSHOT_ID,totalCounts:{listings:1}});
  state.canonicalWorkCapacities[0].reservations=[{amountSubatoms:listing.amountSubatoms,listingId:listing.listingId}];
  for(const path of ['**/api/v1/token?**','**/api/v1/token-summary?**']) await page.route(path,route=>route.fulfill({contentType:'application/json',body:JSON.stringify(state)}));
  await page.route(`**/api/v1/tx/${listing.listingId}/hex*`,route=>route.fulfill({contentType:'application/json',body:JSON.stringify({hex:tx.toHex()})}));
  await page.route(`**/api/v1/tx/${listing.listingId}/outspend/2*`,route=>route.fulfill({contentType:'application/json',body:'{"spent":false}'}));
  await page.route('**/api/v1/marketplace-summary**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({indexedAt:NOW,network:'livenet',registry:registryState(),summaryOnly:true,token:state,workFloor:workFloor()})}));
  await page.route('**/api/v1/token-history?**',async route=>{
    const url=new URL(route.request().url());
    if(url.searchParams.get('kind')!=='listings') return route.fallback();
    await route.fulfill({contentType:'application/json',body:JSON.stringify(completeListingHistoryPage({allListings:[listing]}))});
  });
  if(market){await page.goto(computer?'/?folder=marketplace':'/?marketplace=1');const connect=page.getByRole('button',{name:/Connect (UniSat|wallet)/}).first();if(await connect.isVisible({timeout:1000}).catch(()=>false))await connect.click();await page.getByLabel('AMO asset tabs').getByRole('button',{name:/^Credits/}).click();}
  else if(computer){await page.goto('/');await page.locator('.onboarding-pane').getByRole('button',{name:'Connect UniSat'}).click();await page.locator('.sidebar').getByRole('button',{name:/^Wallet/}).click();}
  else await openConnectedWallet(page);
  return {listing,state};
}
for(const computer of [false,true]){
  test(`Marketplace review: ${computer?'Computer':'standalone Wallet'} seller seal explains reusable signature and cancels before wallet`,async({page})=>{
    await openMarketWorkTicket(page,{computer});
    const row=page.locator('.token-list-item').filter({hasText:'25,000 proofs AMO unit'});
    await row.getByRole('button',{name:'Seal',exact:true}).click();
    const review=page.getByRole('dialog');await expect(review).toContainText('0.0000000752009741 WORK');
    await expect(review).toContainText('25546 proofs');await expect(review).toContainText('ANYONECANPAY');
    await expect(review).toContainText('does not broadcast');expect(await page.evaluate(()=>window.__mailComposeFixture.signCalls)).toBe(0);
    await review.getByRole('button',{name:'Back to task'}).click();
    await page.evaluate(()=>{window.unisat.signPsbt=async()=>{window.__mailComposeFixture.signCalls++;throw new Error('User rejected seller seal');};});
    await row.getByRole('button',{name:'Seal',exact:true}).click();await review.getByRole('button',{name:'Continue to wallet'}).click();
    await expect(page.locator('.status-text')).toContainText('User rejected seller seal');
    expect(await page.evaluate(()=>window.__mailComposeFixture.signCalls)).toBe(1);
  });
}
test('Marketplace review: changed ticket evidence blocks a reviewed seller signature',async({page})=>{
  const {listing}=await openMarketWorkTicket(page);
  await page.locator('.token-list-item').getByRole('button',{name:'Seal',exact:true}).click();
  const review=page.getByRole('dialog');await expect(review).toBeVisible();
  await page.route(`**/api/v1/tx/${listing.listingId}/outspend/2*`,route=>route.fulfill({contentType:'application/json',body:'{"spent":true}'}));
  await review.getByRole('button',{name:'Continue to wallet'}).click();
  await expect(page.locator('.status-text')).toContainText('already been spent');expect(await page.evaluate(()=>window.__mailComposeFixture.signCalls)).toBe(0);
});
test('Marketplace review: delisting returns the ticket and rechecks exact funding',async({page})=>{
  await openMarketWorkTicket(page);
  await page.locator('.token-list-item').getByRole('button',{name:'Delist',exact:true}).click();
  const review=page.getByRole('dialog');await expect(review).toContainText('Ticket value returned to seller');
  await expect(review).toContainText('0.0000000752009741 WORK');expect(await page.evaluate(()=>window.__mailComposeFixture.signCalls)).toBe(0);
  await page.route(`**/api/v1/address/${SENDER}/utxo*`,route=>route.fulfill({contentType:'application/json',body:'[]'}));
  await review.getByRole('button',{name:'Continue to wallet'}).click();await expect(page.locator('.status-text')).toContainText('Prepared funding changed');
  expect(await page.evaluate(()=>window.__mailComposeFixture.signCalls)).toBe(0);
});

for(const computer of [false,true]) test(`Marketplace review: ${computer?'Computer AMO':'standalone AMO'} purchase separates buyer funding and frozen ticket terms`,async({page})=>{
  await openMarketWorkTicket(page,{computer,market:true,sealed:true,seller:RECIPIENT});
  await page.getByRole('button',{name:'Buy',exact:true}).click();
  const review=page.getByRole('dialog');await expect(review).toContainText('0.0000000752009741 WORK');await expect(review).toContainText('Seller price plus returned ticket value');
  await expect(review).toContainText('25546 proofs');await expect(review).toContainText('Frozen WORK terms never reprice');
  const fields=await review.locator('.review-total').innerText();
  const minerFee = BigInt((await review.locator('dt').filter({hasText:/^Miner fee$/}).locator('..').locator('dd code').innerText()).replace(' proofs',''));
  expect(fields).toContain(`${25000n + 546n + minerFee} proofs`);
  expect(await page.evaluate(()=>window.__mailComposeFixture.signCalls)).toBe(0);
  await review.getByRole('button',{name:'Back to task'}).click();
  await expect(page.getByRole('button',{name:'Buy',exact:true})).toBeEnabled();
});


test('Marketplace review: unavailable ticket spend evidence stops signing', async ({page}) => {
  const {listing} = await openMarketWorkTicket(page);
  await page.locator('#wallet-list').getByRole('button',{name:'Delist',exact:true}).click();
  const review = page.getByRole('dialog'); await expect(review).toBeVisible();
  await page.route(`**/api/v1/tx/${listing.listingId}/outspend/2*`,route=>route.fulfill({contentType:'application/json',body:'{}'}));
  await review.getByRole('button',{name:'Continue to wallet'}).click();
  await expect(page.getByText('Sale ticket availability cannot be confirmed. Refresh and review again.',{exact:true}).first()).toBeVisible();
  expect(await page.evaluate(()=>window.__mailComposeFixture.signCalls)).toBe(0);
});

test('Marketplace review: unknown WORK intent broadcast retains recovery after reload', async ({page}) => {
  await installWallet(page); await installMarketPublicKey(page); await installApiFixtures(page,{pendingV8Listing:true});
  await openConnectedWallet(page);
  await page.exposeFunction('fixtureFinalizeMarket', hex => {
    const psbt=bitcoin.Psbt.fromHex(hex);
    for(let index=0; index<psbt.inputCount; index++) psbt.updateInput(index,{finalScriptSig:bitcoin.script.compile([Buffer.alloc(72,1),Buffer.alloc(33,2)])});
    return psbt.toHex(); // Structurally finalized fixture; no real broadcast.
  });
  await page.evaluate(()=>{window.unisat.signPsbt=async hex=>{window.__mailComposeFixture.signCalls++;return window.fixtureFinalizeMarket(hex);};});
  let calls=0;
  await page.route('**/api/v1/broadcast/tx*',route=>{calls++;return route.fulfill({status:400,contentType:'application/json',body:'{"error":"fixture unavailable"}'});});
  const create=page.locator('#wallet-list').getByRole('button',{name:'Create 25,000 proofs AMO intent'});
  await create.click();await page.getByRole('dialog').getByRole('button',{name:'Continue to wallet'}).click();
  await expect(page.getByRole('region',{name:'Transaction recovery'})).toContainText('Broadcast outcome unknown');
  await create.click();await expect(page.locator('.status-text')).toContainText('earlier transaction');expect(calls).toBe(1);
  const retainedTxid = (await savedActionRecovery(page))[0].txid;
  await page.route(`**/api/v1/tx/${retainedTxid}/status*`, route => route.fulfill({ contentType: 'application/json', body: '{"status":"unknown"}' }));
  await page.reload();await expect(page.getByRole('region',{name:'Transaction recovery'})).toContainText('WORK');
  await revealActionRecovery(page);
  await expect(page.getByRole('region',{name:'Transaction recovery'}).getByRole('link',{name:'the appropriate workspace'})).toHaveAttribute('href', /marketplace|amo/);
  expect(calls).toBe(1);
});

test('Marketplace review: seller authorization leads to a separate seal publication review', async ({page}) => {
  await openMarketWorkTicket(page);
  await page.exposeFunction('fixtureAuthorizeMarket', hex => {
    const psbt=bitcoin.Psbt.fromHex(hex);
    psbt.updateInput(0,{partialSig:[{pubkey:Buffer.from(MARKET_PUBLIC_KEY,'hex'),signature:bitcoin.script.signature.encode(Buffer.alloc(64,1),131)}]});
    return psbt.toHex(); // Structural signature fixture; never broadcast.
  });
  await page.evaluate(()=>{window.unisat.signPsbt=async hex=>{window.__mailComposeFixture.signCalls++;return window.fixtureAuthorizeMarket(hex);};});
  let broadcasts=0;
  await page.route('**/api/v1/broadcast/tx*',route=>{broadcasts++;return route.fulfill({status:400,body:'fixture blocked'});});
  await page.locator('#wallet-list').getByRole('button',{name:'Seal',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Continue to wallet'}).click();
  const publication=page.getByRole('dialog',{name:'Review marketplace seal publication'});
  await expect(publication).toBeVisible(); await expect(publication).toContainText('Registry payment to publish seal');
  expect(await page.evaluate(()=>window.__mailComposeFixture.signCalls)).toBe(1);
  await publication.getByRole('button',{name:'Back to task'}).click();expect(broadcasts).toBe(0);
});
