// 現金記帳：記帳先存在這台裝置，連上 Google 後同步到你自己的「現金記帳」試算表。
import {
  makeEntry,
  ledger,
  cashNow,
  monthSummary,
  parseCents,
  makeOption,
  channelList,
  categoryTree,
  CASH
} from '../cloud/cash.mjs';
import { CashLocal } from '../cloud/cash-local.mjs';
import { CashStore, SCOPE } from '../cloud/cash-store.mjs';
import { loadGis, requestToken } from '../cloud/auth.mjs';
import { rememberedAccount, rememberAccount } from '../cloud/login-preferences.mjs';
import { CATEGORY_TREE, iconOf } from '../cloud/categories.mjs';
import { row, dayHeader, groupByDay, yuan, CATEGORY_COLORS } from './rows.mjs';
import { initPwa } from './pwa.mjs';

const $ = id => document.getElementById(id);
const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
const local = new CashLocal(storage);
const store = new CashStore();
let remembered = rememberedAccount(storage),
  syncing = false,
  syncAgain = false,
  syncTimer = 0,
  lastError = '',
  editing = null,
  month = '',
  filter = '',
  askedCash = false;

const messages = {
  CASH_DATE: '請選擇日期。',
  CASH_TIME: '時間格式不正確，可以留空。',
  CASH_AMOUNT: '請填寫大於 0 的金額，最多到小數點後兩位。',
  CASH_CATEGORY: '請選一個分類。',
  CASH_CHANNEL: '請選擇渠道。',
  OPTION_NAME: '請填寫名稱。',
  CASH_EXPRESSION: '金額算式看不懂，只支援數字與 + −。',
  GOOGLE_NETWORK: '連不上 Google，記帳已先存在這台裝置，有網路時再同步。',
  GOOGLE_PERMISSION: 'Google 沒有給予存取權限，請重新連接並允許存取。',
  GOOGLE_POPUP: 'Google 授權視窗沒有完成；若是 Safari，請允許彈出視窗後再試。',
  GOOGLE_NOT_READY: 'Google 元件還在載入，請再按一次。',
  GOOGLE_CONFIG: '網站尚未設定 Google 連接。',
  GOOGLE_LOGIN_REQUIRED: 'Google 授權已過期，按右上角重新連接即可同步。',
  GOOGLE_API: 'Google 試算表暫時無法寫入，記帳已先存在這台裝置。',
  SHEET_SCHEMA: '試算表「異動紀錄」的欄位被改動過，請還原第一列的欄名。'
};
const pad = n => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
};
const shiftDay = (date, days) => {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
};
const shiftMonth = (m, by) => {
  let y = +m.slice(0, 4),
    mm = +m.slice(5, 7) + by;
  while (mm < 1) ((mm += 12), y--);
  while (mm > 12) ((mm -= 12), y++);
  return y + '-' + pad(mm);
};
const signedYuan = c => (c < 0 ? '−' : '') + yuan(Math.abs(c));
const treeOf = t =>
  categoryTree(
    t === '收入' ? CATEGORY_TREE.收入 : CATEGORY_TREE.支出,
    local.options,
    t === '收入' ? '收入' : '支出'
  );
// Your own main categories carry their own icon.
function iconFor(category, t = '支出') {
  const main = String(category || '').split('／')[0];
  const own =
    treeOf(t).find(c => c.name === main && c.own) ||
    treeOf(t === '收入' ? '支出' : '收入').find(c => c.name === main && c.own);
  return own ? own.icon : iconOf(category);
}
function chips(box, values, current, onPick, extra) {
  box.replaceChildren();
  for (const [value, label] of values) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(value === current));
    b.textContent = label;
    b.addEventListener('click', () => onPick(value));
    box.append(b);
  }
  if (extra) box.append(extra);
}

// ---------- Home ----------
function drawHome() {
  const setting = local.setting,
    entries = local.entries;
  const cash = cashNow(entries, setting);
  $('cashNow').textContent = signedYuan(cash);
  $('cashNow').classList.toggle('out', cash < 0);
  $('cashAnchor').textContent = setting
    ? '從 ' + setting.date.replaceAll('-', '/') + ' 00:00 的 ' + yuan(setting.cents) + ' 起算'
    : '還沒設定起始現金';
  $('welcome').hidden = !!setting || store.connected || entries.length > 0;
  const used = new Set(entries.filter(e => !e.deleted && e.date.slice(0, 7) === month).map(e => e.channel));
  if (filter && !used.has(filter)) filter = '';
  const shown = channelList(local.options).filter(c => used.has(c));
  for (const c of used) if (!shown.includes(c)) shown.push(c);
  $('channelFilter').hidden = shown.length < 2 && !(shown.length === 1 && shown[0] !== CASH);
  chips($('channelFilter'), [['', '全部'], ...shown.map(c => [c, c])], filter, value => {
    filter = value;
    drawHome();
  });
  const m = monthSummary(entries, month, filter);
  $('monthLabel').textContent = month.slice(0, 4) + ' 年 ' + +month.slice(5) + ' 月';
  const thisMonth = month === today().slice(0, 7);
  $('monthExpense').textContent = yuan(m.expenseCents);
  $('monthIncome').textContent = yuan(m.incomeCents);
  const when = (thisMonth ? '本月' : +month.slice(5) + ' 月') + (filter ? ' ' + filter : '');
  $('monthExpense').previousElementSibling.textContent = when + '支出';
  $('monthIncome').previousElementSibling.textContent = when + '收入';
  // Spending by category as one thin stacked bar with labels underneath.
  const box = $('monthBreakdown');
  box.replaceChildren();
  if (m.byCategory.length) {
    const bar = document.createElement('div');
    bar.className = 'stack';
    const legend = document.createElement('div');
    legend.className = 'stack-legend';
    for (const c of m.byCategory) {
      const seg = document.createElement('span');
      seg.style.width = ((100 * c.cents) / m.expenseCents).toFixed(2) + '%';
      seg.style.background = CATEGORY_COLORS[c.name] || '#8b8f96';
      seg.title = c.name + ' ' + yuan(c.cents);
      bar.append(seg);
      const item = document.createElement('span');
      const dot = document.createElement('i');
      dot.style.background = seg.style.background;
      item.append(dot, iconFor(c.name) + ' ' + c.name + ' ' + yuan(c.cents));
      legend.append(item);
    }
    const extra = [];
    if (m.withdrawCents) extra.push('提款 ' + yuan(m.withdrawCents));
    if (m.depositCents) extra.push('存入 ' + yuan(m.depositCents));
    if (extra.length) {
      const item = document.createElement('span');
      item.className = 'muted';
      item.textContent = extra.join('・');
      legend.append(item);
    }
    box.append(bar, legend);
  }
  const rows = ledger(entries, setting)
    .filter(e => e.date.slice(0, 7) === month && (!filter || e.channel === filter))
    .reverse();
  const list = $('entryList');
  list.replaceChildren();
  $('listEmpty').hidden = rows.length > 0;
  const pending = new Set(local.state.pending);
  for (const g of groupByDay(
    rows,
    e => e.date,
    e => (e.type === '支出' || e.type === '收入' ? e.amountSigned : 0)
  )) {
    list.append(dayHeader(g.date, g.cents));
    for (const e of g.items) {
      const transfer = e.type === '提款' || e.type === '存入';
      const cash = e.channel === CASH;
      list.append(
        row({
          category: transfer ? '' : e.category,
          icon: e.type === '提款' ? '🏧' : e.type === '存入' ? '🏦' : iconFor(e.category, e.type),
          tint: transfer ? '#8b8f96' : undefined,
          title: transfer ? e.type + (e.party ? '　' + e.party : '') : e.category.split('／').pop(),
          sub:
            [transfer ? '' : e.party, e.note].filter(Boolean).join('－') ||
            (transfer ? '現金 ' + (e.type === '提款' ? '增加' : '減少') : ''),
          cents: e.amountSigned,
          side: (pending.has(e.id) ? '⏳ ' : '') + (cash ? '餘 ' + signedYuan(e.balanceCents) : e.channel),
          dim: transfer,
          onClick: () => openEditor(e)
        })
      );
    }
  }
}

// ---------- Entry form ----------
let type = '支出',
  category = '',
  channel = CASH,
  adding = null; // { kind, parent } while the add box is open
function drawChannels() {
  const list = channelList(local.options);
  if (!list.includes(channel)) list.push(channel);
  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'chip add';
  plus.textContent = '＋';
  plus.setAttribute('aria-label', '新增渠道');
  plus.addEventListener('click', () => openAdder({ kind: '渠道', parent: '' }));
  chips(
    $('channelRow'),
    list.map(c => [c, c]),
    channel,
    value => {
      channel = value;
      local.state.lastChannel = value;
      local.save();
      drawChannels();
    },
    plus
  );
}
function setType(t) {
  type = t;
  for (const b of document.querySelectorAll('.type-tab'))
    b.setAttribute('aria-selected', String(b.dataset.type === t));
  const transfer = t === '提款' || t === '存入';
  $('categoryButton').hidden = transfer;
  $('channelRow').hidden = transfer;
  closeAdder();
  $('partyLabel').textContent = transfer ? '銀行／帳戶' : '對象／商店';
  $('typeHint').hidden = !transfer;
  $('typeHint').textContent =
    t === '提款'
      ? '從銀行領出現金：現金增加，但不算收入。'
      : t === '存入'
        ? '把現金存回銀行：現金減少，但不算支出。'
        : '';
  if (transfer) showPicker(false);
  drawCategories();
}
function setCategory(c) {
  category = c || '';
  $('categoryIcon').textContent = category ? iconFor(category, type) : '＋';
  $('categoryName').textContent = category ? category.replace('／', ' · ') : '選分類';
  drawCategories();
}
function showPicker(open) {
  $('categoryPicker').hidden = !open;
  $('categoryButton').setAttribute('aria-expanded', String(open));
}
function drawCategories() {
  const groups = treeOf(type);
  const grid = $('categoryGrid'),
    subs = $('subGrid');
  grid.replaceChildren();
  subs.replaceChildren();
  const main = category.split('／')[0];
  for (const c of groups) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'category-tile' + (main === c.name ? ' on' : '');
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = c.icon;
    b.append(icon, c.name);
    b.addEventListener('click', () => setCategory(c.name));
    grid.append(b);
  }
  const addMain = document.createElement('button');
  addMain.type = 'button';
  addMain.className = 'category-tile add';
  const plus = document.createElement('span');
  plus.className = 'icon';
  plus.textContent = '＋';
  addMain.append(plus, '新增');
  addMain.addEventListener('click', () => openAdder({ kind: type + '分類', parent: '' }));
  grid.append(addMain);
  const group = groups.find(c => c.name === main);
  if (group)
    for (const sub of group.subs) {
      const b = document.createElement('button');
      b.type = 'button';
      const full = group.name + '／' + sub;
      b.className = 'sub-chip' + (category === full ? ' on' : '');
      b.textContent = sub;
      b.addEventListener('click', () => {
        setCategory(category === full ? group.name : full);
        showPicker(false);
      });
      subs.append(b);
    }
  if (group) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sub-chip add';
    b.textContent = '＋ 子分類';
    b.addEventListener('click', () => openAdder({ kind: type + '分類', parent: group.name }));
    subs.append(b);
  }
}
// One small box for adding a channel, a main category or a sub-category.
function openAdder(what) {
  adding = what;
  $('optionAdder').hidden = false;
  $('optionIcon').hidden = !(what.kind !== '渠道' && !what.parent);
  $('optionAdderLabel').textContent =
    what.kind === '渠道'
      ? '新增渠道'
      : what.parent
        ? '新增「' + what.parent + '」的子分類'
        : '新增' + what.kind;
  $('optionName').value = '';
  $('optionIcon').value = '';
  $('optionName').focus();
}
function closeAdder() {
  adding = null;
  $('optionAdder').hidden = true;
}
function addOption(input, statusId) {
  let o;
  try {
    o = makeOption(input);
  } catch (error) {
    $(statusId).textContent = messages[error.message] || '名稱不正確。';
    return null;
  }
  const exists =
    o.kind === '渠道'
      ? channelList(local.options).includes(o.name)
      : o.parent
        ? treeOf(type)
            .find(c => c.name === o.parent)
            ?.subs.includes(o.name)
        : treeOf(o.kind.slice(0, 2)).some(c => c.name === o.name);
  if (exists) {
    $(statusId).textContent = '「' + o.name + '」已經有了。';
    return null;
  }
  local.putOption(o);
  queueSync();
  drawSettings();
  return o;
}
export function evaluateAmount(text) {
  const t = String(text).replace(/\s+/g, '').replace(/[−－]/g, '-').replace(/＋/g, '+').replace(/,/g, '');
  if (!t) return '';
  if (!/^\d+(\.\d{1,2})?([+-]\d+(\.\d{1,2})?)*$/.test(t)) throw Error('CASH_EXPRESSION');
  let cents = 0;
  for (const part of t.match(/[+-]?\d+(\.\d{1,2})?/g))
    cents += (part.startsWith('-') ? -1 : 1) * parseCents(part.replace(/^[+-]/, ''));
  return (cents / 100)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}
function keypad() {
  const box = $('keypad');
  for (const key of ['7', '8', '9', '⌫', '4', '5', '6', '+', '1', '2', '3', '−', '00', '0', '.', '=']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = key;
    b.className = 'key' + (/[⌫+−=]/.test(key) ? ' op' : '');
    b.addEventListener('click', () => {
      const input = $('amount');
      try {
        if (key === '⌫') input.value = input.value.slice(0, -1);
        else if (key === '=') input.value = evaluateAmount(input.value);
        else input.value += key === '−' ? '-' : key;
        $('formStatus').textContent = '';
      } catch (error) {
        $('formStatus').textContent = messages[error.message];
      }
    });
    box.append(b);
  }
}
function fillForm(e = null) {
  editing = e;
  channel = e?.channel || local.state.lastChannel || CASH;
  drawChannels();
  setType(e?.type || '支出');
  setCategory(e?.category || '');
  showPicker(!e && type === '支出');
  $('amount').value = e ? String(e.amountCents / 100) : '';
  $('date').value = e?.date || today();
  $('time').value = e?.time || '';
  $('party').value = e?.party || '';
  $('note').value = e?.note || '';
  $('saveEntry').textContent = e ? '儲存修改' : '儲存';
  $('deleteEntry').hidden = $('cancelEdit').hidden = !e;
  $('formContext').hidden = !e;
  $('formContext').textContent = e ? '正在修改 ' + e.date.replaceAll('-', '/') + ' 的記帳。' : '';
}
function openEditor(e) {
  fillForm(e);
  $('formStatus').textContent = '';
  location.hash = '#add';
}
function saveForm(ev) {
  ev.preventDefault();
  let entry;
  try {
    $('amount').value = evaluateAmount($('amount').value);
    const now = new Date().toISOString();
    entry = makeEntry({
      id: editing?.id || crypto.randomUUID(),
      type,
      date: $('date').value,
      time: $('time').value,
      amount: $('amount').value,
      category,
      channel,
      party: $('party').value,
      note: $('note').value,
      createdAt: editing?.createdAt || now,
      updatedAt: now
    });
  } catch (error) {
    $('formStatus').textContent = messages[error.message] || '請檢查填寫的內容。';
    if (error.message === 'CASH_CATEGORY') showPicker(true);
    return;
  }
  const saved = local.put(entry);
  const label =
    (entry.channel === CASH ? '' : entry.channel + ' ') +
    (entry.category.split('／').pop() || entry.type) +
    ' ' +
    yuan(entry.amountCents);
  const was = editing;
  fillForm();
  month = entry.date.slice(0, 7);
  $('formStatus').textContent = saved
    ? (was ? '已修改：' : '已記下：') + label + (store.connected ? '，正在同步…' : '。')
    : '這台裝置無法儲存（可能是私密瀏覽），請連接 Google 後再記。';
  refresh();
  queueSync();
  if (was) location.hash = '#home';
}

// ---------- Cash setting ----------
function setCash(text, statusId) {
  const cents = parseCents(text);
  if (!Number.isSafeInteger(cents)) {
    $(statusId).textContent = '請填寫 0 以上的金額，最多到小數點後兩位。';
    return false;
  }
  local.setSetting(cents, today());
  $(statusId).textContent =
    '已設定：' + today().replaceAll('-', '/') + ' 00:00 現金 ' + yuan(cents) + ' 元。';
  refresh();
  queueSync();
  return true;
}
function askCash() {
  const dialog = $('cashDialog');
  if (askedCash || local.setting || dialog.open) return;
  askedCash = true;
  $('cashDialogDate').textContent = today().replaceAll('-', '/') + ' 00:00';
  $('cashDialogAmount').value = '';
  $('cashDialogStatus').textContent = '';
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

// ---------- Google ----------
function syncLabel() {
  const n = local.pendingCount;
  if (syncing) return '同步中…';
  if (!store.connected)
    return n ? n + ' 筆待同步' : remembered || local.state.lastSync ? '點此連接' : '未連接';
  if (lastError) return '同步失敗';
  return n ? n + ' 筆待同步' : '已同步';
}
function drawStatus() {
  $('syncChip').textContent = syncLabel();
  $('syncChip').dataset.state = syncing
    ? 'busy'
    : !store.connected
      ? 'off'
      : lastError || local.pendingCount
        ? 'warn'
        : 'ok';
  $('connectButton').textContent = store.connected
    ? '登出'
    : remembered
      ? '以 ' + remembered + ' 連接'
      : '連接 Google';
  $('syncButton').hidden = !store.connected;
  $('switchButton').hidden = !store.connected && !remembered;
  $('accountLine').textContent = store.connected
    ? '已連接：' + (store.user?.emailAddress || '')
    : '尚未連接。記帳會先存在這台裝置。';
  const last = local.state.lastSync;
  $('syncLine').textContent =
    (last ? '上次同步：' + new Date(last).toLocaleString('zh-TW', { hour12: false }) : '還沒同步過') +
    (local.pendingCount ? '；' + local.pendingCount + ' 筆待同步' : '') +
    (lastError ? '。' + lastError : '');
  const link = local.state.fileId
    ? 'https://docs.google.com/spreadsheets/d/' + local.state.fileId + '/edit'
    : '';
  $('sheetLink').hidden = !link;
  if (link) $('sheetLink').href = link;
  const s = local.setting;
  $('settingLine').textContent = s
    ? s.date.replaceAll('-', '/') +
      ' 00:00 設定為 ' +
      yuan(s.cents) +
      ' 元；目前算出 ' +
      signedYuan(cashNow(local.entries, s)) +
      ' 元。'
    : '還沒設定。';
}
async function connect({ chooser = false } = {}) {
  if (syncing) return;
  try {
    await loadGis();
  } catch {
    lastError = messages.GOOGLE_NETWORK;
    drawStatus();
    return;
  }
  try {
    const token = await requestToken({ scope: SCOPE, hint: remembered, chooser });
    store.authorize(token.access_token, token.expires_in);
    const user = await store.profile();
    remembered = user.emailAddress || '';
    rememberAccount(storage, remembered);
    await store.open(local.state.fileId);
    local.state.fileId = store.file.id;
    local.save();
    lastError = '';
    await sync();
    if (store.connected && !local.setting) askCash();
  } catch (error) {
    lastError = messages[error.message] || 'Google 連接失敗。';
    if (error.message === 'GOOGLE_PERMISSION' || error.message === 'GOOGLE_API') store.disconnect();
    drawStatus();
  }
}
async function sync() {
  if (!store.connected || !store.file) return;
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  drawStatus();
  try {
    const result = await store.sync(local.map, local.setting, local.options);
    local.synced({
      entries: result.entries,
      setting: result.setting,
      options: result.options,
      fileId: result.fileId
    });
    lastError = '';
  } catch (error) {
    lastError = messages[error.message] || '同步失敗，記帳已先存在這台裝置。';
  } finally {
    syncing = false;
    refresh();
  }
  if (syncAgain) {
    syncAgain = false;
    await sync();
  }
}
function queueSync() {
  clearTimeout(syncTimer);
  if (store.connected) syncTimer = setTimeout(sync, 800);
}
function logout() {
  store.disconnect();
  lastError = '';
  refresh();
}

// ---------- Routing ----------
function route() {
  const name = (location.hash || '#home').slice(1);
  const known = ['home', 'add', 'settings'].includes(name) ? name : 'home';
  for (const v of document.querySelectorAll('[data-route]')) v.hidden = v.dataset.route !== known;
  for (const a of document.querySelectorAll('[data-nav]'))
    if (a.dataset.nav === known) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  if (known === 'add' && !editing) $('date').value ||= today();
  if (known !== 'add' && editing) fillForm();
  if (known === 'settings') void loadGis().catch(() => {});
  window.scrollTo(0, 0);
}
// Your own channels and categories, each with a ✕ to remove it.
function drawSettings() {
  const box = $('ownOptions');
  box.replaceChildren();
  const live = [...local.options.values()].filter(o => !o.deleted);
  const groups = [
    ['渠道', live.filter(o => o.kind === '渠道')],
    ['支出分類', live.filter(o => o.kind === '支出分類')],
    ['收入分類', live.filter(o => o.kind === '收入分類')]
  ];
  for (const [title, list] of groups) {
    if (!list.length) continue;
    const h = document.createElement('h3');
    h.textContent = '自己新增的' + title;
    const wrap = document.createElement('div');
    wrap.className = 'chip-row wrap';
    for (const o of list.sort((a, b) => (a.parent + a.name).localeCompare(b.parent + b.name))) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip removable';
      b.textContent = (o.icon ? o.icon + ' ' : '') + (o.parent ? o.parent + '／' : '') + o.name + ' ✕';
      b.setAttribute('aria-label', '移除 ' + (o.parent ? o.parent + '／' : '') + o.name);
      b.addEventListener('click', () => {
        local.putOption({ ...o, deleted: true, updatedAt: new Date().toISOString() });
        $('optionStatus').textContent = '已移除「' + o.name + '」。已經記下的帳不受影響。';
        queueSync();
        refresh();
        drawChannels();
        drawCategories();
      });
      wrap.append(b);
    }
    box.append(h, wrap);
  }
}
function refresh() {
  drawHome();
  drawStatus();
  drawSettings();
}

// ---------- Start ----------
function init() {
  month = today().slice(0, 7);
  keypad();
  for (const b of document.querySelectorAll('.type-tab'))
    b.addEventListener('click', () => {
      setType(b.dataset.type);
      setCategory('');
      showPicker(b.dataset.type === '支出' || b.dataset.type === '收入');
    });
  $('categoryButton').addEventListener('click', () => showPicker($('categoryPicker').hidden));
  $('optionCancel').addEventListener('click', closeAdder);
  const submitAdder = () => {
    if (!adding) return;
    const what = adding;
    const o = addOption({ ...what, name: $('optionName').value, icon: $('optionIcon').value }, 'formStatus');
    if (!o) return;
    closeAdder();
    $('formStatus').textContent = '已新增「' + o.name + '」。';
    if (o.kind === '渠道') {
      channel = o.name;
      local.state.lastChannel = o.name;
      local.save();
      drawChannels();
    } else if (o.parent) {
      setCategory(o.parent + '／' + o.name);
      showPicker(false);
    } else {
      setCategory(o.name);
      showPicker(true);
    }
  };
  $('optionAdd').addEventListener('click', submitAdder);
  $('optionName').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitAdder();
    }
  });
  $('channelForm').addEventListener('submit', e => {
    e.preventDefault();
    const o = addOption({ kind: '渠道', name: $('channelName').value }, 'optionStatus');
    if (!o) return;
    $('channelName').value = '';
    $('optionStatus').textContent = '已新增渠道「' + o.name + '」。';
    drawChannels();
  });
  $('prevDay').addEventListener('click', () => ($('date').value = shiftDay($('date').value || today(), -1)));
  $('nextDay').addEventListener('click', () => ($('date').value = shiftDay($('date').value || today(), 1)));
  $('entryForm').addEventListener('submit', saveForm);
  $('cancelEdit').addEventListener('click', () => {
    fillForm();
    location.hash = '#home';
  });
  $('deleteEntry').addEventListener('click', () => {
    if (!editing) return;
    const e = editing;
    local.remove(e);
    fillForm();
    $('formStatus').textContent =
      '已刪除：' + (e.category.split('／').pop() || e.type) + ' ' + yuan(e.amountCents) + '。';
    refresh();
    queueSync();
    location.hash = '#home';
  });
  $('prevMonth').addEventListener('click', () => {
    month = shiftMonth(month, -1);
    drawHome();
  });
  $('nextMonth').addEventListener('click', () => {
    month = shiftMonth(month, 1);
    drawHome();
  });
  $('syncChip').addEventListener('click', () => (store.connected ? sync() : connect()));
  $('connectButton').addEventListener('click', () => (store.connected ? logout() : connect()));
  $('switchButton').addEventListener('click', () => {
    logout();
    void connect({ chooser: true });
  });
  $('syncButton').addEventListener('click', () => sync());
  $('welcomeConnect').addEventListener('click', () => connect());
  $('welcomeLocal').addEventListener('click', () => {
    askedCash = false;
    askCash();
  });
  $('settingForm').addEventListener('submit', e => {
    e.preventDefault();
    if (setCash($('settingAmount').value, 'settingStatus')) $('settingAmount').value = '';
  });
  $('cashDialogForm').addEventListener('submit', e => {
    e.preventDefault();
    if (setCash($('cashDialogAmount').value, 'cashDialogStatus')) $('cashDialog').close?.();
  });
  $('cashDialogLater').addEventListener('click', () => $('cashDialog').close?.());
  let confirmClear = false;
  $('clearLocal').addEventListener('click', () => {
    if (!confirmClear) {
      confirmClear = true;
      $('localStatus').textContent =
        (local.pendingCount
          ? '還有 ' + local.pendingCount + ' 筆沒同步，清除後會遺失。'
          : '試算表裡的資料不受影響。') + '確定要清除請再按一次。';
      return;
    }
    confirmClear = false;
    local.clear();
    $('localStatus').textContent = '已清除這台裝置的記帳。';
    refresh();
  });
  // Coming back to the app: sync whatever was recorded while away.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && local.pendingCount) queueSync();
  });
  window.addEventListener('online', queueSync);
  window.addEventListener('hashchange', route);
  fillForm();
  route();
  refresh();
  if (!local.ok) $('localStatus').textContent = '這個瀏覽器不允許儲存資料，記帳要連上 Google 才保得住。';
  void initPwa();
}
init();
