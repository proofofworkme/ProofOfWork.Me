import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { PAY2SPEAK_APP_URL } from "../../app/appLinks";
import { appHref } from "../../app/routeRegistry";

export type Pay2SpeakCampaign = {
  confirmed: boolean;
  createdAt: string;
  creatorAddress: string;
  dataBytes?: number;
  fundedGrossSats: number;
  fundingCount: number;
  handle: string;
  network: BitcoinNetwork;
  registrySats: number;
  spaceNumber: number;
  status: "Funding" | "Funded";
  targetGrossSats: number;
  title: string;
  txid: string;
};

export type Pay2SpeakFunding = {
  campaignId: string;
  confirmed: boolean;
  createdAt: string;
  creatorAddress: string;
  creatorSats: number;
  dataBytes?: number;
  donorAddress: string;
  grossSats: number;
  network: BitcoinNetwork;
  question?: string;
  registrySats: number;
  txid: string;
};

export type Pay2SpeakQuestion = {
  campaignId: string;
  confirmed: boolean;
  createdAt: string;
  grossSats: number;
  question: string;
  txid: string;
};

export type Pay2SpeakState = {
  campaigns: Pay2SpeakCampaign[];
  funding: Pay2SpeakFunding[];
  questions: Pay2SpeakQuestion[];
};

export const PAY2SPEAK_PROTOCOL_PREFIX = "pws1:";
export const PAY2SPEAK_REGISTRY_PRICE_SATS = 1000;
export const PAY2SPEAK_SPLIT_THRESHOLD_SATS = 5460;
export const PAY2SPEAK_REGISTRY_ADDRESSES: Partial<
  Record<BitcoinNetwork, string>
> = {
  livenet: "bc1q4k34zlkgwtuhfpfrcpml2ajvj66x22x20an2t4",
};

export function pay2SpeakRegistryAddressForNetwork(
  network: BitcoinNetwork,
) {
  return PAY2SPEAK_REGISTRY_ADDRESSES[network] ?? "";
}

export function pay2SpeakCampaignProgress(campaign: Pay2SpeakCampaign) {
  if (campaign.targetGrossSats <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.round((campaign.fundedGrossSats / campaign.targetGrossSats) * 100),
  );
}

export function pay2SpeakCreatorUrl(creatorAddress: string) {
  const localHref = `/?pay2speak=1&creator=${encodeURIComponent(creatorAddress)}`;
  const productionHref = `${PAY2SPEAK_APP_URL}/?creator=${encodeURIComponent(creatorAddress)}`;
  return appHref(productionHref, localHref);
}
