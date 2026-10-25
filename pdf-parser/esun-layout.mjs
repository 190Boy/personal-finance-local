// E.SUN three-baseline download header; match labels, never infer directions from balances.
const clean = s =>
  String(s ?? '')
    .normalize('NFKC')
    .replace(/\s/g, '');
export function findEsunHeader(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].items.some(t => clean(t.str) === '交易日期')) continue;
    const rows = lines.slice(i, i + 3);
    if (
      rows.length !== 3 ||
      rows.at(-1).y - rows[0].y > Math.max(60, ...rows.flatMap(r => r.items.map(t => t.h * 6)))
    )
      continue;
    const names = {
      date: '交易日期',
      summary: '摘要',
      expense: '提',
      income: '存',
      balance: '帳戶餘額',
      note: '存摺備註',
      message: '轉帳留言',
      serial: '財金序號'
    };
    const columns = {};
    for (const [field, label] of Object.entries(names)) {
      const matches = rows.flatMap(r => r.items).filter(t => clean(t.str) === label);
      if (matches.length === 1) {
        const t = matches[0];
        columns[field] = { x: t.x + t.w / 2, left: t.x, right: t.x + t.w };
      }
    }
    if (!['date', 'summary', 'expense', 'income', 'balance'].every(k => columns[k])) continue;
    const xs = ['date', 'summary', 'expense', 'income', 'balance'].map(k => columns[k].x);
    if (xs.some((x, j) => j && x <= xs[j - 1])) continue;
    if (
      !rows.some(r => r.items.some(t => clean(t.str) === '時間')) ||
      !rows.some(r => r.items.some(t => clean(t.str) === '手續費'))
    )
      continue;
    return { columns, y: rows.at(-1).y, profile: 'esun-stacked-v1', score: 5 };
  }
  return null;
}
export function isEsunTime(s) {
  return /^\d{2}:\d{2}(?::\d{2})?$/.test(String(s ?? '').trim());
}
