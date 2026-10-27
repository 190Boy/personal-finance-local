import { decisionRow, PAYMENT_METHODS } from '../cloud/matching.mjs';
import { hash } from '../cloud/records.mjs';
const $ = id => document.getElementById(id);
const money = c =>
  Number.isSafeInteger(c)
    ? (c / 100).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    : '—';
const md = d => (d ? Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10)) : '');
const messages = {
  GOOGLE_LOGIN_REQUIRED: '請先連接 Google。',
  SYNC_BUSY: '其他同步正在進行，請稍後重試。',
  SYNC_RETRY: '其他裝置正在同步，請稍後重試。',
  SHEET_SCHEMA: '「配對紀錄」或「付款習慣」工作表欄位已更動，請保留系統欄名與順序。'
};
let cloud = null,
  data = null,
  busy = false;

function el(tag, text, className) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (className) e.className = className;
  return e;
}
function button(label, onClick, secondary = false) {
  const b = el('button', label, secondary ? 'secondary' : '');
  b.type = 'button';
  b.disabled = busy;
  b.addEventListener('click', onClick);
  return b;
}
function recordLabel(r) {
  return r.source + '／' + r.account + ' ' + md(r.date) + ' ' + r.summary;
}
function invoiceCard(inv) {
  const card = el('article', null, 'invoice-card');
  const top = el('div', null, 'top');
  top.append(el('h3', inv.short || inv.sellerName), el('span', money(inv.totalCents) + ' 元', 'amount'));
  card.append(top, el('p', [md(inv.date), inv.branch, inv.carrier].filter(Boolean).join(' · '), 'meta'));
  if (inv.items.length) {
    const details = el('details'),
      list = el('ul', null, 'invoice-items');
    details.append(el('summary', inv.items.length + ' 個品項'));
    for (const item of inv.items) {
      const li = el('li', null, item.amountCents < 0 ? 'discount' : '');
      const qty = item.quantity && item.quantity !== '1' ? ' ×' + item.quantity : '';
      li.append(el('span', item.name + qty), el('span', money(item.amountCents)));
      list.append(li);
    }
    details.append(list);
    card.append(details);
  }
  return card;
}
async function decide(list, done) {
  if (busy || !list.length) return;
  busy = true;
  render();
  $('matchingStatus').textContent = '正在儲存…';
  try {
    const rows = [];
    for (const d of list) rows.push(await decisionRow(hash, d));
    await cloud.saveDecisions(rows);
    $('matchingStatus').textContent = done;
  } catch (error) {
    $('matchingStatus').textContent = messages[error.message] || '尚未儲存，請稍後重試；畫面維持原狀。';
  } finally {
    busy = false;
    render();
  }
}
function methodPicker(inv) {
  const wrap = el('div', null, 'btns');
  const select = el('select');
  select.setAttribute('aria-label', inv.short + ' 的付款方式');
  for (const m of new Set([inv.defaultMethod, ...PAYMENT_METHODS])) select.append(new Option(m, m));
  select.value = inv.defaultMethod;
  select.disabled = busy;
  wrap.append(
    select,
    button('確認', () =>
      decide(
        [{ type: '發票', target: inv.id, action: '付款方式', method: select.value }],
        '已記錄：' + inv.short + ' ' + money(inv.totalCents) + ' 元，' + select.value + '。'
      )
    )
  );
  return wrap;
}
function section(title, note) {
  const s = el('section', null, 'panel');
  s.append(el('h2', title));
  if (note) s.append(el('p', note, 'muted'));
  return s;
}

function render() {
  const box = $('matchingBody');
  box.replaceChildren();
  $('matchingEmpty').hidden = !!data;
  if (!data) return;
  const c = data.counts,
    by = state => data.invoices.filter(i => i.state === state);
  const stats = el('div', null, 'summarygrid matching-stats');
  for (const [label, value, warn] of [
    ['已配對', c.auto + c.confirmed + c.settled],
    ['待確認', c.pending, c.pending > 0],
    ['需要你選', c.choose + c.questions, c.choose + c.questions > 0],
    ['等待帳單', c.waiting]
  ]) {
    const s = el('div', null, 'stat' + (warn ? ' warn' : ''));
    s.append(el('small', label), el('strong', String(value)));
    stats.append(s);
  }
  box.append(stats);
  if (data.coverage.end)
    box.append(
      el(
        'p',
        '已匯入的卡片與銀行明細共同涵蓋 ' +
          data.coverage.start +
          ' ～ ' +
          data.coverage.end +
          '。這段期間外的發票先等帳單匯入再判斷。',
        'muted'
      )
    );

  const pending = by('pending');
  if (pending.length) {
    const s = section(
      '待確認的支出',
      '這些發票找不到對應的刷卡或銀行紀錄。已依你的付款習慣預選付款方式，確認後才會記錄。'
    );
    const groups = new Map();
    for (const inv of pending) groups.set(inv.defaultMethod, [...(groups.get(inv.defaultMethod) || []), inv]);
    const batch = el('div', null, 'actions');
    for (const [method, list] of groups)
      batch.append(
        button(
          '全部 ' + list.length + ' 張記為「' + method + '」',
          () =>
            decide(
              list.map(inv => ({ type: '發票', target: inv.id, action: '付款方式', method })),
              '已記錄 ' + list.length + ' 張發票為「' + method + '」。'
            ),
          true
        )
      );
    s.append(batch);
    for (const inv of pending) {
      const card = invoiceCard(inv);
      card.append(methodPicker(inv));
      s.append(card);
    }
    box.append(s);
  }

  const choose = by('choose');
  if (choose.length || data.questions.length) {
    const s = section('需要你選');
    for (const inv of choose) {
      const card = invoiceCard(inv);
      if (/優食台灣|優步福爾摩沙/.test(inv.sellerName))
        card.append(
          el('p', '這張發票只有平台的外送費或服務費，餐點、車資另計，所以金額不會和刷卡相同。', 'why')
        );
      for (const r of inv.candidates) {
        const row = el('div', null, 'cand');
        row.append(
          el('span', recordLabel(r) + '　' + money(r.amountCents) + ' 元'),
          button('是這筆', () =>
            decide(
              [{ type: '發票', target: inv.id, action: '配對', other: r.key, method: r.kind }],
              '已配對：' + inv.short + ' ↔ ' + r.summary + '。'
            )
          )
        );
        card.append(row);
      }
      const actions = el('div', null, 'btns');
      actions.append(
        button(
          '都不是',
          () =>
            decide(
              inv.candidates.map(r => ({ type: '發票', target: inv.id, action: '不是這筆', other: r.key })),
              '已排除這些候選，' + inv.short + ' 會改列在待確認或等待帳單。'
            ),
          true
        )
      );
      card.append(actions);
      s.append(card);
    }
    for (const q of data.questions) {
      const card = el('article', null, 'invoice-card');
      const top = el('div', null, 'top');
      top.append(el('h3', q.record.summary), el('span', money(q.record.amountCents) + ' 元', 'amount'));
      card.append(
        top,
        el('p', q.record.source + '／' + q.record.account + ' · ' + md(q.record.date), 'meta'),
        el('p', '這筆銀行扣款找不到對應的發票。是儲值到錢包（不算支出），還是一筆沒有發票的消費？', 'why')
      );
      const actions = el('div', null, 'btns');
      const topup = button(
          '儲值 LINE Pay 錢包',
          () =>
            decide(
              [{ type: '銀行', target: q.record.key, action: '儲值', method: 'LINE Pay 錢包' }],
              '已標記為儲值 LINE Pay 錢包，不算支出。'
            ),
          q.suggestion !== '儲值'
        ),
        spend = button(
          '沒有發票的消費',
          () =>
            decide(
              [{ type: '銀行', target: q.record.key, action: '無發票', method: '玉山帳戶' }],
              '已標記為沒有發票的消費。'
            ),
          q.suggestion === '儲值'
        );
      actions.append(topup, spend);
      card.append(actions);
      s.append(card);
    }
    box.append(s);
  }

  const waiting = by('waiting');
  if (waiting.length) {
    const d = el('details', null, 'panel');
    d.append(el('summary', '等待帳單（' + waiting.length + ' 張）'));
    const reasons = new Map();
    for (const inv of waiting) reasons.set(inv.reason, (reasons.get(inv.reason) || 0) + 1);
    for (const [reason, n] of reasons)
      d.append(el('p', n + ' 張：' + reason + '。匯入較新的明細後會自動重新配對。', 'muted'));
    for (const inv of waiting) d.append(invoiceCard(inv));
    box.append(d);
  }

  const done = data.invoices.filter(i => ['auto', 'confirmed', 'settled'].includes(i.state));
  if (done.length) {
    const d = el('details', null, 'panel');
    d.append(el('summary', '已配對（' + done.length + ' 張）'));
    for (const inv of done) {
      const card = invoiceCard(inv);
      const how =
        inv.state === 'settled'
          ? '付款方式：' + inv.method
          : (inv.state === 'auto' ? '自動配對：' : '已確認：') + recordLabel(inv.record);
      card.append(el('p', how, 'muted'));
      const actions = el('div', null, 'btns');
      if (inv.state === 'auto')
        actions.append(
          button(
            '不是這筆',
            () =>
              decide(
                [{ type: '發票', target: inv.id, action: '不是這筆', other: inv.record.key }],
                '已取消這筆自動配對。'
              ),
            true
          )
        );
      else
        actions.append(
          button(
            '取消',
            () => decide([{ type: '發票', target: inv.id, action: '撤銷' }], '已取消，這張發票會重新配對。'),
            true
          )
        );
      card.append(actions);
      d.append(card);
    }
    box.append(d);
  }
  if (c.voided) box.append(el('p', '另有 ' + c.voided + ' 張作廢發票，不列入配對。', 'muted'));
}

export function renderMatching(matching) {
  data = matching || null;
  render();
}
export function clearMatching() {
  data = null;
  if ($('matchingBody')) render();
  if ($('matchingStatus')) $('matchingStatus').textContent = '';
}
export function initMatching(api) {
  cloud = api;
  render();
}
