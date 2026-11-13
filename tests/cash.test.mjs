import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeEntry,
  parseCents,
  ledger,
  cashNow,
  monthSummary,
  mergeEntries,
  mergeSetting,
  latest,
  readLog,
  logRow,
  detailRows,
  monthRows,
  readSetting,
  settingRows,
  LOG_HEADERS,
  DETAIL_HEADERS
} from '../cloud/cash.mjs';
import { CashLocal } from '../cloud/cash-local.mjs';
import { CashStore, FILE_NAME } from '../cloud/cash-store.mjs';

let n = 0;
const e = (type, date, amount, extra = {}) =>
  makeEntry({
    id: 'e' + ++n,
    type,
    date,
    amount,
    category: type === '支出' ? '餐飲／午餐' : type === '收入' ? '其他收入／收到轉帳' : '',
    createdAt: '2026-11-01T00:00:0' + (n % 10) + 'Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...extra
  });

test('a record needs a date, a positive amount and, for spending or income, a category', () => {
  assert.equal(parseCents('1,234.5'), 123450);
  assert.ok(Number.isNaN(parseCents('-3')));
  assert.throws(
    () => makeEntry({ id: 'x', type: '支出', date: '2026-11-31x', amount: '1', category: '餐飲' }),
    /CASH_DATE/
  );
  assert.throws(
    () => makeEntry({ id: 'x', type: '支出', date: '2026-11-03', amount: '0', category: '餐飲' }),
    /CASH_AMOUNT/
  );
  assert.throws(() => makeEntry({ id: 'x', type: '支出', date: '2026-11-03', amount: '5' }), /CASH_CATEGORY/);
  assert.throws(() => makeEntry({ id: 'x', type: '轉帳', date: '2026-11-03', amount: '5' }), /CASH_TYPE/);
  // A withdrawal has no category even if one was sent.
  assert.equal(
    makeEntry({ id: 'x', type: '提款', date: '2026-11-03', amount: '1000', category: '餐飲' }).category,
    ''
  );
});

test('cash counts from 00:00 on the setting day forwards and is worked out backwards before it', () => {
  const setting = { cents: 300000, date: '2026-11-04', updatedAt: 'x' };
  const list = [
    e('支出', '2026-11-02', '500'),
    e('提款', '2026-11-03', '2000'),
    e('支出', '2026-11-04', '120', { time: '08:00' }),
    e('提款', '2026-11-04', '1000', { time: '12:00' }),
    e('存入', '2026-11-05', '300'),
    e('收入', '2026-11-06', '1000'),
    e('支出', '2026-11-06', '9', { deleted: true })
  ];
  const rows = ledger(list, setting);
  assert.deepEqual(
    rows.map(r => [r.date, r.flowCents, r.balanceCents]),
    [
      ['2026-11-02', -50000, 100000],
      ['2026-11-03', 200000, 300000],
      ['2026-11-04', -12000, 288000],
      ['2026-11-04', 100000, 388000],
      ['2026-11-05', -30000, 358000],
      ['2026-11-06', 100000, 458000]
    ]
  );
  assert.equal(cashNow(list, setting), 458000);
  // Without a setting everything counts from 0.
  assert.equal(cashNow(list, null), -50000 + 200000 - 12000 + 100000 - 30000 + 100000);
  const m = monthSummary(list, '2026-11');
  assert.deepEqual(
    [m.expenseCents, m.incomeCents, m.withdrawCents, m.depositCents, m.count],
    [62000, 100000, 300000, 30000, 6]
  );
  assert.deepEqual(m.byCategory, [{ name: '餐飲', cents: 62000 }]);
  const detail = detailRows(rows);
  assert.deepEqual(detail[0], DETAIL_HEADERS);
  assert.deepEqual(detail[1].slice(0, 10), [
    '2026-11-02',
    '',
    '支出',
    500,
    -500,
    '餐飲',
    '午餐',
    '',
    '',
    1000
  ]);
  assert.deepEqual(monthRows(rows)[1], ['2026-11', 620, 1000, 3000, 300, 6, 4580]);
});

test('the newer version of a record or setting wins in either direction', () => {
  const a = e('支出', '2026-11-03', '100', { id: 'same', updatedAt: '2026-11-03T01:00:00Z' });
  const b = { ...a, amountCents: 20000, updatedAt: '2026-11-03T02:00:00Z' };
  let r = mergeEntries(new Map([['same', b]]), new Map([['same', a]]));
  assert.equal(r.merged.get('same').amountCents, 20000);
  assert.deepEqual(r.upload, [b]);
  r = mergeEntries(new Map([['same', a]]), new Map([['same', b]]));
  assert.equal(r.merged.get('same').amountCents, 20000);
  assert.deepEqual(r.upload, []);
  assert.equal(latest([b, a]).get('same'), b);
  assert.equal(mergeSetting({ updatedAt: '2' }, { updatedAt: '1' }).updatedAt, '2');
  assert.equal(mergeSetting(null, { updatedAt: '1' }).updatedAt, '1');
  // The log round-trips, and a row edited by hand into nonsense is skipped.
  const back = readLog([LOG_HEADERS, logRow(b), ['bad', 'x']]);
  assert.deepEqual(back, [b]);
  assert.throws(() => readLog([['ID']]), /SHEET_SCHEMA/);
  const setting = { cents: 123450, date: '2026-11-13', updatedAt: '2026-11-13T03:00:00Z' };
  assert.deepEqual(readSetting(settingRows(setting, 0)), setting);
  assert.equal(readSetting(settingRows(null, 0)), null);
});

function memoryStorage() {
  const m = new Map();
  return {
    getItem: k => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
}
test('records stay on the phone until synced; edits made during a sync stay pending', () => {
  const storage = memoryStorage();
  const local = new CashLocal(storage);
  const a = e('支出', '2026-11-03', '100', { id: 'a' });
  local.put(a);
  local.setSetting(100000, '2026-11-01', '2026-11-01T00:00:00Z');
  assert.equal(local.pendingCount, 2);
  assert.equal(new CashLocal(storage).entries.length, 1);
  // The sync took a snapshot; meanwhile the user edits `a` again.
  const sheet = new Map([['a', a]]);
  const edited = { ...a, amountCents: 999, updatedAt: '2026-11-03T09:00:00Z' };
  local.put(edited);
  local.synced({ entries: sheet, setting: local.setting, fileId: 'f' });
  assert.equal(local.map.get('a').amountCents, 999);
  assert.equal(local.pendingCount, 1);
  local.synced({ entries: new Map([['a', edited]]), setting: local.setting, fileId: 'f' });
  assert.equal(local.pendingCount, 0);
  local.remove(edited, '2026-11-03T10:00:00Z');
  assert.equal(local.live.length, 0);
  assert.equal(local.pendingCount, 1);
});

// A tiny stand-in for the Drive and Sheets APIs, enough to run real syncs.
function fakeGoogle() {
  const files = [],
    books = new Map();
  const json = data => ({ ok: true, status: 200, json: async () => data });
  const fetcher = async (url, opt = {}) => {
    const u = new URL(url),
      body = opt.body ? JSON.parse(opt.body) : null;
    if (u.pathname === '/drive/v3/files' && opt.method === 'POST') {
      const f = {
        id: 'sheet' + (files.length + 1),
        name: body.name,
        webViewLink: 'https://x',
        appProperties: body.appProperties
      };
      files.push(f);
      books.set(f.id, { sheets: [{ sheetId: 0, title: '工作表1' }], values: { 工作表1: [] } });
      return json(f);
    }
    if (u.pathname === '/drive/v3/files') return json({ files });
    const [, id, rest = ''] = u.pathname.match(/\/v4\/spreadsheets\/([^/:]+)(.*)$/);
    const book = books.get(id);
    const tab = r => decodeURIComponent(r).split("'")[1];
    if (rest === '') return json({ sheets: book.sheets.map(properties => ({ properties })) });
    if (rest === ':batchUpdate') {
      for (const r of body.requests) {
        if (r.addSheet) {
          book.sheets.push({ sheetId: book.sheets.length + 10, title: r.addSheet.properties.title });
          book.values[r.addSheet.properties.title] = [];
        }
        if (r.updateSheetProperties) {
          const s = book.sheets.find(x => x.sheetId === r.updateSheetProperties.properties.sheetId);
          delete book.values[s.title];
          s.title = r.updateSheetProperties.properties.title;
          book.values[s.title] = [];
        }
      }
      return json({});
    }
    if (rest === '/values:batchClear') {
      for (const r of body.ranges) book.values[tab(r)] = [];
      return json({});
    }
    if (rest === '/values:batchUpdate') {
      for (const d of body.data) book.values[tab(d.range)] = d.values;
      return json({});
    }
    const name = tab(rest.split('/values/')[1].split(':')[0]);
    if (rest.endsWith(':append')) book.values[name].push(...body.values);
    else if (opt.method === 'PUT') book.values[name] = body.values;
    else return json({ values: structuredClone(book.values[name]) });
    return json({});
  };
  return { fetcher, files, books };
}

test('the first sync creates 現金記帳; a second device merges, edits and deletes through the log', async () => {
  const g = fakeGoogle();
  const phone = new CashStore({ fetcher: g.fetcher });
  phone.authorize('t', 3600);
  await phone.open();
  assert.equal(g.files.length, 1);
  assert.equal(g.files[0].name, FILE_NAME);
  const book = g.books.get('sheet1');
  assert.deepEqual(
    book.sheets.map(s => s.title),
    ['記帳明細', '月份統計', '設定', '異動紀錄']
  );
  const lunch = e('支出', '2026-11-13', '160', { id: 'lunch' });
  const setting = { cents: 350000, date: '2026-11-13', updatedAt: '2026-11-13T01:00:00Z' };
  let r = await phone.sync(new Map([['lunch', lunch]]), setting);
  assert.equal(r.uploaded, 1);
  assert.deepEqual(book.values['記帳明細'][1].slice(0, 10), [
    '2026-11-13',
    '',
    '支出',
    160,
    -160,
    '餐飲',
    '午餐',
    '',
    '',
    3340
  ]);
  assert.equal(book.values['設定'][4][1], 3340);

  // Another device opens the same file (no new file), sees the record and the setting.
  const tablet = new CashStore({ fetcher: g.fetcher });
  tablet.authorize('t', 3600);
  await tablet.open();
  assert.equal(g.files.length, 1);
  r = await tablet.sync(new Map(), null);
  assert.equal(r.entries.get('lunch').amountCents, 16000);
  assert.deepEqual(r.setting, setting);
  // It edits the amount; then the phone deletes it later. Deleted records leave 記帳明細 but stay in the log.
  await tablet.sync(
    new Map([['lunch', { ...lunch, amountCents: 18000, updatedAt: '2026-11-13T05:00:00Z' }]]),
    null
  );
  r = await phone.sync(new Map([['lunch', lunch]]), setting);
  assert.equal(r.entries.get('lunch').amountCents, 18000);
  await phone.sync(
    new Map([['lunch', { ...r.entries.get('lunch'), deleted: true, updatedAt: '2026-11-13T06:00:00Z' }]]),
    setting
  );
  assert.equal(book.values['記帳明細'].length, 1);
  assert.equal(book.values['異動紀錄'].length, 4);
  assert.equal(book.values['設定'][4][1], 3500);
});
