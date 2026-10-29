const reviewLabel = v =>
  ({ pass: '餘額吻合', fail: '餘額不符', no_opening: '無起始餘額', uncheckable: '待核對' })[v] ||
  String(v || '');
// Same stable ID and same financial fields collapse for display only.
// Conflicting rows, missing IDs and different IDs are retained.
export function cloudHistory(bankRows, stockRows) {
  const out = [],
    seen = new Map();
  let duplicates = 0;
  for (const [kind, rows] of [
    ['銀行存款', bankRows],
    ['股票股數', stockRows]
  ]) {
    for (let index = 0; index < rows.length; index++) {
      const r = rows[index];
      if (!r.some(v => v !== '' && v != null)) continue;
      const identity = JSON.stringify([kind, r[0] || 'row:' + index]),
        financial = JSON.stringify(kind === '銀行存款' ? r.slice(1, 12) : r.slice(1, 10)),
        prior = seen.get(identity) || [];
      if (prior.some(p => p.financial === financial)) {
        duplicates++;
        continue;
      }
      const entry = {
        kind,
        id: r[0] || '',
        source: r[1] || '',
        account: r[2] || '',
        date: String(r[3] ?? ''),
        time: kind === '銀行存款' ? String(r[4] ?? '') : '',
        code: kind === '股票股數' ? r[4] || '' : '',
        summary: kind === '銀行存款' ? r[5] || '' : [r[4], r[5], r[6]].filter(Boolean).join('／'),
        expense: kind === '銀行存款' ? r[6] : r[7],
        income: kind === '銀行存款' ? r[7] : r[8],
        fee: kind === '銀行存款' ? r[8] : null,
        balance: kind === '銀行存款' ? r[9] : r[9],
        review:
          kind === '銀行存款'
            ? [reviewLabel(r[10]), String(r[11] || '').replaceAll('CLOUD_ID_CONFLICT', '相同紀錄內容衝突')]
                .filter(Boolean)
                .join('／')
            : '股數異動，非現金收支',
        conflict: false,
        ordinal: index,
        financial
      };
      if (prior.length) {
        entry.conflict = true;
        for (const p of prior) p.conflict = true;
      }
      prior.push(entry);
      seen.set(identity, prior);
      out.push(entry);
    }
  }
  out.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.ordinal - a.ordinal);
  return { rows: out, duplicates };
}
export function filterHistory(
  rows,
  { kind = '', account = '', query = '', from = '', to = '', month = '', category = '' } = {}
) {
  const q = query.trim().toLocaleLowerCase();
  return rows.filter(
    r =>
      (!kind || r.kind === kind) &&
      (!month || String(r.date).startsWith(month)) &&
      (!category || String(r.category || '').split('／')[0] === category) &&
      (!account || JSON.stringify([r.source, r.account]) === account) &&
      (!from || r.date >= from) &&
      (!to || r.date <= to) &&
      (!q ||
        [r.source, r.account, r.code, r.summary, r.review, r.category]
          .join(' ')
          .toLocaleLowerCase()
          .includes(q))
  );
}
