import { BANKS, moneyCents, parseDate, reconcile, timeValue, transactionHint } from './parser.mjs';
export const TABLE_FIELDS = ['date', 'time', 'summary', 'expense', 'income', 'balance', 'fee', 'note'];
export const TABLE_REQUIRED = ['date', 'summary', 'expense', 'income', 'balance'];
const compact = s =>
  String(s ?? '')
    .normalize('NFKC')
    .replace(/\s/g, '');
const names = {
  date: ['交易日期', '交易日', '日期', '交易日期時間'],
  time: ['交易時間', '時間'],
  summary: ['交易摘要', '摘要', '交易項目'],
  expense: ['提', '提款', '提款金額', '提出金額', '支出', '支出金額'],
  income: ['存', '存入', '存款', '存入金額', '存款金額', '收入', '收入金額'],
  balance: ['帳戶餘額', '交易後餘額', '餘額', '結餘'],
  fee: ['手續費', '手續費金額'],
  note: ['存摺備註', '備註', '轉帳留言']
};
export function inspectTable(rows) {
  if (!rows.length) throw Error('EXCEL_EMPTY');
  let best = { headerIndex: 0, score: -1, mapping: {} };
  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const mapping = {};
    for (const field of TABLE_FIELDS) {
      const matches = rows[i].cells
        .map((v, j) => (names[field].includes(compact(v)) ? j : -1))
        .filter(j => j >= 0);
      if (matches.length === 1) mapping[field] = matches[0];
      else if (field === 'note') {
        const primary = rows[i].cells.map((v, j) => (compact(v) === '存摺備註' ? j : -1)).filter(j => j >= 0);
        if (primary.length === 1) mapping.note = primary[0];
      }
    }
    const score = TABLE_REQUIRED.filter(f => Number.isInteger(mapping[f])).length;
    if (score > best.score) best = { headerIndex: i, score, mapping };
  }
  return { rows, ...best };
}
function numericDate(v, date1904) {
  if (!Number.isFinite(v) || v < 0 || v > 109574 || (!date1904 && Math.floor(v) === 60)) return String(v);
  const whole = Math.floor(v),
    base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, whole < 60 ? 31 : 30);
  const d = new Date(base + whole * 86400000);
  return d.toISOString().slice(0, 10) + (v !== whole ? ' ' + numericTime(v - whole) : '');
}
function numericTime(v) {
  const seconds = Math.round(v * 86400);
  if (!Number.isFinite(v) || v < 0 || v >= 1 || seconds >= 86400) return String(v);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(n => String(n).padStart(2, '0'))
    .join(':');
}
export function parseEsunTable(
  draft,
  { mapping = draft.mapping, headerIndex = draft.headerIndex, order = 'descending', openingCents = null } = {}
) {
  if (!Number.isInteger(headerIndex) || headerIndex < 0 || headerIndex >= draft.rows.length)
    throw Error('EXCEL_MAPPING');
  const header = draft.rows[headerIndex].cells,
    width = header.length;
  for (const f of TABLE_REQUIRED) if (!Number.isInteger(mapping[f])) throw Error('EXCEL_MAPPING');
  const indexes = TABLE_FIELDS.filter(f => mapping[f] != null).map(f => mapping[f]);
  if (
    indexes.some(i => !Number.isInteger(i) || i < 0 || i >= width) ||
    new Set(indexes).size !== indexes.length
  )
    throw Error('EXCEL_MAPPING');
  const transactions = [],
    issues = [],
    seen = new Map();
  for (const row of draft.rows.slice(headerIndex + 1)) {
    const cells = row.cells;
    if (cells.every((v, i) => compact(v) === compact(header[i])) && cells.length === width) continue;
    const get = f => {
      const i = mapping[f];
      if (i == null) return '';
      const value = row.raw?.[i] ?? cells[i] ?? '';
      if (typeof value === 'number') {
        if (f === 'date') return numericDate(value, !!draft.date1904);
        if (f === 'time') return numericTime(value);
      }
      return String(value).normalize('NFKC').trim();
    };
    const errors = [];
    if (cells.length !== width) errors.push('EXCEL_ROW_WIDTH');
    if (indexes.some(i => row.formulaColumns?.includes(i))) errors.push('EXCEL_FORMULA');
    if (indexes.some(i => row.errorColumns?.includes(i))) errors.push('EXCEL_CELL_ERROR');
    const dateText = get('date'),
      date = parseDate(dateText);
    const dateRemainder = dateText.replace(/^\*?\d{3,4}[\/.-]\d{1,2}[\/.-]\d{1,2}/, '').trim();
    const tm = timeValue(get('time') || dateRemainder);
    if (!date) errors.push('INVALID_DATE');
    if (tm.issue) errors.push(tm.issue);
    const summary = get('summary');
    if (!summary) errors.push('MISSING_SUMMARY');
    const expense = moneyCents(get('expense'), { blank: true }),
      income = moneyCents(get('income'), { blank: true }),
      balance = moneyCents(get('balance'));
    if (expense === null || income === null) errors.push('INVALID_AMOUNT');
    if (balance === null) errors.push('INVALID_BALANCE');
    if (expense === 0 && income === 0) errors.push('ZERO_FLOW');
    if (expense > 0 && income > 0) errors.push('BOTH_DIRECTIONS');
    if (expense < 0 || income < 0) errors.push('NEGATIVE_FLOW');
    const feeText = get('fee'),
      fee = feeText ? moneyCents(feeText) : null;
    if (feeText && (fee === null || fee < 0)) errors.push('FEE_REQUIRES_REVIEW');
    const t = {
      bank: BANKS.esun,
      date,
      time: tm.value,
      summary,
      note: get('note'),
      expenseCents: expense,
      incomeCents: income,
      balanceCents: balance,
      feeCents: fee,
      typeHint: transactionHint(summary + ' ' + get('note')),
      page: null,
      endPage: null,
      line: row.line,
      sourceLine: row.line,
      sheetName: draft.sheetName,
      errors,
      reviewStatus: 'needs_review'
    };
    // Keep malformed records visible; do not match incomplete rows as duplicates.
    if (!errors.length) {
      const key = [date, tm.value, summary, expense, income, balance, fee].join('\u001f');
      const prior = seen.get(key);
      if (prior) {
        prior.errors.push('DUPLICATE_CANDIDATE');
        t.errors.push('DUPLICATE_CANDIDATE');
      } else seen.set(key, t);
    }
    transactions.push(t);
  }
  if (!transactions.length) issues.push({ code: 'NO_TRANSACTIONS', page: null, line: null });
  const ordered = order === 'descending' ? [...transactions].reverse() : transactions;
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1],
      b = ordered[i];
    if (a.date && b.date && (a.date > b.date || (a.date === b.date && a.time && b.time && a.time > b.time)))
      issues.push({ code: 'ORDER_MISMATCH', page: null, line: b.line });
  }
  const balance = reconcile(transactions, { order, openingCents, debitFees: true }),
    invalidRows = transactions.filter(t => t.errors.length).length;
  return {
    parserVersion: '0.4.2',
    sourceType: 'excel',
    feePolicy: 'expense_plus_fee_income_unchanged',
    bank: BANKS.esun,
    transactions,
    issues,
    headers: [{ line: draft.rows[headerIndex].line, fields: Object.keys(mapping) }],
    stats: {
      rows: transactions.length,
      invalidRows,
      pages: 0,
      datesSeen: transactions.filter(t => t.date).length
    },
    balance,
    validation: {
      status: 'needs_review',
      fieldChecksPass: transactions.length > 0 && invalidRows === 0 && issues.length === 0,
      balanceChecksComplete: balance.complete,
      realBankSamplesVerified: false,
      message: 'Excel 本機預覽，需逐欄核對。'
    }
  };
}
