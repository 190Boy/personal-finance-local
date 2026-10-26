// 「發票」工作表：發票與品項放同一張表，以「資料類型」區分。
// 發票列一張一列，帶加總金額與（之後用來配對的）配對欄位；品項列以發票紀錄ID連回所屬發票。
import { hash } from './records.mjs';
import { isVoided } from '../pdf-parser/invoices.mjs';
import { moneyCents } from '../pdf-parser/parser.mjs';

export const INVOICE_HEADERS = [
  '資料類型',
  '紀錄ID',
  '匯入ID',
  '發票紀錄ID',
  '發票號碼',
  '發票日期',
  '賣方統編',
  '賣方名稱',
  '賣方地址',
  '載具',
  '發票狀態',
  '折讓',
  '買方統編',
  '金額（元）',
  '品名',
  '數量',
  '單價',
  '品項序',
  '核對狀態',
  '匯入時間',
  '來源列',
  '配對狀態',
  '配對紀錄ID',
  '付款方式',
  '配對更新時間'
];
export const INVOICE_COL = Object.fromEntries(INVOICE_HEADERS.map((name, i) => [name, i]));
const AMOUNT = INVOICE_COL['金額（元）'];

// Sheets stores yuan for readability; the program keeps integer cents.
export function invoiceSheetRows(rows) {
  return rows.map(r => {
    const out = [...r];
    if (out[AMOUNT] !== '' && out[AMOUNT] != null) {
      if (!Number.isSafeInteger(out[AMOUNT])) throw Error('INVOICE_AMOUNT');
      out[AMOUNT] /= 100;
    }
    return out;
  });
}
export function invoiceTable(values) {
  if (!values.length) return [];
  if (JSON.stringify(values[0]) !== JSON.stringify(INVOICE_HEADERS)) throw Error('SHEET_SCHEMA');
  return values.slice(1).map(r => {
    const out = INVOICE_HEADERS.map((_, i) => r[i] ?? '');
    if (out[AMOUNT] !== '') {
      const n = moneyCents(String(out[AMOUNT]));
      if (!Number.isSafeInteger(n)) throw Error('INVOICE_AMOUNT');
      out[AMOUNT] = n;
    }
    return out;
  });
}

export async function makeInvoiceImport(parsed, { fileHash }) {
  if (!fileHash || !parsed?.invoices?.length) throw Error('NO_RECORDS');
  const now = new Date().toISOString(),
    id = await hash(JSON.stringify(['invoices-v1', fileHash])),
    rows = [],
    occurrences = new Map();
  for (const inv of parsed.invoices) {
    // A masked number is not unique, so its identity also covers the content.
    const identity = JSON.stringify([
        'invoice',
        inv.number,
        inv.date,
        inv.sellerId,
        ...(inv.masked ? [inv.totalCents, inv.items.map(i => [i.name, i.amountCents])] : [])
      ]),
      n = (occurrences.get(identity) || 0) + 1;
    occurrences.set(identity, n);
    const invoiceId = await hash(identity + '#' + n);
    const review = inv.errors.length ? inv.errors.join('／') : '已讀取';
    rows.push([
      '發票',
      invoiceId,
      id,
      invoiceId,
      inv.number,
      inv.date,
      inv.sellerId,
      inv.sellerName,
      inv.sellerAddress,
      inv.carrier,
      inv.status,
      inv.allowance,
      inv.buyerId,
      inv.totalCents ?? '',
      '',
      '',
      '',
      '',
      review,
      now,
      inv.line,
      isVoided(inv.status) ? '作廢' : '未配對',
      '',
      '',
      ''
    ]);
    for (const [k, item] of inv.items.entries())
      rows.push([
        '品項',
        await hash(invoiceId + '#item#' + k),
        id,
        invoiceId,
        inv.number,
        inv.date,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        item.amountCents ?? '',
        item.name,
        item.quantity,
        item.unitPrice,
        k + 1,
        '',
        now,
        item.line,
        '',
        '',
        '',
        ''
      ]);
  }
  const carriers = [...new Set(parsed.invoices.map(i => i.carrier).filter(Boolean))].join('、').slice(0, 60);
  return {
    id,
    rows,
    log: [
      id,
      '財政部電子發票',
      carriers || '雲端發票',
      '雲端發票',
      now,
      parsed.invoices.length,
      0,
      '',
      '',
      '發票 ' + parsed.from + '～' + parsed.to + '；尚未配對'
    ]
  };
}

// An invoice and its items are added or skipped together. Re-exporting an overlapping month
// adds nothing; an invoice whose content changed (voided later, allowance) is appended and flagged,
// and readers use the latest import of each invoice.
export function invoiceRowsToAppend(existing, incoming) {
  const C = INVOICE_COL,
    known = new Map();
  const signature = (head, items) =>
    JSON.stringify([
      head[C['發票狀態']],
      head[C['折讓']],
      head[C['金額（元）']],
      items.map(r => [r[C['品名']], r[C['金額（元）']]])
    ]);
  const group = rows => {
    const out = new Map();
    for (const r of rows) {
      const key = r[C['發票紀錄ID']];
      if (!out.has(key)) out.set(key, { head: null, items: [] });
      if (r[0] === '發票') out.get(key).head = r;
      else out.get(key).items.push(r);
    }
    return out;
  };
  for (const [key, g] of group(existing)) if (g.head) known.set(key, [signature(g.head, g.items)]);
  // Older imports of the same invoice may differ; any match counts as already stored.
  for (const r of existing)
    if (r[0] === '發票' && known.has(r[C['發票紀錄ID']])) {
      const items = existing.filter(
        x => x[0] === '品項' && x[C['匯入ID']] === r[C['匯入ID']] && x[C['發票紀錄ID']] === r[C['發票紀錄ID']]
      );
      known.get(r[C['發票紀錄ID']]).push(signature(r, items));
    }
  const fresh = [];
  let skipped = 0,
    changed = 0;
  for (const [key, g] of group(incoming)) {
    if (!g.head) continue;
    const sig = signature(g.head, g.items),
      prior = known.get(key);
    if (prior?.includes(sig)) {
      skipped++;
      continue;
    }
    const head = [...g.head];
    if (prior) {
      changed++;
      head[C['核對狀態']] = [head[C['核對狀態']], '與先前匯入內容不同，以最新匯入為準'].join('／');
    }
    fresh.push(head, ...g.items);
    known.set(key, [...(prior || []), sig]);
  }
  return { fresh, skipped, changed, added: fresh.filter(r => r[0] === '發票').length };
}
