import { recurringItem, recurringRow, nextDue, localToday } from '../cloud/recurring.mjs';
import { CATEGORY_TREE, iconOf } from '../cloud/categories.mjs';
import { transferCategory } from '../cloud/balances.mjs';
const $ = id => document.getElementById(id);
const money = c => (c / 100).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const messages = {
  RECURRING_NAME: '請填寫名稱，例如「房租」。',
  RECURRING_DAY: '每月幾號請填 1 到 31；31 號遇到小月會記在月底。',
  RECURRING_START: '請選擇開始月份。',
  RECURRING_END: '結束月份要在開始月份之後，或留空。',
  MANUAL_AMOUNT: '請填寫大於 0 的金額，最多到小數點後兩位。',
  MANUAL_METHOD: '請選擇付款方式。',
  MANUAL_TRANSFER: '轉帳要選不同的轉出與轉入帳戶。',
  GOOGLE_LOGIN_REQUIRED: '請先連接 Google。',
  SYNC_BUSY: '其他同步正在進行，請稍後重試。',
  SYNC_RETRY: '其他裝置正在同步，請稍後重試；填寫的內容保留。',
  SHEET_SCHEMA: '「固定收支」工作表欄位已更動，請保留系統欄名與順序。'
};
let cloud = null,
  items = null,
  editing = null,
  busy = false;

function categoryOptions(type) {
  const select = $('recurringCategory'),
    keep = select.value;
  const groups = type === '收入' ? CATEGORY_TREE.收入 : CATEGORY_TREE.支出;
  select.replaceChildren(
    ...groups.map(c => {
      const g = document.createElement('optgroup');
      g.label = c.icon + ' ' + c.name;
      g.append(
        new Option(c.name, c.name),
        ...c.subs.map(s => new Option(c.name + '／' + s, c.name + '／' + s))
      );
      return g;
    })
  );
  if ([...select.options].some(o => o.value === keep)) select.value = keep;
}
function setType(type) {
  $('recurringType').value = type;
  const transfer = type === '轉帳';
  $('recurringCategoryLabel').hidden = transfer;
  $('recurringToLabel').hidden = !transfer;
  $('recurringPartyLabel').hidden = transfer;
  $('recurringMethodLabel').firstChild.textContent = transfer ? '轉出帳戶' : '付款方式／帳戶';
  if (!transfer) categoryOptions(type);
}
function setAccounts(names) {
  const list = names?.length ? names : ['現金'];
  for (const id of ['recurringMethod', 'recurringTo']) {
    const select = $(id),
      keep = select.value;
    select.replaceChildren(...list.map(n => new Option(n, n)));
    if (list.includes(keep)) select.value = keep;
  }
}
function fill(item = null) {
  editing = item;
  setType(item?.type || '支出');
  $('recurringName').value = item?.name || '';
  $('recurringAmount').value = item ? String(item.amountCents / 100) : '';
  for (const [id, value] of [
    ['recurringMethod', item?.method],
    ['recurringTo', item?.type === '轉帳' ? item.party : '']
  ])
    if (value) {
      if (![...$(id).options].some(o => o.value === value)) $(id).append(new Option(value, value));
      $(id).value = value;
    }
  $('recurringParty').value = item && item.type !== '轉帳' ? item.party : '';
  if (item?.category && item.type !== '轉帳') {
    if (![...$('recurringCategory').options].some(o => o.value === item.category))
      $('recurringCategory').append(new Option(item.category, item.category));
    $('recurringCategory').value = item.category;
  }
  $('recurringDay').value = item ? String(item.day) : String(new Date().getDate());
  $('recurringStart').value = item?.start || localToday().slice(0, 7);
  $('recurringEnd').value = item?.end || '';
  $('recurringNote').value = item?.note || '';
  $('recurringSave').textContent = item ? '儲存修改' : '新增固定收支';
  $('recurringCancel').hidden = !item;
}
async function save(rows, done) {
  busy = true;
  draw();
  $('recurringStatus').textContent = '正在儲存…';
  try {
    await cloud.saveRecurring(rows);
    $('recurringStatus').textContent = done;
    return true;
  } catch (error) {
    $('recurringStatus').textContent = messages[error.message] || '尚未儲存，請稍後重試；填寫的內容保留。';
    return false;
  } finally {
    busy = false;
    draw();
  }
}
function el(tag, text, className) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (className) e.className = className;
  return e;
}
function draw() {
  $('recurringSave').disabled = busy;
  const box = $('recurringList');
  box.replaceChildren();
  if (!items) {
    box.append(el('p', '連接 Google 後會列出已設定的固定收支。', 'muted'));
    return;
  }
  if (!items.length) {
    box.append(el('p', '還沒有固定收支。', 'muted'));
    return;
  }
  const today = localToday();
  let out = 0,
    inc = 0;
  for (const it of items)
    if (it.type === '支出') out += it.amountCents;
    else if (it.type === '收入') inc += it.amountCents;
  box.append(el('p', '每月固定支出 ' + money(out) + ' 元，固定收入 ' + money(inc) + ' 元。', 'muted'));
  for (const it of items) {
    const card = el('article', null, 'invoice-card'),
      top = el('div', null, 'top'),
      actions = el('div', null, 'actions');
    const icon = it.type === '轉帳' ? '🔁' : iconOf(it.category);
    top.append(
      el('h3', icon + ' ' + it.name),
      el('span', (it.type === '收入' ? '+' : '') + money(it.amountCents) + ' 元', 'amount')
    );
    const next = nextDue(it, today);
    const meta = [
      '每月 ' + it.day + ' 號',
      it.type === '轉帳' ? it.method + ' → ' + it.party : it.method,
      it.type === '轉帳' ? '' : it.category,
      it.start + ' 起' + (it.end ? '，到 ' + it.end : ''),
      next ? '下次 ' + next : '已結束'
    ];
    const edit = el('button', '修改', 'secondary'),
      remove = el('button', '停用', 'secondary');
    edit.type = remove.type = 'button';
    edit.disabled = remove.disabled = busy;
    edit.addEventListener('click', () => {
      fill(it);
      $('recurringForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    remove.addEventListener('click', () => {
      if (!busy)
        void save([recurringRow(it, { deleted: true })], '已停用：' + it.name + '。已產生的記帳會保留。');
    });
    actions.append(edit, remove);
    card.append(top, el('p', meta.filter(Boolean).join(' · '), 'meta'), actions);
    box.append(card);
  }
}
export function renderRecurring(list, names, generated = []) {
  items = list;
  if (!$('recurringList')) return;
  setAccounts(names);
  $('recurringNotice').hidden = !generated.length;
  if (generated.length)
    $('recurringNotice').textContent =
      '已自動記下 ' +
      generated.length +
      ' 筆固定收支：' +
      generated
        .slice(0, 5)
        .map(e => e.date.slice(5) + ' ' + e.note.split('；')[0].replace('固定收支：', ''))
        .join('、') +
      (generated.length > 5 ? ' 等' : '') +
      '。';
  draw();
}
export function initRecurring(api) {
  cloud = api;
  setAccounts(null);
  $('recurringType').addEventListener('change', () => setType($('recurringType').value));
  fill();
  $('recurringForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    if (busy) return;
    let item;
    try {
      const type = $('recurringType').value,
        transfer = type === '轉帳';
      item = recurringItem({
        id: editing?.id || crypto.randomUUID().slice(0, 8),
        name: $('recurringName').value,
        type,
        amount: $('recurringAmount').value.trim(),
        method: $('recurringMethod').value,
        party: transfer ? $('recurringTo').value : $('recurringParty').value,
        category: transfer ? transferCategory($('recurringTo').value) : $('recurringCategory').value,
        day: $('recurringDay').value,
        start: $('recurringStart').value,
        end: $('recurringEnd').value,
        note: $('recurringNote').value
      });
    } catch (error) {
      $('recurringStatus').textContent = messages[error.message] || '請檢查填寫的內容。';
      return;
    }
    const was = editing;
    if (
      await save(
        [recurringRow(item)],
        (was ? '已修改：' : '已新增：') + item.name + ' ' + money(item.amountCents) + ' 元。'
      )
    )
      fill();
  });
  $('recurringCancel').addEventListener('click', () => {
    fill();
    $('recurringStatus').textContent = '';
  });
  window.addEventListener('finance-signout', () => {
    items = null;
    $('recurringNotice').textContent = '';
    $('recurringNotice').hidden = true;
    fill();
    draw();
  });
  draw();
}
