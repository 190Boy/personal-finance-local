import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatement } from '../pdf-parser/parser.mjs';
// Entirely fabricated amounts/dates/text; only the reported header layout is reproduced.
const item = (str, x, y, w = 4) => ({ str, x: x * 10, y, w: w * 10, h: 10 });
function header(y = 60) {
  return [
    item('交易日期', 9.6, y, 7),
    item('提', 31.4, y, 1.4),
    item('存摺備註', 64.5, y, 7),
    item('摘要', 20.7, y + 12, 3.4),
    item('存', 41.6, y + 12, 1.4),
    item('帳戶餘額', 51.2, y + 12, 7),
    item('轉帳留言', 77.7, y + 12, 7),
    item('財金序號', 87.1, y + 12, 7),
    item('時間', 10.9, y + 24, 3.4),
    item('手續費', 30.2, y + 24, 5),
    item('銀行代號/帳號', 62.9, y + 24, 12)
  ];
}
function row(
  date,
  summary,
  expense,
  income,
  balance,
  y,
  { fee = null, note = '本機測試', time = '12:34:56' } = {}
) {
  return [
    item(date, 8.7, y, 10),
    item(note, 64.5, y, 7),
    item(summary, 18.2, y + 12, 10),
    ...(expense ? [item(expense, 31.1, y + 12, 4)] : []),
    ...(income ? [item(income, 41.6, y + 12, 4)] : []),
    item(balance, 51.5, y + 12, 5),
    item(time, 9.6, y + 24, 7),
    ...(fee !== null ? [item(fee, 31.1, y + 24, 4)] : [])
  ];
}
function pages() {
  return [
    {
      number: 1,
      width: 1000,
      height: 840,
      items: [
        ...header(),
        ...row('*2026/09/04', '連結帳戶交易', '125', null, '9,875', 110),
        ...row('2026/09/03', '股利', null, '500', '10,000', 155)
      ]
    },
    {
      number: 2,
      width: 1000,
      height: 840,
      items: [
        ...header(),
        ...row('2026/09/02', '信用卡繳款', '200', null, '9,500', 110),
        ...row('2026/09/01', '跨行轉帳', '300', null, '9,700', 155)
      ]
    }
  ];
}
const opts = { bank: 'esun', order: 'descending', openingCents: 1000000 };
test('E.SUN stacked headers and rows preserve all fields, notes and descending balance chain', () => {
  const r = parseStatement(pages(), opts);
  assert.equal(r.stats.rows, 4);
  assert.equal(r.validation.fieldChecksPass, true);
  assert.equal(r.balance.complete, true);
  assert.equal(r.headers[0].profile, 'esun-stacked-v1');
  assert.deepEqual(
    r.transactions.map(t => [t.date, t.time, t.expenseCents, t.incomeCents, t.balanceCents]),
    [
      ['2026-09-04', '12:34:56', 12500, 0, 987500],
      ['2026-09-03', '12:34:56', 0, 50000, 1000000],
      ['2026-09-02', '12:34:56', 20000, 0, 950000],
      ['2026-09-01', '12:34:56', 30000, 0, 970000]
    ]
  );
  assert.ok(r.transactions.every(t => t.note === '本機測試'));
});
test('E.SUN header detection follows coordinates, not fixed percentages', () => {
  const p = pages();
  for (const page of p)
    for (const i of page.items) {
      i.x = i.x * 0.8 + 30;
      i.w *= 0.8;
    }
  assert.equal(parseStatement(p, opts).balance.complete, true);
});
test('E.SUN nonzero fee is separate and prevents guessed balance acceptance', () => {
  const p = pages();
  p[0].items.push(item('7', 31.1, 134, 4));
  const r = parseStatement(p, opts);
  assert.equal(r.transactions[0].feeCents, 700);
  assert.equal(r.transactions[0].expenseCents, 12500);
  assert.ok(r.transactions[0].errors.includes('FEE_REQUIRES_REVIEW'));
  assert.equal(r.balance.complete, false);
});
test('E.SUN explicit zero fee does not replace main withdrawal', () => {
  const p = pages();
  p[0].items.push(item('0', 31.1, 134, 4));
  const r = parseStatement(p, opts);
  assert.equal(r.transactions[0].feeCents, 0);
  assert.equal(r.balance.complete, true);
});
test('E.SUN unknown fee text remains a blocking issue', () => {
  const p = pages();
  p[0].items.push(item('不明', 31.1, 134, 4));
  const r = parseStatement(p, opts);
  assert.equal(r.transactions[0].feeCents, null);
  assert.ok(r.transactions[0].errors.includes('FEE_REQUIRES_REVIEW'));
});
test('E.SUN missing balance remains unknown instead of inferred', () => {
  const p = pages();
  p[0].items = p[0].items.filter(i => i.str !== '9,875');
  const r = parseStatement(p, opts);
  assert.equal(r.transactions[0].balanceCents, null);
  assert.equal(r.balance.complete, false);
});
test('E.SUN page without repeated header inherits the established layout', () => {
  const p = pages();
  p[1].items = p[1].items.filter(i => i.y > 84);
  assert.equal(parseStatement(p, opts).balance.complete, true);
});
test('E.SUN wrong order stays visible and is never silently sorted', () => {
  const r = parseStatement(pages(), { ...opts, order: 'ascending' });
  assert.ok(r.issues.some(i => i.code === 'ORDER_MISMATCH'));
  assert.equal(r.balance.complete, false);
});
test('unmapped rows keep unknown flow amounts and do not create bogus duplicate matches', () => {
  const p = [
    { number: 1, width: 1000, items: [item('2026/09/01', 9, 10, 10), item('2026/09/01', 9, 50, 10)] }
  ];
  const r = parseStatement(p, { bank: 'esun' });
  assert.ok(r.transactions.every(t => t.expenseCents === null && t.incomeCents === null));
  assert.ok(r.transactions.every(t => !t.errors.includes('DUPLICATE_CANDIDATE')));
});
