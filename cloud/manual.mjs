// 「手動記帳」工作表：現金消費、LINE Pay 轉帳等沒有任何檔案可匯入的收支。
// 只新增不修改：修改或刪除都是新增一列相同紀錄ID、較新更新時間的資料，讀取時每筆取最新一列。
import { moneyCents } from '../pdf-parser/parser.mjs';

export const MANUAL_HEADERS = [
  '紀錄ID',
  '日期',
  '時間',
  '類型',
  '金額（元）',
  '付款方式',
  '對象／商店',
  '分類',
  '備註',
  '狀態',
  '更新時間'
];
export const MANUAL_TYPES = ['支出', '收入'];
export const MANUAL_CATEGORIES = [
  '餐飲',
  '交通',
  '日用品',
  '購物',
  '娛樂',
  '轉帳給別人',
  '收到轉帳',
  '醫療',
  '其他'
];
const AMOUNT = 4;
const validDate = s => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === s;
};

export function manualEntry(input) {
  const amountCents = moneyCents(String(input.amount ?? '').trim());
  const entry = {
    id: String(input.id || '').trim(),
    date: String(input.date || ''),
    time: String(input.time || '').trim(),
    type: MANUAL_TYPES.includes(input.type) ? input.type : '支出',
    amountCents,
    method: String(input.method || '')
      .trim()
      .slice(0, 30),
    party: String(input.party || '')
      .trim()
      .slice(0, 60),
    category: String(input.category || '')
      .trim()
      .slice(0, 20),
    note: String(input.note || '')
      .trim()
      .slice(0, 200)
  };
  if (!entry.id) throw Error('MANUAL_ID');
  if (!validDate(entry.date)) throw Error('MANUAL_DATE');
  if (entry.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time)) throw Error('MANUAL_TIME');
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw Error('MANUAL_AMOUNT');
  if (!entry.method) throw Error('MANUAL_METHOD');
  return entry;
}
export function manualRow(entry, { deleted = false, at = new Date().toISOString() } = {}) {
  return [
    entry.id,
    entry.date,
    entry.time,
    entry.type,
    entry.amountCents,
    entry.method,
    entry.party,
    entry.category,
    entry.note,
    deleted ? '已刪除' : '有效',
    at
  ];
}
export function manualSheetRows(rows) {
  return rows.map(r => {
    const out = [...r];
    if (!Number.isSafeInteger(out[AMOUNT])) throw Error('MANUAL_AMOUNT');
    out[AMOUNT] /= 100;
    return out;
  });
}
export function manualTable(values) {
  if (!values.length) return [];
  if (JSON.stringify(values[0]) !== JSON.stringify(MANUAL_HEADERS)) throw Error('SHEET_SCHEMA');
  return values.slice(1).map(r => {
    const out = MANUAL_HEADERS.map((_, i) => r[i] ?? '');
    const n = moneyCents(String(out[AMOUNT]));
    if (!Number.isSafeInteger(n)) throw Error('MANUAL_AMOUNT');
    out[AMOUNT] = n;
    return out;
  });
}
// The latest row of each record wins; deleted records disappear.
export function manualEntries(rows) {
  const latest = new Map();
  rows.forEach((r, n) => {
    const prior = latest.get(r[0]);
    if (
      !prior ||
      String(r[10]) > String(prior.r[10]) ||
      (String(r[10]) === String(prior.r[10]) && n > prior.n)
    )
      latest.set(r[0], { r, n });
  });
  return [...latest.values()]
    .map(({ r }) => r)
    .filter(r => r[0] && r[9] !== '已刪除')
    .map(r => ({
      id: String(r[0]),
      date: String(r[1]),
      time: String(r[2] || ''),
      type: String(r[3]),
      amountCents: r[4],
      method: String(r[5] || ''),
      party: String(r[6] || ''),
      category: String(r[7] || ''),
      note: String(r[8] || ''),
      updatedAt: String(r[10] || '')
    }))
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.updatedAt.localeCompare(a.updatedAt)
    );
}
export function manualHistoryRow(e, n) {
  return {
    kind: '手動記帳',
    id: e.id,
    source: '手動記帳',
    account: e.method,
    date: e.date,
    time: e.time,
    code: '',
    summary: [e.party, e.category].filter(Boolean).join('／') || e.type,
    expense: e.type === '支出' ? e.amountCents / 100 : null,
    income: e.type === '收入' ? e.amountCents / 100 : null,
    fee: null,
    balance: null,
    review: e.note || '手動記帳',
    conflict: false,
    ordinal: n,
    financial: 'manual:' + e.id
  };
}
