import {parseStockPdf,reconcileStocks} from '../pdf-parser/stocks.mjs';
const fileHash=async buffer=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');
const $=id=>document.getElementById(id);
export function initStocks(cloud){
 let snapshot=null,history=null,reconciliation=null,fileHashes={},controller=null,run=0,busy=false,urls=new Set();
 function clear(){run++;controller?.abort();controller=null;snapshot=null;history=null;reconciliation=null;fileHashes={};busy=false;for(const id of ['stockHoldingsFile','stockHistoryFile','stockPassword','stockAccount'])$(id).value='';$('stockConfirmed').checked=false;$('stockTwd').checked=false;$('stockPreview').replaceChildren();$('stockReport').textContent='';$('stockStatus').textContent='已清除股票檔案與預覽。';for(const url of urls)URL.revokeObjectURL(url);urls.clear();controls();}
 function controls(){for(const id of ['stockHoldingsFile','stockHistoryFile','stockPassword','stockAccount','stockTwd','stockConfirmed'])$(id).disabled=busy;$('stockParse').disabled=busy;$('stockSave').disabled=busy||!snapshot||!reconciliation?.pass||!$('stockConfirmed').checked||!$('stockTwd').checked;$('stockExport').disabled=busy||!snapshot||!$('stockConfirmed').checked;}
 function invalidate(){run++;controller?.abort();snapshot=null;history=null;reconciliation=null;fileHashes={};$('stockConfirmed').checked=false;$('stockPreview').replaceChildren();$('stockReport').textContent='來源已更動，請重新解析。';controls();}
 for(const id of ['stockHoldingsFile','stockHistoryFile'])$(id).addEventListener('change',invalidate);
 $('stockConfirmed').addEventListener('input',controls);for(const id of ['stockTwd','stockAccount'])$(id).addEventListener('input',()=>{$('stockConfirmed').checked=false;controls();});
 function table(title,headers,rows){
  const h=document.createElement('h3');h.textContent=title;const wrap=document.createElement('div');wrap.className='tablewrap';wrap.tabIndex=0;
  const t=document.createElement('table'),head=document.createElement('thead'),tr=document.createElement('tr');
  for(const v of headers){const c=document.createElement('th');c.textContent=v;tr.append(c);}head.append(tr);t.append(head);const body=document.createElement('tbody');
  for(const row of rows){const tr=document.createElement('tr');for(const v of row){const c=document.createElement('td');c.textContent=String(v??'—');tr.append(c);}body.append(tr);}t.append(body);wrap.append(t);$('stockPreview').append(h,wrap);
 }
 $('stockForm').addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;const mine=++run;controller=new AbortController();busy=true;snapshot=null;history=null;reconciliation=null;fileHashes={};$('stockConfirmed').checked=false;$('stockPreview').replaceChildren();controls();
  let secret=$('stockPassword').value;$('stockPassword').value='';
  try{
   if(!$('stockTwd').checked)throw Error('TWD_CONFIRM');
   const {extractLocalPdf}=await import('../pdf-parser/extract.mjs');
   for(const [kind,id] of [['holdings','stockHoldingsFile'],['movements','stockHistoryFile']]){
    const file=$(id).files[0];if(!file){if(kind==='holdings')throw Error('HOLDINGS_REQUIRED');continue;}
    $('stockStatus').textContent=kind==='holdings'?'正在本機解密庫存 PDF…':'正在本機解密股數異動 PDF…';
    if(file.size>25*1024*1024)throw Error('FILE_TOO_LARGE');
    const digest=await fileHash(await file.arrayBuffer());
    const extracted=await extractLocalPdf(file,secret,{signal:controller.signal});
    if(mine!==run)return;
    const parsed=parseStockPdf(extracted.pages,{kind,currency:'TWD'});extracted.pages.length=0;
    if(kind==='holdings')snapshot=parsed;else history=parsed;
    fileHashes[kind]=digest;
   }
   if(mine!==run)return;reconciliation=reconcileStocks(snapshot,history);
   table('庫存預覽（股，不是張）',['代號','名稱','股數','收盤價','價格日期','市值 TWD'],snapshot.holdings.map(h=>[h.code,h.name,h.quantity,h.close,h.priceDate,h.marketValueCents===null?'—':(h.marketValueCents/100).toLocaleString('zh-TW')]));
   if(history)table('股數異動（不是現金收支）',['日期','代號','名稱','摘要','提出股數','存入股數','結存股數'],history.movements.map(t=>[t.date,t.code,t.name,t.memo,t.withdrawal,t.deposit,t.balance]));
   $('stockReport').textContent='報表產製：'+(snapshot.asOf||'未識別')+'；庫存 '+snapshot.holdings.length+' 筆；異動 '+(history?.movements.length||0)+' 筆；股數連續性比較 '+reconciliation.comparisons+' 次。'+(reconciliation.paired?'庫存交叉核對 '+reconciliation.checks.length+' 檔。':'未提供異動報表，只驗證庫存欄位與市值算術，不能確認歷史完整性。')+'\n'+(reconciliation.errors.join('\n')||'欄位及算術檢查通過，仍須逐欄比對原檔、確認兩檔是同一證券帳戶。')+'\n缺少成交價、成本與費稅，因此不計算損益。不保證異動涵蓋完整歷史。';
   $('stockStatus').textContent=reconciliation.pass?'解析完成。請比對預覽後確認，再儲存到雲端。':'有待核對問題，已停用雲端儲存。';
  }catch(e){if(mine===run){snapshot=null;history=null;reconciliation=null;$('stockStatus').textContent=({TWD_CONFIRM:'請先確認報表為新臺幣一般庫存。',HOLDINGS_REQUIRED:'請選擇庫存 PDF。',PASSWORD_REQUIRED:'請輸入 PDF 開啟密碼。',WRONG_PASSWORD:'PDF 密碼錯誤，請重試。',FILE_TOO_LARGE:'檔案超過 25 MiB。',CANCELLED:'已取消。'}[e.message]||'本機解析未完成。請確認檔案、密碼及支援版型；沒有上傳原始檔。');}}
  finally{secret='';if(mine===run){busy=false;controller=null;controls();}}
 });
 $('stockSave').addEventListener('click',async()=>{
  if(busy||!reconciliation?.pass||!$('stockConfirmed').checked||!$('stockTwd').checked)return;
  const mine=run;busy=true;controls();
  try{const saved=await cloud.saveStocks({snapshot,history,reconciliation,account:$('stockAccount').value,fileHashes});if(mine===run)$('stockStatus').textContent=saved.repeated?'此匯入已記錄，沒有重複寫入。':'已儲存到同一份雲端試算表的股票工作表，首頁市值與占比已更新。';}
  catch(e){if(mine===run)$('stockStatus').textContent=({ACCOUNT_REQUIRED:'請填寫券商帳戶代稱。',GOOGLE_LOGIN_REQUIRED:'請先到設定連接 Google，再回來儲存。',SHEET_SCHEMA:'雲端股票工作表欄位已更動，請還原系統欄名。',SYNC_BUSY:'其他同步正在進行，請稍後重試。',SYNC_RETRY:'其他裝置正在同步，請稍後重試；預覽仍保留。',SYNC_METADATA_LIMIT:'同步標記接近容量上限，請聯絡維護者；預覽保留，沒有自動刪資料。',SYNC_REVISION_INVALID:'同步協調標記異常，請保留試算表並聯絡維護者。'}[e.message]||'雲端尚未完成，預覽保留；重新連接 Google 或稍後重試。');}
  finally{if(mine===run){busy=false;controls();}}
 });
 $('stockExport').addEventListener('click',()=>{
  if(!snapshot||!$('stockConfirmed').checked)return;const url=URL.createObjectURL(new Blob([JSON.stringify({snapshot,history,reconciliation},null,2)],{type:'application/json'}));urls.add(url);const a=document.createElement('a');a.href=url;a.download='stock-preview.json';a.click();setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},1000);
 });
 $('stockClear').addEventListener('click',clear);
 for(const event of ['finance-signout','pagehide','finance-clear-local'])window.addEventListener(event,clear);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)$('stockPassword').value='';});
 controls();
}
