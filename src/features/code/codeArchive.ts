import { validateCodePath } from "../../shared/protocol/codeRepository.mjs";

// A standards-compliant, uncompressed ZIP preserves exact UTF-8 source bytes and paths.
// UTF-8 filename flags are set on both records; no generated source is executed.
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function record(length: number, fields: [number, number, 2 | 4][]) {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  for (const [offset, value, width] of fields) width === 2 ? view.setUint16(offset, value, true) : view.setUint32(offset, value, true);
  return bytes;
}
export function codeRepositoryZip(files: { path: string; bytes: Uint8Array }[]) {
  const paths = files.map(file => file.path).sort();
  const pathSet = new Set(paths);
  if (pathSet.size !== paths.length || paths.some(path => !validateCodePath(path) || path.split("/").slice(0, -1).some((_, index, parts) => pathSet.has(parts.slice(0, index + 1).join("/"))))) {
    throw new Error("Archive contains an unsafe, duplicate, or conflicting repository path.");
  }
  if (files.length > 65535) throw new Error("Repository exceeds the supported ZIP file count.");
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.path);
    if (!name.length || name.length > 65535 || file.bytes.length > 0xffffffff) throw new Error("A repository file exceeds the supported ZIP limits.");
    const crc = crc32(file.bytes);
    const header = record(30, [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [12, 0x21, 2], [14, crc, 4], [18, file.bytes.length, 4], [22, file.bytes.length, 4], [26, name.length, 2]]);
    const entry = record(46, [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [14, 0x21, 2], [16, crc, 4], [20, file.bytes.length, 4], [24, file.bytes.length, 4], [28, name.length, 2], [42, offset, 4]]);
    parts.push(header, name, file.bytes);
    central.push(entry, name);
    offset += header.length + name.length + file.bytes.length;
  }
  const centralSize = central.reduce((sum, bytes) => sum + bytes.length, 0);
  if (offset + centralSize > 0xffffffff) throw new Error("Repository exceeds the supported ZIP size.");
  const end = record(22, [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, centralSize, 4], [16, offset, 4]]);
  return new Blob([...parts, ...central, end].map(bytes => new Uint8Array(bytes).buffer), { type: "application/zip" });
}
export function downloadCodeBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
}
