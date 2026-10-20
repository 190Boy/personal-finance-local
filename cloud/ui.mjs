import {GoogleStore,SCOPE} from './google.mjs';
import {makeImport} from './records.mjs';
const $=id=>document.getElementById(id),store=new GoogleStore();
const messages={ACCOUNT_REQUIRED:'請先填寫帳戶代稱，例如「玉山主要帳戶」；同一帳戶每次使用相同名稱。',NO_RECORDS:'尚無本次交易可儲存。',GOOGLE_LOGIN_REQUIRED:'請到設定重新連接 Google；授權可能已過期。',GOOGLE_NETWORK:'連線中斷，請重試；重試前會檢查匯入紀錄，避免同檔重複寫入。',GOOGLE_PERMISSION:'Google 權限不足，請確認已啟用 Drive API、Sheets API，並同意檔案權限。',GOOGLE_API:'Google 未完成操作。請確認 API 設定，稍後重試。',SHEET_SCHEMA:'試算表欄位與目前版本不同，請保留系統欄名及順序。',MULTIPLE_SPREADSHEETS:'找到多份「我的理財紀錄」，請在 Drive 整理重複的應用程式試算表後重連。',CLOUD_ROW_LIMIT:'雲端資料超過目前 100,000 列讀取上限。',SYNC_BUSY:'正在儲存，請稍候。'};
let gisPromise=null,working=false;
function notice(text){$('cloudStatus').textContent=text;$('syncNotice').textContent=text;}
function gis(){
 if(globalThis.google?.accounts?.oauth2)return Promise.resolve();
 if(!gisPromise)gisPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.onload=resolve;script.onerror=()=>{gisPromise=null;script.remove();reject(Error('GOOGLE_NETWORK'));};document.head.append(script);});
 return gisPromise;
}
function controls(){for(const id of ['connectGoogle','disconnectGoogle','refreshCloud','syncCloud','googleClientId'])$(id).disabled=working;}
function clearSummary(){
 $('bankDeposit').textContent='尚未同步';$('bankDepositDetail').textContent='連接 Google 後載入各帳戶最後餘額。';$('cloudSheetLink').hidden=true;
}
async function summary(){
 const result=await store.summary();
 $('bankDeposit').textContent=result.balances.length?(result.pending.length?'部分合計 NT$ ':'NT$ ')+(result.totalCents/100).toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2}):'尚無可核對餘額';
 $('bankDepositDetail').textContent=(result.balances.length?result.balances.map(b=>b.bank+'／'+b.account+'：'+(b.cents/100).toLocaleString('zh-TW')+'（'+b.date+'）').join('；'):'尚無已儲存的銀行明細。')+(result.pending.length?'；'+result.pending.length+' 個帳戶餘額或交易先後待確認，未列入合計。':'')+' 此為匯入明細最後餘額，非銀行即時餘額。';
 $('cloudSheetLink').href=store.file.webViewLink||'https://docs.google.com/spreadsheets/d/'+encodeURIComponent(store.file.id)+'/edit';$('cloudSheetLink').hidden=false;
}
export function initCloud({getPayload}){
 try{$('googleClientId').value=localStorage.getItem('finance-google-client-id')||'';}catch{}
 clearSummary();
 async function save(){
  if(working)return;const payload=getPayload();if(!payload){notice(messages.NO_RECORDS);return;}
  working=true;controls();notice('正在儲存交易並更新雲端餘額…');
  try{
   if(!store.connected)throw Error('GOOGLE_LOGIN_REQUIRED');
   const tab='銀行存款';
   const batch=await makeImport(payload.result,{...payload.context,account:payload.account,tab});
   const saved=await store.save(batch);await summary();
   notice(saved.repeated?'這份檔案已記錄，沒有重複寫入。':'已儲存至你的試算表：新增 '+saved.added+' 筆；首頁銀行存款已更新。');
  }catch(error){notice(messages[error.message]||'同步尚未完成，交易預覽仍保留，請稍後重試。');}
  finally{working=false;controls();}
 }
 $('syncCloud').addEventListener('click',save);
 $('googleClientId').addEventListener('change',()=>{store.disconnect();clearSummary();try{localStorage.setItem('finance-google-client-id',$('googleClientId').value.trim());}catch{}notice('用戶端 ID 已更新，請重新連接 Google。');});
 // Load GIS on settings entry so the subsequent Connect click can open its popup synchronously.
 const prepare=()=>{if(location.hash==='#settings'&&$('googleClientId').value.trim())void gis().catch(()=>notice(messages.GOOGLE_NETWORK));};
 window.addEventListener('hashchange',prepare);$('googleClientId').addEventListener('change',prepare);prepare();
 $('connectGoogle').addEventListener('click',()=>{
  const id=$('googleClientId').value.trim();if(!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)){notice('請先填入有效的 Google OAuth 網頁用戶端 ID；下方有設定說明。');return;}
  if(!globalThis.google?.accounts?.oauth2){void gis().then(()=>notice('Google 授權元件已就緒，請再點一次「連接 Google」。')).catch(()=>notice(messages.GOOGLE_NETWORK));return;}
  working=true;controls();
  const finish=()=>{working=false;controls();};
  const client=google.accounts.oauth2.initTokenClient({client_id:id,scope:SCOPE,include_granted_scopes:false,
   callback:async response=>{
    try{
     if(response.error||!response.access_token||!google.accounts.oauth2.hasGrantedAllScopes(response,SCOPE))throw Error('GOOGLE_PERMISSION');
     store.authorize(response.access_token,response.expires_in);clearSummary();await store.open();await summary();notice('Google 已連接。匯入後可自動寫入「我的理財紀錄」。');
    }catch(error){store.disconnect();clearSummary();notice(messages[error.message]||'Google 連接失敗。');}finally{finish();}
   },error_callback:()=>{finish();notice('Google 授權視窗未完成，請確認 Safari 允許彈出視窗後再連接。');}});
  try{client.requestAccessToken({prompt:'select_account'});}catch{finish();notice('無法開啟 Google 授權視窗，請在 Safari 開啟網站再試。');}
 });
 $('refreshCloud').addEventListener('click',async()=>{if(working)return;working=true;controls();try{await summary();notice('已重新載入雲端餘額。');}catch(e){notice(messages[e.message]||'載入失敗。');}finally{working=false;controls();}});
 $('disconnectGoogle').addEventListener('click',()=>{store.disconnect();clearSummary();notice('已清除本次 Google 授權與餘額顯示。雲端試算表保留。');});
 window.addEventListener('pagehide',()=>{store.disconnect();clearSummary();});
 return {savedImport:async()=>{if($('autoCloud').checked&&store.connected)await save();else notice('本次匯入尚未存到雲端；連接 Google 後可點「儲存本次匯入」。');}};
}
