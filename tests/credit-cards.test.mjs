import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvText, readCardCsv, parseCardBook } from '../pdf-parser/credit-cards.mjs';
import {
  makeCardImport,
  cardMeta,
  cardRowsToAppend,
  confirmedCardSummary as cardSummary,
  cardHistory,
  CARD_HEADERS
} from '../cloud/credit-cards.mjs';
const headers = [
  '消費日',
  '入帳起息日',
  '摘要',
  '幣別',
  '消費地金額',
  '外幣折算日',
  '消費地',
  '末四碼',
  '新臺幣金額'
];
const row = (summary, amount) => ['2026/09/02', '2026/09/03', summary, '', '', '', '', '9999', amount];
const book = rows => ({
  sheets: [{ name: '合成資料', rows: rows.map((cells, i) => ({ cells, raw: cells, line: i + 1 })) }]
});
const parse = rows =>
  parseCardBook(book([['帳單明細查詢'], ['資料時間：2026/10/21 00:00:00'], headers, ...rows]), {
    bank: 'ctbc'
  });
const options = {
  account: '測試信用卡',
  fileHash: 'synthetic',
  month: '2026-09',
  billKind: '已出帳',
  closing: '2026-09-20',
  due: '2026-10-05',
  total: '1000',
  paid: '100',
  paidAsOf: '2026-09-22',
  confirmed: true
};
test('CSV handles quoted commas, line breaks, BOM and rejects malformed quotes', () => {
  const r = parseCsvText('﻿a,"b,c","d\ne"\r\n');
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].cells, ['a', 'b,c', 'd\ne']);
  assert.throws(() => parseCsvText('a,"b'), /CSV_QUOTES/);
  assert.throws(() => parseCsvText('"a"b'), /CSV_QUOTES/);
});
test('UTF8 CSV decode works without network and rejects empty or oversize files', async () => {
  const b = await readCardCsv(
    new File([headers.join(',') + '\n' + row('合成消費', '100').join(',')], 'synthetic.csv')
  );
  assert.equal(b.encoding, 'UTF-8');
  assert.equal(parseCardBook(b, { bank: 'ctbc' }).transactions.length, 1);
  await assert.rejects(readCardCsv(new File([], 'empty.csv')), /EMPTY_FILE/);
});
test('CTBC download timestamp is not billing month; payment/refund are signed and unknown negative retained', () => {
  const p = parse([
    row('合成消費', '100'),
    row('自動扣繳', '-200'),
    row('退貨', '-10'),
    row('用途不明', '-3'),
    row('分期 1/3', '40'),
    row('年費', '20')
  ]);
  assert.equal(p.meta.month, '');
  assert.equal(p.meta.sourceTotalCents, null);
  assert.deepEqual(
    p.transactions.map(t => t.kind),
    ['消費', '繳款', '退款', '待核對', '分期當期', '費用']
  );
  assert.equal(p.transactions.length, 6);
  assert.ok(p.transactions[3].errors.length);
  assert.ok(p.issues.length);
  assert.ok(!JSON.stringify(p).includes('9999'));
});
test('KGI exact headers, Excel serial dates, metadata and source total control', () => {
  const h = ['月份', '特店名稱', '消費日期', '消費金額', '卡號末四碼', '消費地', '入帳日期', '消費幣別'];
  const p = parseCardBook(
    book([
      ['9月份帳單'],
      ['NTD 300'],
      ['最低應繳金額', 'NTD 30'],
      ['最近結帳日', '2026/09/20'],
      ['繳費截止日(遇假日順延)', '2026/10/05'],
      h,
      ['9', '虛構商店', 46267, 'NTD 300', '9999', '', 46268, '-']
    ]),
    { bank: 'kgi' }
  );
  assert.equal(p.transactions.length, 1);
  assert.ok(p.transactions[0].date);
  assert.equal(p.meta.month, '2026-09');
  assert.equal(p.meta.minimumCents, 3000);
  assert.equal(p.sourceTotalMatches, true);
  assert.ok(!JSON.stringify(p).includes('9999'));
});
test('formula, invalid date/amount and mismatched direction are retained for review', () => {
  const b = book([headers, row('退款', '10'), row('錯誤', 'bad')]);
  b.sheets[0].rows[2].cells[0] = 'bad';
  b.sheets[0].rows[2].formulaColumns = [8];
  const p = parseCardBook(b, { bank: 'ctbc' });
  assert.equal(p.transactions.length, 2);
  assert.ok(p.transactions.every(t => t.errors.length));
  assert.equal(p.detailNetCents, null);
});
test('debt requires explicitly confirmed metadata; never inferred from detail sums or payment lines', async () => {
  const p = parse([row('消費', '100'), row('扣繳', '-90')]);
  assert.throws(() => cardMeta({ ...options, paid: '' }), /CARD_META/);
  assert.throws(() => cardMeta({ ...options, paid: '1001' }), /CARD_META/);
  assert.throws(() => cardMeta({ ...options, due: '2026-99-99' }), /CARD_META/);
  assert.throws(() => cardMeta({ ...options, billKind: '未出帳' }), /CARD_META/);
  const pending = await makeCardImport(p, { account: '測試信用卡', fileHash: 'A', month: '2026-09' });
  assert.equal(cardSummary(pending.rows).accounts.length, 0);
  const b = await makeCardImport(p, options);
  assert.equal(cardSummary(b.rows).totalCents, 90000);
  assert.equal(b.rows[0].length, CARD_HEADERS.length);
  assert.equal(b.log[3], '信用卡');
});
test('same transactions across overlapping files dedup; equal same-day transactions retain occurrence count', async () => {
  const p = parse([row('消費', '100'), row('消費', '100')]),
    a = await makeCardImport(p, options),
    b = await makeCardImport(p, { ...options, fileHash: 'different' });
  assert.notEqual(a.rows[1][1], a.rows[2][1]);
  assert.equal(cardRowsToAppend(a.rows, b.rows).length, 0);
  assert.equal(cardHistory(a.rows).rows.length, 2);
  const conflict = structuredClone(b.rows);
  conflict[1][12] = '費用';
  assert.equal(cardRowsToAppend(a.rows, conflict).length, 1);
  assert.ok(cardRowsToAppend(a.rows, conflict)[0][17].includes('衝突'));
});
test('refund reduces expense; repayments and unknown amounts never become expenses or income', async () => {
  const b = await makeCardImport(
      parse([
        row('消費', '100'),
        row('扣繳', '-200'),
        row('退款', '-10'),
        row('未知', '-2'),
        row('退款', '20')
      ]),
      options
    ),
    h = cardHistory(b.rows);
  assert.deepEqual(
    h.rows.map(t => t.expense),
    [100, null, -10, null, null]
  );
  assert.ok(h.rows.every(t => t.income === null && t.balance === null));
});
test('newer bill replaces older outstanding; never sums all months and recognizes confirmed zero', async () => {
  const p = parse([row('消費', '100')]);
  const old = await makeCardImport(p, options),
    next = await makeCardImport(p, {
      ...options,
      month: '2026-10',
      closing: '2026-10-20',
      due: '2026-11-05',
      paidAsOf: '2026-10-22',
      total: '500',
      paid: '500'
    });
  assert.equal(cardSummary([...next.rows, ...old.rows]).totalCents, 0);
  assert.equal(cardSummary([...next.rows, ...old.rows]).accounts[0].month, '2026-10');
  const unconfirmed = await makeCardImport(p, { ...options, month: '2026-11', confirmed: false });
  assert.equal(cardSummary([...old.rows, ...unconfirmed.rows]).accounts.length, 0);
});

test('edited invalid bill dates never become a verified debt', async () => {
  const b = await makeCardImport(parse([row('消費', '100')]), options);
  b.rows[0][7] = 'bad';
  assert.equal(cardSummary(b.rows).accounts.length, 0);
});

test('incomplete records from different files are preserved instead of guessed as duplicates', async () => {
  const p = parse([row('資料缺漏', 'bad')]);
  p.transactions[0].date = '';
  const a = await makeCardImport(p, options),
    b = await makeCardImport(p, { ...options, fileHash: 'another' });
  assert.notEqual(a.rows[1][1], b.rows[1][1]);
  assert.equal(cardRowsToAppend(a.rows, b.rows).filter(r => r[0] === '明細').length, 1);
});

// 中信「未出帳單明細」: fabricated rows in the same layout as the bank's export.
import { splitCardLocation } from '../pdf-parser/credit-cards.mjs';
const UNBILLED = [
  '未出帳單明細',
  '資料時間：2026/10/29 15:48:09,單位：元',
  '',
  '交易序號,消費日,入帳日,摘要,卡號末四碼,新臺幣金額',
  ',2026/10/23,2026/10/27,"本行扣繳　　　　　　　   ",,"-4,809"',
  '1,2026/10/26,2026/10/28,連加＊虛構披薩店           Taipei       TW,9999,"1,254"',
  '2,2026/10/19,2026/10/22,連支＊統一超商           Taipei       TW,9999,39',
  '3,2026/10/19,2026/10/22,連支＊統一超商           Taipei       TW,9999,39',
  '4,2026/10/12,2026/10/16,連加＊肯德基 KFC         Taipei       TW,9999,77'
].join('\r\n');
const unbilledBook = () => ({ sheets: [{ name: 'CSV', rows: parseCsvText(UNBILLED) }], encoding: 'Big5' });
test('中信未出帳明細 is recognised and the padded location is split off the summary', () => {
  const p = parseCardBook(unbilledBook(), { bank: 'ctbc' });
  assert.equal(p.unbilled, true);
  assert.equal(p.exportedAt, '2026/10/29 15:48:09');
  assert.deepEqual(
    p.transactions.map(t => [t.date, t.postingDate, t.summary, t.amountCents, t.kind]),
    [
      ['2026-10-23', '2026-10-27', '本行扣繳', -480900, '繳款'],
      ['2026-10-26', '2026-10-28', '連加*虛構披薩店', 125400, '消費'],
      ['2026-10-19', '2026-10-22', '連支*統一超商', 3900, '消費'],
      ['2026-10-19', '2026-10-22', '連支*統一超商', 3900, '消費'],
      ['2026-10-12', '2026-10-16', '連加*肯德基 KFC', 7700, '消費']
    ]
  );
  assert.ok(p.transactions.every(t => !t.errors.length));
  assert.throws(() => parseCardBook(unbilledBook(), { bank: 'kgi' }), /CARD_HEADER/);
});
test('location splitting keeps single spaces inside shop names', () => {
  assert.deepEqual(splitCardLocation('連加*肯德基 KFC         Taipei       TW'), {
    summary: '連加*肯德基 KFC',
    location: 'Taipei TW'
  });
  assert.deepEqual(splitCardLocation('連支*麥當勞'), { summary: '連支*麥當勞', location: '' });
  assert.deepEqual(splitCardLocation('OPENAI SAN FRANCISCO US'), {
    summary: 'OPENAI SAN FRANCISCO US',
    location: ''
  });
});
test('the same transactions from the unbilled export and the later billed export de-duplicate', async () => {
  const unbilled = parseCardBook(unbilledBook(), { bank: 'ctbc' });
  const billed = parse([
    ['2026/10/19', '2026/10/22', '連支＊統一超商', '', '', '', 'Taipei TW', '9999', '39'],
    ['2026/10/19', '2026/10/22', '連支＊統一超商', '', '', '', 'Taipei TW', '9999', '39'],
    ['2026/10/26', '2026/10/28', '連加＊虛構披薩店', '', '', '', 'Taipei TW', '9999', '1,254'],
    ['2026/10/30', '2026/11/02', '連支＊統一超商', '', '', '', 'Taipei TW', '9999', '45']
  ]);
  const opts = { account: '中信信用卡', month: '2026-11' };
  const first = await makeCardImport(unbilled, { ...opts, fileHash: 'unbilled', billKind: '未出帳' });
  const second = await makeCardImport(billed, { ...opts, fileHash: 'billed', billKind: '已出帳' });
  const fresh = cardRowsToAppend(first.rows, second.rows).filter(r => r[0] === '明細');
  assert.deepEqual(
    fresh.map(r => [r[8], r[10], r[11]]),
    [['2026-10-30', '連支*統一超商', 4500]]
  );
});
