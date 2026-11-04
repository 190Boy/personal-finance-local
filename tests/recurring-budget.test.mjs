import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECURRING_HEADERS,
  recurringItem,
  recurringRow,
  recurringTable,
  dueEntries,
  dueDate,
  nextDue
} from '../cloud/recurring.mjs';
import {
  BUDGET_HEADERS,
  budgetTable,
  budgetRow,
  monthReport,
  trend,
  budgetStatus,
  TOTAL
} from '../cloud/budget.mjs';
import { manualRow, manualHistoryRow } from '../cloud/manual.mjs';

const rent = recurringItem({
  id: 'r1',
  name: '房租',
  type: '支出',
  amount: '12000',
  method: '玉山銀行／玉山銀行帳戶',
  category: '居家／房租',
  day: 5,
  start: '2026-09'
});
const netflix = recurringItem({
  id: 'n1',
  name: 'Netflix',
  type: '支出',
  amount: '390',
  method: '中國信託／中信信用卡',
  category: '娛樂／訂閱',
  day: 31,
  start: '2026-10',
  end: '2026-12'
});

test('fixed items are validated like hand entries', () => {
  assert.throws(() => recurringItem({ ...rent, amount: '12000', name: '' }), /RECURRING_NAME/);
  assert.throws(
    () => recurringItem({ id: 'x', name: 'x', amount: '1', method: '現金', day: 32, start: '2026-01' }),
    /RECURRING_DAY/
  );
  assert.throws(
    () => recurringItem({ id: 'x', name: 'x', amount: '1', method: '現金', day: 1, start: '2026-13' }),
    /RECURRING_START/
  );
  assert.throws(
    () =>
      recurringItem({
        id: 'x',
        name: 'x',
        amount: '1',
        method: '現金',
        day: 1,
        start: '2026-05',
        end: '2026-04'
      }),
    /RECURRING_END/
  );
  assert.throws(
    () => recurringItem({ id: 'x', name: 'x', amount: '0', method: '現金', day: 1, start: '2026-05' }),
    /MANUAL_AMOUNT/
  );
});

test('the sheet keeps the latest row per item and drops deleted ones', () => {
  const values = [
    RECURRING_HEADERS,
    recurringRow(rent, { at: '2026-09-01T00:00:00Z' }),
    recurringRow({ ...rent, amountCents: 1250000 }, { at: '2026-10-01T00:00:00Z' }),
    recurringRow(netflix, { at: '2026-10-01T00:00:00Z' }),
    recurringRow(netflix, { deleted: true, at: '2026-10-02T00:00:00Z' })
  ];
  const list = recurringTable(values);
  assert.deepEqual(
    list.map(i => [i.name, i.amountCents]),
    [['房租', 1250000]]
  );
  assert.throws(() => recurringTable([['x']]), /SHEET_SCHEMA/);
});

test('due months become hand entries once, the 31st falls on the last day of short months', () => {
  assert.equal(dueDate(netflix, '2026-11'), '2026-11-30');
  assert.equal(dueDate(netflix, '2027-02'), '2027-02-28');
  const due = dueEntries([rent, netflix], new Set(), '2026-11-04');
  assert.deepEqual(
    due.map(e => [e.id, e.date, e.amountCents]),
    [
      ['rec-r1-2026-09', '2026-09-05', 1200000],
      ['rec-r1-2026-10', '2026-10-05', 1200000],
      ['rec-n1-2026-10', '2026-10-31', 39000]
    ]
  );
  assert.equal(due[0].note, '固定收支：房租');
  assert.equal(due[0].category, '居家／房租');
  // Already written (or written and then deleted) months are not created again.
  const again = dueEntries([rent, netflix], new Set(due.map(e => e.id)), '2026-11-05');
  assert.deepEqual(
    again.map(e => e.id),
    ['rec-r1-2026-11']
  );
  // Past the end month nothing more is created.
  assert.equal(dueEntries([netflix], new Set(), '2027-03-31').length, 3);
  assert.equal(nextDue(rent, '2026-11-04'), '2026-11-05');
  assert.equal(nextDue(rent, '2026-11-05'), '2026-12-05');
  assert.equal(nextDue(netflix, '2026-12-31'), '');
  // A generated entry survives the sheet round trip.
  assert.equal(manualRow(due[0])[0], 'rec-r1-2026-09');
});

const row = (kind, date, expense, income, category) => ({ kind, date, expense, income, category });
const rows = [
  row('信用卡', '2026-11-01', 300, null, '餐飲／午餐'),
  row('信用卡', '2026-11-02', -50, null, '餐飲／午餐'),
  row('銀行存款', '2026-11-03', 12000, null, '居家／房租'),
  row('銀行存款', '2026-11-03', 20000, null, '內部轉帳／繳卡費'),
  row('銀行存款', '2026-11-04', null, 50000, '薪資／薪水'),
  row('手動記帳', '2026-11-04', 80, null, '交通／計程車'),
  row('股票股數', '2026-11-04', 1000, null, ''),
  row('銀行存款', '2026-10-05', 12000, null, '居家／房租'),
  row('信用卡', '2026-09-10', 999, null, '收到轉帳')
];

test('a month report groups spending by main category without transfers, stocks or refunds counted twice', () => {
  const r = monthReport(rows, '2026-11');
  assert.equal(r.expenseCents, 30000 - 5000 + 1200000 + 8000);
  assert.equal(r.incomeCents, 5000000);
  assert.deepEqual(
    r.byCategory.map(c => [c.name, c.cents]),
    [
      ['居家', 1200000],
      ['餐飲', 25000],
      ['交通', 8000]
    ]
  );
  // An odd category on an expense is counted as 其他.
  assert.deepEqual(monthReport(rows, '2026-09').byCategory, [{ name: '其他', cents: 99900 }]);
  const t = trend(rows, '2026-11', 3);
  assert.deepEqual(
    t.map(m => [m.month, m.expenseCents, m.incomeCents]),
    [
      ['2026-09', 99900, 0],
      ['2026-10', 1200000, 0],
      ['2026-11', 1233000, 5000000]
    ]
  );
  assert.deepEqual(
    trend([], '2026-02', 3).map(m => m.month),
    ['2025-12', '2026-01', '2026-02']
  );
});

test('budgets keep the latest amount per category; zero removes one', () => {
  const b = budgetTable([
    BUDGET_HEADERS,
    budgetRow(TOTAL, 2000000, '2026-11-01T00:00:00Z'),
    budgetRow('餐飲', 600000, '2026-11-01T00:00:00Z'),
    budgetRow('交通', 100000, '2026-11-01T00:00:00Z'),
    budgetRow('交通', 0, '2026-11-02T00:00:00Z'),
    budgetRow('居家', 1000000, '2026-11-01T00:00:00Z')
  ]);
  assert.deepEqual([...b.keys()], [TOTAL, '餐飲', '居家']);
  const s = budgetStatus(b, monthReport(rows, '2026-11'));
  assert.deepEqual(
    s.map(x => [x.name, x.spentCents, x.leftCents]),
    [
      [TOTAL, 1233000, 767000],
      ['餐飲', 25000, 575000],
      ['居家', 1200000, -200000]
    ]
  );
  assert.ok(s[2].ratio > 1);
});

test('a generated entry shows in the history with its category', () => {
  const [e] = dueEntries([rent], new Set(), '2026-09-05');
  const h = manualHistoryRow(e, 0);
  assert.deepEqual([h.date, h.expense, h.category], ['2026-09-05', 12000, '居家／房租']);
});
