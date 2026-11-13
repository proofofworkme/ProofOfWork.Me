import {Fragment,useEffect,useMemo,useState} from "react";
import {buildReaderModel,verifiedReaderPage,READER_PAGE_UNITS} from "../../shared/protocol/publishReaderPage.mjs";
import {BROWSER_APP_URL,LOCAL_BROWSER_APP_URL} from "../../app/appLinks";
import {appHref} from "../../app/routeRegistry";
import {boostRouteHref} from "../boost/boostProtocol";
import {BoostText} from "../boost/BoostText";
import type {BitcoinNetwork} from "../../shared/bitcoin/networks";

export function VerifiedArticleBody({body,bytes,txid,network}:{body:string;bytes:Uint8Array;txid:string;network:BitcoinNetwork}) {
 const model=useMemo(()=>body.length>READER_PAGE_UNITS?buildReaderModel(body):undefined,[body]);
 const [history,setHistory]=useState([0]),[download,setDownload]=useState(""),[notice,setNotice]=useState("");
 const page=useMemo(()=>model?verifiedReaderPage(model,history[history.length-1]):undefined,[model,history]);
 useEffect(()=>{
  if(!model)return;
  const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:"text/plain;charset=utf-8"}));setDownload(url);
  return ()=>URL.revokeObjectURL(url);
 },[model,bytes]);
 if(!model||!page)return <div className="publish-article-body"><BoostText text={body} dnsOnly network={network}/></div>;
 return <>
  <nav className="publish-page-controls" aria-label="Verified article reading pages">
   <p role="status">Partial reading view: text positions {(page.start+1).toLocaleString()}–{page.end.toLocaleString()} of {page.total.toLocaleString()} (UTF-16 units). The complete verified article is {bytes.length.toLocaleString()} UTF-8 bytes. Download or copy includes every page.</p>
   <button type="button" className="secondary small" disabled={page.start===0} onClick={()=>setHistory(previous=>previous.slice(0,-1))}>Previous reading page</button>
   <button type="button" className="secondary small" disabled={page.end>=page.total} onClick={()=>setHistory(previous=>[...previous,page.end])}>Next reading page</button>
   {download&&<a className="secondary small" href={download} download={`proofofwork-article-${txid}.txt`}>Download full verified text</a>}
   <button type="button" className="secondary small" onClick={()=>void (async()=>{try{await navigator.clipboard.writeText(body);setNotice("Full verified text copied.");}catch{setNotice("Copy is unavailable. Download the full verified text instead.");}})()}>Copy full verified text</button>
   {notice&&<p role="status">{notice}</p>}
  </nav>
  <div className="publish-article-body" data-source-start={page.start} data-source-end={page.end}>
   {page.segments.map((segment,index)=>segment.kind==="dns"
    ? <a key={index} className="boost-text-link boost-dns-link" href={boostRouteHref(appHref(BROWSER_APP_URL,LOCAL_BROWSER_APP_URL),{name:segment.value,network})} target="_blank" rel="noopener noreferrer" aria-label={`${segment.text} (open in Browser, new tab)`} onClick={event=>event.stopPropagation()}>{segment.text}</a>
    : <Fragment key={index}>{segment.text}</Fragment>)}
  </div>
 </>;
}
