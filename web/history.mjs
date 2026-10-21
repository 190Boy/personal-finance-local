import {filterHistory} from '../cloud/history.mjs';
const $=id=>document.getElementById(id);let data=null,limit=100;
const shownNumber=v=>v===''||v==null?'—':Number.isFinite(Number(v))?Number(v).toLocaleString('zh-TW',{maximumFractionDigits:6}):String(v);
export function clearHistory(){data=null;limit=100;$('historyRows').replaceChildren();$('historyAccount').replaceChildren(new Option('全部帳戶',''));$('historyQuery').value='';$('historyFrom').value='';$('historyTo').value='';$('historyKind').value='';$('historyCount').textContent='連接 Google 後載入雲端歷史交易。';$('historyMore').hidden=true;}
export function renderHistory(result){
 data=result;limit=100;const chosen=$('historyAccount').value;const accounts=new Map();
 for(const r of result.rows)accounts.set(JSON.stringify([r.source,r.account]),r.source+'／'+r.account);
 $('historyAccount').replaceChildren(new Option('全部帳戶',''));for(const [key,label] of accounts)$('historyAccount').append(new Option(label,key));
 if(accounts.has(chosen))$('historyAccount').value=chosen;draw();
}
function draw(){
 if(!data)return;
 const rows=filterHistory(data.rows,{kind:$('historyKind').value,account:$('historyAccount').value,query:$('historyQuery').value,from:$('historyFrom').value,to:$('historyTo').value});
 const validRange=!$('historyFrom').value||!$('historyTo').value||$('historyFrom').value<=$('historyTo').value;
 $('historyCount').textContent=(validRange?'雲端歷史 '+data.rows.length+' 筆，篩選 '+rows.length+' 筆，顯示前 '+Math.min(limit,rows.length)+' 筆。':'起始日期不可晚於結束日期。')+(data.duplicates?' 相同 ID 與內容的 '+data.duplicates+' 個重複列已合併顯示；雲端原列保留。':'')+' 銀行待核對資料照常顯示；股票單位為股，不列現金收支。';
 $('historyRows').replaceChildren();
 for(const r of rows.slice(0,limit)){
  const tr=document.createElement('tr'),stock=r.kind==='股票股數';
  const values=[r.kind,r.source,r.account,r.date||'日期待核對',r.time||'—',r.summary,shownNumber(r.expense),shownNumber(r.income),stock?'不適用':shownNumber(r.fee),shownNumber(r.balance),stock?'股':'元',(r.conflict?'相同 ID 內容衝突，全部保留／':'')+(r.review||'未提供核對結果')];
  for(const v of values){const td=document.createElement('td');td.textContent=v;tr.append(td);}if(r.conflict)tr.className='bad';$('historyRows').append(tr);
 }
 $('historyMore').hidden=rows.length<=limit;
}
export function initHistory(){
 for(const id of ['historyKind','historyAccount','historyQuery','historyFrom','historyTo'])$(id).addEventListener('input',()=>{limit=100;draw();});
 $('historyMore').addEventListener('click',()=>{limit+=100;draw();});
 $('historyReset').addEventListener('click',()=>{for(const id of ['historyKind','historyAccount','historyQuery','historyFrom','historyTo'])$(id).value='';limit=100;draw();});
 clearHistory();
}
