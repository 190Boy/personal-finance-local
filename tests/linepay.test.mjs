import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLinePayChat, splitMessages } from '../pdf-parser/linepay.mjs';
import {
  LINEPAY_HEADERS,
  makeLinePayImport,
  linePayRowsToAppend,
  linePaySheetRows,
  linePayTable,
  linePayEvents,
  walletGaps
} from '../cloud/linepay.mjs';
import { computeMatches, DECISION_HEADERS } from '../cloud/matching.mjs';
import { parseCsvText } from '../pdf-parser/credit-cards.mjs';
import { parseInvoiceBook, INVOICE_FIELDS } from '../pdf-parser/invoices.mjs';
import { makeInvoiceImport } from '../cloud/invoices.mjs';

// Fabricated messages in the same shapes as a real LINE錢包 export.
const pay = (time, amount, shop, balance) =>
  time +
  '\tLINE錢包\t"LINE Pay 付款 NT$ ' +
  amount +
  '\n付款完成。\n商店名稱: ' +
  shop +
  (balance ? '\n付款後餘額: NT$ ' + balance : '\n回饋: 1%') +
  '"';
const CHAT = [
  '[LINE] 與LINE錢包的聊天記錄',
  '儲存日期： 2026/10/29 16:26',
  '',
  '2026/10/14（三）',
  '09:00\tLINE錢包\t您的LINE POINTS一般點數即將於30天內逾期',
  '',
  '2026/10/15（四）',
  pay('14:15', '106', '全家便利商店', '3,196'),
  '',
  '2026/10/16（五）',
  '08:01\tLINE錢包\tLINE Pay 付款 NT$ 20 付款完成。 商店名稱: 台北捷運乘車碼 付款後餘額: NT$ 3,176',
  pay('12:24', '39', '統一超商', ''),
  '',
  '2026/10/17（六）',
  // 200 left the wallet between these two notices without any notice: a friend transfer.
  pay('13:46', '80', 'SORA', '2,896'),
  '18:00\tLINE錢包\t儲值 NT$1,000 儲值完成。',
  pay('19:00', '100', '全家便利商店', '3,796'),
  '',
  '2026/10/20（二）',
  // 1,500 arrived unannounced: matches a 玉山 linked-account debit on 10/19.
  pay('12:00', '49', '全家便利商店', '5,247'),
  '13:00\tLINE錢包\t"LINE Pay 付款 NT$ 10\n取消付款。\n商店名稱: LINE禮物"',
  // The cancelled 10 came back.
  pay('14:00', '35', '全家便利商店', '5,222'),
  ''
].join('\r\n');

test('the chat export is split into messages and transaction notices are parsed', () => {
  const p = parseLinePayChat(CHAT);
  assert.deepEqual(p.counts, { wallet: 6, card: 1, topup: 1, withdraw: 0, cancel: 1 });
  assert.equal(p.skipped, 1);
  assert.deepEqual([p.from, p.to], ['2026-10-15', '2026-10-20']);
  const transit = p.events.find(e => e.shop === '台北捷運乘車碼');
  assert.deepEqual([transit.amountCents, transit.balanceCents, transit.method], [2000, 317600, '錢包']);
  const card = p.events.find(e => e.shop === '統一超商');
  assert.deepEqual([card.method, card.balanceCents], ['刷卡', null]);
  assert.equal(p.events.find(e => e.type === '儲值').amountCents, 100000);
  assert.deepEqual(p.lastBalance, { date: '2026-10-20', time: '14:00', cents: 522200 });
  assert.throws(() => parseLinePayChat('[LINE] 與某人的聊天記錄\n'), /LINEPAY_HEADER/);
  assert.throws(
    () => parseLinePayChat('[LINE] 與LINE錢包的聊天記錄\n2026/10/14（三）\n09:00\tLINE錢包\t公告'),
    /LINEPAY_EMPTY/
  );
  assert.equal(splitMessages(CHAT)[1].text.split('\n').length, 4);
});

async function rows(text = CHAT, fileHash = 'f') {
  return (await makeLinePayImport(parseLinePayChat(text), { fileHash })).rows;
}
test('rows round-trip through the sheet and re-exports add only new notices', async () => {
  const first = await rows();
  assert.ok(first.every(r => r.length === LINEPAY_HEADERS.length));
  assert.deepEqual(linePayTable([LINEPAY_HEADERS, ...linePaySheetRows(first)]), first);
  const later = await rows(
    CHAT + '\r\n2026/10/21（三）\r\n' + pay('12:00', '45', '全家便利商店', '5,177'),
    'g'
  );
  const plan = linePayRowsToAppend(first, later);
  assert.equal(plan.fresh.length, 1);
  assert.equal(plan.skipped, first.length);
  // Two identical notices in the same minute stay two rows.
  const twins = await rows(CHAT + '\r\n' + pay('14:00', '35', '全家便利商店', '5,222'), 'h');
  assert.equal(new Set(twins.map(r => r[0])).size, twins.length);
});
const bank = [
  ['b1', '玉山銀行', '玉山銀行帳戶', '2026-10-19', '18:00:00', '連結帳戶交易', 1500, 0],
  ['b2', '玉山銀行', '玉山銀行帳戶', '2026-10-17', '20:00:00', '連結帳戶交易', 278, 0],
  ['b0', '玉山銀行', '玉山銀行帳戶', '2026-07-01', '20:00:00', '連結帳戶交易', 50, 0]
];
test('balance gaps find unannounced money and explain top-ups and cancellations', async () => {
  const events = linePayEvents(await rows()),
    w = walletGaps(events, bank);
  assert.deepEqual(
    w.gaps.map(g => [g.from.time, g.to.time, g.direction, g.amountCents, g.explainedBy?.label || '']),
    [
      ['08:01', '13:46', 'out', 20000, ''],
      ['19:00', '12:00', 'in', 150000, '玉山銀行 連結帳戶交易'],
      ['13:00', '14:00', 'in', 1000, '取消付款退回（LINE禮物）']
    ]
  );
  assert.deepEqual([...w.topupKeys], ['bank:b1']);
  // Bank data reaching back further than 60 days extends the listed period.
  assert.equal(w.since, '2026-07-01');
  assert.equal(w.older, 0);
  // Without bank data only the last 60 days are listed.
  assert.equal(walletGaps(events, []).since, '2026-08-21');
});

const inv = (date, no, amount, seller, id) =>
  [
    '手機條碼',
    date,
    no,
    amount,
    '開立已確認',
    '否',
    id,
    seller,
    '虛構地址',
    '',
    1,
    amount,
    amount,
    '商品'
  ].join(',');
async function invoiceRows() {
  const csv = [
    INVOICE_FIELDS.join(','),
    inv('20261015', 'AA00000001', 106, '全家便利商店股份有限公司虛構分公司', '44444444'),
    inv('20261017', 'AA00000002', 278, '全聯實業股份有限公司虛構分公司', '33333333'),
    inv('20261020', 'AA00000003', 49, '全家便利商店股份有限公司虛構分公司', '44444444')
  ].join('\n');
  return (
    await makeInvoiceImport(parseInvoiceBook({ sheets: [{ rows: parseCsvText(csv) }] }), { fileHash: 'i' })
  ).rows;
}
test('wallet payments pair with invoices, and an explained top-up is not asked about', async () => {
  const events = linePayEvents(await rows());
  const m = computeMatches({
    invoiceRows: await invoiceRows(),
    bankRows: bank,
    linePayEvents: events,
    wallet: walletGaps(events, bank)
  });
  const familymart = m.invoices.find(i => i.number === 'AA00000001');
  assert.deepEqual(
    [familymart.state, familymart.record.kind, familymart.record.summary],
    ['auto', 'LINE Pay', '全家便利商店']
  );
  assert.equal(m.invoices.find(i => i.number === 'AA00000002').record.key, 'bank:b2');
  assert.equal(m.recordLinks.get('bank:b1').state, '儲值');
  assert.ok(!m.questions.some(q => q.record.key === 'bank:b1'));
  // Card-paid LINE Pay notices are not records: the card statement already has them.
  assert.ok(!m.walletRecords.some(r => r.summary === '統一超商'));
  assert.equal(m.walletRecords.length, 6);
});
test('labelled gaps carry the label; undo clears it', async () => {
  const events = linePayEvents(await rows()),
    wallet = walletGaps(events, bank),
    id = wallet.gaps[0].id;
  const labelled = computeMatches({
    bankRows: bank,
    linePayEvents: events,
    wallet,
    decisionRows: [
      DECISION_HEADERS,
      ['d1', 'LINE錢包', id, '落差', '', '轉帳給別人', '2026-10-29T00:00:00Z', '']
    ]
  });
  assert.equal(labelled.wallet.gaps[0].label, '轉帳給別人');
  const undone = computeMatches({
    bankRows: bank,
    linePayEvents: events,
    wallet,
    decisionRows: [
      DECISION_HEADERS,
      ['d1', 'LINE錢包', id, '落差', '', '轉帳給別人', '2026-10-29T00:00:00Z', ''],
      ['d2', 'LINE錢包', id, '撤銷', '', '', '2026-10-29T01:00:00Z', '']
    ]
  });
  assert.equal(undone.wallet.gaps[0].label, undefined);
});

import { GoogleStore } from '../cloud/google.mjs';
import { HEADERS, IMPORT_HEADERS } from '../cloud/records.mjs';
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
    } else
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
    return { ok: true, status: 200, json: async () => data };
  };
  const s = new GoogleStore({ fetcher });
  s.authorize('synthetic', 3600);
  s.file = { id: 'synthetic-sheet' };
  return s;
}
test('saving LINE Pay creates its sheet once; the summary lists wallet payments and gaps without invoices', async () => {
  const tables = {
    匯入紀錄: [IMPORT_HEADERS],
    銀行存款: [HEADERS, ...bank.map(r => [...r, ...Array(HEADERS.length - r.length).fill('')])]
  };
  const store = sheetsApi(tables);
  await store.metadata();
  const batch = await makeLinePayImport(parseLinePayChat(CHAT), { fileHash: 'x' });
  const first = await store.saveLinePay(batch),
    again = await store.saveLinePay(batch);
  assert.deepEqual([first.added, again.repeated], [batch.rows.length, true]);
  const later = await makeLinePayImport(
    parseLinePayChat(CHAT + '\r\n2026/10/21（三）\r\n' + pay('12:00', '45', '全家便利商店', '5,177')),
    {
      fileHash: 'y'
    }
  );
  assert.deepEqual([(await store.saveLinePay(later)).added], [1]);
  assert.equal(tables['LINE Pay'].length, 1 + batch.rows.length + 1);
  await store.metadata();
  const r = await store.summary();
  assert.equal(r.matching.wallet.gaps.length, 3);
  const wallet = r.history.rows.filter(h => h.kind === 'LINE Pay');
  assert.equal(wallet.length, 7);
  assert.equal(r.history.rows.find(h => h.id === 'b1').match.state, '儲值');
});
