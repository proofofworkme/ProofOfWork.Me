export type NotificationReadState = { version: 1; entries: Record<string, { read: boolean; at: number }>; readThrough?: { firstSeenAt: string; maxEventId: number; at: number }; readBoundaries?: { firstSeenAt: string; maxEventId: number; at: number }[] };
export function notificationStorageKey(network: string, address: string): string;
export function emptyNotificationReadState(): NotificationReadState;
export function parseNotificationReadState(raw: string | null): NotificationReadState;
export function mergeNotificationReadStates(left: NotificationReadState, right: NotificationReadState): NotificationReadState;
export function setNotificationsRead(state: NotificationReadState, ids: string[], read: boolean, now?: number): NotificationReadState;
export function notificationIsRead(state: NotificationReadState, item: { id: string; firstSeenAt?: string | number | null; maxEventId?: number | null }): boolean;
export function appendNotificationPage<T extends { network: string; address: string | null; scopeKey?: string; scope?: { type: string; id?: string; registrationTxid?: string }; snapshotId: string; items: { id: string }[]; nextCursor: string | null; hasMore: boolean }>(previous: T, page: T, requestedCursor: string): T;

export function setAllNotificationsRead(state: NotificationReadState, items: { id: string }[], firstSeenAt: string, maxEventId: number, now?: number): NotificationReadState;

export function notificationAddressScope(address: string): string;

export function serializeNotificationReadState(state: NotificationReadState): string;
export function reconcileNotificationReadStorage(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void }, key: string, memory: NotificationReadState, change?: (state: NotificationReadState) => NotificationReadState): { state: NotificationReadState; warning: string };

export function notificationSnapshotReadIds(response: import("./notificationsApi").NotificationsResponse): string[];
export function notificationHasUnloadedUnread(state: NotificationReadState, response: import("./notificationsApi").NotificationsResponse | null): boolean;
