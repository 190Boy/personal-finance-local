import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerPlan, OLD_IMPORT_HEADERS, LEGACY_STOCK_HEADERS } from '../cloud/ledger.mjs';
import { IMPORT_HEADERS, HEADERS } from '../cloud/records.mjs';
import { cloudHistory, filterHistory } from '../cloud/history.mjs';
import { GoogleStore } from '../cloud/google.mjs';
test('ledger migrates stock records into categories without changing bank rows', () => {
  const bank = ['bank-id', '銀行', '主要', '銀行存款', '2026-10-01', 2, 2];
  const stock = ['stock-id', '券商', '證券', '2026-10-02', 'hash-b', 'hash-c', '人工確認'];
  const plan = ledgerPlan([OLD_IMPORT_HEADERS, bank], [LEGACY_STOCK_HEADERS, stock, stock]);
  assert.equal(plan.rewriteHeader, true);
  assert.equal(plan.rows.length, 1);
  assert.deepEqual(plan.rows[0], [
    'stock-id',
    '券商',
    '證券',
    '股票資產',
    '2026-10-02',
    '',
    '',
    'hash-b',
    'hash-c',
    '人工確認'
  ]);
  assert.equal(
    ledgerPlan([IMPORT_HEADERS, bank, ...plan.rows], [LEGACY_STOCK_HEADERS, stock]).rows.length,
    0
  );
  assert.deepEqual(bank, ['bank-id', '銀行', '主要', '銀行存款', '2026-10-01', 2, 2]);
});
test('custom ledger headers stop migration', () => {
  assert.throws(() => ledgerPlan([['custom']], [LEGACY_STOCK_HEADERS]), /SHEET_SCHEMA/);
});
test('history merges exact repeated IDs, keeps conflicts, missing IDs and legitimate same-day repeats', () => {
  const row = ['id', '銀行', '主要', '2026-10-01', '10:00:00', '測試', 10, 0, 0, 90, 'fail', '待核對'];
  const conflict = [...row];
  conflict[9] = 80;
  const legitimate = [...row];
  legitimate[0] = 'id-2';
  const noid = [...row];
  noid[0] = '';
  const v = cloudHistory([row, row, conflict, legitimate, noid], []);
  assert.equal(v.rows.length, 4);
  assert.equal(v.duplicates, 1);
  assert.equal(v.rows.filter(r => r.conflict).length, 2);
  assert.ok(v.rows.some(r => r.review.includes('待核對')));
});
test('history supports source/account/category/query/date and stock quantities', () => {
  const v = cloudHistory(
    [['b', '銀行', '主戶', '2026-10-01', '', '薪資', 0, 500, 0, 500, 'pass', '']],
    [['s', '券商', '證券', '2026-10-02', '1234', '虛構股票', '買進', 0, 20, 20]]
  );
  const found = filterHistory(v.rows, {
    kind: '股票股數',
    account: JSON.stringify(['券商', '證券']),
    query: '1234',
    from: '2026-10-02',
    to: '2026-10-02'
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].income, 20);
  assert.equal(found[0].fee, null);
});
test('migration writes header, legacy rows and hiding atomically; rerun is idempotent', async () => {
  const tables = {
      匯入紀錄: [OLD_IMPORT_HEADERS, ['bank-id', '銀行', '主戶', '銀行存款', '2026-10-01', 1, 1]],
      股票匯入紀錄: [LEGACY_STOCK_HEADERS, ['stock-id', '券商', '證券', '2026-10-02', 'b', 'c', '人工確認']]
    },
    sheets = [
      { sheetId: 1, title: '匯入紀錄' },
      { sheetId: 2, title: '股票匯入紀錄' },
      { sheetId: 3, title: '銀行存款' }
    ];
  let writes = 0;
  const store = new GoogleStore({
    fetcher: async (url, opt) => {
      let data = {};
      if (url.includes('/values/')) {
        const tab = decodeURIComponent(url.split('/values/')[1].split('?')[0]).split("'")[1];
        data = { values: tables[tab] || [] };
      } else if (opt.method === 'GET') data = { sheets: sheets.map(properties => ({ properties })) };
      else {
        writes++;
        const requests = JSON.parse(opt.body).requests;
        assert.equal(requests.filter(r => r.updateCells).length, 1);
        assert.equal(requests.filter(r => r.appendCells).length, 1);
        assert.equal(requests.filter(r => r.updateSheetProperties).length, 1);
        for (const r of requests) {
          if (r.updateCells)
            tables['匯入紀錄'][0] = r.updateCells.rows[0].values.map(v => v.userEnteredValue.stringValue);
          if (r.appendCells)
            tables['匯入紀錄'].push(
              ...r.appendCells.rows.map(r =>
                r.values.map(v => v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue)
              )
            );
          if (r.updateSheetProperties) sheets[1].hidden = true;
        }
      }
      return { ok: true, status: 200, json: async () => data };
    }
  });
  store.authorize('synthetic', 3600);
  store.file = { id: 'test' };
  store.sheets = sheets;
  await store.unifiedLog();
  await store.unifiedLog();
  assert.equal(writes, 1);
  assert.equal(tables['匯入紀錄'].length, 3);
  assert.equal(tables['股票匯入紀錄'].length, 2);
  assert.equal(sheets[1].hidden, true);
});
