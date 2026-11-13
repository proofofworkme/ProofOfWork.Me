export const EDITOR_PAGE_UNITS: number;
export const ARTICLE_MAX_BYTES: number;
export type EditorPage = {start:number;end:number;raw:string;text:string;offsets:number[];total:number};
export function safeBoundary(body:string,offset:number):number;
export function editorPage(body:string,start?:number):EditorPage;
export function replacePageSelection(body:string,page:EditorPage,from:number,to:number,insertion:string):{body:string;caret:number};
export function applyPageInput(body:string,page:EditorPage,nextText:string):{body:string;caret:number};

export function pageStartForCaret(body:string,page:EditorPage,caret:number):number;
