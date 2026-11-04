import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBalances,
  resolveAccount,
  settingsTable,
  settingsRow,
  transferCategory,
  ACCOUNT_SETTINGS_HEADERS
} from '../cloud/balances.mjs';
import { manualEntry, manualEntries, manualRow, manualHistoryRow } from '../cloud/manual.mjs';
import { categorize, monthTotals } from '../cloud/categories.mjs';
import { GoogleStore } from '../cloud/google.mjs';
import { HEADERS, IMPORT_HEADERS } from '../cloud/records.mjs';

const names = [
  '現金',
  '玉山銀行／玉山銀行帳戶',
  '中國信託／中信銀行帳戶',
  '中國信託／中信信用卡',
  '凱基銀行／凱基信用卡',
  'LINE Pay 錢包'
];
test('older free-text payment methods resolve to accounts', () => {
  assert.equal(resolveAccount('玉山帳戶', names), '玉山銀行／玉山銀行帳戶');
  assert.equal(resolveAccount('中信卡 LINE Pay', names), '中國信託／中信信用卡');
  assert.equal(resolveAccount('LINE Pay 錢包', names), 'LINE Pay 錢包');
  assert.equal(resolveAccount('悠遊卡', names), '悠遊卡');
  assert.equal(resolveAccount('', names), '');
});

let n = 0;
const entry = (type, date, amount, method, extra = {}) =>
  manualEntries([
    manualRow(manualEntry({ id: 'e' + ++n, type, date, amount, method, category: '餐飲', ...extra }))
  ])[0];
test('balances start from the last statement or notice and add later hand entries', () => {
  const settings = settingsTable([
    ACCOUNT_SETTINGS_HEADERS,
    ['現金', 1000, '2026-10-01', '', '2026-10-01T00:00:00Z'],
    ['現金', 1500, '2026-10-02', '', '2026-10-02T00:00:00Z'],
    ['悠遊卡', 300, '2026-10-01', '', '2026-10-01T00:00:00Z']
  ]);
  const bankRows = [
    ['w1', '玉山銀行', '玉山銀行帳戶', '2026-10-05', '', 'ATM提款', 2000, 0],
    ['w0', '玉山銀行', '玉山銀行帳戶', '2026-10-01', '', 'ATM提款', 9999, 0],
    ['t1', '玉山銀行', '玉山銀行帳戶', '2026-10-06', '', '轉帳提', 500, 0]
  ];
  const manual = [
    entry('支出', '2026-10-06', '85', '現金'),
    entry('支出', '2026-10-01', '50', '現金'),
    entry('收入', '2026-10-07', '200', '現金'),
    entry('轉帳', '2026-10-08', '300', '現金', { party: 'LINE Pay 錢包', category: '內部轉帳／儲值' }),
    entry('支出', '2026-10-20', '100', '玉山帳戶'),
    entry('支出', '2026-10-10', '999', '玉山帳戶'),
    entry('支出', '2026-10-21', '35', 'LINE Pay 錢包'),
    entry('支出', '2026-10-09', '20', '悠遊卡')
  ];
  const b = computeBalances({
    bankBalances: [{ bank: '玉山銀行', account: '玉山銀行帳戶', date: '2026-10-17', cents: 923480 }],
    bankRows,
    credits: { accounts: [{ bank: '凱基銀行', account: '凱基信用卡', month: '2026-10', cents: 783000 }] },
    wallet: { lastBalance: { date: '2026-10-20', cents: 522200 } },
    manual,
    settings
  });
  const by = name => b.accounts.find(a => a.name === name);
  // Bank: statement balance on 10/17, minus the hand entry on 10/20 only.
  assert.equal(by('玉山銀行／玉山銀行帳戶').cents, 923480 - 10000);
  // Wallet: last notice on 10/20, minus 35 on 10/21; the 10/08 top-up is before the notice.
  assert.equal(by('LINE Pay 錢包').cents, 522200 - 3500);
  // Cash: 1,500 counted on 10/02 (the latest setting), + 2,000 withdrawn, − 85 + 200 − 300 transferred.
  assert.equal(by('現金').cents, 150000 + 200000 - 8500 + 20000 - 30000);
  assert.equal(by('悠遊卡').cents, 30000 - 2000);
  assert.equal(by('凱基銀行／凱基信用卡').cents, -783000);
  assert.ok(by('凱基銀行／凱基信用卡').liability);
  assert.equal(b.liabilitiesCents, 783000);
  assert.equal(b.assetsCents, 913480 + 518700 + 331500 + 28000);
  assert.ok(b.names.includes('悠遊卡'));
});
test('without a cash setting or wallet import the balances say so', () => {
  const b = computeBalances({ manual: [entry('支出', '2026-10-06', '85', 'LINE Pay 錢包')] });
  assert.ok(b.accounts.find(a => a.name === '現金').partial);
  const wallet = b.accounts.find(a => a.name === 'LINE Pay 錢包');
  assert.deepEqual([wallet.cents, wallet.partial], [-8500, true]);
});
test('transfers need two different accounts, stay out of totals and get a category from the destination', () => {
  assert.throws(
    () =>
      manualEntry({ id: 'x', type: '轉帳', date: '2026-10-01', amount: '1', method: '現金', party: '現金' }),
    /MANUAL_TRANSFER/
  );
  assert.equal(transferCategory('現金'), '內部轉帳／提款');
  assert.equal(transferCategory('LINE Pay 錢包'), '內部轉帳／儲值');
  assert.equal(transferCategory('凱基銀行／凱基信用卡'), '內部轉帳／繳卡費');
  assert.equal(transferCategory('中國信託／中信銀行帳戶'), '內部轉帳／帳戶互轉');
  const t = entry('轉帳', '2026-10-08', '300', '玉山銀行／玉山銀行帳戶', {
    party: '現金',
    category: '內部轉帳／提款'
  });
  const row = manualHistoryRow(t, 0);
  assert.equal(row.summary, '轉帳：玉山銀行／玉山銀行帳戶 → 現金');
  categorize([row]);
  assert.equal(row.category, '內部轉帳／提款');
  assert.deepEqual(monthTotals([row]), { expenseCents: 0, incomeCents: 0 });
});

function sheetsApi(tables) {
  const sheets = Object.keys(tables).map((title, i) => ({ title, sheetId: i + 1 }));
  const decode = rows =>
    rows.map(r => r.values.map(v => v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue));
  const fetcher = async (url, opt) => {
    let data = {};
    if (url.includes('?fields=developerMetadata')) data = { developerMetadata: [] };
    else if (url.includes('?fields=sheets.properties'))
      data = { sheets: sheets.map(properties => ({ properties })) };
    else if (url.includes('/values/')) {
      const tab = decodeURIComponent(url.split('/values/')[1].split('?')[0]).split("'")[1];
      if (opt.method === 'PUT') tables[tab] = JSON.parse(opt.body).values;
      else data = { values: structuredClone(tables[tab] || []) };
    } else
      for (const r of JSON.parse(opt.body).requests) {
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
test('the summary carries balances; a cash setting is saved and used', async () => {
  const bankRow = [
    'b1',
    '玉山銀行',
    '玉山銀行帳戶',
    '2026-10-17',
    '12:00:00',
    '薪水',
    0,
    1000,
    '',
    5000,
    'pass'
  ];
  const tables = {
    匯入紀錄: [IMPORT_HEADERS],
    銀行存款: [HEADERS, [...bankRow, ...Array(HEADERS.length - bankRow.length).fill('')]]
  };
  const store = sheetsApi(tables);
  await store.metadata();
  let r = await store.summary();
  assert.equal(r.balances.accounts.find(a => a.name === '玉山銀行／玉山銀行帳戶').cents, 500000);
  await store.saveAccountSetting(settingsRow('現金', 120000, '2026-10-20'));
  assert.equal(tables['帳戶設定'].length, 2);
  r = await store.summary();
  assert.equal(r.balances.accounts.find(a => a.name === '現金').cents, 120000);
});
