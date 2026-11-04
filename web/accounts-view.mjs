import { settingsRow, CASH } from '../cloud/balances.mjs';
import { moneyCents } from '../pdf-parser/parser.mjs';
const $ = id => document.getElementById(id);
const yuan = c => (c / 100).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const ICONS = { 銀行: '🏦', 信用卡: '💳', 電子支付: '📱', 現金: '💵', 其他: '👛' };
let cloud = null,
  data = null,
  busy = false;
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
  const form = el('form', null, 'account-setup');
  const amount = el('input');
  amount.inputMode = 'decimal';
  amount.placeholder = '目前金額';
  amount.setAttribute('aria-label', account.name + ' 目前金額');
  const date = el('input');
  date.type = 'date';
  date.value = today();
  date.setAttribute('aria-label', '以哪一天結束時為準');
  const save = el('button', '設定');
  save.type = 'submit';
  form.append(amount, date, save);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    const cents = moneyCents(amount.value.trim());
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
        '已設定 ' + account.name + ' 在 ' + date.value + ' 為 ' + yuan(cents) + ' 元。';
    } catch {
      $('accountsStatus').textContent = '尚未儲存，請確認已連接 Google 後重試。';
    } finally {
      busy = false;
      save.disabled = false;
    }
  });
  return form;
}
function draw() {
  const box = $('accountsBody');
  box.replaceChildren();
  $('accountsEmpty').hidden = !!data;
  if (!data) return;
  const totals = el('div', null, 'history-totals');
  for (const [label, cents, cls] of [
    ['資產', data.assetsCents, 'in'],
    ['信用卡消費', data.liabilitiesCents, 'out'],
    ['差額', data.assetsCents - data.liabilitiesCents, 'net']
  ]) {
    const s = el('div', null, 'stat ' + cls);
    s.append(el('small', label), el('strong', yuan(cents)));
    totals.append(s);
  }
  totals.append(el('p', '不含股票；信用卡是最新帳單月份的消費合計，不是銀行確認的待繳。', 'muted'));
  box.append(totals);
  for (const type of ['現金', '銀行', '電子支付', '信用卡', '其他']) {
    const list = data.accounts.filter(a => a.type === type);
    if (!list.length) continue;
    const section = el('section', null, 'panel');
    section.append(el('h2', ICONS[type] + ' ' + type));
    for (const a of list) {
      const card = el('article', null, 'invoice-card account-card');
      const top = el('div', null, 'top');
      top.append(
        el('h3', a.name),
        el(
          'span',
          (a.liability ? '−' : '') + yuan(Math.abs(a.cents)) + ' 元',
          'amount' + (a.cents < 0 ? ' negative' : '')
        )
      );
      card.append(top, el('p', a.note, 'meta' + (a.partial ? ' bad' : '')));
      if (a.type === '現金' || a.type === '其他') {
        const d = el('details');
        d.append(el('summary', a.type === '現金' ? '設定目前現金' : '設定目前餘額'));
        d.append(
          el(
            'p',
            a.name === CASH
              ? '數一下錢包裡的現金填在這裡。之後銀行明細裡的提款會自動加進來，不用另外記；花掉的現金請用手動記帳記下。'
              : '填這個帳戶在某一天結束時的餘額，之後的手動記帳會從這裡加減。',
            'muted'
          ),
          setupForm(a)
        );
        card.append(d);
      }
      section.append(card);
    }
    box.append(section);
  }
}
export function renderAccounts(balances) {
  data = balances || null;
  if ($('accountsBody')) draw();
}
export function initAccountsView(api) {
  cloud = api;
  draw();
}
