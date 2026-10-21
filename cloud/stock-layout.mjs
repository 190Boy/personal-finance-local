export const LEGACY_SNAPSHOT_HEADERS=['快照ID','券商','帳戶代稱','報表產製時間','幣別','持股筆數','市值分','內容指紋','匯入時間'];
export const LEGACY_HOLDING_HEADERS=['快照ID','證券代號','證券名稱','股數','幣別','收盤價','價格日期','市值分'];
export const HOLDING_HEADERS=['資料類型','快照ID','券商','帳戶代稱','報表產製時間','幣別','持股筆數','總市值分','內容指紋','匯入時間','證券代號','證券名稱','股數','收盤價','價格日期','市值分','持股幣別'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function mergeStockTables(holdings,snapshots){
 if(snapshots.length&&!same(snapshots[0],LEGACY_SNAPSHOT_HEADERS))throw Error('SHEET_SCHEMA');
 if(holdings.length&&same(holdings[0],HOLDING_HEADERS))return {rewrite:false,rows:holdings.slice(1)};
 if(holdings.length&&!same(holdings[0],LEGACY_HOLDING_HEADERS))throw Error('SHEET_SCHEMA');
 const positions=holdings.slice(1),rows=[],known=new Set();
 for(const s of snapshots.slice(1)){
  known.add(s[0]);const items=positions.filter(p=>p[0]===s[0]);
  rows.push([s[5]===0?'空庫存':'快照',...s,'','',0,'','',0,'']);
  for(const p of items)rows.push(['持股',...s,p[1],p[2],p[3],p[5],p[6],p[7],p[4]]);
 }
 for(const p of positions)if(!known.has(p[0]))rows.push(['缺快照',p[0],'','','',p[4],'','','','',p[1],p[2],p[3],p[5],p[6],p[7],p[4]]);
 return {rewrite:true,rows};
}
export function splitStockRows(rows){
 const snapshots=new Map(),holdings=[];
 for(const r of rows){
  if(!['快照','持股','空庫存','庫存缺漏','缺快照'].includes(r[0]))continue;
  if(r[0]!=='缺快照'){const s=r.slice(1,10);snapshots.set(JSON.stringify(s),s);}
  if(r[0]==='持股'||r[0]==='缺快照')holdings.push([r[1],r[10],r[11],r[12],r[16]??r[5],r[13],r[14],r[15]]);
 }
 return {'股票快照':[...snapshots.values()],'股票庫存':holdings};
}
