import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { after, test } from "node:test";
import ts from "typescript";

const dataModule = (source, name) => `data:text/javascript;base64,${Buffer.from(
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: name,
  }).outputText,
).toString("base64")}`;
const readState = dataModule(await readFile("src/shared/api/proofApiReadState.ts", "utf8"), "readState.ts");
const server = http.createServer((request, response) => {
  const route = new URL(request.url, "http://localhost").pathname;
  if (route === "/headers-stall") return;
  response.writeHead(route.startsWith("/error") ? 503 : 200, { "Content-Type": "application/json" });
  if (route.endsWith("stall")) {
    response.flushHeaders();
    response.write('{"partial":');
    return;
  }
  response.end(route === "/invalid" ? "invalid JSON" : route === "/error" ?
    JSON.stringify({ error: "Canonical data catching up", details: { code: "CANONICAL_INDEX_CATCHING_UP" } }) :
    JSON.stringify({ exact: "9007199254740993", confirmed: true }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
after(() => { server.closeAllConnections(); server.close(); });
const base = `http://127.0.0.1:${server.address().port}`;
const clientSource = (await readFile("src/shared/api/proofApiClient.ts", "utf8"))
  .replaceAll('"./proofApiReadState"', JSON.stringify(readState))
  .replace("import.meta.env.VITE_POW_API_BASE", JSON.stringify(base));
const { fetchProofApiJson, ProofApiRequestError } = await import(dataModule(clientSource, "proofApiClient.ts"));

for (const route of ["/headers-stall", "/body-stall", "/error-stall"]) {
  test(`deadline covers ${route}`, async () => {
    const started = performance.now();
    await assert.rejects(fetchProofApiJson(route, "livenet", { timeoutMs: 150 }), /refresh took too long/u);
    assert.ok(performance.now() - started < 2000, "deadline must bound the whole response");
  });
}
for (const route of ["/headers-stall", "/body-stall", "/error-stall"]) {
  test(`caller cancellation covers ${route}`, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      await assert.rejects(fetchProofApiJson(route, "livenet", { signal: controller.signal, timeoutMs: 2000 }),
        (error) => error.name === "AbortError" && !/refresh took too long/u.test(error.message));
    } finally { clearTimeout(timer); }
  });
}
test("already cancelled callers remain cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchProofApiJson("/ok", "livenet", { signal: controller.signal }), { name: "AbortError" });
});
test("HTTP error bodies preserve structured canonical unavailability", async () => {
  await assert.rejects(fetchProofApiJson("/error", "livenet"), (error) =>
    error instanceof ProofApiRequestError && error.status === 503 && error.code === "CANONICAL_INDEX_CATCHING_UP");
});
test("successful exact data and invalid JSON retain their semantics", async () => {
  assert.deepEqual(await fetchProofApiJson("/ok?fresh=1", "livenet"), { exact: "9007199254740993", confirmed: true });
  await assert.rejects(fetchProofApiJson("/invalid", "livenet"), SyntaxError);
});
test("settled reads detach caller cancellation listeners", async () => {
  const controller = new AbortController();
  let attached = 0;
  let removed = 0;
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args) => { attached += 1; return add(...args); };
  controller.signal.removeEventListener = (...args) => { removed += 1; return remove(...args); };
  await fetchProofApiJson("/ok", "livenet", { signal: controller.signal, timeoutMs: 100 });
  assert.equal(attached, 1);
  assert.equal(removed, 1);
  controller.abort();
});
