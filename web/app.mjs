// 現金記帳：記帳先存在這台裝置，連上 Google 後同步到你自己的「現金記帳」試算表。
import {
  makeEntry,
  inOrder,
  nextRank,
  placeInDay,
  ledger,
  cashNow,
  monthSummary,
  parseCents,
  makeOption,
  optionKey,
  channelList,
  channelGroups,
  searchWords,
  matchesSearch,
  transferAccounts,
  CHANNEL_GROUPS,
  categoryTree,
  CASH,
  DEFAULT_WALLETS,
  walletNames,
  makeWallet,
  balanceNow
} from '../cloud/cash.mjs';
import { CashLocal } from '../cloud/cash-local.mjs';
import { CashStore, SCOPE } from '../cloud/cash-store.mjs';
import { loadGis, requestToken } from '../cloud/auth.mjs';
import {
  rememberedAccount,
  rememberAccount,
  savedToken,
  saveToken,
  autoLogin,
  setAutoLogin
} from '../cloud/login-preferences.mjs';
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
  CASH_TOPUP: '儲值的來源和轉入不能是同一個錢包。',
  OPTION_CASH: '「現金」是內建的，不用新增。',
  CASH_RANK: '排序要填 1 以上的整數，或留空。',
  WALLET_CASH: '「現金」已經有自己的結餘，錢包請取別的名字。',
  OPTION_NAME: '請填寫名稱。',
  CASH_EXPRESSION: '金額算式看不懂，只支援數字與 + −。',
  GOOGLE_NETWORK: '連不上 Google，記帳已先存在這台裝置，有網路時再同步。',
  GOOGLE_PERMISSION: 'Google 沒有給予存取權限，請重新連接並允許存取。',
  GOOGLE_POPUP: 'Google 授權視窗沒有完成；若是 Safari，請允許彈出視窗後再試。',
  GOOGLE_NOT_READY: 'Google 元件還在載入，請再按一次。',
  GOOGLE_CONFIG: '網站尚未設定 Google 連接。',
  GOOGLE_LOGIN_REQUIRED: 'Google 授權已過期，按右上角重新連接即可同步。',
  GOOGLE_API: 'Google 試算表暫時無法寫入，記帳已先存在這台裝置。',
  SHEET_SCHEMA: '試算表「異動紀錄」的欄位被改動過，請還原第一列的欄名。',
  SHEET_ROWS: '試算表「記帳明細」有看不懂的列，這次沒有同步，試算表也沒有被改動。'
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
  // One card per wallet, each kept like cash. Tap one to see only its records.
  const wallets = local.wallets;
  const cards = $('walletCards');
  cards.replaceChildren();
  for (const name of walletNames(wallets)) {
    const w = wallets.get(name);
    const set = w && w.cents != null;
    const cents = set ? balanceNow(entries, w, name) : 0;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wallet-line';
    b.dataset.wallet = name;
    b.setAttribute('aria-pressed', String(filter === name));
    const label = document.createElement('span');
    label.textContent = '📱 ' + name;
    const amount = document.createElement('strong');
    amount.textContent = set ? signedYuan(cents) : '未設定';
    amount.classList.toggle('out', set && cents < 0);
    const anchor = document.createElement('small');
    anchor.textContent = set
      ? '從 ' + w.date.replaceAll('-', '/') + ' 00:00 的 ' + yuan(w.cents) + ' 起算'
      : '到設定填裡面現在的錢';
    b.append(label, amount, anchor);
    b.addEventListener('click', () => {
      if (!set) {
        location.hash = '#settings';
        return;
      }
      filter = filter === name ? '' : name;
      drawHome();
    });
    cards.append(b);
  }
  const used = new Set(
    entries
      .filter(e => !e.deleted && e.date.slice(0, 7) === month)
      .flatMap(e => (e.to ? [e.channel, e.to] : [e.channel]))
  );
  if (filter && !used.has(filter)) filter = '';
  const shown = channelList(local.options, wallets).filter(c => used.has(c));
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
  const gap = filter ? ' ' : '';
  $('monthExpense').previousElementSibling.textContent = when + gap + '支出';
  $('monthIncome').previousElementSibling.textContent = when + gap + '收入';
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
    if (m.topupCents) extra.push('儲值 ' + yuan(m.topupCents));
    if (extra.length) {
      const item = document.createElement('span');
      item.className = 'muted';
      item.textContent = extra.join('・');
      legend.append(item);
    }
    box.append(bar, legend);
  }
  // Searching looks through every month and channel; the month view and its filters step aside.
  const words = searchWords(query);
  const searching = words.length > 0;
  for (const id of ['monthStep', 'channelFilter', 'monthBreakdown']) $(id).hidden = searching;
  $('searchClear').hidden = !query;
  const all = ledger(entries, setting, wallets).filter(e =>
    searching
      ? matchesSearch(e, words)
      : e.date.slice(0, 7) === month && (!filter || e.channel === filter || e.to === filter)
  );
  const shownRows = searching ? all.slice(-SEARCH_LIMIT) : all;
  const rows = shownRows.reverse();
  const summary = $('searchSummary');
  summary.hidden = !searching;
  if (searching) {
    const out = all.filter(e => e.type === '支出').reduce((t, e) => t + e.amountCents, 0);
    const inn = all.filter(e => e.type === '收入').reduce((t, e) => t + e.amountCents, 0);
    summary.textContent = all.length
      ? '找到 ' +
        all.length +
        ' 筆' +
        (out ? '，支出 ' + yuan(out) : '') +
        (inn ? '，收入 ' + yuan(inn) : '') +
        (all.length > SEARCH_LIMIT ? '。只列出最近的 ' + SEARCH_LIMIT + ' 筆，多打幾個字可以縮小範圍' : '') +
        '。'
      : '';
  }
  const list = $('entryList');
  list.replaceChildren();
  $('listEmpty').hidden = rows.length > 0;
  $('listEmpty').textContent = searching
    ? '找不到符合「' + query.trim() + '」的記帳。'
    : '這個月還沒有現金記帳。按下方的 ＋ 記一筆。';
  const pending = new Set(local.state.pending);
  for (const g of groupByDay(
    rows,
    e => e.date,
    e => (e.type === '支出' || e.type === '收入' ? e.amountSigned : 0)
  )) {
    list.append(dayHeader(g.date, g.cents));
    for (const e of g.items) {
      const topup = e.type === '儲值';
      const transfer = e.type === '提款' || e.type === '存入' || topup;
      // The balance shown is the one this record moves: the wallet for a top-up or a wallet record, else cash.
      const balance = e.wallet
        ? e.walletCents != null && e.wallet + ' 餘 ' + signedYuan(e.walletCents)
        : e.balanceCents != null && '餘 ' + signedYuan(e.balanceCents);
      list.append(
        row({
          category: transfer ? '' : e.category,
          icon:
            e.type === '提款' ? '🏧' : e.type === '存入' ? '🏦' : topup ? '📲' : iconFor(e.category, e.type),
          tint: transfer ? '#8b8f96' : undefined,
          title: topup
            ? '儲值 ' + e.to
            : transfer
              ? e.type + (e.party ? '　' + e.party : '')
              : e.category.split('／').pop(),
          sub:
            [topup ? '從 ' + e.channel : '', transfer ? '' : e.party, e.note].filter(Boolean).join('－') ||
            (transfer ? '現金 ' + (e.type === '提款' ? '增加' : '減少') : ''),
          cents: topup ? null : e.amountSigned,
          amountText: topup ? yuan(e.amountCents) : undefined,
          side: (pending.has(e.id) ? '⏳ ' : '') + (balance || e.channel),
          dim: transfer,
          onClick: () => openEditor(e)
        })
      );
    }
  }
}

// ---------- Entry form ----------
// The search box text; when it has words, the home list shows matches from every month.
let query = '';
const SEARCH_LIMIT = 300;
let type = '支出',
  category = '',
  channel = CASH,
  to = DEFAULT_WALLETS[0],
  account = '', // the bank or other account of a 提款／存入, saved as 對象
  adding = null; // { kind, parent } while the add box is open
function drawChannels() {
  let list = channelList(local.options, local.wallets);
  // A top-up moves money from one channel into a wallet, so the source cannot be that wallet.
  if (type === '儲值') {
    const wallets = walletNames(local.wallets);
    if (!wallets.includes(to))
      to = local.state.lastTo && wallets.includes(local.state.lastTo) ? local.state.lastTo : wallets[0];
    chips(
      $('toRow'),
      wallets.map(w => [w, w]),
      to,
      value => {
        to = value;
        local.state.lastTo = value;
        local.save();
        drawChannels();
      }
    );
    list = list.filter(c => c !== to);
    if (channel === to) channel = CASH;
  }
  if (type === '提款' || type === '存入') {
    const accounts = transferAccounts(local.options, local.wallets);
    if (!account)
      account = accounts.includes(local.state.lastAccount) ? local.state.lastAccount : accounts[0] || '';
    // A record from before the list existed may name an account that is not in it.
    if (account && !accounts.includes(account)) accounts.push(account);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'chip add';
    add.textContent = '＋';
    add.setAttribute('aria-label', '新增銀行或帳戶');
    add.addEventListener('click', () => openAdder({ kind: '渠道', parent: '銀行', forAccount: true }));
    chips(
      $('accountRow'),
      accounts.map(a => [a, a]),
      account,
      value => {
        // Tap the chosen one again to leave the account blank.
        account = value === account ? '' : value;
        if (account) local.state.lastAccount = account;
        local.save();
        drawChannels();
      },
      add
    );
  }
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
  const topup = t === '儲值';
  const transfer = t === '提款' || t === '存入';
  $('categoryButton').hidden = transfer || topup;
  $('channelRow').hidden = transfer;
  $('channelLabel').hidden = $('toBox').hidden = !topup;
  closeAdder();
  $('accountBox').hidden = !transfer;
  $('partyField').hidden = transfer;
  $('accountLabel').textContent = t === '提款' ? '從哪個帳戶領出' : '存進哪個帳戶';
  $('typeHint').hidden = !transfer && !topup;
  $('typeHint').textContent =
    t === '提款'
      ? '從銀行領出現金：現金增加，但不算收入。'
      : t === '存入'
        ? '把現金存回銀行：現金減少，但不算支出。'
        : topup
          ? '從上面選的地方轉進錢包：錢包增加、來源減少，不算支出。'
          : '';
  if (transfer || topup) showPicker(false);
  drawChannels();
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
  $('optionGroup').hidden = what.kind !== '渠道';
  if (what.kind === '渠道') $('optionGroup').value = what.parent || '其他';
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
      ? channelList(local.options, local.wallets).includes(o.name)
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
  to = e?.to || local.state.lastTo || DEFAULT_WALLETS[0];
  account = e && (e.type === '提款' || e.type === '存入') ? e.party : '';
  drawChannels();
  setType(e?.type || '支出');
  setCategory(e?.category || '');
  showPicker(!e && type === '支出');
  $('amount').value = e ? String(e.amountCents / 100) : '';
  $('date').value = e?.date || today();
  $('rank').value = e?.position ? String(e.position) : '';
  drawRankHint();
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
// Under the 排序 box: how many records the chosen day has, so a number can be picked.
function drawRankHint() {
  const date = $('date').value || today();
  const day = inOrder(local.entries.filter(e => e.date === date && e.id !== editing?.id));
  $('rankHint').textContent = day.length
    ? '排序：這天另有 ' +
      day.length +
      ' 筆，填 1～' +
      (day.length + 1) +
      '。數字大的排在首頁上面；' +
      (editing ? '留空不變。' : '留空排在最上面（最新）。')
    : '';
}
function saveForm(ev) {
  ev.preventDefault();
  let entry, placed;
  try {
    $('amount').value = evaluateAmount($('amount').value);
    const now = new Date().toISOString();
    entry = makeEntry({
      id: editing?.id || crypto.randomUUID(),
      type,
      date: $('date').value,
      time: editing?.time || '',
      rank: editing?.rank,
      amount: $('amount').value,
      category,
      channel,
      to: type === '儲值' ? to : '',
      party: type === '提款' || type === '存入' ? account : $('party').value,
      note: $('note').value,
      createdAt: editing?.createdAt || now,
      updatedAt: now
    });
    // 排序: blank (or unchanged) keeps an edited record's place and puts a new one last on its day;
    // a number moves it there, renumbering that day.
    const rankText = $('rank').value.trim();
    const at = rankText === '' ? null : Number(rankText);
    if (at !== null && !(Number.isSafeInteger(at) && at > 0)) throw Error('CASH_RANK');
    const sameDay = editing && editing.date === entry.date;
    if (at !== null && !(sameDay && at === editing.position))
      placed = placeInDay(local.entries, entry, at, now);
    else if (!sameDay) entry = { ...entry, rank: nextRank(local.entries, entry.date, entry.id) };
  } catch (error) {
    $('formStatus').textContent = messages[error.message] || '請檢查填寫的內容。';
    if (error.message === 'CASH_CATEGORY') showPicker(true);
    return;
  }
  let saved = true;
  for (const x of placed || [entry]) saved = local.put(x) && saved;
  if (placed) entry = placed.find(x => x.id === entry.id);
  const label =
    (entry.to ? entry.channel + ' → ' + entry.to + ' ' : entry.channel === CASH ? '' : entry.channel + ' ') +
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
function setCash(text, statusId, account = CASH) {
  const cents = parseCents(String(text).replace(/,/g, ''));
  if (!Number.isSafeInteger(cents)) {
    $(statusId).textContent = '請填寫 0 以上的金額，最多到小數點後兩位。';
    return false;
  }
  if (account !== CASH) local.setWalletBalance(account, cents, today());
  else local.setSetting(cents, today());
  $(statusId).textContent =
    '已設定：' + today().replaceAll('-', '/') + ' 00:00 ' + account + ' ' + yuan(cents) + ' 元。';
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
let connecting = false,
  autoTried = false; // signing in on the first tap is tried once each time the app comes to the front
// auto: started by any tap after a past sign-in, not by a sign-in button. Its popup problems stay quiet,
// since the user did not ask; the sync chip still offers to connect.
async function connect({ chooser = false, auto = false } = {}) {
  if (syncing || connecting) return;
  connecting = true;
  try {
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
      saveToken(storage, token.access_token, Date.now() + Number(token.expires_in) * 1000);
      const user = await store.profile();
      remembered = user.emailAddress || '';
      rememberAccount(storage, remembered);
      setAutoLogin(storage, true);
      autoTried = false;
      await openAndSync();
    } catch (error) {
      lastError =
        auto && (error.message === 'GOOGLE_POPUP' || error.message === 'GOOGLE_PERMISSION')
          ? ''
          : messages[error.message] || 'Google 連接失敗。';
      if (error.message === 'GOOGLE_PERMISSION' || error.message === 'GOOGLE_API') {
        store.disconnect();
        saveToken(storage, '', 0);
      }
      drawStatus();
    }
  } finally {
    connecting = false;
  }
}
async function openAndSync() {
  await store.open(local.state.fileId);
  local.state.fileId = store.file.id;
  local.save();
  lastError = '';
  await sync();
  if (store.connected && !local.setting) askCash();
}
// Reopened within the hour a Google token lasts: carry on without a sign-in.
async function resume() {
  const t = savedToken(storage);
  if (!t) return false;
  store.authorize(t.token, (t.expires - Date.now()) / 1000);
  connecting = true;
  try {
    await openAndSync();
  } catch (error) {
    // An expired or revoked token: forget it; the next tap signs in again.
    if (!store.connected) saveToken(storage, '', 0);
    else lastError = messages[error.message] || 'Google 連接失敗。';
    drawStatus();
  } finally {
    connecting = false;
  }
  return true;
}
// After a past sign-in, the first tap anywhere signs in (a popup needs a tap). Buttons that sign in
// themselves are left alone.
function autoConnect(event) {
  if (store.connected || connecting || syncing || autoTried || !remembered || !autoLogin(storage)) return;
  if (!navigator.onLine) return;
  if (event.target.closest?.('#connectButton, #switchButton, #syncChip, #welcomeConnect')) return;
  autoTried = true;
  void connect({ auto: true });
}
function showNotice(text, kind) {
  const n = $('syncNotice');
  n.textContent = text;
  n.hidden = !text;
  n.dataset.kind = kind || '';
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
    const result = await store.sync(local.map, local.setting, local.options, local.wallets);
    local.synced({
      entries: result.entries,
      setting: result.setting,
      wallets: result.wallets,
      options: result.options,
      fileId: result.fileId
    });
    lastError = '';
    showNotice(result.fromSheet ? '已從試算表收回 ' + result.fromSheet + ' 筆新增或修改。' : '', 'ok');
  } catch (error) {
    lastError = messages[error.message] || '同步失敗，記帳已先存在這台裝置。';
    if (error.problems)
      showNotice(
        lastError +
          '請到試算表修正：' +
          error.problems
            .slice(0, 5)
            .map(p => '第 ' + p.row + ' 列：' + p.reason)
            .join('；') +
          (error.problems.length > 5 ? '…等 ' + error.problems.length + ' 列' : '') +
          '。改好後點右上角重新同步。',
        'bad'
      );
  } finally {
    syncing = false;
    if (!store.connected) saveToken(storage, '', 0);
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
  saveToken(storage, '', 0);
  setAutoLogin(storage, false);
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
function drawWallets() {
  const box = $('walletList');
  box.replaceChildren();
  const wallets = local.wallets;
  for (const name of walletNames(wallets)) {
    const w = wallets.get(name);
    const set = w && w.cents != null;
    const item = document.createElement('div');
    item.className = 'wallet-item';
    item.dataset.wallet = name;
    const head = document.createElement('h3');
    head.textContent = '📱 ' + name;
    const line = document.createElement('p');
    line.className = 'muted small';
    line.textContent = set
      ? w.date.replaceAll('-', '/') +
        ' 00:00 設定為 ' +
        yuan(w.cents) +
        ' 元；目前算出 ' +
        signedYuan(balanceNow(local.entries, w, name)) +
        ' 元。'
      : '還沒填起始餘額，填了才會算結餘。';
    const form = document.createElement('form');
    form.className = 'inline-form';
    const input = document.createElement('input');
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.placeholder = '裡面現在的錢（元）';
    input.setAttribute('aria-label', name + ' 裡現在的錢（元）');
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.textContent = '設定';
    form.append(input, ok);
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      if (setCash(input.value, 'walletStatus', name)) input.value = '';
    });
    item.append(head, line, form);
    if (!DEFAULT_WALLETS.includes(name)) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary danger small-btn';
      remove.textContent = '移除這個錢包';
      remove.addEventListener('click', () => {
        local.putWallet({ ...w, deleted: true, updatedAt: new Date().toISOString() });
        if (filter === name) filter = '';
        $('walletStatus').textContent =
          '已移除錢包「' + name + '」。已經記下的帳不受影響，只是不再算它的結餘。';
        refresh();
        drawChannels();
        queueSync();
      });
      item.append(remove);
    }
    box.append(item);
  }
}
function addWallet() {
  const name = $('walletName').value.trim();
  const text = $('walletStart').value.trim();
  const status = $('walletStatus');
  if (walletNames(local.wallets).includes(name.replace(/／/g, '/'))) {
    status.textContent = '已經有「' + name + '」這個錢包了。';
    return;
  }
  const cents = text ? parseCents(text.replace(/,/g, '')) : null;
  if (text && !Number.isSafeInteger(cents)) {
    status.textContent = '請填寫 0 以上的金額，最多到小數點後兩位。';
    return;
  }
  let w;
  try {
    w = makeWallet({ name, cents, date: cents == null ? '' : today() });
  } catch (error) {
    status.textContent = messages[error.message] || '請填寫錢包名稱。';
    return;
  }
  local.putWallet(w);
  $('walletName').value = $('walletStart').value = '';
  status.textContent =
    '已新增錢包「' +
    w.name +
    '」' +
    (w.cents == null ? '，記得填起始餘額。' : '：今天 00:00 ' + yuan(w.cents) + ' 元。');
  refresh();
  drawChannels();
  queueSync();
}
// Icons offered when changing a category's icon in settings; any emoji can still be typed.
const COMMON_ICONS = [
  '🐶',
  '🐱',
  '👶',
  '📚',
  '✏️',
  '💼',
  '🏋️',
  '⚽',
  '🎮',
  '🎵',
  '📷',
  '✈️',
  '🚗',
  '⛽',
  '☕',
  '🍺',
  '🍰',
  '🛒',
  '👕',
  '💇',
  '💡',
  '📱',
  '💻',
  '🏥',
  '🎓',
  '🙏',
  '🎁',
  '💰',
  '🏦',
  '📈',
  '🧾',
  '🔧',
  '🌱',
  '🐾',
  '🧸',
  '🏷️'
];
let editingIcon = ''; // optionKey of the category whose icon editor is open in settings
function iconEditor(o) {
  const box = document.createElement('div');
  box.className = 'icon-editor';
  const title = document.createElement('p');
  title.className = 'row-label';
  title.textContent = '「' + o.name + '」的圖案';
  const grid = document.createElement('div');
  grid.className = 'icon-grid';
  grid.setAttribute('role', 'radiogroup');
  grid.setAttribute('aria-label', o.name + '的圖案');
  const save = icon => {
    let next;
    try {
      next = makeOption({ ...o, icon, updatedAt: new Date().toISOString() });
    } catch {
      return;
    }
    local.putOption(next);
    editingIcon = '';
    $('optionStatus').textContent =
      '「' + o.name + '」的圖案改成 ' + (next.icon || '🏷️') + '。已經記下的帳也會跟著換。';
    queueSync();
    refresh();
    drawCategories();
  };
  for (const icon of COMMON_ICONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-choice';
    b.textContent = icon;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String((o.icon || '🏷️') === icon));
    b.setAttribute('aria-label', icon);
    b.addEventListener('click', () => save(icon));
    grid.append(b);
  }
  const form = document.createElement('form');
  form.className = 'inline-form';
  const input = document.createElement('input');
  input.maxLength = 4;
  input.autocomplete = 'off';
  input.placeholder = '或自己打一個表情符號';
  input.setAttribute('aria-label', '自己輸入圖案');
  const ok = document.createElement('button');
  ok.type = 'submit';
  ok.textContent = '套用';
  form.append(input, ok);
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    if (input.value.trim()) save(input.value);
  });
  const actions = document.createElement('div');
  actions.className = 'actions';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'secondary danger small-btn';
  remove.textContent = '移除這個分類';
  remove.addEventListener('click', () => removeOption(o));
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'secondary small-btn';
  close.textContent = '完成';
  close.addEventListener('click', () => {
    editingIcon = '';
    drawSettings();
  });
  actions.append(close, remove);
  box.append(title, grid, form, actions);
  return box;
}
function removeOption(o) {
  local.putOption({ ...o, deleted: true, updatedAt: new Date().toISOString() });
  if (editingIcon === optionKey(o)) editingIcon = '';
  $('optionStatus').textContent = '已移除「' + o.name + '」。已經記下的帳不受影響。';
  queueSync();
  refresh();
  drawChannels();
  drawCategories();
}
let editingChannel = ''; // name of the channel whose group editor is open in settings
function channelEditor(name, group) {
  const box = document.createElement('div');
  box.className = 'icon-editor';
  const title = document.createElement('p');
  title.className = 'row-label';
  title.textContent = '「' + name + '」放在哪一組';
  const row = document.createElement('div');
  row.className = 'chip-row wrap';
  const save = patch => {
    const key = optionKey({ kind: '渠道', name });
    const o = makeOption({
      kind: '渠道',
      name,
      parent: group,
      ...local.options.get(key),
      ...patch,
      updatedAt: new Date().toISOString()
    });
    local.putOption(o);
    editingChannel = '';
    $('optionStatus').textContent = o.deleted
      ? '已移除渠道「' + name + '」。已經記下的帳不受影響；之後想用，再新增一次同樣的名字就好。'
      : '已把「' + name + '」移到' + o.parent + '。';
    queueSync();
    refresh();
    drawChannels();
  };
  chips(
    row,
    CHANNEL_GROUPS.map(g => [g, g]),
    group,
    g => save({ parent: g, deleted: false })
  );
  const actions = document.createElement('div');
  actions.className = 'actions';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'secondary small-btn';
  close.textContent = '完成';
  close.addEventListener('click', () => {
    editingChannel = '';
    drawSettings();
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'secondary danger small-btn';
  remove.textContent = '移除這個渠道';
  remove.addEventListener('click', () => save({ parent: group, deleted: true }));
  actions.append(close, remove);
  box.append(title, row, actions);
  return box;
}
function drawChannelGroups() {
  const box = $('channelGroups');
  box.replaceChildren();
  for (const [group, names] of channelGroups(local.options, local.wallets)) {
    const h = document.createElement('h3');
    h.textContent = group;
    const wrap = document.createElement('div');
    wrap.className = 'chip-row wrap';
    let editor = null;
    for (const name of names) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = name;
      // 現金 is built in and wallets are managed in the 錢包 card, so only banks, cards and others are editable here.
      if (CHANNEL_GROUPS.includes(group)) {
        const open = editingChannel === name;
        b.textContent += ' ✎';
        b.setAttribute('aria-expanded', String(open));
        b.setAttribute('aria-label', '調整渠道「' + name + '」');
        b.addEventListener('click', () => {
          editingChannel = open ? '' : name;
          drawSettings();
        });
        if (open) editor = channelEditor(name, group);
      } else {
        b.disabled = true;
        b.classList.add('fixed');
      }
      wrap.append(b);
    }
    if (!names.length) {
      const none = document.createElement('span');
      none.className = 'small muted';
      none.textContent = '（沒有）';
      wrap.append(none);
    }
    box.append(h, wrap);
    if (editor) box.append(editor);
  }
}
function drawSettings() {
  drawWallets();
  drawChannelGroups();
  const box = $('ownOptions');
  box.replaceChildren();
  const live = [...local.options.values()].filter(o => !o.deleted);
  const groups = [
    ['支出分類', live.filter(o => o.kind === '支出分類')],
    ['收入分類', live.filter(o => o.kind === '收入分類')]
  ];
  for (const [title, list] of groups) {
    if (!list.length) continue;
    const h = document.createElement('h3');
    h.textContent = '自己新增的' + title;
    const wrap = document.createElement('div');
    wrap.className = 'chip-row wrap';
    let editor = null;
    for (const o of list.sort((a, b) => (a.parent + a.name).localeCompare(b.parent + b.name))) {
      const b = document.createElement('button');
      b.type = 'button';
      const label = (o.parent ? o.parent + '／' : '') + o.name;
      // A main category opens its icon editor (which can also remove it); channels and sub-categories are removed directly.
      if (o.kind !== '渠道' && !o.parent) {
        const open = editingIcon === optionKey(o);
        b.className = 'chip';
        b.textContent = (o.icon || '🏷️') + ' ' + label + ' ✎';
        b.setAttribute('aria-expanded', String(open));
        b.setAttribute('aria-label', '修改「' + label + '」的圖案');
        b.addEventListener('click', () => {
          editingIcon = open ? '' : optionKey(o);
          drawSettings();
        });
        if (open) editor = iconEditor(o);
      } else {
        b.className = 'chip removable';
        b.textContent = label + ' ✕';
        b.setAttribute('aria-label', '移除 ' + label);
        b.addEventListener('click', () => removeOption(o));
      }
      wrap.append(b);
    }
    box.append(h, wrap);
    if (editor) box.append(editor);
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
    const o = addOption(
      {
        kind: what.kind,
        parent: what.kind === '渠道' ? $('optionGroup').value : what.parent,
        name: $('optionName').value,
        icon: $('optionIcon').value
      },
      'formStatus'
    );
    if (!o) return;
    closeAdder();
    $('formStatus').textContent = '已新增「' + o.name + '」。';
    if (what.forAccount) {
      account = o.name;
      local.state.lastAccount = o.name;
      local.save();
      drawChannels();
    } else if (o.kind === '渠道') {
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
    const o = addOption(
      { kind: '渠道', name: $('channelName').value, parent: $('channelGroup').value },
      'optionStatus'
    );
    if (!o) return;
    $('channelName').value = '';
    $('optionStatus').textContent = '已把「' + o.name + '」加到' + o.parent + '。';
    drawChannels();
  });
  $('prevDay').addEventListener('click', () => {
    $('date').value = shiftDay($('date').value || today(), -1);
    drawRankHint();
  });
  $('date').addEventListener('change', drawRankHint);
  $('nextDay').addEventListener('click', () => {
    $('date').value = shiftDay($('date').value || today(), 1);
    drawRankHint();
  });
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
  $('search').addEventListener('input', () => {
    query = $('search').value;
    drawHome();
  });
  $('searchForm').addEventListener('submit', e => {
    e.preventDefault();
    $('search').blur(); // close the phone keyboard to see the results
  });
  $('searchClear').addEventListener('click', () => {
    $('search').value = query = '';
    drawHome();
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
  $('walletAddForm').addEventListener('submit', e => {
    e.preventDefault();
    addWallet();
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
    if (document.visibilityState !== 'visible') return;
    autoTried = false;
    if (local.pendingCount) queueSync();
  });
  document.addEventListener('click', autoConnect, true);
  // Reopened within the token's hour: sync straight away. Otherwise get Google's script ready, so the
  // first tap can open the sign-in popup at once.
  void resume().then(resumed => {
    if (!resumed && autoLogin(storage) && remembered) void loadGis().catch(() => {});
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
