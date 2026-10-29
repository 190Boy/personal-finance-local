import { readLinePayChat } from '../pdf-parser/linepay.mjs';
const $ = id => document.getElementById(id);
const money = c =>
  Number.isSafeInteger(c) ? (c / 100).toLocaleString('zh-TW', { maximumFractionDigits: 2 }) : '—';
const messages = {
  LINEPAY_HEADER:
    '這不是「LINE錢包」聊天室的匯出檔。請在 LINE 打開「LINE錢包」聊天室，選設定 → 傳送聊天紀錄。',
  LINEPAY_EMPTY: '檔案裡沒有付款、儲值或提領的通知。',
  LINEPAY_ENCODING: '檔案編碼無法辨識，請直接使用 LINE 匯出的文字檔，不要另存。',
  LINEPAY_LIMIT: '檔案超過本機讀取上限。',
  LINEPAY_AMOUNT: '「LINE Pay」工作表的金額無法辨識，尚未寫入。請不要手動修改金額欄。',
  FILE_TOO_LARGE: '檔案超過 25 MiB。',
  EMPTY_FILE: '檔案是空的。',
  LINEPAY_FILE: '請選擇 .txt 文字檔。',
  NO_RECORDS: '沒有可同步的通知。',
  GOOGLE_LOGIN_REQUIRED: '請先到設定連接 Google，再回來同步。',
  SYNC_BUSY: '其他同步正在進行，請稍後重試。',
  SYNC_RETRY: '其他裝置正在同步，請稍後重試；預覽保留。',
  SHEET_SCHEMA: '「LINE Pay」工作表欄位已更動，請保留系統欄名與順序。'
};
const label = e =>
  e.type === '付款'
    ? e.method === '錢包'
      ? '錢包付款'
      : 'LINE Pay 卡付款'
    : e.type === '取消'
      ? '取消付款'
      : e.type;

export function initLinePay(cloud) {
  let parsed = null,
    digest = '',
    busy = false,
    run = 0;
  function controls() {
    $('linepayFile').disabled = busy;
    $('linepayParse').disabled = busy;
    $('linepayConsent').disabled = busy || !parsed;
    $('linepaySave').disabled = busy || !parsed || !$('linepayConsent').checked;
  }
  function discard() {
    run++;
    parsed = null;
    digest = '';
    busy = false;
    $('linepayConsent').checked = false;
    $('linepayPreview').replaceChildren();
    $('linepayReport').hidden = true;
    controls();
  }
  function preview() {
    const box = $('linepayPreview'),
      recent = parsed.events.slice(-30).reverse();
    const title = document.createElement('h2');
    title.textContent = '最近 ' + recent.length + ' 筆通知';
    const list = document.createElement('div');
    list.className = 'invoice-list';
    for (const e of recent) {
      const card = document.createElement('article'),
        top = document.createElement('div'),
        h = document.createElement('h3'),
        amount = document.createElement('span'),
        meta = document.createElement('p');
      card.className = 'invoice-card';
      top.className = 'top';
      h.textContent = e.shop || (e.type === '儲值' ? '儲值' + (e.bank ? '（' + e.bank + '）' : '') : e.type);
      amount.className = 'amount';
      amount.textContent = (e.type === '儲值' ? '+' : '') + money(e.amountCents) + ' 元';
      meta.className = 'meta';
      meta.textContent = [
        e.date,
        e.time,
        label(e),
        e.balanceCents !== null ? '餘額 ' + money(e.balanceCents) : ''
      ]
        .filter(Boolean)
        .join(' · ');
      top.append(h, amount);
      card.append(top, meta);
      list.append(card);
    }
    box.append(title, list);
  }
  $('linepayFile').addEventListener('change', () => {
    discard();
    $('linepayStatus').textContent = '檔案已選擇，請按「本機讀取」。';
  });
  $('linepayConsent').addEventListener('input', controls);
  $('linepayForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    discard();
    const mine = run,
      file = $('linepayFile').files[0];
    if (!file) return;
    busy = true;
    controls();
    $('linepayStatus').textContent = '正在本機讀取…';
    try {
      if (!/\.txt$/i.test(file.name)) throw Error('LINEPAY_FILE');
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
        .map(v => v.toString(16).padStart(2, '0'))
        .join('');
      const result = await readLinePayChat(file);
      if (mine !== run) return;
      parsed = result;
      digest = hash;
      const c = parsed.counts;
      $('linepayReport').textContent =
        parsed.from +
        ' ～ ' +
        parsed.to +
        '：錢包付款 ' +
        c.wallet +
        ' 筆、LINE Pay 卡付款 ' +
        c.card +
        ' 筆、儲值 ' +
        c.topup +
        ' 筆' +
        (c.withdraw ? '、提領 ' + c.withdraw + ' 筆' : '') +
        (c.cancel ? '、取消付款 ' + c.cancel + ' 筆' : '') +
        '。' +
        (parsed.lastBalance
          ? '最後一筆通知的錢包餘額 ' +
            money(parsed.lastBalance.cents) +
            ' 元（' +
            parsed.lastBalance.date +
            '）。'
          : '') +
        '其他 ' +
        parsed.skipped +
        ' 則是點數、公告等非交易訊息，不會匯入。';
      $('linepayReport').hidden = false;
      preview();
      $('linepayStatus').textContent = '讀取完成，尚未同步。';
    } catch (error) {
      if (mine === run) {
        parsed = null;
        $('linepayStatus').textContent =
          messages[error.message] || '本機讀取未完成，請確認是 LINE 匯出的聊天記錄文字檔。';
      }
    } finally {
      if (mine === run) {
        busy = false;
        controls();
      }
    }
  });
  $('linepaySave').addEventListener('click', async () => {
    if (busy || !parsed || !$('linepayConsent').checked) return;
    const mine = run;
    busy = true;
    controls();
    $('linepayStatus').textContent = '正在同步…';
    try {
      const r = await cloud.saveLinePay({ parsed, fileHash: digest });
      if (mine === run)
        $('linepayStatus').textContent = r.repeated
          ? '這個檔案已經匯入過，沒有重複寫入。'
          : '已同步到「LINE Pay」工作表：新增 ' +
            r.added +
            ' 筆' +
            (r.skipped ? '，' + r.skipped + ' 筆先前已存過而略過' : '') +
            '。到「交易明細 → 發票配對」查看錢包餘額落差。';
    } catch (error) {
      if (mine === run)
        $('linepayStatus').textContent =
          messages[error.message] || '雲端尚未完成，預覽保留；請重新連接 Google 或稍後重試。';
    } finally {
      if (mine === run) {
        busy = false;
        controls();
      }
    }
  });
  $('linepayClear').addEventListener('click', () => {
    discard();
    $('linepayFile').value = '';
    $('linepayStatus').textContent = '已清除檔案與預覽。';
  });
  for (const event of ['pagehide', 'finance-signout', 'finance-clear-local'])
    window.addEventListener(event, () => {
      discard();
      $('linepayFile').value = '';
    });
  controls();
}
