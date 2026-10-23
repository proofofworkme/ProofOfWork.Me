import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { notificationQueryParams } from "./notificationScope.mjs";
import { validateNotificationsResponse } from "./notificationsResponse.mjs";

export type NotificationDirection = "incoming" | "outgoing" | "self" | "related";
export type NotificationTarget = { workspace: string; txid: string; version?: string; id?: string; asset?: string };
export type ComputerNotification = {
  id: string; app: string; kind: string; label: string; detail: string;
  direction: NotificationDirection;
  status: "confirmed" | "pending" | "dropped" | "orphaned" | "invalid" | "unavailable";
  txid: string; protocolVout: number | null; recordOrdinal: number | null;
  createdAt: string | number | null;
  firstSeenAt?: string | number | null;
  maxEventId?: number | null;
  actions?: Omit<ComputerNotification, "actions">[];
  actorAddress: string | null; senderAddresses?: string[]; recipientAddresses: string[]; relatedTxids: string[];
  evidence: { protocol: string; valid: boolean | null; applied?: boolean; blockHeight?: number | null; blockHash?: string | null; sourceEventId: string | number | null; chainStatus?: string; reason?: string | null; qualification?: string | Record<string, unknown>; amounts?: Record<string, string | number>; [field: string]: unknown };
  target: NotificationTarget;
};
export type NotificationsResponse = {
  model: "proof-computer-notifications-v1";
  network: BitcoinNetwork; address: string | null;
  scope?: { type: "address"; address: string } | { type: "id"; id: string; registrationTxid: string };
  scopeKey?: string; items: ComputerNotification[];
  nextCursor: string | null; hasMore: boolean; totalCount: number;
  indexedThroughBlock: number | null; indexedThroughBlockHash: string | null;
  coverage: { complete: boolean; scope: string; pending: string; qualification: string[]; localActions?: string; mentions?: string };
  observedAt?: string; readBoundary?: { maxFirstSeenAt: string | null; maxEventId: number; explicitIds?: string[] };
  snapshotId: string;
};
export type NotificationQuery = { network: BitcoinNetwork } & ({ address: string; id?: never } | { id: string; address?: never });

export async function fetchNotifications(query: NotificationQuery, signal: AbortSignal, cursor?: string): Promise<NotificationsResponse> {
  const params = notificationQueryParams(query, cursor);
  const response = await fetchProofApiJson<unknown>(`/api/v1/notifications?${params}`, query.network, { signal, timeoutMs: 30_000 });
  return validateNotificationsResponse(response, query);
}
