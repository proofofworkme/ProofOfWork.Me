export type YouTubeLink = { videoId: string; start: number; watchUrl: string };
export const MAX_YOUTUBE_CARDS: number;
export function parseYouTubeUrl(value: unknown): YouTubeLink | null;
export function youtubeLinksFromText(value: unknown): YouTubeLink[];
