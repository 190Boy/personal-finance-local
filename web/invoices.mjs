import { readInvoiceCsv, parseInvoiceBook, shortSeller, isVoided } from '../pdf-parser/invoices.mjs';
const $ = id => document.getElementById(id);
const money = c =>
  Number.isSafeInteger(c)
    ? (c / 100).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    : '待核對';
const PAGE = 50;
const messages = {
  INVOICE_HEADER:
    '找不到雲端發票明細的欄位。請確認是財政部平台「載具消費明細」下載的 CSV，且沒有另存或修改欄名。',
  INVOICE_MULTIPLE: '檔案裡有多組表頭，請重新下載單一份明細。',
  INVOICE_EMPTY: '檔案裡沒有發票資料。',
  INVOICE_AMOUNT: '「發票」工作表的金額無法辨識，尚未寫入。請不要手動修改金額欄。',
  CSV_ENCODING: 'CSV 編碼無法識別；支援 UTF-8 與 Big5。',
  CSV_QUOTES: 'CSV 引號結構錯誤，請重新下載。',
  CARD_LIMIT: '資料超過本機讀取上限。',
  FILE_TOO_LARGE: '檔案超過 25 MiB。',
  EMPTY_FILE: '檔案是空的。',
  INVOICE_FILE: '請選擇 CSV 檔。',
  NO_RECORDS: '沒有可同步的發票。',
  GOOGLE_LOGIN_REQUIRED: '請先到設定連接 Google，再回來同步。',
  SYNC_BUSY: '其他同步正在進行，請稍後重試。',
  SYNC_RETRY: '其他裝置正在同步，請稍後重試；預覽保留。',
  SYNC_METADATA_LIMIT: '試算表的同步標記已滿，請更新到最新版後重試。',
  SHEET_SCHEMA: '「發票」工作表欄位已更動，請保留系統欄名與順序。'
};

function text(tag, value, className) {
  const el = document.createElement(tag);
  el.textContent = value;
  if (className) el.className = className;
  return el;
}
function invoiceCard(inv) {
  const card = document.createElement('article');
  card.className = 'invoice-card' + (isVoided(inv.status) ? ' voided' : '');
  const seller = shortSeller(inv.sellerName),
    top = document.createElement('div');
  top.className = 'top';
  top.append(
    text('h3', seller.name || '賣方名稱缺漏'),
    text('span', money(inv.totalCents) + ' 元', 'amount')
  );
  const meta = [inv.date || '日期待核對', seller.branch, inv.carrier, inv.number].filter(Boolean).join(' · ');
  card.append(top, text('p', meta, 'meta'));
  if (inv.items.length) {
    const details = document.createElement('details'),
      list = document.createElement('ul');
    details.append(text('summary', inv.items.length + ' 個品項'));
    list.className = 'invoice-items';
    for (const item of inv.items) {
      const li = document.createElement('li');
      if (item.amountCents < 0) li.className = 'discount';
      const qty = item.quantity && item.quantity !== '1' ? ' ×' + item.quantity : '';
      li.append(text('span', (item.name || '品名缺漏') + qty), text('span', money(item.amountCents)));
      list.append(li);
    }
    details.append(list);
    card.append(details);
  }
  if (inv.errors.length) card.append(text('p', inv.errors.join('；'), 'bad'));
  return card;
}

export function initInvoices(cloud) {
  let parsed = null,
    digest = '',
    busy = false,
    run = 0,
    shown = 0;
  function controls() {
    $('invoiceFile').disabled = busy;
    $('invoiceParse').disabled = busy;
    $('invoiceConsent').disabled = busy || !parsed;
    $('invoiceSave').disabled = busy || !parsed || !$('invoiceConsent').checked;
  }
  function discard() {
    run++;
    parsed = null;
    digest = '';
    busy = false;
    shown = 0;
    $('invoiceConsent').checked = false;
    $('invoicePreview').replaceChildren();
    $('invoiceReport').textContent = '';
    $('invoiceReport').hidden = true;
    controls();
  }
  function clear() {
    discard();
    $('invoiceFile').value = '';
    $('invoiceStatus').textContent = '已清除發票檔案與預覽。';
  }
  function more() {
    const box = $('invoicePreview');
    box.querySelector('.invoice-more')?.remove();
    const next = parsed.invoices.slice(shown, shown + PAGE);
    for (const inv of next) box.append(invoiceCard(inv));
    shown += next.length;
    if (shown < parsed.invoices.length) {
      const button = text(
        'button',
        '再顯示 ' + Math.min(PAGE, parsed.invoices.length - shown) + ' 張',
        'secondary invoice-more'
      );
      button.type = 'button';
      button.addEventListener('click', more);
      box.append(button);
    }
  }
  $('invoiceFile').addEventListener('change', () => {
    discard();
    $('invoiceStatus').textContent = '檔案已選擇，請按「本機讀取發票」。';
  });
  $('invoiceConsent').addEventListener('input', controls);
  $('invoiceForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    discard();
    const mine = run,
      file = $('invoiceFile').files[0];
    if (!file) return;
    busy = true;
    controls();
    $('invoiceStatus').textContent = '正在本機讀取發票…';
    try {
      if (!/\.csv$/i.test(file.name)) throw Error('INVOICE_FILE');
      if (file.size > 25 * 1024 * 1024) throw Error('FILE_TOO_LARGE');
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
        .map(v => v.toString(16).padStart(2, '0'))
        .join('');
      const result = parseInvoiceBook(await readInvoiceCsv(file));
      if (mine !== run) return;
      parsed = result;
      digest = hash;
      const voided = parsed.invoices.filter(i => isVoided(i.status)).length,
        flagged = parsed.invoices.filter(i => i.errors.length && !isVoided(i.status)).length;
      $('invoiceReport').textContent =
        parsed.from +
        ' ～ ' +
        parsed.to +
        ' · ' +
        parsed.invoices.length +
        ' 張發票、' +
        parsed.itemCount +
        ' 個品項，合計 ' +
        money(parsed.totalCents) +
        ' 元' +
        (voided ? '（不含作廢 ' + voided + ' 張）' : '') +
        '。' +
        (flagged ? flagged + ' 張需要核對，已在下方標示。' : '');
      $('invoiceReport').hidden = false;
      more();
      $('invoiceStatus').textContent = '讀取完成，尚未同步。';
    } catch (error) {
      if (mine === run) {
        parsed = null;
        digest = '';
        $('invoiceStatus').textContent =
          messages[error.message] || '本機讀取未完成。請確認是財政部平台下載的發票明細 CSV；原檔沒有上傳。';
      }
    } finally {
      if (mine === run) {
        busy = false;
        controls();
      }
    }
  });
  $('invoiceSave').addEventListener('click', async () => {
    if (busy || !parsed || !$('invoiceConsent').checked) return;
    const mine = run;
    busy = true;
    controls();
    $('invoiceStatus').textContent = '正在同步發票…';
    try {
      const r = await cloud.saveInvoices({ parsed, fileHash: digest });
      if (mine === run)
        $('invoiceStatus').textContent = r.repeated
          ? '這個檔案已經匯入過，沒有重複寫入。'
          : '已同步到「發票」工作表：新增 ' +
            r.added +
            ' 張' +
            (r.skipped ? '，' + r.skipped + ' 張先前已存過而略過' : '') +
            (r.changed ? '，' + r.changed + ' 張內容和先前不同，已加註以最新為準' : '') +
            '。';
    } catch (error) {
      if (mine === run)
        $('invoiceStatus').textContent =
          messages[error.message] || '雲端尚未完成，預覽保留；請重新連接 Google 或稍後重試。';
    } finally {
      if (mine === run) {
        busy = false;
        controls();
      }
    }
  });
  $('invoiceClear').addEventListener('click', clear);
  for (const event of ['pagehide', 'finance-signout', 'finance-clear-local'])
    window.addEventListener(event, clear);
  controls();
}
