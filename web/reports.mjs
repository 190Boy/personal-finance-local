import { monthReport, trend, budgetStatus, budgetRow, TOTAL, EXPENSE_CATEGORIES } from '../cloud/budget.mjs';
import { iconOf } from '../cloud/categories.mjs';
import { moneyCents } from '../pdf-parser/parser.mjs';
import { localToday } from '../cloud/recurring.mjs';
const $ = id => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const yuan = c => Math.round(c / 100).toLocaleString('zh-TW');
// Each category keeps its own color in every month (color follows the category, not its rank).
const COLORS = {
  餐飲: '#2a78d6',
  交通: '#eb6834',
  日用品: '#1baf7a',
  購物: '#eda100',
  娛樂: '#e87ba4',
  居家: '#008300',
  醫療: '#6250d6',
  人情: '#e34948',
  其他: '#8b8f96'
};
const INCOME = '#2a78d6',
  EXPENSE = '#eb6834';
let cloud = null,
  rows = null,
  budgets = new Map(),
  busy = false;

function el(tag, text, className) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (className) e.className = className;
  return e;
}
function svg(tag, attrs = {}) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
function tip(node, text) {
  node.append(Object.assign(svg('title'), { textContent: text }));
  return node;
}
function showInHistory(month, category) {
  location.hash = '#transactions';
  const m = $('historyMonth'),
    c = $('historyCategory');
  if ([...m.options].some(o => o.value === month)) m.value = month;
  if (category && [...c.options].some(o => o.value === category)) c.value = category;
  c.dispatchEvent(new Event('input', { bubbles: true }));
}

function donut(report) {
  const wrap = el('div', null, 'report-donut');
  const total = report.byCategory.reduce((s, c) => s + c.cents, 0);
  const box = svg('svg', { viewBox: '0 0 200 200', role: 'img', 'aria-label': '本月支出依分類' });
  const R = 80,
    r = 52;
  let angle = -Math.PI / 2;
  const point = (a, rad) =>
    [100 + rad * Math.cos(a), 100 + rad * Math.sin(a)].map(n => n.toFixed(2)).join(' ');
  for (const c of report.byCategory) {
    const share = c.cents / total,
      end = angle + share * Math.PI * 2;
    let shape;
    if (share >= 0.9999)
      shape = svg('circle', { cx: 100, cy: 100, r: (R + r) / 2, fill: 'none', 'stroke-width': R - r });
    else {
      const large = share > 0.5 ? 1 : 0;
      shape = svg('path', {
        d:
          'M' +
          point(angle, R) +
          ' A' +
          R +
          ' ' +
          R +
          ' 0 ' +
          large +
          ' 1 ' +
          point(end, R) +
          ' L' +
          point(end, r) +
          ' A' +
          r +
          ' ' +
          r +
          ' 0 ' +
          large +
          ' 0 ' +
          point(angle, r) +
          ' Z',
        stroke: '#fff',
        'stroke-width': 2
      });
    }
    if (shape.tagName === 'circle') shape.setAttribute('stroke', COLORS[c.name]);
    else shape.setAttribute('fill', COLORS[c.name]);
    shape.classList.add('slice');
    shape.addEventListener('click', () => showInHistory(report.month, c.name));
    box.append(tip(shape, c.name + ' ' + yuan(c.cents) + ' 元（' + Math.round(share * 100) + '%）'));
    angle = end;
  }
  const center = svg('text', { x: 100, y: 96, 'text-anchor': 'middle', class: 'donut-label' });
  center.textContent = '支出';
  const value = svg('text', { x: 100, y: 118, 'text-anchor': 'middle', class: 'donut-value' });
  value.textContent = yuan(total);
  box.append(center, value);
  const legend = el('ul', null, 'report-legend');
  for (const c of report.byCategory) {
    const li = el('li'),
      button = el('button');
    button.type = 'button';
    button.title = '在交易明細查看 ' + c.name;
    const swatch = el('span', null, 'swatch');
    swatch.style.background = COLORS[c.name];
    button.append(
      swatch,
      el('span', iconOf(c.name) + ' ' + c.name, 'name'),
      el('span', Math.round((c.cents / total) * 100) + '%', 'muted'),
      el('strong', yuan(c.cents))
    );
    button.addEventListener('click', () => showInHistory(report.month, c.name));
    li.append(button);
    legend.append(li);
  }
  wrap.append(box, legend);
  return wrap;
}

function bars(list) {
  const W = 320,
    H = 180,
    top = 12,
    bottom = 24,
    left = 4;
  const max = Math.max(1, ...list.flatMap(m => [m.incomeCents, m.expenseCents]));
  const step = (W - left) / list.length,
    bw = Math.min(16, (step - 10) / 2);
  const box = svg('svg', {
    viewBox: '0 0 ' + W + ' ' + H,
    role: 'img',
    'aria-label': '近 ' + list.length + ' 個月收支'
  });
  for (const f of [0.5, 1]) {
    const y = top + (H - top - bottom) * (1 - f);
    box.append(svg('line', { x1: left, x2: W, y1: y, y2: y, class: 'grid' }));
  }
  box.append(svg('line', { x1: left, x2: W, y1: H - bottom, y2: H - bottom, class: 'axis' }));
  list.forEach((m, i) => {
    const cx = left + step * i + step / 2;
    [
      ['收入', m.incomeCents, INCOME, cx - bw - 1],
      ['支出', m.expenseCents, EXPENSE, cx + 1]
    ].forEach(([label, cents, color, x]) => {
      const h = Math.max(0, ((H - top - bottom) * cents) / max);
      if (h > 0) {
        const rr = Math.min(4, h, bw / 2);
        const y = H - bottom - h;
        // Rounded at the data end only, square on the baseline.
        const d =
          'M' +
          x +
          ' ' +
          (H - bottom) +
          ' V' +
          (y + rr) +
          ' Q' +
          x +
          ' ' +
          y +
          ' ' +
          (x + rr) +
          ' ' +
          y +
          ' H' +
          (x + bw - rr) +
          ' Q' +
          (x + bw) +
          ' ' +
          y +
          ' ' +
          (x + bw) +
          ' ' +
          (y + rr) +
          ' V' +
          (H - bottom) +
          ' Z';
        box.append(tip(svg('path', { d, fill: color }), m.month + ' ' + label + ' ' + yuan(cents) + ' 元'));
      }
    });
    // A wide invisible target so a hover anywhere in the month shows both numbers.
    box.append(
      tip(
        svg('rect', { x: left + step * i, y: top, width: step, height: H - top - bottom, class: 'hit' }),
        m.month +
          '　收入 ' +
          yuan(m.incomeCents) +
          '　支出 ' +
          yuan(m.expenseCents) +
          '　結餘 ' +
          yuan(m.incomeCents - m.expenseCents)
      )
    );
    const t = svg('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'tick' });
    t.textContent = +m.month.slice(5) + '月';
    box.append(t);
  });
  const legend = el('p', null, 'report-key');
  for (const [label, color] of [
    ['收入', INCOME],
    ['支出', EXPENSE]
  ]) {
    const s = el('span', null, 'swatch');
    s.style.background = color;
    legend.append(s, el('span', label));
  }
  const table = el('details');
  table.append(el('summary', '看數字'));
  const t = el('table'),
    head = el('tr');
  for (const h of ['月份', '收入', '支出', '結餘']) head.append(el('th', h));
  t.append(head);
  for (const m of [...list].reverse()) {
    const tr = el('tr');
    for (const v of [
      m.month,
      yuan(m.incomeCents),
      yuan(m.expenseCents),
      yuan(m.incomeCents - m.expenseCents)
    ])
      tr.append(el('td', v));
    t.append(tr);
  }
  table.append(t);
  const wrap = el('div', null, 'report-trend');
  wrap.append(legend, box, table);
  return wrap;
}

function budgetBars(list) {
  const wrap = el('div', null, 'budget-list');
  for (const b of list) {
    const row = el('div', null, 'budget-row' + (b.ratio > 1 ? ' over' : b.ratio >= 0.8 ? ' near' : ''));
    const head = el('div', null, 'budget-head');
    head.append(
      el('span', (b.name === TOTAL ? '🎯' : iconOf(b.name)) + ' ' + b.name),
      el('span', yuan(b.spentCents) + ' / ' + yuan(b.budgetCents))
    );
    const track = el('div', null, 'budget-track'),
      fill = el('div', null, 'budget-fill');
    fill.style.width = Math.min(100, b.ratio * 100).toFixed(1) + '%';
    track.append(fill);
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', b.name);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(Math.round(b.ratio * 100)));
    const left =
      b.leftCents >= 0
        ? '還剩 ' + yuan(b.leftCents) + ' 元（已用 ' + Math.round(b.ratio * 100) + '%）'
        : '⚠ 超出 ' + yuan(-b.leftCents) + ' 元';
    row.append(head, track, el('small', left, b.ratio > 1 ? 'bad' : 'muted'));
    wrap.append(row);
  }
  return wrap;
}

function budgetForm() {
  const form = el('form', null, 'budget-form');
  const inputs = [];
  for (const name of [TOTAL, ...EXPENSE_CATEGORIES]) {
    const label = el('label', (name === TOTAL ? '🎯 ' : iconOf(name) + ' ') + name);
    const input = el('input');
    input.inputMode = 'decimal';
    input.placeholder = '不設定';
    input.value = budgets.has(name) ? String(budgets.get(name) / 100) : '';
    input.dataset.name = name;
    label.append(input);
    form.append(label);
    inputs.push(input);
  }
  const save = el('button', '儲存預算');
  save.type = 'submit';
  save.disabled = busy;
  form.append(save);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    const changed = [];
    for (const input of inputs) {
      const text = input.value.trim(),
        cents = text ? moneyCents(text) : 0;
      if (!Number.isSafeInteger(cents) || cents < 0) {
        $('reportsStatus').textContent = input.dataset.name + ' 的預算請填 0 以上的金額，或留空。';
        return;
      }
      if (cents !== (budgets.get(input.dataset.name) || 0))
        changed.push(budgetRow(input.dataset.name, cents));
    }
    if (!changed.length) {
      $('reportsStatus').textContent = '預算沒有變更。';
      return;
    }
    busy = true;
    save.disabled = true;
    $('reportsStatus').textContent = '正在儲存…';
    try {
      await cloud.saveBudgets(changed);
      $('reportsStatus').textContent = '已更新 ' + changed.length + ' 項預算。';
    } catch (error) {
      $('reportsStatus').textContent =
        error.message === 'SYNC_BUSY'
          ? '其他同步正在進行，請稍後重試。'
          : '尚未儲存，請確認已連接 Google 後重試。';
    } finally {
      busy = false;
      save.disabled = false;
    }
  });
  return form;
}

function draw() {
  const body = $('reportsBody');
  body.replaceChildren();
  $('reportsEmpty').hidden = !!rows;
  if (!rows) return;
  const select = $('reportsMonth'),
    current = localToday().slice(0, 7);
  const months = [
    ...new Set([current, ...rows.map(r => String(r.date).slice(0, 7)).filter(m => /^\d{4}-\d{2}$/.test(m))])
  ]
    .sort()
    .reverse();
  const keep = select.value || current;
  select.replaceChildren(...months.map(m => new Option(m.replace('-', ' 年 ') + ' 月', m)));
  select.value = months.includes(keep) ? keep : current;
  const month = select.value,
    report = monthReport(rows, month);

  const totals = el('div', null, 'history-totals');
  for (const [label, cents, cls] of [
    ['支出', report.expenseCents, 'out'],
    ['收入', report.incomeCents, 'in'],
    ['結餘', report.incomeCents - report.expenseCents, 'net']
  ]) {
    const s = el('div', null, 'stat ' + cls);
    s.append(el('small', label), el('strong', yuan(cents)));
    totals.append(s);
  }
  totals.append(el('p', '不含股票與自己帳戶之間的轉帳（繳卡費、儲值、提款）。', 'muted'));
  body.append(totals);

  const budget = el('section', null, 'panel');
  budget.append(el('h2', '預算'));
  const status = budgetStatus(budgets, report);
  if (status.length) budget.append(budgetBars(status));
  else budget.append(el('p', '還沒有設定預算。可以只設總預算，也可以替個別分類設定。', 'muted'));
  const edit = el('details');
  edit.open = !status.length;
  edit.append(el('summary', '設定每月預算'), budgetForm());
  budget.append(edit);
  body.append(budget);

  const pie = el('section', null, 'panel');
  pie.append(el('h2', '支出分類'));
  if (report.byCategory.length) {
    pie.append(donut(report));
    pie.append(el('p', '點分類可以到交易明細看這個月的這類交易。', 'muted'));
  } else pie.append(el('p', '這個月還沒有支出紀錄。', 'muted'));
  body.append(pie);

  const t = el('section', null, 'panel');
  t.append(el('h2', '近 6 個月收支'));
  t.append(bars(trend(rows, month, 6)));
  body.append(t);
}
export function renderReports(list, budgetMap) {
  rows = list || null;
  budgets = budgetMap || new Map();
  if ($('reportsBody')) draw();
}
export function initReports(api) {
  cloud = api;
  $('reportsMonth').addEventListener('change', draw);
  window.addEventListener('finance-signout', () => renderReports(null, new Map()));
  draw();
}
