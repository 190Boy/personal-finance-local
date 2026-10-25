import { IMPORT_HEADERS, hash } from './records.mjs';
export const OLD_IMPORT_HEADERS = ['匯入 ID', '銀行', '帳戶代稱', '類別', '寫入時間', '來源筆數', '新增筆數'];
export const LEGACY_STOCK_HEADERS = [
  '匯入ID',
  '券商',
  '帳戶代稱',
  '匯入時間',
  '庫存檔指紋',
  '異動檔指紋',
  '核對狀態'
];
export function ledgerPlan(current, legacy) {
  const header = current[0] || [];
  if (
    current.length &&
    ![IMPORT_HEADERS, OLD_IMPORT_HEADERS].some(h => JSON.stringify(h) === JSON.stringify(header))
  )
    throw Error('SHEET_SCHEMA');
  if (legacy.length && JSON.stringify(legacy[0]) !== JSON.stringify(LEGACY_STOCK_HEADERS))
    throw Error('SHEET_SCHEMA');
  const seen = new Set(current.slice(1).map(r => r[0])),
    rows = [];
  for (const r of legacy.slice(1)) {
    if (!r[0] || seen.has(r[0])) continue;
    seen.add(r[0]);
    rows.push([r[0], r[1], r[2], '股票資產', r[3], '', '', r[4] || '', r[5] || '', r[6] || '']);
  }
  return { rewriteHeader: JSON.stringify(header) !== JSON.stringify(IMPORT_HEADERS), rows };
}
export async function migrationId(file, plan) {
  return parseInt((await hash(JSON.stringify(['unified-log-v1', file, plan]))).slice(0, 7), 16) + 1;
}
