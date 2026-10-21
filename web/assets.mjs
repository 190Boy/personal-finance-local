const $=id=>document.getElementById(id);
const money=c=>(c/100).toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2});
export function assetParts(summary){
 if(!summary)return [];
 return [{name:'銀行存款',cents:summary.totalCents,color:'#1763aa'},{name:'股票市值',cents:summary.stocks?.totalCents||0,color:'#16a487'}].filter(p=>Number.isSafeInteger(p.cents)&&p.cents>0);
}
export function renderAssets(summary){
 const stocks=summary?.stocks,credits=summary?.credits;
 $('creditCardDebt').textContent=credits?.accounts.length?(credits.pending.length?'部分合計 NT$ ':'NT$ ')+money(credits.totalCents):summary?'待確認／尚無帳單':'尚未同步';
 $('creditCardDetail').textContent=credits?(credits.accounts.map(a=>a.bank+'／'+a.account+'：'+a.month+' 帳單待繳 NT$ '+money(a.cents)+'；結帳 '+a.closing+'；截止 '+a.due+'；繳款核對 '+a.asOf).join('；')||'尚無已確認帳單待繳。')+(credits.pending.length?'；'+credits.pending.map(p=>p.bank+'／'+p.account+'：'+p.reason).join('；'):'')+' 僅顯示已確認的帳單總額減結帳後已繳，非即時總負債；不包含未出帳及未來分期。':'連接 Google 後載入信用卡帳單。';
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
