import {
  ChangeEvent,
  CSSProperties,
  FormEvent,
  MouseEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as bitcoin from "bitcoinjs-lib";
import { Buffer } from "buffer";
import {
  Archive,
  AtSign,
  ArrowLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FilePenLine,
  FileText,
  GitBranch,
  Inbox,
  LogOut,
  Mail,
  MessageCircle,
  MessageSquareQuote,
  Monitor,
  Paperclip,
  PenLine,
  FolderPlus,
  RefreshCw,
  Reply,
  Search,
  Send,
  Star,
  Tag,
  Trash2,
  TrendingUp,
  Upload,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";
import * as ecc from "@bitcoinerlab/secp256k1";
import {
  BROWSER_APP_URL,
  COMPUTER_APP_URL,
  DESKTOP_APP_URL,
  GROWTH_APP_URL,
  HOME_APP_URL,
  ID_APP_URL,
  LOCAL_BROWSER_APP_URL,
  LOCAL_COMPUTER_APP_URL,
  LOCAL_DESKTOP_APP_URL,
  LOCAL_GROWTH_APP_URL,
  LOCAL_ID_APP_URL,
  LOCAL_LOG_APP_URL,
  LOCAL_MARKETPLACE_APP_URL,
  LOCAL_TOKEN_APP_URL,
  LOCAL_WALLET_APP_URL,
  LOCAL_WORK_TOKEN_APP_URL,
  LOG_APP_URL,
  MARKETPLACE_APP_URL,
  TOKEN_APP_URL,
  WALLET_APP_URL,
  WORK_TOKEN_APP_URL,
} from "./app/appLinks";
import {
  appHref,
  isActivityRoute,
  isBrowserRoute,
  isDesktopRoute,
  isGrowthRoute,
  isIdLaunchRoute,
  isLandingRoute,
  isLocalPreviewHost,
  isMarketplaceRoute,
  isRushRoute,
  isTokenRoute,
  isWalletRoute,
  isWorkTokenRoute,
} from "./app/routeRegistry";
import { BrowserNetworkTabs } from "./shared/components/BrowserNetworkTabs";
import {
  CHAINED_MINT_BROADCAST_STRATEGY,
  CHAINED_MINT_MAX_COUNT,
  executeChainedMintRun,
} from "./chained-mint";
import { LandingApp } from "./features/landing/LandingApp";
import { RushApp } from "./features/rush/RushApp";
import {
  buildRushMintPayload,
  emptyRushState,
  RUSH_CHAINED_MINT_DEFAULT_COUNT,
  RUSH_CHAINED_MINT_DEFAULT_DELAY_MS,
  RUSH_CHAINED_MINT_MAX_COUNT,
  RUSH_CHAINED_MINT_MAX_DELAY_MS,
  RUSH_MAX_REWARDED_MINTS,
  RUSH_MINT_PRICE_SATS,
  RUSH_PROTOCOL_PREFIX,
  formatRushUnits,
  rushPhaseForOrdinal,
  rushRegistryAddressForNetwork,
  rushRewardForOrdinal,
  rushRewardUnitsForOrdinal,
  rushStatsFromMints,
  type RushMintRecord,
  type RushState,
} from "./features/rush/rushProtocol";
import { AppHeader } from "./shared/components/AppHeader";
import {
  AppStatusRow,
  type AppStatusTone,
} from "./shared/components/AppStatusRow";
import { FeeRateControl } from "./shared/components/FeeRateControl";
import { ProgressBar } from "./shared/components/ProgressBar";
import { SocialFooter } from "./shared/components/SocialFooter";
import {
  explorerAddressUrl,
  explorerTxUrl,
} from "./shared/bitcoin/networks";
import { MAX_DATA_CARRIER_BYTES } from "./shared/bitcoin/protocolLimits";
import {
  fetchProofApiJson,
  proofApiUrl,
} from "./shared/api/proofApiClient";
import {
  base64FromBase64Url,
  base64UrlDecodeBytes,
  base64UrlEncodeBytes,
  base64UrlFromBase64,
  byteLength,
  bytesToHex,
  chunkAscii,
  chunkUtf8,
  decodeTextBase64Url,
  encodeTextBase64Url,
  sha256Hex,
} from "./shared/utils/encoding";
import {
  dustFeeAbsorptionCanceledText,
  errorMessage,
  formatBytes,
  formatDate,
  isPlainRecord,
  normalizeSearchQuery,
  normalizeSubject,
  satsToUsd,
  searchIncludes,
  shortAddress,
  tokenSatsPerUnit,
  tokenRouteTarget,
  tokenUsd,
} from "./functions";

bitcoin.initEccLib(ecc);

const globalWithBuffer = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer;
};
if (!globalWithBuffer.Buffer) {
  globalWithBuffer.Buffer = Buffer;
}

type BitcoinNetwork = "livenet" | "testnet" | "testnet4";
type LegacyBitcoinNetwork = "livenet" | "testnet";
type UniSatChain = "BITCOIN_MAINNET" | "BITCOIN_TESTNET" | "BITCOIN_TESTNET4";
type UniSatEvent = "accountsChanged" | "networkChanged" | "chainChanged";
type StatusTone = AppStatusTone;
type Folder =
  | "inbox"
  | "incoming"
  | "sent"
  | "outbox"
  | "drafts"
  | "favorites"
  | "archive"
  | "files"
  | "desktop"
  | "browser"
  | "ids"
  | "marketplace"
  | "token"
  | "wallet"
  | "work"
  | "log"
  | "contacts"
  | "custom";

const COMPUTER_ROUTE_FOLDERS: Folder[] = [
  "inbox",
  "incoming",
  "sent",
  "outbox",
  "drafts",
  "favorites",
  "archive",
  "files",
  "desktop",
  "browser",
  "ids",
  "marketplace",
  "token",
  "wallet",
  "work",
  "log",
  "contacts",
];

const STANDALONE_ROUTE_PARAMS = [
  "landing",
  "id-launch",
  "desktop",
  "browser",
  "marketplace",
  "token",
  "wallet",
  "work",
  "rush",
  "log",
  "growth",
];

function computerFolderFromSearch() {
  if (typeof window === "undefined") {
    return undefined;
  }

  const folder = new URLSearchParams(window.location.search).get("folder");
  return folder && COMPUTER_ROUTE_FOLDERS.includes(folder as Folder)
    ? (folder as Folder)
    : undefined;
}
type SortMode =
  | "value"
  | "newest"
  | "oldest"
  | "thread"
  | "largest"
  | "filetype"
  | "sender";
type FileFilter = "all" | "image" | "pdf" | "document" | "other";
type BroadcastStatus = "pending" | "confirmed" | "dropped" | "unknown";
type BroadcastSource = "mempool" | "node" | "slipstream" | "wallet";
type BroadcastStrategy = "mempool" | "first-party-if-multiple-op-return";

type TransactionBroadcastResult = {
  opReturnCount: number;
  source: BroadcastSource;
  txid: string;
  url?: string;
};
type MailAttachment = {
  name: string;
  mime: string;
  size: number;
  sha256: string;
  data: string;
};

type AttachmentPreviewKind =
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "text"
  | "unsupported";

type MailRecipient = {
  address: string;
  amountSats: number;
  display: string;
  id?: string;
};

type DraftMessage = {
  network: BitcoinNetwork;
  from: string;
  recipient: string;
  ccRecipient?: string;
  amountSats: number;
  feeRate: number;
  subject?: string;
  memo: string;
  attachment?: MailAttachment;
  parentTxid?: string;
  updatedAt: string;
};

type MailPreference = {
  archived?: boolean;
  favorite?: boolean;
  folders?: string[];
};

type MailPreferences = Record<string, MailPreference>;

type CustomFolderRecord = {
  id: string;
  name: string;
  createdAt: string;
};

type ContactRecord = {
  network: BitcoinNetwork;
  name: string;
  address: string;
  powId?: string;
  source: "manual" | "registry";
  createdAt: string;
  updatedAt: string;
};

type DesktopProfile = {
  address: string;
  label: string;
  loadedAt: string;
  network: BitcoinNetwork;
  query: string;
  resolvedId?: string;
};

type BrowserPage = {
  amountSats: number;
  attachment: MailAttachment;
  confirmed: boolean;
  createdAt: string;
  html: string;
  network: BitcoinNetwork;
  protocolBytes: number;
  sender: string;
  source: "attachment" | "message";
  txid: string;
};

type LocalBackupPayload = {
  app: "ProofOfWork.Me";
  version: 1;
  exportedAt: string;
  data: Record<string, string>;
};

type UnisatWallet = {
  requestAccounts?: () => Promise<string[]>;
  getAccounts?: () => Promise<string[]>;
  getChain?: () => Promise<{ enum?: string; network?: string }>;
  getNetwork?: () => Promise<string>;
  getPublicKey?: () => Promise<string>;
  disconnect?: () => Promise<void>;
  switchChain?: (
    chain: UniSatChain,
  ) => Promise<{ enum?: string; network?: string }>;
  switchNetwork?: (network: LegacyBitcoinNetwork) => Promise<string>;
  on?: (event: UniSatEvent, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: UniSatEvent,
    listener: (...args: unknown[]) => void,
  ) => void;
  signMessage?: (message: string, type?: string) => Promise<string>;
  sendBitcoin?: (
    toAddress: string,
    satoshis: number,
    options?: {
      feeRate?: number;
      memo?: string;
      memos?: string[];
    },
  ) => Promise<string>;
  signPsbt?: (
    psbtHex: string,
    options?: {
      autoFinalized?: boolean;
      toSignInputs?: Array<{
        index: number;
        address?: string;
        publicKey?: string;
        sighashTypes?: number[];
        disableTweakSigner?: boolean;
        useTweakedSigner?: boolean;
      }>;
    },
  ) => Promise<string>;
  pushPsbt?: (psbtHex: string) => Promise<string>;
};

type SentMessage = {
  txid: string;
  network: BitcoinNetwork;
  from: string;
  to: string;
  recipients?: MailRecipient[];
  toRecipients?: MailRecipient[];
  ccRecipients?: MailRecipient[];
  amountSats: number;
  feeRate: number;
  subject?: string;
  memo: string;
  attachment?: MailAttachment;
  status?: BroadcastStatus;
  lastCheckedAt?: string;
  confirmedAt?: string;
  droppedAt?: string;
  replyTo: string;
  parentTxid?: string;
  createdAt: string;
};

type BroadcastCheckResult = {
  from: string;
  network: BitcoinNetwork;
  status?: BroadcastStatus;
  txid: string;
};

type BroadcastCheckSummary = {
  checkedAt: string;
  confirmed: number;
  dropped: number;
  failed: number;
  pending: number;
  results: BroadcastCheckResult[];
};

type InboxMessage = {
  txid: string;
  network: BitcoinNetwork;
  from: string;
  to: string;
  recipients?: MailRecipient[];
  amountSats: number;
  subject?: string;
  memo: string;
  attachment?: MailAttachment;
  replyTo: string;
  parentTxid?: string;
  confirmed: boolean;
  createdAt: string;
};

type PowIdRecord = {
  id: string;
  ownerAddress: string;
  receiveAddress: string;
  pgpKey?: string;
  txid: string;
  network: BitcoinNetwork;
  amountSats: number;
  confirmed: boolean;
  createdAt: string;
};

type PowIdPendingEvent = {
  amountSats: number;
  createdAt: string;
  currentOwnerAddress?: string;
  currentReceiveAddress?: string;
  id?: string;
  inputAddresses: string[];
  kind: "update" | "transfer" | "marketTransfer" | "list" | "seal" | "delist";
  listingId?: string;
  network: BitcoinNetwork;
  ownerAddress?: string;
  priceSats?: number;
  receiveAddress?: string;
  sellerAddress?: string;
  transferVersion?: PowIdMarketplaceTransferVersion;
  txid: string;
};

type PowIdMarketplaceSale = {
  amountSats: number;
  buyerAddress: string;
  confirmed: boolean;
  createdAt: string;
  id: string;
  listingId?: string;
  network: BitcoinNetwork;
  priceSats: number;
  receiveAddress: string;
  sellerAddress: string;
  transferVersion?: PowIdMarketplaceTransferVersion;
  txid: string;
};

type PowTokenDefinition = {
  confirmed: boolean;
  confirmedMints?: number;
  confirmedSupply?: number;
  createdAt: string;
  creatorAddress: string;
  creationFeeSats: number;
  dataBytes?: number;
  holderCount?: number;
  lastSalePricePerToken?: number;
  lowestAskPricePerToken?: number;
  maxSupply: number;
  mintAmount: number;
  mintPriceSats: number;
  network: BitcoinNetwork;
  openListings?: number;
  pendingMints?: number;
  pendingSupply?: number;
  registryAddress: string;
  ticker: string;
  tokenId: string;
  transferCount?: number;
  txid: string;
};

type PowTokenMint = {
  amount: number;
  confirmed: boolean;
  createdAt: string;
  dataBytes?: number;
  minterAddress: string;
  network: BitcoinNetwork;
  paidSats: number;
  registryAddress: string;
  ticker: string;
  tokenId: string;
  txid: string;
};

type PowTokenTransfer = {
  amount: number;
  confirmed: boolean;
  createdAt: string;
  dataBytes?: number;
  network: BitcoinNetwork;
  paidSats: number;
  recipientAddress: string;
  registryAddress: string;
  senderAddress: string;
  ticker: string;
  tokenId: string;
  txid: string;
};

type PowTokenSaleAuthorizationDraft = {
  amount: number;
  anchorScriptPubKey: string;
  anchorSigHashType: number;
  anchorType: string;
  anchorValueSats: number;
  anchorVout: number;
  buyerAddress: string;
  expiresAt: string;
  network: BitcoinNetwork;
  nonce: string;
  priceSats: number;
  registryAddress: string;
  sellerAddress: string;
  sellerPublicKey: string;
  ticker: string;
  tokenId: string;
  version: string;
};

type PowTokenSaleAuthorization = PowTokenSaleAuthorizationDraft & {
  anchorSignature: string;
  anchorTxid: string;
};

type PowTokenListing = {
  amount: number;
  confirmed: boolean;
  createdAt: string;
  dataBytes?: number;
  listingId: string;
  network: BitcoinNetwork;
  priceSats: number;
  registryAddress: string;
  saleAuthorization: PowTokenSaleAuthorization;
  sealTxid?: string;
  sellerAddress: string;
  ticker: string;
  tokenId: string;
};

type PowTokenClosedListing = PowTokenListing & {
  closedAt?: string;
  closedConfirmed?: boolean;
  closedTxid?: string;
  closedVin?: number;
};

type PowTokenSale = {
  amount: number;
  buyerAddress: string;
  confirmed: boolean;
  createdAt: string;
  listingId: string;
  network: BitcoinNetwork;
  paidSats: number;
  priceSats: number;
  registryAddress: string;
  sellerAddress: string;
  ticker: string;
  tokenId: string;
  txid: string;
};

type MarketplacePurchaseReceipt = {
  amountLabel: string;
  assetLabel: string;
  buyerAddress: string;
  kind: "id" | "token";
  listingId: string;
  network: BitcoinNetwork;
  priceSats: number;
  sellerAddress: string;
  txid: string;
};

type TokenMarketPricePoint = {
  confirmed: boolean;
  createdAt: string;
  kind: "ask" | "mint" | "sale";
  label: string;
  priceSats: number;
};

type PowTokenHolder = {
  address: string;
  balance: number;
};

type PowTokenState = {
  closedListings: PowTokenClosedListing[];
  creationSats: number;
  confirmedSupply: number;
  holders: PowTokenHolder[];
  listings: PowTokenListing[];
  mints: PowTokenMint[];
  pendingSupply: number;
  sales: PowTokenSale[];
  summaryOnly?: boolean;
  transfers: PowTokenTransfer[];
  tokens: PowTokenDefinition[];
};

type PowTokenSupplyState = Pick<
  PowTokenState,
  "creationSats" | "confirmedSupply" | "pendingSupply" | "tokens"
>;

type PowTokenWalletBalance = {
  confirmedBalance: number;
  pendingIncoming: number;
  pendingOutgoing: number;
  token: PowTokenDefinition;
};

type PowIdMarketplaceStats = {
  confirmedSales: number;
  confirmedVolumeSats: number;
  pendingSales: number;
  pendingVolumeSats: number;
  totalSales: number;
  totalVolumeSats: number;
};

type PowActivityKind =
  | "id-register"
  | "id-update"
  | "id-transfer"
  | "id-list"
  | "id-seal"
  | "id-delist"
  | "id-buy"
  | "mail"
  | "reply"
  | "file"
  | "token-create"
  | "token-mint"
  | "token-listing"
  | "token-listing-closed"
  | "token-sale"
  | "token-transfer"
  | "rush-mint";

type PowActivityItem = {
  amountSats?: number;
  actor?: string;
  blockHeight?: number;
  confirmed: boolean;
  counterparty?: string;
  createdAt: string;
  dataBytes?: number;
  description: string;
  detail?: string;
  id?: string;
  kind: PowActivityKind;
  listingId?: string;
  network: BitcoinNetwork;
  tags: string[];
  title: string;
  txid: string;
  utxo?: string;
};

type PowActivityStats = {
  addresses?: number;
  confirmed?: number;
  dataBytes?: number;
  files?: number;
  indexedThroughBlock?: number;
  messages?: number;
  pending?: number;
  registry?: number;
  total?: number;
};

type PowIdListingVersion = "list2" | "list3" | "list4" | "list5";

type PowIdMarketplaceTransferVersion = "buy2" | "buy3" | "buy4" | "buy5";

type PowIdDelistingVersion = "delist2" | "delist3" | "delist4" | "delist5";

type PowIdSpentOutpoint = {
  txid: string;
  vout: number;
};

type PowIdPaymentSnapshot = {
  address: string;
  amountSats: number;
};

type PowIdListing = {
  amountSats: number;
  anchorSigHashType?: number;
  anchorSignature?: string;
  anchorScriptPubKey?: string;
  anchorTxid?: string;
  anchorType?: string;
  anchorValueSats?: number;
  anchorVout?: number;
  buyerAddress?: string;
  confirmed: boolean;
  createdAt: string;
  expiresAt?: string;
  id: string;
  listingId: string;
  listingVersion?: PowIdListingVersion;
  network: BitcoinNetwork;
  priceSats: number;
  receiveAddress?: string;
  saleAuthorization: PowIdSaleAuthorization;
  sealTxid?: string;
  sellerAddress: string;
  sellerPublicKey?: string;
  txid: string;
};

type PowIdSaleAuthorizationDraft = {
  anchorSigHashType?: number;
  anchorSignature?: string;
  anchorScriptPubKey?: string;
  anchorTxid?: string;
  anchorType?: string;
  anchorValueSats?: number;
  anchorVout?: number;
  buyerAddress?: string;
  expiresAt?: string;
  id: string;
  nonce: string;
  priceSats: number;
  receiveAddress?: string;
  sellerAddress: string;
  sellerPublicKey?: string;
  version: "pwid-sale-v1" | "pwid-sale-v2" | "pwid-sale-v3" | "pwid-sale-v4";
};

type PowIdSaleAuthorization = PowIdSaleAuthorizationDraft & {
  signature?: string;
};

type PowIdChainOrder = {
  blockHeight?: number;
  blockIndex?: number;
  dataBytes: number;
};

type PowIdEvent = PowIdChainOrder &
  (
    | {
        amountSats: number;
        confirmed: boolean;
        createdAt: string;
        id: string;
        inputAddresses: string[];
        kind: "register";
        network: BitcoinNetwork;
        ownerAddress: string;
        pgpKey?: string;
        receiveAddress: string;
        txid: string;
      }
    | {
        amountSats: number;
        confirmed: boolean;
        createdAt: string;
        id: string;
        inputAddresses: string[];
        kind: "update";
        network: BitcoinNetwork;
        receiveAddress: string;
        txid: string;
      }
    | {
        amountSats: number;
        confirmed: boolean;
        createdAt: string;
        id: string;
        inputAddresses: string[];
        kind: "transfer";
        network: BitcoinNetwork;
        ownerAddress: string;
        receiveAddress: string;
        txid: string;
      }
    | {
        amountSats: number;
        confirmed: boolean;
        createdAt: string;
        id?: string;
        inputAddresses: string[];
        kind: "marketTransfer";
        listingId?: string;
        network: BitcoinNetwork;
        ownerAddress: string;
        paymentOutputs: PowIdPaymentSnapshot[];
        priceSats?: number;
        receiveAddress: string;
        saleAuthorization?: PowIdSaleAuthorization;
        sellerAddress?: string;
        spentOutpoints: PowIdSpentOutpoint[];
        transferVersion: PowIdMarketplaceTransferVersion;
        txid: string;
      }
    | {
        amountSats: number;
        confirmed: boolean;
        createdAt: string;
        id: string;
        inputAddresses: string[];
        kind: "list";
        listingAnchorPresent: boolean;
        listingVersion: PowIdListingVersion;
        network: BitcoinNetwork;
        priceSats: number;
        saleAuthorization: PowIdSaleAuthorization;
        sellerAddress: string;
        txid: string;
      }
    | {
        amountSats: number;
        confirmed: boolean;
        createdAt: string;
        inputAddresses: string[];
        kind: "seal";
        listingId: string;
        network: BitcoinNetwork;
        saleAuthorization: PowIdSaleAuthorization;
        spentOutpoints: PowIdSpentOutpoint[];
        txid: string;
      }
    | {
        amountSats: number;
        confirmed: boolean;
        createdAt: string;
        delistingVersion: PowIdDelistingVersion;
        inputAddresses: string[];
        kind: "delist";
        listingId: string;
        network: BitcoinNetwork;
        spentOutpoints: PowIdSpentOutpoint[];
        txid: string;
      }
  );

type RecipientResolution = {
  displayRecipient: string;
  error?: string;
  id?: string;
  isId: boolean;
  paymentAddress: string;
  record?: PowIdRecord;
};

type PowIdOwnerResolution = {
  displayRecipient: string;
  error?: string;
  id?: string;
  isId: boolean;
  ownerAddress: string;
  receiveAddress: string;
  record?: PowIdRecord;
};

type MultiRecipientResolution = {
  duplicateCount: number;
  error?: string;
  idCount: number;
  recipients: RecipientResolution[];
};

type MailMessage =
  | (InboxMessage & {
      folder: "inbox";
    })
  | (InboxMessage & {
      folder: "incoming";
    })
  | (SentMessage & {
      folder: "sent";
    });
type FileSurfaceMessage = MailMessage & {
  attachment: MailAttachment;
};

type ProtocolMessage = {
  memo: string;
  subject?: string;
  attachment?: MailAttachment;
  parentTxid?: string;
  replyTo?: string;
};

type AttachmentAccumulator = {
  chunks: string[];
  mime: string;
  name: string;
  sha256: string;
  size: number;
  total: number;
};

type MempoolUtxo = {
  txid: string;
  vout: number;
  value: number;
  status?: {
    confirmed?: boolean;
  };
};

type UtxoSelection = {
  dustFeeSats: number;
  selected: MempoolUtxo[];
  feeSats: number;
  changeSats: number;
};

type PaymentOutputSpec = {
  address?: string;
  amountSats: number;
  script?: Uint8Array;
};

type ChainedMintInput = {
  previousOutput?: bitcoin.Transaction["outs"][number];
  previousTxHex?: string;
  script?: Uint8Array;
  txid: string;
  value: number;
  vout: number;
};

type ChainedMintBuildResult = {
  dustFeeSats: number;
  feeSats: number;
  inputCount: number;
  nextInput?: ChainedMintInput;
  psbtHex: string;
};

type PowRegistryApiResponse = {
  activity?: PowActivityItem[];
  listings?: PowIdListing[];
  pendingEvents?: PowIdPendingEvent[];
  records?: PowIdRecord[];
  sales?: PowIdMarketplaceSale[];
};

type PowRegistryState = {
  activity: PowActivityItem[];
  listings: PowIdListing[];
  pendingEvents: PowIdPendingEvent[];
  records: PowIdRecord[];
  sales: PowIdMarketplaceSale[];
};

type RushApiResponse = Partial<RushState>;

type PowTokenApiResponse = Partial<PowTokenState> & {
  registryAddress?: string;
  reserveAddress?: string;
  summaryOnly?: boolean;
};

type PowActivityApiResponse = {
  activity?: PowActivityItem[];
  indexedAt?: string;
  source?: string;
  stats?: PowActivityStats;
  summaryOnly?: boolean;
};

type PowPaginatedApiResponse<T> = {
  cursor?: string;
  end?: number;
  indexedAt?: string;
  indexedThroughBlock?: number;
  items?: T[];
  kind?: string;
  limit?: number;
  network?: BitcoinNetwork;
  nextCursor?: string;
  page?: number;
  pageCount?: number;
  pageSize?: number;
  query?: string;
  start?: number;
  totalCount?: number;
};

type PowMailApiResponse = {
  inboxMessages?: InboxMessage[];
  sentMessages?: SentMessage[];
};

type PowTxStatusApiResponse = {
  status?: BroadcastStatus;
};

declare global {
  interface Window {
    unisat?: UnisatWallet;
  }
}

const SENT_KEY = "proofofwork.sent.v5";
const DRAFT_KEY_PREFIX = "proofofwork.draft.v1";
const MAIL_PREFS_KEY = "proofofwork.mailPrefs.v1";
const CONTACTS_KEY = "proofofwork.contacts.v1";
const CUSTOM_FOLDERS_KEY = "proofofwork.customFolders.v1";
const BACKUP_APP = "ProofOfWork.Me";
const BACKUP_VERSION = 1;
const BACKUP_MAX_BYTES = 5 * 1024 * 1024;
const UNISAT_DOWNLOAD_URL = "https://unisat.io/download";
const CANONICAL_WELCOME_TXID =
  "8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b";
const CANONICAL_WELCOME_HTML =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Welcome to ProofOfWork.Me</title><main style="font-family:system-ui,sans-serif;max-width:680px;margin:40px auto;padding:0 18px;line-height:1.55;color:#111"><p style="color:#06c;font-weight:800;text-transform:uppercase">Bitcoin Computer</p><h1>Welcome to ProofOfWork.Me</h1><p><b>ProofOfWork.Me is a computer built on Bitcoin.</b></p><p>It turns transactions into identity, mail, files, pages, marketplace actions, logs, and proof.</p><p>Your ProofOfWork ID is your Bitcoin-native name. Your Computer is where your ID, messages, files, contacts, pages, and history become usable.</p><p>Most apps ask you to trust a server. ProofOfWork.Me asks you to check the chain. Bitcoin history is the source of truth.</p><p>Claim an ID. Send mail. Save a file. Open a txid in the Browser. Watch the Log.</p><p><b>This is the Bitcoin Computer. Small today. Already real.</b></p><p><code>ProofOfWork.Me</code></p></main>\n';
const CANONICAL_WELCOME_SENDER = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const CANONICAL_WELCOME_RECIPIENT = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
const CANONICAL_WELCOME_CREATED_AT = "2026-05-13T17:58:01.000Z";
const MAX_ATTACHMENT_BYTES = 60_000;
const MAX_REGISTRY_TX_PAGES = 100;
const DATA_PAGE_SIZE = 25;
const TOKEN_GRID_PAGE_SIZE = 24;
const ACTIVITY_FEED_PAGE_SIZE = 50;
const GROWTH_EVENT_PAGE_SIZE = 12;
const GROWTH_AUTO_REFRESH_MS = 5 * 60_000;
const WORK_FLOOR_LIVE_REFRESH_MS = 15_000;
const LOG_LIVE_REFRESH_MS = 15_000;
const BACKGROUND_FRESH_REFRESH_DELAY_MS = 1_000;
const BTC_USD_BROWSER_CACHE_TTL_MS = 60_000;
const BLOCK_TXID_INDEX_CACHE = new Map<string, Promise<Map<string, number>>>();
const BTC_USD_BROWSER_INFLIGHT = new Map<string, Promise<number>>();
const PROTOCOL_PREFIX = "pwm1:";
let btcUsdBrowserCache:
  | {
      fetchedAtMs: number;
      usd: number;
    }
  | undefined;

// Canonical Phase 1 ProofOfWork ID registry.
// Do not fork this address/protocol for id.proofofwork.me; the launch surface
// must use the same registry as the full mail app so first-confirmed-wins stays global.
const ID_PROTOCOL_PREFIX = "pwid1:";
const ID_REGISTRATION_PRICE_SATS = 1000;
const ID_MUTATION_PRICE_SATS = 546;
const ID_SALE_AUTH_VERSION_LEGACY = "pwid-sale-v1";
const ID_SALE_AUTH_VERSION_ANCHORED = "pwid-sale-v2";
const ID_SALE_AUTH_VERSION = "pwid-sale-v3";
const ID_SALE_AUTH_VERSION_TICKET = "pwid-sale-v4";
const ID_LISTING_ANCHOR_TYPE_LEGACY = "p2wsh-op-true-v1";
const ID_LISTING_ANCHOR_TYPE = "seller-utxo-v1";
const ID_LISTING_TICKET_ANCHOR_TYPE = "sale-ticket-v1";
const ID_LISTING_ANCHOR_VALUE_SATS = 546;
const ID_LISTING_ANCHOR_VOUT = 2;
const ID_LISTING_ANCHOR_SIGHASH_TYPE =
  bitcoin.Transaction.SIGHASH_SINGLE | bitcoin.Transaction.SIGHASH_ANYONECANPAY;
const ID_LISTING_ANCHOR_SEAL_FEE_SATS = 500;
const ID_REGISTRY_ADDRESSES: Partial<Record<BitcoinNetwork, string>> = {
  livenet: "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e",
};
const TOKEN_PROTOCOL_PREFIX = "pwt1:";
const TOKEN_CREATE_ACTION = "create";
const TOKEN_MINT_ACTION = "mint";
const TOKEN_SEND_ACTION = "send";
const TOKEN_LIST_ACTION = "list5";
const TOKEN_SEAL_ACTION = "seal5";
const TOKEN_DELIST_ACTION = "delist5";
const TOKEN_BUY_ACTION = "buy5";
const TOKEN_SALE_AUTH_VERSION = "pwt-sale-v1";
const TOKEN_CREATION_PRICE_SATS = 546;
const TOKEN_MIN_MUTATION_PRICE_SATS = 546;
const TOKEN_LISTING_ANCHOR_TYPE = ID_LISTING_TICKET_ANCHOR_TYPE;
const TOKEN_LISTING_ANCHOR_VALUE_SATS = ID_LISTING_ANCHOR_VALUE_SATS;
const TOKEN_LISTING_ANCHOR_VOUT = ID_LISTING_ANCHOR_VOUT;
const TOKEN_LISTING_ANCHOR_SIGHASH_TYPE = ID_LISTING_ANCHOR_SIGHASH_TYPE;
const TOKEN_PREPARE_DEFAULT_MINT_COUNT = 40;
const TOKEN_PREPARE_MAX_MINT_COUNT = 100;
const TOKEN_PREPARE_DEFAULT_FEE_RESERVE_SATS = 1000;
const TOKEN_MINT_ASSISTANT_DEFAULT_COUNT = 5;
const TOKEN_MINT_ASSISTANT_MAX_COUNT = 100;
const TOKEN_MINT_ASSISTANT_DEFAULT_DELAY_MS = 1200;
const TOKEN_MINT_ASSISTANT_MAX_DELAY_MS = 60_000;
const TOKEN_LIST_PREVIEW_COUNT = DATA_PAGE_SIZE;
const TOKEN_INDEX_ID = "tokens@proofofwork.me";
const TOKEN_INDEX_TXID =
  "7a8845f33823305fabd818b3a3e2f06a175b29bf55dd79a2f83365251a6d5d19";
const TOKEN_INDEX_ADDRESSES: Partial<Record<BitcoinNetwork, string>> = {
  livenet: "1L4xrDurN9VghknrbsSju2vQb6oXZe1Pbn",
};
const TOKEN_TEMPLATE_TICKER = "TOKEN";
const WORK_TOKEN_TICKER = "WORK";
const WORK_TOKEN_MAX_SUPPLY = 21_000_000;
const WORK_TOKEN_MINT_AMOUNT = 1000;
const WORK_TOKEN_MINT_PRICE_SATS = 1000;
const WORK_TOKEN_ID =
  "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const BLOCKED_TOKEN_CREATOR_ADDRESSES = new Set([
  "bc1qcf57sgazj4gcd0yfxste3eaa35eltj48sgrvjl",
]);
const WORK_TOKEN_DEFAULT_REGISTRY_ID = "work@proofofwork.me";
const WORK_TOKEN_REGISTRY_TXID =
  "ec249a2b023e9f7ec173d717ae06f331942cb7893dcc19a1a490936a93b35422";
const WORK_TOKEN_REGISTRY_ADDRESS = "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
const WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS =
  WORK_TOKEN_DEFAULT_REGISTRY_ID;
const WORK_TOKEN_REGISTRY_RECORD: PowIdRecord = {
  amountSats: ID_REGISTRATION_PRICE_SATS,
  confirmed: true,
  createdAt: "2026-05-14T22:37:33.000Z",
  id: "work",
  network: "livenet",
  ownerAddress: WORK_TOKEN_REGISTRY_ADDRESS,
  receiveAddress: WORK_TOKEN_REGISTRY_ADDRESS,
  txid: WORK_TOKEN_REGISTRY_TXID,
};
const WORK_TOKEN_DEFINITION: PowTokenDefinition = {
  confirmed: true,
  createdAt: "2026-05-15T02:57:28.000Z",
  creationFeeSats: TOKEN_CREATION_PRICE_SATS,
  creatorAddress: TOKEN_INDEX_ADDRESSES.livenet ?? "",
  dataBytes: 70,
  maxSupply: WORK_TOKEN_MAX_SUPPLY,
  mintAmount: WORK_TOKEN_MINT_AMOUNT,
  mintPriceSats: WORK_TOKEN_MINT_PRICE_SATS,
  network: "livenet",
  registryAddress: WORK_TOKEN_REGISTRY_ADDRESS,
  ticker: WORK_TOKEN_TICKER,
  tokenId: WORK_TOKEN_ID,
  txid: WORK_TOKEN_ID,
};
const ESTIMATED_INPUT_VBYTES = 160;
const ESTIMATED_PAYMENT_OUTPUT_VBYTES = 31;
const DUST_SATS = 546;
const DEFAULT_AMOUNT_SATS = 546;
const DEFAULT_FEE_RATE = 0.1;
const DEFAULT_BROWSER_INTENT_FEE_RATE = 1;
const DEFAULT_MEMO = "";
const MAX_RECIPIENTS = 10;

type GrowthModelRow = {
  adoption: number;
  browserSats: number;
  browserWrites: number;
  blockspaceUsageRatio: number;
  btcUsdBase: number;
  driveSats: number;
  driveWrites: number;
  idSats: number;
  idWrites: number;
  label: string;
  mailSats: number;
  mailWrites: number;
  marketplaceSats: number;
  marketplaceWrites: number;
  powids: number;
  tokenSats: number;
  tokenWrites: number;
  totalSats: number;
  totalUsdBase: number;
  totalWrites: number;
  years: number;
};

type GrowthValuePoint = {
  label: string;
  sats: number;
  usd: number;
  years: number;
};

type GrowthActualNetworkValue = {
  browserFlowSats: number;
  browserSats: number;
  computerEventFlowSats: number;
  computerEventSats: number;
  driveFlowSats: number;
  driveSats: number;
  mailFlowSats: number;
  mailSats: number;
  marketplaceSats: number;
  marketplaceVolumeSats: number;
  powids: number;
  tokenCreationFlowSats: number;
  tokenMintFlowSats: number;
  tokenSaleFlowSats: number;
  tokenTransferFlowSats: number;
  tokenSats: number;
  walletFlowSats: number;
  walletSats: number;
  totalSats: number;
  totalUsd: number;
};

type WorkFloorQuote = {
  actualValue?: GrowthActualNetworkValue;
  chartPoints: WorkFloorPoint[];
  indexedAt: string;
  networkValueSats: number;
  powids: number;
  stats?: Record<string, number>;
  tokenFlowSats: number;
};

type WorkFloorPoint = {
  floorSats: number;
  label: string;
  networkValueSats: number;
  years: number;
};

type WorkFloorChartUnit = "sats" | "usd";

type WorkFloorApiResponse = {
  actualValue?: Partial<GrowthActualNetworkValue>;
  chartPoints?: Array<Partial<WorkFloorPoint>>;
  indexedAt?: string;
  network?: BitcoinNetwork;
  networkValueSats?: number;
  powids?: number;
  stats?: Record<string, number>;
  tokenFlowSats?: number;
};

type GrowthRealEvent = {
  amountLabel: string;
  createdAt: string;
  detail: string;
  key: string;
  kind: string;
  network: BitcoinNetwork;
  title: string;
  txid: string;
};

type GrowthSummaryCounts = {
  browserActions: number;
  confirmedComputerActions: number;
  confirmedTokenDefinitions: number;
  confirmedTokenMints: number;
  confirmedTokenSales: number;
  confirmedTokenTransfers: number;
  driveActions: number;
  idListings: number;
  mailActions: number;
  marketplaceSaleCount: number;
  pendingRecords: number;
  powids: number;
  tokenCount: number;
};

type GrowthSummarySnapshot = {
  actualValue: GrowthActualNetworkValue;
  counts: GrowthSummaryCounts;
  events: GrowthRealEvent[];
  indexedAt: string;
  workFloor?: WorkFloorQuote;
};

type GrowthSummaryApiResponse = {
  actualValue?: Partial<GrowthActualNetworkValue>;
  activity?: PowActivityApiResponse;
  counts?: Partial<GrowthSummaryCounts>;
  events?: Array<Partial<GrowthRealEvent>>;
  indexedAt?: string;
  registry?: PowRegistryApiResponse;
  token?: PowTokenApiResponse;
  workFloor?: WorkFloorApiResponse;
};

type MarketplaceSummarySnapshot = {
  indexedAt: string;
  registry: PowRegistryState;
  token: PowTokenState;
  workFloor?: WorkFloorQuote;
};

type MarketplaceSummaryApiResponse = {
  indexedAt?: string;
  network?: BitcoinNetwork;
  registry?: PowRegistryApiResponse;
  summaryOnly?: boolean;
  token?: PowTokenApiResponse;
  workFloor?: WorkFloorApiResponse;
};

const GROWTH_MODEL_START_DATE = "2026-05-11";
const GROWTH_MODEL_GENERATED_ON = "2026-05-13";
const MAX_GROWTH_ACTUAL_CHART_EVENTS = 240;
const GROWTH_MODEL_INPUTS = {
  bitnodesReachableNodes: 23_984,
  agentShare: 0.51,
  nodeCagr: 0.25,
  currentBtcUsd: 80_879.33,
  historicalBtcUsd: 452.73,
  btcBenchmarkYears: 10,
  currentPowids: 94,
  idDensitySatsPerN2: 268.68933906745133,
  baselineMailFlowSats: 10_202,
  baselineFileFlowSats: 2_184,
  baselineMarketplaceVolumeSats: 1_000,
  baselineBrowserFlowSats: 0,
  baselineTokenFlowSats: 0,
  mailEdgeDensity: 0.012307692307692308,
  mailSatsPerDelivery: 680.1333333333333,
  marketplaceAverageSaleSats: 1000,
  browserAveragePageSats: 1000,
  tokenAverageMintSats: 1000,
  satsPerFile: 1000,
  canonicalFee: 0.00001,
  blockspaceVbytesPerYear: 52_560_000_000,
  idVbytesPerWrite: 350,
  mailVbytesPerWrite: 500,
  driveVbytesPerWrite: 9_621,
  marketplaceVbytesPerSale: 1_500,
  browserVbytesPerPage: 15_000,
  tokenVbytesPerWrite: 700,
  mailMessagesPerPairPerYear: 4,
  driveFilesPerIdPerYear: 6,
  marketplaceSalesPerIdPerYear: 0.2,
  browserPagesPerIdPerYear: 1,
  tokenMintsPerIdPerYear: 0.25,
  valueMultiple: 5,
  elasticities: {
    id: 0.25,
    mail: 0.5,
    drive: 0.75,
    marketplace: 0.5,
    browser: 0.75,
    token: 0.6,
  },
  horizons: [
    { label: "6 months", years: 0.5, adoption: 0.1 },
    { label: "12 months", years: 1, adoption: 0.2 },
    { label: "24 months", years: 2, adoption: 0.4 },
    { label: "5 years", years: 5, adoption: 0.6 },
    { label: "10 years", years: 10, adoption: 0.8 },
    { label: "25 years", years: 25, adoption: 0.9 },
    { label: "50 years", years: 50, adoption: 1 },
  ],
};

function growthFeeMultiplier(feeRate: number, elasticity: number) {
  return (0.01 / feeRate) ** elasticity;
}

function growthBtcUsdAtYears(years: number) {
  const mu =
    Math.log(
      GROWTH_MODEL_INPUTS.currentBtcUsd / GROWTH_MODEL_INPUTS.historicalBtcUsd,
    ) / GROWTH_MODEL_INPUTS.btcBenchmarkYears;
  return GROWTH_MODEL_INPUTS.currentBtcUsd * Math.exp(mu * Math.max(0, years));
}

function growthSatsToUsdAtYears(sats: number, years: number) {
  return (sats / 100_000_000) * growthBtcUsdAtYears(years);
}

function growthModelRow(horizon: {
  label: string;
  years: number;
  adoption: number;
}): GrowthModelRow {
  const nodes =
    GROWTH_MODEL_INPUTS.bitnodesReachableNodes *
    (1 + GROWTH_MODEL_INPUTS.nodeCagr) ** horizon.years;
  const agentNodes = nodes * GROWTH_MODEL_INPUTS.agentShare;
  const powids = agentNodes * horizon.adoption;
  const directedPairs = powids * Math.max(0, powids - 1);
  const idMultiplier = growthFeeMultiplier(
    GROWTH_MODEL_INPUTS.canonicalFee,
    GROWTH_MODEL_INPUTS.elasticities.id,
  );
  const mailMultiplier = growthFeeMultiplier(
    GROWTH_MODEL_INPUTS.canonicalFee,
    GROWTH_MODEL_INPUTS.elasticities.mail,
  );
  const driveMultiplier = growthFeeMultiplier(
    GROWTH_MODEL_INPUTS.canonicalFee,
    GROWTH_MODEL_INPUTS.elasticities.drive,
  );
  const marketplaceMultiplier = growthFeeMultiplier(
    GROWTH_MODEL_INPUTS.canonicalFee,
    GROWTH_MODEL_INPUTS.elasticities.marketplace,
  );
  const browserMultiplier = growthFeeMultiplier(
    GROWTH_MODEL_INPUTS.canonicalFee,
    GROWTH_MODEL_INPUTS.elasticities.browser,
  );
  const tokenMultiplier = growthFeeMultiplier(
    GROWTH_MODEL_INPUTS.canonicalFee,
    GROWTH_MODEL_INPUTS.elasticities.token,
  );
  const rawIdSats =
    powids ** 2 * GROWTH_MODEL_INPUTS.idDensitySatsPerN2 * idMultiplier;
  const rawMailSats =
    directedPairs *
    GROWTH_MODEL_INPUTS.mailEdgeDensity *
    GROWTH_MODEL_INPUTS.mailMessagesPerPairPerYear *
    GROWTH_MODEL_INPUTS.mailSatsPerDelivery *
    GROWTH_MODEL_INPUTS.valueMultiple *
    mailMultiplier;
  const rawDriveSats =
    powids *
    GROWTH_MODEL_INPUTS.driveFilesPerIdPerYear *
    GROWTH_MODEL_INPUTS.satsPerFile *
    GROWTH_MODEL_INPUTS.valueMultiple *
    driveMultiplier;
  const rawMarketplaceSats =
    powids *
    GROWTH_MODEL_INPUTS.marketplaceSalesPerIdPerYear *
    GROWTH_MODEL_INPUTS.marketplaceAverageSaleSats *
    GROWTH_MODEL_INPUTS.valueMultiple *
    marketplaceMultiplier;
  const rawBrowserSats =
    powids *
    GROWTH_MODEL_INPUTS.browserPagesPerIdPerYear *
    GROWTH_MODEL_INPUTS.browserAveragePageSats *
    GROWTH_MODEL_INPUTS.valueMultiple *
    browserMultiplier;
  const rawTokenSats =
    powids *
    GROWTH_MODEL_INPUTS.tokenMintsPerIdPerYear *
    GROWTH_MODEL_INPUTS.tokenAverageMintSats *
    GROWTH_MODEL_INPUTS.valueMultiple *
    tokenMultiplier;
  const idWrites = powids * idMultiplier;
  const mailWrites =
    directedPairs *
    GROWTH_MODEL_INPUTS.mailEdgeDensity *
    GROWTH_MODEL_INPUTS.mailMessagesPerPairPerYear *
    mailMultiplier;
  const driveWrites =
    powids * GROWTH_MODEL_INPUTS.driveFilesPerIdPerYear * driveMultiplier;
  const marketplaceWrites =
    powids *
    GROWTH_MODEL_INPUTS.marketplaceSalesPerIdPerYear *
    marketplaceMultiplier;
  const browserWrites =
    powids * GROWTH_MODEL_INPUTS.browserPagesPerIdPerYear * browserMultiplier;
  const tokenWrites =
    powids *
    GROWTH_MODEL_INPUTS.tokenMintsPerIdPerYear *
    tokenMultiplier;
  const rawBlockspaceVbytes =
    idWrites * GROWTH_MODEL_INPUTS.idVbytesPerWrite +
    mailWrites * GROWTH_MODEL_INPUTS.mailVbytesPerWrite +
    driveWrites * GROWTH_MODEL_INPUTS.driveVbytesPerWrite +
    marketplaceWrites * GROWTH_MODEL_INPUTS.marketplaceVbytesPerSale +
    browserWrites * GROWTH_MODEL_INPUTS.browserVbytesPerPage +
    tokenWrites * GROWTH_MODEL_INPUTS.tokenVbytesPerWrite;
  const blockspaceUsageRatio =
    rawBlockspaceVbytes > 0
      ? Math.min(
          rawBlockspaceVbytes,
          GROWTH_MODEL_INPUTS.blockspaceVbytesPerYear,
        ) / rawBlockspaceVbytes
      : 1;
  const idSats = rawIdSats;
  const mailSats = rawMailSats * blockspaceUsageRatio;
  const driveSats = rawDriveSats * blockspaceUsageRatio;
  const marketplaceSats = rawMarketplaceSats * blockspaceUsageRatio;
  const browserSats = rawBrowserSats * blockspaceUsageRatio;
  const tokenSats = rawTokenSats * blockspaceUsageRatio;
  const totalSats =
    idSats +
    mailSats +
    driveSats +
    marketplaceSats +
    browserSats +
    tokenSats;
  const btcUsdBase = growthBtcUsdAtYears(horizon.years);

  return {
    ...horizon,
    blockspaceUsageRatio,
    browserSats,
    browserWrites: browserWrites * blockspaceUsageRatio,
    btcUsdBase,
    driveSats,
    driveWrites: driveWrites * blockspaceUsageRatio,
    idSats,
    idWrites,
    mailSats,
    mailWrites: mailWrites * blockspaceUsageRatio,
    marketplaceSats,
    marketplaceWrites: marketplaceWrites * blockspaceUsageRatio,
    powids,
    tokenSats,
    tokenWrites: tokenWrites * blockspaceUsageRatio,
    totalSats,
    totalUsdBase: (totalSats / 100_000_000) * btcUsdBase,
    totalWrites:
      idWrites +
      (
        mailWrites +
        driveWrites +
        marketplaceWrites +
        browserWrites +
        tokenWrites
      ) *
        blockspaceUsageRatio,
  };
}

function growthModelStartRow(): GrowthModelRow {
  const idSats =
    GROWTH_MODEL_INPUTS.currentPowids ** 2 *
    GROWTH_MODEL_INPUTS.idDensitySatsPerN2;
  const mailSats =
    GROWTH_MODEL_INPUTS.baselineMailFlowSats *
    GROWTH_MODEL_INPUTS.valueMultiple;
  const driveSats =
    GROWTH_MODEL_INPUTS.baselineFileFlowSats *
    GROWTH_MODEL_INPUTS.valueMultiple;
  const marketplaceSats =
    GROWTH_MODEL_INPUTS.baselineMarketplaceVolumeSats *
    GROWTH_MODEL_INPUTS.valueMultiple;
  const browserSats =
    GROWTH_MODEL_INPUTS.baselineBrowserFlowSats *
    GROWTH_MODEL_INPUTS.valueMultiple;
  const tokenSats =
    GROWTH_MODEL_INPUTS.baselineTokenFlowSats *
    GROWTH_MODEL_INPUTS.valueMultiple;
  const totalSats =
    idSats +
    mailSats +
    driveSats +
    marketplaceSats +
    browserSats +
    tokenSats;
  const btcUsdBase = growthBtcUsdAtYears(0);
  return {
    adoption: 0,
    blockspaceUsageRatio: 1,
    browserSats,
    browserWrites: 0,
    btcUsdBase,
    driveSats,
    driveWrites: 0,
    idSats,
    idWrites: GROWTH_MODEL_INPUTS.currentPowids,
    label: "Model start",
    mailSats,
    mailWrites: 0,
    marketplaceSats,
    marketplaceWrites: 0,
    powids: GROWTH_MODEL_INPUTS.currentPowids,
    tokenSats,
    tokenWrites: 0,
    totalSats,
    totalUsdBase: (totalSats / 100_000_000) * btcUsdBase,
    totalWrites: GROWTH_MODEL_INPUTS.currentPowids,
    years: 0,
  };
}

const GROWTH_MODEL_ROWS = GROWTH_MODEL_INPUTS.horizons.map(growthModelRow);
const GROWTH_MODEL_CHART_ROWS = [growthModelStartRow(), ...GROWTH_MODEL_ROWS];

function isBackupStorageKey(key: string) {
  return (
    key === SENT_KEY ||
    key === MAIL_PREFS_KEY ||
    key === CONTACTS_KEY ||
    key === CUSTOM_FOLDERS_KEY ||
    key.startsWith(`${DRAFT_KEY_PREFIX}:`)
  );
}

function validateBackupValue(key: string, value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (key === SENT_KEY) {
      return Array.isArray(parsed);
    }

    if (key === CONTACTS_KEY) {
      return Array.isArray(parsed);
    }

    if (key === CUSTOM_FOLDERS_KEY) {
      return Array.isArray(parsed);
    }

    return isPlainRecord(parsed);
  } catch {
    return false;
  }
}

function collectBackupData() {
  const data: Record<string, string> = {};

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !isBackupStorageKey(key)) {
      continue;
    }

    const value = localStorage.getItem(key);
    if (typeof value === "string" && validateBackupValue(key, value)) {
      data[key] = value;
    }
  }

  return data;
}

function backupFileName() {
  return `proofofwork-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

function parseBackup(text: string) {
  const parsed = JSON.parse(text) as unknown;
  if (
    !isPlainRecord(parsed) ||
    parsed.app !== BACKUP_APP ||
    parsed.version !== BACKUP_VERSION ||
    !isPlainRecord(parsed.data)
  ) {
    throw new Error("Backup file is not a supported ProofOfWork.Me backup.");
  }

  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (!isBackupStorageKey(key)) {
      continue;
    }

    if (typeof value !== "string" || !validateBackupValue(key, value)) {
      throw new Error(`Backup contains invalid data for ${key}.`);
    }

    data[key] = value;
  }

  if (Object.keys(data).length === 0) {
    throw new Error("Backup does not contain any supported local app data.");
  }

  return data;
}

function backupDataSummary(data: Record<string, string>) {
  const details: string[] = [];

  if (data[SENT_KEY]) {
    try {
      const sent = JSON.parse(data[SENT_KEY]) as unknown;
      if (Array.isArray(sent)) {
        details.push(
          `${sent.length} sent/outbox message${sent.length === 1 ? "" : "s"}`,
        );
      }
    } catch {
      // Already validated before this helper is used.
    }
  }

  if (data[MAIL_PREFS_KEY]) {
    try {
      const preferences = JSON.parse(data[MAIL_PREFS_KEY]) as unknown;
      if (isPlainRecord(preferences)) {
        const count = Object.keys(preferences).length;
        details.push(`${count} mail preference${count === 1 ? "" : "s"}`);
      }
    } catch {
      // Already validated before this helper is used.
    }
  }

  if (data[CONTACTS_KEY]) {
    try {
      const contacts = JSON.parse(data[CONTACTS_KEY]) as unknown;
      if (Array.isArray(contacts)) {
        details.push(
          `${contacts.length} contact${contacts.length === 1 ? "" : "s"}`,
        );
      }
    } catch {
      // Already validated before this helper is used.
    }
  }

  if (data[CUSTOM_FOLDERS_KEY]) {
    try {
      const folders = JSON.parse(data[CUSTOM_FOLDERS_KEY]) as unknown;
      if (Array.isArray(folders)) {
        details.push(
          `${folders.length} custom folder${folders.length === 1 ? "" : "s"}`,
        );
      }
    } catch {
      // Already validated before this helper is used.
    }
  }

  const draftCount = Object.keys(data).filter((key) =>
    key.startsWith(`${DRAFT_KEY_PREFIX}:`),
  ).length;
  if (draftCount > 0) {
    details.push(`${draftCount} draft${draftCount === 1 ? "" : "s"}`);
  }

  return details.join(", ");
}

function opReturnScriptForPayload(payload: string) {
  const output = bitcoin.payments.embed({
    data: [Buffer.from(payload, "utf8")],
  }).output;
  if (!output) {
    throw new Error("Could not build OP_RETURN output.");
  }

  return output;
}

function dataCarrierBytesForPayload(payload: string) {
  return opReturnScriptForPayload(payload).length;
}

function dataCarrierBytesForPayloads(payloads: string[]) {
  return payloads.reduce(
    (total, payload) => total + dataCarrierBytesForPayload(payload),
    0,
  );
}

function maxPayloadDataBytes(prefix: string) {
  let low = 0;
  let high = Math.max(0, MAX_DATA_CARRIER_BYTES - byteLength(prefix));

  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    const payload = `${prefix}${"x".repeat(candidate)}`;

    if (dataCarrierBytesForPayload(payload) <= MAX_DATA_CARRIER_BYTES) {
      low = candidate;
    } else {
      high = candidate - 1;
    }
  }

  return low;
}

async function fetchBtcUsdPrice(fresh = false) {
  if (
    !fresh &&
    btcUsdBrowserCache &&
    Date.now() - btcUsdBrowserCache.fetchedAtMs < BTC_USD_BROWSER_CACHE_TTL_MS
  ) {
    return btcUsdBrowserCache.usd;
  }

  const cacheKey = fresh ? "fresh" : "cached";
  const inFlight = BTC_USD_BROWSER_INFLIGHT.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    const payload = await fetchProofApiJson<{ USD?: number; usd?: number }>(
      fresh ? "/api/v1/prices/btc-usd?fresh=1" : "/api/v1/prices/btc-usd",
      "livenet",
    );
    const usd = Number(payload.USD ?? payload.usd);
    if (!Number.isFinite(usd) || usd <= 0) {
      throw new Error("BTC/USD price is unavailable.");
    }

    btcUsdBrowserCache = {
      fetchedAtMs: Date.now(),
      usd,
    };
    return usd;
  })();

  BTC_USD_BROWSER_INFLIGHT.set(cacheKey, request);
  try {
    return await request;
  } finally {
    BTC_USD_BROWSER_INFLIGHT.delete(cacheKey);
  }
}

async function fetchBlockTxidIndex(
  blockHash: string,
  network: BitcoinNetwork,
): Promise<Map<string, number>> {
  if (!/^[0-9a-fA-F]{64}$/u.test(blockHash)) {
    return new Map();
  }

  const normalizedHash = blockHash.toLowerCase();
  const cacheKey = `${network}:${normalizedHash}`;
  if (!BLOCK_TXID_INDEX_CACHE.has(cacheKey)) {
    const promise = fetchProofApiJson<string[]>(
      `/api/v1/block/${encodeURIComponent(normalizedHash)}/txids`,
      network,
    )
      .then((txids) => {
        const index = new Map<string, number>();
        if (Array.isArray(txids)) {
          txids.forEach((txid, position) => {
            if (typeof txid === "string" && /^[0-9a-fA-F]{64}$/u.test(txid)) {
              index.set(txid.toLowerCase(), position);
            }
          });
        }
        return index;
      })
      .catch((error) => {
        BLOCK_TXID_INDEX_CACHE.delete(cacheKey);
        throw error;
      });
    BLOCK_TXID_INDEX_CACHE.set(cacheKey, promise);
  }

  return BLOCK_TXID_INDEX_CACHE.get(cacheKey)!;
}

function xVerificationUrl(record: PowIdRecord) {
  const action = record.confirmed
    ? "registered"
    : "submitted a registration for";
  const text = [
    `I ${action} ${record.id}@proofofwork.me on Bitcoin.`,
    `Registry tx: ${explorerTxUrl(record.txid, record.network)}`,
    "ProofOfWork.Me IDs are on-chain mail identities.",
  ].join("\n\n");

  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

function marketplacePurchaseTweetUrl(receipt: MarketplacePurchaseReceipt) {
  const assetLine =
    receipt.kind === "id"
      ? `I bought ${receipt.assetLabel} on ProofOfWork.Me.`
      : `I bought ${receipt.amountLabel} on ProofOfWork.Me.`;
  const text = [
    assetLine,
    `Purchase tx: ${explorerTxUrl(receipt.txid, receipt.network)}`,
    "Bitcoin-native markets settle through on-chain sale tickets.",
  ].join("\n\n");

  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

function MarketplacePurchaseReceiptModal({
  onClose,
  receipt,
}: {
  onClose: () => void;
  receipt?: MarketplacePurchaseReceipt;
}) {
  if (!receipt) {
    return null;
  }

  const title =
    receipt.kind === "id"
      ? "ID purchase broadcast"
      : "Token purchase broadcast";
  const description =
    receipt.kind === "id"
      ? `${receipt.assetLabel} buyer-funded transfer is on Bitcoin.`
      : `${receipt.amountLabel} purchase is on Bitcoin.`;

  return (
    <div
      className="purchase-receipt-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <section
        aria-labelledby="purchase-receipt-title"
        aria-modal="true"
        className="purchase-receipt-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="purchase-receipt-head">
          <div className="empty-icon" aria-hidden="true">
            <CheckCircle2 size={24} />
          </div>
          <div>
            <h3 id="purchase-receipt-title">{title}</h3>
            <p>{description}</p>
          </div>
          <button
            aria-label="Close purchase receipt"
            className="secondary small"
            onClick={onClose}
            type="button"
          >
            <X size={15} />
          </button>
        </div>

        <dl className="purchase-receipt-fields">
          <div>
            <dt>Asset</dt>
            <dd>{receipt.assetLabel}</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd>{receipt.amountLabel}</dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd>{receipt.priceSats.toLocaleString()} sats</dd>
          </div>
          <div>
            <dt>Purchase TX</dt>
            <dd>{shortAddress(receipt.txid)}</dd>
          </div>
          <div>
            <dt>Buyer</dt>
            <dd>{shortAddress(receipt.buyerAddress)}</dd>
          </div>
          <div>
            <dt>Seller</dt>
            <dd>{shortAddress(receipt.sellerAddress)}</dd>
          </div>
        </dl>

        <div className="id-record-actions purchase-receipt-actions">
          <a
            className="primary link-button"
            href={explorerTxUrl(receipt.txid, receipt.network)}
            rel="noreferrer"
            target="_blank"
          >
            <ArrowUpRight size={15} />
            <span>View Purchase TX</span>
          </a>
          <a
            className="secondary link-button"
            href={explorerTxUrl(receipt.listingId, receipt.network)}
            rel="noreferrer"
            target="_blank"
          >
            <ArrowUpRight size={15} />
            <span>View Listing TX</span>
          </a>
          <a
            className="secondary link-button"
            href={marketplacePurchaseTweetUrl(receipt)}
            rel="noreferrer"
            target="_blank"
          >
            <Send size={15} />
            <span>Post on X</span>
          </a>
        </div>
      </section>
    </div>
  );
}

function registryAddressForNetwork(network: BitcoinNetwork) {
  return ID_REGISTRY_ADDRESSES[network] ?? "";
}

function tokenIndexAddressForNetwork(network: BitcoinNetwork) {
  return TOKEN_INDEX_ADDRESSES[network] ?? "";
}

function bitcoinNetwork(network: BitcoinNetwork) {
  return network === "livenet"
    ? bitcoin.networks.bitcoin
    : bitcoin.networks.testnet;
}

function varIntSize(value: number) {
  if (value < 0xfd) {
    return 1;
  }

  if (value <= 0xffff) {
    return 3;
  }

  if (value <= 0xffffffff) {
    return 5;
  }

  return 9;
}

function outputVbytesForScript(script: Uint8Array) {
  return 8 + varIntSize(script.length) + script.length;
}

function scriptForAddress(
  address: string,
  network: BitcoinNetwork,
  fieldName: string,
) {
  try {
    return bitcoin.address.toOutputScript(address, bitcoinNetwork(network));
  } catch {
    throw new Error(
      `${fieldName} is not a valid ${networkLabel(network)} address.`,
    );
  }
}

function marketplaceLegacyAnchorWitnessScript() {
  return bitcoin.script.compile([bitcoin.opcodes.OP_TRUE]);
}

function marketplaceLegacyAnchorOutputScript(_network: BitcoinNetwork) {
  const payment = bitcoin.payments.p2wsh({
    redeem: {
      output: marketplaceLegacyAnchorWitnessScript(),
    },
  });

  if (!payment.output) {
    throw new Error("Could not build marketplace listing anchor script.");
  }

  return payment.output;
}

function marketplaceLegacyAnchorScriptPubKey(network: BitcoinNetwork) {
  return bytesToHex(marketplaceLegacyAnchorOutputScript(network));
}

function validPublicKeyHex(value: string) {
  return (
    /^[0-9a-fA-F]{64}$/u.test(value) ||
    /^(02|03)[0-9a-fA-F]{64}$/u.test(value) ||
    /^04[0-9a-fA-F]{128}$/u.test(value)
  );
}

function validSignatureHex(value: string) {
  return (
    /^[0-9a-fA-F]+$/u.test(value) &&
    value.length >= 18 &&
    value.length <= 146 &&
    value.length % 2 === 0
  );
}

function isTaprootScriptPubKey(script: Uint8Array) {
  return (
    script.length === 34 &&
    script[0] === bitcoin.opcodes.OP_1 &&
    script[1] === 0x20
  );
}

function signedInputSignature(
  signedPsbt: bitcoin.Psbt,
  inputIndex: number,
  publicKeyHex: string,
): { kind: "partial" | "tapKey"; signature: Uint8Array } | undefined {
  const input = signedPsbt.data.inputs[inputIndex];
  if (input?.tapKeySig) {
    return {
      kind: "tapKey",
      signature: input.tapKeySig,
    };
  }

  const normalizedPublicKey = publicKeyHex.toLowerCase();
  const partialSig =
    input?.partialSig?.find(
      (candidate) =>
        bytesToHex(candidate.pubkey).toLowerCase() === normalizedPublicKey,
    ) ?? input?.partialSig?.[0];
  if (!partialSig?.signature) {
    return undefined;
  }

  return {
    kind: "partial",
    signature: partialSig.signature,
  };
}

function isValidBitcoinAddress(address: string, network: BitcoinNetwork) {
  try {
    bitcoin.address.toOutputScript(address, bitcoinNetwork(network));
    return true;
  } catch {
    return false;
  }
}

function chainForNetwork(network: BitcoinNetwork) {
  if (network === "testnet4") {
    return "BITCOIN_TESTNET4";
  }

  return network === "livenet" ? "BITCOIN_MAINNET" : "BITCOIN_TESTNET";
}

function networkLabel(network: BitcoinNetwork) {
  if (network === "testnet4") {
    return "Testnet4";
  }

  return network === "livenet" ? "Mainnet" : "Testnet3";
}

function confirmDustFeeAbsorption({
  dustFeeSats,
  feeRate,
  feeSats,
}: {
  dustFeeSats?: number;
  feeRate: number;
  feeSats: number;
}) {
  const extraFeeSats = Math.max(0, Math.floor(dustFeeSats ?? 0));
  if (extraFeeSats <= 0) {
    return true;
  }

  return window.confirm(
    [
      `${extraFeeSats.toLocaleString()} sats of below-dust change will be added to the miner fee.`,
      `Selected fee rate: ${feeRate} sat/vB.`,
      `Estimated fee: ${feeSats.toLocaleString()} sats.`,
      "Use a larger confirmed UTXO or batch payments to avoid this. Continue signing?",
    ].join("\n\n"),
  );
}

function mailKey(message: MailMessage) {
  return `${message.folder}-${message.network}-${message.txid}`;
}

function sentMessageKey(
  message: Pick<SentMessage, "from" | "network" | "txid">,
) {
  return `${message.network}-${message.from}-${message.txid}`;
}

function broadcastStatusRank(status: BroadcastStatus) {
  if (status === "confirmed") {
    return 4;
  }

  if (status === "pending") {
    return 3;
  }

  if (status === "unknown") {
    return 2;
  }

  return 1;
}

function preferSentMessage(candidate: SentMessage, current: SentMessage) {
  const byStatus =
    broadcastStatusRank(sentDeliveryStatus(candidate)) -
    broadcastStatusRank(sentDeliveryStatus(current));
  if (byStatus !== 0) {
    return byStatus > 0;
  }

  if (Boolean(candidate.attachment) !== Boolean(current.attachment)) {
    return Boolean(candidate.attachment);
  }

  return Date.parse(candidate.createdAt) > Date.parse(current.createdAt);
}

function mergeSentRecord(
  preferred: SentMessage,
  fallback: SentMessage,
): SentMessage {
  return {
    ...fallback,
    ...preferred,
    attachment: preferred.attachment ?? fallback.attachment,
    confirmedAt: preferred.confirmedAt ?? fallback.confirmedAt,
    droppedAt: preferred.droppedAt ?? fallback.droppedAt,
    feeRate: preferred.feeRate || fallback.feeRate,
    lastCheckedAt: preferred.lastCheckedAt ?? fallback.lastCheckedAt,
    parentTxid: preferred.parentTxid ?? fallback.parentTxid,
    recipients: preferred.recipients ?? fallback.recipients,
    subject: preferred.subject ?? fallback.subject,
    toRecipients: preferred.toRecipients ?? fallback.toRecipients,
    ccRecipients: preferred.ccRecipients ?? fallback.ccRecipients,
  };
}

function mergeSentMessages(messages: SentMessage[]) {
  const merged = new Map<string, SentMessage>();

  for (const message of messages) {
    const key = sentMessageKey(message);
    const current = merged.get(key);

    if (!current) {
      merged.set(key, message);
      continue;
    }

    merged.set(
      key,
      preferSentMessage(message, current)
        ? mergeSentRecord(message, current)
        : mergeSentRecord(current, message),
    );
  }

  return [...merged.values()];
}

function ownedPowIds(records: PowIdRecord[], ownerOrReceiverAddress: string) {
  if (!ownerOrReceiverAddress) {
    return [];
  }

  return records.filter(
    (record) =>
      record.ownerAddress === ownerOrReceiverAddress ||
      record.receiveAddress === ownerOrReceiverAddress,
  );
}

function idRecordMatchesSearch(record: PowIdRecord, query: string) {
  return searchIncludes(
    [
      record.id,
      `${record.id}@proofofwork.me`,
      record.ownerAddress,
      record.receiveAddress,
      record.pgpKey ? "pgp" : "none",
      record.txid,
      record.network,
      networkLabel(record.network),
      record.amountSats,
      record.confirmed ? "confirmed" : "pending",
    ],
    query,
  );
}

function idListingMatchesSearch(listing: PowIdListing, query: string) {
  return searchIncludes(
    [
      listing.id,
      `${listing.id}@proofofwork.me`,
      listing.sellerAddress,
      listing.buyerAddress,
      listing.receiveAddress,
      listing.listingId,
      listing.txid,
      listing.network,
      networkLabel(listing.network),
      listing.priceSats,
      listing.confirmed ? "confirmed" : "pending",
      listing.listingVersion,
      listing.expiresAt ? "expires" : "no expiry",
    ],
    query,
  );
}

function pendingIdEventMatchesSearch(event: PowIdPendingEvent, query: string) {
  return searchIncludes(
    [
      event.id,
      event.id ? `${event.id}@proofofwork.me` : undefined,
      event.kind,
      event.currentOwnerAddress,
      event.currentReceiveAddress,
      event.ownerAddress,
      event.receiveAddress,
      event.sellerAddress,
      event.listingId,
      event.txid,
      event.network,
      networkLabel(event.network),
      event.amountSats,
      event.priceSats,
      ...event.inputAddresses,
    ],
    query,
  );
}

function pendingIdEventTouchesAddress(
  event: PowIdPendingEvent,
  targetAddress: string,
) {
  if (!targetAddress) {
    return false;
  }

  return [
    event.currentOwnerAddress,
    event.currentReceiveAddress,
    event.ownerAddress,
    event.receiveAddress,
    event.sellerAddress,
    ...event.inputAddresses,
  ].includes(targetAddress);
}

function pendingIdEventDirection(
  event: PowIdPendingEvent,
  targetAddress: string,
) {
  if (!targetAddress) {
    return "Pending";
  }

  if (
    (event.kind === "transfer" || event.kind === "marketTransfer") &&
    (event.ownerAddress === targetAddress ||
      event.receiveAddress === targetAddress)
  ) {
    return "Incoming";
  }

  if (
    event.kind === "update" &&
    event.receiveAddress === targetAddress &&
    event.currentOwnerAddress !== targetAddress &&
    !event.inputAddresses.includes(targetAddress)
  ) {
    return "Incoming";
  }

  if (
    event.currentOwnerAddress === targetAddress ||
    event.sellerAddress === targetAddress ||
    event.inputAddresses.includes(targetAddress)
  ) {
    return "Outgoing";
  }

  if (event.currentReceiveAddress === targetAddress) {
    return "Routing";
  }

  return "Pending";
}

function pendingIdEventLabel(event: PowIdPendingEvent, targetAddress: string) {
  const direction = pendingIdEventDirection(event, targetAddress);
  if (event.kind === "update") {
    return `${direction} receiver update`;
  }

  if (event.kind === "list") {
    return `${direction} listing`;
  }

  if (event.kind === "seal") {
    return `${direction} sale-ticket seal`;
  }

  if (event.kind === "delist") {
    return `${direction} delisting`;
  }

  return `${direction} ID transfer`;
}

function resolveRecipientInput(
  value: string,
  targetNetwork: BitcoinNetwork,
  registryRecords: PowIdRecord[],
  registryAddress: string,
): RecipientResolution {
  const input = value.trim();
  if (!input) {
    return { displayRecipient: "", isId: false, paymentAddress: "" };
  }

  if (isValidBitcoinAddress(input, targetNetwork)) {
    return { displayRecipient: input, isId: false, paymentAddress: input };
  }

  const id = normalizePowId(input);
  const displayRecipient = id ? `${id}@proofofwork.me` : input;
  if (!id) {
    return {
      displayRecipient,
      error: "Enter a valid Bitcoin address or ProofOfWork ID.",
      isId: true,
      paymentAddress: "",
    };
  }

  if (!registryAddress) {
    return {
      displayRecipient,
      error: `ProofOfWork ID registry is not configured for ${networkLabel(targetNetwork)}.`,
      id,
      isId: true,
      paymentAddress: "",
    };
  }

  const matchingRecords = registryRecords.filter(
    (record) => record.network === targetNetwork && record.id === id,
  );
  const confirmedRecord = matchingRecords.find((record) => record.confirmed);
  if (confirmedRecord) {
    return {
      displayRecipient,
      id,
      isId: true,
      paymentAddress: confirmedRecord.receiveAddress,
      record: confirmedRecord,
    };
  }

  // Pending IDs are deliberately not routable. A pending tx can be replaced,
  // dropped, or beaten by another valid registration before confirmation.
  const pendingRecord = matchingRecords.find((record) => !record.confirmed);
  if (pendingRecord) {
    return {
      displayRecipient,
      error: `${displayRecipient} is pending. Wait for confirmation before sending to this ID.`,
      id,
      isId: true,
      paymentAddress: "",
      record: pendingRecord,
    };
  }

  return {
    displayRecipient,
    error: `No confirmed ProofOfWork ID found for ${displayRecipient}.`,
    id,
    isId: true,
    paymentAddress: "",
  };
}

function resolvePowIdOwnerInput(
  value: string,
  targetNetwork: BitcoinNetwork,
  registryRecords: PowIdRecord[],
  registryAddress: string,
): PowIdOwnerResolution {
  const input = value.trim();
  if (!input) {
    return {
      displayRecipient: "",
      isId: false,
      ownerAddress: "",
      receiveAddress: "",
    };
  }

  if (isValidBitcoinAddress(input, targetNetwork)) {
    return {
      displayRecipient: input,
      isId: false,
      ownerAddress: input,
      receiveAddress: input,
    };
  }

  const id = normalizePowId(input);
  const displayRecipient = id ? `${id}@proofofwork.me` : input;
  if (!id) {
    return {
      displayRecipient,
      error: "Enter a valid Bitcoin address or confirmed ProofOfWork ID.",
      isId: true,
      ownerAddress: "",
      receiveAddress: "",
    };
  }

  if (!registryAddress) {
    return {
      displayRecipient,
      error: `ProofOfWork ID registry is not configured for ${networkLabel(targetNetwork)}.`,
      id,
      isId: true,
      ownerAddress: "",
      receiveAddress: "",
    };
  }

  const matchingRecords = registryRecords.filter(
    (record) => record.network === targetNetwork && record.id === id,
  );
  const confirmedRecord = matchingRecords.find((record) => record.confirmed);
  if (confirmedRecord) {
    return {
      displayRecipient,
      id,
      isId: true,
      ownerAddress: confirmedRecord.ownerAddress,
      receiveAddress: confirmedRecord.receiveAddress,
      record: confirmedRecord,
    };
  }

  const pendingRecord = matchingRecords.find((record) => !record.confirmed);
  if (pendingRecord) {
    return {
      displayRecipient,
      error: `${displayRecipient} is pending. Wait for confirmation before transferring to this ID.`,
      id,
      isId: true,
      ownerAddress: "",
      receiveAddress: "",
      record: pendingRecord,
    };
  }

  return {
    displayRecipient,
    error: `No confirmed ProofOfWork ID found for ${displayRecipient}.`,
    id,
    isId: true,
    ownerAddress: "",
    receiveAddress: "",
  };
}

function splitRecipientInputs(value: string) {
  return value
    .split(/[,;\n]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveRecipientInputs(
  value: string,
  targetNetwork: BitcoinNetwork,
  registryRecords: PowIdRecord[],
  registryAddress: string,
): MultiRecipientResolution {
  const inputs = splitRecipientInputs(value);
  if (inputs.length === 0) {
    return { duplicateCount: 0, idCount: 0, recipients: [] };
  }

  if (inputs.length > MAX_RECIPIENTS) {
    return {
      duplicateCount: 0,
      error: `Send to ${MAX_RECIPIENTS} recipients or fewer for now.`,
      idCount: 0,
      recipients: [],
    };
  }

  const recipients: RecipientResolution[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  let idCount = 0;

  for (const input of inputs) {
    const resolved = resolveRecipientInput(
      input,
      targetNetwork,
      registryRecords,
      registryAddress,
    );
    if (resolved.error || !resolved.paymentAddress) {
      return {
        duplicateCount,
        error:
          resolved.error ||
          "Enter valid Bitcoin addresses or confirmed ProofOfWork IDs.",
        idCount,
        recipients,
      };
    }

    if (resolved.isId) {
      idCount += 1;
    }

    const key = resolved.paymentAddress;
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }

    seen.add(key);
    recipients.push(resolved);
  }

  return { duplicateCount, idCount, recipients };
}

function needsRegistryResolution(value: string, targetNetwork: BitcoinNetwork) {
  return splitRecipientInputs(value).some(
    (input) => !isValidBitcoinAddress(input, targetNetwork),
  );
}

function recipientResolutionNote(resolution: MultiRecipientResolution) {
  if (resolution.error) {
    return resolution.error;
  }

  if (resolution.recipients.length === 0) {
    return "";
  }

  const pieces = [
    `${resolution.recipients.length} recipient${resolution.recipients.length === 1 ? "" : "s"}`,
  ];
  if (resolution.idCount > 0) {
    pieces.push(
      `${resolution.idCount} confirmed ID${resolution.idCount === 1 ? "" : "s"} resolved`,
    );
  }

  if (resolution.duplicateCount > 0) {
    pieces.push(
      `${resolution.duplicateCount} duplicate${resolution.duplicateCount === 1 ? "" : "s"} skipped`,
    );
  }

  return pieces.join(" · ");
}

function ownerResolutionNote(resolution: PowIdOwnerResolution) {
  if (resolution.error) {
    return resolution.error;
  }

  if (!resolution.ownerAddress) {
    return "";
  }

  if (resolution.isId) {
    return `${resolution.displayRecipient} resolves to owner ${shortAddress(resolution.ownerAddress)} and receiver ${shortAddress(resolution.receiveAddress)}.`;
  }

  return "Raw Bitcoin owner address.";
}

function receiveResolutionNote(resolution: RecipientResolution) {
  if (resolution.error) {
    return resolution.error;
  }

  if (!resolution.paymentAddress) {
    return "";
  }

  if (resolution.isId) {
    return `${resolution.displayRecipient} resolves to receiver ${shortAddress(resolution.paymentAddress)}.`;
  }

  return "Raw Bitcoin receive address.";
}

function explorerNetworkFor(
  messageNetwork: BitcoinNetwork,
  activeNetwork: BitcoinNetwork,
) {
  if (messageNetwork === "livenet" || activeNetwork === "livenet") {
    return messageNetwork;
  }

  return activeNetwork;
}

function rootTxid(message: MailMessage) {
  return message.parentTxid ?? message.txid;
}

function isInboundFolder(folder: MailMessage["folder"]) {
  return folder === "inbox" || folder === "incoming";
}

function peerAddress(message: MailMessage) {
  return isInboundFolder(message.folder)
    ? message.from
    : recipientSummary(message.recipients, message.to);
}

function recipientSummary(
  recipients: MailRecipient[] | undefined,
  fallback: string,
) {
  if (!recipients || recipients.length === 0) {
    return fallback;
  }

  const first = recipients[0];
  return recipients.length === 1
    ? first.display
    : `${first.display} +${recipients.length - 1}`;
}

function recipientListText(
  recipients: MailRecipient[] | undefined,
  fallback: string,
) {
  if (!recipients || recipients.length === 0) {
    return fallback;
  }

  return recipients.map((recipient) => recipient.display).join(", ");
}

function recipientInputSummary(value: string) {
  const inputs = splitRecipientInputs(value);
  if (inputs.length === 0) {
    return "No recipient";
  }

  return inputs.length === 1
    ? shortAddress(inputs[0])
    : `${shortAddress(inputs[0])} +${inputs.length - 1}`;
}

function totalRecipientSats(recipients: MailRecipient[]) {
  return recipients.reduce(
    (total, recipient) => total + recipient.amountSats,
    0,
  );
}

function messageReplyAmount(message: MailMessage) {
  return message.recipients?.[0]?.amountSats ?? message.amountSats;
}

function hasAttachment(
  message: MailMessage,
): message is MailMessage & { attachment: MailAttachment } {
  return Boolean(message.attachment);
}

function normalizeBroadcastStatus(status: unknown): BroadcastStatus {
  if (status === "confirmed" || status === "pending" || status === "dropped") {
    return status;
  }

  return "unknown";
}

function sentDeliveryStatus(message: Pick<SentMessage, "status">) {
  return normalizeBroadcastStatus(message.status);
}

function deliveryLabel(status: BroadcastStatus) {
  if (status === "confirmed") {
    return "Confirmed";
  }

  if (status === "dropped") {
    return "Dropped";
  }

  return status === "pending" ? "Pending" : "Checking";
}

function isVisibleSentStatus(status: BroadcastStatus) {
  return status === "confirmed" || status === "unknown";
}

function isOutboxStatus(status: BroadcastStatus) {
  return status === "pending" || status === "dropped";
}

function folderLabel(folder: Folder) {
  if (folder === "inbox") {
    return "Inbox";
  }

  if (folder === "incoming") {
    return "Incoming";
  }

  if (folder === "sent") {
    return "Sent";
  }

  if (folder === "outbox") {
    return "Outbox";
  }

  if (folder === "drafts") {
    return "Drafts";
  }

  if (folder === "favorites") {
    return "Favorites";
  }

  if (folder === "ids") {
    return "IDs";
  }

  if (folder === "marketplace") {
    return "Marketplace";
  }

  if (folder === "token") {
    return "Token";
  }

  if (folder === "wallet") {
    return "Wallet";
  }

  if (folder === "work") {
    return "WORK";
  }

  if (folder === "log") {
    return "Log";
  }

  if (folder === "desktop") {
    return "Desktop";
  }

  if (folder === "browser") {
    return "Browser";
  }

  if (folder === "contacts") {
    return "Contacts";
  }

  return folder === "archive" ? "Archive" : "Files";
}

function folderSubtitle(folder: Folder) {
  if (folder === "inbox") {
    return "Confirmed received mail";
  }

  if (folder === "incoming") {
    return "Pending received mail";
  }

  if (folder === "sent") {
    return "Confirmed and recovered sent mail";
  }

  if (folder === "outbox") {
    return "Pending and dropped broadcasts";
  }

  if (folder === "drafts") {
    return "Local unsent mail";
  }

  if (folder === "favorites") {
    return "Starred confirmed mail";
  }

  if (folder === "ids") {
    return "ProofOfWork ID registry";
  }

  if (folder === "marketplace") {
    return "ID listings and transfers";
  }

  if (folder === "token") {
    return "Token creation and minting";
  }

  if (folder === "wallet") {
    return "Token balances and transfers";
  }

  if (folder === "work") {
    return "WORK token dashboard";
  }

  if (folder === "log") {
    return "Chain-readable computer log";
  }

  if (folder === "desktop") {
    return "Public file desktop";
  }

  if (folder === "browser") {
    return "Verified HTML pages";
  }

  if (folder === "contacts") {
    return "Local address book";
  }

  return folder === "archive"
    ? "Local archived mail"
    : "Attachments across mail";
}

function mailboxSummary(
  inboxMessages: InboxMessage[],
  sentMessages: SentMessage[],
) {
  const inboxCount = inboxMessages.filter(
    (message) => message.confirmed,
  ).length;
  const incomingCount = inboxMessages.length - inboxCount;
  const sentCount = sentMessages.filter((message) =>
    isVisibleSentStatus(sentDeliveryStatus(message)),
  ).length;
  const outboxCount = sentMessages.filter((message) =>
    isOutboxStatus(sentDeliveryStatus(message)),
  ).length;
  return `${inboxCount} inbox, ${incomingCount} incoming, ${sentCount} sent, ${outboxCount} outbox`;
}

function selectedInboundKey(folder: Folder, inboxMessages: InboxMessage[]) {
  if (folder !== "inbox" && folder !== "incoming") {
    return "";
  }

  const confirmed = folder === "inbox";
  const message = inboxMessages.find(
    (inboxMessage) => inboxMessage.confirmed === confirmed,
  );
  return message ? mailKey({ ...message, folder }) : "";
}

function mailSubject(memo: string) {
  const firstLine = memo
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine ? firstLine.slice(0, 90) : "OP_RETURN message";
}

function messageSubject(message: {
  attachment?: MailAttachment;
  memo: string;
  subject?: string;
}) {
  const subject =
    normalizeSubject(message.subject ?? "") || mailSubject(message.memo);
  if (subject !== "OP_RETURN message") {
    return subject;
  }

  return message.attachment
    ? `Attachment: ${message.attachment.name}`
    : subject;
}

function mailPreview(message: { attachment?: MailAttachment; memo: string }) {
  const preview = message.memo.replace(/\s+/g, " ").trim().slice(0, 180);
  if (preview) {
    return preview;
  }

  return message.attachment
    ? `${message.attachment.name} (${formatBytes(message.attachment.size)})`
    : "";
}

function attachmentHref(attachment: MailAttachment) {
  return `data:${attachment.mime};base64,${base64FromBase64Url(attachment.data)}`;
}

function attachmentKind(attachment: MailAttachment): FileFilter {
  const mime = attachment.mime.toLowerCase();
  const name = attachment.name.toLowerCase();

  if (mime.startsWith("image/")) {
    return "image";
  }

  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    return "pdf";
  }

  if (
    mime.includes("document") ||
    mime.includes("msword") ||
    mime.includes("opendocument") ||
    mime.startsWith("text/") ||
    /\.(doc|docx|odt|rtf|txt|md|csv)$/u.test(name)
  ) {
    return "document";
  }

  return "other";
}

function fileKindForMessage(message: MailMessage & { attachment: MailAttachment }) {
  return attachmentKind(message.attachment);
}

function isImageAttachment(attachment: MailAttachment) {
  return attachment.mime.toLowerCase().startsWith("image/");
}

function isAudioAttachment(attachment: MailAttachment) {
  return attachment.mime.toLowerCase().startsWith("audio/");
}

function isVideoAttachment(attachment: MailAttachment) {
  return attachment.mime.toLowerCase().startsWith("video/");
}

function isPdfAttachment(attachment: MailAttachment) {
  return (
    attachment.mime.toLowerCase() === "application/pdf" ||
    attachment.name.toLowerCase().endsWith(".pdf")
  );
}

function isTextAttachment(attachment: MailAttachment) {
  const mime = attachment.mime.toLowerCase();
  const name = attachment.name.toLowerCase();

  return (
    mime.startsWith("text/") ||
    [
      "application/json",
      "application/javascript",
      "application/typescript",
      "application/xml",
      "application/yaml",
      "application/x-yaml",
      "application/toml",
      "application/sql",
      "image/svg+xml",
    ].includes(mime) ||
    /\.(c|cc|cpp|cs|css|csv|env|go|h|hpp|html|java|js|json|jsx|kt|lua|md|php|pl|py|r|rb|rs|sh|sol|sql|svelte|swift|toml|ts|tsx|txt|vue|xml|yaml|yml)$/u.test(
      name,
    )
  );
}

function attachmentPreviewKind(
  attachment: MailAttachment,
): AttachmentPreviewKind {
  if (isImageAttachment(attachment)) {
    return "image";
  }

  if (isAudioAttachment(attachment)) {
    return "audio";
  }

  if (isVideoAttachment(attachment)) {
    return "video";
  }

  if (isPdfAttachment(attachment)) {
    return "pdf";
  }

  if (isTextAttachment(attachment)) {
    return "text";
  }

  return "unsupported";
}

function attachmentText(attachment: MailAttachment) {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(
      base64UrlDecodeBytes(attachment.data),
    );
  } catch {
    return "";
  }
}

function attachmentCodeLabel(attachment: MailAttachment) {
  const mime = attachment.mime.toLowerCase();
  const extension = attachment.name.split(".").pop()?.toLowerCase();

  if (mime === "application/json" || extension === "json") {
    return "JSON";
  }

  if (extension) {
    return extension.toUpperCase();
  }

  return mime.startsWith("text/") ? "Text" : "Code";
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.left = "-9999px";
  textarea.style.position = "fixed";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function fileFilterLabel(filter: FileFilter) {
  if (filter === "image") {
    return "Images";
  }

  if (filter === "pdf") {
    return "PDFs";
  }

  if (filter === "document") {
    return "Documents";
  }

  return filter === "other" ? "Other" : "All files";
}

function normalizeAttachmentName(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, 120) || "attachment";
}

function normalizeAttachmentMime(mime: string) {
  return mime.trim().slice(0, 120) || "application/octet-stream";
}

async function attachmentFromFile(file: File): Promise<MailAttachment> {
  if (file.size <= 0) {
    throw new Error("Attachment is empty.");
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `Attachment must be ${formatBytes(MAX_ATTACHMENT_BYTES)} or smaller.`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    data: base64UrlEncodeBytes(bytes),
    mime: normalizeAttachmentMime(file.type),
    name: normalizeAttachmentName(file.name),
    sha256: sha256Hex(bytes),
    size: bytes.byteLength,
  };
}

function buildAttachmentPayloads(attachment: MailAttachment) {
  const metadataPrefix = `${PROTOCOL_PREFIX}a:${encodeTextBase64Url(attachment.mime)}:${encodeTextBase64Url(
    attachment.name,
  )}:${attachment.size}:${attachment.sha256}:`;
  const maxChunkBytes = maxPayloadDataBytes(`${metadataPrefix}999/999:`);
  const chunks = chunkAscii(attachment.data, Math.max(1, maxChunkBytes));

  return chunks.map(
    (chunk, index) => `${metadataPrefix}${index}/${chunks.length}:${chunk}`,
  );
}

function buildProtocolPayloads(
  subject: string,
  message: string,
  parentTxid?: string,
  attachment?: MailAttachment,
) {
  const bodyPrefix = `${PROTOCOL_PREFIX}m:`;
  const bodyChunkBytes = maxPayloadDataBytes(bodyPrefix);
  const payloads: string[] = [];
  const trimmedSubject = normalizeSubject(subject);

  if (trimmedSubject) {
    payloads.push(`${PROTOCOL_PREFIX}s:${encodeTextBase64Url(trimmedSubject)}`);
  }

  if (parentTxid) {
    payloads.push(`${PROTOCOL_PREFIX}r:${parentTxid}`);
  }

  for (const chunk of chunkUtf8(message, bodyChunkBytes)) {
    payloads.push(`${bodyPrefix}${chunk}`);
  }

  if (attachment) {
    payloads.push(...buildAttachmentPayloads(attachment));
  }

  return payloads;
}

function normalizePowId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/u, "")
    .replace(/@proofofwork\.me$/u, "")
    .trim();
}

function powIdError(id: string) {
  if (!id) {
    return "Enter an ID.";
  }

  return "";
}

function buildIdRegistrationPayload(
  id: string,
  ownerAddress: string,
  receiveAddress: string,
  pgpKey: string,
) {
  const pgp = pgpKey.trim();
  return `${ID_PROTOCOL_PREFIX}r2:${encodeTextBase64Url(id)}:${ownerAddress}:${receiveAddress}${pgp ? `:${encodeTextBase64Url(pgp)}` : ""}`;
}

function buildIdReceiverUpdatePayload(id: string, receiveAddress: string) {
  return `${ID_PROTOCOL_PREFIX}u:${encodeTextBase64Url(id)}:${receiveAddress}`;
}

function buildIdTransferPayload(
  id: string,
  ownerAddress: string,
  receiveAddress: string,
) {
  const receiver = receiveAddress.trim();
  return `${ID_PROTOCOL_PREFIX}t:${encodeTextBase64Url(id)}:${ownerAddress}${receiver ? `:${receiver}` : ""}`;
}

function saleAuthorizationDraft({
  anchorSigHashType,
  anchorSignature,
  anchorScriptPubKey,
  anchorTxid,
  anchorType,
  anchorValueSats,
  anchorVout,
  buyerAddress,
  expiresAt,
  id,
  nonce,
  priceSats,
  receiveAddress,
  sellerAddress,
  sellerPublicKey,
  version = ID_SALE_AUTH_VERSION,
}: {
  anchorSigHashType?: number;
  anchorSignature?: string;
  anchorScriptPubKey?: string;
  anchorTxid?: string;
  anchorType?: string;
  anchorValueSats?: number;
  anchorVout?: number;
  buyerAddress?: string;
  expiresAt?: string;
  id: string;
  nonce: string;
  priceSats: number;
  receiveAddress?: string;
  sellerAddress: string;
  sellerPublicKey?: string;
  version?: PowIdSaleAuthorizationDraft["version"];
}): PowIdSaleAuthorizationDraft {
  const draft: PowIdSaleAuthorizationDraft = {
    buyerAddress: buyerAddress?.trim() || undefined,
    expiresAt: expiresAt?.trim() || undefined,
    id: normalizePowId(id),
    nonce,
    priceSats: Math.floor(priceSats),
    receiveAddress: receiveAddress?.trim() || undefined,
    sellerAddress: sellerAddress.trim(),
    sellerPublicKey: sellerPublicKey?.trim().toLowerCase() || undefined,
    version,
  };

  if (
    version === ID_SALE_AUTH_VERSION_ANCHORED ||
    version === ID_SALE_AUTH_VERSION ||
    version === ID_SALE_AUTH_VERSION_TICKET
  ) {
    draft.anchorSigHashType =
      typeof anchorSigHashType === "number" &&
      Number.isSafeInteger(anchorSigHashType)
        ? Math.floor(anchorSigHashType)
        : version === ID_SALE_AUTH_VERSION ||
            version === ID_SALE_AUTH_VERSION_TICKET
          ? ID_LISTING_ANCHOR_SIGHASH_TYPE
          : undefined;
    draft.anchorSignature = anchorSignature?.trim().toLowerCase() || undefined;
    draft.anchorScriptPubKey =
      anchorScriptPubKey?.trim().toLowerCase() || undefined;
    draft.anchorTxid = anchorTxid?.trim().toLowerCase() || undefined;
    draft.anchorType =
      anchorType?.trim() ||
      (version === ID_SALE_AUTH_VERSION_TICKET
        ? ID_LISTING_TICKET_ANCHOR_TYPE
        : version === ID_SALE_AUTH_VERSION
          ? ID_LISTING_ANCHOR_TYPE
          : ID_LISTING_ANCHOR_TYPE_LEGACY);
    draft.anchorValueSats =
      typeof anchorValueSats === "number" &&
      Number.isSafeInteger(anchorValueSats)
        ? Math.floor(anchorValueSats)
        : ID_LISTING_ANCHOR_VALUE_SATS;
    draft.anchorVout =
      typeof anchorVout === "number" && Number.isSafeInteger(anchorVout)
        ? Math.floor(anchorVout)
        : ID_LISTING_ANCHOR_VOUT;

    if (
      version === ID_SALE_AUTH_VERSION_ANCHORED &&
      !draft.anchorScriptPubKey
    ) {
      draft.anchorScriptPubKey = marketplaceLegacyAnchorScriptPubKey("livenet");
    }
  }

  return draft;
}

function saleAuthorizationMessage(authorization: PowIdSaleAuthorizationDraft) {
  const lines = [
    "ProofOfWork.Me ID Sale",
    `version:${authorization.version}`,
    `id:${normalizePowId(authorization.id)}@proofofwork.me`,
    `seller:${authorization.sellerAddress}`,
    `priceSats:${Math.floor(authorization.priceSats)}`,
    `buyer:${authorization.buyerAddress || "*"}`,
    `receiver:${authorization.receiveAddress || "*"}`,
    `nonce:${authorization.nonce}`,
    `expiresAt:${authorization.expiresAt || ""}`,
  ];

  if (
    authorization.version === ID_SALE_AUTH_VERSION_ANCHORED ||
    authorization.version === ID_SALE_AUTH_VERSION ||
    authorization.version === ID_SALE_AUTH_VERSION_TICKET
  ) {
    lines.push(
      `anchorType:${authorization.anchorType || ""}`,
      `anchorTxid:${authorization.anchorTxid || ""}`,
      `anchorVout:${authorization.anchorVout ?? ""}`,
      `anchorValueSats:${authorization.anchorValueSats ?? ""}`,
      `anchorScriptPubKey:${authorization.anchorScriptPubKey || ""}`,
      `anchorSigHashType:${authorization.anchorSigHashType ?? ""}`,
      `sellerPublicKey:${authorization.sellerPublicKey || ""}`,
    );
  }

  return lines.join("\n");
}

function saleAuthorizationWithoutSignature(
  authorization: PowIdSaleAuthorization,
): PowIdSaleAuthorizationDraft {
  return saleAuthorizationDraft(authorization);
}

function parseSaleAuthorizationText(
  value: string,
  targetNetwork: BitcoinNetwork,
): PowIdSaleAuthorization {
  const parsed = JSON.parse(value) as unknown;
  if (!isPlainRecord(parsed)) {
    throw new Error("Sale authorization must be a JSON object.");
  }

  const id = normalizePowId(typeof parsed.id === "string" ? parsed.id : "");
  const sellerAddress =
    typeof parsed.sellerAddress === "string" ? parsed.sellerAddress.trim() : "";
  const buyerAddress =
    typeof parsed.buyerAddress === "string" ? parsed.buyerAddress.trim() : "";
  const receiveAddress =
    typeof parsed.receiveAddress === "string"
      ? parsed.receiveAddress.trim()
      : "";
  const signature =
    typeof parsed.signature === "string" ? parsed.signature.trim() : "";
  const nonce = typeof parsed.nonce === "string" ? parsed.nonce.trim() : "";
  const expiresAt =
    typeof parsed.expiresAt === "string" ? parsed.expiresAt.trim() : "";
  const priceSats =
    typeof parsed.priceSats === "number"
      ? Math.floor(parsed.priceSats)
      : Number.NaN;
  const version =
    parsed.version === ID_SALE_AUTH_VERSION_LEGACY
      ? ID_SALE_AUTH_VERSION_LEGACY
      : parsed.version === ID_SALE_AUTH_VERSION_ANCHORED
        ? ID_SALE_AUTH_VERSION_ANCHORED
        : parsed.version === ID_SALE_AUTH_VERSION
          ? ID_SALE_AUTH_VERSION
          : parsed.version === ID_SALE_AUTH_VERSION_TICKET
            ? ID_SALE_AUTH_VERSION_TICKET
            : "";
  const anchorType =
    typeof parsed.anchorType === "string" ? parsed.anchorType.trim() : "";
  const anchorSigHashType =
    typeof parsed.anchorSigHashType === "number"
      ? Math.floor(parsed.anchorSigHashType)
      : Number.NaN;
  const anchorSignature =
    typeof parsed.anchorSignature === "string"
      ? parsed.anchorSignature.trim().toLowerCase()
      : "";
  const anchorScriptPubKey =
    typeof parsed.anchorScriptPubKey === "string"
      ? parsed.anchorScriptPubKey.trim().toLowerCase()
      : "";
  const anchorTxid =
    typeof parsed.anchorTxid === "string"
      ? parsed.anchorTxid.trim().toLowerCase()
      : "";
  const anchorVout =
    typeof parsed.anchorVout === "number"
      ? Math.floor(parsed.anchorVout)
      : Number.NaN;
  const anchorValueSats =
    typeof parsed.anchorValueSats === "number"
      ? Math.floor(parsed.anchorValueSats)
      : Number.NaN;
  const sellerPublicKey =
    typeof parsed.sellerPublicKey === "string"
      ? parsed.sellerPublicKey.trim().toLowerCase()
      : "";

  if (!version) {
    throw new Error("Sale authorization version is not supported.");
  }

  const idError = powIdError(id);
  if (idError) {
    throw new Error(idError);
  }

  if (!isValidBitcoinAddress(sellerAddress, targetNetwork)) {
    throw new Error("Seller address is not valid for the selected network.");
  }

  if (buyerAddress && !isValidBitcoinAddress(buyerAddress, targetNetwork)) {
    throw new Error("Buyer address is not valid for the selected network.");
  }

  if (receiveAddress && !isValidBitcoinAddress(receiveAddress, targetNetwork)) {
    throw new Error("Receive address is not valid for the selected network.");
  }

  if (!Number.isSafeInteger(priceSats) || priceSats < 0) {
    throw new Error("Sale price must be zero or more sats.");
  }

  if (!nonce || nonce.length > 160) {
    throw new Error("Sale authorization nonce is missing.");
  }

  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
    throw new Error("Sale authorization expiry is not a valid date.");
  }

  if (version === ID_SALE_AUTH_VERSION_ANCHORED) {
    if (anchorType !== ID_LISTING_ANCHOR_TYPE_LEGACY) {
      throw new Error("Listing anchor type is not supported.");
    }

    if (
      !Number.isSafeInteger(anchorVout) ||
      anchorVout < 0 ||
      !Number.isSafeInteger(anchorValueSats) ||
      anchorValueSats < DUST_SATS ||
      anchorScriptPubKey !== marketplaceLegacyAnchorScriptPubKey(targetNetwork)
    ) {
      throw new Error("Listing anchor is invalid.");
    }
  }

  if (version === ID_SALE_AUTH_VERSION) {
    if (anchorType !== ID_LISTING_ANCHOR_TYPE) {
      throw new Error("Listing anchor type is not supported.");
    }

    if (
      !/^[0-9a-f]{64}$/u.test(anchorTxid) ||
      !Number.isSafeInteger(anchorVout) ||
      anchorVout < 0 ||
      !Number.isSafeInteger(anchorValueSats) ||
      anchorValueSats < DUST_SATS ||
      !/^[0-9a-f]+$/u.test(anchorScriptPubKey) ||
      !validPublicKeyHex(sellerPublicKey) ||
      anchorSigHashType !== ID_LISTING_ANCHOR_SIGHASH_TYPE ||
      !validSignatureHex(anchorSignature)
    ) {
      throw new Error("Listing anchor is invalid.");
    }
  }

  if (version === ID_SALE_AUTH_VERSION_TICKET) {
    if (
      anchorType !== ID_LISTING_TICKET_ANCHOR_TYPE ||
      !Number.isSafeInteger(anchorVout) ||
      anchorVout < 0 ||
      !Number.isSafeInteger(anchorValueSats) ||
      anchorValueSats < DUST_SATS ||
      !/^[0-9a-f]+$/u.test(anchorScriptPubKey) ||
      !validPublicKeyHex(sellerPublicKey) ||
      anchorSigHashType !== ID_LISTING_ANCHOR_SIGHASH_TYPE ||
      (anchorSignature && !validSignatureHex(anchorSignature))
    ) {
      throw new Error("Listing sale ticket is invalid.");
    }
  }

  return {
    ...saleAuthorizationDraft({
      anchorSigHashType,
      anchorSignature,
      anchorScriptPubKey,
      anchorTxid,
      anchorType,
      anchorValueSats,
      anchorVout,
      buyerAddress,
      expiresAt,
      id,
      nonce,
      priceSats,
      receiveAddress,
      sellerAddress,
      sellerPublicKey,
      version,
    }),
    signature,
  };
}

function parseSaleAuthorizationJson(
  value: string,
  targetNetwork: BitcoinNetwork,
): PowIdSaleAuthorization {
  return parseSaleAuthorizationText(value, targetNetwork);
}

function saleAuthorizationCanBroadcast(authorization: PowIdSaleAuthorization) {
  return (
    (authorization.version === ID_SALE_AUTH_VERSION_ANCHORED ||
      authorization.version === ID_SALE_AUTH_VERSION ||
      (authorization.version === ID_SALE_AUTH_VERSION_TICKET &&
        saleAuthorizationUsesSaleTicketAnchor(authorization))) &&
    Boolean(authorization.id && authorization.nonce)
  );
}

function saleAuthorizationVerified(_authorization: PowIdSaleAuthorization) {
  // Browser builds intentionally do not bundle the Node-oriented BIP322 verifier.
  // The production API/indexer performs canonical legacy buy2 signature verification.
  return false;
}

function saleAuthorizationTermsMatch(
  left: PowIdSaleAuthorization,
  right: PowIdSaleAuthorization,
) {
  const leftTerms = saleAuthorizationDraft(left);
  const rightTerms = saleAuthorizationDraft(right);
  return JSON.stringify(leftTerms) === JSON.stringify(rightTerms);
}

function saleAuthorizationTermsMatchIgnoringSeal(
  left: PowIdSaleAuthorization,
  right: PowIdSaleAuthorization,
) {
  const leftTerms = saleAuthorizationDraft({
    ...left,
    anchorSignature: undefined,
    anchorTxid: undefined,
  });
  const rightTerms = saleAuthorizationDraft({
    ...right,
    anchorSignature: undefined,
    anchorTxid: undefined,
  });
  return JSON.stringify(leftTerms) === JSON.stringify(rightTerms);
}

function findMatchingActiveListing(
  listings: Map<string, PowIdListing>,
  authorization: PowIdSaleAuthorization,
  currentOwnerAddress: string,
) {
  for (const listing of listings.values()) {
    if (
      listing.listingVersion !== "list3" &&
      listing.id === authorization.id &&
      listing.sellerAddress === authorization.sellerAddress &&
      listing.sellerAddress === currentOwnerAddress &&
      saleAuthorizationTermsMatch(listing.saleAuthorization, authorization)
    ) {
      return listing;
    }
  }

  return undefined;
}

function saleAuthorizationHasAnchor(
  authorization: PowIdSaleAuthorization,
): authorization is PowIdSaleAuthorization & {
  anchorSigHashType?: number;
  anchorSignature?: string;
  anchorScriptPubKey: string;
  anchorTxid?: string;
  anchorType: string;
  anchorValueSats: number;
  anchorVout: number;
  sellerPublicKey?: string;
} {
  return (
    (authorization.version === ID_SALE_AUTH_VERSION_ANCHORED ||
      authorization.version === ID_SALE_AUTH_VERSION ||
      authorization.version === ID_SALE_AUTH_VERSION_TICKET) &&
    (authorization.anchorType === ID_LISTING_ANCHOR_TYPE_LEGACY ||
      authorization.anchorType === ID_LISTING_ANCHOR_TYPE ||
      authorization.anchorType === ID_LISTING_TICKET_ANCHOR_TYPE) &&
    typeof authorization.anchorScriptPubKey === "string" &&
    /^[0-9a-f]+$/u.test(authorization.anchorScriptPubKey) &&
    typeof authorization.anchorVout === "number" &&
    Number.isSafeInteger(authorization.anchorVout) &&
    typeof authorization.anchorValueSats === "number" &&
    Number.isSafeInteger(authorization.anchorValueSats) &&
    authorization.anchorValueSats >= DUST_SATS
  );
}

function saleAuthorizationUsesSellerUtxoAnchor(
  authorization: PowIdSaleAuthorization,
): authorization is PowIdSaleAuthorization & {
  anchorSigHashType: number;
  anchorSignature: string;
  anchorScriptPubKey: string;
  anchorTxid: string;
  anchorType: string;
  anchorValueSats: number;
  anchorVout: number;
  sellerPublicKey: string;
} {
  return (
    saleAuthorizationHasAnchor(authorization) &&
    authorization.version === ID_SALE_AUTH_VERSION &&
    authorization.anchorType === ID_LISTING_ANCHOR_TYPE &&
    typeof authorization.anchorTxid === "string" &&
    /^[0-9a-f]{64}$/u.test(authorization.anchorTxid) &&
    typeof authorization.sellerPublicKey === "string" &&
    validPublicKeyHex(authorization.sellerPublicKey) &&
    authorization.anchorSigHashType === ID_LISTING_ANCHOR_SIGHASH_TYPE &&
    typeof authorization.anchorSignature === "string" &&
    validSignatureHex(authorization.anchorSignature)
  );
}

function saleAuthorizationUsesSaleTicketAnchor(
  authorization: PowIdSaleAuthorization,
): authorization is PowIdSaleAuthorization & {
  anchorSigHashType: number;
  anchorSignature: string;
  anchorScriptPubKey: string;
  anchorTxid: string;
  anchorType: string;
  anchorValueSats: number;
  anchorVout: number;
  sellerPublicKey: string;
} {
  return (
    saleAuthorizationHasAnchor(authorization) &&
    authorization.version === ID_SALE_AUTH_VERSION_TICKET &&
    authorization.anchorType === ID_LISTING_TICKET_ANCHOR_TYPE &&
    typeof authorization.anchorTxid === "string" &&
    /^[0-9a-f]{64}$/u.test(authorization.anchorTxid) &&
    typeof authorization.sellerPublicKey === "string" &&
    validPublicKeyHex(authorization.sellerPublicKey) &&
    authorization.anchorSigHashType === ID_LISTING_ANCHOR_SIGHASH_TYPE &&
    typeof authorization.anchorSignature === "string" &&
    validSignatureHex(authorization.anchorSignature)
  );
}

function listingAnchorOutpoint(listing: PowIdListing) {
  if (!saleAuthorizationHasAnchor(listing.saleAuthorization)) {
    return null;
  }

  return {
    txid: saleAuthorizationUsesSellerUtxoAnchor(listing.saleAuthorization)
      ? listing.saleAuthorization.anchorTxid
      : listing.listingId,
    vout: listing.saleAuthorization.anchorVout,
  };
}

function activeListingAnchorOutpointsForAddress(
  listings: PowIdListing[],
  address: string,
  {
    exceptListingId,
    network,
  }: {
    exceptListingId?: string;
    network?: BitcoinNetwork;
  } = {},
): PowIdSpentOutpoint[] {
  if (!address) {
    return [];
  }

  return listings.flatMap((listing) => {
    if (network && listing.network !== network) {
      return [];
    }

    if (exceptListingId && listing.listingId === exceptListingId) {
      return [];
    }

    if (listing.sellerAddress !== address) {
      return [];
    }

    const anchor = listingAnchorOutpoint(listing);
    return anchor ? [anchor] : [];
  });
}

function spendsListingAnchor(
  spentOutpoints: PowIdSpentOutpoint[],
  listing: PowIdListing,
) {
  const anchor = listingAnchorOutpoint(listing);
  return Boolean(
    anchor &&
    spentOutpoints.some(
      (outpoint) =>
        outpoint.txid === anchor.txid && outpoint.vout === anchor.vout,
    ),
  );
}

function sellerPaymentRequiredSats(listing: PowIdListing) {
  const anchorValue = saleAuthorizationHasAnchor(listing.saleAuthorization)
    ? listing.saleAuthorization.anchorValueSats
    : 0;
  return listing.priceSats + anchorValue;
}

function listingAnchorIsPresent(
  vout: Array<Record<string, unknown>>,
  authorization: PowIdSaleAuthorization,
) {
  if (!saleAuthorizationHasAnchor(authorization)) {
    return false;
  }

  if (
    authorization.version !== ID_SALE_AUTH_VERSION_ANCHORED &&
    authorization.version !== ID_SALE_AUTH_VERSION_TICKET
  ) {
    return false;
  }

  if (
    authorization.version === ID_SALE_AUTH_VERSION_ANCHORED &&
    authorization.anchorType !== ID_LISTING_ANCHOR_TYPE_LEGACY
  ) {
    return false;
  }

  if (
    authorization.version === ID_SALE_AUTH_VERSION_TICKET &&
    authorization.anchorType !== ID_LISTING_TICKET_ANCHOR_TYPE
  ) {
    return false;
  }

  const output = vout[authorization.anchorVout];
  return (
    output?.scriptpubkey === authorization.anchorScriptPubKey &&
    typeof output.value === "number" &&
    output.value === authorization.anchorValueSats
  );
}

async function listingAnchorSpent(
  listing: PowIdListing,
  network: BitcoinNetwork,
) {
  const anchor = listingAnchorOutpoint(listing);
  if (
    (listing.listingVersion !== "list3" &&
      listing.listingVersion !== "list4" &&
      listing.listingVersion !== "list5") ||
    !anchor
  ) {
    return false;
  }

  try {
    const outspend = await fetchTransactionOutspend(
      anchor.txid,
      anchor.vout,
      network,
    );
    return outspend?.spent === true;
  } catch {
    return false;
  }
}

async function filterSpendableListings(
  listings: PowIdListing[],
  network: BitcoinNetwork,
) {
  const spentStates = await Promise.all(
    listings.map((listing) => listingAnchorSpent(listing, network)),
  );
  return listings.filter((_listing, index) => !spentStates[index]);
}

function saleAuthorizationExpired(
  authorization: PowIdSaleAuthorization,
  eventCreatedAt: string,
) {
  if (!authorization.expiresAt) {
    return false;
  }

  return Date.parse(eventCreatedAt) > Date.parse(authorization.expiresAt);
}

function compareRegistryEventOrder(left: PowIdEvent, right: PowIdEvent) {
  if (left.confirmed && right.confirmed) {
    const leftHeight =
      typeof left.blockHeight === "number" &&
      Number.isSafeInteger(left.blockHeight)
        ? left.blockHeight
        : Number.POSITIVE_INFINITY;
    const rightHeight =
      typeof right.blockHeight === "number" &&
      Number.isSafeInteger(right.blockHeight)
        ? right.blockHeight
        : Number.POSITIVE_INFINITY;
    if (leftHeight !== rightHeight) {
      return leftHeight - rightHeight;
    }

    const leftIndex =
      typeof left.blockIndex === "number" &&
      Number.isSafeInteger(left.blockIndex)
        ? left.blockIndex
        : Number.POSITIVE_INFINITY;
    const rightIndex =
      typeof right.blockIndex === "number" &&
      Number.isSafeInteger(right.blockIndex)
        ? right.blockIndex
        : Number.POSITIVE_INFINITY;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
  }

  return (
    Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
    left.txid.localeCompare(right.txid)
  );
}

function buildIdMarketplaceTransferPayload(
  listingId: string,
  ownerAddress: string,
  receiveAddress: string,
  version: Extract<
    PowIdMarketplaceTransferVersion,
    "buy3" | "buy4" | "buy5"
  > = "buy5",
) {
  const receiver = receiveAddress.trim();
  return `${ID_PROTOCOL_PREFIX}${version}:${listingId}:${ownerAddress}${receiver ? `:${receiver}` : ""}`;
}

function marketplaceTransferVersionForListing(
  listing: PowIdListing,
): Extract<PowIdMarketplaceTransferVersion, "buy3" | "buy4" | "buy5"> {
  return listing.listingVersion === "list3"
    ? "buy3"
    : listing.listingVersion === "list4"
      ? "buy4"
      : "buy5";
}

function listingCanBePurchased(listing: PowIdListing) {
  return (
    listing.listingVersion === "list3" ||
    listing.listingVersion === "list4" ||
    (listing.listingVersion === "list5" &&
      saleAuthorizationUsesSaleTicketAnchor(listing.saleAuthorization))
  );
}

function buildIdListingPayload(
  authorization: PowIdSaleAuthorization,
  version: Extract<PowIdListingVersion, "list4" | "list5"> = "list5",
) {
  return `${ID_PROTOCOL_PREFIX}${version}:${encodeTextBase64Url(JSON.stringify(authorization))}`;
}

function buildIdSaleSealPayload(
  listingId: string,
  authorization: PowIdSaleAuthorization,
) {
  if (!saleAuthorizationUsesSaleTicketAnchor(authorization)) {
    throw new Error("Sale-ticket seal signature is invalid.");
  }

  return `${ID_PROTOCOL_PREFIX}seal5:${listingId}:${encodeTextBase64Url(JSON.stringify(authorization))}`;
}

function buildIdDelistingPayload(
  listingId: string,
  version: PowIdDelistingVersion = "delist5",
) {
  return `${ID_PROTOCOL_PREFIX}${version}:${listingId}`;
}

function protocolOutputScripts(payloads: string[]) {
  const scripts = payloads.map((payload) => {
    const script = opReturnScriptForPayload(payload);
    if (script.length > MAX_DATA_CARRIER_BYTES) {
      throw new Error("One OP_RETURN data-carrier output is over 100 KB.");
    }

    return script;
  });

  const aggregateBytes = scripts.reduce(
    (total, script) => total + script.length,
    0,
  );
  if (aggregateBytes > MAX_DATA_CARRIER_BYTES) {
    throw new Error(
      `OP_RETURN data-carrier scripts use ${aggregateBytes.toLocaleString()} bytes; limit is ${MAX_DATA_CARRIER_BYTES.toLocaleString()} bytes.`,
    );
  }

  return scripts;
}

function parseProtocolMemo(memo: string): ProtocolMessage | null {
  return memo.startsWith(PROTOCOL_PREFIX) ? { memo, replyTo: "" } : null;
}

function sortMessages(messages: MailMessage[], sortMode: SortMode) {
  const sorted = [...messages];
  const threadActivity = new Map<string, number>();

  for (const message of sorted) {
    const thread = rootTxid(message);
    const previous = threadActivity.get(thread) ?? 0;
    threadActivity.set(
      thread,
      Math.max(previous, Date.parse(message.createdAt)),
    );
  }

  sorted.sort((left, right) => {
    if (sortMode === "value") {
      return (
        right.amountSats - left.amountSats ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt)
      );
    }

    if (sortMode === "newest") {
      return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    }

    if (sortMode === "oldest") {
      return Date.parse(left.createdAt) - Date.parse(right.createdAt);
    }

    if (sortMode === "thread") {
      const byActivity =
        (threadActivity.get(rootTxid(right)) ?? 0) -
        (threadActivity.get(rootTxid(left)) ?? 0);
      if (byActivity !== 0) {
        return byActivity;
      }

      const byThread = rootTxid(left).localeCompare(rootTxid(right));
      return (
        byThread || Date.parse(left.createdAt) - Date.parse(right.createdAt)
      );
    }

    if (sortMode === "largest") {
      return (
        (right.attachment?.size ?? 0) - (left.attachment?.size ?? 0) ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt)
      );
    }

    if (sortMode === "filetype") {
      const byType = (left.attachment?.mime ?? "").localeCompare(
        right.attachment?.mime ?? "",
      );
      return (
        byType ||
        (left.attachment?.name ?? "").localeCompare(
          right.attachment?.name ?? "",
        )
      );
    }

    if (sortMode === "sender") {
      return (
        peerAddress(left).localeCompare(peerAddress(right)) ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt)
      );
    }

    return (
      right.amountSats - left.amountSats ||
      Date.parse(right.createdAt) - Date.parse(left.createdAt)
    );
  });

  return sorted;
}

async function getWalletNetwork(
  wallet: UnisatWallet,
): Promise<BitcoinNetwork | undefined> {
  const chain = await wallet.getChain?.().catch(() => undefined);
  if (chain?.enum === "BITCOIN_MAINNET") {
    return "livenet";
  }
  if (chain?.enum === "BITCOIN_TESTNET") {
    return "testnet";
  }
  if (chain?.enum === "BITCOIN_TESTNET4") {
    return "testnet4";
  }

  const walletNetwork = await wallet.getNetwork?.().catch(() => undefined);
  return walletNetwork === "livenet" || walletNetwork === "testnet"
    ? walletNetwork
    : undefined;
}

async function switchWalletNetwork(
  wallet: UnisatWallet,
  network: BitcoinNetwork,
) {
  if (wallet.switchChain) {
    await wallet.switchChain(chainForNetwork(network));
    return;
  }

  if (wallet.switchNetwork) {
    if (network === "testnet4") {
      throw new Error(
        "This UniSat version cannot switch to testnet4 through the legacy switchNetwork API.",
      );
    }

    await wallet.switchNetwork(network);
  }
}

function storedMailRecipients(
  value: unknown,
  network: BitcoinNetwork,
): MailRecipient[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): MailRecipient[] => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const recipient = item as Partial<MailRecipient>;
    if (
      typeof recipient.address !== "string" ||
      !isValidBitcoinAddress(recipient.address, network)
    ) {
      return [];
    }

    const amountSats =
      typeof recipient.amountSats === "number" && recipient.amountSats > 0
        ? Math.floor(recipient.amountSats)
        : DEFAULT_AMOUNT_SATS;
    const id =
      typeof recipient.id === "string" ? normalizePowId(recipient.id) : "";
    const display =
      typeof recipient.display === "string" && recipient.display.trim()
        ? recipient.display.trim()
        : id
          ? `${id}@proofofwork.me`
          : recipient.address;

    return [
      {
        address: recipient.address,
        amountSats,
        display,
        id: id || undefined,
      },
    ];
  });
}

function loadSentMessages(): SentMessage[] {
  try {
    const stored = localStorage.getItem(SENT_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((message): SentMessage[] => {
      if (!message || typeof message !== "object") {
        return [];
      }

      const sent = message as Partial<SentMessage>;
      if (
        typeof sent.txid !== "string" ||
        typeof sent.from !== "string" ||
        typeof sent.to !== "string" ||
        typeof sent.memo !== "string" ||
        !/^[0-9a-fA-F]{64}$/.test(sent.txid)
      ) {
        return [];
      }

      const network: BitcoinNetwork =
        sent.network === "livenet" ||
        sent.network === "testnet" ||
        sent.network === "testnet4"
          ? sent.network
          : "livenet";
      const recipients = storedMailRecipients(sent.recipients, network);
      const toRecipients = storedMailRecipients(sent.toRecipients, network);
      const ccRecipients = storedMailRecipients(sent.ccRecipients, network);

      return [
        {
          amountSats:
            typeof sent.amountSats === "number"
              ? sent.amountSats
              : DEFAULT_AMOUNT_SATS,
          attachment: storedAttachment(sent.attachment),
          confirmedAt:
            typeof sent.confirmedAt === "string" ? sent.confirmedAt : undefined,
          createdAt:
            typeof sent.createdAt === "string"
              ? sent.createdAt
              : new Date().toISOString(),
          droppedAt:
            typeof sent.droppedAt === "string" ? sent.droppedAt : undefined,
          feeRate:
            typeof sent.feeRate === "number" ? sent.feeRate : DEFAULT_FEE_RATE,
          from: sent.from,
          lastCheckedAt:
            typeof sent.lastCheckedAt === "string"
              ? sent.lastCheckedAt
              : undefined,
          memo: sent.memo,
          network,
          parentTxid:
            typeof sent.parentTxid === "string" ? sent.parentTxid : undefined,
          recipients: recipients.length > 0 ? recipients : undefined,
          subject:
            typeof sent.subject === "string"
              ? sent.subject.slice(0, 180)
              : undefined,
          toRecipients: toRecipients.length > 0 ? toRecipients : undefined,
          ccRecipients: ccRecipients.length > 0 ? ccRecipients : undefined,
          replyTo: typeof sent.replyTo === "string" ? sent.replyTo : sent.from,
          status: normalizeBroadcastStatus(sent.status),
          to: sent.to,
          txid: sent.txid.toLowerCase(),
        },
      ];
    });
  } catch {
    return [];
  }
}

function saveSentMessages(messages: SentMessage[]) {
  localStorage.setItem(SENT_KEY, JSON.stringify(messages));
}

function loadMailPreferences(): MailPreferences {
  try {
    const stored = localStorage.getItem(MAIL_PREFS_KEY);
    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        if (!value || typeof value !== "object") {
          return [];
        }

        const preference = value as MailPreference;
        const normalized: MailPreference = {};
        if (preference.archived) {
          normalized.archived = true;
        }

        if (preference.favorite) {
          normalized.favorite = true;
        }

        if (Array.isArray(preference.folders)) {
          const folders = [
            ...new Set(
              preference.folders
                .filter((folder) => typeof folder === "string" && folder.trim())
                .map((folder) => folder.trim()),
            ),
          ];
          if (folders.length > 0) {
            normalized.folders = folders;
          }
        }

        return Object.keys(normalized).length > 0 ? [[key, normalized]] : [];
      }),
    );
  } catch {
    return {};
  }
}

function saveMailPreferences(preferences: MailPreferences) {
  localStorage.setItem(MAIL_PREFS_KEY, JSON.stringify(preferences));
}

function normalizeFolderName(name: string) {
  return name.trim().replace(/\s+/gu, " ").slice(0, 40);
}

function customFolderId(name: string) {
  const slug = normalizeFolderName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 32);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${slug || "folder"}-${suffix}`;
}

function sortCustomFolders(folders: CustomFolderRecord[]) {
  return [...folders].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

function storedCustomFolder(value: unknown): CustomFolderRecord | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const folder = value as Partial<CustomFolderRecord>;
  const id = typeof folder.id === "string" ? folder.id.trim().slice(0, 80) : "";
  const name =
    typeof folder.name === "string" ? normalizeFolderName(folder.name) : "";
  if (!id || !name) {
    return undefined;
  }

  return {
    createdAt:
      typeof folder.createdAt === "string" &&
      !Number.isNaN(Date.parse(folder.createdAt))
        ? folder.createdAt
        : new Date().toISOString(),
    id,
    name,
  };
}

function loadCustomFolders(): CustomFolderRecord[] {
  try {
    const stored = localStorage.getItem(CUSTOM_FOLDERS_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return sortCustomFolders(
      parsed.flatMap((folder): CustomFolderRecord[] => {
        const normalized = storedCustomFolder(folder);
        return normalized ? [normalized] : [];
      }),
    );
  } catch {
    return [];
  }
}

function saveCustomFolders(folders: CustomFolderRecord[]) {
  localStorage.setItem(
    CUSTOM_FOLDERS_KEY,
    JSON.stringify(sortCustomFolders(folders)),
  );
}

function normalizeContactName(name: string, fallback: string) {
  return name.trim().replace(/\s+/gu, " ").slice(0, 80) || fallback;
}

function contactTarget(contact: Pick<ContactRecord, "address" | "powId">) {
  return contact.powId ? `${contact.powId}@proofofwork.me` : contact.address;
}

function contactKey(
  contact: Pick<ContactRecord, "address" | "network" | "powId">,
) {
  return `${contact.network}:${contact.powId ? `id:${contact.powId}` : `addr:${contact.address}`}`;
}

function registryContactKey(record: Pick<PowIdRecord, "id" | "network">) {
  return `${record.network}:id:${record.id}`;
}

function sortContacts(contacts: ContactRecord[]) {
  return [...contacts].sort((left, right) => {
    const byNetwork = left.network.localeCompare(right.network);
    if (byNetwork) {
      return byNetwork;
    }

    return (
      left.name.localeCompare(right.name) ||
      contactTarget(left).localeCompare(contactTarget(right))
    );
  });
}

function storedContact(value: unknown): ContactRecord | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const contact = value as Partial<ContactRecord>;
  const network: BitcoinNetwork | undefined =
    contact.network === "livenet" ||
    contact.network === "testnet" ||
    contact.network === "testnet4"
      ? contact.network
      : undefined;

  if (
    !network ||
    typeof contact.address !== "string" ||
    !isValidBitcoinAddress(contact.address, network)
  ) {
    return undefined;
  }

  const powId =
    typeof contact.powId === "string" ? normalizePowId(contact.powId) : "";
  const target = powId
    ? `${powId}@proofofwork.me`
    : shortAddress(contact.address);
  const createdAt =
    typeof contact.createdAt === "string" &&
    !Number.isNaN(Date.parse(contact.createdAt))
      ? contact.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof contact.updatedAt === "string" &&
    !Number.isNaN(Date.parse(contact.updatedAt))
      ? contact.updatedAt
      : createdAt;

  return {
    address: contact.address,
    createdAt,
    name: normalizeContactName(
      typeof contact.name === "string" ? contact.name : "",
      target,
    ),
    network,
    powId: powId || undefined,
    source: contact.source === "registry" ? "registry" : "manual",
    updatedAt,
  };
}

function loadContacts(): ContactRecord[] {
  try {
    const stored = localStorage.getItem(CONTACTS_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return sortContacts(
      parsed.flatMap((contact): ContactRecord[] => {
        const normalized = storedContact(contact);
        return normalized ? [normalized] : [];
      }),
    );
  } catch {
    return [];
  }
}

function saveContacts(contacts: ContactRecord[]) {
  localStorage.setItem(CONTACTS_KEY, JSON.stringify(sortContacts(contacts)));
}

function upsertContact(contacts: ContactRecord[], contact: ContactRecord) {
  const key = contactKey(contact);
  const next = new Map(
    contacts.map((current) => [contactKey(current), current]),
  );
  const existing = next.get(key);
  next.set(key, {
    ...existing,
    ...contact,
    createdAt: existing?.createdAt ?? contact.createdAt,
    updatedAt: new Date().toISOString(),
  });
  return sortContacts([...next.values()]);
}

function refreshRegistryContactsFromRecords(
  contacts: ContactRecord[],
  registryRecords: PowIdRecord[],
  targetNetwork: BitcoinNetwork,
) {
  const confirmedReceivers = new Map(
    registryRecords
      .filter((record) => record.network === targetNetwork && record.confirmed)
      .map((record) => [record.id, record.receiveAddress]),
  );
  const refreshedAt = new Date().toISOString();
  let changed = false;

  const refreshed = contacts.map((contact) => {
    if (!contact.powId || contact.network !== targetNetwork) {
      return contact;
    }

    const receiveAddress = confirmedReceivers.get(contact.powId);
    if (!receiveAddress || receiveAddress === contact.address) {
      return contact;
    }

    changed = true;
    return {
      ...contact,
      address: receiveAddress,
      source: "registry" as const,
      updatedAt: refreshedAt,
    };
  });

  return changed ? sortContacts(refreshed) : contacts;
}

function contactFromRegistryRecord(record: PowIdRecord): ContactRecord {
  const target = `${record.id}@proofofwork.me`;
  return {
    address: record.receiveAddress,
    createdAt: new Date().toISOString(),
    name: target,
    network: record.network,
    powId: record.id,
    source: "registry",
    updatedAt: new Date().toISOString(),
  };
}

function contactFromInput(
  name: string,
  target: string,
  network: BitcoinNetwork,
  registryRecords: PowIdRecord[],
  registryAddress: string,
): ContactRecord {
  const trimmedTarget = target.trim();
  if (!trimmedTarget) {
    throw new Error("Enter an address or confirmed ProofOfWork ID.");
  }

  if (isValidBitcoinAddress(trimmedTarget, network)) {
    const fallback = shortAddress(trimmedTarget);
    return {
      address: trimmedTarget,
      createdAt: new Date().toISOString(),
      name: normalizeContactName(name, fallback),
      network,
      source: "manual",
      updatedAt: new Date().toISOString(),
    };
  }

  const resolved = resolveRecipientInput(
    trimmedTarget,
    network,
    registryRecords,
    registryAddress,
  );
  if (resolved.error || !resolved.paymentAddress || !resolved.id) {
    throw new Error(
      resolved.error || "Enter a valid address or confirmed ProofOfWork ID.",
    );
  }

  const fallback = `${resolved.id}@proofofwork.me`;
  return {
    address: resolved.paymentAddress,
    createdAt: new Date().toISOString(),
    name: normalizeContactName(name, fallback),
    network,
    powId: resolved.id,
    source: "registry",
    updatedAt: new Date().toISOString(),
  };
}

function draftKey(address: string, network: BitcoinNetwork) {
  return `${DRAFT_KEY_PREFIX}:${network}:${address}`;
}

function storedAttachment(value: unknown): MailAttachment | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const attachment = value as Partial<MailAttachment>;
  if (
    typeof attachment.name !== "string" ||
    typeof attachment.mime !== "string" ||
    typeof attachment.data !== "string" ||
    typeof attachment.sha256 !== "string" ||
    typeof attachment.size !== "number" ||
    attachment.size <= 0 ||
    attachment.size > MAX_ATTACHMENT_BYTES ||
    !/^[0-9a-f]{64}$/i.test(attachment.sha256)
  ) {
    return undefined;
  }

  return {
    data: attachment.data,
    mime: normalizeAttachmentMime(attachment.mime),
    name: normalizeAttachmentName(attachment.name),
    sha256: attachment.sha256.toLowerCase(),
    size: attachment.size,
  };
}

function loadDraft(
  address: string,
  network: BitcoinNetwork,
): DraftMessage | undefined {
  try {
    const stored = localStorage.getItem(draftKey(address, network));
    if (!stored) {
      return undefined;
    }

    const draft = JSON.parse(stored) as Partial<DraftMessage>;
    const amountSats =
      typeof draft.amountSats === "number" && Number.isFinite(draft.amountSats)
        ? draft.amountSats
        : DEFAULT_AMOUNT_SATS;
    const feeRate =
      typeof draft.feeRate === "number" && Number.isFinite(draft.feeRate)
        ? draft.feeRate
        : DEFAULT_FEE_RATE;
    const parentTxid =
      typeof draft.parentTxid === "string" &&
      /^[0-9a-fA-F]{64}$/.test(draft.parentTxid)
        ? draft.parentTxid.toLowerCase()
        : undefined;
    const updatedAt =
      typeof draft.updatedAt === "string" &&
      !Number.isNaN(Date.parse(draft.updatedAt))
        ? draft.updatedAt
        : new Date().toISOString();

    return {
      amountSats,
      attachment: storedAttachment(draft.attachment),
      ccRecipient:
        typeof draft.ccRecipient === "string" ? draft.ccRecipient : "",
      feeRate,
      from: address,
      memo: typeof draft.memo === "string" ? draft.memo : DEFAULT_MEMO,
      network,
      parentTxid,
      recipient: typeof draft.recipient === "string" ? draft.recipient : "",
      subject:
        typeof draft.subject === "string" ? draft.subject.slice(0, 180) : "",
      updatedAt,
    };
  } catch {
    return undefined;
  }
}

function saveDraft(draft: DraftMessage) {
  localStorage.setItem(
    draftKey(draft.from, draft.network),
    JSON.stringify(draft),
  );
}

function clearDraft(address: string, network: BitcoinNetwork) {
  localStorage.removeItem(draftKey(address, network));
}

function isDraftContentful(draft: DraftMessage) {
  return Boolean(
    draft.recipient.trim() ||
    draft.ccRecipient?.trim() ||
    draft.subject?.trim() ||
    draft.memo.trim() ||
    draft.attachment ||
    draft.parentTxid ||
    draft.amountSats !== DEFAULT_AMOUNT_SATS ||
    draft.feeRate !== DEFAULT_FEE_RATE,
  );
}

function decodeHex(hex: string) {
  if (!hex || hex.length % 2 !== 0) {
    return "";
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function decodedOpReturnMessages(vout: Array<Record<string, unknown>>) {
  return vout
    .filter((output) => output.scriptpubkey_type === "op_return")
    .map((output) => String(output.scriptpubkey_asm ?? ""))
    .map((asm) =>
      asm
        .split(" ")
        .slice(1)
        .filter((token) => /^[0-9a-fA-F]+$/.test(token))
        .map(decodeHex)
        .join(""),
    )
    .filter(Boolean);
}

function decodedProtocolMessages(
  vout: Array<Record<string, unknown>>,
  prefix: string,
) {
  return decodedOpReturnMessages(vout).filter((message) =>
    message.startsWith(prefix),
  );
}

function proofProtocolDataBytesForVout(vout: Array<Record<string, unknown>>) {
  return decodedOpReturnMessages(vout)
    .filter(
      (message) =>
        message.startsWith(PROTOCOL_PREFIX) ||
        message.startsWith(ID_PROTOCOL_PREFIX) ||
        message.startsWith(TOKEN_PROTOCOL_PREFIX) ||
        message.startsWith(RUSH_PROTOCOL_PREFIX),
    )
    .reduce(
      (total, message) => total + new TextEncoder().encode(message).byteLength,
      0,
    );
}

function firstProtocolOutputIndex(vout: Array<Record<string, unknown>>) {
  return vout.findIndex((output) => {
    if (output.scriptpubkey_type !== "op_return") {
      return false;
    }

    return decodedOpReturnMessages([output]).some((message) =>
      message.startsWith(PROTOCOL_PREFIX),
    );
  });
}

function firstIdProtocolOutputIndex(vout: Array<Record<string, unknown>>) {
  return vout.findIndex((output) => {
    if (output.scriptpubkey_type !== "op_return") {
      return false;
    }

    return decodedProtocolMessages([output], ID_PROTOCOL_PREFIX).length > 0;
  });
}

function parseAttachmentPayload(
  payload: string,
  current: AttachmentAccumulator | undefined,
) {
  const parts = payload.split(":");
  if (parts.length !== 7) {
    return current;
  }

  const [, mimeEncoded, nameEncoded, sizeText, sha256, partText, chunk] = parts;
  const size = Number(sizeText);
  const part = partText.match(/^(\d+)\/(\d+)$/);

  if (
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > MAX_ATTACHMENT_BYTES ||
    !/^[0-9a-f]{64}$/i.test(sha256) ||
    !part
  ) {
    return current;
  }

  const index = Number(part[1]);
  const total = Number(part[2]);
  if (
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(total) ||
    total < 1 ||
    index < 0 ||
    index >= total
  ) {
    return current;
  }

  let mime = "";
  let name = "";
  try {
    mime = normalizeAttachmentMime(decodeTextBase64Url(mimeEncoded));
    name = normalizeAttachmentName(decodeTextBase64Url(nameEncoded));
  } catch {
    return current;
  }

  const accumulator =
    current &&
    current.mime === mime &&
    current.name === name &&
    current.size === size &&
    current.sha256 === sha256.toLowerCase() &&
    current.total === total
      ? current
      : {
          chunks: Array.from({ length: total }, () => ""),
          mime,
          name,
          sha256: sha256.toLowerCase(),
          size,
          total,
        };

  accumulator.chunks[index] = chunk;
  return accumulator;
}

function attachmentFromAccumulator(
  accumulator: AttachmentAccumulator | undefined,
): MailAttachment | undefined {
  if (!accumulator || accumulator.chunks.some((chunk) => !chunk)) {
    return undefined;
  }

  const data = accumulator.chunks.join("");
  try {
    const bytes = base64UrlDecodeBytes(data);
    if (
      bytes.byteLength !== accumulator.size ||
      sha256Hex(bytes) !== accumulator.sha256
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return {
    data,
    mime: accumulator.mime,
    name: accumulator.name,
    sha256: accumulator.sha256,
    size: accumulator.size,
  };
}

function extractProtocolMemo(vout: Array<Record<string, unknown>>) {
  const decodedMessages = decodedOpReturnMessages(vout);
  let replyTo = "";
  let parentTxid: string | undefined;
  let subject = "";
  let attachmentAccumulator: AttachmentAccumulator | undefined;
  const chunks: string[] = [];

  for (const decodedMessage of decodedMessages) {
    const parsed = parseProtocolMemo(decodedMessage);
    if (!parsed) {
      continue;
    }

    const payload = decodedMessage.slice(PROTOCOL_PREFIX.length);
    if (payload.startsWith("f:")) {
      replyTo = payload.slice(2);
      continue;
    }

    if (payload.startsWith("s:")) {
      try {
        subject = normalizeSubject(decodeTextBase64Url(payload.slice(2)));
      } catch {
        // Ignore malformed optional headers while keeping the message readable.
      }
      continue;
    }

    const reply = payload.match(/^r:([0-9a-fA-F]{64})$/);
    if (reply) {
      parentTxid = reply[1].toLowerCase();
      continue;
    }

    if (payload.startsWith("m:")) {
      chunks.push(payload.slice(2));
      continue;
    }

    if (payload.startsWith("a:")) {
      attachmentAccumulator = parseAttachmentPayload(
        payload,
        attachmentAccumulator,
      );
    }
  }

  if (chunks.length === 0 && !subject && !attachmentAccumulator) {
    return null;
  }

  const protocolMessage: ProtocolMessage = {
    memo: chunks.join(""),
  };

  if (subject) {
    protocolMessage.subject = subject;
  }

  if (replyTo) {
    protocolMessage.replyTo = replyTo;
  }

  if (parentTxid) {
    protocolMessage.parentTxid = parentTxid;
  }

  const attachment = attachmentFromAccumulator(attachmentAccumulator);
  if (attachment) {
    protocolMessage.attachment = attachment;
  }

  return protocolMessage;
}

function receivedPaymentAmount(
  vout: Array<Record<string, unknown>>,
  address: string,
) {
  const protocolIndex = firstProtocolOutputIndex(vout);
  const amount = vout.reduce((total, output, index) => {
    if (
      output.scriptpubkey_address !== address ||
      typeof output.value !== "number"
    ) {
      return total;
    }

    return protocolIndex === -1 || index < protocolIndex
      ? total + output.value
      : total;
  }, 0);

  if (amount > 0) {
    return amount;
  }

  if (protocolIndex !== -1) {
    return 0;
  }

  const fallbackOutput = vout.find(
    (output) =>
      output.scriptpubkey_address === address &&
      typeof output.value === "number",
  );

  return typeof fallbackOutput?.value === "number" ? fallbackOutput.value : 0;
}

function protocolPaymentOutputs(
  vout: Array<Record<string, unknown>>,
): MailRecipient[] {
  const protocolIndex = firstProtocolOutputIndex(vout);
  if (protocolIndex === -1) {
    return [];
  }

  return vout.flatMap((output, index): MailRecipient[] => {
    if (
      index >= protocolIndex ||
      output.scriptpubkey_type === "op_return" ||
      typeof output.scriptpubkey_address !== "string" ||
      typeof output.value !== "number" ||
      output.value <= 0
    ) {
      return [];
    }

    return [
      {
        address: output.scriptpubkey_address,
        amountSats: output.value,
        display: output.scriptpubkey_address,
      },
    ];
  });
}

function senderAddress(
  vin: Array<Record<string, unknown>>,
  targetAddress: string,
) {
  const inputAddresses = vin
    .map((input) => {
      const prevout = input.prevout as Record<string, unknown> | undefined;
      return typeof prevout?.scriptpubkey_address === "string"
        ? prevout.scriptpubkey_address
        : "";
    })
    .filter(Boolean);

  return (
    inputAddresses.find((inputAddress) => inputAddress !== targetAddress) ??
    inputAddresses[0] ??
    "Unknown"
  );
}

function transactionInputAddresses(vin: Array<Record<string, unknown>>) {
  return vin
    .map((input) => {
      const prevout = input.prevout as Record<string, unknown> | undefined;
      return typeof prevout?.scriptpubkey_address === "string"
        ? prevout.scriptpubkey_address
        : "";
    })
    .filter(Boolean);
}

function transactionSpentOutpoints(
  vin: Array<Record<string, unknown>>,
): PowIdSpentOutpoint[] {
  return vin.flatMap((input): PowIdSpentOutpoint[] => {
    const txid =
      typeof input.txid === "string" && /^[0-9a-fA-F]{64}$/u.test(input.txid)
        ? input.txid.toLowerCase()
        : "";
    const vout =
      typeof input.vout === "number" &&
      Number.isSafeInteger(input.vout) &&
      input.vout >= 0
        ? input.vout
        : -1;
    return txid && vout >= 0 ? [{ txid, vout }] : [];
  });
}

function registryPaymentAmount(
  vout: Array<Record<string, unknown>>,
  registryAddress: string,
) {
  const protocolIndex = firstIdProtocolOutputIndex(vout);
  return vout.reduce((total, output, index) => {
    if (
      output.scriptpubkey_address === registryAddress &&
      typeof output.value === "number" &&
      output.value > 0 &&
      (protocolIndex === -1 || index < protocolIndex)
    ) {
      return total + output.value;
    }

    return total;
  }, 0);
}

function firstTokenOutputIndex(vout: Array<Record<string, unknown>>) {
  return vout.findIndex((output) => {
    if (output.scriptpubkey_type !== "op_return") {
      return false;
    }

    return decodedProtocolMessages([output], TOKEN_PROTOCOL_PREFIX).length > 0;
  });
}

function tokenPaymentAmountBeforeProtocol(
  vout: Array<Record<string, unknown>>,
  address: string,
) {
  const protocolIndex = firstTokenOutputIndex(vout);
  return vout.reduce((total, output, index) => {
    if (
      output.scriptpubkey_address === address &&
      typeof output.value === "number" &&
      output.value > 0 &&
      (protocolIndex === -1 || index < protocolIndex)
    ) {
      return total + output.value;
    }

    return total;
  }, 0);
}

function paymentOutputsBeforeTokenProtocol(
  vout: Array<Record<string, unknown>>,
): PowIdPaymentSnapshot[] {
  const protocolIndex = firstTokenOutputIndex(vout);
  return vout.flatMap((output, index): PowIdPaymentSnapshot[] => {
    if (
      typeof output.scriptpubkey_address !== "string" ||
      typeof output.value !== "number" ||
      output.value <= 0 ||
      (protocolIndex !== -1 && index >= protocolIndex)
    ) {
      return [];
    }

    return [{ address: output.scriptpubkey_address, amountSats: output.value }];
  });
}

function firstRushOutputIndex(vout: Array<Record<string, unknown>>) {
  return vout.findIndex((output) => {
    if (output.scriptpubkey_type !== "op_return") {
      return false;
    }

    return decodedProtocolMessages([output], RUSH_PROTOCOL_PREFIX).some(
      (message) => message === buildRushMintPayload(),
    );
  });
}

function rushPaymentAmountBeforeProtocol(
  vout: Array<Record<string, unknown>>,
  address: string,
) {
  const protocolIndex = firstRushOutputIndex(vout);
  return vout.reduce((total, output, index) => {
    if (
      output.scriptpubkey_address === address &&
      typeof output.value === "number" &&
      output.value > 0 &&
      (protocolIndex === -1 || index < protocolIndex)
    ) {
      return total + output.value;
    }

    return total;
  }, 0);
}

function rushProtocolSortedTransactions(txs: Array<Record<string, unknown>>) {
  return txs.slice().sort((left, right) => {
    const leftConfirmed = transactionConfirmed(left);
    const rightConfirmed = transactionConfirmed(right);
    if (leftConfirmed !== rightConfirmed) {
      return Number(rightConfirmed) - Number(leftConfirmed);
    }

    return (
      (transactionBlockHeight(left) ?? Number.MAX_SAFE_INTEGER) -
        (transactionBlockHeight(right) ?? Number.MAX_SAFE_INTEGER) ||
      (transactionBlockIndex(left) ?? Number.MAX_SAFE_INTEGER) -
        (transactionBlockIndex(right) ?? Number.MAX_SAFE_INTEGER) ||
      String(transactionTxid(left)).localeCompare(String(transactionTxid(right)))
    );
  });
}

function rushStateFromTransactions(
  txs: Array<Record<string, unknown>>,
  registryAddress: string,
  targetNetwork: BitcoinNetwork,
): RushState {
  const mints: RushMintRecord[] = [];
  let confirmedOrdinal = 0;

  for (const tx of rushProtocolSortedTransactions(txs)) {
    const txid = transactionTxid(tx);
    if (!txid || mints.some((mint) => mint.txid === txid)) {
      continue;
    }

    const vin = Array.isArray(tx.vin)
      ? (tx.vin as Array<Record<string, unknown>>)
      : [];
    const vout = Array.isArray(tx.vout)
      ? (tx.vout as Array<Record<string, unknown>>)
      : [];
    const minterAddress = transactionInputAddresses(vin)[0] ?? "";
    if (!isValidBitcoinAddress(minterAddress, targetNetwork)) {
      continue;
    }

    const messages = decodedProtocolMessages(vout, RUSH_PROTOCOL_PREFIX);
    if (!messages.includes(buildRushMintPayload())) {
      continue;
    }

    const paidSats = rushPaymentAmountBeforeProtocol(vout, registryAddress);
    if (paidSats < RUSH_MINT_PRICE_SATS) {
      continue;
    }

    const confirmed = transactionConfirmed(tx);
    const createdAt = new Date(tokenTransactionTime(tx)).toISOString();
    const ordinal = confirmed ? (confirmedOrdinal += 1) : undefined;
    const rewardOrdinal = ordinal ?? confirmedOrdinal + 1;
    const rewardUnits = rushRewardUnitsForOrdinal(rewardOrdinal);
    const phase = rushPhaseForOrdinal(rewardOrdinal);

    mints.push({
      amount: formatRushUnits(rewardUnits),
      amountUnits: rewardUnits.toString(),
      confirmed,
      createdAt,
      dataBytes: proofProtocolDataBytesForVout(vout),
      minterAddress,
      network: targetNetwork,
      ordinal,
      overflow: confirmed ? rewardUnits === 0n : false,
      paidSats: RUSH_MINT_PRICE_SATS,
      phase: phase?.phase,
      registryAddress,
      txid,
    });
  }

  const sortedMints = mints.sort(
    (left, right) =>
      Number(right.confirmed) - Number(left.confirmed) ||
      (right.ordinal ?? Number.MAX_SAFE_INTEGER) -
        (left.ordinal ?? Number.MAX_SAFE_INTEGER) ||
      Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
      left.txid.localeCompare(right.txid),
  );

  return {
    indexedAt: new Date().toISOString(),
    mints: sortedMints,
    network: targetNetwork,
    registryAddress,
    stats: rushStatsFromMints(sortedMints),
  };
}

function normalizeTokenTicker(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "")
    .slice(0, 12);
}

function normalizeTokenCreatorAddress(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function tokenTickerIsReserved(value: string) {
  const ticker = normalizeTokenTicker(value);
  return ticker.includes(WORK_TOKEN_TICKER);
}

function tokenTickerReservationError(value: string) {
  const ticker = normalizeTokenTicker(value);
  return ticker && tokenTickerIsReserved(ticker)
    ? "WORK is reserved for the canonical WORK token. Choose a ticker without WORK."
    : "";
}

function tokenCreationIsAllowed({
  creatorAddress,
  ticker,
  tokenId,
}: {
  creatorAddress: string;
  ticker: string;
  tokenId: string;
}) {
  if (String(tokenId ?? "").toLowerCase() === WORK_TOKEN_ID) {
    return true;
  }

  if (
    BLOCKED_TOKEN_CREATOR_ADDRESSES.has(
      normalizeTokenCreatorAddress(creatorAddress),
    )
  ) {
    return false;
  }

  return !tokenTickerIsReserved(ticker);
}

function buildTokenCreatePayload({
  maxSupply,
  mintAmount,
  mintPriceSats,
  registryAddress,
  ticker,
}: {
  maxSupply: number;
  mintAmount: number;
  mintPriceSats: number;
  registryAddress: string;
  ticker: string;
}) {
  return [
    `${TOKEN_PROTOCOL_PREFIX}${TOKEN_CREATE_ACTION}`,
    normalizeTokenTicker(ticker),
    Math.floor(maxSupply),
    Math.floor(mintAmount),
    Math.floor(mintPriceSats),
    registryAddress.trim(),
  ].join(":");
}

function buildTokenMintPayload(tokenId: string, amount: number) {
  return [
    `${TOKEN_PROTOCOL_PREFIX}${TOKEN_MINT_ACTION}`,
    tokenId.trim().toLowerCase(),
    Math.floor(amount),
  ].join(":");
}

function buildTokenSendPayload(
  tokenId: string,
  amount: number,
  recipientAddress: string,
) {
  return [
    `${TOKEN_PROTOCOL_PREFIX}${TOKEN_SEND_ACTION}`,
    tokenId.trim().toLowerCase(),
    Math.floor(amount),
    recipientAddress.trim(),
  ].join(":");
}

function tokenSaleAuthorizationDraft(
  authorization: Partial<PowTokenSaleAuthorization>,
): PowTokenSaleAuthorizationDraft {
  return {
    amount: Math.max(0, Math.floor(Number(authorization.amount ?? 0))),
    anchorScriptPubKey: String(authorization.anchorScriptPubKey ?? "").toLowerCase(),
    anchorSigHashType: Math.floor(Number(authorization.anchorSigHashType ?? 0)),
    anchorType: String(authorization.anchorType ?? ""),
    anchorValueSats: Math.max(
      0,
      Math.floor(Number(authorization.anchorValueSats ?? 0)),
    ),
    anchorVout: Math.max(0, Math.floor(Number(authorization.anchorVout ?? 0))),
    buyerAddress: String(authorization.buyerAddress ?? "").trim(),
    expiresAt: String(authorization.expiresAt ?? "").trim(),
    network: (authorization.network ?? "livenet") as BitcoinNetwork,
    nonce: String(authorization.nonce ?? "").trim(),
    priceSats: Math.max(0, Math.floor(Number(authorization.priceSats ?? 0))),
    registryAddress: String(authorization.registryAddress ?? "").trim(),
    sellerAddress: String(authorization.sellerAddress ?? "").trim(),
    sellerPublicKey: String(authorization.sellerPublicKey ?? "").toLowerCase(),
    ticker: normalizeTokenTicker(String(authorization.ticker ?? "")),
    tokenId: String(authorization.tokenId ?? "").toLowerCase(),
    version: authorization.version ?? TOKEN_SALE_AUTH_VERSION,
  };
}

function parseTokenSaleAuthorizationJson(
  value: string,
  targetNetwork: BitcoinNetwork,
): PowTokenSaleAuthorization {
  const parsed = JSON.parse(value) as Partial<PowTokenSaleAuthorization>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Token sale authorization is not an object.");
  }

  const draft = tokenSaleAuthorizationDraft(parsed);
  const anchorTxid = String(parsed.anchorTxid ?? "").toLowerCase();
  const anchorSignature = String(parsed.anchorSignature ?? "").toLowerCase();

  if (draft.version !== TOKEN_SALE_AUTH_VERSION) {
    throw new Error("Token sale authorization version is not supported.");
  }

  if (
    !/^[0-9a-f]{64}$/u.test(draft.tokenId) ||
    !/^[A-Z0-9]{1,12}$/u.test(draft.ticker) ||
    draft.amount < 1 ||
    draft.priceSats < 1 ||
    draft.network !== targetNetwork ||
    !isValidBitcoinAddress(draft.registryAddress, targetNetwork) ||
    !isValidBitcoinAddress(draft.sellerAddress, targetNetwork) ||
    (draft.buyerAddress &&
      !isValidBitcoinAddress(draft.buyerAddress, targetNetwork)) ||
    !draft.nonce ||
    draft.nonce.length > 160 ||
    (draft.expiresAt && Number.isNaN(Date.parse(draft.expiresAt))) ||
    draft.anchorType !== TOKEN_LISTING_ANCHOR_TYPE ||
    draft.anchorVout !== TOKEN_LISTING_ANCHOR_VOUT ||
    draft.anchorValueSats !== TOKEN_LISTING_ANCHOR_VALUE_SATS ||
    !/^[0-9a-f]+$/u.test(draft.anchorScriptPubKey) ||
    !validPublicKeyHex(draft.sellerPublicKey) ||
    draft.anchorSigHashType !== TOKEN_LISTING_ANCHOR_SIGHASH_TYPE ||
    (anchorTxid && !/^[0-9a-f]{64}$/u.test(anchorTxid)) ||
    (anchorSignature && !validSignatureHex(anchorSignature))
  ) {
    throw new Error("Token sale authorization is invalid.");
  }

  return {
    ...draft,
    anchorSignature,
    anchorTxid,
  };
}

function tokenSaleAuthorizationUsesSaleTicketAnchor(
  authorization: PowTokenSaleAuthorization,
): authorization is PowTokenSaleAuthorization & {
  anchorSignature: string;
  anchorTxid: string;
  sellerPublicKey: string;
} {
  return (
    authorization.version === TOKEN_SALE_AUTH_VERSION &&
    authorization.anchorType === TOKEN_LISTING_ANCHOR_TYPE &&
    authorization.anchorVout === TOKEN_LISTING_ANCHOR_VOUT &&
    authorization.anchorValueSats === TOKEN_LISTING_ANCHOR_VALUE_SATS &&
    authorization.anchorSigHashType === TOKEN_LISTING_ANCHOR_SIGHASH_TYPE &&
    /^[0-9a-f]{64}$/u.test(authorization.anchorTxid) &&
    validPublicKeyHex(authorization.sellerPublicKey) &&
    validSignatureHex(authorization.anchorSignature)
  );
}

function tokenSaleAuthorizationTermsMatch(
  left: PowTokenSaleAuthorization,
  right: PowTokenSaleAuthorization,
) {
  return (
    JSON.stringify(
      tokenSaleAuthorizationDraft({
        ...left,
        anchorSignature: "",
        anchorTxid: "",
      }),
    ) ===
    JSON.stringify(
      tokenSaleAuthorizationDraft({
        ...right,
        anchorSignature: "",
        anchorTxid: "",
      }),
    )
  );
}

function buildTokenListingPayload(authorization: PowTokenSaleAuthorization) {
  return `${TOKEN_PROTOCOL_PREFIX}${TOKEN_LIST_ACTION}:${encodeTextBase64Url(JSON.stringify(authorization))}`;
}

function buildTokenSaleSealPayload(
  listingId: string,
  authorization: PowTokenSaleAuthorization,
) {
  if (!tokenSaleAuthorizationUsesSaleTicketAnchor(authorization)) {
    throw new Error("Token sale-ticket seal signature is invalid.");
  }

  return `${TOKEN_PROTOCOL_PREFIX}${TOKEN_SEAL_ACTION}:${listingId}:${encodeTextBase64Url(JSON.stringify(authorization))}`;
}

function buildTokenDelistingPayload(listingId: string) {
  return `${TOKEN_PROTOCOL_PREFIX}${TOKEN_DELIST_ACTION}:${listingId}`;
}

function buildTokenBuyPayload(listingId: string, buyerAddress: string) {
  return `${TOKEN_PROTOCOL_PREFIX}${TOKEN_BUY_ACTION}:${listingId}:${buyerAddress.trim()}`;
}

function tokenListingAnchorOutpoint(listing: PowTokenListing) {
  return {
    txid: listing.listingId,
    vout: listing.saleAuthorization.anchorVout,
  };
}

function activeTokenListingAnchorOutpointsForAddress(
  listings: PowTokenListing[],
  address: string,
  {
    exceptListingId,
    network,
  }: {
    exceptListingId?: string;
    network?: BitcoinNetwork;
  } = {},
): PowIdSpentOutpoint[] {
  if (!address) {
    return [];
  }

  return listings.flatMap((listing) => {
    if (network && listing.network !== network) {
      return [];
    }

    if (exceptListingId && listing.listingId === exceptListingId) {
      return [];
    }

    if (listing.sellerAddress !== address) {
      return [];
    }

    return [tokenListingAnchorOutpoint(listing)];
  });
}

function spendsTokenListingAnchor(
  spentOutpoints: PowIdSpentOutpoint[],
  listing: PowTokenListing,
) {
  const anchor = tokenListingAnchorOutpoint(listing);
  return spentOutpoints.some(
    (outpoint) =>
      outpoint.txid === anchor.txid && outpoint.vout === anchor.vout,
  );
}

function tokenSellerPaymentRequiredSats(listing: PowTokenListing) {
  return listing.priceSats + listing.saleAuthorization.anchorValueSats;
}

function tokenListingAnchorIsPresent(
  vout: Array<Record<string, unknown>>,
  authorization: PowTokenSaleAuthorization,
) {
  const output = vout[authorization.anchorVout];
  return (
    output?.scriptpubkey === authorization.anchorScriptPubKey &&
    typeof output.value === "number" &&
    output.value === authorization.anchorValueSats
  );
}

function tokenListingIsExpired(listing: PowTokenListing, nowMs = Date.now()) {
  return Boolean(
    listing.saleAuthorization.expiresAt &&
      Date.parse(listing.saleAuthorization.expiresAt) <= nowMs,
  );
}

function parseTokenPayload(message: string, network: BitcoinNetwork) {
  if (!message.startsWith(TOKEN_PROTOCOL_PREFIX)) {
    return null;
  }

  const parts = message.slice(TOKEN_PROTOCOL_PREFIX.length).split(":");
  if (parts.length === 6 && parts[0] === TOKEN_CREATE_ACTION) {
    const ticker = normalizeTokenTicker(String(parts[1] ?? ""));
    const maxSupply = Number(parts[2]);
    const mintAmount = Number(parts[3]);
    const mintPriceSats = Number(parts[4]);
    const registryAddress = String(parts[5] ?? "").trim();
    if (
      !/^[A-Z0-9]{1,12}$/u.test(ticker) ||
      !Number.isSafeInteger(maxSupply) ||
      maxSupply < 1 ||
      !Number.isSafeInteger(mintAmount) ||
      mintAmount < 1 ||
      mintAmount > maxSupply ||
      !Number.isSafeInteger(mintPriceSats) ||
      mintPriceSats < TOKEN_MIN_MUTATION_PRICE_SATS ||
      !isValidBitcoinAddress(registryAddress, network)
    ) {
      return null;
    }

    return {
      kind: "create" as const,
      maxSupply,
      mintAmount,
      mintPriceSats,
      registryAddress,
      ticker,
    };
  }

  if (parts.length === 3 && parts[0] === TOKEN_MINT_ACTION) {
    const tokenId = String(parts[1] ?? "").toLowerCase();
    const amount = Number(parts[2]);
    if (
      !/^[0-9a-f]{64}$/u.test(tokenId) ||
      !Number.isSafeInteger(amount) ||
      amount < 1
    ) {
      return null;
    }

    return { amount, kind: "mint" as const, tokenId };
  }

  if (parts.length === 4 && parts[0] === TOKEN_SEND_ACTION) {
    const tokenId = String(parts[1] ?? "").toLowerCase();
    const amount = Number(parts[2]);
    const recipientAddress = String(parts[3] ?? "").trim();
    if (
      !/^[0-9a-f]{64}$/u.test(tokenId) ||
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      !isValidBitcoinAddress(recipientAddress, network)
    ) {
      return null;
    }

    return { amount, kind: "send" as const, recipientAddress, tokenId };
  }

  if (parts.length === 2 && parts[0] === TOKEN_LIST_ACTION) {
    try {
      return {
        kind: "list" as const,
        saleAuthorization: parseTokenSaleAuthorizationJson(
          decodeTextBase64Url(parts[1]),
          network,
        ),
      };
    } catch {
      return null;
    }
  }

  if (
    parts.length === 3 &&
    parts[0] === TOKEN_SEAL_ACTION &&
    /^[0-9a-fA-F]{64}$/u.test(parts[1])
  ) {
    try {
      return {
        kind: "seal" as const,
        listingId: parts[1].toLowerCase(),
        saleAuthorization: parseTokenSaleAuthorizationJson(
          decodeTextBase64Url(parts[2]),
          network,
        ),
      };
    } catch {
      return null;
    }
  }

  if (
    parts.length === 2 &&
    parts[0] === TOKEN_DELIST_ACTION &&
    /^[0-9a-fA-F]{64}$/u.test(parts[1])
  ) {
    return {
      kind: "delist" as const,
      listingId: parts[1].toLowerCase(),
    };
  }

  if (
    parts.length === 3 &&
    parts[0] === TOKEN_BUY_ACTION &&
    /^[0-9a-fA-F]{64}$/u.test(parts[1])
  ) {
    const buyerAddress = String(parts[2] ?? "").trim();
    if (!isValidBitcoinAddress(buyerAddress, network)) {
      return null;
    }

    return {
      buyerAddress,
      kind: "buy" as const,
      listingId: parts[1].toLowerCase(),
    };
  }

  return null;
}

function emptyTokenState(): PowTokenState {
  return {
    closedListings: [],
    creationSats: 0,
    confirmedSupply: 0,
    holders: [],
    listings: [],
    mints: [],
    pendingSupply: 0,
    sales: [],
    transfers: [],
    tokens: [],
  };
}

function tokenTransactionTime(tx: Record<string, unknown>) {
  const status = tx.status as Record<string, unknown> | undefined;
  return typeof status?.block_time === "number"
    ? status.block_time * 1000
    : Date.now();
}

function tokenProtocolSortedTransactions(txs: Array<Record<string, unknown>>) {
  return txs.slice().sort((left, right) => {
    const leftConfirmed = transactionConfirmed(left);
    const rightConfirmed = transactionConfirmed(right);
    if (leftConfirmed !== rightConfirmed) {
      return Number(rightConfirmed) - Number(leftConfirmed);
    }

    return (
      (transactionBlockHeight(left) ?? Number.MAX_SAFE_INTEGER) -
        (transactionBlockHeight(right) ?? Number.MAX_SAFE_INTEGER) ||
      (transactionBlockIndex(left) ?? Number.MAX_SAFE_INTEGER) -
        (transactionBlockIndex(right) ?? Number.MAX_SAFE_INTEGER) ||
      String(transactionTxid(left)).localeCompare(String(transactionTxid(right)))
    );
  });
}

function tokenDefinitionsFromTransactions(
  txs: Array<Record<string, unknown>>,
  indexAddress: string,
  targetNetwork: BitcoinNetwork,
): { creationSats: number; tokens: PowTokenDefinition[] } {
  const tokens: PowTokenDefinition[] = [];
  let creationSats = 0;

  for (const tx of tokenProtocolSortedTransactions(txs)) {
    const txid = transactionTxid(tx);
    if (!txid) {
      continue;
    }

    const vin = Array.isArray(tx.vin)
      ? (tx.vin as Array<Record<string, unknown>>)
      : [];
    const vout = Array.isArray(tx.vout)
      ? (tx.vout as Array<Record<string, unknown>>)
      : [];
    const actorAddress = transactionInputAddresses(vin)[0] ?? "";
    if (!isValidBitcoinAddress(actorAddress, targetNetwork)) {
      continue;
    }

    const messages = decodedProtocolMessages(vout, TOKEN_PROTOCOL_PREFIX);
    if (messages.length === 0) {
      continue;
    }

    let remainingCreationSats = tokenPaymentAmountBeforeProtocol(vout, indexAddress);
    const confirmed = transactionConfirmed(tx);
    const createdAt = new Date(tokenTransactionTime(tx)).toISOString();

    for (const message of messages) {
      const parsed = parseTokenPayload(message, targetNetwork);
      if (
        !parsed ||
        parsed.kind !== "create" ||
        remainingCreationSats < TOKEN_CREATION_PRICE_SATS ||
        tokens.some((token) => token.tokenId === txid) ||
        !tokenCreationIsAllowed({
          creatorAddress: actorAddress,
          ticker: parsed.ticker,
          tokenId: txid,
        })
      ) {
        continue;
      }

      remainingCreationSats -= TOKEN_CREATION_PRICE_SATS;
      creationSats += TOKEN_CREATION_PRICE_SATS;
      tokens.push({
        confirmed,
        createdAt,
        creatorAddress: actorAddress,
        creationFeeSats: TOKEN_CREATION_PRICE_SATS,
        maxSupply: parsed.maxSupply,
        mintAmount: parsed.mintAmount,
        mintPriceSats: parsed.mintPriceSats,
        network: targetNetwork,
        registryAddress: parsed.registryAddress,
        ticker: parsed.ticker,
        tokenId: txid,
        txid,
      });
    }
  }

  return {
    creationSats,
    tokens: tokens.sort(compareTokensByConfirmation),
  };
}

function tokenStateFromTransactions(
  indexTxs: Array<Record<string, unknown>>,
  registryTxsByAddress: Map<string, Array<Record<string, unknown>>>,
  indexAddress: string,
  targetNetwork: BitcoinNetwork,
): PowTokenState {
  const { creationSats, tokens } = tokenDefinitionsFromTransactions(
    indexTxs,
    indexAddress,
    targetNetwork,
  );
  const tokensById = new Map(tokens.map((token) => [token.tokenId, token]));
  const tokenSupply = new Map<string, { confirmed: number; pending: number }>();
  const balances = new Map<string, number>();
  const listings = new Map<string, PowTokenListing>();
  const closedListings: PowTokenClosedListing[] = [];
  const mints: PowTokenMint[] = [];
  const sales: PowTokenSale[] = [];
  const transfers: PowTokenTransfer[] = [];
  let confirmedSupply = 0;
  let pendingSupply = 0;
  const tokenBalanceKey = (tokenId: string, ownerAddress: string) =>
    `${tokenId}:${ownerAddress}`;
  const tokenReservedBalance = (tokenId: string, ownerAddress: string) => {
    let reserved = 0;
    for (const listing of listings.values()) {
      if (
        listing.tokenId === tokenId &&
        listing.sellerAddress === ownerAddress &&
        !tokenListingIsExpired(listing)
      ) {
        reserved += listing.amount;
      }
    }
    return reserved;
  };
  const tokenSpendableBalance = (tokenId: string, ownerAddress: string) =>
    (balances.get(tokenBalanceKey(tokenId, ownerAddress)) ?? 0) -
    tokenReservedBalance(tokenId, ownerAddress);
  const closeTokenListing = (
    listing: PowTokenListing,
    event: { confirmed: boolean; createdAt: string; txid: string },
  ) => {
    if (
      closedListings.some(
        (closed) =>
          closed.listingId === listing.listingId &&
          closed.closedTxid === event.txid,
      )
    ) {
      return;
    }

    closedListings.push({
      ...listing,
      closedAt: event.createdAt,
      closedConfirmed: event.confirmed,
      closedTxid: event.txid,
    });
  };

  const registryAddresses = [
    ...new Set(tokens.map((token) => token.registryAddress).filter(Boolean)),
  ];

  for (const registryAddress of registryAddresses) {
    const txs = registryTxsByAddress.get(registryAddress) ?? [];
    for (const tx of tokenProtocolSortedTransactions(txs)) {
      const txid = transactionTxid(tx);
      if (!txid) {
        continue;
      }

      const vin = Array.isArray(tx.vin)
        ? (tx.vin as Array<Record<string, unknown>>)
        : [];
      const vout = Array.isArray(tx.vout)
        ? (tx.vout as Array<Record<string, unknown>>)
        : [];
      const txInputAddresses = transactionInputAddresses(vin);
      const actorAddress = txInputAddresses[0] ?? "";
      if (!isValidBitcoinAddress(actorAddress, targetNetwork)) {
        continue;
      }

      const messages = decodedProtocolMessages(vout, TOKEN_PROTOCOL_PREFIX);
      if (messages.length === 0) {
        continue;
      }

      let remainingRegistrySats = tokenPaymentAmountBeforeProtocol(
        vout,
        registryAddress,
      );
      const paymentOutputs = paymentOutputsBeforeTokenProtocol(vout);
      const spentOutpoints = transactionSpentOutpoints(vin);
      const confirmed = transactionConfirmed(tx);
      const createdAt = new Date(tokenTransactionTime(tx)).toISOString();

      for (const message of messages) {
        const parsed = parseTokenPayload(message, targetNetwork);
        if (!parsed) {
          continue;
        }

        if (parsed.kind === "mint") {
          const mintedToken = tokensById.get(parsed.tokenId);
          if (
            !mintedToken ||
            mintedToken.registryAddress !== registryAddress ||
            parsed.amount !== mintedToken.mintAmount ||
            remainingRegistrySats < mintedToken.mintPriceSats
          ) {
            continue;
          }

          const currentSupply = tokenSupply.get(mintedToken.tokenId) ?? {
            confirmed: 0,
            pending: 0,
          };
          if (
            currentSupply.confirmed + currentSupply.pending + parsed.amount >
            mintedToken.maxSupply
          ) {
            continue;
          }

          remainingRegistrySats -= mintedToken.mintPriceSats;
          if (confirmed) {
            currentSupply.confirmed += parsed.amount;
            confirmedSupply += parsed.amount;
            const balanceKey = tokenBalanceKey(mintedToken.tokenId, actorAddress);
            balances.set(balanceKey, (balances.get(balanceKey) ?? 0) + parsed.amount);
          } else {
            currentSupply.pending += parsed.amount;
            pendingSupply += parsed.amount;
          }
          tokenSupply.set(mintedToken.tokenId, currentSupply);

          mints.push({
            amount: parsed.amount,
            confirmed,
            createdAt,
            minterAddress: actorAddress,
            network: targetNetwork,
            paidSats: mintedToken.mintPriceSats,
            registryAddress: mintedToken.registryAddress,
            ticker: mintedToken.ticker,
            tokenId: mintedToken.tokenId,
            txid,
          });
          continue;
        }

        if (parsed.kind === "send") {
          const sentToken = tokensById.get(parsed.tokenId);
          if (
            !sentToken ||
            sentToken.registryAddress !== registryAddress ||
            remainingRegistrySats < TOKEN_MIN_MUTATION_PRICE_SATS
          ) {
            continue;
          }

          const senderBalanceKey = `${sentToken.tokenId}:${actorAddress}`;
          const recipientBalanceKey = `${sentToken.tokenId}:${parsed.recipientAddress}`;
          const senderBalance = balances.get(senderBalanceKey) ?? 0;
          if (
            confirmed &&
            tokenSpendableBalance(sentToken.tokenId, actorAddress) < parsed.amount
          ) {
            continue;
          }

          remainingRegistrySats -= TOKEN_MIN_MUTATION_PRICE_SATS;
          if (confirmed) {
            balances.set(senderBalanceKey, senderBalance - parsed.amount);
            balances.set(
              recipientBalanceKey,
              (balances.get(recipientBalanceKey) ?? 0) + parsed.amount,
            );
          }

          transfers.push({
            amount: parsed.amount,
            confirmed,
            createdAt,
            network: targetNetwork,
            paidSats: TOKEN_MIN_MUTATION_PRICE_SATS,
            recipientAddress: parsed.recipientAddress,
            registryAddress: sentToken.registryAddress,
            senderAddress: actorAddress,
            ticker: sentToken.ticker,
            tokenId: sentToken.tokenId,
            txid,
          });
          continue;
        }

        if (parsed.kind === "list") {
          const authorization = parsed.saleAuthorization;
          const listedToken = tokensById.get(authorization.tokenId);
          if (
            !listedToken ||
            listedToken.registryAddress !== registryAddress ||
            authorization.registryAddress !== registryAddress ||
            authorization.ticker !== listedToken.ticker ||
            authorization.sellerAddress !== actorAddress ||
            remainingRegistrySats < TOKEN_MIN_MUTATION_PRICE_SATS ||
            tokenSpendableBalance(listedToken.tokenId, actorAddress) <
              authorization.amount ||
            !tokenListingAnchorIsPresent(vout, authorization) ||
            listings.has(txid)
          ) {
            continue;
          }

          remainingRegistrySats -= TOKEN_MIN_MUTATION_PRICE_SATS;
          listings.set(txid, {
            amount: authorization.amount,
            confirmed,
            createdAt,
            dataBytes: proofProtocolDataBytesForVout(vout),
            listingId: txid,
            network: targetNetwork,
            priceSats: authorization.priceSats,
            registryAddress,
            saleAuthorization: authorization,
            sellerAddress: actorAddress,
            ticker: listedToken.ticker,
            tokenId: listedToken.tokenId,
          });
          continue;
        }

        if (parsed.kind === "seal") {
          const listing = listings.get(parsed.listingId);
          const authorization = parsed.saleAuthorization;
          if (
            !listing ||
            listing.sellerAddress !== actorAddress ||
            remainingRegistrySats < TOKEN_MIN_MUTATION_PRICE_SATS ||
            !tokenSaleAuthorizationTermsMatch(
              listing.saleAuthorization,
              authorization,
            ) ||
            authorization.anchorTxid !== listing.listingId ||
            !tokenSaleAuthorizationUsesSaleTicketAnchor(authorization)
          ) {
            continue;
          }

          remainingRegistrySats -= TOKEN_MIN_MUTATION_PRICE_SATS;
          listings.set(listing.listingId, {
            ...listing,
            saleAuthorization: authorization,
            sealTxid: txid,
          });
          continue;
        }

        if (parsed.kind === "delist") {
          const listing = listings.get(parsed.listingId);
          if (
            !listing ||
            listing.sellerAddress !== actorAddress ||
            remainingRegistrySats < TOKEN_MIN_MUTATION_PRICE_SATS ||
            !spendsTokenListingAnchor(spentOutpoints, listing)
          ) {
            continue;
          }

          remainingRegistrySats -= TOKEN_MIN_MUTATION_PRICE_SATS;
          closeTokenListing(listing, { confirmed, createdAt, txid });
          listings.delete(listing.listingId);
          continue;
        }

        if (parsed.kind === "buy") {
          const listing = listings.get(parsed.listingId);
          const sellerBalanceKey = listing
            ? tokenBalanceKey(listing.tokenId, listing.sellerAddress)
            : "";
          const buyerBalanceKey = listing
            ? tokenBalanceKey(listing.tokenId, parsed.buyerAddress)
            : "";
          if (
            !listing ||
            !txInputAddresses.includes(parsed.buyerAddress) ||
            remainingRegistrySats < TOKEN_MIN_MUTATION_PRICE_SATS ||
            !tokenSaleAuthorizationUsesSaleTicketAnchor(
              listing.saleAuthorization,
            ) ||
            (listing.saleAuthorization.buyerAddress &&
              listing.saleAuthorization.buyerAddress !== parsed.buyerAddress) ||
            tokenListingIsExpired(listing) ||
            !spendsTokenListingAnchor(spentOutpoints, listing) ||
            paymentAmountFromSnapshots(paymentOutputs, listing.sellerAddress) <
              tokenSellerPaymentRequiredSats(listing) ||
            (confirmed &&
              (balances.get(sellerBalanceKey) ?? 0) < listing.amount)
          ) {
            continue;
          }

          remainingRegistrySats -= TOKEN_MIN_MUTATION_PRICE_SATS;
          closeTokenListing(listing, { confirmed, createdAt, txid });
          listings.delete(listing.listingId);
          if (confirmed) {
            const sellerBalance = balances.get(sellerBalanceKey) ?? 0;
            balances.set(sellerBalanceKey, sellerBalance - listing.amount);
            balances.set(
              buyerBalanceKey,
              (balances.get(buyerBalanceKey) ?? 0) + listing.amount,
            );
          }

          sales.push({
            amount: listing.amount,
            buyerAddress: parsed.buyerAddress,
            confirmed,
            createdAt,
            listingId: listing.listingId,
            network: targetNetwork,
            paidSats:
              tokenSellerPaymentRequiredSats(listing) +
              TOKEN_MIN_MUTATION_PRICE_SATS,
            priceSats: listing.priceSats,
            registryAddress,
            sellerAddress: listing.sellerAddress,
            ticker: listing.ticker,
            tokenId: listing.tokenId,
            txid,
          });
        }
      }
    }
  }

  return {
    closedListings: closedListings.sort(
      (left, right) =>
        Number(Boolean(right.closedConfirmed)) -
          Number(Boolean(left.closedConfirmed)) ||
        Date.parse(right.closedAt ?? right.createdAt) -
          Date.parse(left.closedAt ?? left.createdAt) ||
        left.listingId.localeCompare(right.listingId),
    ),
    creationSats,
    confirmedSupply,
    holders: [...balances.entries()]
      .filter(([, balance]) => balance > 0)
      .map(([key, balance]) => ({ address: key.split(":").slice(1).join(":"), balance }))
      .sort(
        (left, right) =>
          right.balance - left.balance ||
        left.address.localeCompare(right.address),
      ),
    listings: [...listings.values()]
      .filter((listing) => !tokenListingIsExpired(listing))
      .sort(
        (left, right) =>
          Number(right.confirmed) - Number(left.confirmed) ||
          Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
          left.listingId.localeCompare(right.listingId),
      ),
    mints: mints.sort(
      (left, right) =>
        Number(right.confirmed) - Number(left.confirmed) ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.txid.localeCompare(right.txid),
    ),
    pendingSupply,
    sales: sales.sort(
      (left, right) =>
        Number(right.confirmed) - Number(left.confirmed) ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.txid.localeCompare(right.txid),
    ),
    transfers: transfers.sort(
      (left, right) =>
        Number(right.confirmed) - Number(left.confirmed) ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.txid.localeCompare(right.txid),
    ),
    tokens,
  };
}

function tokenLedgerFor(
  token: PowTokenDefinition | undefined,
  mints: PowTokenMint[],
  transfers: PowTokenTransfer[] = [],
  sales: PowTokenSale[] = [],
) {
  const balances = new Map<string, number>();
  let confirmedSupply = 0;
  let pendingSupply = 0;
  const tokenMints = token
    ? mints.filter((mint) => mint.tokenId === token.tokenId)
    : [];

  tokenMints.forEach((mint) => {
    if (mint.confirmed) {
      confirmedSupply += mint.amount;
      balances.set(
        mint.minterAddress,
        (balances.get(mint.minterAddress) ?? 0) + mint.amount,
      );
    } else {
      pendingSupply += mint.amount;
    }
  });

  transfers
    .filter((transfer) => token && transfer.tokenId === token.tokenId)
    .forEach((transfer) => {
      if (!transfer.confirmed) {
        return;
      }

      balances.set(
        transfer.senderAddress,
        (balances.get(transfer.senderAddress) ?? 0) - transfer.amount,
      );
      balances.set(
        transfer.recipientAddress,
        (balances.get(transfer.recipientAddress) ?? 0) + transfer.amount,
      );
    });

  sales
    .filter((sale) => token && sale.tokenId === token.tokenId)
    .forEach((sale) => {
      if (!sale.confirmed) {
        return;
      }

      balances.set(
        sale.sellerAddress,
        (balances.get(sale.sellerAddress) ?? 0) - sale.amount,
      );
      balances.set(
        sale.buyerAddress,
        (balances.get(sale.buyerAddress) ?? 0) + sale.amount,
      );
    });

  const summaryConfirmedSupply =
    token && Number.isFinite(token.confirmedSupply)
      ? Math.max(0, Number(token.confirmedSupply))
      : 0;
  const summaryPendingSupply =
    token && Number.isFinite(token.pendingSupply)
      ? Math.max(0, Number(token.pendingSupply))
      : 0;

  return {
    confirmedSupply: Math.max(confirmedSupply, summaryConfirmedSupply),
    holders: [...balances.entries()]
      .filter(([, balance]) => balance > 0)
      .map(([holderAddress, balance]) => ({ address: holderAddress, balance }))
      .sort(
        (left, right) =>
          right.balance - left.balance ||
          left.address.localeCompare(right.address),
      ),
    mints: tokenMints,
    pendingSupply: Math.max(pendingSupply, summaryPendingSupply),
  };
}

function sanitizedTokenState(state: PowTokenState): PowTokenState {
  const summaryOnly = Boolean(state.summaryOnly);
  const tokens = state.tokens.filter((token) =>
    tokenCreationIsAllowed({
      creatorAddress: token.creatorAddress,
      ticker: token.ticker,
      tokenId: token.tokenId,
    }),
  );
  const allowedTokenIds = new Set(tokens.map((token) => token.tokenId));
  const mints = state.mints.filter((mint) => allowedTokenIds.has(mint.tokenId));
  const transfers = state.transfers.filter((transfer) =>
    allowedTokenIds.has(transfer.tokenId),
  );
  const listings = (state.listings ?? []).filter((listing) =>
    allowedTokenIds.has(listing.tokenId),
  );
  const closedListings = (state.closedListings ?? []).filter((listing) =>
    allowedTokenIds.has(listing.tokenId),
  );
  const sales = (state.sales ?? []).filter((sale) =>
    allowedTokenIds.has(sale.tokenId),
  );

  if (tokens.length === 1) {
    const ledger = tokenLedgerFor(tokens[0], mints, transfers, sales);
    return {
      closedListings,
      creationSats: tokens[0].creationFeeSats,
      confirmedSupply: summaryOnly
        ? Math.max(ledger.confirmedSupply, state.confirmedSupply)
        : ledger.confirmedSupply,
      holders: summaryOnly && state.holders.length > 0 ? state.holders : ledger.holders,
      listings,
      mints,
      pendingSupply: summaryOnly
        ? Math.max(ledger.pendingSupply, state.pendingSupply)
        : ledger.pendingSupply,
      sales,
      summaryOnly,
      tokens,
      transfers,
    };
  }

  return {
    closedListings,
    creationSats: tokens.reduce(
      (total, token) => total + token.creationFeeSats,
      0,
    ),
    confirmedSupply: summaryOnly
      ? state.confirmedSupply
      : mints
          .filter((mint) => mint.confirmed)
          .reduce((total, mint) => total + mint.amount, 0),
    holders: summaryOnly ? state.holders : [],
    listings,
    mints,
    pendingSupply: summaryOnly
      ? state.pendingSupply
      : mints
          .filter((mint) => !mint.confirmed)
          .reduce((total, mint) => total + mint.amount, 0),
    sales,
    summaryOnly,
    tokens,
    transfers,
  };
}

function tokenWalletBalancesFor(
  walletAddress: string,
  tokens: PowTokenDefinition[],
  mints: PowTokenMint[],
  transfers: PowTokenTransfer[],
  sales: PowTokenSale[] = [],
): PowTokenWalletBalance[] {
  if (!walletAddress) {
    return [];
  }

  return tokens
    .map((token) => {
      let confirmedBalance = 0;
      let pendingIncoming = 0;
      let pendingOutgoing = 0;

      for (const mint of mints) {
        if (mint.tokenId !== token.tokenId || mint.minterAddress !== walletAddress) {
          continue;
        }

        if (mint.confirmed) {
          confirmedBalance += mint.amount;
        } else {
          pendingIncoming += mint.amount;
        }
      }

      for (const transfer of transfers) {
        if (transfer.tokenId !== token.tokenId) {
          continue;
        }

        if (transfer.confirmed) {
          if (transfer.senderAddress === walletAddress) {
            confirmedBalance -= transfer.amount;
          }
          if (transfer.recipientAddress === walletAddress) {
            confirmedBalance += transfer.amount;
          }
          continue;
        }

        if (transfer.senderAddress === walletAddress) {
          pendingOutgoing += transfer.amount;
        }
        if (transfer.recipientAddress === walletAddress) {
          pendingIncoming += transfer.amount;
        }
      }

      for (const sale of sales) {
        if (sale.tokenId !== token.tokenId) {
          continue;
        }

        if (sale.confirmed) {
          if (sale.sellerAddress === walletAddress) {
            confirmedBalance -= sale.amount;
          }
          if (sale.buyerAddress === walletAddress) {
            confirmedBalance += sale.amount;
          }
          continue;
        }

        if (sale.sellerAddress === walletAddress) {
          pendingOutgoing += sale.amount;
        }
        if (sale.buyerAddress === walletAddress) {
          pendingIncoming += sale.amount;
        }
      }

      return {
        confirmedBalance: Math.max(0, confirmedBalance),
        pendingIncoming,
        pendingOutgoing,
        token,
      };
    })
    .filter(
      (item) =>
        item.confirmedBalance > 0 ||
        item.pendingIncoming > 0 ||
        item.pendingOutgoing > 0,
    )
    .sort(
      (left, right) =>
        right.confirmedBalance - left.confirmedBalance ||
        left.token.ticker.localeCompare(right.token.ticker) ||
        left.token.tokenId.localeCompare(right.token.tokenId),
    );
}

function tokenReservedBalanceFor(
  listings: PowTokenListing[],
  tokenId: string,
  ownerAddress: string,
) {
  if (!tokenId || !ownerAddress) {
    return 0;
  }

  return listings.reduce(
    (total, listing) =>
      listing.tokenId === tokenId &&
      listing.sellerAddress === ownerAddress &&
      !tokenListingIsExpired(listing)
        ? total + listing.amount
        : total,
    0,
  );
}

function tokenHolderMatchesSearch(holder: PowTokenHolder, query: string) {
  if (!query) {
    return true;
  }

  return [holder.address, String(holder.balance)].some((value) =>
    value.toLowerCase().includes(query),
  );
}

function tokenMintMatchesSearch(mint: PowTokenMint, query: string) {
  if (!query) {
    return true;
  }

  return [
    mint.txid,
    mint.minterAddress,
    mint.registryAddress,
    mint.ticker,
    mint.confirmed ? "confirmed" : "pending",
    String(mint.amount),
    String(mint.paidSats),
    formatDate(mint.createdAt),
  ].some((value) => value.toLowerCase().includes(query));
}

function compareTokensByConfirmation(
  left: PowTokenDefinition,
  right: PowTokenDefinition,
) {
  if (left.confirmed !== right.confirmed) {
    return Number(right.confirmed) - Number(left.confirmed);
  }

  return (
    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    left.txid.localeCompare(right.txid)
  );
}

function tokenDetailHref(token: PowTokenDefinition) {
  if (token.ticker === WORK_TOKEN_TICKER) {
    return appHref(WORK_TOKEN_APP_URL, LOCAL_WORK_TOKEN_APP_URL);
  }

  return appHref(
    `${TOKEN_APP_URL}/?asset=${encodeURIComponent(token.tokenId)}`,
    `/?token=1&asset=${encodeURIComponent(token.tokenId)}`,
  );
}

function tokenProgressPercent(confirmedSupply: number, maxSupply: number) {
  if (!Number.isFinite(maxSupply) || maxSupply <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (confirmedSupply / maxSupply) * 100));
}

function tokenProgressLabel(confirmedSupply: number, maxSupply: number) {
  const progress = tokenProgressPercent(confirmedSupply, maxSupply);
  if (progress > 0 && progress < 0.01) {
    return "<0.01%";
  }

  return `${progress.toLocaleString(undefined, {
    maximumFractionDigits: progress < 1 ? 2 : 1,
  })}%`;
}

function tokenMintSupplyState(
  token: PowTokenDefinition | undefined,
  confirmedSupply: number,
  pendingSupply: number,
) {
  const maxSupply = token?.maxSupply ?? 0;
  const confirmedRemainingSupply = Math.max(0, maxSupply - confirmedSupply);
  const availableSupply = Math.max(
    0,
    confirmedRemainingSupply - pendingSupply,
  );
  const mintedOut = Boolean(token && maxSupply > 0 && confirmedRemainingSupply <= 0);
  const pendingMintOut = Boolean(
    token &&
      !mintedOut &&
      confirmedRemainingSupply > 0 &&
      pendingSupply >= confirmedRemainingSupply,
  );
  const wouldOverfill = Boolean(
    token &&
      !mintedOut &&
      !pendingMintOut &&
      token.mintAmount > availableSupply,
  );

  return {
    availableSupply,
    confirmedRemainingSupply,
    mintedOut,
    pendingMintOut,
    wouldOverfill,
  };
}

function decodedOpReturnAt(vout: Array<Record<string, unknown>>, index: number) {
  const output = vout[index];
  if (!output || output.scriptpubkey_type !== "op_return") {
    return "";
  }

  return decodedOpReturnMessages([output])[0] ?? "";
}

function idEventMinimumPaymentSats(
  kind:
    | "register"
    | "update"
    | "transfer"
    | "marketTransfer"
    | "list"
    | "seal"
    | "delist",
) {
  return kind === "register"
    ? ID_REGISTRATION_PRICE_SATS
    : ID_MUTATION_PRICE_SATS;
}

function paymentOutputsBeforeIdProtocol(
  vout: Array<Record<string, unknown>>,
): PowIdPaymentSnapshot[] {
  const protocolIndex = firstIdProtocolOutputIndex(vout);
  return vout.flatMap((output, index): PowIdPaymentSnapshot[] => {
    if (
      typeof output.scriptpubkey_address !== "string" ||
      typeof output.value !== "number" ||
      output.value <= 0 ||
      (protocolIndex !== -1 && index >= protocolIndex)
    ) {
      return [];
    }

    return [{ address: output.scriptpubkey_address, amountSats: output.value }];
  });
}

function paymentAmountFromSnapshots(
  outputs: PowIdPaymentSnapshot[],
  address: string,
) {
  return outputs.reduce(
    (total, output) =>
      total + (output.address === address ? output.amountSats : 0),
    0,
  );
}

function paymentAmountBeforeIdProtocol(
  vout: Array<Record<string, unknown>>,
  address: string,
) {
  const protocolIndex = firstIdProtocolOutputIndex(vout);
  return vout.reduce((total, output, index) => {
    if (
      output.scriptpubkey_address === address &&
      typeof output.value === "number" &&
      output.value > 0 &&
      (protocolIndex === -1 || index < protocolIndex)
    ) {
      return total + output.value;
    }

    return total;
  }, 0);
}

function parseIdRegistrationPayload(
  payload: string,
  targetNetwork: BitcoinNetwork,
) {
  let rawId = "";
  let ownerAddress = "";
  let receiveAddress = "";
  let pgpEncoded = "";

  // r2 is the canonical launch format. The ID is base64url encoded so
  // punctuation/Unicode cannot corrupt the colon-delimited registry envelope.
  if (payload.startsWith("r2:")) {
    const parts = payload.split(":");
    if (parts.length < 4 || parts.length > 5) {
      return null;
    }

    const [, idEncoded, owner, receiver, pgp] = parts;
    try {
      rawId = decodeTextBase64Url(idEncoded);
    } catch {
      return null;
    }

    ownerAddress = owner;
    receiveAddress = receiver;
    pgpEncoded = pgp ?? "";
  } else if (payload.startsWith("r:")) {
    // Legacy reader compatibility only. New writes must use r2.
    const parts = payload.split(":");
    if (parts.length < 4 || parts.length > 5) {
      return null;
    }

    const [, id, owner, receiver, pgp] = parts;
    rawId = id;
    ownerAddress = owner;
    receiveAddress = receiver;
    pgpEncoded = pgp ?? "";
  } else {
    return null;
  }

  const id = normalizePowId(rawId);
  if (
    powIdError(id) ||
    !isValidBitcoinAddress(ownerAddress, targetNetwork) ||
    !isValidBitcoinAddress(receiveAddress, targetNetwork)
  ) {
    return null;
  }

  let pgpKey = "";
  if (pgpEncoded) {
    try {
      pgpKey = decodeTextBase64Url(pgpEncoded).trim();
    } catch {
      return null;
    }
  }

  return {
    id,
    ownerAddress,
    pgpKey,
    receiveAddress,
  };
}

function parseIdReceiverUpdatePayload(
  payload: string,
  targetNetwork: BitcoinNetwork,
) {
  if (!payload.startsWith("u:")) {
    return null;
  }

  const parts = payload.split(":");
  if (parts.length !== 3) {
    return null;
  }

  const [, idEncoded, receiver] = parts;
  let rawId = "";
  try {
    rawId = decodeTextBase64Url(idEncoded);
  } catch {
    return null;
  }

  const id = normalizePowId(rawId);
  if (powIdError(id) || !isValidBitcoinAddress(receiver, targetNetwork)) {
    return null;
  }

  return {
    id,
    receiveAddress: receiver,
  };
}

function parseIdTransferPayload(
  payload: string,
  targetNetwork: BitcoinNetwork,
) {
  if (!payload.startsWith("t:")) {
    return null;
  }

  const parts = payload.split(":");
  if (parts.length < 3 || parts.length > 4) {
    return null;
  }

  const [, idEncoded, owner, receiver] = parts;
  let rawId = "";
  try {
    rawId = decodeTextBase64Url(idEncoded);
  } catch {
    return null;
  }

  const receiveAddress = receiver?.trim() || owner;
  const id = normalizePowId(rawId);
  if (
    powIdError(id) ||
    !isValidBitcoinAddress(owner, targetNetwork) ||
    !isValidBitcoinAddress(receiveAddress, targetNetwork)
  ) {
    return null;
  }

  return {
    id,
    ownerAddress: owner,
    receiveAddress,
  };
}

function parseIdMarketplaceTransferPayload(
  payload: string,
  targetNetwork: BitcoinNetwork,
) {
  const parts = payload.split(":");
  if (
    payload.startsWith("buy3:") ||
    payload.startsWith("buy4:") ||
    payload.startsWith("buy5:")
  ) {
    if (
      parts.length < 3 ||
      parts.length > 4 ||
      !/^[0-9a-fA-F]{64}$/u.test(parts[1])
    ) {
      return null;
    }

    const [, listingId, owner, receiver] = parts;
    const receiveAddress = receiver?.trim() || owner;
    if (
      !isValidBitcoinAddress(owner, targetNetwork) ||
      !isValidBitcoinAddress(receiveAddress, targetNetwork)
    ) {
      return null;
    }

    return {
      listingId: listingId.toLowerCase(),
      ownerAddress: owner,
      receiveAddress,
      transferVersion: payload.startsWith("buy5:")
        ? ("buy5" as const)
        : payload.startsWith("buy4:")
          ? ("buy4" as const)
          : ("buy3" as const),
    };
  }

  if (!payload.startsWith("buy2:")) {
    return null;
  }

  if (parts.length < 3 || parts.length > 4) {
    return null;
  }

  const [, authorizationEncoded, owner, receiver] = parts;
  let authorization: PowIdSaleAuthorization;
  try {
    authorization = parseSaleAuthorizationJson(
      decodeTextBase64Url(authorizationEncoded),
      targetNetwork,
    );
  } catch {
    return null;
  }

  const receiveAddress = receiver?.trim() || owner;
  if (
    !isValidBitcoinAddress(owner, targetNetwork) ||
    !isValidBitcoinAddress(receiveAddress, targetNetwork)
  ) {
    return null;
  }

  if (authorization.buyerAddress && authorization.buyerAddress !== owner) {
    return null;
  }

  if (
    authorization.receiveAddress &&
    authorization.receiveAddress !== receiveAddress
  ) {
    return null;
  }

  return {
    id: authorization.id,
    ownerAddress: owner,
    priceSats: authorization.priceSats,
    receiveAddress,
    saleAuthorization: authorization,
    sellerAddress: authorization.sellerAddress,
    transferVersion: "buy2" as const,
  };
}

function parseIdListingPayload(payload: string, targetNetwork: BitcoinNetwork) {
  const listingVersion: PowIdListingVersion = payload.startsWith("list5:")
    ? "list5"
    : payload.startsWith("list4:")
      ? "list4"
      : payload.startsWith("list3:")
        ? "list3"
        : payload.startsWith("list2:")
          ? "list2"
          : "list2";
  if (
    !payload.startsWith("list2:") &&
    !payload.startsWith("list3:") &&
    !payload.startsWith("list4:") &&
    !payload.startsWith("list5:")
  ) {
    return null;
  }

  const parts = payload.split(":");
  if (parts.length !== 2) {
    return null;
  }

  const [, authorizationEncoded] = parts;
  let authorization: PowIdSaleAuthorization;
  try {
    authorization = parseSaleAuthorizationJson(
      decodeTextBase64Url(authorizationEncoded),
      targetNetwork,
    );
  } catch {
    return null;
  }

  return {
    id: authorization.id,
    listingVersion,
    priceSats: authorization.priceSats,
    saleAuthorization: authorization,
    sellerAddress: authorization.sellerAddress,
  };
}

function parseIdSaleSealPayload(
  payload: string,
  targetNetwork: BitcoinNetwork,
) {
  if (!payload.startsWith("seal5:")) {
    return null;
  }

  const parts = payload.split(":");
  if (parts.length !== 3 || !/^[0-9a-fA-F]{64}$/u.test(parts[1])) {
    return null;
  }

  const [, listingId, authorizationEncoded] = parts;
  let authorization: PowIdSaleAuthorization;
  try {
    authorization = parseSaleAuthorizationJson(
      decodeTextBase64Url(authorizationEncoded),
      targetNetwork,
    );
  } catch {
    return null;
  }

  return {
    listingId: listingId.toLowerCase(),
    saleAuthorization: authorization,
  };
}

function parseIdDelistingPayload(payload: string) {
  const delistingVersion: PowIdDelistingVersion = payload.startsWith("delist5:")
    ? "delist5"
    : payload.startsWith("delist4:")
      ? "delist4"
      : payload.startsWith("delist3:")
        ? "delist3"
        : payload.startsWith("delist2:")
          ? "delist2"
          : "delist2";
  if (
    !payload.startsWith("delist2:") &&
    !payload.startsWith("delist3:") &&
    !payload.startsWith("delist4:") &&
    !payload.startsWith("delist5:")
  ) {
    return null;
  }

  const parts = payload.split(":");
  if (parts.length !== 2 || !/^[0-9a-fA-F]{64}$/u.test(parts[1])) {
    return null;
  }

  return {
    delistingVersion,
    listingId: parts[1].toLowerCase(),
  };
}

function parseIdEventPayload(payload: string, targetNetwork: BitcoinNetwork) {
  const registration = parseIdRegistrationPayload(payload, targetNetwork);
  if (registration) {
    return {
      kind: "register" as const,
      ...registration,
    };
  }

  const update = parseIdReceiverUpdatePayload(payload, targetNetwork);
  if (update) {
    return {
      kind: "update" as const,
      ...update,
    };
  }

  const transfer = parseIdTransferPayload(payload, targetNetwork);
  if (transfer) {
    return {
      kind: "transfer" as const,
      ...transfer,
    };
  }

  const marketplaceTransfer = parseIdMarketplaceTransferPayload(
    payload,
    targetNetwork,
  );
  if (marketplaceTransfer) {
    return {
      kind: "marketTransfer" as const,
      ...marketplaceTransfer,
    };
  }

  const listing = parseIdListingPayload(payload, targetNetwork);
  if (listing) {
    return {
      kind: "list" as const,
      ...listing,
    };
  }

  const seal = parseIdSaleSealPayload(payload, targetNetwork);
  if (seal) {
    return {
      kind: "seal" as const,
      ...seal,
    };
  }

  const delisting = parseIdDelistingPayload(payload);
  if (delisting) {
    return {
      kind: "delist" as const,
      ...delisting,
    };
  }

  return null;
}

async function fetchAddressTransactionsPage(
  targetAddress: string,
  targetNetwork: BitcoinNetwork,
  path: string,
) {
  const transactions = await fetchProofApiJson<Array<Record<string, unknown>>>(
    `/api/v1/address/${encodeURIComponent(targetAddress)}/${path}`,
    targetNetwork,
  );
  return Array.isArray(transactions)
    ? (transactions as Array<Record<string, unknown>>)
    : [];
}

async function fetchAddressTransactions(
  targetAddress: string,
  targetNetwork: BitcoinNetwork,
) {
  return fetchAddressTransactionsPage(targetAddress, targetNetwork, "txs");
}

function transactionTxid(tx: Record<string, unknown>) {
  return typeof tx.txid === "string" && /^[0-9a-fA-F]{64}$/u.test(tx.txid)
    ? tx.txid.toLowerCase()
    : "";
}

function transactionConfirmed(tx: Record<string, unknown>) {
  const status = tx.status as Record<string, unknown> | undefined;
  return Boolean(status?.confirmed);
}

function transactionBlockHash(tx: Record<string, unknown>) {
  const status = tx.status as Record<string, unknown> | undefined;
  const blockHash = status?.block_hash;
  return typeof blockHash === "string" && /^[0-9a-fA-F]{64}$/u.test(blockHash)
    ? blockHash.toLowerCase()
    : "";
}

function transactionBlockHeight(tx: Record<string, unknown>) {
  const status = tx.status as Record<string, unknown> | undefined;
  const height = status?.block_height;
  return typeof height === "number" &&
    Number.isSafeInteger(height) &&
    height >= 0
    ? height
    : undefined;
}

function transactionBlockIndex(tx: Record<string, unknown>) {
  const status = tx.status as Record<string, unknown> | undefined;
  const index =
    tx._powBlockIndex ?? status?.block_index ?? status?.block_tx_index;
  return typeof index === "number" && Number.isSafeInteger(index) && index >= 0
    ? index
    : undefined;
}

async function annotateBlockOrder(
  txs: Array<Record<string, unknown>>,
  targetNetwork: BitcoinNetwork,
) {
  const blockCounts = new Map<string, number>();
  for (const tx of txs) {
    if (!transactionConfirmed(tx)) {
      continue;
    }

    const blockHash = transactionBlockHash(tx);
    if (blockHash) {
      blockCounts.set(blockHash, (blockCounts.get(blockHash) ?? 0) + 1);
    }
  }

  const blockHashes = [...blockCounts]
    .filter(([, count]) => count > 1)
    .map(([blockHash]) => blockHash);

  if (blockHashes.length === 0) {
    return txs;
  }

  const blockIndexes = new Map<string, Map<string, number>>();
  await Promise.all(
    blockHashes.map(async (blockHash) => {
      const index = await fetchBlockTxidIndex(blockHash, targetNetwork).catch(
        () => null,
      );
      if (index) {
        blockIndexes.set(blockHash, index);
      }
    }),
  );

  if (blockIndexes.size === 0) {
    return txs;
  }

  return txs.map((tx) => {
    const txid = transactionTxid(tx);
    const blockHash = transactionBlockHash(tx);
    const index = blockIndexes.get(blockHash)?.get(txid);
    return Number.isSafeInteger(index) ? { ...tx, _powBlockIndex: index } : tx;
  });
}

function oldestConfirmedTxid(txs: Array<Record<string, unknown>>) {
  const confirmedTxs = txs.filter(transactionConfirmed);
  return confirmedTxs.length > 0
    ? transactionTxid(confirmedTxs[confirmedTxs.length - 1])
    : "";
}

function dedupeTransactions(txs: Array<Record<string, unknown>>) {
  const merged = new Map<string, Record<string, unknown>>();

  for (const tx of txs) {
    const txid = transactionTxid(tx);
    if (!txid) {
      continue;
    }

    const current = merged.get(txid);
    if (
      !current ||
      (transactionConfirmed(tx) && !transactionConfirmed(current))
    ) {
      merged.set(txid, tx);
    }
  }

  return [...merged.values()];
}

async function fetchRegistryTransactions(
  registryAddress: string,
  targetNetwork: BitcoinNetwork,
) {
  const recentTxs = await fetchAddressTransactions(
    registryAddress,
    targetNetwork,
  );
  const mempoolTxs = await fetchAddressTransactionsPage(
    registryAddress,
    targetNetwork,
    "txs/mempool",
  );

  let chainPage: Array<Record<string, unknown>>;
  try {
    chainPage = await fetchAddressTransactionsPage(
      registryAddress,
      targetNetwork,
      "txs/chain",
    );
  } catch {
    chainPage = recentTxs.filter(transactionConfirmed);
  }

  if (chainPage.length === 0) {
    chainPage = recentTxs.filter(transactionConfirmed);
  }

  const chainTxs = [...chainPage];
  const cursors = new Set<string>();
  let cursor = oldestConfirmedTxid(chainPage);

  for (let page = 0; cursor && page < MAX_REGISTRY_TX_PAGES; page += 1) {
    if (cursors.has(cursor)) {
      break;
    }

    cursors.add(cursor);
    const nextPage = await fetchAddressTransactionsPage(
      registryAddress,
      targetNetwork,
      `txs/chain/${cursor}`,
    );
    if (nextPage.length === 0) {
      break;
    }

    chainTxs.push(...nextPage);
    cursor = oldestConfirmedTxid(nextPage);
  }

  const txs = dedupeTransactions([...chainTxs, ...mempoolTxs, ...recentTxs]);
  return annotateBlockOrder(txs, targetNetwork);
}

function inboxMessagesFromTransactions(
  txs: Array<Record<string, unknown>>,
  targetAddress: string,
  targetNetwork: BitcoinNetwork,
): InboxMessage[] {
  return txs.flatMap((tx): InboxMessage[] => {
    const vin = Array.isArray(tx.vin)
      ? (tx.vin as Array<Record<string, unknown>>)
      : [];
    const vout = Array.isArray(tx.vout)
      ? (tx.vout as Array<Record<string, unknown>>)
      : [];
    const protocolMessage = extractProtocolMemo(vout);
    const amount = receivedPaymentAmount(vout, targetAddress);
    const recipients = protocolPaymentOutputs(vout);

    if (!protocolMessage || amount <= 0) {
      return [];
    }

    const status = tx.status as Record<string, unknown> | undefined;
    const blockTime =
      typeof status?.block_time === "number"
        ? status.block_time * 1000
        : Date.now();
    const sender = senderAddress(vin, targetAddress);

    const message: InboxMessage = {
      txid: String(tx.txid),
      network: targetNetwork,
      from: sender,
      to: targetAddress,
      amountSats: amount,
      memo: protocolMessage.memo,
      subject: protocolMessage.subject,
      attachment: protocolMessage.attachment,
      replyTo:
        sender === "Unknown" ? (protocolMessage.replyTo ?? "Unknown") : sender,
      recipients: recipients.length > 0 ? recipients : undefined,
      confirmed: Boolean(status?.confirmed),
      createdAt: new Date(blockTime).toISOString(),
    };

    if (protocolMessage.parentTxid) {
      message.parentTxid = protocolMessage.parentTxid;
    }

    return [message];
  });
}

function sentMessagesFromTransactions(
  txs: Array<Record<string, unknown>>,
  targetAddress: string,
  targetNetwork: BitcoinNetwork,
): SentMessage[] {
  return txs.flatMap((tx): SentMessage[] => {
    const vin = Array.isArray(tx.vin)
      ? (tx.vin as Array<Record<string, unknown>>)
      : [];
    const vout = Array.isArray(tx.vout)
      ? (tx.vout as Array<Record<string, unknown>>)
      : [];
    const inputAddresses = transactionInputAddresses(vin);

    if (!inputAddresses.includes(targetAddress)) {
      return [];
    }

    const protocolMessage = extractProtocolMemo(vout);
    const recipients = protocolPaymentOutputs(vout);
    const payment = recipients[0];
    const txid =
      typeof tx.txid === "string" && /^[0-9a-fA-F]{64}$/.test(tx.txid)
        ? tx.txid.toLowerCase()
        : "";

    if (!protocolMessage || !payment || !txid) {
      return [];
    }

    const status = tx.status as Record<string, unknown> | undefined;
    const confirmed = Boolean(status?.confirmed);
    const blockTime =
      typeof status?.block_time === "number"
        ? status.block_time * 1000
        : Date.now();
    const createdAt = new Date(blockTime).toISOString();

    return [
      {
        amountSats: totalRecipientSats(recipients),
        attachment: protocolMessage.attachment,
        confirmedAt: confirmed ? createdAt : undefined,
        createdAt,
        feeRate: 0,
        from: targetAddress,
        lastCheckedAt: new Date().toISOString(),
        memo: protocolMessage.memo,
        network: targetNetwork,
        parentTxid: protocolMessage.parentTxid,
        recipients,
        subject: protocolMessage.subject,
        replyTo: targetAddress,
        status: confirmed ? "confirmed" : "pending",
        to: recipientSummary(recipients, payment.address),
        txid,
      },
    ];
  });
}

async function fetchAddressMail(
  targetAddress: string,
  targetNetwork: BitcoinNetwork,
) {
  const payload = await fetchProofApiJson<PowMailApiResponse>(
    `/api/v1/address/${encodeURIComponent(targetAddress)}/mail`,
    targetNetwork,
  );
  return {
    inboxMessages: Array.isArray(payload.inboxMessages)
      ? payload.inboxMessages
      : [],
    sentMessages: Array.isArray(payload.sentMessages)
      ? payload.sentMessages
      : [],
  };
}

async function fetchTransactionJson(
  txid: string,
  targetNetwork: BitcoinNetwork,
) {
  const normalizedTxid = txid.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(normalizedTxid)) {
    throw new Error("Enter a valid Bitcoin txid.");
  }

  const payload = await fetchProofApiJson<{
    tx?: Record<string, unknown> | null;
  }>(`/api/v1/tx/${encodeURIComponent(normalizedTxid)}`, targetNetwork);
  if (!payload.tx) {
    throw new Error("Transaction not found.");
  }

  return payload.tx;
}

function isBrowserHtmlAttachment(attachment: MailAttachment) {
  const mime = attachment.mime.toLowerCase().split(";")[0].trim();
  const name = attachment.name.toLowerCase();
  return (
    mime === "text/html" ||
    mime === "application/xhtml+xml" ||
    /\.x?html?$/u.test(name)
  );
}

function isBrowserHtmlMessageBody(value: string) {
  const text = value.trim();
  if (!text) {
    return false;
  }

  return (
    /^<!doctype\s+html[\s>]/iu.test(text) ||
    /^<html[\s>]/iu.test(text) ||
    /<\/(?:html|head|body)>/iu.test(text) ||
    /^<(?:a|article|body|button|canvas|code|div|form|h[1-6]|head|img|input|main|ol|p|pre|script|section|span|style|svg|table|ul)(?:\s|>|\/)/iu.test(
      text,
    )
  );
}

function canonicalWelcomeAttachment(): MailAttachment {
  const bytes = new TextEncoder().encode(CANONICAL_WELCOME_HTML);
  return {
    data: base64UrlEncodeBytes(bytes),
    mime: "text/html",
    name: "Welcome to ProofOfWork.Me.html",
    sha256: sha256Hex(bytes),
    size: bytes.byteLength,
  };
}

function canonicalWelcomeFileMessage(): FileSurfaceMessage {
  return {
    amountSats: DEFAULT_AMOUNT_SATS,
    attachment: canonicalWelcomeAttachment(),
    confirmed: true,
    createdAt: CANONICAL_WELCOME_CREATED_AT,
    folder: "inbox",
    from: CANONICAL_WELCOME_SENDER,
    memo: CANONICAL_WELCOME_HTML,
    network: "livenet",
    recipients: [
      {
        address: CANONICAL_WELCOME_RECIPIENT,
        amountSats: DEFAULT_AMOUNT_SATS,
        display: shortAddress(CANONICAL_WELCOME_RECIPIENT),
      },
    ],
    replyTo: CANONICAL_WELCOME_SENDER,
    subject: "Welcome to ProofOfWork.Me",
    to: CANONICAL_WELCOME_RECIPIENT,
    txid: CANONICAL_WELCOME_TXID,
  };
}

function withCanonicalWelcomeFile(
  messages: FileSurfaceMessage[],
  network: BitcoinNetwork,
) {
  if (network !== "livenet") {
    return messages;
  }

  const withoutExistingWelcome = messages.filter(
    (message) => message.txid !== CANONICAL_WELCOME_TXID,
  );
  return [canonicalWelcomeFileMessage(), ...withoutExistingWelcome];
}

function fileSurfaceMessages(messages: MailMessage[]): FileSurfaceMessage[] {
  return messages
    .filter(
      (message) =>
        Boolean(message.attachment) || isBrowserHtmlMessageBody(message.memo),
    )
    .map((message): FileSurfaceMessage =>
      message.attachment
        ? { ...message, attachment: message.attachment }
        : {
            ...message,
            attachment: browserMessageBodyAttachment(
              message.memo,
              message.subject,
            ),
          },
    );
}

function browserTxUrl(txid: string, network: BitcoinNetwork) {
  const params = new URLSearchParams();
  params.set("txid", txid);
  if (network !== "livenet") {
    params.set("network", network);
  }

  if (isLocalPreviewHost()) {
    return `${LOCAL_BROWSER_APP_URL}&${params.toString()}`;
  }

  return `${BROWSER_APP_URL}/tx/${txid}${network === "livenet" ? "" : `?network=${encodeURIComponent(network)}`}`;
}

function browserMessageBodyAttachment(
  html: string,
  subject?: string,
): MailAttachment {
  const bytes = new TextEncoder().encode(html);
  const safeSubject = (subject ?? "")
    .trim()
    .replace(/[^\w.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  const name = safeSubject
    ? safeSubject.toLowerCase().endsWith(".html")
      ? safeSubject
      : `${safeSubject}.html`
    : "message-body.html";

  return {
    data: base64UrlEncodeBytes(bytes),
    mime: "text/html",
    name,
    sha256: sha256Hex(bytes),
    size: bytes.byteLength,
  };
}

function browserPageFromTransaction(
  tx: Record<string, unknown>,
  targetNetwork: BitcoinNetwork,
): BrowserPage {
  const txid =
    typeof tx.txid === "string" && /^[0-9a-fA-F]{64}$/u.test(tx.txid)
      ? tx.txid.toLowerCase()
      : "";
  if (!txid) {
    throw new Error("Transaction payload did not include a valid txid.");
  }

  const vin = Array.isArray(tx.vin)
    ? (tx.vin as Array<Record<string, unknown>>)
    : [];
  const vout = Array.isArray(tx.vout)
    ? (tx.vout as Array<Record<string, unknown>>)
    : [];
  const protocolMessage = extractProtocolMemo(vout);
  if (!protocolMessage) {
    throw new Error("This transaction does not contain a ProofOfWork message.");
  }

  const htmlAttachment =
    protocolMessage.attachment &&
    isBrowserHtmlAttachment(protocolMessage.attachment)
      ? protocolMessage.attachment
      : undefined;
  const htmlBody = isBrowserHtmlMessageBody(protocolMessage.memo)
    ? protocolMessage.memo
    : "";
  const attachment =
    htmlAttachment ??
    (htmlBody
      ? browserMessageBodyAttachment(htmlBody, protocolMessage.subject)
      : undefined);
  const source: BrowserPage["source"] = htmlAttachment
    ? "attachment"
    : "message";

  if (!attachment) {
    throw new Error(
      protocolMessage.attachment
        ? `This transaction contains ${protocolMessage.attachment.name}, but no Browser-readable HTML attachment or message body.`
        : "This transaction does not contain Browser-readable HTML in its attachment or message body.",
    );
  }

  const html = htmlAttachment ? attachmentText(attachment) : htmlBody;
  if (!html.trim()) {
    throw new Error("The Browser HTML content is empty.");
  }

  const status = tx.status as Record<string, unknown> | undefined;
  const blockTime =
    typeof status?.block_time === "number"
      ? status.block_time * 1000
      : Date.now();
  const recipients = protocolPaymentOutputs(vout);
  const inputAddresses = transactionInputAddresses(vin);

  return {
    amountSats: totalRecipientSats(recipients),
    attachment,
    confirmed: Boolean(status?.confirmed),
    createdAt: new Date(blockTime).toISOString(),
    html,
    network: targetNetwork,
    protocolBytes: proofProtocolDataBytesForVout(vout),
    sender: inputAddresses[0] ?? "Unknown",
    source,
    txid,
  };
}

async function fetchBrowserPage(txid: string, targetNetwork: BitcoinNetwork) {
  return browserPageFromTransaction(
    await fetchTransactionJson(txid, targetNetwork),
    targetNetwork,
  );
}

function publicDesktopMail(
  inboxMessages: InboxMessage[],
  sentMessages: SentMessage[],
): MailMessage[] {
  return [
    ...inboxMessages
      .filter((message) => message.confirmed)
      .map((message): MailMessage => ({ ...message, folder: "inbox" })),
    ...sentMessages
      .filter((message) => sentDeliveryStatus(message) === "confirmed")
      .map((message): MailMessage => ({ ...message, folder: "sent" })),
  ];
}

function activityStatusTag(confirmed: boolean) {
  return confirmed ? "Confirmed" : "Pending";
}

function emptyMarketplaceStats(): PowIdMarketplaceStats {
  return {
    confirmedSales: 0,
    confirmedVolumeSats: 0,
    pendingSales: 0,
    pendingVolumeSats: 0,
    totalSales: 0,
    totalVolumeSats: 0,
  };
}

function marketplaceStatsFromSales(
  sales: PowIdMarketplaceSale[],
): PowIdMarketplaceStats {
  return sales.reduce((stats, sale) => {
    if (sale.confirmed) {
      stats.confirmedSales += 1;
      stats.confirmedVolumeSats += sale.priceSats;
    } else {
      stats.pendingSales += 1;
      stats.pendingVolumeSats += sale.priceSats;
    }

    stats.totalSales += 1;
    stats.totalVolumeSats += sale.priceSats;
    return stats;
  }, emptyMarketplaceStats());
}

function publicMarketplaceSales(sales: PowIdMarketplaceSale[]) {
  return sales.filter((sale) => sale.transferVersion === "buy5");
}

function activityItemsFromIdEvents(events: PowIdEvent[]): PowActivityItem[] {
  return events.map((event) => {
    const status = activityStatusTag(event.confirmed);
    const base = {
      amountSats: event.amountSats,
      actor: event.inputAddresses[0],
      confirmed: event.confirmed,
      createdAt: event.createdAt,
      dataBytes: event.dataBytes,
      network: event.network,
      tags: [
        status,
        networkLabel(event.network),
        `${event.amountSats.toLocaleString()} sats`,
      ],
      txid: event.txid,
    };

    if (event.kind === "register") {
      return {
        ...base,
        counterparty: event.receiveAddress,
        description: `${event.id}@proofofwork.me claimed by ${shortAddress(event.ownerAddress)} and routed to ${shortAddress(event.receiveAddress)}.`,
        detail: event.pgpKey ? "PGP key registered" : "No PGP key",
        id: event.id,
        kind: "id-register",
        tags: [...base.tags, "Registration"],
        title: event.confirmed ? "ID registered" : "ID registration pending",
      };
    }

    if (event.kind === "update") {
      return {
        ...base,
        counterparty: event.receiveAddress,
        description: `${event.id}@proofofwork.me receive address updated to ${shortAddress(event.receiveAddress)}.`,
        id: event.id,
        kind: "id-update",
        tags: [...base.tags, "Receiver update"],
        title: event.confirmed ? "Receiver updated" : "Receiver update pending",
      };
    }

    if (event.kind === "transfer") {
      return {
        ...base,
        counterparty: event.ownerAddress,
        description: `${event.id}@proofofwork.me transferred to ${shortAddress(event.ownerAddress)} and routed to ${shortAddress(event.receiveAddress)}.`,
        id: event.id,
        kind: "id-transfer",
        tags: [...base.tags, "Transfer"],
        title: event.confirmed ? "ID transferred" : "ID transfer pending",
      };
    }

    if (event.kind === "list") {
      const anchorVout =
        event.saleAuthorization.anchorVout ?? ID_LISTING_ANCHOR_VOUT;
      return {
        ...base,
        actor: event.sellerAddress,
        counterparty: event.saleAuthorization.buyerAddress,
        description: `${event.id}@proofofwork.me listed for ${event.priceSats.toLocaleString()} sats by ${shortAddress(event.sellerAddress)}.`,
        detail:
          event.listingVersion === "list5"
            ? "Sale-ticket listing"
            : "Legacy listing",
        id: event.id,
        kind: "id-list",
        listingId: event.txid,
        tags: [
          ...base.tags,
          "Listing",
          `${event.priceSats.toLocaleString()} sale sats`,
        ],
        title: event.confirmed ? "ID listed" : "ID listing pending",
        utxo: `${event.txid}:${anchorVout}`,
      };
    }

    if (event.kind === "seal") {
      return {
        ...base,
        description: `Sale ticket sealed for listing ${shortAddress(event.listingId)}.`,
        detail: "Seller signature published on chain",
        kind: "id-seal",
        listingId: event.listingId,
        tags: [...base.tags, "Seal"],
        title: event.confirmed
          ? "Sale ticket sealed"
          : "Sale-ticket seal pending",
      };
    }

    if (event.kind === "delist") {
      return {
        ...base,
        description: `Listing ${shortAddress(event.listingId)} delisted by spending its sale ticket.`,
        detail: event.delistingVersion,
        kind: "id-delist",
        listingId: event.listingId,
        tags: [...base.tags, "Delisting"],
        title: event.confirmed ? "Listing delisted" : "Delisting pending",
      };
    }

    return {
      ...base,
      actor: event.ownerAddress,
      counterparty: event.sellerAddress,
      description: `${event.id ? `${event.id}@proofofwork.me` : "ID"} purchased by ${shortAddress(event.ownerAddress)}${event.sellerAddress ? ` from ${shortAddress(event.sellerAddress)}` : ""}.`,
      detail: event.listingId
        ? `Listing ${shortAddress(event.listingId)}`
        : undefined,
      id: event.id,
      kind: "id-buy",
      listingId: event.listingId,
      tags: [
        ...base.tags,
        "Marketplace buy",
        event.priceSats ? `${event.priceSats.toLocaleString()} sale sats` : "",
      ].filter(Boolean),
      title: event.confirmed ? "ID purchased" : "ID purchase pending",
    };
  });
}

function activityItemsFromAddressMail(
  inboxMessages: InboxMessage[],
  sentMessages: SentMessage[],
): PowActivityItem[] {
  const inboxItems = inboxMessages.map((message): PowActivityItem => {
    const isFile = Boolean(message.attachment);
    const isReply = Boolean(message.parentTxid);
    return {
      amountSats: message.amountSats,
      actor: message.from,
      confirmed: message.confirmed,
      counterparty: message.to,
      createdAt: message.createdAt,
      description: `${message.confirmed ? "Received" : "Incoming"} ${isFile ? "file" : isReply ? "reply" : "mail"} from ${shortAddress(message.from)} for ${message.amountSats.toLocaleString()} sats.`,
      detail: message.attachment
        ? `${message.attachment.name} · ${formatBytes(message.attachment.size)}`
        : messageSubject(message),
      kind: isFile ? "file" : isReply ? "reply" : "mail",
      network: message.network,
      tags: [
        activityStatusTag(message.confirmed),
        networkLabel(message.network),
        "Inbound",
        `${message.amountSats.toLocaleString()} sats`,
        isFile ? "File" : isReply ? "Reply" : "Mail",
        isBrowserHtmlMessageBody(message.memo) ? "HTML body" : "",
        message.attachment?.mime ?? "",
        message.attachment?.name ?? "",
      ].filter(Boolean),
      title: isFile
        ? "File received"
        : isReply
          ? "Reply received"
          : "Mail received",
      txid: message.txid,
    };
  });

  const sentItems = sentMessages.map((message): PowActivityItem => {
    const deliveryStatus = sentDeliveryStatus(message);
    const confirmed = deliveryStatus === "confirmed";
    const isFile = Boolean(message.attachment);
    const isReply = Boolean(message.parentTxid);
    return {
      amountSats: message.amountSats,
      actor: message.from,
      confirmed,
      counterparty: message.to,
      createdAt: message.createdAt,
      description: `${confirmed ? "Sent" : deliveryStatus === "dropped" ? "Dropped" : "Pending"} ${isFile ? "file" : isReply ? "reply" : "mail"} to ${message.to} for ${message.amountSats.toLocaleString()} sats.`,
      detail: message.attachment
        ? `${message.attachment.name} · ${formatBytes(message.attachment.size)}`
        : messageSubject(message),
      kind: isFile ? "file" : isReply ? "reply" : "mail",
      network: message.network,
      tags: [
        confirmed
          ? "Confirmed"
          : deliveryStatus === "dropped"
            ? "Dropped"
            : "Pending",
        networkLabel(message.network),
        "Outbound",
        `${message.amountSats.toLocaleString()} sats`,
        isFile ? "File" : isReply ? "Reply" : "Mail",
        isBrowserHtmlMessageBody(message.memo) ? "HTML body" : "",
        message.attachment?.mime ?? "",
        message.attachment?.name ?? "",
      ].filter(Boolean),
      title: isFile ? "File sent" : isReply ? "Reply sent" : "Mail sent",
      txid: message.txid,
    };
  });

  return [...inboxItems, ...sentItems];
}

function compareActivityItems(left: PowActivityItem, right: PowActivityItem) {
  return (
    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    right.txid.localeCompare(left.txid)
  );
}

function mergeActivityItems(
  current: PowActivityItem[],
  incoming: PowActivityItem[],
) {
  if (!incoming.length) {
    return current;
  }

  const merged = new Map<string, PowActivityItem>();
  for (const item of current) {
    merged.set(activityKey(item), item);
  }
  for (const item of incoming) {
    merged.set(activityKey(item), item);
  }

  return [...merged.values()].sort(compareActivityItems);
}

function numericActivityStat(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0
    ? numberValue
    : undefined;
}

function normalizeActivityStats(
  stats: PowActivityStats | undefined,
  fallbackItems: PowActivityItem[],
): PowActivityStats {
  const total = numericActivityStat(stats?.total) ?? fallbackItems.length;
  const pending =
    numericActivityStat(stats?.pending) ??
    fallbackItems.filter((item) => !item.confirmed).length;
  const confirmed =
    numericActivityStat(stats?.confirmed) ?? Math.max(0, total - pending);

  return {
    ...stats,
    confirmed,
    dataBytes:
      numericActivityStat(stats?.dataBytes) ?? totalActivityDataBytes(fallbackItems),
    indexedThroughBlock: numericActivityStat(stats?.indexedThroughBlock),
    pending,
    total,
  };
}

function compareMarketplaceSales(
  left: PowIdMarketplaceSale,
  right: PowIdMarketplaceSale,
) {
  return (
    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    right.txid.localeCompare(left.txid)
  );
}

function activityMatchesSearch(item: PowActivityItem, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [
    item.title,
    item.description,
    item.detail,
    item.id ? `${item.id}@proofofwork.me` : undefined,
    item.txid,
    item.listingId,
    item.actor,
    item.counterparty,
    item.kind,
    item.utxo,
    ...item.tags,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized));
}

function idRegistryStateFromTransactions(
  txs: Array<Record<string, unknown>>,
  registryAddress: string,
  targetNetwork: BitcoinNetwork,
): PowRegistryState {
  const events = txs.flatMap((tx): PowIdEvent[] => {
    const vin = Array.isArray(tx.vin)
      ? (tx.vin as Array<Record<string, unknown>>)
      : [];
    const vout = Array.isArray(tx.vout)
      ? (tx.vout as Array<Record<string, unknown>>)
      : [];
    const amount = registryPaymentAmount(vout, registryAddress);
    const txid =
      typeof tx.txid === "string" && /^[0-9a-fA-F]{64}$/u.test(tx.txid)
        ? tx.txid.toLowerCase()
        : "";

    if (!txid || amount <= 0) {
      return [];
    }

    const eventMessage = decodedProtocolMessages(vout, ID_PROTOCOL_PREFIX)
      .map((message) => message.slice(ID_PROTOCOL_PREFIX.length))
      .map((payload) => parseIdEventPayload(payload, targetNetwork))
      .find(Boolean);
    if (!eventMessage) {
      return [];
    }

    if (amount < idEventMinimumPaymentSats(eventMessage.kind)) {
      return [];
    }

    const status = tx.status as Record<string, unknown> | undefined;
    const confirmed = Boolean(status?.confirmed);
    const blockTime =
      typeof status?.block_time === "number"
        ? status.block_time * 1000
        : Date.now();
    const baseEvent = {
      amountSats: amount,
      blockHeight: transactionBlockHeight(tx),
      blockIndex: transactionBlockIndex(tx),
      confirmed,
      createdAt: new Date(blockTime).toISOString(),
      dataBytes: proofProtocolDataBytesForVout(vout),
      inputAddresses: transactionInputAddresses(vin),
      network: targetNetwork,
      txid,
    };
    const spentOutpoints = transactionSpentOutpoints(vin);
    const paymentOutputs = paymentOutputsBeforeIdProtocol(vout);

    if (eventMessage.kind === "register") {
      return [
        {
          ...baseEvent,
          id: eventMessage.id,
          kind: "register",
          ownerAddress: eventMessage.ownerAddress,
          pgpKey: eventMessage.pgpKey || undefined,
          receiveAddress: eventMessage.receiveAddress,
        },
      ];
    }

    if (eventMessage.kind === "update") {
      return [
        {
          ...baseEvent,
          id: eventMessage.id,
          kind: "update",
          receiveAddress: eventMessage.receiveAddress,
        },
      ];
    }

    if (eventMessage.kind === "marketTransfer") {
      return [
        {
          ...baseEvent,
          id: eventMessage.id,
          kind: "marketTransfer",
          ownerAddress: eventMessage.ownerAddress,
          paymentOutputs,
          priceSats: eventMessage.priceSats,
          receiveAddress: eventMessage.receiveAddress,
          saleAuthorization: eventMessage.saleAuthorization,
          sellerAddress: eventMessage.sellerAddress,
          spentOutpoints,
          transferVersion: eventMessage.transferVersion,
          listingId: eventMessage.listingId,
        },
      ];
    }

    if (eventMessage.kind === "list") {
      return [
        {
          ...baseEvent,
          id: eventMessage.id,
          kind: "list",
          listingAnchorPresent: listingAnchorIsPresent(
            vout,
            eventMessage.saleAuthorization,
          ),
          listingVersion: eventMessage.listingVersion,
          priceSats: eventMessage.priceSats,
          saleAuthorization: eventMessage.saleAuthorization,
          sellerAddress: eventMessage.sellerAddress,
        },
      ];
    }

    if (eventMessage.kind === "seal") {
      return [
        {
          ...baseEvent,
          kind: "seal",
          listingId: eventMessage.listingId,
          saleAuthorization: eventMessage.saleAuthorization,
          spentOutpoints,
        },
      ];
    }

    if (eventMessage.kind === "delist") {
      return [
        {
          ...baseEvent,
          delistingVersion: eventMessage.delistingVersion,
          kind: "delist",
          listingId: eventMessage.listingId,
          spentOutpoints,
        },
      ];
    }

    return [
      {
        ...baseEvent,
        id: eventMessage.id,
        kind: "transfer",
        ownerAddress: eventMessage.ownerAddress,
        receiveAddress: eventMessage.receiveAddress,
      },
    ];
  });

  const confirmedEvents = events
    .filter((event) => event.confirmed)
    .sort(compareRegistryEventOrder);
  const pendingRegistrations = events
    .filter(
      (event): event is Extract<PowIdEvent, { kind: "register" }> =>
        !event.confirmed && event.kind === "register",
    )
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.txid.localeCompare(right.txid),
    );
  const records = new Map<string, PowIdRecord>();
  const listings = new Map<string, PowIdListing>();
  const confirmedSales: PowIdMarketplaceSale[] = [];
  const acceptedActivityEvents: PowIdEvent[] = [];

  function invalidateListingsForId(id: string) {
    for (const [listingId, listing] of listings) {
      if (listing.id === id) {
        listings.delete(listingId);
      }
    }
  }

  for (const event of confirmedEvents) {
    if (event.kind === "register") {
      const current = records.get(event.id);
      if (current) {
        continue;
      }

      records.set(event.id, {
        amountSats: event.amountSats,
        confirmed: true,
        createdAt: event.createdAt,
        id: event.id,
        network: event.network,
        ownerAddress: event.ownerAddress,
        pgpKey: event.pgpKey,
        receiveAddress: event.receiveAddress,
        txid: event.txid,
      });
      acceptedActivityEvents.push(event);
      continue;
    }

    if (event.kind === "delist") {
      const listing = listings.get(event.listingId);
      const current = listing ? records.get(listing.id) : undefined;
      const anchorOk =
        (event.delistingVersion !== "delist3" &&
          event.delistingVersion !== "delist5") ||
        (listing ? spendsListingAnchor(event.spentOutpoints, listing) : false);
      if (
        listing &&
        current &&
        event.inputAddresses.includes(current.ownerAddress) &&
        anchorOk
      ) {
        listings.delete(event.listingId);
        acceptedActivityEvents.push(event);
      }
      continue;
    }

    if (event.kind === "seal") {
      const listing = listings.get(event.listingId);
      const current = listing ? records.get(listing.id) : undefined;
      if (
        !listing ||
        !current ||
        listing.listingVersion !== "list5" ||
        current.ownerAddress !== listing.sellerAddress ||
        !event.inputAddresses.includes(current.ownerAddress) ||
        !saleAuthorizationUsesSaleTicketAnchor(event.saleAuthorization) ||
        event.saleAuthorization.anchorTxid !== listing.listingId ||
        !saleAuthorizationTermsMatchIgnoringSeal(
          listing.saleAuthorization,
          event.saleAuthorization,
        )
      ) {
        continue;
      }

      listings.set(event.listingId, {
        ...listing,
        anchorSigHashType: event.saleAuthorization.anchorSigHashType,
        anchorSignature: event.saleAuthorization.anchorSignature,
        anchorTxid: listing.listingId,
        saleAuthorization: {
          ...event.saleAuthorization,
          anchorTxid: listing.listingId,
        },
        sealTxid: event.txid,
      });
      acceptedActivityEvents.push(event);
      continue;
    }

    if (event.kind === "marketTransfer") {
      if (
        event.transferVersion === "buy3" ||
        event.transferVersion === "buy4" ||
        event.transferVersion === "buy5"
      ) {
        const listing = event.listingId
          ? listings.get(event.listingId)
          : undefined;
        const current = listing ? records.get(listing.id) : undefined;
        const sellerPaymentSats = listing
          ? paymentAmountFromSnapshots(
              event.paymentOutputs,
              listing.sellerAddress,
            )
          : 0;
        if (
          !listing ||
          !current ||
          (event.transferVersion === "buy3" &&
            listing.listingVersion !== "list3") ||
          (event.transferVersion === "buy4" &&
            listing.listingVersion !== "list4") ||
          (event.transferVersion === "buy5" &&
            listing.listingVersion !== "list5") ||
          current.ownerAddress !== listing.sellerAddress ||
          !spendsListingAnchor(event.spentOutpoints, listing) ||
          sellerPaymentSats < sellerPaymentRequiredSats(listing) ||
          saleAuthorizationExpired(
            listing.saleAuthorization,
            event.createdAt,
          ) ||
          (listing.buyerAddress &&
            listing.buyerAddress !== event.ownerAddress) ||
          (listing.receiveAddress &&
            listing.receiveAddress !== event.receiveAddress)
        ) {
          continue;
        }

        records.set(listing.id, {
          ...current,
          amountSats: event.amountSats,
          createdAt: event.createdAt,
          ownerAddress: event.ownerAddress,
          receiveAddress: event.receiveAddress,
          txid: event.txid,
        });
        confirmedSales.push({
          amountSats: event.amountSats,
          buyerAddress: event.ownerAddress,
          confirmed: true,
          createdAt: event.createdAt,
          id: listing.id,
          listingId: listing.listingId,
          network: event.network,
          priceSats: listing.priceSats,
          receiveAddress: event.receiveAddress,
          sellerAddress: listing.sellerAddress,
          transferVersion: event.transferVersion,
          txid: event.txid,
        });
        acceptedActivityEvents.push(event);
        invalidateListingsForId(listing.id);
        continue;
      }

      if (
        event.id &&
        event.saleAuthorization &&
        event.sellerAddress &&
        typeof event.priceSats === "number"
      ) {
        const current = records.get(event.id);
        if (!current) {
          continue;
        }

        const matchingListing = findMatchingActiveListing(
          listings,
          event.saleAuthorization,
          current.ownerAddress,
        );
        if (
          current.ownerAddress !== event.sellerAddress ||
          paymentAmountFromSnapshots(
            event.paymentOutputs,
            event.sellerAddress,
          ) < event.priceSats ||
          saleAuthorizationExpired(event.saleAuthorization, event.createdAt) ||
          (!matchingListing &&
            !saleAuthorizationVerified(event.saleAuthorization))
        ) {
          continue;
        }

        records.set(event.id, {
          ...current,
          amountSats: event.amountSats,
          createdAt: event.createdAt,
          ownerAddress: event.ownerAddress,
          receiveAddress: event.receiveAddress,
          txid: event.txid,
        });
        confirmedSales.push({
          amountSats: event.amountSats,
          buyerAddress: event.ownerAddress,
          confirmed: true,
          createdAt: event.createdAt,
          id: event.id,
          listingId: matchingListing?.listingId,
          network: event.network,
          priceSats: event.priceSats,
          receiveAddress: event.receiveAddress,
          sellerAddress: event.sellerAddress,
          transferVersion: event.transferVersion,
          txid: event.txid,
        });
        acceptedActivityEvents.push(event);
        invalidateListingsForId(event.id);
      }
      continue;
    }

    const current = records.get(event.id);
    if (!current) {
      continue;
    }

    if (event.kind === "list") {
      if (
        current.ownerAddress !== event.sellerAddress ||
        !event.inputAddresses.includes(current.ownerAddress) ||
        saleAuthorizationExpired(event.saleAuthorization, event.createdAt) ||
        (event.listingVersion === "list3" && !event.listingAnchorPresent) ||
        (event.listingVersion === "list4" &&
          event.saleAuthorization.version !== ID_SALE_AUTH_VERSION) ||
        (event.listingVersion === "list5" &&
          (event.saleAuthorization.version !== ID_SALE_AUTH_VERSION_TICKET ||
            !event.listingAnchorPresent)) ||
        (event.listingVersion === "list2" &&
          event.saleAuthorization.version !== ID_SALE_AUTH_VERSION_LEGACY)
      ) {
        continue;
      }

      listings.set(event.txid, {
        amountSats: event.amountSats,
        anchorSigHashType: event.saleAuthorization.anchorSigHashType,
        anchorSignature: event.saleAuthorization.anchorSignature,
        anchorScriptPubKey: event.saleAuthorization.anchorScriptPubKey,
        anchorTxid: event.saleAuthorization.anchorTxid,
        anchorType: event.saleAuthorization.anchorType,
        anchorValueSats: event.saleAuthorization.anchorValueSats,
        anchorVout: event.saleAuthorization.anchorVout,
        buyerAddress: event.saleAuthorization.buyerAddress,
        confirmed: true,
        createdAt: event.createdAt,
        expiresAt: event.saleAuthorization.expiresAt,
        id: event.id,
        listingId: event.txid,
        listingVersion: event.listingVersion,
        network: event.network,
        priceSats: event.priceSats,
        receiveAddress: event.saleAuthorization.receiveAddress,
        saleAuthorization: event.saleAuthorization,
        sellerAddress: event.sellerAddress,
        sellerPublicKey: event.saleAuthorization.sellerPublicKey,
        txid: event.txid,
      });
      acceptedActivityEvents.push(event);
      continue;
    }

    if (!event.inputAddresses.includes(current.ownerAddress)) {
      continue;
    }

    if (event.kind === "update") {
      records.set(event.id, {
        ...current,
        amountSats: event.amountSats,
        createdAt: event.createdAt,
        receiveAddress: event.receiveAddress,
        txid: event.txid,
      });
      acceptedActivityEvents.push(event);
      continue;
    }

    records.set(event.id, {
      ...current,
      amountSats: event.amountSats,
      createdAt: event.createdAt,
      ownerAddress: event.ownerAddress,
      receiveAddress: event.receiveAddress,
      txid: event.txid,
    });
    acceptedActivityEvents.push(event);
    invalidateListingsForId(event.id);
  }

  const accepted = [...records.values()];
  const pendingEvents = events
    .filter((event) => !event.confirmed && event.kind !== "register")
    .flatMap((event): PowIdPendingEvent[] => {
      if (event.kind === "delist") {
        const listing = listings.get(event.listingId);
        const current = listing ? records.get(listing.id) : undefined;
        const anchorOk =
          (event.delistingVersion !== "delist3" &&
            event.delistingVersion !== "delist5") ||
          (listing
            ? spendsListingAnchor(event.spentOutpoints, listing)
            : false);
        if (
          !listing ||
          !current ||
          !event.inputAddresses.includes(current.ownerAddress) ||
          !anchorOk
        ) {
          return [];
        }

        return [
          {
            amountSats: event.amountSats,
            createdAt: event.createdAt,
            currentOwnerAddress: current.ownerAddress,
            currentReceiveAddress: current.receiveAddress,
            id: listing.id,
            inputAddresses: event.inputAddresses,
            kind: "delist",
            listingId: event.listingId,
            network: event.network,
            sellerAddress: listing.sellerAddress,
            txid: event.txid,
          },
        ];
      }

      if (event.kind === "seal") {
        const listing = listings.get(event.listingId);
        const current = listing ? records.get(listing.id) : undefined;
        if (
          !listing ||
          !current ||
          listing.listingVersion !== "list5" ||
          current.ownerAddress !== listing.sellerAddress ||
          !event.inputAddresses.includes(current.ownerAddress) ||
          !saleAuthorizationUsesSaleTicketAnchor(event.saleAuthorization) ||
          event.saleAuthorization.anchorTxid !== listing.listingId ||
          !saleAuthorizationTermsMatchIgnoringSeal(
            listing.saleAuthorization,
            event.saleAuthorization,
          )
        ) {
          return [];
        }

        return [
          {
            amountSats: event.amountSats,
            createdAt: event.createdAt,
            currentOwnerAddress: current.ownerAddress,
            currentReceiveAddress: current.receiveAddress,
            id: listing.id,
            inputAddresses: event.inputAddresses,
            kind: "seal",
            listingId: event.listingId,
            network: event.network,
            sellerAddress: listing.sellerAddress,
            txid: event.txid,
          },
        ];
      }

      if (event.kind === "marketTransfer") {
        if (
          event.transferVersion === "buy3" ||
          event.transferVersion === "buy4" ||
          event.transferVersion === "buy5"
        ) {
          const listing = event.listingId
            ? listings.get(event.listingId)
            : undefined;
          const current = listing ? records.get(listing.id) : undefined;
          const sellerPaymentSats = listing
            ? paymentAmountFromSnapshots(
                event.paymentOutputs,
                listing.sellerAddress,
              )
            : 0;
          if (
            !listing ||
            !current ||
            (event.transferVersion === "buy3" &&
              listing.listingVersion !== "list3") ||
            (event.transferVersion === "buy4" &&
              listing.listingVersion !== "list4") ||
            (event.transferVersion === "buy5" &&
              listing.listingVersion !== "list5") ||
            current.ownerAddress !== listing.sellerAddress ||
            !spendsListingAnchor(event.spentOutpoints, listing) ||
            sellerPaymentSats < sellerPaymentRequiredSats(listing) ||
            saleAuthorizationExpired(
              listing.saleAuthorization,
              event.createdAt,
            ) ||
            (listing.buyerAddress &&
              listing.buyerAddress !== event.ownerAddress) ||
            (listing.receiveAddress &&
              listing.receiveAddress !== event.receiveAddress)
          ) {
            return [];
          }

          return [
            {
              amountSats: event.amountSats,
              createdAt: event.createdAt,
              currentOwnerAddress: current.ownerAddress,
              currentReceiveAddress: current.receiveAddress,
              id: listing.id,
              inputAddresses: event.inputAddresses,
              kind: "marketTransfer",
              listingId: listing.listingId,
              network: event.network,
              ownerAddress: event.ownerAddress,
              priceSats: listing.priceSats,
              receiveAddress: event.receiveAddress,
              sellerAddress: listing.sellerAddress,
              transferVersion: event.transferVersion,
              txid: event.txid,
            },
          ];
        }

        if (
          event.id &&
          event.saleAuthorization &&
          event.sellerAddress &&
          typeof event.priceSats === "number"
        ) {
          const current = records.get(event.id);
          if (!current) {
            return [];
          }

          const matchingListing = findMatchingActiveListing(
            listings,
            event.saleAuthorization,
            current.ownerAddress,
          );
          if (
            current.ownerAddress !== event.sellerAddress ||
            paymentAmountFromSnapshots(
              event.paymentOutputs,
              event.sellerAddress,
            ) < event.priceSats ||
            saleAuthorizationExpired(
              event.saleAuthorization,
              event.createdAt,
            ) ||
            (!matchingListing &&
              !saleAuthorizationVerified(event.saleAuthorization))
          ) {
            return [];
          }

          return [
            {
              amountSats: event.amountSats,
              createdAt: event.createdAt,
              currentOwnerAddress: current.ownerAddress,
              currentReceiveAddress: current.receiveAddress,
              id: event.id,
              inputAddresses: event.inputAddresses,
              kind: "marketTransfer",
              network: event.network,
              ownerAddress: event.ownerAddress,
              priceSats: event.priceSats,
              receiveAddress: event.receiveAddress,
              sellerAddress: event.sellerAddress,
              transferVersion: event.transferVersion,
              txid: event.txid,
            },
          ];
        }

        return [];
      }

      const current = records.get(event.id);
      if (!current) {
        return [];
      }

      if (event.kind === "list") {
        if (
          current.ownerAddress !== event.sellerAddress ||
          !event.inputAddresses.includes(current.ownerAddress) ||
          saleAuthorizationExpired(event.saleAuthorization, event.createdAt) ||
          (event.listingVersion === "list3" && !event.listingAnchorPresent) ||
          (event.listingVersion === "list4" &&
            event.saleAuthorization.version !== ID_SALE_AUTH_VERSION) ||
          (event.listingVersion === "list5" &&
            (event.saleAuthorization.version !== ID_SALE_AUTH_VERSION_TICKET ||
              !event.listingAnchorPresent)) ||
          (event.listingVersion === "list2" &&
            event.saleAuthorization.version !== ID_SALE_AUTH_VERSION_LEGACY)
        ) {
          return [];
        }

        return [
          {
            amountSats: event.amountSats,
            createdAt: event.createdAt,
            currentOwnerAddress: current.ownerAddress,
            currentReceiveAddress: current.receiveAddress,
            id: event.id,
            inputAddresses: event.inputAddresses,
            kind: "list",
            network: event.network,
            priceSats: event.priceSats,
            sellerAddress: event.sellerAddress,
            txid: event.txid,
          },
        ];
      }

      if (!event.inputAddresses.includes(current.ownerAddress)) {
        return [];
      }

      if (event.kind === "update") {
        return [
          {
            amountSats: event.amountSats,
            createdAt: event.createdAt,
            currentOwnerAddress: current.ownerAddress,
            currentReceiveAddress: current.receiveAddress,
            id: event.id,
            inputAddresses: event.inputAddresses,
            kind: "update",
            network: event.network,
            receiveAddress: event.receiveAddress,
            txid: event.txid,
          },
        ];
      }

      return [
        {
          amountSats: event.amountSats,
          createdAt: event.createdAt,
          currentOwnerAddress: current.ownerAddress,
          currentReceiveAddress: current.receiveAddress,
          id: event.id,
          inputAddresses: event.inputAddresses,
          kind: "transfer",
          network: event.network,
          ownerAddress: event.ownerAddress,
          receiveAddress: event.receiveAddress,
          txid: event.txid,
        },
      ];
    })
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.txid.localeCompare(right.txid),
    );

  const pendingSales: PowIdMarketplaceSale[] = pendingEvents
    .filter(
      (
        event,
      ): event is PowIdPendingEvent & {
        id: string;
        kind: "marketTransfer";
        ownerAddress: string;
        priceSats: number;
        receiveAddress: string;
        sellerAddress: string;
      } =>
        event.kind === "marketTransfer" &&
        Boolean(event.id) &&
        Boolean(event.ownerAddress) &&
        typeof event.priceSats === "number" &&
        Number.isSafeInteger(event.priceSats) &&
        event.priceSats >= 0 &&
        Boolean(event.receiveAddress) &&
        Boolean(event.sellerAddress),
    )
    .map((event) => ({
      amountSats: event.amountSats,
      buyerAddress: event.ownerAddress,
      confirmed: false,
      createdAt: event.createdAt,
      id: event.id,
      listingId: event.listingId,
      network: event.network,
      priceSats: event.priceSats,
      receiveAddress: event.receiveAddress,
      sellerAddress: event.sellerAddress,
      transferVersion: event.transferVersion,
      txid: event.txid,
    }));

  const pendingRegistrationIds = new Set(records.keys());
  const pendingRegistrationActivityEvents: PowIdEvent[] = [];
  for (const event of pendingRegistrations) {
    if (!pendingRegistrationIds.has(event.id)) {
      accepted.push({
        amountSats: event.amountSats,
        confirmed: false,
        createdAt: event.createdAt,
        id: event.id,
        network: event.network,
        ownerAddress: event.ownerAddress,
        pgpKey: event.pgpKey,
        receiveAddress: event.receiveAddress,
        txid: event.txid,
      });
      pendingRegistrationActivityEvents.push(event);
      pendingRegistrationIds.add(event.id);
    }
  }

  const pendingEventTxids = new Set(pendingEvents.map((event) => event.txid));
  const pendingMutationActivityEvents = events.filter(
    (event) =>
      !event.confirmed &&
      event.kind !== "register" &&
      pendingEventTxids.has(event.txid),
  );
  const activityEvents = [
    ...acceptedActivityEvents,
    ...pendingRegistrationActivityEvents,
    ...pendingMutationActivityEvents,
  ];

  return {
    activity:
      activityItemsFromIdEvents(activityEvents).sort(compareActivityItems),
    listings: [...listings.values()].sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.txid.localeCompare(right.txid),
    ),
    pendingEvents,
    records: accepted,
    sales: publicMarketplaceSales([...confirmedSales, ...pendingSales]).sort(
      compareMarketplaceSales,
    ),
  };
}

function idRecordsFromTransactions(
  txs: Array<Record<string, unknown>>,
  registryAddress: string,
  targetNetwork: BitcoinNetwork,
): PowIdRecord[] {
  return idRegistryStateFromTransactions(txs, registryAddress, targetNetwork)
    .records;
}

function idListingsFromTransactions(
  txs: Array<Record<string, unknown>>,
  registryAddress: string,
  targetNetwork: BitcoinNetwork,
): PowIdListing[] {
  return idRegistryStateFromTransactions(txs, registryAddress, targetNetwork)
    .listings;
}

async function fetchIdRegistry(
  targetNetwork: BitcoinNetwork,
): Promise<PowIdRecord[]> {
  return (await fetchIdRegistryState(targetNetwork)).records;
}

async function fetchIdRegistryState(
  targetNetwork: BitcoinNetwork,
  fresh = false,
  summary = false,
): Promise<PowRegistryState> {
  const registryAddress = registryAddressForNetwork(targetNetwork);
  if (!registryAddress) {
    return {
      activity: [],
      listings: [],
      pendingEvents: [],
      records: [],
      sales: [],
    };
  }

  const basePath = summary ? "/api/v1/registry-summary" : "/api/v1/registry";
  const path = fresh ? `${basePath}?fresh=1` : basePath;
  const payload = await fetchProofApiJson<PowRegistryApiResponse>(
    path,
    targetNetwork,
  );
  return {
    activity: Array.isArray(payload.activity) ? payload.activity : [],
    listings: Array.isArray(payload.listings) ? payload.listings : [],
    pendingEvents: Array.isArray(payload.pendingEvents)
      ? payload.pendingEvents
      : [],
    records: Array.isArray(payload.records) ? payload.records : [],
    sales: Array.isArray(payload.sales) ? payload.sales : [],
  };
}

async function fetchGlobalActivity(
  targetNetwork: BitcoinNetwork,
  fresh = false,
  summary = false,
): Promise<PowActivityItem[]> {
  return (await fetchGlobalActivityPayload(targetNetwork, fresh, summary))
    .activity ?? [];
}

async function fetchGlobalActivityPayload(
  targetNetwork: BitcoinNetwork,
  fresh = false,
  summary = false,
): Promise<PowActivityApiResponse> {
  const basePath = summary ? "/api/v1/log-summary" : "/api/v1/log";
  const path = fresh ? `${basePath}?fresh=1` : basePath;
  const payload = await fetchProofApiJson<PowActivityApiResponse>(
    path,
    targetNetwork,
  );
  return {
    ...payload,
    activity: Array.isArray(payload.activity) ? payload.activity : [],
  };
}

async function fetchGlobalActivityHistoryPage(
  targetNetwork: BitcoinNetwork,
  options: {
    fresh?: boolean;
    pageIndex?: number;
    pageSize?: number;
    query?: string;
  } = {},
): Promise<PowPaginatedApiResponse<PowActivityItem>> {
  const params = new URLSearchParams();
  params.set("limit", String(options.pageSize ?? ACTIVITY_FEED_PAGE_SIZE));
  params.set("page", String(options.pageIndex ?? 0));
  if (options.fresh) {
    params.set("fresh", "1");
  }
  if (options.query?.trim()) {
    params.set("q", options.query.trim());
  }

  const payload = await fetchProofApiJson<
    PowPaginatedApiResponse<PowActivityItem>
  >(`/api/v1/log-history?${params.toString()}`, targetNetwork);
  return {
    ...payload,
    items: Array.isArray(payload.items) ? payload.items : [],
  };
}

function normalizeRegistryApiState(
  payload: PowRegistryApiResponse | undefined,
): PowRegistryState {
  return {
    activity: Array.isArray(payload?.activity) ? payload.activity : [],
    listings: Array.isArray(payload?.listings) ? payload.listings : [],
    pendingEvents: Array.isArray(payload?.pendingEvents)
      ? payload.pendingEvents
      : [],
    records: Array.isArray(payload?.records) ? payload.records : [],
    sales: Array.isArray(payload?.sales) ? payload.sales : [],
  };
}

function normalizeTokenApiState(
  payload: PowTokenApiResponse | undefined,
): PowTokenState {
  return sanitizedTokenState({
    closedListings: Array.isArray(payload?.closedListings)
      ? payload.closedListings
      : [],
    creationSats: Number.isSafeInteger(payload?.creationSats)
      ? Number(payload?.creationSats)
      : 0,
    confirmedSupply: Number.isSafeInteger(payload?.confirmedSupply)
      ? Number(payload?.confirmedSupply)
      : 0,
    holders: Array.isArray(payload?.holders) ? payload.holders : [],
    listings: Array.isArray(payload?.listings) ? payload.listings : [],
    mints: Array.isArray(payload?.mints) ? payload.mints : [],
    pendingSupply: Number.isSafeInteger(payload?.pendingSupply)
      ? Number(payload?.pendingSupply)
      : 0,
    sales: Array.isArray(payload?.sales) ? payload.sales : [],
    summaryOnly: Boolean(payload?.summaryOnly),
    transfers: Array.isArray(payload?.transfers) ? payload.transfers : [],
    tokens: Array.isArray(payload?.tokens) ? payload.tokens : [],
  });
}

async function fetchTokenState(
  targetNetwork: BitcoinNetwork,
  fresh = false,
  tokenScope = "",
  summary = false,
): Promise<PowTokenState> {
  const indexAddress = tokenIndexAddressForNetwork(targetNetwork);
  if (!indexAddress) {
    return emptyTokenState();
  }

  const params = new URLSearchParams();
  if (fresh) {
    params.set("fresh", "1");
  }
  if (tokenScope.trim()) {
    params.set("asset", tokenScope.trim());
  }
  const query = params.toString();
  const payload = await fetchProofApiJson<PowTokenApiResponse>(
    query
      ? `${summary ? "/api/v1/token-summary" : "/api/v1/token"}?${query}`
      : summary
        ? "/api/v1/token-summary"
      : "/api/v1/token",
    targetNetwork,
  );
  return normalizeTokenApiState(payload);
}

async function fetchTokenSupplyState(
  targetNetwork: BitcoinNetwork,
  fresh = false,
  tokenScope = "",
): Promise<PowTokenSupplyState> {
  const indexAddress = tokenIndexAddressForNetwork(targetNetwork);
  if (!indexAddress) {
    return {
      creationSats: 0,
      confirmedSupply: 0,
      pendingSupply: 0,
      tokens: [],
    };
  }

  const params = new URLSearchParams();
  if (fresh) {
    params.set("fresh", "1");
  }
  if (tokenScope.trim()) {
    params.set("asset", tokenScope.trim());
  }
  const query = params.toString();
  const payload = await fetchProofApiJson<PowTokenApiResponse>(
    query ? `/api/v1/token-summary?${query}` : "/api/v1/token-summary",
    targetNetwork,
  );
  return {
    creationSats: Number.isSafeInteger(payload.creationSats)
      ? Number(payload.creationSats)
      : 0,
    confirmedSupply: Number.isSafeInteger(payload.confirmedSupply)
      ? Number(payload.confirmedSupply)
      : 0,
    pendingSupply: Number.isSafeInteger(payload.pendingSupply)
      ? Number(payload.pendingSupply)
      : 0,
    tokens: Array.isArray(payload.tokens) ? payload.tokens : [],
  };
}

async function fetchTokenHistoryPage<T>(
  targetNetwork: BitcoinNetwork,
  kind:
    | "closedListings"
    | "holders"
    | "listings"
    | "market-log"
    | "mints"
    | "sales"
    | "tokens"
    | "transfers",
  options: {
    fresh?: boolean;
    pageIndex?: number;
    pageSize?: number;
    query?: string;
    tokenScope?: string;
  } = {},
): Promise<PowPaginatedApiResponse<T>> {
  const params = new URLSearchParams();
  params.set("kind", kind);
  params.set("limit", String(options.pageSize ?? DATA_PAGE_SIZE));
  params.set("page", String(options.pageIndex ?? 0));
  if (options.fresh) {
    params.set("fresh", "1");
  }
  if (options.query?.trim()) {
    params.set("q", options.query.trim());
  }
  if (options.tokenScope?.trim()) {
    params.set("asset", options.tokenScope.trim());
  }

  const payload = await fetchProofApiJson<PowPaginatedApiResponse<T>>(
    `/api/v1/token-history?${params.toString()}`,
    targetNetwork,
  );
  return {
    ...payload,
    items: Array.isArray(payload.items) ? payload.items : [],
  };
}

function growthNumberField(
  payload: Partial<GrowthActualNetworkValue> | undefined,
  key: keyof GrowthActualNetworkValue,
) {
  const value = Number(payload?.[key]);
  return Number.isFinite(value) ? value : 0;
}

function normalizeGrowthActualValue(
  payload?: Partial<GrowthActualNetworkValue>,
): GrowthActualNetworkValue {
  return {
    browserFlowSats: growthNumberField(payload, "browserFlowSats"),
    browserSats: growthNumberField(payload, "browserSats"),
    computerEventFlowSats: growthNumberField(
      payload,
      "computerEventFlowSats",
    ),
    computerEventSats: growthNumberField(payload, "computerEventSats"),
    driveFlowSats: growthNumberField(payload, "driveFlowSats"),
    driveSats: growthNumberField(payload, "driveSats"),
    mailFlowSats: growthNumberField(payload, "mailFlowSats"),
    mailSats: growthNumberField(payload, "mailSats"),
    marketplaceSats: growthNumberField(payload, "marketplaceSats"),
    marketplaceVolumeSats: growthNumberField(
      payload,
      "marketplaceVolumeSats",
    ),
    powids: growthNumberField(payload, "powids"),
    tokenCreationFlowSats: growthNumberField(
      payload,
      "tokenCreationFlowSats",
    ),
    tokenMintFlowSats: growthNumberField(payload, "tokenMintFlowSats"),
    tokenSaleFlowSats: growthNumberField(payload, "tokenSaleFlowSats"),
    tokenTransferFlowSats: growthNumberField(
      payload,
      "tokenTransferFlowSats",
    ),
    tokenSats: growthNumberField(payload, "tokenSats"),
    walletFlowSats: growthNumberField(payload, "walletFlowSats"),
    walletSats: growthNumberField(payload, "walletSats"),
    totalSats: growthNumberField(payload, "totalSats"),
    totalUsd: growthNumberField(payload, "totalUsd"),
  };
}

function normalizeGrowthCounts(
  payload: Partial<GrowthSummaryCounts> | undefined,
  actualValue: GrowthActualNetworkValue,
): GrowthSummaryCounts {
  const numberCount = (key: keyof GrowthSummaryCounts, fallback = 0) => {
    const value = Number(payload?.[key]);
    return Number.isFinite(value) ? value : fallback;
  };

  return {
    browserActions: numberCount("browserActions"),
    confirmedComputerActions: numberCount("confirmedComputerActions"),
    confirmedTokenDefinitions: numberCount("confirmedTokenDefinitions"),
    confirmedTokenMints: numberCount("confirmedTokenMints"),
    confirmedTokenSales: numberCount("confirmedTokenSales"),
    confirmedTokenTransfers: numberCount("confirmedTokenTransfers"),
    driveActions: numberCount("driveActions"),
    idListings: numberCount("idListings"),
    mailActions: numberCount("mailActions"),
    marketplaceSaleCount: numberCount("marketplaceSaleCount"),
    pendingRecords: numberCount("pendingRecords"),
    powids: numberCount("powids", actualValue.powids),
    tokenCount: numberCount("tokenCount"),
  };
}

function normalizeGrowthEvent(
  event: Partial<GrowthRealEvent>,
): GrowthRealEvent | undefined {
  const txid = typeof event.txid === "string" ? event.txid : "";
  if (!txid) {
    return undefined;
  }
  const network: BitcoinNetwork =
    event.network === "testnet" || event.network === "testnet4"
      ? event.network
      : "livenet";

  return {
    amountLabel: String(event.amountLabel ?? "Confirmed"),
    createdAt:
      typeof event.createdAt === "string"
        ? event.createdAt
        : new Date().toISOString(),
    detail: String(event.detail ?? ""),
    key: String(event.key ?? txid),
    kind: String(event.kind ?? "Event"),
    network,
    title: String(event.title ?? "Growth event"),
    txid,
  };
}

function normalizeWorkFloorQuote(payload: WorkFloorApiResponse): WorkFloorQuote {
  const stats =
    payload.stats && typeof payload.stats === "object"
      ? Object.fromEntries(
          Object.entries(payload.stats)
            .map(([key, value]) => [key, Number(value)])
            .filter(([, value]) => Number.isFinite(value)),
        )
      : undefined;

  return {
    actualValue: payload.actualValue
      ? normalizeGrowthActualValue(payload.actualValue)
      : undefined,
    chartPoints: Array.isArray(payload.chartPoints)
      ? payload.chartPoints
          .map((point) => ({
            floorSats: Number(point.floorSats) || 0,
            label: String(point.label ?? "point"),
            networkValueSats: Number(point.networkValueSats) || 0,
            years: Number(point.years) || 0,
          }))
          .filter(
            (point) =>
              Number.isFinite(point.floorSats) &&
              Number.isFinite(point.networkValueSats) &&
              Number.isFinite(point.years),
          )
      : [],
    indexedAt:
      typeof payload.indexedAt === "string"
        ? payload.indexedAt
        : new Date().toISOString(),
    networkValueSats: Number(payload.networkValueSats) || 0,
    powids: Number(payload.powids) || 0,
    stats,
    tokenFlowSats: Number(payload.tokenFlowSats) || 0,
  };
}

async function fetchWorkFloorQuote(
  targetNetwork: BitcoinNetwork,
  fresh = false,
): Promise<WorkFloorQuote | undefined> {
  const payload = await fetchProofApiJson<WorkFloorApiResponse>(
    fresh ? "/api/v1/work-floor?fresh=1" : "/api/v1/work-floor",
    targetNetwork,
  );
  return normalizeWorkFloorQuote(payload);
}

async function fetchMarketplaceSummary(
  fresh = false,
): Promise<MarketplaceSummarySnapshot> {
  const payload = await fetchProofApiJson<MarketplaceSummaryApiResponse>(
    fresh
      ? "/api/v1/marketplace-summary?fresh=1"
      : "/api/v1/marketplace-summary",
    "livenet",
  );

  return {
    indexedAt:
      typeof payload.indexedAt === "string"
        ? payload.indexedAt
        : new Date().toISOString(),
    registry: normalizeRegistryApiState(payload.registry),
    token: normalizeTokenApiState(payload.token),
    workFloor: payload.workFloor
      ? normalizeWorkFloorQuote(payload.workFloor)
      : undefined,
  };
}

function normalizeGrowthSummary(
  payload: GrowthSummaryApiResponse,
): GrowthSummarySnapshot {
  const workFloor = payload.workFloor
    ? normalizeWorkFloorQuote(payload.workFloor)
    : undefined;
  const actualValue = normalizeGrowthActualValue(
    payload.actualValue ?? workFloor?.actualValue,
  );

  return {
    actualValue,
    counts: normalizeGrowthCounts(payload.counts, actualValue),
    events: Array.isArray(payload.events)
      ? payload.events
          .map(normalizeGrowthEvent)
          .filter((event): event is GrowthRealEvent => Boolean(event))
      : [],
    indexedAt:
      typeof payload.indexedAt === "string"
        ? payload.indexedAt
        : new Date().toISOString(),
    workFloor,
  };
}

async function fetchGrowthSummary(
  fresh = false,
): Promise<{
  activity: PowActivityItem[];
  registry: PowRegistryState;
  snapshot: GrowthSummarySnapshot;
  token: PowTokenState;
}> {
  const payload = await fetchProofApiJson<GrowthSummaryApiResponse>(
    fresh ? "/api/v1/growth-summary?fresh=1" : "/api/v1/growth-summary",
    "livenet",
  );

  return {
    activity: Array.isArray(payload.activity?.activity)
      ? payload.activity.activity
      : [],
    registry: normalizeRegistryApiState(payload.registry),
    snapshot: normalizeGrowthSummary(payload),
    token: normalizeTokenApiState(payload.token),
  };
}

async function fetchRushState(
  targetNetwork: BitcoinNetwork,
  fresh = false,
): Promise<RushState> {
  const registryAddress = rushRegistryAddressForNetwork(targetNetwork);
  if (!registryAddress) {
    return emptyRushState(targetNetwork);
  }

  const payload = await fetchProofApiJson<RushApiResponse>(
    fresh ? "/api/v1/rush?fresh=1" : "/api/v1/rush",
    targetNetwork,
  );
  return {
    indexedAt:
      typeof payload.indexedAt === "string"
        ? payload.indexedAt
        : new Date().toISOString(),
    mints: Array.isArray(payload.mints) ? payload.mints : [],
    network: targetNetwork,
    registryAddress:
      typeof payload.registryAddress === "string"
        ? payload.registryAddress
        : registryAddress,
    stats: payload.stats ?? emptyRushState(targetNetwork).stats,
  };
}

async function fetchUtxos(
  ownerAddress: string,
  ownerNetwork: BitcoinNetwork,
): Promise<MempoolUtxo[]> {
  const rawUtxos = await fetchProofApiJson<Array<Record<string, unknown>>>(
    `/api/v1/address/${encodeURIComponent(ownerAddress)}/utxo`,
    ownerNetwork,
  );

  return rawUtxos
    .flatMap((utxo): MempoolUtxo[] => {
      const txid = typeof utxo.txid === "string" ? utxo.txid : "";
      const vout = typeof utxo.vout === "number" ? utxo.vout : -1;
      const value = typeof utxo.value === "number" ? utxo.value : 0;

      if (!/^[0-9a-fA-F]{64}$/.test(txid) || vout < 0 || value <= 0) {
        return [];
      }

      const status = utxo.status as MempoolUtxo["status"] | undefined;
      return [{ txid, vout, value, status }];
    })
    .sort((left, right) => {
      const byConfirmation =
        Number(Boolean(right.status?.confirmed)) -
        Number(Boolean(left.status?.confirmed));
      return byConfirmation || right.value - left.value;
    });
}

async function fetchTransactionHex(txid: string, ownerNetwork: BitcoinNetwork) {
  const payload = await fetchProofApiJson<Record<string, unknown>>(
    `/api/v1/tx/${encodeURIComponent(txid)}/hex`,
    ownerNetwork,
  );
  const hex = typeof payload.hex === "string" ? payload.hex.trim() : "";
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/u.test(hex)) {
    throw new Error(
      `Could not load previous transaction ${shortAddress(txid)}.`,
    );
  }

  return hex;
}

async function fetchTransactionOutspend(
  txid: string,
  vout: number,
  network: BitcoinNetwork,
) {
  const url = proofApiUrl(
    `/api/v1/tx/${encodeURIComponent(txid)}/outspend/${vout}`,
    network,
  );
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });
  return response.ok ? ((await response.json()) as Record<string, unknown>) : null;
}

async function loadUtxoPreviousOutput(
  utxo: MempoolUtxo,
  network: BitcoinNetwork,
) {
  const previousTxHex = await fetchTransactionHex(utxo.txid, network);
  const previousTx = bitcoin.Transaction.fromHex(previousTxHex);
  const previousOutput = previousTx.outs[utxo.vout];

  if (!previousOutput) {
    throw new Error(
      `Previous output ${shortAddress(utxo.txid)}:${utxo.vout} could not be read.`,
    );
  }

  return {
    ...utxo,
    previousOutput,
    previousTxHex,
  };
}

async function chooseSellerAnchorPlan(
  fromAddress: string,
  network: BitcoinNetwork,
  priceSats: number,
) {
  const walletUtxos = await fetchUtxos(fromAddress, network);
  const confirmedUtxos = walletUtxos
    .filter((utxo) => utxo.status?.confirmed && utxo.value >= DUST_SATS)
    .sort(
      (left, right) =>
        left.value - right.value ||
        left.txid.localeCompare(right.txid) ||
        left.vout - right.vout,
    );

  if (confirmedUtxos.length < 2) {
    throw new Error(
      "A hardened listing needs at least two confirmed wallet UTXOs: one reserved as the sale anchor and one to publish the listing.",
    );
  }

  const anchor = confirmedUtxos[0];
  const sealTargetSats =
    Math.floor(priceSats) + anchor.value + ID_LISTING_ANCHOR_SEAL_FEE_SATS;
  const fillerUtxos: MempoolUtxo[] = [];
  let totalSats = anchor.value;

  for (const utxo of confirmedUtxos.slice(1)) {
    fillerUtxos.push(utxo);
    totalSats += utxo.value;
    if (totalSats >= sealTargetSats + DUST_SATS) {
      break;
    }
  }

  if (totalSats < sealTargetSats) {
    throw new Error(
      `Need confirmed wallet UTXOs covering at least ${sealTargetSats.toLocaleString()} sats to create the seller anchor seal.`,
    );
  }

  return {
    anchorUtxo: await loadUtxoPreviousOutput(anchor, network),
    sealFundingUtxos: await Promise.all(
      fillerUtxos.map((utxo) => loadUtxoPreviousOutput(utxo, network)),
    ),
  };
}

async function fetchBroadcastStatus(
  txid: string,
  ownerNetwork: BitcoinNetwork,
): Promise<BroadcastStatus> {
  const payload = await fetchProofApiJson<PowTxStatusApiResponse>(
    `/api/v1/tx/${encodeURIComponent(txid)}/status`,
    ownerNetwork,
  );
  return normalizeBroadcastStatus(payload.status);
}

function broadcastTargetsFor(
  ownerAddress: string,
  ownerNetwork: BitcoinNetwork,
  localSent: SentMessage[],
  recoveredSent: SentMessage[],
) {
  return mergeSentMessages(
    [...localSent, ...recoveredSent].filter(
      (message) =>
        message.from === ownerAddress &&
        message.network === ownerNetwork &&
        sentDeliveryStatus(message) !== "confirmed",
    ),
  );
}

async function checkBroadcastTargets(
  targets: SentMessage[],
): Promise<BroadcastCheckSummary> {
  const checkedAt = new Date().toISOString();
  const results = await Promise.all(
    targets.map(async (message): Promise<BroadcastCheckResult> => {
      try {
        const nextStatus = await fetchBroadcastStatus(
          message.txid,
          message.network,
        );
        return {
          from: message.from,
          network: message.network,
          status: nextStatus,
          txid: message.txid,
        };
      } catch {
        return {
          from: message.from,
          network: message.network,
          status: undefined,
          txid: message.txid,
        };
      }
    }),
  );

  const confirmed = results.filter(
    (result) => result.status === "confirmed",
  ).length;
  const dropped = results.filter(
    (result) => result.status === "dropped",
  ).length;
  const pending = results.filter(
    (result) => result.status === "pending",
  ).length;

  return {
    checkedAt,
    confirmed,
    dropped,
    failed: results.length - confirmed - dropped - pending,
    pending,
    results,
  };
}

function applyBroadcastCheckResults<T extends SentMessage>(
  messages: T[],
  summary: BroadcastCheckSummary,
) {
  return messages.map((message) => {
    const result = summary.results.find(
      (item) =>
        item.txid === message.txid &&
        item.network === message.network &&
        item.from === message.from,
    );

    if (!result?.status) {
      return message;
    }

    return {
      ...message,
      confirmedAt:
        result.status === "confirmed"
          ? (message.confirmedAt ?? summary.checkedAt)
          : message.confirmedAt,
      droppedAt:
        result.status === "dropped"
          ? (message.droppedAt ?? summary.checkedAt)
          : undefined,
      lastCheckedAt: summary.checkedAt,
      status: result.status,
    };
  });
}

function broadcastCheckSummaryText(summary: BroadcastCheckSummary) {
  return `${summary.pending} pending, ${summary.confirmed} confirmed, ${summary.dropped} dropped${
    summary.failed ? `, ${summary.failed} unavailable` : ""
  }`;
}

function estimateTxVbytes(inputCount: number, outputVbytes: number) {
  return 10 + inputCount * ESTIMATED_INPUT_VBYTES + outputVbytes;
}

function selectUtxos(
  utxos: MempoolUtxo[],
  amountSats: number,
  feeRate: number,
  fixedOutputVbytes: number,
  changeOutputVbytes: number,
  baseInputCount = 0,
): UtxoSelection {
  const selected: MempoolUtxo[] = [];
  let selectedValue = 0;

  for (const utxo of utxos) {
    selected.push(utxo);
    selectedValue += utxo.value;

    const feeWithChange = Math.ceil(
      estimateTxVbytes(
        selected.length + baseInputCount,
        fixedOutputVbytes + changeOutputVbytes,
      ) * feeRate,
    );
    const changeWithChange = selectedValue - amountSats - feeWithChange;
    if (changeWithChange >= DUST_SATS) {
      return {
        selected,
        dustFeeSats: 0,
        feeSats: feeWithChange,
        changeSats: changeWithChange,
      };
    }

    const feeWithoutChange = Math.ceil(
      estimateTxVbytes(selected.length + baseInputCount, fixedOutputVbytes) *
        feeRate,
    );
    const remainder = selectedValue - amountSats - feeWithoutChange;
    if (remainder >= 0) {
      return {
        selected,
        dustFeeSats: remainder,
        feeSats: feeWithoutChange + remainder,
        changeSats: 0,
      };
    }
  }

  const lastInputCount = Math.max(selected.length, 1) + baseInputCount;
  const estimatedFee = Math.ceil(
    estimateTxVbytes(lastInputCount, fixedOutputVbytes + changeOutputVbytes) *
      feeRate,
  );
  throw new Error(
    `Insufficient funds. Need about ${(amountSats + estimatedFee).toLocaleString()} sats for amount plus fee.`,
  );
}

function isNativeWitnessScript(script: Uint8Array) {
  const version = script[0];
  const pushLength = script[1];
  return (
    script.length >= 4 &&
    (version === 0x00 || version === 0x51) &&
    pushLength === script.length - 2
  );
}

function utxoInputData(
  utxo: MempoolUtxo & {
    previousOutput: bitcoin.Transaction["outs"][number];
    previousTxHex: string;
  },
) {
  if (isNativeWitnessScript(utxo.previousOutput.script)) {
    return {
      witnessUtxo: {
        script: utxo.previousOutput.script,
        value: utxo.previousOutput.value,
      },
    };
  }

  return {
    nonWitnessUtxo: Buffer.from(utxo.previousTxHex, "hex"),
  };
}

function chainedMintInputData(input: ChainedMintInput) {
  if (input.previousOutput && input.previousTxHex) {
    return utxoInputData({
      previousOutput: input.previousOutput,
      previousTxHex: input.previousTxHex,
      txid: input.txid,
      value: input.value,
      vout: input.vout,
    });
  }

  if (!input.script) {
    throw new Error("Chained mint input is missing witness script data.");
  }

  return {
    witnessUtxo: {
      script: input.script,
      value: BigInt(input.value),
    },
  };
}

async function loadChainedInitialInputs(
  selected: MempoolUtxo[],
  network: BitcoinNetwork,
): Promise<ChainedMintInput[]> {
  return Promise.all(
    selected.map(async (utxo) => {
      const previousTxHex = await fetchTransactionHex(utxo.txid, network);
      const previousTx = bitcoin.Transaction.fromHex(previousTxHex);
      const previousOutput = previousTx.outs[utxo.vout];

      if (!previousOutput) {
        throw new Error(
          `Previous output ${shortAddress(utxo.txid)}:${utxo.vout} could not be read.`,
        );
      }

      return {
        previousOutput,
        previousTxHex,
        txid: utxo.txid,
        value: utxo.value,
        vout: utxo.vout,
      };
    }),
  );
}

async function selectChainedInitialInputs({
  excludeOutpoints,
  feeRate,
  fromAddress,
  network,
  totalRequiredSats,
}: {
  excludeOutpoints?: PowIdSpentOutpoint[];
  feeRate: number;
  fromAddress: string;
  network: BitcoinNetwork;
  totalRequiredSats: number;
}) {
  const walletUtxos = await fetchUtxos(fromAddress, network);
  const excluded = new Set(
    (excludeOutpoints ?? []).map(
      (outpoint) => `${outpoint.txid}:${outpoint.vout}`,
    ),
  );
  const spendableWalletUtxos = walletUtxos.filter(
    (utxo) => !excluded.has(`${utxo.txid}:${utxo.vout}`),
  );
  const utxos = spendableWalletUtxos.filter((utxo) => utxo.status?.confirmed);

  if (walletUtxos.length === 0) {
    throw new Error(
      `No spendable UTXOs found for ${shortAddress(fromAddress)} on ${networkLabel(network)}.`,
    );
  }

  if (utxos.length === 0) {
    throw new Error(
      `No confirmed UTXOs found for ${shortAddress(fromAddress)}. Wait for wallet funds to confirm before broadcasting.`,
    );
  }

  const changeScript = scriptForAddress(
    fromAddress,
    network,
    "Connected wallet",
  );
  const changeOutputVbytes = outputVbytesForScript(changeScript);
  let selection: UtxoSelection;
  try {
    selection = selectUtxos(
      utxos,
      totalRequiredSats,
      feeRate,
      0,
      changeOutputVbytes,
    );
  } catch (error) {
    throw new Error(
      `${errorMessage(error, "Insufficient confirmed funds.")} Chained minting uses confirmed wallet UTXOs for the first transaction, then spends its own chained outputs.`,
    );
  }

  return loadChainedInitialInputs(selection.selected, network);
}

function buildChainedMintPsbt({
  feeRate,
  fixedOutputs,
  fromAddress,
  inputs,
  isLast,
  network,
}: {
  feeRate: number;
  fixedOutputs: PaymentOutputSpec[];
  fromAddress: string;
  inputs: ChainedMintInput[];
  isLast: boolean;
  network: BitcoinNetwork;
}): ChainedMintBuildResult {
  const selectedNetwork = bitcoinNetwork(network);
  const chainScript = scriptForAddress(
    fromAddress,
    network,
    "Connected wallet",
  );
  const normalizedOutputs = fixedOutputs.map((output, index) => {
    const amountSats = Math.floor(output.amountSats);
    if (amountSats < 0) {
      throw new Error(`Chained mint output ${index + 1} has a negative value.`);
    }

    const script =
      output.script ??
      scriptForAddress(
        output.address ?? "",
        network,
        `Chained mint output ${index + 1}`,
      );

    return {
      address: output.address,
      amountSats,
      script,
    };
  });
  const fixedOutputVbytes =
    normalizedOutputs.reduce(
      (total, output) => total + outputVbytesForScript(output.script),
      0,
    ) + outputVbytesForScript(chainScript);
  const totalInputSats = inputs.reduce((total, input) => total + input.value, 0);
  const totalFixedSats = normalizedOutputs.reduce(
    (total, output) => total + output.amountSats,
    0,
  );
  const baseFeeSats = Math.ceil(
    estimateTxVbytes(inputs.length, fixedOutputVbytes) * feeRate,
  );
  const chainValue = totalInputSats - totalFixedSats - baseFeeSats;
  if (chainValue < 0) {
    throw new Error("Chained mint input value is not enough for outputs plus fee.");
  }

  const includeChainOutput = chainValue >= DUST_SATS;
  if (!includeChainOutput && !isLast) {
    throw new Error(
      `Chained mint output would be below dust (${DUST_SATS.toLocaleString()} sats).`,
    );
  }

  const dustFeeSats = includeChainOutput ? 0 : chainValue;
  const psbt = new bitcoin.Psbt({ network: selectedNetwork });
  for (const input of inputs) {
    psbt.addInput({
      hash: input.txid,
      index: input.vout,
      ...chainedMintInputData(input),
    });
  }

  for (const output of normalizedOutputs) {
    if (output.address) {
      psbt.addOutput({
        address: output.address,
        value: BigInt(output.amountSats),
      });
    } else {
      psbt.addOutput({
        script: output.script,
        value: BigInt(output.amountSats),
      });
    }
  }

  let nextInput: ChainedMintInput | undefined;
  if (includeChainOutput) {
    psbt.addOutput({
      address: fromAddress,
      value: BigInt(chainValue),
    });
    nextInput = {
      script: chainScript,
      txid: "",
      value: chainValue,
      vout: normalizedOutputs.length,
    };
  }

  return {
    dustFeeSats,
    feeSats: baseFeeSats + dustFeeSats,
    inputCount: inputs.length,
    nextInput,
    psbtHex: psbt.toHex(),
  };
}

async function buildPaymentPsbt({
  amountSats,
  excludeOutpoints,
  feeRate,
  fromAddress,
  network,
  payments,
  postProtocolPayments,
  requireConfirmedUtxos = true,
  protocolPayloads,
  toAddress,
}: {
  amountSats?: number;
  excludeOutpoints?: PowIdSpentOutpoint[];
  feeRate: number;
  fromAddress: string;
  network: BitcoinNetwork;
  payments?: PaymentOutputSpec[];
  postProtocolPayments?: PaymentOutputSpec[];
  requireConfirmedUtxos?: boolean;
  protocolPayloads: string[];
  toAddress?: string;
}) {
  const selectedNetwork = bitcoinNetwork(network);
  const paymentOutputs =
    payments ??
    (toAddress && typeof amountSats === "number"
      ? [{ address: toAddress, amountSats }]
      : []);
  if (paymentOutputs.length === 0) {
    throw new Error("Add at least one recipient.");
  }

  const normalizeOutput = (
    payment: PaymentOutputSpec,
    index: number,
    label: string,
  ) => {
    const satoshis = Math.floor(payment.amountSats);
    if (satoshis <= 0) {
      throw new Error("Recipient amount must be greater than zero.");
    }

    if (payment.script) {
      return {
        amountSats: satoshis,
        script: payment.script,
      };
    }

    if (!payment.address) {
      throw new Error(`${label} ${index + 1} is missing an address.`);
    }

    return {
      address: payment.address,
      amountSats: satoshis,
      script: scriptForAddress(
        payment.address,
        network,
        `${label} ${index + 1}`,
      ),
    };
  };
  const normalizedPayments = paymentOutputs.map((payment, index) =>
    normalizeOutput(payment, index, "Recipient"),
  );
  const normalizedPostProtocolPayments = (postProtocolPayments ?? []).map(
    (payment, index) =>
      normalizeOutput(payment, index, "Post-protocol recipient"),
  );
  const totalAmountSats = [
    ...normalizedPayments,
    ...normalizedPostProtocolPayments,
  ].reduce((total, payment) => total + payment.amountSats, 0);
  const changeScript = scriptForAddress(
    fromAddress,
    network,
    "Connected wallet",
  );
  const opReturnScripts = protocolOutputScripts(protocolPayloads);
  const fixedOutputVbytes =
    normalizedPayments.reduce(
      (total, payment) => total + outputVbytesForScript(payment.script),
      0,
    ) +
    opReturnScripts.reduce(
      (total, script) => total + outputVbytesForScript(script),
      0,
    ) +
    normalizedPostProtocolPayments.reduce(
      (total, payment) => total + outputVbytesForScript(payment.script),
      0,
    );
  const changeOutputVbytes = outputVbytesForScript(changeScript);
  const walletUtxos = await fetchUtxos(fromAddress, network);
  const excluded = new Set(
    (excludeOutpoints ?? []).map(
      (outpoint) => `${outpoint.txid}:${outpoint.vout}`,
    ),
  );
  const spendableWalletUtxos = walletUtxos.filter(
    (utxo) => !excluded.has(`${utxo.txid}:${utxo.vout}`),
  );
  const utxos = requireConfirmedUtxos
    ? spendableWalletUtxos.filter((utxo) => utxo.status?.confirmed)
    : spendableWalletUtxos;

  if (walletUtxos.length === 0) {
    throw new Error(
      `No spendable UTXOs found for ${shortAddress(fromAddress)} on ${networkLabel(network)}.`,
    );
  }

  if (requireConfirmedUtxos && utxos.length === 0) {
    throw new Error(
      `No confirmed UTXOs found for ${shortAddress(fromAddress)}. Wait for wallet funds to confirm before broadcasting.`,
    );
  }

  let selection: UtxoSelection;
  try {
    selection = selectUtxos(
      utxos,
      totalAmountSats,
      feeRate,
      fixedOutputVbytes,
      changeOutputVbytes,
    );
  } catch (error) {
    if (requireConfirmedUtxos && walletUtxos.length > utxos.length) {
      throw new Error(
        `${errorMessage(error, "Insufficient confirmed funds.")} Only confirmed UTXOs are used for ProofOfWork.Me broadcasts so effective fees do not get dragged down by unconfirmed ancestors.`,
      );
    }

    throw error;
  }
  const selectedWithPreviousTx = await Promise.all(
    selection.selected.map(async (utxo) => {
      const previousTxHex = await fetchTransactionHex(utxo.txid, network);
      const previousTx = bitcoin.Transaction.fromHex(previousTxHex);
      const previousOutput = previousTx.outs[utxo.vout];

      if (!previousOutput) {
        throw new Error(
          `Previous output ${shortAddress(utxo.txid)}:${utxo.vout} could not be read.`,
        );
      }

      return {
        ...utxo,
        previousTxHex,
        previousOutput,
      };
    }),
  );

  const psbt = new bitcoin.Psbt({ network: selectedNetwork });

  for (const utxo of selectedWithPreviousTx) {
    const input = {
      hash: utxo.txid,
      index: utxo.vout,
    };

    psbt.addInput({
      ...input,
      ...utxoInputData(utxo),
    });
  }

  for (const payment of normalizedPayments) {
    if (payment.address) {
      psbt.addOutput({
        address: payment.address,
        value: BigInt(payment.amountSats),
      });
    } else {
      psbt.addOutput({
        script: payment.script,
        value: BigInt(payment.amountSats),
      });
    }
  }

  for (const script of opReturnScripts) {
    psbt.addOutput({
      script,
      value: 0n,
    });
  }

  for (const payment of normalizedPostProtocolPayments) {
    if (payment.address) {
      psbt.addOutput({
        address: payment.address,
        value: BigInt(payment.amountSats),
      });
    } else {
      psbt.addOutput({
        script: payment.script,
        value: BigInt(payment.amountSats),
      });
    }
  }

  if (selection.changeSats >= DUST_SATS) {
    psbt.addOutput({
      address: fromAddress,
      value: BigInt(selection.changeSats),
    });
  }

  return {
    changeSats: selection.changeSats,
    dustFeeSats: selection.dustFeeSats,
    feeSats: selection.feeSats,
    inputCount: selection.selected.length,
    outputCount:
      normalizedPayments.length +
      opReturnScripts.length +
      normalizedPostProtocolPayments.length +
      (selection.changeSats >= DUST_SATS ? 1 : 0),
    psbtHex: psbt.toHex(),
  };
}

async function signSellerAnchorAuthorization({
  anchorUtxo,
  network,
  priceSats,
  sellerAddress,
  sellerPublicKey,
  sealFundingUtxos,
  wallet,
}: {
  anchorUtxo: MempoolUtxo & {
    previousOutput: bitcoin.Transaction["outs"][number];
    previousTxHex: string;
  };
  network: BitcoinNetwork;
  priceSats: number;
  sellerAddress: string;
  sellerPublicKey: string;
  sealFundingUtxos: Array<
    MempoolUtxo & {
      previousOutput: bitcoin.Transaction["outs"][number];
      previousTxHex: string;
    }
  >;
  wallet: UnisatWallet;
}) {
  if (!wallet.signPsbt) {
    throw new Error(
      "UniSat signPsbt is not available. Update UniSat and try again.",
    );
  }

  const psbt = new bitcoin.Psbt({ network: bitcoinNetwork(network) });
  psbt.addInput({
    hash: anchorUtxo.txid,
    index: anchorUtxo.vout,
    sighashType: ID_LISTING_ANCHOR_SIGHASH_TYPE,
    ...utxoInputData(anchorUtxo),
  });

  for (const utxo of sealFundingUtxos) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      ...utxoInputData(utxo),
    });
  }

  const totalInputSats =
    anchorUtxo.value +
    sealFundingUtxos.reduce((total, utxo) => total + utxo.value, 0);
  const sellerOutputSats = Math.floor(priceSats) + anchorUtxo.value;
  const changeSats =
    totalInputSats - sellerOutputSats - ID_LISTING_ANCHOR_SEAL_FEE_SATS;
  if (changeSats < 0) {
    throw new Error(
      "Seller anchor seal does not have enough temporary wallet input value.",
    );
  }

  psbt.addOutput({
    address: sellerAddress,
    value: BigInt(sellerOutputSats),
  });

  if (changeSats >= DUST_SATS) {
    psbt.addOutput({
      address: sellerAddress,
      value: BigInt(changeSats),
    });
  }

  let signedPsbtHex = "";
  try {
    signedPsbtHex = await wallet.signPsbt(psbt.toHex(), {
      autoFinalized: false,
      toSignInputs: [
        {
          address: sellerAddress,
          index: 0,
          sighashTypes: [ID_LISTING_ANCHOR_SIGHASH_TYPE],
        },
      ],
    });
  } catch (addressError) {
    try {
      signedPsbtHex = await wallet.signPsbt(psbt.toHex(), {
        autoFinalized: false,
        toSignInputs: [
          {
            index: 0,
            publicKey: sellerPublicKey,
            sighashTypes: [ID_LISTING_ANCHOR_SIGHASH_TYPE],
          },
        ],
      });
    } catch {
      throw addressError;
    }
  }
  const signedPsbt = bitcoin.Psbt.fromHex(signedPsbtHex, {
    network: bitcoinNetwork(network),
  });
  const inputSignature = signedInputSignature(signedPsbt, 0, sellerPublicKey);
  const signature = inputSignature?.signature;

  if (
    !signature ||
    signature[signature.length - 1] !== ID_LISTING_ANCHOR_SIGHASH_TYPE
  ) {
    throw new Error(
      "Wallet did not return a seller anchor signature with the required sighash type.",
    );
  }

  const signatureHex = bytesToHex(signature);
  if (!validSignatureHex(signatureHex)) {
    throw new Error("Wallet returned a malformed seller anchor signature.");
  }

  return signatureHex;
}

async function signSaleTicketAuthorization({
  listing,
  network,
  wallet,
}: {
  listing: PowIdListing;
  network: BitcoinNetwork;
  wallet: UnisatWallet;
}) {
  if (!wallet.signPsbt) {
    throw new Error(
      "UniSat signPsbt is not available. Update UniSat and try again.",
    );
  }

  if (listing.listingVersion !== "list5") {
    throw new Error("Only sale-ticket listings can be sealed.");
  }

  const anchor = await assertListingAnchorUnspent(listing, network);
  if (!("scriptPubKey" in anchor) || !anchor.publicKey) {
    throw new Error(
      "This listing does not have a seller-controlled sale ticket.",
    );
  }

  const psbt = new bitcoin.Psbt({ network: bitcoinNetwork(network) });
  psbt.addInput({
    hash: anchor.txid,
    index: anchor.vout,
    sighashType: ID_LISTING_ANCHOR_SIGHASH_TYPE,
    ...utxoInputData({
      txid: anchor.txid,
      value: anchor.valueSats,
      vout: anchor.vout,
      previousOutput: anchor.previousOutput,
      previousTxHex: anchor.previousTxHex,
    }),
  });
  psbt.addOutput({
    address: listing.sellerAddress,
    value: BigInt(sellerPaymentRequiredSats(listing)),
  });

  let signedPsbtHex = "";
  try {
    signedPsbtHex = await wallet.signPsbt(psbt.toHex(), {
      autoFinalized: false,
      toSignInputs: [
        {
          address: listing.sellerAddress,
          index: 0,
          sighashTypes: [ID_LISTING_ANCHOR_SIGHASH_TYPE],
        },
      ],
    });
  } catch (addressError) {
    try {
      signedPsbtHex = await wallet.signPsbt(psbt.toHex(), {
        autoFinalized: false,
        toSignInputs: [
          {
            index: 0,
            publicKey: anchor.publicKey,
            sighashTypes: [ID_LISTING_ANCHOR_SIGHASH_TYPE],
          },
        ],
      });
    } catch {
      throw addressError;
    }
  }

  const signedPsbt = bitcoin.Psbt.fromHex(signedPsbtHex, {
    network: bitcoinNetwork(network),
  });
  const inputSignature = signedInputSignature(signedPsbt, 0, anchor.publicKey);
  const signature = inputSignature?.signature;

  if (
    !signature ||
    signature[signature.length - 1] !== ID_LISTING_ANCHOR_SIGHASH_TYPE
  ) {
    throw new Error(
      "Wallet did not return a sale-ticket signature with the required sighash type.",
    );
  }

  const signatureHex = bytesToHex(signature);
  if (!validSignatureHex(signatureHex)) {
    throw new Error("Wallet returned a malformed sale-ticket signature.");
  }

  return signatureHex;
}

async function signTokenSaleTicketAuthorization({
  listing,
  network,
  wallet,
}: {
  listing: PowTokenListing;
  network: BitcoinNetwork;
  wallet: UnisatWallet;
}) {
  if (!wallet.signPsbt) {
    throw new Error(
      "UniSat signPsbt is not available. Update UniSat and try again.",
    );
  }

  const anchor = await assertListingAnchorUnspent(listing, network);
  if (!("scriptPubKey" in anchor) || !anchor.publicKey) {
    throw new Error(
      "This token listing does not have a seller-controlled sale ticket.",
    );
  }

  const psbt = new bitcoin.Psbt({ network: bitcoinNetwork(network) });
  psbt.addInput({
    hash: anchor.txid,
    index: anchor.vout,
    sighashType: TOKEN_LISTING_ANCHOR_SIGHASH_TYPE,
    ...utxoInputData({
      txid: anchor.txid,
      value: anchor.valueSats,
      vout: anchor.vout,
      previousOutput: anchor.previousOutput,
      previousTxHex: anchor.previousTxHex,
    }),
  });
  psbt.addOutput({
    address: listing.sellerAddress,
    value: BigInt(tokenSellerPaymentRequiredSats(listing)),
  });

  let signedPsbtHex = "";
  try {
    signedPsbtHex = await wallet.signPsbt(psbt.toHex(), {
      autoFinalized: false,
      toSignInputs: [
        {
          address: listing.sellerAddress,
          index: 0,
          sighashTypes: [TOKEN_LISTING_ANCHOR_SIGHASH_TYPE],
        },
      ],
    });
  } catch (addressError) {
    try {
      signedPsbtHex = await wallet.signPsbt(psbt.toHex(), {
        autoFinalized: false,
        toSignInputs: [
          {
            index: 0,
            publicKey: anchor.publicKey,
            sighashTypes: [TOKEN_LISTING_ANCHOR_SIGHASH_TYPE],
          },
        ],
      });
    } catch {
      throw addressError;
    }
  }

  const signedPsbt = bitcoin.Psbt.fromHex(signedPsbtHex, {
    network: bitcoinNetwork(network),
  });
  const inputSignature = signedInputSignature(signedPsbt, 0, anchor.publicKey);
  const signature = inputSignature?.signature;

  if (
    !signature ||
    signature[signature.length - 1] !== TOKEN_LISTING_ANCHOR_SIGHASH_TYPE
  ) {
    throw new Error(
      "Wallet did not return a token sale-ticket signature with the required sighash type.",
    );
  }

  const signatureHex = bytesToHex(signature);
  if (!validSignatureHex(signatureHex)) {
    throw new Error("Wallet returned a malformed token sale-ticket signature.");
  }

  return signatureHex;
}

function encodeCompactSize(value: number) {
  if (value < 0xfd) {
    return Buffer.from([value]);
  }

  if (value <= 0xffff) {
    const buffer = Buffer.alloc(3);
    buffer[0] = 0xfd;
    buffer.writeUInt16LE(value, 1);
    return buffer;
  }

  if (value <= 0xffffffff) {
    const buffer = Buffer.alloc(5);
    buffer[0] = 0xfe;
    buffer.writeUInt32LE(value, 1);
    return buffer;
  }

  throw new Error("Witness stack item is too large.");
}

function witnessStackToScriptWitness(stack: Uint8Array[]) {
  return Buffer.concat([
    encodeCompactSize(stack.length),
    ...stack.flatMap((item) => [
      encodeCompactSize(item.length),
      Buffer.from(item),
    ]),
  ]);
}

function listingAnchorDetails(
  listing: PowIdListing | PowTokenListing,
  network: BitcoinNetwork,
) {
  if (
    "tokenId" in listing &&
    listing.saleAuthorization.version === TOKEN_SALE_AUTH_VERSION
  ) {
    if (
      listing.saleAuthorization.anchorType === TOKEN_LISTING_ANCHOR_TYPE &&
      typeof listing.saleAuthorization.sellerPublicKey === "string"
    ) {
      return {
        publicKey: listing.saleAuthorization.sellerPublicKey,
        scriptPubKey: listing.saleAuthorization.anchorScriptPubKey,
        signature: listing.saleAuthorization.anchorSignature,
        sighashType: listing.saleAuthorization.anchorSigHashType,
        txid: listing.listingId,
        valueSats: listing.saleAuthorization.anchorValueSats,
        vout: listing.saleAuthorization.anchorVout,
      };
    }

    throw new Error("This token listing does not use a sale-ticket anchor.");
  }

  const authorization = listing.saleAuthorization as PowIdSaleAuthorization;
  if (!saleAuthorizationHasAnchor(authorization)) {
    throw new Error(
      "This listing does not use a spendable marketplace anchor.",
    );
  }

  if (saleAuthorizationUsesSellerUtxoAnchor(authorization)) {
    return {
      scriptPubKey: authorization.anchorScriptPubKey,
      signature: authorization.anchorSignature,
      sighashType: authorization.anchorSigHashType,
      txid: authorization.anchorTxid,
      valueSats: authorization.anchorValueSats,
      vout: authorization.anchorVout,
      publicKey: authorization.sellerPublicKey,
    };
  }

  if (
    authorization.version === ID_SALE_AUTH_VERSION_TICKET &&
    authorization.anchorType === ID_LISTING_TICKET_ANCHOR_TYPE &&
    typeof authorization.sellerPublicKey === "string"
  ) {
    return {
      publicKey: authorization.sellerPublicKey,
      scriptPubKey: authorization.anchorScriptPubKey,
      signature: authorization.anchorSignature,
      sighashType:
        authorization.anchorSigHashType ??
        ID_LISTING_ANCHOR_SIGHASH_TYPE,
      txid: listing.listingId,
      valueSats: authorization.anchorValueSats,
      vout: authorization.anchorVout,
    };
  }

  if (
    authorization.anchorScriptPubKey !==
    marketplaceLegacyAnchorScriptPubKey(network)
  ) {
    throw new Error(
      "This listing anchor script does not match the legacy marketplace protocol.",
    );
  }

  return {
    script: marketplaceLegacyAnchorOutputScript(network),
    txid: listing.listingId,
    valueSats: authorization.anchorValueSats,
    vout: authorization.anchorVout,
    witnessScript: marketplaceLegacyAnchorWitnessScript(),
  };
}

async function assertListingAnchorUnspent(
  listing: PowIdListing | PowTokenListing,
  network: BitcoinNetwork,
) {
  const anchor = listingAnchorDetails(listing, network);
  const listingTxHex = await fetchTransactionHex(anchor.txid, network);
  const listingTx = bitcoin.Transaction.fromHex(listingTxHex);
  const output = listingTx.outs[anchor.vout];
  const expectedScript =
    "scriptPubKey" in anchor ? anchor.scriptPubKey : bytesToHex(anchor.script);

  if (
    !output ||
    bytesToHex(output.script) !== expectedScript ||
    Number(output.value) !== anchor.valueSats
  ) {
    throw new Error(
      "Listing anchor output does not match the on-chain listing transaction.",
    );
  }

  const outspend = await fetchTransactionOutspend(
    anchor.txid,
    anchor.vout,
    network,
  );
  if (outspend) {
    if (outspend.spent) {
      throw new Error("This listing anchor has already been spent.");
    }
  }

  return {
    ...anchor,
    previousOutput: output,
    previousTxHex: listingTxHex,
  };
}

async function buildAnchoredMarketplacePsbt({
  anchorSpendMode = "preSigned",
  excludeOutpoints,
  feeRate,
  fromAddress,
  listing,
  network,
  payments,
  protocolPayloads,
  requireConfirmedUtxos = true,
}: {
  anchorSpendMode?: "preSigned" | "wallet";
  excludeOutpoints?: PowIdSpentOutpoint[];
  feeRate: number;
  fromAddress: string;
  listing: PowIdListing | PowTokenListing;
  network: BitcoinNetwork;
  payments: PaymentOutputSpec[];
  protocolPayloads: string[];
  requireConfirmedUtxos?: boolean;
}) {
  const selectedNetwork = bitcoinNetwork(network);
  const anchor = await assertListingAnchorUnspent(listing, network);
  const normalizedPayments = payments.map((payment, index) => {
    const satoshis = Math.floor(payment.amountSats);
    if (satoshis <= 0) {
      throw new Error("Recipient amount must be greater than zero.");
    }

    if (!payment.address) {
      throw new Error(`Recipient ${index + 1} is missing an address.`);
    }

    return {
      address: payment.address,
      amountSats: satoshis,
      script: scriptForAddress(
        payment.address,
        network,
        `Recipient ${index + 1}`,
      ),
    };
  });
  const positiveOutputSats = normalizedPayments.reduce(
    (total, payment) => total + payment.amountSats,
    0,
  );
  const walletFundedSats = Math.max(0, positiveOutputSats - anchor.valueSats);
  const changeScript = scriptForAddress(
    fromAddress,
    network,
    "Connected wallet",
  );
  const opReturnScripts = protocolOutputScripts(protocolPayloads);
  const fixedOutputVbytes =
    normalizedPayments.reduce(
      (total, payment) => total + outputVbytesForScript(payment.script),
      0,
    ) +
    opReturnScripts.reduce(
      (total, script) => total + outputVbytesForScript(script),
      0,
    );
  const changeOutputVbytes = outputVbytesForScript(changeScript);
  const walletUtxos = await fetchUtxos(fromAddress, network);
  const anchorOutpointKey = `${anchor.txid}:${anchor.vout}`;
  const excluded = new Set([
    anchorOutpointKey,
    ...(excludeOutpoints ?? []).map(
      (outpoint) => `${outpoint.txid}:${outpoint.vout}`,
    ),
  ]);
  const spendableWalletUtxos = walletUtxos.filter(
    (utxo) => !excluded.has(`${utxo.txid}:${utxo.vout}`),
  );
  const utxos = requireConfirmedUtxos
    ? spendableWalletUtxos.filter((utxo) => utxo.status?.confirmed)
    : spendableWalletUtxos;

  if (walletUtxos.length === 0) {
    throw new Error(
      `No spendable UTXOs found for ${shortAddress(fromAddress)} on ${networkLabel(network)}.`,
    );
  }

  if (requireConfirmedUtxos && utxos.length === 0) {
    throw new Error(
      `No confirmed UTXOs found for ${shortAddress(fromAddress)}. Wait for wallet funds to confirm before broadcasting.`,
    );
  }

  let selection: UtxoSelection;
  try {
    selection = selectUtxos(
      utxos,
      walletFundedSats,
      feeRate,
      fixedOutputVbytes,
      changeOutputVbytes,
      1,
    );
  } catch (error) {
    if (requireConfirmedUtxos && walletUtxos.length > utxos.length) {
      throw new Error(
        `${errorMessage(error, "Insufficient confirmed funds.")} Only confirmed UTXOs are used for ProofOfWork.Me broadcasts so effective fees do not get dragged down by unconfirmed ancestors.`,
      );
    }

    throw error;
  }

  const selectedWithPreviousTx = await Promise.all(
    selection.selected.map((utxo) => loadUtxoPreviousOutput(utxo, network)),
  );

  const psbt = new bitcoin.Psbt({ network: selectedNetwork });
  if ("scriptPubKey" in anchor) {
    const anchorInput = {
      hash: anchor.txid,
      index: anchor.vout,
      ...utxoInputData({
        txid: anchor.txid,
        value: anchor.valueSats,
        vout: anchor.vout,
        previousOutput: anchor.previousOutput,
        previousTxHex: anchor.previousTxHex,
      }),
    };
    const anchorIsTaproot = isTaprootScriptPubKey(anchor.previousOutput.script);
    const anchorPublicKey = anchor.publicKey;
    const anchorSignature = anchor.signature;
    if (anchorSpendMode === "preSigned" && !anchorSignature) {
      throw new Error(
        "This sale ticket is not sealed yet. The seller must seal it before buyers can purchase.",
      );
    }

    if (
      anchorSpendMode === "preSigned" &&
      !anchorIsTaproot &&
      !anchorPublicKey
    ) {
      throw new Error("This sale ticket is missing the seller public key.");
    }

    if (anchorSpendMode === "preSigned") {
      if (anchorIsTaproot) {
        psbt.addInput({
          ...anchorInput,
          sighashType: anchor.sighashType,
          tapKeySig: Buffer.from(anchorSignature as string, "hex"),
        });
      } else {
        psbt.addInput({
          ...anchorInput,
          partialSig: [
            {
              pubkey: Buffer.from(anchorPublicKey as string, "hex"),
              signature: Buffer.from(anchorSignature as string, "hex"),
            },
          ],
          sighashType: anchor.sighashType,
        });
      }
    } else {
      psbt.addInput(anchorInput);
    }
  } else {
    psbt.addInput({
      hash: anchor.txid,
      index: anchor.vout,
      witnessScript: anchor.witnessScript,
      witnessUtxo: {
        script: anchor.script,
        value: BigInt(anchor.valueSats),
      },
    });
  }

  for (const utxo of selectedWithPreviousTx) {
    const input = {
      hash: utxo.txid,
      index: utxo.vout,
    };

    psbt.addInput({
      ...input,
      ...utxoInputData(utxo),
    });
  }

  for (const payment of normalizedPayments) {
    psbt.addOutput({
      address: payment.address,
      value: BigInt(payment.amountSats),
    });
  }

  for (const script of opReturnScripts) {
    psbt.addOutput({
      script,
      value: 0n,
    });
  }

  if (selection.changeSats >= DUST_SATS) {
    psbt.addOutput({
      address: fromAddress,
      value: BigInt(selection.changeSats),
    });
  }

  if (
    anchorSpendMode === "preSigned" &&
    "signature" in anchor &&
    typeof anchor.signature === "string"
  ) {
    psbt.finalizeInput(0);
  } else if (!("scriptPubKey" in anchor)) {
    psbt.finalizeInput(0, () => ({
      finalScriptWitness: witnessStackToScriptWitness([anchor.witnessScript]),
    }));
  }

  return {
    anchorInputCount: 1,
    changeSats: selection.changeSats,
    dustFeeSats: selection.dustFeeSats,
    feeSats: selection.feeSats,
    inputCount: selection.selected.length + 1,
    outputCount:
      normalizedPayments.length +
      opReturnScripts.length +
      (selection.changeSats >= DUST_SATS ? 1 : 0),
    psbtHex: psbt.toHex(),
    walletInputIndexes:
      "scriptPubKey" in anchor && anchorSpendMode === "wallet"
        ? [0, ...selection.selected.map((_, index) => index + 1)]
        : selection.selected.map((_, index) => index + 1),
  };
}

function normalizeBroadcastTxid(value: unknown) {
  const txid = String(value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/u.test(txid) ? txid : "";
}

function rawTransactionTxid(rawTx: string) {
  try {
    return normalizeBroadcastTxid(bitcoin.Transaction.fromHex(rawTx).getId());
  } catch {
    return "";
  }
}

function countOpReturnOutputs(rawTx: string, network: BitcoinNetwork) {
  try {
    const transaction = bitcoin.Transaction.fromHex(rawTx);
    return transaction.outs.filter(
      (output) => output.script[0] === bitcoin.opcodes.OP_RETURN,
    ).length;
  } catch {
    const psbt = bitcoin.Psbt.fromHex(rawTx, {
      network: bitcoinNetwork(network),
    });
    const transaction = psbt.extractTransaction();
    return transaction.outs.filter(
      (output) => output.script[0] === bitcoin.opcodes.OP_RETURN,
    ).length;
  }
}

const PROOF_API_BROADCAST_RETRY_DELAYS_MS = [900, 2_500, 5_000];
const PROOF_API_BROADCAST_RECOVERY_DELAYS_MS = [500, 1_500];

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function broadcastRawTransaction(
  rawTx: string,
  ownerNetwork: BitcoinNetwork,
): Promise<TransactionBroadcastResult> {
  return broadcastRawTransactionViaProofApi(rawTx, ownerNetwork);
}

function proofApiBroadcastErrorMessage(
  payload: Record<string, unknown> | null,
  responseText: string,
  status: number,
) {
  const details =
    payload?.details && typeof payload.details === "object"
      ? (payload.details as Record<string, unknown>)
      : null;
  const mempoolAccept =
    details?.mempoolAccept && typeof details.mempoolAccept === "object"
      ? (details.mempoolAccept as Record<string, unknown>)
      : null;
  const rawBase = String(
    payload?.error ??
      payload?.message ??
      responseText ??
      `Node broadcast failed with HTTP ${status}.`,
  );
  const gatewayFailure =
    status >= 500 &&
    /<html|bad gateway|nginx|caddy|connection reset|upstream|gateway/i.test(
      `${rawBase} ${responseText}`,
    );
  const base = gatewayFailure
    ? `Broadcast gateway returned HTTP ${status}. The node/API connection reset before returning a transaction result. Refresh wallet UTXOs and retry after pending ancestors settle.`
    : rawBase;
  const reason = String(
    details?.reason ?? mempoolAccept?.rejectReason ?? "",
  ).trim();
  const code =
    typeof details?.code === "number" || typeof details?.code === "string"
      ? String(details.code)
      : "";
  const hint = String(details?.hint ?? "").trim();
  const parts = [base];
  if (reason && !base.toLowerCase().includes(reason.toLowerCase())) {
    parts.push(`Reason: ${reason}`);
  }
  if (code && !base.includes(code)) {
    parts.push(`RPC code: ${code}`);
  }
  if (hint) {
    parts.push(`Hint: ${hint}`);
  }
  return parts.join(" ");
}

function isKnownAcceptedBroadcastMessage(message: string) {
  return /txn-already-in-mempool|already in mempool|already known|already exists|already in block chain|transaction already in the block chain|transaction already in blockchain/i.test(
    message,
  );
}

function isTransientProofApiBroadcastFailure(status: number, message: string) {
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  return /bad gateway|gateway|upstream|connection reset|econnreset|socket hang up|timeout|timed out|temporarily unavailable|service unavailable|too many requests|failed to fetch|networkerror|node broadcast request failed/i.test(
    message,
  );
}

async function recoverBroadcastTxidFromStatus(
  txid: string,
  ownerNetwork: BitcoinNetwork,
) {
  for (const waitMs of PROOF_API_BROADCAST_RECOVERY_DELAYS_MS) {
    await delay(waitMs);
    try {
      const status = await fetchBroadcastStatus(txid, ownerNetwork);
      if (status === "pending" || status === "confirmed") {
        return true;
      }
    } catch {
      // Best-effort recovery only. The normal retry path handles failure.
    }
  }

  return false;
}

type ProofApiBroadcastAttempt = {
  ok: boolean;
  payload: Record<string, unknown> | null;
  responseText: string;
  status: number;
  txid: string;
};

async function postRawTransactionToProofApi(
  rawTx: string,
  ownerNetwork: BitcoinNetwork,
): Promise<ProofApiBroadcastAttempt> {
  const response = await fetch(
    proofApiUrl("/api/v1/broadcast/tx", ownerNetwork),
    {
      body: JSON.stringify({ txHex: rawTx }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  const responseText = await response.text().catch(() => "");
  let payload: Record<string, unknown> | null = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      payload = { message: responseText };
    }
  }

  return {
    ok: response.ok,
    payload,
    responseText,
    status: response.status,
    txid: normalizeBroadcastTxid(
      payload?.txid ?? payload?.message ?? payload?.txId ?? payload?.result,
    ),
  };
}

async function broadcastRawTransactionViaProofApi(
  rawTx: string,
  ownerNetwork: BitcoinNetwork,
): Promise<TransactionBroadcastResult> {
  const opReturnCount = countOpReturnOutputs(rawTx, ownerNetwork);
  const localTxid = rawTransactionTxid(rawTx);
  let lastMessage = "Node broadcast failed.";

  for (
    let attempt = 0;
    attempt <= PROOF_API_BROADCAST_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    if (attempt > 0) {
      await delay(PROOF_API_BROADCAST_RETRY_DELAYS_MS[attempt - 1]);
    }

    let result: ProofApiBroadcastAttempt | null = null;
    try {
      result = await postRawTransactionToProofApi(rawTx, ownerNetwork);
    } catch (error) {
      lastMessage = errorMessage(error, "Node broadcast request failed.");
    }

    if (result?.ok && result.txid) {
      return {
        opReturnCount,
        source:
          result.payload?.source === "mempool" ||
          result.payload?.source === "node" ||
          result.payload?.source === "slipstream" ||
          result.payload?.source === "wallet"
            ? result.payload.source
            : "node",
        txid: result.txid,
        url:
          typeof result.payload?.url === "string"
            ? result.payload.url
            : explorerTxUrl(result.txid, ownerNetwork),
      };
    }

    const status = result?.status ?? 0;
    if (result) {
      lastMessage = proofApiBroadcastErrorMessage(
        result.payload,
        result.responseText,
        result.status,
      );
    }

    const knownAccepted = isKnownAcceptedBroadcastMessage(lastMessage);
    if (localTxid && knownAccepted) {
      return {
        opReturnCount,
        source: "node",
        txid: localTxid,
        url: explorerTxUrl(localTxid, ownerNetwork),
      };
    }

    const transient = isTransientProofApiBroadcastFailure(status, lastMessage);
    if (localTxid && transient) {
      const recovered = await recoverBroadcastTxidFromStatus(
        localTxid,
        ownerNetwork,
      );
      if (recovered) {
        return {
          opReturnCount,
          source: "node",
          txid: localTxid,
          url: explorerTxUrl(localTxid, ownerNetwork),
        };
      }
    }

    if (!transient || attempt >= PROOF_API_BROADCAST_RETRY_DELAYS_MS.length) {
      throw new Error(lastMessage);
    }
  }

  throw new Error(lastMessage);
}

async function broadcastSignedRawTransaction(
  rawTx: string,
  ownerNetwork: BitcoinNetwork,
  strategy: BroadcastStrategy = "mempool",
) {
  const opReturnCount = countOpReturnOutputs(rawTx, ownerNetwork);
  if (
    strategy === "first-party-if-multiple-op-return" &&
    opReturnCount > 1
  ) {
    const result = await broadcastRawTransactionViaProofApi(
      rawTx,
      ownerNetwork,
    );
    return { ...result, opReturnCount };
  }

  const result = await broadcastRawTransaction(rawTx, ownerNetwork);
  return { ...result, opReturnCount };
}

async function signAndBroadcastPsbtDetailed({
  broadcastStrategy = "mempool",
  inputCount,
  network,
  psbtHex,
  signInputIndexes,
  signingAddress,
  wallet,
}: {
  broadcastStrategy?: BroadcastStrategy;
  inputCount: number;
  network: BitcoinNetwork;
  psbtHex: string;
  signInputIndexes?: number[];
  signingAddress?: string;
  wallet: UnisatWallet;
}): Promise<TransactionBroadcastResult> {
  if (!wallet.signPsbt) {
    throw new Error(
      "UniSat signPsbt is not available. Update UniSat or use a wallet that can sign PSBTs.",
    );
  }

  let signedPsbtHex = "";
  const requestedSignInputs = signInputIndexes?.map((index) => ({
    address: signingAddress,
    index,
  }));
  try {
    signedPsbtHex = await wallet.signPsbt(
      psbtHex,
      requestedSignInputs
        ? {
            autoFinalized: true,
            toSignInputs: requestedSignInputs,
          }
        : {
            autoFinalized: true,
          },
    );
  } catch (error) {
    const signFailure = errorMessage(error, "");
    if (
      !/(tosigninput|sign input|matched|current address)/i.test(signFailure)
    ) {
      throw error;
    }

    const publicKey = await wallet.getPublicKey?.().catch(() => "");
    if (!publicKey) {
      throw error;
    }

    signedPsbtHex = await wallet.signPsbt(psbtHex, {
      autoFinalized: true,
      toSignInputs: (
        signInputIndexes ??
        Array.from({ length: inputCount }, (_, index) => index)
      ).map((index) => ({
        index,
        publicKey,
      })),
    });
  }

  let rawTx = "";
  try {
    const signedPsbt = bitcoin.Psbt.fromHex(signedPsbtHex, {
      network: bitcoinNetwork(network),
    });
    rawTx = signedPsbt.extractTransaction().toHex();
  } catch (error) {
    if (wallet.pushPsbt) {
      const txid = normalizeBroadcastTxid(await wallet.pushPsbt(signedPsbtHex));
      if (!txid) {
        throw new Error("Wallet broadcast did not return a valid txid.");
      }

      return {
        opReturnCount: 0,
        source: "wallet",
        txid,
      };
    }

    throw error;
  }

  return broadcastSignedRawTransaction(rawTx, network, broadcastStrategy);
}

async function signAndBroadcastPsbt(
  args: Parameters<typeof signAndBroadcastPsbtDetailed>[0],
) {
  const result = await signAndBroadcastPsbtDetailed(args);
  return result.txid;
}

export default function App() {
  const idLaunchMode = isIdLaunchRoute();
  const landingMode = isLandingRoute();
  const desktopRoute = isDesktopRoute();
  const browserRoute = isBrowserRoute();
  const marketplaceMode = isMarketplaceRoute();
  const tokenMode = isTokenRoute();
  const walletMode = isWalletRoute();
  const workTokenMode = isWorkTokenRoute();
  const rushMode = isRushRoute();
  const activityMode = isActivityRoute();
  const growthMode = isGrowthRoute();
  const mainnetRegistryMode =
    idLaunchMode ||
    marketplaceMode ||
    tokenMode ||
    walletMode ||
    workTokenMode ||
    activityMode ||
    growthMode;
  const [hasUnisat, setHasUnisat] = useState(() => Boolean(window.unisat));
  const [network, setNetwork] = useState<BitcoinNetwork>("livenet");
  const [address, setAddress] = useState("");
  const [recipient, setRecipient] = useState("");
  const [ccRecipient, setCcRecipient] = useState("");
  const [amountSats, setAmountSats] = useState(DEFAULT_AMOUNT_SATS);
  const [feeRate, setFeeRate] = useState(DEFAULT_FEE_RATE);
  const [subject, setSubject] = useState("");
  const [memo, setMemo] = useState(DEFAULT_MEMO);
  const [attachment, setAttachment] = useState<MailAttachment | undefined>();
  const [allSent, setAllSent] = useState<SentMessage[]>(() =>
    loadSentMessages(),
  );
  const [chainSent, setChainSent] = useState<SentMessage[]>([]);
  const [idRegistry, setIdRegistry] = useState<PowIdRecord[]>([]);
  const [idListings, setIdListings] = useState<PowIdListing[]>([]);
  const [idPendingEvents, setIdPendingEvents] = useState<PowIdPendingEvent[]>(
    [],
  );
  const [idSales, setIdSales] = useState<PowIdMarketplaceSale[]>([]);
  const [idActivity, setIdActivity] = useState<PowActivityItem[]>([]);
  const [lastRegisteredId, setLastRegisteredId] = useState<
    PowIdRecord | undefined
  >();
  const [idName, setIdName] = useState("");
  const [idReceiveAddress, setIdReceiveAddress] = useState("");
  const [idPgpKey, setIdPgpKey] = useState("");
  const [managedIdName, setManagedIdName] = useState("");
  const [idUpdateReceiveAddress, setIdUpdateReceiveAddress] = useState("");
  const [idTransferOwnerAddress, setIdTransferOwnerAddress] = useState("");
  const [idTransferReceiveAddress, setIdTransferReceiveAddress] = useState("");
  const [idSalePriceSats, setIdSalePriceSats] = useState(1000);
  const [idSaleBuyerAddress, setIdSaleBuyerAddress] = useState("");
  const [idSaleReceiveAddress, setIdSaleReceiveAddress] = useState("");
  const [idSaleAuthorization, setIdSaleAuthorization] = useState("");
  const [idSelectedListingId, setIdSelectedListingId] = useState("");
  const [idPurchaseOwnerAddress, setIdPurchaseOwnerAddress] = useState("");
  const [idPurchaseReceiveAddress, setIdPurchaseReceiveAddress] = useState("");
  const [tokenDefinitions, setTokenDefinitions] = useState<
    PowTokenDefinition[]
  >([]);
  const [tokenMints, setTokenMints] = useState<PowTokenMint[]>([]);
  const [tokenTransfers, setTokenTransfers] = useState<PowTokenTransfer[]>([]);
  const [tokenListings, setTokenListings] = useState<PowTokenListing[]>([]);
  const [tokenClosedListings, setTokenClosedListings] = useState<
    PowTokenClosedListing[]
  >([]);
  const [tokenSales, setTokenSales] = useState<PowTokenSale[]>([]);
  const [purchaseReceipt, setPurchaseReceipt] = useState<
    MarketplacePurchaseReceipt | undefined
  >();
  const [tokenCreationSats, setTokenCreationSats] = useState(0);
  const [tokenSelectedId, setTokenSelectedId] = useState(() =>
    workTokenMode ? WORK_TOKEN_TICKER : tokenRouteTarget(),
  );
  const [tokenDetailTarget, setTokenDetailTarget] = useState(() =>
    workTokenMode ? WORK_TOKEN_TICKER : tokenRouteTarget(),
  );
  const [tokenCreateTicker, setTokenCreateTicker] = useState("");
  const [tokenCreateMaxSupply, setTokenCreateMaxSupply] = useState(0);
  const [tokenCreateMintAmount, setTokenCreateMintAmount] = useState(0);
  const [tokenCreateMintPriceSats, setTokenCreateMintPriceSats] = useState(0);
  const [tokenCreateRegistryAddress, setTokenCreateRegistryAddress] =
    useState("");
  const [tokenTransferTokenId, setTokenTransferTokenId] = useState("");
  const [tokenTransferAmount, setTokenTransferAmount] = useState(
    WORK_TOKEN_MINT_AMOUNT,
  );
  const [tokenTransferRecipient, setTokenTransferRecipient] = useState("");
  const [tokenListAmount, setTokenListAmount] = useState(WORK_TOKEN_MINT_AMOUNT);
  const [tokenListBuyerAddress, setTokenListBuyerAddress] = useState("");
  const [tokenListPriceSats, setTokenListPriceSats] = useState(1000);
  const [tokenBtcUsd, setTokenBtcUsd] = useState(0);
  const [workFloorQuote, setWorkFloorQuote] = useState<
    WorkFloorQuote | undefined
  >();
  const [growthSummary, setGrowthSummary] = useState<
    GrowthSummarySnapshot | undefined
  >();
  const [workFloorLoading, setWorkFloorLoading] = useState(false);
  const [tokenPrepareMintCount, setTokenPrepareMintCount] = useState(
    TOKEN_PREPARE_DEFAULT_MINT_COUNT,
  );
  const [tokenPrepareFeeReserveSats, setTokenPrepareFeeReserveSats] = useState(
    TOKEN_PREPARE_DEFAULT_FEE_RESERVE_SATS,
  );
  const [tokenPrepareFeeRate, setTokenPrepareFeeRate] =
    useState(DEFAULT_FEE_RATE);
  const [tokenMintAssistantTarget, setTokenMintAssistantTarget] = useState(
    TOKEN_MINT_ASSISTANT_DEFAULT_COUNT,
  );
  const [tokenMintAssistantDelayMs, setTokenMintAssistantDelayMs] = useState(
    TOKEN_MINT_ASSISTANT_DEFAULT_DELAY_MS,
  );
  const [tokenMintAssistantCompleted, setTokenMintAssistantCompleted] =
    useState(0);
  const [tokenMintAssistantRemaining, setTokenMintAssistantRemaining] =
    useState(0);
  const [tokenMintAssistantRunning, setTokenMintAssistantRunning] =
    useState(false);
  const [rushState, setRushState] = useState<RushState>(() => emptyRushState());
  const [rushMintCount, setRushMintCount] = useState(
    RUSH_CHAINED_MINT_DEFAULT_COUNT,
  );
  const [rushMintDelayMs, setRushMintDelayMs] = useState(
    RUSH_CHAINED_MINT_DEFAULT_DELAY_MS,
  );
  const [rushMinting, setRushMinting] = useState(false);
  const [tokenAction, setTokenAction] = useState<
    "" | "buy" | "create" | "delist" | "list" | "mint" | "seal" | "split" | "transfer"
  >("");
  const [mailPreferences, setMailPreferences] = useState<MailPreferences>(() =>
    loadMailPreferences(),
  );
  const [contacts, setContacts] = useState<ContactRecord[]>(() =>
    loadContacts(),
  );
  const [customFolders, setCustomFolders] = useState<CustomFolderRecord[]>(() =>
    loadCustomFolders(),
  );
  const [newFolderName, setNewFolderName] = useState("");
  const [desktopQuery, setDesktopQuery] = useState("");
  const [desktopProfile, setDesktopProfile] = useState<
    DesktopProfile | undefined
  >();
  const [desktopMail, setDesktopMail] = useState<MailMessage[]>([]);
  const [desktopSelectedKey, setDesktopSelectedKey] = useState("");
  const [activityQuery, setActivityQuery] = useState("");
  const [activityProfile, setActivityProfile] = useState<
    DesktopProfile | undefined
  >();
  const [activityMail, setActivityMail] = useState<PowActivityItem[]>([]);
  const [activityStats, setActivityStats] = useState<
    PowActivityStats | undefined
  >();
  const [activityHistoryPage, setActivityHistoryPage] = useState<
    PowPaginatedApiResponse<PowActivityItem> | undefined
  >();
  const [activityLoading, setActivityLoading] = useState(false);
  const [desktopLoading, setDesktopLoading] = useState(false);
  const [savedDraft, setSavedDraft] = useState<DraftMessage | undefined>();
  const [inbox, setInbox] = useState<InboxMessage[]>([]);
  const [activeFolder, setActiveFolder] = useState<Folder>(() => {
    const queryFolder =
      !landingMode &&
      !idLaunchMode &&
      !desktopRoute &&
      !browserRoute &&
      !marketplaceMode &&
      !tokenMode &&
      !walletMode &&
      !workTokenMode &&
      !rushMode &&
      !activityMode &&
      !growthMode
        ? computerFolderFromSearch()
        : undefined;

    return (
      queryFolder ??
      (desktopRoute
        ? "desktop"
        : browserRoute
          ? "browser"
          : marketplaceMode
            ? "marketplace"
            : tokenMode
              ? "token"
                : walletMode
                  ? "wallet"
                  : workTokenMode
                    ? "work"
                    : activityMode
                      ? "log"
                      : mainnetRegistryMode
                        ? "ids"
                        : "inbox")
    );
  });
  const [activeCustomFolderId, setActiveCustomFolderId] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("value");
  const [fileFilter, setFileFilter] = useState<FileFilter>("all");
  const [selectedKey, setSelectedKey] = useState("");
  const [composeOpen, setComposeOpen] = useState(true);
  const [replyParentTxid, setReplyParentTxid] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: StatusTone; text: string }>({
    tone: "idle",
    text: "Ready",
  });
  const [refreshing, setRefreshing] = useState(false);
  const [checkingBroadcasts, setCheckingBroadcasts] = useState(false);
  const allSentRef = useRef(allSent);
  const chainSentRef = useRef(chainSent);
  const idRefreshInFlightRef =
    useRef<Promise<PowRegistryState | undefined> | null>(null);
  const idRefreshInFlightFreshRef = useRef(false);
  const tokenRefreshInFlightRef =
    useRef<Promise<PowTokenState | undefined> | null>(null);
  const tokenRefreshInFlightFreshRef = useRef(false);
  const marketplaceSummaryRefreshInFlightRef =
    useRef<Promise<MarketplaceSummarySnapshot | undefined> | null>(null);
  const marketplaceSummaryRefreshInFlightFreshRef = useRef(false);
  const growthRefreshInFlightRef = useRef(false);
  const workFloorRefreshInFlightRef =
    useRef<Promise<WorkFloorQuote | undefined> | null>(null);
  const workFloorRefreshInFlightFreshRef = useRef(false);
  const tokenMintAssistantActiveRef = useRef(false);
  const tokenMintAssistantTimerRef = useRef<number | undefined>(undefined);
  const rushMintActiveRef = useRef(false);
  const activityHistoryPageRef =
    useRef<PowPaginatedApiResponse<PowActivityItem> | undefined>(undefined);
  const activityProfileRef = useRef<DesktopProfile | undefined>(undefined);
  const backupInputRef = useRef<HTMLInputElement>(null);

  const protocolPayloads = useMemo(
    () => buildProtocolPayloads(subject, memo, replyParentTxid, attachment),
    [attachment, memo, replyParentTxid, subject],
  );
  const dataCarrierBytes = useMemo(
    () => dataCarrierBytesForPayloads(protocolPayloads),
    [protocolPayloads],
  );
  const archivedKeys = useMemo(
    () =>
      new Set(
        Object.entries(mailPreferences)
          .filter(([, preference]) => preference.archived)
          .map(([key]) => key),
      ),
    [mailPreferences],
  );
  const favoriteKeys = useMemo(
    () =>
      new Set(
        Object.entries(mailPreferences)
          .filter(([, preference]) => preference.favorite)
          .map(([key]) => key),
      ),
    [mailPreferences],
  );
  const contactsForNetwork = useMemo(
    () => contacts.filter((contact) => contact.network === network),
    [contacts, network],
  );
  const inboxMailAll = useMemo<MailMessage[]>(
    () =>
      inbox
        .filter((message) => message.confirmed)
        .map((message) => ({ ...message, folder: "inbox" })),
    [inbox],
  );
  const incomingMailAll = useMemo<MailMessage[]>(
    () =>
      inbox
        .filter((message) => !message.confirmed)
        .map((message) => ({ ...message, folder: "incoming" })),
    [inbox],
  );
  const sentForAccount = useMemo(
    () =>
      address
        ? mergeSentMessages([
            ...allSent.filter(
              (message) =>
                message.from === address && message.network === network,
            ),
            ...chainSent.filter(
              (message) =>
                message.from === address && message.network === network,
            ),
          ])
        : [],
    [address, allSent, chainSent, network],
  );
  const sentMailAll = useMemo<Array<SentMessage & { folder: "sent" }>>(
    () => sentForAccount.map((message) => ({ ...message, folder: "sent" })),
    [sentForAccount],
  );
  const visibleSentMailAll = useMemo(
    () =>
      sentMailAll.filter((message) =>
        isVisibleSentStatus(sentDeliveryStatus(message)),
      ),
    [sentMailAll],
  );
  const outboxMailAll = useMemo(
    () =>
      sentMailAll.filter((message) =>
        isOutboxStatus(sentDeliveryStatus(message)),
      ),
    [sentMailAll],
  );
  const allMail = useMemo(
    () => [...inboxMailAll, ...visibleSentMailAll],
    [inboxMailAll, visibleSentMailAll],
  );
  const threadMail = useMemo(
    () => [...incomingMailAll, ...allMail, ...outboxMailAll],
    [allMail, incomingMailAll, outboxMailAll],
  );
  const inboxMail = useMemo(
    () => inboxMailAll.filter((message) => !archivedKeys.has(mailKey(message))),
    [archivedKeys, inboxMailAll],
  );
  const incomingMail = useMemo(() => incomingMailAll, [incomingMailAll]);
  const sentMail = useMemo(
    () =>
      visibleSentMailAll.filter(
        (message) => !archivedKeys.has(mailKey(message)),
      ),
    [archivedKeys, visibleSentMailAll],
  );
  const outboxMail = useMemo(
    () =>
      outboxMailAll.filter((message) => !archivedKeys.has(mailKey(message))),
    [archivedKeys, outboxMailAll],
  );
  const favoritesMail = useMemo(
    () => allMail.filter((message) => favoriteKeys.has(mailKey(message))),
    [allMail, favoriteKeys],
  );
  const archiveMail = useMemo(
    () => allMail.filter((message) => archivedKeys.has(mailKey(message))),
    [allMail, archivedKeys],
  );
  const activeCustomFolder = useMemo(
    () => customFolders.find((folder) => folder.id === activeCustomFolderId),
    [activeCustomFolderId, customFolders],
  );
  const customFolderMail = useMemo(
    () =>
      activeCustomFolderId
        ? allMail.filter((message) =>
            mailPreferences[mailKey(message)]?.folders?.includes(
              activeCustomFolderId,
            ),
          )
        : [],
    [activeCustomFolderId, allMail, mailPreferences],
  );
  const customFolderCounts = useMemo(
    () =>
      new Map(
        customFolders.map((folder) => [
          folder.id,
          allMail.filter((message) =>
            mailPreferences[mailKey(message)]?.folders?.includes(folder.id),
          ).length,
        ]),
      ),
    [allMail, customFolders, mailPreferences],
  );
  const allFileMessages = useMemo(
    () =>
      withCanonicalWelcomeFile(
        fileSurfaceMessages(
          allMail.filter(
            (message) => message.folder !== "inbox" || message.confirmed,
          ),
        ),
        network,
      ),
    [allMail, network],
  );
  const desktopFileMessages = useMemo(
    () => desktopMail.filter(hasAttachment),
    [desktopMail],
  );
  const fileMessages = useMemo(
    () =>
      allFileMessages.filter(
        (message) =>
          message.attachment &&
          (fileFilter === "all" ||
            fileKindForMessage(message) === fileFilter),
      ),
    [allFileMessages, fileFilter],
  );
  const activeMessages = useMemo(
    () =>
      sortMessages(
        activeFolder === "inbox"
          ? inboxMail
          : activeFolder === "incoming"
            ? incomingMail
            : activeFolder === "sent"
              ? sentMail
              : activeFolder === "outbox"
                ? outboxMail
                : activeFolder === "favorites"
                  ? favoritesMail
                  : activeFolder === "archive"
                    ? archiveMail
                    : activeFolder === "files"
                      ? fileMessages
                      : activeFolder === "custom"
                        ? customFolderMail
                        : [],
        sortMode,
      ),
    [
      activeFolder,
      archiveMail,
      customFolderMail,
      favoritesMail,
      fileMessages,
      inboxMail,
      incomingMail,
      outboxMail,
      sentMail,
      sortMode,
    ],
  );
  const selectedMessage =
    activeMessages.find((message) => mailKey(message) === selectedKey) ??
    activeMessages[0];
  const threadMessages = selectedMessage
    ? sortMessages(
        threadMail.filter(
          (message) => rootTxid(message) === rootTxid(selectedMessage),
        ),
        "oldest",
      )
    : [];
  const registryAddress = registryAddressForNetwork(network);
  const recipientResolution = useMemo(
    () =>
      resolveRecipientInputs(recipient, network, idRegistry, registryAddress),
    [idRegistry, network, recipient, registryAddress],
  );
  const ccRecipientResolution = useMemo(
    () =>
      resolveRecipientInputs(ccRecipient, network, idRegistry, registryAddress),
    [ccRecipient, idRegistry, network, registryAddress],
  );
  const recipientNote = recipient.trim()
    ? recipientResolutionNote(recipientResolution)
    : "";
  const ccRecipientNote = ccRecipient.trim()
    ? recipientResolutionNote(ccRecipientResolution)
    : "";
  const totalResolvedRecipients =
    recipientResolution.recipients.length +
    ccRecipientResolution.recipients.length;
  const canSend =
    Boolean(
      address &&
      recipient.trim() &&
      amountSats > 0 &&
      Number.isFinite(feeRate) &&
      feeRate >= 0 &&
      (subject.trim() || memo.trim() || attachment),
    ) &&
    recipientResolution.recipients.length > 0 &&
    totalResolvedRecipients <= MAX_RECIPIENTS &&
    !recipientResolution.error &&
    !ccRecipientResolution.error &&
    dataCarrierBytes <= MAX_DATA_CARRIER_BYTES &&
    !busy;
  const normalizedIdName = normalizePowId(idName);
  const idRegistrationPayload = useMemo(
    () =>
      address && idReceiveAddress && normalizedIdName
        ? buildIdRegistrationPayload(
            normalizedIdName,
            address,
            idReceiveAddress.trim(),
            idPgpKey,
          )
        : "",
    [address, idPgpKey, idReceiveAddress, normalizedIdName],
  );
  const idRegistrationBytes = useMemo(
    () =>
      idRegistrationPayload
        ? dataCarrierBytesForPayload(idRegistrationPayload)
        : 0,
    [idRegistrationPayload],
  );
  const ownedIdCount = useMemo(
    () => ownedPowIds(idRegistry, address).length,
    [address, idRegistry],
  );
  const confirmedIdCount = useMemo(
    () => idRegistry.filter((record) => record.confirmed).length,
    [idRegistry],
  );
  const pendingIdCount = idRegistry.length - confirmedIdCount;
  const pendingIdEventCount = useMemo(
    () => idPendingEvents.filter((event) => event.network === network).length,
    [idPendingEvents, network],
  );
  const walletPendingIdEvents = useMemo(
    () =>
      idPendingEvents.filter(
        (event) =>
          event.network === network &&
          pendingIdEventTouchesAddress(event, address),
      ),
    [address, idPendingEvents, network],
  );
  const existingIdRegistration = useMemo(
    () =>
      idRegistry.find(
        (record) =>
          record.network === network && record.id === normalizedIdName,
      ),
    [idRegistry, network, normalizedIdName],
  );
  const canRegisterId =
    Boolean(
      address &&
      registryAddress &&
      idRegistrationPayload &&
      !powIdError(normalizedIdName) &&
      isValidBitcoinAddress(idReceiveAddress.trim(), network),
    ) &&
    idRegistrationBytes <= MAX_DATA_CARRIER_BYTES &&
    !existingIdRegistration &&
    !busy;
  const ownerControlledIds = useMemo(
    () =>
      idRegistry.filter(
        (record) =>
          record.network === network &&
          record.confirmed &&
          record.ownerAddress === address,
      ),
    [address, idRegistry, network],
  );
  const managedIdRecord = useMemo(
    () =>
      ownerControlledIds.find((record) => record.id === managedIdName) ??
      ownerControlledIds[0],
    [managedIdName, ownerControlledIds],
  );
  const receiverUpdateResolution = useMemo(
    () =>
      resolveRecipientInput(
        idUpdateReceiveAddress,
        network,
        idRegistry,
        registryAddress,
      ),
    [idRegistry, idUpdateReceiveAddress, network, registryAddress],
  );
  const idReceiverUpdatePayload = useMemo(
    () =>
      managedIdRecord && receiverUpdateResolution.paymentAddress
        ? buildIdReceiverUpdatePayload(
            managedIdRecord.id,
            receiverUpdateResolution.paymentAddress,
          )
        : "",
    [managedIdRecord, receiverUpdateResolution.paymentAddress],
  );
  const transferOwnerResolution = useMemo(
    () =>
      resolvePowIdOwnerInput(
        idTransferOwnerAddress,
        network,
        idRegistry,
        registryAddress,
      ),
    [idRegistry, idTransferOwnerAddress, network, registryAddress],
  );
  const transferReceiveAddress = idTransferReceiveAddress.trim();
  const transferReceiveResolution = useMemo(
    () =>
      transferReceiveAddress
        ? resolveRecipientInput(
            transferReceiveAddress,
            network,
            idRegistry,
            registryAddress,
          )
        : undefined,
    [idRegistry, network, registryAddress, transferReceiveAddress],
  );
  const effectiveTransferReceiveAddress = transferReceiveResolution
    ? transferReceiveResolution.paymentAddress
    : transferOwnerResolution.receiveAddress;
  const transferPayloadReceiveAddress =
    effectiveTransferReceiveAddress &&
    effectiveTransferReceiveAddress !== transferOwnerResolution.ownerAddress
      ? effectiveTransferReceiveAddress
      : "";
  const idTransferPayload = useMemo(
    () =>
      managedIdRecord && transferOwnerResolution.ownerAddress
        ? buildIdTransferPayload(
            managedIdRecord.id,
            transferOwnerResolution.ownerAddress,
            transferPayloadReceiveAddress,
          )
        : "",
    [
      managedIdRecord,
      transferOwnerResolution.ownerAddress,
      transferPayloadReceiveAddress,
    ],
  );
  const parsedSaleAuthorization = useMemo(() => {
    const trimmed = idSaleAuthorization.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      return parseSaleAuthorizationText(trimmed, network);
    } catch {
      return undefined;
    }
  }, [idSaleAuthorization, network]);
  const selectedMarketplaceListing = useMemo(
    () =>
      idListings.find(
        (listing) =>
          listing.listingId === idSelectedListingId &&
          listing.network === network,
      ),
    [idListings, idSelectedListingId, network],
  );
  const tokenIndexAddress = tokenIndexAddressForNetwork(network);
  const normalizedTokenTicker = normalizeTokenTicker(tokenCreateTicker);
  const tokenTickerReservationMessage = tokenTickerReservationError(
    normalizedTokenTicker,
  );
  const tokenRegistryRecords = useMemo(() => {
    if (network !== "livenet") {
      return idRegistry;
    }

    return idRegistry.some(
      (record) =>
        record.network === "livenet" &&
        record.id === WORK_TOKEN_REGISTRY_RECORD.id &&
        record.confirmed,
    )
      ? idRegistry
      : [WORK_TOKEN_REGISTRY_RECORD, ...idRegistry];
  }, [idRegistry, network]);
  const tokenRegistryResolution = useMemo(
    () =>
      resolveRecipientInput(
        tokenCreateRegistryAddress,
        network,
        tokenRegistryRecords,
        registryAddress,
      ),
    [
      network,
      registryAddress,
      tokenCreateRegistryAddress,
      tokenRegistryRecords,
    ],
  );
  const tokenResolvedRegistryAddress = tokenRegistryResolution.paymentAddress;
  const tokenCreatePayload = useMemo(
    () =>
      normalizedTokenTicker &&
      !tokenTickerReservationMessage &&
      Number.isSafeInteger(Math.floor(tokenCreateMaxSupply)) &&
      Math.floor(tokenCreateMaxSupply) >= 1 &&
      Number.isSafeInteger(Math.floor(tokenCreateMintAmount)) &&
      Math.floor(tokenCreateMintAmount) >= 1 &&
      Math.floor(tokenCreateMintAmount) <= Math.floor(tokenCreateMaxSupply) &&
      Number.isSafeInteger(Math.floor(tokenCreateMintPriceSats)) &&
      Math.floor(tokenCreateMintPriceSats) >= TOKEN_MIN_MUTATION_PRICE_SATS &&
      tokenResolvedRegistryAddress
        ? buildTokenCreatePayload({
            maxSupply: tokenCreateMaxSupply,
            mintAmount: tokenCreateMintAmount,
            mintPriceSats: tokenCreateMintPriceSats,
            registryAddress: tokenResolvedRegistryAddress,
            ticker: normalizedTokenTicker,
          })
        : "",
    [
      normalizedTokenTicker,
      tokenTickerReservationMessage,
      tokenCreateMaxSupply,
      tokenCreateMintAmount,
      tokenCreateMintPriceSats,
      tokenResolvedRegistryAddress,
    ],
  );
  const tokenCreateBytes = useMemo(
    () =>
      tokenCreatePayload ? dataCarrierBytesForPayload(tokenCreatePayload) : 0,
    [tokenCreatePayload],
  );
  const orderedTokenDefinitions = useMemo(
    () =>
      tokenDefinitions
        .filter((token) =>
          tokenCreationIsAllowed({
            creatorAddress: token.creatorAddress,
            ticker: token.ticker,
            tokenId: token.tokenId,
          }),
        )
        .sort(compareTokensByConfirmation),
    [tokenDefinitions],
  );
  const dashboardTokenDefinitions = useMemo(() => {
    if (!workTokenMode && activeFolder !== "work") {
      return orderedTokenDefinitions;
    }

    const hasWork = orderedTokenDefinitions.some(
      (token) =>
        token.tokenId === WORK_TOKEN_ID || token.ticker === WORK_TOKEN_TICKER,
    );
    return hasWork
      ? orderedTokenDefinitions
      : [WORK_TOKEN_DEFINITION, ...orderedTokenDefinitions];
  }, [activeFolder, orderedTokenDefinitions, workTokenMode]);
  const effectiveTokenDetailTarget =
    workTokenMode || activeFolder === "work"
      ? WORK_TOKEN_TICKER
      : tokenDetailTarget;
  const selectedToken = useMemo(
    () => {
      const effectiveTokenSelection =
        workTokenMode || activeFolder === "work"
          ? WORK_TOKEN_TICKER
          : tokenSelectedId;
      const selectedTicker = normalizeTokenTicker(effectiveTokenSelection);
      return (
        dashboardTokenDefinitions.find(
          (token) =>
            token.tokenId === effectiveTokenSelection ||
            (selectedTicker && token.ticker === selectedTicker),
        ) ??
        dashboardTokenDefinitions.find(
          (token) => token.ticker === WORK_TOKEN_TICKER,
        ) ??
        dashboardTokenDefinitions[0]
      );
    },
    [activeFolder, dashboardTokenDefinitions, tokenSelectedId, workTokenMode],
  );
  const tokenDetailToken = useMemo(() => {
    const detailTicker = normalizeTokenTicker(effectiveTokenDetailTarget);
    return (
      dashboardTokenDefinitions.find(
        (token) =>
          token.tokenId === effectiveTokenDetailTarget ||
          (detailTicker && token.ticker === detailTicker),
      ) ?? undefined
    );
  }, [dashboardTokenDefinitions, effectiveTokenDetailTarget]);
  const tokenRouteShowsWorkFloor =
    tokenMode &&
    (effectiveTokenDetailTarget === WORK_TOKEN_ID ||
      normalizeTokenTicker(effectiveTokenDetailTarget) === WORK_TOKEN_TICKER);
  const tokenDetailLedger = useMemo(
    () => tokenLedgerFor(tokenDetailToken, tokenMints, tokenTransfers, tokenSales),
    [tokenDetailToken, tokenMints, tokenSales, tokenTransfers],
  );
  const workTokenDefinition = useMemo(
    () =>
      orderedTokenDefinitions.find(
        (token) => token.ticker === WORK_TOKEN_TICKER,
      ) ??
      dashboardTokenDefinitions.find(
        (token) => token.ticker === WORK_TOKEN_TICKER,
      ),
    [dashboardTokenDefinitions, orderedTokenDefinitions],
  );
  const workTokenLedger = useMemo(
    () =>
      tokenLedgerFor(workTokenDefinition, tokenMints, tokenTransfers, tokenSales),
    [tokenMints, tokenSales, tokenTransfers, workTokenDefinition],
  );
  const selectedTokenLedger = useMemo(
    () => tokenLedgerFor(selectedToken, tokenMints, tokenTransfers, tokenSales),
    [selectedToken, tokenMints, tokenSales, tokenTransfers],
  );
  const tokenWalletBalances = useMemo(
    () =>
      tokenWalletBalancesFor(
        address,
        dashboardTokenDefinitions,
        tokenMints,
        tokenTransfers,
        tokenSales,
      ),
    [address, dashboardTokenDefinitions, tokenMints, tokenSales, tokenTransfers],
  );
  const walletTransferToken =
    tokenWalletBalances.find(
      (item) => item.token.tokenId === tokenTransferTokenId,
    )?.token ??
    tokenWalletBalances[0]?.token ??
    (!address ? workTokenDefinition ?? WORK_TOKEN_DEFINITION : undefined);
  const walletTransferBalance =
    tokenWalletBalances.find(
      (item) => item.token.tokenId === walletTransferToken?.tokenId,
    )?.confirmedBalance ?? 0;
  const walletReservedTokenBalance = walletTransferToken
    ? tokenReservedBalanceFor(tokenListings, walletTransferToken.tokenId, address)
    : 0;
  const walletSpendableTokenBalance = Math.max(
    0,
    walletTransferBalance - walletReservedTokenBalance,
  );
  const tokenMintPayload = useMemo(
    () =>
      selectedToken
        ? buildTokenMintPayload(selectedToken.tokenId, selectedToken.mintAmount)
        : "",
    [selectedToken],
  );
  const tokenMintBytes = useMemo(
    () =>
      tokenMintPayload ? dataCarrierBytesForPayload(tokenMintPayload) : 0,
    [tokenMintPayload],
  );
  const tokenTransferPayload = useMemo(
    () =>
      walletTransferToken && tokenTransferRecipient.trim()
        ? buildTokenSendPayload(
            walletTransferToken.tokenId,
            tokenTransferAmount,
            tokenTransferRecipient.trim(),
          )
        : "",
    [tokenTransferAmount, tokenTransferRecipient, walletTransferToken],
  );
  const tokenTransferBytes = useMemo(
    () =>
      tokenTransferPayload
        ? dataCarrierBytesForPayload(tokenTransferPayload)
        : 0,
    [tokenTransferPayload],
  );
  const normalizedTokenListAmount = Number.isFinite(tokenListAmount)
    ? Math.floor(tokenListAmount)
    : 0;
  const normalizedTokenListPriceSats = Number.isFinite(tokenListPriceSats)
    ? Math.floor(tokenListPriceSats)
    : 0;
  const canListToken =
    Boolean(
      address &&
        walletTransferToken &&
        normalizedTokenListAmount >= 1 &&
        normalizedTokenListAmount <= walletSpendableTokenBalance &&
        normalizedTokenListPriceSats >= 1 &&
        (!tokenListBuyerAddress.trim() ||
          isValidBitcoinAddress(tokenListBuyerAddress.trim(), "livenet")),
    ) &&
    !busy &&
    network === "livenet";
  const selectedTokenSupplyState = tokenMintSupplyState(
    selectedToken,
    selectedTokenLedger.confirmedSupply,
    selectedTokenLedger.pendingSupply,
  );
  const selectedTokenMintedOut = selectedTokenSupplyState.mintedOut;
  const selectedTokenPendingMintOut = selectedTokenSupplyState.pendingMintOut;
  const selectedTokenMintWouldOverfill = selectedTokenSupplyState.wouldOverfill;
  const tokenPrepareMintCountValue = Number.isFinite(tokenPrepareMintCount)
    ? Math.floor(tokenPrepareMintCount)
    : 0;
  const tokenPrepareFeeReserveValue = Number.isFinite(
    tokenPrepareFeeReserveSats,
  )
    ? Math.floor(tokenPrepareFeeReserveSats)
    : 0;
  const tokenPrepareFeeRateValue =
    Number.isFinite(tokenPrepareFeeRate) && tokenPrepareFeeRate > 0
      ? tokenPrepareFeeRate
      : DEFAULT_FEE_RATE;
  const tokenPrepareOutputSats = selectedToken
    ? Math.max(
        DUST_SATS,
        selectedToken.mintPriceSats + Math.max(0, tokenPrepareFeeReserveValue),
      )
    : 0;
  const canMintToken =
    Boolean(
      address &&
      network === "livenet" &&
      selectedToken &&
      tokenMintPayload &&
      selectedToken.registryAddress,
    ) &&
    !selectedTokenMintedOut &&
    !selectedTokenPendingMintOut &&
    !selectedTokenMintWouldOverfill &&
    tokenMintBytes <= MAX_DATA_CARRIER_BYTES &&
    !busy;
  const canTransferToken =
    Boolean(
      address &&
      network === "livenet" &&
      walletTransferToken &&
      walletTransferToken.registryAddress &&
      tokenTransferPayload &&
      isValidBitcoinAddress(tokenTransferRecipient.trim(), "livenet") &&
      Number.isSafeInteger(Math.floor(tokenTransferAmount)) &&
      Math.floor(tokenTransferAmount) >= 1 &&
      Math.floor(tokenTransferAmount) <= walletSpendableTokenBalance,
    ) &&
    tokenTransferBytes <= MAX_DATA_CARRIER_BYTES &&
    !busy;
  const canPrepareTokenMintUtxos =
    Boolean(
      address &&
      network === "livenet" &&
      selectedToken &&
      !selectedTokenMintedOut &&
      !selectedTokenPendingMintOut &&
      !selectedTokenMintWouldOverfill &&
      tokenPrepareMintCountValue >= 1 &&
      tokenPrepareMintCountValue <= TOKEN_PREPARE_MAX_MINT_COUNT &&
      tokenPrepareFeeReserveValue >= 0 &&
      tokenPrepareFeeRateValue > 0 &&
      tokenPrepareOutputSats >= DUST_SATS,
    ) && !busy;
  const canCreateToken =
    Boolean(
      address &&
      network === "livenet" &&
      tokenIndexAddress &&
      tokenCreatePayload &&
      /^[A-Z0-9]{1,12}$/u.test(normalizedTokenTicker) &&
      !tokenTickerReservationMessage &&
      tokenResolvedRegistryAddress &&
      !tokenRegistryResolution.error &&
      Number.isSafeInteger(Math.floor(tokenCreateMaxSupply)) &&
      Math.floor(tokenCreateMaxSupply) >= 1 &&
      Number.isSafeInteger(Math.floor(tokenCreateMintAmount)) &&
      Math.floor(tokenCreateMintAmount) >= 1 &&
      Math.floor(tokenCreateMintAmount) <= Math.floor(tokenCreateMaxSupply) &&
      Number.isSafeInteger(Math.floor(tokenCreateMintPriceSats)) &&
      Math.floor(tokenCreateMintPriceSats) >= TOKEN_MIN_MUTATION_PRICE_SATS,
    ) &&
    tokenCreateBytes <= MAX_DATA_CARRIER_BYTES &&
    !busy;
  const idPurchasePayload = useMemo(() => {
    if (!selectedMarketplaceListing || !idPurchaseOwnerAddress.trim()) {
      return "";
    }

    try {
      return buildIdMarketplaceTransferPayload(
        selectedMarketplaceListing.listingId,
        idPurchaseOwnerAddress.trim(),
        idPurchaseReceiveAddress.trim(),
        marketplaceTransferVersionForListing(selectedMarketplaceListing),
      );
    } catch {
      return "";
    }
  }, [
    idPurchaseOwnerAddress,
    idPurchaseReceiveAddress,
    selectedMarketplaceListing,
  ]);
  const idReceiverUpdateBytes = useMemo(
    () =>
      idReceiverUpdatePayload
        ? dataCarrierBytesForPayload(idReceiverUpdatePayload)
        : 0,
    [idReceiverUpdatePayload],
  );
  const idTransferBytes = useMemo(
    () =>
      idTransferPayload ? dataCarrierBytesForPayload(idTransferPayload) : 0,
    [idTransferPayload],
  );
  const idPurchaseBytes = useMemo(
    () =>
      idPurchasePayload ? dataCarrierBytesForPayload(idPurchasePayload) : 0,
    [idPurchasePayload],
  );
  const salePriceSats = Math.floor(idSalePriceSats);
  const saleBuyerAddress = idSaleBuyerAddress.trim();
  const saleReceiveAddress = idSaleReceiveAddress.trim();
  const purchaseReceiveAddress = idPurchaseReceiveAddress.trim();
  const canCreateSaleAuthorization =
    Boolean(
      address &&
      registryAddress &&
      managedIdRecord &&
      managedIdRecord.ownerAddress === address &&
      Number.isSafeInteger(salePriceSats) &&
      salePriceSats >= 0 &&
      (!saleBuyerAddress || isValidBitcoinAddress(saleBuyerAddress, network)) &&
      (!saleReceiveAddress ||
        isValidBitcoinAddress(saleReceiveAddress, network)),
    ) && !busy;
  const canUpdateId =
    Boolean(
      address &&
      registryAddress &&
      managedIdRecord &&
      idReceiverUpdatePayload &&
      !receiverUpdateResolution.error &&
      isValidBitcoinAddress(receiverUpdateResolution.paymentAddress, network) &&
      receiverUpdateResolution.paymentAddress !==
        managedIdRecord.receiveAddress,
    ) &&
    idReceiverUpdateBytes <= MAX_DATA_CARRIER_BYTES &&
    !busy;
  const canTransferId =
    Boolean(
      address &&
      registryAddress &&
      managedIdRecord &&
      idTransferPayload &&
      !transferOwnerResolution.error &&
      !transferReceiveResolution?.error &&
      isValidBitcoinAddress(transferOwnerResolution.ownerAddress, network) &&
      isValidBitcoinAddress(effectiveTransferReceiveAddress, network) &&
      (transferOwnerResolution.ownerAddress !== managedIdRecord.ownerAddress ||
        effectiveTransferReceiveAddress !== managedIdRecord.receiveAddress),
    ) &&
    idTransferBytes <= MAX_DATA_CARRIER_BYTES &&
    !busy;
  const canPurchaseId =
    Boolean(
      address &&
      registryAddress &&
      parsedSaleAuthorization &&
      selectedMarketplaceListing &&
      listingCanBePurchased(selectedMarketplaceListing) &&
      idPurchasePayload &&
      isValidBitcoinAddress(idPurchaseOwnerAddress.trim(), network) &&
      (!purchaseReceiveAddress ||
        isValidBitcoinAddress(purchaseReceiveAddress, network)) &&
      (!parsedSaleAuthorization.buyerAddress ||
        parsedSaleAuthorization.buyerAddress ===
          idPurchaseOwnerAddress.trim()) &&
      (!parsedSaleAuthorization.receiveAddress ||
        parsedSaleAuthorization.receiveAddress ===
          (purchaseReceiveAddress || idPurchaseOwnerAddress.trim())) &&
      saleAuthorizationCanBroadcast(parsedSaleAuthorization),
    ) &&
    idPurchaseBytes <= MAX_DATA_CARRIER_BYTES &&
    !busy;
  const refreshInProgress = refreshing || checkingBroadcasts;
  const refreshDisabled =
    activeFolder === "contacts"
      ? busy || refreshInProgress || !registryAddress
      : activeFolder === "desktop"
        ? desktopLoading || !desktopProfile
          : activeFolder === "browser"
            ? true
            : activeFolder === "ids" ||
                activeFolder === "marketplace" ||
                activeFolder === "token" ||
                activeFolder === "wallet" ||
                activeFolder === "work" ||
                activeFolder === "log"
            ? busy || refreshInProgress || !registryAddress
            : !address || busy || refreshInProgress;

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
  }, []);

  useEffect(() => {
    const detectWallet = () => setHasUnisat(Boolean(window.unisat));
    detectWallet();
    const interval = window.setInterval(detectWallet, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(
    () => () => {
      tokenMintAssistantActiveRef.current = false;
      clearTokenMintAssistantTimer();
    },
    [],
  );

  useEffect(() => {
    allSentRef.current = allSent;
    saveSentMessages(allSent);
  }, [allSent]);

  useEffect(() => {
    activityHistoryPageRef.current = activityHistoryPage;
  }, [activityHistoryPage]);

  useEffect(() => {
    activityProfileRef.current = activityProfile;
  }, [activityProfile]);

  useEffect(() => {
    chainSentRef.current = chainSent;
  }, [chainSent]);

  const checkBroadcastStatuses = useCallback(
    async (silent = false) => {
      if (!address) {
        return;
      }

      const targets = broadcastTargetsFor(
        address,
        network,
        allSentRef.current,
        chainSentRef.current,
      );

      if (targets.length === 0) {
        if (!silent) {
          setStatus({ tone: "idle", text: "No pending broadcasts to check." });
        }
        return;
      }

      setCheckingBroadcasts(true);

      try {
        const summary = await checkBroadcastTargets(targets);

        setAllSent((current) => applyBroadcastCheckResults(current, summary));
        setChainSent((current) => applyBroadcastCheckResults(current, summary));

        if (!silent) {
          setStatus({
            tone: summary.failed === summary.results.length ? "bad" : "good",
            text: `Outbox checked. ${broadcastCheckSummaryText(summary)}.`,
          });
        }
      } finally {
        setCheckingBroadcasts(false);
      }
    },
    [address, network],
  );

  useEffect(() => {
    if (!address) {
      return;
    }

    void checkBroadcastStatuses(true);
    const interval = window.setInterval(() => {
      void checkBroadcastStatuses(true);
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [address, checkBroadcastStatuses, network]);

  useEffect(() => {
    saveMailPreferences(mailPreferences);
  }, [mailPreferences]);

  useEffect(() => {
    saveCustomFolders(customFolders);
  }, [customFolders]);

  useEffect(() => {
    setSavedDraft(address ? loadDraft(address, network) : undefined);
  }, [address, network]);

  useEffect(() => {
    setIdReceiveAddress(address);
    setIdPurchaseOwnerAddress(address);
  }, [address, network]);

  useEffect(() => {
    if (tokenWalletBalances.length === 0) {
      setTokenTransferTokenId("");
      return;
    }

    if (
      !tokenTransferTokenId ||
      !tokenWalletBalances.some(
        (item) => item.token.tokenId === tokenTransferTokenId,
      )
    ) {
      setTokenTransferTokenId(tokenWalletBalances[0].token.tokenId);
    }
  }, [tokenTransferTokenId, tokenWalletBalances]);

  useEffect(() => {
    if (ownerControlledIds.length === 0) {
      setManagedIdName("");
      setIdUpdateReceiveAddress("");
      return;
    }

    const selectedRecord =
      ownerControlledIds.find((record) => record.id === managedIdName) ??
      ownerControlledIds[0];
    if (selectedRecord.id !== managedIdName) {
      setManagedIdName(selectedRecord.id);
    }
  }, [managedIdName, ownerControlledIds]);

  useEffect(() => {
    if (desktopProfile && desktopProfile.network !== network) {
      setDesktopProfile(undefined);
      setDesktopMail([]);
      setDesktopSelectedKey("");
    }
  }, [desktopProfile, network]);

  useEffect(() => {
    if (!address || !composeOpen) {
      return;
    }

    const draft: DraftMessage = {
      amountSats,
      attachment,
      ccRecipient,
      feeRate,
      from: address,
      memo,
      network,
      parentTxid: replyParentTxid,
      recipient,
      subject,
      updatedAt: new Date().toISOString(),
    };

    if (!isDraftContentful(draft)) {
      return;
    }

    saveDraft(draft);
    setSavedDraft(draft);
  }, [
    address,
    amountSats,
    attachment,
    ccRecipient,
    composeOpen,
    feeRate,
    memo,
    network,
    recipient,
    replyParentTxid,
    subject,
  ]);

  useEffect(() => {
    if (
      activityMode ||
      growthMode ||
      tokenMode ||
      walletMode ||
      workTokenMode ||
      rushMode
    ) {
      return;
    }

    if (
      activeFolder === "ids" ||
      activeFolder === "marketplace" ||
      activeFolder === "token" ||
      activeFolder === "wallet" ||
      activeFolder === "work" ||
      activeFolder === "contacts"
    ) {
      if (activeFolder === "token" || activeFolder === "wallet" || activeFolder === "work") {
        if (network !== "livenet") {
          setNetwork("livenet");
          return;
        }
        void refreshToken(true);
        return;
      }
      void refreshIds(true);
    }
  }, [
    activeFolder,
    activityMode,
    growthMode,
    network,
    rushMode,
    tokenMode,
    walletMode,
    workTokenMode,
  ]);

  useEffect(() => {
    if (!mainnetRegistryMode) {
      return;
    }

    if (network !== "livenet") {
      setNetwork("livenet");
      return;
    }

    if (
      activityMode ||
      growthMode ||
      marketplaceMode ||
      tokenMode ||
      walletMode ||
      workTokenMode ||
      rushMode
    ) {
      return;
    }

    setActiveFolder("ids");
    void refreshIds(true);
  }, [
    activityMode,
    growthMode,
    mainnetRegistryMode,
    marketplaceMode,
    network,
    rushMode,
    tokenMode,
    walletMode,
    workTokenMode,
  ]);

  useEffect(() => {
    if (
      (!marketplaceMode && !tokenMode && !walletMode && !workTokenMode) ||
      network !== "livenet"
    ) {
      return;
    }

    let cancelled = false;
    void (async () => {
      if (marketplaceMode || activeFolder === "marketplace") {
        await refreshMarketplaceSummary(true, false);
      } else {
        await refreshToken(true, false);
      }
      if (!cancelled && document.visibilityState === "visible") {
        window.setTimeout(() => {
          if (!cancelled && document.visibilityState === "visible") {
            if (marketplaceMode || activeFolder === "marketplace") {
              void refreshMarketplaceSummary(true, true);
            } else {
              void refreshToken(true, false);
            }
          }
        }, BACKGROUND_FRESH_REFRESH_DELAY_MS);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeFolder, marketplaceMode, network, tokenMode, walletMode, workTokenMode]);

  useEffect(() => {
    if (!(activityMode || activeFolder === "log")) {
      return;
    }

    if (network !== "livenet") {
      setNetwork("livenet");
      return;
    }

    let cancelled = false;
    let settleTimer: number | undefined;

    const loadVisibleLog = (fresh = false) => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void (async () => {
        await loadLogHead(true, fresh);
        if (cancelled) {
          return;
        }

        const currentPageIndex = activityHistoryPageRef.current?.page ?? 0;
        await loadLogHistoryPage(currentPageIndex, true);
        const currentProfile = activityProfileRef.current;
        if (!cancelled && currentProfile) {
          void loadActivityTarget(currentProfile.query);
        }

        if (fresh) {
          window.clearTimeout(settleTimer);
          settleTimer = window.setTimeout(() => {
            if (!cancelled && document.visibilityState === "visible") {
              void loadLogHead(true, false);
              void loadLogHistoryPage(currentPageIndex, true);
            }
          }, BACKGROUND_FRESH_REFRESH_DELAY_MS);
        }
      })();
    };

    void refreshLogSurface(false, false);
    settleTimer = window.setTimeout(() => {
      loadVisibleLog(false);
    }, BACKGROUND_FRESH_REFRESH_DELAY_MS);

    const interval = window.setInterval(() => {
      loadVisibleLog(false);
    }, LOG_LIVE_REFRESH_MS);
    const focusHandler = () => loadVisibleLog(false);
    window.addEventListener("focus", focusHandler);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(settleTimer);
      window.removeEventListener("focus", focusHandler);
    };
  }, [
    activeFolder,
    activityMode,
    network,
  ]);

  useEffect(() => {
    if (!rushMode || !rushRegistryAddressForNetwork(network)) {
      return;
    }

    void refreshRush(true);
  }, [network, rushMode]);

  useEffect(() => {
    if (
      network !== "livenet" ||
      (!marketplaceMode &&
        !walletMode &&
        !tokenRouteShowsWorkFloor &&
        !workTokenMode &&
        activeFolder !== "marketplace" &&
        activeFolder !== "wallet" &&
        activeFolder !== "work")
    ) {
      return;
    }

    const refreshWorkFloorMetrics = () => {
      if (document.visibilityState === "visible") {
        void (async () => {
          const useMarketplaceSummary =
            marketplaceMode || activeFolder === "marketplace";
          if (useMarketplaceSummary) {
            await refreshMarketplaceSummary(true, false);
          } else {
            await Promise.all([
              refreshTokenBtcUsd(false),
              refreshWorkFloor(true, false),
            ]);
          }
          window.setTimeout(() => {
            if (document.visibilityState === "visible") {
              if (useMarketplaceSummary) {
                void refreshMarketplaceSummary(true, true);
              } else {
                void refreshTokenBtcUsd(true);
                void refreshWorkFloor(true, true);
              }
            }
          }, BACKGROUND_FRESH_REFRESH_DELAY_MS);
        })();
      }
    };

    refreshWorkFloorMetrics();
    const interval = window.setInterval(
      refreshWorkFloorMetrics,
      WORK_FLOOR_LIVE_REFRESH_MS,
    );
    window.addEventListener("focus", refreshWorkFloorMetrics);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWorkFloorMetrics);
    };
  }, [
    activeFolder,
    marketplaceMode,
    network,
    tokenRouteShowsWorkFloor,
    walletMode,
    workTokenMode,
  ]);

  useEffect(() => {
    if (
      !marketplaceMode &&
      !tokenMode &&
      !walletMode &&
      !growthMode &&
      !workTokenMode &&
      activeFolder !== "marketplace" &&
      activeFolder !== "token" &&
      activeFolder !== "wallet" &&
      activeFolder !== "work"
    ) {
      return;
    }

    let canceled = false;
    fetchBtcUsdPrice()
      .then((usd) => {
        if (!canceled) {
          setTokenBtcUsd(usd);
        }
      })
      .catch(() => {
        return undefined;
      });

    return () => {
      canceled = true;
    };
  }, [
    activeFolder,
    growthMode,
    marketplaceMode,
    tokenMode,
    walletMode,
    workTokenMode,
  ]);

  async function refreshTokenBtcUsd(fresh = true) {
    try {
      setTokenBtcUsd(await fetchBtcUsdPrice(fresh));
    } catch {
      return undefined;
    }
  }

  useEffect(() => {
    if (!growthMode || network !== "livenet") {
      return;
    }

    const refreshGrowthMetrics = () => {
      if (document.visibilityState === "visible") {
        void (async () => {
          await refreshGrowth(true, false);
          window.setTimeout(() => {
            if (document.visibilityState === "visible") {
              void refreshGrowth(true, true);
            }
          }, BACKGROUND_FRESH_REFRESH_DELAY_MS);
        })();
      }
    };
    refreshGrowthMetrics();
    const interval = window.setInterval(
      refreshGrowthMetrics,
      WORK_FLOOR_LIVE_REFRESH_MS,
    );
    window.addEventListener("focus", refreshGrowthMetrics);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshGrowthMetrics);
    };
  }, [growthMode, network, registryAddress]);

  useEffect(() => {
    if (!landingMode) {
      return;
    }

    if (network !== "livenet") {
      setNetwork("livenet");
      return;
    }

    void refreshIds(true);
  }, [landingMode, network]);

  useEffect(() => {
    if (!marketplaceMode) {
      return;
    }

    if (network !== "livenet") {
      setNetwork("livenet");
      return;
    }

    void refreshMarketplaceSummary(true, false);
  }, [marketplaceMode, network]);

  useEffect(() => {
    if (
      (!needsRegistryResolution(recipient, network) &&
        !needsRegistryResolution(ccRecipient, network) &&
        !(
          (tokenMode ||
            workTokenMode ||
            activeFolder === "token" ||
            activeFolder === "work") &&
          needsRegistryResolution(tokenCreateRegistryAddress, network)
        )) ||
      !registryAddress
    ) {
      return undefined;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      fetchIdRegistry(network)
        .then((records) => {
          if (!cancelled) {
            setIdRegistry(records);
          }
        })
        .catch(() => undefined);
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [activeFolder, ccRecipient, network, recipient, registryAddress, tokenCreateRegistryAddress, tokenMode, workTokenMode]);

  useEffect(() => {
    if (
      landingMode ||
      desktopRoute ||
      browserRoute ||
      activityMode ||
      growthMode
    ) {
      return;
    }

    if (!window.unisat) {
      return;
    }

    if (mainnetRegistryMode) {
      setNetwork("livenet");
      return;
    }

    getWalletNetwork(window.unisat)
      .then((walletNetwork) => {
        if (walletNetwork) {
          setNetwork(walletNetwork);
        }
      })
      .catch(() => undefined);
  }, [
    activityMode,
    browserRoute,
    desktopRoute,
    growthMode,
    hasUnisat,
    landingMode,
    mainnetRegistryMode,
  ]);

  useEffect(() => {
    if (
      landingMode ||
      desktopRoute ||
      browserRoute ||
      activityMode ||
      growthMode
    ) {
      return;
    }

    if (!window.unisat?.on) {
      return;
    }

    const syncWallet = async () => {
      const accounts = await window.unisat?.getAccounts?.().catch(() => []);
      const nextAddress = accounts?.[0] ?? "";
      const nextNetwork = mainnetRegistryMode
        ? "livenet"
        : ((await getWalletNetwork(window.unisat as UnisatWallet)) ?? network);

      setAddress(nextAddress);
      setNetwork(nextNetwork);
      setInbox([]);
      setChainSent([]);
      setSelectedKey("");
      setActiveFolder(
        workTokenMode
            ? "work"
            : tokenMode
              ? "token"
              : walletMode
                ? "wallet"
                : marketplaceMode
                  ? "marketplace"
                  : mainnetRegistryMode
                    ? "ids"
                    : "inbox",
      );
      setComposeOpen(false);

      if (!nextAddress) {
        setStatus({ tone: "idle", text: "Wallet account disconnected." });
        return;
      }

      try {
        if (tokenMode || walletMode || workTokenMode) {
          await switchWalletNetwork(window.unisat as UnisatWallet, "livenet");
          const state = await fetchTokenState(
            "livenet",
            false,
            workTokenMode ? WORK_TOKEN_ID : "",
          );
          setTokenDefinitions(state.tokens);
          setTokenMints(state.mints);
          setTokenTransfers(state.transfers);
          setTokenListings(state.listings);
          setTokenClosedListings(state.closedListings);
          setTokenSales(state.sales);
          setTokenCreationSats(state.creationSats);
          setStatus({
            tone: "good",
            text: `${shortAddress(nextAddress)} connected. Token wallet ready.`,
          });
          return;
        }

        if (rushMode) {
          const rushNetwork = rushRegistryAddressForNetwork(nextNetwork)
            ? nextNetwork
            : "livenet";
          await switchWalletNetwork(window.unisat as UnisatWallet, rushNetwork);
          const state = await fetchRushState(rushNetwork, true);
          setNetwork(rushNetwork);
          setRushState(state);
          setStatus({
            tone: "good",
            text: `${shortAddress(nextAddress)} connected. RUSH mint ready.`,
          });
          return;
        }

        if (mainnetRegistryMode) {
          await switchWalletNetwork(window.unisat as UnisatWallet, "livenet");
          const state = await fetchIdRegistryState("livenet");
          setIdRegistry(state.records);
          setIdListings(state.listings);
          setIdPendingEvents(state.pendingEvents);
          setIdSales(state.sales);
          setIdActivity(state.activity);
          setStatus({
            tone: "good",
            text: `${shortAddress(nextAddress)} connected. ProofOfWork ID registry ready.`,
          });
          return;
        }

        const mailState = await fetchAddressMail(nextAddress, nextNetwork);
        const { inboxMessages, sentMessages } = mailState;
        setInbox(inboxMessages);
        setChainSent(sentMessages);
        setSelectedKey(selectedInboundKey("inbox", inboxMessages));
        setStatus({
          tone: "good",
          text: `${shortAddress(nextAddress)} loaded. ${mailboxSummary(inboxMessages, sentMessages)}.`,
        });
      } catch (error) {
        setStatus({
          tone: "bad",
          text: errorMessage(error, "Address scan failed."),
        });
      }
    };

    const accountsChanged = () => {
      void syncWallet();
    };
    const networkChanged = () => {
      void syncWallet();
    };
    const chainChanged = () => {
      void syncWallet();
    };

    window.unisat.on("accountsChanged", accountsChanged);
    window.unisat.on("networkChanged", networkChanged);
    window.unisat.on("chainChanged", chainChanged);

    return () => {
      window.unisat?.removeListener?.("accountsChanged", accountsChanged);
      window.unisat?.removeListener?.("networkChanged", networkChanged);
      window.unisat?.removeListener?.("chainChanged", chainChanged);
    };
  }, [
    activityMode,
    browserRoute,
    desktopRoute,
    growthMode,
    hasUnisat,
    landingMode,
    mainnetRegistryMode,
    marketplaceMode,
    network,
    rushMode,
    tokenMode,
    walletMode,
    workTokenMode,
  ]);

  function applyDraft(draft: DraftMessage) {
    setRecipient(draft.recipient);
    setCcRecipient(draft.ccRecipient ?? "");
    setAmountSats(draft.amountSats);
    setFeeRate(draft.feeRate);
    setSubject(draft.subject ?? "");
    setMemo(draft.memo);
    setAttachment(draft.attachment);
    setReplyParentTxid(draft.parentTxid);
    setActiveFolder("drafts");
    setComposeOpen(true);
    setSelectedKey("draft");
  }

  function isArchived(message: MailMessage) {
    return archivedKeys.has(mailKey(message));
  }

  function isFavorite(message: MailMessage) {
    return favoriteKeys.has(mailKey(message));
  }

  function canArchive(message: MailMessage) {
    return (
      message.folder === "inbox" ||
      (message.folder === "sent" && sentDeliveryStatus(message) === "confirmed")
    );
  }

  function canFavorite(message: MailMessage) {
    return (
      message.folder === "inbox" ||
      (message.folder === "sent" && sentDeliveryStatus(message) === "confirmed")
    );
  }

  function canUseCustomFolders(message: MailMessage) {
    return canFavorite(message);
  }

  function messageFolderIds(message: MailMessage) {
    return mailPreferences[mailKey(message)]?.folders ?? [];
  }

  function setMessageCustomFolder(
    message: MailMessage,
    folderId: string,
    enabled: boolean,
  ) {
    if (!canUseCustomFolders(message)) {
      setStatus({ tone: "bad", text: "Only confirmed mail can be filed." });
      return;
    }

    const folder = customFolders.find((item) => item.id === folderId);
    if (!folder) {
      return;
    }

    const key = mailKey(message);
    setMailPreferences((current) => {
      const next = { ...current };
      const currentFolders = new Set(next[key]?.folders ?? []);
      if (enabled) {
        currentFolders.add(folderId);
      } else {
        currentFolders.delete(folderId);
      }

      const folders = [...currentFolders];
      const existing = next[key] ?? {};
      if (folders.length > 0) {
        next[key] = { ...existing, folders };
      } else {
        const { folders: _folders, ...rest } = existing;
        if (Object.keys(rest).length > 0) {
          next[key] = rest;
        } else {
          delete next[key];
        }
      }

      return next;
    });

    setStatus({
      tone: "good",
      text: enabled
        ? `Added to ${folder.name}.`
        : `Removed from ${folder.name}.`,
    });
  }

  function createCustomFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = normalizeFolderName(newFolderName);
    if (!name) {
      return;
    }

    if (
      customFolders.some(
        (folder) => folder.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      setStatus({ tone: "bad", text: `${name} already exists.` });
      return;
    }

    const folder: CustomFolderRecord = {
      createdAt: new Date().toISOString(),
      id: customFolderId(name),
      name,
    };
    setCustomFolders((current) => sortCustomFolders([...current, folder]));
    setNewFolderName("");
    setActiveFolder("custom");
    setActiveCustomFolderId(folder.id);
    setStatus({ tone: "good", text: `${name} folder created.` });
  }

  function removeCustomFolder(folderId: string) {
    const folder = customFolders.find((item) => item.id === folderId);
    if (!folder) {
      return;
    }

    setCustomFolders((current) =>
      current.filter((item) => item.id !== folderId),
    );
    setMailPreferences((current) => {
      const next: MailPreferences = {};
      for (const [key, preference] of Object.entries(current)) {
        const folders = (preference.folders ?? []).filter(
          (item) => item !== folderId,
        );
        const normalized = {
          ...preference,
          folders: folders.length > 0 ? folders : undefined,
        };
        if (
          !normalized.archived &&
          !normalized.favorite &&
          !normalized.folders
        ) {
          continue;
        }

        next[key] = normalized;
      }

      return next;
    });

    if (activeCustomFolderId === folderId) {
      setActiveFolder("inbox");
      setActiveCustomFolderId("");
      setSelectedKey("");
    }

    setStatus({ tone: "good", text: `${folder.name} folder removed.` });
  }

  function setMessageFavorite(message: MailMessage, favorite: boolean) {
    if (!canFavorite(message)) {
      setStatus({ tone: "bad", text: "Only confirmed mail can be favorited." });
      return;
    }

    const key = mailKey(message);
    setMailPreferences((current) => {
      const next = { ...current };
      if (favorite) {
        next[key] = { ...next[key], favorite: true };
      } else {
        const { favorite: _favorite, ...rest } = next[key] ?? {};
        if (Object.keys(rest).length > 0) {
          next[key] = rest;
        } else {
          delete next[key];
        }
      }

      return next;
    });

    setStatus({
      tone: "good",
      text: favorite
        ? "Message added to Favorites."
        : "Message removed from Favorites.",
    });
  }

  function setMessageArchived(message: MailMessage, archived: boolean) {
    if (!canArchive(message)) {
      setStatus({ tone: "bad", text: "Only confirmed mail can be archived." });
      return;
    }

    const key = mailKey(message);
    setMailPreferences((current) => {
      const next = { ...current };
      if (archived) {
        next[key] = { ...next[key], archived: true };
      } else {
        const { archived: _archived, ...rest } = next[key] ?? {};
        if (Object.keys(rest).length > 0) {
          next[key] = rest;
        } else {
          delete next[key];
        }
      }

      return next;
    });

    setSelectedKey("");
    setComposeOpen(false);
    setStatus({
      tone: "good",
      text: archived ? "Message archived." : "Message returned to mail.",
    });
  }

  function restoreSentAsDraft(message: MailMessage) {
    if (message.folder !== "sent") {
      return;
    }

    const draft: DraftMessage = {
      amountSats: message.amountSats,
      attachment: message.attachment,
      ccRecipient: recipientListText(message.ccRecipients, ""),
      feeRate: message.feeRate,
      from: message.from,
      memo: message.memo,
      network: message.network,
      parentTxid: message.parentTxid,
      recipient: recipientListText(
        message.toRecipients ?? message.recipients,
        message.to,
      ),
      subject: message.subject,
      updatedAt: new Date().toISOString(),
    };

    saveDraft(draft);
    setSavedDraft(draft);
    applyDraft(draft);
    setStatus({
      tone: "good",
      text: "Dropped message restored as a draft. Review it, then send to sign a fresh transaction.",
    });
  }

  function rememberComputerFolder(folder: Folder) {
    if (typeof window === "undefined" || folder === "custom") {
      return;
    }

    if (
      landingMode ||
      idLaunchMode ||
      desktopRoute ||
      browserRoute ||
      marketplaceMode ||
      tokenMode ||
      walletMode ||
      workTokenMode ||
      rushMode ||
      activityMode ||
      growthMode
    ) {
      return;
    }

    const url = new URL(window.location.href);
    STANDALONE_ROUTE_PARAMS.forEach((param) => url.searchParams.delete(param));
    if (folder === "inbox") {
      url.searchParams.delete("folder");
    } else {
      url.searchParams.set("folder", folder);
    }
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  function rememberComputerWorkspaceAsset(folder: Folder, asset = "") {
    if (typeof window === "undefined" || folder === "custom") {
      return;
    }

    if (
      landingMode ||
      idLaunchMode ||
      desktopRoute ||
      browserRoute ||
      marketplaceMode ||
      tokenMode ||
      walletMode ||
      workTokenMode ||
      rushMode ||
      activityMode ||
      growthMode
    ) {
      return;
    }

    const url = new URL(window.location.href);
    STANDALONE_ROUTE_PARAMS.forEach((param) => url.searchParams.delete(param));
    url.searchParams.set("folder", folder);
    if (asset) {
      url.searchParams.set("asset", asset);
      url.searchParams.delete("ticker");
    } else {
      url.searchParams.delete("asset");
      url.searchParams.delete("ticker");
    }
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  function openFolder(folder: Folder) {
    rememberComputerFolder(folder);

    if (folder === "drafts") {
      const draft = address ? loadDraft(address, network) : savedDraft;
      setSavedDraft(draft);
      setActiveFolder("drafts");
      setSortMode((current) =>
        ["largest", "filetype", "sender"].includes(current) ? "value" : current,
      );
      setSelectedKey("");

      if (draft) {
        applyDraft(draft);
        setStatus({
          tone: "idle",
          text: `Draft restored. Last saved ${formatDate(draft.updatedAt)}.`,
        });
      } else {
        setComposeOpen(false);
        setReplyParentTxid(undefined);
        setAttachment(undefined);
        setCcRecipient("");
        setSubject("");
      }

      return;
    }

    setActiveFolder(folder);
    if (folder !== "custom") {
      setActiveCustomFolderId("");
    }
    setSortMode((current) =>
      !["files", "desktop"].includes(folder) &&
      ["largest", "filetype", "sender"].includes(current)
        ? "value"
        : current,
    );
    setComposeOpen(false);
    setReplyParentTxid(undefined);
    setAttachment(undefined);
    setSelectedKey("");
  }

  function openTokenWorkspace(token?: PowTokenDefinition) {
    const folder =
      token &&
      (token.tokenId === WORK_TOKEN_ID || token.ticker === WORK_TOKEN_TICKER)
        ? "work"
        : "token";

    if (token) {
      setTokenSelectedId(token.tokenId);
      setTokenDetailTarget(token.tokenId);
      rememberComputerWorkspaceAsset(folder, token.tokenId);
    } else {
      setTokenDetailTarget("");
      rememberComputerWorkspaceAsset(folder);
    }

    openFolder(folder);
  }

  function openWalletWorkspace(token?: PowTokenDefinition) {
    if (token) {
      setTokenTransferTokenId(token.tokenId);
      rememberComputerWorkspaceAsset("wallet", token.tokenId);
    } else {
      rememberComputerWorkspaceAsset("wallet");
    }

    openFolder("wallet");
  }

  function openSourceMessage(message: MailMessage) {
    setActiveFolder(isArchived(message) ? "archive" : message.folder);
    setSortMode((current) =>
      ["largest", "filetype", "sender"].includes(current) ? "value" : current,
    );
    setComposeOpen(false);
    setReplyParentTxid(undefined);
    setAttachment(undefined);
    setSelectedKey(mailKey(message));
  }

  function composeNew() {
    setRecipient("");
    setCcRecipient("");
    setAmountSats(DEFAULT_AMOUNT_SATS);
    setFeeRate(DEFAULT_FEE_RATE);
    setSubject("");
    setMemo(DEFAULT_MEMO);
    setAttachment(undefined);
    setReplyParentTxid(undefined);
    setActiveFolder("inbox");
    setComposeOpen(true);
  }

  function discardDraft() {
    if (address) {
      clearDraft(address, network);
    }

    setSavedDraft(undefined);
    setRecipient("");
    setCcRecipient("");
    setAmountSats(DEFAULT_AMOUNT_SATS);
    setFeeRate(DEFAULT_FEE_RATE);
    setSubject("");
    setMemo(DEFAULT_MEMO);
    setAttachment(undefined);
    setReplyParentTxid(undefined);
    setComposeOpen(false);
    setSelectedKey("");
    setStatus({ tone: "good", text: "Draft discarded." });
  }

  function saveContact(contact: ContactRecord) {
    setContacts((current) => {
      const nextContacts = upsertContact(current, contact);
      saveContacts(nextContacts);
      return nextContacts;
    });
    setStatus({ tone: "good", text: `${contact.name} saved to Contacts.` });
  }

  async function addManualContact(name: string, target: string) {
    const trimmedTarget = target.trim();
    try {
      saveContact(
        contactFromInput(
          name,
          trimmedTarget,
          network,
          idRegistry,
          registryAddress,
        ),
      );
      return true;
    } catch (error) {
      if (
        !trimmedTarget ||
        isValidBitcoinAddress(trimmedTarget, network) ||
        !normalizePowId(trimmedTarget) ||
        !registryAddress
      ) {
        setStatus({
          tone: "bad",
          text: errorMessage(error, "Contact could not be saved."),
        });
        return false;
      }

      const id = normalizePowId(trimmedTarget);
      setBusy(true);
      setStatus({
        tone: "idle",
        text: `Refreshing confirmed registry for ${id}@proofofwork.me...`,
      });

      try {
        const latestState = await fetchIdRegistryState(network, true);
        setIdRegistry(latestState.records);
        setIdListings(latestState.listings);
        setIdPendingEvents(latestState.pendingEvents);
        setIdSales(latestState.sales);
        setIdActivity(latestState.activity);
        setContacts((current) => {
          const nextContacts = refreshRegistryContactsFromRecords(
            current,
            latestState.records,
            network,
          );
          if (nextContacts !== current) {
            saveContacts(nextContacts);
          }
          return nextContacts;
        });

        saveContact(
          contactFromInput(
            name,
            trimmedTarget,
            network,
            latestState.records,
            registryAddress,
          ),
        );
        return true;
      } catch (refreshError) {
        setStatus({
          tone: "bad",
          text: errorMessage(
            refreshError,
            errorMessage(error, "Contact could not be saved."),
          ),
        });
        return false;
      } finally {
        setBusy(false);
      }
    }
  }

  function addRegistryContact(record: PowIdRecord) {
    if (!record.confirmed) {
      setStatus({
        tone: "bad",
        text: "Only confirmed IDs can be saved as contacts.",
      });
      return;
    }

    saveContact(contactFromRegistryRecord(record));
  }

  function removeContact(contact: ContactRecord) {
    const nextContacts = contacts.filter(
      (current) => contactKey(current) !== contactKey(contact),
    );
    setContacts(nextContacts);
    saveContacts(nextContacts);
    setStatus({ tone: "good", text: `${contact.name} removed from Contacts.` });
  }

  function composeToContact(contact: ContactRecord) {
    setRecipient(contactTarget(contact));
    setCcRecipient("");
    setAmountSats(DEFAULT_AMOUNT_SATS);
    setFeeRate(DEFAULT_FEE_RATE);
    setSubject("");
    setMemo(DEFAULT_MEMO);
    setAttachment(undefined);
    setReplyParentTxid(undefined);
    setActiveFolder("inbox");
    setComposeOpen(true);
  }

  function exportBackup() {
    const data = collectBackupData();
    const keyCount = Object.keys(data).length;
    if (keyCount === 0) {
      setStatus({ tone: "idle", text: "No local app data to export yet." });
      return;
    }

    const payload: LocalBackupPayload = {
      app: BACKUP_APP,
      data,
      exportedAt: new Date().toISOString(),
      version: BACKUP_VERSION,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = backupFileName();
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);

    const summary = backupDataSummary(data);
    setStatus({
      tone: "good",
      text: `Backup exported with ${keyCount} data group${keyCount === 1 ? "" : "s"}${summary ? `: ${summary}` : ""}.`,
    });
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";

    if (!file) {
      return;
    }

    if (file.size > BACKUP_MAX_BYTES) {
      setStatus({ tone: "bad", text: "Backup file is too large." });
      return;
    }

    try {
      const data = parseBackup(await file.text());
      for (const [key, value] of Object.entries(data)) {
        localStorage.setItem(key, value);
      }

      setAllSent(loadSentMessages());
      setMailPreferences(loadMailPreferences());
      setContacts(loadContacts());
      setCustomFolders(loadCustomFolders());
      setSavedDraft(address ? loadDraft(address, network) : undefined);

      const keyCount = Object.keys(data).length;
      const summary = backupDataSummary(data);
      setStatus({
        tone: "good",
        text: `Backup imported. ${keyCount} data group${keyCount === 1 ? "" : "s"} restored${summary ? `: ${summary}` : ""}.`,
      });
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "Backup import failed."),
      });
    }
  }

  async function loadDesktopTarget(target = desktopQuery) {
    const query = target.trim();
    if (!query) {
      setStatus({
        tone: "bad",
        text: "Enter a Bitcoin address or confirmed ProofOfWork ID.",
      });
      return;
    }

    setDesktopLoading(true);
    setStatus({ tone: "idle", text: "Opening public desktop..." });

    try {
      let resolved = resolveRecipientInput(
        query,
        network,
        idRegistry,
        registryAddress,
      );
      if (resolved.isId || resolved.error) {
        const records = await fetchIdRegistry(network);
        setIdRegistry(records);
        resolved = resolveRecipientInput(
          query,
          network,
          records,
          registryAddress,
        );
      }

      if (resolved.error || !resolved.paymentAddress) {
        setStatus({
          tone: "bad",
          text:
            resolved.error ||
            "Enter a valid Bitcoin address or confirmed ProofOfWork ID.",
        });
        return;
      }

      const mailState = await fetchAddressMail(resolved.paymentAddress, network);
      const { inboxMessages, sentMessages } = mailState;
      const publicMail = withCanonicalWelcomeFile(
        fileSurfaceMessages(publicDesktopMail(inboxMessages, sentMessages)),
        network,
      );
      const files = publicMail.filter(hasAttachment);
      const profile: DesktopProfile = {
        address: resolved.paymentAddress,
        label: resolved.isId
          ? resolved.displayRecipient
          : shortAddress(resolved.paymentAddress),
        loadedAt: new Date().toISOString(),
        network,
        query,
        resolvedId: resolved.id,
      };

      setDesktopQuery(query);
      setDesktopProfile(profile);
      setDesktopMail(publicMail);
      setDesktopSelectedKey(files[0] ? mailKey(files[0]) : "");
      setActiveFolder("desktop");
      setComposeOpen(false);
      setSelectedKey("");
      setStatus({
        tone: "good",
        text: `${profile.label} desktop loaded. ${files.length.toLocaleString()} public file${files.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "Desktop search failed."),
      });
    } finally {
      setDesktopLoading(false);
    }
  }

  function clearDesktop() {
    setDesktopProfile(undefined);
    setDesktopMail([]);
    setDesktopSelectedKey("");
    setStatus({ tone: "idle", text: "Desktop cleared." });
  }

  function applyActivityPayload(payload: PowActivityApiResponse) {
    const activity = Array.isArray(payload.activity) ? payload.activity : [];
    const stats = normalizeActivityStats(payload.stats, activity);
    setActivityStats(stats);
    setIdActivity((current) =>
      payload.summaryOnly ? mergeActivityItems(current, activity) : activity,
    );
    return { activity, stats };
  }

  async function loadLogHead(silent = true, fresh = false) {
    if (network !== "livenet") {
      return undefined;
    }

    if (!silent) {
      setBusy(true);
      setStatus({ tone: "idle", text: "Loading cached Computer log..." });
    }

    try {
      const payload = await fetchGlobalActivityPayload(network, fresh, true);
      const { activity, stats } = applyActivityPayload(payload);
      if (!silent) {
        const total = stats.total ?? activity.length;
        setStatus({
          tone: "good",
          text: `Log loaded from indexed ledger. ${total.toLocaleString()} computer action${total === 1 ? "" : "s"} tracked.`,
        });
      }
      return payload;
    } catch (error) {
      if (!silent) {
        setStatus({
          tone: "bad",
          text: errorMessage(error, "Computer log load failed."),
        });
      }
      return undefined;
    } finally {
      if (!silent) {
        setBusy(false);
      }
    }
  }

  async function loadLogHistoryPage(pageIndex = 0, silent = true) {
    if (network !== "livenet") {
      return undefined;
    }

    if (!silent) {
      setActivityLoading(true);
    }

    try {
      const page = await fetchGlobalActivityHistoryPage(network, {
        pageIndex,
        pageSize: ACTIVITY_FEED_PAGE_SIZE,
      });
      activityHistoryPageRef.current = page;
      setActivityHistoryPage(page);
      setIdActivity((current) =>
        mergeActivityItems(current, Array.isArray(page.items) ? page.items : []),
      );
      return page;
    } catch (error) {
      if (!silent) {
        setStatus({
          tone: "bad",
          text: errorMessage(error, "Computer log history failed."),
        });
      }
      return undefined;
    } finally {
      if (!silent) {
        setActivityLoading(false);
      }
    }
  }

  async function refreshLogSurface(silent = true, fresh = false) {
    const head = await loadLogHead(silent, fresh);
    await loadLogHistoryPage(0, true);
    return head;
  }

  async function loadActivityTarget(target = activityQuery) {
    const query = target.trim();
    if (!query) {
      setActivityProfile(undefined);
      setActivityMail([]);
      setStatus({ tone: "idle", text: "Log search cleared." });
      return;
    }

    const txidOnly = /^[0-9a-fA-F]{64}$/u.test(query);
    if (txidOnly) {
      setActivityQuery(query.toLowerCase());
      setActivityProfile(undefined);
      setActivityMail([]);
      setStatus({ tone: "good", text: "Filtering log by txid." });
      return;
    }

    setActivityLoading(true);
    setStatus({ tone: "idle", text: "Opening ProofOfWork log..." });

    try {
      let resolved = resolveRecipientInput(
        query,
        network,
        idRegistry,
        registryAddress,
      );
      if (resolved.isId || resolved.error) {
        const state = await fetchIdRegistryState(network, true);
        setIdRegistry(state.records);
        setIdListings(state.listings);
        setIdPendingEvents(state.pendingEvents);
        setIdSales(state.sales);
        resolved = resolveRecipientInput(
          query,
          network,
          state.records,
          registryAddress,
        );
      }

      if (resolved.error || !resolved.paymentAddress) {
        setStatus({
          tone: "bad",
          text:
            resolved.error ||
            "Enter a valid Bitcoin address or confirmed ProofOfWork ID.",
        });
        return;
      }

      const { inboxMessages, sentMessages } = await fetchAddressMail(
        resolved.paymentAddress,
        network,
      );
      const addressActivity = activityItemsFromAddressMail(
        inboxMessages,
        sentMessages,
      ).sort(compareActivityItems);
      const profile: DesktopProfile = {
        address: resolved.paymentAddress,
        label: resolved.isId
          ? resolved.displayRecipient
          : shortAddress(resolved.paymentAddress),
        loadedAt: new Date().toISOString(),
        network,
        query,
        resolvedId: resolved.id,
      };

      setActivityQuery(query);
      setActivityProfile(profile);
      setActivityMail(addressActivity);
      setStatus({
        tone: "good",
        text: `${profile.label} log loaded. ${addressActivity.length.toLocaleString()} mail/file action${addressActivity.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "Log search failed."),
      });
    } finally {
      setActivityLoading(false);
    }
  }

  function clearActivity() {
    setActivityQuery("");
    setActivityProfile(undefined);
    setActivityMail([]);
    setStatus({ tone: "idle", text: "Log cleared." });
  }

  async function refreshMarketplaceSummary(
    silent = false,
    fresh = false,
  ): Promise<MarketplaceSummarySnapshot | undefined> {
    if (network !== "livenet") {
      return undefined;
    }

    if (marketplaceSummaryRefreshInFlightRef.current) {
      const needsFreshRefresh =
        fresh && !marketplaceSummaryRefreshInFlightFreshRef.current;
      if (!silent) {
        setBusy(true);
        setWorkFloorLoading(true);
        setStatus({
          tone: "idle",
          text: "Marketplace summary refresh already in progress...",
        });
      }
      try {
        const snapshot = await marketplaceSummaryRefreshInFlightRef.current;
        if (needsFreshRefresh) {
          return refreshMarketplaceSummary(silent, fresh);
        }
        return snapshot;
      } finally {
        if (!silent && !needsFreshRefresh) {
          setBusy(false);
          setWorkFloorLoading(false);
        }
      }
    }

    const refreshPromise = (async () => {
      if (!silent) {
        setBusy(true);
        setWorkFloorLoading(true);
        setStatus({ tone: "idle", text: "Refreshing marketplace summary..." });
      }
      try {
        const [snapshot, btcUsdQuote] = await Promise.all([
          fetchMarketplaceSummary(fresh),
          fetchBtcUsdPrice(fresh).catch(() => undefined),
        ]);
        setIdRegistry(snapshot.registry.records);
        setIdListings(snapshot.registry.listings);
        setIdPendingEvents(snapshot.registry.pendingEvents);
        setIdSales(snapshot.registry.sales);
        setIdActivity(snapshot.registry.activity);
        setTokenDefinitions(snapshot.token.tokens);
        setTokenMints(snapshot.token.mints);
        setTokenTransfers(snapshot.token.transfers);
        setTokenListings(snapshot.token.listings);
        setTokenClosedListings(snapshot.token.closedListings);
        setTokenSales(snapshot.token.sales);
        setTokenCreationSats(snapshot.token.creationSats);
        if (btcUsdQuote) {
          setTokenBtcUsd(btcUsdQuote);
        }
        if (snapshot.workFloor) {
          setWorkFloorQuote(snapshot.workFloor);
        }
        if (!silent) {
          const floorText = snapshot.workFloor
            ? ` WORK floor ${Math.round(snapshot.workFloor.networkValueSats).toLocaleString()} sats.`
            : "";
          setStatus({
            tone: "good",
            text: `Marketplace loaded. ${snapshot.token.tokens.length.toLocaleString()} token${snapshot.token.tokens.length === 1 ? "" : "s"}, ${snapshot.token.listings.length.toLocaleString()} listing${snapshot.token.listings.length === 1 ? "" : "s"}.${floorText}`,
          });
        }
        return snapshot;
      } catch (error) {
        if (!silent) {
          setStatus({
            tone: "bad",
            text: errorMessage(error, "Marketplace summary refresh failed."),
          });
        }
        return undefined;
      } finally {
        marketplaceSummaryRefreshInFlightRef.current = null;
        marketplaceSummaryRefreshInFlightFreshRef.current = false;
        if (!silent) {
          setBusy(false);
          setWorkFloorLoading(false);
        }
      }
    })();
    marketplaceSummaryRefreshInFlightFreshRef.current = fresh;
    marketplaceSummaryRefreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }

  async function refreshToken(
    silent = false,
    fresh = false,
  ): Promise<PowTokenState | undefined> {
    if (!tokenIndexAddress) {
      setTokenDefinitions([]);
      setTokenMints([]);
      setTokenTransfers([]);
      setTokenListings([]);
      setTokenClosedListings([]);
      setTokenSales([]);
      setTokenCreationSats(0);
      if (!silent) {
        setStatus({
          tone: "idle",
          text: `No token index configured for ${networkLabel(network)}.`,
        });
      }
      return undefined;
    }

    if (tokenRefreshInFlightRef.current) {
      const needsFreshRefresh =
        fresh && !tokenRefreshInFlightFreshRef.current;
      if (!silent) {
        setBusy(true);
        setStatus({
          tone: "idle",
          text: "Token index refresh already in progress...",
        });
      }
      try {
        const state = await tokenRefreshInFlightRef.current;
        if (needsFreshRefresh) {
          if (!silent) {
            setStatus({
              tone: "idle",
              text: "Starting fresh token index refresh...",
            });
          }
          return refreshToken(silent, fresh);
        }
        if (!silent) {
          setStatus(
            state
              ? {
                  tone: "good",
                  text: `Token index loaded. ${state.tokens.length.toLocaleString()} token${state.tokens.length === 1 ? "" : "s"}, ${state.mints.length.toLocaleString()} mint${state.mints.length === 1 ? "" : "s"}, ${state.transfers.length.toLocaleString()} transfer${state.transfers.length === 1 ? "" : "s"}.`,
                }
              : {
                  tone: "bad",
                  text: "Token scan failed.",
                },
          );
        }
        return state;
      } finally {
        if (!silent && !needsFreshRefresh) {
          setBusy(false);
        }
      }
    }

    const refreshPromise = (async () => {
      if (!silent) {
        setBusy(true);
      }
      if (!silent) {
        setStatus({ tone: "idle", text: "Scanning token index..." });
      }
      const tokenScope =
        workTokenMode || activeFolder === "work" ? WORK_TOKEN_ID : "";
      const useSummary = false;
      try {
        const state = await fetchTokenState(
          network,
          fresh,
          tokenScope,
          useSummary,
        );
        setTokenDefinitions(state.tokens);
        setTokenMints(state.mints);
        setTokenTransfers(state.transfers);
        setTokenListings(state.listings);
        setTokenClosedListings(state.closedListings);
        setTokenSales(state.sales);
        setTokenCreationSats(state.creationSats);
        if (!silent) {
          setStatus({
            tone: "good",
            text: `Token index loaded. ${state.tokens.length.toLocaleString()} token${state.tokens.length === 1 ? "" : "s"}, ${state.mints.length.toLocaleString()} mint${state.mints.length === 1 ? "" : "s"}, ${state.transfers.length.toLocaleString()} transfer${state.transfers.length === 1 ? "" : "s"}.`,
          });
        }
        return state;
      } catch (error) {
        if (!silent) {
          setStatus({
            tone: "bad",
            text: errorMessage(error, "Token scan failed."),
          });
        }
        return undefined;
      } finally {
        tokenRefreshInFlightRef.current = null;
        tokenRefreshInFlightFreshRef.current = false;
        if (!silent) {
          setBusy(false);
        }
      }
    })();
    tokenRefreshInFlightFreshRef.current = fresh;
    tokenRefreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }

  async function refreshRush(silent = false, fresh = false) {
    const registryAddress = rushRegistryAddressForNetwork(network);
    if (!registryAddress) {
      setRushState(emptyRushState(network));
      if (!silent) {
        setStatus({
          tone: "idle",
          text: `No RUSH registry configured for ${networkLabel(network)}.`,
        });
      }
      return;
    }

    setBusy(true);
    if (!silent) {
      setStatus({ tone: "idle", text: "Scanning RUSH registry..." });
    }

    try {
      const state = await fetchRushState(network, fresh);
      setRushState(state);
      if (!silent) {
        setStatus({
          tone: "good",
          text: `RUSH loaded. ${state.stats.confirmedMints.toLocaleString()} confirmed mint${state.stats.confirmedMints === 1 ? "" : "s"}, ${state.stats.pendingMints.toLocaleString()} pending.`,
        });
      }
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "RUSH scan failed."),
      });
    } finally {
      setBusy(false);
    }
  }

  async function refreshWorkFloor(
    silent = false,
    fresh = !silent,
  ): Promise<WorkFloorQuote | undefined> {
    if (workFloorRefreshInFlightRef.current) {
      const needsFreshRefresh =
        fresh && !workFloorRefreshInFlightFreshRef.current;
      if (!silent) {
        setWorkFloorLoading(true);
        setStatus({
          tone: "idle",
          text: "WORK floor refresh already in progress...",
        });
      }
      try {
        const quote = await workFloorRefreshInFlightRef.current;
        if (needsFreshRefresh) {
          if (!silent) {
            setStatus({
              tone: "idle",
              text: "Starting fresh WORK floor refresh...",
            });
          }
          return refreshWorkFloor(silent, fresh);
        }
        if (!silent) {
          setStatus(
            quote
              ? {
                  tone: "good",
                  text: `WORK floor loaded. Confirmed network value ${Math.round(quote.networkValueSats).toLocaleString()} sats.`,
                }
              : {
                  tone: "bad",
                  text: "WORK floor refresh failed.",
                },
          );
        }
        return quote;
      } finally {
        if (!silent && !needsFreshRefresh) {
          setWorkFloorLoading(false);
        }
      }
    }

    const refreshPromise = (async () => {
      const showLoading = !silent;
      if (showLoading) {
        setWorkFloorLoading(true);
      }
      if (!silent) {
        setStatus({ tone: "idle", text: "Refreshing WORK floor..." });
      }
      try {
        const apiQuote = await fetchWorkFloorQuote("livenet", fresh).catch(
          () => undefined,
        );
        if (apiQuote) {
          setWorkFloorQuote(apiQuote);
          if (!silent) {
            setStatus({
              tone: "good",
              text: `WORK floor loaded. Confirmed network value ${Math.round(apiQuote.networkValueSats).toLocaleString()} sats.`,
            });
          }
          return apiQuote;
        }

        const [registryState, computerActivity, tokenState] = await Promise.all([
          fetchIdRegistryState("livenet", fresh),
          fetchGlobalActivity("livenet", fresh).catch(() => []),
          fetchTokenState("livenet", fresh),
        ]);
        const activityForGrowth =
          computerActivity.length > 0
            ? computerActivity
            : registryState.activity;
        const actualValue = growthActualNetworkValue(
          registryState.records,
          activityForGrowth,
          registryState.sales,
          tokenState.tokens,
          tokenState.mints,
          tokenState.transfers,
          tokenState.sales,
        );
        const workToken = tokenState.tokens.find(
          (token) =>
            token.tokenId === WORK_TOKEN_ID || token.ticker === WORK_TOKEN_TICKER,
        );
        const workCreatedMs = workToken
          ? Date.parse(workToken.createdAt)
          : GROWTH_MODEL_START_MS;
        const chartPoints = growthActualValuePoints(
          registryState.records,
          activityForGrowth,
          registryState.sales,
          tokenState.tokens,
          tokenState.mints,
          tokenState.transfers,
          tokenState.sales,
          {
            startLabel: "WORK deploy",
            startMs: workCreatedMs,
          },
        ).map((point) => ({
          floorSats: point.sats / WORK_TOKEN_MAX_SUPPLY,
          label: point.label,
          networkValueSats: point.sats,
          years: point.years,
        }));
        const quote = {
          chartPoints,
          indexedAt: new Date().toISOString(),
          networkValueSats: actualValue.totalSats,
          powids: actualValue.powids,
          tokenFlowSats:
            actualValue.tokenCreationFlowSats + actualValue.tokenMintFlowSats,
        };
        setWorkFloorQuote(quote);
        if (!silent) {
          setStatus({
            tone: "good",
            text: `WORK floor loaded. Confirmed network value ${Math.round(actualValue.totalSats).toLocaleString()} sats.`,
          });
        }
        return quote;
      } catch (error) {
        if (!silent) {
          setStatus({
            tone: "bad",
            text: errorMessage(error, "WORK floor refresh failed."),
          });
        }
        return undefined;
      } finally {
        workFloorRefreshInFlightRef.current = null;
        workFloorRefreshInFlightFreshRef.current = false;
        if (showLoading) {
          setWorkFloorLoading(false);
        }
      }
    })();
    workFloorRefreshInFlightFreshRef.current = fresh;
    workFloorRefreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }

  async function refreshTokenMarketData({
    fresh = true,
    includeWorkFloor = true,
    label = "token market data",
    silent = false,
  }: {
    fresh?: boolean;
    includeWorkFloor?: boolean;
    label?: string;
    silent?: boolean;
  } = {}) {
    if (!silent) {
      setBusy(true);
      setStatus({ tone: "idle", text: `Refreshing ${label}...` });
    }

    try {
      let tokenState: PowTokenState | undefined;
      let floorQuote: WorkFloorQuote | undefined;
      if (marketplaceMode || activeFolder === "marketplace") {
        const marketplaceSummary = await refreshMarketplaceSummary(true, fresh);
        tokenState = marketplaceSummary?.token;
        floorQuote = includeWorkFloor ? marketplaceSummary?.workFloor : undefined;
      } else {
        [tokenState, , floorQuote] = await Promise.all([
          refreshToken(true, fresh),
          refreshTokenBtcUsd(fresh),
          includeWorkFloor
            ? refreshWorkFloor(true, fresh)
            : Promise.resolve(undefined),
        ]);
      }

      if (!silent) {
        if (tokenState) {
          const floorText =
            includeWorkFloor && floorQuote
              ? ` WORK floor ${Math.round(floorQuote.networkValueSats).toLocaleString()} sats.`
              : "";
          setStatus({
            tone: "good",
            text: `Token market loaded. ${tokenState.tokens.length.toLocaleString()} token${tokenState.tokens.length === 1 ? "" : "s"}, ${tokenState.listings.length.toLocaleString()} listing${tokenState.listings.length === 1 ? "" : "s"}, ${tokenState.sales.length.toLocaleString()} sale${tokenState.sales.length === 1 ? "" : "s"}.${floorText}`,
          });
        } else {
          setStatus({
            tone: "bad",
            text: "Token market refresh did not return token state.",
          });
        }
      }

      return { floorQuote, tokenState };
    } catch (error) {
      if (!silent) {
        setStatus({
          tone: "bad",
          text: errorMessage(error, "Token market refresh failed."),
        });
      }
      return { floorQuote: undefined, tokenState: undefined };
    } finally {
      if (!silent) {
        setBusy(false);
      }
    }
  }

  async function refreshGrowth(silent = false, fresh = !silent) {
    if (growthRefreshInFlightRef.current) {
      return;
    }

    growthRefreshInFlightRef.current = true;
    if (!silent) {
      setBusy(true);
    }
    if (!silent) {
      setStatus({ tone: "idle", text: "Refreshing Growth metrics..." });
    }

    try {
      const [summaryPayload, btcUsdQuote] = await Promise.all([
        fetchGrowthSummary(fresh),
        fetchBtcUsdPrice(fresh).catch(() => undefined),
      ]);
      const { activity, registry: registryState, snapshot, token: tokenState } =
        summaryPayload;
      setIdRegistry(registryState.records);
      setIdListings(registryState.listings);
      setIdPendingEvents(registryState.pendingEvents);
      setIdSales(registryState.sales);
      setIdActivity(activity.length > 0 ? activity : registryState.activity);
      setTokenDefinitions(tokenState.tokens);
      setTokenMints(tokenState.mints);
      setTokenTransfers(tokenState.transfers);
      setTokenListings(tokenState.listings);
      setTokenClosedListings(tokenState.closedListings);
      setTokenSales(tokenState.sales);
      setTokenCreationSats(tokenState.creationSats);
      setGrowthSummary(snapshot);
      if (btcUsdQuote) {
        setTokenBtcUsd(btcUsdQuote);
      }
      if (snapshot.workFloor) {
        setWorkFloorQuote(snapshot.workFloor);
      }
      if (!silent) {
        setStatus({
          tone: "good",
          text: `Growth metrics loaded. ${snapshot.counts.powids.toLocaleString()} IDs, ${snapshot.counts.confirmedComputerActions.toLocaleString()} computer action${snapshot.counts.confirmedComputerActions === 1 ? "" : "s"}, ${snapshot.counts.tokenCount.toLocaleString()} token${snapshot.counts.tokenCount === 1 ? "" : "s"}.`,
        });
      }
    } catch (error) {
      if (!silent) {
        setStatus({
          tone: "bad",
          text: errorMessage(error, "Growth metrics refresh failed."),
        });
      }
    } finally {
      growthRefreshInFlightRef.current = false;
      if (!silent) {
        setBusy(false);
      }
    }
  }

  function replyTo(message: MailMessage) {
    const recipientAddress = isInboundFolder(message.folder)
      ? message.replyTo
      : (message.recipients?.[0]?.display ?? message.to);
    const subject = messageSubject(message);
    setRecipient(recipientAddress === "Unknown" ? "" : recipientAddress);
    setCcRecipient("");
    setAmountSats(messageReplyAmount(message));
    setSubject(`Re: ${subject}`);
    setMemo("");
    setAttachment(undefined);
    setReplyParentTxid(rootTxid(message));
    setComposeOpen(true);
  }

  function replyAllTo(message: MailMessage) {
    const targets = new Map<string, string>();

    const addTarget = (display: string, addressHint = display) => {
      if (!display || display === "Unknown" || addressHint === address) {
        return;
      }

      targets.set(addressHint, display);
    };

    if (isInboundFolder(message.folder)) {
      addTarget(message.replyTo, message.replyTo);
    }

    for (const recipientItem of message.recipients ?? []) {
      addTarget(recipientItem.display, recipientItem.address);
    }

    if (
      !isInboundFolder(message.folder) &&
      (!message.recipients || message.recipients.length === 0)
    ) {
      addTarget(message.to, message.to);
    }

    const subject = messageSubject(message);
    setRecipient([...targets.values()].join(", "));
    setCcRecipient("");
    setAmountSats(messageReplyAmount(message));
    setSubject(`Re: ${subject}`);
    setMemo("");
    setAttachment(undefined);
    setReplyParentTxid(rootTxid(message));
    setComposeOpen(true);
  }

  function clearWalletSession() {
    setAddress("");
    setInbox([]);
    setChainSent([]);
    setSavedDraft(undefined);
    setSelectedKey("");
    setActiveFolder("inbox");
    setComposeOpen(true);
    setRecipient("");
    setCcRecipient("");
    setSubject("");
    setMemo(DEFAULT_MEMO);
    setAttachment(undefined);
    setReplyParentTxid(undefined);
  }

  async function attachFile(file: File) {
    setStatus({ tone: "idle", text: `Reading ${file.name}...` });

    try {
      const nextAttachment = await attachmentFromFile(file);
      setAttachment(nextAttachment);
      setStatus({
        tone: "good",
        text: `${nextAttachment.name} attached. ${formatBytes(nextAttachment.size)} before encoding.`,
      });
    } catch (error) {
      setAttachment(undefined);
      setStatus({
        tone: "bad",
        text: errorMessage(error, "Attachment could not be read."),
      });
    }
  }

  async function connectWallet() {
    if (!window.unisat) {
      setHasUnisat(false);
      setStatus({ tone: "bad", text: "UniSat is not installed." });
      return;
    }

    setBusy(true);
    setStatus({ tone: "idle", text: "Opening UniSat..." });

    try {
      const accounts = window.unisat.requestAccounts
        ? await window.unisat.requestAccounts()
        : await window.unisat.getAccounts?.();

      const firstAddress = accounts?.[0];
      if (!firstAddress) {
        throw new Error("UniSat did not return an address.");
      }

      const walletNetwork = await getWalletNetwork(window.unisat);
      if (mainnetRegistryMode) {
        if (walletNetwork !== "livenet") {
          await switchWalletNetwork(window.unisat, "livenet");
        }
        setNetwork("livenet");
      } else if (walletNetwork) {
        setNetwork(walletNetwork);
      }

      setAddress(firstAddress);
      setInbox([]);
      setChainSent([]);
      setSelectedKey("");
      setActiveFolder(
        tokenMode
            ? "token"
            : walletMode
              ? "wallet"
              : workTokenMode
                ? "work"
                : marketplaceMode
                  ? "marketplace"
                  : mainnetRegistryMode
                    ? "ids"
                    : "inbox",
      );
      setComposeOpen(false);

      try {
        if (tokenMode || walletMode || workTokenMode) {
          const state = await fetchTokenState(
            "livenet",
            false,
            workTokenMode ? WORK_TOKEN_ID : "",
          );
          setTokenDefinitions(state.tokens);
          setTokenMints(state.mints);
          setTokenTransfers(state.transfers);
          setTokenListings(state.listings);
          setTokenClosedListings(state.closedListings);
          setTokenSales(state.sales);
          setTokenCreationSats(state.creationSats);
          setStatus({
            tone: "good",
            text: `UniSat connected. Token wallet ready.`,
          });
          return;
        }

        if (mainnetRegistryMode) {
          const state = await fetchIdRegistryState("livenet");
          setIdRegistry(state.records);
          setIdListings(state.listings);
          setIdPendingEvents(state.pendingEvents);
          setIdSales(state.sales);
          setIdActivity(state.activity);
          setStatus({
            tone: "good",
            text: `UniSat connected. ProofOfWork ID registry ready.`,
          });
          return;
        }

        const scanNetwork = walletNetwork ?? network;
        const mailState = await fetchAddressMail(firstAddress, scanNetwork);
        const { inboxMessages, sentMessages } = mailState;
        setInbox(inboxMessages);
        setChainSent(sentMessages);
        setSelectedKey(selectedInboundKey("inbox", inboxMessages));
        setStatus({
          tone: "good",
          text: `UniSat connected. ${mailboxSummary(inboxMessages, sentMessages)}.`,
        });
      } catch (error) {
        setStatus({
          tone: "bad",
          text: errorMessage(
            error,
            "UniSat connected, but address scan failed.",
          ),
        });
      }
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "Could not connect UniSat."),
      });
    } finally {
      setBusy(false);
    }
  }

  async function disconnectWallet() {
    setBusy(true);
    setStatus({ tone: "idle", text: "Disconnecting UniSat..." });

    try {
      await window.unisat?.disconnect?.();
      clearWalletSession();
      setStatus({ tone: "good", text: "Wallet disconnected." });
    } catch (error) {
      clearWalletSession();
      setStatus({
        tone: "bad",
        text: `Local account cleared. ${errorMessage(error, "Wallet disconnect failed.")}`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function chooseNetwork(nextNetwork: BitcoinNetwork) {
    setNetwork(nextNetwork);
    setInbox([]);
    setChainSent([]);
    setSelectedKey("");

    if (!window.unisat?.switchChain && !window.unisat?.switchNetwork) {
      setStatus({
        tone: "idle",
        text: `${networkLabel(nextNetwork)} selected.`,
      });
      return;
    }

    setBusy(true);
    setStatus({
      tone: "idle",
      text: `Switching to ${networkLabel(nextNetwork)}...`,
    });

    try {
      await switchWalletNetwork(window.unisat, nextNetwork);
      const activeWalletNetwork =
        (await getWalletNetwork(window.unisat)) ?? nextNetwork;
      const accounts = window.unisat.getAccounts
        ? await window.unisat.getAccounts()
        : [];
      const nextAddress = accounts[0] ?? address;
      setNetwork(activeWalletNetwork);
      setAddress(nextAddress);
      setInbox([]);
      setChainSent([]);
      setSelectedKey("");

      if (!nextAddress) {
        if (rushMode) {
          const rushRegistry = rushRegistryAddressForNetwork(activeWalletNetwork);
          setRushState(
            rushRegistry
              ? await fetchRushState(activeWalletNetwork, true)
              : emptyRushState(activeWalletNetwork),
          );
        }
        setStatus({
          tone: "good",
          text: `${networkLabel(activeWalletNetwork)} ready.`,
        });
        return;
      }

      if (rushMode) {
        const rushRegistry = rushRegistryAddressForNetwork(activeWalletNetwork);
        if (!rushRegistry) {
          setRushState(emptyRushState(activeWalletNetwork));
          setStatus({
            tone: "idle",
            text: `No RUSH registry configured for ${networkLabel(activeWalletNetwork)}.`,
          });
          return;
        }
        const state = await fetchRushState(activeWalletNetwork, true);
        setRushState(state);
        setStatus({
          tone: "good",
          text: `${networkLabel(activeWalletNetwork)} ready. RUSH registry loaded.`,
        });
        return;
      }

      const mailState = await fetchAddressMail(
        nextAddress,
        activeWalletNetwork,
      );
      const { inboxMessages, sentMessages } = mailState;
      setInbox(inboxMessages);
      setChainSent(sentMessages);
      setSelectedKey(selectedInboundKey("inbox", inboxMessages));
      setStatus({
        tone: "good",
        text: `${networkLabel(activeWalletNetwork)} ready. ${mailboxSummary(inboxMessages, sentMessages)}.`,
      });
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "Network switch failed."),
      });
    } finally {
      setBusy(false);
    }
  }

  async function refreshIds(
    silent = false,
    fresh = !silent,
  ): Promise<PowRegistryState | undefined> {
    if (!registryAddress) {
      setIdRegistry([]);
      setIdListings([]);
      setIdPendingEvents([]);
      setIdSales([]);
      setIdActivity([]);
      if (!silent) {
        setStatus({
          tone: "idle",
          text: `No ProofOfWork ID registry configured for ${networkLabel(network)} yet.`,
        });
      }
      return undefined;
    }

    if (idRefreshInFlightRef.current) {
      const needsFreshRefresh = fresh && !idRefreshInFlightFreshRef.current;
      if (!silent) {
        setBusy(true);
        setStatus({
          tone: "idle",
          text: "ID registry refresh already in progress...",
        });
      }
      try {
        const state = await idRefreshInFlightRef.current;
        if (needsFreshRefresh) {
          if (!silent) {
            setStatus({
              tone: "idle",
              text: "Starting fresh ID registry refresh...",
            });
          }
          return refreshIds(silent, fresh);
        }
        if (!silent) {
          if (state) {
            const confirmed = state.records.filter(
              (record) => record.confirmed,
            ).length;
            const pending = state.records.length - confirmed;
            setStatus({
              tone: "good",
              text: `ID registry loaded. ${confirmed} confirmed, ${pending} pending, ${state.pendingEvents.length} in flight.`,
            });
          } else {
            setStatus({
              tone: "bad",
              text: "ID registry scan failed.",
            });
          }
        }
        return state;
      } finally {
        if (!silent && !needsFreshRefresh) {
          setBusy(false);
        }
      }
    }

    const refreshPromise = (async () => {
      if (!silent) {
        setBusy(true);
      }
      if (!silent) {
        setStatus({
          tone: "idle",
          text:
            activityMode || growthMode || activeFolder === "log"
              ? "Scanning ProofOfWork computer log..."
              : "Scanning ProofOfWork ID registry...",
        });
      }
      const shouldLoadComputerLog =
        activityMode || growthMode || activeFolder === "log";
      const useSummary =
        silent &&
        !shouldLoadComputerLog &&
        !marketplaceMode &&
        activeFolder !== "marketplace";
      try {
        const state = await fetchIdRegistryState(network, fresh, useSummary);
        let activity = state.activity;
        let activityLoadFailed = false;
        if (shouldLoadComputerLog) {
          try {
            const liveActivity = await fetchGlobalActivity(
              network,
              fresh,
              useSummary,
            );
            activity = liveActivity.length > 0 ? liveActivity : state.activity;
          } catch {
            activityLoadFailed = true;
          }
        }
        setIdRegistry(state.records);
        setIdListings(state.listings);
        setIdPendingEvents(state.pendingEvents);
        setIdSales(state.sales);
        setIdActivity(activity);
        setContacts((current) => {
          const nextContacts = refreshRegistryContactsFromRecords(
            current,
            state.records,
            network,
          );
          if (nextContacts !== current) {
            saveContacts(nextContacts);
          }
          return nextContacts;
        });

        if (!silent) {
          const confirmed = state.records.filter(
            (record) => record.confirmed,
          ).length;
          const pending = state.records.length - confirmed;
          const pendingChanges = state.pendingEvents.length;
          setStatus({
            tone: activityLoadFailed ? "idle" : "good",
            text: shouldLoadComputerLog
              ? activityLoadFailed
                ? `Registry loaded. Log refresh unavailable; using ${activity.length.toLocaleString()} registry action${activity.length === 1 ? "" : "s"}.`
                : `Log loaded. ${activity.length.toLocaleString()} computer action${activity.length === 1 ? "" : "s"} indexed.`
              : `ID registry loaded. ${confirmed} confirmed, ${pending} pending, ${pendingChanges} in flight.`,
          });
        }
        return state;
      } catch (error) {
        if (!silent) {
          setStatus({
            tone: "bad",
            text: errorMessage(error, "ID registry scan failed."),
          });
        }
        return undefined;
      } finally {
        idRefreshInFlightRef.current = null;
        idRefreshInFlightFreshRef.current = false;
        if (!silent) {
          setBusy(false);
        }
      }
    })();
    idRefreshInFlightFreshRef.current = fresh;
    idRefreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }

  async function registerId(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!window.unisat) {
      setStatus({ tone: "bad", text: "Connect UniSat first." });
      return;
    }

    if (!window.unisat.signPsbt) {
      setStatus({
        tone: "bad",
        text: "UniSat signPsbt is not available. Update UniSat and try again.",
      });
      return;
    }

    if (!registryAddress) {
      setStatus({
        tone: "bad",
        text: `No ProofOfWork ID registry configured for ${networkLabel(network)} yet.`,
      });
      return;
    }

    const idError = powIdError(normalizedIdName);
    if (idError) {
      setStatus({ tone: "bad", text: idError });
      return;
    }

    if (!isValidBitcoinAddress(idReceiveAddress.trim(), network)) {
      setStatus({
        tone: "bad",
        text: "Receive address is not valid for the selected network.",
      });
      return;
    }

    if (idRegistrationBytes > MAX_DATA_CARRIER_BYTES) {
      setStatus({
        tone: "bad",
        text: "ID registration OP_RETURN is over 100 KB.",
      });
      return;
    }

    setBusy(true);
    setStatus({
      tone: "idle",
      text: `Checking ${normalizedIdName}@proofofwork.me against the full registry...`,
    });

    try {
      const latestState = await fetchIdRegistryState(network, true);
      setIdRegistry(latestState.records);
      setIdListings(latestState.listings);
      setIdPendingEvents(latestState.pendingEvents);
      setIdSales(latestState.sales);

      const existingRecord = latestState.records.find(
        (record) =>
          record.network === network && record.id === normalizedIdName,
      );
      if (existingRecord?.confirmed) {
        setStatus({
          tone: "bad",
          text: `${normalizedIdName}@proofofwork.me is already registered.`,
        });
        return;
      }

      if (existingRecord) {
        setStatus({
          tone: "bad",
          text: `${normalizedIdName}@proofofwork.me is already pending. Wait for confirmation before retrying.`,
        });
        return;
      }

      setStatus({
        tone: "idle",
        text: `Registering ${normalizedIdName}@proofofwork.me...`,
      });
      const reservedOutpoints = activeListingAnchorOutpointsForAddress(
        latestState.listings,
        address,
        { network },
      );

      const currentNetwork = await getWalletNetwork(window.unisat);
      if (currentNetwork !== network) {
        await switchWalletNetwork(window.unisat, network);
      }

      const paymentPsbt = await buildPaymentPsbt({
        amountSats: ID_REGISTRATION_PRICE_SATS,
        excludeOutpoints: reservedOutpoints,
        feeRate,
        fromAddress: address,
        network,
        protocolPayloads: [idRegistrationPayload],
        requireConfirmedUtxos: true,
        toAddress: registryAddress,
      });
      if (
        !confirmDustFeeAbsorption({
          dustFeeSats: paymentPsbt.dustFeeSats,
          feeRate,
          feeSats: paymentPsbt.feeSats,
        })
      ) {
        setStatus({ tone: "idle", text: dustFeeAbsorptionCanceledText() });
        return;
      }

      const txid = await signAndBroadcastPsbt({
        inputCount: paymentPsbt.inputCount,
        network,
        psbtHex: paymentPsbt.psbtHex,
        wallet: window.unisat,
      });
      const registeredRecord: PowIdRecord = {
        amountSats: ID_REGISTRATION_PRICE_SATS,
        confirmed: false,
        createdAt: new Date().toISOString(),
        id: normalizedIdName,
        network,
        ownerAddress: address,
        pgpKey: idPgpKey.trim() || undefined,
        receiveAddress: idReceiveAddress.trim(),
        txid,
      };

      setLastRegisteredId(registeredRecord);
      setIdRegistry((current) =>
        current.some((record) => record.txid === txid)
          ? current
          : [registeredRecord, ...current],
      );
      setIdName("");
      setIdPgpKey("");
      setStatus({
        tone: "good",
        text: `${normalizedIdName}@proofofwork.me registration broadcast: ${shortAddress(txid)}.`,
      });
      await refreshIds(true);
      setIdRegistry((current) =>
        current.some((record) => record.txid === txid)
          ? current
          : [registeredRecord, ...current],
      );
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "ID registration failed."),
      });
    } finally {
      setBusy(false);
    }
  }

  async function broadcastIdMutation({
    expectedOwner,
    id,
    payload,
    successText,
  }: {
    expectedOwner: string;
    id: string;
    payload: string;
    successText: string;
  }) {
    if (!window.unisat) {
      setStatus({ tone: "bad", text: "Connect UniSat first." });
      return;
    }

    if (!window.unisat.signPsbt) {
      setStatus({
        tone: "bad",
        text: "UniSat signPsbt is not available. Update UniSat and try again.",
      });
      return;
    }

    if (!registryAddress) {
      setStatus({
        tone: "bad",
        text: `No ProofOfWork ID registry configured for ${networkLabel(network)} yet.`,
      });
      return;
    }

    if (expectedOwner !== address) {
      setStatus({
        tone: "bad",
        text: "Only the current owner address can update or transfer this ID.",
      });
      return;
    }

    if (dataCarrierBytesForPayload(payload) > MAX_DATA_CARRIER_BYTES) {
      setStatus({
        tone: "bad",
        text: "ID registry event OP_RETURN is over 100 KB.",
      });
      return;
    }

    setBusy(true);
    setStatus({
      tone: "idle",
      text: `Checking current owner for ${id}@proofofwork.me...`,
    });

    try {
      const latestState = await fetchIdRegistryState(network, true);
      setIdRegistry(latestState.records);
      setIdListings(latestState.listings);
      setIdPendingEvents(latestState.pendingEvents);
      setIdSales(latestState.sales);
      const latestRecord = latestState.records.find(
        (record) =>
          record.network === network && record.id === id && record.confirmed,
      );

      if (!latestRecord) {
        setStatus({
          tone: "bad",
          text: `${id}@proofofwork.me is not confirmed yet.`,
        });
        return;
      }

      if (latestRecord.ownerAddress !== address) {
        setStatus({
          tone: "bad",
          text: `${id}@proofofwork.me is owned by ${shortAddress(latestRecord.ownerAddress)}.`,
        });
        return;
      }

      const currentNetwork = await getWalletNetwork(window.unisat);
      if (currentNetwork !== network) {
        await switchWalletNetwork(window.unisat, network);
      }

      setStatus({ tone: "idle", text: `${successText}...` });
      const reservedOutpoints = activeListingAnchorOutpointsForAddress(
        latestState.listings,
        address,
        { network },
      );
      const paymentPsbt = await buildPaymentPsbt({
        amountSats: ID_MUTATION_PRICE_SATS,
        excludeOutpoints: reservedOutpoints,
        feeRate,
        fromAddress: address,
        network,
        protocolPayloads: [payload],
        requireConfirmedUtxos: true,
        toAddress: registryAddress,
      });
      if (
        !confirmDustFeeAbsorption({
          dustFeeSats: paymentPsbt.dustFeeSats,
          feeRate,
          feeSats: paymentPsbt.feeSats,
        })
      ) {
        setStatus({ tone: "idle", text: dustFeeAbsorptionCanceledText() });
        return;
      }

      const txid = await signAndBroadcastPsbt({
        inputCount: paymentPsbt.inputCount,
        network,
        psbtHex: paymentPsbt.psbtHex,
        wallet: window.unisat,
      });

      setStatus({
        tone: "good",
        text: `${successText} broadcast: ${shortAddress(txid)}.`,
      });
      await refreshIds(true);
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "ID registry update failed."),
      });
    } finally {
      setBusy(false);
    }
  }

  async function prepareIdSaleAuthorization() {
    if (!window.unisat) {
      throw new Error("Connect UniSat first.");
    }

    if (!managedIdRecord) {
      throw new Error("Choose one of your confirmed IDs first.");
    }

    if (managedIdRecord.ownerAddress !== address) {
      throw new Error(
        "Only the current owner can publish an on-chain listing.",
      );
    }

    if (!Number.isSafeInteger(salePriceSats) || salePriceSats < 0) {
      throw new Error("Sale price must be zero or more sats.");
    }

    if (saleBuyerAddress && !isValidBitcoinAddress(saleBuyerAddress, network)) {
      throw new Error(
        "Specific buyer address is not valid for the selected network.",
      );
    }

    if (
      saleReceiveAddress &&
      !isValidBitcoinAddress(saleReceiveAddress, network)
    ) {
      throw new Error(
        "Locked receive address is not valid for the selected network.",
      );
    }

    const latestState = await fetchIdRegistryState(network, true);
    setIdRegistry(latestState.records);
    setIdListings(latestState.listings);
    setIdPendingEvents(latestState.pendingEvents);
    setIdSales(latestState.sales);
    const latestRecord = latestState.records.find(
      (record) =>
        record.network === network &&
        record.id === managedIdRecord.id &&
        record.confirmed,
    );

    if (!latestRecord) {
      throw new Error(
        `${managedIdRecord.id}@proofofwork.me is not confirmed yet.`,
      );
    }

    if (latestRecord.ownerAddress !== address) {
      throw new Error(
        `${managedIdRecord.id}@proofofwork.me is owned by ${shortAddress(latestRecord.ownerAddress)}.`,
      );
    }

    const currentNetwork = await getWalletNetwork(window.unisat);
    if (currentNetwork !== network) {
      await switchWalletNetwork(window.unisat, network);
    }

    setStatus({ tone: "idle", text: "Preparing sale-ticket listing..." });
    const sellerPublicKey =
      (await window.unisat.getPublicKey?.())?.trim().toLowerCase() ?? "";
    if (!validPublicKeyHex(sellerPublicKey)) {
      throw new Error(
        "Could not read a seller public key from UniSat for the sale ticket.",
      );
    }

    const draft = saleAuthorizationDraft({
      anchorSigHashType: ID_LISTING_ANCHOR_SIGHASH_TYPE,
      anchorScriptPubKey: bytesToHex(
        scriptForAddress(
          latestRecord.ownerAddress,
          network,
          "Sale-ticket output",
        ),
      ),
      anchorType: ID_LISTING_TICKET_ANCHOR_TYPE,
      anchorValueSats: ID_LISTING_ANCHOR_VALUE_SATS,
      anchorVout: ID_LISTING_ANCHOR_VOUT,
      buyerAddress: saleBuyerAddress,
      id: latestRecord.id,
      nonce: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
      priceSats: salePriceSats,
      receiveAddress: saleReceiveAddress,
      sellerAddress: latestRecord.ownerAddress,
      sellerPublicKey,
      version: ID_SALE_AUTH_VERSION_TICKET,
    });

    return {
      authorization: { ...draft, signature: "" },
      reservedOutpoints: activeListingAnchorOutpointsForAddress(
        latestState.listings,
        address,
        { network },
      ),
    };
  }

  async function publishIdListing() {
    if (!window.unisat) {
      setStatus({ tone: "bad", text: "Connect UniSat first." });
      return;
    }

    if (!registryAddress) {
      setStatus({
        tone: "bad",
        text: `No ProofOfWork ID registry configured for ${networkLabel(network)} yet.`,
      });
      return;
    }

    setBusy(true);
    setStatus({
      tone: "idle",
      text: `Checking current owner for ${managedIdRecord?.id ?? "ID"}...`,
    });

    try {
      const { authorization, reservedOutpoints } =
        await prepareIdSaleAuthorization();
      setStatus({
        tone: "idle",
        text: `Listing ticket ready. Approve the on-chain listing transaction in UniSat...`,
      });
      const payload = buildIdListingPayload(authorization);
      if (dataCarrierBytesForPayload(payload) > MAX_DATA_CARRIER_BYTES) {
        setStatus({
          tone: "bad",
          text: "ID listing OP_RETURN is over 100 KB.",
        });
        return;
      }

      setStatus({
        tone: "idle",
        text: `Publishing listing for ${authorization.id}@proofofwork.me...`,
      });
      const paymentPsbt = await buildPaymentPsbt({
        amountSats: ID_MUTATION_PRICE_SATS,
        excludeOutpoints: reservedOutpoints,
        feeRate,
        fromAddress: address,
        network,
        postProtocolPayments: [
          {
            address,
            amountSats: ID_LISTING_ANCHOR_VALUE_SATS,
          },
        ],
        protocolPayloads: [payload],
        requireConfirmedUtxos: true,
        toAddress: registryAddress,
      });
      if (
        !confirmDustFeeAbsorption({
          dustFeeSats: paymentPsbt.dustFeeSats,
          feeRate,
          feeSats: paymentPsbt.feeSats,
        })
      ) {
        setStatus({ tone: "idle", text: dustFeeAbsorptionCanceledText() });
        return;
      }

      const txid = await signAndBroadcastPsbt({
        inputCount: paymentPsbt.inputCount,
        network,
        psbtHex: paymentPsbt.psbtHex,
        wallet: window.unisat,
      });

      setIdSaleAuthorization(JSON.stringify(authorization, null, 2));
      setStatus({
        tone: "good",
        text: `${authorization.id}@proofofwork.me sale ticket broadcast: ${shortAddress(txid)}. After it confirms, seal it so buyers can settle atomically.`,
      });
      await refreshIds(true);
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "ID listing failed."),
      });
    } finally {
      setBusy(false);
    }
  }

  async function sealIdListing(listing: PowIdListing) {
    if (!window.unisat) {
      setStatus({ tone: "bad", text: "Connect UniSat first." });
      return;
    }

    if (!window.unisat.signPsbt) {
      setStatus({
        tone: "bad",
        text: "UniSat signPsbt is not available. Update UniSat and try again.",
      });
      return;
    }

    if (!registryAddress) {
      setStatus({
        tone: "bad",
        text: `No ProofOfWork ID registry configured for ${networkLabel(network)} yet.`,
      });
      return;
    }

    if (listing.sellerAddress !== address) {
      setStatus({
        tone: "bad",
        text: "Only the current listing seller can seal this sale ticket.",
      });
      return;
    }

    if (listing.listingVersion !== "list5") {
      setStatus({
        tone: "bad",
        text: "Only sale-ticket listings need sealing.",
      });
      return;
    }

    if (saleAuthorizationUsesSaleTicketAnchor(listing.saleAuthorization)) {
      setStatus({ tone: "good", text: "This sale ticket is already sealed." });
      return;
    }

    setBusy(true);
    setStatus({
      tone: "idle",
      text: `Checking sale ticket for ${listing.id}@proofofwork.me...`,
    });

    try {
      const latestState = await fetchIdRegistryState(network, true);
      setIdRegistry(latestState.records);
      setIdListings(latestState.listings);
      setIdPendingEvents(latestState.pendingEvents);
      setIdSales(latestState.sales);
      const latestListing = latestState.listings.find(
        (item) =>
          item.listingId === listing.listingId && item.network === network,
      );
      const latestRecord = latestState.records.find(
        (record) =>
          record.network === network &&
          record.id === listing.id &&
          record.confirmed,
      );

      if (!latestListing || latestListing.listingVersion !== "list5") {
        setStatus({
          tone: "bad",
          text: "This sale-ticket listing is no longer active.",
        });
        return;
      }

      if (!latestRecord || latestRecord.ownerAddress !== address) {
        setStatus({
          tone: "bad",
          text: `${listing.id}@proofofwork.me is no longer owned by this wallet.`,
        });
        return;
      }

      const currentNetwork = await getWalletNetwork(window.unisat);
      if (currentNetwork !== network) {
        await switchWalletNetwork(window.unisat, network);
      }

      setStatus({
        tone: "idle",
        text: "Approve the sale-ticket seal in UniSat. This signature is published on-chain.",
      });
      const anchorSignature = await signSaleTicketAuthorization({
        listing: latestListing,
        network,
        wallet: window.unisat,
      });
      const sealedAuthorization: PowIdSaleAuthorization = {
        ...latestListing.saleAuthorization,
        anchorSignature,
        anchorTxid: latestListing.listingId,
      };
      const payload = buildIdSaleSealPayload(
        latestListing.listingId,
        sealedAuthorization,
      );
      if (dataCarrierBytesForPayload(payload) > MAX_DATA_CARRIER_BYTES) {
        setStatus({
          tone: "bad",
          text: "ID sale-ticket seal OP_RETURN is over 100 KB.",
        });
        return;
      }

      setStatus({
        tone: "idle",
        text: `Publishing sale-ticket seal for ${listing.id}@proofofwork.me...`,
      });
      const anchor = listingAnchorOutpoint(latestListing);
      const reservedOutpoints = activeListingAnchorOutpointsForAddress(
        latestState.listings,
        address,
        {
          exceptListingId: latestListing.listingId,
          network,
        },
      );
      const paymentPsbt = await buildPaymentPsbt({
        amountSats: ID_MUTATION_PRICE_SATS,
        excludeOutpoints: [...reservedOutpoints, ...(anchor ? [anchor] : [])],
        feeRate,
        fromAddress: address,
        network,
        protocolPayloads: [payload],
        requireConfirmedUtxos: true,
        toAddress: registryAddress,
      });
      if (
        !confirmDustFeeAbsorption({
          dustFeeSats: paymentPsbt.dustFeeSats,
          feeRate,
          feeSats: paymentPsbt.feeSats,
        })
      ) {
        setStatus({ tone: "idle", text: dustFeeAbsorptionCanceledText() });
        return;
      }

      const txid = await signAndBroadcastPsbt({
        inputCount: paymentPsbt.inputCount,
        network,
        psbtHex: paymentPsbt.psbtHex,
        wallet: window.unisat,
      });

      setIdSaleAuthorization(JSON.stringify(sealedAuthorization, null, 2));
      setStatus({
        tone: "good",
        text: `${listing.id}@proofofwork.me sale ticket sealed: ${shortAddress(txid)}.`,
      });
      await refreshIds(true);
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "ID sale-ticket seal failed."),
      });
    } finally {
      setBusy(false);
    }
  }

  async function delistIdListing(listing: PowIdListing) {
    if (!window.unisat) {
      setStatus({ tone: "bad", text: "Connect UniSat first." });
      return;
    }

    if (!window.unisat.signPsbt) {
      setStatus({
        tone: "bad",
        text: "UniSat signPsbt is not available. Update UniSat and try again.",
      });
      return;
    }

    if (!registryAddress) {
      setStatus({
        tone: "bad",
        text: `No ProofOfWork ID registry configured for ${networkLabel(network)} yet.`,
      });
      return;
    }

    if (listing.sellerAddress !== address) {
      setStatus({
        tone: "bad",
        text: "Only the current listing seller can delist this ID.",
      });
      return;
    }

    if (
      listing.listingVersion === "list3" ||
      listing.listingVersion === "list5"
    ) {
      const payload = buildIdDelistingPayload(
        listing.listingId,
        listing.listingVersion === "list5" ? "delist5" : "delist3",
      );
      if (dataCarrierBytesForPayload(payload) > MAX_DATA_CARRIER_BYTES) {
        setStatus({
          tone: "bad",
          text: "ID delisting OP_RETURN is over 100 KB.",
        });
        return;
      }

      setBusy(true);
      setStatus({
        tone: "idle",
        text: `Closing sale ticket for ${listing.id}@proofofwork.me...`,
      });

      try {
        const latestState = await fetchIdRegistryState(network, true);
        setIdRegistry(latestState.records);
        setIdListings(latestState.listings);
        setIdPendingEvents(latestState.pendingEvents);
        setIdSales(latestState.sales);
        const latestListing = latestState.listings.find(
          (item) =>
            item.listingId === listing.listingId && item.network === network,
        );
        const latestRecord = latestState.records.find(
          (record) =>
            record.network === network &&
            record.id === listing.id &&
            record.confirmed,
        );

        if (
          !latestListing ||
          latestListing.listingVersion !== listing.listingVersion
        ) {
          setStatus({ tone: "bad", text: "This listing is no longer active." });
          return;
        }

        if (!latestRecord || latestRecord.ownerAddress !== address) {
          setStatus({
            tone: "bad",
            text: `${listing.id}@proofofwork.me is no longer owned by this wallet.`,
          });
          return;
        }

        const currentNetwork = await getWalletNetwork(window.unisat);
        if (currentNetwork !== network) {
          await switchWalletNetwork(window.unisat, network);
        }

        const reservedOutpoints = activeListingAnchorOutpointsForAddress(
          latestState.listings,
          address,
          {
            exceptListingId: latestListing.listingId,
            network,
          },
        );
        const paymentPsbt = await buildAnchoredMarketplacePsbt({
          anchorSpendMode:
            listing.listingVersion === "list5" ? "wallet" : "preSigned",
          excludeOutpoints: reservedOutpoints,
          feeRate,
          fromAddress: address,
          listing: latestListing,
          network,
          payments: [
            {
              address: latestListing.sellerAddress,
              amountSats:
                latestListing.anchorValueSats ?? ID_LISTING_ANCHOR_VALUE_SATS,
            },
            {
              address: registryAddress,
              amountSats: ID_MUTATION_PRICE_SATS,
            },
          ],
          protocolPayloads: [payload],
          requireConfirmedUtxos: true,
        });
        if (
          !confirmDustFeeAbsorption({
            dustFeeSats: paymentPsbt.dustFeeSats,
            feeRate,
            feeSats: paymentPsbt.feeSats,
          })
        ) {
          setStatus({ tone: "idle", text: dustFeeAbsorptionCanceledText() });
          return;
        }

        const txid = await signAndBroadcastPsbt({
          inputCount: paymentPsbt.inputCount,
          network,
          psbtHex: paymentPsbt.psbtHex,
          signInputIndexes: paymentPsbt.walletInputIndexes,
          signingAddress: address,
          wallet: window.unisat,
        });

        setStatus({
          tone: "good",
          text: `Delisting for ${listing.id}@proofofwork.me broadcast: ${shortAddress(txid)}.`,
        });
        await refreshIds(true);
      } catch (error) {
        setStatus({
          tone: "bad",
          text: errorMessage(error, "ID delisting failed."),
        });
      } finally {
        setBusy(false);
      }
      return;
    }

    await broadcastIdMutation({
      expectedOwner: listing.sellerAddress,
      id: listing.id,
      payload: buildIdDelistingPayload(
        listing.listingId,
        listing.listingVersion === "list4" ? "delist4" : "delist2",
      ),
      successText: `Delisting for ${listing.id}@proofofwork.me`,
    });
  }

  async function purchaseId(
    event?: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement>,
  ) {
    event?.preventDefault();

    if (!window.unisat) {
      setStatus({ tone: "bad", text: "Connect UniSat first." });
      return;
    }

    if (!window.unisat.signPsbt) {
      setStatus({
        tone: "bad",
        text: "UniSat signPsbt is not available. Update UniSat and try again.",
      });
      return;
    }

    if (!registryAddress) {
      setStatus({
        tone: "bad",
        text: `No ProofOfWork ID registry configured for ${networkLabel(network)} yet.`,
      });
      return;
    }

    let authorization: PowIdSaleAuthorization;
    try {
      authorization = parseSaleAuthorizationText(
        idSaleAuthorization.trim(),
        network,
      );
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "Listing authorization is invalid."),
      });
      return;
    }

    const ownerAddress = idPurchaseOwnerAddress.trim();
    const receiveAddress = idPurchaseReceiveAddress.trim();
    const effectiveReceiveAddress = receiveAddress || ownerAddress;

    if (!saleAuthorizationCanBroadcast(authorization)) {
      setStatus({
        tone: "bad",
        text: "Select an active on-chain listing first.",
      });
      return;
    }

    const selectedListing = selectedMarketplaceListing;
    if (!selectedListing || !listingCanBePurchased(selectedListing)) {
      setStatus({
        tone: "bad",
        text: "Select an active on-chain listing first.",
      });
      return;
    }

    if (!isValidBitcoinAddress(ownerAddress, network)) {
      setStatus({
        tone: "bad",
        text: "New owner address is not valid for the selected network.",
      });
      return;
    }

    if (receiveAddress && !isValidBitcoinAddress(receiveAddress, network)) {
      setStatus({
        tone: "bad",
        text: "New receive address is not valid for the selected network.",
      });
      return;
    }

    if (
      authorization.buyerAddress &&
      authorization.buyerAddress !== ownerAddress
    ) {
      setStatus({
        tone: "bad",
        text: `This sale is locked to ${shortAddress(authorization.buyerAddress)}.`,
      });
      return;
    }

    if (
      authorization.receiveAddress &&
      authorization.receiveAddress !== effectiveReceiveAddress
    ) {
      setStatus({
        tone: "bad",
        text: `This sale is locked to receive at ${shortAddress(authorization.receiveAddress)}.`,
      });
      return;
    }

    const payload = buildIdMarketplaceTransferPayload(
      selectedListing.listingId,
      ownerAddress,
      receiveAddress,
      marketplaceTransferVersionForListing(selectedListing),
    );
    if (dataCarrierBytesForPayload(payload) > MAX_DATA_CARRIER_BYTES) {
      setStatus({
        tone: "bad",
        text: "ID marketplace transfer OP_RETURN is over 100 KB.",
      });
      return;
    }

    setBusy(true);
    setStatus({
      tone: "idle",
      text: `Checking ${authorization.id}@proofofwork.me listing terms...`,
    });

    try {
      const latestState = await fetchIdRegistryState(network, true);
      setIdRegistry(latestState.records);
      setIdListings(latestState.listings);
      setIdPendingEvents(latestState.pendingEvents);
      setIdSales(latestState.sales);
      const latestListing = latestState.listings.find(
        (listing) =>
          listing.network === network &&
          listing.listingId === selectedListing.listingId,
      );
      const latestRecord = latestState.records.find(
        (record) =>
          record.network === network &&
          record.id === authorization.id &&
          record.confirmed,
      );

      if (!latestRecord) {
        setStatus({
          tone: "bad",
          text: `${authorization.id}@proofofwork.me is not confirmed yet.`,
        });
        return;
      }

      if (!latestListing || !listingCanBePurchased(latestListing)) {
        setStatus({ tone: "bad", text: "This listing is no longer active." });
        return;
      }

      if (latestRecord.ownerAddress !== latestListing.sellerAddress) {
        setStatus({
          tone: "bad",
          text: `${authorization.id}@proofofwork.me is no longer owned by this seller.`,
        });
        return;
      }

      const currentNetwork = await getWalletNetwork(window.unisat);
      if (currentNetwork !== network) {
        await switchWalletNetwork(window.unisat, network);
      }

      const payments: PaymentOutputSpec[] = [
        {
          address: latestListing.sellerAddress,
          amountSats: sellerPaymentRequiredSats(latestListing),
        },
        {
          address: registryAddress,
          amountSats: ID_MUTATION_PRICE_SATS,
        },
      ];

      setStatus({
        tone: "idle",
        text: `Buying ${authorization.id}@proofofwork.me...`,
      });
      const reservedOutpoints = activeListingAnchorOutpointsForAddress(
        latestState.listings,
        address,
        {
          exceptListingId: latestListing.listingId,
          network,
        },
      );
      const paymentPsbt = await buildAnchoredMarketplacePsbt({
        excludeOutpoints: reservedOutpoints,
        feeRate,
        fromAddress: address,
        listing: latestListing,
        network,
        payments,
        protocolPayloads: [payload],
        requireConfirmedUtxos: true,
      });
      if (
        !confirmDustFeeAbsorption({
          dustFeeSats: paymentPsbt.dustFeeSats,
          feeRate,
          feeSats: paymentPsbt.feeSats,
        })
      ) {
        setStatus({ tone: "idle", text: dustFeeAbsorptionCanceledText() });
        return;
      }

      const txid = await signAndBroadcastPsbt({
        inputCount: paymentPsbt.inputCount,
        network,
        psbtHex: paymentPsbt.psbtHex,
        signInputIndexes: paymentPsbt.walletInputIndexes,
        signingAddress: address,
        wallet: window.unisat,
      });

      setStatus({
        tone: "good",
        text: `${authorization.id}@proofofwork.me purchase broadcast: ${shortAddress(txid)}.`,
      });
      setPurchaseReceipt({
        amountLabel: "1 ID",
        assetLabel: `${authorization.id}@proofofwork.me`,
        buyerAddress: ownerAddress,
        kind: "id",
        listingId: latestListing.listingId,
        network,
        priceSats: latestListing.priceSats,
        sellerAddress: latestListing.sellerAddress,
        txid,
      });
      setIdSaleAuthorization("");
      setIdSelectedListingId("");
      setIdPurchaseReceiveAddress("");
      await refreshIds(true);
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "ID purchase failed."),
      });
    } finally {
      setBusy(false);
    }
  }

  async function updateIdReceiver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!managedIdRecord) {
      setStatus({
        tone: "bad",
        text: "Choose one of your confirmed IDs first.",
      });
      return;
    }

    const receiveInput = idUpdateReceiveAddress.trim();
    if (!receiveInput) {
      setStatus({
        tone: "bad",
        text: "Enter a new receive address or confirmed ProofOfWork ID.",
      });
      return;
    }

    let latestRegistry = idRegistry;
    let resolvedReceive = resolveRecipientInput(
      receiveInput,
      network,
      latestRegistry,
      registryAddress,
    );
    if (!isValidBitcoinAddress(receiveInput, network)) {
      const latestState = await fetchIdRegistryState(network, true);
      latestRegistry = latestState.records;
      setIdRegistry(latestState.records);
      setIdListings(latestState.listings);
      setIdPendingEvents(latestState.pendingEvents);
      setIdSales(latestState.sales);
      resolvedReceive = resolveRecipientInput(
        receiveInput,
        network,
        latestRegistry,
        registryAddress,
      );
    }

    const receiveAddress = resolvedReceive.paymentAddress;
    if (
      resolvedReceive.error ||
      !isValidBitcoinAddress(receiveAddress, network)
    ) {
      setStatus({
        tone: "bad",
        text:
          resolvedReceive.error ||
          "New receive address is not valid for the selected network.",
      });
      return;
    }

    if (receiveAddress === managedIdRecord.receiveAddress) {
      setStatus({
        tone: "bad",
        text: `${managedIdRecord.id}@proofofwork.me already receives at that address.`,
      });
      return;
    }

    await broadcastIdMutation({
      expectedOwner: managedIdRecord.ownerAddress,
      id: managedIdRecord.id,
      payload: buildIdReceiverUpdatePayload(managedIdRecord.id, receiveAddress),
      successText: `Receiver update for ${managedIdRecord.id}@proofofwork.me`,
    });
  }

  async function transferId(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!managedIdRecord) {
      setStatus({
        tone: "bad",
        text: "Choose one of your confirmed IDs first.",
      });
      return;
    }

    const receiveInput = idTransferReceiveAddress.trim();

    let latestRegistry = idRegistry;
    let resolvedOwner = transferOwnerResolution;
    let resolvedReceive = receiveInput
      ? resolveRecipientInput(
          receiveInput,
          network,
          latestRegistry,
          registryAddress,
        )
      : undefined;
    if (
      !isValidBitcoinAddress(idTransferOwnerAddress.trim(), network) ||
      (receiveInput && !isValidBitcoinAddress(receiveInput, network))
    ) {
      const latestState = await fetchIdRegistryState(network, true);
      latestRegistry = latestState.records;
      setIdRegistry(latestState.records);
      setIdListings(latestState.listings);
      setIdPendingEvents(latestState.pendingEvents);
      setIdSales(latestState.sales);
      resolvedOwner = resolvePowIdOwnerInput(
        idTransferOwnerAddress,
        network,
        latestRegistry,
        registryAddress,
      );
      resolvedReceive = receiveInput
        ? resolveRecipientInput(
            receiveInput,
            network,
            latestRegistry,
            registryAddress,
          )
        : undefined;
    }

    const latestOwnerAddress = resolvedOwner.ownerAddress;
    const effectiveReceiveAddress = resolvedReceive
      ? resolvedReceive.paymentAddress
      : resolvedOwner.receiveAddress;
    const payloadReceiveAddress =
      effectiveReceiveAddress && effectiveReceiveAddress !== latestOwnerAddress
        ? effectiveReceiveAddress
        : "";

    if (
      resolvedOwner.error ||
      !latestOwnerAddress ||
      !isValidBitcoinAddress(latestOwnerAddress, network)
    ) {
      setStatus({
        tone: "bad",
        text:
          resolvedOwner.error ||
          "New owner is not valid for the selected network.",
      });
      return;
    }

    if (resolvedReceive?.error) {
      setStatus({ tone: "bad", text: resolvedReceive.error });
      return;
    }

    if (!isValidBitcoinAddress(effectiveReceiveAddress, network)) {
      setStatus({
        tone: "bad",
        text: "New receive address is not valid for the selected network.",
      });
      return;
    }

    if (
      latestOwnerAddress === managedIdRecord.ownerAddress &&
      effectiveReceiveAddress === managedIdRecord.receiveAddress
    ) {
      setStatus({
        tone: "bad",
        text: "Transfer destination matches the current ID state.",
      });
      return;
    }

    await broadcastIdMutation({
      expectedOwner: managedIdRecord.ownerAddress,
      id: managedIdRecord.id,
      payload: buildIdTransferPayload(
        managedIdRecord.id,
        latestOwnerAddress,
        payloadReceiveAddress,
      ),
      successText: `Transfer for ${managedIdRecord.id}@proofofwork.me`,
    });

    setIdTransferOwnerAddress("");
    setIdTransferReceiveAddress("");
  }

  async function sendOpReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!window.unisat) {
      setStatus({ tone: "bad", text: "Connect UniSat first." });
      return;
    }

    if (!window.unisat.signPsbt) {
      setStatus({
        tone: "bad",
        text: "UniSat signPsbt is not available. Update UniSat and try again.",
      });
      return;
    }

    if (dataCarrierBytes > MAX_DATA_CARRIER_BYTES) {
      setStatus({
        tone: "bad",
        text: "Aggregate OP_RETURN data-carrier scripts are over 100 KB.",
      });
      return;
    }

    let resolvedRecipients = recipientResolution;
    let resolvedCcRecipients = ccRecipientResolution;
    const recipientInput = recipient.trim();
    const ccRecipientInput = ccRecipient.trim();
    const shouldResolveId =
      needsRegistryResolution(recipientInput, network) ||
      needsRegistryResolution(ccRecipientInput, network);

    setBusy(true);
    setStatus({
      tone: "idle",
      text: shouldResolveId
        ? "Checking ProofOfWork ID registry..."
        : "Building PSBT...",
    });

    try {
      if (shouldResolveId) {
        if (!registryAddress) {
          setStatus({
            tone: "bad",
            text: `ProofOfWork ID registry is not configured for ${networkLabel(network)}.`,
          });
          return;
        }

        const records = await fetchIdRegistry(network);
        setIdRegistry(records);
        resolvedRecipients = resolveRecipientInputs(
          recipientInput,
          network,
          records,
          registryAddress,
        );
        resolvedCcRecipients = resolveRecipientInputs(
          ccRecipientInput,
          network,
          records,
          registryAddress,
        );
      }

      if (
        resolvedRecipients.error ||
        resolvedRecipients.recipients.length === 0
      ) {
        setStatus({
          tone: "bad",
          text:
            resolvedRecipients.error ||
            "Enter a valid Bitcoin address or confirmed ProofOfWork ID.",
        });
        return;
      }

      if (resolvedCcRecipients.error) {
        setStatus({ tone: "bad", text: resolvedCcRecipients.error });
        return;
      }

      if (
        resolvedRecipients.recipients.length +
          resolvedCcRecipients.recipients.length >
        MAX_RECIPIENTS
      ) {
        setStatus({
          tone: "bad",
          text: `Send to ${MAX_RECIPIENTS} recipients or fewer for now.`,
        });
        return;
      }

      setStatus({ tone: "idle", text: "Building PSBT..." });
      const currentNetwork = await getWalletNetwork(window.unisat);
      if (currentNetwork !== network) {
        await switchWalletNetwork(window.unisat, network);
      }

      let reservedOutpoints: PowIdSpentOutpoint[] = [];
      if (registryAddress) {
        const latestState = await fetchIdRegistryState(network, true);
        setIdRegistry(latestState.records);
        setIdListings(latestState.listings);
        setIdPendingEvents(latestState.pendingEvents);
        setIdSales(latestState.sales);
        reservedOutpoints = activeListingAnchorOutpointsForAddress(
          latestState.listings,
          address,
          { network },
        );
      }

      const satoshis = Math.floor(amountSats);
      const toRecipients: MailRecipient[] = resolvedRecipients.recipients.map(
        (resolved) => ({
          address: resolved.paymentAddress,
          amountSats: satoshis,
          display: resolved.isId
            ? resolved.displayRecipient
            : resolved.paymentAddress,
          id: resolved.id,
        }),
      );
      const seenAddresses = new Set(
        toRecipients.map((mailRecipient) => mailRecipient.address),
      );
      const ccRecipients: MailRecipient[] =
        resolvedCcRecipients.recipients.flatMap((resolved): MailRecipient[] => {
          if (seenAddresses.has(resolved.paymentAddress)) {
            return [];
          }

          seenAddresses.add(resolved.paymentAddress);
          return [
            {
              address: resolved.paymentAddress,
              amountSats: satoshis,
              display: resolved.isId
                ? resolved.displayRecipient
                : resolved.paymentAddress,
              id: resolved.id,
            },
          ];
        });
      const mailRecipients = [...toRecipients, ...ccRecipients];
      const paymentPsbt = await buildPaymentPsbt({
        excludeOutpoints: reservedOutpoints,
        feeRate,
        fromAddress: address,
        network,
        payments: mailRecipients.map((mailRecipient) => ({
          address: mailRecipient.address,
          amountSats: mailRecipient.amountSats,
        })),
        protocolPayloads,
      });
      if (
        !confirmDustFeeAbsorption({
          dustFeeSats: paymentPsbt.dustFeeSats,
          feeRate,
          feeSats: paymentPsbt.feeSats,
        })
      ) {
        setStatus({ tone: "idle", text: dustFeeAbsorptionCanceledText() });
        return;
      }

      setStatus({
        tone: "idle",
        text: `Waiting for UniSat signature. Fee estimate: ${paymentPsbt.feeSats.toLocaleString()} sats.`,
      });

      const txid = await signAndBroadcastPsbt({
        inputCount: paymentPsbt.inputCount,
        network,
        psbtHex: paymentPsbt.psbtHex,
        wallet: window.unisat,
      });

      const sentMessage: SentMessage = {
        txid,
        network,
        from: address,
        to: recipientSummary(toRecipients, recipientInput),
        recipients: mailRecipients,
        toRecipients,
        ccRecipients: ccRecipients.length > 0 ? ccRecipients : undefined,
        amountSats: totalRecipientSats(mailRecipients),
        feeRate,
        subject: normalizeSubject(subject) || undefined,
        memo,
        attachment,
        status: "pending",
        lastCheckedAt: new Date().toISOString(),
        replyTo: address,
        parentTxid: replyParentTxid,
        createdAt: new Date().toISOString(),
      };

      clearDraft(address, network);
      setSavedDraft(undefined);
      setAllSent((current) => [sentMessage, ...current]);
      setActiveFolder("outbox");
      setComposeOpen(false);
      setAttachment(undefined);
      setCcRecipient("");
      setSubject("");
      setReplyParentTxid(undefined);
      setSelectedKey(`sent-${network}-${txid}`);
      setStatus({
        tone: "good",
        text: `Transaction broadcast to ${mailRecipients.length} recipient${mailRecipients.length === 1 ? "" : "s"}. ${paymentPsbt.inputCount} input${paymentPsbt.inputCount === 1 ? "" : "s"}, ${paymentPsbt.outputCount} output${paymentPsbt.outputCount === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "Transaction failed."),
      });
    } finally {
      setBusy(false);
    }
  }

  async function refreshMail(nextFolder: Folder = activeFolder) {
    if (!address) {
      setStatus({ tone: "bad", text: "Connect UniSat first." });
      return;
    }

    setBusy(true);
    setRefreshing(true);
    setCheckingBroadcasts(true);
    setStatus({
      tone: "idle",
      text: "Refreshing mail and transaction statuses...",
    });

    try {
      const mailState = await fetchAddressMail(address, network);
      const { inboxMessages, sentMessages } = mailState;
      const targets = broadcastTargetsFor(
        address,
        network,
        allSentRef.current,
        sentMessages,
      );
      const summary = targets.length
        ? await checkBroadcastTargets(targets)
        : undefined;
      const checkedSentMessages = summary
        ? applyBroadcastCheckResults(sentMessages, summary)
        : sentMessages;

      setInbox(inboxMessages);
      setChainSent(checkedSentMessages);
      if (summary) {
        setAllSent((current) => applyBroadcastCheckResults(current, summary));
      }

      setActiveFolder(nextFolder);
      if (nextFolder !== "drafts") {
        setComposeOpen(false);
      }
      setSelectedKey(selectedInboundKey(nextFolder, inboxMessages));
      setStatus({
        tone:
          summary && summary.failed === summary.results.length ? "bad" : "good",
        text: `Refreshed. ${mailboxSummary(inboxMessages, checkedSentMessages)}${
          summary ? `. ${broadcastCheckSummaryText(summary)}` : ""
        }.`,
      });
    } catch (error) {
      setStatus({ tone: "bad", text: errorMessage(error, "Refresh failed.") });
    } finally {
      setCheckingBroadcasts(false);
      setRefreshing(false);
      setBusy(false);
    }
  }

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!window.unisat) {
      setStatus({ tone: "bad", text: "Connect UniSat first." });
      return;
    }

    if (!window.unisat.signPsbt) {
      setStatus({
        tone: "bad",
        text: "UniSat signPsbt is not available. Update UniSat and try again.",
      });
      return;
    }

    if (network !== "livenet" || !tokenIndexAddress) {
      setStatus({ tone: "bad", text: "Token creation is mainnet only." });
      return;
    }

    const ticker = normalizedTokenTicker;
    const maxSupply = Math.floor(tokenCreateMaxSupply);
    const mintAmount = Math.floor(tokenCreateMintAmount);
    const mintPriceSats = Math.floor(tokenCreateMintPriceSats);
    const registryAddress = tokenResolvedRegistryAddress;
    const registryError = tokenRegistryResolution.error?.replace(
      "before sending to this ID",
      "before using it as a token registry",
    );
    const reservationError = tokenTickerReservationError(ticker);
    if (
      !ticker ||
      reservationError ||
      !Number.isSafeInteger(maxSupply) ||
      maxSupply < 1 ||
      !Number.isSafeInteger(mintAmount) ||
      mintAmount < 1 ||
      mintAmount > maxSupply ||
      !Number.isSafeInteger(mintPriceSats) ||
      mintPriceSats < TOKEN_MIN_MUTATION_PRICE_SATS ||
      !registryAddress ||
      tokenRegistryResolution.error
    ) {
      setStatus({
        tone: "bad",
        text:
          reservationError ||
          registryError ||
          "Token creation fields are invalid.",
      });
      return;
    }

    if (tokenCreateBytes > MAX_DATA_CARRIER_BYTES) {
      setStatus({
        tone: "bad",
        text: "Token create OP_RETURN is over 100 KB.",
      });
      return;
    }

    setTokenAction("create");
    setBusy(true);
    setStatus({ tone: "idle", text: `Creating ${ticker} token...` });

    try {
      const currentNetwork = await getWalletNetwork(window.unisat);
      if (currentNetwork !== "livenet") {
        await switchWalletNetwork(window.unisat, "livenet");
      }

      const paymentPsbt = await buildPaymentPsbt({
        amountSats: TOKEN_CREATION_PRICE_SATS,
        excludeOutpoints: activeTokenListingAnchorOutpointsForAddress(
          tokenListings,
          address,
          { network: "livenet" },
        ),
        feeRate,
        fromAddress: address,
        network: "livenet",
        protocolPayloads: [
          buildTokenCreatePayload({
            maxSupply,
            mintAmount,
            mintPriceSats,
            registryAddress,
            ticker,
          }),
        ],
        requireConfirmedUtxos: true,
        toAddress: tokenIndexAddress,
      });
      if (
        !confirmDustFeeAbsorption({
          dustFeeSats: paymentPsbt.dustFeeSats,
          feeRate,
          feeSats: paymentPsbt.feeSats,
        })
      ) {
        setStatus({ tone: "idle", text: dustFeeAbsorptionCanceledText() });
        return;
      }

      const txid = await signAndBroadcastPsbt({
        inputCount: paymentPsbt.inputCount,
        network: "livenet",
        psbtHex: paymentPsbt.psbtHex,
        wallet: window.unisat,
      });
      const token: PowTokenDefinition = {
        confirmed: false,
        createdAt: new Date().toISOString(),
        creatorAddress: address,
        creationFeeSats: TOKEN_CREATION_PRICE_SATS,
        maxSupply,
        mintAmount,
        mintPriceSats,
        network: "livenet",
        registryAddress,
        ticker,
        tokenId: txid,
        txid,
      };

      setTokenDefinitions((current) =>
        current.some((item) => item.tokenId === txid)
          ? current
          : [token, ...current],
      );
      setTokenCreationSats((current) => current + TOKEN_CREATION_PRICE_SATS);
      setTokenSelectedId(txid);
      setStatus({
        tone: "good",
        text: `${ticker} create broadcast: ${shortAddress(txid)}.`,
      });
      void refreshToken(true);
      setTokenDefinitions((current) =>
        current.some((item) => item.tokenId === txid)
          ? current
          : [token, ...current],
      );
      setTokenSelectedId(txid);
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "Token creation failed."),
      });
    } finally {
      setTokenAction("");
      setBusy(false);
    }
  }

  async function runTokenChainedMint({
    count,
    delayMs,
    mintPayloadBytes,
    onBroadcast,
    requireActive,
    token,
  }: {
    count: number;
    delayMs: number;
    mintPayloadBytes: number;
    onBroadcast?: (completed: number, txid: string) => void;
    requireActive: () => boolean;
    token: PowTokenDefinition;
  }) {
    const wallet = window.unisat;
    if (!wallet?.signPsbt) {
      throw new Error("UniSat signPsbt is not available.");
    }
    const currentNetwork = await getWalletNetwork(wallet);
    if (currentNetwork !== "livenet") {
      await switchWalletNetwork(wallet, "livenet");
    }

    const total = Math.min(
      CHAINED_MINT_MAX_COUNT,
      Math.max(1, Math.floor(count)),
    );
    const payload = buildTokenMintPayload(token.tokenId, token.mintAmount);
    const opReturnScripts = protocolOutputScripts([payload]);
    const registryScript = scriptForAddress(
      token.registryAddress,
      "livenet",
      `${token.ticker} registry`,
    );
    const changeScript = scriptForAddress(
      address,
      "livenet",
      "Connected wallet",
    );
    const fixedOutputVbytes =
      outputVbytesForScript(registryScript) +
      opReturnScripts.reduce(
        (totalVbytes, script) => totalVbytes + outputVbytesForScript(script),
        0,
      );
    const changeOutputVbytes = outputVbytesForScript(changeScript);
    const estimatedFeePerMint = Math.ceil(
      estimateTxVbytes(1, fixedOutputVbytes + changeOutputVbytes) * feeRate,
    );
    const initialInputs = await selectChainedInitialInputs({
      excludeOutpoints: activeTokenListingAnchorOutpointsForAddress(
        tokenListings,
        address,
        { network: "livenet" },
      ),
      feeRate,
      fromAddress: address,
      network: "livenet",
      totalRequiredSats:
        total * token.mintPriceSats + total * estimatedFeePerMint + DUST_SATS,
    });

    const result = await executeChainedMintRun<ChainedMintInput, PowTokenMint>({
      buildAndBroadcastStep: async ({ currentInputs, index, isLast }) => {
        const paymentPsbt = buildChainedMintPsbt({
          feeRate,
          fixedOutputs: [
            {
              address: token.registryAddress,
              amountSats: token.mintPriceSats,
            },
            { amountSats: 0, script: opReturnScripts[0] },
          ],
          fromAddress: address,
          inputs: currentInputs,
          isLast,
          network: "livenet",
        });
        if (
          paymentPsbt.dustFeeSats > 0 &&
          !confirmDustFeeAbsorption({
            dustFeeSats: paymentPsbt.dustFeeSats,
            feeRate,
            feeSats: paymentPsbt.feeSats,
          })
        ) {
          throw new Error(dustFeeAbsorptionCanceledText());
        }

        setStatus({
          tone: "idle",
          text: `Waiting for UniSat signature ${index + 1}/${total}. Fee estimate: ${paymentPsbt.feeSats.toLocaleString()} sats.`,
        });
        const broadcast = await signAndBroadcastPsbtDetailed({
          broadcastStrategy: CHAINED_MINT_BROADCAST_STRATEGY,
          inputCount: paymentPsbt.inputCount,
          network: "livenet",
          psbtHex: paymentPsbt.psbtHex,
          wallet,
        });
        const txid = broadcast.txid;
        const mint: PowTokenMint = {
          amount: token.mintAmount,
          confirmed: false,
          createdAt: new Date().toISOString(),
          dataBytes: mintPayloadBytes,
          minterAddress: address,
          network: "livenet",
          paidSats: token.mintPriceSats,
          registryAddress: token.registryAddress,
          ticker: token.ticker,
          tokenId: token.tokenId,
          txid,
        };

        setTokenMints((current) =>
          current.some((item) => item.txid === txid)
            ? current
            : [mint, ...current],
        );
        setStatus({
          tone: "good",
          text: `${token.ticker} mint ${index + 1}/${total} broadcast via ${broadcast.source}: ${shortAddress(txid)}.`,
        });

        const nextInput = paymentPsbt.nextInput
          ? { ...paymentPsbt.nextInput, txid }
          : undefined;
        return {
          feeSats: paymentPsbt.feeSats,
          nextInputs: nextInput ? [nextInput] : [],
          pendingRecord: mint,
          txid,
        };
      },
      count: total,
      delayMs,
      initialInputs,
      isActive: requireActive,
      onProgress: (event) => {
        if (event.kind === "broadcast") {
          onBroadcast?.(event.index + 1, event.txid);
        }
      },
    });

    return result.txids;
  }

  async function mintToken(
    event?: FormEvent<HTMLFormElement>,
    tokenOverride?: PowTokenDefinition,
    options: { freshSupplyCheck?: boolean; refreshAfterBroadcast?: boolean } = {},
  ): Promise<string | undefined> {
    event?.preventDefault();
    const mintTarget = tokenOverride ?? selectedToken;
    const freshSupplyCheck = options.freshSupplyCheck ?? true;
    const refreshAfterBroadcast = options.refreshAfterBroadcast ?? false;
    const mintPayloadBytes = mintTarget
      ? dataCarrierBytesForPayload(
          buildTokenMintPayload(mintTarget.tokenId, mintTarget.mintAmount),
        )
      : tokenMintBytes;

    if (!window.unisat) {
      setStatus({ tone: "bad", text: "Connect UniSat first." });
      return undefined;
    }

    if (!window.unisat.signPsbt) {
      setStatus({
        tone: "bad",
        text: "UniSat signPsbt is not available. Update UniSat and try again.",
      });
      return undefined;
    }

    if (network !== "livenet" || !mintTarget) {
      setStatus({ tone: "bad", text: "Select a mainnet token first." });
      return undefined;
    }

    if (mintPayloadBytes > MAX_DATA_CARRIER_BYTES) {
      setStatus({
        tone: "bad",
        text: "Token mint OP_RETURN is over 100 KB.",
      });
      return undefined;
    }

    setTokenAction("mint");
    setBusy(true);
    setStatus({
      tone: "idle",
      text: freshSupplyCheck
        ? `Checking ${mintTarget.ticker} supply...`
        : `Minting ${mintTarget.ticker}...`,
    });

    try {
      let latestSupply = freshSupplyCheck
        ? await fetchTokenSupplyState("livenet", true, mintTarget.tokenId)
        : undefined;
      let latestToken =
        latestSupply?.tokens.find((token) => token.tokenId === mintTarget.tokenId) ??
        mintTarget;
      if (latestSupply) {
        const remainingAfterCachedCheck = Math.max(
          0,
          latestToken.maxSupply -
            latestSupply.confirmedSupply -
            latestSupply.pendingSupply,
        );
        if (remainingAfterCachedCheck <= latestToken.mintAmount * 10) {
          setStatus({
            tone: "idle",
            text: `Checking final ${latestToken.ticker} supply...`,
          });
          latestSupply = await fetchTokenSupplyState(
            "livenet",
            true,
            mintTarget.tokenId,
          );
          latestToken =
            latestSupply.tokens.find((token) => token.tokenId === mintTarget.tokenId) ??
            latestToken;
        }
      }
      if (latestSupply) {
        setTokenDefinitions(latestSupply.tokens);
        setTokenCreationSats(latestSupply.creationSats);
      }
      const latestLedger = latestSupply
        ? {
            confirmedSupply: latestSupply.confirmedSupply,
            pendingSupply: latestSupply.pendingSupply,
          }
        : tokenLedgerFor(latestToken, tokenMints, tokenTransfers, tokenSales);

      if (latestLedger.confirmedSupply >= latestToken.maxSupply) {
        setStatus({
          tone: "bad",
          text: `${latestToken.ticker} is minted out.`,
        });
        return undefined;
      }

      if (
        latestLedger.confirmedSupply +
          latestLedger.pendingSupply +
          latestToken.mintAmount >
        latestToken.maxSupply
      ) {
        setStatus({
          tone: "bad",
          text: "Next mint would exceed remaining token supply.",
        });
        return undefined;
      }

      const currentNetwork = await getWalletNetwork(window.unisat);
      if (currentNetwork !== "livenet") {
        await switchWalletNetwork(window.unisat, "livenet");
      }

      setStatus({
        tone: "idle",
        text: `Minting ${latestToken.mintAmount.toLocaleString()} ${latestToken.ticker}...`,
      });
      const txids = await runTokenChainedMint({
        count: 1,
        delayMs: 0,
        mintPayloadBytes,
        requireActive: () => true,
        token: latestToken,
      });
      if (refreshAfterBroadcast) {
        await refreshToken(true);
      }
      return txids[0];
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "Token mint failed."),
      });
      return undefined;
    } finally {
      setTokenAction("");
      setBusy(false);
    }
  }

  async function transferToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = walletTransferToken;
    const amount = Math.floor(tokenTransferAmount);
    const recipientAddress = tokenTransferRecipient.trim();

    if (!window.unisat) {
      setStatus({ tone: "bad", text: "Connect UniSat first." });
      return;
    }

    if (!window.unisat.signPsbt) {
      setStatus({
        tone: "bad",
        text: "UniSat signPsbt is not available. Update UniSat and try again.",
      });
      return;
    }

    if (network !== "livenet" || !token) {
      setStatus({ tone: "bad", text: "Select a mainnet token first." });
      return;
    }

    if (
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > walletSpendableTokenBalance ||
      !isValidBitcoinAddress(recipientAddress, "livenet")
    ) {
      setStatus({
        tone: "bad",
        text: "Enter a valid amount and recipient address.",
      });
      return;
    }

    const payload = buildTokenSendPayload(token.tokenId, amount, recipientAddress);
    if (dataCarrierBytesForPayload(payload) > MAX_DATA_CARRIER_BYTES) {
      setStatus({
        tone: "bad",
        text: "Token transfer OP_RETURN is over 100 KB.",
      });
      return;
    }

    setTokenAction("transfer");
    setBusy(true);
    setStatus({
      tone: "idle",
      text: `Transferring ${amount.toLocaleString()} ${token.ticker}...`,
    });

    try {
      const currentNetwork = await getWalletNetwork(window.unisat);
      if (currentNetwork !== "livenet") {
        await switchWalletNetwork(window.unisat, "livenet");
      }

      const paymentPsbt = await buildPaymentPsbt({
        amountSats: TOKEN_MIN_MUTATION_PRICE_SATS,
        excludeOutpoints: activeTokenListingAnchorOutpointsForAddress(
          tokenListings,
          address,
          { network: "livenet" },
        ),
        feeRate,
        fromAddress: address,
        network: "livenet",
        protocolPayloads: [payload],
        requireConfirmedUtxos: true,
        toAddress: token.registryAddress,
      });
      if (
        !confirmDustFeeAbsorption({
          dustFeeSats: paymentPsbt.dustFeeSats,
          feeRate,
          feeSats: paymentPsbt.feeSats,
        })
      ) {
        setStatus({ tone: "idle", text: dustFeeAbsorptionCanceledText() });
        return;
      }

      const txid = await signAndBroadcastPsbt({
        inputCount: paymentPsbt.inputCount,
        network: "livenet",
        psbtHex: paymentPsbt.psbtHex,
        wallet: window.unisat,
      });
      const transfer: PowTokenTransfer = {
        amount,
        confirmed: false,
        createdAt: new Date().toISOString(),
        dataBytes: dataCarrierBytesForPayload(payload),
        network: "livenet",
        paidSats: TOKEN_MIN_MUTATION_PRICE_SATS,
        recipientAddress,
        registryAddress: token.registryAddress,
        senderAddress: address,
        ticker: token.ticker,
        tokenId: token.tokenId,
        txid,
      };

      setTokenTransfers((current) =>
        current.some((item) => item.txid === txid)
          ? current
          : [transfer, ...current],
      );
      setTokenTransferRecipient("");
      setStatus({
        tone: "good",
        text: `${token.ticker} transfer broadcast: ${shortAddress(txid)}.`,
      });
      void refreshToken(true);
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "Token transfer failed."),
      });
    } finally {
      setTokenAction("");
      setBusy(false);
    }
  }

  async function listToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = walletTransferToken;
    const amount = Math.floor(tokenListAmount);
    const priceSats = Math.floor(tokenListPriceSats);
    const buyerAddress = tokenListBuyerAddress.trim();

    if (!window.unisat?.signPsbt) {
      setStatus({
        tone: "bad",
        text: "Connect UniSat with signPsbt support first.",
      });
      return;
    }

    if (network !== "livenet" || !token) {
      setStatus({ tone: "bad", text: "Select a mainnet token first." });
      return;
    }

    if (
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > walletSpendableTokenBalance ||
      !Number.isSafeInteger(priceSats) ||
      priceSats < 1 ||
      (buyerAddress && !isValidBitcoinAddress(buyerAddress, "livenet"))
    ) {
      setStatus({
        tone: "bad",
        text: "Enter a valid listing amount, price, and optional buyer lock.",
      });
      return;
    }

    setTokenAction("list");
    setBusy(true);
    setStatus({
      tone: "idle",
      text: `Listing ${amount.toLocaleString()} ${token.ticker}...`,
    });

    try {
      const currentNetwork = await getWalletNetwork(window.unisat);
      if (currentNetwork !== "livenet") {
        await switchWalletNetwork(window.unisat, "livenet");
      }

      const latestState = await fetchTokenState("livenet", true);
      setTokenDefinitions(latestState.tokens);
      setTokenMints(latestState.mints);
      setTokenTransfers(latestState.transfers);
      setTokenListings(latestState.listings);
      setTokenClosedListings(latestState.closedListings);
      setTokenSales(latestState.sales);
      setTokenCreationSats(latestState.creationSats);
      const latestToken =
        latestState.tokens.find((item) => item.tokenId === token.tokenId) ??
        token;
      const latestBalance =
        tokenWalletBalancesFor(
          address,
          latestState.tokens,
          latestState.mints,
          latestState.transfers,
          latestState.sales,
        ).find((item) => item.token.tokenId === latestToken.tokenId)
          ?.confirmedBalance ?? 0;
      const latestReserved = tokenReservedBalanceFor(
        latestState.listings,
        latestToken.tokenId,
        address,
      );
      if (amount > Math.max(0, latestBalance - latestReserved)) {
        throw new Error("Listing amount exceeds your current spendable balance.");
      }

      const sellerPublicKey =
        (await window.unisat.getPublicKey?.())?.trim().toLowerCase() ?? "";
      if (!validPublicKeyHex(sellerPublicKey)) {
        throw new Error("UniSat did not return a valid seller public key.");
      }

      const saleAuthorization: PowTokenSaleAuthorization = {
        ...tokenSaleAuthorizationDraft({
          amount,
          anchorScriptPubKey: bytesToHex(
            scriptForAddress(address, "livenet", "Sale-ticket address"),
          ),
          anchorSigHashType: TOKEN_LISTING_ANCHOR_SIGHASH_TYPE,
          anchorType: TOKEN_LISTING_ANCHOR_TYPE,
          anchorValueSats: TOKEN_LISTING_ANCHOR_VALUE_SATS,
          anchorVout: TOKEN_LISTING_ANCHOR_VOUT,
          buyerAddress,
          network: "livenet",
          nonce: `${Date.now().toString(36)}-${Math.random()
            .toString(36)
            .slice(2, 10)}`,
          priceSats,
          registryAddress: latestToken.registryAddress,
          sellerAddress: address,
          sellerPublicKey,
          ticker: latestToken.ticker,
          tokenId: latestToken.tokenId,
          version: TOKEN_SALE_AUTH_VERSION,
        }),
        anchorSignature: "",
        anchorTxid: "",
      };
      const payload = buildTokenListingPayload(saleAuthorization);
      if (dataCarrierBytesForPayload(payload) > MAX_DATA_CARRIER_BYTES) {
        throw new Error("Token listing OP_RETURN is over 100 KB.");
      }

      const paymentPsbt = await buildPaymentPsbt({
        excludeOutpoints: activeTokenListingAnchorOutpointsForAddress(
          latestState.listings,
          address,
          { network: "livenet" },
        ),
        feeRate,
        fromAddress: address,
        network: "livenet",
        payments: [
          {
            address: latestToken.registryAddress,
            amountSats: TOKEN_MIN_MUTATION_PRICE_SATS,
          },
        ],
        postProtocolPayments: [
          {
            address,
            amountSats: TOKEN_LISTING_ANCHOR_VALUE_SATS,
          },
        ],
        protocolPayloads: [payload],
        requireConfirmedUtxos: true,
      });
      if (
        !confirmDustFeeAbsorption({
          dustFeeSats: paymentPsbt.dustFeeSats,
          feeRate,
          feeSats: paymentPsbt.feeSats,
        })
      ) {
        setStatus({ tone: "idle", text: dustFeeAbsorptionCanceledText() });
        return;
      }

      const txid = await signAndBroadcastPsbt({
        inputCount: paymentPsbt.inputCount,
        network: "livenet",
        psbtHex: paymentPsbt.psbtHex,
        wallet: window.unisat,
      });
      const listing: PowTokenListing = {
        amount,
        confirmed: false,
        createdAt: new Date().toISOString(),
        dataBytes: dataCarrierBytesForPayload(payload),
        listingId: txid,
        network: "livenet",
        priceSats,
        registryAddress: latestToken.registryAddress,
        saleAuthorization,
        sellerAddress: address,
        ticker: latestToken.ticker,
        tokenId: latestToken.tokenId,
      };
      setTokenListings((current) =>
        current.some((item) => item.listingId === txid)
          ? current
          : [listing, ...current],
      );
      setStatus({
        tone: "good",
        text: `${latestToken.ticker} listing broadcast: ${shortAddress(txid)}.`,
      });
      void refreshToken(true, true);
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "Token listing failed."),
      });
    } finally {
      setTokenAction("");
      setBusy(false);
    }
  }

  async function sealTokenListing(listing: PowTokenListing) {
    if (!window.unisat?.signPsbt) {
      setStatus({
        tone: "bad",
        text: "Connect UniSat with signPsbt support first.",
      });
      return;
    }

    if (!listing.confirmed) {
      setStatus({
        tone: "idle",
        text: "Wait for the listing transaction to confirm before sealing.",
      });
      return;
    }

    if (listing.sellerAddress !== address) {
      setStatus({ tone: "bad", text: "Only the seller can seal this listing." });
      return;
    }

    setTokenAction("seal");
    setBusy(true);
    setStatus({ tone: "idle", text: "Sealing token listing..." });

    try {
      const currentNetwork = await getWalletNetwork(window.unisat);
      if (currentNetwork !== "livenet") {
        await switchWalletNetwork(window.unisat, "livenet");
      }

      const anchorSignature = await signTokenSaleTicketAuthorization({
        listing,
        network: "livenet",
        wallet: window.unisat,
      });
      const sealedAuthorization: PowTokenSaleAuthorization = {
        ...listing.saleAuthorization,
        anchorSignature,
        anchorTxid: listing.listingId,
      };
      const payload = buildTokenSaleSealPayload(
        listing.listingId,
        sealedAuthorization,
      );
      const paymentPsbt = await buildPaymentPsbt({
        amountSats: TOKEN_MIN_MUTATION_PRICE_SATS,
        excludeOutpoints: [
          ...activeTokenListingAnchorOutpointsForAddress(tokenListings, address, {
            network: "livenet",
          }),
          tokenListingAnchorOutpoint(listing),
        ],
        feeRate,
        fromAddress: address,
        network: "livenet",
        protocolPayloads: [payload],
        requireConfirmedUtxos: true,
        toAddress: listing.registryAddress,
      });
      if (
        !confirmDustFeeAbsorption({
          dustFeeSats: paymentPsbt.dustFeeSats,
          feeRate,
          feeSats: paymentPsbt.feeSats,
        })
      ) {
        setStatus({ tone: "idle", text: dustFeeAbsorptionCanceledText() });
        return;
      }

      const txid = await signAndBroadcastPsbt({
        inputCount: paymentPsbt.inputCount,
        network: "livenet",
        psbtHex: paymentPsbt.psbtHex,
        wallet: window.unisat,
      });
      setTokenListings((current) =>
        current.map((item) =>
          item.listingId === listing.listingId
            ? { ...item, saleAuthorization: sealedAuthorization, sealTxid: txid }
            : item,
        ),
      );
      setStatus({
        tone: "good",
        text: `Token listing sealed: ${shortAddress(txid)}.`,
      });
      void refreshToken(true, true);
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "Token listing seal failed."),
      });
    } finally {
      setTokenAction("");
      setBusy(false);
    }
  }

  async function delistTokenListing(listing: PowTokenListing) {
    if (!window.unisat?.signPsbt) {
      setStatus({
        tone: "bad",
        text: "Connect UniSat with signPsbt support first.",
      });
      return;
    }

    if (!listing.confirmed) {
      setStatus({
        tone: "idle",
        text: "Wait for the listing transaction to confirm before delisting.",
      });
      return;
    }

    if (listing.sellerAddress !== address) {
      setStatus({ tone: "bad", text: "Only the seller can delist this listing." });
      return;
    }

    setTokenAction("delist");
    setBusy(true);
    setStatus({ tone: "idle", text: "Delisting token listing..." });

    try {
      const currentNetwork = await getWalletNetwork(window.unisat);
      if (currentNetwork !== "livenet") {
        await switchWalletNetwork(window.unisat, "livenet");
      }

      const payload = buildTokenDelistingPayload(listing.listingId);
      const paymentPsbt = await buildAnchoredMarketplacePsbt({
        anchorSpendMode: "wallet",
        excludeOutpoints: activeTokenListingAnchorOutpointsForAddress(
          tokenListings,
          address,
          { exceptListingId: listing.listingId, network: "livenet" },
        ),
        feeRate,
        fromAddress: address,
        listing,
        network: "livenet",
        payments: [
          {
            address: listing.sellerAddress,
            amountSats: listing.saleAuthorization.anchorValueSats,
          },
          {
            address: listing.registryAddress,
            amountSats: TOKEN_MIN_MUTATION_PRICE_SATS,
          },
        ],
        protocolPayloads: [payload],
        requireConfirmedUtxos: true,
      });
      if (
        !confirmDustFeeAbsorption({
          dustFeeSats: paymentPsbt.dustFeeSats,
          feeRate,
          feeSats: paymentPsbt.feeSats,
        })
      ) {
        setStatus({ tone: "idle", text: dustFeeAbsorptionCanceledText() });
        return;
      }

      const txid = await signAndBroadcastPsbt({
        inputCount: paymentPsbt.inputCount,
        network: "livenet",
        psbtHex: paymentPsbt.psbtHex,
        signInputIndexes: paymentPsbt.walletInputIndexes,
        signingAddress: address,
        wallet: window.unisat,
      });
      setTokenListings((current) =>
        current.filter((item) => item.listingId !== listing.listingId),
      );
      setTokenClosedListings((current) => {
        const closedListing: PowTokenClosedListing = {
          ...listing,
          closedAt: new Date().toISOString(),
          closedConfirmed: false,
          closedTxid: txid,
        };
        return current.some(
          (item) =>
            item.listingId === closedListing.listingId &&
            item.closedTxid === closedListing.closedTxid,
        )
          ? current
          : [closedListing, ...current];
      });
      setStatus({
        tone: "good",
        text: `Token listing delisted: ${shortAddress(txid)}.`,
      });
      void refreshToken(true, true);
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "Token delist failed."),
      });
    } finally {
      setTokenAction("");
      setBusy(false);
    }
  }

  async function buyTokenListing(listing: PowTokenListing) {
    if (!window.unisat?.signPsbt) {
      setStatus({
        tone: "bad",
        text: "Connect UniSat with signPsbt support first.",
      });
      return;
    }

    if (!address) {
      setStatus({ tone: "bad", text: "Connect UniSat first." });
      return;
    }

    if (!tokenSaleAuthorizationUsesSaleTicketAnchor(listing.saleAuthorization)) {
      setStatus({
        tone: "bad",
        text: "Seller must seal this token listing before it can be bought.",
      });
      return;
    }

    if (
      listing.saleAuthorization.buyerAddress &&
      listing.saleAuthorization.buyerAddress !== address
    ) {
      setStatus({
        tone: "bad",
        text: "This listing is locked to a different buyer.",
      });
      return;
    }

    if (listing.sellerAddress === address) {
      setStatus({
        tone: "bad",
        text: "You cannot buy your own token listing from the same wallet.",
      });
      return;
    }

    setTokenAction("buy");
    setBusy(true);
    setStatus({
      tone: "idle",
      text: `Buying ${listing.amount.toLocaleString()} ${listing.ticker}...`,
    });

    try {
      const currentNetwork = await getWalletNetwork(window.unisat);
      if (currentNetwork !== "livenet") {
        await switchWalletNetwork(window.unisat, "livenet");
      }

      const payload = buildTokenBuyPayload(listing.listingId, address);
      const paymentPsbt = await buildAnchoredMarketplacePsbt({
        anchorSpendMode: "preSigned",
        excludeOutpoints: activeTokenListingAnchorOutpointsForAddress(
          tokenListings,
          address,
          { network: "livenet" },
        ),
        feeRate,
        fromAddress: address,
        listing,
        network: "livenet",
        payments: [
          {
            address: listing.sellerAddress,
            amountSats: tokenSellerPaymentRequiredSats(listing),
          },
          {
            address: listing.registryAddress,
            amountSats: TOKEN_MIN_MUTATION_PRICE_SATS,
          },
        ],
        protocolPayloads: [payload],
        requireConfirmedUtxos: true,
      });
      if (
        !confirmDustFeeAbsorption({
          dustFeeSats: paymentPsbt.dustFeeSats,
          feeRate,
          feeSats: paymentPsbt.feeSats,
        })
      ) {
        setStatus({ tone: "idle", text: dustFeeAbsorptionCanceledText() });
        return;
      }

      const txid = await signAndBroadcastPsbt({
        inputCount: paymentPsbt.inputCount,
        network: "livenet",
        psbtHex: paymentPsbt.psbtHex,
        signInputIndexes: paymentPsbt.walletInputIndexes,
        signingAddress: address,
        wallet: window.unisat,
      });
      const sale: PowTokenSale = {
        amount: listing.amount,
        buyerAddress: address,
        confirmed: false,
        createdAt: new Date().toISOString(),
        listingId: listing.listingId,
        network: "livenet",
        paidSats:
          tokenSellerPaymentRequiredSats(listing) +
          TOKEN_MIN_MUTATION_PRICE_SATS,
        priceSats: listing.priceSats,
        registryAddress: listing.registryAddress,
        sellerAddress: listing.sellerAddress,
        ticker: listing.ticker,
        tokenId: listing.tokenId,
        txid,
      };
      setTokenListings((current) =>
        current.filter((item) => item.listingId !== listing.listingId),
      );
      setTokenClosedListings((current) => {
        const closedListing: PowTokenClosedListing = {
          ...listing,
          closedAt: sale.createdAt,
          closedConfirmed: false,
          closedTxid: txid,
        };
        return current.some(
          (item) =>
            item.listingId === closedListing.listingId &&
            item.closedTxid === closedListing.closedTxid,
        )
          ? current
          : [closedListing, ...current];
      });
      setTokenSales((current) =>
        current.some((item) => item.txid === txid) ? current : [sale, ...current],
      );
      setStatus({
        tone: "good",
        text: `${listing.ticker} purchase broadcast: ${shortAddress(txid)}.`,
      });
      setPurchaseReceipt({
        amountLabel: `${listing.amount.toLocaleString()} ${listing.ticker}`,
        assetLabel: listing.ticker,
        buyerAddress: address,
        kind: "token",
        listingId: listing.listingId,
        network: "livenet",
        priceSats: listing.priceSats,
        sellerAddress: listing.sellerAddress,
        txid,
      });
      void refreshToken(true, true);
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "Token purchase failed."),
      });
    } finally {
      setTokenAction("");
      setBusy(false);
    }
  }

  async function runRushChainedMint({
    count,
    delayMs,
    onBroadcast,
    requireActive,
  }: {
    count: number;
    delayMs: number;
    onBroadcast?: (completed: number, txid: string) => void;
    requireActive: () => boolean;
  }) {
    const wallet = window.unisat;
    if (!wallet?.signPsbt) {
      throw new Error("UniSat signPsbt is not available.");
    }
    const mintNetwork = network;
    const registryAddress = rushRegistryAddressForNetwork(mintNetwork);
    if (!registryAddress) {
      throw new Error(`No RUSH registry configured for ${networkLabel(mintNetwork)}.`);
    }
    const currentNetwork = await getWalletNetwork(wallet);
    if (currentNetwork !== mintNetwork) {
      await switchWalletNetwork(wallet, mintNetwork);
    }

    const total = Math.min(
      RUSH_CHAINED_MINT_MAX_COUNT,
      Math.max(1, Math.floor(count)),
    );
    const payload = buildRushMintPayload();
    const opReturnScripts = protocolOutputScripts([payload]);
    const registryScript = scriptForAddress(
      registryAddress,
      mintNetwork,
      "RUSH registry",
    );
    const changeScript = scriptForAddress(
      address,
      mintNetwork,
      "Connected wallet",
    );
    const fixedOutputVbytes =
      outputVbytesForScript(registryScript) +
      opReturnScripts.reduce(
        (totalVbytes, script) => totalVbytes + outputVbytesForScript(script),
        0,
      );
    const changeOutputVbytes = outputVbytesForScript(changeScript);
    const estimatedFeePerMint = Math.ceil(
      estimateTxVbytes(1, fixedOutputVbytes + changeOutputVbytes) * feeRate,
    );
    const initialInputs = await selectChainedInitialInputs({
      feeRate,
      fromAddress: address,
      network: mintNetwork,
      totalRequiredSats:
        total * RUSH_MINT_PRICE_SATS +
        total * estimatedFeePerMint +
        DUST_SATS,
    });
    const latestState = await fetchRushState(mintNetwork, true);
    setRushState(latestState);
    if (latestState.stats.nextOrdinal === null) {
      throw new Error("RUSH rewarded supply is fully minted.");
    }
    const remainingRewarded =
      RUSH_MAX_REWARDED_MINTS - latestState.stats.rewardedMints;
    if (total > remainingRewarded) {
      throw new Error(
        `Only ${remainingRewarded.toLocaleString()} rewarded RUSH mint${remainingRewarded === 1 ? "" : "s"} remain. Lower the run count.`,
      );
    }

    const result = await executeChainedMintRun<ChainedMintInput, RushMintRecord>({
      buildAndBroadcastStep: async ({ currentInputs, index, isLast }) => {
        if (!requireActive()) {
          throw new Error("RUSH chained mint stopped.");
        }

        const paymentPsbt = buildChainedMintPsbt({
          feeRate,
          fixedOutputs: [
            {
              address: registryAddress,
              amountSats: RUSH_MINT_PRICE_SATS,
            },
            { amountSats: 0, script: opReturnScripts[0] },
          ],
          fromAddress: address,
          inputs: currentInputs,
          isLast,
          network: mintNetwork,
        });
        if (
          paymentPsbt.dustFeeSats > 0 &&
          !confirmDustFeeAbsorption({
            dustFeeSats: paymentPsbt.dustFeeSats,
            feeRate,
            feeSats: paymentPsbt.feeSats,
          })
        ) {
          throw new Error(dustFeeAbsorptionCanceledText());
        }

        setStatus({
          tone: "idle",
          text: `Waiting for UniSat signature ${index + 1}/${total}. Fee estimate: ${paymentPsbt.feeSats.toLocaleString()} sats.`,
        });
        const broadcast = await signAndBroadcastPsbtDetailed({
          broadcastStrategy: CHAINED_MINT_BROADCAST_STRATEGY,
          inputCount: paymentPsbt.inputCount,
          network: mintNetwork,
          psbtHex: paymentPsbt.psbtHex,
          wallet,
        });
        const txid = broadcast.txid;
        const ordinal = latestState.stats.rewardedMints + index + 1;
        const rewardUnits = rushRewardUnitsForOrdinal(ordinal);
        const phase = rushPhaseForOrdinal(ordinal);
        const mint: RushMintRecord = {
          amount: formatRushUnits(rewardUnits),
          amountUnits: rewardUnits.toString(),
          confirmed: false,
          createdAt: new Date().toISOString(),
          dataBytes: dataCarrierBytesForPayload(payload),
          minterAddress: address,
          network: mintNetwork,
          overflow: rewardUnits === 0n,
          paidSats: RUSH_MINT_PRICE_SATS,
          phase: phase?.phase,
          registryAddress,
          txid,
        };

        setRushState((current) => {
          const mints = current.mints.some((item) => item.txid === txid)
            ? current.mints
            : [mint, ...current.mints];
          return {
            ...current,
            indexedAt: new Date().toISOString(),
            mints,
            stats: rushStatsFromMints(mints),
          };
        });
        setStatus({
          tone: "good",
          text: `RUSH mint ${index + 1}/${total} broadcast via ${broadcast.source}: ${shortAddress(txid)}.`,
        });

        const nextInput = paymentPsbt.nextInput
          ? { ...paymentPsbt.nextInput, txid }
          : undefined;
        return {
          feeSats: paymentPsbt.feeSats,
          nextInputs: nextInput ? [nextInput] : [],
          pendingRecord: mint,
          txid,
        };
      },
      count: total,
      delayMs,
      initialInputs,
      isActive: requireActive,
      onProgress: (event) => {
        if (event.kind === "broadcast") {
          onBroadcast?.(event.index + 1, event.txid);
        }
      },
    });

    return result.txids;
  }

  async function mintRush(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!window.unisat) {
      setStatus({ tone: "bad", text: "Connect UniSat first." });
      return;
    }
    if (!window.unisat.signPsbt) {
      setStatus({
        tone: "bad",
        text: "UniSat signPsbt is not available. Update UniSat and try again.",
      });
      return;
    }
    if (!address || !isValidBitcoinAddress(address, network)) {
      setStatus({
        tone: "bad",
        text: `Connect a valid ${networkLabel(network)} wallet first.`,
      });
      return;
    }
    if (!rushRegistryAddressForNetwork(network)) {
      setStatus({
        tone: "bad",
        text: `No RUSH registry configured for ${networkLabel(network)}.`,
      });
      return;
    }
    if (dataCarrierBytesForPayload(buildRushMintPayload()) > MAX_DATA_CARRIER_BYTES) {
      setStatus({ tone: "bad", text: "RUSH mint OP_RETURN is over 100 KB." });
      return;
    }

    const target = Math.min(
      RUSH_CHAINED_MINT_MAX_COUNT,
      Math.max(1, Math.floor(rushMintCount)),
    );
    const delayMs = Math.min(
      RUSH_CHAINED_MINT_MAX_DELAY_MS,
      Math.max(0, Math.floor(rushMintDelayMs)),
    );

    rushMintActiveRef.current = true;
    setRushMinting(true);
    setBusy(true);
    setStatus({ tone: "idle", text: `Starting ${target} RUSH mint${target === 1 ? "" : "s"}...` });

    try {
      const txids = await runRushChainedMint({
        count: target,
        delayMs,
        requireActive: () => rushMintActiveRef.current,
      });
      setStatus({
        tone: "good",
        text: `RUSH run broadcast ${txids.length.toLocaleString()} transaction${txids.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "RUSH mint failed."),
      });
    } finally {
      rushMintActiveRef.current = false;
      setRushMinting(false);
      setBusy(false);
    }
  }

  function stopRushMint() {
    rushMintActiveRef.current = false;
    setRushMinting(false);
    setStatus({ tone: "idle", text: "RUSH mint run stopped." });
  }

  function clearTokenMintAssistantTimer() {
    if (tokenMintAssistantTimerRef.current !== undefined) {
      window.clearTimeout(tokenMintAssistantTimerRef.current);
      tokenMintAssistantTimerRef.current = undefined;
    }
  }

  function stopTokenMintAssistant(message = "Mint assistant stopped.") {
    tokenMintAssistantActiveRef.current = false;
    clearTokenMintAssistantTimer();
    setTokenMintAssistantRunning(false);
    setTokenMintAssistantRemaining(0);
    setStatus({ tone: "idle", text: message });
  }

  function tokenForAssistant(tokenId?: string) {
    const normalized = normalizeTokenTicker(tokenId ?? "");
    return tokenId
      ? dashboardTokenDefinitions.find(
          (token) =>
            token.tokenId === tokenId || (normalized && token.ticker === normalized),
        )
      : selectedToken;
  }

  async function startTokenMintAssistant(tokenId?: string) {
    if (tokenMintAssistantRunning || tokenMintAssistantActiveRef.current) {
      return;
    }

    const targetToken = tokenForAssistant(tokenId);
    const requestedTarget = Math.min(
      TOKEN_MINT_ASSISTANT_MAX_COUNT,
      Math.max(1, Math.floor(tokenMintAssistantTarget)),
    );
    const delayMs = Math.min(
      TOKEN_MINT_ASSISTANT_MAX_DELAY_MS,
      Math.max(0, Math.floor(tokenMintAssistantDelayMs)),
    );

    if (!targetToken || !address || network !== "livenet" || busy) {
      setStatus({
        tone: "bad",
        text: "Select a live token, connect UniSat, and resolve any mint block before starting the assistant.",
      });
      return;
    }

    setBusy(true);
    setStatus({
      tone: "idle",
      text: `Checking ${targetToken.ticker} supply before assistant start...`,
    });

    let latestToken = targetToken;
    let latestConfirmedSupply = 0;
    let latestPendingSupply = 0;
    try {
      let latestState = await fetchTokenSupplyState(
        "livenet",
        false,
        targetToken.tokenId,
      );
      latestToken =
        latestState.tokens.find((token) => token.tokenId === targetToken.tokenId) ??
        targetToken;
      const remainingAfterCachedCheck = Math.max(
        0,
        latestToken.maxSupply -
          latestState.confirmedSupply -
          latestState.pendingSupply,
      );
      if (
        remainingAfterCachedCheck <=
        latestToken.mintAmount * (requestedTarget + 5)
      ) {
        setStatus({
          tone: "idle",
          text: `Checking final ${latestToken.ticker} supply before assistant start...`,
        });
        latestState = await fetchTokenSupplyState(
          "livenet",
          true,
          targetToken.tokenId,
        );
        latestToken =
          latestState.tokens.find((token) => token.tokenId === targetToken.tokenId) ??
          latestToken;
      }
      setTokenDefinitions(latestState.tokens);
      setTokenCreationSats(latestState.creationSats);
      latestConfirmedSupply = latestState.confirmedSupply;
      latestPendingSupply = latestState.pendingSupply;
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "Mint assistant supply check failed."),
      });
      setBusy(false);
      return;
    } finally {
      setBusy(false);
    }

    const targetLedger = {
      confirmedSupply: latestConfirmedSupply,
      pendingSupply: latestPendingSupply,
    };
    const targetRemainingSupply = Math.max(
      0,
      latestToken.maxSupply -
        targetLedger.confirmedSupply -
        targetLedger.pendingSupply,
    );
    if (targetLedger.confirmedSupply >= latestToken.maxSupply) {
      setStatus({
        tone: "bad",
        text: `${latestToken.ticker} is minted out.`,
      });
      return;
    }
    if (latestToken.mintAmount > targetRemainingSupply) {
      setStatus({
        tone: "bad",
        text: `Next mint needs ${latestToken.mintAmount.toLocaleString()} ${latestToken.ticker}, but only ${targetRemainingSupply.toLocaleString()} remain after pending mints.`,
      });
      return;
    }

    const supplyLimitedTarget = Math.max(
      1,
      Math.floor(targetRemainingSupply / latestToken.mintAmount),
    );
    const target = Math.min(requestedTarget, supplyLimitedTarget);

    setTokenMintAssistantTarget(target);
    setTokenMintAssistantDelayMs(delayMs);
    setTokenMintAssistantCompleted(0);
    setTokenMintAssistantRemaining(target);
    setTokenMintAssistantRunning(true);
    tokenMintAssistantActiveRef.current = true;
    setStatus({
      tone: "idle",
      text: `Mint assistant started for ${target.toLocaleString()} ${latestToken.ticker} mint${target === 1 ? "" : "s"}. You still approve each UniSat prompt.`,
    });
    setTokenAction("mint");
    setBusy(true);
    void runTokenChainedMint({
      count: target,
      delayMs,
      mintPayloadBytes: dataCarrierBytesForPayload(
        buildTokenMintPayload(latestToken.tokenId, latestToken.mintAmount),
      ),
      onBroadcast: (completed, txid) => {
        setTokenMintAssistantCompleted(completed);
        setTokenMintAssistantRemaining(Math.max(0, target - completed));
        if (completed < target) {
          setStatus({
            tone: "good",
            text: `Mint assistant broadcast ${completed.toLocaleString()} of ${target.toLocaleString()}: ${shortAddress(txid)}. Next prompt in ${(delayMs / 1000).toLocaleString()}s.`,
          });
        }
      },
      requireActive: () => tokenMintAssistantActiveRef.current,
      token: latestToken,
    })
      .then((txids) => {
        if (!tokenMintAssistantActiveRef.current) {
          return;
        }

        tokenMintAssistantActiveRef.current = false;
        setTokenMintAssistantCompleted(txids.length);
        setTokenMintAssistantRemaining(0);
        setTokenMintAssistantRunning(false);
        setStatus({
          tone: "good",
          text: `Mint assistant complete: ${txids.length.toLocaleString()} mint transaction${txids.length === 1 ? "" : "s"} broadcast.`,
        });
      })
      .catch((error) => {
        tokenMintAssistantActiveRef.current = false;
        setTokenMintAssistantRunning(false);
        const message = errorMessage(error, "Mint assistant paused.");
        setStatus({
          tone: "bad",
          text: /^mint assistant paused/i.test(message)
            ? message
            : `Mint assistant paused: ${message}`,
        });
      })
      .finally(() => {
        setTokenAction("");
        setBusy(false);
      });
  }

  async function runTokenMintAssistantStep(
    remaining: number,
    delayMs: number,
    total: number,
    token: PowTokenDefinition,
  ) {
    clearTokenMintAssistantTimer();
    if (!tokenMintAssistantActiveRef.current) {
      return;
    }

    if (remaining <= 0) {
      tokenMintAssistantActiveRef.current = false;
      setTokenMintAssistantRunning(false);
      setTokenMintAssistantRemaining(0);
      setStatus({
        tone: "good",
        text: `Mint assistant complete: ${total.toLocaleString()} mint transaction${total === 1 ? "" : "s"} broadcast.`,
      });
      return;
    }

    setTokenMintAssistantRemaining(remaining);
    const txid = await mintToken(undefined, token, {
      freshSupplyCheck: false,
      refreshAfterBroadcast: false,
    });
    if (!tokenMintAssistantActiveRef.current) {
      return;
    }

    if (!txid) {
      tokenMintAssistantActiveRef.current = false;
      setTokenMintAssistantRunning(false);
      setTokenMintAssistantRemaining(remaining);
      setStatus((current) =>
        current.tone === "bad"
          ? current
          : {
              tone: "bad",
              text: "Mint assistant paused after a failed or canceled mint.",
            },
      );
      return;
    }

    const nextRemaining = remaining - 1;
    const completed = total - nextRemaining;
    setTokenMintAssistantCompleted(completed);
    setTokenMintAssistantRemaining(nextRemaining);

    if (nextRemaining <= 0) {
      tokenMintAssistantActiveRef.current = false;
      setTokenMintAssistantRunning(false);
      setStatus({
        tone: "good",
        text: `Mint assistant complete: ${completed.toLocaleString()} mint transaction${completed === 1 ? "" : "s"} broadcast.`,
      });
      return;
    }

    setStatus({
      tone: "good",
      text: `Mint assistant broadcast ${completed.toLocaleString()} of ${total.toLocaleString()}: ${shortAddress(txid)}. Next prompt in ${(delayMs / 1000).toLocaleString()}s.`,
    });
    tokenMintAssistantTimerRef.current = window.setTimeout(() => {
      void runTokenMintAssistantStep(nextRemaining, delayMs, total, token);
    }, delayMs);
  }

  async function prepareTokenMintUtxos(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!window.unisat) {
      setStatus({ tone: "bad", text: "Connect UniSat first." });
      return;
    }

    if (!window.unisat.signPsbt) {
      setStatus({
        tone: "bad",
        text: "UniSat signPsbt is not available. Update UniSat and try again.",
      });
      return;
    }

    if (network !== "livenet" || !selectedToken) {
      setStatus({ tone: "bad", text: "Select a mainnet token first." });
      return;
    }

    const mintCount = tokenPrepareMintCountValue;
    const feeReserveSats = Math.max(0, tokenPrepareFeeReserveValue);
    const prepareFeeRate = tokenPrepareFeeRateValue;
    const outputSats = Math.max(
      DUST_SATS,
      selectedToken.mintPriceSats + feeReserveSats,
    );

    if (
      !Number.isSafeInteger(mintCount) ||
      mintCount < 1 ||
      mintCount > TOKEN_PREPARE_MAX_MINT_COUNT
    ) {
      setStatus({
        tone: "bad",
        text: `Prepare between 1 and ${TOKEN_PREPARE_MAX_MINT_COUNT} mint UTXOs at a time.`,
      });
      return;
    }

    if (!Number.isSafeInteger(outputSats) || outputSats < DUST_SATS) {
      setStatus({ tone: "bad", text: "Prepared UTXO amount is too small." });
      return;
    }

    setTokenAction("split");
    setBusy(true);
    setStatus({
      tone: "idle",
      text: `Preparing ${mintCount.toLocaleString()} ${selectedToken.ticker} mint UTXOs...`,
    });

    try {
      const currentNetwork = await getWalletNetwork(window.unisat);
      if (currentNetwork !== "livenet") {
        await switchWalletNetwork(window.unisat, "livenet");
      }

      const paymentPsbt = await buildPaymentPsbt({
        feeRate: prepareFeeRate,
        fromAddress: address,
        network: "livenet",
        payments: Array.from({ length: mintCount }, () => ({
          address,
          amountSats: outputSats,
        })),
        protocolPayloads: [],
        requireConfirmedUtxos: true,
      });
      if (
        !confirmDustFeeAbsorption({
          dustFeeSats: paymentPsbt.dustFeeSats,
          feeRate: prepareFeeRate,
          feeSats: paymentPsbt.feeSats,
        })
      ) {
        setStatus({ tone: "idle", text: dustFeeAbsorptionCanceledText() });
        return;
      }

      const txid = await signAndBroadcastPsbt({
        inputCount: paymentPsbt.inputCount,
        network: "livenet",
        psbtHex: paymentPsbt.psbtHex,
        wallet: window.unisat,
      });
      setStatus({
        tone: "good",
        text: `${mintCount.toLocaleString()} mint UTXOs prepared for ${selectedToken.ticker}: ${shortAddress(txid)}. Split fee ${paymentPsbt.feeSats.toLocaleString()} sats at ${prepareFeeRate} sat/vB. Wait for confirmation before burst minting.`,
      });
    } catch (error) {
      setStatus({
        tone: "bad",
        text: errorMessage(error, "Mint UTXO preparation failed."),
      });
    } finally {
      setTokenAction("");
      setBusy(false);
    }
  }

  if (landingMode) {
    return (
      <LandingApp
        network={network}
        onNetworkChange={chooseNetwork}
        registryAddress={registryAddressForNetwork("livenet")}
        registryRecords={idRegistry.filter(
          (record) => record.network === "livenet",
        )}
        onRefresh={() => void refreshIds()}
      />
    );
  }

  if (idLaunchMode) {
    return (
      <IdLaunchApp
        address={address}
        busy={busy}
        canRegister={canRegisterId}
        connectWallet={connectWallet}
        disconnectWallet={disconnectWallet}
        feeRate={feeRate}
        hasUnisat={hasUnisat}
        idName={idName}
        idPgpKey={idPgpKey}
        idReceiveAddress={idReceiveAddress}
        lastRegisteredId={
          lastRegisteredId?.network === "livenet" ? lastRegisteredId : undefined
        }
        network={network}
        onNetworkChange={chooseNetwork}
        registryAddress={registryAddressForNetwork("livenet")}
        registryRecords={idRegistry.filter(
          (record) => record.network === "livenet",
        )}
        registrationBytes={idRegistrationBytes}
        setFeeRate={setFeeRate}
        setIdName={setIdName}
        setIdPgpKey={setIdPgpKey}
        setIdReceiveAddress={setIdReceiveAddress}
        status={status}
        submit={registerId}
        onRefresh={() => void refreshIds()}
      />
    );
  }

  if (marketplaceMode) {
    return (
      <>
        <MarketplaceApp
          address={address}
          btcUsd={tokenBtcUsd}
          busy={busy}
          canCreateSaleAuthorization={canCreateSaleAuthorization}
          canPurchaseId={canPurchaseId}
          connectWallet={connectWallet}
          delistListing={delistIdListing}
          disconnectWallet={disconnectWallet}
          feeRate={feeRate}
          hasUnisat={hasUnisat}
          idPurchaseBytes={idPurchaseBytes}
          idPurchaseOwnerAddress={idPurchaseOwnerAddress}
          idPurchaseReceiveAddress={idPurchaseReceiveAddress}
          idSaleAuthorization={idSaleAuthorization}
          idSaleBuyerAddress={idSaleBuyerAddress}
          idSalePriceSats={idSalePriceSats}
          idSaleReceiveAddress={idSaleReceiveAddress}
          managedIdName={managedIdRecord?.id ?? ""}
          network={network}
          onNetworkChange={chooseNetwork}
          publishListing={publishIdListing}
          pendingEvents={idPendingEvents.filter(
            (event) => event.network === "livenet",
          )}
          registryAddress={registryAddressForNetwork("livenet")}
          registryListings={idListings.filter(
            (listing) => listing.network === "livenet",
          )}
          registryRecords={idRegistry.filter(
            (record) => record.network === "livenet",
          )}
          registrySales={idSales.filter((sale) => sale.network === "livenet")}
          sealListing={sealIdListing}
          setIdPurchaseOwnerAddress={setIdPurchaseOwnerAddress}
          setIdPurchaseReceiveAddress={setIdPurchaseReceiveAddress}
          setIdSaleBuyerAddress={setIdSaleBuyerAddress}
          setIdSalePriceSats={setIdSalePriceSats}
          setIdSaleReceiveAddress={setIdSaleReceiveAddress}
          setFeeRate={setFeeRate}
          setManagedIdName={(id) => {
            setManagedIdName(id);
            setIdSaleAuthorization("");
            setIdSelectedListingId("");
          }}
          status={status}
          submitPurchase={purchaseId}
          tokenClosedListings={tokenClosedListings.filter(
            (listing) => listing.network === "livenet",
          )}
          tokenListings={tokenListings.filter(
            (listing) => listing.network === "livenet",
          )}
          tokenMints={tokenMints.filter((mint) => mint.network === "livenet")}
          tokenSales={tokenSales.filter((sale) => sale.network === "livenet")}
          tokens={orderedTokenDefinitions.filter(
            (token) => token.network === "livenet",
          )}
          tokenTransfers={tokenTransfers.filter(
            (transfer) => transfer.network === "livenet",
          )}
          workFloorLoading={workFloorLoading}
          workFloorQuote={workFloorQuote}
          buyTokenListing={buyTokenListing}
          useListing={(listing) => {
            setIdSaleAuthorization(
              JSON.stringify(listing.saleAuthorization, null, 2),
            );
            setIdSelectedListingId(listing.listingId);
            setIdPurchaseOwnerAddress(address);
            setIdPurchaseReceiveAddress(listing.receiveAddress ?? "");
          }}
          onRefreshIds={() => void refreshIds()}
          onRefreshTokens={() =>
            void refreshTokenMarketData({
              includeWorkFloor: true,
              label: "token marketplace",
            })
          }
        />
        <MarketplacePurchaseReceiptModal
          receipt={purchaseReceipt}
          onClose={() => setPurchaseReceipt(undefined)}
        />
      </>
    );
  }

  if (walletMode) {
    return (
      <TokenWalletApp
        address={address}
        balances={tokenWalletBalances}
        btcUsd={tokenBtcUsd}
        busy={busy}
        canList={canListToken}
        canTransfer={canTransferToken}
        connectWallet={connectWallet}
        delistListing={delistTokenListing}
        disconnectWallet={disconnectWallet}
        feeRate={feeRate}
        hasUnisat={hasUnisat}
        listAmount={tokenListAmount}
        listBuyerAddress={tokenListBuyerAddress}
        listPriceSats={tokenListPriceSats}
        listing={tokenAction === "list"}
        listings={tokenListings}
        listSpendableBalance={walletSpendableTokenBalance}
        network={network}
        onNetworkChange={chooseNetwork}
        onRefresh={() =>
          void refreshTokenMarketData({
            includeWorkFloor: true,
            label: "wallet market data",
          })
        }
        sealListing={sealTokenListing}
        selectedTokenId={walletTransferToken?.tokenId ?? ""}
        setFeeRate={setFeeRate}
        setListAmount={setTokenListAmount}
        setListBuyerAddress={setTokenListBuyerAddress}
        setListPriceSats={setTokenListPriceSats}
        setSelectedTokenId={setTokenTransferTokenId}
        setTransferAmount={setTokenTransferAmount}
        setTransferRecipient={setTokenTransferRecipient}
        status={status}
        submitList={listToken}
        submitTransfer={transferToken}
        transferAmount={tokenTransferAmount}
        transferBalance={walletTransferBalance}
        transferBytes={tokenTransferBytes}
        transferRecipient={tokenTransferRecipient}
        transferToken={walletTransferToken}
        transferring={tokenAction === "transfer"}
        tokenSales={tokenSales}
        transfers={tokenTransfers}
        workFloorLoading={workFloorLoading}
        workFloorQuote={workFloorQuote}
      />
    );
  }

  if (tokenMode || workTokenMode) {
    return (
      <TokenApp
        address={address}
        busy={busy}
        canCreate={canCreateToken}
        canMint={canMintToken}
        canPrepareMintUtxos={canPrepareTokenMintUtxos}
        confirmedSupply={selectedTokenLedger.confirmedSupply}
        connectWallet={connectWallet}
        createBytes={tokenCreateBytes}
        creatingToken={tokenAction === "create"}
        createMaxSupply={tokenCreateMaxSupply}
        createMintAmount={tokenCreateMintAmount}
        createMintPriceSats={tokenCreateMintPriceSats}
        createRegistryAddress={tokenCreateRegistryAddress}
        createRegistryResolution={tokenRegistryResolution}
        createTicker={tokenCreateTicker}
        creationSats={tokenCreationSats}
        createToken={createToken}
        detailConfirmedSupply={tokenDetailLedger.confirmedSupply}
        detailHolders={tokenDetailLedger.holders}
        detailMints={tokenDetailLedger.mints}
        detailPendingSupply={tokenDetailLedger.pendingSupply}
        detailToken={tokenDetailToken}
        disconnectWallet={disconnectWallet}
        feeRate={feeRate}
        btcUsd={tokenBtcUsd}
        hasUnisat={hasUnisat}
        holders={selectedTokenLedger.holders}
        mintBytes={tokenMintBytes}
        network={network}
        onNetworkChange={chooseNetwork}
        mintAssistantCompleted={tokenMintAssistantCompleted}
        mintAssistantDelayMs={tokenMintAssistantDelayMs}
        mintAssistantRemaining={tokenMintAssistantRemaining}
        mintAssistantRunning={tokenMintAssistantRunning}
        mintAssistantTarget={tokenMintAssistantTarget}
        mintingToken={tokenAction === "mint"}
        mints={selectedTokenLedger.mints}
        pendingSupply={selectedTokenLedger.pendingSupply}
        prepareFeeRate={tokenPrepareFeeRate}
        prepareFeeReserveSats={tokenPrepareFeeReserveSats}
        prepareMintCount={tokenPrepareMintCount}
        prepareMintUtxos={prepareTokenMintUtxos}
        preparingMintUtxos={tokenAction === "split"}
        selectedToken={selectedToken}
        selectedTokenId={selectedToken?.tokenId ?? ""}
        setFeeRate={setFeeRate}
        setMintAssistantDelayMs={setTokenMintAssistantDelayMs}
        setMintAssistantTarget={setTokenMintAssistantTarget}
        setPrepareFeeRate={setTokenPrepareFeeRate}
        setCreateMaxSupply={setTokenCreateMaxSupply}
        setCreateMintAmount={setTokenCreateMintAmount}
        setCreateMintPriceSats={setTokenCreateMintPriceSats}
        setCreateRegistryAddress={setTokenCreateRegistryAddress}
        setCreateTicker={setTokenCreateTicker}
        setPrepareFeeReserveSats={setTokenPrepareFeeReserveSats}
        setPrepareMintCount={setTokenPrepareMintCount}
        setSelectedTokenId={setTokenSelectedId}
        setTokenDetailTarget={setTokenDetailTarget}
        status={status}
        tokenDetailTarget={effectiveTokenDetailTarget}
        tokenIndexAddress={tokenIndexAddressForNetwork("livenet")}
        tokenListings={tokenListings}
        tokenSales={tokenSales}
        tokens={orderedTokenDefinitions}
        workFloorLoading={workFloorLoading}
        workFloorQuote={workFloorQuote}
        startMintAssistant={startTokenMintAssistant}
        stopMintAssistant={stopTokenMintAssistant}
        submitMint={mintToken}
        workTokenOnly={workTokenMode}
        onRefresh={() =>
          void refreshTokenMarketData({
            includeWorkFloor: workTokenMode || tokenRouteShowsWorkFloor,
            label: workTokenMode ? "WORK market data" : "token data",
          })
        }
      />
    );
  }

  if (rushMode) {
    return (
      <RushApp
        address={address}
        busy={busy}
        connectWallet={connectWallet}
        disconnectWallet={disconnectWallet}
        feeRate={feeRate}
        hasUnisat={hasUnisat}
        mintCount={rushMintCount}
        mintDelayMs={rushMintDelayMs}
        minting={rushMinting}
        network={network}
        onMint={mintRush}
        onNetworkChange={chooseNetwork}
        onRefresh={() => void refreshRush()}
        onStopMint={stopRushMint}
        setFeeRate={setFeeRate}
        setMintCount={setRushMintCount}
        setMintDelayMs={setRushMintDelayMs}
        state={rushState}
        status={status}
      />
    );
  }

  if (desktopRoute) {
    return (
      <DesktopApp
        activeNetwork={network}
        busy={desktopLoading}
        desktopQuery={desktopQuery}
        fileFilter={fileFilter}
        messages={desktopMail}
        profile={desktopProfile}
        selectedKey={desktopSelectedKey}
        setDesktopQuery={setDesktopQuery}
        setFileFilter={setFileFilter}
        onNetworkChange={chooseNetwork}
        setSortMode={setSortMode}
        sortMode={sortMode}
        status={status}
        onClear={clearDesktop}
        onRefresh={() => void loadDesktopTarget()}
        onSearch={(event) => {
          event.preventDefault();
          void loadDesktopTarget();
        }}
        onSelect={(message) => setDesktopSelectedKey(mailKey(message))}
      />
    );
  }

  if (browserRoute) {
    return <BrowserApp />;
  }

  if (activityMode) {
    return (
      <ActivityApp
        activeNetwork={network}
        activityHistoryPage={activityHistoryPage}
        activityStats={activityStats}
        busy={activityLoading || busy}
        idActivity={idActivity.filter((item) => item.network === "livenet")}
        onNetworkChange={chooseNetwork}
        profile={activityProfile}
        query={activityQuery}
        searchedActivity={activityMail}
        setQuery={setActivityQuery}
        status={status}
        onClear={clearActivity}
        onActivityPageChange={(pageIndex) =>
          void loadLogHistoryPage(pageIndex, false)
        }
        onRefresh={() => {
          void refreshLogSurface(false, true);
          if (activityProfile) {
            void loadActivityTarget(activityProfile.query);
          }
        }}
        onSearch={(event) => {
          event.preventDefault();
          void loadActivityTarget();
        }}
      />
    );
  }

  if (growthMode) {
    return (
      <GrowthApp
        activeNetwork={network}
        btcUsd={tokenBtcUsd}
        busy={busy}
        idActivity={idActivity.filter((item) => item.network === "livenet")}
        registryListings={idListings.filter(
          (listing) => listing.network === "livenet",
        )}
        registryRecords={idRegistry.filter(
          (record) => record.network === "livenet",
        )}
        registrySales={idSales.filter((sale) => sale.network === "livenet")}
        growthSummary={growthSummary}
        status={status}
        tokenDefinitions={tokenDefinitions.filter(
          (token) => token.network === "livenet",
        )}
        tokenMints={tokenMints.filter((mint) => mint.network === "livenet")}
        tokenSales={tokenSales.filter((sale) => sale.network === "livenet")}
        tokenTransfers={tokenTransfers.filter(
          (transfer) => transfer.network === "livenet",
        )}
        workFloorQuote={workFloorQuote}
        onNetworkChange={chooseNetwork}
        onRefresh={() => void refreshGrowth()}
      />
    );
  }

  const layoutClassName = [
    "mail-layout",
    address ? "" : "is-onboarding",
    activeFolder === "token" ||
    activeFolder === "wallet" ||
    activeFolder === "work"
      ? "is-token-workspace"
      : "",
    activeFolder === "marketplace" ? "is-marketplace-workspace" : "",
    activeFolder === "browser" ? "is-browser-workspace" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className="mail-app">
      <AppHeader
        address={address}
        busy={busy}
        connectWallet={connectWallet}
        disconnectWallet={disconnectWallet}
        hasUnisat={hasUnisat}
        network={network}
        onNetworkChange={chooseNetwork}
        onRefresh={
          refreshDisabled
            ? undefined
            : () => {
                if (
                  activeFolder === "token" ||
                  activeFolder === "wallet" ||
                  activeFolder === "work"
                ) {
                  void refreshTokenMarketData({
                    includeWorkFloor:
                      activeFolder === "wallet" ||
                      activeFolder === "work" ||
                      tokenRouteShowsWorkFloor,
                    label:
                      activeFolder === "work"
                        ? "WORK market data"
                        : activeFolder === "wallet"
                          ? "wallet market data"
                          : "token data",
                  });
                  return;
                }

                if (activeFolder === "marketplace") {
                  void refreshTokenMarketData({
                    includeWorkFloor: true,
                    label: "marketplace data",
                  });
                  return;
                }

                if (
                  activeFolder === "ids" ||
                  activeFolder === "log" ||
                  activeFolder === "contacts"
                ) {
                  if (activeFolder === "log") {
                    void refreshLogSurface(false, true);
                    if (activityProfile) {
                      void loadActivityTarget(activityProfile.query);
                    }
                    return;
                  }

                  void refreshIds();
                  return;
                }

                void (activeFolder === "desktop"
                  ? loadDesktopTarget()
                  : refreshMail(activeFolder));
              }
        }
        subtitle={networkLabel(network)}
        title="ProofOfWork.Me"
      />

      <AppStatusRow persistent status={status} />

      <section className={layoutClassName}>
        <aside className="sidebar">
          <button className="compose-button" onClick={composeNew} type="button">
            <span className="button-content">
              <PenLine size={17} />
              <span>Compose</span>
            </span>
          </button>

          <nav className="folders" aria-label="Folders">
            <button
              aria-current={activeFolder === "inbox"}
              onClick={() => openFolder("inbox")}
              type="button"
            >
              <span className="folder-label">
                <Inbox size={17} />
                <span>Inbox</span>
              </span>
              <strong>{inboxMail.length}</strong>
            </button>
            <button
              aria-current={activeFolder === "incoming"}
              onClick={() => openFolder("incoming")}
              type="button"
            >
              <span className="folder-label">
                <Mail size={17} />
                <span>Incoming</span>
              </span>
              <strong>{incomingMail.length}</strong>
            </button>
            <button
              aria-current={activeFolder === "sent"}
              onClick={() => openFolder("sent")}
              type="button"
            >
              <span className="folder-label">
                <Send size={17} />
                <span>Sent</span>
              </span>
              <strong>{sentMail.length}</strong>
            </button>
            <button
              aria-current={activeFolder === "outbox"}
              onClick={() => openFolder("outbox")}
              type="button"
            >
              <span className="folder-label">
                <Clock size={17} />
                <span>Outbox</span>
              </span>
              <strong>{outboxMail.length}</strong>
            </button>
            <button
              aria-current={activeFolder === "drafts"}
              onClick={() => openFolder("drafts")}
              type="button"
            >
              <span className="folder-label">
                <FilePenLine size={17} />
                <span>Drafts</span>
              </span>
              <strong>{savedDraft ? 1 : 0}</strong>
            </button>
            <button
              aria-current={activeFolder === "favorites"}
              onClick={() => openFolder("favorites")}
              type="button"
            >
              <span className="folder-label">
                <Star size={17} />
                <span>Favorites</span>
              </span>
              <strong>{favoritesMail.length}</strong>
            </button>
            <button
              aria-current={activeFolder === "archive"}
              onClick={() => openFolder("archive")}
              type="button"
            >
              <span className="folder-label">
                <Archive size={17} />
                <span>Archive</span>
              </span>
              <strong>{archiveMail.length}</strong>
            </button>
            {customFolders.map((folder) => (
              <div className="custom-folder-row" key={folder.id}>
                <button
                  aria-current={
                    activeFolder === "custom" &&
                    activeCustomFolderId === folder.id
                  }
                  onClick={() => {
                    setActiveFolder("custom");
                    setActiveCustomFolderId(folder.id);
                    setComposeOpen(false);
                    setSelectedKey("");
                  }}
                  type="button"
                >
                  <span className="folder-label">
                    <FolderPlus size={17} />
                    <span>{folder.name}</span>
                  </span>
                  <strong>{customFolderCounts.get(folder.id) ?? 0}</strong>
                </button>
                <button
                  aria-label={`Remove ${folder.name}`}
                  className="custom-folder-remove"
                  onClick={() => removeCustomFolder(folder.id)}
                  type="button"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <form className="custom-folder-form" onSubmit={createCustomFolder}>
              <input
                aria-label="New folder name"
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder="New folder"
                value={newFolderName}
              />
              <button
                aria-label="Create folder"
                className="icon-button"
                type="submit"
              >
                <FolderPlus size={15} />
              </button>
            </form>
            <button
              aria-current={activeFolder === "files"}
              onClick={() => openFolder("files")}
              type="button"
            >
              <span className="folder-label">
                <Paperclip size={17} />
                <span>Files</span>
              </span>
              <strong>{allFileMessages.length}</strong>
            </button>
            <button
              aria-current={activeFolder === "desktop"}
              onClick={() => openFolder("desktop")}
              type="button"
            >
              <span className="folder-label">
                <Monitor size={17} />
                <span>Desktop</span>
              </span>
              <strong>{desktopFileMessages.length}</strong>
            </button>
            <button
              aria-current={activeFolder === "browser"}
              onClick={() => openFolder("browser")}
              type="button"
            >
              <span className="folder-label">
                <FileText size={17} />
                <span>Browser</span>
              </span>
            </button>
            <button
              aria-current={activeFolder === "ids"}
              onClick={() => openFolder("ids")}
              type="button"
            >
              <span className="folder-label">
                <AtSign size={17} />
                <span>IDs</span>
              </span>
              <strong>{ownedIdCount + walletPendingIdEvents.length}</strong>
            </button>
            <button
              aria-current={activeFolder === "marketplace"}
              onClick={() => openFolder("marketplace")}
              type="button"
            >
              <span className="folder-label">
                <Users size={17} />
                <span>Marketplace</span>
              </span>
              <strong>{ownerControlledIds.length}</strong>
            </button>
            <button
              aria-current={activeFolder === "token"}
              onClick={() => openFolder("token")}
              type="button"
            >
              <span className="folder-label">
                <FilePenLine size={17} />
                <span>Token</span>
              </span>
              <strong>{tokenDefinitions.length}</strong>
            </button>
            <button
              aria-current={activeFolder === "wallet"}
              onClick={() => openFolder("wallet")}
              type="button"
            >
              <span className="folder-label">
                <Wallet size={17} />
                <span>Wallet</span>
              </span>
              <strong>{tokenWalletBalances.length}</strong>
            </button>
            <button
              aria-current={activeFolder === "work"}
              onClick={() => openFolder("work")}
              type="button"
            >
              <span className="folder-label">
                <TrendingUp size={17} />
                <span>WORK</span>
              </span>
              <strong>{workTokenLedger.confirmedSupply.toLocaleString()}</strong>
            </button>
            <button
              aria-current={activeFolder === "log"}
              onClick={() => openFolder("log")}
              type="button"
            >
              <span className="folder-label">
                <Clock size={17} />
                <span>Log</span>
              </span>
              <strong>
                {(activityStats?.total ?? idActivity.length).toLocaleString()}
              </strong>
            </button>
            <button
              aria-current={activeFolder === "contacts"}
              onClick={() => openFolder("contacts")}
              type="button"
            >
              <span className="folder-label">
                <Users size={17} />
                <span>Contacts</span>
              </span>
              <strong>{contactsForNetwork.length}</strong>
            </button>
            {registryAddress ? (
              <div
                className="registry-network-stat"
                aria-label="ProofOfWork ID registry network total"
              >
                <span>Registry Network</span>
                <strong>{idRegistry.length.toLocaleString()}</strong>
                <small>
                  {confirmedIdCount.toLocaleString()} confirmed ·{" "}
                  {pendingIdCount.toLocaleString()} pending IDs
                  {pendingIdEventCount
                    ? ` · ${pendingIdEventCount.toLocaleString()} changes`
                    : ""}
                </small>
              </div>
            ) : null}
          </nav>

          <div className="account-box">
            <span>Account</span>
            <code>{address || "Not connected"}</code>
            <div className="backup-actions" aria-label="Local data backup">
              <button
                className="secondary small"
                onClick={exportBackup}
                type="button"
              >
                <span className="button-content">
                  <Download size={15} />
                  <span>Export</span>
                </span>
              </button>
              <button
                className="secondary small"
                onClick={() => backupInputRef.current?.click()}
                type="button"
              >
                <span className="button-content">
                  <Upload size={15} />
                  <span>Import</span>
                </span>
              </button>
            </div>
            <input
              ref={backupInputRef}
              accept="application/json,.json"
              className="backup-file-input"
              onChange={(event) => void importBackup(event)}
              type="file"
            />
          </div>
        </aside>

        {activeFolder === "ids" ? (
          <IdsWorkspace
            address={address}
            busy={busy}
            canRegister={canRegisterId}
            contacts={contactsForNetwork}
            feeRate={feeRate}
            idName={idName}
            idPgpKey={idPgpKey}
            idReceiveAddress={idReceiveAddress}
            idTransferBytes={idTransferBytes}
            idTransferOwnerAddress={idTransferOwnerAddress}
            idTransferReceiveAddress={idTransferReceiveAddress}
            idUpdateReceiveAddress={idUpdateReceiveAddress}
            idReceiverUpdateBytes={idReceiverUpdateBytes}
            managedIdName={managedIdRecord?.id ?? ""}
            network={network}
            pendingEvents={idPendingEvents}
            registryAddress={registryAddress}
            registryRecords={idRegistry}
            registrationBytes={idRegistrationBytes}
            lastRegisteredId={
              lastRegisteredId?.network === network
                ? lastRegisteredId
                : undefined
            }
            canTransfer={canTransferId}
            canUpdate={canUpdateId}
            setFeeRate={setFeeRate}
            setManagedIdName={(id) => {
              setManagedIdName(id);
              setIdUpdateReceiveAddress("");
              setIdTransferOwnerAddress("");
              setIdTransferReceiveAddress("");
            }}
            setIdName={setIdName}
            setIdPgpKey={setIdPgpKey}
            setIdReceiveAddress={setIdReceiveAddress}
            setIdTransferOwnerAddress={setIdTransferOwnerAddress}
            setIdTransferReceiveAddress={setIdTransferReceiveAddress}
            setIdUpdateReceiveAddress={setIdUpdateReceiveAddress}
            onAddContact={addRegistryContact}
            onRefresh={() => void refreshIds()}
            submitTransfer={transferId}
            submitUpdate={updateIdReceiver}
            submit={registerId}
          />
        ) : activeFolder === "marketplace" ? (
          <MarketplaceWorkspace
            address={address}
            btcUsd={tokenBtcUsd}
            busy={busy}
            canCreateSaleAuthorization={canCreateSaleAuthorization}
            canPurchaseId={canPurchaseId}
            delistListing={delistIdListing}
            feeRate={feeRate}
            idPurchaseBytes={idPurchaseBytes}
            idPurchaseOwnerAddress={idPurchaseOwnerAddress}
            idPurchaseReceiveAddress={idPurchaseReceiveAddress}
            idSaleAuthorization={idSaleAuthorization}
            idSaleBuyerAddress={idSaleBuyerAddress}
            idSalePriceSats={idSalePriceSats}
            idSaleReceiveAddress={idSaleReceiveAddress}
            managedIdName={managedIdName}
            network={network}
            pendingEvents={idPendingEvents}
            publishListing={publishIdListing}
            registryAddress={registryAddress}
            registryListings={idListings}
            registryRecords={idRegistry}
            registrySales={idSales}
            sealListing={sealIdListing}
            setIdPurchaseOwnerAddress={setIdPurchaseOwnerAddress}
            setIdPurchaseReceiveAddress={setIdPurchaseReceiveAddress}
            setIdSaleBuyerAddress={setIdSaleBuyerAddress}
            setIdSalePriceSats={setIdSalePriceSats}
            setIdSaleReceiveAddress={setIdSaleReceiveAddress}
            setFeeRate={setFeeRate}
            setManagedIdName={(id) => {
              setManagedIdName(id);
              setIdSaleAuthorization("");
              setIdSelectedListingId("");
            }}
            status={status}
            submitPurchase={purchaseId}
            buyTokenListing={buyTokenListing}
            tokenClosedListings={tokenClosedListings}
            tokenListings={tokenListings}
            tokenMints={tokenMints}
            tokenSales={tokenSales}
            tokens={orderedTokenDefinitions}
            tokenTransfers={tokenTransfers}
            workFloorLoading={workFloorLoading}
            workFloorQuote={workFloorQuote}
            onOpenTokenWorkspace={openTokenWorkspace}
            onOpenWalletWorkspace={openWalletWorkspace}
            useListing={(listing) => {
              setIdSaleAuthorization(
                JSON.stringify(listing.saleAuthorization, null, 2),
              );
              setIdSelectedListingId(listing.listingId);
              setIdPurchaseOwnerAddress(address);
              setIdPurchaseReceiveAddress(listing.receiveAddress ?? "");
            }}
            onRefreshIds={() => void refreshIds()}
            onRefreshTokens={() =>
              void refreshTokenMarketData({
                includeWorkFloor: true,
                label: "token marketplace",
              })
            }
          />
        ) : activeFolder === "wallet" ? (
          <TokenWalletWorkspace
            address={address}
            balances={tokenWalletBalances}
            btcUsd={tokenBtcUsd}
            canList={canListToken}
            canTransfer={canTransferToken}
            compact
            delistListing={delistTokenListing}
            feeRate={feeRate}
            listAmount={tokenListAmount}
            listBuyerAddress={tokenListBuyerAddress}
            listPriceSats={tokenListPriceSats}
            listing={tokenAction === "list"}
            listings={tokenListings}
            listSpendableBalance={walletSpendableTokenBalance}
            sealListing={sealTokenListing}
            selectedTokenId={walletTransferToken?.tokenId ?? ""}
            setFeeRate={setFeeRate}
            setListAmount={setTokenListAmount}
            setListBuyerAddress={setTokenListBuyerAddress}
            setListPriceSats={setTokenListPriceSats}
            setSelectedTokenId={setTokenTransferTokenId}
            setTransferAmount={setTokenTransferAmount}
            setTransferRecipient={setTokenTransferRecipient}
            submitList={listToken}
            submitTransfer={transferToken}
            tokenSales={tokenSales}
            transferAmount={tokenTransferAmount}
            transferBalance={walletTransferBalance}
            transferBytes={tokenTransferBytes}
            transferRecipient={tokenTransferRecipient}
            transferToken={walletTransferToken}
            transferring={tokenAction === "transfer"}
            transfers={tokenTransfers}
            workFloorLoading={workFloorLoading}
            workFloorQuote={workFloorQuote}
          />
        ) : activeFolder === "token" || activeFolder === "work" ? (
          <TokenWorkspace
            address={address}
            busy={busy}
            canCreate={canCreateToken}
            canMint={canMintToken}
            canPrepareMintUtxos={canPrepareTokenMintUtxos}
            compact
            confirmedSupply={selectedTokenLedger.confirmedSupply}
            createBytes={tokenCreateBytes}
            creatingToken={tokenAction === "create"}
            createMaxSupply={tokenCreateMaxSupply}
            createMintAmount={tokenCreateMintAmount}
            createMintPriceSats={tokenCreateMintPriceSats}
            createRegistryAddress={tokenCreateRegistryAddress}
            createRegistryResolution={tokenRegistryResolution}
            createTicker={tokenCreateTicker}
            creationSats={tokenCreationSats}
            createToken={createToken}
            detailConfirmedSupply={tokenDetailLedger.confirmedSupply}
            detailHolders={tokenDetailLedger.holders}
            detailMints={tokenDetailLedger.mints}
            detailPendingSupply={tokenDetailLedger.pendingSupply}
            detailToken={tokenDetailToken}
            feeRate={feeRate}
            btcUsd={tokenBtcUsd}
            holders={selectedTokenLedger.holders}
            mintBytes={tokenMintBytes}
            network={network}
            mintAssistantCompleted={tokenMintAssistantCompleted}
            mintAssistantDelayMs={tokenMintAssistantDelayMs}
            mintAssistantRemaining={tokenMintAssistantRemaining}
            mintAssistantRunning={tokenMintAssistantRunning}
            mintAssistantTarget={tokenMintAssistantTarget}
            mintingToken={tokenAction === "mint"}
            mints={selectedTokenLedger.mints}
            pendingSupply={selectedTokenLedger.pendingSupply}
            prepareFeeRate={tokenPrepareFeeRate}
            prepareFeeReserveSats={tokenPrepareFeeReserveSats}
            prepareMintCount={tokenPrepareMintCount}
            prepareMintUtxos={prepareTokenMintUtxos}
            preparingMintUtxos={tokenAction === "split"}
            selectedToken={selectedToken}
            selectedTokenId={selectedToken?.tokenId ?? ""}
            setFeeRate={setFeeRate}
            setMintAssistantDelayMs={setTokenMintAssistantDelayMs}
            setMintAssistantTarget={setTokenMintAssistantTarget}
            setPrepareFeeRate={setTokenPrepareFeeRate}
            setCreateMaxSupply={setTokenCreateMaxSupply}
            setCreateMintAmount={setTokenCreateMintAmount}
            setCreateMintPriceSats={setTokenCreateMintPriceSats}
            setCreateRegistryAddress={setTokenCreateRegistryAddress}
            setCreateTicker={setTokenCreateTicker}
            setPrepareFeeReserveSats={setTokenPrepareFeeReserveSats}
            setPrepareMintCount={setTokenPrepareMintCount}
            setSelectedTokenId={setTokenSelectedId}
            setTokenDetailTarget={setTokenDetailTarget}
            submitMint={mintToken}
            tokenDetailTarget={
              activeFolder === "work" ? WORK_TOKEN_TICKER : ""
            }
            tokenIndexAddress={tokenIndexAddressForNetwork("livenet")}
            tokenListings={tokenListings}
            tokenSales={tokenSales}
            tokens={orderedTokenDefinitions}
            workFloorLoading={workFloorLoading}
            workFloorQuote={workFloorQuote}
            startMintAssistant={startTokenMintAssistant}
            stopMintAssistant={stopTokenMintAssistant}
            workTokenOnly={activeFolder === "work"}
            onOpenTokenFactory={() => openTokenWorkspace()}
            onRefresh={() =>
              void refreshTokenMarketData({
                includeWorkFloor: activeFolder === "work",
                label:
                  activeFolder === "work" ? "WORK market data" : "token data",
              })
            }
          />
        ) : activeFolder === "contacts" ? (
          <ContactsWorkspace
            contacts={contactsForNetwork}
            network={network}
            onAdd={addManualContact}
            onCompose={composeToContact}
            onRemove={removeContact}
          />
        ) : activeFolder === "desktop" ? (
          <DesktopWorkspace
            activeNetwork={network}
            busy={desktopLoading}
            desktopQuery={desktopQuery}
            fileFilter={fileFilter}
            messages={desktopMail}
            profile={desktopProfile}
            selectedKey={desktopSelectedKey}
            setDesktopQuery={setDesktopQuery}
            setFileFilter={setFileFilter}
            setSortMode={setSortMode}
            sortMode={sortMode}
            onClear={clearDesktop}
            onRefresh={() => void loadDesktopTarget()}
            onSearch={(event) => {
              event.preventDefault();
              void loadDesktopTarget();
            }}
            onSelect={(message) => setDesktopSelectedKey(mailKey(message))}
          />
        ) : activeFolder === "browser" ? (
          <BrowserWorkspace activeNetwork={network} />
        ) : activeFolder === "log" ? (
          <ActivityWorkspace
            activeNetwork={network}
            activityHistoryPage={activityHistoryPage}
            activityStats={activityStats}
            busy={activityLoading || busy}
            idActivity={idActivity}
            profile={activityProfile}
            query={activityQuery}
            searchedActivity={activityMail}
            setQuery={setActivityQuery}
            onClear={clearActivity}
            onActivityPageChange={(pageIndex) =>
              void loadLogHistoryPage(pageIndex, false)
            }
            onRefresh={() => {
              void refreshLogSurface(false, true);
              if (activityProfile) {
                void loadActivityTarget(activityProfile.query);
              }
            }}
            onSearch={(event) => {
              event.preventDefault();
              void loadActivityTarget();
            }}
          />
        ) : activeFolder === "files" ? (
          <FilesWorkspace
            activeKey={selectedMessage ? mailKey(selectedMessage) : ""}
            activeNetwork={network}
            busy={busy || refreshInProgress}
            connected={Boolean(address)}
            fileFilter={fileFilter}
            messages={activeMessages}
            refreshing={refreshInProgress}
            selectedMessage={
              selectedMessage && hasAttachment(selectedMessage)
                ? selectedMessage
                : undefined
            }
            setFileFilter={setFileFilter}
            setSortMode={setSortMode}
            sortMode={sortMode}
            onOpenInbox={() => openFolder("inbox")}
            onOpenMessage={openSourceMessage}
            onRefresh={() => void refreshMail("files")}
            onSelect={(message) => {
              setComposeOpen(false);
              setSelectedKey(mailKey(message));
            }}
          />
        ) : (
          <>
            <section className="message-column">
              <div className="list-toolbar">
                <div>
                  <h2>
                    {activeFolder === "custom"
                      ? (activeCustomFolder?.name ?? "Folder")
                      : folderLabel(activeFolder)}
                  </h2>
                  <span>
                    {activeFolder === "custom"
                      ? "Local folder"
                      : folderSubtitle(activeFolder)}
                  </span>
                </div>
                {activeFolder === "drafts" ? null : (
                  <label className="sort-control">
                    Sort
                    <select
                      value={sortMode}
                      onChange={(event) =>
                        setSortMode(event.target.value as SortMode)
                      }
                    >
                      <option value="value">Highest sats</option>
                      <option value="newest">Newest</option>
                      <option value="oldest">Oldest</option>
                      <option value="thread">Thread</option>
                    </select>
                  </label>
                )}
                {activeFolder !== "drafts" ? (
                  <button
                    className="secondary small"
                    disabled={refreshDisabled}
                    onClick={() => void refreshMail(activeFolder)}
                    type="button"
                  >
                    <span className="button-content">
                      <RefreshCw
                        className={refreshInProgress ? "refresh-spin" : ""}
                        size={15}
                      />
                      <span>
                        {refreshInProgress ? "Refreshing" : "Refresh"}
                      </span>
                    </span>
                  </button>
                ) : null}
              </div>

              {activeFolder === "drafts" ? (
                <DraftList
                  draft={savedDraft}
                  onCompose={composeNew}
                  onDiscard={discardDraft}
                  onOpen={(draft) => {
                    applyDraft(draft);
                    setStatus({
                      tone: "idle",
                      text: `Draft restored. Last saved ${formatDate(draft.updatedAt)}.`,
                    });
                  }}
                />
              ) : (
                <MessageList
                  activeKey={selectedMessage ? mailKey(selectedMessage) : ""}
                  activeNetwork={network}
                  activeFolder={activeFolder}
                  favoriteKeys={favoriteKeys}
                  inboxCount={inboxMail.length}
                  messages={activeMessages}
                  onOpenInbox={() => openFolder("inbox")}
                  onSelect={(message) => {
                    setComposeOpen(false);
                    setSelectedKey(mailKey(message));
                  }}
                />
              )}
            </section>

            <section className="reader-pane">
              {!address ? (
                <OnboardingPane
                  busy={busy}
                  hasUnisat={hasUnisat}
                  network={network}
                  onConnect={connectWallet}
                />
              ) : activeFolder === "drafts" && composeOpen ? (
                <ComposePane
                  amountSats={amountSats}
                  attachment={attachment}
                  busy={busy}
                  canSend={canSend}
                  contacts={contactsForNetwork}
                  dataCarrierBytes={dataCarrierBytes}
                  draftMode
                  feeRate={feeRate}
                  memo={memo}
                  network={network}
                  ccRecipient={ccRecipient}
                  ccRecipientError={Boolean(ccRecipientResolution.error)}
                  ccRecipientNote={ccRecipientNote}
                  onDiscardDraft={discardDraft}
                  parentTxid={replyParentTxid}
                  recipient={recipient}
                  recipientError={Boolean(recipientResolution.error)}
                  recipientNote={recipientNote}
                  sender={address}
                  setAttachment={setAttachment}
                  setAttachmentFile={(file) => void attachFile(file)}
                  setParentTxid={setReplyParentTxid}
                  setAmountSats={setAmountSats}
                  setCcRecipient={setCcRecipient}
                  setFeeRate={setFeeRate}
                  setMemo={setMemo}
                  setRecipient={setRecipient}
                  setSubject={setSubject}
                  subject={subject}
                  submit={sendOpReturn}
                />
              ) : activeFolder === "drafts" ? (
                <div className="empty-reader">
                  <div className="empty-icon" aria-hidden="true">
                    <FilePenLine size={26} />
                  </div>
                  <h3>No draft selected</h3>
                  <button
                    className="compose-button"
                    onClick={composeNew}
                    type="button"
                  >
                    <span className="button-content">
                      <PenLine size={17} />
                      <span>Compose</span>
                    </span>
                  </button>
                </div>
              ) : composeOpen ? (
                <ComposePane
                  amountSats={amountSats}
                  attachment={attachment}
                  busy={busy}
                  canSend={canSend}
                  contacts={contactsForNetwork}
                  feeRate={feeRate}
                  memo={memo}
                  dataCarrierBytes={dataCarrierBytes}
                  network={network}
                  ccRecipient={ccRecipient}
                  ccRecipientError={Boolean(ccRecipientResolution.error)}
                  ccRecipientNote={ccRecipientNote}
                  parentTxid={replyParentTxid}
                  recipient={recipient}
                  recipientError={Boolean(recipientResolution.error)}
                  recipientNote={recipientNote}
                  sender={address}
                  setAttachment={setAttachment}
                  setAttachmentFile={(file) => void attachFile(file)}
                  setParentTxid={setReplyParentTxid}
                  setAmountSats={setAmountSats}
                  setCcRecipient={setCcRecipient}
                  setFeeRate={setFeeRate}
                  setMemo={setMemo}
                  setRecipient={setRecipient}
                  setSubject={setSubject}
                  subject={subject}
                  submit={sendOpReturn}
                />
              ) : selectedMessage ? (
                <Reader
                  activeNetwork={network}
                  archivable={canArchive(selectedMessage)}
                  archived={isArchived(selectedMessage)}
                  checkingBroadcasts={checkingBroadcasts}
                  deliveryStatus={
                    selectedMessage.folder === "sent"
                      ? sentDeliveryStatus(selectedMessage)
                      : undefined
                  }
                  favoriteable={canFavorite(selectedMessage)}
                  favorited={isFavorite(selectedMessage)}
                  folderIds={messageFolderIds(selectedMessage)}
                  folderable={canUseCustomFolders(selectedMessage)}
                  activeCustomFolderId={
                    activeFolder === "custom" ? activeCustomFolderId : ""
                  }
                  customFolders={customFolders}
                  message={selectedMessage}
                  onArchiveToggle={setMessageArchived}
                  onCheckBroadcasts={() => void checkBroadcastStatuses(false)}
                  onFavoriteToggle={setMessageFavorite}
                  onFolderToggle={setMessageCustomFolder}
                  onReply={replyTo}
                  onReplyAll={replyAllTo}
                  onRestoreDraft={restoreSentAsDraft}
                  threadMessages={threadMessages}
                />
              ) : (
                <div className="empty-reader">
                  <div className="empty-icon" aria-hidden="true">
                    <Mail size={26} />
                  </div>
                  <h3>Select a message</h3>
                  <button
                    className="compose-button"
                    onClick={composeNew}
                    type="button"
                  >
                    <span className="button-content">
                      <PenLine size={17} />
                      <span>Compose</span>
                    </span>
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </section>
      <MarketplacePurchaseReceiptModal
        receipt={purchaseReceipt}
        onClose={() => setPurchaseReceipt(undefined)}
      />
      <SocialFooter compact />
    </main>
  );
}

function htmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function browserTemplateHtml(title: string, kicker: string, body: string) {
  const pageTitle = title.trim() || "Proof Page";
  const pageKicker = kicker.trim() || "Published on the Bitcoin Computer";
  const pageBody =
    body.trim() ||
    "This page is HTML carried by ProofOfWork.Me OP_RETURN data and verified by txid.";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlText(pageTitle)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #030508; color: #edf2f7; display: grid; place-items: center; padding: 32px; }
    main { width: min(760px, 100%); border: 1px solid rgba(237,242,247,.16); border-radius: 14px; background: #10151c; padding: 52px; box-shadow: 0 24px 70px rgba(0,0,0,.35); }
    .kicker { color: #4aa3ff; font-size: 13px; font-weight: 850; letter-spacing: 0; text-transform: uppercase; }
    h1 { font-size: 4.6rem; letter-spacing: 0; line-height: .92; margin: 10px 0 18px; overflow-wrap: anywhere; }
    p { color: #a8b3c1; font-size: 1.05rem; line-height: 1.55; margin: 0; }
    section { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); margin-top: 30px; }
    div { border: 1px solid rgba(237,242,247,.12); border-radius: 10px; padding: 14px; }
    span { color: #8b98a8; display: block; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    strong { display: block; font-size: 1.1rem; margin-top: 4px; }
    footer { color: #64748b; font-size: 13px; margin-top: 34px; }
    @media (max-width: 640px) {
      body { padding: 18px; }
      main { padding: 28px; }
      h1 { font-size: 2.7rem; }
    }
  </style>
</head>
<body>
  <main>
    <p class="kicker">${htmlText(pageKicker)}</p>
    <h1>${htmlText(pageTitle)}</h1>
    <p>${htmlText(pageBody)}</p>
    <section aria-label="Proof fields">
      <div><span>Carrier</span><strong>ProofOfWork.Me</strong></div>
      <div><span>Format</span><strong>text/html</strong></div>
      <div><span>Truth</span><strong>Bitcoin txid</strong></div>
    </section>
    <footer>Rendered by browser.proofofwork.me from ProofOfWork OP_RETURN HTML.</footer>
  </main>
</body>
</html>`;
}

function txidFromBrowserLocation() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("txid") ?? params.get("tx");
  if (fromQuery && /^[0-9a-fA-F]{64}$/u.test(fromQuery.trim())) {
    return fromQuery.trim().toLowerCase();
  }

  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const txIndex = pathParts.findIndex((part) => part.toLowerCase() === "tx");
  const fromPath = txIndex >= 0 ? pathParts[txIndex + 1] : pathParts[0];
  return fromPath && /^[0-9a-fA-F]{64}$/u.test(fromPath)
    ? fromPath.toLowerCase()
    : "";
}

function networkFromBrowserLocation(): BitcoinNetwork {
  const params = new URLSearchParams(window.location.search);
  const network = params.get("network");
  return network === "testnet4" ||
    network === "testnet" ||
    network === "livenet"
    ? network
    : "livenet";
}

type PagedItems<T> = {
  end: number;
  items: T[];
  pageCount: number;
  pageIndex: number;
  pageSize: number;
  start: number;
  totalCount: number;
};

function pagedItems<T>(
  items: T[],
  requestedPageIndex: number,
  requestedPageSize = DATA_PAGE_SIZE,
): PagedItems<T> {
  const pageSize = Math.max(1, Math.floor(requestedPageSize));
  const totalCount = items.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const pageIndex = Math.min(
    Math.max(0, Math.floor(requestedPageIndex) || 0),
    pageCount - 1,
  );
  const start = totalCount === 0 ? 0 : pageIndex * pageSize;
  const end = Math.min(totalCount, start + pageSize);

  return {
    end,
    items: items.slice(start, end),
    pageCount,
    pageIndex,
    pageSize,
    start,
    totalCount,
  };
}

function historyPageToPagedItems<T>(
  page: PowPaginatedApiResponse<T>,
  fallbackPageIndex: number,
  fallbackPageSize = DATA_PAGE_SIZE,
): PagedItems<T> {
  const items = Array.isArray(page.items) ? page.items : [];
  const pageSize = Math.max(
    1,
    Math.floor(Number(page.pageSize ?? page.limit ?? fallbackPageSize)) ||
      fallbackPageSize,
  );
  const totalCount = Math.max(0, Number(page.totalCount ?? items.length) || 0);
  const pageIndex = Math.max(
    0,
    Math.floor(Number(page.page ?? fallbackPageIndex)) || 0,
  );
  const pageCount = Math.max(
    1,
    Math.ceil(totalCount / pageSize),
    Number(page.pageCount ?? 0) || 0,
  );
  const start =
    Number.isFinite(Number(page.start)) && Number(page.start) >= 0
      ? Number(page.start)
      : totalCount === 0
        ? 0
        : pageIndex * pageSize;
  const end =
    Number.isFinite(Number(page.end)) && Number(page.end) >= start
      ? Number(page.end)
      : Math.min(totalCount, start + items.length);

  return {
    end,
    items,
    pageCount,
    pageIndex: Math.min(pageIndex, pageCount - 1),
    pageSize,
    start,
    totalCount,
  };
}

function PaginationControls({
  label,
  onPageChange,
  page,
}: {
  label: string;
  onPageChange: (pageIndex: number) => void;
  page: PagedItems<unknown>;
}) {
  if (page.totalCount <= page.pageSize) {
    return null;
  }

  const firstVisible = page.totalCount === 0 ? 0 : page.start + 1;

  return (
    <div className="pagination-row" aria-label={`${label} pagination`}>
      <span>
        {label}: {firstVisible.toLocaleString()}-{page.end.toLocaleString()} of{" "}
        {page.totalCount.toLocaleString()}
      </span>
      <div className="id-record-actions">
        <button
          className="secondary small"
          disabled={page.pageIndex <= 0}
          onClick={() => onPageChange(page.pageIndex - 1)}
          type="button"
        >
          <span className="button-content">
            <ChevronLeft size={15} />
            <span>Prev</span>
          </span>
        </button>
        <button
          className="secondary small"
          disabled={page.pageIndex >= page.pageCount - 1}
          onClick={() => onPageChange(page.pageIndex + 1)}
          type="button"
        >
          <span className="button-content">
            <span>
              Page {(page.pageIndex + 1).toLocaleString()} /{" "}
              {page.pageCount.toLocaleString()}
            </span>
            <ChevronRight size={15} />
          </span>
        </button>
      </div>
    </div>
  );
}

function browserPageWithContext(page: BrowserPage) {
  const context = JSON.stringify({
    amountSats: page.amountSats,
    confirmed: page.confirmed,
    network: page.network,
    protocolBytes: page.protocolBytes,
    sender: page.sender,
    source: page.source,
    txid: page.txid,
  }).replace(/</gu, "\\u003c");
  const contextScript = `<script>window.POW_CONTEXT=${context};</script>\n`;
  return /^<!doctype[^>]*>/iu.test(page.html)
    ? page.html.replace(/^<!doctype[^>]*>/iu, (doctype) => `${doctype}\n${contextScript}`)
    : `${contextScript}${page.html}`;
}

function BrowserApp({
}: {
}) {
  const [network, setNetwork] = useState<BitcoinNetwork>(() =>
    networkFromBrowserLocation(),
  );
  const [query, setQuery] = useState(() => txidFromBrowserLocation());
  const [page, setPage] = useState<BrowserPage | undefined>();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ tone: StatusTone; text: string }>({ tone: "idle", text: "Ready" });
  const [templateTitle, setTemplateTitle] = useState("My Bitcoin Page");
  const [templateKicker, setTemplateKicker] = useState(
    "ProofOfWork.Me Browser",
  );
  const [templateBody, setTemplateBody] = useState(
    "This page lives as HTML carried by the Bitcoin Computer.",
  );
  const [templateCopied, setTemplateCopied] = useState(false);
  const initialLoadRef = useRef(false);
  const template = useMemo(() => browserTemplateHtml(templateTitle, templateKicker, templateBody), [templateBody, templateKicker, templateTitle]);
  const templateBytes = useMemo(() => byteLength(template), [template]);
  const templateSha256 = useMemo(
    () => sha256Hex(new TextEncoder().encode(template)),
    [template],
  );
  const templateHref = `data:text/html;charset=utf-8,${encodeURIComponent(template)}`;

  const loadPage = useCallback(
    async (target = query) => {
      const txid = target.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/u.test(txid)) {
        setStatus({ tone: "bad", text: "Enter a valid Bitcoin txid." });
        return;
      }

      setLoading(true);
      setStatus({
        tone: "idle",
        text: "Loading verified page from Bitcoin...",
      });
      try {
        const loadedPage = await fetchBrowserPage(txid, network);
        setPage(loadedPage);
        setQuery(txid);
        setStatus({
          tone: loadedPage.confirmed ? "good" : "idle",
          text: loadedPage.confirmed
            ? "Verified confirmed HTML page."
            : "Verified pending HTML page. Confirmation is still final truth.",
        });
      } catch (error) {
        setPage(undefined);
        setStatus({
          tone: "bad",
          text: errorMessage(error, "Could not load Browser page."),
        });
      } finally {
        setLoading(false);
      }
    },
    [network, query],
  );

  useEffect(() => {
    if (initialLoadRef.current) {
      return;
    }

    initialLoadRef.current = true;
    const initialTxid = txidFromBrowserLocation();
    if (initialTxid) {
      void loadPage(initialTxid);
    }
  }, [loadPage]);

  async function copyTemplate() {
    await copyTextToClipboard(template);
    setTemplateCopied(true);
    window.setTimeout(() => setTemplateCopied(false), 1600);
  }

  return (
    <main className="desktop-public-app browser-public-app has-route-status">
      <AppHeader
        network={network}
        onNetworkChange={setNetwork}
        subtitle="HTML from Bitcoin"
        title="ProofOfWork Browser"
      />

      <AppStatusRow className="desktop-route-status" persistent status={status} />

      <section className="browser-workspace">
        <section className="browser-hero">
          <div>
            <span className="browser-kicker">Bitcoin-native browser</span>
            <h2>Paste a txid. Render the page.</h2>
            <p>
              HTML pages are ProofOfWork message bodies or file attachments,
              reconstructed from OP_RETURN chunks and rendered inside a sandbox.
            </p>
          </div>
          <form
            className="browser-search-card"
            onSubmit={(event) => {
              event.preventDefault();
              void loadPage();
            }}
          >
            <label>
              Transaction ID
              <input
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="64 character txid"
                spellCheck={false}
                value={query}
              />
            </label>
            <div className="browser-form-row">
              <BrowserNetworkTabs network={network} onChange={setNetwork} />
              <button className="primary" disabled={loading} type="submit">
                <span className="button-content">
                  <Search size={16} />
                  <span>{loading ? "Loading" : "View Page"}</span>
                </span>
              </button>
            </div>
          </form>
        </section>

        {page ? (
          <section className="browser-page-grid">
            <article className="browser-preview-card">
              <div className="browser-card-head">
                <div>
                  <span>Sandboxed preview</span>
                  <h3>{page.attachment.name}</h3>
                </div>
                <a
                  className="secondary small link-button"
                  href={explorerTxUrl(page.txid, page.network)}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="button-content">
                    <span>View TX</span>
                    <ArrowUpRight size={14} />
                  </span>
                </a>
              </div>
              <iframe
                allow="clipboard-write"
                referrerPolicy="no-referrer"
                sandbox={page.confirmed ? "allow-scripts" : ""}
                srcDoc={browserPageWithContext(page)}
                title={`${page.attachment.name} rendered from ${page.txid}`}
              />
            </article>

            <aside className="browser-proof-card">
              <div className="empty-icon" aria-hidden="true">
                <CheckCircle2 size={24} />
              </div>
              <h3>Verified page</h3>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{page.confirmed ? "Confirmed" : "Pending"}</dd>
                </div>
                <div>
                  <dt>Network</dt>
                  <dd>{networkLabel(page.network)}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>
                    {page.source === "attachment"
                      ? "HTML attachment"
                      : "Message body"}
                  </dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytes(page.attachment.size)}</dd>
                </div>
                <div>
                  <dt>Protocol bytes</dt>
                  <dd>{formatBytes(page.protocolBytes)}</dd>
                </div>
                <div>
                  <dt>Sender</dt>
                  <dd>{shortAddress(page.sender)}</dd>
                </div>
                <div>
                  <dt>Payment</dt>
                  <dd>{page.amountSats.toLocaleString()} sats</dd>
                </div>
                <div>
                  <dt>SHA-256</dt>
                  <dd>{page.attachment.sha256}</dd>
                </div>
                <div>
                  <dt>TXID</dt>
                  <dd>{page.txid}</dd>
                </div>
              </dl>
            </aside>

            <article className="browser-source-card">
              <div className="browser-card-head">
                <div>
                  <span>Source</span>
                  <h3>Verified HTML</h3>
                </div>
                <button
                  className="secondary small"
                  onClick={() => void copyTextToClipboard(page.html)}
                  type="button"
                >
                  <span className="button-content">
                    <Copy size={14} />
                    <span>Copy</span>
                  </span>
                </button>
              </div>
              <pre>{page.html}</pre>
            </article>
          </section>
        ) : (
          <section className="browser-empty">
            <div className="empty-icon" aria-hidden="true">
              <Monitor size={26} />
            </div>
            <h3>No page loaded</h3>
            <p>
              Browser accepts confirmed or pending txids with HTML in the
              message body or a verified HTML attachment.
            </p>
          </section>
        )}

        <section className="browser-template-card">
          <div className="browser-card-head">
            <div>
              <span>Page template</span>
              <h3>Computer-native HTML</h3>
            </div>
            <div className="browser-template-actions">
              <button
                className="secondary small"
                onClick={() => void copyTemplate()}
                type="button"
              >
                <span className="button-content">
                  <Copy size={14} />
                  <span>{templateCopied ? "Copied" : "Copy HTML"}</span>
                </span>
              </button>
              <a
                className="secondary small link-button"
                download="proof-page.html"
                href={templateHref}
              >
                <span className="button-content">
                  <Download size={14} />
                  <span>Download</span>
                </span>
              </a>
            </div>
          </div>

          <div className="browser-template-grid">
            <div className="browser-template-fields">
              <label>
                Title
                <input
                  onChange={(event) => setTemplateTitle(event.target.value)}
                  value={templateTitle}
                />
              </label>
              <label>
                Kicker
                <input
                  onChange={(event) => setTemplateKicker(event.target.value)}
                  value={templateKicker}
                />
              </label>
              <label>
                Body
                <textarea
                  onChange={(event) => setTemplateBody(event.target.value)}
                  rows={5}
                  value={templateBody}
                />
              </label>
              <dl className="browser-template-meta">
                <div>
                  <dt>Bytes</dt>
                  <dd>{formatBytes(templateBytes)}</dd>
                </div>
                <div>
                  <dt>SHA-256</dt>
                  <dd>{templateSha256}</dd>
                </div>
              </dl>
            </div>
            <textarea
              className="browser-template-source"
              readOnly
              rows={18}
              value={template}
            />
          </div>
        </section>
      </section>

      <SocialFooter />
    </main>
  );
}

function BrowserWorkspace({
  activeNetwork,
}: {
  activeNetwork: BitcoinNetwork;
}) {
  const [network, setNetwork] = useState<BitcoinNetwork>(activeNetwork);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<BrowserPage | undefined>();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ tone: StatusTone; text: string }>({
    tone: "idle",
    text: "Ready. Paste a txid to render verified HTML from the Bitcoin Computer.",
  });
  const [templateTitle, setTemplateTitle] = useState("My Bitcoin Page");
  const [templateKicker, setTemplateKicker] = useState(
    "ProofOfWork.Me Browser",
  );
  const [templateBody, setTemplateBody] = useState(
    "This page lives as HTML carried by the Bitcoin Computer.",
  );
  const [templateCopied, setTemplateCopied] = useState(false);
  const template = useMemo(
    () => browserTemplateHtml(templateTitle, templateKicker, templateBody),
    [templateBody, templateKicker, templateTitle],
  );
  const templateBytes = useMemo(() => byteLength(template), [template]);
  const templateSha256 = useMemo(
    () => sha256Hex(new TextEncoder().encode(template)),
    [template],
  );
  const templateHref = `data:text/html;charset=utf-8,${encodeURIComponent(template)}`;

  useEffect(() => {
    setNetwork(activeNetwork);
  }, [activeNetwork]);

  const loadPage = useCallback(
    async (target = query) => {
      const txid = target.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/u.test(txid)) {
        setStatus({ tone: "bad", text: "Enter a valid Bitcoin txid." });
        return;
      }

      setLoading(true);
      setStatus({
        tone: "idle",
        text: "Loading verified page from Bitcoin...",
      });
      try {
        const loadedPage = await fetchBrowserPage(txid, network);
        setPage(loadedPage);
        setQuery(txid);
        setStatus({
          tone: loadedPage.confirmed ? "good" : "idle",
          text: loadedPage.confirmed
            ? "Verified confirmed HTML page."
            : "Verified pending HTML page. Confirmation is still final truth.",
        });
      } catch (error) {
        setPage(undefined);
        setStatus({
          tone: "bad",
          text: errorMessage(error, "Could not load Browser page."),
        });
      } finally {
        setLoading(false);
      }
    },
    [network, query],
  );

  async function copyTemplate() {
    await copyTextToClipboard(template);
    setTemplateCopied(true);
    window.setTimeout(() => setTemplateCopied(false), 1600);
  }

  return (
    <section className="browser-workspace browser-computer-workspace">
      <AppStatusRow
        className="browser-workspace-status"
        persistent
        status={status}
      />

      <section className="browser-hero">
        <div>
          <span className="browser-kicker">Bitcoin-native browser</span>
          <h2>Browser</h2>
          <p>
            Paste a txid to render HTML from a ProofOfWork message body or the
            same verified attachment protocol used by Files and Desktop.
          </p>
        </div>
        <form
          className="browser-search-card"
          onSubmit={(event) => {
            event.preventDefault();
            void loadPage();
          }}
        >
          <label>
            Transaction ID
            <input
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="64 character txid"
              spellCheck={false}
              value={query}
            />
          </label>
          <div className="browser-form-row">
            <BrowserNetworkTabs network={network} onChange={setNetwork} />
            <button className="primary" disabled={loading} type="submit">
              <span className="button-content">
                <Search size={16} />
                <span>{loading ? "Loading" : "View Page"}</span>
              </span>
            </button>
          </div>
        </form>
      </section>

      {page ? (
        <section className="browser-page-grid">
          <article className="browser-preview-card">
            <div className="browser-card-head">
              <div>
                <span>Sandboxed preview</span>
                <h3>{page.attachment.name}</h3>
              </div>
              <a
                className="secondary small link-button"
                href={explorerTxUrl(page.txid, page.network)}
                rel="noreferrer"
                target="_blank"
              >
                <span className="button-content">
                  <span>View TX</span>
                  <ArrowUpRight size={14} />
                </span>
              </a>
            </div>
            <iframe
              allow="clipboard-write"
              referrerPolicy="no-referrer"
              sandbox={page.confirmed ? "allow-scripts" : ""}
              srcDoc={browserPageWithContext(page)}
              title={`${page.attachment.name} rendered from ${page.txid}`}
            />
          </article>

          <aside className="browser-proof-card">
            <div className="empty-icon" aria-hidden="true">
              <CheckCircle2 size={24} />
            </div>
            <h3>Verified page</h3>
            <dl>
              <div>
                <dt>Status</dt>
                <dd>{page.confirmed ? "Confirmed" : "Pending"}</dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd>{networkLabel(page.network)}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>
                  {page.source === "attachment"
                    ? "HTML attachment"
                    : "Message body"}
                </dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{formatBytes(page.attachment.size)}</dd>
              </div>
              <div>
                <dt>Protocol bytes</dt>
                <dd>{formatBytes(page.protocolBytes)}</dd>
              </div>
              <div>
                <dt>Sender</dt>
                <dd>{shortAddress(page.sender)}</dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd>{page.amountSats.toLocaleString()} sats</dd>
              </div>
              <div>
                <dt>SHA-256</dt>
                <dd>{page.attachment.sha256}</dd>
              </div>
              <div>
                <dt>TXID</dt>
                <dd>{page.txid}</dd>
              </div>
            </dl>
          </aside>

          <article className="browser-source-card">
            <div className="browser-card-head">
              <div>
                <span>Source</span>
                <h3>Verified HTML</h3>
              </div>
              <button
                className="secondary small"
                onClick={() => void copyTextToClipboard(page.html)}
                type="button"
              >
                <span className="button-content">
                  <Copy size={14} />
                  <span>Copy</span>
                </span>
              </button>
            </div>
            <pre>{page.html}</pre>
          </article>
        </section>
      ) : (
        <section className="browser-empty">
          <div className="empty-icon" aria-hidden="true">
            <Monitor size={26} />
          </div>
          <h3>No page loaded</h3>
          <p>
            Browser accepts confirmed or pending txids with HTML in the message
            body or a verified HTML attachment.
          </p>
        </section>
      )}

      <section className="browser-template-card">
        <div className="browser-card-head">
          <div>
            <span>Page template</span>
            <h3>Computer-native HTML</h3>
          </div>
          <div className="browser-template-actions">
            <button
              className="secondary small"
              onClick={() => void copyTemplate()}
              type="button"
            >
              <span className="button-content">
                <Copy size={14} />
                <span>{templateCopied ? "Copied" : "Copy HTML"}</span>
              </span>
            </button>
            <a
              className="secondary small link-button"
              download="proof-page.html"
              href={templateHref}
            >
              <span className="button-content">
                <Download size={14} />
                <span>Download</span>
              </span>
            </a>
          </div>
        </div>

        <div className="browser-template-grid">
          <div className="browser-template-fields">
            <label>
              Title
              <input
                onChange={(event) => setTemplateTitle(event.target.value)}
                value={templateTitle}
              />
            </label>
            <label>
              Kicker
              <input
                onChange={(event) => setTemplateKicker(event.target.value)}
                value={templateKicker}
              />
            </label>
            <label>
              Body
              <textarea
                onChange={(event) => setTemplateBody(event.target.value)}
                rows={5}
                value={templateBody}
              />
            </label>
            <dl className="browser-template-meta">
              <div>
                <dt>Bytes</dt>
                <dd>{formatBytes(templateBytes)}</dd>
              </div>
              <div>
                <dt>SHA-256</dt>
                <dd>{templateSha256}</dd>
              </div>
            </dl>
          </div>
          <textarea
            className="browser-template-source"
            readOnly
            rows={18}
            value={template}
          />
        </div>
      </section>
    </section>
  );
}

function DesktopApp({
  activeNetwork,
  busy,
  desktopQuery,
  fileFilter,
  messages,
  profile,
  selectedKey,
  setDesktopQuery,
  setFileFilter,
  setSortMode,
  sortMode,
  status,
  onClear,
  onNetworkChange,
  onRefresh,
  onSearch,
  onSelect,
}: {
  activeNetwork: BitcoinNetwork;
  busy: boolean;
  desktopQuery: string;
  fileFilter: FileFilter;
  messages: MailMessage[];
  profile?: DesktopProfile;
  selectedKey: string;
  setDesktopQuery: (value: string) => void;
  setFileFilter: (value: FileFilter) => void;
  setSortMode: (value: SortMode) => void;
  sortMode: SortMode;
  status: { tone: StatusTone; text: string };
  onClear: () => void;
  onNetworkChange: (network: BitcoinNetwork) => void;
  onRefresh: () => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onSelect: (message: MailMessage) => void;
}) {
  return (
    <main className="desktop-public-app has-route-status">
      <AppHeader
        network={activeNetwork}
        onNetworkChange={onNetworkChange}
        onRefresh={onRefresh}
        subtitle="Public file search"
        title="ProofOfWork Desktop"
      />

      <AppStatusRow className="desktop-route-status" persistent status={status} />

      <DesktopWorkspace
        activeNetwork={activeNetwork}
        busy={busy}
        desktopQuery={desktopQuery}
        fileFilter={fileFilter}
        messages={messages}
        profile={profile}
        selectedKey={selectedKey}
        setDesktopQuery={setDesktopQuery}
        setFileFilter={setFileFilter}
        setSortMode={setSortMode}
        sortMode={sortMode}
        onClear={onClear}
        onRefresh={onRefresh}
        onSearch={onSearch}
        onSelect={onSelect}
      />

      <SocialFooter />
    </main>
  );
}

function ActivityApp({
  activeNetwork,
  activityHistoryPage,
  activityStats,
  busy,
  idActivity,
  profile,
  query,
  searchedActivity,
  setQuery,
  status,
  onActivityPageChange,
  onClear,
  onNetworkChange,
  onRefresh,
  onSearch,
}: {
  activeNetwork: BitcoinNetwork;
  activityHistoryPage?: PowPaginatedApiResponse<PowActivityItem>;
  activityStats?: PowActivityStats;
  busy: boolean;
  idActivity: PowActivityItem[];
  profile?: DesktopProfile;
  query: string;
  searchedActivity: PowActivityItem[];
  setQuery: (value: string) => void;
  status: { tone: StatusTone; text: string };
  onActivityPageChange?: (pageIndex: number) => void;
  onClear: () => void;
  onNetworkChange: (network: BitcoinNetwork) => void;
  onRefresh: () => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <main className="desktop-public-app activity-public-app has-route-status">
      <AppHeader
        network={activeNetwork}
        onNetworkChange={onNetworkChange}
        onRefresh={onRefresh}
        subtitle="Bitcoin Computer log"
        title="ProofOfWork Log"
      />

      <AppStatusRow className="desktop-route-status" persistent status={status} />

      <ActivityWorkspace
        activeNetwork={activeNetwork}
        activityHistoryPage={activityHistoryPage}
        activityStats={activityStats}
        busy={busy}
        idActivity={idActivity}
        profile={profile}
        query={query}
        searchedActivity={searchedActivity}
        setQuery={setQuery}
        onClear={onClear}
        onActivityPageChange={onActivityPageChange}
        onRefresh={onRefresh}
        onSearch={onSearch}
      />

      <SocialFooter />
    </main>
  );
}

function activityKey(item: PowActivityItem) {
  return `${item.kind}-${item.network}-${item.txid}-${item.listingId ?? ""}-${item.id ?? ""}`;
}

function activityItemsForView(
  idActivity: PowActivityItem[],
  searchedActivity: PowActivityItem[],
  query: string,
  profile?: DesktopProfile,
) {
  const registryItems = profile
    ? idActivity.filter((item) =>
        [
          profile.address,
          profile.resolvedId ? `${profile.resolvedId}@proofofwork.me` : "",
          profile.resolvedId ?? "",
          profile.query,
        ]
          .filter(Boolean)
          .some((needle) => activityMatchesSearch(item, needle)),
      )
    : idActivity.filter((item) => activityMatchesSearch(item, query));

  const merged = new Map<string, PowActivityItem>();
  for (const item of [...registryItems, ...searchedActivity]) {
    merged.set(activityKey(item), item);
  }

  return [...merged.values()].sort(compareActivityItems);
}

function totalActivityDataBytes(items: PowActivityItem[]) {
  const bytesByTxid = new Map<string, number>();

  for (const item of items) {
    if (
      !item.txid ||
      !Number.isFinite(item.dataBytes ?? 0) ||
      !item.dataBytes
    ) {
      continue;
    }

    bytesByTxid.set(
      item.txid,
      Math.max(bytesByTxid.get(item.txid) ?? 0, item.dataBytes),
    );
  }

  return [...bytesByTxid.values()].reduce((total, bytes) => total + bytes, 0);
}

function ActivityWorkspace({
  activeNetwork,
  activityHistoryPage,
  activityStats,
  busy,
  idActivity,
  profile,
  query,
  searchedActivity,
  setQuery,
  onActivityPageChange,
  onClear,
  onRefresh,
  onSearch,
}: {
  activeNetwork: BitcoinNetwork;
  activityHistoryPage?: PowPaginatedApiResponse<PowActivityItem>;
  activityStats?: PowActivityStats;
  busy: boolean;
  idActivity: PowActivityItem[];
  profile?: DesktopProfile;
  query: string;
  searchedActivity: PowActivityItem[];
  setQuery: (value: string) => void;
  onActivityPageChange?: (pageIndex: number) => void;
  onClear: () => void;
  onRefresh: () => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [activityPageIndex, setActivityPageIndex] = useState(0);
  useEffect(() => {
    setActivityPageIndex(0);
  }, [profile?.query, query]);

  const items = activityItemsForView(
    idActivity,
    searchedActivity,
    query,
    profile,
  );
  const useServerPage =
    !profile && !query.trim() && Array.isArray(activityHistoryPage?.items);
  const serverPage = useServerPage
    ? historyPageToPagedItems(
        activityHistoryPage ?? {},
        activityHistoryPage?.page ?? 0,
        ACTIVITY_FEED_PAGE_SIZE,
      )
    : undefined;
  const localPage = pagedItems(
      items,
      activityPageIndex,
      ACTIVITY_FEED_PAGE_SIZE,
    );
  const activityPage = serverPage ?? localPage;
  const stats = !profile && !query.trim() ? activityStats : undefined;
  const totalCount = stats?.total ?? activityPage.totalCount;
  const pendingCount =
    stats?.pending ?? items.filter((item) => !item.confirmed).length;
  const confirmedCount =
    stats?.confirmed ??
    Math.max(0, totalCount - pendingCount);
  const dataBytes = stats?.dataBytes ?? totalActivityDataBytes(items);
  const visibleItems = activityPage.items;
  const indexedAt = activityHistoryPage?.indexedAt;
  const indexedThroughBlock =
    activityHistoryPage?.indexedThroughBlock ?? stats?.indexedThroughBlock;
  const title = profile
    ? `${profile.label} log`
    : query.trim()
      ? "Filtered log"
      : "Global computer log";
  const changePage = useServerPage && onActivityPageChange
    ? onActivityPageChange
    : setActivityPageIndex;

  return (
    <section className="activity-workspace">
      <div className="activity-hero">
        <div>
          <span className="landing-kicker">Bitcoin-native audit trail</span>
          <h2>Every ProofOfWork action with a txid.</h2>
          <p>
            Messages, replies, files, ID registry events, listings, seals,
            delistings, purchases, and token events in one chain-readable log.
          </p>
        </div>
        <form className="desktop-search activity-search" onSubmit={onSearch}>
          <Search size={16} aria-hidden="true" />
          <input
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="address, user@proofofwork.me, or txid"
            spellCheck={false}
            value={query}
          />
          <button
            className="secondary small"
            disabled={busy || !query.trim()}
            type="submit"
          >
            <span className="button-content">
              <Search size={15} />
              <span>Search</span>
            </span>
          </button>
          <button
            className="secondary small"
            disabled={busy}
            onClick={onRefresh}
            type="button"
          >
            <span className="button-content">
              <RefreshCw className={busy ? "refresh-spin" : ""} size={15} />
              <span>{busy ? "Refreshing" : "Refresh"}</span>
            </span>
          </button>
          <button
            className="secondary small"
            disabled={busy || (!query && !profile)}
            onClick={onClear}
            type="button"
          >
            <span className="button-content">
              <X size={15} />
              <span>Clear</span>
            </span>
          </button>
        </form>
      </div>

      <div className="activity-stats" aria-label="Log stats">
        <div>
          <strong>{totalCount.toLocaleString()}</strong>
          <span>Total actions</span>
        </div>
        <div>
          <strong>{confirmedCount.toLocaleString()}</strong>
          <span>Confirmed</span>
        </div>
        <div>
          <strong>{pendingCount.toLocaleString()}</strong>
          <span>Pending</span>
        </div>
        <div>
          <strong>{formatBytes(dataBytes)}</strong>
          <span>Data stored</span>
        </div>
        <div>
          <strong>{networkLabel(activeNetwork)}</strong>
          <span>Network</span>
        </div>
      </div>

      <section className="activity-feed-card">
        <div className="id-card-head">
          <div className="empty-icon" aria-hidden="true">
            <Clock size={24} />
          </div>
          <div>
            <h3>{title}</h3>
            <p>
              Confirmed records are canonical. Pending records are visible until
              they confirm or disappear.
            </p>
            {indexedAt || indexedThroughBlock ? (
              <p>
                {indexedAt ? `Refreshed ${formatDate(indexedAt)}` : "Refreshed"}{" "}
                {indexedThroughBlock
                  ? `through block ${indexedThroughBlock.toLocaleString()}.`
                  : "from the confirmed Computer index."}
              </p>
            ) : null}
            {totalCount > ACTIVITY_FEED_PAGE_SIZE ? (
              <p>
                Showing paged results from {totalCount.toLocaleString()}{" "}
                matching actions. Search an address, ID, txid, or app label to
                narrow the feed.
              </p>
            ) : null}
          </div>
        </div>
        <ActivityFeed items={visibleItems} totalCount={totalCount} />
        <PaginationControls
          label="Actions"
          onPageChange={changePage}
          page={activityPage}
        />
      </section>
    </section>
  );
}

function ActivityFeed({
  items,
  totalCount,
}: {
  items: PowActivityItem[];
  totalCount: number;
}) {
  if (totalCount === 0) {
    return (
      <div className="empty-state activity-empty">
        <div className="empty-icon" aria-hidden="true">
          <Clock size={26} />
        </div>
        <h3>No activity</h3>
        <p>
          Search an address, confirmed ProofOfWork ID, or txid to narrow the
          protocol log.
        </p>
      </div>
    );
  }

  return (
    <div className="activity-feed">
      {items.map((item) => {
        const key = activityKey(item);
        return (
          <article className="activity-row" key={key}>
            <div className="activity-row-main">
              <div>
                <h4>{item.id ? `${item.id}@proofofwork.me` : item.title}</h4>
                <strong>{item.id ? item.title : item.description}</strong>
                {item.id ? <p>{item.description}</p> : null}
                {item.detail ? (
                  <span className="activity-detail">{item.detail}</span>
                ) : null}
              </div>
              <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
            </div>

            <div className="activity-tags">
              {item.tags.map((tag) => (
                <span key={`${key}-${tag}`}>{tag}</span>
              ))}
            </div>

            <dl className="activity-meta">
              {item.actor ? (
                <div>
                  <dt>Actor</dt>
                  <dd>{shortAddress(item.actor)}</dd>
                </div>
              ) : null}
              {item.counterparty ? (
                <div>
                  <dt>Counterparty</dt>
                  <dd>{shortAddress(item.counterparty)}</dd>
                </div>
              ) : null}
              {item.listingId ? (
                <div>
                  <dt>Listing</dt>
                  <dd>{shortAddress(item.listingId)}</dd>
                </div>
              ) : null}
              {item.utxo ? (
                <div>
                  <dt>UTXO</dt>
                  <dd>{shortAddress(item.utxo)}</dd>
                </div>
              ) : null}
            </dl>

            <div className="id-record-actions">
              <a
                className="secondary small"
                href={explorerTxUrl(item.txid, item.network)}
                rel="noreferrer"
                target="_blank"
              >
                <span className="button-content">
                  <ArrowUpRight size={15} />
                  <span>View TX</span>
                </span>
              </a>
              {item.listingId && item.listingId !== item.txid ? (
                <a
                  className="secondary small"
                  href={explorerTxUrl(item.listingId, item.network)}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="button-content">
                    <ArrowUpRight size={15} />
                    <span>View Listing</span>
                  </span>
                </a>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

type TokenWalletAppProps = {
  address: string;
  balances: PowTokenWalletBalance[];
  btcUsd: number;
  busy: boolean;
  canList: boolean;
  canTransfer: boolean;
  connectWallet: () => Promise<void>;
  delistListing: (listing: PowTokenListing) => void;
  disconnectWallet: () => void;
  feeRate: number;
  hasUnisat: boolean;
  listAmount: number;
  listBuyerAddress: string;
  listPriceSats: number;
  listing: boolean;
  listings: PowTokenListing[];
  listSpendableBalance: number;
  network: BitcoinNetwork;
  onNetworkChange: (network: BitcoinNetwork) => void;
  onRefresh: () => void;
  sealListing: (listing: PowTokenListing) => void;
  selectedTokenId: string;
  setFeeRate: (value: number) => void;
  setListAmount: (value: number) => void;
  setListBuyerAddress: (value: string) => void;
  setListPriceSats: (value: number) => void;
  setSelectedTokenId: (value: string) => void;
  setTransferAmount: (value: number) => void;
  setTransferRecipient: (value: string) => void;
  status: { tone: StatusTone; text: string };
  submitList: (event: FormEvent<HTMLFormElement>) => void;
  submitTransfer: (event: FormEvent<HTMLFormElement>) => void;
  tokenSales: PowTokenSale[];
  transferAmount: number;
  transferBalance: number;
  transferBytes: number;
  transferRecipient: string;
  transferToken: PowTokenDefinition | undefined;
  transferring: boolean;
  transfers: PowTokenTransfer[];
  workFloorLoading: boolean;
  workFloorQuote?: WorkFloorQuote;
};

function TokenWalletApp({
  address,
  balances,
  btcUsd,
  busy,
  canList,
  canTransfer,
  connectWallet,
  delistListing,
  disconnectWallet,
  feeRate,
  hasUnisat,
  listAmount,
  listBuyerAddress,
  listPriceSats,
  listing,
  listings,
  listSpendableBalance,
  network,
  onNetworkChange,
  onRefresh,
  sealListing,
  selectedTokenId,
  setFeeRate,
  setListAmount,
  setListBuyerAddress,
  setListPriceSats,
  setSelectedTokenId,
  setTransferAmount,
  setTransferRecipient,
  status,
  submitList,
  submitTransfer,
  tokenSales,
  transferAmount,
  transferBalance,
  transferBytes,
  transferRecipient,
  transferToken,
  transferring,
  transfers,
  workFloorLoading,
  workFloorQuote,
}: TokenWalletAppProps) {
  return (
    <main className="id-launch-app token-public-app token-wallet-public-app">
      <AppHeader
        address={address}
        busy={busy}
        connectWallet={connectWallet}
        disconnectWallet={disconnectWallet}
        hasUnisat={hasUnisat}
        homeHref={appHref(WALLET_APP_URL, LOCAL_WALLET_APP_URL)}
        network={network}
        onNetworkChange={onNetworkChange}
        onRefresh={onRefresh}
        subtitle="Token balances and transfers"
        title="Wallet"
      />

      <AppStatusRow className="desktop-route-status" persistent status={status} />

      <TokenWalletWorkspace
        address={address}
        balances={balances}
        btcUsd={btcUsd}
        canList={canList}
        canTransfer={canTransfer}
        compact={false}
        delistListing={delistListing}
        feeRate={feeRate}
        listAmount={listAmount}
        listBuyerAddress={listBuyerAddress}
        listPriceSats={listPriceSats}
        listing={listing}
        listings={listings}
        listSpendableBalance={listSpendableBalance}
        sealListing={sealListing}
        selectedTokenId={selectedTokenId}
        setFeeRate={setFeeRate}
        setListAmount={setListAmount}
        setListBuyerAddress={setListBuyerAddress}
        setListPriceSats={setListPriceSats}
        setSelectedTokenId={setSelectedTokenId}
        setTransferAmount={setTransferAmount}
        setTransferRecipient={setTransferRecipient}
        submitList={submitList}
        submitTransfer={submitTransfer}
        tokenSales={tokenSales}
        transferAmount={transferAmount}
        transferBalance={transferBalance}
        transferBytes={transferBytes}
        transferRecipient={transferRecipient}
        transferToken={transferToken}
        transferring={transferring}
        transfers={transfers}
        workFloorLoading={workFloorLoading}
        workFloorQuote={workFloorQuote}
      />

      <SocialFooter />
    </main>
  );
}

function TokenWalletWorkspace({
  address,
  balances,
  btcUsd,
  canList,
  canTransfer,
  compact,
  delistListing,
  feeRate,
  listAmount,
  listBuyerAddress,
  listPriceSats,
  listing,
  listings,
  listSpendableBalance,
  sealListing,
  selectedTokenId,
  setFeeRate,
  setListAmount,
  setListBuyerAddress,
  setListPriceSats,
  setSelectedTokenId,
  setTransferAmount,
  setTransferRecipient,
  submitList,
  submitTransfer,
  tokenSales,
  transferAmount,
  transferBalance,
  transferBytes,
  transferRecipient,
  transferToken,
  transferring,
  transfers,
  workFloorLoading,
  workFloorQuote,
}: Pick<
  TokenWalletAppProps,
  | "address"
  | "balances"
  | "btcUsd"
  | "canList"
  | "canTransfer"
  | "delistListing"
  | "feeRate"
  | "listAmount"
  | "listBuyerAddress"
  | "listPriceSats"
  | "listing"
  | "listings"
  | "listSpendableBalance"
  | "sealListing"
  | "selectedTokenId"
  | "setFeeRate"
  | "setListAmount"
  | "setListBuyerAddress"
  | "setListPriceSats"
  | "setSelectedTokenId"
  | "setTransferAmount"
  | "setTransferRecipient"
  | "submitList"
  | "submitTransfer"
  | "tokenSales"
  | "transferAmount"
  | "transferBalance"
  | "transferBytes"
  | "transferRecipient"
  | "transferToken"
  | "transferring"
  | "transfers"
  | "workFloorLoading"
  | "workFloorQuote"
> & {
  compact: boolean;
}) {
  const [walletListingPageIndex, setWalletListingPageIndex] = useState(0);
  const [walletTransferPageIndex, setWalletTransferPageIndex] = useState(0);
  const [walletListingSortMode, setWalletListingSortMode] =
    useState<MarketplaceSortMode>("price-desc");
  useEffect(() => {
    setWalletListingPageIndex(0);
  }, [address, selectedTokenId, walletListingSortMode]);
  const walletTransfers = address
    ? transfers.filter(
        (transfer) =>
          transfer.senderAddress === address ||
          transfer.recipientAddress === address,
      )
    : [];
  const walletMovements = [
    ...walletTransfers.map((transfer) => ({
      amount: transfer.amount,
      confirmed: transfer.confirmed,
      createdAt: transfer.createdAt,
      key: `transfer:${transfer.txid}`,
      label: transfer.senderAddress === address ? "Sent" : "Received",
      network: transfer.network,
      priceSats: 0,
      ticker: transfer.ticker,
      txid: transfer.txid,
      type: "transfer" as const,
    })),
    ...(address
      ? tokenSales
          .filter(
            (sale) =>
              sale.buyerAddress === address || sale.sellerAddress === address,
          )
          .map((sale) => ({
            amount: sale.amount,
            confirmed: sale.confirmed,
            createdAt: sale.createdAt,
            key: `sale:${sale.txid}`,
            label: sale.buyerAddress === address ? "Bought" : "Sold",
            network: sale.network,
            priceSats: sale.priceSats,
            ticker: sale.ticker,
            txid: sale.txid,
            type: "sale" as const,
          }))
      : []),
  ].sort(
    (left, right) =>
      Number(right.confirmed) - Number(left.confirmed) ||
      Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
      left.key.localeCompare(right.key),
  );
  const walletListings = address
    ? listings.filter(
        (item) =>
          item.sellerAddress === address &&
          (!selectedTokenId || item.tokenId === selectedTokenId),
      )
    : [];
  const walletTokenById = new Map<string, TokenReferenceSnapshot>(
    balances.map((balance) => [balance.token.tokenId, balance.token]),
  );
  const walletWorkFloorSats =
    workFloorQuote
      ? workFloorQuote.networkValueSats / WORK_TOKEN_MAX_SUPPLY
      : 0;
  const sortedWalletListings = sortTokenListings(
    walletListings,
    walletListingSortMode,
    walletTokenById,
    walletWorkFloorSats,
  );
  const walletListingPage = pagedItems(
    sortedWalletListings,
    walletListingPageIndex,
    TOKEN_LIST_PREVIEW_COUNT,
  );
  const walletTransferPage = pagedItems(
    walletMovements,
    walletTransferPageIndex,
    TOKEN_LIST_PREVIEW_COUNT,
  );
  const confirmedTokenCount = balances.filter(
    (balance) => balance.confirmedBalance > 0,
  ).length;
  const selectedListToken = transferToken;
  const normalizedListAmount =
    Number.isFinite(listAmount) && listAmount > 0 ? listAmount : 0;
  const normalizedListPriceSats =
    Number.isFinite(listPriceSats) && listPriceSats > 0 ? listPriceSats : 0;
  const listUnitPriceSats =
    normalizedListAmount > 0
      ? normalizedListPriceSats / normalizedListAmount
      : 0;
  const selectedTokenListings = selectedListToken
    ? listings.filter(
        (item) =>
          item.network === selectedListToken.network &&
          item.tokenId === selectedListToken.tokenId,
      )
    : [];
  const selectedTokenSales = selectedListToken
    ? tokenSales.filter(
        (sale) =>
          sale.network === selectedListToken.network &&
          sale.tokenId === selectedListToken.tokenId &&
          sale.confirmed,
      )
    : [];
  const lowestAskSats = selectedTokenListings.reduce((lowest, item) => {
    const unit = item.amount > 0 ? item.priceSats / item.amount : 0;
    if (unit <= 0) {
      return lowest;
    }

    return lowest > 0 ? Math.min(lowest, unit) : unit;
  }, 0);
  const lastSaleSats =
    selectedTokenSales[0] && selectedTokenSales[0].amount > 0
      ? selectedTokenSales[0].priceSats / selectedTokenSales[0].amount
      : 0;
  const mintReferenceSats =
    selectedListToken && selectedListToken.mintAmount > 0
      ? selectedListToken.mintPriceSats / selectedListToken.mintAmount
      : 0;
  const workReferenceSats =
    selectedListToken?.tokenId === WORK_TOKEN_ID && workFloorQuote
      ? workFloorQuote.networkValueSats / WORK_TOKEN_MAX_SUPPLY
      : 0;
  const workSuggestedListPriceSats =
    selectedListToken?.tokenId === WORK_TOKEN_ID &&
    workReferenceSats > 0 &&
    normalizedListAmount > 0
      ? Math.max(1, Math.round(workReferenceSats * normalizedListAmount))
      : 0;
  const listReferenceSats =
    workReferenceSats || lowestAskSats || lastSaleSats || mintReferenceSats;
  const listReferenceLabel =
    workReferenceSats > 0
      ? "Market floor"
      : lowestAskSats > 0
        ? "Lowest ask"
        : lastSaleSats > 0
          ? "Last sale"
          : mintReferenceSats > 0
            ? "Mint price"
            : "Reference";
  const listPriceDeltaPct =
    listReferenceSats > 0 &&
    listUnitPriceSats > 0
      ? (listUnitPriceSats - listReferenceSats) / listReferenceSats
      : 0;
  const listPriceAtMarket =
    listReferenceSats > 0 &&
    listUnitPriceSats > 0 &&
    Math.abs(listPriceDeltaPct) <= 0.01;
  const listPriceBelowReference =
    listReferenceSats > 0 && listUnitPriceSats > 0 && listPriceDeltaPct < -0.01;
  const listPriceAboveReference =
    listReferenceSats > 0 && listUnitPriceSats > 0 && listPriceDeltaPct > 0.01;
  const listPositionLabel =
    listReferenceSats > 0 && listUnitPriceSats > 0
      ? listPriceAtMarket
        ? "Market"
        : `${listPriceDeltaPct > 0 ? "+" : ""}${(listPriceDeltaPct * 100).toLocaleString(undefined, {
            maximumFractionDigits: 1,
            minimumFractionDigits: 1,
          })}%`
      : "n/a";
  const listPositionNote =
    listReferenceSats > 0 && listUnitPriceSats > 0
      ? listPriceAtMarket
        ? `At ${listReferenceLabel.toLowerCase()}`
        : listPriceBelowReference
          ? `Below ${listReferenceLabel.toLowerCase()}`
          : `Above ${listReferenceLabel.toLowerCase()}`
      : "Set listing";
  const previousWorkSuggestedListPriceSatsRef = useRef(0);

  useEffect(() => {
    if (
      selectedListToken?.tokenId !== WORK_TOKEN_ID ||
      workSuggestedListPriceSats <= 0
    ) {
      previousWorkSuggestedListPriceSatsRef.current = 0;
      return;
    }

    const previousSuggestion = previousWorkSuggestedListPriceSatsRef.current;
    previousWorkSuggestedListPriceSatsRef.current = workSuggestedListPriceSats;

    if (
      normalizedListPriceSats <= 0 ||
      normalizedListPriceSats === WORK_TOKEN_MINT_PRICE_SATS ||
      normalizedListPriceSats === previousSuggestion
    ) {
      setListPriceSats(workSuggestedListPriceSats);
    }
  }, [
    normalizedListPriceSats,
    selectedListToken?.tokenId,
    setListPriceSats,
    workSuggestedListPriceSats,
  ]);

  return (
    <section
      className={
        compact
          ? "workspace token-workspace token-workspace-compact token-wallet-workspace"
          : "token-workspace token-wallet-workspace"
      }
    >
      <section className="id-launch-card token-dashboard-card">
        <div className="id-card-heading">
          <div className="id-card-icon">
            <Wallet size={24} />
          </div>
          <div>
            <p>Token wallet</p>
            <h2>{address ? shortAddress(address) : "Connect UniSat"}</h2>
            <span>
              Confirmed balances are canonical. Pending transfers stay visible
              until Bitcoin confirms or drops them.
            </span>
          </div>
        </div>
        <div className="id-launch-stats token-stats-row">
          <div>
            <span>Tokens owned</span>
            <strong>{confirmedTokenCount.toLocaleString()}</strong>
          </div>
          <div>
            <span>Movements seen</span>
            <strong>{walletMovements.length.toLocaleString()}</strong>
          </div>
          <div>
            <span>Mutation fee</span>
            <strong>{TOKEN_MIN_MUTATION_PRICE_SATS.toLocaleString()} sats</strong>
          </div>
        </div>
      </section>

      <div className="token-detail-grid">
        <section className="id-launch-card token-mint-panel">
          <div className="id-card-heading compact">
            <div className="id-card-icon">
              <Wallet size={22} />
            </div>
            <div>
              <h2>Balances</h2>
              <p>Tokens held by the connected address.</p>
            </div>
          </div>
          {balances.length ? (
            <div className="token-list compact-token-list">
              {balances.map((balance) => (
                <button
                  aria-current={selectedTokenId === balance.token.tokenId}
                  className="token-list-item"
                  key={balance.token.tokenId}
                  onClick={() => setSelectedTokenId(balance.token.tokenId)}
                  type="button"
                >
                  <span>
                    <strong>{balance.token.ticker}</strong>
                    <small>{shortAddress(balance.token.tokenId)}</small>
                  </span>
                  <span>
                    <strong>
                      {balance.confirmedBalance.toLocaleString()}{" "}
                      {balance.token.ticker}
                    </strong>
                    <small>
                      {balance.pendingIncoming
                        ? `+${balance.pendingIncoming.toLocaleString()} pending in`
                        : "confirmed"}
                      {balance.pendingOutgoing
                        ? ` · -${balance.pendingOutgoing.toLocaleString()} pending out`
                        : ""}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Wallet size={28} />
              <h3>No token balance yet</h3>
              <p>Mint or receive a token, then refresh this wallet.</p>
            </div>
          )}
        </section>

        <section className="id-launch-card token-mint-card">
          <div className="id-card-heading compact">
            <div className="id-card-icon">
              <Send size={22} />
            </div>
            <div>
              <h2>Transfer</h2>
              <p>
                Sends a `pwt1:send` event and pays the selected token registry.
              </p>
            </div>
          </div>
          <form className="id-form" onSubmit={submitTransfer}>
            <label>
              Token
              <select
                onChange={(event) => setSelectedTokenId(event.target.value)}
                value={selectedTokenId || balances[0]?.token.tokenId || ""}
              >
                {balances.length ? (
                  balances.map((balance) => (
                    <option key={balance.token.tokenId} value={balance.token.tokenId}>
                      {balance.token.ticker} ·{" "}
                      {balance.confirmedBalance.toLocaleString()} available
                    </option>
                  ))
                ) : (
                  <option value="">No token balance</option>
                )}
              </select>
            </label>
            <div className="token-form-grid">
              <label>
                Amount
                <input
                  min={1}
                  max={Math.max(1, transferBalance)}
                  onChange={(event) => setTransferAmount(Number(event.target.value))}
                  type="number"
                  value={transferAmount}
                />
              </label>
              <label>
                Recipient address
                <input
                  onChange={(event) => setTransferRecipient(event.target.value)}
                  placeholder="Bitcoin address"
                  value={transferRecipient}
                />
              </label>
            </div>
            <div className="id-launch-stats token-stats-row">
              <div>
                <span>Available</span>
                <strong>
                  {transferBalance.toLocaleString()}{" "}
                  {transferToken?.ticker ?? "TOKEN"}
                </strong>
              </div>
              <div>
                <span>Registry fee</span>
                <strong>{TOKEN_MIN_MUTATION_PRICE_SATS.toLocaleString()} sats</strong>
              </div>
              <div>
                <span>Payload</span>
                <strong>{transferBytes.toLocaleString()} bytes</strong>
              </div>
            </div>
            <FeeRateControl feeRate={feeRate} setFeeRate={setFeeRate} />
            <button className="primary" disabled={!canTransfer} type="submit">
              <span className="button-content">
                <Send size={16} />
                <span>{transferring ? "Transferring" : "Transfer token"}</span>
              </span>
            </button>
          </form>
        </section>

        <section className="id-launch-card token-mint-card">
          <div className="id-card-heading compact">
            <div className="id-card-icon">
              <Tag size={22} />
            </div>
            <div>
              <h2>List</h2>
              <p>Creates a sale-ticket listing paid to the token registry.</p>
            </div>
          </div>
          <form className="id-form" onSubmit={submitList}>
            <div className="token-form-grid">
              <label>
                Amount
                <input
                  min={1}
                  max={Math.max(1, listSpendableBalance)}
                  onChange={(event) => setListAmount(Number(event.target.value))}
                  type="number"
                  value={listAmount}
                />
              </label>
              <label>
                Price sats
                <input
                  min={1}
                  onChange={(event) => setListPriceSats(Number(event.target.value))}
                  type="number"
                  value={listPriceSats}
                />
              </label>
            </div>
            <div className="token-list-price-reference">
              <div>
                <span>List unit</span>
                <strong>
                  {listUnitPriceSats > 0
                    ? `${tokenSatsPerUnit(listUnitPriceSats)} sats / ${selectedListToken?.ticker ?? "TOKEN"}`
                    : "Set amount and price"}
                </strong>
                <small>{tokenUsd(satsToUsd(listUnitPriceSats, btcUsd))}</small>
              </div>
              <div>
                <span>{listReferenceLabel}</span>
                <strong>
                  {listReferenceSats > 0
                    ? `${tokenSatsPerUnit(listReferenceSats)} sats / ${selectedListToken?.ticker ?? "TOKEN"}`
                    : workFloorLoading &&
                        selectedListToken?.tokenId === WORK_TOKEN_ID
                      ? "Loading floor"
                      : "No market data"}
                </strong>
                <small>
                  {listReferenceSats > 0
                    ? tokenUsd(satsToUsd(listReferenceSats, btcUsd))
                    : "Refresh for latest"}
                </small>
              </div>
              <div
                className={
                  listPriceBelowReference
                    ? "bad"
                    : listPriceAboveReference
                      ? "good"
                      : ""
                }
              >
                <span>Position</span>
                <strong>{listPositionLabel}</strong>
                <small>{listPositionNote}</small>
              </div>
            </div>
            <label>
              Buyer lock optional
              <input
                onChange={(event) => setListBuyerAddress(event.target.value)}
                placeholder="Specific buyer address"
                value={listBuyerAddress}
              />
            </label>
            <div className="id-launch-stats token-stats-row">
              <div>
                <span>Spendable</span>
                <strong>
                  {listSpendableBalance.toLocaleString()}{" "}
                  {transferToken?.ticker ?? "TOKEN"}
                </strong>
              </div>
              <div>
                <span>Registry fee</span>
                <strong>{TOKEN_MIN_MUTATION_PRICE_SATS.toLocaleString()} sats</strong>
              </div>
              <div>
                <span>Ticket</span>
                <strong>{TOKEN_LISTING_ANCHOR_VALUE_SATS.toLocaleString()} sats</strong>
              </div>
            </div>
            <FeeRateControl feeRate={feeRate} setFeeRate={setFeeRate} />
            <button className="primary" disabled={listing} type="submit">
              <span className="button-content">
                <Tag size={16} />
                <span>{listing ? "Listing" : "List token"}</span>
              </span>
            </button>
          </form>

          {walletListings.length ? (
            <>
              <div className="listing-fee-control token-listing-fee-control">
                <div>
                  <strong>Seal / Delist fee rate</strong>
                  <span>Used when sealing or closing your token listings.</span>
                </div>
                <FeeRateControl feeRate={feeRate} setFeeRate={setFeeRate} />
              </div>
              <MarketplaceSortControl
                onChange={setWalletListingSortMode}
                value={walletListingSortMode}
              />
              <div className="token-list compact-token-list">
                {walletListingPage.items.map((item) => {
                  const sealed = tokenSaleAuthorizationUsesSaleTicketAnchor(
                    item.saleAuthorization,
                  );
                  const readyToSeal = item.confirmed && !sealed;
                  const unitSats = tokenListingUnitPriceSats(item);
                  return (
                    <article className="token-list-item" key={item.listingId}>
                      <span>
                        <strong>
                          {item.amount.toLocaleString()} {item.ticker}
                        </strong>
                        <small>
                          {!item.confirmed
                            ? "waiting for confirmation"
                            : sealed
                              ? "sealed"
                              : "ready to seal"}{" "}
                          ·{" "}
                          {item.priceSats.toLocaleString()} sats ·{" "}
                          {tokenSatsPerUnit(unitSats)} sats / {item.ticker}
                        </small>
                      </span>
                      <span className="id-record-actions">
                        <a
                          className="secondary small"
                          href={explorerTxUrl(item.listingId, item.network)}
                          rel="noreferrer"
                          target="_blank"
                        >
                          View TX
                        </a>
                        {!sealed ? (
                          <button
                            className="secondary small"
                            disabled={!readyToSeal}
                            onClick={() => sealListing(item)}
                            type="button"
                          >
                            {item.confirmed ? "Seal" : "Confirming"}
                          </button>
                        ) : null}
                        <button
                          className="secondary small"
                          onClick={() => delistListing(item)}
                          type="button"
                        >
                          Delist
                        </button>
                      </span>
                    </article>
                  );
                })}
              </div>
              <PaginationControls
                label="Listings"
                onPageChange={setWalletListingPageIndex}
                page={walletListingPage}
              />
            </>
          ) : null}
        </section>
      </div>

      <section className="id-launch-card token-log-card">
        <div className="id-card-heading compact">
          <div className="id-card-icon">
            <Clock size={22} />
          </div>
          <div>
            <h2>Transfer log</h2>
            <p>Transfers and trades touching the connected address.</p>
          </div>
        </div>
        {walletMovements.length ? (
          <>
            <div className="token-list compact-token-list">
              {walletTransferPage.items.map((movement) => (
                <a
                  className="token-list-item"
                  href={explorerTxUrl(movement.txid, movement.network)}
                  key={movement.key}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span>
                    <strong>
                      {movement.amount.toLocaleString()} {movement.ticker}
                    </strong>
                    <small>
                      {movement.label} ·{" "}
                      {movement.confirmed ? "confirmed" : "pending"}
                      {movement.type === "sale"
                        ? ` · ${movement.priceSats.toLocaleString()} sale sats`
                        : ""}
                    </small>
                  </span>
                  <span>
                    <strong>{shortAddress(movement.txid)}</strong>
                    <small>{formatDate(movement.createdAt)}</small>
                  </span>
                </a>
              ))}
            </div>
            <PaginationControls
              label="Transfers"
              onPageChange={setWalletTransferPageIndex}
              page={walletTransferPage}
            />
          </>
        ) : (
          <div className="empty-state">
            <Clock size={28} />
            <h3>No movements yet</h3>
            <p>Your token transfer and trade history will appear here.</p>
          </div>
        )}
      </section>
    </section>
  );
}

type TokenAppProps = {
  address: string;
  busy: boolean;
  canCreate: boolean;
  canMint: boolean;
  canPrepareMintUtxos: boolean;
  compact?: boolean;
  confirmedSupply: number;
  connectWallet: () => void;
  createBytes: number;
  creatingToken: boolean;
  createMaxSupply: number;
  createMintAmount: number;
  createMintPriceSats: number;
  createRegistryAddress: string;
  createRegistryResolution: RecipientResolution;
  createTicker: string;
  creationSats: number;
  createToken: (event: FormEvent<HTMLFormElement>) => void;
  detailConfirmedSupply: number;
  detailHolders: PowTokenHolder[];
  detailMints: PowTokenMint[];
  detailPendingSupply: number;
  detailToken: PowTokenDefinition | undefined;
  disconnectWallet: () => void;
  feeRate: number;
  btcUsd: number;
  hasUnisat: boolean;
  network: BitcoinNetwork;
  holders: PowTokenHolder[];
  mintBytes: number;
  mintAssistantCompleted: number;
  mintAssistantDelayMs: number;
  mintAssistantRemaining: number;
  mintAssistantRunning: boolean;
  mintAssistantTarget: number;
  mintingToken: boolean;
  mints: PowTokenMint[];
  prepareFeeRate: number;
  pendingSupply: number;
  prepareFeeReserveSats: number;
  prepareMintCount: number;
  prepareMintUtxos: (event: FormEvent<HTMLFormElement>) => void;
  preparingMintUtxos: boolean;
  selectedToken: PowTokenDefinition | undefined;
  selectedTokenId: string;
  setFeeRate: (value: number) => void;
  setMintAssistantDelayMs: (value: number) => void;
  setMintAssistantTarget: (value: number) => void;
  setPrepareFeeRate: (value: number) => void;
  setCreateMaxSupply: (value: number) => void;
  setCreateMintAmount: (value: number) => void;
  setCreateMintPriceSats: (value: number) => void;
  setCreateRegistryAddress: (value: string) => void;
  setCreateTicker: (value: string) => void;
  setPrepareFeeReserveSats: (value: number) => void;
  setPrepareMintCount: (value: number) => void;
  setSelectedTokenId: (value: string) => void;
  setTokenDetailTarget: (value: string) => void;
  status: { tone: StatusTone; text: string };
  tokenDetailTarget: string;
  tokenIndexAddress: string;
  tokenListings: PowTokenListing[];
  tokenSales: PowTokenSale[];
  tokens: PowTokenDefinition[];
  workFloorLoading: boolean;
  workFloorQuote?: WorkFloorQuote;
  startMintAssistant: (tokenId?: string) => void;
  stopMintAssistant: () => void;
  submitMint: (
    event: FormEvent<HTMLFormElement>,
    tokenOverride?: PowTokenDefinition,
  ) => void | Promise<string | undefined>;
  workTokenOnly?: boolean;
  onOpenTokenFactory?: () => void;
  onNetworkChange: (network: BitcoinNetwork) => void;
  onRefresh: () => void;
};

function TokenApp({
  address,
  busy,
  connectWallet,
  disconnectWallet,
  hasUnisat,
  network,
  onNetworkChange,
  status,
  workTokenOnly,
  ...workspaceProps
}: TokenAppProps) {
  return (
    <main className="id-launch-app token-public-app">
      <AppHeader
        address={address}
        busy={busy}
        connectWallet={connectWallet}
        disconnectWallet={disconnectWallet}
        hasUnisat={hasUnisat}
        network={network}
        onNetworkChange={onNetworkChange}
        onRefresh={workspaceProps.onRefresh}
        subtitle={
          workTokenOnly
            ? "ProofOfWork token dashboard"
            : "ProofOfWork token factory"
        }
        title={workTokenOnly ? "WORK" : "Tokens"}
      />

      <AppStatusRow persistent status={status} />

      <TokenWorkspace
        address={address}
        busy={busy}
        network={network}
        workTokenOnly={workTokenOnly}
        {...workspaceProps}
      />
      <SocialFooter />
    </main>
  );
}

function TokenWorkspace({
  address,
  busy,
  canCreate,
  canMint,
  canPrepareMintUtxos,
  compact,
  confirmedSupply,
  createBytes,
  creatingToken,
  createMaxSupply,
  createMintAmount,
  createMintPriceSats,
  createRegistryAddress,
  createRegistryResolution,
  createTicker,
  creationSats,
  createToken,
  detailConfirmedSupply,
  detailHolders,
  detailMints,
  detailPendingSupply,
  detailToken,
  feeRate,
  btcUsd,
  holders,
  mintBytes,
  network,
  mintAssistantCompleted,
  mintAssistantDelayMs,
  mintAssistantRemaining,
  mintAssistantRunning,
  mintAssistantTarget,
  mintingToken,
  mints,
  pendingSupply,
  prepareFeeRate,
  prepareFeeReserveSats,
  prepareMintCount,
  prepareMintUtxos,
  preparingMintUtxos,
  selectedToken,
  selectedTokenId,
  setFeeRate,
  setMintAssistantDelayMs,
  setMintAssistantTarget,
  setPrepareFeeRate,
  setCreateMaxSupply,
  setCreateMintAmount,
  setCreateMintPriceSats,
  setCreateRegistryAddress,
  setCreateTicker,
  setPrepareFeeReserveSats,
  setPrepareMintCount,
  setSelectedTokenId,
  setTokenDetailTarget,
  startMintAssistant,
  stopMintAssistant,
  submitMint,
  tokenDetailTarget,
  tokenIndexAddress,
  tokenListings,
  tokenSales,
  tokens,
  workFloorLoading,
  workFloorQuote,
  workTokenOnly,
  onOpenTokenFactory,
  onRefresh,
}: Omit<
  TokenAppProps,
  | "connectWallet"
  | "disconnectWallet"
  | "hasUnisat"
  | "onNetworkChange"
  | "status"
>) {
  const [holderSearch, setHolderSearch] = useState("");
  const [mintSearch, setMintSearch] = useState("");
  const [holderPageIndex, setHolderPageIndex] = useState(0);
  const [mintPageIndex, setMintPageIndex] = useState(0);
  const [tokenIndexPageIndex, setTokenIndexPageIndex] = useState(0);
  const [workFloorChartUnit, setWorkFloorChartUnit] =
    useState<WorkFloorChartUnit>("sats");
  const [tokenMarketChartUnit, setTokenMarketChartUnit] =
    useState<WorkFloorChartUnit>("sats");
  const [remoteMintPage, setRemoteMintPage] = useState<
    | {
        key: string;
        page: PowPaginatedApiResponse<PowTokenMint>;
      }
    | undefined
  >();
  const [remoteMintPageLoading, setRemoteMintPageLoading] = useState(false);
  const holderQuery = holderSearch.trim().toLowerCase();
  const mintQuery = mintSearch.trim().toLowerCase();
  const detailMode = workTokenOnly || Boolean(tokenDetailTarget.trim());
  const mintHistoryToken = detailMode ? detailToken : selectedToken;
  const mintHistoryLocalCount = detailMode ? detailMints.length : mints.length;
  const mintHistoryTotalHint =
    (Number(mintHistoryToken?.confirmedMints) || 0) +
    (Number(mintHistoryToken?.pendingMints) || 0);
  const mintHistoryKey = [
    network,
    mintHistoryToken?.tokenId ?? "",
    mintPageIndex,
    mintQuery,
    TOKEN_LIST_PREVIEW_COUNT,
  ].join(":");
  const activeRemoteMintPage =
    remoteMintPage?.key === mintHistoryKey ? remoteMintPage.page : undefined;
  useEffect(() => {
    if (!mintHistoryToken?.tokenId || network !== "livenet") {
      setRemoteMintPage(undefined);
      return;
    }

    if (mintHistoryTotalHint <= mintHistoryLocalCount) {
      setRemoteMintPage(undefined);
      return;
    }

    let cancelled = false;
    setRemoteMintPageLoading(true);
    void fetchTokenHistoryPage<PowTokenMint>(network, "mints", {
      pageIndex: mintPageIndex,
      pageSize: TOKEN_LIST_PREVIEW_COUNT,
      query: mintQuery,
      tokenScope: mintHistoryToken.tokenId,
    })
      .then((page) => {
        if (!cancelled) {
          setRemoteMintPage({ key: mintHistoryKey, page });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRemoteMintPage(undefined);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRemoteMintPageLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    mintHistoryKey,
    mintHistoryLocalCount,
    mintHistoryToken?.tokenId,
    mintHistoryTotalHint,
    mintPageIndex,
    mintQuery,
    network,
  ]);
  const holderBalance =
    holders.find((holder) => holder.address === address)?.balance ?? 0;
  const selectedMatchingHolders = holders.filter((holder) =>
    tokenHolderMatchesSearch(holder, holderQuery),
  );
  const selectedHolderPage = pagedItems(
    selectedMatchingHolders,
    holderPageIndex,
    TOKEN_LIST_PREVIEW_COUNT,
  );
  const selectedVisibleHolders = selectedHolderPage.items;
  const selectedMatchingMints = mints.filter((mint) =>
    tokenMintMatchesSearch(mint, mintQuery),
  );
  const selectedRemoteMintPage =
    !detailMode && activeRemoteMintPage
      ? historyPageToPagedItems(
          activeRemoteMintPage,
          mintPageIndex,
          TOKEN_LIST_PREVIEW_COUNT,
        )
      : undefined;
  const selectedMintPage =
    selectedRemoteMintPage ??
    pagedItems(selectedMatchingMints, mintPageIndex, TOKEN_LIST_PREVIEW_COUNT);
  const selectedVisibleMints = selectedMintPage.items;
  const selectedMintMatchingCount =
    selectedRemoteMintPage?.totalCount ?? selectedMatchingMints.length;
  const selectedMintTotalCount = selectedRemoteMintPage?.totalCount ?? mints.length;
  const confirmedTokenCount = tokens.filter((token) => token.confirmed).length;
  const pendingTokenCount = tokens.length - confirmedTokenCount;
  const selectedPricePerToken =
    selectedToken && selectedToken.mintAmount > 0
      ? selectedToken.mintPriceSats / selectedToken.mintAmount
      : 0;
  const createTickerReservationMessage =
    tokenTickerReservationError(createTicker);
  const createTickerLabel = normalizeTokenTicker(createTicker) || "TOKEN";
  const createPricePerToken =
    createMintAmount > 0 ? createMintPriceSats / createMintAmount : 0;
  const createHasMintPreview =
    createMintAmount > 0 && createMintPriceSats > 0;
  const createMintUsd = satsToUsd(createMintPriceSats, btcUsd);
  const createUnitUsd = satsToUsd(createPricePerToken, btcUsd);
  const selectedMintUsd = satsToUsd(selectedToken?.mintPriceSats ?? 0, btcUsd);
  const selectedUnitUsd = satsToUsd(selectedPricePerToken, btcUsd);
  const createRegistryNote = createRegistryAddress.trim()
    ? createRegistryResolution.error
      ? createRegistryResolution.error.replace(
          "before sending to this ID",
          "before using it as a token registry",
        )
      : createRegistryResolution.isId
        ? `${createRegistryResolution.displayRecipient} resolves to ${shortAddress(createRegistryResolution.paymentAddress)}.`
        : "Raw Bitcoin registry address."
    : "";
  const applyTokenTemplate = () => {
    setCreateTicker(TOKEN_TEMPLATE_TICKER);
    setCreateMaxSupply(WORK_TOKEN_MAX_SUPPLY);
    setCreateMintAmount(WORK_TOKEN_MINT_AMOUNT);
    setCreateMintPriceSats(WORK_TOKEN_MINT_PRICE_SATS);
  };
  const replaceComputerTokenRoute = (token?: PowTokenDefinition) => {
    if (!compact || typeof window === "undefined") {
      return false;
    }

    const url = new URL(window.location.href);
    STANDALONE_ROUTE_PARAMS.forEach((param) => url.searchParams.delete(param));
    url.searchParams.set(
      "folder",
      token &&
        (token.tokenId === WORK_TOKEN_ID || token.ticker === WORK_TOKEN_TICKER)
        ? "work"
        : "token",
    );
    if (token) {
      url.searchParams.set("asset", token.tokenId);
      url.searchParams.delete("ticker");
    } else {
      url.searchParams.delete("asset");
      url.searchParams.delete("ticker");
    }
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    return true;
  };
  const openTokenDetail = (token: PowTokenDefinition) => {
    setSelectedTokenId(token.tokenId);
    setTokenDetailTarget(token.tokenId);
    if (!replaceComputerTokenRoute(token)) {
      window.history.pushState(null, "", tokenDetailHref(token));
    }
  };
  const openTokenFactory = () => {
    setTokenDetailTarget("");
    if (onOpenTokenFactory) {
      onOpenTokenFactory();
      return;
    }
    if (!replaceComputerTokenRoute()) {
      window.history.pushState(
        null,
        "",
        appHref(TOKEN_APP_URL, LOCAL_TOKEN_APP_URL),
      );
    }
  };
  const detailPricePerToken =
    detailToken && detailToken.mintAmount > 0
      ? detailToken.mintPriceSats / detailToken.mintAmount
      : 0;
  const detailSupplyState = tokenMintSupplyState(
    detailToken,
    detailConfirmedSupply,
    detailPendingSupply,
  );
  const detailConfirmedRemainingSupply =
    detailSupplyState.confirmedRemainingSupply;
  const detailAvailableSupply = detailSupplyState.availableSupply;
  const detailMintedOut = detailSupplyState.mintedOut;
  const detailPendingMintOut = detailSupplyState.pendingMintOut;
  const detailMintWouldOverfill = detailSupplyState.wouldOverfill;
  const detailMintBytes = detailToken
    ? dataCarrierBytesForPayload(
        buildTokenMintPayload(detailToken.tokenId, detailToken.mintAmount),
      )
    : 0;
  const detailCanMint = Boolean(
    address &&
      network === "livenet" &&
      detailToken &&
      detailToken.registryAddress &&
      !detailMintedOut &&
      !detailPendingMintOut &&
      !detailMintWouldOverfill &&
      detailMintBytes <= MAX_DATA_CARRIER_BYTES &&
      !busy,
  );
  const detailMintButtonLabel = mintingToken
    ? "Minting"
    : detailMintedOut
      ? "Minted out"
      : detailPendingMintOut
        ? "Pending mint-out"
      : detailMintWouldOverfill
        ? "Exceeds remaining"
        : "Mint";
  const detailMintBlockedNote = detailMintedOut
    ? `${detailToken?.ticker ?? "This token"} is minted out by confirmed supply.`
    : detailPendingMintOut
      ? `Pending mints currently fill the remaining ${detailToken?.ticker ?? "token"} supply. Refresh after confirmations.`
      : detailMintWouldOverfill
        ? detailPendingSupply > 0
          ? `Next mint needs ${detailToken?.mintAmount.toLocaleString()} ${detailToken?.ticker}, but only ${detailAvailableSupply.toLocaleString()} are available after pending mints.`
          : `Next mint needs ${detailToken?.mintAmount.toLocaleString()} ${detailToken?.ticker}, but only ${detailConfirmedRemainingSupply.toLocaleString()} confirmed supply remains.`
      : "";
  const detailProgress = tokenProgressPercent(
    detailConfirmedSupply,
    detailToken?.maxSupply ?? 0,
  );
  const detailMintUsd = satsToUsd(detailToken?.mintPriceSats ?? 0, btcUsd);
  const detailUnitUsd = satsToUsd(detailPricePerToken, btcUsd);
  const detailShowsWorkFloor =
    Boolean(
      detailToken &&
        (detailToken.tokenId === WORK_TOKEN_ID ||
          detailToken.ticker === WORK_TOKEN_TICKER),
    );
  const liveWorkFloorSats =
    detailShowsWorkFloor && workFloorQuote
      ? workFloorQuote.networkValueSats / WORK_TOKEN_MAX_SUPPLY
      : 0;
  const liveWorkFloorUsd = satsToUsd(liveWorkFloorSats, btcUsd);
  const liveWorkNetworkUsd = workFloorQuote
    ? satsToUsd(workFloorQuote.networkValueSats, btcUsd)
    : 0;
  const workFloorChartPoints = workFloorQuote?.chartPoints ?? [];
  const workFloorMinSats =
    workFloorChartPoints.length > 0
      ? Math.min(...workFloorChartPoints.map((point) => point.floorSats))
      : 0;
  const workFloorMaxSats =
    workFloorChartPoints.length > 0
      ? Math.max(...workFloorChartPoints.map((point) => point.floorSats))
      : 0;
  const detailMatchingHolders = detailHolders.filter((holder) =>
    tokenHolderMatchesSearch(holder, holderQuery),
  );
  const detailHolderPage = pagedItems(
    detailMatchingHolders,
    holderPageIndex,
    TOKEN_LIST_PREVIEW_COUNT,
  );
  const detailVisibleHolders = detailHolderPage.items;
  const detailMatchingMints = detailMints.filter((mint) =>
    tokenMintMatchesSearch(mint, mintQuery),
  );
  const detailRemoteMintPage =
    detailMode && activeRemoteMintPage
      ? historyPageToPagedItems(
          activeRemoteMintPage,
          mintPageIndex,
          TOKEN_LIST_PREVIEW_COUNT,
        )
      : undefined;
  const detailMintPage =
    detailRemoteMintPage ??
    pagedItems(detailMatchingMints, mintPageIndex, TOKEN_LIST_PREVIEW_COUNT);
  const detailVisibleMints = detailMintPage.items;
  const detailMintMatchingCount =
    detailRemoteMintPage?.totalCount ?? detailMatchingMints.length;
  const detailMintTotalCount =
    detailRemoteMintPage?.totalCount ?? detailMints.length;
  const detailHolderBalance =
    detailHolders.find((holder) => holder.address === address)?.balance ?? 0;
  const detailConfirmedMintCount = detailMints.filter(
    (mint) => mint.confirmed,
  ).length;
  const detailPendingMintCount = detailMints.length - detailConfirmedMintCount;
  const detailRegistryLabel =
    detailToken?.registryAddress === WORK_TOKEN_REGISTRY_ADDRESS
      ? `${WORK_TOKEN_DEFAULT_REGISTRY_ID} / ${shortAddress(WORK_TOKEN_REGISTRY_ADDRESS)}`
      : (detailToken?.registryAddress ?? "");
  const detailMarketListings = detailToken
    ? tokenListings.filter(
        (listing) =>
          listing.network === network && listing.tokenId === detailToken.tokenId,
      )
    : [];
  const detailMarketSales = detailToken
    ? tokenSales.filter(
        (sale) =>
          sale.network === network && sale.tokenId === detailToken.tokenId,
      )
    : [];
  const detailMarketChartPoints = detailToken
    ? tokenMarketPricePointsFor(
        detailToken,
        detailMarketListings,
        detailMarketSales,
      )
    : [];
  const detailConfirmedMarketChartPoints = detailMarketChartPoints.filter(
    (point) => point.confirmed,
  );
  const detailMarketChartMinSats = detailConfirmedMarketChartPoints.length
    ? Math.min(...detailConfirmedMarketChartPoints.map((point) => point.priceSats))
    : 0;
  const detailMarketChartMaxSats = detailConfirmedMarketChartPoints.length
    ? Math.max(...detailConfirmedMarketChartPoints.map((point) => point.priceSats))
    : 0;
  const detailLowestAskSats = detailMarketListings.reduce((lowest, listing) => {
    if (!listing.confirmed || listing.amount <= 0) {
      return lowest;
    }

    const unit = listing.priceSats / listing.amount;
    return lowest > 0 ? Math.min(lowest, unit) : unit;
  }, 0);
  const detailLastSale = detailMarketSales
    .filter((sale) => sale.confirmed && sale.amount > 0)
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        right.txid.localeCompare(left.txid),
    )[0];
  const detailLastSaleSats = detailLastSale
    ? detailLastSale.priceSats / detailLastSale.amount
    : 0;
  const selectedProgress = tokenProgressPercent(
    confirmedSupply,
    selectedToken?.maxSupply ?? 0,
  );
  const selectedSupplyState = tokenMintSupplyState(
    selectedToken,
    confirmedSupply,
    pendingSupply,
  );
  const selectedConfirmedRemainingSupply =
    selectedSupplyState.confirmedRemainingSupply;
  const selectedAvailableSupply = selectedSupplyState.availableSupply;
  const selectedMintedOut = selectedSupplyState.mintedOut;
  const selectedPendingMintOut = selectedSupplyState.pendingMintOut;
  const selectedMintWouldOverfill = selectedSupplyState.wouldOverfill;
  const selectedMintButtonLabel = mintingToken
    ? "Minting"
    : selectedMintedOut
      ? "Minted out"
      : selectedPendingMintOut
        ? "Pending mint-out"
      : selectedMintWouldOverfill
        ? "Exceeds remaining"
        : "Mint";
  const selectedMintBlockedNote = selectedMintedOut
    ? `${selectedToken?.ticker ?? "This token"} is minted out by confirmed supply.`
    : selectedPendingMintOut
      ? `Pending mints currently fill the remaining ${selectedToken?.ticker ?? "token"} supply. Refresh after confirmations.`
      : selectedMintWouldOverfill
        ? pendingSupply > 0
          ? `Next mint needs ${selectedToken?.mintAmount.toLocaleString()} ${selectedToken?.ticker}, but only ${selectedAvailableSupply.toLocaleString()} are available after pending mints.`
          : `Next mint needs ${selectedToken?.mintAmount.toLocaleString()} ${selectedToken?.ticker}, but only ${selectedConfirmedRemainingSupply.toLocaleString()} confirmed supply remains.`
      : "";
  const selectedRegistryLabel =
    selectedToken?.registryAddress === WORK_TOKEN_REGISTRY_ADDRESS
      ? `${WORK_TOKEN_DEFAULT_REGISTRY_ID} / ${shortAddress(WORK_TOKEN_REGISTRY_ADDRESS)}`
      : selectedToken
        ? shortAddress(selectedToken.registryAddress)
        : "No token selected";
  const tokenStatsById = useMemo(() => {
    const stats = new Map<
      string,
      {
        confirmedMints: number;
        confirmedSupply: number;
        pendingMints: number;
        pendingSupply: number;
      }
    >();

    for (const token of tokens) {
      stats.set(token.tokenId, {
        confirmedMints: 0,
        confirmedSupply: 0,
        pendingMints: 0,
        pendingSupply: 0,
      });
    }

    for (const mint of mints) {
      const current =
        stats.get(mint.tokenId) ??
        {
          confirmedMints: 0,
          confirmedSupply: 0,
          pendingMints: 0,
          pendingSupply: 0,
        };
      if (mint.confirmed) {
        current.confirmedMints += 1;
        current.confirmedSupply += mint.amount;
      } else {
        current.pendingMints += 1;
        current.pendingSupply += mint.amount;
      }
      stats.set(mint.tokenId, current);
    }

    return stats;
  }, [mints, tokens]);
  const tokenDefinitionPage = pagedItems(
    tokens,
    tokenIndexPageIndex,
    TOKEN_GRID_PAGE_SIZE,
  );
  const normalizedPrepareMintCount = Number.isFinite(prepareMintCount)
    ? Math.max(0, Math.floor(prepareMintCount))
    : 0;
  const normalizedPrepareFeeReserveSats = Number.isFinite(prepareFeeReserveSats)
    ? Math.max(0, Math.floor(prepareFeeReserveSats))
    : 0;
  const normalizedPrepareFeeRate =
    Number.isFinite(prepareFeeRate) && prepareFeeRate > 0
      ? prepareFeeRate
      : DEFAULT_FEE_RATE;
  const normalizedMintAssistantTarget = Number.isFinite(mintAssistantTarget)
    ? Math.min(
        TOKEN_MINT_ASSISTANT_MAX_COUNT,
        Math.max(1, Math.floor(mintAssistantTarget)),
      )
    : TOKEN_MINT_ASSISTANT_DEFAULT_COUNT;
  const normalizedMintAssistantDelayMs = Number.isFinite(mintAssistantDelayMs)
    ? Math.min(
        TOKEN_MINT_ASSISTANT_MAX_DELAY_MS,
        Math.max(0, Math.floor(mintAssistantDelayMs)),
      )
    : TOKEN_MINT_ASSISTANT_DEFAULT_DELAY_MS;
  const mintAssistantDelaySeconds = Number(
    (normalizedMintAssistantDelayMs / 1000).toFixed(2),
  );
  const renderMintAssistant = (token: PowTokenDefinition | undefined) => {
    if (!token) {
      return null;
    }

    const assistantMints =
      detailToken?.tokenId === token.tokenId
        ? detailMints
        : selectedToken?.tokenId === token.tokenId
          ? mints
          : [];
    const assistantLedger = tokenLedgerFor(token, assistantMints);
    const assistantSupplyState = tokenMintSupplyState(
      token,
      assistantLedger.confirmedSupply,
      assistantLedger.pendingSupply,
    );
    const assistantMintedOut = assistantSupplyState.mintedOut;
    const assistantPendingMintOut = assistantSupplyState.pendingMintOut;
    const assistantWouldOverfill = assistantSupplyState.wouldOverfill;
    const assistantBlocked =
      assistantMintedOut ||
      assistantPendingMintOut ||
      assistantWouldOverfill ||
      dataCarrierBytesForPayload(
        buildTokenMintPayload(token.tokenId, token.mintAmount),
      ) > MAX_DATA_CARRIER_BYTES;
    const assistantCanStart = Boolean(
      address && !busy && !mintAssistantRunning && !assistantBlocked,
    );
    const completedLabel = mintAssistantCompleted.toLocaleString();
    const remainingLabel = mintAssistantRemaining.toLocaleString();
    const assistantButtonLabel = mintAssistantRunning
      ? "Assistant running"
      : assistantMintedOut
        ? "Minted out"
        : assistantPendingMintOut
          ? "Pending mint-out"
        : assistantWouldOverfill
          ? "Exceeds remaining"
          : `Start ${normalizedMintAssistantTarget.toLocaleString()} mints`;

    return (
      <div className="token-mint-assistant">
        <div className="token-assistant-head">
          <div>
            <strong>Mint assistant</strong>
            <span>
              {mintAssistantRunning
                ? `${completedLabel} broadcast, ${remainingLabel} queued`
                : "Queues one UniSat signing prompt at a time"}
            </span>
          </div>
          <div className="token-assistant-status" aria-label="Mint assistant progress">
            <span>{completedLabel} done</span>
            <span>{remainingLabel} left</span>
          </div>
        </div>
        <div className="token-form-grid token-assistant-grid">
          <label>
            Mints
            <input
              disabled={mintAssistantRunning}
              max={TOKEN_MINT_ASSISTANT_MAX_COUNT}
              min={1}
              onChange={(event) =>
                setMintAssistantTarget(Number(event.target.value))
              }
              type="number"
              value={mintAssistantTarget || ""}
            />
          </label>
          <label>
            Delay seconds
            <input
              disabled={mintAssistantRunning}
              max={TOKEN_MINT_ASSISTANT_MAX_DELAY_MS / 1000}
              min={0}
              onChange={(event) =>
                setMintAssistantDelayMs(Number(event.target.value) * 1000)
              }
              step={0.1}
              type="number"
              value={mintAssistantDelaySeconds}
            />
          </label>
        </div>
        <div className="token-assistant-actions">
          <button
            className="secondary"
            disabled={!assistantCanStart}
            onClick={() => startMintAssistant(token.tokenId)}
            type="button"
          >
            <span className="button-content">
              <Send size={16} />
              <span>{assistantButtonLabel}</span>
            </span>
          </button>
          <button
            className="secondary"
            disabled={!mintAssistantRunning}
            onClick={() => stopMintAssistant()}
            type="button"
          >
            <span className="button-content">
              <X size={16} />
              <span>Stop</span>
            </span>
          </button>
        </div>
        <p className="field-note">
          Opens the next {token.ticker} mint after the previous broadcast. You
          still click Sign in UniSat. It stops on errors, cancelation, or minted
          out supply.
        </p>
      </div>
    );
  };
  const renderMintUtxoPrep = (token: PowTokenDefinition | undefined) => {
    if (!token) {
      return null;
    }

    const outputSats = Math.max(
      DUST_SATS,
      token.mintPriceSats + normalizedPrepareFeeReserveSats,
    );
    const totalPreparedSats = outputSats * normalizedPrepareMintCount;
    const estimatedSplitVbytes =
      normalizedPrepareMintCount > 0
        ? estimateTxVbytes(
            1,
            normalizedPrepareMintCount * ESTIMATED_PAYMENT_OUTPUT_VBYTES +
              ESTIMATED_PAYMENT_OUTPUT_VBYTES,
          )
        : 0;
    const estimatedSplitFeeSats =
      normalizedPrepareMintCount > 0
        ? Math.ceil(estimatedSplitVbytes * normalizedPrepareFeeRate)
        : 0;
    const estimatedTotalSats = totalPreparedSats + estimatedSplitFeeSats;
    const registrySatsTotal = token.mintPriceSats * normalizedPrepareMintCount;
    const futureReserveTotal =
      normalizedPrepareFeeReserveSats * normalizedPrepareMintCount;
    const helperTokenSelected = selectedToken?.tokenId === token.tokenId;
    const helperCanPrepare = canPrepareMintUtxos && helperTokenSelected;

    return (
      <details className="token-utxo-prep" open>
        <summary>Prepare UTXOs fee dashboard</summary>
        <form className="id-form" onSubmit={prepareMintUtxos}>
          <div className="token-utxo-dashboard">
            <div>
              <span>Split tx fee rate</span>
              <strong>{normalizedPrepareFeeRate.toLocaleString()} sat/vB</strong>
              <p>
                Miner fee for the one self-send transaction that creates mint
                UTXOs.
              </p>
            </div>
            <div>
              <span>Estimated split size</span>
              <strong>{estimatedSplitVbytes.toLocaleString()} vB</strong>
              <p>
                One funding input, {normalizedPrepareMintCount.toLocaleString()}{" "}
                mint outputs, and one change output.
              </p>
            </div>
            <div>
              <span>Split miner fee</span>
              <strong>{estimatedSplitFeeSats.toLocaleString()} sats</strong>
              <p>This is paid to miners by the prepare transaction.</p>
            </div>
            <div>
              <span>Total wallet needed</span>
              <strong>{estimatedTotalSats.toLocaleString()} sats</strong>
              <p>Outputs total plus the split transaction miner fee.</p>
            </div>
          </div>
          <div className="token-form-grid">
            <label>
              Mint txs
              <input
                max={TOKEN_PREPARE_MAX_MINT_COUNT}
                min={1}
                onChange={(event) =>
                  setPrepareMintCount(Number(event.target.value))
                }
                type="number"
                value={prepareMintCount || ""}
              />
            </label>
            <label>
              Future mint reserve / UTXO
              <input
                min={0}
                onChange={(event) =>
                  setPrepareFeeReserveSats(Number(event.target.value))
                }
                type="number"
                value={prepareFeeReserveSats || ""}
              />
            </label>
            <label>
              Split fee sat/vB
              <input
                min={0.01}
                onChange={(event) =>
                  setPrepareFeeRate(Number(event.target.value))
                }
                step={0.01}
                type="number"
                value={prepareFeeRate || ""}
              />
            </label>
          </div>
          <div className="fee-presets token-split-fee-presets" aria-label="Split fee presets">
            {[0.1, 0.25, 0.5, 1, 2, 5].map((preset) => (
              <button
                aria-pressed={prepareFeeRate === preset}
                key={preset}
                onClick={() => setPrepareFeeRate(preset)}
                type="button"
              >
                {preset}
              </button>
            ))}
          </div>
          <div
            className="id-launch-stats token-utxo-stats"
            aria-label="Prepared UTXO preview"
          >
            <div>
              <span>Outputs</span>
              <strong>{normalizedPrepareMintCount.toLocaleString()}</strong>
            </div>
            <div>
              <span>Each UTXO</span>
              <strong>{outputSats.toLocaleString()} sats</strong>
            </div>
            <div>
              <span>Registry sats staged</span>
              <strong>{registrySatsTotal.toLocaleString()} sats</strong>
            </div>
            <div>
              <span>Future fee reserve</span>
              <strong>{futureReserveTotal.toLocaleString()} sats</strong>
            </div>
            <div>
              <span>Outputs total</span>
              <strong>{totalPreparedSats.toLocaleString()} sats</strong>
            </div>
            <div>
              <span>Split tx miner fee</span>
              <strong>{estimatedSplitFeeSats.toLocaleString()} sats</strong>
            </div>
            <div>
              <span>Total needed now</span>
              <strong>{estimatedTotalSats.toLocaleString()} sats</strong>
            </div>
          </div>
          <p className="field-note">
            This does not mint. It creates self-send outputs to your connected
            wallet. Each output is sized for the{" "}
            {token.mintPriceSats.toLocaleString()} sat registry payment plus a
            future-mint miner reserve. The split transaction has its own fee
            rate and should confirm before burst minting.
          </p>
          <button className="secondary" disabled={!helperCanPrepare} type="submit">
            <span className="button-content">
              <Wallet size={16} />
              <span>
                {preparingMintUtxos ? "Preparing" : "Prepare Mint UTXOs"}
              </span>
            </span>
          </button>
          {!address ? (
            <p className="field-note">Connect UniSat to prepare mint UTXOs.</p>
          ) : !helperTokenSelected ? (
            <p className="field-note">Select this token before preparing UTXOs.</p>
          ) : null}
        </form>
      </details>
    );
  };
  const visibleCountText = (
    visibleCount: number,
    matchingCount: number,
    totalCount: number,
    label: string,
    query: string,
  ) =>
    query
      ? `${visibleCount.toLocaleString()} of ${matchingCount.toLocaleString()} matching ${label}`
      : `${visibleCount.toLocaleString()} of ${totalCount.toLocaleString()} ${label}`;
  const renderHolderSearch = (
    visibleCount: number,
    matchingCount: number,
    totalCount: number,
  ) => (
    <div className="token-search-row">
      <label className="token-search-field">
        <Search size={15} />
        <input
          aria-label="Search token holders"
          onChange={(event) => setHolderSearch(event.target.value)}
          placeholder="Search address or balance"
          value={holderSearch}
        />
      </label>
      <span className="token-search-count">
        {visibleCountText(
          visibleCount,
          matchingCount,
          totalCount,
          "holders",
          holderQuery,
        )}
      </span>
    </div>
  );
  const renderMintSearch = (
    visibleCount: number,
    matchingCount: number,
    totalCount: number,
  ) => (
    <div className="token-search-row">
      <label className="token-search-field">
        <Search size={15} />
        <input
          aria-label="Search token mints"
          onChange={(event) => setMintSearch(event.target.value)}
          placeholder="Search minter, txid, status, sats"
          value={mintSearch}
        />
      </label>
      <span className="token-search-count">
        {visibleCountText(
          visibleCount,
          matchingCount,
          totalCount,
          "mints",
          mintQuery,
        )}
      </span>
    </div>
  );
  const renderHolderList = (
    token: PowTokenDefinition,
    visibleHolders: PowTokenHolder[],
  ) => (
    <div className="id-record-list">
      {visibleHolders.length === 0 ? (
        <div className="empty-state">
          <h3>{holderQuery ? "No holder matches" : "No holders yet"}</h3>
          <p>
            {holderQuery
              ? "Search by a full address fragment or confirmed balance."
              : "The first confirmed mint will appear here."}
          </p>
        </div>
      ) : (
        visibleHolders.map((holder) => (
          <article className="id-record" key={holder.address}>
            <div>
              <strong>
                {holder.balance.toLocaleString()} {token.ticker}
              </strong>
              <code>{holder.address}</code>
            </div>
            <a
              className="secondary small"
              href={explorerAddressUrl(holder.address, token.network)}
              rel="noreferrer"
              target="_blank"
            >
              <span className="button-content">
                <ArrowUpRight size={15} />
                <span>Address</span>
              </span>
            </a>
          </article>
        ))
      )}
    </div>
  );
  const renderMintList = (
    visibleMints: PowTokenMint[],
    loadingRemotePage = false,
  ) => (
    <div className="activity-feed">
      {visibleMints.length === 0 ? (
        <div className="empty-state">
          <h3>
            {loadingRemotePage
              ? "Loading mints"
              : mintQuery
                ? "No mint matches"
                : "No mints yet"}
          </h3>
          <p>
            {loadingRemotePage
              ? "Fetching the requested history page."
              : mintQuery
              ? "Search by minter address, transaction id, status, amount, or sats."
              : "The selected token starts with its first valid mint."}
          </p>
        </div>
      ) : (
        visibleMints.map((mint) => (
          <article className="activity-row" key={`${mint.txid}-${mint.amount}`}>
            <div className="activity-row-main">
              <div>
                <h4>
                  {mint.amount.toLocaleString()} {mint.ticker}
                </h4>
                <strong>{shortAddress(mint.minterAddress)}</strong>
                <p>
                  {mint.confirmed ? "Confirmed" : "Pending"} -{" "}
                  {mint.paidSats.toLocaleString()} sats
                </p>
              </div>
              <time dateTime={mint.createdAt}>{formatDate(mint.createdAt)}</time>
            </div>
            <div className="id-record-actions">
              <a
                className="secondary small"
                href={explorerTxUrl(mint.txid, mint.network)}
                rel="noreferrer"
                target="_blank"
              >
                <span className="button-content">
                  <ArrowUpRight size={15} />
                  <span>View TX</span>
                </span>
              </a>
            </div>
          </article>
        ))
      )}
    </div>
  );
  const workspaceClassName = `id-launch-main token-workspace${compact ? " token-workspace-compact" : ""}`;

  if (detailMode) {
    return (
      <section className={`${workspaceClassName} token-detail-page`}>
        <div className="token-detail-toolbar">
          {compact ? (
            <button className="secondary small" onClick={openTokenFactory} type="button">
              <span className="button-content">
                <ArrowLeft size={15} />
                <span>Factory</span>
              </span>
            </button>
          ) : (
            <a
              className="secondary small"
              href={appHref(TOKEN_APP_URL, LOCAL_TOKEN_APP_URL)}
            >
              <span className="button-content">
                <ArrowLeft size={15} />
                <span>Factory</span>
              </span>
            </a>
          )}
          <button className="secondary small" onClick={onRefresh} type="button">
            <span className="button-content">
              <RefreshCw size={15} />
              <span>Refresh</span>
            </span>
          </button>
        </div>

        {detailToken ? (
          <>
            <section className="id-launch-card token-detail-hero">
              <div className="token-detail-title">
                <div className="empty-icon" aria-hidden="true">
                  <TrendingUp size={26} />
                </div>
                <div>
                  <p className="eyebrow">Token dashboard</p>
                  <h2>{detailToken.ticker}</h2>
                  <div className="token-chip-row" aria-label="Token summary">
                    <span>{detailToken.maxSupply.toLocaleString()} max</span>
                    <span>
                      {detailToken.mintAmount.toLocaleString()} per mint
                    </span>
                    <span>
                      {tokenSatsPerUnit(detailPricePerToken)} sat /{" "}
                      {detailToken.ticker}
                    </span>
                    <span>{detailConfirmedMintCount.toLocaleString()} mints</span>
                  </div>
                  <p>
                    Minted by confirmed Bitcoin history. Mints pay the token
                    registry directly.
                  </p>
                </div>
              </div>
              <div className="token-detail-actions">
                <a
                  className="secondary small"
                  href={explorerTxUrl(detailToken.txid, detailToken.network)}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="button-content">
                    <ArrowUpRight size={15} />
                    <span>Deploy TX</span>
                  </span>
                </a>
                <a
                  className="secondary small"
                  href={explorerAddressUrl(
                    detailToken.registryAddress,
                    detailToken.network,
                  )}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="button-content">
                    <ArrowUpRight size={15} />
                    <span>Registry</span>
                  </span>
                </a>
              </div>
              <div className="token-progress-block">
                <div className="token-progress-copy">
                  <span>Mint progress</span>
                  <strong>{tokenProgressLabel(detailConfirmedSupply, detailToken.maxSupply)}</strong>
                </div>
                <ProgressBar
                  label={`${detailToken.ticker} mint progress`}
                  progress={detailProgress}
                />
                <p className="field-note">
                  {detailConfirmedSupply.toLocaleString()} /{" "}
                  {detailToken.maxSupply.toLocaleString()} {detailToken.ticker}{" "}
                  confirmed. {detailConfirmedRemainingSupply.toLocaleString()}{" "}
                  confirmed remaining; {detailAvailableSupply.toLocaleString()}{" "}
                  available after pending mints.
                </p>
              </div>
            </section>

            <div className="id-launch-stats token-detail-stats">
              <div>
                <strong>{detailToken.maxSupply.toLocaleString()}</strong>
                <span>Max supply</span>
              </div>
              <div>
                <strong>{detailConfirmedSupply.toLocaleString()}</strong>
                <span>Confirmed minted</span>
              </div>
              <div>
                <strong>{detailHolders.length.toLocaleString()}</strong>
                <span>Holders</span>
              </div>
              <div>
                <strong>{detailConfirmedMintCount.toLocaleString()}</strong>
                <span>Confirmed mints</span>
              </div>
            </div>

            {detailShowsWorkFloor ? (
              <section className="id-launch-card token-floor-card">
                <div className="id-card-head">
                  <div className="empty-icon" aria-hidden="true">
                    <TrendingUp size={24} />
                  </div>
                  <div>
                    <h3>Live WORK floor</h3>
                    <p>
                      Confirmed Bitcoin Computer network value divided by{" "}
                      {WORK_TOKEN_MAX_SUPPLY.toLocaleString()} WORK.
                    </p>
                  </div>
                </div>
                {workFloorQuote ? (
                  <>
                    <div
                      className="id-launch-stats token-floor-stats"
                      aria-label="Live WORK floor"
                    >
                      <div>
                        <span>Floor</span>
                        <strong>
                          {tokenSatsPerUnit(liveWorkFloorSats)} sats / WORK
                        </strong>
                      </div>
                      <div>
                        <span>USD/WORK</span>
                        <strong>{tokenUsd(liveWorkFloorUsd)}</strong>
                      </div>
                      <div>
                        <span>Network value</span>
                        <strong>
                          {Math.round(
                            workFloorQuote.networkValueSats,
                          ).toLocaleString()}{" "}
                          sats
                        </strong>
                      </div>
                      <div>
                        <span>Network USD</span>
                        <strong>{tokenUsd(liveWorkNetworkUsd)}</strong>
                      </div>
                    </div>
                    {workFloorChartPoints.length > 1 ? (
                      <>
                        <div className="work-floor-chart-toolbar">
                          <div
                            className="network-tabs work-floor-chart-toggle"
                            aria-label="WORK floor chart unit"
                          >
                            {(
                              [
                                ["sats", "Sats"],
                                ["usd", "USD"],
                              ] as const
                            ).map(([unit, label]) => (
                              <button
                                aria-pressed={workFloorChartUnit === unit}
                                key={unit}
                                onClick={() => setWorkFloorChartUnit(unit)}
                                type="button"
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <WorkFloorChart
                          btcUsd={btcUsd}
                          points={workFloorChartPoints}
                          unit={workFloorChartUnit}
                        />
                        <div className="work-floor-chart-meta">
                          <span>
                            Low{" "}
                            {workFloorPriceLabel(
                              workFloorMinSats,
                              btcUsd,
                              workFloorChartUnit,
                            )}
                          </span>
                          <span>
                            High{" "}
                            {workFloorPriceLabel(
                              workFloorMaxSats,
                              btcUsd,
                              workFloorChartUnit,
                            )}
                          </span>
                          <span>
                            {workFloorChartPoints.length.toLocaleString()}{" "}
                            confirmed points
                          </span>
                        </div>
                      </>
                    ) : null}
                    <p className="field-note">
                      Mint price remains{" "}
                      {detailToken.mintPriceSats.toLocaleString()} sats for{" "}
                      {detailToken.mintAmount.toLocaleString()} WORK. The live
                      floor follows confirmed network value only; pending mints
                      wait for confirmation. Refreshed{" "}
                      {formatDate(workFloorQuote.indexedAt)} from confirmed
                      Computer value across{" "}
                      {Math.round(
                        workFloorQuote.stats?.confirmedComputerActions ?? 0,
                      ).toLocaleString()}{" "}
                      confirmed actions.
                    </p>
                  </>
                ) : (
                  <p className="field-note">
                    {workFloorLoading
                      ? "Loading confirmed network value..."
                      : "Refresh to load the live WORK floor."}
                  </p>
                )}
              </section>
            ) : null}

            {!detailShowsWorkFloor ? (
              <section className="id-launch-card token-floor-card">
                <div className="id-card-head">
                  <div className="empty-icon" aria-hidden="true">
                    <TrendingUp size={24} />
                  </div>
                  <div>
                    <h3>{detailToken.ticker} market chart</h3>
                    <p>
                      Confirmed deploy price, sale prices, and active asks for
                      this token.
                    </p>
                  </div>
                </div>
                <div
                  className="id-launch-stats token-floor-stats"
                  aria-label={`${detailToken.ticker} market prices`}
                >
                  <div>
                    <span>Mint price</span>
                    <strong>
                      {tokenSatsPerUnit(detailPricePerToken)} sats /{" "}
                      {detailToken.ticker}
                    </strong>
                  </div>
                  <div>
                    <span>Lowest ask</span>
                    <strong>
                      {detailLowestAskSats > 0
                        ? `${tokenSatsPerUnit(detailLowestAskSats)} sats / ${detailToken.ticker}`
                        : "No asks"}
                    </strong>
                  </div>
                  <div>
                    <span>Last sale</span>
                    <strong>
                      {detailLastSaleSats > 0
                        ? `${tokenSatsPerUnit(detailLastSaleSats)} sats / ${detailToken.ticker}`
                        : "No sales"}
                    </strong>
                  </div>
                  <div>
                    <span>USD/token</span>
                    <strong>{tokenUsd(detailUnitUsd)}</strong>
                  </div>
                </div>
                {detailConfirmedMarketChartPoints.length > 0 ? (
                  <>
                    <div className="work-floor-chart-toolbar">
                      <div
                        className="network-tabs work-floor-chart-toggle"
                        aria-label={`${detailToken.ticker} chart unit`}
                      >
                        {(
                          [
                            ["sats", "Sats"],
                            ["usd", "USD"],
                          ] as const
                        ).map(([unit, label]) => (
                          <button
                            aria-pressed={tokenMarketChartUnit === unit}
                            key={unit}
                            onClick={() => setTokenMarketChartUnit(unit)}
                            type="button"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <TokenMarketPriceChart
                      btcUsd={btcUsd}
                      points={detailConfirmedMarketChartPoints}
                      ticker={detailToken.ticker}
                      unit={tokenMarketChartUnit}
                    />
                    <div className="work-floor-chart-meta">
                      <span>
                        Low{" "}
                        {tokenMarketPriceLabel(
                          detailMarketChartMinSats,
                          btcUsd,
                          detailToken.ticker,
                          tokenMarketChartUnit,
                        )}
                      </span>
                      <span>
                        High{" "}
                        {tokenMarketPriceLabel(
                          detailMarketChartMaxSats,
                          btcUsd,
                          detailToken.ticker,
                          tokenMarketChartUnit,
                        )}
                      </span>
                      <span>
                        {detailConfirmedMarketChartPoints.length.toLocaleString()}{" "}
                        confirmed points
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="field-note">
                    This token has no confirmed market points yet. The mint
                    price remains the starting reference until listings or sales
                    confirm.
                  </p>
                )}
                <p className="field-note">
                  WORK uses the network floor chart. Other tokens use their own
                  confirmed sale-ticket market data.
                </p>
              </section>
            ) : null}

            <div className="id-launch-grid">
              <section className="id-launch-card token-mint-panel">
                <div className="id-card-head">
                  <div className="empty-icon" aria-hidden="true">
                    <Wallet size={24} />
                  </div>
                  <div>
                    <h3>Mint {detailToken.ticker}</h3>
                    <p>
                      {detailToken.mintAmount.toLocaleString()}{" "}
                      {detailToken.ticker} for{" "}
                      {detailToken.mintPriceSats.toLocaleString()} sats.
                    </p>
                  </div>
                </div>
                <form
                  className="id-form"
                  onSubmit={(event) => submitMint(event, detailToken)}
                >
                  <div className="id-launch-stats">
                    <div>
                      <span>Mint price</span>
                      <strong>
                        {detailToken.mintPriceSats.toLocaleString()} sats
                      </strong>
                    </div>
                    <div>
                      <span>Amount</span>
                      <strong>
                        {detailToken.mintAmount.toLocaleString()}{" "}
                        {detailToken.ticker}
                      </strong>
                    </div>
                    <div>
                      <span>Unit price</span>
                      <strong>
                        {tokenSatsPerUnit(detailPricePerToken)} sat /{" "}
                        {detailToken.ticker}
                      </strong>
                    </div>
                    <div>
                      <span>USD/token</span>
                      <strong>{tokenUsd(detailUnitUsd)}</strong>
                    </div>
                  </div>
                  <p className="field-note">
                    {tokenUsd(detailMintUsd)} per mint at the current BTC/USD
                    estimate. Paid to{" "}
                    {shortAddress(detailToken.registryAddress)}.
                    {address
                      ? ` Your confirmed balance is ${detailHolderBalance.toLocaleString()} ${detailToken.ticker}.`
                      : ""}
                  </p>
                  <div className="token-payment-lane">
                    <div>
                      <span>Registry paid</span>
                      <strong>{shortAddress(detailToken.registryAddress)}</strong>
                    </div>
                    <div>
                      <span>Available now</span>
                      <strong>
                        {detailAvailableSupply.toLocaleString()}{" "}
                        {detailToken.ticker}
                      </strong>
                    </div>
                  </div>
                  <FeeRateControl feeRate={feeRate} setFeeRate={setFeeRate} />
                  <button className="primary" disabled={!detailCanMint} type="submit">
                    <span className="button-content">
                      <Send size={16} />
                      <span>{detailMintButtonLabel}</span>
                    </span>
                  </button>
                  {detailMintBlockedNote ? (
                    <p className="field-note bad">{detailMintBlockedNote}</p>
                  ) : null}
                </form>
                {renderMintAssistant(detailToken)}
                {renderMintUtxoPrep(detailToken)}
              </section>

              <section className="id-launch-card">
                <div className="id-card-head">
                  <div className="empty-icon" aria-hidden="true">
                    <FileText size={24} />
                  </div>
                  <div>
                    <h3>Token facts</h3>
                    <p>Deployment and registry values for this token.</p>
                  </div>
                </div>
                <dl className="browser-meta">
                  <div>
                    <dt>Token id</dt>
                    <dd>{shortAddress(detailToken.tokenId)}</dd>
                  </div>
                  <div>
                    <dt>Deploy date</dt>
                    <dd>{formatDate(detailToken.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Registry</dt>
                    <dd>{detailRegistryLabel}</dd>
                  </div>
                  <div>
                    <dt>Pending mints</dt>
                    <dd>{detailPendingMintCount.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Limit per mint</dt>
                    <dd>
                      {detailToken.mintAmount.toLocaleString()}{" "}
                      {detailToken.ticker}
                    </dd>
                  </div>
                  <div>
                    <dt>Starting price</dt>
                    <dd>
                      {tokenSatsPerUnit(detailPricePerToken)} sat /{" "}
                      {detailToken.ticker}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>

            <div className="id-launch-grid">
              <section className="id-launch-card">
                <div className="id-card-head">
                  <div className="empty-icon" aria-hidden="true">
                    <Users size={24} />
                  </div>
                  <div>
                    <h3>Top holders</h3>
                    <p>Confirmed balances for {detailToken.ticker}.</p>
                  </div>
                </div>
                {renderHolderSearch(
                  detailVisibleHolders.length,
                  detailMatchingHolders.length,
                  detailHolders.length,
                )}
                {renderHolderList(detailToken, detailVisibleHolders)}
                <PaginationControls
                  label="Holders"
                  onPageChange={setHolderPageIndex}
                  page={detailHolderPage}
                />
              </section>

              <section className="id-launch-card">
                <div className="id-card-head">
                  <div className="empty-icon" aria-hidden="true">
                    <Clock size={24} />
                  </div>
                  <div>
                    <h3>Mint log</h3>
                    <p>
                      Sorted by confirmation date. Pending records stay visible.
                    </p>
                  </div>
                </div>
                {renderMintSearch(
                  detailVisibleMints.length,
                  detailMintMatchingCount,
                  detailMintTotalCount,
                )}
                {renderMintList(detailVisibleMints, remoteMintPageLoading)}
                <PaginationControls
                  label="Mints"
                  onPageChange={setMintPageIndex}
                  page={detailMintPage}
                />
              </section>
            </div>
          </>
        ) : (
          <section className="id-launch-card token-detail-empty">
            <div className="empty-icon" aria-hidden="true">
              <FileText size={24} />
            </div>
            <h2>{normalizeTokenTicker(tokenDetailTarget) || "Token"} not live yet</h2>
            <p>
              Create the token first. Once the creation transaction confirms,
              this page becomes the token dashboard.
            </p>
          </section>
        )}
      </section>
    );
  }

  return (
    <section className={workspaceClassName}>
      <div className="token-registry-strip">
        <div>
          <span>Token index</span>
          <strong>{TOKEN_INDEX_ID}</strong>
          <p>Creation records and token ids.</p>
        </div>
        <div>
          <span>Selected registry</span>
          <strong>{selectedRegistryLabel}</strong>
          <p>Mint payments go to the creator registry.</p>
        </div>
        <div>
          <span>Mint rule</span>
          <strong>
            {selectedToken
              ? `${selectedToken.mintAmount.toLocaleString()} ${selectedToken.ticker}`
              : "Owner priced"}
          </strong>
          <p>Every token keeps its own mint lane.</p>
        </div>
      </div>
      <div className="id-launch-hero">
        <section className="id-launch-card id-claim-card token-create-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <FilePenLine size={24} />
            </div>
            <div>
              <h2>Create token</h2>
              <p>
                Pay the creation fee to <code>{TOKEN_INDEX_ID}</code>. Mints
                route to the token registry you choose.
              </p>
            </div>
          </div>

          <form className="id-form" onSubmit={createToken}>
            <div className="token-form-grid">
              <label>
                Ticker
                <input
                  maxLength={12}
                  onChange={(event) => setCreateTicker(event.target.value)}
                  placeholder={TOKEN_TEMPLATE_TICKER}
                  value={createTicker}
                />
                {createTickerReservationMessage ? (
                  <span className="field-note bad">
                    {createTickerReservationMessage}
                  </span>
                ) : null}
              </label>
              <label>
                Max supply
                <input
                  min={1}
                  onChange={(event) =>
                    setCreateMaxSupply(Number(event.target.value))
                  }
                  placeholder={String(WORK_TOKEN_MAX_SUPPLY)}
                  type="number"
                  value={createMaxSupply || ""}
                />
              </label>
              <label>
                Mint amount
                <input
                  min={1}
                  onChange={(event) =>
                    setCreateMintAmount(Number(event.target.value))
                  }
                  placeholder={String(WORK_TOKEN_MINT_AMOUNT)}
                  type="number"
                  value={createMintAmount || ""}
                />
              </label>
              <label>
                Mint price sats
                <input
                  min={TOKEN_MIN_MUTATION_PRICE_SATS}
                  onChange={(event) =>
                    setCreateMintPriceSats(Number(event.target.value))
                  }
                  placeholder={String(WORK_TOKEN_MINT_PRICE_SATS)}
                  type="number"
                  value={createMintPriceSats || ""}
                />
              </label>
              <label className="wide">
                Token registry
                <input
                  onChange={(event) =>
                    setCreateRegistryAddress(event.target.value)
                  }
                  placeholder="your-id@proofofwork.me or Bitcoin address"
                  value={createRegistryAddress}
                />
                {createRegistryNote ? (
                  <span
                    className={
                      createRegistryResolution.error
                        ? "field-note bad"
                        : "field-note good"
                    }
                  >
                    {createRegistryNote}
                  </span>
                ) : null}
              </label>
              <label>
                Fee rate
                <input
                  min={0.1}
                  onChange={(event) => setFeeRate(Number(event.target.value))}
                  step={0.1}
                  type="number"
                  value={feeRate}
                />
              </label>
            </div>
            <div className="token-template-action">
              <button
                className="secondary small"
                onClick={applyTokenTemplate}
                type="button"
              >
                <span className="button-content">
                  <FilePenLine size={15} />
                  <span>Use 21M template</span>
                </span>
              </button>
            </div>
            <div className="id-launch-stats" aria-label="Token create preview">
              <div>
                <span>Create fee</span>
                <strong>{TOKEN_CREATION_PRICE_SATS.toLocaleString()} sats</strong>
              </div>
              <div>
                <span>Minimum mint</span>
                <strong>
                  {TOKEN_MIN_MUTATION_PRICE_SATS.toLocaleString()} sats
                </strong>
              </div>
              <div>
                <span>Launch price</span>
                <strong>
                  {tokenSatsPerUnit(createPricePerToken)} sat /{" "}
                  {createTickerLabel}
                </strong>
              </div>
              <div>
                <span>USD/token</span>
                <strong>{tokenUsd(createUnitUsd)}</strong>
              </div>
            </div>
            {createHasMintPreview ? (
              <p className="field-note">
                {createMintAmount.toLocaleString()} {createTickerLabel} for{" "}
                {createMintPriceSats.toLocaleString()} sats ={" "}
                {tokenSatsPerUnit(createPricePerToken)} sat / {createTickerLabel}{" "}
                ({tokenUsd(createMintUsd)} per mint). Paid to{" "}
                {createRegistryResolution.paymentAddress
                  ? shortAddress(createRegistryResolution.paymentAddress)
                  : "the token registry"} on each mint.
              </p>
            ) : (
              <p className="field-note">
                Enter a ticker and your own registry. WORK is already reserved
                for the canonical WORK token.
              </p>
            )}
            <div className="token-action-footer">
              <div
                className={
                  createBytes > MAX_DATA_CARRIER_BYTES
                    ? "counter bad"
                    : "counter"
                }
              >
                {createBytes.toLocaleString()} /{" "}
                {MAX_DATA_CARRIER_BYTES.toLocaleString()} OP_RETURN data-carrier
                bytes
              </div>
              <button className="primary" disabled={!canCreate} type="submit">
                <span className="button-content">
                  <Send size={16} />
                  <span>{creatingToken ? "Creating" : "Create Token"}</span>
                </span>
              </button>
              {!address ? (
                <p className="field-note">Connect UniSat to create a token.</p>
              ) : null}
            </div>
          </form>
        </section>

        <section className="id-launch-card id-claim-card token-mint-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <Wallet size={24} />
            </div>
            <div>
              <h2>Mint token</h2>
              <p>
                Mints pay the token registry directly. ProofOfWork only charges
                the creation event.
              </p>
            </div>
          </div>

          <form className="id-form" onSubmit={submitMint}>
            <div className="token-form-grid token-mint-grid">
              <label className="wide">
                Token
                <select
                  onChange={(event) => setSelectedTokenId(event.target.value)}
                  value={selectedTokenId}
                >
                  {tokens.length === 0 ? (
                    <option value="">No tokens created yet</option>
                  ) : null}
                  {tokens.map((token) => (
                    <option key={token.tokenId} value={token.tokenId}>
                      {token.ticker} - {shortAddress(token.tokenId)} -{" "}
                      {token.confirmed ? "confirmed" : "pending"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Amount
                <input
                  readOnly
                  type="number"
                  value={selectedToken?.mintAmount ?? 0}
                />
              </label>
            </div>
            <div className="id-launch-stats" aria-label="Mint preview">
              <div>
                <span>Mint price</span>
                <strong>
                  {(selectedToken?.mintPriceSats ?? 0).toLocaleString()} sats
                </strong>
              </div>
              <div>
                <span>Amount</span>
                <strong>
                  {(selectedToken?.mintAmount ?? 0).toLocaleString()}{" "}
                  {selectedToken?.ticker ?? ""}
                </strong>
              </div>
              <div>
                <span>Price</span>
                <strong>
                  {tokenSatsPerUnit(selectedPricePerToken)} sat /{" "}
                  {selectedToken?.ticker ?? "TOKEN"}
                </strong>
              </div>
              <div>
                <span>USD/token</span>
                <strong>{tokenUsd(selectedUnitUsd)}</strong>
              </div>
            </div>
            {selectedToken ? (
              <div className="token-progress-mini">
                <div>
                  <span>Selected progress</span>
                  <strong>
                    {tokenProgressLabel(confirmedSupply, selectedToken.maxSupply)}
                  </strong>
                </div>
                <ProgressBar
                  label={`${selectedToken.ticker} selected mint progress`}
                  progress={selectedProgress}
                />
                <p className="field-note">
                  {confirmedSupply.toLocaleString()} confirmed,{" "}
                  {pendingSupply.toLocaleString()} pending.{" "}
                  {selectedConfirmedRemainingSupply.toLocaleString()} confirmed
                  remaining; {selectedAvailableSupply.toLocaleString()} available
                  after pending.
                </p>
              </div>
            ) : null}
            <p className="field-note">
              {(selectedToken?.mintAmount ?? 0).toLocaleString()}{" "}
              {selectedToken?.ticker ?? "TOKEN"} for{" "}
              {(selectedToken?.mintPriceSats ?? 0).toLocaleString()} sats ={" "}
              {tokenSatsPerUnit(selectedPricePerToken)} sat /{" "}
              {selectedToken?.ticker ?? "TOKEN"} ({tokenUsd(selectedMintUsd)} per
              mint). Paid to{" "}
              {selectedToken
                ? shortAddress(selectedToken.registryAddress)
                : "the token registry"}{" "}
              on each mint. Your confirmed balance is {holderBalance.toLocaleString()}{" "}
              {selectedToken?.ticker ?? ""}.
            </p>
            <FeeRateControl feeRate={feeRate} setFeeRate={setFeeRate} />
            <div className="token-action-footer">
              <div
                className={
                  mintBytes > MAX_DATA_CARRIER_BYTES ? "counter bad" : "counter"
                }
              >
                {mintBytes.toLocaleString()} /{" "}
                {MAX_DATA_CARRIER_BYTES.toLocaleString()} OP_RETURN data-carrier
                bytes
              </div>
              <button className="primary" disabled={!canMint} type="submit">
                <span className="button-content">
                  <Send size={16} />
                  <span>{selectedMintButtonLabel}</span>
                </span>
              </button>
              {!selectedToken ? (
                <p className="field-note">
                  Create or load a token before minting.
                </p>
              ) : selectedMintBlockedNote ? (
                <p className="field-note bad">{selectedMintBlockedNote}</p>
              ) : null}
            </div>
          </form>
          {renderMintAssistant(selectedToken)}
          {renderMintUtxoPrep(selectedToken)}
        </section>
      </div>

      <div className="id-launch-stats" aria-label="Token stats">
        <div>
          <strong>{tokens.length.toLocaleString()}</strong>
          <span>Created tokens</span>
        </div>
        <div>
          <strong>{confirmedTokenCount.toLocaleString()}</strong>
          <span>Confirmed tokens</span>
        </div>
        <div>
          <strong>{pendingTokenCount.toLocaleString()}</strong>
          <span>Pending tokens</span>
        </div>
        <div>
          <strong>{creationSats.toLocaleString()}</strong>
          <span>Creation sats</span>
        </div>
      </div>

      {selectedToken ? (
        <div className="id-launch-grid token-selected-ledger">
          <section className="id-launch-card">
            <div className="id-card-head">
              <div className="empty-icon" aria-hidden="true">
                <Users size={24} />
              </div>
              <div>
                <h3>{selectedToken.ticker} holders</h3>
                <p>Paged confirmed balances. Search to verify an address.</p>
              </div>
            </div>
            {renderHolderSearch(
              selectedVisibleHolders.length,
              selectedMatchingHolders.length,
              holders.length,
            )}
            {renderHolderList(selectedToken, selectedVisibleHolders)}
            <PaginationControls
              label="Holders"
              onPageChange={setHolderPageIndex}
              page={selectedHolderPage}
            />
          </section>

          <section className="id-launch-card">
            <div className="id-card-head">
              <div className="empty-icon" aria-hidden="true">
                <Clock size={24} />
              </div>
              <div>
                <h3>{selectedToken.ticker} mints</h3>
                <p>Paged mint history. Pending records stay visible.</p>
              </div>
            </div>
            {renderMintSearch(
              selectedVisibleMints.length,
              selectedMintMatchingCount,
              selectedMintTotalCount,
            )}
            {renderMintList(selectedVisibleMints, remoteMintPageLoading)}
            <PaginationControls
              label="Mints"
              onPageChange={setMintPageIndex}
              page={selectedMintPage}
            />
          </section>
        </div>
      ) : null}

      <div className="id-launch-grid">
        <section className="id-launch-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <TrendingUp size={24} />
            </div>
            <div>
              <h3>Token index</h3>
              <p>
                Creation fees go to {TOKEN_INDEX_ID}. Mints and mutations pay
                each token registry at the owner-set price.
              </p>
            </div>
          </div>
          <dl className="browser-meta">
            <div>
              <dt>Index ID</dt>
              <dd>{TOKEN_INDEX_ID}</dd>
            </div>
            <div>
              <dt>Index address</dt>
              <dd>{tokenIndexAddress}</dd>
            </div>
            <div>
              <dt>Creation sats</dt>
              <dd>{creationSats.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Creation tx</dt>
              <dd>{shortAddress(TOKEN_INDEX_TXID)}</dd>
            </div>
            <div>
              <dt>BTC/USD</dt>
              <dd>{tokenUsd(btcUsd)}</dd>
            </div>
          </dl>
          <div className="id-record-actions">
            <button className="secondary small" onClick={onRefresh} type="button">
              <span className="button-content">
                <RefreshCw size={15} />
                <span>Refresh</span>
              </span>
            </button>
            <a
              className="secondary small"
              href={explorerAddressUrl(tokenIndexAddress, "livenet")}
              rel="noreferrer"
              target="_blank"
            >
              <span className="button-content">
                <ArrowUpRight size={15} />
                <span>Index</span>
              </span>
            </a>
            <a
              className="secondary small"
              href={explorerTxUrl(TOKEN_INDEX_TXID, "livenet")}
              rel="noreferrer"
              target="_blank"
            >
              <span className="button-content">
                <ArrowUpRight size={15} />
                <span>TX</span>
              </span>
            </a>
            <a
              className="secondary small"
              href={appHref(WORK_TOKEN_APP_URL, LOCAL_WORK_TOKEN_APP_URL)}
            >
              <span className="button-content">
                <TrendingUp size={15} />
                <span>WORK</span>
              </span>
            </a>
          </div>
        </section>

        <section className="id-launch-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <FileText size={24} />
            </div>
            <div>
              <h3>Created tokens</h3>
              <p>Sorted by confirmation date. Pending creations stay visible.</p>
            </div>
          </div>
          <div className="id-record-list">
            {tokens.length === 0 ? (
              <div className="empty-state">
                <h3>No tokens yet</h3>
                <p>Create WORK first, then mint against its token id.</p>
              </div>
            ) : (
              tokenDefinitionPage.items.map((token) => {
                const stats = tokenStatsById.get(token.tokenId) ?? {
                  confirmedMints: 0,
                  confirmedSupply: 0,
                  pendingMints: 0,
                  pendingSupply: 0,
                };
                const rowProgress = tokenProgressPercent(
                  stats.confirmedSupply,
                  token.maxSupply,
                );
                const rowPrice =
                  token.mintAmount > 0
                    ? token.mintPriceSats / token.mintAmount
                    : 0;

                return (
                  <article
                    className="id-record token-record"
                    key={token.tokenId}
                  >
                    <div>
                      <div className="token-record-top">
                        <strong>{token.ticker}</strong>
                        <span>{token.confirmed ? "Confirmed" : "Pending"}</span>
                      </div>
                      <p className="token-record-price">
                        {token.mintAmount.toLocaleString()} for{" "}
                        {token.mintPriceSats.toLocaleString()} sats -{" "}
                        {tokenSatsPerUnit(rowPrice)} sat / {token.ticker}
                      </p>
                      <code>{shortAddress(token.tokenId)}</code>
                      <div className="token-record-meter">
                        <ProgressBar
                          label={`${token.ticker} row mint progress`}
                          progress={rowProgress}
                        />
                      </div>
                      <p className="field-note">
                        {stats.confirmedSupply.toLocaleString()} /{" "}
                        {token.maxSupply.toLocaleString()} minted - registry{" "}
                        {shortAddress(token.registryAddress)} -{" "}
                        {formatDate(token.createdAt)}
                      </p>
                    </div>
                    <div className="id-record-actions">
                      <button
                        className="secondary small"
                        onClick={() => setSelectedTokenId(token.tokenId)}
                        type="button"
                      >
                        Select
                      </button>
                      <button
                        className="secondary small"
                        onClick={() => openTokenDetail(token)}
                        type="button"
                      >
                        Details
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
          <PaginationControls
            label="Tokens"
            onPageChange={setTokenIndexPageIndex}
            page={tokenDefinitionPage}
          />
        </section>
      </div>
    </section>
  );
}

const GROWTH_MODEL_CHART_YEARS = 10;
const GROWTH_MODEL_START_MS = Date.parse(
  `${GROWTH_MODEL_START_DATE}T00:00:00.000Z`,
);
const MS_PER_MODEL_YEAR = 365 * 24 * 60 * 60 * 1000;

function growthElapsedYears() {
  return Math.max(0, (Date.now() - GROWTH_MODEL_START_MS) / MS_PER_MODEL_YEAR);
}

function growthCompactNumber(value: number, decimals = 0) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  const units = [
    { label: "T", size: 1_000_000_000_000 },
    { label: "B", size: 1_000_000_000 },
    { label: "M", size: 1_000_000 },
    { label: "K", size: 1_000 },
  ];
  const unit = units.find((item) => Math.abs(value) >= item.size);
  if (!unit) {
    return Math.round(value).toLocaleString();
  }

  const scaled = value / unit.size;
  const digits =
    scaled >= 100
      ? 0
      : scaled >= 10
        ? Math.min(1, decimals + 1)
        : Math.min(2, decimals + 1);
  return `${scaled.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/u, "$1")}${unit.label}`;
}

function growthSats(value: number) {
  return `${growthCompactNumber(value)} sats`;
}

function growthUsd(value: number) {
  if (!Number.isFinite(value)) {
    return "$0";
  }

  const units = [
    { label: "T", size: 1_000_000_000_000 },
    { label: "B", size: 1_000_000_000 },
    { label: "M", size: 1_000_000 },
    { label: "K", size: 1_000 },
  ];
  const unit = units.find((item) => Math.abs(value) >= item.size);
  if (!unit) {
    return `$${Math.round(value).toLocaleString()}`;
  }

  const scaled = value / unit.size;
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `$${scaled.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/u, "$1")}${unit.label}`;
}

function growthPercent(value: number) {
  return `${Math.round(value * 100).toLocaleString()}%`;
}

function isBrowserActivityItem(item: PowActivityItem) {
  const searchText = [item.title, item.detail, item.description, ...item.tags]
    .join(" ")
    .toLowerCase();
  const hasHtmlAttachment =
    searchText.includes("text/html") ||
    searchText.includes("application/xhtml+xml") ||
    /\.x?html?\b/u.test(searchText);
  const hasHtmlBody =
    item.tags.some((tag) => tag.toLowerCase() === "html body") ||
    isBrowserHtmlMessageBody(item.detail ?? "");

  return item.kind === "file"
    ? hasHtmlAttachment
    : item.kind === "mail" || item.kind === "reply"
      ? hasHtmlBody
      : false;
}

function activityAmountSats(item: PowActivityItem) {
  const amount = Number(item.amountSats ?? 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function activityKindHasDedicatedGrowthBucket(item: PowActivityItem) {
  if (isBrowserActivityItem(item)) {
    return true;
  }

  return (
    item.kind === "mail" ||
    item.kind === "reply" ||
    item.kind === "file" ||
    item.kind === "token-create" ||
    item.kind === "token-mint" ||
    item.kind === "token-transfer" ||
    item.kind === "token-sale"
  );
}

function unbucketedConfirmedComputerLogFlowSats(
  confirmedActivity: PowActivityItem[],
) {
  return confirmedActivity
    .filter((item) => !activityKindHasDedicatedGrowthBucket(item))
    .reduce((total, item) => total + activityAmountSats(item), 0);
}

function growthActualNetworkValue(
  records: PowIdRecord[],
  idActivity: PowActivityItem[],
  sales: PowIdMarketplaceSale[],
  tokenDefinitions: PowTokenDefinition[],
  tokenMints: PowTokenMint[],
  tokenTransfers: PowTokenTransfer[] = [],
  tokenSales: PowTokenSale[] = [],
  cutoffMs = Date.now(),
): GrowthActualNetworkValue {
  const confirmedRecords = records.filter(
    (record) => record.confirmed && Date.parse(record.createdAt) <= cutoffMs,
  );
  const confirmedActivity = idActivity.filter(
    (item) => item.confirmed && Date.parse(item.createdAt) <= cutoffMs,
  );
  const confirmedSales = publicMarketplaceSales(sales).filter(
    (sale) => sale.confirmed && Date.parse(sale.createdAt) <= cutoffMs,
  );
  const confirmedTokens = tokenDefinitions.filter(
    (token) => token.confirmed && Date.parse(token.createdAt) <= cutoffMs,
  );
  const confirmedTokenMints = tokenMints.filter(
    (mint) => mint.confirmed && Date.parse(mint.createdAt) <= cutoffMs,
  );
  const confirmedTokenTransfers = tokenTransfers.filter(
    (transfer) =>
      transfer.confirmed && Date.parse(transfer.createdAt) <= cutoffMs,
  );
  const confirmedTokenSales = tokenSales.filter(
    (sale) => sale.confirmed && Date.parse(sale.createdAt) <= cutoffMs,
  );
  const powids = confirmedRecords.length;
  const mailFlowSats = confirmedActivity
    .filter(
      (item) =>
        (item.kind === "mail" || item.kind === "reply") &&
        !isBrowserActivityItem(item),
    )
    .reduce((total, item) => total + (item.amountSats ?? 0), 0);
  const browserFlowSats = confirmedActivity
    .filter(isBrowserActivityItem)
    .reduce((total, item) => total + (item.amountSats ?? 0), 0);
  const driveFlowSats = confirmedActivity
    .filter((item) => item.kind === "file" && !isBrowserActivityItem(item))
    .reduce((total, item) => total + (item.amountSats ?? 0), 0);
  const idMarketplaceVolumeSats = confirmedSales.reduce(
    (total, sale) => total + sale.priceSats,
    0,
  );
  const tokenSaleFlowSats = confirmedTokenSales.reduce(
    (total, sale) => total + sale.priceSats,
    0,
  );
  const marketplaceVolumeSats = idMarketplaceVolumeSats + tokenSaleFlowSats;
  const tokenCreationFlowSats = confirmedTokens.reduce(
    (total, token) => total + token.creationFeeSats,
    0,
  );
  const tokenMintFlowSats = confirmedTokenMints.reduce(
    (total, mint) => total + mint.paidSats,
    0,
  );
  const tokenTransferFlowSats = confirmedTokenTransfers.reduce(
    (total, transfer) => total + transfer.paidSats,
    0,
  );
  const walletFlowSats = tokenTransferFlowSats;
  const computerEventFlowSats =
    unbucketedConfirmedComputerLogFlowSats(confirmedActivity);
  const idSats = powids ** 2 * GROWTH_MODEL_INPUTS.idDensitySatsPerN2;
  const mailSats = mailFlowSats * GROWTH_MODEL_INPUTS.valueMultiple;
  const driveSats = driveFlowSats * GROWTH_MODEL_INPUTS.valueMultiple;
  const marketplaceSats =
    marketplaceVolumeSats * GROWTH_MODEL_INPUTS.valueMultiple;
  const browserSats = browserFlowSats * GROWTH_MODEL_INPUTS.valueMultiple;
  const tokenSats =
    (tokenCreationFlowSats + tokenMintFlowSats) *
    GROWTH_MODEL_INPUTS.valueMultiple;
  const walletSats = walletFlowSats * GROWTH_MODEL_INPUTS.valueMultiple;
  const computerEventSats =
    computerEventFlowSats * GROWTH_MODEL_INPUTS.valueMultiple;
  const totalSats =
    idSats +
    mailSats +
    driveSats +
    marketplaceSats +
    browserSats +
    tokenSats +
    walletSats +
    computerEventSats;
  const years = Math.max(
    0,
    (Math.min(cutoffMs, Date.now()) - GROWTH_MODEL_START_MS) /
      MS_PER_MODEL_YEAR,
  );

  return {
    browserFlowSats,
    browserSats,
    computerEventFlowSats,
    computerEventSats,
    driveFlowSats,
    driveSats,
    mailFlowSats,
    mailSats,
    marketplaceSats,
    marketplaceVolumeSats,
    powids,
    tokenCreationFlowSats,
    tokenMintFlowSats,
    tokenSaleFlowSats,
    tokenTransferFlowSats,
    tokenSats,
    walletFlowSats,
    walletSats,
    totalSats,
    totalUsd: growthSatsToUsdAtYears(totalSats, years),
  };
}

function compactGrowthEventTimes(
  eventTimes: Array<{ createdMs: number; label: string }>,
) {
  const sorted = [...eventTimes].sort(
    (left, right) => left.createdMs - right.createdMs,
  );
  if (sorted.length <= MAX_GROWTH_ACTUAL_CHART_EVENTS) {
    return sorted;
  }

  const indexes = new Set<number>([0, sorted.length - 1]);
  for (let index = 0; index < MAX_GROWTH_ACTUAL_CHART_EVENTS; index += 1) {
    indexes.add(
      Math.round(
        (index * (sorted.length - 1)) /
          Math.max(1, MAX_GROWTH_ACTUAL_CHART_EVENTS - 1),
      ),
    );
  }

  return [...indexes]
    .sort((left, right) => left - right)
    .map((index) => sorted[index])
    .filter((item): item is { createdMs: number; label: string } =>
      Boolean(item),
    );
}

function growthActualValuePoints(
  records: PowIdRecord[],
  idActivity: PowActivityItem[],
  sales: PowIdMarketplaceSale[],
  tokenDefinitions: PowTokenDefinition[],
  tokenMints: PowTokenMint[],
  tokenTransfers: PowTokenTransfer[] = [],
  tokenSales: PowTokenSale[] = [],
  options?: { startLabel?: string; startMs?: number },
): GrowthValuePoint[] {
  const startMs = Math.max(
    options?.startMs ?? GROWTH_MODEL_START_MS,
    GROWTH_MODEL_START_MS,
  );
  const startYears = Math.max(
    0,
    (startMs - GROWTH_MODEL_START_MS) / MS_PER_MODEL_YEAR,
  );
  const eventTimes: Array<{ createdMs: number; label: string }> = [];
  const addEventTime = (createdAt: string, label: string) => {
    const createdMs = Date.parse(createdAt);
    if (Number.isFinite(createdMs) && createdMs >= startMs) {
      eventTimes.push({ createdMs, label });
    }
  };

  for (const record of records) {
    if (record.confirmed) {
      addEventTime(record.createdAt, `${record.id}@proofofwork.me`);
    }
  }

  for (const item of idActivity) {
    if (item.confirmed) {
      addEventTime(item.createdAt, item.title);
    }
  }

  for (const sale of publicMarketplaceSales(sales)) {
    if (sale.confirmed) {
      addEventTime(sale.createdAt, `${sale.id}@proofofwork.me sale`);
    }
  }

  for (const token of tokenDefinitions) {
    if (token.confirmed) {
      addEventTime(token.createdAt, `${token.ticker} token created`);
    }
  }

  for (const mint of tokenMints) {
    if (mint.confirmed) {
      addEventTime(mint.createdAt, `${mint.ticker} token mint`);
    }
  }

  for (const transfer of tokenTransfers) {
    if (transfer.confirmed) {
      addEventTime(transfer.createdAt, `${transfer.ticker} token transfer`);
    }
  }

  for (const sale of tokenSales) {
    if (sale.confirmed) {
      addEventTime(sale.createdAt, `${sale.ticker} token sale`);
    }
  }

  const points: GrowthValuePoint[] = [];
  const startValue = growthActualNetworkValue(
    records,
    idActivity,
    sales,
    tokenDefinitions,
    tokenMints,
    tokenTransfers,
    tokenSales,
    startMs,
  );
  points.push({
    label: options?.startLabel ?? "Model start",
    sats: startValue.totalSats,
    usd: growthSatsToUsdAtYears(startValue.totalSats, startYears),
    years: startYears,
  });

  for (const { createdMs, label } of compactGrowthEventTimes(eventTimes)) {
    const value = growthActualNetworkValue(
      records,
      idActivity,
      sales,
      tokenDefinitions,
      tokenMints,
      tokenTransfers,
      tokenSales,
      createdMs,
    );
    points.push({
      label,
      sats: value.totalSats,
      usd: growthSatsToUsdAtYears(
        value.totalSats,
        Math.max(0, (createdMs - GROWTH_MODEL_START_MS) / MS_PER_MODEL_YEAR),
      ),
      years: Math.max(
        0,
        (createdMs - GROWTH_MODEL_START_MS) / MS_PER_MODEL_YEAR,
      ),
    });
  }

  const elapsed = growthElapsedYears();
  const nowValue = growthActualNetworkValue(
    records,
    idActivity,
    sales,
    tokenDefinitions,
    tokenMints,
    tokenTransfers,
    tokenSales,
  );
  const lastPoint = points[points.length - 1];
  if (
    !lastPoint ||
    lastPoint.sats !== nowValue.totalSats ||
    lastPoint.years < elapsed
  ) {
    points.push({
      label: "Real now",
      sats: nowValue.totalSats,
      usd: nowValue.totalUsd,
      years: elapsed,
    });
  }

  return points;
}

function growthModelValueAtYears(years: number): GrowthValuePoint {
  const rows = GROWTH_MODEL_CHART_ROWS;
  const clampedYears = Math.max(0, Math.min(GROWTH_MODEL_CHART_YEARS, years));
  const before =
    [...rows].reverse().find((row) => row.years <= clampedYears) ?? rows[0];
  const after =
    rows.find((row) => row.years >= clampedYears) ?? rows[rows.length - 1];
  if (!before || !after || before.years === after.years) {
    const row = before ?? after ?? growthModelStartRow();
    return {
      label: row.label,
      sats: row.totalSats,
      usd: growthSatsToUsdAtYears(row.totalSats, clampedYears),
      years: clampedYears,
    };
  }

  const ratio = (clampedYears - before.years) / (after.years - before.years);
  const beforeLog = Math.log(Math.max(1, before.totalSats));
  const afterLog = Math.log(Math.max(1, after.totalSats));
  const sats = Math.exp(beforeLog + (afterLog - beforeLog) * ratio);
  return {
    label: "Model now",
    sats,
    usd: growthSatsToUsdAtYears(sats, clampedYears),
    years: clampedYears,
  };
}

function growthEventTimeLabel(createdAt: string) {
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) {
    return "Confirmed";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(createdMs);
}

function growthActivityKindLabel(kind: PowActivityKind) {
  if (
    kind === "id-register" ||
    kind === "id-update" ||
    kind === "id-transfer"
  ) {
    return "ID";
  }

  if (
    kind === "id-list" ||
    kind === "id-seal" ||
    kind === "id-delist" ||
    kind === "id-buy"
  ) {
    return "Marketplace";
  }

  if (kind === "file") {
    return "Drive";
  }

  if (kind === "token-transfer") {
    return "Wallet";
  }

  if (
    kind === "token-create" ||
    kind === "token-mint" ||
    kind === "token-listing" ||
    kind === "token-listing-closed" ||
    kind === "token-sale"
  ) {
    return "Token";
  }

  return kind === "reply" ? "Mail reply" : "Mail";
}

function confirmedComputerActionCount(
  records: PowIdRecord[],
  idActivity: PowActivityItem[],
  tokenDefinitions: PowTokenDefinition[],
  tokenMints: PowTokenMint[],
  tokenTransfers: PowTokenTransfer[] = [],
  tokenSales: PowTokenSale[] = [],
) {
  const txids = new Set<string>();
  const add = (confirmed: boolean, txid: string) => {
    if (confirmed && txid) {
      txids.add(txid);
    }
  };

  records.forEach((record) => add(record.confirmed, record.txid));
  idActivity.forEach((item) => add(item.confirmed, item.txid));
  tokenDefinitions.forEach((token) => add(token.confirmed, token.txid));
  tokenMints.forEach((mint) => add(mint.confirmed, mint.txid));
  tokenTransfers.forEach((transfer) => add(transfer.confirmed, transfer.txid));
  tokenSales.forEach((sale) => add(sale.confirmed, sale.txid));

  return txids.size;
}

function growthRealEventItems(
  records: PowIdRecord[],
  idActivity: PowActivityItem[],
  sales: PowIdMarketplaceSale[],
  tokenDefinitions: PowTokenDefinition[],
  tokenMints: PowTokenMint[],
  tokenTransfers: PowTokenTransfer[] = [],
  tokenSales: PowTokenSale[] = [],
): GrowthRealEvent[] {
  const events = new Map<string, GrowthRealEvent>();
  const setEvent = (event: GrowthRealEvent) => {
    events.set(event.key, event);
  };

  for (const record of records) {
    if (!record.confirmed) {
      continue;
    }

    setEvent({
      amountLabel: `${record.amountSats.toLocaleString()} sats`,
      createdAt: record.createdAt,
      detail: `${record.id}@proofofwork.me joined the confirmed ID graph.`,
      key: record.txid,
      kind: "ID",
      network: record.network,
      title: "ID registered",
      txid: record.txid,
    });
  }

  for (const item of idActivity) {
    if (!item.confirmed) {
      continue;
    }

    setEvent({
      amountLabel: item.amountSats
        ? `${item.amountSats.toLocaleString()} sats`
        : "Confirmed",
      createdAt: item.createdAt,
      detail: item.detail || item.description,
      key: item.txid,
      kind: isBrowserActivityItem(item)
        ? "Browser"
        : growthActivityKindLabel(item.kind),
      network: item.network,
      title: item.id ? `${item.title}: ${item.id}@proofofwork.me` : item.title,
      txid: item.txid,
    });
  }

  for (const sale of publicMarketplaceSales(sales)) {
    if (!sale.confirmed) {
      continue;
    }

    setEvent({
      amountLabel: `${sale.priceSats.toLocaleString()} sale sats`,
      createdAt: sale.createdAt,
      detail: `${sale.id}@proofofwork.me transferred from ${shortAddress(sale.sellerAddress)} to ${shortAddress(sale.buyerAddress)}.`,
      key: sale.txid,
      kind: "Marketplace",
      network: sale.network,
      title: "Marketplace sale",
      txid: sale.txid,
    });
  }

  for (const token of tokenDefinitions) {
    if (!token.confirmed) {
      continue;
    }

    setEvent({
      amountLabel: `${token.creationFeeSats.toLocaleString()} creation sats`,
      createdAt: token.createdAt,
      detail: `${token.ticker} created with ${token.maxSupply.toLocaleString()} max supply and registry ${shortAddress(token.registryAddress)}.`,
      key: token.txid,
      kind: "Token",
      network: token.network,
      title: "Token created",
      txid: token.txid,
    });
  }

  for (const mint of tokenMints) {
    if (!mint.confirmed) {
      continue;
    }

    setEvent({
      amountLabel: `${mint.paidSats.toLocaleString()} mint sats`,
      createdAt: mint.createdAt,
      detail: `${mint.amount.toLocaleString()} ${mint.ticker} minted by ${shortAddress(mint.minterAddress)}.`,
      key: mint.txid,
      kind: "Token",
      network: mint.network,
      title: "Token mint",
      txid: mint.txid,
    });
  }

  for (const transfer of tokenTransfers) {
    if (!transfer.confirmed) {
      continue;
    }

    setEvent({
      amountLabel: `${transfer.paidSats.toLocaleString()} registry sats`,
      createdAt: transfer.createdAt,
      detail: `${transfer.amount.toLocaleString()} ${transfer.ticker} moved from ${shortAddress(transfer.senderAddress)} to ${shortAddress(transfer.recipientAddress)}.`,
      key: transfer.txid,
      kind: "Wallet",
      network: transfer.network,
      title: "Wallet transfer",
      txid: transfer.txid,
    });
  }

  for (const sale of tokenSales) {
    if (!sale.confirmed) {
      continue;
    }

    setEvent({
      amountLabel: `${sale.priceSats.toLocaleString()} sale sats`,
      createdAt: sale.createdAt,
      detail: `${sale.amount.toLocaleString()} ${sale.ticker} bought by ${shortAddress(sale.buyerAddress)} from ${shortAddress(sale.sellerAddress)}.`,
      key: sale.txid,
      kind: "Marketplace",
      network: sale.network,
      title: "Token sale",
      txid: sale.txid,
    });
  }

  return [...events.values()].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}

function growthChartPath(
  points: Array<{ sats: number; years: number }>,
  xFor: (years: number) => number,
  yFor: (value: number) => number,
) {
  return points
    .map(
      (point) =>
        `${xFor(point.years).toFixed(2)},${yFor(point.sats).toFixed(2)}`,
    )
    .join(" ");
}

function GrowthLineChart({
  actualPoints,
}: {
  actualPoints: GrowthValuePoint[];
}) {
  const width = 920;
  const height = 390;
  const padLeft = 72;
  const padRight = 28;
  const padTop = 24;
  const padBottom = 52;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const modelPoints = GROWTH_MODEL_CHART_ROWS.filter(
    (row) => row.years <= GROWTH_MODEL_CHART_YEARS,
  ).map((row) => ({
    label: row.label,
    sats: row.totalSats,
    usd: row.totalUsdBase,
    years: row.years,
  }));
  const visibleActualPoints = actualPoints.map((point) => ({
    ...point,
    years: Math.min(GROWTH_MODEL_CHART_YEARS, point.years),
  }));
  const yValues = [
    ...modelPoints.map((row) => row.sats),
    ...visibleActualPoints.map((point) => point.sats),
  ].filter((value) => value > 0);
  const yMin = Math.max(1, Math.floor(Math.min(...yValues) * 0.72));
  const yMax = Math.max(10_000_000, Math.ceil(Math.max(...yValues) * 1.2));
  const logMin = Math.log10(yMin);
  const logMax = Math.log10(yMax);
  const xFor = (years: number) =>
    padLeft +
    (Math.max(0, Math.min(GROWTH_MODEL_CHART_YEARS, years)) /
      GROWTH_MODEL_CHART_YEARS) *
      plotWidth;
  const yFor = (value: number) =>
    padTop +
    (1 -
      (Math.log10(Math.max(yMin, value)) - logMin) / (logMax - logMin || 1)) *
      plotHeight;
  const yTicks = Array.from(
    { length: Math.floor(logMax) - Math.floor(logMin) + 1 },
    (_, index) => 10 ** (Math.floor(logMin) + index),
  ).filter((tick) => tick >= yMin && tick <= yMax);
  const xTicks = [0, 1, 2, 5, 10];

  return (
    <svg
      className="growth-chart"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      aria-label="Modeled Bitcoin Computer network value compared with real confirmed network value"
    >
      <rect
        className="growth-chart-bg"
        x="0"
        y="0"
        width={width}
        height={height}
        rx="18"
      />
      {yTicks.map((tick) => (
        <g key={`y-${tick}`}>
          <line
            className="growth-chart-grid"
            x1={padLeft}
            x2={width - padRight}
            y1={yFor(tick)}
            y2={yFor(tick)}
          />
          <text
            className="growth-chart-label"
            x={padLeft - 14}
            y={yFor(tick) + 4}
            textAnchor="end"
          >
            {growthCompactNumber(tick)}
          </text>
        </g>
      ))}
      {xTicks.map((tick) => (
        <g key={`x-${tick}`}>
          <line
            className="growth-chart-grid growth-chart-grid-vertical"
            x1={xFor(tick)}
            x2={xFor(tick)}
            y1={padTop}
            y2={height - padBottom}
          />
          <text
            className="growth-chart-label"
            x={xFor(tick)}
            y={height - 20}
            textAnchor="middle"
          >
            {tick === 0 ? "now" : `${tick}y`}
          </text>
        </g>
      ))}
      <polyline
        className="growth-chart-line model"
        points={growthChartPath(modelPoints, xFor, yFor)}
      />
      <polyline
        className="growth-chart-line actual"
        points={growthChartPath(visibleActualPoints, xFor, yFor)}
      />
      {modelPoints.map((point) => (
        <circle
          className="growth-chart-dot model"
          cx={xFor(point.years)}
          cy={yFor(point.sats)}
          key={`model-${point.label}`}
          r="4.5"
        />
      ))}
      {visibleActualPoints.map((point, index) => (
        <circle
          className="growth-chart-dot actual"
          cx={xFor(point.years)}
          cy={yFor(point.sats)}
          key={`actual-${point.label}-${index}`}
          r={index === visibleActualPoints.length - 1 ? 6 : 4}
        />
      ))}
    </svg>
  );
}

function workFloorChartValue(
  point: WorkFloorPoint,
  btcUsd: number,
  unit: WorkFloorChartUnit,
) {
  return unit === "usd" ? satsToUsd(point.floorSats, btcUsd) : point.floorSats;
}

function workFloorPriceLabel(
  floorSats: number,
  btcUsd: number,
  unit: WorkFloorChartUnit,
) {
  if (unit === "usd") {
    return `${tokenUsd(satsToUsd(floorSats, btcUsd))} / WORK`;
  }

  return `${tokenSatsPerUnit(floorSats)} sats / WORK`;
}

function workFloorAxisPriceLabel(value: number, unit: WorkFloorChartUnit) {
  if (unit === "usd") {
    if (!Number.isFinite(value) || value <= 0) {
      return "$0";
    }

    return value < 0.01 ? `$${value.toFixed(5)}` : tokenUsd(value);
  }

  if (!Number.isFinite(value) || value <= 0) {
    return "0 sats";
  }

  const decimals = value < 10 ? 3 : value < 100 ? 2 : 0;
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  })} sats`;
}

function workFloorPointTimeMs(point: WorkFloorPoint) {
  return GROWTH_MODEL_START_MS + point.years * MS_PER_MODEL_YEAR;
}

function workFloorTimeLabel(point: WorkFloorPoint) {
  const createdMs = workFloorPointTimeMs(point);
  if (!Number.isFinite(createdMs)) {
    return point.label;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(createdMs));
}

function compactWorkFloorChartPoints(points: WorkFloorPoint[]) {
  const compacted: WorkFloorPoint[] = [];
  const sorted = [...points].sort((left, right) => {
    const timeSort = left.years - right.years;
    return timeSort || left.label.localeCompare(right.label);
  });

  for (const point of sorted) {
    const previous = compacted[compacted.length - 1];
    if (
      previous &&
      Math.abs(previous.years - point.years) < 0.000000001 &&
      Math.abs(previous.floorSats - point.floorSats) < 0.000000001
    ) {
      continue;
    }

    compacted.push(point);
  }

  return compacted;
}

function WorkFloorChart({
  btcUsd,
  points,
  unit,
}: {
  btcUsd: number;
  points: WorkFloorPoint[];
  unit: WorkFloorChartUnit;
}) {
  const visiblePoints = compactWorkFloorChartPoints(
    points.filter(
      (point) => Number.isFinite(point.floorSats) && point.floorSats >= 0,
    ),
  );
  if (visiblePoints.length < 2) {
    return null;
  }

  const width = 920;
  const height = 260;
  const padLeft = 92;
  const padRight = 24;
  const padTop = 28;
  const padBottom = 52;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const minYear = Math.min(...visiblePoints.map((point) => point.years));
  const maxYear = Math.max(...visiblePoints.map((point) => point.years));
  const pointValue = (point: WorkFloorPoint) =>
    workFloorChartValue(point, btcUsd, unit);
  const pointValues = visiblePoints.map(pointValue);
  const rawYMin = Math.min(...pointValues);
  const rawYMax = Math.max(...pointValues);
  const rawYRange = rawYMax - rawYMin;
  const fallbackYRange =
    unit === "usd"
      ? Math.max(0.000001, Math.abs(rawYMax) * 0.02)
      : Math.max(0.01, Math.abs(rawYMax) * 0.02);
  const yRange = rawYRange > 0 ? rawYRange : fallbackYRange;
  const yPadding = yRange * 0.22;
  const yMin = Math.max(0, rawYMin - yPadding);
  const yMax = Math.max(rawYMax + yPadding, yMin + fallbackYRange);
  const xRange = Math.max(0.000001, maxYear - minYear);
  const xFor = (years: number) =>
    padLeft + ((years - minYear) / xRange) * plotWidth;
  const yFor = (value: number) =>
    padTop +
    (1 - Math.max(0, Math.min(1, (value - yMin) / (yMax - yMin)))) *
      plotHeight;
  const latestPoint = visiblePoints[visiblePoints.length - 1];
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const xTicks = [
    visiblePoints[0],
    visiblePoints[Math.floor((visiblePoints.length - 1) / 2)],
    latestPoint,
  ].filter((point, index, list) => point && list.indexOf(point) === index);

  return (
    <svg
      className="work-floor-chart"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      aria-label={`Confirmed WORK floor history in ${
        unit === "usd" ? "USD" : "sats"
      } per WORK`}
    >
      <rect
        className="growth-chart-bg"
        x="0"
        y="0"
        width={width}
        height={height}
        rx="14"
      />
      <text
        className="growth-chart-label work-floor-axis-title"
        x={padLeft}
        y="18"
        textAnchor="start"
      >
        Price / WORK
      </text>
      {yTicks.map((tick) => (
        <g key={`floor-y-${tick}`}>
          <line
            className="growth-chart-grid"
            x1={padLeft}
            x2={width - padRight}
            y1={yFor(tick)}
            y2={yFor(tick)}
          />
          <text
            className="growth-chart-label"
            x={padLeft - 12}
            y={yFor(tick) + 4}
            textAnchor="end"
          >
            {workFloorAxisPriceLabel(tick, unit)}
          </text>
        </g>
      ))}
      {xTicks.map((point, index) => (
        <text
          className="growth-chart-label"
          key={`floor-x-${point.label}-${index}`}
          x={xFor(point.years)}
          y={height - 16}
          textAnchor={
            index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"
          }
        >
          {workFloorTimeLabel(point)}
        </text>
      ))}
      <text
        className="growth-chart-label work-floor-axis-title"
        x={width - padRight}
        y={height - 6}
        textAnchor="end"
      >
        time
      </text>
      <polyline
        className="work-floor-chart-line"
        points={visiblePoints
          .map(
            (point) =>
              `${xFor(point.years).toFixed(2)},${yFor(pointValue(point)).toFixed(2)}`,
          )
          .join(" ")}
      />
      {visiblePoints.map((point, index) => (
        <circle
          className="work-floor-chart-dot"
          cx={xFor(point.years)}
          cy={yFor(pointValue(point))}
          key={`${point.label}-${index}`}
          r={index === visiblePoints.length - 1 ? 5.5 : 3.5}
        />
      ))}
    </svg>
  );
}

function tokenMarketPointTimeMs(point: TokenMarketPricePoint) {
  const createdMs = Date.parse(point.createdAt);
  return Number.isFinite(createdMs) ? createdMs : 0;
}

function tokenMarketTimeLabel(point: TokenMarketPricePoint) {
  const createdMs = tokenMarketPointTimeMs(point);
  if (!createdMs) {
    return point.label;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(createdMs));
}

function tokenMarketPriceLabel(
  priceSats: number,
  btcUsd: number,
  ticker: string,
  unit: WorkFloorChartUnit,
) {
  if (unit === "usd") {
    return `${tokenUsd(satsToUsd(priceSats, btcUsd))} / ${ticker}`;
  }

  return `${tokenSatsPerUnit(priceSats)} sats / ${ticker}`;
}

function tokenMarketAxisPriceLabel(value: number, unit: WorkFloorChartUnit) {
  return workFloorAxisPriceLabel(value, unit);
}

function compactTokenMarketPricePoints(points: TokenMarketPricePoint[]) {
  const compacted: TokenMarketPricePoint[] = [];
  const sorted = [...points].sort((left, right) => {
    const timeSort = tokenMarketPointTimeMs(left) - tokenMarketPointTimeMs(right);
    return timeSort || left.kind.localeCompare(right.kind);
  });

  for (const point of sorted) {
    const previous = compacted[compacted.length - 1];
    if (
      previous &&
      previous.kind === point.kind &&
      previous.label === point.label &&
      Math.abs(previous.priceSats - point.priceSats) < 0.000000001
    ) {
      continue;
    }

    compacted.push(point);
  }

  return compacted;
}

function tokenMarketPricePointsFor(
  token: PowTokenDefinition,
  listings: PowTokenListing[],
  sales: PowTokenSale[],
) {
  const points: TokenMarketPricePoint[] = [];
  const mintPrice =
    token.mintAmount > 0 ? token.mintPriceSats / token.mintAmount : 0;

  if (mintPrice > 0) {
    points.push({
      confirmed: token.confirmed,
      createdAt: token.createdAt,
      kind: "mint",
      label: "deploy",
      priceSats: mintPrice,
    });
  }

  for (const sale of sales) {
    if (!sale.confirmed || sale.amount <= 0 || sale.priceSats <= 0) {
      continue;
    }

    points.push({
      confirmed: true,
      createdAt: sale.createdAt,
      kind: "sale",
      label: shortAddress(sale.txid),
      priceSats: sale.priceSats / sale.amount,
    });
  }

  for (const listing of listings) {
    if (!listing.confirmed || listing.amount <= 0 || listing.priceSats <= 0) {
      continue;
    }

    points.push({
      confirmed: true,
      createdAt: listing.createdAt,
      kind: "ask",
      label: shortAddress(listing.listingId),
      priceSats: listing.priceSats / listing.amount,
    });
  }

  return compactTokenMarketPricePoints(points);
}

function TokenMarketPriceChart({
  btcUsd,
  points,
  ticker,
  unit,
}: {
  btcUsd: number;
  points: TokenMarketPricePoint[];
  ticker: string;
  unit: WorkFloorChartUnit;
}) {
  const visiblePoints = compactTokenMarketPricePoints(
    points.filter(
      (point) =>
        point.confirmed &&
        Number.isFinite(point.priceSats) &&
        point.priceSats >= 0,
    ),
  );
  if (visiblePoints.length === 0) {
    return null;
  }

  const width = 920;
  const height = 260;
  const padLeft = 92;
  const padRight = 24;
  const padTop = 28;
  const padBottom = 52;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const pointTime = (point: TokenMarketPricePoint) =>
    tokenMarketPointTimeMs(point);
  const minTime = Math.min(...visiblePoints.map(pointTime));
  const maxTime = Math.max(...visiblePoints.map(pointTime));
  const pointValue = (point: TokenMarketPricePoint) =>
    unit === "usd" ? satsToUsd(point.priceSats, btcUsd) : point.priceSats;
  const pointValues = visiblePoints.map(pointValue);
  const rawYMin = Math.min(...pointValues);
  const rawYMax = Math.max(...pointValues);
  const rawYRange = rawYMax - rawYMin;
  const fallbackYRange =
    unit === "usd"
      ? Math.max(0.000001, Math.abs(rawYMax) * 0.02)
      : Math.max(0.01, Math.abs(rawYMax) * 0.02);
  const yRange = rawYRange > 0 ? rawYRange : fallbackYRange;
  const yPadding = yRange * 0.22;
  const yMin = Math.max(0, rawYMin - yPadding);
  const yMax = Math.max(rawYMax + yPadding, yMin + fallbackYRange);
  const xRange = Math.max(1, maxTime - minTime);
  const xFor = (point: TokenMarketPricePoint) =>
    visiblePoints.length === 1
      ? padLeft + plotWidth / 2
      : padLeft + ((pointTime(point) - minTime) / xRange) * plotWidth;
  const yFor = (value: number) =>
    padTop +
    (1 - Math.max(0, Math.min(1, (value - yMin) / (yMax - yMin)))) *
      plotHeight;
  const latestPoint = visiblePoints[visiblePoints.length - 1];
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const xTicks = [
    visiblePoints[0],
    visiblePoints[Math.floor((visiblePoints.length - 1) / 2)],
    latestPoint,
  ].filter((point, index, list) => point && list.indexOf(point) === index);

  return (
    <svg
      className="work-floor-chart token-market-price-chart"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      aria-label={`Confirmed ${ticker} market history in ${
        unit === "usd" ? "USD" : "sats"
      } per ${ticker}`}
    >
      <rect
        className="growth-chart-bg"
        x="0"
        y="0"
        width={width}
        height={height}
        rx="14"
      />
      <text
        className="growth-chart-label work-floor-axis-title"
        x={padLeft}
        y="18"
        textAnchor="start"
      >
        Price / {ticker}
      </text>
      {yTicks.map((tick) => (
        <g key={`token-y-${tick}`}>
          <line
            className="growth-chart-grid"
            x1={padLeft}
            x2={width - padRight}
            y1={yFor(tick)}
            y2={yFor(tick)}
          />
          <text
            className="growth-chart-label"
            x={padLeft - 12}
            y={yFor(tick) + 4}
            textAnchor="end"
          >
            {tokenMarketAxisPriceLabel(tick, unit)}
          </text>
        </g>
      ))}
      {xTicks.map((point, index) => (
        <text
          className="growth-chart-label"
          key={`token-x-${point.label}-${index}`}
          x={xFor(point)}
          y={height - 16}
          textAnchor={
            index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"
          }
        >
          {tokenMarketTimeLabel(point)}
        </text>
      ))}
      <text
        className="growth-chart-label work-floor-axis-title"
        x={width - padRight}
        y={height - 6}
        textAnchor="end"
      >
        time
      </text>
      {visiblePoints.length > 1 ? (
        <polyline
          className="token-market-chart-line"
          points={visiblePoints
            .map(
              (point) =>
                `${xFor(point).toFixed(2)},${yFor(pointValue(point)).toFixed(2)}`,
            )
            .join(" ")}
        />
      ) : null}
      {visiblePoints.map((point, index) => (
        <circle
          className={`token-market-chart-dot ${point.kind}`}
          cx={xFor(point)}
          cy={yFor(pointValue(point))}
          key={`${point.label}-${point.kind}-${index}`}
          r={index === visiblePoints.length - 1 ? 5.5 : 3.5}
        />
      ))}
    </svg>
  );
}

function GrowthProductCard({
  actual,
  actualLabel,
  icon,
  modelFiveYear,
  modelFiveYearLabel,
  modelLabel,
  modelOneYear,
  modelOneYearLabel,
  name,
  note,
}: {
  actual: string;
  actualLabel: string;
  icon: ReactNode;
  modelFiveYear: string;
  modelFiveYearLabel: string;
  modelLabel: string;
  modelOneYear: string;
  modelOneYearLabel: string;
  name: string;
  note: string;
}) {
  return (
    <article className="growth-product-card">
      <div className="id-card-head">
        <div className="empty-icon" aria-hidden="true">
          {icon}
        </div>
        <div>
          <h3>{name}</h3>
          <p>{note}</p>
        </div>
      </div>
      <dl className="growth-product-metrics">
        <div>
          <dt>Real now</dt>
          <dd>{actual}</dd>
          <span>{actualLabel}</span>
        </div>
        <div>
          <dt>12m model</dt>
          <dd>{modelOneYear}</dd>
          <span>{modelOneYearLabel || modelLabel}</span>
        </div>
        <div>
          <dt>5y model</dt>
          <dd>{modelFiveYear}</dd>
          <span>{modelFiveYearLabel || modelLabel}</span>
        </div>
      </dl>
    </article>
  );
}

function GrowthApp({
  activeNetwork,
  btcUsd,
  busy,
  growthSummary,
  idActivity,
  registryListings,
  registryRecords,
  registrySales,
  status,
  tokenDefinitions,
  tokenMints,
  tokenSales,
  tokenTransfers,
  workFloorQuote,
  onNetworkChange,
  onRefresh,
}: {
  activeNetwork: BitcoinNetwork;
  btcUsd: number;
  busy: boolean;
  growthSummary?: GrowthSummarySnapshot;
  idActivity: PowActivityItem[];
  registryListings: PowIdListing[];
  registryRecords: PowIdRecord[];
  registrySales: PowIdMarketplaceSale[];
  status: { tone: StatusTone; text: string };
  tokenDefinitions: PowTokenDefinition[];
  tokenMints: PowTokenMint[];
  tokenSales: PowTokenSale[];
  tokenTransfers: PowTokenTransfer[];
  workFloorQuote?: WorkFloorQuote;
  onNetworkChange: (network: BitcoinNetwork) => void;
  onRefresh: () => void;
}) {
  return (
    <main className="desktop-public-app activity-public-app growth-public-app has-route-status">
      <AppHeader
        network={activeNetwork}
        onNetworkChange={onNetworkChange}
        onRefresh={onRefresh}
        subtitle="Model vs chain"
        title="ProofOfWork Growth"
      />

      <AppStatusRow className="desktop-route-status" persistent status={status} />

      <GrowthWorkspace
        btcUsd={btcUsd}
        busy={busy}
        growthSummary={growthSummary}
        idActivity={idActivity}
        registryListings={registryListings}
        registryRecords={registryRecords}
        registrySales={registrySales}
        tokenDefinitions={tokenDefinitions}
        tokenMints={tokenMints}
        tokenSales={tokenSales}
        tokenTransfers={tokenTransfers}
        workFloorQuote={workFloorQuote}
        onRefresh={onRefresh}
      />

      <SocialFooter />
    </main>
  );
}

function GrowthWorkspace({
  btcUsd,
  busy,
  growthSummary,
  idActivity,
  registryListings,
  registryRecords,
  registrySales,
  tokenDefinitions,
  tokenMints,
  tokenSales,
  tokenTransfers,
  workFloorQuote,
  onRefresh,
}: {
  btcUsd: number;
  busy: boolean;
  growthSummary?: GrowthSummarySnapshot;
  idActivity: PowActivityItem[];
  registryListings: PowIdListing[];
  registryRecords: PowIdRecord[];
  registrySales: PowIdMarketplaceSale[];
  tokenDefinitions: PowTokenDefinition[];
  tokenMints: PowTokenMint[];
  tokenSales: PowTokenSale[];
  tokenTransfers: PowTokenTransfer[];
  workFloorQuote?: WorkFloorQuote;
  onRefresh: () => void;
}) {
  const [growthEventPageIndex, setGrowthEventPageIndex] = useState(0);
  const pendingRecords = registryRecords.filter((record) => !record.confirmed);
  const confirmedActivity = idActivity.filter((item) => item.confirmed);
  const computedActualValue = growthActualNetworkValue(
    registryRecords,
    idActivity,
    registrySales,
    tokenDefinitions,
    tokenMints,
    tokenTransfers,
    tokenSales,
  );
  const actualValue = growthSummary?.actualValue ?? computedActualValue;
  const actualPoints = growthActualValuePoints(
    registryRecords,
    idActivity,
    registrySales,
    tokenDefinitions,
    tokenMints,
    tokenTransfers,
    tokenSales,
  );
  const liveBtcUsd = Number.isFinite(btcUsd) && btcUsd > 0 ? btcUsd : 0;
  const usdForSats = (sats: number) => satsToUsd(sats, liveBtcUsd);
  const growthUsdForSats = (sats: number) => growthUsd(usdForSats(sats));
  const summaryWorkFloor = growthSummary?.workFloor ?? workFloorQuote;
  const authoritativeNetworkValueSats =
    growthSummary?.actualValue.totalSats && growthSummary.actualValue.totalSats > 0
      ? growthSummary.actualValue.totalSats
      : summaryWorkFloor && summaryWorkFloor.networkValueSats > 0
      ? summaryWorkFloor.networkValueSats
      : actualValue.totalSats;
  const authoritativeActualPoints =
    summaryWorkFloor && summaryWorkFloor.chartPoints.length > 0
      ? summaryWorkFloor.chartPoints.map((point) => ({
          label: point.label,
          sats: point.networkValueSats,
          usd: usdForSats(point.networkValueSats),
          years: point.years,
        }))
      : actualPoints.map((point) => ({
          ...point,
          usd: usdForSats(point.sats),
        }));
  const realEvents =
    growthSummary?.events && growthSummary.events.length > 0
      ? growthSummary.events
      : growthRealEventItems(
          registryRecords,
          idActivity,
          registrySales,
          tokenDefinitions,
          tokenMints,
          tokenTransfers,
          tokenSales,
        );
  const growthEventPage = pagedItems(
    realEvents,
    growthEventPageIndex,
    GROWTH_EVENT_PAGE_SIZE,
  );
  const marketplaceStats = marketplaceStatsFromSales(registrySales);
  const oneYear =
    GROWTH_MODEL_ROWS.find((row) => row.years === 1) ?? GROWTH_MODEL_ROWS[1];
  const fiveYear =
    GROWTH_MODEL_ROWS.find((row) => row.years === 5) ?? GROWTH_MODEL_ROWS[3];
  const summaryCounts = growthSummary?.counts;
  const currentActual = summaryCounts?.powids ?? actualValue.powids;
  const elapsedYears = growthElapsedYears();
  const modelNow = growthModelValueAtYears(elapsedYears);
  const valueDeltaSats = authoritativeNetworkValueSats - modelNow.sats;
  const valueDeltaPct = modelNow.sats > 0 ? valueDeltaSats / modelNow.sats : 0;
  const confirmedComputerActions =
    summaryCounts?.confirmedComputerActions ??
    confirmedComputerActionCount(
      registryRecords,
      idActivity,
      tokenDefinitions,
      tokenMints,
      tokenTransfers,
      tokenSales,
    );
  const mailActions =
    summaryCounts?.mailActions ??
    confirmedActivity.filter(
      (item) => item.kind === "mail" || item.kind === "reply",
    ).length;
  const browserActions =
    summaryCounts?.browserActions ??
    confirmedActivity.filter(isBrowserActivityItem).length;
  const driveActions =
    summaryCounts?.driveActions ??
    confirmedActivity.filter(
      (item) => item.kind === "file" && !isBrowserActivityItem(item),
    ).length;
  const confirmedTokenDefinitions =
    summaryCounts?.confirmedTokenDefinitions ??
    tokenDefinitions.filter((token) => token.confirmed).length;
  const confirmedTokenMints =
    summaryCounts?.confirmedTokenMints ??
    tokenMints.filter((mint) => mint.confirmed).length;
  const confirmedTokenTransfers =
    summaryCounts?.confirmedTokenTransfers ??
    tokenTransfers.filter((transfer) => transfer.confirmed).length;
  const confirmedTokenSales =
    summaryCounts?.confirmedTokenSales ??
    tokenSales.filter((sale) => sale.confirmed).length;
  const marketplaceSaleCount =
    summaryCounts?.marketplaceSaleCount ??
    marketplaceStats.confirmedSales + confirmedTokenSales;
  const tokenFlowSats =
    actualValue.tokenCreationFlowSats + actualValue.tokenMintFlowSats;
  const walletFlowSats = actualValue.walletFlowSats;
  const computerEventFlowSats = actualValue.computerEventFlowSats;
  const pendingRecordCount = summaryCounts?.pendingRecords ?? pendingRecords.length;
  const idListingCount = summaryCounts?.idListings ?? registryListings.length;
  const chainMetricsIndexedAt =
    growthSummary?.indexedAt ?? summaryWorkFloor?.indexedAt;

  return (
    <section className="growth-workspace">
      <div className="growth-hero">
        <div>
          <span className="landing-kicker">Bitcoin Computer growth model</span>
          <h2>Model the future. Measure the chain.</h2>
          <p>
            The candle-gold line is modeled Bitcoin Computer network value. The
            olive line is real confirmed mainnet value from IDs, Mail, Drive,
            Marketplace, Browser, Tokens, and Wallet.
          </p>
        </div>
        <div className="growth-model-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <TrendingUp size={24} />
            </div>
            <div>
              <h3>Canonical baseline</h3>
              <p>
                Generated {GROWTH_MODEL_GENERATED_ON}. Model start{" "}
                {GROWTH_MODEL_START_DATE}.
              </p>
            </div>
          </div>
          <dl className="growth-assumption-list">
            <div>
              <dt>Baseline value</dt>
              <dd>{growthSats(GROWTH_MODEL_CHART_ROWS[0].totalSats)}</dd>
            </div>
            <div>
              <dt>Baseline IDs</dt>
              <dd>{GROWTH_MODEL_INPUTS.currentPowids.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Node CAGR</dt>
              <dd>{growthPercent(GROWTH_MODEL_INPUTS.nodeCagr)}</dd>
            </div>
            <div>
              <dt>Agent share</dt>
              <dd>{growthPercent(GROWTH_MODEL_INPUTS.agentShare)}</dd>
            </div>
            <div>
              <dt>Canonical fee</dt>
              <dd>
                {GROWTH_MODEL_INPUTS.canonicalFee.toLocaleString("en-US", {
                  maximumFractionDigits: 5,
                })}{" "}
                sat/vB
              </dd>
            </div>
          </dl>
          <button
            className="secondary small"
            disabled={busy}
            onClick={onRefresh}
            type="button"
          >
            <span className="button-content">
              <RefreshCw className={busy ? "refresh-spin" : ""} size={15} />
              <span>{busy ? "Refreshing" : "Refresh chain metrics"}</span>
            </span>
          </button>
          {chainMetricsIndexedAt ? (
            <p className="field-note">
              Refreshed {formatDate(chainMetricsIndexedAt)} from confirmed
              Computer events.
            </p>
          ) : null}
        </div>
      </div>

      <div className="growth-stat-grid" aria-label="Growth headline stats">
        <div>
          <strong>{growthSats(authoritativeNetworkValueSats)}</strong>
          <span>
            Real network value now · {growthUsdForSats(authoritativeNetworkValueSats)}
          </span>
        </div>
        <div>
          <strong>{growthSats(modelNow.sats)}</strong>
          <span>Modeled value now · {growthUsdForSats(modelNow.sats)}</span>
        </div>
        <div>
          <strong>
            {valueDeltaSats >= 0 ? "+" : ""}
            {growthSats(valueDeltaSats)}
          </strong>
          <span>
            {valueDeltaPct >= 0 ? "+" : ""}
            {growthPercent(valueDeltaPct)} versus model now
          </span>
        </div>
        <div>
          <strong>{currentActual.toLocaleString()}</strong>
          <span>
            Confirmed IDs · {pendingRecordCount.toLocaleString()} pending
          </span>
        </div>
        <div>
          <strong>{confirmedComputerActions.toLocaleString()}</strong>
          <span>Confirmed computer actions</span>
        </div>
        <div>
          <strong>
            {actualValue.marketplaceVolumeSats.toLocaleString()}
          </strong>
          <span>
            Marketplace sale sats ·{" "}
            {marketplaceSaleCount.toLocaleString()} confirmed sales
          </span>
        </div>
      </div>

      <section
        className="growth-explainer-grid"
        aria-label="Growth model explainer"
      >
        <article className="growth-explainer-card primary">
          <span>Plain read</span>
          <h3>Candle-gold is the success case. Olive is Bitcoin history.</h3>
          <p>
            The model asks what the Bitcoin Computer can become if IDs, Mail,
            Drive, Marketplace, Browser, Tokens, and Wallet compound together.
            The real line only counts confirmed mainnet records that already
            exist.
          </p>
        </article>
        <article className="growth-explainer-card">
          <span>Network value</span>
          <h3>Everything is valued in sats first.</h3>
          <p>
            IDs use n squared network value. Mail, Drive, Marketplace, Browser,
            Tokens, and Wallet use confirmed payment flow multiplied by the
            same value multiple, then translated to USD with the Bitcoin
            benchmark.
          </p>
        </article>
        <article className="growth-explainer-card">
          <span>Real events</span>
          <h3>The olive line moves when Bitcoin confirms.</h3>
          <p>
            Registrations, messages, replies, file writes, HTML page writes,
            buyer-funded marketplace sales, token sale-ticket buys, token
            creations, token mints, and token transfers are pulled from live
            endpoints. Pending mempool events wait until they confirm.
          </p>
        </article>
        <article className="growth-explainer-card">
          <span>New products</span>
          <h3>Every product joins the same model.</h3>
          <p>
            A product needs real chain inputs, a usage assumption, a value
            assumption, fee elasticity, and blockspace cost. That keeps every
            merged app beside IDs, Mail, Drive, Marketplace, Browser, Tokens,
            and Wallet instead of bolted on.
          </p>
        </article>
      </section>

      <section className="growth-chart-card">
        <div className="id-launch-section-head">
          <div>
            <h3>Modeled network value vs real confirmed value</h3>
            <p>
              Log scale, 10-year window. Values are shown in sats and translated
              to USD through the same BTC/USD benchmark.
            </p>
          </div>
          <div className="growth-chart-legend" aria-label="Chart legend">
            <span>
              <i className="model" /> Model
            </span>
            <span>
              <i className="actual" /> Real
            </span>
          </div>
        </div>
        <div
          className="growth-chart-value-strip"
          aria-label="Current chart values"
        >
          <div>
            <span>
              <i className="model" /> Modeled now
            </span>
            <strong>{growthSats(modelNow.sats)}</strong>
            <small>
              {growthUsdForSats(modelNow.sats)} at {elapsedYears.toFixed(2)} years
            </small>
          </div>
          <div>
            <span>
              <i className="actual" /> Real now
            </span>
            <strong>{growthSats(authoritativeNetworkValueSats)}</strong>
            <small>
              {growthUsdForSats(authoritativeNetworkValueSats)} from confirmed events
            </small>
          </div>
          <div>
            <span>
              <i className="model" /> 12m model
            </span>
            <strong>{growthSats(oneYear.totalSats)}</strong>
            <small>{growthUsdForSats(oneYear.totalSats)} success path</small>
          </div>
        </div>
        <GrowthLineChart actualPoints={authoritativeActualPoints} />
      </section>

      <section
        className="growth-events-card"
        aria-label="Real confirmed growth events"
      >
        <div className="id-launch-section-head">
          <div>
            <h3>Real growth events</h3>
            <p>
              The olive line is rebuilt from confirmed Bitcoin events. These
              are the newest receipts feeding the real network value.
            </p>
          </div>
        </div>
        {realEvents.length > 0 ? (
          <>
            <div className="growth-event-list">
              {growthEventPage.items.map((event) => (
                <a
                  className="growth-event-item"
                  href={explorerTxUrl(event.txid, event.network)}
                  key={event.key}
                  rel="noreferrer"
                  target="_blank"
                >
                  <div>
                    <span className="growth-event-kind">{event.kind}</span>
                    <strong>{event.title}</strong>
                    <p>{event.detail}</p>
                  </div>
                  <div className="growth-event-meta">
                    <span>{event.amountLabel}</span>
                    <small>{growthEventTimeLabel(event.createdAt)}</small>
                    <small>{shortAddress(event.txid)}</small>
                  </div>
                </a>
              ))}
            </div>
            <PaginationControls
              label="Growth events"
              onPageChange={setGrowthEventPageIndex}
              page={growthEventPage}
            />
          </>
        ) : (
          <p className="empty-copy">
            No confirmed growth events loaded yet. Refresh chain metrics to pull
            the latest registry and log state.
          </p>
        )}
      </section>

      <section
        className="growth-product-section"
        aria-label="Growth product metrics"
      >
        <div className="id-launch-section-head">
          <div>
            <h3>Products in the model</h3>
            <p>
              Every product gets a real metric, a usage assumption, a value
              assumption, a fee elasticity, and blockspace accounting.
            </p>
          </div>
        </div>
        <div className="growth-product-grid">
          <GrowthProductCard
            actual={growthSats(
              actualValue.powids ** 2 * GROWTH_MODEL_INPUTS.idDensitySatsPerN2,
            )}
            actualLabel={`${growthUsdForSats(actualValue.powids ** 2 * GROWTH_MODEL_INPUTS.idDensitySatsPerN2)} · ${currentActual.toLocaleString()} confirmed IDs`}
            icon={<AtSign size={24} />}
            modelFiveYear={growthSats(fiveYear.idSats)}
            modelFiveYearLabel={growthUsdForSats(fiveYear.idSats)}
            modelLabel="network value"
            modelOneYear={growthSats(oneYear.idSats)}
            modelOneYearLabel={growthUsdForSats(oneYear.idSats)}
            name="IDs"
            note="Network stock value: n squared against current ID value density."
          />
          <GrowthProductCard
            actual={growthSats(actualValue.mailSats)}
            actualLabel={`${growthUsdForSats(actualValue.mailSats)} · ${actualValue.mailFlowSats.toLocaleString()} paid sats · ${mailActions.toLocaleString()} actions`}
            icon={<Mail size={24} />}
            modelFiveYear={growthSats(fiveYear.mailSats)}
            modelFiveYearLabel={growthUsdForSats(fiveYear.mailSats)}
            modelLabel="network value"
            modelOneYear={growthSats(oneYear.mailSats)}
            modelOneYearLabel={growthUsdForSats(oneYear.mailSats)}
            name="Mail"
            note="Relationship flow across the confirmed ID graph."
          />
          <GrowthProductCard
            actual={growthSats(actualValue.driveSats)}
            actualLabel={`${growthUsdForSats(actualValue.driveSats)} · ${actualValue.driveFlowSats.toLocaleString()} file sats · ${driveActions.toLocaleString()} actions`}
            icon={<FileText size={24} />}
            modelFiveYear={growthSats(fiveYear.driveSats)}
            modelFiveYearLabel={growthUsdForSats(fiveYear.driveSats)}
            modelLabel="network value"
            modelOneYear={growthSats(oneYear.driveSats)}
            modelOneYearLabel={growthUsdForSats(oneYear.driveSats)}
            name="Drive"
            note="File writes priced through the same fee-collapse and blockspace constraint."
          />
          <GrowthProductCard
            actual={growthSats(actualValue.marketplaceSats)}
            actualLabel={`${growthUsdForSats(actualValue.marketplaceSats)} · ${actualValue.marketplaceVolumeSats.toLocaleString()} sale sats · ${marketplaceSaleCount.toLocaleString()} confirmed sales · ${idListingCount.toLocaleString()} ID listings`}
            icon={<Users size={24} />}
            modelFiveYear={growthSats(fiveYear.marketplaceSats)}
            modelFiveYearLabel={growthUsdForSats(fiveYear.marketplaceSats)}
            modelLabel="network value"
            modelOneYear={growthSats(oneYear.marketplaceSats)}
            modelOneYearLabel={growthUsdForSats(oneYear.marketplaceSats)}
            name="Marketplace"
            note="Buyer-funded ID transfers and token sale-ticket buys become first-class product flow."
          />
          <GrowthProductCard
            actual={growthSats(actualValue.browserSats)}
            actualLabel={`${growthUsdForSats(actualValue.browserSats)} · ${actualValue.browserFlowSats.toLocaleString()} page sats · ${browserActions.toLocaleString()} actions`}
            icon={<Monitor size={24} />}
            modelFiveYear={growthSats(fiveYear.browserSats)}
            modelFiveYearLabel={growthUsdForSats(fiveYear.browserSats)}
            modelLabel="network value"
            modelOneYear={growthSats(oneYear.browserSats)}
            modelOneYearLabel={growthUsdForSats(oneYear.browserSats)}
            name="Browser"
            note="HTML pages rendered from OP_RETURN message bodies or verified file attachments by txid."
          />
          <GrowthProductCard
            actual={growthSats(actualValue.computerEventSats)}
            actualLabel={`${growthUsdForSats(actualValue.computerEventSats)} · ${computerEventFlowSats.toLocaleString()} confirmed log sats`}
            icon={<GitBranch size={24} />}
            modelFiveYear="Tracked"
            modelFiveYearLabel="confirmed event ledger"
            modelLabel="confirmed log value"
            modelOneYear="Tracked"
            modelOneYearLabel="confirmed event ledger"
            name="Confirmed Events"
            note="Registry mutations, listings, seals, delistings, and other confirmed log writes feed the same WORK floor ledger."
          />
          <GrowthProductCard
            actual={growthSats(actualValue.tokenSats)}
            actualLabel={`${growthUsdForSats(actualValue.tokenSats)} · ${tokenFlowSats.toLocaleString()} token sats · ${confirmedTokenDefinitions.toLocaleString()} tokens · ${confirmedTokenMints.toLocaleString()} mints`}
            icon={<TrendingUp size={24} />}
            modelFiveYear={growthSats(fiveYear.tokenSats)}
            modelFiveYearLabel={growthUsdForSats(fiveYear.tokenSats)}
            modelLabel="network value"
            modelOneYear={growthSats(oneYear.tokenSats)}
            modelOneYearLabel={growthUsdForSats(oneYear.tokenSats)}
            name="Tokens"
            note="Token creation fees and owner-registry mint flow become measurable Bitcoin Computer value."
          />
          <GrowthProductCard
            actual={growthSats(actualValue.walletSats)}
            actualLabel={`${growthUsdForSats(actualValue.walletSats)} · ${walletFlowSats.toLocaleString()} transfer sats · ${confirmedTokenTransfers.toLocaleString()} transfers`}
            icon={<Wallet size={24} />}
            modelFiveYear="Tracked"
            modelFiveYearLabel="token transfer lane"
            modelLabel="confirmed transfer value"
            modelOneYear="Tracked"
            modelOneYearLabel="token transfer lane"
            name="Wallet"
            note="Token balances and pwt1:send transfers become their own ownership product in the Bitcoin Computer model."
          />
        </div>
      </section>

      <section
        className="growth-assumption-grid"
        aria-label="Model assumptions"
      >
        <article>
          <h3>Product contract</h3>
          <p>
            New products are not side quests. They enter the same model with
            real chain inputs, per-user usage, value multiple, fee elasticity,
            and vbyte cost.
          </p>
        </article>
        <article>
          <h3>Blockspace constraint</h3>
          <p>
            The model compounds until the current theoretical ceiling is
            binding:{" "}
            {growthCompactNumber(GROWTH_MODEL_INPUTS.blockspaceVbytesPerYear)}{" "}
            vB per year.
          </p>
        </article>
        <article>
          <h3>Canonical path</h3>
          <p>
            At 12 months the model reaches{" "}
            {Math.round(oneYear.powids).toLocaleString()} PowIDs and{" "}
            {growthSats(oneYear.totalSats)} / {growthUsdForSats(oneYear.totalSats)}{" "}
            total modeled Bitcoin Computer value.
          </p>
        </article>
      </section>
    </section>
  );
}

function IdLaunchApp({
  address,
  busy,
  canRegister,
  connectWallet,
  disconnectWallet,
  feeRate,
  hasUnisat,
  idName,
  idPgpKey,
  idReceiveAddress,
  lastRegisteredId,
  network,
  onNetworkChange,
  registryAddress,
  registryRecords,
  registrationBytes,
  setFeeRate,
  setIdName,
  setIdPgpKey,
  setIdReceiveAddress,
  status,
  submit,
  onRefresh,
}: {
  address: string;
  busy: boolean;
  canRegister: boolean;
  connectWallet: () => void;
  disconnectWallet: () => void;
  feeRate: number;
  hasUnisat: boolean;
  idName: string;
  idPgpKey: string;
  idReceiveAddress: string;
  lastRegisteredId?: PowIdRecord;
  network: BitcoinNetwork;
  onNetworkChange: (network: BitcoinNetwork) => void;
  registryAddress: string;
  registryRecords: PowIdRecord[];
  registrationBytes: number;
  setFeeRate: (value: number) => void;
  setIdName: (value: string) => void;
  setIdPgpKey: (value: string) => void;
  setIdReceiveAddress: (value: string) => void;
  status: { tone: StatusTone; text: string };
  submit: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
}) {
  const normalizedId = normalizePowId(idName);
  const ownedIds = ownedPowIds(registryRecords, address);
  const confirmedRecords = registryRecords.filter((record) => record.confirmed);
  const pendingRecords = registryRecords.filter((record) => !record.confirmed);
  const confirmedMatch = normalizedId
    ? confirmedRecords.find((record) => record.id === normalizedId)
    : undefined;
  const pendingMatch = normalizedId
    ? pendingRecords.find((record) => record.id === normalizedId)
    : undefined;
  const availabilityTone = !normalizedId
    ? "idle"
    : confirmedMatch
      ? "bad"
      : pendingMatch
        ? "idle"
        : "good";
  const availabilityTitle = !normalizedId
    ? "Search any ID"
    : confirmedMatch
      ? `${normalizedId}@proofofwork.me is taken`
      : pendingMatch
        ? `${normalizedId}@proofofwork.me is pending`
        : `${normalizedId}@proofofwork.me is open`;
  const availabilityText = !normalizedId
    ? "Enter a name to check the Bitcoin registry before you claim."
    : confirmedMatch
      ? `First confirmed registration won in ${shortAddress(confirmedMatch.txid)}.`
      : pendingMatch
        ? "Pending is not final. First confirmed valid registration wins."
        : "Claimable now. Registration pays 1,000 sats to the canonical registry.";

  return (
    <main className="id-launch-app">
      <AppHeader
        address={address}
        busy={busy}
        connectWallet={connectWallet}
        disconnectWallet={disconnectWallet}
        hasUnisat={hasUnisat}
        network={network}
        onNetworkChange={onNetworkChange}
        onRefresh={onRefresh}
        subtitle="Mainnet registry"
        title="ProofOfWork IDs"
      />

      <AppStatusRow persistent status={status} />

      <section className="id-launch-main">
        <div className="id-launch-hero">
          <div>
            <span className="id-launch-kicker">Bitcoin-native identity</span>
            <h2>Claim your ProofOfWork ID.</h2>
            <p>
              Register a permanent on-chain mail identity that resolves to your
              Bitcoin receive address. First confirmed valid registration wins.
            </p>
          </div>

          <div className="id-launch-stats" aria-label="Registry stats">
            <div>
              <strong>{registryRecords.length.toLocaleString()}</strong>
              <span>Total IDs</span>
            </div>
            <div>
              <strong>{confirmedRecords.length.toLocaleString()}</strong>
              <span>Confirmed</span>
            </div>
            <div>
              <strong>{pendingRecords.length.toLocaleString()}</strong>
              <span>Pending</span>
            </div>
          </div>
        </div>

        <div className="id-launch-grid">
          <form className="id-launch-card id-claim-card" onSubmit={submit}>
            <div className="id-card-head">
              <div className="empty-icon" aria-hidden="true">
                <AtSign size={24} />
              </div>
              <div>
                <h3>Register ID</h3>
                <p>
                  Pay {ID_REGISTRATION_PRICE_SATS.toLocaleString()} sats to the
                  canonical registry address.
                </p>
              </div>
            </div>

            <label>
              ID
              <div className="id-input-row">
                <input
                  autoComplete="off"
                  onChange={(event) => setIdName(event.target.value)}
                  placeholder="user"
                  spellCheck={false}
                  value={idName}
                />
                <span>@proofofwork.me</span>
              </div>
            </label>

            <div className={`id-availability ${availabilityTone}`}>
              <strong>{availabilityTitle}</strong>
              <span>{availabilityText}</span>
            </div>

            <div className="compose-grid">
              <label>
                Owner
                <input readOnly value={address || "Connect UniSat"} />
              </label>
              <label>
                Receive address
                <input
                  autoComplete="off"
                  onChange={(event) => setIdReceiveAddress(event.target.value)}
                  spellCheck={false}
                  value={idReceiveAddress}
                />
              </label>
            </div>

            <details className="id-advanced">
              <summary>Advanced options</summary>
              <div className="id-advanced-content">
                <label>
                  PGP public key optional
                  <textarea
                    onChange={(event) => setIdPgpKey(event.target.value)}
                    placeholder="Paste an armored public key later when encryption is ready."
                    value={idPgpKey}
                  />
                </label>
                <FeeRateControl
                  feeRate={feeRate}
                  setFeeRate={setFeeRate}
                  sidecar={
                    <label>
                      Registry
                      <input readOnly value={registryAddress} />
                    </label>
                  }
                />
              </div>
            </details>

            <div
              className={
                registrationBytes > MAX_DATA_CARRIER_BYTES
                  ? "counter bad"
                  : "counter"
              }
            >
              {registrationBytes.toLocaleString()} /{" "}
              {MAX_DATA_CARRIER_BYTES.toLocaleString()} OP_RETURN data-carrier
              bytes
            </div>

            <button className="primary" disabled={busy} type="submit">
              <span className="button-content">
                <AtSign size={16} />
                <span>{busy ? "Registering" : "Register for 1,000 sats"}</span>
              </span>
            </button>
          </form>

          <aside className="id-launch-side">
            {lastRegisteredId ? (
              <section className="id-launch-card id-verify-card">
                <div className="id-card-head">
                  <div className="empty-icon" aria-hidden="true">
                    <AtSign size={24} />
                  </div>
                  <div>
                    <h3>Verify on X</h3>
                    <p>
                      Post public proof for {lastRegisteredId.id}
                      @proofofwork.me.
                    </p>
                  </div>
                </div>
                <div className="id-record-actions">
                  <a
                    className="primary link-button"
                    href={xVerificationUrl(lastRegisteredId)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span className="button-content">
                      <ArrowUpRight size={16} />
                      <span>Verify on X</span>
                    </span>
                  </a>
                  <a
                    className="secondary link-button"
                    href={explorerTxUrl(
                      lastRegisteredId.txid,
                      lastRegisteredId.network,
                    )}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span className="button-content">
                      <ArrowUpRight size={16} />
                      <span>View TX</span>
                    </span>
                  </a>
                </div>
              </section>
            ) : null}

            <section className="id-launch-card">
              <h3>Canonical Registry</h3>
              <dl className="file-detail-list">
                <div>
                  <dt>Network</dt>
                  <dd>Mainnet</dd>
                </div>
                <div>
                  <dt>Address</dt>
                  <dd>{registryAddress}</dd>
                </div>
                <div>
                  <dt>Protocol</dt>
                  <dd>{ID_PROTOCOL_PREFIX}r2</dd>
                </div>
              </dl>
            </section>

            <section className="id-launch-card">
              <h3>Your IDs</h3>
              <IdRecordList
                records={ownedIds}
                allowVerification
                empty={
                  address
                    ? "No IDs for this wallet yet."
                    : "Connect UniSat to see your IDs."
                }
                searchPlaceholder="Search your IDs"
              />
            </section>
          </aside>
        </div>

        <section className="id-launch-card">
          <div className="id-launch-section-head">
            <div>
              <h3>Public Registry</h3>
              <p>
                Global records create the network effect. Verification actions
                only appear for your own IDs.
              </p>
            </div>
            <button
              className="secondary small"
              disabled={busy}
              onClick={onRefresh}
              type="button"
            >
              <span className="button-content">
                <RefreshCw className={busy ? "refresh-spin" : ""} size={15} />
                <span>Refresh</span>
              </span>
            </button>
          </div>
          <IdRecordList
            records={registryRecords}
            empty="No registry records found yet."
            initialLimit={12}
          />
        </section>
      </section>

      <SocialFooter />
    </main>
  );
}

type MarketplaceTab = "ids" | "tokens";

type TokenMarketplaceRow = PowTokenDefinition & {
  confirmedMints: number;
  confirmedSupply: number;
  holderCount: number;
  lastSalePricePerToken: number;
  lowestAskPricePerToken: number;
  openListings: number;
  pendingMints: number;
  pendingSupply: number;
  pricePerToken: number;
  progress: number;
  transferCount: number;
  walletBalance: number;
};

type MarketplaceSortMode =
  | "price-desc"
  | "price-asc"
  | "arb-desc"
  | "arb-asc";

type TokenReferenceSnapshot = Pick<
  PowTokenDefinition,
  "mintAmount" | "mintPriceSats" | "ticker" | "tokenId"
> &
  Partial<
    Pick<
      TokenMarketplaceRow,
      "lastSalePricePerToken" | "lowestAskPricePerToken" | "pricePerToken"
    >
  >;

type TokenMarketLogItem =
  | {
      createdAt: string;
      closedListing: PowTokenClosedListing;
      kind: "closed-listing";
      txid: string;
    }
  | {
      createdAt: string;
      kind: "listing";
      listing: PowTokenListing;
      txid: string;
    }
  | {
      createdAt: string;
      kind: "sale";
      sale: PowTokenSale;
      txid: string;
    };

const MARKETPLACE_SORT_OPTIONS: Array<{
  label: string;
  value: MarketplaceSortMode;
}> = [
  { label: "Price high", value: "price-desc" },
  { label: "Price low", value: "price-asc" },
  { label: "Arb high", value: "arb-desc" },
  { label: "Arb low", value: "arb-asc" },
];

function finitePositiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function compareOptionalMetric(
  leftMetric: number | null,
  rightMetric: number | null,
  descending: boolean,
  fallback: () => number,
) {
  const leftHasMetric = leftMetric !== null && Number.isFinite(leftMetric);
  const rightHasMetric = rightMetric !== null && Number.isFinite(rightMetric);
  if (leftHasMetric && !rightHasMetric) {
    return -1;
  }
  if (!leftHasMetric && rightHasMetric) {
    return 1;
  }
  if (leftHasMetric && rightHasMetric && leftMetric !== rightMetric) {
    return descending
      ? Number(rightMetric) - Number(leftMetric)
      : Number(leftMetric) - Number(rightMetric);
  }

  return fallback();
}

function compareCreatedAtDesc(
  left: { createdAt: string; txid?: string },
  right: { createdAt: string; txid?: string },
) {
  return (
    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    String(left.txid ?? "").localeCompare(String(right.txid ?? ""))
  );
}

function tokenMintPricePerUnit(token?: TokenReferenceSnapshot) {
  if (!token || token.mintAmount <= 0) {
    return 0;
  }

  return token.mintPriceSats / token.mintAmount;
}

function tokenReferencePriceSats(
  token: TokenReferenceSnapshot | undefined,
  workFloorSats: number,
) {
  if (!token) {
    return null;
  }

  if (token.tokenId === WORK_TOKEN_ID && workFloorSats > 0) {
    return workFloorSats;
  }

  return (
    finitePositiveNumber(token.lastSalePricePerToken) ||
    finitePositiveNumber(token.pricePerToken) ||
    tokenMintPricePerUnit(token) ||
    null
  );
}

function tokenMarketDisplayPriceSats(
  token: TokenMarketplaceRow,
  workFloorSats: number,
) {
  if (token.tokenId === WORK_TOKEN_ID && workFloorSats > 0) {
    return workFloorSats;
  }

  return (
    finitePositiveNumber(token.lowestAskPricePerToken) ||
    finitePositiveNumber(token.lastSalePricePerToken) ||
    finitePositiveNumber(token.pricePerToken) ||
    tokenMintPricePerUnit(token) ||
    null
  );
}

function tokenMarketArbSats(token: TokenMarketplaceRow, workFloorSats: number) {
  const reference = tokenReferencePriceSats(token, workFloorSats);
  const ask =
    finitePositiveNumber(token.lowestAskPricePerToken) ||
    finitePositiveNumber(token.lastSalePricePerToken) ||
    finitePositiveNumber(token.pricePerToken) ||
    tokenMintPricePerUnit(token) ||
    null;

  return reference !== null && ask !== null ? reference - ask : null;
}

function tokenListingUnitPriceSats(listing: PowTokenListing) {
  return listing.amount > 0 ? listing.priceSats / listing.amount : 0;
}

function tokenListingReferencePriceSats(
  listing: PowTokenListing,
  tokenById: Map<string, TokenReferenceSnapshot>,
  workFloorSats: number,
) {
  return tokenReferencePriceSats(tokenById.get(listing.tokenId), workFloorSats);
}

function tokenListingArbSats(
  listing: PowTokenListing,
  tokenById: Map<string, TokenReferenceSnapshot>,
  workFloorSats: number,
) {
  const reference = tokenListingReferencePriceSats(
    listing,
    tokenById,
    workFloorSats,
  );
  const unit = tokenListingUnitPriceSats(listing);

  return reference !== null && unit > 0 ? reference - unit : null;
}

function sortTokenMarketplaceRows(
  rows: TokenMarketplaceRow[],
  sortMode: MarketplaceSortMode,
  workFloorSats: number,
) {
  return [...rows].sort((left, right) => {
    const fallback = () =>
      right.openListings - left.openListings ||
      right.confirmedSupply - left.confirmedSupply ||
      compareTokensByConfirmation(left, right);

    if (sortMode === "price-desc" || sortMode === "price-asc") {
      return compareOptionalMetric(
        tokenMarketDisplayPriceSats(left, workFloorSats),
        tokenMarketDisplayPriceSats(right, workFloorSats),
        sortMode === "price-desc",
        fallback,
      );
    }

    return compareOptionalMetric(
      tokenMarketArbSats(left, workFloorSats),
      tokenMarketArbSats(right, workFloorSats),
      sortMode === "arb-desc",
      fallback,
    );
  });
}

function sortTokenListings(
  listings: PowTokenListing[],
  sortMode: MarketplaceSortMode,
  tokenById: Map<string, TokenReferenceSnapshot>,
  workFloorSats: number,
) {
  return [...listings].sort((left, right) => {
    const fallback = () =>
      compareCreatedAtDesc(
        { createdAt: left.createdAt, txid: left.listingId },
        { createdAt: right.createdAt, txid: right.listingId },
      );

    if (sortMode === "price-desc" || sortMode === "price-asc") {
      return compareOptionalMetric(
        tokenListingUnitPriceSats(left) || null,
        tokenListingUnitPriceSats(right) || null,
        sortMode === "price-desc",
        fallback,
      );
    }

    return compareOptionalMetric(
      tokenListingArbSats(left, tokenById, workFloorSats),
      tokenListingArbSats(right, tokenById, workFloorSats),
      sortMode === "arb-desc",
      fallback,
    );
  });
}

function tokenMarketLogItemConfirmed(item: TokenMarketLogItem) {
  if (item.kind === "closed-listing") {
    return Boolean(item.closedListing.closedConfirmed);
  }

  return item.kind === "sale" ? item.sale.confirmed : item.listing.confirmed;
}

function sortTokenMarketLogItems(items: TokenMarketLogItem[]) {
  return [...items].sort(
    (left, right) =>
      Number(tokenMarketLogItemConfirmed(right)) -
        Number(tokenMarketLogItemConfirmed(left)) ||
      compareCreatedAtDesc(left, right),
  );
}

function sortIdMarketplaceListings(
  listings: PowIdListing[],
  sortMode: MarketplaceSortMode,
) {
  return [...listings].sort((left, right) => {
    const fallback = () =>
      compareCreatedAtDesc(
        { createdAt: left.createdAt, txid: left.listingId },
        { createdAt: right.createdAt, txid: right.listingId },
      );
    const descending =
      sortMode === "price-desc" ||
      sortMode === "arb-asc";

    return compareOptionalMetric(
      finitePositiveNumber(left.priceSats) || null,
      finitePositiveNumber(right.priceSats) || null,
      descending,
      fallback,
    );
  });
}

function MarketplaceSortControl({
  label = "Sort",
  onChange,
  value,
}: {
  label?: string;
  onChange: (value: MarketplaceSortMode) => void;
  value: MarketplaceSortMode;
}) {
  return (
    <div className="marketplace-sort-row">
      <label className="sort-control">
        {label}
        <select
          onChange={(event) => onChange(event.target.value as MarketplaceSortMode)}
          value={value}
        >
          {MARKETPLACE_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function tokenMarketplaceRowsFor({
  address,
  listings,
  mints,
  network,
  sales,
  tokens,
  transfers,
}: {
  address: string;
  listings: PowTokenListing[];
  mints: PowTokenMint[];
  network: BitcoinNetwork;
  sales: PowTokenSale[];
  tokens: PowTokenDefinition[];
  transfers: PowTokenTransfer[];
}): TokenMarketplaceRow[] {
  const stats = new Map<
    string,
    {
      balances: Map<string, number>;
      confirmedMints: number;
      confirmedSupply: number;
      lastSalePricePerToken: number;
      lowestAskPricePerToken: number;
      openListings: number;
      pendingMints: number;
      pendingSupply: number;
      transferCount: number;
    }
  >();

  const networkTokens = tokens.filter((token) => token.network === network);

  for (const token of networkTokens) {
    stats.set(token.tokenId, {
      balances: new Map(),
      confirmedMints: 0,
      confirmedSupply: 0,
      lastSalePricePerToken: 0,
      lowestAskPricePerToken: 0,
      openListings: 0,
      pendingMints: 0,
      pendingSupply: 0,
      transferCount: 0,
    });
  }

  for (const mint of mints) {
    if (mint.network !== network) {
      continue;
    }

    const current = stats.get(mint.tokenId);
    if (!current) {
      continue;
    }

    if (mint.confirmed) {
      current.confirmedMints += 1;
      current.confirmedSupply += mint.amount;
      current.balances.set(
        mint.minterAddress,
        (current.balances.get(mint.minterAddress) ?? 0) + mint.amount,
      );
    } else {
      current.pendingMints += 1;
      current.pendingSupply += mint.amount;
    }
  }

  for (const transfer of transfers) {
    if (transfer.network !== network) {
      continue;
    }

    const current = stats.get(transfer.tokenId);
    if (!current) {
      continue;
    }

    current.transferCount += 1;
    if (!transfer.confirmed) {
      continue;
    }

    current.balances.set(
      transfer.senderAddress,
      (current.balances.get(transfer.senderAddress) ?? 0) - transfer.amount,
    );
    current.balances.set(
      transfer.recipientAddress,
      (current.balances.get(transfer.recipientAddress) ?? 0) + transfer.amount,
    );
  }

  for (const sale of sales) {
    if (sale.network !== network) {
      continue;
    }

    const current = stats.get(sale.tokenId);
    if (!current) {
      continue;
    }

    if (sale.confirmed) {
      current.balances.set(
        sale.sellerAddress,
        (current.balances.get(sale.sellerAddress) ?? 0) - sale.amount,
      );
      current.balances.set(
        sale.buyerAddress,
        (current.balances.get(sale.buyerAddress) ?? 0) + sale.amount,
      );
      if (current.lastSalePricePerToken === 0) {
        current.lastSalePricePerToken =
          sale.amount > 0 ? sale.priceSats / sale.amount : 0;
      }
    }
  }

  for (const listing of listings) {
    if (listing.network !== network) {
      continue;
    }

    const current = stats.get(listing.tokenId);
    if (!current) {
      continue;
    }

    current.openListings += 1;
    const ask =
      listing.amount > 0 ? listing.priceSats / listing.amount : 0;
    current.lowestAskPricePerToken =
      current.lowestAskPricePerToken > 0
        ? Math.min(current.lowestAskPricePerToken, ask)
        : ask;
  }

  return networkTokens
    .map((token) => {
      const current = stats.get(token.tokenId);
      const balances = current?.balances ?? new Map<string, number>();
      const confirmedMints = Math.max(
        current?.confirmedMints ?? 0,
        Number.isFinite(token.confirmedMints) ? Number(token.confirmedMints) : 0,
      );
      const confirmedSupply = Math.max(
        current?.confirmedSupply ?? 0,
        Number.isFinite(token.confirmedSupply)
          ? Number(token.confirmedSupply)
          : 0,
      );
      const holderCount = Math.max(
        [...balances.values()].filter((balance) => balance > 0).length,
        Number.isFinite(token.holderCount) ? Number(token.holderCount) : 0,
      );
      const lastSalePricePerToken = Math.max(
        current?.lastSalePricePerToken ?? 0,
        Number.isFinite(token.lastSalePricePerToken)
          ? Number(token.lastSalePricePerToken)
          : 0,
      );
      const computedLowestAsk = current?.lowestAskPricePerToken ?? 0;
      const summaryLowestAsk = Number.isFinite(token.lowestAskPricePerToken)
        ? Number(token.lowestAskPricePerToken)
        : 0;
      const lowestAskPricePerToken =
        computedLowestAsk > 0 && summaryLowestAsk > 0
          ? Math.min(computedLowestAsk, summaryLowestAsk)
          : computedLowestAsk || summaryLowestAsk;
      const openListings = Math.max(
        current?.openListings ?? 0,
        Number.isFinite(token.openListings) ? Number(token.openListings) : 0,
      );
      const pendingMints = Math.max(
        current?.pendingMints ?? 0,
        Number.isFinite(token.pendingMints) ? Number(token.pendingMints) : 0,
      );
      const pendingSupply = Math.max(
        current?.pendingSupply ?? 0,
        Number.isFinite(token.pendingSupply) ? Number(token.pendingSupply) : 0,
      );
      const transferCount = Math.max(
        current?.transferCount ?? 0,
        Number.isFinite(token.transferCount) ? Number(token.transferCount) : 0,
      );

      return {
        ...token,
        confirmedMints,
        confirmedSupply,
        holderCount,
        lastSalePricePerToken,
        lowestAskPricePerToken,
        openListings,
        pendingMints,
        pendingSupply,
        pricePerToken:
          token.mintAmount > 0 ? token.mintPriceSats / token.mintAmount : 0,
        progress: tokenProgressPercent(
          confirmedSupply,
          token.maxSupply,
        ),
        transferCount,
        walletBalance: address ? Math.max(0, balances.get(address) ?? 0) : 0,
      };
    })
    .sort(
      (left, right) =>
        right.confirmedSupply - left.confirmedSupply ||
        compareTokensByConfirmation(left, right),
    );
}

function MarketplaceTabs({
  active,
  idCount,
  onChange,
  tokenCount,
}: {
  active: MarketplaceTab;
  idCount: number;
  onChange: (tab: MarketplaceTab) => void;
  tokenCount: number;
}) {
  return (
    <div className="marketplace-tabs" aria-label="Marketplace asset tabs">
      {(
        [
          ["ids", "IDs", idCount],
          ["tokens", "Tokens", tokenCount],
        ] as const
      ).map(([tab, label, count]) => (
        <button
          aria-pressed={active === tab}
          key={tab}
          onClick={() => onChange(tab)}
          type="button"
        >
          <span>{label}</span>
          <strong>{count.toLocaleString()}</strong>
        </button>
      ))}
    </div>
  );
}

function marketplaceStatusIsIdScoped(text: string) {
  return /(?:ID registry|ProofOfWork ID|Registry loaded)/u.test(text);
}

function marketplaceStatusIsTokenScoped(text: string) {
  return /(?:Token index|token market|WORK floor)/iu.test(text);
}

function marketplaceStatusForTab({
  active,
  idSummary,
  status,
  tokenSummary,
}: {
  active: MarketplaceTab;
  idSummary: { tone: StatusTone; text: string };
  status: { tone: StatusTone; text: string };
  tokenSummary: { tone: StatusTone; text: string };
}) {
  if (status.tone === "bad") {
    return status;
  }

  if (active === "tokens" && marketplaceStatusIsIdScoped(status.text)) {
    return tokenSummary;
  }

  if (active === "ids" && marketplaceStatusIsTokenScoped(status.text)) {
    return idSummary;
  }

  return status;
}

function TokenMarketplacePanel({
  address,
  btcUsd,
  busy,
  buyListing,
  closedListings,
  computerMode = false,
  feeRate,
  listings,
  mints,
  network,
  onOpenTokenWorkspace,
  onOpenWalletWorkspace,
  sales,
  setFeeRate,
  tokens,
  transfers,
  workFloorLoading,
  workFloorQuote,
}: {
  address: string;
  btcUsd: number;
  busy: boolean;
  buyListing: (listing: PowTokenListing) => void;
  closedListings: PowTokenClosedListing[];
  computerMode?: boolean;
  feeRate: number;
  listings: PowTokenListing[];
  mints: PowTokenMint[];
  network: BitcoinNetwork;
  onOpenTokenWorkspace?: (token?: PowTokenDefinition) => void;
  onOpenWalletWorkspace?: (token?: PowTokenDefinition) => void;
  sales: PowTokenSale[];
  setFeeRate: (value: number) => void;
  tokens: PowTokenDefinition[];
  transfers: PowTokenTransfer[];
  workFloorLoading: boolean;
  workFloorQuote?: WorkFloorQuote;
}) {
  const [workFloorChartUnit, setWorkFloorChartUnit] =
    useState<WorkFloorChartUnit>("sats");
  const [tokenMarketChartUnit, setTokenMarketChartUnit] =
    useState<WorkFloorChartUnit>("sats");
  const rows = tokenMarketplaceRowsFor({
    address,
    listings,
    mints,
    network,
    sales,
    tokens,
    transfers,
  });
  const [selectedTokenMarketId, setSelectedTokenMarketId] = useState(() =>
    tokenRouteTarget(),
  );
  const [tokenMarketPageIndex, setTokenMarketPageIndex] = useState(0);
  const [tokenListingPageIndex, setTokenListingPageIndex] = useState(0);
  const [tokenMarketLogPageIndex, setTokenMarketLogPageIndex] = useState(0);
  const [remoteTokenMarketLogPage, setRemoteTokenMarketLogPage] = useState<
    | {
        key: string;
        page: PowPaginatedApiResponse<TokenMarketLogItem>;
      }
    | undefined
  >();
  const [tokenMarketLogPageLoading, setTokenMarketLogPageLoading] =
    useState(false);
  const [tokenMarketSortMode, setTokenMarketSortMode] =
    useState<MarketplaceSortMode>("arb-desc");
  const [tokenListingSortMode, setTokenListingSortMode] =
    useState<MarketplaceSortMode>("arb-desc");
  const selectedMarketToken = rows.find(
    (token) =>
      token.tokenId === selectedTokenMarketId ||
      token.ticker === normalizeTokenTicker(selectedTokenMarketId),
  );
  useEffect(() => {
    setTokenMarketPageIndex(0);
  }, [selectedMarketToken?.tokenId, tokenMarketSortMode]);
  useEffect(() => {
    setTokenListingPageIndex(0);
  }, [selectedMarketToken?.tokenId, tokenListingSortMode]);
  useEffect(() => {
    setTokenMarketLogPageIndex(0);
  }, [selectedMarketToken?.tokenId]);
  const setTokenMarketRoute = (tokenId: string) => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (tokenId) {
      params.set("asset", tokenId);
    } else {
      params.delete("asset");
    }
    if (computerMode) {
      STANDALONE_ROUTE_PARAMS.forEach((param) => params.delete(param));
      params.set("folder", "marketplace");
    } else if (isLocalPreviewHost()) {
      params.set("marketplace", "1");
    }
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  };
  const openTokenMarket = (token: TokenMarketplaceRow) => {
    setSelectedTokenMarketId(token.tokenId);
    setTokenMarketRoute(token.tokenId);
  };
  const clearTokenMarket = () => {
    setSelectedTokenMarketId("");
    setTokenMarketRoute("");
  };
  const networkListings = listings.filter((listing) => listing.network === network);
  const marketListings = selectedMarketToken
    ? networkListings.filter(
        (listing) => listing.tokenId === selectedMarketToken.tokenId,
      )
    : networkListings;
  const networkClosedListings = closedListings.filter(
    (listing) => listing.network === network,
  );
  const marketClosedListings = selectedMarketToken
    ? networkClosedListings.filter(
        (listing) => listing.tokenId === selectedMarketToken.tokenId,
      )
    : networkClosedListings;
  const networkSales = sales.filter((sale) => sale.network === network);
  const marketSales = selectedMarketToken
    ? networkSales.filter((sale) => sale.tokenId === selectedMarketToken.tokenId)
    : networkSales;
  const workMarketFloorSats =
    network === "livenet" && workFloorQuote
      ? workFloorQuote.networkValueSats / WORK_TOKEN_MAX_SUPPLY
      : 0;
  const tokenReferenceById = new Map<string, TokenReferenceSnapshot>(
    rows.map((token) => [token.tokenId, token]),
  );
  const sortedMarketListings = sortTokenListings(
    marketListings,
    tokenListingSortMode,
    tokenReferenceById,
    workMarketFloorSats,
  );
  const tokenMarketLogItems = sortTokenMarketLogItems([
    ...marketListings.map((listing) => ({
      createdAt: listing.createdAt,
      kind: "listing" as const,
      listing,
      txid: listing.listingId,
    })),
    ...marketClosedListings.map((closedListing) => ({
      closedListing,
      createdAt: closedListing.closedAt ?? closedListing.createdAt,
      kind: "closed-listing" as const,
      txid: closedListing.closedTxid || closedListing.listingId,
    })),
    ...marketSales.map((sale) => ({
      createdAt: sale.createdAt,
      kind: "sale" as const,
      sale,
      txid: sale.txid,
    })),
  ]);
  const tokenMarketLogDataVersion = tokenMarketLogItems
    .map((item) =>
      [
        item.kind,
        item.txid,
        item.createdAt,
        tokenMarketLogItemConfirmed(item) ? "1" : "0",
      ].join(":"),
    )
    .join("|");
  const tokenMarketLogKey = [
    network,
    selectedMarketToken?.tokenId ?? "",
    tokenMarketLogPageIndex,
    TOKEN_LIST_PREVIEW_COUNT,
    tokenMarketLogDataVersion,
  ].join(":");
  useEffect(() => {
    if (network !== "livenet") {
      setRemoteTokenMarketLogPage(undefined);
      return;
    }

    let cancelled = false;
    setTokenMarketLogPageLoading(true);
    void fetchTokenHistoryPage<TokenMarketLogItem>(network, "market-log", {
      pageIndex: tokenMarketLogPageIndex,
      pageSize: TOKEN_LIST_PREVIEW_COUNT,
      tokenScope: selectedMarketToken?.tokenId ?? "",
    })
      .then((page) => {
        if (!cancelled) {
          setRemoteTokenMarketLogPage({ key: tokenMarketLogKey, page });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRemoteTokenMarketLogPage(undefined);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTokenMarketLogPageLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    network,
    selectedMarketToken?.tokenId,
    tokenMarketLogKey,
    tokenMarketLogPageIndex,
  ]);
  const visibleRows = selectedMarketToken ? [selectedMarketToken] : rows;
  const sortedVisibleRows = sortTokenMarketplaceRows(
    visibleRows,
    tokenMarketSortMode,
    workMarketFloorSats,
  );
  const tokenMarketPage = pagedItems(
    sortedVisibleRows,
    tokenMarketPageIndex,
    TOKEN_LIST_PREVIEW_COUNT,
  );
  const tokenListingPage = pagedItems(
    sortedMarketListings,
    tokenListingPageIndex,
    TOKEN_LIST_PREVIEW_COUNT,
  );
  const localTokenMarketLogPage = pagedItems(
    tokenMarketLogItems,
    tokenMarketLogPageIndex,
    TOKEN_LIST_PREVIEW_COUNT,
  );
  const activeRemoteTokenMarketLogPage =
    remoteTokenMarketLogPage?.key === tokenMarketLogKey
      ? historyPageToPagedItems(
          remoteTokenMarketLogPage.page,
          tokenMarketLogPageIndex,
          TOKEN_LIST_PREVIEW_COUNT,
        )
      : undefined;
  const tokenMarketLogPage =
    activeRemoteTokenMarketLogPage ?? localTokenMarketLogPage;
  const hasTokenMarketLogItems = tokenMarketLogPage.totalCount > 0;
  const sealedListings = marketListings.filter((listing) =>
    tokenSaleAuthorizationUsesSaleTicketAnchor(listing.saleAuthorization),
  );
  const confirmedTokens = rows.filter((token) => token.confirmed);
  const confirmedSupply = rows.reduce(
    (total, token) => total + token.confirmedSupply,
    0,
  );
  const workMarketFloorUsd = satsToUsd(workMarketFloorSats, btcUsd);
  const workMarketNetworkUsd = workFloorQuote
    ? satsToUsd(workFloorQuote.networkValueSats, btcUsd)
    : 0;
  const workRow = rows.find(
    (token) =>
      token.tokenId === WORK_TOKEN_ID || token.ticker === WORK_TOKEN_TICKER,
  );
  const selectedMarketTokenIsWork = Boolean(
    selectedMarketToken &&
      (selectedMarketToken.tokenId === WORK_TOKEN_ID ||
        selectedMarketToken.ticker === WORK_TOKEN_TICKER),
  );
  const workFloorChartPoints = workFloorQuote?.chartPoints ?? [];
  const workFloorMinSats =
    workFloorChartPoints.length > 0
      ? Math.min(...workFloorChartPoints.map((point) => point.floorSats))
      : 0;
  const workFloorMaxSats =
    workFloorChartPoints.length > 0
      ? Math.max(...workFloorChartPoints.map((point) => point.floorSats))
      : 0;
  const selectedMarketChartPoints =
    selectedMarketToken && !selectedMarketTokenIsWork
      ? tokenMarketPricePointsFor(
          selectedMarketToken,
          networkListings.filter(
            (listing) => listing.tokenId === selectedMarketToken.tokenId,
          ),
          sales.filter(
            (sale) =>
              sale.network === network &&
              sale.tokenId === selectedMarketToken.tokenId,
          ),
        ).filter((point) => point.confirmed)
      : [];
  const selectedMarketChartMinSats = selectedMarketChartPoints.length
    ? Math.min(...selectedMarketChartPoints.map((point) => point.priceSats))
    : 0;
  const selectedMarketChartMaxSats = selectedMarketChartPoints.length
    ? Math.max(...selectedMarketChartPoints.map((point) => point.priceSats))
    : 0;
  const marketPriceLabelFor = (token: TokenMarketplaceRow) => {
    if (token.tokenId === WORK_TOKEN_ID && workMarketFloorSats > 0) {
      return `${tokenSatsPerUnit(workMarketFloorSats)} sat floor`;
    }

    if (token.lowestAskPricePerToken > 0) {
      return `${tokenSatsPerUnit(token.lowestAskPricePerToken)} sat ask`;
    }

    return `${tokenSatsPerUnit(token.pricePerToken)} sat mint`;
  };
  const marketUsdFor = (token: TokenMarketplaceRow) =>
    token.tokenId === WORK_TOKEN_ID && workMarketFloorSats > 0
      ? satsToUsd(workMarketFloorSats, btcUsd)
      : satsToUsd(token.pricePerToken, btcUsd);

  return (
    <>
      <div className="id-launch-stats marketplace-workspace-stats token-market-stats">
        <div>
          <strong>{confirmedTokens.length.toLocaleString()}</strong>
          <span>Confirmed tokens</span>
        </div>
        <div>
          <strong>{confirmedSupply.toLocaleString()}</strong>
          <span>Confirmed supply</span>
        </div>
        <div>
          <strong>{marketListings.length.toLocaleString()}</strong>
          <span>{selectedMarketToken ? "Token listings" : "Open listings"}</span>
        </div>
        <div>
          <strong>{sealedListings.length.toLocaleString()}</strong>
          <span>Sealed listings</span>
        </div>
      </div>

      <div className="ids-content marketplace-content token-market-content">
        {!selectedMarketToken || selectedMarketTokenIsWork ? (
          <section className="id-card ids-registry-card token-market-card marketplace-work-floor-card">
            <div className="id-card-head">
              <div className="empty-icon" aria-hidden="true">
                <TrendingUp size={24} />
              </div>
              <div>
                <h3>WORK Market Price</h3>
                <p>
                  WORK uses the network floor as its reference price. Listings
                  can clear above or below it.
                </p>
              </div>
            </div>

            {workFloorQuote && workMarketFloorSats > 0 ? (
              <>
                <div
                  className="id-launch-stats token-floor-stats"
                  aria-label="WORK market price"
                >
                  <div>
                    <span>Network floor</span>
                    <strong>
                      {tokenSatsPerUnit(workMarketFloorSats)} sats / WORK
                    </strong>
                  </div>
                  <div>
                    <span>USD/WORK</span>
                    <strong>{tokenUsd(workMarketFloorUsd)}</strong>
                  </div>
                  <div>
                    <span>Network value</span>
                    <strong>
                      {Math.round(
                        workFloorQuote.networkValueSats,
                      ).toLocaleString()}{" "}
                      sats
                    </strong>
                  </div>
                  <div>
                    <span>Network USD</span>
                    <strong>{tokenUsd(workMarketNetworkUsd)}</strong>
                  </div>
                  <div>
                    <span>Best ask</span>
                    <strong>
                      {workRow?.lowestAskPricePerToken
                        ? `${tokenSatsPerUnit(workRow.lowestAskPricePerToken)} sats / WORK`
                        : "No asks"}
                    </strong>
                  </div>
                </div>

                {workFloorChartPoints.length > 1 ? (
                  <>
                    <div className="work-floor-chart-toolbar">
                      <div
                        className="network-tabs work-floor-chart-toggle"
                        aria-label="WORK market chart unit"
                      >
                        {(
                          [
                            ["sats", "Sats"],
                            ["usd", "USD"],
                          ] as const
                        ).map(([unit, label]) => (
                          <button
                            aria-pressed={workFloorChartUnit === unit}
                            key={unit}
                            onClick={() => setWorkFloorChartUnit(unit)}
                            type="button"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <WorkFloorChart
                      btcUsd={btcUsd}
                      points={workFloorChartPoints}
                      unit={workFloorChartUnit}
                    />
                    <div className="work-floor-chart-meta">
                      <span>
                        Low{" "}
                        {workFloorPriceLabel(
                          workFloorMinSats,
                          btcUsd,
                          workFloorChartUnit,
                        )}
                      </span>
                      <span>
                        High{" "}
                        {workFloorPriceLabel(
                          workFloorMaxSats,
                          btcUsd,
                          workFloorChartUnit,
                        )}
                      </span>
                      <span>
                        {workFloorChartPoints.length.toLocaleString()}{" "}
                        confirmed points
                      </span>
                    </div>
                  </>
                ) : null}

                <p className="field-note">
                  Refreshed {formatDate(workFloorQuote.indexedAt)} from
                  confirmed Computer value across{" "}
                  {Math.round(
                    workFloorQuote.stats?.confirmedComputerActions ?? 0,
                  ).toLocaleString()}{" "}
                  confirmed actions.
                </p>
              </>
            ) : (
              <p className="field-note">
                {workFloorLoading
                  ? "Loading WORK market price..."
                  : "Refresh Marketplace to load the WORK market price."}
              </p>
            )}
          </section>
        ) : null}

        {selectedMarketToken && !selectedMarketTokenIsWork ? (
          <section className="id-card ids-registry-card token-market-card">
            <div className="id-card-head">
              <div className="empty-icon" aria-hidden="true">
                <TrendingUp size={24} />
              </div>
              <div>
                <h3>{selectedMarketToken.ticker} Market Chart</h3>
                <p>
                  Confirmed deploy price, sale prices, and active asks for this
                  token market.
                </p>
              </div>
            </div>
            <div
              className="id-launch-stats token-floor-stats"
              aria-label={`${selectedMarketToken.ticker} market price`}
            >
              <div>
                <span>Mint price</span>
                <strong>
                  {tokenSatsPerUnit(selectedMarketToken.pricePerToken)} sats /{" "}
                  {selectedMarketToken.ticker}
                </strong>
              </div>
              <div>
                <span>Lowest ask</span>
                <strong>
                  {selectedMarketToken.lowestAskPricePerToken > 0
                    ? `${tokenSatsPerUnit(selectedMarketToken.lowestAskPricePerToken)} sats / ${selectedMarketToken.ticker}`
                    : "No asks"}
                </strong>
              </div>
              <div>
                <span>Last sale</span>
                <strong>
                  {selectedMarketToken.lastSalePricePerToken > 0
                    ? `${tokenSatsPerUnit(selectedMarketToken.lastSalePricePerToken)} sats / ${selectedMarketToken.ticker}`
                    : "No sales"}
                </strong>
              </div>
              <div>
                <span>USD/token</span>
                <strong>
                  {tokenUsd(satsToUsd(selectedMarketToken.pricePerToken, btcUsd))}
                </strong>
              </div>
            </div>
            {selectedMarketChartPoints.length > 0 ? (
              <>
                <div className="work-floor-chart-toolbar">
                  <div
                    className="network-tabs work-floor-chart-toggle"
                    aria-label={`${selectedMarketToken.ticker} market chart unit`}
                  >
                    {(
                      [
                        ["sats", "Sats"],
                        ["usd", "USD"],
                      ] as const
                    ).map(([unit, label]) => (
                      <button
                        aria-pressed={tokenMarketChartUnit === unit}
                        key={unit}
                        onClick={() => setTokenMarketChartUnit(unit)}
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <TokenMarketPriceChart
                  btcUsd={btcUsd}
                  points={selectedMarketChartPoints}
                  ticker={selectedMarketToken.ticker}
                  unit={tokenMarketChartUnit}
                />
                <div className="work-floor-chart-meta">
                  <span>
                    Low{" "}
                    {tokenMarketPriceLabel(
                      selectedMarketChartMinSats,
                      btcUsd,
                      selectedMarketToken.ticker,
                      tokenMarketChartUnit,
                    )}
                  </span>
                  <span>
                    High{" "}
                    {tokenMarketPriceLabel(
                      selectedMarketChartMaxSats,
                      btcUsd,
                      selectedMarketToken.ticker,
                      tokenMarketChartUnit,
                    )}
                  </span>
                  <span>
                    {selectedMarketChartPoints.length.toLocaleString()} confirmed
                    points
                  </span>
                </div>
              </>
            ) : (
              <p className="field-note">
                This token has no confirmed market points yet. The mint price
                remains the starting reference until listings or sales confirm.
              </p>
            )}
          </section>
        ) : null}

        <section className="id-card ids-registry-card token-market-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <TrendingUp size={24} />
            </div>
            <div>
              <h3>
                {selectedMarketToken
                  ? `${selectedMarketToken.ticker} Market`
                  : "Token Markets"}
              </h3>
              <p>
                {selectedMarketToken
                  ? "This view only shows the selected token and its sale tickets."
                  : "Tokens list, seal, delist, and buy through the same sale-ticket settlement model used by IDs."}
              </p>
            </div>
            {selectedMarketToken ? (
              <button
                className="secondary small"
                onClick={clearTokenMarket}
                type="button"
              >
                <span className="button-content">
                  <ArrowLeft size={15} />
                  <span>All tokens</span>
                </span>
              </button>
            ) : null}
          </div>

          {!selectedMarketToken ? (
            <MarketplaceSortControl
              onChange={setTokenMarketSortMode}
              value={tokenMarketSortMode}
            />
          ) : null}

          {rows.length === 0 ? (
            <div className="empty-state">
              <Wallet size={28} />
              <h3>No tokens indexed yet</h3>
              <p>Create a token before token markets can open.</p>
            </div>
          ) : (
            <div className="token-market-grid">
              {tokenMarketPage.items.map((token) => (
                <article className="id-record token-market-row" key={token.tokenId}>
                  <div>
                    <strong>{token.ticker}</strong>
                    <span>{token.confirmed ? "Confirmed" : "Pending"}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>Supply</dt>
                      <dd>
                        {token.confirmedSupply.toLocaleString()} /{" "}
                        {token.maxSupply.toLocaleString()}
                      </dd>
                    </div>
                    <div>
                      <dt>Holders</dt>
                      <dd>{token.holderCount.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Listings</dt>
                      <dd>{token.openListings.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Floor / Ask</dt>
                      <dd>{marketPriceLabelFor(token)}</dd>
                    </div>
                    <div>
                      <dt>Last Sale</dt>
                      <dd>
                        {token.lastSalePricePerToken > 0
                          ? `${tokenSatsPerUnit(token.lastSalePricePerToken)} sat`
                          : "none"}
                      </dd>
                    </div>
                  </dl>
                  <ProgressBar
                    label={`${token.ticker} market supply progress`}
                    progress={token.progress}
                  />
                  <p className="field-note">
                    Registry {shortAddress(token.registryAddress)} ·{" "}
                    {token.pendingMints.toLocaleString()} pending mints ·{" "}
                    {tokenUsd(marketUsdFor(token))} per token
                    {address
                      ? ` · Your balance ${token.walletBalance.toLocaleString()} ${token.ticker}`
                      : ""}
                  </p>
                  <div className="id-record-actions">
                    <button
                      className="primary small"
                      onClick={() => openTokenMarket(token)}
                      type="button"
                    >
                      Market
                    </button>
                    {onOpenTokenWorkspace ? (
                      <button
                        className="secondary small"
                        onClick={() => onOpenTokenWorkspace(token)}
                        type="button"
                      >
                        <span className="button-content">
                          <ArrowUpRight size={15} />
                          <span>Token</span>
                        </span>
                      </button>
                    ) : (
                      <a
                        className="secondary small"
                        href={tokenDetailHref(token)}
                      >
                        <span className="button-content">
                          <ArrowUpRight size={15} />
                          <span>Token</span>
                        </span>
                      </a>
                    )}
                    {onOpenWalletWorkspace ? (
                      <button
                        className="secondary small"
                        onClick={() => onOpenWalletWorkspace(token)}
                        type="button"
                      >
                        <span className="button-content">
                          <Wallet size={15} />
                          <span>Wallet</span>
                        </span>
                      </button>
                    ) : (
                      <a
                        className="secondary small"
                        href={appHref(WALLET_APP_URL, LOCAL_WALLET_APP_URL)}
                      >
                        <span className="button-content">
                          <Wallet size={15} />
                          <span>Wallet</span>
                        </span>
                      </a>
                    )}
                    <a
                      className="secondary small"
                      href={explorerTxUrl(token.txid, token.network)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <span className="button-content">
                        <ArrowUpRight size={15} />
                        <span>Deploy TX</span>
                      </span>
                    </a>
                  </div>
                </article>
              ))}
            </div>
          )}
          <PaginationControls
            label="Token markets"
            onPageChange={setTokenMarketPageIndex}
            page={tokenMarketPage}
          />
        </section>

        <section className="id-card token-market-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <Wallet size={24} />
            </div>
            <div>
              <h3>Token Sale Tickets</h3>
              <p>
                {selectedMarketToken
                  ? `${selectedMarketToken.ticker} listings only. Buyers spend the sealed ticket and pay the seller plus registry.`
                  : "Open listings reserve seller balance, then buyers spend the sealed ticket and pay the seller plus registry."}
              </p>
            </div>
          </div>
          <div className="listing-fee-control token-listing-fee-control">
            <div>
              <strong>Buy fee rate</strong>
              <span>Used when buying token sale tickets.</span>
            </div>
            <FeeRateControl feeRate={feeRate} setFeeRate={setFeeRate} />
          </div>
          <MarketplaceSortControl
            onChange={setTokenListingSortMode}
            value={tokenListingSortMode}
          />
          {marketListings.length ? (
            <div className="token-market-grid">
              {tokenListingPage.items.map((listing) => {
                const sealed = tokenSaleAuthorizationUsesSaleTicketAnchor(
                  listing.saleAuthorization,
                );
                const listingUnitSats =
                  listing.amount > 0 ? listing.priceSats / listing.amount : 0;
                const listingToken = rows.find(
                  (token) => token.tokenId === listing.tokenId,
                );
                const listingReferenceSats =
                  listing.tokenId === WORK_TOKEN_ID && workMarketFloorSats > 0
                    ? workMarketFloorSats
                    : listingToken?.lastSalePricePerToken ||
                      listingToken?.pricePerToken ||
                      0;
                const listingReferenceLabel =
                  listing.tokenId === WORK_TOKEN_ID && workMarketFloorSats > 0
                    ? "market floor"
                    : listingToken?.lastSalePricePerToken
                      ? "last sale"
                      : listingToken?.pricePerToken
                        ? "mint price"
                        : "reference";
                const listingDeltaPct =
                  listingReferenceSats > 0 && listingUnitSats > 0
                    ? (listingUnitSats - listingReferenceSats) /
                      listingReferenceSats
                    : 0;
                const listingMarketLabel =
                  listingReferenceSats > 0 && listingUnitSats > 0
                    ? Math.abs(listingDeltaPct) <= 0.01
                      ? "Market"
                      : `${listingDeltaPct > 0 ? "+" : ""}${(listingDeltaPct * 100).toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                          minimumFractionDigits: 1,
                        })}%`
                    : "n/a";
                const buyLabel = !address
                  ? "Connect to buy"
                  : !sealed
                    ? "Needs seal"
                    : listing.sellerAddress === address
                      ? "Your listing"
                      : listing.saleAuthorization.buyerAddress &&
                          listing.saleAuthorization.buyerAddress !== address
                        ? "Buyer locked"
                        : "Buy";
                return (
                  <article
                    className="id-record token-market-row"
                    key={listing.listingId}
                  >
                    <div>
                      <strong>{listing.ticker}</strong>
                      <span>{sealed ? "Sealed" : "Waiting for seal"}</span>
                    </div>
                    <dl>
                      <div>
                        <dt>Amount</dt>
                        <dd>{listing.amount.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Price</dt>
                        <dd>{listing.priceSats.toLocaleString()} sats</dd>
                      </div>
                      <div>
                        <dt>Unit</dt>
                        <dd>
                          {tokenSatsPerUnit(listingUnitSats)} sat /{" "}
                          {listing.ticker}
                        </dd>
                      </div>
                      <div>
                        <dt>Market</dt>
                        <dd>{listingMarketLabel}</dd>
                      </div>
                      <div>
                        <dt>Seller</dt>
                        <dd>{shortAddress(listing.sellerAddress)}</dd>
                      </div>
                    </dl>
                    <p className="field-note">
                      Reference:{" "}
                      {listingReferenceSats > 0
                        ? `${tokenSatsPerUnit(listingReferenceSats)} sats / ${listing.ticker} ${listingReferenceLabel}`
                        : "none yet"}
                    </p>
                    <div className="id-record-actions">
                      <button
                        className="primary small"
                        disabled={busy}
                        onClick={() => buyListing(listing)}
                        type="button"
                      >
                        {buyLabel}
                      </button>
                      <a
                        className="secondary small"
                        href={explorerTxUrl(listing.listingId, listing.network)}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <span className="button-content">
                          <ArrowUpRight size={15} />
                          <span>Listing TX</span>
                        </span>
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <Wallet size={28} />
              <h3>No token listings yet</h3>
              <p>
                {selectedMarketToken
                  ? `No ${selectedMarketToken.ticker} sale tickets are open yet.`
                  : "List from Wallet to open a token sale ticket."}
              </p>
            </div>
          )}
          <PaginationControls
            label="Sale tickets"
            onPageChange={setTokenListingPageIndex}
            page={tokenListingPage}
          />
        </section>

        <section className="id-card token-market-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <FileText size={24} />
            </div>
            <div>
              <h3>Token Sales & Listings Log</h3>
              <p>
                {selectedMarketToken
                  ? `${selectedMarketToken.ticker} listings and sale settlements.`
                  : "Listings and sale settlements across token markets."}
              </p>
            </div>
          </div>
          {hasTokenMarketLogItems ? (
            <div className="token-market-grid">
              {tokenMarketLogPage.items.map((item) => {
                if (item.kind === "closed-listing") {
                  const closedListing = item.closedListing;
                  const unitSats =
                    closedListing.amount > 0
                      ? closedListing.priceSats / closedListing.amount
                      : 0;
                  const closedTxid =
                    closedListing.closedTxid || closedListing.listingId;
                  const closedAt =
                    closedListing.closedAt ?? closedListing.createdAt;
                  return (
                    <article
                      className="id-record token-market-row"
                      key={`closed-listing-${closedListing.listingId}-${closedTxid}`}
                    >
                      <div>
                        <strong>
                          {closedListing.amount.toLocaleString()}{" "}
                          {closedListing.ticker}
                        </strong>
                        <span>
                          {closedListing.closedConfirmed
                            ? "Closed listing"
                            : "Closing listing"}
                        </span>
                      </div>
                      <dl>
                        <div>
                          <dt>Price</dt>
                          <dd>{closedListing.priceSats.toLocaleString()} sats</dd>
                        </div>
                        <div>
                          <dt>Unit</dt>
                          <dd>
                            {tokenSatsPerUnit(unitSats)} sat /{" "}
                            {closedListing.ticker}
                          </dd>
                        </div>
                        <div>
                          <dt>Seller</dt>
                          <dd>{shortAddress(closedListing.sellerAddress)}</dd>
                        </div>
                        <div>
                          <dt>Closed</dt>
                          <dd>{formatDate(closedAt)}</dd>
                        </div>
                        <div>
                          <dt>Listed</dt>
                          <dd>{formatDate(closedListing.createdAt)}</dd>
                        </div>
                      </dl>
                      <p className="field-note">
                        Sale ticket {shortAddress(closedListing.listingId)} spent
                        {closedListing.closedTxid
                          ? ` by ${shortAddress(closedListing.closedTxid)}.`
                          : "."}
                      </p>
                      <div className="id-record-actions">
                        {closedListing.closedTxid ? (
                          <a
                            className="secondary small"
                            href={explorerTxUrl(
                              closedListing.closedTxid,
                              closedListing.network,
                            )}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <span className="button-content">
                              <ArrowUpRight size={15} />
                              <span>Close TX</span>
                            </span>
                          </a>
                        ) : null}
                        <a
                          className="secondary small"
                          href={explorerTxUrl(
                            closedListing.listingId,
                            closedListing.network,
                          )}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <span className="button-content">
                            <ArrowUpRight size={15} />
                            <span>Listing TX</span>
                          </span>
                        </a>
                      </div>
                    </article>
                  );
                }

                if (item.kind === "sale") {
                  const unitSats =
                    item.sale.amount > 0
                      ? item.sale.priceSats / item.sale.amount
                      : 0;
                  return (
                    <article
                      className="id-record token-market-row"
                      key={`sale-${item.sale.txid}`}
                    >
                      <div>
                        <strong>
                          {item.sale.amount.toLocaleString()}{" "}
                          {item.sale.ticker}
                        </strong>
                        <span>
                          {item.sale.confirmed
                            ? "Confirmed sale"
                            : "Pending sale"}
                        </span>
                      </div>
                      <dl>
                        <div>
                          <dt>Price</dt>
                          <dd>{item.sale.priceSats.toLocaleString()} sats</dd>
                        </div>
                        <div>
                          <dt>Unit</dt>
                          <dd>
                            {tokenSatsPerUnit(unitSats)} sat /{" "}
                            {item.sale.ticker}
                          </dd>
                        </div>
                        <div>
                          <dt>Seller</dt>
                          <dd>{shortAddress(item.sale.sellerAddress)}</dd>
                        </div>
                        <div>
                          <dt>Buyer</dt>
                          <dd>{shortAddress(item.sale.buyerAddress)}</dd>
                        </div>
                        <div>
                          <dt>Date</dt>
                          <dd>{formatDate(item.sale.createdAt)}</dd>
                        </div>
                      </dl>
                      <p className="field-note">
                        Listing {shortAddress(item.sale.listingId)} settled for{" "}
                        {item.sale.paidSats.toLocaleString()} paid sats.
                      </p>
                      <div className="id-record-actions">
                        <a
                          className="secondary small"
                          href={explorerTxUrl(item.sale.txid, item.sale.network)}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <span className="button-content">
                            <ArrowUpRight size={15} />
                            <span>Sale TX</span>
                          </span>
                        </a>
                        <a
                          className="secondary small"
                          href={explorerTxUrl(
                            item.sale.listingId,
                            item.sale.network,
                          )}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <span className="button-content">
                            <ArrowUpRight size={15} />
                            <span>Listing TX</span>
                          </span>
                        </a>
                      </div>
                    </article>
                  );
                }

                const sealed = tokenSaleAuthorizationUsesSaleTicketAnchor(
                  item.listing.saleAuthorization,
                );
                const unitSats =
                  item.listing.amount > 0
                    ? item.listing.priceSats / item.listing.amount
                    : 0;
                const buyerLock =
                  item.listing.saleAuthorization.buyerAddress || "";
                return (
                  <article
                    className="id-record token-market-row"
                    key={`listing-${item.listing.listingId}`}
                  >
                    <div>
                      <strong>
                        {item.listing.amount.toLocaleString()}{" "}
                        {item.listing.ticker}
                      </strong>
                      <span>
                        {!item.listing.confirmed
                          ? "Pending listing"
                          : sealed
                            ? "Sealed listing"
                            : "Waiting for seal"}
                      </span>
                    </div>
                    <dl>
                      <div>
                        <dt>Price</dt>
                        <dd>{item.listing.priceSats.toLocaleString()} sats</dd>
                      </div>
                      <div>
                        <dt>Unit</dt>
                        <dd>
                          {tokenSatsPerUnit(unitSats)} sat /{" "}
                          {item.listing.ticker}
                        </dd>
                      </div>
                      <div>
                        <dt>Seller</dt>
                        <dd>{shortAddress(item.listing.sellerAddress)}</dd>
                      </div>
                      <div>
                        <dt>Buyer lock</dt>
                        <dd>{buyerLock ? shortAddress(buyerLock) : "Open"}</dd>
                      </div>
                      <div>
                        <dt>Date</dt>
                        <dd>{formatDate(item.listing.createdAt)}</dd>
                      </div>
                    </dl>
                    <p className="field-note">
                      Sale ticket {shortAddress(item.listing.listingId)}
                      {item.listing.sealTxid
                        ? ` sealed by ${shortAddress(item.listing.sealTxid)}.`
                        : "."}
                    </p>
                    <div className="id-record-actions">
                      <a
                        className="secondary small"
                        href={explorerTxUrl(
                          item.listing.listingId,
                          item.listing.network,
                        )}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <span className="button-content">
                          <ArrowUpRight size={15} />
                          <span>Listing TX</span>
                        </span>
                      </a>
                      {item.listing.sealTxid ? (
                        <a
                          className="secondary small"
                          href={explorerTxUrl(
                            item.listing.sealTxid,
                            item.listing.network,
                          )}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <span className="button-content">
                            <ArrowUpRight size={15} />
                            <span>Seal TX</span>
                          </span>
                        </a>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <FileText size={28} />
              <h3>No token market history yet</h3>
              <p>
                {selectedMarketToken
                  ? `${selectedMarketToken.ticker} has no listings or sales yet.`
                  : "Token listings and sales will appear here after they confirm or enter mempool."}
              </p>
            </div>
          )}
          {tokenMarketLogPageLoading ? (
            <p className="field-note">Loading full token market history...</p>
          ) : null}
          <PaginationControls
            label="Token sales and listings"
            onPageChange={setTokenMarketLogPageIndex}
            page={tokenMarketLogPage}
          />
        </section>
      </div>
    </>
  );
}

function MarketplaceApp({
  address,
  btcUsd,
  busy,
  canCreateSaleAuthorization,
  canPurchaseId,
  connectWallet,
  delistListing,
  disconnectWallet,
  feeRate,
  hasUnisat,
  idPurchaseBytes,
  idPurchaseOwnerAddress,
  idPurchaseReceiveAddress,
  idSaleAuthorization,
  idSaleBuyerAddress,
  idSalePriceSats,
  idSaleReceiveAddress,
  managedIdName,
  network,
  onNetworkChange,
  pendingEvents,
  publishListing,
  registryAddress,
  registryListings,
  registryRecords,
  registrySales,
  sealListing,
  setIdPurchaseOwnerAddress,
  setIdPurchaseReceiveAddress,
  setIdSaleBuyerAddress,
  setIdSalePriceSats,
  setIdSaleReceiveAddress,
  setFeeRate,
  setManagedIdName,
  status,
  submitPurchase,
  tokenClosedListings,
  tokenListings,
  tokenMints,
  tokenSales,
  tokens,
  tokenTransfers,
  workFloorLoading,
  workFloorQuote,
  buyTokenListing,
  useListing,
  onRefreshIds,
  onRefreshTokens,
}: {
  address: string;
  btcUsd: number;
  busy: boolean;
  canCreateSaleAuthorization: boolean;
  canPurchaseId: boolean;
  connectWallet: () => void;
  delistListing: (listing: PowIdListing) => void;
  disconnectWallet: () => void;
  feeRate: number;
  hasUnisat: boolean;
  idPurchaseBytes: number;
  idPurchaseOwnerAddress: string;
  idPurchaseReceiveAddress: string;
  idSaleAuthorization: string;
  idSaleBuyerAddress: string;
  idSalePriceSats: number;
  idSaleReceiveAddress: string;
  managedIdName: string;
  network: BitcoinNetwork;
  onNetworkChange: (network: BitcoinNetwork) => void;
  pendingEvents: PowIdPendingEvent[];
  publishListing: () => void;
  registryAddress: string;
  registryListings: PowIdListing[];
  registryRecords: PowIdRecord[];
  registrySales: PowIdMarketplaceSale[];
  sealListing: (listing: PowIdListing) => void;
  setIdPurchaseOwnerAddress: (value: string) => void;
  setIdPurchaseReceiveAddress: (value: string) => void;
  setIdSaleBuyerAddress: (value: string) => void;
  setIdSalePriceSats: (value: number) => void;
  setIdSaleReceiveAddress: (value: string) => void;
  setFeeRate: (value: number) => void;
  setManagedIdName: (value: string) => void;
  status: { tone: StatusTone; text: string };
  submitPurchase: (
    event?: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement>,
  ) => void;
  tokenClosedListings: PowTokenClosedListing[];
  tokenListings: PowTokenListing[];
  tokenMints: PowTokenMint[];
  tokenSales: PowTokenSale[];
  tokens: PowTokenDefinition[];
  tokenTransfers: PowTokenTransfer[];
  workFloorLoading: boolean;
  workFloorQuote?: WorkFloorQuote;
  buyTokenListing: (listing: PowTokenListing) => void;
  useListing: (listing: PowIdListing) => void;
  onRefreshIds: () => void;
  onRefreshTokens: () => void;
}) {
  const [marketplaceTab, setMarketplaceTab] = useState<MarketplaceTab>("ids");
  const confirmedRecords = registryRecords.filter((record) => record.confirmed);
  const pendingRecords = registryRecords.filter((record) => !record.confirmed);
  const ownerControlledIds = confirmedRecords.filter(
    (record) => record.ownerAddress === address,
  );
  const managedId =
    ownerControlledIds.find((record) => record.id === managedIdName) ??
    ownerControlledIds[0];
  const walletPendingEvents = pendingEvents.filter((event) =>
    pendingIdEventTouchesAddress(event, address),
  );
  const marketplaceStats = marketplaceStatsFromSales(registrySales);
  const sealedTokenListings = tokenListings.filter((listing) =>
    tokenSaleAuthorizationUsesSaleTicketAnchor(listing.saleAuthorization),
  );
  const confirmedTokenCount = tokens.filter((token) => token.confirmed).length;
  const scopedStatus = marketplaceStatusForTab({
    active: marketplaceTab,
    idSummary: {
      tone: "good",
      text: `ID marketplace loaded. ${confirmedRecords.length.toLocaleString()} confirmed, ${registryListings.length.toLocaleString()} active listing${registryListings.length === 1 ? "" : "s"}, ${pendingRecords.length.toLocaleString()} pending.`,
    },
    status,
    tokenSummary: {
      tone: "good",
      text: `Token market loaded. ${confirmedTokenCount.toLocaleString()} confirmed token${confirmedTokenCount === 1 ? "" : "s"}, ${tokenListings.length.toLocaleString()} open listing${tokenListings.length === 1 ? "" : "s"}, ${sealedTokenListings.length.toLocaleString()} sealed.`,
    },
  });
  const refreshMarketplaceTab = () => {
    if (marketplaceTab === "tokens") {
      onRefreshTokens();
      return;
    }

    onRefreshIds();
  };

  return (
    <main className="id-launch-app marketplace-app">
      <AppHeader
        address={address}
        busy={busy}
        connectWallet={connectWallet}
        disconnectWallet={disconnectWallet}
        hasUnisat={hasUnisat}
        network={network}
        onNetworkChange={onNetworkChange}
        onRefresh={refreshMarketplaceTab}
        subtitle="Mainnet asset marketplace"
        title="ProofOfWork Marketplace"
      />

      <AppStatusRow persistent status={scopedStatus} />

      <section className="id-launch-main">
        <div
          className={`id-launch-hero${marketplaceTab === "tokens" ? " marketplace-token-hero" : ""}`}
        >
          <div>
            <span className="id-launch-kicker">ProofOfWork marketplace</span>
            <h2>Trade Bitcoin-native assets.</h2>
            <p>
              IDs and tokens trade through sale tickets: sellers reserve the
              asset, seal exact terms, and buyers settle on Bitcoin.
            </p>
          </div>

          {marketplaceTab === "ids" ? (
            <div className="id-launch-stats" aria-label="ID marketplace stats">
              <div>
                <strong>{registryRecords.length.toLocaleString()}</strong>
                <span>Total IDs</span>
              </div>
              <div>
                <strong>{registryListings.length.toLocaleString()}</strong>
                <span>Active Listings</span>
              </div>
              <div>
                <strong>{marketplaceStats.totalSales.toLocaleString()}</strong>
                <span>ID Sales</span>
              </div>
              <div>
                <strong>
                  {marketplaceStats.totalVolumeSats.toLocaleString()}
                </strong>
                <span>Volume sats</span>
              </div>
              <div>
                <strong>{pendingRecords.length.toLocaleString()}</strong>
                <span>Pending IDs</span>
              </div>
              <div>
                <strong>{marketplaceStats.pendingSales.toLocaleString()}</strong>
                <span>Pending Sales</span>
              </div>
            </div>
          ) : null}
        </div>

        <MarketplaceTabs
          active={marketplaceTab}
          idCount={registryListings.length}
          onChange={setMarketplaceTab}
          tokenCount={tokens.length}
        />

        {marketplaceTab === "ids" ? (
        <div className="ids-content marketplace-content">
          <section className="id-card">
            <div className="id-card-head">
              <div className="empty-icon" aria-hidden="true">
                <Wallet size={24} />
              </div>
              <div>
                <h3>List an ID</h3>
                <p>
                  Publish an on-chain listing for one of your confirmed IDs.
                  Listings cost {ID_MUTATION_PRICE_SATS.toLocaleString()} sats.
                </p>
              </div>
            </div>

            {ownerControlledIds.length === 0 ? (
              <p className="field-note">
                {address
                  ? "This wallet does not own any confirmed IDs yet."
                  : "Connect the owner wallet to list confirmed IDs."}
              </p>
            ) : (
              <>
                <label>
                  ID
                  <select
                    value={managedId?.id ?? ""}
                    onChange={(event) => setManagedIdName(event.target.value)}
                  >
                    {ownerControlledIds.map((record) => (
                      <option
                        key={`${record.network}-${record.id}`}
                        value={record.id}
                      >
                        {record.id}@proofofwork.me
                      </option>
                    ))}
                  </select>
                </label>
                {managedId ? (
                  <dl className="id-manage-state">
                    <div>
                      <dt>Owner</dt>
                      <dd>{shortAddress(managedId.ownerAddress)}</dd>
                    </div>
                    <div>
                      <dt>Receives</dt>
                      <dd>{shortAddress(managedId.receiveAddress)}</dd>
                    </div>
                    <div>
                      <dt>Registry</dt>
                      <dd>{shortAddress(registryAddress)}</dd>
                    </div>
                  </dl>
                ) : null}
                <p className="field-note">
                  The published listing includes on-chain sale terms. Delisting
                  costs {ID_MUTATION_PRICE_SATS.toLocaleString()} sats and
                  transfers invalidate old listings.
                </p>
              </>
            )}
          </section>

          <IdMarketplaceCard
            busy={busy}
            canCreateSaleAuthorization={canCreateSaleAuthorization}
            canPurchaseId={canPurchaseId}
            feeRate={feeRate}
            idPurchaseBytes={idPurchaseBytes}
            idPurchaseOwnerAddress={idPurchaseOwnerAddress}
            idPurchaseReceiveAddress={idPurchaseReceiveAddress}
            idSaleAuthorization={idSaleAuthorization}
            idSaleBuyerAddress={idSaleBuyerAddress}
            idSalePriceSats={idSalePriceSats}
            idSaleReceiveAddress={idSaleReceiveAddress}
            managedId={managedId}
            network="livenet"
            publishListing={publishListing}
            setIdPurchaseOwnerAddress={setIdPurchaseOwnerAddress}
            setIdPurchaseReceiveAddress={setIdPurchaseReceiveAddress}
            setIdSaleBuyerAddress={setIdSaleBuyerAddress}
            setIdSalePriceSats={setIdSalePriceSats}
            setIdSaleReceiveAddress={setIdSaleReceiveAddress}
            setFeeRate={setFeeRate}
            status={status}
            submitPurchase={submitPurchase}
          />

          <MarketplaceListingList
            address={address}
            feeRate={feeRate}
            listings={registryListings}
            onDelist={delistListing}
            onSeal={sealListing}
            onUse={useListing}
            pendingEvents={pendingEvents}
            setFeeRate={setFeeRate}
          />

          <section className="id-card">
            <div className="id-card-head">
              <div className="empty-icon" aria-hidden="true">
                <Clock size={24} />
              </div>
              <div>
                <h3>Pending Transfers</h3>
                <p>
                  Listings, purchases, and transfers touching your wallet stay
                  here until confirmation.
                </p>
              </div>
            </div>
            <PendingIdEventList
              address={address}
              events={walletPendingEvents}
              empty={
                address
                  ? "No pending marketplace transfers for this wallet."
                  : "Connect a wallet to see pending marketplace transfers."
              }
            />
          </section>

          <section className="id-card ids-registry-card">
            <div className="id-card-head">
              <div className="empty-icon" aria-hidden="true">
                <Inbox size={24} />
              </div>
              <div>
                <h3>Registry Supply</h3>
                <p>
                  Confirmed IDs are the assets. The public listing book will
                  build on the same registry.
                </p>
              </div>
            </div>
            <IdRecordList
              records={confirmedRecords}
              empty="No confirmed registry records found yet."
              initialLimit={24}
              searchPlaceholder="Search registry supply"
            />
          </section>
        </div>
        ) : (
          <TokenMarketplacePanel
            address={address}
            btcUsd={btcUsd}
            busy={busy}
            buyListing={buyTokenListing}
            closedListings={tokenClosedListings}
            feeRate={feeRate}
            listings={tokenListings}
            mints={tokenMints}
            network="livenet"
            sales={tokenSales}
            setFeeRate={setFeeRate}
            tokens={tokens}
            transfers={tokenTransfers}
            workFloorLoading={workFloorLoading}
            workFloorQuote={workFloorQuote}
          />
        )}
      </section>

      <SocialFooter />
    </main>
  );
}

function MarketplaceWorkspace({
  address,
  btcUsd,
  busy,
  canCreateSaleAuthorization,
  canPurchaseId,
  delistListing,
  feeRate,
  idPurchaseBytes,
  idPurchaseOwnerAddress,
  idPurchaseReceiveAddress,
  idSaleAuthorization,
  idSaleBuyerAddress,
  idSalePriceSats,
  idSaleReceiveAddress,
  managedIdName,
  network,
  pendingEvents,
  publishListing,
  registryAddress,
  registryListings,
  registryRecords,
  registrySales,
  sealListing,
  setIdPurchaseOwnerAddress,
  setIdPurchaseReceiveAddress,
  setIdSaleBuyerAddress,
  setIdSalePriceSats,
  setIdSaleReceiveAddress,
  setFeeRate,
  setManagedIdName,
  status,
  submitPurchase,
  buyTokenListing,
  tokenClosedListings,
  tokenListings,
  tokenMints,
  tokenSales,
  tokens,
  tokenTransfers,
  workFloorLoading,
  workFloorQuote,
  onOpenTokenWorkspace,
  onOpenWalletWorkspace,
  useListing,
  onRefreshIds,
  onRefreshTokens,
}: {
  address: string;
  btcUsd: number;
  busy: boolean;
  canCreateSaleAuthorization: boolean;
  canPurchaseId: boolean;
  delistListing: (listing: PowIdListing) => void;
  feeRate: number;
  idPurchaseBytes: number;
  idPurchaseOwnerAddress: string;
  idPurchaseReceiveAddress: string;
  idSaleAuthorization: string;
  idSaleBuyerAddress: string;
  idSalePriceSats: number;
  idSaleReceiveAddress: string;
  managedIdName: string;
  network: BitcoinNetwork;
  pendingEvents: PowIdPendingEvent[];
  publishListing: () => void;
  registryAddress: string;
  registryListings: PowIdListing[];
  registryRecords: PowIdRecord[];
  registrySales: PowIdMarketplaceSale[];
  sealListing: (listing: PowIdListing) => void;
  setIdPurchaseOwnerAddress: (value: string) => void;
  setIdPurchaseReceiveAddress: (value: string) => void;
  setIdSaleBuyerAddress: (value: string) => void;
  setIdSalePriceSats: (value: number) => void;
  setIdSaleReceiveAddress: (value: string) => void;
  setFeeRate: (value: number) => void;
  setManagedIdName: (value: string) => void;
  status: { tone: StatusTone; text: string };
  submitPurchase: (
    event?: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement>,
  ) => void;
  buyTokenListing: (listing: PowTokenListing) => void;
  tokenClosedListings: PowTokenClosedListing[];
  tokenListings: PowTokenListing[];
  tokenMints: PowTokenMint[];
  tokenSales: PowTokenSale[];
  tokens: PowTokenDefinition[];
  tokenTransfers: PowTokenTransfer[];
  workFloorLoading: boolean;
  workFloorQuote?: WorkFloorQuote;
  onOpenTokenWorkspace?: (token?: PowTokenDefinition) => void;
  onOpenWalletWorkspace?: (token?: PowTokenDefinition) => void;
  useListing: (listing: PowIdListing) => void;
  onRefreshIds: () => void;
  onRefreshTokens: () => void;
}) {
  const [marketplaceTab, setMarketplaceTab] = useState<MarketplaceTab>("ids");
  const confirmedRecords = registryRecords.filter(
    (record) => record.network === network && record.confirmed,
  );
  const pendingRecords = registryRecords.filter(
    (record) => record.network === network && !record.confirmed,
  );
  const networkListings = registryListings.filter(
    (listing) => listing.network === network,
  );
  const networkSales = registrySales.filter((sale) => sale.network === network);
  const marketplaceStats = marketplaceStatsFromSales(networkSales);
  const ownerControlledIds = confirmedRecords.filter(
    (record) => record.ownerAddress === address,
  );
  const managedId =
    ownerControlledIds.find((record) => record.id === managedIdName) ??
    ownerControlledIds[0];
  const walletPendingEvents = pendingEvents.filter(
    (event) =>
      event.network === network && pendingIdEventTouchesAddress(event, address),
  );
  const networkTokenCount = tokens.filter(
    (token) => token.network === network,
  ).length;
  const refreshMarketplaceTab = () => {
    if (marketplaceTab === "tokens") {
      onRefreshTokens();
      return;
    }

    onRefreshIds();
  };

  return (
    <section className="ids-workspace marketplace-workspace">
      <div className="files-toolbar">
        <div>
          <h2>Marketplace</h2>
          <span>
            {registryAddress
              ? `${networkListings.length.toLocaleString()} ID listings · ${networkTokenCount.toLocaleString()} tokens`
              : `No marketplace registry configured for ${networkLabel(network)}`}
          </span>
        </div>
        <button
          className="secondary small"
          disabled={busy || (marketplaceTab === "ids" && !registryAddress)}
          onClick={refreshMarketplaceTab}
          type="button"
        >
          <span className="button-content">
            <RefreshCw className={busy ? "refresh-spin" : ""} size={15} />
            <span>{busy ? "Refreshing" : "Refresh"}</span>
          </span>
        </button>
      </div>

      <MarketplaceTabs
        active={marketplaceTab}
        idCount={networkListings.length}
        onChange={setMarketplaceTab}
        tokenCount={networkTokenCount}
      />

      {marketplaceTab === "ids" ? (
        <>
      <div
        className="id-launch-stats marketplace-workspace-stats"
        aria-label="Marketplace stats"
      >
        <div>
          <strong>{networkListings.length.toLocaleString()}</strong>
          <span>Active Listings</span>
        </div>
        <div>
          <strong>{marketplaceStats.totalSales.toLocaleString()}</strong>
          <span>ID Sales</span>
        </div>
        <div>
          <strong>{marketplaceStats.totalVolumeSats.toLocaleString()}</strong>
          <span>Volume sats</span>
        </div>
        <div>
          <strong>{marketplaceStats.pendingSales.toLocaleString()}</strong>
          <span>Pending Sales</span>
        </div>
      </div>

      <div className="ids-content marketplace-content">
        <section className="id-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <Wallet size={24} />
            </div>
            <div>
              <h3>List an ID</h3>
              <p>
                Publish an on-chain listing for one of your confirmed IDs.
                Listings cost {ID_MUTATION_PRICE_SATS.toLocaleString()} sats.
              </p>
            </div>
          </div>

          {ownerControlledIds.length === 0 ? (
            <p className="field-note">
              {address
                ? "This wallet does not own any confirmed IDs yet."
                : "Connect the owner wallet to list confirmed IDs."}
            </p>
          ) : (
            <>
              <label>
                ID
                <select
                  value={managedId?.id ?? ""}
                  onChange={(event) => setManagedIdName(event.target.value)}
                >
                  {ownerControlledIds.map((record) => (
                    <option
                      key={`${record.network}-${record.id}`}
                      value={record.id}
                    >
                      {record.id}@proofofwork.me
                    </option>
                  ))}
                </select>
              </label>
              {managedId ? (
                <dl className="id-manage-state">
                  <div>
                    <dt>Owner</dt>
                    <dd>{shortAddress(managedId.ownerAddress)}</dd>
                  </div>
                  <div>
                    <dt>Receives</dt>
                    <dd>{shortAddress(managedId.receiveAddress)}</dd>
                  </div>
                  <div>
                    <dt>Registry</dt>
                    <dd>{shortAddress(registryAddress)}</dd>
                  </div>
                </dl>
              ) : null}
              <p className="field-note">
                The published listing includes on-chain sale terms. Delisting
                costs {ID_MUTATION_PRICE_SATS.toLocaleString()} sats and
                transfers invalidate old listings.
              </p>
            </>
          )}
        </section>

        <IdMarketplaceCard
          busy={busy}
          canCreateSaleAuthorization={canCreateSaleAuthorization}
          canPurchaseId={canPurchaseId}
          feeRate={feeRate}
          idPurchaseBytes={idPurchaseBytes}
          idPurchaseOwnerAddress={idPurchaseOwnerAddress}
          idPurchaseReceiveAddress={idPurchaseReceiveAddress}
          idSaleAuthorization={idSaleAuthorization}
          idSaleBuyerAddress={idSaleBuyerAddress}
          idSalePriceSats={idSalePriceSats}
          idSaleReceiveAddress={idSaleReceiveAddress}
          managedId={managedId}
          network={network}
          publishListing={publishListing}
          setIdPurchaseOwnerAddress={setIdPurchaseOwnerAddress}
          setIdPurchaseReceiveAddress={setIdPurchaseReceiveAddress}
          setIdSaleBuyerAddress={setIdSaleBuyerAddress}
          setIdSalePriceSats={setIdSalePriceSats}
          setIdSaleReceiveAddress={setIdSaleReceiveAddress}
          setFeeRate={setFeeRate}
          status={status}
          submitPurchase={submitPurchase}
        />

        <MarketplaceListingList
          address={address}
          feeRate={feeRate}
          listings={networkListings}
          onDelist={delistListing}
          onSeal={sealListing}
          onUse={useListing}
          pendingEvents={pendingEvents.filter(
            (event) => event.network === network,
          )}
          setFeeRate={setFeeRate}
        />

        <section className="id-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <Clock size={24} />
            </div>
            <div>
              <h3>Pending Transfers</h3>
              <p>
                Listings, purchases, and transfers touching your wallet stay
                here until confirmation.
              </p>
            </div>
          </div>
          <PendingIdEventList
            address={address}
            events={walletPendingEvents}
            empty={
              address
                ? "No pending marketplace transfers for this wallet."
                : "Connect a wallet to see pending marketplace transfers."
            }
          />
        </section>

        <section className="id-card ids-registry-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <Inbox size={24} />
            </div>
            <div>
              <h3>Registry Supply</h3>
              <p>
                Confirmed IDs are marketplace assets. The standalone marketplace
                uses the same registry.
              </p>
            </div>
          </div>
          <IdRecordList
            records={confirmedRecords}
            empty={
              registryAddress
                ? "No confirmed registry records found yet."
                : "Switch to Mainnet to browse the ID marketplace."
            }
            initialLimit={24}
            searchPlaceholder="Search registry supply"
          />
        </section>
      </div>
        </>
      ) : (
        <TokenMarketplacePanel
          address={address}
          btcUsd={btcUsd}
          busy={busy}
          buyListing={buyTokenListing}
          closedListings={tokenClosedListings}
          computerMode
          feeRate={feeRate}
          listings={tokenListings}
          mints={tokenMints}
          network={network}
          onOpenTokenWorkspace={onOpenTokenWorkspace}
          onOpenWalletWorkspace={onOpenWalletWorkspace}
          sales={tokenSales}
          setFeeRate={setFeeRate}
          tokens={tokens}
          transfers={tokenTransfers}
          workFloorLoading={workFloorLoading}
          workFloorQuote={workFloorQuote}
        />
      )}
    </section>
  );
}

function ContactsWorkspace({
  contacts,
  network,
  onAdd,
  onCompose,
  onRemove,
}: {
  contacts: ContactRecord[];
  network: BitcoinNetwork;
  onAdd: (name: string, target: string) => boolean | Promise<boolean>;
  onCompose: (contact: ContactRecord) => void;
  onRemove: (contact: ContactRecord) => void;
}) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) {
      return;
    }

    setSaving(true);
    try {
      if (await onAdd(name, target)) {
        setName("");
        setTarget("");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="contacts-workspace">
      <div className="files-toolbar">
        <div>
          <h2>Contacts</h2>
          <span>
            {contacts.length.toLocaleString()} local contact
            {contacts.length === 1 ? "" : "s"} on {networkLabel(network)}
          </span>
        </div>
      </div>

      <div className="ids-content contacts-content">
        <form className="id-card contact-form" onSubmit={submit}>
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <UserPlus size={24} />
            </div>
            <div>
              <h3>Add Contact</h3>
              <p>
                Save a Bitcoin address or confirmed ProofOfWork ID locally for
                compose.
              </p>
            </div>
          </div>

          <label>
            Name optional
            <input
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
              placeholder="Satoshi"
              value={name}
            />
          </label>

          <label>
            Address or ID
            <input
              autoComplete="off"
              onChange={(event) => setTarget(event.target.value)}
              placeholder={
                network === "livenet"
                  ? "bitcoin@proofofwork.me or bc1..."
                  : "tb1..."
              }
              spellCheck={false}
              value={target}
            />
          </label>

          <button className="primary" disabled={saving} type="submit">
            <span className="button-content">
              <UserPlus size={16} />
              <span>{saving ? "Saving" : "Save Contact"}</span>
            </span>
          </button>
        </form>

        <section className="id-card contacts-list-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <Users size={24} />
            </div>
            <div>
              <h3>Address Book</h3>
              <p>
                Contacts stay in this browser and are included in backup
                export/import.
              </p>
            </div>
          </div>

          {contacts.length === 0 ? (
            <p className="field-note">
              No contacts saved for {networkLabel(network)} yet.
            </p>
          ) : (
            <div className="id-record-list">
              {contacts.map((contact) => (
                <article
                  className="id-record contact-record"
                  key={contactKey(contact)}
                >
                  <div>
                    <strong>{contact.name}</strong>
                    <span>
                      {contact.source === "registry" ? "Registry" : "Manual"} ·{" "}
                      {networkLabel(contact.network)}
                    </span>
                  </div>
                  <dl>
                    <div>
                      <dt>Target</dt>
                      <dd>{contactTarget(contact)}</dd>
                    </div>
                    <div>
                      <dt>Address</dt>
                      <dd>{shortAddress(contact.address)}</dd>
                    </div>
                    <div>
                      <dt>Saved</dt>
                      <dd>{formatDate(contact.updatedAt)}</dd>
                    </div>
                  </dl>
                  <div className="id-record-actions">
                    <button
                      className="primary small"
                      onClick={() => onCompose(contact)}
                      type="button"
                    >
                      <span className="button-content">
                        <PenLine size={15} />
                        <span>Write</span>
                      </span>
                    </button>
                    <button
                      className="secondary small"
                      onClick={() => onRemove(contact)}
                      type="button"
                    >
                      <span className="button-content">
                        <Trash2 size={15} />
                        <span>Remove</span>
                      </span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function IdsWorkspace({
  address,
  busy,
  canRegister,
  contacts,
  feeRate,
  idName,
  idPgpKey,
  idReceiveAddress,
  idReceiverUpdateBytes,
  idTransferBytes,
  idTransferOwnerAddress,
  idTransferReceiveAddress,
  idUpdateReceiveAddress,
  managedIdName,
  network,
  pendingEvents,
  registryAddress,
  registryRecords,
  registrationBytes,
  lastRegisteredId,
  canTransfer,
  canUpdate,
  setFeeRate,
  setIdName,
  setIdPgpKey,
  setIdReceiveAddress,
  setIdTransferOwnerAddress,
  setIdTransferReceiveAddress,
  setIdUpdateReceiveAddress,
  setManagedIdName,
  onAddContact,
  onRefresh,
  submitTransfer,
  submitUpdate,
  submit,
}: {
  address: string;
  busy: boolean;
  canRegister: boolean;
  contacts: ContactRecord[];
  feeRate: number;
  idName: string;
  idPgpKey: string;
  idReceiveAddress: string;
  idReceiverUpdateBytes: number;
  idTransferBytes: number;
  idTransferOwnerAddress: string;
  idTransferReceiveAddress: string;
  idUpdateReceiveAddress: string;
  managedIdName: string;
  network: BitcoinNetwork;
  pendingEvents: PowIdPendingEvent[];
  registryAddress: string;
  registryRecords: PowIdRecord[];
  registrationBytes: number;
  lastRegisteredId?: PowIdRecord;
  canTransfer: boolean;
  canUpdate: boolean;
  setFeeRate: (value: number) => void;
  setIdName: (value: string) => void;
  setIdPgpKey: (value: string) => void;
  setIdReceiveAddress: (value: string) => void;
  setIdTransferOwnerAddress: (value: string) => void;
  setIdTransferReceiveAddress: (value: string) => void;
  setIdUpdateReceiveAddress: (value: string) => void;
  setManagedIdName: (value: string) => void;
  onAddContact: (record: PowIdRecord) => void;
  onRefresh: () => void;
  submitTransfer: (event: FormEvent<HTMLFormElement>) => void;
  submitUpdate: (event: FormEvent<HTMLFormElement>) => void;
  submit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const normalizedId = normalizePowId(idName);
  const idError = powIdError(normalizedId);
  const ownedIds = ownedPowIds(registryRecords, address);
  const ownerControlledIds = registryRecords.filter(
    (record) =>
      record.network === network &&
      record.confirmed &&
      record.ownerAddress === address,
  );
  const walletPendingEvents = pendingEvents.filter(
    (event) =>
      event.network === network && pendingIdEventTouchesAddress(event, address),
  );
  const managedId =
    ownerControlledIds.find((record) => record.id === managedIdName) ??
    ownerControlledIds[0];
  const receiverUpdateResolution = resolveRecipientInput(
    idUpdateReceiveAddress,
    network,
    registryRecords,
    registryAddress,
  );
  const receiverUpdateNote = idUpdateReceiveAddress.trim()
    ? receiveResolutionNote(receiverUpdateResolution)
    : "";
  const transferTargetResolution = resolvePowIdOwnerInput(
    idTransferOwnerAddress,
    network,
    registryRecords,
    registryAddress,
  );
  const transferTargetNote = idTransferOwnerAddress.trim()
    ? ownerResolutionNote(transferTargetResolution)
    : "";
  const transferReceiveResolution = idTransferReceiveAddress.trim()
    ? resolveRecipientInput(
        idTransferReceiveAddress,
        network,
        registryRecords,
        registryAddress,
      )
    : undefined;
  const transferReceiveNote = transferReceiveResolution
    ? receiveResolutionNote(transferReceiveResolution)
    : "";

  return (
    <section className="ids-workspace">
      <div className="files-toolbar">
        <div>
          <h2>ProofOfWork IDs</h2>
          <span>
            {registryAddress
              ? `${registryRecords.length} total registry record${registryRecords.length === 1 ? "" : "s"} · ${ownedIds.length} yours`
              : `No registry configured for ${networkLabel(network)}`}
          </span>
        </div>
        <button
          className="secondary small"
          disabled={busy || !registryAddress}
          onClick={onRefresh}
          type="button"
        >
          <span className="button-content">
            <RefreshCw className={busy ? "refresh-spin" : ""} size={15} />
            <span>{busy ? "Refreshing" : "Refresh"}</span>
          </span>
        </button>
      </div>

      <div className="ids-content">
        <form className="id-card" onSubmit={submit}>
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <AtSign size={24} />
            </div>
            <div>
              <h3>Register ID</h3>
              <p>
                First confirmed valid claim wins. Registration pays{" "}
                {ID_REGISTRATION_PRICE_SATS.toLocaleString()} sats to the
                registry.
              </p>
            </div>
          </div>

          <label>
            ID
            <div className="id-input-row">
              <input
                autoComplete="off"
                onChange={(event) => setIdName(event.target.value)}
                placeholder="user"
                spellCheck={false}
                value={idName}
              />
              <span>@proofofwork.me</span>
            </div>
          </label>
          {normalizedId && idError ? (
            <p className="field-note bad">{idError}</p>
          ) : null}

          <label>
            Owner
            <input readOnly value={address || "Connect UniSat"} />
          </label>

          <label>
            Receive address
            <input
              autoComplete="off"
              onChange={(event) => setIdReceiveAddress(event.target.value)}
              spellCheck={false}
              value={idReceiveAddress}
            />
          </label>

          <label>
            PGP public key optional
            <textarea
              onChange={(event) => setIdPgpKey(event.target.value)}
              placeholder="Paste an armored public key later when encryption is ready."
              value={idPgpKey}
            />
          </label>

          <FeeRateControl
            feeRate={feeRate}
            setFeeRate={setFeeRate}
            sidecar={
              <label>
                Registry
                <input readOnly value={registryAddress || "Not configured"} />
              </label>
            }
          />

          <div
            className={
              registrationBytes > MAX_DATA_CARRIER_BYTES
                ? "counter bad"
                : "counter"
            }
          >
            {registrationBytes.toLocaleString()} /{" "}
            {MAX_DATA_CARRIER_BYTES.toLocaleString()} OP_RETURN data-carrier
            bytes
          </div>

          <button className="primary" disabled={busy} type="submit">
            <span className="button-content">
              <AtSign size={16} />
              <span>{busy ? "Registering" : "Register ID"}</span>
            </span>
          </button>
        </form>

        <section className="id-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <Wallet size={24} />
            </div>
            <div>
              <h3>Manage ID</h3>
              <p>
                Current owners can update routing or transfer the asset. Each
                registry mutation pays {ID_MUTATION_PRICE_SATS.toLocaleString()}{" "}
                sats.
              </p>
            </div>
          </div>

          {ownerControlledIds.length === 0 ? (
            <p className="field-note">
              Connect the current owner wallet to manage confirmed IDs.
            </p>
          ) : (
            <>
              <label>
                ID
                <select
                  value={managedId?.id ?? ""}
                  onChange={(event) => setManagedIdName(event.target.value)}
                >
                  {ownerControlledIds.map((record) => (
                    <option
                      key={`${record.network}-${record.id}`}
                      value={record.id}
                    >
                      {record.id}@proofofwork.me
                    </option>
                  ))}
                </select>
              </label>

              {managedId ? (
                <dl className="id-manage-state">
                  <div>
                    <dt>Owner</dt>
                    <dd>{shortAddress(managedId.ownerAddress)}</dd>
                  </div>
                  <div>
                    <dt>Receives</dt>
                    <dd>{shortAddress(managedId.receiveAddress)}</dd>
                  </div>
                  <div>
                    <dt>Last Event</dt>
                    <dd>{shortAddress(managedId.txid)}</dd>
                  </div>
                </dl>
              ) : null}

              <FeeRateControl feeRate={feeRate} setFeeRate={setFeeRate} />

              <form className="id-action-form" onSubmit={submitUpdate}>
                <label>
                  New receive address or ID
                  <input
                    autoComplete="off"
                    onChange={(event) =>
                      setIdUpdateReceiveAddress(event.target.value)
                    }
                    spellCheck={false}
                    value={idUpdateReceiveAddress}
                  />
                </label>
                {receiverUpdateNote ? (
                  <p
                    className={
                      receiverUpdateResolution.error
                        ? "field-note bad"
                        : "field-note good"
                    }
                  >
                    {receiverUpdateNote}
                  </p>
                ) : null}
                <div
                  className={
                    idReceiverUpdateBytes > MAX_DATA_CARRIER_BYTES
                      ? "counter bad"
                      : "counter"
                  }
                >
                  {idReceiverUpdateBytes.toLocaleString()} /{" "}
                  {MAX_DATA_CARRIER_BYTES.toLocaleString()} OP_RETURN
                  data-carrier bytes
                </div>
                <button
                  className="secondary"
                  disabled={!canUpdate}
                  type="submit"
                >
                  <span className="button-content">
                    <RefreshCw size={15} />
                    <span>Update Receiver</span>
                  </span>
                </button>
              </form>

              <form className="id-action-form" onSubmit={submitTransfer}>
                <label>
                  New owner address or ID
                  <input
                    autoComplete="off"
                    onChange={(event) =>
                      setIdTransferOwnerAddress(event.target.value)
                    }
                    spellCheck={false}
                    value={idTransferOwnerAddress}
                  />
                </label>
                {transferTargetNote ? (
                  <p
                    className={
                      transferTargetResolution.error
                        ? "field-note bad"
                        : "field-note good"
                    }
                  >
                    {transferTargetNote}
                  </p>
                ) : null}
                <label>
                  New receive address or ID optional
                  <input
                    autoComplete="off"
                    onChange={(event) =>
                      setIdTransferReceiveAddress(event.target.value)
                    }
                    placeholder="Defaults to new owner"
                    spellCheck={false}
                    value={idTransferReceiveAddress}
                  />
                </label>
                {transferReceiveNote ? (
                  <p
                    className={
                      transferReceiveResolution?.error
                        ? "field-note bad"
                        : "field-note good"
                    }
                  >
                    {transferReceiveNote}
                  </p>
                ) : null}
                <div
                  className={
                    idTransferBytes > MAX_DATA_CARRIER_BYTES
                      ? "counter bad"
                      : "counter"
                  }
                >
                  {idTransferBytes.toLocaleString()} /{" "}
                  {MAX_DATA_CARRIER_BYTES.toLocaleString()} OP_RETURN
                  data-carrier bytes
                </div>
                <button
                  className="primary"
                  disabled={!canTransfer}
                  type="submit"
                >
                  <span className="button-content">
                    <Send size={15} />
                    <span>Transfer ID</span>
                  </span>
                </button>
              </form>
            </>
          )}
        </section>

        {lastRegisteredId ? (
          <section className="id-card id-verify-card">
            <div className="id-card-head">
              <div className="empty-icon" aria-hidden="true">
                <AtSign size={24} />
              </div>
              <div>
                <h3>Verify on X</h3>
                <p>
                  Post a public proof for {lastRegisteredId.id}@proofofwork.me
                  with the registry transaction link.
                </p>
              </div>
            </div>
            <div className="id-record-actions">
              <a
                className="primary link-button"
                href={xVerificationUrl(lastRegisteredId)}
                rel="noreferrer"
                target="_blank"
              >
                <span className="button-content">
                  <ArrowUpRight size={16} />
                  <span>Verify on X</span>
                </span>
              </a>
              <a
                className="secondary link-button"
                href={explorerTxUrl(
                  lastRegisteredId.txid,
                  lastRegisteredId.network,
                )}
                rel="noreferrer"
                target="_blank"
              >
                <span className="button-content">
                  <ArrowUpRight size={16} />
                  <span>View TX</span>
                </span>
              </a>
            </div>
          </section>
        ) : null}

        <section className="id-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <Star size={24} />
            </div>
            <div>
              <h3>Your IDs</h3>
              <p>IDs owned by or routed to the connected address.</p>
            </div>
          </div>
          <IdRecordList
            records={ownedIds}
            allowVerification
            contacts={contacts}
            empty="No IDs for this wallet yet."
            onAddContact={onAddContact}
            searchPlaceholder="Search your IDs"
          />
        </section>

        <section className="id-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <Clock size={24} />
            </div>
            <div>
              <h3>Pending IDs</h3>
              <p>
                Incoming and outgoing ID transfers appear here until they
                confirm.
              </p>
            </div>
          </div>
          <PendingIdEventList
            address={address}
            events={walletPendingEvents}
            empty={
              address
                ? "No in-flight ID transfers for this wallet."
                : "Connect a wallet to see pending ID transfers."
            }
          />
        </section>

        <section className="id-card ids-registry-card">
          <div className="id-card-head">
            <div className="empty-icon" aria-hidden="true">
              <Inbox size={24} />
            </div>
            <div>
              <h3>Registry</h3>
              <p>
                Confirmed records are final. Pending records can still change
                before confirmation.
              </p>
            </div>
          </div>
          <IdRecordList
            records={registryRecords}
            contacts={contacts}
            empty={
              registryAddress
                ? "No registry records found yet."
                : "Registry address is not configured for this network."
            }
            initialLimit={24}
            onAddContact={onAddContact}
            searchPlaceholder="Search registry IDs"
          />
        </section>
      </div>
    </section>
  );
}

function MarketplaceListingList({
  address,
  feeRate,
  listings,
  onDelist,
  onSeal,
  onUse,
  pendingEvents,
  setFeeRate,
}: {
  address: string;
  feeRate: number;
  listings: PowIdListing[];
  onDelist: (listing: PowIdListing) => void;
  onSeal: (listing: PowIdListing) => void;
  onUse: (listing: PowIdListing) => void;
  pendingEvents: PowIdPendingEvent[];
  setFeeRate: (value: number) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [listingPageIndex, setListingPageIndex] = useState(0);
  const [listingSortMode, setListingSortMode] =
    useState<MarketplaceSortMode>("price-asc");
  const filteredListings = searchQuery
    ? listings.filter((listing) => idListingMatchesSearch(listing, searchQuery))
    : listings;
  const sortedListings = sortIdMarketplaceListings(
    filteredListings,
    listingSortMode,
  );
  useEffect(() => {
    setListingPageIndex(0);
  }, [searchQuery, listingSortMode]);
  const listingPage = pagedItems(
    sortedListings,
    listingPageIndex,
    DATA_PAGE_SIZE,
  );
  const sellerListings = address
    ? listings.filter((listing) => listing.sellerAddress === address)
    : [];
  const pendingSealByListingId = new Map(
    pendingEvents
      .filter((event) => event.kind === "seal" && event.listingId)
      .map((event) => [event.listingId as string, event]),
  );
  const hasUnsealedSellerTicket = sellerListings.some(
    (listing) =>
      listing.listingVersion === "list5" &&
      !saleAuthorizationUsesSaleTicketAnchor(listing.saleAuthorization) &&
      !pendingSealByListingId.has(listing.listingId),
  );
  const listingStatus = (listing: PowIdListing) => {
    const pendingSeal = pendingSealByListingId.get(listing.listingId);
    if (listing.listingVersion === "list5") {
      if (saleAuthorizationUsesSaleTicketAnchor(listing.saleAuthorization)) {
        return "Sealed ticket";
      }

      return pendingSeal ? "Seal pending" : "Ticket needs seal";
    }

    return listing.listingVersion === "list4"
      ? "Hardened"
      : listing.listingVersion === "list3"
        ? "Anchored"
        : "Legacy";
  };

  return (
    <section className="id-card ids-registry-card marketplace-listings-card">
      <div className="id-card-head">
        <div className="empty-icon" aria-hidden="true">
          <Inbox size={24} />
        </div>
        <div>
          <h3>Active Listings</h3>
          <p>
            On-chain listings are canceled by delisting, expiry, or any
            ownership transfer.
          </p>
        </div>
      </div>

      <IdSearchControl
        placeholder="Search listings, sellers, txids"
        resultCount={filteredListings.length}
        setValue={setSearchQuery}
        totalCount={listings.length}
        value={searchQuery}
      />
      <MarketplaceSortControl
        onChange={setListingSortMode}
        value={listingSortMode}
      />

      {sellerListings.length > 0 ? (
        <div className="listing-fee-control">
          <div>
            <strong>
              {hasUnsealedSellerTicket
                ? "Seal fee rate"
                : "Seller action fee rate"}
            </strong>
            <span>Used for sealing and delisting marketplace listings.</span>
          </div>
          <FeeRateControl feeRate={feeRate} setFeeRate={setFeeRate} />
        </div>
      ) : null}

      {listings.length === 0 ? (
        <p className="field-note">No active on-chain listings yet.</p>
      ) : filteredListings.length === 0 ? (
        <p className="field-note">No active listings match this search.</p>
      ) : (
        <div className="id-record-list marketplace-listing-list">
          {listingPage.items.map((listing) => {
            const pendingSeal = pendingSealByListingId.get(listing.listingId);
            const sealTxid = listing.sealTxid ?? pendingSeal?.txid;

            return (
              <article className="id-record" key={listing.listingId}>
                <div>
                  <strong>{listing.id}@proofofwork.me</strong>
                  <span>
                    {listing.priceSats.toLocaleString()} sats ·{" "}
                    {listingStatus(listing)} · Listed{" "}
                    {formatDate(listing.createdAt)}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Seller</dt>
                    <dd>{shortAddress(listing.sellerAddress)}</dd>
                  </div>
                  <div>
                    <dt>Buyer</dt>
                    <dd>
                      {listing.buyerAddress
                        ? shortAddress(listing.buyerAddress)
                        : "Any"}
                    </dd>
                  </div>
                  <div>
                    <dt>Listing</dt>
                    <dd>{shortAddress(listing.listingId)}</dd>
                  </div>
                </dl>
                <div className="id-record-actions">
                  <button
                    className="primary small"
                    disabled={!listingCanBePurchased(listing)}
                    onClick={() => onUse(listing)}
                    type="button"
                  >
                    <span className="button-content">
                      <Send size={15} />
                      <span>
                        {listingCanBePurchased(listing)
                          ? "Select Listing"
                          : pendingSeal
                            ? "Seal Pending"
                            : "Not Sealed"}
                      </span>
                    </span>
                  </button>
                  {address && listing.sellerAddress === address ? (
                    <>
                      {listing.listingVersion === "list5" &&
                      !saleAuthorizationUsesSaleTicketAnchor(
                        listing.saleAuthorization,
                      ) &&
                      !pendingSeal ? (
                        <button
                          className="secondary small"
                          onClick={() => onSeal(listing)}
                          type="button"
                        >
                          <span className="button-content">
                            <Send size={15} />
                            <span>Seal</span>
                          </span>
                        </button>
                      ) : null}
                      <button
                        className="secondary small"
                        onClick={() => onDelist(listing)}
                        type="button"
                      >
                        <span className="button-content">
                          <Trash2 size={15} />
                          <span>Delist</span>
                        </span>
                      </button>
                    </>
                  ) : null}
                  <a
                    className="secondary small link-button"
                    href={explorerTxUrl(listing.txid, listing.network)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span className="button-content">
                      <ArrowUpRight size={15} />
                      <span>View TX</span>
                    </span>
                  </a>
                  {sealTxid ? (
                    <a
                      className="secondary small link-button"
                      href={explorerTxUrl(sealTxid, listing.network)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <span className="button-content">
                        <ArrowUpRight size={15} />
                        <span>View Seal TX</span>
                      </span>
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <PaginationControls
        label="Listings"
        onPageChange={setListingPageIndex}
        page={listingPage}
      />
    </section>
  );
}

function IdMarketplaceCard({
  busy,
  canCreateSaleAuthorization,
  canPurchaseId,
  feeRate,
  idPurchaseBytes,
  idPurchaseOwnerAddress,
  idPurchaseReceiveAddress,
  idSaleAuthorization,
  idSaleBuyerAddress,
  idSalePriceSats,
  idSaleReceiveAddress,
  managedId,
  network,
  publishListing,
  setIdPurchaseOwnerAddress,
  setIdPurchaseReceiveAddress,
  setIdSaleBuyerAddress,
  setIdSalePriceSats,
  setIdSaleReceiveAddress,
  setFeeRate,
  status,
  submitPurchase,
}: {
  busy: boolean;
  canCreateSaleAuthorization: boolean;
  canPurchaseId: boolean;
  feeRate: number;
  idPurchaseBytes: number;
  idPurchaseOwnerAddress: string;
  idPurchaseReceiveAddress: string;
  idSaleAuthorization: string;
  idSaleBuyerAddress: string;
  idSalePriceSats: number;
  idSaleReceiveAddress: string;
  managedId?: PowIdRecord;
  network: BitcoinNetwork;
  publishListing: () => void;
  setIdPurchaseOwnerAddress: (value: string) => void;
  setIdPurchaseReceiveAddress: (value: string) => void;
  setIdSaleBuyerAddress: (value: string) => void;
  setIdSalePriceSats: (value: number) => void;
  setIdSaleReceiveAddress: (value: string) => void;
  setFeeRate: (value: number) => void;
  status: { tone: StatusTone; text: string };
  submitPurchase: (
    event?: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement>,
  ) => void;
}) {
  const parsedSale = useMemo(() => {
    if (!idSaleAuthorization.trim()) {
      return undefined;
    }

    try {
      return parseSaleAuthorizationText(idSaleAuthorization, network);
    } catch {
      return undefined;
    }
  }, [idSaleAuthorization, network]);
  const saleIsReady = parsedSale
    ? saleAuthorizationCanBroadcast(parsedSale)
    : false;

  return (
    <section className="id-card id-marketplace-card">
      <div className="id-card-head">
        <div className="empty-icon" aria-hidden="true">
          <Users size={24} />
        </div>
        <div>
          <h3>Marketplace Transfer</h3>
          <p>
            Listings create a sale-ticket UTXO. Buyers settle by spending that
            ticket and paying the {ID_MUTATION_PRICE_SATS.toLocaleString()} sat
            registry transfer.
          </p>
        </div>
      </div>

      <div className="id-market-grid">
        <div className="id-action-form">
          <h4>Publish on-chain listing</h4>
          <p className="field-note">
            {managedId
              ? `Listing ${managedId.id}@proofofwork.me from ${shortAddress(managedId.ownerAddress)}.`
              : "Select an owned confirmed ID above first."}
          </p>
          <label>
            Seller price sats
            <input
              min={0}
              onChange={(event) =>
                setIdSalePriceSats(Number(event.target.value))
              }
              step={1}
              type="number"
              value={idSalePriceSats}
            />
          </label>
          <label>
            Specific buyer optional
            <input
              autoComplete="off"
              onChange={(event) => setIdSaleBuyerAddress(event.target.value)}
              placeholder="Any buyer if empty"
              spellCheck={false}
              value={idSaleBuyerAddress}
            />
          </label>
          <label>
            Locked receive address optional
            <input
              autoComplete="off"
              onChange={(event) => setIdSaleReceiveAddress(event.target.value)}
              placeholder="Buyer chooses if empty"
              spellCheck={false}
              value={idSaleReceiveAddress}
            />
          </label>
          <FeeRateControl feeRate={feeRate} setFeeRate={setFeeRate} />
          <div className="id-record-actions">
            <button
              className="primary"
              disabled={!canCreateSaleAuthorization}
              onClick={publishListing}
              type="button"
            >
              <span className="button-content">
                <Send size={15} />
                <span>{busy ? "Publishing" : "Publish On-Chain"}</span>
              </span>
            </button>
          </div>
        </div>

        <form className="id-action-form" onSubmit={submitPurchase}>
          <h4>
            {parsedSale
              ? `Buy ${parsedSale.id}@proofofwork.me`
              : "Select an on-chain listing"}
          </h4>
          <p
            className={
              parsedSale && saleIsReady ? "field-note good" : "field-note"
            }
          >
            {parsedSale && saleIsReady
              ? `Selected listing price: ${parsedSale.priceSats.toLocaleString()} sats.`
              : "Choose an active listing below. The purchase form fills from that on-chain listing."}
          </p>
          <AppStatusRow
            className="marketplace-action-status"
            persistent
            status={status}
          />
          <div className="compose-grid">
            <label>
              New owner
              <input
                autoComplete="off"
                onChange={(event) =>
                  setIdPurchaseOwnerAddress(event.target.value)
                }
                spellCheck={false}
                value={idPurchaseOwnerAddress}
              />
            </label>
            <label>
              New receive optional
              <input
                autoComplete="off"
                onChange={(event) =>
                  setIdPurchaseReceiveAddress(event.target.value)
                }
                placeholder="Defaults to new owner"
                spellCheck={false}
                value={idPurchaseReceiveAddress}
              />
            </label>
          </div>
          <div
            className={
              idPurchaseBytes > MAX_DATA_CARRIER_BYTES
                ? "counter bad"
                : "counter"
            }
          >
            {idPurchaseBytes.toLocaleString()} /{" "}
            {MAX_DATA_CARRIER_BYTES.toLocaleString()} OP_RETURN data-carrier
            bytes
          </div>
          <FeeRateControl feeRate={feeRate} setFeeRate={setFeeRate} />
          <div className="id-record-actions">
            <button
              className="primary"
              disabled={busy}
              onClick={submitPurchase}
              type="button"
            >
              <span className="button-content">
                <Send size={15} />
                <span>{busy ? "Buying" : "Buy Listing On-Chain"}</span>
              </span>
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function PendingIdEventList({
  address,
  empty,
  events,
}: {
  address: string;
  empty: string;
  events: PowIdPendingEvent[];
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const filteredEvents = searchQuery
    ? events.filter((event) => pendingIdEventMatchesSearch(event, searchQuery))
    : events;
  const eventPage = pagedItems(filteredEvents, pageIndex, DATA_PAGE_SIZE);

  if (events.length === 0) {
    return <p className="field-note">{empty}</p>;
  }

  return (
    <>
      <IdSearchControl
        placeholder="Search pending IDs, addresses, txids"
        resultCount={filteredEvents.length}
        setValue={setSearchQuery}
        totalCount={events.length}
        value={searchQuery}
      />
      {filteredEvents.length === 0 ? (
        <p className="field-note">No pending ID events match this search.</p>
      ) : (
        <div className="id-record-list">
          {eventPage.items.map((event) => (
            <article
              className="id-record"
              key={`${event.network}-${event.txid}-${event.kind}`}
            >
              <div>
                <strong>
                  {event.id ? `${event.id}@proofofwork.me` : "Registry event"}
                </strong>
                <span>
                  {pendingIdEventLabel(event, address)} ·{" "}
                  {event.amountSats.toLocaleString()} sats
                </span>
              </div>
              <dl>
                <div>
                  <dt>Current Owner</dt>
                  <dd>
                    {event.currentOwnerAddress
                      ? shortAddress(event.currentOwnerAddress)
                      : "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt>New Owner</dt>
                  <dd>
                    {event.ownerAddress
                      ? shortAddress(event.ownerAddress)
                      : event.kind === "update"
                        ? "No change"
                        : "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt>Receives</dt>
                  <dd>
                    {event.receiveAddress
                      ? shortAddress(event.receiveAddress)
                      : event.currentReceiveAddress
                        ? shortAddress(event.currentReceiveAddress)
                        : "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt>TX</dt>
                  <dd>{shortAddress(event.txid)}</dd>
                </div>
              </dl>
              <div className="id-record-actions">
                <a
                  className="secondary small link-button"
                  href={explorerTxUrl(event.txid, event.network)}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="button-content">
                    <ArrowUpRight size={15} />
                    <span>View TX</span>
                  </span>
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
      <PaginationControls
        label="Pending events"
        onPageChange={setPageIndex}
        page={eventPage}
      />
    </>
  );
}

function IdSearchControl({
  placeholder,
  resultCount,
  setValue,
  totalCount,
  value,
}: {
  placeholder: string;
  resultCount: number;
  setValue: (value: string) => void;
  totalCount: number;
  value: string;
}) {
  return (
    <div className="id-search-row">
      <div className="desktop-search id-search-control">
        <Search size={16} aria-hidden="true" />
        <input
          aria-label={placeholder}
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          value={value}
        />
        {value ? (
          <button
            aria-label="Clear search"
            className="icon-button id-search-clear"
            onClick={() => setValue("")}
            type="button"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      <span>
        {value
          ? `${resultCount.toLocaleString()} of ${totalCount.toLocaleString()}`
          : `${totalCount.toLocaleString()} total`}
      </span>
    </div>
  );
}

function IdRecordList({
  records,
  allowVerification = false,
  contacts = [],
  empty,
  initialLimit,
  onAddContact,
  searchPlaceholder = "Search IDs, addresses, txids",
}: {
  records: PowIdRecord[];
  allowVerification?: boolean;
  contacts?: ContactRecord[];
  empty: string;
  initialLimit?: number;
  onAddContact?: (record: PowIdRecord) => void;
  searchPlaceholder?: string;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const filteredRecords = searchQuery
    ? records.filter((record) => idRecordMatchesSearch(record, searchQuery))
    : records;
  const recordPage = pagedItems(
    filteredRecords,
    pageIndex,
    initialLimit ?? DATA_PAGE_SIZE,
  );
  const visibleRecords = recordPage.items;

  if (records.length === 0) {
    return <p className="field-note">{empty}</p>;
  }

  return (
    <>
      <IdSearchControl
        placeholder={searchPlaceholder}
        resultCount={filteredRecords.length}
        setValue={setSearchQuery}
        totalCount={records.length}
        value={searchQuery}
      />
      {visibleRecords.length === 0 ? (
        <p className="field-note">No IDs match this search.</p>
      ) : (
        <div className="id-record-list">
          {visibleRecords.map((record) => {
            const saved = contacts.some(
              (contact) => contactKey(contact) === registryContactKey(record),
            );

            return (
              <article
                className="id-record"
                key={`${record.network}-${record.txid}-${record.id}`}
              >
                <div>
                  <strong>{record.id}@proofofwork.me</strong>
                  <span>
                    {record.confirmed ? "Confirmed" : "Pending"} ·{" "}
                    {record.amountSats.toLocaleString()} sats
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Owner</dt>
                    <dd>{shortAddress(record.ownerAddress)}</dd>
                  </div>
                  <div>
                    <dt>Receives</dt>
                    <dd>{shortAddress(record.receiveAddress)}</dd>
                  </div>
                  <div>
                    <dt>PGP</dt>
                    <dd>{record.pgpKey ? "Registered" : "None"}</dd>
                  </div>
                  <div>
                    <dt>TX</dt>
                    <dd>{shortAddress(record.txid)}</dd>
                  </div>
                </dl>
                <div className="id-record-actions">
                  {allowVerification ? (
                    <a
                      className="secondary small link-button"
                      href={xVerificationUrl(record)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <span className="button-content">
                        <ArrowUpRight size={15} />
                        <span>Verify on X</span>
                      </span>
                    </a>
                  ) : null}
                  {onAddContact && record.confirmed ? (
                    <button
                      className="secondary small"
                      disabled={saved}
                      onClick={() => onAddContact(record)}
                      type="button"
                    >
                      <span className="button-content">
                        <UserPlus size={15} />
                        <span>{saved ? "Saved" : "Add Contact"}</span>
                      </span>
                    </button>
                  ) : null}
                  <a
                    className="secondary small link-button"
                    href={explorerTxUrl(record.txid, record.network)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span className="button-content">
                      <ArrowUpRight size={15} />
                      <span>View TX</span>
                    </span>
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <PaginationControls
        label="IDs"
        onPageChange={setPageIndex}
        page={recordPage}
      />
    </>
  );
}

function MessageList({
  activeKey,
  activeFolder,
  activeNetwork,
  favoriteKeys,
  inboxCount,
  messages,
  onOpenInbox,
  onSelect,
}: {
  activeKey: string;
  activeFolder: Folder;
  activeNetwork: BitcoinNetwork;
  favoriteKeys: Set<string>;
  inboxCount: number;
  messages: MailMessage[];
  onOpenInbox: () => void;
  onSelect: (message: MailMessage) => void;
}) {
  if (messages.length === 0) {
    const emptyIcon =
      activeFolder === "inbox" ? (
        <Inbox size={26} />
      ) : activeFolder === "incoming" ? (
        <Mail size={26} />
      ) : activeFolder === "outbox" ? (
        <Clock size={26} />
      ) : activeFolder === "favorites" ? (
        <Star size={26} />
      ) : activeFolder === "archive" ? (
        <Archive size={26} />
      ) : activeFolder === "custom" ? (
        <FolderPlus size={26} />
      ) : (
        <Send size={26} />
      );
    const emptyTitle =
      activeFolder === "inbox"
        ? "No Inbox messages"
        : activeFolder === "incoming"
          ? "No Incoming messages"
          : activeFolder === "outbox"
            ? "Outbox clear"
            : activeFolder === "favorites"
              ? "No favorites"
              : activeFolder === "archive"
                ? "No archived messages"
                : activeFolder === "custom"
                  ? "No messages here yet"
                  : "No Sent messages";
    const emptyCopy =
      activeFolder === "inbox"
        ? "Confirmed received mail will land here after the next scan."
        : activeFolder === "incoming"
          ? "Pending inbound transactions will appear here until they confirm."
          : activeFolder === "outbox"
            ? "Pending and dropped broadcasts will appear here."
            : activeFolder === "favorites"
              ? "Star confirmed mail to keep it close."
              : activeFolder === "archive"
                ? "Archived mail will appear here."
                : activeFolder === "custom"
                  ? "Open confirmed mail and add it to this local folder."
                  : "Confirmed sent mail appears here after a scan.";

    return (
      <div className="empty-state empty-list">
        <div className="empty-icon" aria-hidden="true">
          {emptyIcon}
        </div>
        <h3>{emptyTitle}</h3>
        <p>{emptyCopy}</p>
        {activeFolder === "sent" && inboxCount > 0 ? (
          <button
            className="secondary small"
            onClick={onOpenInbox}
            type="button"
          >
            Open Inbox ({inboxCount})
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="message-list">
      {messages.map((message) => {
        const key = mailKey(message);
        const peer = peerAddress(message);
        const explorerNetwork = explorerNetworkFor(
          message.network,
          activeNetwork,
        );

        return (
          <button
            aria-current={activeKey === key}
            className="message-row"
            key={key}
            onClick={() => onSelect(message)}
            type="button"
          >
            <div className="message-row-top">
              <strong>{shortAddress(peer)}</strong>
              <span>{formatDate(message.createdAt)}</span>
            </div>
            <div className="message-subject">{messageSubject(message)}</div>
            <div className="message-preview">{mailPreview(message)}</div>
            <div className="message-meta">
              <span>{message.amountSats.toLocaleString()} sats</span>
              {message.folder === "sent" ? (
                <span>{deliveryLabel(sentDeliveryStatus(message))}</span>
              ) : null}
              {message.folder === "incoming" ? <span>Pending</span> : null}
              {favoriteKeys.has(key) ? <span>Favorite</span> : null}
              {message.attachment ? <span>Attachment</span> : null}
              {message.parentTxid ? <span>Reply</span> : null}
              <span>{networkLabel(explorerNetwork)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DraftList({
  draft,
  onCompose,
  onDiscard,
  onOpen,
}: {
  draft?: DraftMessage;
  onCompose: () => void;
  onDiscard: () => void;
  onOpen: (draft: DraftMessage) => void;
}) {
  if (!draft) {
    return (
      <div className="empty-state empty-list">
        <div className="empty-icon" aria-hidden="true">
          <FilePenLine size={26} />
        </div>
        <h3>No drafts</h3>
        <p>Messages stay local here until you broadcast them.</p>
        <button className="secondary small" onClick={onCompose} type="button">
          Compose
        </button>
      </div>
    );
  }

  return (
    <div className="message-list">
      <article className="message-row draft-row" data-current="true">
        <button
          className="draft-open"
          onClick={() => onOpen(draft)}
          type="button"
        >
          <div className="message-row-top">
            <strong>{recipientInputSummary(draft.recipient)}</strong>
            <span>{formatDate(draft.updatedAt)}</span>
          </div>
          <div className="message-subject">{messageSubject(draft)}</div>
          <div className="message-preview">
            {mailPreview(draft) || "Unsent ProofOfWork.Me mail"}
          </div>
          <div className="message-meta">
            <span>{draft.amountSats.toLocaleString()} sats</span>
            {draft.attachment ? <span>Attachment</span> : null}
            {draft.parentTxid ? <span>Reply</span> : null}
            <span>{networkLabel(draft.network)}</span>
          </div>
        </button>
        <button className="secondary small" onClick={onDiscard} type="button">
          <span className="button-content">
            <X size={15} />
            <span>Discard</span>
          </span>
        </button>
      </article>
    </div>
  );
}

function DesktopWorkspace({
  activeNetwork,
  busy,
  desktopQuery,
  fileFilter,
  messages,
  profile,
  selectedKey,
  setDesktopQuery,
  setFileFilter,
  setSortMode,
  sortMode,
  onClear,
  onRefresh,
  onSearch,
  onSelect,
}: {
  activeNetwork: BitcoinNetwork;
  busy: boolean;
  desktopQuery: string;
  fileFilter: FileFilter;
  messages: MailMessage[];
  profile?: DesktopProfile;
  selectedKey: string;
  setDesktopQuery: (value: string) => void;
  setFileFilter: (value: FileFilter) => void;
  setSortMode: (value: SortMode) => void;
  sortMode: SortMode;
  onClear: () => void;
  onRefresh: () => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onSelect: (message: MailMessage) => void;
}) {
  const fileMessages = sortMessages(
    fileSurfaceMessages(messages).filter(
      (message) =>
        fileFilter === "all" ||
        fileKindForMessage(message) === fileFilter,
    ),
    sortMode,
  ).filter(hasAttachment);
  const selectedFile =
    fileMessages.find((message) => mailKey(message) === selectedKey) ??
    fileMessages[0];

  if (!profile) {
    return (
      <section className="desktop-workspace desktop-workspace-empty">
        <div className="desktop-screensaver">
          <div className="desktop-screen-card">
            <div className="brand-mark" aria-hidden="true">
              PoW
            </div>
            <span>ProofOfWork Desktop</span>
            <h2>Open a public Bitcoin desktop.</h2>
            <form
              className="desktop-search desktop-search-large"
              onSubmit={onSearch}
            >
              <Search size={18} aria-hidden="true" />
              <input
                autoComplete="off"
                onChange={(event) => setDesktopQuery(event.target.value)}
                placeholder="address or user@proofofwork.me"
                spellCheck={false}
                value={desktopQuery}
              />
              <button
                className="primary"
                disabled={busy || !desktopQuery.trim()}
                type="submit"
              >
                <span className="button-content">
                  <Monitor size={16} />
                  <span>{busy ? "Opening" : "Open"}</span>
                </span>
              </button>
            </form>
            <div className="desktop-signal">
              <span>{networkLabel(activeNetwork)}</span>
              <span>Confirmed files</span>
              <span>No wallet required</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="desktop-workspace desktop-workspace-loaded">
      <div className="desktop-toolbar">
        <div>
          <h2>{profile.label} Desktop</h2>
          <span>
            {fileMessages.length.toLocaleString()} public file
            {fileMessages.length === 1 ? "" : "s"} ·{" "}
            {shortAddress(profile.address)}
          </span>
        </div>
        <form className="desktop-search" onSubmit={onSearch}>
          <Search size={16} aria-hidden="true" />
          <input
            autoComplete="off"
            onChange={(event) => setDesktopQuery(event.target.value)}
            placeholder="address or user@proofofwork.me"
            spellCheck={false}
            value={desktopQuery}
          />
          <button
            className="secondary small"
            disabled={busy || !desktopQuery.trim()}
            type="submit"
          >
            <span className="button-content">
              <Search size={15} />
              <span>Search</span>
            </span>
          </button>
        </form>
        <label className="sort-control">
          Type
          <select
            value={fileFilter}
            onChange={(event) =>
              setFileFilter(event.target.value as FileFilter)
            }
          >
            <option value="all">All files</option>
            <option value="image">Images</option>
            <option value="pdf">PDFs</option>
            <option value="document">Documents</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="sort-control">
          Sort
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
          >
            <option value="value">Highest sats</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="largest">Largest</option>
            <option value="filetype">File type</option>
            <option value="sender">Address</option>
            <option value="thread">Thread</option>
          </select>
        </label>
        <button
          className="secondary small"
          disabled={busy}
          onClick={onRefresh}
          type="button"
        >
          <span className="button-content">
            <RefreshCw className={busy ? "refresh-spin" : ""} size={15} />
            <span>{busy ? "Refreshing" : "Refresh"}</span>
          </span>
        </button>
        <button
          className="secondary small"
          disabled={busy}
          onClick={onClear}
          type="button"
        >
          <span className="button-content">
            <X size={15} />
            <span>Clear</span>
          </span>
        </button>
      </div>

      {fileMessages.length === 0 ? (
        <div className="desktop-empty">
          <div className="empty-icon" aria-hidden="true">
            <Monitor size={26} />
          </div>
          <h3>No public files</h3>
          <p>
            {profile.label} has no confirmed ProofOfWork.Me files on this
            network.
          </p>
        </div>
      ) : (
        <div className="files-browser desktop-browser">
          <div
            className="files-desktop"
            aria-label={`${profile.label} public files`}
          >
            {fileMessages.map((message) => (
              <FileTile
                active={
                  selectedFile
                    ? mailKey(selectedFile) === mailKey(message)
                    : false
                }
                activeNetwork={activeNetwork}
                key={mailKey(message)}
                message={message}
                onSelect={onSelect}
              />
            ))}
          </div>

          <FileInspector activeNetwork={activeNetwork} message={selectedFile} />
        </div>
      )}
    </section>
  );
}

function FilesWorkspace({
  activeKey,
  activeNetwork,
  busy,
  connected,
  fileFilter,
  messages,
  refreshing,
  selectedMessage,
  setFileFilter,
  setSortMode,
  sortMode,
  onOpenInbox,
  onOpenMessage,
  onRefresh,
  onSelect,
}: {
  activeKey: string;
  activeNetwork: BitcoinNetwork;
  busy: boolean;
  connected: boolean;
  fileFilter: FileFilter;
  messages: MailMessage[];
  refreshing: boolean;
  selectedMessage?: MailMessage & { attachment: MailAttachment };
  setFileFilter: (value: FileFilter) => void;
  setSortMode: (value: SortMode) => void;
  sortMode: SortMode;
  onOpenInbox: () => void;
  onOpenMessage: (message: MailMessage) => void;
  onRefresh: () => void;
  onSelect: (message: MailMessage) => void;
}) {
  const fileMessages = fileSurfaceMessages(messages);
  const selectedFile = selectedMessage ?? fileMessages[0];

  if (fileMessages.length === 0) {
    return (
      <section className="files-workspace">
        <FilesToolbar
          busy={busy}
          connected={connected}
          fileFilter={fileFilter}
          fileCount={0}
          refreshing={refreshing}
          setFileFilter={setFileFilter}
          setSortMode={setSortMode}
          sortMode={sortMode}
          onRefresh={onRefresh}
        />
        <div className="empty-state files-empty">
          <div className="empty-icon" aria-hidden="true">
            <Paperclip size={26} />
          </div>
          <h3>
            {connected
              ? fileFilter === "all"
                ? "No files"
                : `No ${fileFilterLabel(fileFilter).toLowerCase()}`
              : "Connect to view files"}
          </h3>
          <p>
            Attachments from Inbox and Sent will appear here as a desktop-style
            file space.
          </p>
          <button
            className="secondary small"
            onClick={onOpenInbox}
            type="button"
          >
            Open Inbox
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="files-workspace">
      <FilesToolbar
        busy={busy}
        connected={connected}
        fileFilter={fileFilter}
        fileCount={fileMessages.length}
        refreshing={refreshing}
        setFileFilter={setFileFilter}
        setSortMode={setSortMode}
        sortMode={sortMode}
        onRefresh={onRefresh}
      />

      <div className="files-browser">
        <div className="files-desktop" aria-label="Attachments">
          {fileMessages.map((message) => (
            <FileTile
              active={activeKey === mailKey(message)}
              activeNetwork={activeNetwork}
              key={mailKey(message)}
              message={message}
              onSelect={onSelect}
            />
          ))}
        </div>

        <FileInspector
          activeNetwork={activeNetwork}
          message={selectedFile}
          onOpenMessage={onOpenMessage}
        />
      </div>
    </section>
  );
}

function FilesToolbar({
  busy,
  connected,
  fileFilter,
  fileCount,
  refreshing,
  setFileFilter,
  setSortMode,
  sortMode,
  onRefresh,
}: {
  busy: boolean;
  connected: boolean;
  fileFilter: FileFilter;
  fileCount: number;
  refreshing: boolean;
  setFileFilter: (value: FileFilter) => void;
  setSortMode: (value: SortMode) => void;
  sortMode: SortMode;
  onRefresh: () => void;
}) {
  return (
    <div className="files-toolbar">
      <div>
        <h2>Files</h2>
        <span>
          {fileCount.toLocaleString()} file{fileCount === 1 ? "" : "s"} across
          mail
        </span>
      </div>
      <label className="sort-control">
        Type
        <select
          value={fileFilter}
          onChange={(event) => setFileFilter(event.target.value as FileFilter)}
        >
          <option value="all">All files</option>
          <option value="image">Images</option>
          <option value="pdf">PDFs</option>
          <option value="document">Documents</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="sort-control">
        Sort
        <select
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value as SortMode)}
        >
          <option value="value">Highest sats</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="largest">Largest</option>
          <option value="filetype">File type</option>
          <option value="sender">Address</option>
          <option value="thread">Thread</option>
        </select>
      </label>
      <button
        className="secondary small"
        disabled={busy || !connected}
        onClick={onRefresh}
        type="button"
      >
        <span className="button-content">
          <RefreshCw className={refreshing ? "refresh-spin" : ""} size={15} />
          <span>{refreshing ? "Refreshing" : "Refresh"}</span>
        </span>
      </button>
    </div>
  );
}

function FileTile({
  active,
  activeNetwork,
  message,
  onSelect,
}: {
  active: boolean;
  activeNetwork: BitcoinNetwork;
  message: MailMessage & { attachment: MailAttachment };
  onSelect: (message: MailMessage) => void;
}) {
  const attachment = message.attachment;
  const explorerNetwork = explorerNetworkFor(message.network, activeNetwork);

  return (
    <button
      aria-current={active}
      className="file-tile"
      onClick={() => onSelect(message)}
      type="button"
    >
      <FilePreview attachment={attachment} />
      <strong title={attachment.name}>{attachment.name}</strong>
      <span>
        {formatBytes(attachment.size)} ·{" "}
        {fileFilterLabel(fileKindForMessage(message)).replace(/s$/u, "")}
      </span>
      <div className="file-tile-meta">
        <span>{message.amountSats.toLocaleString()} sats</span>
        <span>{networkLabel(explorerNetwork)}</span>
      </div>
    </button>
  );
}

function FilePreview({ attachment }: { attachment: MailAttachment }) {
  if (isImageAttachment(attachment)) {
    return (
      <span className="file-preview is-image">
        <img alt="" src={attachmentHref(attachment)} />
      </span>
    );
  }

  return (
    <span className="file-preview">
      <FileText size={34} />
    </span>
  );
}

function AttachmentViewer({ attachment }: { attachment: MailAttachment }) {
  const [copied, setCopied] = useState(false);
  const href = attachmentHref(attachment);
  const previewKind = attachmentPreviewKind(attachment);
  const text = previewKind === "text" ? attachmentText(attachment) : "";

  async function copyText() {
    if (!text) {
      return;
    }

    try {
      await copyTextToClipboard(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  if (previewKind === "image") {
    return (
      <section
        className="attachment-viewer image-viewer"
        aria-label={`${attachment.name} preview`}
      >
        <img alt={attachment.name} src={href} />
      </section>
    );
  }

  if (previewKind === "audio") {
    return (
      <section
        className="attachment-viewer media-viewer"
        aria-label={`${attachment.name} audio player`}
      >
        <audio controls preload="metadata" src={href}>
          <a download={attachment.name} href={href}>
            Download {attachment.name}
          </a>
        </audio>
      </section>
    );
  }

  if (previewKind === "video") {
    return (
      <section
        className="attachment-viewer media-viewer video-viewer"
        aria-label={`${attachment.name} video player`}
      >
        <video controls preload="metadata" src={href}>
          <a download={attachment.name} href={href}>
            Download {attachment.name}
          </a>
        </video>
      </section>
    );
  }

  if (previewKind === "pdf") {
    return (
      <section
        className="attachment-viewer pdf-viewer"
        aria-label={`${attachment.name} PDF preview`}
      >
        <object data={href} type="application/pdf">
          <div>
            <FileText size={34} />
            <strong>PDF preview unavailable</strong>
            <a
              className="secondary small link-button"
              download={attachment.name}
              href={href}
            >
              Download PDF
            </a>
          </div>
        </object>
      </section>
    );
  }

  if (previewKind === "text") {
    return (
      <section
        className="attachment-viewer text-viewer"
        aria-label={`${attachment.name} text preview`}
      >
        <div className="attachment-viewer-head">
          <span>{attachmentCodeLabel(attachment)}</span>
          <button
            className="secondary small"
            onClick={() => void copyText()}
            type="button"
          >
            <span className="button-content">
              {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </span>
          </button>
        </div>
        <pre>
          <code>{text}</code>
        </pre>
      </section>
    );
  }

  return (
    <section
      className="attachment-viewer unsupported-viewer"
      aria-label={`${attachment.name} file preview`}
    >
      <FileText size={34} />
      <strong>No inline preview</strong>
      <p>
        This file type is saved on-chain. Download it to open with a local app.
      </p>
    </section>
  );
}

function FileInspector({
  activeNetwork,
  message,
  onOpenMessage,
}: {
  activeNetwork: BitcoinNetwork;
  message?: MailMessage & { attachment: MailAttachment };
  onOpenMessage?: (message: MailMessage) => void;
}) {
  if (!message) {
    return (
      <aside className="file-inspector">
        <div className="empty-icon" aria-hidden="true">
          <Paperclip size={24} />
        </div>
        <h3>Select a file</h3>
      </aside>
    );
  }

  const attachment = message.attachment;
  const peer = peerAddress(message);
  const explorerNetwork = explorerNetworkFor(message.network, activeNetwork);

  return (
    <aside className="file-inspector">
      <div className="file-detail-title">
        <h3>{attachment.name}</h3>
        <span>{attachment.mime}</span>
      </div>
      <AttachmentViewer attachment={attachment} />
      <div className="file-detail-actions">
        {isBrowserHtmlAttachment(attachment) ? (
          <a
            className="primary link-button"
            href={browserTxUrl(message.txid, explorerNetwork)}
            rel="noreferrer"
            target="_blank"
          >
            <span className="button-content">
              <Monitor size={15} />
              <span>Open in Browser</span>
            </span>
          </a>
        ) : null}
        <a
          className="primary link-button"
          download={attachment.name}
          href={attachmentHref(attachment)}
        >
          <span className="button-content">
            <Download size={15} />
            <span>Download</span>
          </span>
        </a>
        {onOpenMessage ? (
          <button
            className="secondary"
            onClick={() => onOpenMessage(message)}
            type="button"
          >
            <span className="button-content">
              <Mail size={15} />
              <span>Open Message</span>
            </span>
          </button>
        ) : null}
        <a
          className="secondary link-button"
          href={explorerTxUrl(message.txid, explorerNetwork)}
          rel="noreferrer"
          target="_blank"
        >
          <span className="button-content">
            <ArrowUpRight size={15} />
            <span>View TX</span>
          </span>
        </a>
      </div>
      <dl className="file-detail-list">
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(attachment.size)}</dd>
        </div>
        <div>
          <dt>{isInboundFolder(message.folder) ? "From" : "To"}</dt>
          <dd>{peer}</dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd>{message.amountSats.toLocaleString()} sats</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{formatDate(message.createdAt)}</dd>
        </div>
        <div>
          <dt>SHA-256</dt>
          <dd>{attachment.sha256}</dd>
        </div>
      </dl>
    </aside>
  );
}

function OnboardingPane({
  busy,
  hasUnisat,
  network,
  onConnect,
}: {
  busy: boolean;
  hasUnisat: boolean;
  network: BitcoinNetwork;
  onConnect: () => void;
}) {
  return (
    <section className="onboarding-pane">
      <div className="onboarding-panel">
        <div className="onboarding-icon" aria-hidden="true">
          <Mail size={30} />
        </div>
        <div>
          <h2>{hasUnisat ? "Open ProofOfWork.Me" : "Install UniSat"}</h2>
          <p>
            {hasUnisat
              ? `Connect UniSat to read and send Bitcoin mail on ${networkLabel(network)}.`
              : "ProofOfWork.Me needs UniSat to sign Bitcoin mail transactions locally."}
          </p>
        </div>
        <div className="onboarding-checks" aria-label="Setup">
          <span>
            <CheckCircle2 size={16} />
            {hasUnisat ? "Wallet signed" : "Official wallet link"}
          </span>
          <span>
            <CheckCircle2 size={16} />
            No account server
          </span>
          <span>
            <CheckCircle2 size={16} />
            OP_RETURN native
          </span>
        </div>
        {hasUnisat ? (
          <button
            className="primary"
            disabled={busy}
            onClick={onConnect}
            type="button"
          >
            <span className="button-content">
              <Wallet size={17} />
              <span>{busy ? "Connecting" : "Connect UniSat"}</span>
            </span>
          </button>
        ) : (
          <a
            className="primary link-button"
            href={UNISAT_DOWNLOAD_URL}
            rel="noreferrer"
            target="_blank"
          >
            <span className="button-content">
              <Wallet size={17} />
              <span>Download UniSat</span>
              <ArrowUpRight size={15} />
            </span>
          </a>
        )}
      </div>
    </section>
  );
}

function ComposePane({
  amountSats,
  attachment,
  busy,
  canSend,
  ccRecipient,
  ccRecipientError,
  ccRecipientNote,
  contacts,
  dataCarrierBytes,
  draftMode = false,
  feeRate,
  memo,
  network,
  onDiscardDraft,
  parentTxid,
  recipient,
  recipientError,
  recipientNote,
  sender,
  setAttachment,
  setAttachmentFile,
  setAmountSats,
  setCcRecipient,
  setFeeRate,
  setMemo,
  setParentTxid,
  setRecipient,
  setSubject,
  subject,
  submit,
}: {
  amountSats: number;
  attachment?: MailAttachment;
  busy: boolean;
  canSend: boolean;
  ccRecipient: string;
  ccRecipientError: boolean;
  ccRecipientNote: string;
  contacts: ContactRecord[];
  dataCarrierBytes: number;
  draftMode?: boolean;
  feeRate: number;
  memo: string;
  network: BitcoinNetwork;
  onDiscardDraft?: () => void;
  parentTxid?: string;
  recipient: string;
  recipientError: boolean;
  recipientNote: string;
  sender: string;
  setAttachment: (value: MailAttachment | undefined) => void;
  setAttachmentFile: (file: File) => void;
  setAmountSats: (value: number) => void;
  setCcRecipient: (value: string) => void;
  setFeeRate: (value: number) => void;
  setMemo: (value: string) => void;
  setParentTxid: (value: string | undefined) => void;
  setRecipient: (value: string) => void;
  setSubject: (value: string) => void;
  subject: string;
  submit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const recipientTokens = splitRecipientInputs(recipient);
  const ccRecipientTokens = splitRecipientInputs(ccRecipient);
  const removeRecipient = (target: string) => {
    setRecipient(recipientTokens.filter((item) => item !== target).join(", "));
  };
  const removeCcRecipient = (target: string) => {
    setCcRecipient(
      ccRecipientTokens.filter((item) => item !== target).join(", "),
    );
  };

  return (
    <form className="compose-pane" onSubmit={submit}>
      <div className="pane-head">
        <div>
          <h2>{draftMode ? "Draft" : parentTxid ? "Reply" : "New Message"}</h2>
          {parentTxid ? <span>Thread: {shortAddress(parentTxid)}</span> : null}
        </div>
        <div className="reader-actions">
          {draftMode && onDiscardDraft ? (
            <button
              className="secondary small"
              disabled={busy}
              onClick={onDiscardDraft}
              type="button"
            >
              <span className="button-content">
                <X size={15} />
                <span>Discard</span>
              </span>
            </button>
          ) : null}
          <button className="primary" disabled={!canSend} type="submit">
            <span className="button-content">
              <Send size={16} />
              <span>{busy ? "Sending" : "Send"}</span>
            </span>
          </button>
        </div>
      </div>

      {parentTxid ? (
        <div className="reply-banner">
          <Reply size={16} aria-hidden="true" />
          <span>
            Replying to <code>{parentTxid}</code>
          </span>
          <button
            className="secondary small"
            onClick={() => setParentTxid(undefined)}
            type="button"
          >
            Remove
          </button>
        </div>
      ) : null}

      <label>
        From
        <input readOnly value={sender || "Not connected"} />
      </label>

      <label>
        To
        <input
          autoComplete="off"
          list="proof-contact-options"
          onChange={(event) => setRecipient(event.target.value)}
          placeholder={
            network === "livenet" ? "bc1... or user@proofofwork.me" : "tb1..."
          }
          spellCheck={false}
          value={recipient}
        />
        <datalist id="proof-contact-options">
          {contacts.map((contact) => (
            <option
              key={contactKey(contact)}
              label={contact.name}
              value={contactTarget(contact)}
            />
          ))}
        </datalist>
      </label>
      {recipientTokens.length > 0 ? (
        <div className="recipient-chip-list" aria-label="Recipients">
          {recipientTokens.map((token, index) => (
            <button
              className="recipient-chip"
              key={`${token}-${index}`}
              onClick={() => removeRecipient(token)}
              title="Remove recipient"
              type="button"
            >
              <span>{shortAddress(token)}</span>
              <X size={13} />
            </button>
          ))}
        </div>
      ) : null}
      {recipientNote ? (
        <p className={recipientError ? "field-note bad" : "field-note"}>
          {recipientNote}
        </p>
      ) : null}

      <label>
        CC
        <input
          autoComplete="off"
          list="proof-contact-options"
          onChange={(event) => setCcRecipient(event.target.value)}
          placeholder="Optional visible copies"
          spellCheck={false}
          value={ccRecipient}
        />
      </label>
      {ccRecipientTokens.length > 0 ? (
        <div className="recipient-chip-list" aria-label="CC recipients">
          {ccRecipientTokens.map((token, index) => (
            <button
              className="recipient-chip"
              key={`${token}-${index}`}
              onClick={() => removeCcRecipient(token)}
              title="Remove CC recipient"
              type="button"
            >
              <span>{shortAddress(token)}</span>
              <X size={13} />
            </button>
          ))}
        </div>
      ) : null}
      {ccRecipientNote ? (
        <p className={ccRecipientError ? "field-note bad" : "field-note"}>
          {ccRecipientNote}
        </p>
      ) : null}

      <label>
        Subject
        <input
          autoComplete="off"
          maxLength={180}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Optional subject"
          value={subject}
        />
      </label>

      <div className="compose-grid">
        <label>
          Sats each
          <input
            min={1}
            onChange={(event) => setAmountSats(Number(event.target.value))}
            type="number"
            value={amountSats}
          />
        </label>
        <FeeRateControl feeRate={feeRate} setFeeRate={setFeeRate} />
      </div>

      <label className="memo-field">
        Message
        <textarea
          onChange={(event) => setMemo(event.target.value)}
          value={memo}
        />
      </label>

      <div className="attachment-control">
        <label className="attachment-picker">
          <input
            className="file-input"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) {
                setAttachmentFile(file);
              }
            }}
            type="file"
          />
          <span className="button-content">
            <Paperclip size={16} />
            <span>{attachment ? "Replace attachment" : "Attach file"}</span>
          </span>
        </label>
        <span>
          One file, {formatBytes(MAX_ATTACHMENT_BYTES)} max before encoding.
        </span>
      </div>

      {attachment ? (
        <AttachmentCard
          attachment={attachment}
          onRemove={() => setAttachment(undefined)}
        />
      ) : null}

      <div
        className={
          dataCarrierBytes > MAX_DATA_CARRIER_BYTES ? "counter bad" : "counter"
        }
      >
        {dataCarrierBytes.toLocaleString()} /{" "}
        {MAX_DATA_CARRIER_BYTES.toLocaleString()} OP_RETURN data-carrier bytes
      </div>
    </form>
  );
}

function AttachmentCard({
  attachment,
  onRemove,
}: {
  attachment: MailAttachment;
  onRemove?: () => void;
}) {
  return (
    <div className="attachment-card">
      <div className="attachment-icon" aria-hidden="true">
        <FileText size={20} />
      </div>
      <div className="attachment-info">
        <strong>{attachment.name}</strong>
        <span>
          {attachment.mime} · {formatBytes(attachment.size)}
        </span>
        <code>{shortAddress(attachment.sha256)}</code>
      </div>
      <div className="attachment-actions">
        {onRemove ? (
          <button className="secondary small" onClick={onRemove} type="button">
            <span className="button-content">
              <X size={15} />
              <span>Remove</span>
            </span>
          </button>
        ) : (
          <a
            className="secondary small link-button"
            download={attachment.name}
            href={attachmentHref(attachment)}
          >
            <span className="button-content">
              <Download size={15} />
              <span>Download</span>
            </span>
          </a>
        )}
      </div>
    </div>
  );
}

function Reader({
  activeCustomFolderId,
  activeNetwork,
  archivable,
  archived,
  checkingBroadcasts,
  customFolders,
  deliveryStatus,
  favoriteable,
  favorited,
  folderable,
  folderIds,
  message,
  onArchiveToggle,
  onCheckBroadcasts,
  onFavoriteToggle,
  onFolderToggle,
  onReply,
  onReplyAll,
  onRestoreDraft,
  threadMessages,
}: {
  activeCustomFolderId: string;
  activeNetwork: BitcoinNetwork;
  archivable: boolean;
  archived: boolean;
  checkingBroadcasts: boolean;
  customFolders: CustomFolderRecord[];
  deliveryStatus?: BroadcastStatus;
  favoriteable: boolean;
  favorited: boolean;
  folderable: boolean;
  folderIds: string[];
  message: MailMessage;
  onArchiveToggle: (message: MailMessage, archived: boolean) => void;
  onCheckBroadcasts: () => void;
  onFavoriteToggle: (message: MailMessage, favorite: boolean) => void;
  onFolderToggle: (
    message: MailMessage,
    folderId: string,
    enabled: boolean,
  ) => void;
  onReply: (message: MailMessage) => void;
  onReplyAll: (message: MailMessage) => void;
  onRestoreDraft: (message: MailMessage) => void;
  threadMessages: MailMessage[];
}) {
  const peerLabel = message.folder === "sent" ? "To" : "From";
  const peer =
    message.folder === "sent"
      ? recipientListText(
          message.toRecipients ?? message.recipients,
          message.to,
        )
      : message.from;
  const ccRecipients =
    message.folder === "sent" ? (message.ccRecipients ?? []) : [];
  const explorerNetwork = explorerNetworkFor(message.network, activeNetwork);
  const hasReplyAllTargets =
    (message.recipients?.length ?? 0) > 1 ||
    (isInboundFolder(message.folder) && Boolean(message.recipients?.length));
  const availableFolders = customFolders.filter(
    (folder) => !folderIds.includes(folder.id),
  );
  const activeCustomFolder = customFolders.find(
    (folder) => folder.id === activeCustomFolderId,
  );

  return (
    <article className="reader">
      <div className="pane-head">
        <div>
          <h2>{messageSubject(message)}</h2>
          <span>
            {formatDate(message.createdAt)}
            {message.parentTxid ? " · Reply" : ""}
          </span>
        </div>
        <div className="reader-actions">
          {deliveryStatus && deliveryStatus !== "confirmed" ? (
            <button
              className="secondary small"
              disabled={checkingBroadcasts}
              onClick={onCheckBroadcasts}
              type="button"
            >
              <span className="button-content">
                <RefreshCw size={15} />
                <span>{checkingBroadcasts ? "Checking" : "Check TX"}</span>
              </span>
            </button>
          ) : null}
          {deliveryStatus === "dropped" ? (
            <button
              className="secondary small"
              onClick={() => onRestoreDraft(message)}
              type="button"
            >
              <span className="button-content">
                <FilePenLine size={15} />
                <span>Rebuild Draft</span>
              </span>
            </button>
          ) : null}
          {favoriteable ? (
            <button
              className="secondary small"
              onClick={() => onFavoriteToggle(message, !favorited)}
              type="button"
            >
              <span className="button-content">
                <Star className={favorited ? "star-filled" : ""} size={15} />
                <span>{favorited ? "Unfavorite" : "Favorite"}</span>
              </span>
            </button>
          ) : null}
          {archivable ? (
            <button
              className="secondary small"
              onClick={() => onArchiveToggle(message, !archived)}
              type="button"
            >
              <span className="button-content">
                <Archive size={15} />
                <span>{archived ? "Unarchive" : "Archive"}</span>
              </span>
            </button>
          ) : null}
          {folderable && availableFolders.length > 0 ? (
            <label className="folder-action-select">
              <span>Folder</span>
              <select
                aria-label="Add to folder"
                onChange={(event) => {
                  const folderId = event.target.value;
                  event.target.value = "";
                  if (folderId) {
                    onFolderToggle(message, folderId, true);
                  }
                }}
                value=""
              >
                <option value="">Add to folder</option>
                {availableFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {folderable &&
          activeCustomFolder &&
          folderIds.includes(activeCustomFolder.id) ? (
            <button
              className="secondary small"
              onClick={() =>
                onFolderToggle(message, activeCustomFolder.id, false)
              }
              type="button"
            >
              <span className="button-content">
                <FolderPlus size={15} />
                <span>Remove</span>
              </span>
            </button>
          ) : null}
          <button
            className="secondary small"
            onClick={() => onReply(message)}
            type="button"
          >
            <span className="button-content">
              <Reply size={15} />
              <span>Reply</span>
            </span>
          </button>
          {hasReplyAllTargets ? (
            <button
              className="secondary small"
              onClick={() => onReplyAll(message)}
              type="button"
            >
              <span className="button-content">
                <Users size={15} />
                <span>Reply All</span>
              </span>
            </button>
          ) : null}
          <a
            className="secondary small link-button"
            href={explorerTxUrl(message.txid, explorerNetwork)}
            rel="noreferrer"
            target="_blank"
          >
            <span className="button-content">
              <ArrowUpRight size={15} />
              <span>View TX</span>
            </span>
          </a>
        </div>
      </div>

      <dl className="headers">
        <div>
          <dt>{peerLabel}</dt>
          <dd>{peer}</dd>
        </div>
        {isInboundFolder(message.folder) &&
        message.recipients &&
        message.recipients.length > 1 ? (
          <div>
            <dt>To</dt>
            <dd>{recipientListText(message.recipients, message.to)}</dd>
          </div>
        ) : null}
        {ccRecipients.length > 0 ? (
          <div>
            <dt>CC</dt>
            <dd>{recipientListText(ccRecipients, "")}</dd>
          </div>
        ) : null}
        <div>
          <dt>Value</dt>
          <dd>{message.amountSats.toLocaleString()} sats</dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd>{networkLabel(explorerNetwork)}</dd>
        </div>
        {deliveryStatus ? (
          <div>
            <dt>Status</dt>
            <dd>{deliveryLabel(deliveryStatus)}</dd>
          </div>
        ) : message.folder === "incoming" ? (
          <div>
            <dt>Status</dt>
            <dd>Pending</dd>
          </div>
        ) : null}
        {message.folder === "sent" && message.lastCheckedAt ? (
          <div>
            <dt>Last Checked</dt>
            <dd>{formatDate(message.lastCheckedAt)}</dd>
          </div>
        ) : null}
        {message.parentTxid ? (
          <div>
            <dt>Reply To</dt>
            <dd>{message.parentTxid}</dd>
          </div>
        ) : null}
      </dl>

      <pre>{message.memo}</pre>

      {message.attachment ? (
        <AttachmentCard attachment={message.attachment} />
      ) : null}

      {threadMessages.length > 1 ? (
        <section className="thread-panel">
          <h3>Thread</h3>
          {threadMessages.map((threadMessage) => (
            <article className="thread-item" key={mailKey(threadMessage)}>
              <div>
                <strong>
                  {isInboundFolder(threadMessage.folder) ? "From" : "To"}{" "}
                  {shortAddress(peerAddress(threadMessage))}
                </strong>
                <span>
                  {formatDate(threadMessage.createdAt)} ·{" "}
                  {threadMessage.amountSats.toLocaleString()} sats
                </span>
              </div>
              <p>{mailPreview(threadMessage)}</p>
            </article>
          ))}
        </section>
      ) : null}

      <div className="txid">
        <span>TXID</span>
        <code>{message.txid}</code>
      </div>
    </article>
  );
}
