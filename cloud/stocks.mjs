import {
  HOLDING_HEADERS,
  mergeStockTables,
  splitStockRows,
  LEGACY_HOLDING_HEADERS,
  LEGACY_SNAPSHOT_HEADERS
} from './stock-layout.mjs';
import { hash } from './records.mjs';
export const STOCK_SCHEMAS = {
  股票庫存: HOLDING_HEADERS,
  股票異動: [
    '異動ID',
    '券商',
    '帳戶代稱',
    '日期',
    '證券代號',
    '證券名稱',
    '摘要',
    '提出股數',
    '存入股數',
    '結存股數'
  ]
};
export async function makeStockImport({ snapshot, history, reconciliation, account, fileHashes }) {
  account = String(account || '').trim();
  if (!account || account.length > 60) throw Error('ACCOUNT_REQUIRED');
  if (!snapshot || !reconciliation?.pass || snapshot.errors.length || history?.errors.length)
    throw Error('STOCK_INVALID');
  const now = new Date().toISOString(),
    broker = snapshot.broker;
  const positions = snapshot.holdings.slice().sort((a, b) => a.code.localeCompare(b.code));
  const fingerprint = await hash(
    JSON.stringify(
      positions.map(h => [h.code, h.name, h.quantity, h.currency, h.close, h.priceDate, h.marketValueCents])
    )
  );
  const snapshotId = await hash(JSON.stringify([broker, account, snapshot.asOf, fingerprint]));
  const id = await hash(JSON.stringify(['stocks', broker, account, snapshotId, fileHashes]));
  const movements = [],
    occurrences = new Map();
  for (const t of history?.movements || []) {
    const key = JSON.stringify([broker, account, t.date, t.code, t.memo, t.withdrawal, t.deposit, t.balance]);
    const count = (occurrences.get(key) || 0) + 1;
    occurrences.set(key, count);
    movements.push([
      await hash(key + '#' + count),
      broker,
      account,
      t.date,
      t.code,
      t.name,
      t.memo,
      t.withdrawal,
      t.deposit,
      t.balance
    ]);
  }
  const total = positions.reduce((sum, h) => sum + h.marketValueCents, 0);
  if (!Number.isSafeInteger(total) || total < 0) throw Error('STOCK_INVALID');
  return {
    id,
    snapshotId,
    log: [
      id,
      broker,
      account,
      '股票資產',
      now,
      positions.length + movements.length,
      0,
      fileHashes?.holdings || '',
      fileHashes?.movements || '',
      history ? '股數連續及庫存交叉核對通過；人工確認' : '僅庫存算術檢查通過；人工確認'
    ],
    tables: {
      股票庫存: mergeStockTables(
        [
          LEGACY_HOLDING_HEADERS,
          ...positions.map(h => [
            snapshotId,
            h.code,
            h.name,
            h.quantity,
            h.currency,
            h.close,
            h.priceDate,
            h.marketValueCents
          ])
        ],
        [
          LEGACY_SNAPSHOT_HEADERS,
          [snapshotId, broker, account, snapshot.asOf, 'TWD', positions.length, total, fingerprint, now]
        ]
      ).rows,
      股票異動: movements
    }
  };
}
export function stockSummary(tables) {
  const sourceRows = tables['股票庫存'] || [],
    unresolved = !tables['股票快照']
      ? sourceRows.filter(r => !['快照', '持股', '空庫存', '庫存缺漏'].includes(r[0])).length
      : 0;
  if (!tables['股票快照']) tables = splitStockRows(tables['股票庫存'] || []);
  const groups = new Map(),
    holdings = tables['股票庫存'] || [],
    pending = [],
    accounts = [];
  for (const r of tables['股票快照'] || []) {
    const key = JSON.stringify([r[1], r[2]]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  if (unresolved)
    pending.push({
      account: '未識別帳戶',
      reason: '有 ' + unresolved + ' 筆庫存缺少快照或格式不明，未列入合計'
    });
  let totalCents = 0;
  for (const rows of groups.values()) {
    const latest = rows.reduce((v, r) => (String(r[3]) > v ? String(r[3]) : v), '');
    const current = rows.filter(r => r[3] === latest),
      unique = new Map(current.map(r => [r[0], r]));
    const r = current[0];
    if (
      unique.size !== 1 ||
      new Set(current.map(v => JSON.stringify(v))).size !== 1 ||
      !r ||
      r[4] !== 'TWD' ||
      !Number.isSafeInteger(r[5]) ||
      r[5] < 0 ||
      !Number.isSafeInteger(r[6]) ||
      r[6] < 0
    ) {
      pending.push({ account: r?.[2] || '未知帳戶', reason: '同時點快照衝突或欄位無效' });
      continue;
    }
    const positions = holdings.filter(h => h[0] === r[0]);
    if (
      positions.length !== r[5] ||
      new Set(positions.map(h => h[1])).size !== positions.length ||
      positions.some(
        h =>
          h[4] !== 'TWD' ||
          !Number.isFinite(h[3]) ||
          h[3] < 0 ||
          !Number.isFinite(h[5]) ||
          !Number.isSafeInteger(h[7]) ||
          Math.abs(Math.round(h[3] * h[5] * 100) - h[7]) > 1
      ) ||
      positions.reduce((s, h) => s + h[7], 0) !== r[6]
    ) {
      pending.push({ account: r[2], reason: '快照庫存不完整或市值不符' });
      continue;
    }
    totalCents += r[6];
    if (!Number.isSafeInteger(totalCents)) throw Error('AMOUNT_LIMIT');
    accounts.push({
      broker: r[1],
      account: r[2],
      asOf: r[3],
      totalCents: r[6],
      priceDates: [...new Set(positions.map(h => h[6]))]
    });
  }
  return { totalCents, accounts, pending };
}
