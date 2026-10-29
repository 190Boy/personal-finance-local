// 「LINE Pay」工作表與錢包餘額落差。
// 錢包付款的通知帶「付款後餘額」，相鄰兩則通知的餘額對不上，就代表中間有沒發通知的錢進出（好友轉帳、
// 沒有通知的儲值等）。落差每次載入時重新計算；使用者的標記記在「配對紀錄」。
import { hash } from './records.mjs';
import { moneyCents } from '../pdf-parser/parser.mjs';

export const LINEPAY_HEADERS = [
  '紀錄ID',
  '匯入ID',
  '日期',
  '時間',
  '類型',
  '金額（元）',
  '商店名稱',
  '付款方式',
  '付款後餘額（元）',
  '銀行',
  '匯入時間',
  '來源列'
];
const AMOUNTS = [5, 8];
export const GAP_LABELS = {
  out: ['轉帳給別人', '乘車碼', '其他支出'],
  in: ['收到轉帳', '儲值', '退款', '其他收入']
};
const TOPUP_HINT = '連結帳戶交易';
const DAY = 86400000;

export function linePaySheetRows(rows) {
  return rows.map(r => {
    const out = [...r];
    for (const i of AMOUNTS)
      if (out[i] !== '' && out[i] != null) {
        if (!Number.isSafeInteger(out[i])) throw Error('LINEPAY_AMOUNT');
        out[i] /= 100;
      }
    return out;
  });
}
export function linePayTable(values) {
  if (!values.length) return [];
  if (JSON.stringify(values[0]) !== JSON.stringify(LINEPAY_HEADERS)) throw Error('SHEET_SCHEMA');
  return values.slice(1).map(r => {
    const out = LINEPAY_HEADERS.map((_, i) => r[i] ?? '');
    for (const i of AMOUNTS)
      if (out[i] !== '') {
        const n = moneyCents(String(out[i]));
        if (!Number.isSafeInteger(n)) throw Error('LINEPAY_AMOUNT');
        out[i] = n;
      }
    return out;
  });
}

export async function makeLinePayImport(parsed, { fileHash }) {
  if (!fileHash || !parsed?.events?.length) throw Error('NO_RECORDS');
  const now = new Date().toISOString(),
    id = await hash(JSON.stringify(['linepay-v1', fileHash])),
    occurrences = new Map(),
    rows = [];
  for (const e of parsed.events) {
    // Every export repeats the whole history; the content identifies a notification across exports.
    const identity = JSON.stringify([e.date, e.time, e.type, e.amountCents, e.shop, e.balanceCents, e.bank]),
      n = (occurrences.get(identity) || 0) + 1;
    occurrences.set(identity, n);
    rows.push([
      await hash('linepay|' + identity + '#' + n),
      id,
      e.date,
      e.time,
      e.type,
      e.amountCents,
      e.shop,
      e.method,
      e.balanceCents ?? '',
      e.bank,
      now,
      e.line
    ]);
  }
  return {
    id,
    rows,
    log: [
      id,
      'LINE Pay',
      'LINE 錢包',
      'LINE Pay',
      now,
      rows.length,
      0,
      '',
      '',
      '通知 ' + parsed.from + '～' + parsed.to
    ]
  };
}
export function linePayRowsToAppend(existing, incoming) {
  const known = new Set(existing.map(r => r[0])),
    fresh = incoming.filter(r => !known.has(r[0]));
  return { fresh, skipped: incoming.length - fresh.length };
}

export function linePayEvents(rows) {
  const seen = new Set();
  return rows
    .filter(r => r[0] && !seen.has(r[0]) && seen.add(r[0]))
    .map(r => ({
      id: String(r[0]),
      date: String(r[2]),
      time: String(r[3]),
      type: String(r[4]),
      amountCents: r[5],
      shop: String(r[6] || ''),
      method: String(r[7] || ''),
      balanceCents: r[8] === '' ? null : r[8],
      bank: String(r[9] || ''),
      line: Number(r[11]) || 0
    }))
    .filter(e => Number.isSafeInteger(e.amountCents))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.line - b.line);
}

// Bank rows straight from the 銀行存款 sheet (yuan): linked-account debits that may be wallet top-ups.
function topups(bankRows) {
  return bankRows
    .filter(r => r[0] && String(r[5] || '').includes(TOPUP_HINT) && Number(r[6]) > 0)
    .map(r => ({
      key: 'bank:' + r[0],
      date: String(r[3]),
      amountCents: Math.round(Number(r[6]) * 100),
      label: String(r[1]) + ' ' + String(r[5])
    }));
}

export function walletGaps(events, bankRows = []) {
  const gaps = [];
  let balance = null,
    prev = null;
  for (const e of events) {
    if (e.type === '付款' && e.method === '刷卡') continue;
    if (e.type === '取消') {
      prev = e;
      continue;
    }
    const sign = e.type === '儲值' ? 1 : -1;
    if (e.balanceCents === null) {
      // New-style top-up notices omit the balance; carry the running figure forward.
      if (balance !== null) balance += sign * e.amountCents;
      prev = e;
      continue;
    }
    if (balance !== null && prev) {
      const expected = balance + sign * e.amountCents,
        diff = expected - e.balanceCents;
      if (diff !== 0)
        gaps.push({
          id: 'gap:' + prev.id + '>' + e.id,
          from: prev,
          to: e,
          amountCents: Math.abs(diff),
          direction: diff > 0 ? 'out' : 'in'
        });
    }
    balance = e.balanceCents;
    prev = e;
  }
  // Money that arrived unannounced and equals one linked-account debit in that window is that top-up.
  const pool = topups(bankRows),
    used = new Set();
  for (const g of gaps) {
    if (g.direction !== 'in') continue;
    const from = Date.parse(g.from.date + 'T00:00:00Z') - DAY,
      to = Date.parse(g.to.date + 'T00:00:00Z');
    const hit = pool.find(
      t =>
        !used.has(t.key) &&
        t.amountCents === g.amountCents &&
        Date.parse(t.date + 'T00:00:00Z') >= from &&
        Date.parse(t.date + 'T00:00:00Z') <= to
    );
    if (hit) {
      used.add(hit.key);
      g.explainedBy = hit;
    }
    const cancel =
      !hit &&
      events.find(
        e =>
          e.type === '取消' && e.amountCents === g.amountCents && e.date >= g.from.date && e.date <= g.to.date
      );
    if (cancel) g.explainedBy = { key: '', label: '取消付款退回（' + cancel.shop + '）' };
  }
  // List the recent period: the last 60 days, or from the first linked-account debit if bank data reaches further
  // back (so top-ups can be explained). Older gaps, e.g. from before the wallet changed provider, are only counted.
  const start = pool.map(t => t.date).sort()[0] || '';
  const last = events.at(-1)?.date || '';
  const recentStart = last
    ? new Date(Date.parse(last + 'T00:00:00Z') - 60 * DAY).toISOString().slice(0, 10)
    : '';
  const since = [start, recentStart].filter(Boolean).sort()[0] || '';
  const recent = gaps.filter(g => g.to.date >= since);
  const lastWallet = [...events].reverse().find(e => e.balanceCents !== null);
  return {
    gaps: recent,
    older: gaps.length - recent.length,
    since,
    topupKeys: new Set(recent.filter(g => g.explainedBy?.key).map(g => g.explainedBy.key)),
    lastBalance: lastWallet
      ? { date: lastWallet.date, time: lastWallet.time, cents: lastWallet.balanceCents }
      : null
  };
}
