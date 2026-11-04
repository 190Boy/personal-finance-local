// 帳戶與餘額：銀行用對帳單最後的餘額、LINE Pay 錢包用最後一則通知的餘額，之後的手動記帳再加減上去；
// 現金沒有任何對帳來源，從你設定的目前現金開始，加上銀行明細裡的提款與手動記帳。
// 現金的設定一律以「填寫當天 00:00」為準：當天以後的流量往後加，當天以前的日期則從這個時間點往回推。
import { moneyCents } from '../pdf-parser/parser.mjs';

export const ACCOUNT_SETTINGS_HEADERS = ['帳戶', '期初餘額（元）', '期初日期', '備註', '更新時間'];
export const CASH = '現金';
export const WALLET = 'LINE Pay 錢包';
const WITHDRAWAL = /提款|atm提/i;

export function settingsTable(values) {
  if (!values.length) return new Map();
  if (JSON.stringify(values[0]) !== JSON.stringify(ACCOUNT_SETTINGS_HEADERS)) throw Error('SHEET_SCHEMA');
  const latest = new Map();
  for (const r of values.slice(1)) {
    const name = String(r[0] || ''),
      cents = moneyCents(String(r[1] ?? '')),
      at = String(r[4] || '');
    if (!name || !Number.isSafeInteger(cents)) continue;
    if (!latest.has(name) || at >= latest.get(name).at)
      latest.set(name, { cents, date: String(r[2] || ''), note: String(r[3] || ''), at });
  }
  return latest;
}
// date is the day the amount was counted; it means the start of that day (00:00).
export function settingsRow(name, cents, date, note = '') {
  return [name, cents / 100, date, note, new Date().toISOString()];
}

// Hand-entered methods were free text before accounts existed ("玉山帳戶", "中信卡 LINE Pay").
export function resolveAccount(method, names) {
  const m = String(method || '').trim();
  if (!m) return '';
  if (names.includes(m)) return m;
  if (/line\s*pay\s*錢包/i.test(m)) return WALLET;
  const bankHint = [
    [/玉山/, '玉山'],
    [/中信|中國信託/, '中國信託'],
    [/凱基/, '凱基']
  ].find(([re]) => re.test(m))?.[1];
  if (bankHint) {
    const card = /卡/.test(m);
    const hit = names.find(
      n =>
        n.startsWith(bankHint) &&
        (card ? /卡/.test(n.split('／')[1] || '') : !/卡/.test(n.split('／')[1] || ''))
    );
    if (hit) return hit;
  }
  return m;
}

export function accountNames({
  bankBalances = [],
  credits = { accounts: [] },
  wallet = null,
  manual = [],
  settings = new Map()
}) {
  const names = [
    CASH,
    ...bankBalances.map(b => b.bank + '／' + b.account),
    ...credits.accounts.map(c => c.bank + '／' + c.account)
  ];
  if (wallet?.lastBalance || manual.some(e => /line\s*pay\s*錢包/i.test(e.method))) names.push(WALLET);
  for (const name of settings.keys()) if (!names.includes(name)) names.push(name);
  const known = [...names];
  for (const e of manual)
    for (const m of [e.method, e.type === '轉帳' ? e.party : ''])
      if (m && m !== '其他') {
        const name = resolveAccount(m, known);
        if (!names.includes(name)) names.push(name);
      }
  return [...new Set(names)];
}

// The flow of one hand-entered record on one account, in cents.
function flow(e, name, names) {
  const from = resolveAccount(e.method, names);
  if (e.type === '轉帳')
    return (
      (resolveAccount(e.party, names) === name ? e.amountCents : 0) - (from === name ? e.amountCents : 0)
    );
  if (from !== name) return 0;
  return e.type === '收入' ? e.amountCents : -e.amountCents;
}

export function computeBalances({
  bankBalances = [],
  bankRows = [],
  credits = { accounts: [] },
  wallet = null,
  manual = [],
  settings = new Map()
}) {
  const names = accountNames({ bankBalances, credits, wallet, manual, settings });
  const after = (name, date) => {
    const list = manual.filter(e => (!date || e.date > date) && flow(e, name, names) !== 0);
    return { cents: list.reduce((s, e) => s + flow(e, name, names), 0), count: list.length };
  };
  const accounts = [];
  for (const b of bankBalances) {
    const name = b.bank + '／' + b.account,
      extra = after(name, b.date);
    accounts.push({
      name,
      type: '銀行',
      cents: b.cents + extra.cents,
      asOf: b.date,
      note: b.date + ' 對帳單餘額' + (extra.count ? '，加上之後 ' + extra.count + ' 筆手動記帳' : '')
    });
  }
  if (names.includes(WALLET)) {
    const base = wallet?.lastBalance,
      extra = after(WALLET, base?.date || '');
    accounts.push({
      name: WALLET,
      type: '電子支付',
      cents: (base?.cents || 0) + extra.cents,
      asOf: base?.date || '',
      note: base
        ? base.date + ' 最後一則通知的餘額' + (extra.count ? '，加上之後 ' + extra.count + ' 筆手動記帳' : '')
        : '尚未匯入 LINE 錢包聊天記錄，只計算手動記帳',
      partial: !base
    });
  }
  // Cash: the amount the user counted, as of 00:00 on that day; withdrawals and hand entries from that day on.
  const start = settings.get(CASH);
  const flows = cashFlows(bankRows, manual, names).filter(f => !start?.date || f.date >= start.date);
  const withdrawals = flows.filter(f => f.kind === 'withdrawal').length,
    hand = flows.filter(f => f.kind === 'manual').length;
  accounts.push({
    name: CASH,
    type: '現金',
    cents: (start?.cents || 0) + flows.reduce((s, f) => s + f.cents, 0),
    asOf: start?.date || '',
    note:
      (start ? start.date + ' 00:00 設定的現金' : '尚未設定目前現金，從 0 開始') +
      (withdrawals ? '，加上銀行提款 ' + withdrawals + ' 筆' : '') +
      (hand ? '，手動記帳 ' + hand + ' 筆' : ''),
    partial: !start
  });
  for (const c of credits.accounts)
    accounts.push({
      name: c.bank + '／' + c.account,
      type: '信用卡',
      cents: -c.cents,
      asOf: c.month,
      note: c.month + ' 帳單月份的消費合計（不是銀行確認的待繳）',
      liability: true
    });
  // Accounts that only exist through hand entries or settings (e.g. an easy card).
  const listed = new Set(accounts.map(a => a.name));
  for (const name of names)
    if (!listed.has(name)) {
      const s = settings.get(name),
        extra = after(name, s?.date || '');
      accounts.push({
        name,
        type: '其他',
        cents: (s?.cents || 0) + extra.cents,
        asOf: s?.date || '',
        note: (s ? s.date + ' 設定的餘額，' : '') + '手動記帳 ' + extra.count + ' 筆',
        partial: !s
      });
    }
  const assets = accounts.filter(a => !a.liability).reduce((s, a) => s + a.cents, 0),
    liabilities = accounts.filter(a => a.liability).reduce((s, a) => s - a.cents, 0);
  return { accounts, names, assetsCents: assets, liabilitiesCents: liabilities };
}

// Every movement of cash: withdrawals in the bank statements plus hand entries, each with its day.
function cashFlows(bankRows, manual, names) {
  const out = [];
  for (const r of bankRows)
    if (WITHDRAWAL.test(String(r[5] || '')) && Number(r[6]) > 0)
      out.push({ date: String(r[3]), cents: Math.round(Number(r[6]) * 100), kind: 'withdrawal' });
  for (const e of manual) {
    const cents = flow(e, CASH, names);
    if (cents) out.push({ date: e.date, cents, kind: 'manual' });
  }
  return out;
}

// Cash at 00:00 of any day, worked out from the counted amount: forwards by adding the flows from the
// counting day up to the day before, backwards by taking back the flows from that day up to the counting day.
export function cashAt(date, { bankRows = [], manual = [], settings = new Map(), names } = {}) {
  const start = settings.get(CASH);
  if (!start?.date) return null;
  const all = cashFlows(bankRows, manual, names || accountNames({ manual, settings }));
  const sum = list => list.reduce((s, f) => s + f.cents, 0);
  if (date >= start.date) return start.cents + sum(all.filter(f => f.date >= start.date && f.date < date));
  return start.cents - sum(all.filter(f => f.date >= date && f.date < start.date));
}

// A transfer's category follows from where the money went.
export function transferCategory(to) {
  if (to === CASH) return '內部轉帳／提款';
  if (to === WALLET) return '內部轉帳／儲值';
  if (/卡/.test(String(to).split('／')[1] || '')) return '內部轉帳／繳卡費';
  return '內部轉帳／帳戶互轉';
}
