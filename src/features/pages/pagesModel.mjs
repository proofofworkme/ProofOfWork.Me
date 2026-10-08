export const MAX_PAGE_BYTES = 100_000;
export const MAX_PAGE_DRAFTS = 20;

export function pageByteLength(html) {
  return new TextEncoder().encode(html).byteLength;
}

export function pagesStorageKey(network, address = "") {
  if (!["livenet", "testnet", "testnet4"].includes(network)) {
    throw new Error("Unknown Pages network.");
  }
  return `proofofwork.pages.drafts.v1.${network}.${encodeURIComponent(address || "disconnected")}`;
}

export function validatePageHtml(html) {
  if (typeof html !== "string" || !html.trim()) throw new Error("Add HTML before continuing.");
  if (pageByteLength(html) > MAX_PAGE_BYTES) {
    throw new Error(`HTML exceeds ${MAX_PAGE_BYTES.toLocaleString()} UTF-8 bytes. Export your draft and reduce its size before publishing.`);
  }
  return html;
}

// Decode without normalizing whitespace or stripping a UTF-8 BOM. Re-encoding
// checks that imports remain the same bytes used by the existing Files carrier.
export function decodePageFile(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_PAGE_BYTES) {
    throw new Error(`Import an HTML file of at most ${MAX_PAGE_BYTES.toLocaleString()} bytes.`);
  }
  let html;
  try {
    html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error("This file is not valid UTF-8 HTML.");
  }
  const encoded = new TextEncoder().encode(html);
  if (encoded.length !== bytes.length || encoded.some((value, index) => value !== bytes[index])) {
    throw new Error("The file's UTF-8 bytes could not be preserved.");
  }
  return validatePageHtml(html);
}

export function escapePageHtml(value) {
  return String(value).replace(/[&<>"']/gu, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

export function pageFileName(title) {
  const name = title.trim().replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/gu, "-").replace(/\s+/gu, " ").slice(0, 100);
  return `${name || "ProofOfWork page"}.html`;
}

export function pageTemplateHtml(title = "My ProofOfWork Page", app = false) {
  const escapedTitle = escapePageHtml(title);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapedTitle}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 48px 24px; background: #080807; color: #f7f0e2; font: 16px/1.6 system-ui, sans-serif; }
    main { max-width: 720px; margin: auto; }
    small { color: #d7a84f; letter-spacing: .14em; text-transform: uppercase; }
    h1 { font-size: clamp(32px, 7vw, 56px); line-height: 1.1; letter-spacing: -.04em; }
    p { color: #c3b59d; }
    section { margin-top: 32px; padding: 24px; border: 1px solid #332c22; border-radius: 12px; }
    button { background: #d7a84f; color: #15130f; border: 0; border-radius: 8px; padding: 12px 20px; font: inherit; cursor: pointer; }
    output { display: block; font: 48px/1.2 monospace; margin: 20px 0; }
    a { color: #d7a84f; }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main>
    <small>ProofOfWork Computer</small>
    <h1>${escapedTitle}</h1>
    <p>${app ? "A small app made with HTML, CSS, and inline JavaScript." : "A page carried by ProofOfWork. Create something worth keeping."}</p>
    <section>
      ${app ? `<h2>Counter</h2>
      <output id="count" aria-live="polite">0</output>
      <button id="increment" type="button">Add one</button>
      <button id="reset" type="button">Reset</button>` : `<h2>Start here</h2>
      <p>Edit this HTML, preview it, and publish through a locally signed ProofOfWork message or file.</p>`}
    </section>
  </main>${app ? `
  <script>
    let count = 0;
    const output = document.getElementById('count');
    document.getElementById('increment').addEventListener('click', () => { output.textContent = String(++count); });
    document.getElementById('reset').addEventListener('click', () => { count = 0; output.textContent = '0'; });
  </script>` : ""}
</body>
</html>
`;
}

export function identityCardHtml(identity) {
  if (!identity || !identity.id || !identity.ownerAddress || !identity.receiveAddress) {
    throw new Error("Confirmed identity evidence is incomplete.");
  }
  const id = escapePageHtml(identity.id);
  const owner = escapePageHtml(identity.ownerAddress);
  const receiver = escapePageHtml(identity.receiveAddress);
  return `\n  <section class="pow-identity" aria-label="ProofOfWork identity">
    <h2>${id}</h2>
    <p>Confirmed receiver at insertion: <code>${receiver}</code></p>
    <p>Owner: <code>${owner}</code></p>
    <a href="https://computer.proofofwork.me/" rel="noreferrer">Open Computer</a>
  </section>\n`;
}

export function insertPageMarkup(html, markup, selection) {
  if (selection && Number.isInteger(selection.start) && Number.isInteger(selection.end)
      && selection.start >= 0 && selection.end >= selection.start && selection.end <= html.length) {
    return html.slice(0, selection.start) + markup + html.slice(selection.end);
  }
  const bodyEnd = html.search(/<\/body\s*>/iu);
  return bodyEnd < 0 ? html + markup : html.slice(0, bodyEnd) + markup + html.slice(bodyEnd);
}

export function validatePagesDrafts(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.drafts)
      || !value.drafts.length || value.drafts.length > MAX_PAGE_DRAFTS || typeof value.activeId !== "string") {
    throw new Error("Saved Pages drafts have an unsupported format.");
  }
  const ids = new Set();
  const drafts = value.drafts.map((draft) => {
    if (!draft || typeof draft.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/u.test(draft.id)
        || ids.has(draft.id) || typeof draft.title !== "string" || draft.title.length > 160
        || !Number.isSafeInteger(draft.updatedAt) || draft.updatedAt < 0) {
      throw new Error("Saved Pages draft data is invalid.");
    }
    ids.add(draft.id);
    if (typeof draft.html !== "string" || pageByteLength(draft.html) > MAX_PAGE_BYTES) {
      throw new Error("A saved Pages draft exceeds the HTML size limit.");
    }
    const clean = { id: draft.id, title: draft.title, html: draft.html, updatedAt: draft.updatedAt };
    if (draft.origin !== undefined) {
      const origin = draft.origin;
      if (!origin || !/^[a-f0-9]{64}$/u.test(origin.txid) || !/^[a-f0-9]{64}$/u.test(origin.sha256)
          || typeof origin.confirmed !== "boolean" || typeof origin.modified !== "boolean"
          || typeof origin.sender !== "string" || origin.sender.length > 200) {
        throw new Error("Saved Pages source evidence is invalid.");
      }
      clean.origin = { txid: origin.txid, sha256: origin.sha256, confirmed: origin.confirmed, sender: origin.sender, modified: origin.modified };
    }
    return clean;
  });
  if (!ids.has(value.activeId)) throw new Error("The saved active Pages draft is missing.");
  return { version: 1, activeId: value.activeId, drafts };
}

export const PAGES_APP_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

// Template contents are inert: parsing does not insert source nodes into a live
// document. The result is only used in an opaque sandbox="allow-scripts" frame.
// Inline scripts can still navigate their own frame. There is no parent bridge.
export function pagesAppPreviewHtml(html, document) {
  validatePageHtml(html);
  const template = document.createElement("template");
  template.innerHTML = html;
  const clean = (fragment) => {
    for (const node of fragment.querySelectorAll("meta, base, iframe, frame, frameset, object, embed, link, script[src]")) node.remove();
    for (const node of fragment.querySelectorAll("*")) {
      for (const attribute of Array.from(node.attributes)) {
        if (/^(?:href|xlink:href|src|srcset|action|formaction|target|formtarget|ping|poster|background|data|manifest|codebase|cite|profile)$/iu.test(attribute.name)) {
          node.removeAttribute(attribute.name);
        }
      }
      if (node.tagName === "TEMPLATE") clean(node.content);
    }
  };
  clean(template.content);
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${escapePageHtml(PAGES_APP_CSP)}"><meta name="referrer" content="no-referrer"><meta charset="utf-8"></head><body>${template.innerHTML}</body></html>`;
}
