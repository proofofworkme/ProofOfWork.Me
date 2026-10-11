import {
  AtSign, BookOpen, BriefcaseBusiness, ChartNoAxesCombined, Code2, Coins,
  FilePenLine, FolderOpen, Globe, House, Infinity, ListTree, Mail,
  MessageSquareQuote, Monitor, Network, PanelsTopLeft, Search, ShieldCheck,
  Sprout, Store, TrendingUp, Users, Wallet, type LucideIcon,
} from "lucide-react";

// One visual identity for each app across public navigation and Computer.
export const APP_ICONS: Readonly<Record<string, LucideIcon>> = {
  Home: House,
  Computer: PanelsTopLeft,
  Mail,
  Files: FolderOpen,
  Desktop: Monitor,
  Browser: Globe,
  Pages: FilePenLine,
  Boost: MessageSquareQuote,
  Publish: BookOpen,
  Search,
  Code: Code2,
  Jobs: BriefcaseBusiness,
  Permission: ShieldCheck,
  IDs: AtSign,
  DNS: Network,
  AMO: Store,
  Credit: Coins,
  Wallet,
  WORK: TrendingUp,
  Infinity,
  Inception: Sprout,
  Log: ListTree,
  Growth: ChartNoAxesCombined,
  Contacts: Users,
};
