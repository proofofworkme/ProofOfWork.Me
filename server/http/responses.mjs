const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";

export function jsonResponse(
  response,
  statusCode,
  payload,
  cacheControl = "no-store",
) {
  writeJsonBody(response, statusCode, JSON.stringify(payload), cacheControl);
}

export function writeJsonBody(
  response,
  statusCode,
  body,
  cacheControl = "no-store",
  cacheStatus = "",
) {
  // writeHead-only headers are sent but are not retained by getHeader(). Keep
  // this value available to the response observer, using UTF-8 byte length.
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.writeHead(statusCode, {
    "Access-Control-Allow-Headers":
      "Accept, Authorization, Cache-Control, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Cache-Control": cacheControl,
    "Content-Type": "application/json; charset=utf-8",
    ...(cacheStatus ? { "X-PoW-Cache": cacheStatus } : {}),
  });
  response.end(body);
}

export function errorResponse(response, statusCode, message, details) {
  jsonResponse(response, statusCode, {
    details,
    error: message,
    ok: false,
  });
}

export function optionsResponse(response) {
  response.writeHead(204, {
    "Access-Control-Allow-Headers":
      "Accept, Authorization, Cache-Control, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
  });
  response.end();
}
