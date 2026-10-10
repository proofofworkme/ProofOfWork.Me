import {
  AtSign, BookOpen, BriefcaseBusiness, Code2, FilePenLine, FolderOpen, Globe,
  Infinity, ListTree, Mail, MessageSquareQuote, Monitor, Network, Search,
  ShieldCheck, Sprout, Store, TrendingUp, Users, Wallet, type LucideIcon,
} from "lucide-react";

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
  { workspace: "inbox", label: "Mail", description: "Messages, drafts and local folders", icon: Mail, keywords: "inbox incoming sent outbox favorites archive compose" },
  { workspace: "files", label: "Files", description: "Your confirmed message attachments", icon: FolderOpen },
  { workspace: "desktop", label: "Desktop", description: "Public file desktop", icon: Monitor, keywords: "public files address" },
  { workspace: "browser", label: "Browser", description: "Verified pages and apps", icon: Globe },
  { workspace: "pages", label: "Pages", description: "Create HTML pages and apps", icon: FilePenLine },
  { workspace: "boost", label: "Boost", description: "Proof-ranked posts and people", icon: MessageSquareQuote, keywords: "social" },
  { workspace: "publish", label: "Publish", description: "Write and read articles", icon: BookOpen },
  { workspace: "search", label: "Search", description: "Discover public chain records", icon: Search, keywords: "transactions evidence" },
  { workspace: "code", label: "Code", description: "Public source repositories", icon: Code2 },
  { workspace: "jobs", label: "Jobs", description: "Briefs, delivery and direct payments", icon: BriefcaseBusiness },
  { workspace: "permission", label: "Permission", description: "Wallet-bound agent permissions", icon: ShieldCheck, keywords: "grants" },
  { workspace: "ids", label: "IDs", description: "Registration, receivers and direct transfers", icon: AtSign, keywords: "identity names" },
  { workspace: "dns", label: "DNS", description: "Your .pow names and records", icon: Network, keywords: "domains subdomains" },
  { workspace: "marketplace", label: "AMO", description: "Listings, seals and asset markets", icon: Store, keywords: "marketplace sale tickets" },
  { workspace: "token", label: "Credit", description: "Create and mint credits", icon: Sprout, keywords: "tokens" },
  { workspace: "wallet", label: "Wallet", description: "Balances, transfers and history", icon: Wallet },
  { workspace: "work", label: "WORK", description: "WORK dashboard and floor", icon: TrendingUp },
  { workspace: "infinity", label: "Infinity", description: "Infinity Bonds and POWB", icon: Infinity },
  { workspace: "inception", label: "Inception", description: "Inception Bonds and INCB", icon: Sprout },
  { workspace: "log", label: "Log", description: "Transaction-backed activity", icon: ListTree },
  { workspace: "contacts", label: "Contacts", description: "Your local address book", icon: Users },
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
