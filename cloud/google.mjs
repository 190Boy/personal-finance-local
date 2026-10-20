import {HEADERS,IMPORT_HEADERS,BANK_TABS,bankSummary} from './records.mjs';
export const SCOPE='https://www.googleapis.com/auth/drive.file';
const APP='personal-finance-local-v1',DRIVE='https://www.googleapis.com/drive/v3',SHEETS='https://sheets.googleapis.com/v4/spreadsheets';
const literal=value=>typeof value==='number'?{numberValue:value}:{stringValue:String(value??'')};
const cells=rows=>rows.map(row=>({values:row.map(value=>({userEnteredValue:literal(value)}))}));
export class GoogleStore{
 constructor({fetcher=(...args)=>globalThis.fetch(...args)}={}){this.fetcher=fetcher;this.token='';this.expires=0;this.file=null;this.sheets=[];this.user=null;this.saving=false;this.epoch=0;}
 authorize(token,expires){this.disconnect();this.token=token;this.expires=Date.now()+Math.max(0,Number(expires)-30)*1000;}
 disconnect(){this.epoch++;this.token='';this.expires=0;this.file=null;this.sheets=[];this.user=null;}
 get connected(){return !!this.token&&Date.now()<this.expires;}
 async api(url,{method='GET',body}={}){
  if(!this.connected)throw Error('GOOGLE_LOGIN_REQUIRED');const epoch=this.epoch;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  let response;try{response=await this.fetcher(url,{method,headers:{Authorization:'Bearer '+this.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});}catch{throw Error('GOOGLE_NETWORK');}finally{clearTimeout(timer);}
  if(epoch!==this.epoch)throw Error('GOOGLE_LOGIN_REQUIRED');
  if(response.status===401){this.disconnect();throw Error('GOOGLE_LOGIN_REQUIRED');}
  if(!response.ok)throw Error(response.status===403?'GOOGLE_PERMISSION':'GOOGLE_API');
  return response.status===204?{}:response.json();
 }
 async profile(){const data=await this.api(DRIVE+'/about?fields=user(displayName,emailAddress,photoLink)');this.user=data.user||{};return this.user;}
 async open(){
  const query="trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet' and appProperties has { key='financeApp' and value='"+APP+"' }";
  const found=await this.api(DRIVE+'/files?'+new URLSearchParams({q:query,fields:'files(id,name,webViewLink),nextPageToken',pageSize:'100'}));
  const files=found.files||[];if(found.nextPageToken||files.length>1)throw Error('MULTIPLE_SPREADSHEETS');
  this.file=files[0]||await this.api(DRIVE+'/files?fields=id,name,webViewLink',{method:'POST',body:{name:'我的理財紀錄',mimeType:'application/vnd.google-apps.spreadsheet',appProperties:{financeApp:APP}}});
  await this.metadata();return this.file;
 }
 async metadata(){if(!this.file)throw Error('GOOGLE_LOGIN_REQUIRED');const data=await this.api(SHEETS+'/'+encodeURIComponent(this.file.id)+'?fields=sheets.properties');this.sheets=(data.sheets||[]).map(s=>s.properties);}
 async ensure(tab,headers){
  let sheet=this.sheets.find(s=>s.title===tab);
  if(!sheet){let failure=null;try{await this.api(SHEETS+'/'+this.file.id+':batchUpdate',{method:'POST',body:{requests:[{addSheet:{properties:{title:tab,gridProperties:{frozenRowCount:1}}}}]}});}catch(e){failure=e;}await this.metadata();sheet=this.sheets.find(s=>s.title===tab);if(!sheet)throw failure||Error('GOOGLE_API');}
  const rows=await this.read(tab);
  if(!rows.length){await this.api(SHEETS+'/'+this.file.id+'/values/'+encodeURIComponent("'"+tab+"'!A1")+'?valueInputOption=RAW',{method:'PUT',body:{values:[headers]}});}
  else if(JSON.stringify(rows[0])!==JSON.stringify(headers))throw Error('SHEET_SCHEMA');
  return sheet;
 }
 async read(tab){
  if(!this.sheets.some(s=>s.title===tab))return [];
  const data=await this.api(SHEETS+'/'+this.file.id+'/values/'+encodeURIComponent("'"+tab+"'!A:S")+'?valueRenderOption=UNFORMATTED_VALUE');
  const rows=data.values||[];if(rows.length>100001)throw Error('CLOUD_ROW_LIMIT');return rows;
 }
 async summary(){let rows=[];for(const tab of BANK_TABS){const values=await this.read(tab);if(values.length&&JSON.stringify(values[0])!==JSON.stringify(HEADERS))throw Error('SHEET_SCHEMA');rows.push(...values.slice(1));}return bankSummary(rows);}
 async save(batch){
  if(this.saving)throw Error('SYNC_BUSY');this.saving=true;const epoch=this.epoch,fileId=this.file?.id;
  try{
   const sheet=await this.ensure(batch.tab,HEADERS),logSheet=await this.ensure('匯入紀錄',IMPORT_HEADERS);
   let logs=(await this.read('匯入紀錄')).slice(1);if(logs.some(row=>row[0]===batch.id))return {added:0,repeated:true};
   const all=[];for(const tab of BANK_TABS)all.push(...(await this.read(tab)).slice(1));
   const existing=new Set(all.map(row=>row[0])),fresh=batch.rows.filter(row=>!existing.has(row[0]));
   const log=[...batch.log];log[6]=fresh.length;
   // One atomic batch: rows and import ledger succeed or fail together.
   // A deterministic metadata ID rejects concurrent writes of the same import.
   const metadataId=parseInt(batch.id.slice(0,7),16)+1;
   const requests=[{createDeveloperMetadata:{developerMetadata:{metadataId,metadataKey:'financeImport',metadataValue:batch.id,visibility:'DOCUMENT',location:{spreadsheet:true}}}},
    ...(fresh.length?[{appendCells:{sheetId:sheet.sheetId,rows:cells(fresh),fields:'userEnteredValue'}}]:[]),
    {appendCells:{sheetId:logSheet.sheetId,rows:cells([log]),fields:'userEnteredValue'}}];
   if(epoch!==this.epoch||fileId!==this.file?.id)throw Error('GOOGLE_LOGIN_REQUIRED');
   try{await this.api(SHEETS+'/'+fileId+':batchUpdate',{method:'POST',body:{requests}});}
   catch(error){logs=(await this.read('匯入紀錄')).slice(1);if(logs.some(row=>row[0]===batch.id))return {added:0,repeated:true};throw error;}
   return {added:fresh.length,repeated:false};
  }finally{this.saving=false;}
 }
}
