// 一列式清單：左邊分類圓形圖示、中間兩行字、右邊金額；依日期分組，組標題寫當天合計。
import { iconOf, mainOf } from '../cloud/categories.mjs';

// Each main category keeps one color everywhere (rows, charts).
export const CATEGORY_COLORS = {
  餐飲: '#2a78d6',
  交通: '#eb6834',
  日用品: '#1baf7a',
  購物: '#eda100',
  娛樂: '#e87ba4',
  居家: '#008300',
  醫療: '#6250d6',
  人情: '#e34948',
  其他: '#8b8f96',
  薪資: '#2a78d6',
  投資: '#eb6834',
  其他收入: '#1baf7a',
  內部轉帳: '#8b8f96'
};
export const colorOf = category => CATEGORY_COLORS[mainOf(category)] || '#8b8f96';
export const yuan = c => Math.round(Math.abs(c) / 100).toLocaleString('zh-TW');
// Expense shows as −190, income as +1,000.
export const signed = c => (c < 0 ? '−' : c > 0 ? '+' : '') + yuan(c);
const WEEK = '日一二三四五六';
export const weekday = date => {
  const d = new Date(String(date) + 'T00:00:00');
  return Number.isFinite(d.valueOf()) ? '週' + WEEK[d.getDay()] : '';
};

function el(tag, text, className) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (className) e.className = className;
  return e;
}
export function iconBadge(category, icon, tint) {
  const b = el('span', icon || iconOf(category), 'row-icon');
  b.style.setProperty('--tint', tint || colorOf(category));
  b.setAttribute('aria-hidden', 'true');
  return b;
}
// cents: negative = money out, positive = money in, null = no amount (e.g. stock shares; pass side text).
export function row({ category, icon, tint, title, sub, cents, amountText, side, onClick, dim = false }) {
  const r = el(onClick ? 'button' : 'div', null, 'row' + (dim ? ' dim' : ''));
  if (onClick) {
    r.type = 'button';
    r.addEventListener('click', onClick);
  }
  const main = el('span', null, 'row-main');
  main.append(el('span', title || '—', 'row-title'));
  if (sub) main.append(el('span', sub, 'row-sub'));
  const right = el('span', null, 'row-side');
  const amount = el(
    'span',
    amountText ?? (cents == null ? '' : signed(cents)),
    'row-amount' + (cents < 0 ? ' out' : cents > 0 ? ' in' : '') + (dim ? ' dim' : '')
  );
  right.append(amount);
  if (side) right.append(el('span', side, 'row-sub'));
  r.append(iconBadge(category, icon, tint), main, right);
  return r;
}
export function dayHeader(date, cents) {
  const h = el('div', null, 'day-head');
  h.append(el('span', String(date).replaceAll('-', '/') + ' ' + weekday(date)));
  if (cents != null) h.append(el('span', signed(cents), cents < 0 ? 'out' : cents > 0 ? 'in' : ''));
  return h;
}
// Group items that are already sorted newest first; net(item) gives the signed cents counted in the day total.
export function groupByDay(items, dateOf, net) {
  const groups = [];
  for (const it of items) {
    const d = dateOf(it);
    let g = groups[groups.length - 1];
    if (!g || g.date !== d) groups.push((g = { date: d, items: [], cents: 0 }));
    g.items.push(it);
    g.cents += net(it) || 0;
  }
  return groups;
}
