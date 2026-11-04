// 固定收支：房租、訂閱、薪水這類每月固定的收支，設定一次，到期時自動產生一筆手動記帳。
// 「固定收支」工作表只新增不修改：修改或刪除都是新增一列相同固定ID、較新更新時間的資料。
// 每月產生的手動記帳ID固定為 rec-<固定ID>-<年月>，所以同一個月只會產生一次；刪掉那筆也不會再補回來。
import { manualEntry } from './manual.mjs';

export const RECURRING_HEADERS = [
  '固定ID',
  '名稱',
  '類型',
  '金額（元）',
  '付款方式',
  '轉入帳戶／對象',
  '分類',
  '每月幾號',
  '開始月份',
  '結束月份',
  '備註',
  '狀態',
  '更新時間'
];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function recurringItem(input) {
  const day = Number(input.day);
  const item = {
    id: String(input.id || '').trim(),
    name: String(input.name || '')
      .trim()
      .slice(0, 40),
    day,
    start: String(input.start || ''),
    end: String(input.end || '')
  };
  if (!item.name) throw Error('RECURRING_NAME');
  if (!Number.isInteger(day) || day < 1 || day > 31) throw Error('RECURRING_DAY');
  if (!MONTH.test(item.start)) throw Error('RECURRING_START');
  if (item.end && (!MONTH.test(item.end) || item.end < item.start)) throw Error('RECURRING_END');
  // Amount, type, accounts and category follow the hand-entry rules.
  if (!item.id) throw Error('RECURRING_ID');
  const e = manualEntry({ ...input, id: item.id, date: item.start + '-01' });
  return {
    ...item,
    type: e.type,
    amountCents: e.amountCents,
    method: e.method,
    party: e.party,
    category: e.category,
    note: e.note
  };
}
export function recurringRow(item, { deleted = false, at = new Date().toISOString() } = {}) {
  return [
    item.id,
    item.name,
    item.type,
    item.amountCents / 100,
    item.method,
    item.party,
    item.category,
    item.day,
    item.start,
    item.end,
    item.note,
    deleted ? '已刪除' : '啟用',
    at
  ];
}
// The latest row of each item wins; deleted items disappear.
export function recurringTable(values) {
  if (!values.length) return [];
  if (JSON.stringify(values[0]) !== JSON.stringify(RECURRING_HEADERS)) throw Error('SHEET_SCHEMA');
  const latest = new Map();
  values.slice(1).forEach((r, n) => {
    const prior = latest.get(r[0]);
    if (
      !prior ||
      String(r[12]) > String(prior.r[12]) ||
      (String(r[12]) === String(prior.r[12]) && n > prior.n)
    )
      latest.set(r[0], { r, n });
  });
  const out = [];
  for (const { r } of latest.values()) {
    if (!r[0] || r[11] === '已刪除') continue;
    try {
      out.push(
        recurringItem({
          id: r[0],
          name: r[1],
          type: r[2],
          amount: String(r[3] ?? ''),
          method: r[4],
          party: r[5],
          category: r[6],
          day: r[7],
          start: String(r[8] || ''),
          end: String(r[9] || ''),
          note: r[10]
        })
      );
    } catch {
      // A row edited by hand into something invalid is skipped rather than breaking the summary.
    }
  }
  return out.sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
}

const pad = n => String(n).padStart(2, '0');
const lastDay = ym => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
const nextMonth = ym => {
  const y = +ym.slice(0, 4),
    m = +ym.slice(5, 7);
  return m === 12 ? y + 1 + '-01' : y + '-' + pad(m + 1);
};
// The day of a month an item falls on; the 31st becomes the last day of a shorter month.
export const dueDate = (item, ym) => ym + '-' + pad(Math.min(item.day, lastDay(ym)));
export const occurrenceId = (item, ym) => 'rec-' + item.id + '-' + ym;

// Hand entries that are due by today and were never created (existingIds includes deleted records).
export function dueEntries(items, existingIds, today) {
  const out = [];
  for (const item of items) {
    const until = item.end && item.end < today.slice(0, 7) ? item.end : today.slice(0, 7);
    for (let ym = item.start; ym <= until; ym = nextMonth(ym)) {
      const date = dueDate(item, ym),
        id = occurrenceId(item, ym);
      if (date > today || existingIds.has(id)) continue;
      out.push(
        manualEntry({
          id,
          type: item.type,
          date,
          amount: String(item.amountCents / 100),
          method: item.method,
          party: item.party,
          category: item.category,
          note: ['固定收支：' + item.name, item.note].filter(Boolean).join('；')
        })
      );
    }
  }
  return out;
}
// The next date an item will be recorded, for the list.
export function nextDue(item, today) {
  let ym = item.start > today.slice(0, 7) ? item.start : today.slice(0, 7);
  if (dueDate(item, ym) <= today && ym >= item.start) ym = nextMonth(ym);
  if (item.end && ym > item.end) return '';
  return dueDate(item, ym);
}
export function localToday(d = new Date()) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
