import { normalizeSearchQuery } from "./normalizeSearchQuery";

export function searchIncludes(
  values: Array<string | number | undefined>,
  query: string,
) {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return true;
  }

  return values.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(normalized),
  );
}
