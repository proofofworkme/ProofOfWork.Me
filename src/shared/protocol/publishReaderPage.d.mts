import type {BoostTextSegment} from "./boostText.mjs";
export const READER_PAGE_UNITS:number;
export type ReaderSegment=BoostTextSegment&{start:number;end:number};
export type ReaderModel={body:string;segments:ReaderSegment[]};
export function buildReaderModel(body:string):ReaderModel;
export function verifiedReaderPage(model:ReaderModel,start?:number):{start:number;end:number;total:number;raw:string;segments:ReaderSegment[]};
