const APP_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data: blob:; media-src data: blob:; font-src data: blob:; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const URL_ATTRIBUTES = new Set(["action", "archive", "background", "cite", "classid", "codebase", "data", "formaction", "href", "imagesrcset", "longdesc", "manifest", "ping", "poster", "profile", "src", "srcdoc", "srcset", "xlink:href"]);

function embeddedUrl(element: Element, attribute: Attr) {
  const tag = element.localName.toLowerCase();
  const name = attribute.name.toLowerCase();
  const value = attribute.value.trim();
  if ((name === "href" || name === "xlink:href") && value.startsWith("#") && ["a", "use"].includes(tag)) return true;
  if (!/^(?:data|blob):/iu.test(value)) return false;
  return (name === "src" && ["audio", "img", "source", "track", "video"].includes(tag)) ||
    (name === "poster" && tag === "video") ||
    (["href", "xlink:href"].includes(name) && tag === "image");
}

// Source is parsed inertly, then executed only after Run app in the existing
// opaque runner. Its HTTP sandbox and the parent's frame policy remain the
// independent boundaries; this document grants no parent or wallet bridge.
export function browserAppDocument(html: string, document: Document) {
  const bytes = new TextEncoder().encode(html).byteLength;
  if (!html.trim() || bytes > 100_000) throw new Error("Run an HTML app of at most 100,000 UTF-8 bytes.");
  const template = document.createElement("template");
  template.innerHTML = html;
  function clean(fragment: DocumentFragment) {
    for (const element of fragment.querySelectorAll("applet, base, embed, fencedframe, frame, frameset, iframe, link, meta, object, portal, script[src]")) element.remove();
    for (const element of fragment.querySelectorAll("*")) {
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        if ((URL_ATTRIBUTES.has(name) && !embeddedUrl(element, attribute)) ||
            ["target", "formtarget", "download", "autofocus", "shadowrootmode"].includes(name)) element.removeAttribute(attribute.name);
      }
    }
    for (const nested of fragment.querySelectorAll("template")) clean(nested.content);
  }
  clean(template.content);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${APP_CSP}"></head><body>${template.innerHTML}</body></html>`;
}

// Titles are presentation only; template parsing never executes source code.
export function browserDocumentTitle(html: string, document: Document) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return (template.content.querySelector("title")?.textContent ?? "").trim().slice(0, 160);
}
