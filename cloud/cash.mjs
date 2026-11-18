// 現金記帳的核心：一筆記帳、現金餘額、本機與試算表的合併，以及試算表各工作表的欄位。
// 這裡不碰網路與畫面，方便測試。金額一律用「分」的整數計算，避免小數誤差。

export const TYPES = ['支出', '收入', '提款', '存入', '儲值'];
// 提款：從銀行領現金，現金增加但不是收入；存入：把現金存回銀行，現金減少但不是支出。
// 儲值：從「渠道」那個帳戶轉進「轉入」的錢包，錢包增加、來源減少，不是支出也不是收入。
// SIGN 是對「渠道」那個帳戶的增減。
export const SIGN = { 支出: -1, 收入: 1, 提款: 1, 存入: -1, 儲值: -1 };
// 渠道：錢從哪裡付、進到哪裡。現金與錢包會算餘額（每一筆都記）；其他渠道是給 BOT 對帳用的參考紀錄。
// 錢包：像 LINE Pay 這樣自己記每一筆、算餘額的帳戶。LINE Pay 是預設錢包，其他可以自己新增。
export const CASH = '現金';
export const WALLET = 'LINE Pay';
export const DEFAULT_WALLETS = [WALLET];
export const DEFAULT_CHANNELS = [CASH, '玉山銀行', '中信銀行', '凱基信用卡', '中信信用卡', 'LINE Pay'];

export const LOG_SHEET = '異動紀錄';
export const LOG_HEADERS = [
  'ID',
  '日期',
  '時間',
  '類型',
  '金額（元）',
  '分類',
  '對象／商店',
  '備註',
  '狀態',
  '建立時間',
  '更新時間',
  '渠道',
  '轉入',
  '排序'
];
// v1.0.0 sheets have no 渠道 column (read as cash); before v1.5.0 there is no 轉入 column (a top-up went into
// LINE Pay); before v1.8.0 there is no 排序 column. All are upgraded on the next sync.
export const LOG_HEADERS_V1 = LOG_HEADERS.slice(0, 11);
export const LOG_HEADERS_V2 = LOG_HEADERS.slice(0, 12);
export const LOG_HEADERS_V3 = LOG_HEADERS.slice(0, 13);
export const DETAIL_SHEET = '記帳明細';
export const DETAIL_HEADERS = [
  '日期',
  '排序',
  '類型',
  '渠道',
  '轉入',
  '金額（元）',
  '增減（元）',
  '主分類',
  '子分類',
  '對象／商店',
  '備註',
  '記帳後現金（元）',
  '記帳後錢包（元）',
  'ID',
  '更新時間'
];
export const MONTH_SHEET = '月份統計';
export const MONTH_HEADERS = [
  '月份',
  '渠道',
  '支出（元）',
  '收入（元）',
  '提款（元）',
  '存入（元）',
  '儲值（元）',
  '筆數',
  '月底餘額（元）'
];
// 試算表欄位或資料意義有變時加 1，並同步更新 BOT 說明書（見 README）。1 = v1.0.0；2 = v1.1.0 起（渠道、選項）；3 = v1.2.0 起（記帳明細可直接打字）；4 = v1.3.0 起（預設渠道指定銀行與信用卡）；5 = v1.4.0 起（LINE Pay 結餘、儲值）；6 = v1.5.0 起（多個錢包、轉入、錢包工作表）。
export const SCHEMA_VERSION = 8;
export const SETTING_SHEET = '設定';
export const SETTING_HEADERS = ['項目', '內容', '說明'];
// 每個錢包一列：起始餘額與日期（空白表示還沒設定）、目前餘額；刪掉的錢包狀態是「已刪除」。
export const WALLET_SHEET = '錢包';
export const WALLET_HEADERS = [
  '錢包',
  '起始餘額（元）',
  '起始日期',
  '設定更新時間',
  '目前餘額（元）',
  '狀態'
];
// 自己新增的渠道、分類、子分類。種類：渠道／支出分類／收入分類；子分類的「上層」填主分類名稱。
export const OPTION_SHEET = '選項';
export const OPTION_HEADERS = ['種類', '名稱', '上層', '圖示', '狀態', '更新時間'];
export const OPTION_KINDS = ['渠道', '支出分類', '收入分類'];
// Channel groups you can put a channel in. 現金 and wallets are groups of their own and are not set here.
export const CHANNEL_GROUPS = ['銀行', '信用卡', '其他'];
export const DEFAULT_CHANNEL_GROUP = {
  玉山銀行: '銀行',
  中信銀行: '銀行',
  凱基信用卡: '信用卡',
  中信信用卡: '信用卡'
};

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseCents(text) {
  const t = String(text ?? '')
    .trim()
    .replace(/[,，\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  const [whole, frac = ''] = t.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
export const yuanText = cents =>
  (cents / 100)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');

// Build one record from the form (or a sheet row); throws a short code the screen turns into a message.
export function makeEntry(input, now = new Date().toISOString()) {
  const e = {
    id: String(input.id || '').trim(),
    date: String(input.date || ''),
    // Kept from records made before v1.8.0, when a time could be filled in; only used to order those.
    time: String(input.time || '').slice(0, 5),
    // The record's place in its day (排序): bigger is later. Blank on records from before v1.8.0.
    rank: rankOf(input.rank),
    type: String(input.type || '支出'),
    amountCents: Number.isSafeInteger(input.amountCents) ? input.amountCents : parseCents(input.amount),
    category: String(input.category || '').trim(),
    channel: String(input.channel || CASH)
      .trim()
      .slice(0, 20),
    to: String(input.to || '')
      .trim()
      .slice(0, 20),
    party: String(input.party || '')
      .trim()
      .slice(0, 60),
    note: String(input.note || '')
      .trim()
      .slice(0, 200),
    createdAt: String(input.createdAt || now),
    updatedAt: String(input.updatedAt || now),
    deleted: !!input.deleted
  };
  if (!e.id || e.id.length > 64) throw Error('CASH_ID');
  if (!DATE.test(e.date)) throw Error('CASH_DATE');
  if (e.time && !TIME.test(e.time)) throw Error('CASH_TIME');
  if (!TYPES.includes(e.type)) throw Error('CASH_TYPE');
  if (!Number.isSafeInteger(e.amountCents) || e.amountCents <= 0 || e.amountCents > 100000000000)
    throw Error('CASH_AMOUNT');
  if ((e.type === '支出' || e.type === '收入') && !e.category) throw Error('CASH_CATEGORY');
  if (e.type === '提款' || e.type === '存入') {
    e.category = '';
    e.channel = CASH;
  }
  if (e.type === '儲值') {
    e.category = '';
    // Records from before v1.5.0 have no destination: they went into LINE Pay.
    e.to ||= WALLET;
    if (e.channel === e.to) throw Error('CASH_TOPUP');
  } else e.to = '';
  if (!e.channel) throw Error('CASH_CHANNEL');
  return e;
}
export const isCash = e => e.channel === CASH;
// The record's money in (+) or out (−) on its own channel.
export const amountOf = e => (e.deleted ? 0 : SIGN[e.type] * e.amountCents);
// How one record moves each account: its own channel by SIGN, and a top-up also adds to its wallet.
export function flowsOf(e) {
  if (e.deleted) return {};
  const out = { [e.channel]: amountOf(e) };
  if (e.type === '儲值') out[e.to] = (out[e.to] || 0) + e.amountCents;
  return out;
}
// The wallet whose balance a record shows: where a top-up went, or the record's own channel.
export const walletOf = (e, wallets) =>
  e.type === '儲值' ? e.to : wallets.includes(e.channel) ? e.channel : '';
export const moves = (e, account) => (flowsOf(e)[account] || 0) !== 0;
// The record's effect on the cash balance (0 when it does not touch cash).
export const flowOf = e => flowsOf(e)[CASH] || 0;
// A 排序 value: a whole number from 1, or null for none.
function rankOf(v) {
  const n = typeof v === 'number' ? v : String(v ?? '').trim() === '' ? NaN : Number(String(v).trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
const legacy = (a, b) =>
  (a.time || '').localeCompare(b.time || '') ||
  a.createdAt.localeCompare(b.createdAt) ||
  a.id.localeCompare(b.id);
// Records of one day in order. A record's key is its 排序; records from before v1.8.0 have none and are keyed
// 1, 2, 3… in their old order (time, then when made), so new records (numbered after them) come later.
function sortDay(list) {
  const keys = new Map();
  list
    .filter(e => e.rank == null)
    .sort(legacy)
    .forEach((e, i) => keys.set(e.id, i + 1));
  const key = e => e.rank ?? keys.get(e.id);
  return list.sort((a, b) => key(a) - key(b) || legacy(a, b));
}
// Live records in order: by date, then by place in the day. Each copy carries `position`, 1, 2, 3… in its day.
export function inOrder(entries) {
  const days = new Map();
  for (const e of entries) {
    if (e.deleted) continue;
    if (!days.has(e.date)) days.set(e.date, []);
    days.get(e.date).push(e);
  }
  return [...days.keys()]
    .sort()
    .flatMap(d => sortDay(days.get(d)).map((e, i) => ({ ...e, position: i + 1 })));
}
// The 排序 that puts a record last on its day.
export function nextRank(entries, date, exceptId = '') {
  const day = inOrder([...entries].filter(e => e.date === date && e.id !== exceptId));
  return day.length ? Math.max(day.length, ...day.map(e => e.rank || 0)) + 1 : 1;
}
// Put record e at place `at` (1 = first) on its day; every record of that day gets 排序 1, 2, 3…
// Returns the records that changed (e always), stamped with `now`.
export function placeInDay(entries, e, at, now) {
  const day = inOrder([...entries].filter(x => x.date === e.date && x.id !== e.id));
  const i = Math.min(Math.max(Math.round(at) - 1, 0), day.length);
  day.splice(i, 0, e);
  const out = [];
  day.forEach((x, n) => {
    if (x.id === e.id) out.push({ ...stripView(e), rank: n + 1, updatedAt: now });
    else if (x.rank !== n + 1) out.push({ ...stripView(x), rank: n + 1, updatedAt: now });
  });
  return out;
}
const stripView = ({ position, ...e }) => e; // eslint-disable-line no-unused-vars

// Newest version of each record wins; on a tie the later one in the list wins.
export function latest(list) {
  const out = new Map();
  for (const e of list) {
    const prior = out.get(e.id);
    if (!prior || e.updatedAt >= prior.updatedAt) out.set(e.id, e);
  }
  return out;
}
// Local and sheet copies: the newer version of each record wins. `upload` are the local versions the
// sheet does not have yet; the sheet's newer versions come back in `merged`.
export function mergeEntries(local, remote) {
  const merged = new Map(remote);
  const upload = [];
  for (const [id, e] of local) {
    const r = remote.get(id);
    if (!r || e.updatedAt > r.updatedAt) {
      merged.set(id, e);
      upload.push(e);
    }
  }
  return { merged, upload };
}
// A setting is { cents, date, updatedAt }: the cash counted at 00:00 on date.
export function mergeSetting(local, remote) {
  if (!local) return remote || null;
  if (!remote) return local;
  return local.updatedAt > remote.updatedAt ? local : remote;
}

export function logRow(e) {
  return [
    e.id,
    e.date,
    e.time,
    e.type,
    e.amountCents / 100,
    e.category,
    e.party,
    e.note,
    e.deleted ? '已刪除' : '有效',
    e.createdAt,
    e.updatedAt,
    e.channel,
    e.to,
    e.rank ?? ''
  ];
}
export function readLog(values) {
  if (!values.length) return [];
  const head = JSON.stringify(values[0]);
  if (![LOG_HEADERS, LOG_HEADERS_V3, LOG_HEADERS_V2, LOG_HEADERS_V1].some(h => head === JSON.stringify(h)))
    throw Error('SHEET_SCHEMA');
  const out = [];
  for (const r of values.slice(1)) {
    try {
      out.push(
        makeEntry({
          id: r[0],
          date: String(r[1] ?? ''),
          time: String(r[2] ?? ''),
          type: r[3],
          amountCents: parseCents(String(r[4] ?? '')),
          category: r[5],
          party: r[6],
          note: r[7],
          deleted: r[8] === '已刪除',
          createdAt: String(r[9] || ''),
          updatedAt: String(r[10] || ''),
          channel: String(r[11] || CASH),
          to: String(r[12] || ''),
          rank: r[13]
        })
      );
    } catch {
      // A row edited by hand into something invalid is skipped, never fatal.
    }
  }
  return out;
}

// Every live record in time order. Records that move cash carry `balanceCents` (cash left after them) and
// records that move LINE Pay carry `walletCents`; others get null. A setting is the amount counted at 00:00 on its
// day: records from that day on add up from it, earlier ones are worked out backwards.
function runBalance(rows, account, setting, set) {
  const list = rows.filter(e => moves(e, account));
  const start = setting?.cents ?? 0,
    anchorDate = setting?.date || '';
  let anchor = anchorDate ? list.findIndex(e => e.date >= anchorDate) : 0;
  if (anchor < 0) anchor = list.length;
  let run = start;
  for (let i = anchor; i < list.length; i++) set(list[i], (run += flowsOf(list[i])[account]));
  run = start;
  for (let i = anchor - 1; i >= 0; i--) {
    set(list[i], run);
    run -= flowsOf(list[i])[account];
  }
}

// ---------- Wallets ----------
// A wallet is { name, cents, date, updatedAt, deleted }; cents null means no starting balance yet.
export function makeWallet(input, now = new Date().toISOString()) {
  const cents = input.cents ?? null;
  const w = {
    name: String(input.name || '')
      .trim()
      .replace(/／/g, '/')
      .slice(0, 20),
    cents: Number.isSafeInteger(cents) ? cents : null,
    date: String(input.date || ''),
    updatedAt: String(input.updatedAt || now),
    deleted: !!input.deleted
  };
  if (!w.name) throw Error('OPTION_NAME');
  if (w.name === CASH) throw Error('WALLET_CASH');
  if (w.cents != null && (w.cents < 0 || !DATE.test(w.date))) throw Error('CASH_AMOUNT');
  if (w.cents == null) w.date = '';
  if (DEFAULT_WALLETS.includes(w.name)) w.deleted = false;
  return w;
}
// Older callers pass a single LINE Pay setting instead of a Map of wallets.
const asWallets = w =>
  w instanceof Map ? w : w ? new Map([[WALLET, { name: WALLET, ...w, deleted: false }]]) : new Map();
export function walletNames(wallets = new Map()) {
  const names = [...DEFAULT_WALLETS];
  for (const w of asWallets(wallets).values()) if (!w.deleted && !names.includes(w.name)) names.push(w.name);
  return names;
}
export const anchorOf = w => (w && w.cents != null && w.date ? { cents: w.cents, date: w.date } : null);
export function mergeWallets(local, remote) {
  const out = new Map(remote);
  for (const [k, w] of local) if (!out.has(k) || w.updatedAt > out.get(k).updatedAt) out.set(k, w);
  return out;
}

// Every live record in time order. Records that move cash carry `balanceCents` (cash left after them);
// records that move a wallet with a starting balance carry `wallet` and `walletCents` (that wallet after them).
// A starting balance is the amount at 00:00 on its day: records from that day on add up from it, earlier ones are
// worked out backwards.
export function ledger(entries, setting, wallets = new Map()) {
  wallets = asWallets(wallets);
  const names = walletNames(wallets);
  const out = inOrder(entries).map(e => ({
    ...e,
    amountSigned: amountOf(e),
    flowCents: flowOf(e),
    balanceCents: null,
    wallet: walletOf(e, names),
    walletCents: null,
    walletBalances: {}
  }));
  runBalance(out, CASH, setting, (e, v) => (e.balanceCents = v));
  for (const name of names) {
    const a = anchorOf(wallets.get(name));
    if (a) runBalance(out, name, a, (e, v) => (e.walletBalances[name] = v));
  }
  for (const e of out)
    if (e.wallet && e.walletBalances[e.wallet] != null) e.walletCents = e.walletBalances[e.wallet];
  return out;
}
// Balance of 現金 or a wallet now: the starting balance plus every record from its day on.
export function balanceNow(entries, setting, account = CASH) {
  const anchorDate = setting?.date || '';
  return (
    (setting?.cents ?? 0) +
    [...entries]
      .filter(e => !e.deleted && e.date >= anchorDate)
      .reduce((s, e) => s + (flowsOf(e)[account] || 0), 0)
  );
}
export const cashNow = (entries, setting) => balanceNow(entries, setting, CASH);
export function walletRows(wallets, entries) {
  // entries may be a one-shot iterator (map.values()); every wallet needs to walk it.
  entries = [...entries];
  const list = asWallets(wallets);
  const rows = walletNames(list).map(name => list.get(name) || makeWallet({ name, updatedAt: '' }));
  for (const w of list.values()) if (w.deleted && !rows.includes(w)) rows.push(w);
  return [
    WALLET_HEADERS,
    ...rows.map(w => {
      const a = anchorOf(w);
      return [
        w.name,
        a ? a.cents / 100 : '',
        a ? a.date : '',
        w.updatedAt,
        a && !w.deleted ? balanceNow(entries, a, w.name) / 100 : '',
        w.deleted ? '已刪除' : '使用中'
      ];
    })
  ];
}
export function readWallets(values) {
  const out = new Map();
  if (!values.length || JSON.stringify(values[0]) !== JSON.stringify(WALLET_HEADERS)) return out;
  for (const r of values.slice(1)) {
    try {
      const cents = String(r[1] ?? '') === '' ? null : parseCents(String(r[1]));
      const w = makeWallet({
        name: String(r[0] ?? ''),
        cents: Number.isSafeInteger(cents) ? cents : null,
        date: String(r[2] ?? ''),
        updatedAt: String(r[3] || ''),
        deleted: r[5] === '已刪除'
      });
      if (!out.has(w.name) || w.updatedAt >= out.get(w.name).updatedAt) out.set(w.name, w);
    } catch {
      // Skip rows edited by hand into something unreadable.
    }
  }
  return out;
}

// channel '' means every channel.
export function monthSummary(entries, month, channel = '') {
  const out = {
    month,
    expenseCents: 0,
    incomeCents: 0,
    withdrawCents: 0,
    depositCents: 0,
    topupCents: 0,
    count: 0,
    byCategory: []
  };
  const by = new Map();
  for (const e of entries) {
    // A top-up shows under its source and under LINE Pay.
    const inChannel = !channel || e.channel === channel || (e.type === '儲值' && e.to === channel);
    if (e.deleted || e.date.slice(0, 7) !== month || !inChannel) continue;
    out.count++;
    if (e.type === '支出') {
      out.expenseCents += e.amountCents;
      const main = e.category.split('／')[0];
      by.set(main, (by.get(main) || 0) + e.amountCents);
    } else if (e.type === '收入') out.incomeCents += e.amountCents;
    else if (e.type === '提款') out.withdrawCents += e.amountCents;
    else if (e.type === '存入') out.depositCents += e.amountCents;
    else out.topupCents += e.amountCents;
  }
  out.byCategory = [...by].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents);
  return out;
}

export function detailRows(rows) {
  return [
    DETAIL_HEADERS,
    ...rows.map(e => {
      const [main = '', sub = ''] = e.category.split('／');
      return [
        e.date,
        e.position ?? '',
        e.type,
        e.channel,
        e.to,
        e.amountCents / 100,
        e.amountSigned / 100,
        main,
        sub,
        e.party,
        e.note,
        e.balanceCents == null ? '' : e.balanceCents / 100,
        e.walletCents == null ? '' : e.walletCents / 100,
        e.id,
        e.updatedAt
      ];
    })
  ];
}
// One row per month and channel. A top-up is counted on the wallet it went into. 月底餘額 is filled for 現金 and
// each wallet with a starting balance: the balance after the month's last record that moved that account.
export function monthRows(rows) {
  const groups = new Map();
  const group = (m, channel) => {
    const key = m + '\u0000' + channel;
    if (!groups.has(key))
      groups.set(key, { 支出: 0, 收入: 0, 提款: 0, 存入: 0, 儲值: 0, count: 0, end: null });
    return groups.get(key);
  };
  for (const e of rows) {
    const m = e.date.slice(0, 7);
    // A top-up is counted on the wallet it went into.
    const t = group(m, e.type === '儲值' ? e.to : e.channel);
    t[e.type] += e.amountCents;
    t.count++;
    if (e.balanceCents != null) group(m, CASH).end = e.balanceCents;
    for (const [name, cents] of Object.entries(e.walletBalances || {})) group(m, name).end = cents;
  }
  return [
    MONTH_HEADERS,
    ...[...groups].map(([key, t]) => {
      const [m, channel] = key.split('\u0000');
      return [
        m,
        channel,
        t.支出 / 100,
        t.收入 / 100,
        t.提款 / 100,
        t.存入 / 100,
        t.儲值 / 100,
        t.count,
        t.end == null ? '' : t.end / 100
      ];
    })
  ];
}

// ---------- Your own channels and categories ----------
// An option is { kind: 渠道|支出分類|收入分類, name, parent, icon, deleted, updatedAt }.
// A sub-category has the main category's name in parent. For a channel, parent is its group (銀行／信用卡／
// 其他; blank means the default group), and is not part of the key, so moving a channel keeps one row.
// Removing one keeps a row marked 已刪除 so other devices learn about it; a default channel can be removed too.
export const optionKey = o =>
  o.kind + '\u0000' + (o.kind === '渠道' ? '' : o.parent || '') + '\u0000' + o.name;
export function makeOption(input, now = new Date().toISOString()) {
  const o = {
    kind: String(input.kind || ''),
    name: String(input.name || '')
      .trim()
      .replace(/／/g, '/')
      .slice(0, 20),
    parent: String(input.parent || '').trim(),
    icon: String(input.icon || '')
      .trim()
      .slice(0, 4),
    deleted: !!input.deleted,
    updatedAt: String(input.updatedAt || now)
  };
  if (!OPTION_KINDS.includes(o.kind)) throw Error('OPTION_KIND');
  if (!o.name) throw Error('OPTION_NAME');
  if (o.kind === '渠道') {
    if (o.name === CASH) throw Error('OPTION_CASH');
    if (!CHANNEL_GROUPS.includes(o.parent)) o.parent = '';
  }
  return o;
}
export function mergeOptions(local, remote) {
  const out = new Map(remote);
  for (const [k, o] of local) if (!out.has(k) || o.updatedAt > out.get(k).updatedAt) out.set(k, o);
  return out;
}
export function optionRows(options) {
  return [
    OPTION_HEADERS,
    ...[...options.values()].map(o => [
      o.kind,
      o.name,
      o.parent,
      o.icon,
      o.deleted ? '已刪除' : '使用中',
      o.updatedAt
    ])
  ];
}
export function readOptions(values) {
  const out = new Map();
  if (!values.length || JSON.stringify(values[0]) !== JSON.stringify(OPTION_HEADERS)) return out;
  for (const r of values.slice(1)) {
    try {
      const o = makeOption({
        kind: r[0],
        name: String(r[1] ?? ''),
        parent: String(r[2] ?? ''),
        icon: String(r[3] ?? ''),
        deleted: r[4] === '已刪除',
        updatedAt: String(r[5] || '')
      });
      const k = optionKey(o);
      if (!out.has(k) || o.updatedAt >= out.get(k).updatedAt) out.set(k, o);
    } catch {
      // Skip rows edited by hand into something unreadable.
    }
  }
  return out;
}
// Channels by group, in the order they are shown: 現金, wallets, 銀行, 信用卡, 其他.
// Default channels can be moved to another group or removed through an option row with their name.
export function channelGroups(options, wallets = new Map()) {
  const inWallets = new Set(walletNames(wallets));
  const groups = new Map(CHANNEL_GROUPS.map(g => [g, []]));
  const own = [...options.values()].filter(o => o.kind === '渠道').map(o => o.name);
  for (const name of new Set([...DEFAULT_CHANNELS, ...own])) {
    if (name === CASH || inWallets.has(name)) continue;
    const row = options.get(optionKey({ kind: '渠道', name }));
    if (row?.deleted) continue;
    groups.get(row?.parent || DEFAULT_CHANNEL_GROUP[name] || '其他').push(name);
  }
  return [[CASH, [CASH]], ['錢包', [...inWallets]], ...groups];
}
// Channels to pick from: 現金, every wallet, then banks, cards and the rest.
export function channelList(options, wallets = new Map()) {
  return channelGroups(options, wallets).flatMap(([, names]) => names);
}
// Accounts a 提款 comes from or a 存入 goes to: banks first, never 現金 or a wallet (use 儲值 for a wallet).
export function transferAccounts(options, wallets = new Map()) {
  return channelGroups(options, wallets)
    .filter(([g]) => CHANNEL_GROUPS.includes(g))
    .flatMap(([, names]) => names);
}
// The category tree for 支出 or 收入: built-in categories plus your own main and sub categories.
export function categoryTree(base, options, type) {
  const kind = type + '分類';
  const live = [...options.values()].filter(o => o.kind === kind && !o.deleted);
  const tree = base.map(c => ({ ...c, subs: [...c.subs], own: false }));
  for (const o of live.filter(o => !o.parent))
    if (!tree.some(c => c.name === o.name))
      tree.push({ name: o.name, icon: o.icon || '🏷️', subs: [], own: true });
  for (const o of live.filter(o => o.parent)) {
    const main = tree.find(c => c.name === o.parent);
    if (main && !main.subs.includes(o.name)) main.subs.push(o.name);
  }
  return tree.map(c => ({
    ...c,
    ownSubs: live.filter(o => o.parent === c.name).map(o => o.name)
  }));
}
// Wallet balances now live in the 錢包 sheet; 設定 keeps cash and the sheet-wide items.
export function settingRows(setting, cashCents) {
  return [
    SETTING_HEADERS,
    ['起始現金（元）', setting ? setting.cents / 100 : '', '設定當天 00:00 身上的現金'],
    ['起始日期', setting?.date || '', '這一天（含）以後的記帳往後加減，之前的往回推'],
    ['設定更新時間', setting?.updatedAt || '', ''],
    ['目前現金（元）', cashCents / 100, '最後一次同步時算出的金額'],
    ['同步時間', new Date().toISOString(), ''],
    [
      '資料格式版本',
      SCHEMA_VERSION,
      '欄位或資料意義改變時加 1，對照「BOT 說明書（現金記帳）」開頭標示的版本'
    ],
    [
      '說明',
      '「記帳明細」一列一筆、已是最新狀態；「記帳後現金」「記帳後錢包」只在那一筆動到該帳戶時才有值。錢包的起始與目前餘額在「錢包」工作表。「異動紀錄」保留每次修改，請勿手動編輯。',
      ''
    ]
  ];
}
function readAnchor(values, amountName, dateName, timeName) {
  const get = name => values.find(r => r[0] === name)?.[1];
  const cents = parseCents(String(get(amountName) ?? '')),
    date = String(get(dateName) ?? ''),
    updatedAt = String(get(timeName) ?? '');
  if (!Number.isSafeInteger(cents) || !DATE.test(date)) return null;
  return { cents, date, updatedAt };
}
export const readSetting = values => readAnchor(values, '起始現金（元）', '起始日期', '設定更新時間');
// v1.4.0 kept the LINE Pay starting balance in 設定; it is read once and moved to the 錢包 sheet.
export const readWalletSetting = values =>
  readAnchor(values, 'LINE Pay 起始餘額（元）', 'LINE Pay 起始日期', 'LINE Pay 設定更新時間');

// ---------- Rows typed straight into 記帳明細 ----------
// The sheet is rewritten on every sync, so before that we read it back: a row without an ID is a new record
// typed in the sheet, a row whose content differs from the stored version is an edit, and 類型 = 刪除 deletes.
// Removing a whole row does nothing (the row comes back), so a slip of the mouse never deletes a record.
// Any row that cannot be read stops the sync, so nothing typed in the sheet is ever overwritten.
export const DELETE_WORD = '刪除';
const pad2 = n => String(n).padStart(2, '0');
function looseDate(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // A spreadsheet serial day number.
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  const m = String(v ?? '')
    .trim()
    .match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:\s.*)?$/);
  if (!m) return '';
  const date = m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]);
  const check = new Date(date + 'T00:00:00Z');
  return DATE.test(date) && check.getUTCDate() === +m[3] ? date : '';
}
function looseTime(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const minutes = Math.round(v * 1440);
    return pad2(Math.floor(minutes / 60) % 24) + ':' + pad2(minutes % 60);
  }
  const m = String(v)
    .trim()
    .match(/^(上午|下午|AM|PM)?\s*(\d{1,2})[:：](\d{2})(?:[:：]\d{2})?\s*(AM|PM|上午|下午)?$/i);
  if (!m) return null;
  let h = +m[2];
  const half = (m[1] || m[4] || '').toUpperCase();
  if ((half === '下午' || half === 'PM') && h < 12) h += 12;
  if ((half === '上午' || half === 'AM') && h === 12) h = 0;
  return h < 24 ? pad2(h) + ':' + m[3] : null;
}
function looseCents(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(Math.abs(v) * 100) : NaN;
  return parseCents(String(v ?? '').replace(/^[-−]/, ''));
}
const SAME = ['date', 'time', 'type', 'channel', 'to', 'amountCents', 'category', 'party', 'note'];
const ROW_REASONS = {
  CASH_DATE: '日期看不懂，請用 2026-11-13 或 2026/11/13',
  CASH_TIME: '時間看不懂，請用 14:30，或留空',
  CASH_TYPE: '類型只能是支出、收入、提款、存入、儲值，或「刪除」',
  CASH_TOPUP: '儲值的渠道要填錢從哪裡來（例如現金、玉山銀行），「轉入」填要儲值的錢包，兩個不能一樣',
  CASH_AMOUNT: '金額要是大於 0 的數字',
  CASH_CHANNEL: '渠道不能是空的',
  CASH_ID: 'ID 不正確，新增的列請讓 ID 留空',
  CASH_RANK: '排序要是 1 以上的整數，或留空'
};
// values: the 記帳明細 sheet as read; known: the stored records by ID.
// Returns { changes: records to save, problems: [{ row, reason }] }.
export function readDetailEdits(
  values,
  known,
  { now = new Date().toISOString(), newId = () => crypto.randomUUID() } = {}
) {
  const changes = [],
    problems = [];
  if (!values.length) return { changes, problems };
  const head = values[0].map(h => String(h).trim());
  const col = name => head.indexOf(name);
  const need = ['日期', '類型', '渠道', '金額（元）', '主分類', '子分類', '對象／商店', '備註', 'ID'];
  const missing = need.filter(n => col(n) < 0);
  if (missing.length)
    return {
      changes,
      problems: [{ row: 1, reason: '找不到欄位：' + missing.join('、') + '。請還原第一列的欄名' }]
    };
  // 轉入 is optional (sheets from before v1.5.0 do not have it). Sheets from before v1.8.0 have 時間 where
  // newer ones have 排序.
  const cell = (r, name) => (col(name) < 0 ? '' : (r[col(name)] ?? ''));
  const hasRank = col('排序') >= 0,
    hasTime = col('時間') >= 0;
  const positions = new Map(inOrder(known.values()).map(e => [e.id, e.position]));
  const moves = []; // { e, at }: records whose 排序 was typed or changed, placed once all rows are read
  values.slice(1).forEach((r, i) => {
    const row = i + 2;
    if (!r.some(v => String(v ?? '').trim() !== '')) return;
    const id = String(cell(r, 'ID')).trim();
    const old = id ? known.get(id) : null;
    const typeText = String(cell(r, '類型')).trim();
    if (typeText === DELETE_WORD) {
      if (old && !old.deleted) changes.push({ ...old, deleted: true, updatedAt: now });
      return;
    }
    const date = looseDate(cell(r, '日期'));
    const time = hasTime ? looseTime(cell(r, '時間')) : old?.time || '';
    const rankText = hasRank ? String(cell(r, '排序')).trim() : '';
    const type = typeText || '支出';
    const main = String(cell(r, '主分類')).trim(),
      sub = String(cell(r, '子分類')).trim();
    const category =
      type === '支出' || type === '收入'
        ? (main || (type === '收入' ? '其他收入' : '其他')) + (sub ? '／' + sub : '')
        : '';
    try {
      if (!date) throw Error('CASH_DATE');
      if (time === null) throw Error('CASH_TIME');
      const at = rankText === '' ? null : Number(rankText);
      if (at !== null && !(Number.isSafeInteger(at) && at > 0)) throw Error('CASH_RANK');
      const e = makeEntry({
        id: id || newId(),
        date,
        time,
        rank: old?.rank,
        type,
        amountCents: looseCents(cell(r, '金額（元）')),
        category,
        channel: String(cell(r, '渠道')).trim() || CASH,
        to: String(cell(r, '轉入')).trim(),
        party: String(cell(r, '對象／商店')),
        note: String(cell(r, '備註')),
        createdAt: old?.createdAt || now,
        updatedAt: now
      });
      // A new row, a row moved to another day, or a changed 排序 needs a place in its day.
      const moved = !old || old.deleted || old.date !== e.date;
      if (moved || (at !== null && at !== positions.get(id))) moves.push({ e, at, row });
      else if (!SAME.every(k => old[k] === e[k])) changes.push(e);
    } catch (error) {
      problems.push({ row, reason: ROW_REASONS[error.message] || '這一列看不懂' });
    }
  });
  // Place moved records one by one, top row first, against the records as they stand after the earlier moves.
  // A blank 排序 puts the record last on its day.
  const all = new Map(known);
  for (const e of changes) all.set(e.id, e);
  for (const { e, at } of moves) {
    if (at === null) all.set(e.id, { ...e, rank: nextRank(all.values(), e.date, e.id) });
    else
      for (const x of placeInDay(
        [...all.values()].filter(x => x.id !== e.id),
        e,
        at,
        now
      ))
        all.set(x.id, x);
  }
  const ids = new Set([...changes.map(e => e.id), ...moves.map(m => m.e.id)]);
  // Records renumbered by a move change too.
  for (const [id, x] of all) if (!ids.has(id) && x !== known.get(id)) ids.add(id);
  return { changes: [...ids].map(id => all.get(id)), problems };
}

// Search: every word of the query must appear in the record's store, note, category, channel,
// destination wallet or type (full-width and half-width letters match, case is ignored). A word that
// is a number also matches the amount exactly, so 「160」 finds a 160-元 record.
const fold = text =>
  String(text ?? '')
    .normalize('NFKC')
    .toLowerCase();
export function searchWords(query) {
  return fold(query).split(/\s+/).filter(Boolean);
}
export function matchesSearch(e, words) {
  if (e.deleted || !words.length) return false;
  const text = fold([e.party, e.note, e.category, e.channel, e.to, e.type].join(' '));
  const amount = fold(e.amountCents / 100);
  return words.every(w => text.includes(w) || w.replace(/,/g, '') === amount);
}
