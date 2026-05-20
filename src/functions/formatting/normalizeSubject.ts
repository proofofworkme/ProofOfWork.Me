export function normalizeSubject(value: string) {
  return value.trim().replace(/\s+/gu, " ").slice(0, 180);
}
