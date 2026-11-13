import {POWCAT_MAX_FILE_BYTES} from "./powcatLimits.mjs";
import {parsePowDnsText} from "./boostText.mjs";
export const READER_PAGE_UNITS=16384;
function boundary(body,offset) {
 let n=Math.max(0,Math.min(body.length,Math.trunc(offset)));
 if(n>0&&n<body.length&&((/[\uD800-\uDBFF]/u.test(body[n-1])&&/[\uDC00-\uDFFF]/u.test(body[n]))||(body[n-1]==="\r"&&body[n]==="\n")))n--;
 return n;
}
export function buildReaderModel(body) {
 if(typeof body!=="string"||new TextEncoder().encode(body).length>POWCAT_MAX_FILE_BYTES)throw new Error("Reader body exceeds the verified article bound.");
 let position=0;
 const segments=parsePowDnsText(body).map(segment=>{const start=position;position+=segment.text.length;return {...segment,start,end:position};});
 if(position!==body.length)throw new Error("Reader projection does not preserve the full source.");
 return {body,segments};
}
function at(model,position) {
 let low=0,high=model.segments.length;
 while(low<high){const middle=(low+high)>>>1;if(model.segments[middle].end<=position)low=middle+1;else high=middle;}
 return low;
}
export function verifiedReaderPage(model,requested=0) {
 const body=model.body;
 let start=boundary(body,requested);
 const first=model.segments[at(model,start)];
 if(first?.kind==="dns"&&first.start<start)start=first.start;
 let end=boundary(body,Math.min(body.length,start+READER_PAGE_UNITS));
 const last=model.segments[at(model,end)];
 if(last?.kind==="dns"&&last.start<end)end=last.start;
 if(start<body.length&&end<=start)throw new Error("Reader page did not advance.");
 const segments=[];
 for(let index=at(model,start);index<model.segments.length;index++){
  const segment=model.segments[index];if(segment.start>=end)break;
  const a=Math.max(start,segment.start),b=Math.min(end,segment.end),text=body.slice(a,b);
  const whole=segment.start>=start&&segment.end<=end;
  segments.push(whole?{...segment,text}:{kind:"text",text,value:text,start:a,end:b});
 }
 return {start,end,total:body.length,raw:body.slice(start,end),segments};
}
