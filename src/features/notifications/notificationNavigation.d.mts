export function notificationDestination(target: { workspace: string; txid: string; version?: string }, transactionId: string): {
  workspace: "jobs" | "code" | "permission" | "publish" | "boost" | "browser" | "search";
  params: Record<string, string>;
};
