import {projectTextItem} from './geometry.mjs';
import * as pdfjs from '../web/vendor/pdfjs/pdf.mjs';
export const PDFJS_VERSION=pdfjs.version;
export const LIMITS={bytes:25*1024*1024,pages:200,items:200000,characters:2000000,milliseconds:90000};
const workerUrl=new URL('../web/vendor/pdfjs/pdf.worker.mjs',import.meta.url);
export async function extractLocalPdf(file,password,{signal,onProgress=()=>{}}={}){
 let task=null,worker=null,port=null,bytes=null,timer=null,abortReason=null;
 let pages=[];
  let cancelReject;
  const cancelled=new Promise((_,reject)=>{cancelReject=reject;});
  cancelled.catch(()=>{});
  const guard=promise=>Promise.race([promise,cancelled]);
 const abort=reason=>{
  abortReason=reason;
  // Terminating the dedicated Worker also releases PDF.js-held password/data references.
  cancelReject(new Error(reason));
 };
 const onAbort=()=>abort('CANCELLED');
 try{
  if(!file||file.size===0)throw new Error('EMPTY_FILE');
  if(file.size>LIMITS.bytes)throw new Error('FILE_TOO_LARGE');
  if(signal?.aborted)throw new Error('CANCELLED');
  signal?.addEventListener('abort',onAbort,{once:true});
  timer=setTimeout(()=>abort('TIME_LIMIT'),LIMITS.milliseconds);
  bytes=new Uint8Array(await guard(file.arrayBuffer()));
  if(signal?.aborted||abortReason)throw new Error(abortReason||'CANCELLED');
  if(bytes.length<5||[37,80,68,70,45].some((v,i)=>v!==bytes[i]))throw new Error('INVALID_PDF_HEADER');
  // Real same-origin module Worker: no Blob worker, no external CDN or shared global Worker.
  port=new Worker(workerUrl,{type:'module',name:'local-pdf-text'});
  port.addEventListener('error',()=>abort('WORKER_FAILED'),{once:true});
  worker=new pdfjs.PDFWorker({port});
  task=pdfjs.getDocument({
   data:bytes,password:password||undefined,worker,
   cMapUrl:new URL('../web/vendor/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,
   standardFontDataUrl:new URL('../web/vendor/pdfjs/standard_fonts/',import.meta.url).href,
   useWorkerFetch:true,disableFontFace:true,useSystemFonts:false,
   useWasm:false,isEvalSupported:false,enableXfa:false,
   disableAutoFetch:true,disableStream:true,stopAtErrors:true,verbosity:0
  });
  password='';bytes=null;
  const pdf=await guard(task.promise);
  if(pdf.numPages>LIMITS.pages)throw new Error('PAGE_LIMIT');
  let totalItems=0,totalChars=0;
  for(let number=1;number<=pdf.numPages;number++){
   if(signal?.aborted||abortReason)throw new Error(abortReason||'CANCELLED');
   onProgress(number,pdf.numPages);
   const page=await guard(pdf.getPage(number));
   const viewport=page.getViewport({scale:1});
   const text=await guard(page.getTextContent({includeMarkedContent:false,disableNormalization:false}));
   const items=[],excludedItems=[];
   for(const it of text.items){
    if(!('str' in it)||!it.str.trim())continue;
    const projected=projectTextItem(it,viewport);
    if(projected.supported)items.push(projected.item);
    else excludedItems.push({str:it.str,reason:projected.reason});
    totalChars+=it.str.length;totalItems++;
    if(totalChars>LIMITS.characters||totalItems>LIMITS.items)throw new Error('TEXT_LIMIT');
   }
   pages.push({number,width:viewport.width,height:viewport.height,items,excludedItems});
   page.cleanup();
  }
  return {pages,info:{pages:pdf.numPages,pdfjsVersion:pdfjs.version,characters:totalChars,items:totalItems,excludedItems:pages.reduce((n,p)=>n+p.excludedItems.length,0)}};
 }catch(error){
  pages.length=0;
  if(abortReason)throw new Error(abortReason);
  if(error?.name==='PasswordException'){
   throw new Error(error.code===2?'WRONG_PASSWORD':'PASSWORD_REQUIRED');
  }
  // Never echo PDF.js messages or sensitive document strings into the UI/logs.
  const allowed=['EMPTY_FILE','FILE_TOO_LARGE','CANCELLED','INVALID_PDF_HEADER','PAGE_LIMIT','ROTATED_PAGE','ROTATED_TEXT','TEXT_LIMIT','TIME_LIMIT'];
  throw new Error(allowed.includes(error?.message)?error.message:'PDF_READ_FAILED');
 }finally{
  clearTimeout(timer);signal?.removeEventListener('abort',onAbort);
  password='';bytes=null;
  if(task){try{await Promise.race([task.destroy(),new Promise(resolve=>setTimeout(resolve,300))]);}catch{}task=null;}
  if(worker){try{worker.destroy();}catch{}worker=null;}
  port?.terminate();port=null;
 }
}
