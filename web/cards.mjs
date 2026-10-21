import {readLocalExcel} from '../pdf-parser/excel.mjs';
import {readCardCsv,parseCardBook,CARD_KINDS} from '../pdf-parser/credit-cards.mjs';
const $=id=>document.getElementById(id),money=c=>Number.isSafeInteger(c)?(c/100).toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2}):'待核對';
const messages={CARD_HEADER:'找不到所選銀行的信用卡欄位，請確認檔案與銀行。',CARD_MULTIPLE:'找到多組表頭，請分別匯出單一帳單。',CARD_EMPTY:'沒有可匯入的明細。',CSV_ENCODING:'CSV 編碼無法識別；支援 UTF-8 與 Big5。',CSV_QUOTES:'CSV 引號結構錯誤，請重新匯出。',CARD_LIMIT:'資料超過本機讀取上限。',FILE_TOO_LARGE:'檔案超過 25 MiB。',EMPTY_FILE:'檔案是空的。',CARD_FILE:'凱基請選 Excel；中信請選 CSV。',CARD_MONTH:'請填寫帳單月份；不要用下載月份代替。',CARD_META:'待繳確認資訊不完整或有誤。請核對帳單月份、結帳日、截止日、帳單總額、結帳後已繳金額及核對日。已繳金額不得大於帳單總額；溢繳請先保持待確認。',ACCOUNT_REQUIRED:'請填寫穩定的信用卡帳戶代稱。',GOOGLE_LOGIN_REQUIRED:'請先到設定連接 Google，再回來同步。',SYNC_BUSY:'其他同步正在進行，請稍後重試。',SYNC_RETRY:'其他裝置正在同步，請稍後重試；預覽保留。',SHEET_SCHEMA:'信用卡工作表欄位已更動，請保留系統欄名與順序。',EXCEL_PASSWORD_REQUIRED:'Excel 需要開啟密碼，請輸入後重試。',EXCEL_WRONG_PASSWORD:'Excel 密碼錯誤，請重新輸入。'};
export function initCards(cloud){
 let parsed=null,digest='',busy=false,run=0,controller=null;
 const metaIds=['cardMonth','cardBillKind','cardClosing','cardDue','cardTotal','cardPaid','cardPaidAsOf','cardDebtConfirmed'];
 const inputIds=['cardBank','cardFile','cardPassword','cardAccount',...metaIds,'cardConsent'];
 function controls(){for(const id of inputIds)$(id).disabled=busy;for(const e of $('cardPreview').querySelectorAll('select'))e.disabled=busy;$('cardParse').disabled=busy;$('cardSave').disabled=busy||!parsed||!$('cardConsent').checked;$('cardMeta').hidden=!parsed;}
 function discard(){run++;controller?.abort();controller=null;parsed=null;digest='';busy=false;$('cardConsent').checked=false;$('cardDebtConfirmed').checked=false;$('cardPassword').value='';$('cardPreview').replaceChildren();$('cardReport').textContent='';for(const id of metaIds){if($(id).type==='checkbox')$(id).checked=false;else $(id).value=id==='cardBillKind'?'待確認':'';}controls();}
 function clear(){discard();$('cardFile').value='';$('cardAccount').value='';$('cardStatus').textContent='已清除信用卡檔案與預覽。';}
 function source(){discard();$('cardFile').value='';const excel=$('cardBank').value==='kgi';$('cardFile').accept=excel?'.xlsx,.xls':'.csv,text/csv';$('cardPasswordLabel').hidden=!excel;$('cardStatus').textContent=excel?'請選擇凱基信用卡 Excel。':'請選擇中信信用卡 CSV；僅依欄位識別版型，銀行由你確認。';}
 $('cardBank').addEventListener('change',source);$('cardFile').addEventListener('change',()=>{discard();$('cardStatus').textContent='檔案已更換，請重新讀取。';});
 for(const id of ['cardAccount',...metaIds])$(id).addEventListener('input',()=>{$('cardConsent').checked=false;controls();});
 $('cardConsent').addEventListener('input',controls);
 function preview(){
  $('cardPreview').replaceChildren();
  const list=document.createElement('div');list.className='card-preview-list';
  parsed.transactions.forEach((t,n)=>{const item=document.createElement('article');item.className='history-card';const h=document.createElement('h3');h.textContent=t.summary||'摘要缺漏';const p=document.createElement('p');p.textContent='消費 '+(t.date||'待核對')+' · 入帳 '+(t.postingDate||'待核對')+' · 第 '+t.line+' 列';const amount=document.createElement('p');amount.textContent='臺幣金額：'+money(t.amountCents)+' 元';const label=document.createElement('label');label.textContent='交易種類（請核對）';const select=document.createElement('select');select.setAttribute('aria-label','第 '+(n+1)+' 筆交易種類');for(const kind of CARD_KINDS)select.append(new Option(kind,kind));select.value=t.kind;select.addEventListener('change',()=>{t.kind=select.value;$('cardConsent').checked=false;controls();});label.append(select);const warning=document.createElement('p');warning.className=t.errors.length?'bad':'muted';warning.textContent=t.errors.join('；')||'仍需比對原檔；交易種類為辨識提示。';item.append(p,h,amount,label,warning);list.append(item);});$('cardPreview').append(list);
 }
 $('cardForm').addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;let secret=$('cardPassword').value;discard();const mine=run,bank=$('cardBank').value,file=$('cardFile').files[0];if(!file){secret='';return;}$('cardPassword').value='';controller=new AbortController();busy=true;controls();$('cardStatus').textContent='正在本機讀取信用卡資料…';
  try{if(bank==='kgi'?!/\.xlsx?$/i.test(file.name):! /\.csv$/i.test(file.name))throw Error('CARD_FILE');if(file.size>25*1024*1024)throw Error('FILE_TOO_LARGE');digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');let book=bank==='kgi'?await readLocalExcel(file,{signal:controller.signal,password:secret}):await readCardCsv(file,{signal:controller.signal});if(mine!==run)return;parsed=parseCardBook(book,{bank});book=null;secret='';$('cardFile').value='';
   $('cardMonth').value=parsed.meta.month;$('cardClosing').value=parsed.meta.closing;$('cardDue').value=parsed.meta.due;$('cardTotal').value=parsed.meta.sourceTotalCents===null?'':String(parsed.meta.sourceTotalCents/100);
   $('cardReport').textContent=parsed.bank+' · '+parsed.transactions.length+' 筆'+(parsed.encoding?' · '+parsed.encoding:'')+'。明細正負合計 '+money(parsed.detailNetCents)+' 元（不是目前欠款）。'+(parsed.meta.sourceTotalCents!==null?'檔頭金額候選 '+money(parsed.meta.sourceTotalCents)+' 元，'+(parsed.sourceTotalMatches?'與明細合計一致，仍需核對是否為完整帳單總額。':'與明細合計不一致，請核對完整帳單。'):'來源沒有可靠帳單總額、結帳日或截止日，請自行補填；不要以資料下載時間作為帳單月份。')+' '+parsed.issues.join(' ');
   preview();$('cardStatus').textContent='讀取完成，尚未同步。請確認帳戶、帳單月份與每筆交易種類。';
  }catch(error){if(mine===run){parsed=null;digest='';$('cardStatus').textContent=messages[error.message]||'本機讀取未完成。請確認檔案格式、密碼與版型；原檔沒有上傳。';}}
  finally{secret='';if(mine===run){busy=false;controller=null;controls();}}
 });
 $('cardSave').addEventListener('click',async()=>{
  if(busy||!parsed||!$('cardConsent').checked)return;const mine=run;busy=true;controls();
  try{const result=await cloud.saveCards({parsed,options:{account:$('cardAccount').value,fileHash:digest,month:$('cardMonth').value,billKind:$('cardBillKind').value,closing:$('cardClosing').value,due:$('cardDue').value,total:$('cardTotal').value,paid:$('cardPaid').value,paidAsOf:$('cardPaidAsOf').value,confirmed:$('cardDebtConfirmed').checked}});if(mine===run)$('cardStatus').textContent=result.repeated?'此匯入已記錄，沒有重複寫入。':'已同步到同一份試算表的「信用卡」與「匯入紀錄」。新增 '+result.added+' 筆明細；首頁與歷史交易已更新。';}
  catch(error){if(mine===run)$('cardStatus').textContent=messages[error.message]||'雲端尚未完成，預覽保留；請重新連接 Google 或稍後重試。';}
  finally{if(mine===run){busy=false;controls();}}
 });
 $('cardClear').addEventListener('click',clear);for(const event of ['pagehide','finance-signout','finance-clear-local'])window.addEventListener(event,clear);document.addEventListener('visibilitychange',()=>{if(document.hidden)$('cardPassword').value='';});source();
}
