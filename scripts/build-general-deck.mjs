import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const sourcePath = join(repoRoot, "PROOFOFWORK_GENERAL_DECK.md");
const publicPath = join(repoRoot, "public", "proofofwork-general-deck.pptx");
const outputPath = join(repoRoot, "output", "proofofwork-general-deck.pptx");

const deckMarkdown = readFileSync(sourcePath, "utf8");

function xml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripMarkdown(value) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function parseSlides(markdown) {
  const lines = markdown.split(/\r?\n/u);
  const slides = [];
  let current;
  let inCode = false;

  for (const line of lines) {
    const match = line.match(/^## Slide\s+\d+:\s+(.+)$/u);
    if (match) {
      if (current) slides.push(current);
      current = { title: match[1].trim(), lines: [] };
      inCode = false;
      continue;
    }

    if (!current) continue;
    if (line.trim().startsWith("```")) {
      inCode = !inCode;
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      if (current.lines[current.lines.length - 1] !== "") current.lines.push("");
      continue;
    }

    if (trimmed.startsWith("- ")) {
      current.lines.push(`• ${stripMarkdown(trimmed.slice(2))}`);
      continue;
    }

    current.lines.push(stripMarkdown(trimmed));
  }

  if (current) slides.push(current);
  return slides.map((slide) => ({
    ...slide,
    lines: slide.lines.filter((line, index, all) => line || (all[index - 1] && all[index + 1])),
  }));
}

const slides = parseSlides(deckMarkdown);
if (slides.length === 0) {
  throw new Error("No slides found in PROOFOFWORK_GENERAL_DECK.md");
}

const EMU = 914400;
const width = 13.333 * EMU;
const height = 7.5 * EMU;

function textRun(text, size, bold = false, color = "111827") {
  return `<a:r><a:rPr lang="en-US" sz="${size}"${bold ? ' b="1"' : ""}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${xml(text)}</a:t></a:r>`;
}

function paragraph(text, options = {}) {
  const { size = 2200, bold = false, color = "111827", bullet = false } = options;
  const marL = bullet ? ' marL="342900" indent="-171450"' : "";
  return `<a:p><a:pPr${marL}/>${textRun(text, size, bold, color)}</a:p>`;
}

function textShape(id, name, x, y, cx, cy, paragraphsXml) {
  return `
    <p:sp>
      <p:nvSpPr>
        <p:cNvPr id="${id}" name="${xml(name)}"/>
        <p:cNvSpPr txBox="1"/>
        <p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:noFill/>
        <a:ln><a:noFill/></a:ln>
      </p:spPr>
      <p:txBody>
        <a:bodyPr wrap="square" anchor="t"/>
        <a:lstStyle/>
        ${paragraphsXml}
      </p:txBody>
    </p:sp>`;
}

function slideXml(slide, index) {
  const isTitle = index === 0;
  const titleSize = isTitle ? 5000 : 3800;
  const bodyLines = slide.lines.filter(Boolean);
  const bodyXml = bodyLines
    .slice(0, 13)
    .map((line) =>
      paragraph(line.replace(/^• /u, ""), {
        bullet: line.startsWith("• "),
        size: line.length > 95 ? 1700 : line.length > 70 ? 1850 : 2050,
        bold: line === "Humans sign. Agents verify.",
        color: line.startsWith("• ") ? "374151" : "1f2937",
      }),
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        <a:solidFill><a:srgbClr val="f8fafc"/></a:solidFill>
        <a:effectLst/>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>
      </p:grpSpPr>
      ${textShape(2, "Kicker", 0.7 * EMU, 0.45 * EMU, 11.9 * EMU, 0.35 * EMU, paragraph("PROOFOFWORK.ME", { size: 1250, bold: true, color: "0a84ff" }))}
      ${textShape(3, "Title", 0.7 * EMU, isTitle ? 1.2 * EMU : 0.95 * EMU, 11.9 * EMU, isTitle ? 1.4 * EMU : 1.0 * EMU, paragraph(slide.title, { size: titleSize, bold: true, color: "111827" }))}
      ${textShape(4, "Body", 0.75 * EMU, isTitle ? 2.85 * EMU : 2.15 * EMU, 11.7 * EMU, isTitle ? 3.9 * EMU : 4.9 * EMU, bodyXml)}
      ${textShape(5, "Footer", 0.75 * EMU, 6.95 * EMU, 11.7 * EMU, 0.28 * EMU, paragraph("Bitcoin Computer · local-first · on-chain · agent-readable", { size: 1050, color: "64748b" }))}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const temp = mkdtempSync(join(tmpdir(), "pow-deck-"));
try {
  write(
    join(temp, "[Content_Types].xml"),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("\n  ")}
</Types>`,
  );

  write(
    join(temp, "_rels/.rels"),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
  );

  write(
    join(temp, "docProps/core.xml"),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>ProofOfWork.Me General Deck</dc:title>
  <dc:creator>ProofOfWork.Me</dc:creator>
  <cp:lastModifiedBy>ProofOfWork.Me</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-05-13T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-05-13T00:00:00Z</dcterms:modified>
</cp:coreProperties>`,
  );

  write(
    join(temp, "docProps/app.xml"),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>ProofOfWork.Me</Application>
  <PresentationFormat>Widescreen</PresentationFormat>
  <Slides>${slides.length}</Slides>
</Properties>`,
  );

  write(
    join(temp, "ppt/presentation.xml"),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>
    ${slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join("\n    ")}
  </p:sldIdLst>
  <p:sldSz cx="${Math.round(width)}" cy="${Math.round(height)}" type="wide"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`,
  );

  write(
    join(temp, "ppt/_rels/presentation.xml.rels"),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${slides.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join("\n  ")}
</Relationships>`,
  );

  slides.forEach((slide, index) => {
    write(join(temp, `ppt/slides/slide${index + 1}.xml`), slideXml(slide, index));
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  execFileSync("zip", ["-qr", outputPath, "."], { cwd: temp });
  mkdirSync(dirname(publicPath), { recursive: true });
  copyFileSync(outputPath, publicPath);
  console.log(`Wrote ${outputPath}`);
  console.log(`Wrote ${publicPath}`);
} finally {
  rmSync(temp, { force: true, recursive: true });
}
