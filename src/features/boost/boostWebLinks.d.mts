export function boostWebLinkCodeRanges(text: string): Array<{ start: number; end: number }>;
export function boostWebLinks(text: string, options?: { codeRanges?: Array<{ start: number; end: number }>; sourceOffset?: number }): Array<{ text: string; href?: string }>;
