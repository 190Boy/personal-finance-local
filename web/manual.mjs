import { manualEntry, manualRow, MANUAL_CATEGORIES } from '../cloud/manual.mjs';
import { decisionRow, PAYMENT_METHODS } from '../cloud/matching.mjs';
import { hash } from '../cloud/records.mjs';
const $ = id => document.getElementById(id);
const money = c => (c / 100).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const messages = {
  MANUAL_DATE: '請填寫正確的日期。',
  MANUAL_TIME: '時間格式不正確，可以留空。',
  MANUAL_AMOUNT: '請填寫大於 0 的金額，最多到小數點後兩位。',
  MANUAL_METHOD: '請選擇付款方式。',
  MANUAL_AMOUNT_SHEET: '「手動記帳」工作表的金額無法辨識。',
  GOOGLE_LOGIN_REQUIRED: '請先連接 Google，再回來記帳。',
  SYNC_BUSY: '其他同步正在進行，請稍後重試。',
  SYNC_RETRY: '其他裝置正在同步，請稍後重試；填寫的內容保留。',
  SHEET_SCHEMA: '「手動記帳」工作表欄位已更動，請保留系統欄名與順序。'
};
const today = () => {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
};
let cloud = null,
  entries = null,
  editing = null,
  gapId = '',
  busy = false,
  shown = 30;

function fill(values = {}) {
  editing = values.id ? values : null;
  gapId = values.gapId || '';
  $('manualType').value = values.type || '支出';
  $('manualDate').value = values.date || today();
  $('manualTime').value = values.time || '';
  $('manualAmount').value = values.amountCents ? String(values.amountCents / 100) : values.amount || '';
  $('manualMethod').value = values.method || '現金';
  $('manualParty').value = values.party || '';
  $('manualCategory').value = values.category || '';
  $('manualNote').value = values.note || '';
  $('manualSave').textContent = editing ? '儲存修改' : '儲存';
  $('manualCancel').hidden = !editing && !gapId;
  $('manualContext').textContent = editing
    ? '正在修改 ' + editing.date + ' 的紀錄。'
    : gapId
      ? '從 LINE 錢包餘額落差帶入。儲存後，這段落差會標記為「已手動補記」。'
      : '';
}
function controls() {
  for (const id of ['manualSave', 'manualCancel']) $(id).disabled = busy;
  $('manualList')
    .querySelectorAll('button')
    .forEach(b => (b.disabled = busy));
}
async function save(rows, decisions, done) {
  busy = true;
  controls();
  $('manualStatus').textContent = '正在儲存…';
  try {
    await cloud.saveManual(rows, decisions);
    $('manualStatus').textContent = done;
    return true;
  } catch (error) {
    $('manualStatus').textContent = messages[error.message] || '尚未儲存，請稍後重試；填寫的內容保留。';
    return false;
  } finally {
    busy = false;
    controls();
  }
}
function draw() {
  const box = $('manualList');
  box.replaceChildren();
  if (!entries) {
    box.append(
      Object.assign(document.createElement('p'), {
        className: 'muted',
        textContent: '連接 Google 後會列出已記錄的手動帳。'
      })
    );
    return;
  }
  if (!entries.length) {
    box.append(
      Object.assign(document.createElement('p'), { className: 'muted', textContent: '還沒有手動記帳。' })
    );
    return;
  }
  for (const e of entries.slice(0, shown)) {
    const card = document.createElement('article'),
      top = document.createElement('div'),
      h = document.createElement('h3'),
      amount = document.createElement('span'),
      meta = document.createElement('p'),
      actions = document.createElement('div');
    card.className = 'invoice-card';
    top.className = 'top';
    h.textContent = e.party || e.category || e.type;
    amount.className = 'amount';
    amount.textContent = (e.type === '收入' ? '+' : '') + money(e.amountCents) + ' 元';
    meta.className = 'meta';
    meta.textContent = [e.date + (e.time ? ' ' + e.time : ''), e.method, e.category, e.note]
      .filter(Boolean)
      .join(' · ');
    actions.className = 'actions';
    const edit = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'secondary',
      textContent: '修改'
    });
    edit.addEventListener('click', () => {
      fill(e);
      $('manualForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const remove = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'secondary',
      textContent: '刪除'
    });
    remove.addEventListener('click', () => {
      if (busy) return;
      void save(
        [manualRow(e, { deleted: true })],
        [],
        '已刪除：' + h.textContent + ' ' + money(e.amountCents) + ' 元。'
      );
    });
    actions.append(edit, remove);
    top.append(h, amount);
    card.append(top, meta, actions);
    box.append(card);
  }
  if (entries.length > shown) {
    const more = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'secondary',
      textContent: '再顯示 30 筆'
    });
    more.addEventListener('click', () => {
      shown += 30;
      draw();
    });
    box.append(more);
  }
  controls();
}

export function renderManual(list) {
  entries = list;
  if ($('manualList')) draw();
}
export function initManual(api) {
  cloud = api;
  for (const m of PAYMENT_METHODS) $('manualMethod').append(new Option(m, m));
  for (const c of MANUAL_CATEGORIES) $('manualCategories').append(new Option(c, c));
  fill();
  $('manualForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    if (busy) return;
    let entry;
    try {
      entry = manualEntry({
        id: editing?.id || crypto.randomUUID(),
        type: $('manualType').value,
        date: $('manualDate').value,
        time: $('manualTime').value,
        amount: $('manualAmount').value,
        method: $('manualMethod').value,
        party: $('manualParty').value,
        category: $('manualCategory').value,
        note: $('manualNote').value
      });
    } catch (error) {
      $('manualStatus').textContent = messages[error.message] || '請檢查填寫的內容。';
      return;
    }
    const decisions = gapId
      ? [
          await decisionRow(hash, {
            type: 'LINE錢包',
            target: gapId,
            action: '落差',
            other: 'manual:' + entry.id,
            method: '已手動補記'
          })
        ]
      : [];
    const label = (entry.party || entry.category || entry.type) + ' ' + money(entry.amountCents) + ' 元';
    if (await save([manualRow(entry)], decisions, (editing ? '已修改：' : '已記錄：') + label + '。')) fill();
  });
  $('manualCancel').addEventListener('click', () => {
    fill();
    $('manualStatus').textContent = '';
  });
  window.addEventListener('finance-manual-prefill', e => {
    fill(e.detail || {});
    $('manualStatus').textContent = '';
  });
  for (const event of ['finance-signout', 'pagehide']) window.addEventListener(event, () => fill());
  draw();
}
