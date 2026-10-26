import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvText } from '../pdf-parser/credit-cards.mjs';
import { parseInvoiceBook, shortSeller, invoiceDate, INVOICE_FIELDS } from '../pdf-parser/invoices.mjs';
import {
  INVOICE_HEADERS,
  INVOICE_COL as C,
  makeInvoiceImport,
  invoiceRowsToAppend,
  invoiceSheetRows,
  invoiceTable
} from '../cloud/invoices.mjs';
import { GoogleStore } from '../cloud/google.mjs';
import { IMPORT_HEADERS } from '../cloud/records.mjs';

// Fabricated rows in the same shape as the 財政部 export: one row per item, invoice fields repeated,
// 「發票金額」 equal to the item amount, and two explanatory lines at the end.
const H = INVOICE_FIELDS.join(',');
const row = (carrier, date, no, amount, seller, sellerId, qty, unit, name, status = '開立已確認') =>
  [
    carrier,
    date,
    no,
    amount,
    status,
    '否',
    sellerId,
    seller,
    '虛構市虛構路1號',
    '',
    qty,
    unit,
    amount,
    name
  ].join(',');
const CSV = [
  H,
  row(
    '手機條碼',
    '20261023',
    'AA10000001',
    45,
    '測試便利商店股份有限公司虛構第一分公司',
    '11111111',
    1,
    45,
    '綠茶'
  ),
  row(
    '手機條碼',
    '20261023',
    'AA10000001',
    70,
    '測試便利商店股份有限公司虛構第一分公司',
    '11111111',
    2,
    35,
    '汽水'
  ),
  row(
    '手機條碼',
    '20261023',
    'AA10000001',
    -21,
    '測試便利商店股份有限公司虛構第一分公司',
    '11111111',
    1,
    0,
    '飲料促'
  ),
  row(
    '手機條碼',
    '20261004',
    'BB20000002',
    4295,
    '虛構餐飲股份有限公司市府營業所',
    '00012345',
    5,
    859,
    '成人'
  ),
  row('手機條碼', '20261004', 'BB20000002', 0, '虛構餐飲股份有限公司市府營業所', '00012345', 1, 0, '鍋底'),
  row(
    '手機條碼',
    '20261004',
    'BB20000002',
    430,
    '虛構餐飲股份有限公司市府營業所',
    '00012345',
    1,
    430,
    '服務費'
  ),
  row('外送會員', '20261010', 'CC30000003', 30, '虛構外送股份有限公司', '22222222', 1, 30, '外送費'),
  row('外送會員', '20261010', 'CC30000003', -30, '虛構外送股份有限公司', '22222222', 1, -30, '送餐優惠'),
  row('外送會員', '20261010', 'CC30000003', 50, '虛構外送股份有限公司', '22222222', 1, 50, '服務費'),
  row('手機條碼', '20261007', 'DD40000004', 130, '虛構小吃店', '33333333', 1, 130, '炒麵'),
  row('手機條碼', '20261008', 'EE50000***', 60, '虛構書店有限公司', '44444444', 1, 60, '筆', '開立已確認'),
  row('手機條碼', '20261009', 'FF60000006', 99, '虛構超市股份有限公司', '55555555', 1, 99, '牛奶', '作廢'),
  '捐贈或作廢之發票，字軌號碼均會隱末3碼',
  '注意：本功能所下載之雲端發票明細檔案可能因賣方營業人後續作廢或折讓等原因而產生誤差。',
  ''
].join('\r\n');
const book = (text = CSV) => ({
  sheets: [{ name: 'CSV', rows: parseCsvText('﻿' + text) }],
  encoding: 'UTF-8'
});

test('groups item rows into invoices and sums the real total', () => {
  const p = parseInvoiceBook(book());
  assert.equal(p.invoices.length, 6);
  assert.equal(p.itemCount, 12);
  const a = p.invoices.find(i => i.number === 'AA10000001');
  assert.equal(a.items.length, 3);
  assert.equal(a.totalCents, 9400);
  assert.equal(p.invoices.find(i => i.number === 'BB20000002').totalCents, 472500);
  assert.equal(p.invoices.find(i => i.number === 'CC30000003').totalCents, 5000);
  assert.deepEqual(p.notes.length, 2);
  assert.equal(p.from, '2026-10-04');
  assert.equal(p.to, '2026-10-23');
});
test('total excludes voided invoices; voided and masked invoices are flagged but kept', () => {
  const p = parseInvoiceBook(book());
  assert.equal(p.totalCents, 9400 + 472500 + 5000 + 13000 + 6000);
  const voided = p.invoices.find(i => i.number === 'FF60000006');
  assert.ok(voided.errors.some(e => e.includes('作廢')));
  const masked = p.invoices.find(i => i.number === 'EE50000***');
  assert.equal(masked.masked, true);
  assert.ok(masked.errors.some(e => e.includes('遮蔽')));
  assert.deepEqual(p.invoices.find(i => i.number === 'DD40000004').errors, []);
});
test('newest invoice first; dates validated; footer lines are not purchases', () => {
  const p = parseInvoiceBook(book());
  assert.equal(p.invoices[0].date, '2026-10-23');
  assert.equal(invoiceDate('20261302'), null);
  assert.equal(invoiceDate('20260229'), null);
  assert.equal(invoiceDate('20261031'), '2026-10-31');
  const bad = parseInvoiceBook(
    book(H + '\r\n' + row('手機條碼', '2026-10-01', 'GG70000007', 10, '虛構', '6666', 1, 10, 'x'))
  );
  assert.ok(bad.invoices[0].errors.includes('發票日期無效'));
  assert.ok(bad.invoices[0].errors.includes('賣方統編格式無法辨識'));
});
test('rejects files that are not the e-invoice export', () => {
  assert.throws(() => parseInvoiceBook(book('日期,金額\r\n2026-10-01,10')), /INVOICE_HEADER/);
  assert.throws(() => parseInvoiceBook(book(H + '\r\n')), /INVOICE_EMPTY/);
  assert.throws(() => parseInvoiceBook(book(CSV + '\r\n' + H)), /INVOICE_MULTIPLE/);
});
test('inconsistent rows under one invoice number are flagged', () => {
  const text = [
    H,
    row('手機條碼', '20261001', 'HH80000008', 10, '虛構', '77777777', 1, 10, 'a'),
    row('手機條碼', '20261002', 'HH80000008', 10, '虛構', '77777777', 1, 10, 'b')
  ].join('\n');
  assert.ok(parseInvoiceBook(book(text)).invoices[0].errors.includes('同一發票號碼的發票資訊不一致'));
});
test('seller names shorten to the brand and keep the branch', () => {
  assert.deepEqual(shortSeller('全家便利商店股份有限公司新北市第一○一一分公司'), {
    name: '全家便利商店',
    branch: '新北市第一○一一分公司'
  });
  assert.deepEqual(shortSeller('百五責任有限公司'), { name: '百五', branch: '' });
  assert.deepEqual(shortSeller('我不怕你泰胖餐館'), { name: '我不怕你泰胖餐館', branch: '' });
});

test('import rows: one invoice row plus its items, yuan in the sheet and cents in memory', async () => {
  const p = parseInvoiceBook(book()),
    batch = await makeInvoiceImport(p, { fileHash: 'file-a' });
  assert.equal(batch.rows.filter(r => r[0] === '發票').length, 6);
  assert.equal(batch.rows.filter(r => r[0] === '品項').length, 12);
  assert.ok(batch.rows.every(r => r.length === INVOICE_HEADERS.length));
  const head = batch.rows.find(r => r[C['發票號碼']] === 'BB20000002' && r[0] === '發票');
  assert.equal(head[C['金額（元）']], 472500);
  assert.equal(head[C['賣方統編']], '00012345');
  assert.equal(head[C['配對狀態']], '未配對');
  assert.equal(batch.rows.find(r => r[C['發票號碼']] === 'FF60000006')[C['配對狀態']], '作廢');
  const items = batch.rows.filter(r => r[0] === '品項' && r[C['發票紀錄ID']] === head[C['發票紀錄ID']]);
  assert.deepEqual(
    items.map(r => [r[C['品名']], r[C['金額（元）']], r[C['品項序']]]),
    [
      ['成人', 429500, 1],
      ['鍋底', 0, 2],
      ['服務費', 43000, 3]
    ]
  );
  const sheet = invoiceSheetRows(batch.rows);
  assert.equal(sheet.find(r => r[C['紀錄ID']] === head[C['紀錄ID']])[C['金額（元）']], 4725);
  assert.deepEqual(invoiceTable([INVOICE_HEADERS, ...sheet]), batch.rows);
  assert.equal(batch.log[3], '雲端發票');
  assert.equal(batch.log[5], 6);
});
test('overlapping exports add only new invoices; changed invoices are appended and flagged', async () => {
  const first = await makeInvoiceImport(parseInvoiceBook(book()), { fileHash: 'a' });
  const extra = row(
    '手機條碼',
    '20261024',
    'II90000009',
    63,
    '虛構超市股份有限公司',
    '55555555',
    1,
    63,
    '豆皮'
  );
  const changed = CSV.replace(
    row('手機條碼', '20261007', 'DD40000004', 130, '虛構小吃店', '33333333', 1, 130, '炒麵'),
    row('手機條碼', '20261007', 'DD40000004', 130, '虛構小吃店', '33333333', 1, 130, '炒麵', '作廢')
  ).replace(H, H + '\r\n' + extra);
  const second = await makeInvoiceImport(parseInvoiceBook(book(changed)), { fileHash: 'b' });
  const plan = invoiceRowsToAppend(first.rows, second.rows);
  assert.equal(plan.added, 2);
  assert.equal(plan.skipped, 5);
  assert.equal(plan.changed, 1);
  const flagged = plan.fresh.find(r => r[C['發票號碼']] === 'DD40000004');
  assert.ok(flagged[C['核對狀態']].includes('以最新匯入為準'));
  assert.equal(invoiceRowsToAppend([...first.rows, ...plan.fresh], second.rows).added, 0);
  assert.equal(invoiceRowsToAppend([...first.rows, ...plan.fresh], first.rows).added, 0);
});
test('masked numbers only group rows of the same day and seller', async () => {
  const text = [
    H,
    row('手機條碼', '20261008', 'JJ10000***', 60, '虛構書店有限公司', '44444444', 1, 60, '筆'),
    row('手機條碼', '20261008', 'JJ10000***', 60, '虛構書店有限公司', '44444444', 1, 60, '筆')
  ].join('\n');
  const p = parseInvoiceBook(book(text));
  // Same masked number, same content: the parser cannot tell them apart and keeps one invoice of two items.
  assert.equal(p.invoices.length, 1);
  assert.equal(p.invoices[0].totalCents, 12000);
  const b = await makeInvoiceImport(p, { fileHash: 'x' });
  assert.equal(b.rows.filter(r => r[0] === '發票').length, 1);
  const twoDays =
    text + '\n' + row('手機條碼', '20261009', 'JJ10000***', 60, '虛構書店有限公司', '44444444', 1, 60, '筆');
  const q = parseInvoiceBook(book(twoDays));
  assert.equal(q.invoices.length, 2);
  assert.ok(q.invoices.every(i => !i.errors.includes('同一發票號碼的發票資訊不一致')));
  const ids = (await makeInvoiceImport(q, { fileHash: 'y' })).rows
    .filter(r => r[0] === '發票')
    .map(r => r[C['紀錄ID']]);
  assert.equal(new Set(ids).size, 2);
});

function mockSheets({ barrier = false } = {}) {
  const tables = { 匯入紀錄: [IMPORT_HEADERS] },
    metadata = [],
    sheets = [{ title: '匯入紀錄', sheetId: 1 }];
  let collisions = 0,
    reads = 0,
    release;
  const gate = new Promise(r => (release = r));
  const decode = rows =>
    rows.map(r => r.values.map(v => v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue));
  const fetcher = async (url, opt) => {
    let data = {};
    if (url.includes('?fields=developerMetadata')) {
      data = { developerMetadata: structuredClone(metadata) };
      reads++;
      if (barrier && reads <= 2) {
        if (reads === 2) release();
        await gate;
      }
    } else if (url.includes('?fields=sheets.properties'))
      data = { sheets: sheets.map(properties => ({ properties })) };
    else if (url.includes('/values/')) {
      const tab = decodeURIComponent(url.split('/values/')[1].split('?')[0]).split("'")[1];
      if (opt.method === 'PUT') tables[tab] = JSON.parse(opt.body).values;
      else data = { values: structuredClone(tables[tab] || []) };
    } else {
      const requests = JSON.parse(opt.body).requests,
        ids = new Set(metadata.map(m => m.metadataId));
      // Like the real API, adding a sheet whose title exists fails the whole batch.
      if (requests.some(r => r.addSheet && sheets.some(s => s.title === r.addSheet.properties.title)))
        return { ok: false, status: 400 };
      for (const r of requests)
        if (r.createDeveloperMetadata) {
          const id = r.createDeveloperMetadata.developerMetadata.metadataId;
          if (ids.has(id)) {
            collisions++;
            return { ok: false, status: 400 };
          }
          ids.add(id);
        }
      for (const r of requests) {
        if (r.createDeveloperMetadata) metadata.push(r.createDeveloperMetadata.developerMetadata);
        if (r.deleteDeveloperMetadata) {
          const id = r.deleteDeveloperMetadata.dataFilter.developerMetadataLookup.metadataId;
          metadata.splice(0, metadata.length, ...metadata.filter(m => m.metadataId !== id));
        }
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
  const store = () => {
    const s = new GoogleStore({ fetcher });
    s.authorize('synthetic', 3600);
    s.file = { id: 'synthetic-sheet' };
    s.sheets = structuredClone(sheets);
    return s;
  };
  return {
    tables,
    store,
    get collisions() {
      return collisions;
    }
  };
}
test('saving creates the 發票 sheet once, writes rows with the ledger, and is idempotent', async () => {
  const m = mockSheets(),
    batch = await makeInvoiceImport(parseInvoiceBook(book()), { fileHash: 'file' });
  const first = await m.store().saveInvoices(batch),
    again = await m.store().saveInvoices(batch);
  assert.deepEqual([first.added, first.repeated, again.repeated], [6, false, true]);
  assert.deepEqual(m.tables['發票'][0], INVOICE_HEADERS);
  assert.equal(m.tables['發票'].length, 1 + 18);
  assert.equal(m.tables['匯入紀錄'].length, 2);
  assert.equal(m.tables['匯入紀錄'][1][6], 6);
  const total = m.tables['發票'].find(r => r[C['發票號碼']] === 'BB20000002' && r[0] === '發票');
  assert.equal(total[C['金額（元）']], 4725);
});
test('two devices importing overlapping files serialize and store each invoice once', async () => {
  const m = mockSheets({ barrier: true }),
    a = await makeInvoiceImport(parseInvoiceBook(book()), { fileHash: 'A' }),
    extra = row('手機條碼', '20261024', 'II90000009', 63, '虛構超市股份有限公司', '55555555', 1, 63, '豆皮'),
    b = await makeInvoiceImport(parseInvoiceBook(book(CSV.replace(H, H + '\r\n' + extra))), {
      fileHash: 'B'
    });
  const results = await Promise.all([m.store().saveInvoices(a), m.store().saveInvoices(b)]);
  // Whichever device writes first stores its file; the other adds only what is still missing.
  assert.equal(results[0].added + results[1].added, 7);
  assert.ok(m.collisions >= 1);
  const heads = m.tables['發票'].filter(r => r[0] === '發票');
  assert.equal(heads.length, 7);
  assert.equal(new Set(heads.map(r => r[C['發票紀錄ID']])).size, 7);
  assert.equal(m.tables['匯入紀錄'].length, 3);
});
