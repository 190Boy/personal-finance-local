import {filterHistory} from '../cloud/history.mjs';
const $=id=>document.getElementById(id);let data=null,limit=100;
const shownNumber=v=>v===''||v==null?'—':Number.isFinite(Number(v))?Number(v).toLocaleString('zh-TW',{maximumFractionDigits:6}):String(v);
export function clearHistory(){data=null;limit=100;$('historyRows').replaceChildren();$('historyCards').replaceChildren();$('historyAccount').replaceChildren(new Option('全部帳戶',''));$('historyQuery').value='';$('historyFrom').value='';$('historyTo').value='';$('historyKind').value='';$('historyCount').textContent='尚未載入歷史交易。';$('historyEmpty').hidden=false;$('historyEmpty').textContent='請點上方按鈕連接 Google 並載入。';$('historyFilters').open=false;$('historyMore').hidden=true;}
export function renderHistory(result){
 data=result;limit=100;$('historyNotice').textContent=(result.warnings||[]).join('；');const chosen=$('historyAccount').value;const accounts=new Map();
 for(const r of result.rows)accounts.set(JSON.stringify([r.source,r.account]),r.source+'／'+r.account);
 $('historyAccount').replaceChildren(new Option('全部帳戶',''));for(const [key,label] of accounts)$('historyAccount').append(new Option(label,key));
 if(accounts.has(chosen))$('historyAccount').value=chosen;draw();
}
function draw(){
 if(!data)return;
 const rows=filterHistory(data.rows,{kind:$('historyKind').value,account:$('historyAccount').value,query:$('historyQuery').value,from:$('historyFrom').value,to:$('historyTo').value});
 const validRange=!$('historyFrom').value||!$('historyTo').value||$('historyFrom').value<=$('historyTo').value;
 $('historyCount').textContent=(validRange?'已載入 '+data.rows.length+' 筆｜符合 '+rows.length+' 筆｜顯示 '+Math.min(limit,rows.length)+' 筆。':'起始日期不可晚於結束日期。')+(data.duplicates?' 已合併顯示 '+data.duplicates+' 個重複列。':'');
 $('historyRows').replaceChildren();$('historyCards').replaceChildren();
 $('historyEmpty').hidden=rows.length>0;$('historyEmpty').textContent=data.rows.length?'沒有符合目前篩選的交易，可展開篩選並清除。':'此試算表尚無已儲存的銀行交易或股票異動；可先確認 Google 帳戶與原本的試算表。';
 for(const r of rows.slice(0,limit)){
  const tr=document.createElement('tr'),stock=r.kind==='股票股數';
  const values=[r.kind,r.source,r.account,r.date||'日期待核對',r.time||'—',r.summary,shownNumber(r.expense),shownNumber(r.income),stock?'不適用':shownNumber(r.fee),shownNumber(r.balance),stock?'股':'元',(r.conflict?'相同 ID 內容衝突，全部保留／':'')+(r.review||'未提供核對結果')];
  for(const v of values){const td=document.createElement('td');td.textContent=v;tr.append(td);}if(r.conflict)tr.className='bad';$('historyRows').append(tr);
  const card=document.createElement('article');card.className='history-card';const title=document.createElement('h3');title.textContent=r.summary||'摘要待核對';const meta=document.createElement('p');meta.className='muted';meta.textContent=r.date+' '+r.time+' · '+r.source+'／'+r.account+' · '+r.kind;card.append(meta,title);const dl=document.createElement('dl');for(const [label,value] of [[stock?'提出股數':'支出',r.expense],[stock?'存入股數':'收入',r.income],[stock?'結存股數':'餘額',r.balance],...(stock?[]:[['手續費',r.fee]])]){const block=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=shownNumber(value)+(stock?' 股':' 元');block.append(dt,dd);dl.append(block);}card.append(dl);const review=document.createElement('p');review.className='review'+(r.conflict?' bad':' muted');review.textContent=values[11];card.append(review);$('historyCards').append(card);
 }
 if(data.warnings?.length)$('historyCount').textContent='部分來源未載入。'+$('historyCount').textContent+' '+data.warnings.join('；');
 $('historyMore').hidden=rows.length<=limit;
}
export function initHistory(){
 for(const id of ['historyKind','historyAccount','historyQuery','historyFrom','historyTo'])$(id).addEventListener('input',()=>{limit=100;draw();});
 $('historyMore').addEventListener('click',()=>{limit+=100;draw();});
 $('historyReset').addEventListener('click',()=>{for(const id of ['historyKind','historyAccount','historyQuery','historyFrom','historyTo'])$(id).value='';limit=100;draw();});
 clearHistory();
}
