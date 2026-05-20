function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "";
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) {
      return value;
    }
  }

  return "";
}

function objectErrorMessage(error: Record<string, unknown>) {
  const direct = firstString(error, [
    "message",
    "error",
    "reason",
    "rejectReason",
    "reject-reason",
    "statusText",
    "detail",
  ]);
  const details = isRecord(error.details) ? error.details : null;
  const detailText = details
    ? firstString(details, [
        "message",
        "error",
        "reason",
        "rejectReason",
        "reject-reason",
        "hint",
      ])
    : "";
  const code = numberValue(error.code) || (details ? numberValue(details.code) : "");
  const message = direct || detailText;

  if (message && code && !message.includes(code)) {
    return `${message} (code ${code})`;
  }

  if (message) {
    return message;
  }

  if (code) {
    return `Error code ${code}`;
  }

  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== "{}" && serialized !== "[]"
      ? serialized
      : "";
  } catch {
    return "";
  }
}

export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error) {
    return error;
  }

  if (isRecord(error)) {
    return objectErrorMessage(error) || fallback || "Unknown error.";
  }

  return fallback || "Unknown error.";
}
