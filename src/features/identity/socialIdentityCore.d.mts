import type { BoostIdentityIntent } from "../boost/boostProtocol";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
export const SOCIAL_IDENTITY_STORAGE_KEY: string;
export const SOCIAL_IDENTITY_REQUEST: string;
export const SOCIAL_IDENTITY_RESPONSE: string;
export const SOCIAL_IDENTITY_CHANGED: string;
export const SOCIAL_IDENTITY_ORIGINS: readonly string[];
export function normalizeSocialIdentityId(value: unknown): string;
export function socialIdentityIntentMessage(intent: Pick<BoostIdentityIntent, "address" | "createdAt" | "id" | "network">): string;
export function socialIdentityAccountKey(address: string, network: BitcoinNetwork): string;
export function validSocialIdentityAccount(address: unknown, network: unknown): boolean;
export function verifiedSocialIdentityIntent(value: unknown, address?: string, network?: BitcoinNetwork, now?: number): BoostIdentityIntent | undefined;
export function newestSocialIdentityIntent(current?: BoostIdentityIntent, candidate?: BoostIdentityIntent): BoostIdentityIntent | undefined;
export function readSocialIdentityIntent(storage: StorageLike, address: string, network: BitcoinNetwork): BoostIdentityIntent | undefined;
export function storeSocialIdentityIntent(storage: StorageLike, intent: BoostIdentityIntent): boolean;
export function trustedSocialIdentityOrigin(origin: string, ownOrigin: string): boolean;
export function validSocialIdentityRequest(value: unknown): value is {
  type: string;
  nonce: string;
  operation: "sync" | "subscribe" | "unsubscribe";
  address: string;
  network: BitcoinNetwork;
  intent?: BoostIdentityIntent;
};
