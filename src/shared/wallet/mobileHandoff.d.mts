export function isMobileWalletBrowser(environment?: {
  userAgent?: string; platform?: string; maxTouchPoints?: number;
}): boolean;
export function unisatMobileHandoff(currentUrl: string): { destination: string; href: string };
