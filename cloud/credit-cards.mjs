import {hash} from './records.mjs';
import {cardMoney,CARD_KINDS} from '../pdf-parser/credit-cards.mjs';
export const LEGACY_CARD_HEADERS=['資料類型','紀錄ID','匯入ID','銀行','帳戶代稱','帳單月份','結帳日','繳款截止日','消費日','入帳日','摘要','臺幣金額分','種類','原幣幣別','原幣金額','帳單總額分','結帳後已繳金額分','確認狀態','匯入時間','繳款核對日','來源列'];
export const CARD_HEADERS=LEGACY_CARD_HEADERS.map((v,i)=>({11:'臺幣金額（元）',15:'帳單總額（元）',16:'結帳後已繳金額（元）'}[i]||v));
const moneyIndexes=[11,15,16];
export function cardSheetRows(rows){return rows.map(r=>{const out=[...r];for(const i of moneyIndexes)if(out[i]!==''&&out[i]!=null){if(!Number.isSafeInteger(out[i]))throw Error('CARD_AMOUNT');out[i]/=100;if(cardMoney(out[i])!==r[i])throw Error('CARD_AMOUNT');}return out;});}
export function cardTable(values){
 if(!values.length)return {legacy:false,rows:[]};
 const legacy=JSON.stringify(values[0])===JSON.stringify(LEGACY_CARD_HEADERS);
 if(!legacy&&JSON.stringify(values[0])!==JSON.stringify(CARD_HEADERS))throw Error('SHEET_SCHEMA');
 const rows=values.slice(1).map(r=>{const out=[...r];for(const i of moneyIndexes)if(out[i]!==''&&out[i]!=null){const n=legacy?out[i]:cardMoney(out[i]);if(!Number.isSafeInteger(n))throw Error('CARD_AMOUNT');out[i]=n;}return out;});
 return {legacy,rows};
}

const validDate=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===s;};
export function cardMeta(input){
 const month=String(input.month||'');if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))throw Error('CARD_MONTH');
 const kind=['已出帳','未出帳','待確認'].includes(input.billKind)?input.billKind:'待確認';
 const total=cardMoney(input.total),paid=cardMoney(input.paid),confirmed=!!input.confirmed;
 if(confirmed&&(kind!=='已出帳'||!validDate(input.closing)||!validDate(input.due)||!validDate(input.paidAsOf)||input.due<input.closing||input.paidAsOf<input.closing||input.closing.slice(0,7)!==month||!Number.isSafeInteger(total)||!Number.isSafeInteger(paid)||total<0||paid<0||paid>total))throw Error('CARD_META');
 return {month,kind,total,paid,confirmed,closing:input.closing||'',due:input.due||'',paidAsOf:input.paidAsOf||''};
}
export async function makeCardImport(parsed,{account,fileHash,...input}){
 account=String(account||'').trim();if(!account||account.length>60)throw Error('ACCOUNT_REQUIRED');if(!fileHash||!parsed?.transactions?.length)throw Error('NO_RECORDS');
 const meta=cardMeta(input),now=new Date().toISOString(),bank=parsed.bank;
 const id=await hash(JSON.stringify(['cards-v1',bank,account,fileHash,meta,parsed.transactions.map(t=>t.kind)])),rows=[],occurrences=new Map();
 const billId=await hash(JSON.stringify(['card-bill',bank,account,meta]));
 rows.push(['帳單',billId,id,bank,account,meta.month,meta.closing,meta.due,'','','帳單資訊（明細合計不等於目前欠款）','',meta.kind,'','',meta.total??'',meta.paid??'',meta.confirmed?'已確認':'待確認',now,meta.paidAsOf,'']);
 for(const t of parsed.transactions){
  const incomplete=!validDate(t.date)||!validDate(t.postingDate)||!t.summary||!Number.isSafeInteger(t.amountCents);
  const identity=JSON.stringify([bank,account,t.date,t.postingDate,t.summary,t.amountCents,t.currency,t.foreignAmount,...(incomplete?[fileHash,t.line]:[])]),n=(occurrences.get(identity)||0)+1;occurrences.set(identity,n);
  const kind=CARD_KINDS.includes(t.kind)?t.kind:'待核對';
  const errors=[...(t.errors||[])];if(Number.isSafeInteger(t.amountCents)&&((['消費','分期當期','費用'].includes(kind)&&t.amountCents<=0)||(['退款','繳款'].includes(kind)&&t.amountCents>=0)))errors.push('種類與金額方向不符，勿列支出');
  rows.push(['明細',await hash(identity+'#'+n),id,bank,account,meta.month,meta.closing,meta.due,t.date,t.postingDate,t.summary,t.amountCents??'',kind,t.currency||'',t.foreignAmount||'','','',(errors.length?[...new Set(errors)].join('／'):kind==='待核對'?'用途待核對':'人工核對'),now,'',t.line??'']);
 }
 return {id,rows,log:[id,bank,account,'信用卡',now,parsed.transactions.length,0,'','',meta.confirmed?'已確認帳單待繳範圍':'僅匯入明細；欠款未確認']};
}
export function cardRowsToAppend(existing,incoming){
 const groups=new Map();for(const r of existing){const list=groups.get(r[1])||[];list.push(r);groups.set(r[1],list);}
 const signature=r=>JSON.stringify(r[0]==='帳單'?[...r.slice(3,8),...r.slice(12,18),r[19]]:[r[3],r[4],...r.slice(8,15),String(r[17]||'').replace(/／相同紀錄內容衝突/g,'')]);
 const fresh=[];for(const r of incoming){const prior=groups.get(r[1])||[];if(prior.some(p=>signature(p)===signature(r)))continue;const row=[...r];if(prior.length)row[17]=[row[17],'相同紀錄內容衝突'].join('／');fresh.push(row);prior.push(row);groups.set(row[1],prior);}return fresh;
}
export function confirmedCardSummary(rows){
 const groups=new Map(),accounts=[],pending=[];let totalCents=0;
 for(const r of rows){const key=JSON.stringify([r[3],r[4]]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 for(const all of groups.values()){
  const sample=all[0],bills=all.filter(r=>r[0]==='帳單'&&r[12]!=='未出帳');
  if(!bills.length){pending.push({bank:sample[3],account:sample[4],reason:'只有明細或未出帳資料，沒有已確認帳單'});continue;}
  const month=bills.map(r=>String(r[5])).sort().at(-1),monthBills=bills.filter(r=>r[5]===month),latest=monthBills.map(r=>String(r[19]||'')).sort().at(-1),current=monthBills.filter(r=>String(r[19]||'')===latest);
  const timestamp=current.map(r=>String(r[18]||'')).sort().at(-1),candidates=current.filter(r=>r[18]===timestamp),r=candidates[0];
  if(!r||r[17]!=='已確認'||r[12]!=='已出帳'||!Number.isSafeInteger(r[15])||!Number.isSafeInteger(r[16])||r[15]<0||r[16]<0||r[16]>r[15]||!validDate(r[6])||!validDate(r[7])||!validDate(r[19])||r[7]<r[6]||r[19]<r[6]||String(r[6]).slice(0,7)!==month||new Set(candidates.map(v=>JSON.stringify([v[15],v[16]]))).size!==1){pending.push({bank:sample[3],account:sample[4],reason:'最新帳單總額或結帳後已繳金額尚未確認／有衝突'});continue;}
  if(monthBills.some(v=>v[17]!=='已確認'&&!v[19]))pending.push({bank:r[3],account:r[4],reason:'同月份另有待確認帳單；目前仍顯示上次已確認範圍'});
  const cents=r[15]-r[16];totalCents+=cents;if(!Number.isSafeInteger(totalCents))throw Error('AMOUNT_LIMIT');
  accounts.push({bank:r[3],account:r[4],month,cents,totalCents:r[15],paidCents:r[16],closing:r[6],due:r[7],asOf:r[19]});
  if(all.some(t=>t[0]==='帳單'&&t[12]==='未出帳'))pending.push({bank:r[3],account:r[4],reason:'另有未出帳明細，未列入已出帳待繳'});
 }
 return {totalCents,accounts,pending};
}
export function cardHistory(rows){
 const entries=[],seen=new Map();let duplicates=0;
 for(let n=0;n<rows.length;n++){const r=rows[n];if(r[0]!=='明細')continue;
  const key=r[1]||('missing-'+n),signature=JSON.stringify([r[3],r[4],...r.slice(8,15),r[17]]),list=seen.get(key)||[];
  if(list.some(t=>t.financial===signature)){duplicates++;continue;}
  const amount=Number.isSafeInteger(r[11])?r[11]/100:null,kind=r[12],expense=(['消費','分期當期','費用'].includes(kind)&&amount>0)||(kind==='退款'&&amount<0)?amount:null;
  const t={kind:'信用卡',id:key,source:r[3],account:r[4],date:String(r[8]||r[9]||''),time:'',code:'',summary:r[10],expense,income:null,fee:null,balance:null,review:kind+'／'+(r[17]||'待核對'),conflict:list.length>0,ordinal:n,financial:signature,cardKind:kind,cardAmount:amount};
  if(list.length)for(const p of list)p.conflict=true;list.push(t);seen.set(key,list);entries.push(t);
 }
 return {rows:entries,duplicates};
}

// Latest bill month per bank/account; only explicit consumption is included.
export function cardSummary(rows){
 const groups=new Map(),accounts=[],pending=[];let totalCents=0;
 for(const r of rows){const key=JSON.stringify([r[3],r[4]]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 for(const all of groups.values()){
  const sample=all[0],months=all.map(r=>String(r[5]||'')).filter(v=>/^\d{4}-(?:0[1-9]|1[0-2])$/.test(v)).sort(),month=months.at(-1);
  if(!month){pending.push({bank:sample[3],account:sample[4],reason:'帳單月份無效，未列入'});continue;}
  const current=all.filter(r=>r[5]===month),details=current.filter(r=>r[0]==='明細'),byId=new Map();let cents=0,consumptions=0,uncertain=0;const updated=[];
  for(let n=0;n<details.length;n++){const r=details[n],id=r[1]||('missing-'+n),list=byId.get(id)||[];list.push(r);byId.set(id,list);}
  for(const list of byId.values()){
   const r=list[0],signatures=new Set(list.map(v=>JSON.stringify([v[11],v[12]])));
   if(signatures.size!==1){uncertain++;continue;}
   if(r[12]!=='消費')continue;
   if(!Number.isSafeInteger(r[11])||r[11]<0){uncertain++;continue;}
   cents+=r[11];if(!Number.isSafeInteger(cents))throw Error('AMOUNT_LIMIT');consumptions++;
  }
  for(const r of current)if(r[18])updated.push(String(r[18]));
  if(!details.length){pending.push({bank:sample[3],account:sample[4],reason:month+' 尚無交易明細'});continue;}
  if(uncertain)pending.push({bank:sample[3],account:sample[4],reason:month+' 有 '+uncertain+' 筆消費金額或分類衝突，未列入'});
  if(all.some(r=>!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(r[5]||''))))pending.push({bank:sample[3],account:sample[4],reason:'另有月份無效資料，未列入'});
  accounts.push({bank:sample[3],account:sample[4],month,cents,count:consumptions,asOf:updated.sort().at(-1)||''});totalCents+=cents;if(!Number.isSafeInteger(totalCents))throw Error('AMOUNT_LIMIT');
 }
 return {totalCents,accounts,pending,basis:'latest-month-consumption'};
}
