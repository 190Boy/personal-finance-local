import {applyExtractionWarnings} from '../pdf-parser/geometry.mjs';
import {initPwa,clearPublicCache} from './pwa.mjs';
import {parseStatement,moneyCents,groupLines,markCrossFileDuplicates} from '../pdf-parser/parser.mjs';
import {toCSV,toJSON} from '../pdf-parser/export.mjs';
const $=id=>document.getElementById(id);
const errorMessages={
 EMPTY_FILE:'檔案是空的。',FILE_TOO_LARGE:'檔案超過 25 MiB。',INVALID_PDF_HEADER:'檔頭不是 PDF。',
 PASSWORD_REQUIRED:'這份 PDF 需要密碼，請輸入後重試。',WRONG_PASSWORD:'PDF 密碼錯誤，請重新輸入。',
 PDF_READ_FAILED:'PDF 無法讀取。請先檢查密碼、檔案完整性與 PDF.js／Worker 版本，尚不能判定銀行格式不受支援。',
 PAGE_LIMIT:'超過 200 頁上限。',TEXT_LIMIT:'擷取文字超過本機測試上限。',TIME_LIMIT:'處理超過 90 秒，已停止。可先使用較小的測試檔。',
 ROTATED_PAGE:'目前不解析旋轉頁面，以免欄位錯位。',ROTATED_TEXT:'偵測到旋轉文字，需檢查原檔版型。',
 WORKER_FAILED:'本機 Worker 啟動失敗，請確認 PDF.js 與 Worker 版本一致及瀏覽器支援模組 Worker。',
 CANCELLED:'已取消並清除本次資料。',REPEATED_PDF:'此 PDF 已在本次頁面處理過。未重複加入資料；如需重新校正，先清除本次資料。',
 INVALID_COLUMNS:'手動欄位必須包含日期、摘要、支出、收入、餘額，百分比介於 0–100 且不可重複。',
 INVALID_OPENING:'期初餘額格式錯誤，請輸入完整數字。'
};
const reasonNames={
 NON_HORIZONTAL_TEXT:'有未納入表格的文字',INVALID_DATE:'日期無效',INVALID_TIME:'時間無效',MISSING_SUMMARY:'缺少摘要',INVALID_AMOUNT:'金額無效',
 INVALID_BALANCE:'餘額無效',ZERO_FLOW:'收入支出均為零',BOTH_DIRECTIONS:'同時有收入與支出',NEGATIVE_FLOW:'負數資金方向需核對',
 UNMAPPED_ROW:'欄位未定位',AMBIGUOUS_CONTINUATION:'跨行內容不明',DUPLICATE_CANDIDATE:'相同交易候選',
 CROSS_FILE_DUPLICATE_CANDIDATE:'其他 PDF 已有相同交易候選',HEADER_NOT_FOUND:'未找到表頭',
 ORPHAN_FINANCIAL_ROW:'有金額但缺日期',BANK_MISMATCH:'銀行選擇與文件標記不一致',NO_TRANSACTIONS:'未識別交易',ORDER_MISMATCH:'交易順序不符'
};
let extractor=null,result=null,pages=null,busy=false,run=0,controller=null;
const seenFiles=new Set(),seenTransactions=new Set(),urls=new Set();

const routes=['home','transactions','import','settings'];
function updateRoute(focus=false){
 const requested=location.hash.slice(1);
 const route=routes.includes(requested)?requested:'home';
 document.querySelectorAll('[data-route]').forEach(view=>{view.hidden=view.dataset.route!==route;});
 document.querySelectorAll('[data-nav]').forEach(link=>{
  if(link.dataset.nav===route)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
 });
 $('emptyTransactions').hidden=!!result;
 if(focus){
  const view=document.querySelector('[data-route="'+route+'"]');
  const heading=view?.querySelector('h1,h2');
  heading?.setAttribute('tabindex','-1');heading?.focus({preventScroll:true});window.scrollTo(0,0);
 }
}
window.addEventListener('hashchange',()=>updateRoute(true));

const sensitiveInputs=['pdfFile','password','opening','account'];
const format=c=>Number.isSafeInteger(c)?(c/100).toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
function status(text){$('status').textContent=text;}
function exportsEnabled(){
 const enabled=!!result&&!busy&&$('confirmExport').checked;
 $('csv').disabled=!enabled;$('json').disabled=!enabled;
}
function setBusy(value){
 busy=value;
 $('clearCache').disabled=value;
 for(const id of ['parse','bank','pdfFile','password','order','opening','account','manual','col-date','col-time','col-summary','col-expense','col-income','col-balance','col-note'])
  $(id).disabled=value||(id==='parse'&&!extractor);
 exportsEnabled();
}
function discardPreview(){
 result=null;if(pages){pages.length=0;pages=null;}
 $('rows').replaceChildren();$('mobileRows').replaceChildren();$('homePreview').textContent='尚無本次預覽資料。';$('emptyTransactions').hidden=false;$('issues').textContent='';$('rawText').textContent='';
 $('resultSummary').textContent='';$('validation').textContent='';$('resultPanel').hidden=true;
 $('confirmExport').checked=false;exportsEnabled();
}
function clearAll(){
 run++;controller?.abort();controller=null;
 discardPreview();seenFiles.clear();seenTransactions.clear();
 for(const id of sensitiveInputs)$(id).value='';
 for(const url of urls)URL.revokeObjectURL(url);urls.clear();
 setBusy(false);status('已清除頁面持有的資料與本次重複檢查紀錄。');
}
function columns(){
 if(!$('manual').checked)return null;
 const out={};
 for(const key of ['date','time','summary','expense','income','balance','note']){
  const value=$('col-'+key).value.trim();
  if(value==='')continue;
  const n=Number(value);if(!Number.isFinite(n)||n<0||n>100)throw new Error('INVALID_COLUMNS');
  out[key]=n;
 }
 if(!['date','summary','expense','income','balance'].every(k=>k in out)||new Set(Object.values(out)).size!==Object.keys(out).length)
  throw new Error('INVALID_COLUMNS');
 return out;
}
function render(){
 const {transactions,stats,balance,validation}=result;
 $('resultPanel').hidden=false;$('emptyTransactions').hidden=true;
 $('homePreview').textContent='本次 PDF 預覽：'+transactions.length+' 筆，尚未入帳。';
 $('mobileRows').replaceChildren();
 $('resultSummary').textContent=stats.pages+' 頁 · '+stats.rows+' 筆 · '+stats.invalidRows+' 筆欄位待核對 · '+balance.checked+' 次餘額比較／'+balance.failed+' 次不符';
 $('validation').textContent='人工核對必須完成。欄位結構：'+(validation.fieldChecksPass?'檢查通過':'存在待核對項目')+
  '；完整餘額檢查：'+(balance.complete?'通過':'未通過或缺少起始餘額')+'。真實銀行樣本尚未驗收，不能視為正式入帳。';
 $('rows').replaceChildren();
 for(const t of transactions){
  const row=document.createElement('tr');
  const check=t.balanceCheck||{};
  const checkLabel=check.status==='pass'?'吻合':check.status==='fail'?'不符（差 '+format(check.differenceCents)+'）':
   check.status==='no_opening'?'無起始餘額':'無法核對';
  const values=[t.date||'無效日期',t.time||'未提供',t.summary||'—',format(t.expenseCents),format(t.incomeCents),
   format(t.balanceCents),t.typeHint,t.page===t.endPage?t.page:t.page+'–'+t.endPage,
   checkLabel,t.errors.length?[...new Set(t.errors)].map(k=>reasonNames[k]||k).join('、'):'仍需逐欄人工核對'];
  values.forEach((v,i)=>{const cell=document.createElement('td');cell.textContent=String(v);
   if((i===8&&check.status==='fail')||(i===9&&t.errors.length))cell.className='bad';
   if(i===8&&check.status==='pass')cell.className='good';row.append(cell);});

  $('rows').append(row);
  const card=document.createElement('article');card.className='transaction-card';
  const title=document.createElement('h3');title.textContent=t.summary||'未識別摘要';card.append(title);
  const date=document.createElement('p');date.className='muted';date.textContent=(t.date||'日期待核對')+' · '+(t.time||'未提供時間');card.append(date);
  const dl=document.createElement('dl');
  for(const [name,value] of [['支出',format(t.expenseCents)],['收入',format(t.incomeCents)],['餘額',format(t.balanceCents)],['頁碼',values[7]]]){
   const block=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');
   dt.textContent=name;dd.textContent=String(value);block.append(dt,dd);dl.append(block);
  }
  card.append(dl);
  for(const [name,value] of [['餘額檢查',checkLabel],['辨識提示',t.typeHint],['待核對',values[9]]]){
   const p=document.createElement('p');p.className=name==='待核對'&&t.errors.length?'bad':'muted';p.textContent=name+'：'+value;card.append(p);
  }
  $('mobileRows').append(card);
 }
 $('issues').textContent=result.issues.length?result.issues.map(i=>
  [i.page?'第 '+i.page+' 頁':'全檔',i.line?'第 '+i.line+' 行':'',reasonNames[i.code]||i.code,i.detail].filter(Boolean).join(' · ')).join('\n'):'無全檔結構錯誤；仍需人工比對原始 PDF。';
 $('rawText').textContent='展開後顯示本機文字。';$('textDetails').open=false;exportsEnabled();
}
$('textDetails').addEventListener('toggle',()=>{
 if(!$('textDetails').open){$('rawText').textContent='';return;}
 if(!pages)return;
 $('rawText').textContent=pages.map(p=>'第 '+p.number+' 頁\n'+groupLines(p.items).map(l=>
  l.items.map(i=>'['+(100*i.x/p.width).toFixed(1)+'%] '+i.str).join(' | ')).join('\n')+(p.excludedItems?.length?'\n未納入表格的文字（請確認是否含交易）：\n'+p.excludedItems.map(i=>i.str).join('\n'):'')).join('\n\n');
});
$('pdfForm').addEventListener('submit',async event=>{
 event.preventDefault();if(busy||!extractor)return;
 const myRun=++run;discardPreview();controller=new AbortController();setBusy(true);
 let password=$('password').value; $('password').value='';
 let file=$('pdfFile').files[0],digest=null,documentHash=null;
 try{
  if(!file||file.size===0)throw new Error('EMPTY_FILE');
  if(file.size>extractor.LIMITS.bytes)throw new Error('FILE_TOO_LARGE');
  const opening=$('opening').value.trim();
  const openingCents=opening?moneyCents(opening):null;
  if(opening&&openingCents===null)throw new Error('INVALID_OPENING');
  const options={bank:$('bank').value,order:$('order').value,openingCents,columns:columns()};
  status('正在裝置內解密與擷取文字…');
  // Opaque hash is held in this page only, never sent or persisted.
  digest=await file.arrayBuffer();
  documentHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',digest))).map(x=>x.toString(16).padStart(2,'0')).join('');
  digest=null;
  if(myRun!==run)return;
  if(seenFiles.has(documentHash))throw new Error('REPEATED_PDF');
  const extracted=await extractor.extractLocalPdf(file,password,{signal:controller.signal,onProgress:(n,total)=>{
   if(myRun===run)status('本機擷取第 '+n+'／'+total+' 頁…');
  }});
  password='';
  if(myRun!==run){extracted.pages.length=0;return;}
  pages=extracted.pages;
  status('正在依文字座標解析並檢查餘額…');
  result=applyExtractionWarnings(parseStatement(pages,options),pages);
  markCrossFileDuplicates(result,seenTransactions,$('account').value.trim());
  result.document={...extracted.info,bytes:file.size}; // Excludes original filename and hash.
  seenFiles.add(documentHash);
  render();location.hash='transactions';updateRoute();status(result.transactions.length?'解析完成，請逐筆比對原始 PDF。':'解密與文字擷取完成，但未識別交易；請檢查銀行選擇及欄位位置。');
 }catch(error){
  if(myRun===run){discardPreview();status(errorMessages[error.message]||'本機解析失敗。請檢查版本與檔案格式；未上傳檔案。');}
 }finally{
  password='';digest=null;file=null;documentHash=null;
  if(myRun===run){controller=null;$('pdfFile').value='';setBusy(false);}
 }
});
function download(type){
 if(!result||!$('confirmExport').checked||busy)return;
 const content=type==='csv'?toCSV(result):toJSON(result);
 const blob=new Blob([content],{type:type==='csv'?'text/csv;charset=utf-8':'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob);urls.add(url);
 const a=document.createElement('a');a.href=url;a.download='finance-preview.'+type;
 document.body.append(a);a.click();a.remove();
 setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},30000);
}
$('csv').addEventListener('click',()=>download('csv'));
$('json').addEventListener('click',()=>download('json'));
$('confirmExport').addEventListener('change',exportsEnabled);
$('clear').addEventListener('click',clearAll);
$('pdfFile').addEventListener('change',()=>{discardPreview();$('password').value='';status('已選檔。請輸入密碼後開始本機解析。');});
window.addEventListener('pagehide',clearAll);
document.addEventListener('visibilitychange',()=>{if(document.hidden)$('password').value='';});
$('clearData').addEventListener('click',()=>{clearAll();$('settingsNotice').textContent='已清除本次 PDF 與交易預覽。';});
$('clearCache').addEventListener('click',async()=>{
 $('clearCache').disabled=true;clearAll();
 try{await clearPublicCache();$('settingsNotice').textContent='公開程式快取已清除。請關閉所有本 App 視窗後再開啟。';}
 catch{$('settingsNotice').textContent='無法清除，請使用瀏覽器網站資料設定。';}
 finally{$('clearCache').disabled=false;}
});
updateRoute();void initPwa();
async function start(){
 try{
  if(location.protocol==='file:')throw new Error('HTTP_REQUIRED');
  extractor=await import('../pdf-parser/extract.mjs');
  $('runtime').textContent='PDF.js '+extractor.PDFJS_VERSION+' · 相容版程式 · 專屬本機 Worker · 無 Google 授權';
  setBusy(false);status('工具已就緒。選擇 PDF 並輸入開啟密碼。');
 }catch{
  $('runtime').textContent='程式尚未載入。';
  status(location.protocol==='file:'?'請用隨附的啟動工具或 GitHub Pages 開啟，不能直接雙擊 HTML。':'PDF.js 載入失敗。請確認完整解壓、靜態資源路徑、瀏覽器版本與 CSP。');
 }
}
void start();
