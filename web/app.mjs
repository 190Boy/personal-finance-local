import {initStocks} from './stocks.mjs';
import {initCloud} from '../cloud/ui.mjs';
import {inspectTable,parseEsunTable,TABLE_FIELDS} from '../pdf-parser/tabular.mjs';
import {readLocalExcel} from '../pdf-parser/excel.mjs';
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
 CANCELLED:'已取消並清除本次資料。',REPEATED_PDF:'此檔案已在本次頁面處理過。未重複加入資料；如需重新校正，先清除本次資料。',
 INVALID_COLUMNS:'手動欄位必須包含日期、摘要、支出、收入、餘額，百分比介於 0–100 且不可重複。',
 INVALID_OPENING:'期初餘額格式錯誤，請輸入完整數字。',EXCEL_MAPPING:'請確認日期、摘要、提款、存入、餘額欄位，且不可對應到同一欄。',EXCEL_EMPTY:'Excel 沒有可讀取的資料。',EXCEL_REQUIRED:'玉山請選銀行匯出的 .xls／.xlsx；中信請選 PDF。',EXCEL_FORMAT:'檔案內容不是支援的 Excel 格式。',EXCEL_ENCRYPTED:'這種 Excel 加密方式尚未支援；未上傳檔案。',EXCEL_PASSWORD_REQUIRED:'這份 Excel 需要開啟密碼。請輸入密碼，再點本機解密並讀取 Excel。',EXCEL_WRONG_PASSWORD:'Excel 密碼錯誤，請重新輸入後重試。',EXCEL_PASSWORD_LENGTH:'Excel 密碼不可超過 255 個字元。',EXCEL_ENCRYPTION_UNSUPPORTED:'這份 Excel 的加密方式尚未支援；未上傳檔案。',EXCEL_DECRYPT_FAILED:'Excel 解密失敗，請確認檔案完整性與加密方式；未上傳檔案。',EXCEL_READ_FAILED:'Excel 無法讀取，請重新從銀行下載。',EXCEL_LIMIT:'Excel 超過 50,000 列、256 欄、20 張工作表或文字大小上限。',EXCEL_TIMEOUT:'Excel 讀取超過 30 秒，已停止並清除 Worker。',EXCEL_WORKER:'Excel 本機 Worker 無法啟動，請確認網站程式載入完整。'
};
const reasonNames={
 EXCEL_FORMULA:'來源含公式，未執行且須核對',EXCEL_CELL_ERROR:'來源含 Excel 錯誤值',EXCEL_ROW_WIDTH:'此列欄數與表頭不同',NON_HORIZONTAL_TEXT:'有未納入表格的文字',INVALID_DATE:'日期無效',INVALID_TIME:'時間無效',MISSING_SUMMARY:'缺少摘要',INVALID_AMOUNT:'金額無效',
 INVALID_BALANCE:'餘額無效',ZERO_FLOW:'收入支出均為零',BOTH_DIRECTIONS:'同時有收入與支出',NEGATIVE_FLOW:'負數資金方向需核對',
 FEE_REQUIRES_REVIEW:'手續費無效或來源處理方式待確認',UNMAPPED_ROW:'欄位未定位',AMBIGUOUS_CONTINUATION:'跨行內容不明',DUPLICATE_CANDIDATE:'相同交易候選',
 CROSS_FILE_DUPLICATE_CANDIDATE:'其他 PDF 已有相同交易候選',HEADER_NOT_FOUND:'未找到表頭',
 ORPHAN_FINANCIAL_ROW:'有金額但缺日期',BANK_MISMATCH:'銀行選擇與文件標記不一致',NO_TRANSACTIONS:'未識別交易',ORDER_MISMATCH:'交易順序不符'
};
let extractor=null,result=null,pages=null,busy=false,run=0,controller=null;
let tableDraft=null,excelBook=null,importContext=null;
const seenFiles=new Set(),seenTransactions=new Set(),urls=new Set();

const routes=['login','home','transactions','import','bank-import','stocks','settings'];
function updateRoute(focus=false){
 const requested=location.hash.slice(1);
 const route=routes.includes(requested)?requested:'login';
 document.body.classList.toggle('login-view',route==='login');
 document.querySelectorAll('[data-route]').forEach(view=>{view.hidden=view.dataset.route!==route;});
 document.querySelectorAll('[data-nav]').forEach(link=>{
  if(link.dataset.nav===(['stocks','bank-import'].includes(route)?'import':route))link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
 });
 $('emptyTransactions').hidden=!!result;
 if(focus){
  const view=document.querySelector('[data-route="'+route+'"]');
  const heading=view?.querySelector('h1,h2');
  heading?.setAttribute('tabindex','-1');heading?.focus({preventScroll:true});window.scrollTo(0,0);
 }
}
window.addEventListener('hashchange',()=>updateRoute(true));
window.addEventListener('finance-signout',clearAll);

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
  $(id).disabled=value||(id==='parse'&&($('bank').value==='esun'?!$('pdfFile').files.length:!extractor));
 for(const el of $('excelOptions').querySelectorAll('select'))el.disabled=value;
 exportsEnabled();
}
function discardPreview(){
 result=null;importContext=null;if(pages){pages.length=0;pages=null;}
 $('rows').replaceChildren();$('mobileRows').replaceChildren();$('homePreview').textContent='尚無本次預覽資料。';$('emptyTransactions').hidden=false;$('issues').textContent='';$('rawText').textContent='';
 $('resultSummary').textContent='';$('validation').textContent='';$('resultPanel').hidden=true;
 $('confirmExport').checked=false;exportsEnabled();
}
function clearAll(){
 window.dispatchEvent(new Event('finance-clear-local'));
 run++;controller?.abort();controller=null;
 discardPreview();tableDraft=null;excelBook=null;$('excelSheet').replaceChildren();$('excelMapping').replaceChildren();$('excelHeader').replaceChildren();$('excelInfo').textContent='';seenFiles.clear();seenTransactions.clear();
 for(const id of sensitiveInputs)$(id).value='';
 window.dispatchEvent(new Event('account-source-reset'));
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
 $('homePreview').textContent='本次匯入預覽：'+transactions.length+' 筆，尚未入帳。';
 $('mobileRows').replaceChildren();
 $('resultSummary').textContent=(result.sourceType==='excel'?'玉山 Excel':stats.pages+' 頁')+' · '+stats.rows+' 筆 · '+stats.invalidRows+' 筆欄位待核對 · '+balance.checked+' 次餘額比較／'+balance.failed+' 次不符';
 $('validation').textContent='人工核對必須完成。欄位結構：'+(validation.fieldChecksPass?'檢查通過':'存在待核對項目')+
  '；完整餘額檢查：'+(balance.complete?'通過':'未通過或缺少起始餘額')+'。真實銀行樣本尚未驗收，不能視為正式入帳。';
 $('rows').replaceChildren();
 for(const t of transactions){
  const row=document.createElement('tr');
  const check=t.balanceCheck||{};
  const checkLabel=check.status==='pass'?'吻合':check.status==='fail'?'不符（差 '+format(check.differenceCents)+'）':
   check.status==='no_opening'?'無起始餘額':'無法核對';
  const values=[t.date||'無效日期',t.time||'未提供',t.summary||'—',format(t.expenseCents),format(t.incomeCents),format(t.feeCents),
   format(t.balanceCents),t.typeHint,result.sourceType==='excel'?'Excel 第 '+t.sourceLine+' 列':t.page===t.endPage?t.page:t.page+'–'+t.endPage,
   checkLabel,(t.errors.length?[...new Set(t.errors)].map(k=>reasonNames[k]||k).join('、'):'仍需逐欄人工核對')+(t.feeCents!==null&&t.feeCents!==undefined?'；獨立手續費：'+format(t.feeCents):'')];
  values.forEach((v,i)=>{const cell=document.createElement('td');cell.textContent=String(v);
   if((i===9&&check.status==='fail')||(i===10&&t.errors.length))cell.className='bad';
   if(i===9&&check.status==='pass')cell.className='good';row.append(cell);});

  $('rows').append(row);
  const card=document.createElement('article');card.className='transaction-card';
  const title=document.createElement('h3');title.textContent=t.summary||'未識別摘要';card.append(title);
  const date=document.createElement('p');date.className='muted';date.textContent=(t.date||'日期待核對')+' · '+(t.time||'未提供時間');card.append(date);
  const dl=document.createElement('dl');
  for(const [name,value] of [['支出',format(t.expenseCents)],['收入',format(t.incomeCents)],['手續費',format(t.feeCents)],['餘額',format(t.balanceCents)],['來源位置',values[8]]]){
   const block=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');
   dt.textContent=name;dd.textContent=String(value);block.append(dt,dd);dl.append(block);
  }
  card.append(dl);
  for(const [name,value] of [['餘額檢查',checkLabel],['辨識提示',t.typeHint],['待核對',values[10]]]){
   const p=document.createElement('p');p.className=name==='待核對'&&t.errors.length?'bad':'muted';p.textContent=name+'：'+value;card.append(p);
  }
  $('mobileRows').append(card);
 }
 $('issues').textContent=result.issues.length?result.issues.map(i=>
  [i.page?'第 '+i.page+' 頁':'全檔',i.line?'第 '+i.line+' 行':'',reasonNames[i.code]||i.code,i.detail].filter(Boolean).join(' · ')).join('\n'):'無全檔結構錯誤；仍需人工比對原始 PDF。';
 $('textDetails').hidden=result.sourceType==='excel';$('rawText').textContent='展開後顯示本機文字。';$('textDetails').open=false;exportsEnabled();
}
$('textDetails').addEventListener('toggle',()=>{
 if(!$('textDetails').open){$('rawText').textContent='';return;}
 if(!pages)return;
 $('rawText').textContent=pages.map(p=>'第 '+p.number+' 頁\n'+groupLines(p.items).map(l=>
  l.items.map(i=>'['+(100*i.x/p.width).toFixed(1)+'%] '+i.str).join(' | ')).join('\n')+(p.excludedItems?.length?'\n未納入表格的文字（請確認是否含交易）：\n'+p.excludedItems.map(i=>i.str).join('\n'):'')).join('\n\n');
});
$('pdfForm').addEventListener('submit',async event=>{
 event.preventDefault();if(busy||($('bank').value==='ctbc'&&!extractor))return;
 if($('bank').value==='esun'&&!tableDraft){let secret=$('password').value;$('password').value='';try{await prepareExcel(secret);}finally{secret='';}return;}
 const myRun=++run;discardPreview();controller=new AbortController();setBusy(true);
 let password=$('password').value; $('password').value='';
 let file=$('pdfFile').files[0],digest=null,documentHash=null;
 try{
  if(!file||file.size===0)throw new Error('EMPTY_FILE');
  if(file.size>25*1024*1024)throw new Error('FILE_TOO_LARGE');
  const opening=$('opening').value.trim();
  const openingCents=opening?moneyCents(opening):null;
  if(opening&&openingCents===null)throw new Error('INVALID_OPENING');
  const isExcel=$('bank').value==='esun';
  const options={bank:$('bank').value,order:$('order').value,openingCents,columns:isExcel?null:columns()};
  status(isExcel?'正在裝置內讀取 Excel…':'正在裝置內解密與擷取文字…');
  // Opaque hash is held in this page only, never sent or persisted.
  digest=await file.arrayBuffer();
  documentHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',digest))).map(x=>x.toString(16).padStart(2,'0')).join('');
  digest=null;
  if(myRun!==run)return;
  if(seenFiles.has(documentHash))throw new Error('REPEATED_PDF');
  if(isExcel){
   if(!/\.xlsx?$/i.test(file.name)||!tableDraft)throw Error('EXCEL_REQUIRED');
   const mapping={};for(const field of TABLE_FIELDS){const value=$('excel-'+field).value;if(value!=='')mapping[field]=Number(value);}
   result=parseEsunTable(tableDraft,{mapping,headerIndex:Number($('excelHeader').value),order:options.order,openingCents});
   result.document={sourceType:'excel',bytes:file.size,sheetName:tableDraft.sheetName};
  }else{
   const extracted=await extractor.extractLocalPdf(file,password,{signal:controller.signal,onProgress:(n,total)=>{
    if(myRun===run)status('本機擷取第 '+n+'／'+total+' 頁…');
   }});
   password='';
   if(myRun!==run){extracted.pages.length=0;return;}
   pages=extracted.pages;status('正在依文字座標解析並檢查餘額…');
   result=applyExtractionWarnings(parseStatement(pages,options),pages);
   result.document={...extracted.info,bytes:file.size};
  }
  markCrossFileDuplicates(result,seenTransactions,$('account').value.trim());
  seenFiles.add(documentHash);
  importContext={fileHash:documentHash,order:options.order};
  render();location.hash='transactions';updateRoute();status(result.transactions.length?'解析完成，請逐筆比對銀行原始檔案。':'檔案讀取完成，但未識別交易；請檢查銀行選擇及欄位位置。');
  await cloud.savedImport();
 }catch(error){
  if(myRun===run){discardPreview();status(errorMessages[error.message]||'本機解析失敗。請檢查版本與檔案格式；未上傳檔案。');}
 }finally{
  password='';digest=null;file=null;documentHash=null;
  if(myRun===run){controller=null;if($('bank').value!=='esun')$('pdfFile').value='';setBusy(false);}
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
$('pdfFile').addEventListener('change',()=>{if($('bank').value==='esun'){$('password').value='';void prepareExcel();return;}discardPreview();$('password').value='';status('已選檔。請輸入密碼後開始本機解析。');});
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


const excelNames={date:'日期（必要）',time:'時間（可留空）',summary:'摘要（必要）',expense:'提款／支出（必要）',income:'存入／收入（必要）',balance:'餘額（必要）',fee:'獨立手續費（可留空）',note:'備註（可留空）'};
function fillExcelMapping(){
 if(!tableDraft)return;
 const cells=tableDraft.rows[Number($('excelHeader').value)]?.cells||[];
 $('excelMapping').replaceChildren();
 const detected=inspectTable([{cells,line:1}]).mapping;
 for(const field of TABLE_FIELDS){
  const label=document.createElement('label');label.textContent=excelNames[field];
  const select=document.createElement('select');select.id='excel-'+field;
  const empty=document.createElement('option');empty.value='';empty.textContent='未對應';select.append(empty);
  cells.forEach((name,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=(i+1)+'：'+name;select.append(o);});
  if(detected[field]!=null)select.value=String(detected[field]);label.append(select);$('excelMapping').append(label);
 }
}
function selectExcelSheet(){
 discardPreview();
 const sheet=excelBook?.sheets[Number($('excelSheet').value)];if(!sheet)return;
 tableDraft={...inspectTable(sheet.rows),date1904:excelBook.date1904,sheetName:sheet.name};
 $('excelHeader').replaceChildren();
 tableDraft.rows.slice(0,30).forEach((r,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent='第 '+r.line+' 列：'+r.cells.join(' ／ ').slice(0,100);$('excelHeader').append(o);});
 $('excelHeader').value=String(tableDraft.headerIndex);fillExcelMapping();
 $('parse').textContent='核對欄位並解析 Excel';
 $('excelInfo').textContent='Excel 已在本機讀取；請確認工作表、表頭及欄位對應，再點「本機讀取並解析 Excel」。';
 setBusy(false);
}
async function prepareExcel(password=''){
 controller?.abort();
 $('parse').textContent='本機解密並讀取 Excel';
 const generation=++run;discardPreview();tableDraft=null;excelBook=null;$('password').value='';
 $('excelMapping').replaceChildren();$('excelHeader').replaceChildren();$('excelSheet').replaceChildren();$('excelInfo').textContent='';
 const file=$('pdfFile').files[0];if(!file){setBusy(false);return;}
 controller=new AbortController();setBusy(true);status('正在裝置內讀取 Excel…');
 try{
  if(!/\.xlsx?$/i.test(file.name))throw Error('EXCEL_REQUIRED');
  const book=await readLocalExcel(file,{signal:controller.signal,password});
  if(generation!==run)return;excelBook=book;
  book.sheets.forEach((s,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=s.name;$('excelSheet').append(o);});
  // Select the sheet with the best matching header; every choice stays visible.
  let best=0,score=-1;book.sheets.forEach((s,i)=>{const found=inspectTable(s.rows);if(found.score>score){best=i;score=found.score;}});
  $('excelSheet').value=String(best);selectExcelSheet();status('Excel 已在本機讀取，請確認欄位對應。');
 }catch(error){if(generation===run){tableDraft=null;excelBook=null;status(errorMessages[error.message]||'Excel 無法讀取，請確認檔案格式。');}}
 finally{password='';if(generation===run){controller=null;setBusy(false);}}
}
function updateSource(){
 const excel=$('bank').value==='esun';$('passwordField').hidden=false;$('passwordLabel').textContent=excel?'Excel 開啟密碼（有加密才需填）':'PDF 開啟密碼';$('password').placeholder=excel?'選檔後輸入；只在本機解密':'僅供本次記憶體內解密';$('pdfColumns').hidden=excel;$('excelOptions').hidden=!excel;
 $('fileLabel').textContent=excel?'玉山銀行 Excel':'中信銀行 PDF';$('pdfFile').accept=excel?'.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'.pdf,application/pdf';
 $('parse').textContent=excel?(tableDraft?'核對欄位並解析 Excel':'本機解密並讀取 Excel'):'本機解密並解析';
 setBusy(false);
}
$('bank').addEventListener('change',()=>{clearAll();updateSource();$('order').value=$('bank').value==='esun'?'descending':'ascending';status($('bank').value==='esun'?'請選玉山銀行匯出的 Excel，再確認欄位。':'請選中信 PDF，最後輸入密碼。');});
$('excelSheet').addEventListener('change',selectExcelSheet);$('excelHeader').addEventListener('change',fillExcelMapping);
const cloud=initCloud({getPayload:()=>result&&importContext?{result,context:importContext,account:$('account').value.trim()}:null});
updateSource();void start();

initStocks(cloud);
