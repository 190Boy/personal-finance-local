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
  makeOption,
  optionKey,
  mergeOptions,
  readOptions,
  optionRows,
  channelList,
  channelGroups,
  searchWords,
  matchesSearch,
  transferAccounts,
  categoryTree,
  readDetailEdits,
  inOrder,
  nextRank,
  placeInDay,
  makeWallet,
  balanceNow,
  readWalletSetting,
  LOG_HEADERS_V1,
  LOG_HEADERS,
  DETAIL_HEADERS
} from '../cloud/cash.mjs';
import { CashLocal } from '../cloud/cash-local.mjs';
import { CashStore, FILE_NAME } from '../cloud/cash-store.mjs';
import { CATEGORY_TREE } from '../cloud/categories.mjs';

// Read and write sheet cells by column name, as the BOT is told to.
const at = (values, row, name) => values[row][values[0].indexOf(name)];
const pick = (values, row, names) => names.map(n => at(values, row, n));

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
  assert.deepEqual(
    pick(detail, 1, [
      '日期',
      '排序',
      '類型',
      '渠道',
      '轉入',
      '金額（元）',
      '增減（元）',
      '主分類',
      '子分類',
      '記帳後現金（元）'
    ]),
    ['2026-11-02', 1, '支出', '現金', '', 500, -500, '餐飲', '午餐', 1000]
  );
  assert.deepEqual(monthRows(rows)[1], ['2026-11', '現金', 620, 1000, 3000, 300, 0, 6, 4580]);
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
  assert.deepEqual(
    settingRows(setting, 0)
      .find(r => r[0] === '資料格式版本')
      .slice(0, 2),
    ['資料格式版本', 8]
  );
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
    // Like the real API: writing at A1 overwrites only the rows sent.
    else if (opt.method === 'PUT') book.values[name].splice(0, body.values.length, ...body.values);
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
    ['記帳明細', '月份統計', '錢包', '設定', '選項', '異動紀錄']
  );
  const lunch = e('支出', '2026-11-13', '160', { id: 'lunch' });
  const setting = { cents: 350000, date: '2026-11-13', updatedAt: '2026-11-13T01:00:00Z' };
  let r = await phone.sync(new Map([['lunch', lunch]]), setting);
  assert.equal(r.uploaded, 1);
  assert.deepEqual(
    pick(book.values['記帳明細'], 1, [
      '日期',
      '類型',
      '渠道',
      '金額（元）',
      '增減（元）',
      '主分類',
      '子分類',
      '記帳後現金（元）'
    ]),
    ['2026-11-13', '支出', '現金', 160, -160, '餐飲', '午餐', 3340]
  );
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

test('only cash records move the cash balance; other channels are listed for reference', () => {
  const setting = { cents: 100000, date: '2026-11-01', updatedAt: 'x' };
  const list = [
    e('支出', '2026-11-02', '200'),
    e('支出', '2026-11-02', '890', { channel: '信用卡', category: '購物／網購' }),
    e('收入', '2026-11-03', '50000', { channel: '銀行', category: '薪資／薪水' }),
    // A withdrawal is always cash, whatever channel was sent.
    e('提款', '2026-11-04', '3000', { channel: '銀行' })
  ];
  assert.equal(list[3].channel, '現金');
  assert.throws(
    () =>
      makeEntry({ id: 'x', type: '支出', date: '2026-11-03', amount: '1', category: '餐飲', channel: ' ' }),
    /CASH_CHANNEL/
  );
  assert.equal(cashNow(list, setting), 100000 - 20000 + 300000);
  const rows = ledger(list, setting);
  assert.deepEqual(
    rows.map(r => [r.channel, r.amountSigned, r.balanceCents]),
    [
      ['現金', -20000, 80000],
      ['信用卡', -89000, null],
      ['銀行', 5000000, null],
      ['現金', 300000, 380000]
    ]
  );
  assert.deepEqual(pick(detailRows(rows), 2, ['渠道', '金額（元）', '增減（元）', '記帳後現金（元）']), [
    '信用卡',
    890,
    -890,
    ''
  ]);
  const months = monthRows(rows).slice(1);
  assert.deepEqual(
    months.map(r => [r[1], r[2], r[3], r[8]]),
    [
      ['現金', 200, 0, 3800],
      ['信用卡', 890, 0, ''],
      ['銀行', 0, 50000, '']
    ]
  );
  assert.equal(monthSummary(list, '2026-11').expenseCents, 109000);
  assert.equal(monthSummary(list, '2026-11', '信用卡').expenseCents, 89000);
});

test('your own channels and categories merge by last change and add to the built-in ones', () => {
  const at = t => '2026-11-13T0' + t + ':00:00Z';
  const local = new Map(
    [
      makeOption({ kind: '渠道', name: '悠遊卡', updatedAt: at(1) }),
      makeOption({ kind: '支出分類', name: '寵物', icon: '🐶', updatedAt: at(1) }),
      makeOption({ kind: '支出分類', name: '飼料', parent: '寵物', updatedAt: at(1) }),
      makeOption({ kind: '支出分類', name: '早午餐', parent: '餐飲', updatedAt: at(1) }),
      makeOption({ kind: '收入分類', name: '二手拍賣', updatedAt: at(1) })
    ].map(o => [optionKey(o), o])
  );
  const removed = makeOption({ kind: '渠道', name: '悠遊卡', deleted: true, updatedAt: at(2) });
  const merged = mergeOptions(local, new Map([[optionKey(removed), removed]]));
  const defaults = ['現金', 'LINE Pay', '玉山銀行', '中信銀行', '凱基信用卡', '中信信用卡'];
  assert.deepEqual(channelList(merged), defaults);
  assert.deepEqual(channelList(local), [...defaults, '悠遊卡']);
  // A channel you added yourself that is now a default appears once.
  const dup = makeOption({ kind: '渠道', name: '玉山銀行' });
  assert.deepEqual(channelList(new Map([[optionKey(dup), dup]])), defaults);
  const spend = categoryTree(CATEGORY_TREE.支出, merged, '支出');
  const pet = spend.find(c => c.name === '寵物');
  assert.deepEqual([pet.icon, pet.subs, pet.own], ['🐶', ['飼料'], true]);
  const food = spend.find(c => c.name === '餐飲');
  assert.ok(food.subs.includes('早午餐') && food.subs.includes('午餐'));
  assert.deepEqual(food.ownSubs, ['早午餐']);
  assert.ok(categoryTree(CATEGORY_TREE.收入, merged, '收入').some(c => c.name === '二手拍賣'));
  // The sheet round-trips, including the removal.
  assert.deepEqual(readOptions(optionRows(merged)), merged);
  assert.throws(() => makeOption({ kind: '渠道', name: '  ' }), /OPTION_NAME/);
  // A name cannot contain the main／sub separator.
  assert.equal(makeOption({ kind: '支出分類', name: '外食／聚餐' }).name, '外食/聚餐');
});

test('a v1.0.0 sheet without the 渠道 column reads as cash and gets the new header on the next sync', async () => {
  const old = [LOG_HEADERS_V1, logRow(e('支出', '2026-11-13', '160', { id: 'old' })).slice(0, 11)];
  assert.equal(readLog(old)[0].channel, '現金');
  const g = fakeGoogle();
  const s = new CashStore({ fetcher: g.fetcher });
  s.authorize('t', 3600);
  await s.open();
  const book = g.books.get('sheet1');
  book.values['異動紀錄'] = old;
  await s.ensureSheets();
  assert.equal(book.values['異動紀錄'][0].at(-1), '排序');
  const opt = makeOption({ kind: '渠道', name: '悠遊卡' });
  const r = await s.sync(new Map(), null, new Map([[optionKey(opt), opt]]));
  assert.equal(r.entries.get('old').channel, '現金');
  assert.deepEqual(book.values['選項'][1].slice(0, 5), ['渠道', '悠遊卡', '', '', '使用中']);
  assert.equal(at(book.values['記帳明細'], 1, '渠道'), '現金');
});

test('options added on the phone stay pending until the sheet has them', () => {
  const local = new CashLocal(memoryStorage());
  const o = makeOption({ kind: '支出分類', name: '寵物', updatedAt: '2026-11-13T01:00:00Z' });
  local.putOption(o);
  assert.equal(local.pendingCount, 1);
  local.synced({ entries: new Map(), setting: null, options: new Map([[optionKey(o), o]]), fileId: 'f' });
  assert.equal(local.pendingCount, 0);
  assert.equal(local.options.get(optionKey(o)).name, '寵物');
});

test('rows typed in 記帳明細 come back: new rows, edits, 刪除, loose formats; bad rows are reported', () => {
  const old = makeEntry({
    id: 'k1',
    type: '支出',
    date: '2026-11-10',
    amount: '160',
    category: '餐飲／午餐',
    createdAt: '2026-11-10T01:00:00Z',
    updatedAt: '2026-11-10T01:00:00Z'
  });
  const gone = { ...old, id: 'k2', amountCents: 5000 };
  const known = new Map([
    ['k1', old],
    ['k2', gone]
  ]);
  const sheet = detailRows(ledger([old, gone], null));
  // The rows the app wrote come back unchanged.
  assert.deepEqual(readDetailEdits(sheet, known), { changes: [], problems: [] });
  let n = 0;
  const opts = { now: '2026-11-13T08:00:00Z', newId: () => 'new' + ++n };
  const typed = structuredClone(sheet);
  typed[1][typed[0].indexOf('金額（元）')] = 180; // edit the amount of k1
  typed[2][typed[0].indexOf('類型')] = '刪除'; // delete k2
  const blank = DETAIL_HEADERS.map(() => '');
  const row = values => DETAIL_HEADERS.map(h => values[h] ?? '');
  typed.push(
    blank,
    row({
      日期: '2026/11/13',
      時間: '下午 2:30',
      '金額（元）': '1,200',
      主分類: '交通',
      子分類: '計程車',
      渠道: ''
    }),
    row({ 日期: '2026年11月13日', '金額（元）': 45, 類型: '收入' }),
    row({ 日期: '11/13', '金額（元）': 10 }),
    row({ 日期: '2026-11-13', '金額（元）': 'abc' })
  );
  const r = readDetailEdits(typed, known, opts);
  assert.deepEqual(r.problems, [
    { row: 7, reason: '日期看不懂，請用 2026-11-13 或 2026/11/13' },
    { row: 8, reason: '金額要是大於 0 的數字' }
  ]);
  const by = new Map(r.changes.map(e => [e.id, e]));
  assert.equal(by.get('k1').amountCents, 18000);
  assert.equal(by.get('k1').createdAt, old.createdAt);
  assert.equal(by.get('k2').deleted, true);
  assert.deepEqual(
    [
      by.get('new1').date,
      by.get('new1').rank,
      by.get('new1').type,
      by.get('new1').amountCents,
      by.get('new1').category,
      by.get('new1').channel
    ],
    ['2026-11-13', 1, '支出', 120000, '交通／計程車', '現金']
  );
  assert.equal(by.get('new2').category, '其他收入');
  assert.equal(by.get('new2').rank, 2); // a blank 排序 puts a typed row last on its day
  // Serial numbers from the spreadsheet also read as dates, and as times on a sheet from before v1.8.0.
  const oldHead = DETAIL_HEADERS.map(h => (h === '排序' ? '時間' : h));
  const serial = readDetailEdits(
    [oldHead, oldHead.map(h => ({ 日期: 46339, 時間: 0.5, '金額（元）': 1 })[h] ?? '')],
    new Map(),
    opts
  );
  assert.deepEqual([serial.changes[0].date, serial.changes[0].time], ['2026-11-13', '12:00']);
  // A renamed header stops everything.
  const broken = structuredClone(sheet);
  broken[0][0] = '日子';
  assert.match(readDetailEdits(broken, known).problems[0].reason, /找不到欄位：日期/);
});

test('a sync takes rows typed in the sheet, and refuses to overwrite a sheet with an unreadable row', async () => {
  const g = fakeGoogle();
  const s = new CashStore({ fetcher: g.fetcher });
  s.authorize('t', 3600);
  await s.open();
  const book = g.books.get('sheet1');
  const lunch = e('支出', '2026-11-13', '160', { id: 'lunch' });
  await s.sync(new Map([['lunch', lunch]]), null);
  const row = values => DETAIL_HEADERS.map(h => values[h] ?? '');
  book.values['記帳明細'].push(
    row({ 日期: '2026/11/13', '金額（元）': 85, 主分類: '餐飲', 子分類: '飲料', '對象／商店': '50嵐' })
  );
  let r = await s.sync(new Map([['lunch', lunch]]), null);
  assert.equal(r.fromSheet, 1);
  const tea = [...r.entries.values()].find(x => x.party === '50嵐');
  assert.ok(tea && tea.id);
  // It now has an ID in the sheet and a row in the log.
  assert.ok(book.values['記帳明細'].some(x => x[book.values['記帳明細'][0].indexOf('ID')] === tea.id));
  assert.ok(book.values['異動紀錄'].some(x => x[0] === tea.id));
  // A second sync changes nothing.
  r = await s.sync(r.entries, null);
  assert.equal(r.fromSheet, 0);
  // An unreadable row: the sync stops and the sheet keeps what the user typed.
  book.values['記帳明細'].push(row({ 日期: '昨天', '金額（元）': 30 }));
  const before = JSON.stringify(book.values);
  await assert.rejects(
    () => s.sync(r.entries, null),
    e => e.message === 'SHEET_ROWS' && e.problems[0].row === book.values['記帳明細'].length
  );
  assert.equal(JSON.stringify(book.values), before);
});

test('LINE Pay keeps its own balance like cash; a top-up moves money from its source into LINE Pay', () => {
  const cashSet = { cents: 300000, date: '2026-11-15', updatedAt: 'x' };
  const walletSet = { cents: 233900, date: '2026-11-15', updatedAt: 'x' };
  const list = [
    e('支出', '2026-11-14', '50', { channel: 'LINE Pay' }),
    e('支出', '2026-11-15', '85', { channel: 'LINE Pay', time: '09:00' }),
    e('儲值', '2026-11-15', '1000', { channel: '現金', time: '10:00' }),
    e('儲值', '2026-11-15', '2000', { channel: '玉山銀行', time: '11:00' }),
    e('收入', '2026-11-16', '300', { channel: 'LINE Pay', category: '其他收入／收到轉帳' }),
    e('支出', '2026-11-16', '120', { time: '12:00' })
  ];
  assert.throws(() => e('儲值', '2026-11-15', '1', { channel: 'LINE Pay' }), /CASH_TOPUP/);
  assert.equal(list[2].category, '');
  // LINE Pay: 2,339 − 85 + 1,000 + 2,000 + 300; the 11/14 payment is before the setting day.
  assert.equal(balanceNow(list, walletSet, 'LINE Pay'), 233900 - 8500 + 100000 + 200000 + 30000);
  // Cash: the top-up from cash takes 1,000 out; the bank top-up does not touch cash.
  assert.equal(balanceNow(list, cashSet, '現金'), 300000 - 100000 - 12000);
  const rows = ledger(list, cashSet, walletSet);
  assert.deepEqual(
    rows.map(r => [r.type, r.channel, r.balanceCents, r.walletCents]),
    [
      ['支出', 'LINE Pay', null, 233900],
      ['支出', 'LINE Pay', null, 225400],
      ['儲值', '現金', 200000, 325400],
      ['儲值', '玉山銀行', null, 525400],
      ['收入', 'LINE Pay', null, 555400],
      ['支出', '現金', 188000, null]
    ]
  );
  // 記帳明細 has the LINE Pay balance next to the cash balance.
  assert.deepEqual(
    pick(detailRows(rows), 3, ['類型', '渠道', '轉入', '增減（元）', '記帳後現金（元）', '記帳後錢包（元）']),
    ['儲值', '現金', 'LINE Pay', -1000, 2000, 3254]
  );
  // 月份統計: top-ups are counted on the LINE Pay row, which also has its month-end balance.
  const months = monthRows(rows).slice(1);
  const lp = months.find(r => r[1] === 'LINE Pay'),
    cash = months.find(r => r[1] === '現金');
  assert.deepEqual([lp[2], lp[3], lp[6], lp[7], lp[8]], [135, 300, 3000, 5, 5554]);
  assert.deepEqual([cash[2], cash[8]], [120, 1880]);
  // The month summary: top-ups are not spending; filtering by LINE Pay includes them.
  const m = monthSummary(list, '2026-11');
  assert.deepEqual([m.expenseCents, m.incomeCents, m.topupCents], [25500, 30000, 300000]);
  assert.equal(monthSummary(list, '2026-11', 'LINE Pay').topupCents, 300000);
  assert.equal(monthSummary(list, '2026-11', '現金').topupCents, 100000);
  // 設定 keeps cash only; wallet balances are in the 錢包 sheet.
  assert.deepEqual(readSetting(settingRows(cashSet, 0)), cashSet);
  assert.equal(readWalletSetting(settingRows(cashSet, 0)), null);
});

test('wallets and their starting balances sync through the 錢包 sheet and reach a second device', async () => {
  const g = fakeGoogle();
  const phone = new CashStore({ fetcher: g.fetcher });
  phone.authorize('t', 3600);
  await phone.open();
  const lp = makeWallet({
    name: 'LINE Pay',
    cents: 233900,
    date: '2026-11-15',
    updatedAt: '2026-11-15T09:00:00Z'
  });
  const easy = makeWallet({
    name: '悠遊卡',
    cents: 50000,
    date: '2026-11-15',
    updatedAt: '2026-11-15T09:00:00Z'
  });
  const wallets = new Map([
    ['LINE Pay', lp],
    ['悠遊卡', easy]
  ]);
  const pay = e('支出', '2026-11-15', '85', { id: 'pay', channel: 'LINE Pay' });
  const bus = e('支出', '2026-11-15', '15', {
    id: 'bus',
    channel: '悠遊卡',
    category: '交通／大眾運輸',
    time: '09:00'
  });
  const top = e('儲值', '2026-11-15', '500', { id: 'top', channel: '現金', to: '悠遊卡', time: '08:00' });
  let r = await phone.sync(
    new Map([
      ['pay', pay],
      ['bus', bus],
      ['top', top]
    ]),
    null,
    new Map(),
    wallets
  );
  assert.deepEqual(r.wallets.get('悠遊卡'), easy);
  const book = g.books.get('sheet1');
  const sheet = book.values['錢包'];
  const row = name => sheet.find(x => x[0] === name);
  assert.deepEqual(sheet[0], [
    '錢包',
    '起始餘額（元）',
    '起始日期',
    '設定更新時間',
    '目前餘額（元）',
    '狀態'
  ]);
  assert.deepEqual(row('LINE Pay').slice(0, 5).concat(row('LINE Pay')[5]), [
    'LINE Pay',
    2339,
    '2026-11-15',
    lp.updatedAt,
    2254,
    '使用中'
  ]);
  assert.deepEqual([row('悠遊卡')[1], row('悠遊卡')[4]], [500, 985]);
  // 記帳明細: each record shows the balance of the wallet it moved.
  const detail = book.values['記帳明細'];
  const byId = id => detail.findIndex(x => x[detail[0].indexOf('ID')] === id);
  assert.equal(at(detail, byId('pay'), '記帳後錢包（元）'), 2254);
  assert.deepEqual(pick(detail, byId('top'), ['轉入', '記帳後錢包（元）']), ['悠遊卡', 1000]);
  assert.equal(at(detail, byId('bus'), '記帳後錢包（元）'), 985);
  // 設定 no longer carries LINE Pay rows.
  assert.ok(!book.values['設定'].some(x => String(x[0]).startsWith('LINE Pay')));
  // 月份統計: the top-up is on the 悠遊卡 row, with its month-end balance.
  const ez = book.values['月份統計'].find(x => x[1] === '悠遊卡');
  assert.deepEqual(
    pick([book.values['月份統計'][0], ez], 1, ['支出（元）', '儲值（元）', '月底餘額（元）']),
    [15, 500, 985]
  );
  // A second device gets both wallets.
  const tablet = new CashStore({ fetcher: g.fetcher });
  tablet.authorize('t', 3600);
  await tablet.open();
  r = await tablet.sync(new Map(), null);
  assert.deepEqual([...r.wallets.keys()].sort(), ['LINE Pay', '悠遊卡']);
  // Removing a wallet keeps a 已刪除 row so other devices learn about it; LINE Pay cannot be removed.
  await tablet.sync(
    r.entries,
    null,
    new Map(),
    new Map([['悠遊卡', { ...easy, deleted: true, updatedAt: '2026-11-15T10:00:00Z' }]])
  );
  assert.equal(book.values['錢包'].find(x => x[0] === '悠遊卡')[5], '已刪除');
  assert.equal(makeWallet({ name: 'LINE Pay', deleted: true }).deleted, false);
  assert.throws(() => makeWallet({ name: '現金' }), /WALLET_CASH/);
});

test('a v1.4.0 sheet and phone move the LINE Pay starting balance into the wallet list', async () => {
  // Phone: the old single setting becomes the LINE Pay wallet, still pending if it was.
  const storage = memoryStorage();
  storage.setItem(
    'cash-ledger-v1',
    JSON.stringify({
      entries: [],
      walletSetting: { cents: 174400, date: '2026-11-15', updatedAt: '2026-11-15T01:00:00Z' },
      walletSettingPending: true,
      pending: []
    })
  );
  const local = new CashLocal(storage);
  assert.deepEqual([local.wallets.get('LINE Pay').cents, local.pendingCount], [174400, 1]);
  // Sheet: LINE Pay rows in 設定 are read once when 錢包 has no LINE Pay row.
  const g = fakeGoogle();
  const s = new CashStore({ fetcher: g.fetcher });
  s.authorize('t', 3600);
  await s.open();
  const book = g.books.get('sheet1');
  book.values['設定'] = [
    ['項目', '內容', '說明'],
    ['LINE Pay 起始餘額（元）', 1744, ''],
    ['LINE Pay 起始日期', '2026-11-15', ''],
    ['LINE Pay 設定更新時間', '2026-11-15T01:00:00Z', '']
  ];
  const old = e('儲值', '2026-11-15', '100', { id: 'old', channel: '現金' });
  // A v1.4.0 top-up has no 轉入 and went into LINE Pay.
  book.values['異動紀錄'] = [LOG_HEADERS.slice(0, 12), logRow(old).slice(0, 12)];
  await s.ensureSheets();
  const r = await s.sync(new Map(), null);
  assert.equal(r.wallets.get('LINE Pay').cents, 174400);
  assert.equal(r.entries.get('old').to, 'LINE Pay');
  assert.equal(book.values['錢包'].find(x => x[0] === 'LINE Pay')[4], 1844);
  assert.equal(book.values['異動紀錄'][0].at(-1), '排序');
});

test('channels sit in editable groups, and 提款／存入 pick an account from banks, cards and others', () => {
  const at = t => '2026-11-17T0' + t + ':00:00Z';
  const opts = (...list) => new Map(list.map(o => [optionKey(o), o]));
  const wallets = new Map([['悠遊卡', makeWallet({ name: '悠遊卡' })]]);
  const bank = makeOption({ kind: '渠道', name: '台新銀行', parent: '銀行', updatedAt: at(1) });
  const old = makeOption({ kind: '渠道', name: '街口', updatedAt: at(1) }); // added before groups existed
  let options = opts(bank, old);
  assert.deepEqual(channelGroups(options, wallets), [
    ['現金', ['現金']],
    ['錢包', ['LINE Pay', '悠遊卡']],
    ['銀行', ['玉山銀行', '中信銀行', '台新銀行']],
    ['信用卡', ['凱基信用卡', '中信信用卡']],
    ['其他', ['街口']]
  ]);
  assert.deepEqual(transferAccounts(options, wallets), [
    '玉山銀行',
    '中信銀行',
    '台新銀行',
    '凱基信用卡',
    '中信信用卡',
    '街口'
  ]);
  // Moving a channel keeps one row (the group is not part of the key); a default can be moved or removed.
  const moved = makeOption({ ...old, parent: '銀行', updatedAt: at(2) });
  assert.equal(optionKey(moved), optionKey(old));
  const gone = makeOption({
    kind: '渠道',
    name: '中信銀行',
    parent: '銀行',
    deleted: true,
    updatedAt: at(2)
  });
  const card = makeOption({ kind: '渠道', name: '凱基信用卡', parent: '其他', updatedAt: at(2) });
  options = mergeOptions(opts(moved, gone, card), options);
  assert.deepEqual(transferAccounts(options, wallets), [
    '玉山銀行',
    '台新銀行',
    '街口',
    '中信信用卡',
    '凱基信用卡'
  ]);
  // Groups round-trip through the 選項 sheet, and 現金 cannot be a channel option.
  assert.deepEqual(readOptions(optionRows(options)), options);
  assert.equal(makeOption({ kind: '渠道', name: 'X', parent: '亂寫' }).parent, '');
  assert.throws(() => makeOption({ kind: '渠道', name: '現金' }), /OPTION_CASH/);
});

test('search finds records by store, note, category, channel or exact amount, every word needed', () => {
  const lunch = e('支出', '2026-10-02', '160', {
    party: '全聯福利中心',
    note: '晚餐 便當',
    channel: '玉山銀行'
  });
  const tea = e('支出', '2026-11-03', '1,250', {
    party: 'ＳＴＡＲＢＵＣＫＳ',
    category: '餐飲／飲料',
    channel: 'LINE Pay'
  });
  const top = e('儲值', '2026-11-04', '500', { channel: '現金', to: 'LINE Pay' });
  const find = q =>
    [lunch, tea, top].filter(x => matchesSearch(x, searchWords(q))).map(x => x.amountCents / 100);
  assert.deepEqual(find('全聯'), [160]);
  assert.deepEqual(find('便當'), [160]); // note
  assert.deepEqual(find('starbucks'), [1250]); // full-width, any case
  assert.deepEqual(find('飲料'), [1250]); // sub-category
  assert.deepEqual(find('line pay'), [1250, 500]); // channel and top-up destination
  assert.deepEqual(find('全聯 晚餐'), [160]);
  assert.deepEqual(find('全聯 飲料'), []);
  assert.deepEqual(find('1,250'), [1250]);
  assert.deepEqual(find('16'), []); // amounts match exactly, not by part
  assert.deepEqual(find('   '), []);
  assert.equal(matchesSearch({ ...lunch, deleted: true }, searchWords('全聯')), false);
});

test('排序 orders a day: old records keep their time order, new ones go last, and a number moves a record', () => {
  const now = '2026-11-18T08:00:00Z';
  const mk = (id, more = {}) =>
    makeEntry({
      id,
      type: '支出',
      date: '2026-11-18',
      amount: '10',
      category: '餐飲',
      createdAt: '2026-11-18T0' + id.length + ':00:00Z',
      ...more
    });
  // Before v1.8.0: no 排序, ordered by time then when made.
  const a = mk('a', { time: '09:00', createdAt: '2026-11-18T05:00:00Z' });
  const b = mk('b', { time: '', createdAt: '2026-11-18T01:00:00Z' });
  const c = mk('c', { time: '12:00', createdAt: '2026-11-18T02:00:00Z' });
  let list = [a, b, c];
  const ids = l => inOrder(l).map(e => e.id + e.position);
  assert.deepEqual(ids(list), ['b1', 'a2', 'c3']);
  // A new record goes last; so does one typed with no number.
  const d = { ...mk('d'), rank: nextRank(list, '2026-11-18') };
  assert.equal(d.rank, 4);
  list.push(d);
  assert.deepEqual(ids(list), ['b1', 'a2', 'c3', 'd4']);
  // Moving d to 1 renumbers the day; every record whose 排序 changed is returned.
  const moved = placeInDay(list, d, 1, now);
  assert.deepEqual(
    moved.map(e => e.id + e.rank),
    ['d1', 'b2', 'a3', 'c4']
  );
  assert.ok(moved.every(e => e.updatedAt === now && !('position' in e)));
  list = moved;
  // Out-of-range numbers clamp; deleted records do not count.
  assert.deepEqual(ids(placeInDay(list, list[0], 99, now)), ['b1', 'a2', 'c3', 'd4']);
  assert.equal(nextRank([...list, { ...mk('x'), rank: 9, deleted: true }], '2026-11-18'), 5);
  assert.equal(nextRank(list, '2026-11-19'), 1);
  // 排序 travels through the 異動紀錄 sheet.
  assert.equal(readLog([LOG_HEADERS, logRow(list[0])])[0].rank, list[0].rank);
  assert.equal(makeEntry({ ...list[0], rank: '0' }).rank, null);
});

test('changing 排序 in 記帳明細 moves the record and renumbers its day', () => {
  const now = '2026-11-18T09:00:00Z';
  const mk = (id, rank) =>
    makeEntry({ id, type: '支出', date: '2026-11-18', amount: '10', category: '餐飲', rank, createdAt: now });
  const known = new Map(['p', 'q', 'r'].map((id, i) => [id, mk(id, i + 1)]));
  const sheet = detailRows(ledger(known.values(), null));
  assert.deepEqual(readDetailEdits(sheet, known), { changes: [], problems: [] });
  const typed = structuredClone(sheet);
  const R = typed[0].indexOf('排序');
  typed[3][R] = 1; // r to the top
  const out = readDetailEdits(typed, known, { now });
  assert.deepEqual(out.changes.map(e => e.id + e.rank).sort(), ['p2', 'q3', 'r1']);
  typed[3][R] = '第一';
  assert.deepEqual(readDetailEdits(typed, known, { now }).problems, [
    { row: 4, reason: '排序要是 1 以上的整數，或留空' }
  ]);
});
