import { monthReport, budgetStatus, TOTAL } from '../cloud/budget.mjs';
import { localToday } from '../cloud/recurring.mjs';
import { isInternal } from '../cloud/categories.mjs';
import { row, dayHeader, groupByDay } from './rows.mjs';
const $ = id => document.getElementById(id);
const yuan = c => Math.round(c / 100).toLocaleString('zh-TW');
// The same balances as 帳戶與餘額, grouped by kind.
function accountGroups(summary) {
  const list = summary?.accountBalances?.accounts;
  if (!list) return null;
  const sum = type => list.filter(a => a.type === type).reduce((s, a) => s + a.cents, 0);
  return {
    bank: sum('銀行'),
    cash: sum('現金'),
    wallet: sum('電子支付'),
    other: sum('其他'),
    banks: list.filter(a => a.type === '銀行'),
    partial: list.some(a => a.partial && a.type !== '現金')
  };
}
const money = c => (c / 100).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function assetParts(summary) {
  if (!summary) return [];
  const g = accountGroups(summary);
  // Colors follow the kind of asset, in a fixed order, whatever is present.
  if (g)
    return [
      { name: '銀行存款', cents: g.bank, color: '#2a78d6' },
      { name: '現金', cents: g.cash, color: '#eb6834' },
      { name: '股票市值', cents: summary.stocks?.totalCents || 0, color: '#1baf7a' },
      { name: 'LINE Pay 錢包', cents: g.wallet, color: '#eda100' },
      { name: '其他帳戶', cents: g.other, color: '#e87ba4' }
    ].filter(p => Number.isSafeInteger(p.cents) && p.cents > 0);
  return [
    { name: '銀行存款', cents: summary.totalCents, color: '#1763aa' },
    { name: '股票市值', cents: summary.stocks?.totalCents || 0, color: '#16a487' }
  ].filter(p => Number.isSafeInteger(p.cents) && p.cents > 0);
}
export function netAssets(summary) {
  const g = accountGroups(summary);
  if (g) {
    const stocks = summary.stocks?.totalCents || 0,
      cards = summary.credits?.totalCents || 0,
      other = g.cash + g.wallet + g.other,
      cents = g.bank + other + stocks - cards;
    if (![g.bank, other, stocks, cards, cents].every(Number.isSafeInteger)) return null;
    return {
      bank: g.bank,
      other,
      stocks,
      cards,
      cents,
      partial:
        g.partial ||
        !!(summary.pending?.length || summary.stocks?.pending?.length || summary.credits?.pending?.length)
    };
  }
  if (
    !summary ||
    !(summary.balances?.length || summary.stocks?.accounts?.length || summary.credits?.accounts?.length)
  )
    return null;
  const bank = summary.totalCents || 0,
    stocks = summary.stocks?.totalCents || 0,
    cards = summary.credits?.totalCents || 0,
    cents = bank + stocks - cards;
  if (![bank, stocks, cards, cents].every(Number.isSafeInteger)) return null;
  return {
    bank,
    stocks,
    cards,
    cents,
    partial:
      !summary.balances?.length ||
      !summary.stocks?.accounts?.length ||
      !summary.credits?.accounts?.length ||
      !!(summary.pending?.length || summary.stocks?.pending?.length || summary.credits?.pending?.length)
  };
}
function renderMonth(summary) {
  const box = $('homeMonth');
  if (!box) return;
  const rows = summary?.history?.rows;
  box.hidden = !rows;
  if (!rows) return;
  const month = localToday().slice(0, 7),
    report = monthReport(rows, month),
    net = report.incomeCents - report.expenseCents;
  $('homeMonthTitle').textContent = +month.slice(5) + ' 月結餘';
  $('homeNet').textContent = (net < 0 ? '−' : '') + yuan(Math.abs(net));
  $('homeNet').className = net < 0 ? 'out' : 'in';
  $('homeIncome').textContent = yuan(report.incomeCents);
  $('homeExpense').textContent = yuan(report.expenseCents);
  const top = Math.max(report.incomeCents, report.expenseCents, 1);
  $('homeIncomeBar').style.width = ((100 * report.incomeCents) / top).toFixed(1) + '%';
  $('homeExpenseBar').style.width = ((100 * report.expenseCents) / top).toFixed(1) + '%';
  const total = budgetStatus(summary.budgets || new Map(), report).find(b => b.name === TOTAL);
  $('homeBudget').textContent = total
    ? total.leftCents >= 0
      ? yuan(total.leftCents)
      : '超出 ' + yuan(-total.leftCents)
    : '＋ 設定預算';
  $('homeBudget').className = total && total.leftCents < 0 ? 'out' : '';
  $('homeBudgetBar').style.width = total ? Math.max(0, 100 - total.ratio * 100).toFixed(1) + '%' : '0%';
  $('homeBudgetBar').classList.toggle('over', !!total && total.leftCents < 0);
  const big = report.byCategory[0];
  $('homeMonthDetail').textContent = big ? '花最多：' + big.name + ' ' + yuan(big.cents) : '';
}
function renderRecent(summary) {
  const section = $('homeRecentSection');
  if (!section) return;
  const rows = (summary?.history?.rows || []).filter(r => r.kind !== '股票股數').slice(0, 8);
  section.hidden = !rows.length;
  const box = $('homeRecent');
  box.replaceChildren();
  const netOf = r =>
    isInternal(r.category) ? 0 : Math.round(((Number(r.income) || 0) - (Number(r.expense) || 0)) * 100);
  for (const g of groupByDay(rows, r => r.date, netOf)) {
    box.append(dayHeader(g.date, g.cents));
    for (const r of g.items)
      box.append(
        row({
          category: r.category,
          title: r.summary || '—',
          sub: [r.account, (r.category || '').split('／').pop()].filter(Boolean).join('－'),
          cents: Math.round(((Number(r.income) || 0) - (Number(r.expense) || 0)) * 100),
          dim: isInternal(r.category),
          onClick: () => (location.hash = '#transactions')
        })
      );
  }
}
function renderBank(summary) {
  const g = accountGroups(summary);
  if (!summary) {
    $('bankDeposit').textContent = '尚未同步';
    $('bankDepositDetail').textContent = '連接 Google 後載入各帳戶最後餘額。';
    return;
  }
  if (g?.banks.length) {
    $('bankDeposit').textContent = (summary.pending?.length ? '部分合計 NT$ ' : 'NT$ ') + money(g.bank);
    $('bankDepositDetail').textContent =
      g.banks.map(a => a.name + '：' + yuan(a.cents) + '（' + a.note + '）').join('；') +
      (summary.pending?.length
        ? '；' + summary.pending.length + ' 個帳戶餘額或交易先後待確認，未列入合計。'
        : '') +
      ' 以匯入明細最後餘額為準，再加減之後的手動記帳，不是銀行即時餘額。';
    return;
  }
  $('bankDeposit').textContent = summary.balances?.length
    ? (summary.pending?.length ? '部分合計 NT$ ' : 'NT$ ') + money(summary.totalCents)
    : '尚無可核對餘額';
  $('bankDepositDetail').textContent =
    (summary.balances?.length
      ? summary.balances
          .map(b => b.bank + '／' + b.account + '：' + yuan(b.cents) + '（' + b.date + '）')
          .join('；')
      : '尚無已儲存的銀行明細。') +
    (summary.pending?.length
      ? '；' + summary.pending.length + ' 個帳戶餘額或交易先後待確認，未列入合計。'
      : '') +
    ' 此為匯入明細最後餘額，非銀行即時餘額。';
}
export function renderAssets(summary) {
  const stocks = summary?.stocks,
    credits = summary?.credits;
  const net = netAssets(summary);
  renderMonth(summary);
  renderRecent(summary);
  renderBank(summary);
  $('homeAssets').textContent = net ? yuan(net.cents + net.cards) : '—';
  $('creditCardDebt').textContent = credits?.accounts.length
    ? yuan(credits.totalCents) + (credits.pending.length ? '（部分）' : '')
    : summary
      ? '—'
      : '尚未同步';
  $('creditCardMonth').textContent = credits?.accounts.length
    ? [...new Set(credits.accounts.map(a => a.month))].sort().join('／')
    : '';
  $('creditCardDetail').textContent = credits
    ? (credits.accounts
        .map(
          a =>
            a.bank +
            '／' +
            a.account +
            '：' +
            a.month +
            ' 消費合計 NT$ ' +
            money(a.cents) +
            '（' +
            a.count +
            ' 筆；最後匯入 ' +
            (a.asOf?.slice(0, 10) || '未提供') +
            '）'
        )
        .join('；') || '尚無可彙總的信用卡明細。') +
      (credits.pending.length
        ? '；' + credits.pending.map(p => p.bank + '／' + p.account + '：' + p.reason).join('；')
        : '') +
      ' 各帳戶只取最新帳單月份、種類為「消費」的明細。繳款、退款、費用、分期當期與待核對不列入此合計；這不是銀行確認的實際待繳。'
    : '連接 Google 後載入最新帳單月份的消費合計。';
  $('netAssets').textContent = net
    ? (net.cents < 0 ? '−' : '') + yuan(Math.abs(net.cents))
    : summary
      ? '尚無資料'
      : '尚未同步';
  $('netAssetDetail').textContent = net
    ? '銀行存款 NT$ ' +
      money(net.bank) +
      (net.other != null ? ' ＋ 現金與錢包等 NT$ ' + money(net.other) : '') +
      ' ＋ 股票市值 NT$ ' +
      money(net.stocks) +
      ' － 信用卡最新月份消費 NT$ ' +
      money(net.cards) +
      '。依已載入資料估算，非完整或即時淨資產；各來源日期見下方。' +
      (net.partial ? '有來源缺漏、未載入或待核對，僅顯示部分範圍。' : '') +
      ' 消費合計未扣除已繳款或退款，也未納入其他費用、未來分期及其他負債。'
    : '連接 Google 後，依銀行存款、現金與錢包、股票市值與最新月份信用卡消費估算。';
  $('stockAssets').textContent = stocks?.accounts.length ? 'NT$ ' + money(stocks.totalCents) : '尚未同步';
  $('stockAssetDetail').textContent = stocks
    ? stocks.accounts
        .map(
          a =>
            a.broker +
            '／' +
            a.account +
            '：NT$ ' +
            money(a.totalCents) +
            '；報表 ' +
            a.asOf.replace('T', ' ') +
            '；收盤價日期 ' +
            (a.priceDates.join('、') || '無庫存')
        )
        .join('；') +
        (stocks.pending.length
          ? '；' + stocks.pending.map(p => p.account + '：' + p.reason).join('；')
          : '') || '尚無已儲存股票快照。'
    : '連接 Google 後載入已確認的股票快照。';
  $('assetPie').replaceChildren();
  $('assetLegend').replaceChildren();
  const parts = assetParts(summary),
    total = parts.reduce((s, p) => s + p.cents, 0);
  $('assetChartNotice').textContent = total
    ? '合計 ' + yuan(total) + '，不含負值與待核對的帳戶。'
    : '尚無可顯示的正值資產；請連接 Google 並匯入資料。';
  if (!total) return;
  const ns = 'http://www.w3.org/2000/svg',
    svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    parts.map(p => p.name + ' ' + ((100 * p.cents) / total).toFixed(1) + '%').join('；')
  );
  let offset = 0;
  for (const p of parts) {
    const fraction = p.cents / total,
      c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', '60');
    c.setAttribute('cy', '60');
    c.setAttribute('r', '42');
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke', p.color);
    c.setAttribute('stroke-width', '24');
    c.setAttribute('pathLength', '100');
    c.setAttribute('stroke-dasharray', 100 * fraction + ' ' + (100 - 100 * fraction));
    c.setAttribute('stroke-dashoffset', String(-offset));
    c.setAttribute('transform', 'rotate(-90 60 60)');
    svg.append(c);
    offset += 100 * fraction;
    const li = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = p.color;
    li.append(swatch, ' ' + p.name + ' ' + yuan(p.cents) + '（' + Math.round(100 * fraction) + '%）');
    $('assetLegend').append(li);
  }
  $('assetPie').append(svg);
}
