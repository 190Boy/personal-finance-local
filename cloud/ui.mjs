import {initHistory,renderHistory,clearHistory} from '../web/history.mjs';
import {renderAssets} from '../web/assets.mjs';
import {makeStockImport} from './stocks.mjs';
import {rememberedAccount,rememberAccount} from './login-preferences.mjs';
import {initAccounts} from './accounts.mjs';
import {GOOGLE_CLIENT_ID} from './config.mjs';
import {GoogleStore,SCOPE} from './google.mjs';
import {makeImport} from './records.mjs';
const $=id=>document.getElementById(id),store=new GoogleStore();
const messages={ACCOUNT_REQUIRED:'請先填寫帳戶代稱，例如「玉山主要帳戶」；同一帳戶每次使用相同名稱。',NO_RECORDS:'尚無本次交易可儲存。',GOOGLE_LOGIN_REQUIRED:'請到設定重新連接 Google；授權可能已過期。',GOOGLE_NETWORK:'連線中斷，請重試；重試前會檢查匯入紀錄，避免同檔重複寫入。',GOOGLE_PERMISSION:'Google 權限不足，請確認已啟用 Drive API、Sheets API，並同意檔案權限。',GOOGLE_API:'Google 未完成操作。請確認 API 設定，稍後重試。',SHEET_SCHEMA:'試算表欄位與目前版本不同，請保留系統欄名及順序。',MULTIPLE_SPREADSHEETS:'找到多份「我的理財紀錄」，請在 Drive 整理重複的應用程式試算表後重連。',CLOUD_ROW_LIMIT:'雲端資料超過目前 100,000 列讀取上限。',SYNC_BUSY:'正在儲存，請稍候。'};
let gisPromise=null,working=false,preparing=false,expiryTimer=null,accountChoices=null,remembered='',rememberChoice=false,authAttempt=0;
const browserStorage=()=>{try{return globalThis.localStorage;}catch{return null;}};
function drawRemembered(){
 $('rememberAccount').checked=rememberChoice;
 $('lastAccountHint').textContent=remembered?'上次使用：'+remembered:'可選擇記住帳號，方便下次重新連接。';
 $('loginGoogle').textContent=store.connected?'繼續使用':remembered?'以 '+remembered+' 連接 Google':'使用 Google 連接';
}

function notice(text){$('cloudStatus').textContent=text;$('syncNotice').textContent=text;$('loginNotice').textContent=text;}
function gis(){
 if(globalThis.google?.accounts?.oauth2)return Promise.resolve();
 if(!gisPromise)gisPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.onload=resolve;script.onerror=()=>{gisPromise=null;script.remove();reject(Error('GOOGLE_NETWORK'));};document.head.append(script);});
 return gisPromise;
}
function controls(){
 if(!store.connected&&store.user){store.disconnect();clearSummary();}
 const connected=store.connected;
 $('connectGoogle').textContent=connected?'登出':'連接 Google';
 $('refreshCloud').hidden=!connected;
 $('googleAccount').hidden=!connected;
 if(!connected){$('googleAccountName').textContent='';$('googleAccountEmail').textContent='';$('googleAvatar').removeAttribute('src');$('googleAvatar').hidden=true;$('googleAvatarFallback').hidden=false;}
 for(const id of ['connectGoogle','refreshCloud','syncCloud','loginGoogle','switchLoginAccount'])$(id).disabled=working||preparing;
 $('rememberAccount').disabled=working;drawRemembered();
}
function logout(message='已登出本工具，雲端試算表保留。',{clearPreview=true}={}){
 authAttempt++;clearTimeout(expiryTimer);expiryTimer=null;store.disconnect();clearSummary();if(clearPreview)window.dispatchEvent(new Event('finance-signout'));controls();notice(message);
}
function showAccount(){
 const user=store.user||{};
 $('googleAccountName').textContent=user.displayName||'Google 帳戶';
 $('googleAccountEmail').textContent=user.emailAddress||'Google 未提供信箱';
 $('googleAvatarFallback').textContent=(user.displayName||user.emailAddress||'G').slice(0,1);
 $('googleAvatar').hidden=true;$('googleAvatarFallback').hidden=false;
 try{const url=new URL(user.photoLink);if(url.protocol==='https:'&&(url.hostname==='googleusercontent.com'||url.hostname.endsWith('.googleusercontent.com'))){$('googleAvatar').src=url.href;$('googleAvatar').hidden=false;$('googleAvatarFallback').hidden=true;}}catch{}
 controls();
 clearTimeout(expiryTimer);expiryTimer=setTimeout(()=>logout('Google 授權已過期，請重新連接。',{clearPreview:false}),Math.max(0,store.expires-Date.now()));
}
function clearSummary(){
 accountChoices?.clear();renderAssets(null);clearHistory();
 $('bankDeposit').textContent='尚未同步';$('bankDepositDetail').textContent='連接 Google 後載入各帳戶最後餘額。';$('cloudSheetLink').hidden=true;
}
async function summary(){
 const result=await store.summary();renderAssets(result);renderHistory(result.history);
 accountChoices?.update(result.accounts||{});
 $('bankDeposit').textContent=result.balances.length?(result.pending.length?'部分合計 NT$ ':'NT$ ')+(result.totalCents/100).toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2}):'尚無可核對餘額';
 $('bankDepositDetail').textContent=(result.balances.length?result.balances.map(b=>b.bank+'／'+b.account+'：'+(b.cents/100).toLocaleString('zh-TW')+'（'+b.date+'）').join('；'):'尚無已儲存的銀行明細。')+(result.pending.length?'；'+result.pending.length+' 個帳戶餘額或交易先後待確認，未列入合計。':'')+' 此為匯入明細最後餘額，非銀行即時餘額。';
 $('cloudSheetLink').href=store.file.webViewLink||'https://docs.google.com/spreadsheets/d/'+encodeURIComponent(store.file.id)+'/edit';$('cloudSheetLink').hidden=false;
}
export function initCloud({getPayload}){
 initHistory();accountChoices=initAccounts();remembered=rememberedAccount(browserStorage());rememberChoice=!!remembered;
 // Remove the obsolete per-user public ID setting; credentials remain memory-only.
 try{localStorage.removeItem('finance-google-client-id');}catch{}
 clearSummary();controls();
 $('googleAvatar').addEventListener('error',()=>{$('googleAvatar').hidden=true;$('googleAvatarFallback').hidden=false;});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)controls();});
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
 // Preload GIS on login/settings; OAuth is requested only after the user clicks.
 const prepare=()=>{if(!['','#login','#settings'].includes(location.hash)||!GOOGLE_CLIENT_ID||globalThis.google?.accounts?.oauth2||preparing)return;preparing=true;controls();void gis().catch(()=>notice('Google 連接元件無法載入；可重試或先使用本機匯入。')).finally(()=>{preparing=false;controls();});};
 window.addEventListener('hashchange',prepare);prepare();
 function connect({forceChooser=false,fromLogin=false}={}){
  if(working||preparing)return;
  if(store.connected&&!forceChooser){if(fromLogin)location.hash='home';else logout();return;}
  if(store.connected)logout('正在切換 Google 帳號…');
  const attempt=++authAttempt;
  const id=GOOGLE_CLIENT_ID;if(!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)){notice('網站尚未設定 Google 連接，請聯絡網站管理者。');return;}
  if(!globalThis.google?.accounts?.oauth2){void gis().then(()=>notice('Google 授權元件已就緒，請再點一次「連接 Google」。')).catch(()=>notice(messages.GOOGLE_NETWORK));return;}
  working=true;controls();
  const finish=()=>{working=false;controls();};
  const client=google.accounts.oauth2.initTokenClient({client_id:id,scope:SCOPE,include_granted_scopes:false,
   ...(remembered&&!forceChooser?{login_hint:remembered}:{}),
   callback:async response=>{
    if(attempt!==authAttempt)return;
    try{
     if(response.error||!response.access_token||!google.accounts.oauth2.hasGrantedAllScopes(response,SCOPE))throw Error('GOOGLE_PERMISSION');
     store.authorize(response.access_token,response.expires_in);clearSummary();await store.profile();showAccount();await store.open();await summary();if(attempt!==authAttempt)return;
     remembered=rememberChoice?(store.user?.emailAddress||''):'';
     const stored=rememberAccount(browserStorage(),remembered);drawRemembered();
     notice('Google 已連接。匯入後會依自動儲存選項寫入你自己的「我的理財紀錄」。'+(rememberChoice&&!stored?' 此瀏覽器無法記住帳號，本次連接仍可使用。':''));
     if(fromLogin)location.hash='home';
    }catch(error){if(attempt!==authAttempt)return;clearTimeout(expiryTimer);store.disconnect();clearSummary();notice(messages[error.message]||'Google 連接失敗。');}finally{if(attempt===authAttempt)finish();}
   },error_callback:()=>{if(attempt!==authAttempt)return;finish();notice('Google 授權視窗未完成，請確認 Safari 允許彈出視窗後再連接。');}});
  try{client.requestAccessToken({prompt:remembered&&!forceChooser?'':'select_account'});}catch{finish();notice('無法開啟 Google 授權視窗，請在 Safari 開啟網站再試。');}
 }
 $('connectGoogle').addEventListener('click',()=>connect());
 $('loginGoogle').addEventListener('click',()=>connect({fromLogin:true}));
 $('switchLoginAccount').addEventListener('click',()=>connect({forceChooser:true,fromLogin:true}));
 $('rememberAccount').addEventListener('change',()=>{rememberChoice=$('rememberAccount').checked;if(!rememberChoice){remembered='';rememberAccount(browserStorage(),'');}else if(store.connected){remembered=store.user?.emailAddress||'';rememberAccount(browserStorage(),remembered);}drawRemembered();});
 $('forgetAccount').addEventListener('click',()=>{remembered='';rememberChoice=false;rememberAccount(browserStorage(),'');drawRemembered();notice('已忘記這台裝置記住的帳號；雲端資料不受影響。');});
 $('refreshCloud').addEventListener('click',async()=>{if(working)return;working=true;controls();try{await summary();notice('已重新載入雲端餘額。');}catch(e){notice(messages[e.message]||'載入失敗。');}finally{working=false;controls();}});

 window.addEventListener('pagehide',()=>{authAttempt++;working=false;clearTimeout(expiryTimer);store.disconnect();clearSummary();controls();});
 return {saveStocks:async payload=>{if(working)throw Error('SYNC_BUSY');if(!store.connected)throw Error('GOOGLE_LOGIN_REQUIRED');working=true;controls();try{const batch=await makeStockImport(payload);const saved=await store.saveStocks(batch);await summary();return saved;}finally{working=false;controls();}},savedImport:async()=>{if($('autoCloud').checked&&store.connected)await save();else notice('本次匯入尚未存到雲端；連接 Google 後可點「儲存本次匯入」。');}};
}
