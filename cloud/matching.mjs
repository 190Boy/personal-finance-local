// 發票配對：把雲端發票和信用卡明細、銀行支出對起來。純函式，不讀寫雲端。
// 原則：金額＋日期為主，店名只加分；不確定就讓使用者選；只有使用者確認的決定才寫入試算表。
import { INVOICE_COL as C } from './invoices.mjs';
import { shortSeller, isVoided } from '../pdf-parser/invoices.mjs';

export const HABIT_HEADERS = ['店家關鍵字', '付款方式', '對應紀錄關鍵字', '說明'];
export const DEFAULT_HABITS = [
  ['全聯', '玉山帳戶', '連結帳戶交易', '全聯通常綁定玉山帳戶扣款，先找銀行的「連結帳戶交易」'],
  ['統一超商', '中信卡 LINE Pay', '連支*統一超商', '7-11 通常刷中信卡 LINE Pay'],
  ['全家', 'LINE Pay 錢包', '', '全家通常用 LINE Pay 錢包，卡片和銀行不會有紀錄']
];
export const DECISION_HEADERS = [
  '決定ID',
  '對象類型',
  '對象ID',
  '決定',
  '配對對象ID',
  '付款方式',
  '決定時間',
  '說明'
];
export const PAYMENT_METHODS = ['現金', 'LINE Pay 錢包', '中信卡 LINE Pay', '玉山帳戶', '其他'];

const DAY = 86400000;
const days = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
const norm = v =>
  String(v ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '');
// Card statements name the payment platform or gateway, not the shop; these prefixes say nothing about the seller.
const GATEWAY = /^(連支|連加|優步|藍新|紅陽|綠界|街口|全支付|悠遊付)[*\-－＊]?/;
const PLATFORM_SELLERS = /優食台灣|優步福爾摩沙/;
const BRAND_ALIASES = [
  [/統一超商/, ['統一超商', '7-eleven', '7-11', '統一']],
  [/全家便利商店/, ['全家', 'familymart']],
  [/全聯實業/, ['全聯', 'px']],
  [/富邦媒體科技/, ['momo', '富邦']],
  [/麥當勞|金津|新加坡商麥當勞/, ['麥當勞', 'mcdonal']],
  [/智冠科技/, ['智冠', 'mycard']]
];
export const TOPUP_HINT = '連結帳戶交易';
// Up to 5 dollars: plastic bags and similar small items are often charged but left off the e-invoice.
export const SMALL_EXTRA_CENTS = 500;

function brandWords(inv) {
  const words = new Set();
  const short = shortSeller(inv.sellerName).name;
  if (short.length >= 2) words.add(norm(short));
  for (const [re, list] of BRAND_ALIASES) if (re.test(inv.sellerName)) list.forEach(w => words.add(norm(w)));
  return [...words];
}
function nameMatches(inv, summary) {
  const s = norm(summary).replace(GATEWAY, '');
  return brandWords(inv).some(w => w && s.includes(w));
}
export function habitFor(inv, habits) {
  return (
    habits.find(h => h.keyword && (inv.sellerName.includes(h.keyword) || inv.short.includes(h.keyword))) ||
    null
  );
}

export function readHabits(values) {
  if (!values.length) return DEFAULT_HABITS.map(toHabit);
  if (JSON.stringify(values[0]) !== JSON.stringify(HABIT_HEADERS)) throw Error('SHEET_SCHEMA');
  return values
    .slice(1)
    .map(toHabit)
    .filter(h => h.keyword && h.method);
}
function toHabit(r) {
  return {
    keyword: String(r[0] ?? '').trim(),
    method: String(r[1] ?? '').trim(),
    recordHint: String(r[2] ?? '').trim(),
    note: String(r[3] ?? '').trim()
  };
}

// The latest import of each invoice wins; voided invoices are kept apart.
export function latestInvoices(rows) {
  const heads = new Map();
  for (const r of rows) {
    if (r[0] !== '發票') continue;
    const prior = heads.get(r[C['發票紀錄ID']]);
    if (!prior || String(r[C['匯入時間']]) >= String(prior[C['匯入時間']])) heads.set(r[C['發票紀錄ID']], r);
  }
  return [...heads.values()].map(h => {
    const id = h[C['發票紀錄ID']];
    const items = rows
      .filter(r => r[0] === '品項' && r[C['發票紀錄ID']] === id && r[C['匯入ID']] === h[C['匯入ID']])
      .sort((a, b) => Number(a[C['品項序']]) - Number(b[C['品項序']]))
      .map(r => ({
        name: String(r[C['品名']]),
        quantity: String(r[C['數量']]),
        amountCents: r[C['金額（元）']]
      }));
    const sellerName = String(h[C['賣方名稱']] || ''),
      seller = shortSeller(sellerName);
    return {
      id,
      number: String(h[C['發票號碼']]),
      date: String(h[C['發票日期']]),
      sellerId: String(h[C['賣方統編']]),
      sellerName,
      short: seller.name,
      branch: seller.branch,
      carrier: String(h[C['載具']] || ''),
      status: String(h[C['發票狀態']] || ''),
      totalCents: h[C['金額（元）']],
      items
    };
  });
}

// Card rows come from cardTable (amounts in cents); bank rows straight from the sheet (yuan).
export function spendingRecords(cardRows, bankRows) {
  const out = [],
    seen = new Set();
  for (const r of cardRows) {
    if (r[0] !== '明細' || r[12] !== '消費' || !Number.isSafeInteger(r[11]) || r[11] <= 0) continue;
    const key = 'card:' + r[1];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      kind: '信用卡',
      source: String(r[3]),
      account: String(r[4]),
      date: String(r[8] || r[9] || ''),
      summary: String(r[10] || ''),
      amountCents: r[11],
      closing: String(r[6] || '')
    });
  }
  for (const r of bankRows) {
    const expense = Number(r[6]);
    if (!r[0] || !Number.isFinite(expense) || expense <= 0) continue;
    const key = 'bank:' + r[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      kind: '銀行存款',
      source: String(r[1]),
      account: String(r[2]),
      date: String(r[3] || ''),
      summary: String(r[5] || ''),
      amountCents: Math.round(expense * 100)
    });
  }
  return out.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
}

// LINE Pay wallet payments from the LINE 錢包 chat. Card-paid LINE Pay notices duplicate the card statement's
// 「連支*」 lines, so only wallet payments become records.
export function walletRecords(events) {
  return events
    .filter(e => e.type === '付款' && e.method === '錢包' && e.amountCents > 0)
    .map(e => ({
      key: 'linepay:' + e.id,
      kind: 'LINE Pay',
      source: 'LINE Pay',
      account: '錢包',
      date: e.date,
      time: e.time,
      summary: e.shop,
      amountCents: e.amountCents
    }));
}

// Hand-entered spending can pair with an invoice too, e.g. a cash purchase the user recorded with its invoice.
export function manualRecords(entries) {
  return (
    entries
      // Transfers to people never have an invoice; keeping them out avoids pairing one by coincidence.
      .filter(e => e.type === '支出' && e.amountCents > 0 && !e.category.includes('轉帳'))
      .map(e => ({
        key: 'manual:' + e.id,
        kind: '手動記帳',
        source: '手動記帳',
        account: e.method,
        date: e.date,
        time: e.time,
        summary: e.party || e.category || '手動記帳',
        amountCents: e.amountCents
      }))
  );
}

// Exclusive decisions: the latest per target wins; 「撤銷」 clears it. Rejections accumulate.
export function readDecisions(values) {
  if (values.length && JSON.stringify(values[0]) !== JSON.stringify(DECISION_HEADERS))
    throw Error('SHEET_SCHEMA');
  const rows = values
    .slice(1)
    .map((r, n) => ({
      target: String(r[2] || ''),
      type: String(r[1] || ''),
      action: String(r[3] || ''),
      other: String(r[4] || ''),
      method: String(r[5] || ''),
      at: String(r[6] || ''),
      n
    }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.n - b.n);
  const exclusive = new Map(),
    rejected = new Set();
  for (const d of rows) {
    if (d.action === '不是這筆') rejected.add(d.target + '|' + d.other);
    else if (d.action === '撤銷') exclusive.delete(d.target);
    else exclusive.set(d.target, d);
  }
  return { exclusive, rejected };
}

// Dates the imported statements cover: an invoice outside them may simply belong to a statement not imported yet.
export function coverage(records) {
  const sources = new Map();
  for (const r of records) {
    if (r.kind === '銀行存款' && !r.summary.includes(TOPUP_HINT)) continue;
    // Hand-entered spending has no statement period.
    if (r.kind === '手動記帳') continue;
    const name = r.source + '／' + r.account,
      s = sources.get(name) || { name, start: r.date, end: r.date };
    if (r.date < s.start) s.start = r.date;
    if (r.date > s.end) s.end = r.date;
    if (r.closing && r.closing > s.end) s.end = r.closing;
    sources.set(name, s);
  }
  const list = [...sources.values()];
  if (!list.length) return { start: '', end: '', sources: [] };
  return {
    start: list
      .map(s => s.start)
      .sort()
      .at(-1),
    end: list.map(s => s.end).sort()[0],
    sources: list.sort((a, b) => a.end.localeCompare(b.end))
  };
}

export function computeMatches({
  invoiceRows = [],
  cardRows = [],
  bankRows = [],
  habits = DEFAULT_HABITS.map(toHabit),
  decisionRows = [],
  linePayEvents = [],
  wallet = null,
  manualEntries = []
}) {
  const topupKeys = wallet?.topupKeys || new Set();
  const all = latestInvoices(invoiceRows),
    records = [
      ...spendingRecords(cardRows, bankRows),
      ...walletRecords(linePayEvents),
      ...manualRecords(manualEntries)
    ],
    byKey = new Map(records.map(r => [r.key, r])),
    { exclusive, rejected } = readDecisions(decisionRows),
    cover = coverage(records),
    invoices = all.filter(i => !isVoided(i.status) && Number.isSafeInteger(i.totalCents)),
    voided = all.length - invoices.length,
    taken = new Map(),
    result = new Map();
  for (const inv of invoices) {
    inv.habit = habitFor(inv, habits);
    inv.platform = PLATFORM_SELLERS.test(inv.sellerName);
  }
  // 1. The user's own decisions.
  for (const inv of invoices) {
    const d = exclusive.get(inv.id);
    if (d?.action === '配對' && byKey.has(d.other) && !taken.has(d.other)) {
      taken.set(d.other, inv.id);
      result.set(inv.id, { state: 'confirmed', record: byKey.get(d.other), method: d.method });
    } else if (d?.action === '付款方式') result.set(inv.id, { state: 'settled', method: d.method });
  }
  const recordDecision = key => exclusive.get(key)?.action;
  // A linked-account debit that explains an unannounced wallet top-up is not a purchase, unless the user said so.
  const autoTopup = key => topupKeys.has(key) && !recordDecision(key);
  const free = r =>
    !taken.has(r.key) && !['儲值', '無發票'].includes(recordDecision(r.key)) && !autoTopup(r.key);
  // 2. Candidates by amount and date; names and habits only rank them.
  const candidates = new Map();
  for (const inv of invoices) {
    if (result.has(inv.id)) continue;
    const list = [];
    for (const r of records) {
      if (!free(r) || rejected.has(inv.id + '|' + r.key)) continue;
      const diff = days(inv.date, r.date);
      if (inv.platform) {
        // Uber Eats and rides: the invoice only covers platform fees, so the charge is larger.
        if (
          r.kind === '信用卡' &&
          /^優步/.test(r.summary) &&
          diff >= -1 &&
          diff <= 1 &&
          r.amountCents >= inv.totalCents
        )
          list.push({ record: r, score: 10 - Math.abs(diff) * 3 });
        continue;
      }
      // Online shops often issue the invoice days after the order is charged, so the card date may come first.
      if (r.amountCents !== inv.totalCents || diff < -3 || diff > 3) continue;
      let score = 10 - Math.abs(diff) * 2;
      if (nameMatches(inv, r.summary)) score += 5;
      if (inv.habit?.recordHint && norm(r.summary).includes(norm(inv.habit.recordHint))) score += 5;
      list.push({ record: r, score });
    }
    list.sort((a, b) => b.score - a.score || a.record.date.localeCompare(b.record.date));
    candidates.set(inv.id, list);
  }
  const claims = new Map();
  for (const [id, list] of candidates)
    for (const c of list) claims.set(c.record.key, [...(claims.get(c.record.key) || []), id]);
  // 2b. A charge a few dollars above the invoice (a plastic bag rung up outside the invoice) is offered,
  // never paired automatically, and only when nothing matches exactly on either side.
  for (const inv of invoices) {
    if (result.has(inv.id) || inv.platform || candidates.get(inv.id)?.length) continue;
    const list = [];
    for (const r of records) {
      if (!free(r) || claims.has(r.key) || rejected.has(inv.id + '|' + r.key)) continue;
      const diff = days(inv.date, r.date),
        extra = r.amountCents - inv.totalCents;
      if (extra <= 0 || extra > SMALL_EXTRA_CENTS || diff < -3 || diff > 3) continue;
      let score = 4 - Math.abs(diff) * 2 - extra / 100;
      if (nameMatches(inv, r.summary)) score += 5;
      if (inv.habit?.recordHint && norm(r.summary).includes(norm(inv.habit.recordHint))) score += 5;
      list.push({ record: { ...r, extraCents: extra }, score, near: true });
    }
    list.sort((a, b) => b.score - a.score);
    if (list.length) candidates.set(inv.id, list);
  }
  // 3. Automatic only when the pairing is unique in both directions and not a platform fee invoice.
  for (const inv of invoices) {
    if (result.has(inv.id)) continue;
    const list = candidates.get(inv.id) || [];
    const covered = cover.end && inv.date >= cover.start && inv.date <= cover.end;
    if (list.length === 1 && !inv.platform && !list[0].near && claims.get(list[0].record.key).length === 1) {
      taken.set(list[0].record.key, inv.id);
      result.set(inv.id, { state: 'auto', record: list[0].record });
    } else if (list.length) result.set(inv.id, { state: 'choose', candidates: list.map(c => c.record) });
    else if (inv.habit && !inv.habit.recordHint)
      result.set(inv.id, { state: 'pending', defaultMethod: inv.habit.method });
    else if (covered) result.set(inv.id, { state: 'pending', defaultMethod: '現金' });
    else
      result.set(inv.id, {
        state: 'waiting',
        reason: !cover.end
          ? '尚未匯入信用卡或銀行明細'
          : inv.date > cover.end
            ? cover.sources[0].name + ' 的資料只到 ' + cover.end
            : '發票日期早於已匯入的明細'
      });
  }
  // 4. Linked-account bank debits without an invoice: a top-up of a wallet, or a purchase with no e-invoice.
  const invoiceDates = invoices.map(i => i.date).sort();
  const questions = records
    .filter(
      r =>
        r.kind === '銀行存款' &&
        r.summary.includes(TOPUP_HINT) &&
        !taken.has(r.key) &&
        !recordDecision(r.key) &&
        !autoTopup(r.key) &&
        !claims.has(r.key) &&
        invoiceDates.length &&
        r.date >= invoiceDates[0] &&
        r.date <= invoiceDates.at(-1)
    )
    .map(r => ({ record: r, suggestion: r.amountCents % 10000 === 0 ? '儲值' : '消費' }));
  const recordLinks = new Map();
  for (const inv of invoices) {
    const m = result.get(inv.id);
    if (m.record)
      recordLinks.set(m.record.key, {
        invoice: inv,
        state: m.state,
        extraCents: m.record.amountCents - inv.totalCents
      });
  }
  for (const [key, d] of exclusive)
    if (byKey.has(key) && ['儲值', '無發票'].includes(d.action)) recordLinks.set(key, { state: d.action });
  for (const key of topupKeys)
    if (byKey.has(key) && autoTopup(key)) recordLinks.set(key, { state: '儲值', auto: true });
  const walletResult = wallet
    ? {
        ...wallet,
        gaps: wallet.gaps.map(g => {
          const d = exclusive.get(g.id);
          return d?.action === '落差' ? { ...g, label: d.method } : g;
        })
      }
    : null;
  const list = invoices
    .map(inv => ({ ...inv, ...result.get(inv.id) }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.number.localeCompare(b.number));
  const count = s => list.filter(i => i.state === s).length;
  return {
    invoices: list,
    wallet: walletResult,
    walletRecords: records.filter(r => r.kind === 'LINE Pay'),
    questions,
    recordLinks,
    coverage: cover,
    counts: {
      auto: count('auto'),
      confirmed: count('confirmed'),
      settled: count('settled'),
      choose: count('choose'),
      pending: count('pending'),
      waiting: count('waiting'),
      questions: questions.length,
      voided
    }
  };
}

export async function decisionRow(hash, { type, target, action, other = '', method = '', note = '' }) {
  const at = new Date().toISOString();
  return [
    await hash(JSON.stringify([type, target, action, other, method, at, Math.random()])),
    type,
    target,
    action,
    other,
    method,
    at,
    note
  ];
}
