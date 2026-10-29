import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MANUAL_HEADERS,
  manualEntry,
  manualRow,
  manualSheetRows,
  manualTable,
  manualEntries
} from '../cloud/manual.mjs';
import { computeMatches, DECISION_HEADERS } from '../cloud/matching.mjs';
import { parseCsvText } from '../pdf-parser/credit-cards.mjs';
import { parseInvoiceBook, INVOICE_FIELDS } from '../pdf-parser/invoices.mjs';
import { makeInvoiceImport } from '../cloud/invoices.mjs';
import { parseLinePayChat } from '../pdf-parser/linepay.mjs';
import { makeLinePayImport } from '../cloud/linepay.mjs';
import { GoogleStore } from '../cloud/google.mjs';
import { HEADERS, IMPORT_HEADERS } from '../cloud/records.mjs';

const base = {
  id: 'm1',
  type: '支出',
  date: '2026-10-20',
  amount: '85',
  method: '現金',
  party: '夜市雞排',
  category: '餐飲'
};
test('entries are validated', () => {
  assert.equal(manualEntry(base).amountCents, 8500);
  assert.throws(() => manualEntry({ ...base, amount: '0' }), /MANUAL_AMOUNT/);
  assert.throws(() => manualEntry({ ...base, amount: '1.234' }), /MANUAL_AMOUNT/);
  assert.throws(() => manualEntry({ ...base, date: '2026-02-30' }), /MANUAL_DATE/);
  assert.throws(() => manualEntry({ ...base, time: '25:00' }), /MANUAL_TIME/);
  assert.throws(() => manualEntry({ ...base, method: '' }), /MANUAL_METHOD/);
  assert.equal(manualEntry({ ...base, type: '奇怪' }).type, '支出');
});
test('edits and deletions are new rows; the latest row of each record wins', () => {
  const a = manualRow(manualEntry(base), { at: '2026-10-20T01:00:00Z' }),
    b = manualRow(manualEntry({ ...base, id: 'm2', amount: '50', party: '飲料' }), {
      at: '2026-10-20T02:00:00Z'
    }),
    edit = manualRow(manualEntry({ ...base, amount: '90' }), { at: '2026-10-20T03:00:00Z' }),
    del = manualRow(manualEntry({ ...base, id: 'm2', amount: '50' }), {
      deleted: true,
      at: '2026-10-20T04:00:00Z'
    });
  const rows = manualTable([MANUAL_HEADERS, ...manualSheetRows([a, b, edit, del])]);
  assert.deepEqual(rows[0], a);
  assert.deepEqual(
    manualEntries(rows).map(e => [e.id, e.amountCents]),
    [['m1', 9000]]
  );
  assert.throws(() => manualTable([['x']]), /SHEET_SCHEMA/);
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
    '雞排'
  ].join(',');
async function invoices() {
  const csv = [INVOICE_FIELDS.join(','), inv('20261020', 'AA00000001', 85, '虛構雞排店', '12345678')].join(
    '\n'
  );
  return (
    await makeInvoiceImport(parseInvoiceBook({ sheets: [{ rows: parseCsvText(csv) }] }), { fileHash: 'i' })
  ).rows;
}
test('a hand-entered cash purchase pairs with its invoice; transfers never do', async () => {
  const cash = manualEntries([manualRow(manualEntry(base))]);
  const m = computeMatches({ invoiceRows: await invoices(), manualEntries: cash });
  assert.deepEqual([m.invoices[0].state, m.invoices[0].record.key], ['auto', 'manual:m1']);
  const transfer = manualEntries([
    manualRow(manualEntry({ ...base, category: '轉帳給別人', method: 'LINE Pay 錢包' }))
  ]);
  assert.notEqual(
    computeMatches({ invoiceRows: await invoices(), manualEntries: transfer }).invoices[0].state,
    'auto'
  );
  // Hand-entered records never narrow the statement coverage.
  assert.equal(m.coverage.end, '');
});

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
const pay = (time, amount, shop, balance) =>
  time +
  '\tLINE錢包\t"LINE Pay 付款 NT$ ' +
  amount +
  '\n付款完成。\n商店名稱: ' +
  shop +
  '\n付款後餘額: NT$ ' +
  balance +
  '"';
test('recording a wallet transfer explains its gap and appears once in the history', async () => {
  const tables = { 匯入紀錄: [IMPORT_HEADERS], 銀行存款: [HEADERS] };
  const store = sheetsApi(tables);
  await store.metadata();
  const chat = [
    '[LINE] 與LINE錢包的聊天記錄',
    '',
    '2026/10/15（四）',
    pay('14:15', '106', '全家便利商店', '3,196'),
    '',
    '2026/10/17（六）',
    pay('13:46', '80', 'SORA', '2,916'),
    ''
  ].join('\n');
  await store.saveLinePay(await makeLinePayImport(parseLinePayChat(chat), { fileHash: 'c' }));
  await store.metadata();
  let r = await store.summary();
  const gap = r.matching.wallet.gaps[0];
  assert.deepEqual([gap.direction, gap.amountCents], ['out', 20000]);
  const entry = manualEntry({
    id: 'm9',
    type: '支出',
    date: '2026-10-17',
    amount: '200',
    method: 'LINE Pay 錢包',
    party: '小明',
    category: '轉帳給別人'
  });
  await store.saveManual(
    [manualRow(entry)],
    [['d1', 'LINE錢包', gap.id, '落差', 'manual:m9', '已手動補記', '2026-10-29T00:00:00Z', '']]
  );
  assert.equal(tables['手動記帳'].length, 2);
  assert.equal(tables['配對紀錄'].length, 2);
  r = await store.summary();
  assert.equal(r.matching.wallet.gaps[0].label, '已手動補記');
  assert.equal(r.manual.length, 1);
  const rows = r.history.rows.filter(h => h.expense === 200);
  assert.deepEqual(
    rows.map(h => [h.kind, h.summary]),
    [['手動記帳', '小明／轉帳給別人']]
  );
  // Without any invoice or LINE Pay data, hand-entered records alone still produce a history.
  const plain = sheetsApi({ 匯入紀錄: [IMPORT_HEADERS], 銀行存款: [HEADERS] });
  await plain.metadata();
  await plain.saveManual([manualRow(manualEntry(base))]);
  await plain.metadata();
  assert.equal(
    (await plain.summary()).history.rows.find(h => h.kind === '手動記帳').summary,
    '夜市雞排／餐飲'
  );
  assert.ok(DECISION_HEADERS.length);
});
