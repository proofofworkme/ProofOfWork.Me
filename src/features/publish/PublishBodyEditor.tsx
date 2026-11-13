import {useEffect,useLayoutEffect,useMemo,useRef,useState} from "react";
import {YouTubeLinkCards} from "../../shared/media/YouTubeLinkCards";
import {applyPageInput,editorPage,EDITOR_PAGE_UNITS,replacePageSelection,safeBoundary,pageStartForCaret,type EditorPage} from "./publishEditorPages.mjs";

export function PublishBodyEditor({body,preview,disabled,onChange,onError,onComposingChange}:{
 body:string;preview:boolean;disabled:boolean;onChange:(body:string)=>void;onError:(message:string)=>void;onComposingChange:(active:boolean)=>void;
}) {
 const [start,setStart]=useState(0),[compositionValue,setCompositionValue]=useState<string>();
 const input=useRef<HTMLTextAreaElement>(null),caret=useRef<number>();
 const composition=useRef<{body:string;page:EditorPage}>();
 const page=useMemo(()=>editorPage(body,Math.min(start,Math.max(0,body.length-1))),[body,start]);
 const paged=body.length>EDITOR_PAGE_UNITS;
 const composing=compositionValue!==undefined;
 useEffect(()=>()=>onComposingChange(false),[onComposingChange]);
 useLayoutEffect(()=>{
  if(caret.current===undefined || !input.current)return;
  const offset=page.offsets.findIndex(value=>value>=caret.current!);
  input.current.setSelectionRange(offset<0?page.text.length:offset,offset<0?page.text.length:offset);
  caret.current=undefined;
 },[page]);
 function commit(result:{body:string;caret:number}) {
  caret.current=result.caret;
  setStart(pageStartForCaret(result.body,page,result.caret));
  onChange(result.body);
 }
 function edit(value:string) {
  try {commit(applyPageInput(body,page,value));}catch(error){onError(error instanceof Error?error.message:"Article edit failed; your draft is unchanged.");}
 }
 return <>
  {paged && <div className="publish-page-controls" aria-label={preview?"Article preview pages":"Article editing pages"}>
   <p role="status">{preview?"Partial preview":"Editing one page"}: text positions {(page.start+1).toLocaleString()}–{page.end.toLocaleString()} of {body.length.toLocaleString()} (UTF-16 units). The full article is retained and will be published, not just this page.</p>
   <button type="button" className="secondary small" disabled={disabled||composing||page.start===0} onClick={()=>setStart(safeBoundary(body,Math.max(0,page.start-EDITOR_PAGE_UNITS)))}>Previous text page</button>
   <button type="button" className="secondary small" disabled={disabled||composing||page.end>=body.length} onClick={()=>setStart(page.end)}>Next text page</button>
  </div>}
  {preview ? <><div className="publish-article-body">{page.raw||"Your article text will appear here."}</div><YouTubeLinkCards text={page.raw}/></> :
   <label className="publish-body-label"><span>Article{paged?" · current page":""}</span>
    <textarea ref={input} aria-label="Article text" className="publish-body-input" placeholder="Start writing…" value={compositionValue??page.text} disabled={disabled}
     spellCheck={false}
     onCompositionStart={()=>{composition.current={body,page};setCompositionValue(page.text);onComposingChange(true);}}
     onCompositionEnd={event=>{
      const original=composition.current;composition.current=undefined;setCompositionValue(undefined);onComposingChange(false);
      if(!original)return;
      if(original.body!==body){onError("The draft changed during composition. Your current draft is retained.");return;}
      try {commit(applyPageInput(body,original.page,event.currentTarget.value));}catch(error){onError(error instanceof Error?error.message:"Article edit failed.");}
     }}
     onChange={event=>{if(composition.current)setCompositionValue(event.target.value);else edit(event.target.value);}}
     onPaste={event=>{
      event.preventDefault();
      if(composition.current){onError("Finish the current text composition before pasting.");return;}
      if(!event.clipboardData.types.includes("text/plain")){onError("Paste plain text into the article. Your draft is unchanged.");return;}
      const text=event.clipboardData.getData("text/plain"),target=event.currentTarget;
      if(!text)return;
      try {commit(replacePageSelection(body,page,target.selectionStart,target.selectionEnd,text));}catch(error){onError(error instanceof Error?error.message:"Paste failed; your draft is unchanged.");}
     }}/>
   </label>}
 </>;
}
