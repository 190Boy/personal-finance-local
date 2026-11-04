// 預算與報表：每月總預算與各分類預算，以及每月支出依分類、收支趨勢的統計。
// 「預算」工作表只新增不修改，每個分類取最新一列；金額 0 代表取消這個分類的預算。
import { moneyCents } from '../pdf-parser/parser.mjs';
import { CATEGORY_TREE, isInternal, mainOf } from './categories.mjs';

export const BUDGET_HEADERS = ['分類', '每月預算（元）', '更新時間'];
export const TOTAL = '總預算';
export const EXPENSE_CATEGORIES = CATEGORY_TREE.支出.map(c => c.name);

export function budgetTable(values) {
  const out = new Map();
  if (!values.length) return out;
  if (JSON.stringify(values[0]) !== JSON.stringify(BUDGET_HEADERS)) throw Error('SHEET_SCHEMA');
  const at = new Map();
  for (const r of values.slice(1)) {
    const name = String(r[0] || ''),
      cents = moneyCents(String(r[1] ?? '')),
      when = String(r[2] || '');
    if (!name || !Number.isSafeInteger(cents) || cents < 0) continue;
    if (!at.has(name) || when >= at.get(name)) {
      at.set(name, when);
      out.set(name, cents);
    }
  }
  for (const [k, v] of out) if (!v) out.delete(k);
  return out;
}
export function budgetRow(name, cents, at = new Date().toISOString()) {
  return [name, cents / 100, at];
}

// Same counting rules as the history totals: no stocks, no transfers between own accounts, card refunds
// reduce spending.
function amounts(r) {
  if (r.kind === '股票股數' || isInternal(r.category)) return null;
  const e = Number(r.expense),
    i = Number(r.income);
  let expense = 0,
    income = 0;
  if (Number.isFinite(e) && (e > 0 || (r.kind === '信用卡' && e < 0))) expense = Math.round(e * 100);
  if (Number.isFinite(i) && i > 0) income = Math.round(i * 100);
  return expense || income ? { expense, income } : null;
}
const monthOf = r => String(r.date || '').slice(0, 7);

export function monthReport(rows, month) {
  const by = new Map();
  let expense = 0,
    income = 0;
  for (const r of rows) {
    if (monthOf(r) !== month) continue;
    const a = amounts(r);
    if (!a) continue;
    expense += a.expense;
    income += a.income;
    if (a.expense) {
      // Income categories on an expense (rare) fall into 其他.
      const main = EXPENSE_CATEGORIES.includes(mainOf(r.category)) ? mainOf(r.category) : '其他';
      by.set(main, (by.get(main) || 0) + a.expense);
    }
  }
  const byCategory = [...by]
    .map(([name, cents]) => ({ name, cents }))
    .filter(c => c.cents > 0)
    .sort((a, b) => b.cents - a.cents);
  return { month, expenseCents: expense, incomeCents: income, byCategory };
}

export function monthsBack(month, count) {
  const out = [];
  let y = +month.slice(0, 4),
    m = +month.slice(5, 7);
  for (let n = 0; n < count; n++) {
    out.unshift(y + '-' + String(m).padStart(2, '0'));
    if (--m === 0) {
      m = 12;
      y--;
    }
  }
  return out;
}
export function trend(rows, month, count = 6) {
  const months = monthsBack(month, count),
    totals = new Map(months.map(m => [m, { month: m, expenseCents: 0, incomeCents: 0 }]));
  for (const r of rows) {
    const t = totals.get(monthOf(r)),
      a = t && amounts(r);
    if (!a) continue;
    t.expenseCents += a.expense;
    t.incomeCents += a.income;
  }
  return [...totals.values()];
}

// Budget progress for a month: the total first, then each budgeted category.
export function budgetStatus(budgets, report) {
  const spent = new Map(report.byCategory.map(c => [c.name, c.cents]));
  const list = [];
  if (budgets.has(TOTAL))
    list.push({ name: TOTAL, budgetCents: budgets.get(TOTAL), spentCents: report.expenseCents });
  for (const name of EXPENSE_CATEGORIES)
    if (budgets.has(name))
      list.push({ name, budgetCents: budgets.get(name), spentCents: spent.get(name) || 0 });
  return list.map(b => ({
    ...b,
    leftCents: b.budgetCents - b.spentCents,
    ratio: b.spentCents / b.budgetCents
  }));
}
