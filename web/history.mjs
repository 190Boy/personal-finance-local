import { filterHistory } from '../cloud/history.mjs';
import { CATEGORY_TREE, MAIN_CATEGORIES, iconOf, isInternal, monthTotals } from '../cloud/categories.mjs';
import { decisionRow } from '../cloud/matching.mjs';
import { hash } from '../cloud/records.mjs';
const $ = id => document.getElementById(id);
let data = null,
  limit = 100,
  cloud = null,
  busy = false;
const yuan = c => (c / 100).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
export function setHistoryCloud(api) {
  cloud = api;
}
const shownNumber = v =>
  v === '' || v == null
    ? '—'
    : Number.isFinite(Number(v))
      ? Number(v).toLocaleString('zh-TW', { maximumFractionDigits: 6 })
      : String(v);
export function clearHistory() {
  data = null;
  limit = 100;
  $('historyRows').replaceChildren();
  $('historyCards').replaceChildren();
  $('historyAccount').replaceChildren(new Option('全部帳戶', ''));
  $('historyQuery').value = '';
  $('historyFrom').value = '';
  $('historyTo').value = '';
  $('historyKind').value = '';
  $('historyMonth').replaceChildren(new Option('全部月份', ''));
  $('historyCategory').value = '';
  $('historyTotals').hidden = true;
  $('historyCount').textContent = '尚未載入歷史交易。';
  $('historyEmpty').hidden = false;
  $('historyEmpty').textContent = '請點上方按鈕連接 Google 並載入。';
  $('historyFilters').open = false;
  $('historyMore').hidden = true;
}
export function renderHistory(result) {
  data = result;
  limit = 100;
  $('historyNotice').textContent = (result.warnings || []).join('；');
  const chosen = $('historyAccount').value;
  const accounts = new Map();
  for (const r of result.rows)
    accounts.set(JSON.stringify([r.source, r.account]), r.source + '／' + r.account);
  $('historyAccount').replaceChildren(new Option('全部帳戶', ''));
  for (const [key, label] of accounts) $('historyAccount').append(new Option(label, key));
  if (accounts.has(chosen)) $('historyAccount').value = chosen;
  // Months newest first; open on the newest month the first time data arrives.
  const month = $('historyMonth').value,
    months = [
      ...new Set(result.rows.map(r => String(r.date).slice(0, 7)).filter(m => /^\d{4}-\d{2}$/.test(m)))
    ]
      .sort()
      .reverse();
  const first = $('historyMonth').options.length <= 1;
  $('historyMonth').replaceChildren(
    new Option('全部月份', ''),
    ...months.map(m => new Option(m.replace('-', ' 年 ') + ' 月', m))
  );
  $('historyMonth').value = months.includes(month) ? month : first && months.length ? months[0] : '';
  draw();
}
function draw() {
  if (!data) return;
  const rows = filterHistory(data.rows, {
    month: $('historyMonth').value,
    category: $('historyCategory').value,
    kind: $('historyKind').value,
    account: $('historyAccount').value,
    query: $('historyQuery').value,
    from: $('historyFrom').value,
    to: $('historyTo').value
  });
  const validRange =
    !$('historyFrom').value || !$('historyTo').value || $('historyFrom').value <= $('historyTo').value;
  $('historyCount').textContent =
    (validRange
      ? '已載入 ' +
        data.rows.length +
        ' 筆｜符合 ' +
        rows.length +
        ' 筆｜顯示 ' +
        Math.min(limit, rows.length) +
        ' 筆。'
      : '起始日期不可晚於結束日期。') +
    (data.duplicates ? ' 已合併顯示 ' + data.duplicates + ' 個重複列。' : '');
  const totals = monthTotals(rows);
  $('historyTotals').hidden = false;
  $('historyTotals').replaceChildren(
    ...[
      ['支出', totals.expenseCents, 'out'],
      ['收入', totals.incomeCents, 'in'],
      ['結餘', totals.incomeCents - totals.expenseCents, 'net']
    ].map(([label, cents, cls]) => {
      const box = document.createElement('div');
      box.className = 'stat ' + cls;
      box.append(Object.assign(document.createElement('small'), { textContent: label }));
      box.append(Object.assign(document.createElement('strong'), { textContent: yuan(cents) }));
      return box;
    }),
    Object.assign(document.createElement('p'), {
      className: 'muted',
      textContent: '合計不含內部轉帳（繳卡費、儲值、提款、買股票）與股票股數。'
    })
  );
  $('historyRows').replaceChildren();
  $('historyCards').replaceChildren();
  $('historyEmpty').hidden = rows.length > 0;
  $('historyEmpty').textContent = data.rows.length
    ? '沒有符合目前篩選的交易，可展開篩選並清除。'
    : '此試算表尚無已儲存的銀行、股票或信用卡交易；可先確認 Google 帳戶與原本的試算表。';
  for (const r of rows.slice(0, limit)) {
    const tr = document.createElement('tr'),
      stock = r.kind === '股票股數',
      credit = r.kind === '信用卡';
    const values = [
      r.kind + (r.category ? '／' + r.category : ''),
      r.source,
      r.account,
      r.date || '日期待核對',
      r.time || '—',
      r.summary + (credit ? '（' + r.cardKind + '；帳單金額 ' + shownNumber(r.cardAmount) + ' 元）' : ''),
      shownNumber(r.expense),
      shownNumber(r.income),
      stock || credit ? '不適用' : shownNumber(r.fee),
      shownNumber(r.balance),
      stock ? '股' : '元',
      (r.conflict ? '相同 ID 內容衝突，全部保留／' : '') + (r.review || '未提供核對結果')
    ];
    for (const v of values) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(td);
    }
    if (r.conflict) tr.className = 'bad';
    $('historyRows').append(tr);
    const card = document.createElement('article');
    card.className = 'history-card';
    const title = document.createElement('h3');
    title.textContent = r.summary || '摘要待核對';
    const meta = document.createElement('p');
    meta.className = 'muted';
    meta.textContent = r.date + ' ' + r.time + ' · ' + r.source + '／' + r.account + ' · ' + r.kind;
    card.append(meta, title);
    if (r.category) card.append(categoryChip(r));
    if (isInternal(r.category)) card.classList.add('internal');
    const dl = document.createElement('dl');
    for (const [label, value] of credit
      ? [
          ['帳單明細金額', r.cardAmount],
          ['支出（退款為負數）', r.expense]
        ]
      : [
          [stock ? '提出股數' : '支出', r.expense],
          [stock ? '存入股數' : '收入', r.income],
          [stock ? '結存股數' : '餘額', r.balance],
          ...(stock ? [] : [['手續費', r.fee]])
        ]) {
      const block = document.createElement('div'),
        dt = document.createElement('dt'),
        dd = document.createElement('dd');
      dt.textContent = label;
      dd.textContent = shownNumber(value) + (stock ? ' 股' : ' 元');
      block.append(dt, dd);
      dl.append(block);
    }
    card.append(dl);
    const review = document.createElement('p');
    review.className = 'review' + (r.conflict ? ' bad' : ' muted');
    review.textContent = values[11];
    card.append(review);
    if (r.match) card.append(...matchBlock(r.match));
    $('historyCards').append(card);
  }
  if (data.warnings?.length)
    $('historyCount').textContent =
      '部分來源未載入。' + $('historyCount').textContent + ' ' + data.warnings.join('；');
  $('historyMore').hidden = rows.length <= limit;
}
export function initHistory() {
  for (const group of Object.entries(CATEGORY_TREE)) {
    const og = document.createElement('optgroup');
    og.label = group[0];
    for (const c of group[1]) og.append(new Option(c.icon + ' ' + c.name, c.name));
    $('historyCategory').append(og);
  }
  for (const id of [
    'historyMonth',
    'historyCategory',
    'historyKind',
    'historyAccount',
    'historyQuery',
    'historyFrom',
    'historyTo'
  ])
    $(id).addEventListener('input', () => {
      limit = 100;
      draw();
    });
  $('historyMore').addEventListener('click', () => {
    limit += 100;
    draw();
  });
  $('historyReset').addEventListener('click', () => {
    for (const id of [
      'historyCategory',
      'historyKind',
      'historyAccount',
      'historyQuery',
      'historyFrom',
      'historyTo'
    ])
      $(id).value = '';
    limit = 100;
    draw();
  });
  clearHistory();
}

// A matched invoice shows what the line on the statement actually bought.
function matchBlock(match) {
  const note = document.createElement('p');
  note.className = 'muted';
  if (!match.invoice) {
    note.textContent = match.state === '儲值' ? '已標記為儲值，不算支出。' : '已標記為沒有發票的消費。';
    return [note];
  }
  const inv = match.invoice,
    list = document.createElement('ul');
  list.className = 'invoice-items';
  for (const item of inv.items) {
    const li = document.createElement('li'),
      name = document.createElement('span'),
      amount = document.createElement('span');
    if (item.amountCents < 0) li.className = 'discount';
    name.textContent = item.name + (item.quantity && item.quantity !== '1' ? ' ×' + item.quantity : '');
    amount.textContent = Number.isSafeInteger(item.amountCents)
      ? (item.amountCents / 100).toLocaleString('zh-TW')
      : '—';
    li.append(name, amount);
    list.append(li);
  }
  const platform = /優食台灣|優步福爾摩沙/.test(inv.sellerName);
  note.textContent =
    '發票：' +
    inv.sellerName +
    ' · ' +
    (match.state === 'auto' ? '金額、日期相符自動配對' : '已確認配對') +
    (platform
      ? ' · 發票只含平台費，餐點或車資另計'
      : match.extraCents > 0
        ? ' · 刷卡比發票多 ' +
          (match.extraCents / 100).toLocaleString('zh-TW') +
          ' 元（沒開進發票的小額，例如塑膠袋）'
        : '');
  return [list, note];
}

// The category shows as a chip; tapping it offers the whole tree. Hand-entered records are changed on their
// own page, so only imported records get the picker.
function categoryChip(r) {
  const wrap = document.createElement('div');
  wrap.className = 'category-line';
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'category-chip' + (r.categorySource === '自動' ? ' auto' : '');
  chip.textContent = iconOf(r.category) + ' ' + r.category + (r.categorySource === '自動' ? '（自動）' : '');
  wrap.append(chip);
  if (r.kind === '手動記帳' || !r.recordKey || !cloud) {
    chip.disabled = true;
    return wrap;
  }
  chip.addEventListener('click', () => {
    if (wrap.querySelector('select')) return;
    const select = document.createElement('select');
    select.setAttribute('aria-label', '改分類');
    for (const [group, list] of Object.entries(CATEGORY_TREE)) {
      const og = document.createElement('optgroup');
      og.label = group;
      for (const c of list)
        for (const sub of [null, ...c.subs])
          og.append(
            new Option((sub ? '　' : c.icon + ' ') + (sub || c.name), sub ? c.name + '／' + sub : c.name)
          );
      select.append(og);
    }
    if (r.categorySource !== '自動') select.append(new Option('↩ 恢復自動分類', '__auto'));
    select.value = [...select.options].some(o => o.value === r.category) ? r.category : MAIN_CATEGORIES[0];
    select.addEventListener('change', async () => {
      if (busy) return;
      busy = true;
      select.disabled = true;
      try {
        const auto = select.value === '__auto';
        await cloud.saveDecisions([
          await decisionRow(hash, {
            type: '分類',
            target: 'cat:' + r.recordKey,
            action: auto ? '撤銷' : '分類',
            method: auto ? '' : select.value
          })
        ]);
      } catch {
        $('historyNotice').textContent = '分類尚未儲存，請確認已連接 Google 後重試。';
        select.disabled = false;
      } finally {
        busy = false;
      }
    });
    wrap.append(select);
    select.focus();
  });
  return wrap;
}
