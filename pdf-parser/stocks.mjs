import {groupLines,parseDate,moneyCents} from './parser.mjs';
const sourceAccounts=new WeakMap();
const compact=s=>String(s??'').normalize('NFKC').replace(/\s/g,'');
const text=items=>items.slice().sort((a,b)=>a.y-b.y||a.x-b.x).map(i=>i.str).join(' ').trim();
const number=(s,blank=false)=>{s=compact(s);if(blank&&!s)return 0;if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,6})?$/.test(s))return null;const n=Number(s.replace(/,/g,''));return Number.isFinite(n)&&n<=Number.MAX_SAFE_INTEGER?n:null;};
const date=s=>{s=compact(s);let m=s.match(/^(\d{3,4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);if(!m)m=s.match(/^(\d{3})(\d{2})(\d{2})$/);return m?parseDate(m.slice(1).join('/')):null;};
function field(page,items,a,b){return text(items.filter(i=>{const x=(i.x+i.w/2)/page.width;return x>=a&&x<b;}));}
function metadata(pages){
 const all=pages.flatMap(p=>p.items).map(i=>i.str).join(' ');
 const c=compact(all),m=c.match(/(\d{3})年(\d{1,2})月(\d{1,2})日(\d{2}):(\d{2})/);
 const produced=m?parseDate(m.slice(1,4).join('/')):null;return {asOf:produced&&+m[4]<24&&+m[5]<60?(produced+'T'+m[4]+':'+m[5]):null,broker:/中國信託.*證券/.test(c)?'中國信託證券':null};
}
function warnings(pages){
 const errors=[];
 for(const p of pages){
  const normal=compact(p.items.map(i=>i.str).join(''));const account=normal.match(/帳號[:：](\d+)/)?.[1];const stamp=normal.match(/(\d{3}年\d{1,2}月\d{1,2}日\d{2}:\d{2})/)?.[1];const canonical=account&&stamp?'臺灣集中保管結算所'+account+stamp+'產製':'';const excluded=(p.excludedItems||[]).map(i=>compact(i.str));if(canonical&&excluded.every(s=>canonical.includes(s)))continue;const ignored=excluded.join('');
  // Only the known, complete TDCC watermark may be discarded.
  const rest=ignored.replace(/臺灣集中保管結算所\d{8,20}\d{3}年\d{1,2}月\d{1,2}日\d{2}:\d{2}產製/g,'');
  if(rest)errors.push('第 '+p.number+' 頁有未定位文字，需人工檢查');
 }
 return errors;
}
export function parseStockPdf(pages,{kind,currency='TWD'}={}){
 if(!['holdings','movements'].includes(kind))throw Error('STOCK_KIND');
 const meta=metadata(pages),errors=warnings(pages),holdings=[],movements=[];
 if(!meta.asOf)errors.push('未找到報表產製日期');
 if(!meta.broker)errors.push('未識別中國信託證券報表');
 if(currency!=='TWD')errors.push('目前只支援已確認的新臺幣報表');
 let recognized=0,empty=false;
 for(const p of pages){
  const lines=groupLines(p.items),c=compact(text(p.items));
  if(kind==='holdings'){
   if(!c.includes('證券存摺庫存資料')){errors.push('第 '+p.number+' 頁不是庫存報表');continue;}
   if(c.includes('信用餘額')){
    if(c.includes('無庫存')){recognized++;continue;}
    errors.push('信用／融資融券庫存尚未支援，不能納入一般持股');continue;
   }
   const headers=['證券代號','證券名稱','收盤價日期','市值'];
   if(!headers.every(h=>c.includes(h))||!c.includes('普通餘額')){errors.push('第 '+p.number+' 頁庫存表頭不符');continue;}recognized++;
   const headerY=Math.max(...p.items.filter(i=>compact(i.str)==='市值').map(i=>i.y));
   const anchors=lines.filter(l=>l.y>headerY+4&&/^\d+$/.test(compact(field(p,l.items,.058,.102))));
   if(!anchors.length){if(c.includes('無庫存'))empty=true;else errors.push('庫存報表沒有可辨識的資料列');}
   for(let n=0;n<anchors.length;n++){
    const a=anchors[n],end=anchors[n+1]?.y??a.y+14;
    const items=p.items.filter(i=>i.y>=a.y-2&&i.y<end-2);
    const h={code:compact(field(p,items,.102,.149)),name:compact(field(p,items,.149,.312)),quantity:number(field(p,items,.312,.411)),borrowed:number(field(p,items,.411,.503),true),restricted:number(field(p,items,.503,.627),true),currency:compact(field(p,items,.627,.676))||currency,close: number(field(p,items,.676,.747)),priceDate:date(field(p,items,.747,.825)),marketValueCents:moneyCents(compact(field(p,items,.825,.932))),page:p.number};
    if(!/^\d{4,6}[A-Z]?$/.test(h.code)||!h.name||h.quantity===null||h.close===null||!h.priceDate||h.marketValueCents===null||h.currency!=='TWD'||h.borrowed===null||h.restricted===null)errors.push('第 '+p.number+' 頁第 '+(n+1)+' 筆庫存欄位無效');
    else if(Math.abs(Math.round(h.quantity*h.close*100)-h.marketValueCents)>1)errors.push(h.code+' 股數×收盤價與市值不符');
    if(h.priceDate&&meta.asOf&&h.priceDate>meta.asOf.slice(0,10))errors.push(h.code+' 價格日期晚於報表日期');
    if(h.borrowed||h.restricted)errors.push(h.code+' 含借入或受控管數量，需另行核對');
    holdings.push(h);
   }
  }else{
   if(!c.includes('證券存摺登摺資料')||!['提出數額','存入數額','證券代號','摘要'].every(h=>c.includes(h))){errors.push('第 '+p.number+' 頁不是股數異動表');continue;}recognized++;
   const headers=p.items.filter(i=>compact(i.str)==='交易日期');
   if(!headers.length){errors.push('未找到交易日期表頭');continue;}
   const hy=Math.max(...headers.map(i=>i.y));
   const anchors=lines.filter(l=>l.y>hy+8&&date(field(p,l.items,.058,.139)));
   if(!anchors.length&&!c.includes('無交易'))errors.push('沒有可辨識的股數異動');
   for(let n=0;n<anchors.length;n++){
    const a=anchors[n],end=anchors[n+1]?.y??a.y+32,items=p.items.filter(i=>i.y>=a.y-2&&i.y<end-2);
    const t={date:date(field(p,a.items,.058,.139)),code:compact(field(p,items,.139,.209)),name:compact(field(p,items,.209,.354)),memo:compact(field(p,items,.354,.432)),withdrawal:number(field(p,items,.432,.533),true),deposit:number(field(p,items,.533,.630),true),balance:number(field(p,items,.630,.842)),page:p.number};
    if(!/^\d{4,6}[A-Z]?$/.test(t.code)||!t.name||!['買進','賣出'].includes(t.memo)||[t.withdrawal,t.deposit,t.balance].some(v=>v===null)||(t.withdrawal>0)===(t.deposit>0)||(t.memo==='買進'&&t.withdrawal>0)||(t.memo==='賣出'&&t.deposit>0))errors.push('第 '+p.number+' 頁第 '+(n+1)+' 筆股數異動需核對');
    movements.push(t);
   }
  }
 }
 if(!recognized)errors.push('未識別支援的報表版型');
 if(new Set(holdings.map(h=>h.code)).size!==holdings.length)errors.push('庫存證券代號重複');
 if(kind==='holdings'&&!holdings.length&&!empty)errors.push('未辨識一般庫存');
 const result={kind,...meta,currency,holdings,movements,errors:[...new Set(errors)],empty};
 const account=compact(pages.flatMap(p=>p.items).map(i=>i.str).join('')).match(/帳號[:：](\d+)/)?.[1];sourceAccounts.set(result,account||null);
 return result;
}
export function reconcileStocks(snapshot,history){
 const errors=[...(snapshot?.errors||[]),...(history?.errors||[])],checks=[];
 if(snapshot&&history&&snapshot.asOf!==history.asOf)errors.push('兩份報表產製時間不同，請使用同一時間下載的報表');
 if(snapshot&&history&&(!sourceAccounts.get(snapshot)||sourceAccounts.get(snapshot)!==sourceAccounts.get(history)))errors.push('兩份報表的證券帳號不一致或無法確認');
 const latest=new Map(),previous=new Map();let comparisons=0;
 // Source is newest first. Reverse the original sequence; never sort same-day rows.
 for(const t of [...(history?.movements||[])].reverse()){
  const prior=previous.get(t.code);
  if(prior&&t.date<prior.date)errors.push(t.code+' 日期順序不符');
  if(prior){comparisons++;if(Math.abs(prior.balance-t.withdrawal+t.deposit-t.balance)>0.000001)errors.push(t.code+' 股數連續性不符');}
  previous.set(t.code,t);latest.set(t.code,t.balance);
 }
 if(snapshot&&history){
  const h=new Map(snapshot.holdings.map(v=>[v.code,v.quantity]));
  for(const code of new Set([...h.keys(),...latest.keys()])){
   const actual=latest.get(code),expected=h.get(code)||0,pass=actual!==undefined&&Math.abs(actual-expected)<0.000001;
   checks.push({code,quantity:expected,historyBalance:actual??null,pass});
   if(!pass)errors.push(code+' 庫存與異動最後股數不符或缺少異動紀錄');
  }
 }
 return {errors:[...new Set(errors)],checks,comparisons,pass:!errors.length,paired:!!snapshot&&!!history};
}
