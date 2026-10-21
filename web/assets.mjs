const $=id=>document.getElementById(id);
const money=c=>(c/100).toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2});
export function assetParts(summary){
 if(!summary)return [];
 return [{name:'銀行存款',cents:summary.totalCents,color:'#1763aa'},{name:'股票市值',cents:summary.stocks?.totalCents||0,color:'#16a487'}].filter(p=>Number.isSafeInteger(p.cents)&&p.cents>0);
}
export function netAssets(summary){
 if(!summary||!(summary.balances?.length||summary.stocks?.accounts?.length||summary.credits?.accounts?.length))return null;
 const bank=summary.totalCents||0,stocks=summary.stocks?.totalCents||0,cards=summary.credits?.totalCents||0,cents=bank+stocks-cards;
 if(![bank,stocks,cards,cents].every(Number.isSafeInteger))return null;
 return {bank,stocks,cards,cents,partial:!summary.balances?.length||!summary.stocks?.accounts?.length||!summary.credits?.accounts?.length||!!(summary.pending?.length||summary.stocks?.pending?.length||summary.credits?.pending?.length)};
}
export function renderAssets(summary){
 const stocks=summary?.stocks,credits=summary?.credits;
 const net=netAssets(summary);
 $('creditCardDebt').textContent=credits?.accounts.length?(credits.pending.length?'部分合計 NT$ ':'NT$ ')+money(credits.totalCents):summary?'尚無信用卡明細':'尚未同步';
 $('creditCardMonth').textContent=credits?.accounts.length?[...new Set(credits.accounts.map(a=>a.month))].sort().join('／'):'';
 $('creditCardDetail').textContent=credits?(credits.accounts.map(a=>a.bank+'／'+a.account+'：'+a.month+' 消費合計 NT$ '+money(a.cents)+'（'+a.count+' 筆；最後匯入 '+(a.asOf?.slice(0,10)||'未提供')+'）').join('；')||'尚無可彙總的信用卡明細。')+(credits.pending.length?'；'+credits.pending.map(p=>p.bank+'／'+p.account+'：'+p.reason).join('；'):'')+' 各帳戶只取最新帳單月份、種類為「消費」的明細。繳款、退款、費用、分期當期與待核對不列入此合計；這不是銀行確認的實際待繳。':'連接 Google 後載入最新帳單月份的消費合計。';
 $('netAssets').textContent=net?'估算 NT$ '+money(net.cents):summary?'尚無可計算資料':'尚未同步';
 $('netAssetDetail').textContent=net?'銀行存款 NT$ '+money(net.bank)+' ＋ 股票市值 NT$ '+money(net.stocks)+' － 信用卡最新月份消費 NT$ '+money(net.cards)+'。依已載入資料估算，非完整或即時淨資產；各來源日期見下方。'+(net.partial?'有來源缺漏、未載入或待核對，僅顯示部分範圍。':'')+' 消費合計未扣除已繳款或退款，也未納入其他費用、未來分期及其他負債。':'連接 Google 後，依銀行存款、股票市值與最新月份信用卡消費估算。';
 $('stockAssets').textContent=stocks?.accounts.length?'NT$ '+money(stocks.totalCents):'尚未同步';
 $('stockAssetDetail').textContent=stocks?stocks.accounts.map(a=>a.broker+'／'+a.account+'：NT$ '+money(a.totalCents)+'；報表 '+a.asOf.replace('T',' ')+'；收盤價日期 '+(a.priceDates.join('、')||'無庫存')).join('；')+(stocks.pending.length?'；'+stocks.pending.map(p=>p.account+'：'+p.reason).join('；'):'')||'尚無已儲存股票快照。':'連接 Google 後載入已確認的股票快照。';
 $('assetPie').replaceChildren();$('assetLegend').replaceChildren();
 const parts=assetParts(summary),total=parts.reduce((s,p)=>s+p.cents,0);
 $('assetChartNotice').textContent=total?'已載入正值資產合計 NT$ '+money(total)+'。僅包含可核對的銀行存款與股票報表市值，非完整淨資產；負值、待核對帳戶及未載入來源未列入。':'尚無可顯示的正值資產；請連接 Google 並匯入資料。';
 if(!total)return;
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 120 120');svg.setAttribute('role','img');svg.setAttribute('aria-label',parts.map(p=>p.name+' '+(100*p.cents/total).toFixed(1)+'%').join('；'));
 let offset=0;
 for(const p of parts){
  const fraction=p.cents/total,c=document.createElementNS(ns,'circle');c.setAttribute('cx','60');c.setAttribute('cy','60');c.setAttribute('r','42');c.setAttribute('fill','none');c.setAttribute('stroke',p.color);c.setAttribute('stroke-width','24');c.setAttribute('pathLength','100');c.setAttribute('stroke-dasharray',(100*fraction)+' '+(100-100*fraction));c.setAttribute('stroke-dashoffset',String(-offset));c.setAttribute('transform','rotate(-90 60 60)');svg.append(c);offset+=100*fraction;
  const li=document.createElement('li');li.textContent=p.name+'：NT$ '+money(p.cents)+'（'+(100*fraction).toFixed(1)+'%）';$('assetLegend').append(li);
 }
 $('assetPie').append(svg);
}
