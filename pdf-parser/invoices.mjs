// 財政部電子發票整合服務平台「載具消費明細」CSV。
// One row per line item; invoice fields repeat on every row. The 「發票金額」 column in this export
// carries the line-item amount, not the invoice total, so totals are summed per invoice number.
import { moneyCents } from './parser.mjs';
export { readCardCsv as readInvoiceCsv } from './credit-cards.mjs';

const norm = v =>
  String(v ?? '')
    .normalize('NFKC')
    .trim();
export const INVOICE_FIELDS = [
  '載具自訂名稱',
  '發票日期',
  '發票號碼',
  '發票金額',
  '發票狀態',
  '折讓',
  '賣方統一編號',
  '賣方名稱',
  '賣方地址',
  '買方統編',
  '消費明細_數量',
  '消費明細_單價',
  '消費明細_金額',
  '消費明細_品名'
];
const COL = Object.fromEntries(INVOICE_FIELDS.map((name, i) => [name, i]));
const NUMBER = /^[A-Z]{2}\d{8}$/;
// Donated and voided invoices have their last three digits masked in this export.
const MASKED = /^[A-Z]{2}\d{5}\*{3}$/;

export function invoiceDate(v) {
  const m = norm(v).match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const s = m[1] + '-' + m[2] + '-' + m[3],
    d = new Date(s + 'T00:00:00Z');
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === s ? s : null;
}

// "全家便利商店股份有限公司新北市第一○一一分公司" → { name: "全家便利商店", branch: "新北市第一○一一分公司" }
export function shortSeller(full) {
  const s = norm(full);
  const m = s.match(/^(.+?)(?:股份有限公司|責任有限公司|有限公司|有限合夥)(.*)$/);
  if (!m || !m[1]) return { name: s, branch: '' };
  return { name: m[1], branch: m[2].trim() };
}

export function isVoided(status) {
  return /作廢/.test(status);
}

export function parseInvoiceBook(book) {
  const rows = book.sheets?.[0]?.rows || [];
  const headerAt = rows.findIndex(r => INVOICE_FIELDS.every((name, j) => norm(r.cells[j]) === name));
  if (headerAt < 0) throw Error('INVOICE_HEADER');
  if (rows.slice(headerAt + 1).some(r => INVOICE_FIELDS.every((name, j) => norm(r.cells[j]) === name)))
    throw Error('INVOICE_MULTIPLE');
  const notes = [],
    groups = new Map();
  for (const r of rows.slice(headerAt + 1)) {
    const filled = r.cells.filter(v => norm(v));
    // The export ends with one-cell explanatory lines; they are not purchases.
    if (filled.length <= 1 && !norm(r.cells[COL['發票號碼']])) {
      if (filled.length) notes.push(norm(filled[0]));
      continue;
    }
    const get = name => norm(r.cells[COL[name]]);
    const number = get('發票號碼'),
      date = invoiceDate(get('發票日期')),
      sellerId = get('賣方統一編號'),
      amountCents = moneyCents(get('消費明細_金額')),
      errors = [];
    if (!NUMBER.test(number) && !MASKED.test(number)) errors.push('發票號碼格式無法辨識');
    if (!date) errors.push('發票日期無效');
    if (!/^\d{8}$/.test(sellerId)) errors.push('賣方統編格式無法辨識');
    if (amountCents === null) errors.push('品項金額無效');
    if (r.cells.length < INVOICE_FIELDS.length) errors.push('欄位數不足');
    // A masked number is shared by unrelated invoices, so it only groups rows of the same day and seller.
    const key = MASKED.test(number) ? [number, date, sellerId].join('|') : number || 'line-' + r.line;
    if (!groups.has(key))
      groups.set(key, {
        number,
        masked: MASKED.test(number),
        date: date || '',
        carrier: get('載具自訂名稱'),
        status: get('發票狀態'),
        allowance: get('折讓'),
        sellerId,
        sellerName: get('賣方名稱'),
        sellerAddress: get('賣方地址'),
        buyerId: get('買方統編'),
        line: r.line,
        items: [],
        errors: []
      });
    const inv = groups.get(key);
    // Invoice-level fields must agree across all item rows of the same invoice number.
    for (const [field, value] of [
      ['date', date || ''],
      ['sellerId', sellerId],
      ['status', get('發票狀態')],
      ['carrier', get('載具自訂名稱')]
    ])
      if (inv[field] !== value) errors.push('同一發票號碼的發票資訊不一致');
    inv.items.push({
      name: get('消費明細_品名'),
      quantity: get('消費明細_數量'),
      unitPrice: get('消費明細_單價'),
      amountCents,
      line: r.line
    });
    inv.errors.push(...errors);
  }
  const invoices = [...groups.values()].map(inv => {
    const valid = inv.items.every(i => Number.isSafeInteger(i.amountCents));
    const totalCents = valid ? inv.items.reduce((s, i) => s + i.amountCents, 0) : null;
    const errors = [...inv.errors];
    if (inv.masked) errors.push('捐贈或作廢發票，號碼末三碼遭遮蔽');
    if (isVoided(inv.status)) errors.push('發票已作廢，不列支出');
    else if (inv.status && inv.status !== '開立已確認') errors.push('發票狀態「' + inv.status + '」待核對');
    if (inv.allowance && inv.allowance !== '否') errors.push('發票有折讓，金額可能已變動');
    if (totalCents !== null && totalCents < 0) errors.push('發票合計為負數');
    return { ...inv, totalCents, errors: [...new Set(errors)] };
  });
  if (!invoices.length) throw Error('INVOICE_EMPTY');
  invoices.sort((a, b) => b.date.localeCompare(a.date) || a.line - b.line);
  const counted = invoices.filter(i => !isVoided(i.status) && Number.isSafeInteger(i.totalCents));
  const dates = invoices
    .map(i => i.date)
    .filter(Boolean)
    .sort();
  return {
    invoices,
    notes,
    itemCount: invoices.reduce((s, i) => s + i.items.length, 0),
    totalCents: counted.reduce((s, i) => s + i.totalCents, 0),
    from: dates[0] || '',
    to: dates.at(-1) || '',
    encoding: book.encoding || ''
  };
}
