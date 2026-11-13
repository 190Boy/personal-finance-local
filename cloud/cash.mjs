// 現金記帳的核心：一筆記帳、現金餘額、本機與試算表的合併，以及試算表各工作表的欄位。
// 這裡不碰網路與畫面，方便測試。金額一律用「分」的整數計算，避免小數誤差。

export const TYPES = ['支出', '收入', '提款', '存入'];
// 提款：從銀行領現金，現金增加但不是收入；存入：把現金存回銀行，現金減少但不是支出。
export const SIGN = { 支出: -1, 收入: 1, 提款: 1, 存入: -1 };
// 渠道：錢從哪裡付、進到哪裡。只有「現金」會影響現金餘額；其他渠道是給 BOT 對帳用的參考紀錄。
export const CASH = '現金';
export const DEFAULT_CHANNELS = [CASH, '銀行', '信用卡', 'LINE Pay'];

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
  '渠道'
];
// v1.0.0 sheets have no 渠道 column; they are read as cash and upgraded on the next sync.
export const LOG_HEADERS_V1 = LOG_HEADERS.slice(0, 11);
export const DETAIL_SHEET = '記帳明細';
export const DETAIL_HEADERS = [
  '日期',
  '時間',
  '類型',
  '渠道',
  '金額（元）',
  '增減（元）',
  '主分類',
  '子分類',
  '對象／商店',
  '備註',
  '記帳後現金（元）',
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
  '筆數',
  '月底現金（元）'
];
// 試算表欄位或資料意義有變時加 1，並同步更新 docs/BOT.md。1 = v1.0.0；2 = v1.1.0 起（渠道、選項）。
export const SCHEMA_VERSION = 2;
export const SETTING_SHEET = '設定';
export const SETTING_HEADERS = ['項目', '內容', '說明'];
// 自己新增的渠道、分類、子分類。種類：渠道／支出分類／收入分類；子分類的「上層」填主分類名稱。
export const OPTION_SHEET = '選項';
export const OPTION_HEADERS = ['種類', '名稱', '上層', '圖示', '狀態', '更新時間'];
export const OPTION_KINDS = ['渠道', '支出分類', '收入分類'];

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
    time: String(input.time || '').slice(0, 5),
    type: String(input.type || '支出'),
    amountCents: Number.isSafeInteger(input.amountCents) ? input.amountCents : parseCents(input.amount),
    category: String(input.category || '').trim(),
    channel: String(input.channel || CASH)
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
  if (!e.channel) throw Error('CASH_CHANNEL');
  return e;
}
export const isCash = e => e.channel === CASH;
// The record's money in (+) or out (−) on its own channel.
export const amountOf = e => (e.deleted ? 0 : SIGN[e.type] * e.amountCents);
// Only cash records move the cash balance.
export const flowOf = e => (isCash(e) ? amountOf(e) : 0);
const order = (a, b) =>
  a.date.localeCompare(b.date) ||
  (a.time || '').localeCompare(b.time || '') ||
  a.createdAt.localeCompare(b.createdAt) ||
  a.id.localeCompare(b.id);

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
    e.channel
  ];
}
export function readLog(values) {
  if (!values.length) return [];
  const head = JSON.stringify(values[0]);
  if (head !== JSON.stringify(LOG_HEADERS) && head !== JSON.stringify(LOG_HEADERS_V1))
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
          channel: String(r[11] || CASH)
        })
      );
    } catch {
      // A row edited by hand into something invalid is skipped, never fatal.
    }
  }
  return out;
}

// Every live record in time order. Cash records carry the cash left after them; other channels get null.
// The counted amount is the cash at 00:00 on the setting's day: cash records from that day on add up from it,
// earlier ones are worked out backwards.
export function ledger(entries, setting) {
  const out = [...entries]
    .filter(e => !e.deleted)
    .sort(order)
    .map(e => ({ ...e, amountSigned: amountOf(e), flowCents: flowOf(e), balanceCents: null }));
  const cash = out.filter(isCash);
  const start = setting?.cents ?? 0,
    anchorDate = setting?.date || '';
  let anchor = anchorDate ? cash.findIndex(e => e.date >= anchorDate) : 0;
  if (anchor < 0) anchor = cash.length;
  let run = start;
  for (let i = anchor; i < cash.length; i++) cash[i].balanceCents = run += cash[i].flowCents;
  run = start;
  for (let i = anchor - 1; i >= 0; i--) {
    cash[i].balanceCents = run;
    run -= cash[i].flowCents;
  }
  return out;
}
export function cashNow(entries, setting) {
  const anchorDate = setting?.date || '';
  return (
    (setting?.cents ?? 0) +
    [...entries].filter(e => !e.deleted && e.date >= anchorDate).reduce((s, e) => s + flowOf(e), 0)
  );
}

// channel '' means every channel.
export function monthSummary(entries, month, channel = '') {
  const out = {
    month,
    expenseCents: 0,
    incomeCents: 0,
    withdrawCents: 0,
    depositCents: 0,
    count: 0,
    byCategory: []
  };
  const by = new Map();
  for (const e of entries) {
    if (e.deleted || e.date.slice(0, 7) !== month || (channel && e.channel !== channel)) continue;
    out.count++;
    if (e.type === '支出') {
      out.expenseCents += e.amountCents;
      const main = e.category.split('／')[0];
      by.set(main, (by.get(main) || 0) + e.amountCents);
    } else if (e.type === '收入') out.incomeCents += e.amountCents;
    else if (e.type === '提款') out.withdrawCents += e.amountCents;
    else out.depositCents += e.amountCents;
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
        e.time,
        e.type,
        e.channel,
        e.amountCents / 100,
        e.amountSigned / 100,
        main,
        sub,
        e.party,
        e.note,
        e.balanceCents == null ? '' : e.balanceCents / 100,
        e.id,
        e.updatedAt
      ];
    })
  ];
}
// One row per month and channel; the month-end cash only on the 現金 row.
export function monthRows(rows) {
  const groups = new Map();
  for (const e of rows) {
    const key = e.date.slice(0, 7) + '\u0000' + e.channel;
    const t = groups.get(key) || { 支出: 0, 收入: 0, 提款: 0, 存入: 0, count: 0, end: null };
    t[e.type] += e.amountCents;
    t.count++;
    if (e.balanceCents != null) t.end = e.balanceCents;
    groups.set(key, t);
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
        t.count,
        t.end == null ? '' : t.end / 100
      ];
    })
  ];
}

// ---------- Your own channels and categories ----------
// An option is { kind: 渠道|支出分類|收入分類, name, parent, icon, deleted, updatedAt }.
// A sub-category has the main category's name in parent. Removing one keeps a row marked 已刪除 so other
// devices learn about it.
export const optionKey = o => o.kind + '\u0000' + (o.parent || '') + '\u0000' + o.name;
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
  if (o.kind === '渠道') o.parent = '';
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
// The channel list: the four defaults, then your own.
export function channelList(options) {
  const own = [...options.values()].filter(o => o.kind === '渠道' && !o.deleted).map(o => o.name);
  return [...new Set([...DEFAULT_CHANNELS, ...own])];
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
export function settingRows(setting, cashCents) {
  return [
    SETTING_HEADERS,
    ['起始現金（元）', setting ? setting.cents / 100 : '', '設定當天 00:00 身上的現金'],
    ['起始日期', setting?.date || '', '這一天（含）以後的記帳往後加減，之前的往回推'],
    ['設定更新時間', setting?.updatedAt || '', ''],
    ['目前現金（元）', cashCents / 100, '最後一次同步時算出的金額'],
    ['同步時間', new Date().toISOString(), ''],
    ['資料格式版本', SCHEMA_VERSION, '欄位或資料意義改變時加 1，對照 GitHub 上的 docs/BOT.md'],
    [
      '說明',
      '「記帳明細」一列一筆、已是最新狀態；「記帳後現金」只算渠道為現金的記帳。「異動紀錄」保留每次修改，請勿手動編輯。',
      ''
    ]
  ];
}
export function readSetting(values) {
  const get = name => values.find(r => r[0] === name)?.[1];
  const cents = parseCents(String(get('起始現金（元）') ?? '')),
    date = String(get('起始日期') ?? ''),
    updatedAt = String(get('設定更新時間') ?? '');
  if (!Number.isSafeInteger(cents) || !DATE.test(date)) return null;
  return { cents, date, updatedAt };
}
