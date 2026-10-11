import type { LucideIcon } from "lucide-react";
import { APP_ICONS } from "../../app/appIcons";

export type ComputerLayout = "focus" | "desktop";

// Presentation preference only; drafts and transaction recovery retain their keys.
export const COMPUTER_LAYOUT_STORAGE_KEY = "proofofwork-me-computer-layout-v1";

export type ComputerWorkspace =
  | "inbox" | "incoming" | "sent" | "outbox" | "drafts" | "favorites" | "archive"
  | "files" | "desktop" | "browser" | "pages" | "boost" | "publish" | "search"
  | "code" | "jobs" | "permission" | "ids" | "dns" | "marketplace" | "token"
  | "wallet" | "work" | "infinity" | "inception" | "log" | "contacts" | "custom";

export type ComputerApp = {
  workspace: ComputerWorkspace;
  label: string;
  description: string;
  icon: LucideIcon;
  keywords?: string;
};

// Existing Computer destinations, never independent workspace or signing instances.
export const COMPUTER_APPS: readonly ComputerApp[] = [
  { workspace: "inbox", label: "Mail", description: "Messages, drafts and local folders", icon: APP_ICONS.Mail, keywords: "inbox incoming sent outbox favorites archive compose" },
  { workspace: "files", label: "Files", description: "Your confirmed message attachments", icon: APP_ICONS.Files },
  { workspace: "desktop", label: "Desktop", description: "Public file desktop", icon: APP_ICONS.Desktop, keywords: "public files address" },
  { workspace: "browser", label: "Browser", description: "Verified pages and apps", icon: APP_ICONS.Browser },
  { workspace: "pages", label: "Pages", description: "Create HTML pages and apps", icon: APP_ICONS.Pages },
  { workspace: "boost", label: "Boost", description: "Proof-ranked posts and people", icon: APP_ICONS.Boost, keywords: "social" },
  { workspace: "publish", label: "Publish", description: "Write and read articles", icon: APP_ICONS.Publish },
  { workspace: "search", label: "Search", description: "Discover public chain records", icon: APP_ICONS.Search, keywords: "transactions evidence" },
  { workspace: "code", label: "Code", description: "Public source repositories", icon: APP_ICONS.Code },
  { workspace: "jobs", label: "Jobs", description: "Briefs, delivery and direct payments", icon: APP_ICONS.Jobs },
  { workspace: "permission", label: "Permission", description: "Wallet-bound agent permissions", icon: APP_ICONS.Permission, keywords: "grants" },
  { workspace: "ids", label: "IDs", description: "Registration, receivers and direct transfers", icon: APP_ICONS.IDs, keywords: "identity names" },
  { workspace: "dns", label: "DNS", description: "Your .pow names and records", icon: APP_ICONS.DNS, keywords: "domains subdomains" },
  { workspace: "marketplace", label: "AMO", description: "Listings, seals and asset markets", icon: APP_ICONS.AMO, keywords: "marketplace sale tickets" },
  { workspace: "token", label: "Credit", description: "Create and mint credits", icon: APP_ICONS.Credit, keywords: "tokens" },
  { workspace: "wallet", label: "Wallet", description: "Balances, transfers and history", icon: APP_ICONS.Wallet },
  { workspace: "work", label: "WORK", description: "WORK dashboard and floor", icon: APP_ICONS.WORK },
  { workspace: "infinity", label: "Infinity", description: "Infinity Bonds and POWB", icon: APP_ICONS.Infinity },
  { workspace: "inception", label: "Inception", description: "Inception Bonds and INCB", icon: APP_ICONS.Inception },
  { workspace: "log", label: "Log", description: "Transaction-backed activity", icon: APP_ICONS.Log },
  { workspace: "contacts", label: "Contacts", description: "Your local address book", icon: APP_ICONS.Contacts },
];

const MAIL_WORKSPACES: readonly ComputerWorkspace[] = [
  "inbox", "incoming", "sent", "outbox", "drafts", "favorites", "archive", "custom",
];

export function computerAppForWorkspace(workspace: ComputerWorkspace): ComputerApp {
  return COMPUTER_APPS.find((app) => app.workspace === workspace) ?? COMPUTER_APPS[0];
}

export function computerAppIsActive(app: ComputerApp, workspace: ComputerWorkspace): boolean {
  return app.workspace === "inbox" ? MAIL_WORKSPACES.includes(workspace) : app.workspace === workspace;
}

const DOCK_WORKSPACES: readonly ComputerWorkspace[] = [
  "inbox", "files", "browser", "pages", "ids", "dns", "wallet", "marketplace", "code", "jobs",
];

export const COMPUTER_DOCK_APPS = DOCK_WORKSPACES.map(computerAppForWorkspace);

export function findComputerApps(query: string): readonly ComputerApp[] {
  const terms = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
  return COMPUTER_APPS.filter((app) => {
    const text = `${app.label} ${app.description} ${app.keywords ?? ""}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
