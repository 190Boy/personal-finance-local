// LINE「LINE錢包」聊天室匯出的文字檔（聊天室 → 設定 → 傳送聊天紀錄）。
// 每則交易通知含金額、商店、時間；用錢包付款的通知帶「付款後餘額」，刷 LINE Pay 卡的沒有。
// 好友轉帳不會出現在這個聊天室，所以另外用餘額落差找出沒有通知的錢進出（見 cloud/linepay.mjs）。

const DATE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})[（(][^）)]{1,3}[）)]\s*$/;
const MESSAGE = /^(\d{1,2}):(\d{2})\t([^\t]*)\t(.*)$/;
const money = s => {
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isSafeInteger(n) ? n * 100 : null;
};
const pad = n => String(n).padStart(2, '0');

// The export quotes multi-line messages and doubles embedded quotes, like CSV.
function unquote(text) {
  const t = text.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t;
}

export function splitMessages(text) {
  const lines = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  if (!/LINE錢包/.test(lines[0] || '')) throw Error('LINEPAY_HEADER');
  if (lines.length > 200000) throw Error('LINEPAY_LIMIT');
  const messages = [];
  let date = '',
    current = null;
  for (let n = 1; n < lines.length; n++) {
    const line = lines[n],
      d = line.match(DATE);
    if (d) {
      date = d[1] + '-' + pad(d[2]) + '-' + pad(d[3]);
      current = null;
      continue;
    }
    const m = line.match(MESSAGE);
    if (m && date) {
      current = { date, time: pad(m[1]) + ':' + m[2], sender: m[3], raw: m[4], line: n + 1 };
      messages.push(current);
    } else if (current) current.raw += '\n' + line;
  }
  for (const m of messages) m.text = unquote(m.raw);
  return messages;
}

export function parseEvent(m) {
  const t = m.text,
    head = t.match(/^(?:LINE Pay\s+)?(付款|儲值|提領)\s*NT\$\s*([\d,]+)/);
  if (!head) return null;
  const amountCents = money(head[2]);
  const balance = t.match(/付款後餘額[:：]\s*NT\$\s*([\d,]+)/),
    shop = t.match(/商店名稱[:：][ \t]*([^\n]*?)(?:\s+付款後餘額.*)?$/m),
    bank = t.match(/銀行名稱[:：][ \t]*([^\n]*?)(?:\s+付款後餘額.*)?$/m);
  let type = head[1];
  if (type === '付款' && /取消付款/.test(t)) type = '取消';
  const balanceCents = balance ? money(balance[1]) : null;
  return {
    date: m.date,
    time: m.time,
    type,
    amountCents,
    shop: shop ? shop[1].trim() : '',
    // A wallet payment reports the balance afterwards; a LINE Pay card payment does not.
    method: type === '付款' ? (balanceCents === null ? '刷卡' : '錢包') : '',
    balanceCents,
    bank: bank ? bank[1].trim() : '',
    line: m.line
  };
}

export function parseLinePayChat(text) {
  const messages = splitMessages(text),
    events = [];
  let skipped = 0;
  for (const m of messages) {
    const e = parseEvent(m);
    if (e && Number.isSafeInteger(e.amountCents)) events.push(e);
    else skipped++;
  }
  if (!events.length) throw Error('LINEPAY_EMPTY');
  const dates = events.map(e => e.date).sort(),
    count = (type, method) => events.filter(e => e.type === type && (!method || e.method === method)).length;
  const lastWallet = [...events].reverse().find(e => e.balanceCents !== null);
  return {
    events,
    messages: messages.length,
    skipped,
    from: dates[0],
    to: dates.at(-1),
    counts: {
      wallet: count('付款', '錢包'),
      card: count('付款', '刷卡'),
      topup: count('儲值'),
      withdraw: count('提領'),
      cancel: count('取消')
    },
    lastBalance: lastWallet
      ? { date: lastWallet.date, time: lastWallet.time, cents: lastWallet.balanceCents }
      : null
  };
}

export async function readLinePayChat(file) {
  if (file.size > 25 * 1024 * 1024) throw Error('FILE_TOO_LARGE');
  if (!file.size) throw Error('EMPTY_FILE');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    throw Error('LINEPAY_ENCODING');
  }
  return parseLinePayChat(text);
}
