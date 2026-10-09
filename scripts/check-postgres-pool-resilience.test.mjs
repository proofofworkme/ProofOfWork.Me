import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import { test } from "node:test";
import { createProofIndexPool } from "../server/db/postgres.mjs";

const int32 = value => { const bytes = Buffer.alloc(4); bytes.writeInt32BE(value); return bytes; };
const int16 = value => { const bytes = Buffer.alloc(2); bytes.writeInt16BE(value); return bytes; };
const frame = (type, payload = Buffer.alloc(0)) => Buffer.concat([Buffer.from(type), int32(payload.length + 4), payload]);
const errorPayload = code => Buffer.from(`SFATAL\0V FATAL\0C${code}\0Mprivate database URL and query detail\0Dprivate retained record\0\0`);

async function wireDatabase() {
  const sockets = new Set(); let connections = 0;
  const server = net.createServer(socket => {
    sockets.add(socket); connections += 1;
    socket.once("close", () => sockets.delete(socket));
    let startup = true, buffer = Buffer.alloc(0);
    socket.on("data", bytes => {
      buffer = Buffer.concat([buffer, bytes]);
      while (buffer.length >= (startup ? 4 : 5)) {
        const size = buffer.readInt32BE(startup ? 0 : 1) + (startup ? 0 : 1);
        if (buffer.length < size) return;
        const packet = buffer.subarray(0, size); buffer = buffer.subarray(size);
        if (startup) {
          startup = false;
          socket.write(Buffer.concat([frame("R", int32(0)), frame("Z", Buffer.from("I"))]));
        } else if (String.fromCharCode(packet[0]) === "Q") {
          const query = packet.subarray(5, -1).toString();
          if (query === "SELECT interrupted") {
            socket.write(Buffer.concat([frame("E", errorPayload("57014")), frame("Z", Buffer.from("I"))]));
          } else {
            const field = Buffer.concat([Buffer.from("value\0"), int32(0), int16(0), int32(23), int16(4), int32(-1), int16(0)]);
            socket.write(Buffer.concat([
              frame("T", Buffer.concat([int16(1), field])),
              frame("D", Buffer.concat([int16(1), int32(1), Buffer.from("1")])),
              frame("C", Buffer.from("SELECT 1\0")), frame("Z", Buffer.from("I")),
            ]));
          }
        } else if (String.fromCharCode(packet[0]) === "X") socket.end();
      }
    });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return { port: server.address().port, sockets, get connections() { return connections; },
    async close() { for (const socket of sockets) socket.destroy(); server.close(); await once(server, "close"); } };
}

test("Idle database shutdown is sanitized, removes the broken client and recovers without swallowing active query failures", async () => {
  const database = await wireDatabase();
  const pool = createProofIndexPool({ connectionString: `postgresql://fixture@127.0.0.1:${database.port}/fixture`,
    env: { POW_INDEX_DB_CONNECT_TIMEOUT_MS: "1000", POW_INDEX_DB_POOL_MAX: "1" } });
  const messages = [], previous = console.error;
  console.error = value => messages.push(value);
  try {
    assert.equal((await pool.query("SELECT 1")).rows[0].value, 1);
    assert.equal(pool.idleCount, 1);
    const failure = once(pool, "error");
    const socket = [...database.sockets][0];
    socket.write(frame("E", errorPayload("57P01")));
    const [error] = await failure;
    assert.equal(error.code, "57P01");
    assert.equal(pool.totalCount, 0);
    assert.deepEqual(JSON.parse(messages[0]), { service: "proof-index-database", event: "idle-client-error", code: "57P01" });
    assert.doesNotMatch(messages.join(""), /private|postgresql:|fixture/u);
    assert.equal((await pool.query("SELECT 1")).rows[0].value, 1);
    assert.equal(database.connections, 2);
    const idleLogs = messages.length;
    await assert.rejects(pool.query("SELECT interrupted"), error => error.code === "57014");
    assert.equal(messages.length, idleLogs, "active query rejection is not converted to idle success");
    assert.equal((await pool.query("SELECT 1")).rows[0].value, 1);
  } finally {
    console.error = previous; await pool.end(); await database.close();
  }
});

test("Idle error logs never serialize error message, stack, or malformed code", async () => {
  const pool = createProofIndexPool({ connectionString: "postgresql://fixture@127.0.0.1:1/fixture", env: {} });
  const messages = [], previous = console.error; console.error = value => messages.push(value);
  try {
    pool.emit("error", Object.assign(new Error("private credentials"), { code: "bad\nprivate" }));
    pool.emit("error", new Error("private query"));
    assert.equal(messages.length, 2);
    assert.ok(messages.every(value => JSON.parse(value).code === "UNKNOWN"));
    assert.doesNotMatch(messages.join(""), /private|credentials|query|stack/u);
  } finally { console.error = previous; await pool.end(); }
});
