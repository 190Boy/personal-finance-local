export const csvColumns = [
  'bank',
  'date',
  'time',
  'summary',
  'expense',
  'income',
  'balance',
  'fee',
  'note',
  'type_hint',
  'source_type',
  'source_line',
  'page',
  'end_page',
  'errors',
  'balance_check',
  'review_status'
];
const amount = c => (Number.isSafeInteger(c) ? (c / 100).toFixed(2) : '');
function safeText(s) {
  const value = String(s ?? '');
  // Neutralise spreadsheet formulas, including whitespace/control prefixes.
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? "'" + value : value;
}
function cell(s) {
  return '"' + String(s ?? '').replace(/"/g, '""') + '"';
}
export function toCSV(result) {
  const lines = [csvColumns.map(cell).join(',')];
  for (const t of result.transactions) {
    const row = [
      safeText(t.bank),
      t.date,
      t.time,
      safeText(t.summary),
      amount(t.expenseCents),
      amount(t.incomeCents),
      amount(t.balanceCents),
      amount(t.feeCents),
      safeText(t.note),
      safeText(t.typeHint),
      result.sourceType || 'pdf',
      t.sourceLine ?? t.line,
      t.page,
      t.endPage,
      t.errors.join('|'),
      t.balanceCheck?.status,
      t.reviewStatus
    ];
    lines.push(row.map(cell).join(','));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
export function toJSON(result) {
  return JSON.stringify(
    {
      schemaVersion: 1,
      currency: 'TWD',
      amountUnit: 'integer_cents',
      notice: '供人工核對的預覽，非正式入帳資料。',
      ...result
    },
    null,
    2
  );
}
