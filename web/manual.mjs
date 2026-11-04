import { manualEntry, manualRow } from '../cloud/manual.mjs';
import { CATEGORY_TREE, iconOf, normalizeCategory, mainOf } from '../cloud/categories.mjs';
import { transferCategory, resolveAccount } from '../cloud/balances.mjs';
import { decisionRow, PAYMENT_METHODS } from '../cloud/matching.mjs';
import { hash } from '../cloud/records.mjs';
import { row, dayHeader, groupByDay } from './rows.mjs';
const $ = id => document.getElementById(id);
const money = c => (c / 100).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const messages = {
  MANUAL_DATE: '請填寫正確的日期。',
  MANUAL_TIME: '時間格式不正確，可以留空。',
  MANUAL_AMOUNT: '請填寫大於 0 的金額，最多到小數點後兩位。',
  MANUAL_METHOD: '請選擇付款方式。',
  MANUAL_EXPRESSION: '金額算式看不懂，只支援數字與 + −。',
  MANUAL_CATEGORY: '請選一個分類。',
  MANUAL_TRANSFER: '轉帳要選不同的轉出與轉入帳戶。',
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
  accountList = [],
  entries = null,
  editing = null,
  gapId = '',
  busy = false,
  shown = 30;

// Amount with a small calculator: digits, + and −; 「=」 or saving evaluates the expression.
export function evaluateAmount(text) {
  const t = String(text).replace(/\s+/g, '').replace(/[−－]/g, '-').replace(/[＋]/g, '+');
  if (!t) return '';
  if (!/^\d+(\.\d{1,2})?([+-]\d+(\.\d{1,2})?)*$/.test(t)) throw Error('MANUAL_EXPRESSION');
  let cents = 0;
  for (const part of t.match(/[+-]?\d+(\.\d{1,2})?/g)) {
    const sign = part.startsWith('-') ? -1 : 1,
      [whole, frac = ''] = part.replace(/^[+-]/, '').split('.');
    cents += sign * (Number(whole) * 100 + Number(frac.padEnd(2, '0')));
  }
  return (cents / 100)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}
function setAccountOptions(names) {
  const list = [...new Set([...(names?.length ? names : PAYMENT_METHODS.filter(m => m !== '其他')), '其他'])];
  for (const id of ['manualMethod', 'manualTo']) {
    const select = $(id),
      keep = select.value;
    select.replaceChildren(
      ...list.filter(n => id === 'manualMethod' || n !== '其他').map(n => new Option(n, n))
    );
    if (list.includes(keep)) select.value = keep;
  }
  accountList = list;
}
function setType(type) {
  $('manualType').value = type;
  const transfer = type === '轉帳';
  $('manualCategoryBlock').hidden = transfer;
  $('manualCategoryButton').hidden = transfer;
  $('manualToLabel').hidden = !transfer;
  $('manualPartyLabel').hidden = transfer;
  $('manualMethodLabel').textContent = transfer ? '轉出帳戶' : '帳戶';
  for (const b of document.querySelectorAll('.type-tab'))
    b.setAttribute('aria-selected', String(b.dataset.type === type));
  drawCategories();
}
function setCategory(category) {
  $('manualCategory').value = category || '';
  $('manualCategoryIcon').textContent = category ? iconOf(category) : '＋';
  $('manualCategoryName').textContent = category ? category.replace('／', ' · ') : '選分類';
  drawCategories();
}
function showPicker(open) {
  $('manualCategoryPicker').hidden = !open;
  $('manualCategoryButton').setAttribute('aria-expanded', String(open));
}
function drawCategories() {
  const type = $('manualType').value,
    chosen = $('manualCategory').value,
    groups = type === '收入' ? CATEGORY_TREE.收入 : [...CATEGORY_TREE.支出, ...CATEGORY_TREE.轉帳];
  const grid = $('manualCategoryGrid'),
    subs = $('manualSubGrid');
  grid.replaceChildren();
  subs.replaceChildren();
  for (const c of groups) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'category-tile' + (mainOf(chosen) === c.name ? ' on' : '');
    b.append(
      Object.assign(document.createElement('span'), { className: 'icon', textContent: c.icon }),
      c.name
    );
    b.addEventListener('click', () => {
      setCategory(c.name);
      if (!c.subs.length) showPicker(false);
    });
    grid.append(b);
  }
  const main = groups.find(c => c.name === mainOf(chosen));
  if (main)
    for (const sub of main.subs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sub-chip' + (chosen === main.name + '／' + sub ? ' on' : '');
      b.textContent = sub;
      b.addEventListener('click', () => {
        setCategory(chosen === main.name + '／' + sub ? main.name : main.name + '／' + sub);
        showPicker(false);
      });
      subs.append(b);
    }
}
function keypad() {
  const box = $('manualKeypad');
  for (const key of ['7', '8', '9', '⌫', '4', '5', '6', '+', '1', '2', '3', '−', '00', '0', '.', '=']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = key;
    b.className = 'key' + (/[⌫+−=]/.test(key) ? ' op' : '');
    b.addEventListener('click', () => {
      const input = $('manualAmount');
      try {
        if (key === '⌫') input.value = input.value.slice(0, -1);
        else if (key === '=') input.value = evaluateAmount(input.value);
        else input.value += key === '−' ? '-' : key;
        $('manualStatus').textContent = '';
      } catch (error) {
        $('manualStatus').textContent = messages[error.message];
      }
    });
    box.append(b);
  }
}

function fill(values = {}) {
  editing = values.id ? values : null;
  gapId = values.gapId || '';
  setType(values.type || '支出');
  $('manualDate').value = values.date || today();
  $('manualTime').value = values.time || '';
  $('manualAmount').value = values.amountCents ? String(values.amountCents / 100) : values.amount || '';
  const method = resolveAccount(values.method || '現金', accountList);
  if (![...$('manualMethod').options].some(o => o.value === method))
    $('manualMethod').append(new Option(method, method));
  $('manualMethod').value = method;
  if (values.type === '轉帳') $('manualTo').value = resolveAccount(values.party, accountList);
  $('manualParty').value = values.party || '';
  setCategory(normalizeCategory(values.category, values.type || '支出'));
  showPicker(!$('manualCategory').value && (values.type || '支出') !== '轉帳');
  $('manualNote').value = values.note || '';
  $('manualSave').textContent = editing ? '儲存修改' : '儲存';
  $('manualCancel').hidden = !editing && !gapId;
  $('manualDelete').hidden = !editing;
  $('manualContext').textContent = editing
    ? '正在修改 ' + editing.date + ' 的紀錄。'
    : gapId
      ? '從 LINE 錢包餘額落差帶入。儲存後，這段落差會標記為「已手動補記」。'
      : '';
}
function controls() {
  for (const id of ['manualSave', 'manualCancel', 'manualDelete']) $(id).disabled = busy;
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
  const net = e => (e.type === '收入' ? e.amountCents : e.type === '轉帳' ? 0 : -e.amountCents);
  for (const g of groupByDay(entries.slice(0, shown), e => e.date, net)) {
    box.append(dayHeader(g.date, g.cents));
    for (const e of g.items) {
      const category = normalizeCategory(e.category, e.type);
      const transfer = e.type === '轉帳';
      box.append(
        row({
          category,
          icon: transfer ? '🔁' : undefined,
          title: transfer ? '轉帳 → ' + e.party : category.split('／').pop() || e.type,
          sub: [e.method, transfer ? '' : e.party, e.note].filter(Boolean).join('－'),
          cents: transfer ? null : net(e),
          amountText: transfer ? (e.amountCents / 100).toLocaleString('zh-TW') : undefined,
          side: e.time || '',
          dim: transfer,
          onClick: () => {
            if (busy) return;
            fill(e);
            $('manualStatus').textContent = '';
            $('manualForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        })
      );
    }
  }
  if (entries.length > shown) {
    const more = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'secondary more',
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

export function renderManual(list, names) {
  entries = list;
  if ($('manualMethod')) setAccountOptions(names);
  if ($('manualList')) draw();
}
export function initManual(api) {
  cloud = api;
  setAccountOptions(null);
  keypad();
  for (const b of document.querySelectorAll('.type-tab'))
    b.addEventListener('click', () => {
      setType(b.dataset.type);
      setCategory('');
    });
  fill();
  $('manualForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    if (busy) return;
    let entry;
    try {
      $('manualAmount').value = evaluateAmount($('manualAmount').value);
      const transfer = $('manualType').value === '轉帳';
      if (transfer) setCategory(transferCategory($('manualTo').value));
      if (!$('manualCategory').value) throw Error('MANUAL_CATEGORY');
      entry = manualEntry({
        id: editing?.id || crypto.randomUUID(),
        type: $('manualType').value,
        date: $('manualDate').value,
        time: $('manualTime').value,
        amount: $('manualAmount').value,
        method: $('manualMethod').value,
        party: transfer ? $('manualTo').value : $('manualParty').value,
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
  $('manualCategoryButton').addEventListener('click', () => showPicker($('manualCategoryPicker').hidden));
  const step = days => {
    const d = new Date(($('manualDate').value || today()) + 'T00:00:00');
    d.setDate(d.getDate() + days);
    $('manualDate').value =
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0');
  };
  $('manualPrevDay').addEventListener('click', () => step(-1));
  $('manualNextDay').addEventListener('click', () => step(1));
  $('manualDelete').addEventListener('click', async () => {
    if (busy || !editing) return;
    const e = editing;
    if (
      await save(
        [manualRow(e, { deleted: true })],
        [],
        '已刪除：' + (e.party || e.category || e.type) + ' ' + money(e.amountCents) + ' 元。'
      )
    )
      fill();
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
