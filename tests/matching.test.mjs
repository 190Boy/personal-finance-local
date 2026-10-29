import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvText } from '../pdf-parser/credit-cards.mjs';
import { parseInvoiceBook, INVOICE_FIELDS } from '../pdf-parser/invoices.mjs';
import { makeInvoiceImport, INVOICE_COL as C } from '../cloud/invoices.mjs';
import {
  computeMatches,
  DECISION_HEADERS,
  readHabits,
  HABIT_HEADERS,
  coverage,
  spendingRecords
} from '../cloud/matching.mjs';
import { hash } from '../cloud/records.mjs';

// Fabricated data shaped like the real situations seen in the user's sheet.
const inv = (
  date,
  no,
  amount,
  seller,
  sellerId = '12345678',
  name = '商品',
  status = '開立已確認',
  carrier = '手機條碼'
) =>
  [carrier, date, no, amount, status, '否', sellerId, seller, '虛構地址', '', 1, amount, amount, name].join(
    ','
  );
const CSV = [
  INVOICE_FIELDS.join(','),
  inv('20261001', 'AA00000001', 39, '統一超商股份有限公司虛構分公司', '11111111', '綠茶'),
  inv('20261004', 'AA00000002', 4725, '虛構吃到飽股份有限公司', '22222222', '成人'),
  inv('20261017', 'AA00000003', 278, '全聯實業股份有限公司虛構分公司', '33333333', '魷魚'),
  inv('20261010', 'AA00000004', 50, '優食台灣股份有限公司', '83076928', '外送費', '開立已確認', '關網會員'),
  inv('20261009', 'AA00000005', 219, '全家便利商店股份有限公司虛構分公司', '44444444', '汽水'),
  inv('20261008', 'AA00000006', 130, '虛構小吃店', '55555555', '炒麵'),
  inv('20261025', 'AA00000007', 160, '虛構便當有限公司', '66666666', '便當'),
  inv('20261006', 'AA00000008', 149, '富邦媒體科技股份有限公司', '27365925', '兌換券'),
  inv('20261005', 'AA00000009', 99, '虛構超市股份有限公司', '77777777', '牛奶', '作廢')
].join('\n');
const card = (id, date, summary, yuan, account = '中信信用卡', closing = '', bank = '中國信託') => [
  '明細',
  id,
  'imp',
  bank,
  account,
  '2026-10',
  closing,
  '',
  date,
  date,
  summary,
  yuan * 100,
  '消費'
];
const bankRow = (id, date, summary, yuan) => [
  id,
  '玉山銀行',
  '玉山銀行帳戶',
  date,
  '12:00:00',
  summary,
  yuan,
  0
];
const CARDS = [
  card('c1', '2026-10-01', '連支*統一超商', 39),
  card('k1', '2026-10-04', '紅陽科技股份有限公司六本松', 4725, '凱基信用卡', '2026-10-18', '凱基銀行'),
  card('k2', '2026-10-10', '優步-Burger K', 555, '凱基信用卡', '2026-10-18', '凱基銀行'),
  card('k3', '2026-10-06', '富邦momo-EC', 149, '凱基信用卡', '2026-10-18', '凱基銀行'),
  card('c2', '2026-10-12', '連支*統一超商', 45)
];
const BANK = [
  bankRow('b1', '2026-10-17', '連結帳戶交易', 278),
  bankRow('b2', '2026-10-02', '連結帳戶交易', 1500),
  bankRow('b3', '2026-10-05', '凱基信用卡款', 16533),
  bankRow('b4', '2026-09-20', '連結帳戶交易', 300)
];
async function invoiceRows(text = CSV, fileHash = 'f') {
  const book = { sheets: [{ rows: parseCsvText(text) }] };
  return (await makeInvoiceImport(parseInvoiceBook(book), { fileHash })).rows;
}
const byNo = (m, no) => m.invoices.find(i => i.number === no);
const decision = (type, target, action, other = '', method = '', at = '2026-10-27T00:00:00Z') => [
  'd-' + Math.random(),
  type,
  target,
  action,
  other,
  method,
  at,
  ''
];

test('exact amount and date pair automatically, even when the card names a gateway', async () => {
  const m = computeMatches({ invoiceRows: await invoiceRows(), cardRows: CARDS, bankRows: BANK });
  assert.equal(byNo(m, 'AA00000001').state, 'auto');
  assert.equal(byNo(m, 'AA00000001').record.key, 'card:c1');
  assert.equal(byNo(m, 'AA00000002').record.summary, '紅陽科技股份有限公司六本松');
  assert.equal(byNo(m, 'AA00000008').record.key, 'card:k3');
  assert.equal(byNo(m, 'AA00000003').record.key, 'bank:b1');
  assert.equal(m.recordLinks.get('card:c1').invoice.number, 'AA00000001');
});
test('platform fee invoices are never automatic; the larger Uber charge is offered', async () => {
  const m = computeMatches({ invoiceRows: await invoiceRows(), cardRows: CARDS, bankRows: BANK });
  const uber = byNo(m, 'AA00000004');
  assert.equal(uber.state, 'choose');
  assert.deepEqual(
    uber.candidates.map(r => r.key),
    ['card:k2']
  );
});
test('a habit with no expected record suggests its payment method; others wait for statements or default to cash', async () => {
  const m = computeMatches({ invoiceRows: await invoiceRows(), cardRows: CARDS, bankRows: BANK });
  assert.deepEqual(
    [byNo(m, 'AA00000005').state, byNo(m, 'AA00000005').defaultMethod],
    ['pending', 'LINE Pay 錢包']
  );
  // Coverage ends at the earliest source end: 中信信用卡 2026-10-12 vs 凱基 closing 2026-10-18 vs 玉山 2026-10-17.
  assert.equal(m.coverage.end, '2026-10-12');
  assert.deepEqual([byNo(m, 'AA00000006').state, byNo(m, 'AA00000006').defaultMethod], ['pending', '現金']);
  assert.equal(byNo(m, 'AA00000007').state, 'waiting');
  assert.match(byNo(m, 'AA00000007').reason, /中國信託／中信信用卡 的資料只到 2026-10-12/);
  assert.equal(m.counts.voided, 1);
  assert.ok(!m.invoices.some(i => i.number === 'AA00000009'));
});
test('linked-account debits with no invoice ask whether they are a wallet top-up', async () => {
  const m = computeMatches({ invoiceRows: await invoiceRows(), cardRows: CARDS, bankRows: BANK });
  assert.deepEqual(
    m.questions.map(q => [q.record.key, q.suggestion]),
    [['bank:b2', '儲值']]
  );
  // Outside the invoice period nothing is asked; ordinary bank debits are never asked about.
  assert.ok(!m.questions.some(q => ['bank:b3', 'bank:b4'].includes(q.record.key)));
});
test('ambiguous pairs go to the user instead of guessing', async () => {
  const text =
    CSV + '\n' + inv('20261001', 'AA00000010', 39, '統一超商股份有限公司另一分公司', '11111112', '咖啡');
  const m = computeMatches({ invoiceRows: await invoiceRows(text), cardRows: CARDS, bankRows: BANK });
  assert.equal(byNo(m, 'AA00000001').state, 'choose');
  assert.equal(byNo(m, 'AA00000010').state, 'choose');
});
test('user decisions are applied: confirm, settle, reject, undo and top-up', async () => {
  const rows = await invoiceRows(),
    id = no => rows.find(r => r[0] === '發票' && r[C['發票號碼']] === no)[C['發票紀錄ID']];
  const decisions = [
    DECISION_HEADERS,
    decision('發票', id('AA00000004'), '配對', 'card:k2', '信用卡'),
    decision('發票', id('AA00000005'), '付款方式', '', 'LINE Pay 錢包'),
    decision('發票', id('AA00000001'), '不是這筆', 'card:c1'),
    decision('銀行', 'bank:b2', '儲值', '', 'LINE Pay 錢包'),
    decision('發票', id('AA00000006'), '付款方式', '', '現金', '2026-10-27T00:00:00Z'),
    decision('發票', id('AA00000006'), '撤銷', '', '', '2026-10-27T01:00:00Z')
  ];
  const m = computeMatches({ invoiceRows: rows, cardRows: CARDS, bankRows: BANK, decisionRows: decisions });
  assert.deepEqual([byNo(m, 'AA00000004').state, byNo(m, 'AA00000004').record.key], ['confirmed', 'card:k2']);
  assert.deepEqual([byNo(m, 'AA00000005').state, byNo(m, 'AA00000005').method], ['settled', 'LINE Pay 錢包']);
  assert.notEqual(byNo(m, 'AA00000001').record?.key, 'card:c1');
  assert.equal(byNo(m, 'AA00000006').state, 'pending');
  assert.equal(m.questions.length, 0);
  assert.equal(m.recordLinks.get('bank:b2').state, '儲值');
  assert.throws(() => computeMatches({ invoiceRows: rows, decisionRows: [['x']] }), /SHEET_SCHEMA/);
});
test('a re-imported invoice uses its latest content', async () => {
  const first = await invoiceRows(CSV, 'a');
  const later = (
    await invoiceRows(
      CSV.replace(
        inv('20261008', 'AA00000006', 130, '虛構小吃店', '55555555', '炒麵'),
        inv('20261008', 'AA00000006', 130, '虛構小吃店', '55555555', '炒麵', '作廢')
      ),
      'b'
    )
  ).map(r => {
    const out = [...r];
    out[C['匯入時間']] = '2999-01-01T00:00:00Z';
    return out;
  });
  const m = computeMatches({
    invoiceRows: [...first, ...later.filter(r => r[C['發票號碼']] === 'AA00000006')],
    cardRows: CARDS,
    bankRows: BANK
  });
  assert.ok(!m.invoices.some(i => i.number === 'AA00000006'));
});
test('habits come from the sheet and default when it does not exist yet', () => {
  assert.equal(readHabits([]).length, 3);
  assert.deepEqual(readHabits([HABIT_HEADERS, ['全家', '現金', '', '']]), [
    { keyword: '全家', method: '現金', recordHint: '', note: '' }
  ]);
  assert.throws(() => readHabits([['x']]), /SHEET_SCHEMA/);
});
test('only refunds-free spending is matched and coverage ignores unrelated bank debits', () => {
  const rec = spendingRecords(
    [
      ...CARDS,
      ['明細', 'r1', '', '中國信託', '中信信用卡', '', '', '', '2026-10-03', '', '退款', -3900, '退款']
    ],
    BANK
  );
  assert.ok(!rec.some(r => r.key === 'card:r1'));
  assert.equal(coverage(rec).sources.length, 3);
  assert.equal(coverage([]).end, '');
});
test('decision rows have unique ids', async () => {
  const { decisionRow } = await import('../cloud/matching.mjs');
  const a = await decisionRow(hash, { type: '發票', target: 'x', action: '付款方式', method: '現金' }),
    b = await decisionRow(hash, { type: '發票', target: 'x', action: '付款方式', method: '現金' });
  assert.equal(a.length, DECISION_HEADERS.length);
  assert.notEqual(a[0], b[0]);
});

// End to end through GoogleStore with an in-memory Sheets API.
import { GoogleStore } from '../cloud/google.mjs';
import { HEADERS, IMPORT_HEADERS } from '../cloud/records.mjs';
import { CARD_HEADERS, cardSheetRows } from '../cloud/credit-cards.mjs';
import { INVOICE_HEADERS, invoiceSheetRows } from '../cloud/invoices.mjs';
import { decisionRow as makeDecision } from '../cloud/matching.mjs';
function sheetsApi(tables) {
  const metadata = [],
    sheets = Object.keys(tables).map((title, i) => ({ title, sheetId: i + 1 }));
  const decode = rows =>
    rows.map(r => r.values.map(v => v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue));
  const fetcher = async (url, opt) => {
    let data = {};
    if (url.includes('?fields=developerMetadata')) data = { developerMetadata: structuredClone(metadata) };
    else if (url.includes('?fields=sheets.properties'))
      data = { sheets: sheets.map(properties => ({ properties })) };
    else if (url.includes('/values/')) {
      const tab = decodeURIComponent(url.split('/values/')[1].split('?')[0]).split("'")[1];
      if (opt.method === 'PUT') tables[tab] = JSON.parse(opt.body).values;
      else data = { values: structuredClone(tables[tab] || []) };
    } else {
      for (const r of JSON.parse(opt.body).requests) {
        if (r.createDeveloperMetadata) metadata.push(r.createDeveloperMetadata.developerMetadata);
        if (r.addSheet) {
          sheets.push({ ...r.addSheet.properties, sheetId: sheets.length + 1 });
          tables[r.addSheet.properties.title] = [];
        }
        if (r.appendCells)
          tables[sheets.find(s => s.sheetId === r.appendCells.sheetId).title].push(
            ...decode(r.appendCells.rows)
          );
      }
    }
    return { ok: true, status: 200, json: async () => data };
  };
  const s = new GoogleStore({ fetcher });
  s.authorize('synthetic', 3600);
  s.file = { id: 'synthetic-sheet' };
  return s;
}
test('summary carries matches into history; decisions seed habits and change the result', async () => {
  const bank = BANK.map(r => [...r, '', '', '', '', '', '', '', '', '', '', ''].slice(0, HEADERS.length));
  const tables = {
    匯入紀錄: [IMPORT_HEADERS],
    銀行存款: [HEADERS, ...bank],
    信用卡: [
      CARD_HEADERS,
      ...cardSheetRows(
        CARDS.map(r => [...r, '', '', '', '', '人工核對', '', '', ''].slice(0, CARD_HEADERS.length))
      )
    ],
    發票: [INVOICE_HEADERS, ...invoiceSheetRows(await invoiceRows())]
  };
  const store = sheetsApi(tables);
  await store.metadata();
  let r = await store.summary();
  assert.equal(r.matching.counts.auto, 4);
  assert.deepEqual(r.cardAccounts, { 中國信託: ['中信信用卡'], 凱基銀行: ['凱基信用卡'] });
  const link = r.history.rows.find(h => h.kind === '信用卡' && h.id === 'c1').match;
  assert.equal(link.invoice.items[0].name, '綠茶');
  const familymart = r.matching.invoices.find(i => i.number === 'AA00000005');
  assert.ok(!tables['付款習慣']);
  await store.saveDecisions([
    await makeDecision(hash, {
      type: '發票',
      target: familymart.id,
      action: '付款方式',
      method: familymart.defaultMethod
    }),
    await makeDecision(hash, { type: '銀行', target: 'bank:b2', action: '儲值', method: 'LINE Pay 錢包' })
  ]);
  assert.equal(tables['付款習慣'].length, 4);
  assert.equal(tables['配對紀錄'].length, 3);
  r = await store.summary();
  assert.equal(r.matching.invoices.find(i => i.number === 'AA00000005').state, 'settled');
  assert.equal(r.matching.questions.length, 0);
  assert.equal(r.history.rows.find(h => h.id === 'b2').match.state, '儲值');
  // A second decision does not seed the habits again.
  await store.saveDecisions([
    await makeDecision(hash, { type: '發票', target: familymart.id, action: '撤銷' })
  ]);
  assert.equal(tables['付款習慣'].length, 4);
  r = await store.summary();
  assert.equal(r.matching.invoices.find(i => i.number === 'AA00000005').state, 'pending');
});
test('without an invoice sheet the summary has no matching section and nothing is created', async () => {
  const tables = { 匯入紀錄: [IMPORT_HEADERS], 銀行存款: [HEADERS] };
  const store = sheetsApi(tables);
  await store.metadata();
  assert.equal((await store.summary()).matching, null);
  assert.ok(!tables['付款習慣'] && !tables['配對紀錄']);
});

test('a charge a few dollars above the invoice is offered but never paired automatically', async () => {
  const text =
    CSV + '\n' + inv('20261012', 'AA00000012', 75, '統一超商股份有限公司虛構第二分公司', '11111113', '飯糰');
  const cards = [...CARDS, card('c3', '2026-10-12', '連支*統一超商', 77)];
  const m = computeMatches({ invoiceRows: await invoiceRows(text), cardRows: cards, bankRows: BANK });
  const near = byNo(m, 'AA00000012');
  assert.equal(near.state, 'choose');
  assert.deepEqual(
    near.candidates.map(r => [r.key, r.extraCents]),
    [['card:c3', 200]]
  );
  // Too large a gap, or a record already matched exactly elsewhere, is not offered.
  const far = computeMatches({
    invoiceRows: await invoiceRows(text),
    cardRows: [...CARDS, card('c3', '2026-10-12', '連支*統一超商', 85)],
    bankRows: BANK
  });
  assert.notEqual(byNo(far, 'AA00000012').state, 'choose');
  const exact = computeMatches({
    invoiceRows: await invoiceRows(
      text +
        '\n' +
        inv('20261012', 'AA00000013', 77, '統一超商股份有限公司虛構第三分公司', '11111114', '便當')
    ),
    cardRows: cards,
    bankRows: BANK
  });
  assert.equal(byNo(exact, 'AA00000013').state, 'auto');
  assert.notEqual(byNo(exact, 'AA00000012').state, 'choose');
  // Once confirmed, the history link records the extra amount.
  const rows = await invoiceRows(text),
    id = rows.find(r => r[0] === '發票' && r[C['發票號碼']] === 'AA00000012')[C['發票紀錄ID']];
  const confirmed = computeMatches({
    invoiceRows: rows,
    cardRows: cards,
    bankRows: BANK,
    decisionRows: [DECISION_HEADERS, decision('發票', id, '配對', 'card:c3', '信用卡')]
  });
  assert.equal(confirmed.recordLinks.get('card:c3').extraCents, 200);
});
