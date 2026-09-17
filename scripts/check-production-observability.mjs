#!/usr/bin/env node

import fs from "node:fs";

const healthUrl = process.env.POW_HEALTH_URL ||
  "https://computer.proofofwork.me/health?network=livenet";
const maxDiskPercent = Number(process.env.POW_MAX_DISK_PERCENT || 80);
const maxPayloadBytes = Number(process.env.POW_MAX_PAYLOAD_BYTES || 8_000_000);
const alerts = [];

function alert(kind, details) {
  alerts.push({ kind, ...details });
}

const response = await fetch(healthUrl, { signal: AbortSignal.timeout(30_000) });
let health = null;
try {
  health = await response.json();
} catch {
  alert("health-invalid-json", { status: response.status });
}
if (!response.ok || health?.ok !== true || health?.ready !== true) {
  alert("health-not-ready", {
    status: response.status,
    ok: health?.ok ?? false,
    ready: health?.ready ?? false,
    lagBlocks: health?.lagBlocks ?? null,
  });
}
if (Number(health?.lagBlocks) > 0) {
  alert("canonical-lag", { lagBlocks: Number(health.lagBlocks) });
}

for (const path of process.env.POW_DISK_PATHS
  ? process.env.POW_DISK_PATHS.split(",").filter(Boolean)
  : []) {
  const stat = fs.statfsSync(path);
  const usedPercent = 100 - (Number(stat.bavail) / Number(stat.blocks)) * 100;
  if (usedPercent >= maxDiskPercent) {
    alert("disk-runway", { path, usedPercent: Math.round(usedPercent * 100) / 100 });
  }
}

if (Number(process.env.POW_LAST_PAYLOAD_BYTES || 0) >= maxPayloadBytes) {
  alert("payload-growth", {
    payloadBytes: Number(process.env.POW_LAST_PAYLOAD_BYTES),
    maxPayloadBytes,
  });
}

console.log(JSON.stringify({
  alertCount: alerts.length,
  alerts,
  checkedAt: new Date().toISOString(),
  healthUrl,
  ok: alerts.length === 0,
}));
process.exitCode = alerts.length === 0 ? 0 : 1;
