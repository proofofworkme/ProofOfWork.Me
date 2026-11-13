export const EDITOR_PAGE_UNITS = 16384;
export const ARTICLE_MAX_BYTES = 4000000;
const high = n => n >= 0xd800 && n <= 0xdbff;
const low = n => n >= 0xdc00 && n <= 0xdfff;
export function safeBoundary(body, offset) {
  let n = Math.max(0, Math.min(body.length, Math.trunc(offset)));
  if (n > 0 && n < body.length && ((high(body.charCodeAt(n-1)) && low(body.charCodeAt(n))) || (body[n-1] === "\r" && body[n] === "\n"))) n--;
  return n;
}
export function editorPage(body, requested = 0) {
  const start = safeBoundary(body, requested), end = safeBoundary(body, Math.min(body.length, start + EDITOR_PAGE_UNITS));
  const raw = body.slice(start,end), offsets=[start]; let text="";
  for(let i=0;i<raw.length;i++) {
    if(raw[i]==="\r") { if(raw[i+1]==="\n")i++;text+="\n"; }
    else text+=raw[i];
    offsets.push(start+i+1);
  }
  return {start,end,raw,text,offsets,total:body.length};
}
function assertPage(body,page) {
  if(body.slice(page.start,page.end)!==page.raw)throw new Error("The article page changed. Reopen it before editing.");
}
export function replacePageSelection(body,page,from,to,insertion) {
  assertPage(body,page);
  let a=Math.max(0,Math.min(page.text.length,from)),b=Math.max(a,Math.min(page.text.length,to));
  const start=safeBoundary(body,page.offsets[a]),originalEnd=page.offsets[b];
  let end=safeBoundary(body,originalEnd);
  if(end<originalEnd)end=originalEnd+1;
  const next=body.slice(0,start)+insertion+body.slice(end);
  if(new TextEncoder().encode(next).length>ARTICLE_MAX_BYTES)throw new Error("Article text exceeds 4,000,000 UTF-8 bytes. Your existing draft is unchanged.");
  return {body:next,caret:start+insertion.length};
}
export function applyPageInput(body,page,nextText) {
  assertPage(body,page);
  let from=0,oldEnd=page.text.length,newEnd=nextText.length;
  while(from<oldEnd && from<newEnd && page.text[from]===nextText[from])from++;
  while(oldEnd>from && newEnd>from && page.text[oldEnd-1]===nextText[newEnd-1]){oldEnd--;newEnd--;}
  from=Math.min(safeBoundary(page.text,from),safeBoundary(nextText,from));
  if(safeBoundary(page.text,oldEnd)<oldEnd || safeBoundary(nextText,newEnd)<newEnd){oldEnd++;newEnd++;}
  return replacePageSelection(body,page,from,oldEnd,nextText.slice(from,newEnd));
}


// Move the left edge forward, not backward, if the final-page window would
// divide a surrogate pair or CRLF. Otherwise its end can fall before the caret.
export function pageStartForCaret(body,page,caret) {
  if(caret>=page.start && caret<=page.end)return page.start;
  let start=Math.max(0,caret-EDITOR_PAGE_UNITS);
  if(safeBoundary(body,start)<start)start++;
  return start;
}
