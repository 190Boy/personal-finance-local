import {
  CARD_HEADERS,
  LEGACY_CARD_HEADERS,
  cardTable,
  cardSheetRows,
  makeCardImport
} from '../cloud/credit-cards.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleStore } from '../cloud/google.mjs';
import { HEADERS, IMPORT_HEADERS, makeImport } from '../cloud/records.mjs';
import { STOCK_SCHEMAS, stockSummary, makeStockImport } from '../cloud/stocks.mjs';
import {
  LEGACY_SNAPSHOT_HEADERS,
  LEGACY_HOLDING_HEADERS,
  mergeStockTables,
  splitStockRows,
  HOLDING_HEADERS
} from '../cloud/stock-layout.mjs';
import { rowsToAppend } from '../cloud/dedup.mjs';
const clone = v => structuredClone(v);
const snap = [
  'snapshot',
  '測試券商',
  '測試證券帳戶',
  '2026-10-21T10:12',
  'TWD',
  1,
  15000,
  'synthetic-fingerprint',
  '2026-10-21T10:15'
];
const pos = ['snapshot', '1234', '虛構股票', 20, 'TWD', 7.5, '2026-10-20', 15000];
function mock({ barrier = false, lost = false, failure = false, tables: extra = {} } = {}) {
  const tables = {
      銀行存款: [HEADERS],
      匯入紀錄: [IMPORT_HEADERS],
      股票庫存: [STOCK_SCHEMAS['股票庫存']],
      股票異動: [STOCK_SCHEMAS['股票異動']],
      ...clone(extra)
    },
    metadata = [],
    sheets = Object.keys(tables).map((title, i) => ({ title, sheetId: i + 1 }));
  let collisions = 0,
    writeCalls = 0,
    revisionReads = 0,
    release;
  const gate = new Promise(r => (release = r));
  const decode = rows =>
    rows.map(r => r.values.map(v => v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue));
  const fetcher = async (url, opt) => {
    let data = {};
    if (url.includes('?fields=developerMetadata')) {
      data = { developerMetadata: clone(metadata) };
      revisionReads++;
      if (barrier && revisionReads <= 2) {
        if (revisionReads === 2) release();
        await gate;
      }
    } else if (url.includes('/values/')) {
      const tab = decodeURIComponent(url.split('/values/')[1].split('?')[0]).split("'")[1];
      if (opt.method === 'PUT') tables[tab] = JSON.parse(opt.body).values;
      else data = { values: clone(tables[tab] || []) };
    } else if (opt.method === 'GET')
      data = { sheets: sheets.map(properties => ({ properties: clone(properties) })) };
    else {
      const requests = JSON.parse(opt.body).requests;
      writeCalls++;
      if (failure) return { ok: false, status: 503 };
      const ids = new Set(metadata.map(m => m.metadataId));
      for (const r of requests)
        if (r.createDeveloperMetadata) {
          const id = r.createDeveloperMetadata.developerMetadata.metadataId;
          if (ids.has(id)) {
            collisions++;
            return { ok: false, status: 400 };
          }
          ids.add(id);
        }
      for (const r of requests)
        if (
          r.deleteDeveloperMetadata &&
          !ids.has(r.deleteDeveloperMetadata.dataFilter.developerMetadataLookup.metadataId)
        )
          return { ok: false, status: 400 };
      for (const r of requests) {
        if (r.createDeveloperMetadata) metadata.push(clone(r.createDeveloperMetadata.developerMetadata));
        if (r.deleteDeveloperMetadata) {
          const id = r.deleteDeveloperMetadata.dataFilter.developerMetadataLookup.metadataId;
          metadata.splice(0, metadata.length, ...metadata.filter(m => m.metadataId !== id));
        }
        if (r.appendCells) {
          const tab = sheets.find(s => s.sheetId === r.appendCells.sheetId).title;
          tables[tab].push(...decode(r.appendCells.rows));
        }
        if (r.updateCells) {
          const tab = sheets.find(s => s.sheetId === r.updateCells.range.sheetId).title;
          const data = decode(r.updateCells.rows);
          tables[tab] = [...data, ...tables[tab].slice(r.updateCells.range.endRowIndex)];
        }
        if (r.updateSheetProperties)
          Object.assign(
            sheets.find(s => s.sheetId === r.updateSheetProperties.properties.sheetId),
            r.updateSheetProperties.properties
          );
        if (r.addSheet) {
          sheets.push({ ...r.addSheet.properties, sheetId: sheets.length + 1 });
          tables[r.addSheet.properties.title] = [];
        }
      }
      if (lost) {
        lost = false;
        return { ok: false, status: 503 };
      }
    }
    return { ok: true, status: 200, json: async () => data };
  };
  const store = () => {
    const s = new GoogleStore({ fetcher });
    s.authorize('synthetic', 3600);
    s.file = { id: 'synthetic-sheet' };
    s.sheets = clone(sheets);
    return s;
  };
  return {
    tables,
    metadata,
    sheets,
    store,
    get collisions() {
      return collisions;
    },
    get writeCalls() {
      return writeCalls;
    }
  };
}
const t = (name, balance) => ({
  date: '2026-10-01',
  time: '10:00:00',
  summary: name,
  expenseCents: 100,
  incomeCents: 0,
  feeCents: 0,
  balanceCents: balance,
  balanceCheck: { status: 'pass' },
  errors: []
});
const bankBatch = (file, rows) =>
  makeImport(
    { bank: '測試銀行', sourceType: 'excel', transactions: rows },
    { account: '主要', fileHash: file, order: 'ascending' }
  );
test('two devices with different overlapping bank imports serialize and append shared transaction once', async () => {
  const m = mock({ barrier: true }),
    a = m.store(),
    b = m.store(),
    common = t('共同交易', 10000),
    A = await bankBatch('file-A', [common, t('A', 9900)]),
    B = await bankBatch('file-B', [common, t('B', 9800)]);
  const results = await Promise.all([a.save(A), b.save(B)]);
  assert.deepEqual(results.map(r => r.added).sort(), [1, 2]);
  assert.equal(m.tables['銀行存款'].length, 4);
  assert.equal(m.tables['匯入紀錄'].length, 3);
  assert.ok(m.collisions >= 1);
  assert.deepEqual(
    m.metadata.filter(v => v.metadataKey === 'fw2').map(v => v.metadataValue),
    ['1', '2']
  );
});
test('lost response after commit is idempotent on retry', async () => {
  const m = mock({ lost: true }),
    batch = await bankBatch('file', [t('共同交易', 10000)]);
  await m.store().save(batch);
  await m.store().save(batch);
  assert.equal(m.tables['銀行存款'].length, 2);
  assert.equal(m.tables['匯入紀錄'].length, 2);
});
test('API failure does not consume a revision, append rows or record success', async () => {
  const m = mock({ failure: true });
  await assert.rejects(m.store().save(await bankBatch('file', [t('共同交易', 10000)])), /GOOGLE_API/);
  assert.equal(m.metadata.length, 0);
  assert.equal(m.tables['銀行存款'].length, 1);
});
test('same ID financial conflict is kept; exact duplicates are skipped', () => {
  const a = ['id', '銀行', '主要', '2026-10-01', '', '測試', 10, 0, 0, 90, 'pass', ''],
    b = [...a];
  b[9] = 80;
  const p = rowsToAppend([a], [a, b]);
  assert.equal(p.skipped, 1);
  assert.equal(p.fresh.length, 1);
  assert.equal(p.fresh[0][10], 'uncheckable');
  assert.ok(p.fresh[0][11].includes('CLOUD_ID_CONFLICT'));
});
test('merged inventory preserves dates, positions and zero snapshot without another active sheet', () => {
  const plan = mergeStockTables([LEGACY_HOLDING_HEADERS, pos], [LEGACY_SNAPSHOT_HEADERS, snap]);
  assert.equal(plan.rows.length, 2);
  assert.equal(plan.rows[0][0], '快照');
  assert.deepEqual(splitStockRows(plan.rows)['股票庫存'], [pos]);
  assert.equal(stockSummary({ 股票庫存: plan.rows }).totalCents, 15000);
  const empty = [...snap];
  empty[0] = 'empty';
  empty[3] = '2026-10-22T10:12';
  empty[5] = 0;
  empty[6] = 0;
  const zero = mergeStockTables([LEGACY_HOLDING_HEADERS], [LEGACY_SNAPSHOT_HEADERS, empty]).rows;
  assert.equal(stockSummary({ 股票庫存: [...plan.rows, ...zero] }).totalCents, 0);
});
test('migration is atomic and idempotent; legacy snapshots are hidden and retained', async () => {
  const m = mock({
      tables: { 股票庫存: [LEGACY_HOLDING_HEADERS, pos], 股票快照: [LEGACY_SNAPSHOT_HEADERS, snap] }
    }),
    s = m.store();
  await s.mergedStocks();
  await s.mergedStocks();
  assert.deepEqual(m.tables['股票庫存'][0], HOLDING_HEADERS);
  assert.equal(m.tables['股票庫存'].length, 3);
  assert.equal(m.tables['股票快照'].length, 2);
  assert.equal(m.sheets.find(s => s.title === '股票快照').hidden, true);
  assert.equal(m.writeCalls, 1);
});
test('unknown stock schema does not block valid bank history', async () => {
  const batch = await bankBatch('file', [t('銀行交易', 10000)]),
    m = mock({ tables: { 銀行存款: [HEADERS, ...batch.rows], 股票庫存: [['custom stock header']] } });
  const r = await m.store().summary();
  assert.equal(r.history.rows.length, 1);
  assert.ok(r.history.warnings.length);
  assert.equal(r.stocks.pending.length, 1);
});
test('a missing holding remains detectable through the snapshot marker in the same sheet', () => {
  const plan = mergeStockTables([LEGACY_HOLDING_HEADERS, pos], [LEGACY_SNAPSHOT_HEADERS, snap]);
  const r = stockSummary({ 股票庫存: plan.rows.filter(r => r[0] !== '持股') });
  assert.equal(r.pending.length, 1);
  assert.equal(r.totalCents, 0);
});
test('new devices importing the same snapshot through different files do not add stock assets twice', async () => {
  const m = mock({ barrier: true });
  const payload = {
    snapshot: {
      broker: '測試券商',
      asOf: '2026-10-21T10:12',
      errors: [],
      holdings: [
        {
          code: '1234',
          name: '虛構股票',
          quantity: 20,
          currency: 'TWD',
          close: 7.5,
          priceDate: '2026-10-20',
          marketValueCents: 15000
        }
      ]
    },
    reconciliation: { pass: true },
    account: '證券'
  };
  const A = await makeStockImport({ ...payload, fileHashes: { holdings: 'A' } }),
    B = await makeStockImport({ ...payload, fileHashes: { holdings: 'B' } });
  await Promise.all([m.store().saveStocks(A), m.store().saveStocks(B)]);
  assert.equal(m.tables['股票庫存'].length, 3);
  assert.equal(m.tables['匯入紀錄'].length, 3);
  assert.equal(stockSummary({ 股票庫存: m.tables['股票庫存'].slice(1) }).totalCents, 15000);
});

test('coordination metadata near capacity stops safely without deleting or appending financial rows', async () => {
  const m = mock();
  m.metadata.push({
    metadataId: 123,
    metadataKey: 'x',
    metadataValue: 'x'.repeat(28001),
    location: { spreadsheet: true }
  });
  await assert.rejects(m.store().save(await bankBatch('file', [t('測試', 10000)])), /SYNC_METADATA_LIMIT/);
  assert.equal(m.tables['銀行存款'].length, 1);
  assert.equal(m.metadata.length, 1);
});

test('unknown legacy snapshot headers are not hidden or overwritten when inventory is already merged', () => {
  assert.throws(() => mergeStockTables([HOLDING_HEADERS], [['custom snapshot header']]), /SHEET_SCHEMA/);
});

test('credit card writes use shared ledger, serialize overlapping device imports and reload history', async () => {
  const m = mock({ barrier: true, tables: { 信用卡: [CARD_HEADERS] } }),
    parsed = {
      bank: '合成銀行',
      transactions: [
        {
          date: '2026-09-01',
          postingDate: '2026-09-02',
          summary: '合成消費',
          amountCents: 10000,
          kind: '消費',
          currency: '',
          foreignAmount: '',
          errors: [],
          line: 2
        }
      ]
    },
    opt = { account: '合成卡', month: '2026-09' },
    a = await makeCardImport(parsed, { ...opt, fileHash: 'A' }),
    b = await makeCardImport(parsed, { ...opt, fileHash: 'B' });
  await Promise.all([m.store().saveCards(a), m.store().saveCards(b)]);
  assert.equal(m.tables['信用卡'].length, 3);
  assert.equal(m.tables['匯入紀錄'].length, 3);
  assert.ok(m.collisions >= 1);
  const r = await m.store().summary();
  assert.equal(r.history.rows.length, 1);
  assert.equal(r.history.rows[0].kind, '信用卡');
  assert.equal(r.credits.totalCents, 10000);
  assert.equal(m.tables['信用卡'][2][11], 100);
  assert.equal((await m.store().saveCards(a)).repeated, true);
});

test('credit schema migration atomically changes units/header once, keeps IDs and history', async () => {
  const row = [
      '明細',
      'synthetic-id',
      'import',
      '合成銀行',
      '卡',
      '2026-10',
      '',
      '',
      '2026-10-01',
      '2026-10-02',
      '合成交易',
      12345,
      '消費',
      '',
      '',
      '',
      '',
      '人工核對',
      '2026-10-21T00:00:00Z',
      '',
      '2'
    ],
    m = mock({ tables: { 信用卡: [LEGACY_CARD_HEADERS, row] } }),
    s = m.store();
  await s.cardCurrency();
  assert.deepEqual(m.tables['信用卡'][0], CARD_HEADERS);
  assert.equal(m.tables['信用卡'][1][11], 123.45);
  assert.equal(m.tables['信用卡'][1][1], 'synthetic-id');
  const calls = m.writeCalls;
  await s.cardCurrency();
  assert.equal(m.writeCalls, calls);
  const sum = await s.summary();
  assert.equal(sum.credits.totalCents, 12345);
  assert.equal(sum.history.rows[0].cardAmount, 123.45);
});
test('failed migration keeps legacy cents and header without partial rewrites', async () => {
  const row = [
      '明細',
      'id',
      'import',
      '合成銀行',
      '卡',
      '2026-10',
      '',
      '',
      '',
      '',
      '合成交易',
      12345,
      '消費'
    ],
    m = mock({ failure: true, tables: { 信用卡: [LEGACY_CARD_HEADERS, row] } });
  await assert.rejects(m.store().cardCurrency(), /GOOGLE_API/);
  assert.deepEqual(m.tables['信用卡'][0], LEGACY_CARD_HEADERS);
  assert.equal(m.tables['信用卡'][1][11], 12345);
});
test('two new clients migrate once before overlapping card writes; no factor-100 or repeated rows', async () => {
  const row = [
      '明細',
      'legacy-id',
      'import',
      '合成銀行',
      '卡',
      '2026-09',
      '',
      '',
      '2026-09-01',
      '2026-09-02',
      '前月交易',
      10000,
      '消費',
      '',
      '',
      '',
      '',
      '人工核對',
      '2026-10-01T00:00:00Z',
      '',
      '2'
    ],
    m = mock({ barrier: true, tables: { 信用卡: [LEGACY_CARD_HEADERS, row] } }),
    p = {
      bank: '合成銀行',
      transactions: [
        {
          date: '2026-10-01',
          postingDate: '2026-10-02',
          summary: '合成消費',
          amountCents: 12345,
          kind: '消費',
          currency: '',
          foreignAmount: '',
          errors: [],
          line: 2
        }
      ]
    },
    a = await makeCardImport(p, { account: '卡', month: '2026-10', fileHash: 'A' }),
    b = await makeCardImport(p, { account: '卡', month: '2026-10', fileHash: 'B' });
  await Promise.all([m.store().saveCards(a), m.store().saveCards(b)]);
  assert.equal(m.tables['信用卡'].filter(r => r[0] === '明細').length, 2);
  assert.equal((await m.store().summary()).credits.totalCents, 12345);
  assert.equal(m.tables['信用卡'][1][11], 100);
});

test('unit migration installs a schema barrier that old clients cannot write past', async () => {
  const m = mock({ tables: { 信用卡: [LEGACY_CARD_HEADERS] } }),
    s = m.store();
  await s.cardCurrency();
  const guard = m.metadata.find(v => v.metadataId === 2000000000);
  assert.equal(guard.metadataValue, 'cards-yuan-v1');
  assert.equal(guard.metadataKey, 'fw2');
  assert.ok(!Number.isSafeInteger(Number(guard.metadataValue)));
  await s.writeRevision();
  assert.equal(s.cardUnitsGuard, true);
});

// v0.7.2: coordination metadata stays bounded.
const meta = (metadataId, metadataKey, metadataValue) => ({
  metadataId,
  metadataKey,
  metadataValue,
  visibility: 'DOCUMENT',
  location: { spreadsheet: true }
});
const used = m => m.metadata.reduce((s, v) => s + v.metadataKey.length + v.metadataValue.length, 0);
test('repeated imports keep a bounded revision window and add no per-import metadata', async () => {
  const m = mock(),
    s = m.store();
  for (let i = 0; i < 60; i++) await s.save(await bankBatch('file-' + i, [t('交易' + i, 10000 - i)]));
  const revisions = m.metadata.filter(v => v.metadataKey === 'fw2').map(v => Number(v.metadataValue));
  assert.equal(m.tables['銀行存款'].length, 61);
  assert.equal(m.tables['匯入紀錄'].length, 61);
  assert.equal(Math.max(...revisions), 60);
  assert.ok(revisions.length <= 20);
  assert.ok(Math.min(...revisions) > 40);
  assert.equal(m.metadata.filter(v => v.metadataKey !== 'fw2').length, 0);
});
test('a store already over the metadata budget recovers by pruning legacy import markers', async () => {
  const m = mock({ tables: { 信用卡: [CARD_HEADERS] } });
  for (let i = 1; i <= 330; i++) {
    m.metadata.push(meta(1000000000 + i, 'fw2', String(i)));
    m.metadata.push(meta(5000 + i, i % 2 ? 'financeImport' : 'financeStockImport', 'f'.repeat(64)));
  }
  m.metadata.push(
    meta(9001, 'financeStockSnapshot', 's'.repeat(64)),
    meta(9002, 'financeUnifiedLog', 'v1'),
    meta(2000000000, 'fw2', 'cards-yuan-v1')
  );
  assert.ok(used(m) > 28000);
  const r = await m.store().save(await bankBatch('file', [t('恢復', 10000)]));
  assert.equal(r.added, 1);
  assert.ok(used(m) < 1000);
  assert.equal(
    m.metadata.filter(v =>
      ['financeImport', 'financeStockImport', 'financeStockSnapshot'].includes(v.metadataKey)
    ).length,
    0
  );
  assert.ok(m.metadata.some(v => v.metadataKey === 'financeUnifiedLog'));
  assert.ok(m.metadata.some(v => v.metadataId === 2000000000));
  const s = m.store();
  await s.writeRevision();
  assert.equal(s.cardUnitsGuard, true);
});
test('pruning does not weaken concurrent write serialization', async () => {
  const m = mock({ barrier: true });
  for (let i = 1; i <= 40; i++) m.metadata.push(meta(1000000000 + i, 'fw2', String(i)));
  const a = m.store(),
    b = m.store(),
    common = t('共同交易', 10000),
    A = await bankBatch('file-A', [common, t('A', 9900)]),
    B = await bankBatch('file-B', [common, t('B', 9800)]);
  const results = await Promise.all([a.save(A), b.save(B)]);
  assert.deepEqual(results.map(r => r.added).sort(), [1, 2]);
  assert.equal(m.tables['銀行存款'].length, 4);
  assert.ok(m.collisions >= 1);
  const revisions = m.metadata.filter(v => v.metadataKey === 'fw2').map(v => Number(v.metadataValue));
  assert.equal(Math.max(...revisions), 42);
  assert.ok(revisions.length <= 20);
});
test('same stock snapshot from two devices is still stored once without snapshot markers', async () => {
  const m = mock({ barrier: true });
  const payload = {
    snapshot: {
      broker: '測試券商',
      asOf: '2026-10-21T10:12',
      errors: [],
      holdings: [
        {
          code: '1234',
          name: '虛構股票',
          quantity: 20,
          currency: 'TWD',
          close: 7.5,
          priceDate: '2026-10-20',
          marketValueCents: 15000
        }
      ]
    },
    reconciliation: { pass: true },
    account: '證券'
  };
  const A = await makeStockImport({ ...payload, fileHashes: { holdings: 'A' } }),
    B = await makeStockImport({ ...payload, fileHashes: { holdings: 'B' } });
  await Promise.all([m.store().saveStocks(A), m.store().saveStocks(B)]);
  assert.equal(stockSummary({ 股票庫存: m.tables['股票庫存'].slice(1) }).totalCents, 15000);
  assert.equal(
    m.metadata.filter(v => v.metadataKey.startsWith('financeStock') && v.metadataKey !== 'financeStockMerge')
      .length,
    0
  );
});
