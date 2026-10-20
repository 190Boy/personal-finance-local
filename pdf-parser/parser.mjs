// Coordinate parser. Bank profiles remain experimental until real statement acceptance.
export const PARSER_VERSION = '0.2.0';
export const BANKS = {ctbc:'中國信託', esun:'玉山銀行'};
const norm=s=>String(s??'').normalize('NFKC').trim();
const compact=s=>norm(s).replace(/\s/g,'');
const labels={
 date:['交易日期','交易日','日期'],time:['交易時間','時間'],
 summary:['交易摘要','交易項目','交易類別','摘要'],
 expense:['支出金額','提款金額','提出金額','支出','提款','提出'],
 income:['存入金額','存款金額','收入金額','存入','存款','收入'],
 balance:['帳戶餘額','交易後餘額','存款餘額','結存金額','餘額','結餘'],
 note:['存摺備註','備註','附言']
};
export function moneyCents(input,{blank=false}={}){
 let s=compact(input);
 if(blank && (!s||s==='-'||s==='—'))return 0;
 s=s.replace(/^(?:NT\$|TWD|\$)/i,'');
 if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s))return null;
 const sign=s.startsWith('-')?-1:1;s=s.replace(/^-/, '').replace(/,/g,'');
 const [whole,frac='']=s.split('.');
 const n=sign*(Number(whole)*100+Number(frac.padEnd(2,'0')));
 return Number.isSafeInteger(n)?n:null;
}
export function parseDate(s){
 const m=norm(s).match(/^\*?(\d{3,4})[\/.-](\d{1,2})[\/.-](\d{1,2})(?:\s|$)/);
 if(!m)return null;
 let y=Number(m[1]);if(y<1911)y+=1911;
 const mo=Number(m[2]),d=Number(m[3]),v=new Date(Date.UTC(y,mo-1,d));
 if(y<1911||y>2200||v.getUTCFullYear()!==y||v.getUTCMonth()!==mo-1||v.getUTCDate()!==d)return null;
 return String(y).padStart(4,'0')+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0');
}
export function groupLines(items,tolerance=3){
 const sorted=items.filter(i=>norm(i.str)).slice().sort((a,b)=>a.y-b.y||a.x-b.x);
 const lines=[];
 for(const it of sorted){
  let line=lines.at(-1);
  if(!line||Math.abs(line.y-it.y)>tolerance){line={y:it.y,items:[]};lines.push(line);}
  line.items.push({...it,str:norm(it.str)});
 }
 for(const line of lines){line.items.sort((a,b)=>a.x-b.x);line.text=line.items.map(i=>i.str).join(' ');}
 return lines;
}
function findHeader(lines){
 let best=null;
 for(let i=0;i<lines.length;i++){
  const row=lines[i],found={};
  // A printed header may split a label into individual PDF text items.
  for(let j=0;j<row.items.length;j++){
   for(let span=1;span<=4&&j+span<=row.items.length;span++){
    const parts=row.items.slice(j,j+span);
    if(parts.some((p,k)=>k&&p.x-(parts[k-1].x+parts[k-1].w)>22))break;
    const text=compact(parts.map(p=>p.str).join(''));
    for(const [field,names] of Object.entries(labels)){
     if(!found[field]&&names.includes(text)){
      const left=parts[0].x,right=parts.at(-1).x+parts.at(-1).w;
      found[field]={x:(left+right)/2,left,right};
     }
    }
   }
  }
  // Merge adjacent header baselines (e.g. wrapped labels).
  if(best&&Math.abs(best.y-row.y)<20){
   for(const [k,v] of Object.entries(found))if(!best.columns[k])best.columns[k]=v;
   best.score=['date','summary','expense','income','balance'].filter(k=>best.columns[k]).length;
   best.y=row.y;
  }
  const required=['date','summary','expense','income','balance'];
  const score=required.filter(k=>found[k]).length;
  if(!best||score>best.score)best={columns:found,y:row.y,score};
  if(required.every(k=>best.columns[k]))return best;
 }
 return null;
}
function columnFields(line,columns){
 const anchors=Object.entries(columns).sort((a,b)=>a[1].x-b[1].x),out={};
 for(const item of line.items){
  const cx=item.x+item.w/2;
  let selected=anchors[0]?.[0];
  for(let i=1;i<anchors.length;i++){
   if(cx>=(anchors[i-1][1].x+anchors[i][1].x)/2)selected=anchors[i][0];
  }
  if(selected)(out[selected]??=[]).push(item);
 }
 return Object.fromEntries(Object.entries(out).map(([key,items])=>[key,items.map(t=>t.str).join(' ').trim()]));
}
function transactionHint(s){
 if(/信用卡|卡費/.test(s))return '信用卡繳款候選';
 if(/股利|股息|配息/.test(s))return '股利候選';
 if(/手續費|跨提費/.test(s))return '手續費候選';
 if(/跨行|轉帳|轉入|轉出|匯款/.test(s))return '資金移動候選';
 if(/退款|退費|沖正|取消/.test(s))return '退款／沖正候選';
 return '待分類';
}
function timeValue(s){
 const t=norm(s);
 if(!t)return {value:null,issue:null}; // Source statement may not print time.
 const m=t.match(/(?:^|\s)(\d{2}):(\d{2})(?::(\d{2}))?(?:\s|$)/);
 if(!m||+m[1]>23||+m[2]>59||+(m[3]||0)>59)return {value:null,issue:'INVALID_TIME'};
 return {value:m[1]+':'+m[2]+':'+(m[3]||'00'),issue:null};
}
function identity(t){
 return [t.bank,t.date,t.time??'',t.summary,t.expenseCents,t.incomeCents,t.balanceCents].join('\u001f');
}
export function reconcile(transactions,{order='ascending',openingCents=null}={}){
 const rows=order==='descending'?[...transactions].reverse():[...transactions];
 let previous=openingCents;let gaps=0,checked=0,failed=0;
 for(const t of rows){
  const usable=t.date&&[t.expenseCents,t.incomeCents,t.balanceCents].every(Number.isSafeInteger)&&
   t.errors.length===0;
  if(!usable){t.balanceCheck={status:'uncheckable'};previous=null;gaps++;continue;}
  if(previous===null){t.balanceCheck={status:'no_opening'};gaps++;}
  else{
   const expected=previous-t.expenseCents+t.incomeCents;
   const difference=t.balanceCents-expected;
   t.balanceCheck={status:difference===0?'pass':'fail',expectedCents:expected,differenceCents:difference};
   checked++;if(difference!==0)failed++;
  }
  previous=t.balanceCents;
 }
 return {checked,failed,unanchored:gaps,complete:rows.length>0&&gaps===0&&failed===0&&checked===rows.length};
}
export function parseStatement(pages,options={}){
 const {bank,order='ascending',openingCents=null,columns:manual=null}=options;
 if(!BANKS[bank])throw new Error('BANK_REQUIRED');
 const transactions=[],issues=[],headers=[];
 let pending=null;let inherited=null;let datesSeen=0;
 const report=(code,page,line,detail='')=>issues.push({code,page,line,detail});
 function flush(){
  if(!pending)return;
  const p=pending, f=p.fields;
  const date=parseDate(f.date||'');
  const fromDate=norm(f.date||'').replace(/^\*?\d{3,4}[\/.-]\d{1,2}[\/.-]\d{1,2}/,'').trim();
  const tm=timeValue(f.time||fromDate);
  const expense=moneyCents(f.expense,{blank:true}),income=moneyCents(f.income,{blank:true}),balance=moneyCents(f.balance);
  const errors=[...p.errors];
  if(!date)errors.push('INVALID_DATE');
  if(tm.issue)errors.push(tm.issue);
  if(!f.summary?.trim())errors.push('MISSING_SUMMARY');
  if(expense===null||income===null)errors.push('INVALID_AMOUNT');
  if(balance===null)errors.push('INVALID_BALANCE');
  if(expense===0&&income===0)errors.push('ZERO_FLOW');
  if(expense>0&&income>0)errors.push('BOTH_DIRECTIONS');
  if(expense<0||income<0)errors.push('NEGATIVE_FLOW');
  const t={bank:BANKS[bank],date,time:tm.value,summary:norm(f.summary),note:norm(f.note),
   expenseCents:expense,incomeCents:income,balanceCents:balance,
   typeHint:transactionHint((f.summary||'')+' '+(f.note||'')),
   page:p.page,endPage:p.endPage,line:p.line,errors:[...new Set(errors)],reviewStatus:'needs_review'};
  transactions.push(t);pending=null;
 }
 for(const page of pages){
  const lines=groupLines(page.items);
  const header=manual?{columns:Object.fromEntries(Object.entries(manual).map(([k,v])=>[k,{x:v*page.width/100}])),y:-1,manual:true}:findHeader(lines);
  const columns=header?.columns||inherited;
  if(header){inherited=header.columns;headers.push({page:page.number,manual:!!manual,fields:Object.keys(header.columns)});}
  if(!columns){report('HEADER_NOT_FOUND',page.number,null,'無法可靠定位欄位；請使用欄位位置設定。');}
  for(let index=0;index<lines.length;index++){
   const line=lines[index],text=norm(line.text),compactText=compact(text);
   if(header&&!manual&&line.y<=header.y+2)continue;
   if(/^(?:第?\s*\d+\s*頁|Page\s*\d+|列印|下載時間|查詢期間|帳號|戶名|注意事項|合計|總計|本頁小計|期末餘額|期初餘額)/i.test(text))continue;
   if(Object.values(labels).flat().includes(compactText))continue;
   if(!columns){
    if(/^\*?\d{3,4}[\/.-]\d{1,2}[\/.-]\d{1,2}/.test(text)){
     flush();datesSeen++;pending={fields:{date:text},page:page.number,endPage:page.number,line:index+1,errors:['UNMAPPED_ROW']};
     flush();
    }
    continue;
   }
   const fields=columnFields(line,columns),dateField=norm(fields.date);
   const beginsDate=/^\*?\d{3,4}[\/.-]\d{1,2}[\/.-]\d{1,2}/.test(dateField);
   if(beginsDate){
    flush();datesSeen++;pending={fields,page:page.number,endPage:page.number,line:index+1,errors:[]};
   }else if(/^\*?\d{3,4}[\/.-]\d{1,2}[\/.-]\d{1,2}/.test(text)){
    flush();datesSeen++;pending={fields:{...fields,date:text},page:page.number,endPage:page.number,line:index+1,errors:['UNMAPPED_ROW']};
   }else if(pending){
    const hasMoney=['expense','income','balance'].some(k=>fields[k]&&moneyCents(fields[k])!==null);
    const hasDateOrTime=fields.date||fields.time;
    if(hasMoney||hasDateOrTime){
     // Never silently append a second financial line to an existing transaction.
     pending.errors.push('AMBIGUOUS_CONTINUATION');report('AMBIGUOUS_CONTINUATION',page.number,index+1);
    }else{
     for(const k of ['summary','note'])if(fields[k])pending.fields[k]=[pending.fields[k],fields[k]].filter(Boolean).join(' ');
     pending.endPage=page.number;
    }
   }else if(['expense','income','balance'].some(k=>fields[k]&&moneyCents(fields[k])!==null)){
    report('ORPHAN_FINANCIAL_ROW',page.number,index+1,'有金額但沒有可識別日期。');
   }
  }
 }
 flush();
 const allText=pages.flatMap(p=>p.items.map(i=>norm(i.str))).join(' ');
 if(bank==='ctbc'&&/玉山銀行|交易明細查詢下載/.test(allText))report('BANK_MISMATCH',null,null);
 if(bank==='esun'&&/中國信託|CTBC/i.test(allText))report('BANK_MISMATCH',null,null);
 if(!transactions.length)report('NO_TRANSACTIONS',null,null,'可能是掃描檔、未知版型或無交易。未執行 OCR。');
 // Treat identical financial rows as review candidates, never delete them.
 const identities=new Map();
 transactions.forEach(t=>{const key=identity(t),prior=identities.get(key);
  if(prior){t.errors.push('DUPLICATE_CANDIDATE');prior.errors.push('DUPLICATE_CANDIDATE');}
  else identities.set(key,t);
 });
 const ordered=order==='descending'?[...transactions].reverse():transactions;
 for(let i=1;i<ordered.length;i++){
  const a=ordered[i-1],b=ordered[i];
  if(a.date&&b.date&&(a.date>b.date||(a.date===b.date&&a.time&&b.time&&a.time>b.time))){
   report('ORDER_MISMATCH',b.page,b.line,'請確認 PDF 原始交易順序，不能只按日期排序猜測。');
  }
 }
 const balance=reconcile(transactions,{order,openingCents});
 const invalidRows=transactions.filter(t=>t.errors.length).length;
 return {parserVersion:PARSER_VERSION,bank:BANKS[bank],transactions,issues,headers,
  stats:{datesSeen,rows:transactions.length,invalidRows,pages:pages.length},
  balance,validation:{status:'needs_review',fieldChecksPass:transactions.length>0&&invalidRows===0&&issues.length===0,
   balanceChecksComplete:balance.complete,realBankSamplesVerified:false,
   message:'實驗解析結果，需逐欄人工核對。餘額吻合不代表欄位全部正確。'}};
}
export function markCrossFileDuplicates(result,seen,accountScope){
 if(!accountScope)return;
 for(const t of result.transactions){
  const key=accountScope+'\u001f'+identity(t);
  if(seen.has(key))t.errors.push('CROSS_FILE_DUPLICATE_CANDIDATE');
 }
 for(const t of result.transactions)seen.add(accountScope+'\u001f'+identity(t));
 result.validation.status='needs_review';
}
