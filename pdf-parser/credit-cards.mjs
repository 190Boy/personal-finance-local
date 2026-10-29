import { parseDate, moneyCents } from './parser.mjs';
const norm = v =>
  String(v ?? '')
    .normalize('NFKC')
    .trim();
export const CARD_KINDS = ['消費', '分期當期', '費用', '退款', '繳款', '待核對'];
export function cardMoney(v) {
  return moneyCents(norm(v).replace(/^(?:NTD|TWD|NT\$)\s*/i, ''));
}
function cardDate(v, date1904 = false) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 1 || v > 109574 || (!date1904 && Math.floor(v) === 60)) return null;
    const d = new Date(
      (date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, v < 60 ? 31 : 30)) + Math.floor(v) * 86400000
    );
    return d.toISOString().slice(0, 10);
  }
  return parseDate(norm(v));
}
export function parseCsvText(text) {
  const rows = [];
  let row = [],
    field = '',
    quoted = false,
    afterQuote = false;
  text = text.replace(/^\uFEFF/, '');
  if (text.length > 10000000) throw Error('CARD_LIMIT');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else field += c;
    } else if (c === '"') {
      if (field || afterQuote) throw Error('CSV_QUOTES');
      quoted = true;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field);
      field = '';
      afterQuote = false;
      if (row.length > 256) throw Error('CARD_LIMIT');
      if (c !== ',') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        rows.push({ cells: row, raw: row, line: rows.length + 1 });
        row = [];
        if (rows.length > 50000) throw Error('CARD_LIMIT');
      }
    } else {
      if (afterQuote && !/\s/.test(c)) throw Error('CSV_QUOTES');
      if (!afterQuote) field += c;
    }
  }
  if (quoted) throw Error('CSV_QUOTES');
  if (field || row.length) {
    row.push(field);
    rows.push({ cells: row, raw: row, line: rows.length + 1 });
  }
  if (rows.length > 50000 || rows.some(r => r.cells.length > 256)) throw Error('CARD_LIMIT');
  return rows.filter(r => r.cells.some(v => norm(v)));
}
export async function readCardCsv(file, { signal } = {}) {
  if (file.size > 25 * 1024 * 1024) throw Error('FILE_TOO_LARGE');
  if (!file.size) throw Error('EMPTY_FILE');
  let bytes = await file.arrayBuffer();
  if (signal?.aborted) throw Error('CANCELLED');
  let text,
    encoding = 'UTF-8';
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      text = new TextDecoder('big5', { fatal: true }).decode(bytes);
      encoding = 'Big5';
    } catch {
      throw Error('CSV_ENCODING');
    }
  }
  bytes = null;
  const rows = parseCsvText(text);
  text = '';
  return { sheets: [{ name: 'CSV', rows }], encoding };
}
function hint(summary, cents) {
  if (/繳款|扣繳|信用卡繳費/.test(summary)) return '繳款';
  if (/退貨|退款|退費|取消交易/.test(summary)) return '退款';
  if (/手續費|循環利息|違約金|年費/.test(summary) && cents > 0) return '費用';
  if (/分期/.test(summary) && cents > 0) return '分期當期';
  if (/預借|回饋|折抵|調整|沖正|溢繳|代償/.test(summary)) return '待核對';
  return cents > 0 ? '消費' : '待核對';
}
// 中信「未出帳單明細」: the location is padded onto the summary ("連支＊統一超商     Taipei   TW") instead of
// having its own column as in the billed export. Splitting it off keeps the same transaction's identity
// identical in both exports, so the later billed statement de-duplicates against it.
const CTBC_UNBILLED = ['交易序號', '消費日', '入帳日', '摘要', '卡號末四碼', '新臺幣金額'];
const KGI_UNBILLED = [
  '月份',
  '消費名稱',
  '消費日期',
  '消費金額',
  '卡號末四碼',
  '消費地',
  '入帳日期',
  '外幣幣別和金額'
];
export function splitCardLocation(summary) {
  // The export pads the summary to a fixed width, so the location always follows two or more spaces.
  // Single spaces belong to the shop name ("肯德基 KFC") and are never split.
  const m = summary.match(/^(.*?\S)\s{2,}(\S.*)$/);
  return m ? { summary: m[1], location: m[2].replace(/\s+/g, ' ') } : { summary, location: '' };
}
function findHeader(book, fields) {
  const matches = [];
  for (const s of book.sheets)
    for (let i = 0; i < Math.min(40, s.rows.length); i++)
      if (fields.every((name, j) => norm(s.rows[i].cells[j]) === name)) matches.push({ s, i });
  return matches;
}
function parseCtbcUnbilled(book, { s, i }) {
  const transactions = [],
    stamp = s.rows
      .slice(0, i)
      .map(r => norm(r.cells[0]))
      .find(v => v.startsWith('資料時間'));
  for (const r of s.rows.slice(i + 1)) {
    if (r.cells.every(v => !norm(v))) continue;
    const date = cardDate(r.cells[1]),
      post = cardDate(r.cells[2]),
      { summary } = splitCardLocation(norm(r.cells[3])),
      amountCents = cardMoney(r.cells[5]),
      errors = [];
    if (!date) errors.push('消費日無效');
    if (!post) errors.push('入帳日無效');
    if (!summary) errors.push('缺少摘要');
    if (amountCents === null) errors.push('臺幣金額無效');
    const kind = hint(summary, amountCents);
    if (kind === '待核對') errors.push('金額方向或調整用途待核對');
    if (kind === '繳款' && amountCents >= 0) errors.push('繳款金額方向待核對');
    if (kind === '退款' && amountCents >= 0) errors.push('退款金額方向待核對');
    transactions.push({
      date: date || '',
      postingDate: post || '',
      summary,
      amountCents,
      kind,
      currency: '',
      foreignAmount: '',
      line: r.line,
      errors
    });
  }
  if (!transactions.length) throw Error('CARD_EMPTY');
  const detailNetCents = transactions.every(t => Number.isSafeInteger(t.amountCents))
    ? transactions.reduce((sum, t) => sum + t.amountCents, 0)
    : null;
  return {
    bank: '中國信託',
    source: 'csv',
    unbilled: true,
    exportedAt: stamp ? stamp.replace(/^資料時間[:：]\s*/, '') : '',
    meta: { month: '', closing: '', due: '', sourceTotalCents: null, minimumCents: null },
    transactions,
    issues: [
      '未出帳明細：帳單尚未結帳，請填寫這些消費將出現在哪個月份的帳單。之後匯入正式帳單時，相同交易會自動略過。'
    ],
    detailNetCents,
    sourceTotalMatches: null,
    encoding: book.encoding || ''
  };
}
export function parseCardBook(book, { bank }) {
  if (!['kgi', 'ctbc'].includes(bank)) throw Error('CARD_BANK');
  if (bank === 'ctbc') {
    const unbilled = findHeader(book, CTBC_UNBILLED);
    if (unbilled.length > 1) throw Error('CARD_MULTIPLE');
    if (unbilled.length === 1) return parseCtbcUnbilled(book, unbilled[0]);
  }
  let unbilled = false;
  let fields =
    bank === 'kgi'
      ? ['月份', '特店名稱', '消費日期', '消費金額', '卡號末四碼', '消費地', '入帳日期', '消費幣別']
      : [
          '消費日',
          '入帳起息日',
          '摘要',
          '幣別',
          '消費地金額',
          '外幣折算日',
          '消費地',
          '末四碼',
          '新臺幣金額'
        ];
  let matches = findHeader(book, fields);
  if (!matches.length && bank === 'kgi') {
    // 凱基「未出帳」Excel: same column order, but 「消費名稱」 and 「外幣幣別和金額」 headers.
    matches = findHeader(book, KGI_UNBILLED);
    if (matches.length) {
      fields = KGI_UNBILLED;
      unbilled = true;
    }
  }
  if (matches.length !== 1) throw Error(matches.length ? 'CARD_MULTIPLE' : 'CARD_HEADER');
  const { s, i } = matches[0],
    transactions = [],
    issues = [],
    meta = { month: '', closing: '', due: '', sourceTotalCents: null, minimumCents: null };
  if (bank === 'kgi') {
    for (const r of s.rows.slice(0, i)) {
      const label = norm(r.cells[0]);
      if (label === '最近結帳日') meta.closing = cardDate(r.raw?.[1] ?? r.cells[1], book.date1904) || '';
      if (label.startsWith('繳費截止日')) meta.due = cardDate(r.raw?.[1] ?? r.cells[1], book.date1904) || '';
      if (label === '最低應繳金額') meta.minimumCents = cardMoney(r.cells[1]);
    }
    const title = s.rows.find(r => /^\d{1,2}月份帳單$/.test(norm(r.cells[0])));
    if (title) {
      const n = s.rows.indexOf(title),
        candidate = s.rows[n + 1];
      meta.sourceTotalCents = cardMoney(candidate?.cells[0]);
    }
    if (meta.closing) meta.month = meta.closing.slice(0, 7);
  }
  const indexes =
    bank === 'kgi'
      ? { date: 2, post: 6, summary: 1, amount: 3, currency: 7, foreign: null }
      : { date: 0, post: 1, summary: 2, amount: 8, currency: 3, foreign: 4 };
  for (const r of s.rows.slice(i + 1)) {
    if (r.cells.every(v => !norm(v))) continue;
    if (fields.every((v, j) => norm(r.cells[j]) === v)) continue;
    const get = k => r.raw?.[indexes[k]] ?? r.cells[indexes[k]] ?? '';
    const date = cardDate(get('date'), book.date1904),
      post = cardDate(get('post'), book.date1904),
      summary = norm(get('summary')),
      amountCents = cardMoney(get('amount')),
      currency = norm(get('currency')),
      errors = [];
    if (!date) errors.push('消費日無效');
    if (!post) errors.push('入帳日無效');
    if (!summary) errors.push('缺少摘要');
    if (amountCents === null) errors.push('臺幣金額無效');
    if (r.formulaColumns?.length || r.errorColumns?.length) errors.push('來源含公式或錯誤值，未執行');
    const kind = hint(summary, amountCents);
    if (kind === '待核對') errors.push('金額方向或調整用途待核對');
    if (kind === '繳款' && amountCents >= 0) errors.push('繳款金額方向待核對');
    if (kind === '退款' && amountCents >= 0) errors.push('退款金額方向待核對');
    if (kind === '分期當期') issues.push('分期僅記本次入帳金額，不推算剩餘本金或未來負債。');
    transactions.push({
      date: date || '',
      postingDate: post || '',
      summary,
      amountCents,
      kind,
      // The billed export leaves this blank for domestic and foreign charges alike; the unbilled column mixes
      // currency and amount, so it is left out to keep the same transaction's identity equal in both exports.
      currency: unbilled || currency === '-' ? '' : currency,
      foreignAmount: bank === 'ctbc' ? norm(get('foreign')) : '',
      line: r.line,
      errors
    });
  }
  if (!transactions.length) throw Error('CARD_EMPTY');
  const detailNetCents = transactions.every(t => Number.isSafeInteger(t.amountCents))
    ? transactions.reduce((s, t) => s + t.amountCents, 0)
    : null;
  if (unbilled)
    issues.unshift(
      '未出帳明細：帳單尚未結帳，請填寫這些消費將出現在哪個月份的帳單。之後匯入正式帳單時，相同交易會自動略過。'
    );
  return {
    bank: bank === 'kgi' ? '凱基銀行' : '中國信託',
    source: bank === 'kgi' ? 'excel' : 'csv',
    unbilled,
    meta,
    transactions,
    issues: [...new Set(issues)],
    detailNetCents,
    sourceTotalMatches: meta.sourceTotalCents === null ? null : meta.sourceTotalCents === detailNetCents,
    encoding: book.encoding || ''
  };
}
