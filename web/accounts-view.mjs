import { settingsRow, CASH } from '../cloud/balances.mjs';
import { moneyCents } from '../pdf-parser/parser.mjs';
import { row } from './rows.mjs';
const $ = id => document.getElementById(id);
const yuan = c => (c / 100).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const ICONS = { 銀行: '🏦', 信用卡: '💳', 電子支付: '📱', 現金: '💵', 其他: '👛' };
const TINTS = { 銀行: '#2a78d6', 信用卡: '#e34948', 電子支付: '#1baf7a', 現金: '#008300', 其他: '#8b8f96' };
let cloud = null,
  data = null,
  busy = false,
  askedCash = false; // 「稍後再說」只在這次開啟頁面有效，下次連接仍會再問。
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
function el(tag, text, className) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (className) e.className = className;
  return e;
}
function setupForm(account) {
  const form = el('form', null, 'account-setup' + (account.name === CASH ? ' cash' : ''));
  const amount = el('input');
  amount.inputMode = 'decimal';
  amount.placeholder = '目前金額';
  amount.setAttribute('aria-label', account.name + ' 目前金額');
  const cash = account.name === CASH;
  const date = el('input');
  date.type = 'date';
  date.value = today();
  date.setAttribute('aria-label', '以哪一天 00:00 為準');
  const save = el('button', '設定');
  save.type = 'submit';
  if (cash) form.append(amount, save);
  else form.append(amount, date, save);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    const cents = moneyCents(amount.value.trim());
    if (cash) date.value = today();
    if (!Number.isSafeInteger(cents) || cents < 0 || !date.value) {
      $('accountsStatus').textContent = '請填寫目前金額與日期。';
      return;
    }
    busy = true;
    save.disabled = true;
    $('accountsStatus').textContent = '正在儲存…';
    try {
      await cloud.saveAccountSetting(settingsRow(account.name, cents, date.value, '手動設定'));
      $('accountsStatus').textContent =
        '已設定 ' + account.name + ' 在 ' + date.value + ' 00:00 為 ' + yuan(cents) + ' 元。';
    } catch {
      $('accountsStatus').textContent = '尚未儲存，請確認已連接 Google 後重試。';
    } finally {
      busy = false;
      save.disabled = false;
    }
  });
  return form;
}
// The big number on top, with assets and liabilities beside it.
export function heroBlock(label, cents, sides) {
  const hero = el('div', null, 'hero-number');
  const left = el('div');
  left.append(el('small', label), el('strong', (cents < 0 ? '−' : '') + yuan(Math.abs(cents))));
  const right = el('div', null, 'hero-sides');
  for (const [name, value, cls] of sides) {
    const d = el('div');
    d.append(el('small', name), el('span', yuan(value), cls));
    right.append(d);
  }
  hero.append(left, right);
  return hero;
}
function draw() {
  const box = $('accountsBody');
  box.replaceChildren();
  $('accountsEmpty').hidden = !!data;
  if (!data) return;
  box.append(
    heroBlock('資產減信用卡 TWD', data.assetsCents - data.liabilitiesCents, [
      ['資產', data.assetsCents, 'in'],
      ['信用卡', data.liabilitiesCents, 'out']
    ])
  );
  for (const type of ['現金', '銀行', '電子支付', '信用卡', '其他']) {
    const list = data.accounts.filter(a => a.type === type);
    if (!list.length) continue;
    const group = el('section', null, 'group-card');
    const head = el('div', null, 'group-head'),
      total = list.reduce((s, a) => s + a.cents, 0);
    head.append(
      el('span', type),
      el('span', (total < 0 ? '−' : '') + yuan(Math.abs(total)), total < 0 ? 'out' : 'in')
    );
    group.append(head);
    for (const a of list) {
      const settable = a.type === '現金' || a.type === '其他';
      const r = row({
        icon: ICONS[type],
        tint: TINTS[type],
        title: a.name,
        sub: a.note,
        amountText: (a.cents < 0 ? '−' : '') + yuan(Math.abs(a.cents)),
        side: settable ? (a.partial ? '點這裡設定' : '點這裡重設') : '',
        onClick: settable ? () => (form.hidden = !form.hidden) : undefined
      });
      if (a.partial) r.querySelector('.row-sub')?.classList.add('bad');
      group.append(r);
      let form = null;
      if (settable) {
        form = el('div', null, 'row-extra');
        form.hidden = !a.partial || a.type !== '現金';
        form.append(
          el(
            'p',
            a.name === CASH
              ? '數一下錢包填在這裡，記成今天 00:00 的金額；之前的現金從這個時間點往回推。之後的提款自動加入，花掉的用記一筆記下。'
              : '填這個帳戶在某一天 00:00 的餘額，當天起的手動記帳會從這裡加減。',
            'muted'
          ),
          setupForm(a)
        );
        group.append(form);
      }
    }
    box.append(group);
  }
}
export function renderAccounts(balances) {
  data = balances || null;
  if ($('accountsBody')) draw();
}
// 第一次連接 Google、試算表還沒有現金設定時，請使用者數一下錢包。日期固定為今天 00:00。
export function askCashIfNeeded(balances) {
  const dialog = $('cashOnboarding');
  const cash = balances?.accounts?.find(a => a.name === CASH);
  if (!dialog || askedCash || !cash?.partial || dialog.open) return false;
  askedCash = true;
  $('cashOnboardingDate').textContent = today() + ' 00:00';
  $('cashOnboardingAmount').value = '';
  $('cashOnboardingStatus').textContent = '';
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  $('cashOnboardingAmount').focus();
  return true;
}
function closeCash() {
  const dialog = $('cashOnboarding');
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}
function initCashOnboarding() {
  const form = $('cashOnboardingForm');
  if (!form) return;
  $('cashOnboardingLater').addEventListener('click', () => {
    closeCash();
    $('accountsStatus').textContent =
      '尚未設定目前現金，現金暫時從 0 開始；可以到「帳戶與餘額 → 現金」再設定。';
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    const cents = moneyCents($('cashOnboardingAmount').value.trim());
    if (!Number.isSafeInteger(cents) || cents < 0) {
      $('cashOnboardingStatus').textContent = '請填寫 0 以上的金額，最多到小數點後兩位。';
      return;
    }
    const day = today();
    busy = true;
    $('cashOnboardingSave').disabled = true;
    $('cashOnboardingStatus').textContent = '正在儲存…';
    try {
      await cloud.saveAccountSetting(settingsRow(CASH, cents, day, '第一次連接時設定'));
      closeCash();
      $('accountsStatus').textContent = '已設定現金在 ' + day + ' 00:00 為 ' + yuan(cents) + ' 元。';
    } catch {
      $('cashOnboardingStatus').textContent = '尚未儲存，請稍後重試；填寫的金額保留。';
    } finally {
      busy = false;
      $('cashOnboardingSave').disabled = false;
    }
  });
  window.addEventListener('finance-signout', () => {
    askedCash = false;
    if ($('cashOnboarding').open) closeCash();
  });
}
export function initAccountsView(api) {
  cloud = api;
  initCashOnboarding();
  draw();
}
