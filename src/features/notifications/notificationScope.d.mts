import type { NotificationQuery, NotificationsResponse } from "./notificationsApi";
export function notificationQueryKey(query: NotificationQuery): string;
export function notificationQueryParams(query: NotificationQuery, cursor?: string): string;
export function notificationReadScope(query: NotificationQuery, response: NotificationsResponse | null): string | null;
