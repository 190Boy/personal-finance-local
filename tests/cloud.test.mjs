import test from 'node:test';
import assert from 'node:assert/strict';
import { makeImport, bankSummary, HEADERS, IMPORT_HEADERS } from '../cloud/records.mjs';
import { GoogleStore } from '../cloud/google.mjs';
const transaction = (overrides = {}) => ({
  date: '2026-10-01',
  time: '10:00:00',
  summary: '虛構',
  expenseCents: 0,
  incomeCents: 10000,
  feeCents: 0,
  balanceCents: 110000,
  balanceCheck: { status: 'pass' },
  errors: [],
  ...overrides
});
const result = (bank, transactions) => ({ bank, sourceType: 'excel', transactions });
const batch = async (
  bank = '玉山銀行',
  account = '主要',
  fileHash = 'file1',
  transactions = [transaction()]
) => makeImport(result(bank, transactions), { account, fileHash, order: 'ascending' });
test('two banks sum latest account balances instead of transaction balances', async () => {
  const a = await batch('玉山銀行', '主要', 'a', [
    transaction({ date: '2026-09-01', balanceCents: 90000 }),
    transaction()
  ]);
  const b = await batch('中國信託', '主要', 'b', [transaction({ balanceCents: 250000 })]);
  const total = bankSummary([...a.rows, ...b.rows, ...a.rows]);
  assert.equal(total.totalCents, 360000);
  assert.equal(total.bankCount, 2);
});
test('older imported files do not replace newer balances; multiple accounts count separately', async () => {
  const newer = await batch(),
    older = await batch('玉山銀行', '主要', 'old', [transaction({ date: '2026-09-01', balanceCents: 1 })]);
  const other = await batch('玉山銀行', '儲蓄', 'other', [transaction({ balanceCents: 50000 })]);
  assert.equal(bankSummary([...newer.rows, ...older.rows, ...other.rows]).totalCents, 160000);
});
test('cross-file same-day unknown order blocks ambiguous account totals', async () => {
  const a = await batch('玉山銀行', '主要', 'a', [transaction({ time: null })]);
  const b = await batch('玉山銀行', '主要', 'b', [transaction({ time: null, balanceCents: 150000 })]);
  const s = bankSummary([...a.rows, ...b.rows]);
  assert.equal(s.pending.length, 1);
  assert.equal(s.balances.length, 0);
});
test('descending input uses the latest source position when times are absent', async () => {
  const b = await makeImport(
    result('玉山銀行', [
      transaction({ time: null, balanceCents: 20000 }),
      transaction({ time: null, balanceCents: 10000 })
    ]),
    { account: '主要', fileHash: 'f', order: 'descending' }
  );
  assert.equal(bankSummary(b.rows).totalCents, 20000);
});
test('mismatched balance stays excluded; a legitimate zero balance is shown', async () => {
  const fail = await batch('玉山銀行', '主要', 'a', [transaction({ balanceCheck: { status: 'fail' } })]);
  const zero = await batch('中國信託', '主要', 'b', [transaction({ balanceCents: 0 })]);
  const s = bankSummary([...fail.rows, ...zero.rows]);
  assert.equal(s.pending.length, 1);
  assert.equal(s.balances.length, 1);
  assert.equal(s.totalCents, 0);
});
test('missing account is rejected and private source/password are not included', async () => {
  await assert.rejects(batch('玉山銀行', ' '), /ACCOUNT_REQUIRED/);
  const b = await batch();
  assert.equal(b.rows[0].length, HEADERS.length);
  assert.ok(!JSON.stringify(b).includes('password'));
});
test('overlapping files produce stable row IDs but retain repeated same-file occurrences', async () => {
  const a = await batch(),
    b = await batch('玉山銀行', '主要', 'different');
  assert.equal(a.rows[0][0], b.rows[0][0]);
  assert.notEqual(a.id, b.id);
  const repeats = await batch('玉山銀行', '主要', 'r', [transaction(), transaction()]);
  assert.notEqual(repeats.rows[0][0], repeats.rows[1][0]);
});
function mockStore({ failWrite = false, logged = false } = {}) {
  let writes = 0,
    last = null;
  const rows = { 銀行存款: [HEADERS], 匯入紀錄: [IMPORT_HEADERS] };
  const s = new GoogleStore({
    fetcher: async (url, options) => {
      if (url.includes('?fields=developerMetadata'))
        return { ok: true, status: 200, json: async () => ({ developerMetadata: [] }) };
      if (url.includes('/values/')) {
        const tab = decodeURIComponent(url.split('/values/')[1].split('?')[0]).split("'")[1];
        return { ok: true, status: 200, json: async () => ({ values: rows[tab] || [] }) };
      }
      writes++;
      last = JSON.parse(options.body);
      if (failWrite) return { ok: false, status: 500 };
      for (const req of last.requests) {
        if (req.appendCells) {
          const tab = req.appendCells.sheetId === 1 ? '銀行存款' : '匯入紀錄';
          rows[tab].push(
            ...req.appendCells.rows.map(r =>
              r.values.map(c => c.userEnteredValue.stringValue ?? c.userEnteredValue.numberValue)
            )
          );
        }
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }
  });
  s.authorize('synthetic-token', 3600);
  s.file = { id: 'synthetic-sheet' };
  s.sheets = [
    { title: '銀行存款', sheetId: 1 },
    { title: '匯入紀錄', sheetId: 2 }
  ];
  return {
    s,
    rows,
    get writes() {
      return writes;
    },
    get last() {
      return last;
    }
  };
}
test('atomic save records ledger and rows once; retry does not append duplicates', async () => {
  const m = mockStore(),
    b = await batch();
  const first = await m.s.save(b),
    again = await m.s.save(b);
  assert.equal(first.added, 1);
  assert.equal(again.repeated, true);
  assert.equal(m.writes, 1);
  assert.equal(m.rows['銀行存款'].length, 2);
  assert.equal(m.last.requests.length, 3);
});
test('formula-looking bank summaries are written as stringValue, not formulas', async () => {
  const m = mockStore(),
    b = await batch('玉山銀行', '主要', 'x', [transaction({ summary: '=HYPERLINK("bad")' })]);
  await m.s.save(b);
  assert.deepEqual(m.last.requests[1].appendCells.rows[0].values[5].userEnteredValue, {
    stringValue: '=HYPERLINK("bad")'
  });
});
test('failed cloud write does not create a successful ledger entry', async () => {
  const m = mockStore({ failWrite: true });
  await assert.rejects(m.s.save(await batch()), /GOOGLE_API/);
  assert.equal(m.rows['匯入紀錄'].length, 1);
});
test('logout clears token and refuses further API access', async () => {
  const m = mockStore();
  m.s.disconnect();
  assert.equal(m.s.token, '');
  await assert.rejects(m.s.api('https://www.googleapis.com/drive/v3/files'), /GOOGLE_LOGIN_REQUIRED/);
});
test('changing accounts discards an in-flight response from the previous account', async () => {
  let finish;
  const s = new GoogleStore({
    fetcher: () =>
      new Promise(resolve => {
        finish = resolve;
      })
  });
  s.authorize('old-synthetic-token', 3600);
  const request = s.api('https://www.googleapis.com/drive/v3/files');
  s.authorize('new-synthetic-token', 3600);
  finish({ ok: true, status: 200, json: async () => ({ files: [{ id: 'old-account-file' }] }) });
  await assert.rejects(request, /GOOGLE_LOGIN_REQUIRED/);
  assert.equal(s.file, null);
});
test('changed spreadsheet headers stop writes instead of overwriting user data', async () => {
  const m = mockStore();
  m.rows['銀行存款'][0] = ['custom column'];
  await assert.rejects(m.s.save(await batch()), /SHEET_SCHEMA/);
  assert.equal(m.writes, 0);
});
