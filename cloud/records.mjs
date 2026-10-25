export const HEADERS = [
  '紀錄 ID',
  '銀行',
  '帳戶代稱',
  '日期',
  '時間',
  '摘要',
  '支出（元）',
  '收入（元）',
  '手續費（元）',
  '餘額（元）',
  '餘額核對',
  '待核對原因',
  '來源格式',
  '匯入 ID',
  '原始順序',
  '寫入時間',
  '類別',
  '來源列',
  '手續費規則'
];
export const IMPORT_HEADERS = [
  '匯入 ID',
  '來源',
  '帳戶代稱',
  '類別',
  '寫入時間',
  '來源筆數',
  '新增筆數',
  '庫存檔指紋',
  '異動檔指紋',
  '核對狀態'
];
export const BANK_TABS = ['銀行存款'];
const cents = v =>
  v === '' || v == null
    ? null
    : Number.isFinite(Number(v)) && Number.isSafeInteger(Math.round(Number(v) * 100))
      ? Math.round(Number(v) * 100)
      : null;
const yuan = v => (Number.isSafeInteger(v) ? v / 100 : '');
export async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map(v => v.toString(16).padStart(2, '0'))
    .join('');
}
export async function makeImport(
  result,
  { account, fileHash, order, tab = '銀行存款', now = new Date().toISOString() }
) {
  account = account.trim();
  if (!account) throw Error('ACCOUNT_REQUIRED');
  if (!fileHash || !result?.transactions?.length) throw Error('NO_RECORDS');
  if (!BANK_TABS.includes(tab)) throw Error('CATEGORY_INVALID');
  const bank = result.bank,
    importId = await hash(JSON.stringify([bank, account, fileHash, tab])),
    occurrences = new Map(),
    rows = [];
  const transactions = order === 'descending' ? [...result.transactions].reverse() : [...result.transactions];
  for (let i = 0; i < transactions.length; i++) {
    const t = transactions[i],
      identity = JSON.stringify([
        bank,
        account,
        t.date,
        t.time,
        t.summary,
        t.expenseCents,
        t.incomeCents,
        t.feeCents,
        t.balanceCents
      ]);
    const count = (occurrences.get(identity) || 0) + 1;
    occurrences.set(identity, count);
    const id = await hash(identity + '\u001f' + count);
    rows.push([
      id,
      bank,
      account,
      t.date || '',
      t.time || '',
      t.summary || '',
      yuan(t.expenseCents),
      yuan(t.incomeCents),
      yuan(t.feeCents),
      yuan(t.balanceCents),
      t.balanceCheck?.status || 'uncheckable',
      (t.errors || []).join('|'),
      result.sourceType || 'pdf',
      importId,
      i,
      now,
      '銀行存款',
      t.sourceLine ?? t.line ?? '',
      result.feePolicy || 'pdf_review'
    ]);
  }
  return { id: importId, rows, log: [importId, bank, account, tab, now, rows.length, 0], tab };
}
export function bankSummary(rows) {
  const unique = new Map();
  for (const row of rows) if (row[0]) unique.set(row[0], row);
  const accounts = new Map();
  for (const row of unique.values()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row[3] || '')) continue;
    const key = JSON.stringify([row[1], row[2]]),
      list = accounts.get(key) || [];
    list.push(row);
    accounts.set(key, list);
  }
  const balances = [],
    pending = [];
  for (const list of accounts.values()) {
    const date = list
      .map(r => r[3])
      .sort()
      .at(-1);
    let candidates = list.filter(r => r[3] === date);
    const timed = candidates.every(r => /^\d{2}:\d{2}:\d{2}$/.test(r[4] || ''));
    if (timed) {
      const time = candidates
        .map(r => r[4])
        .sort()
        .at(-1);
      candidates = candidates.filter(r => r[4] === time);
    }
    const byImport = new Map();
    for (const row of candidates) {
      const prior = byImport.get(row[13]);
      if (!prior || Number(row[14]) > Number(prior[14])) byImport.set(row[13], row);
    }
    candidates = [...byImport.values()];
    const last = candidates[0];
    const amounts = candidates.map(r => cents(r[9]));
    if (
      amounts.some(v => v === null) ||
      new Set(amounts).size !== 1 ||
      candidates.some(r => ['fail', 'uncheckable'].includes(r[10]))
    ) {
      pending.push({ bank: last[1], account: last[2], date });
      continue;
    }
    balances.push({ bank: last[1], account: last[2], date, time: timed ? last[4] : '', cents: amounts[0] });
  }
  const totalCents = balances.reduce((s, b) => s + b.cents, 0);
  if (!Number.isSafeInteger(totalCents)) throw Error('AMOUNT_LIMIT');
  return { totalCents, balances, pending, bankCount: new Set(balances.map(b => b.bank)).size };
}
