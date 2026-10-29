import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoCategory,
  categorize,
  categoryOverrides,
  monthTotals,
  normalizeCategory,
  recordKeyOf,
  isInternal,
  validCategory
} from '../cloud/categories.mjs';
import { filterHistory } from '../cloud/history.mjs';
import { DECISION_HEADERS } from '../cloud/matching.mjs';
import { evaluateAmount } from '../web/manual.mjs';

const card = (summary, extra = {}) => ({ kind: '信用卡', summary, expense: 100, cardKind: '消費', ...extra });
const bank = (summary, expense, income) => ({ kind: '銀行存款', summary, expense, income });
test('imported lines get categories from shop names, invoices and bank wording', () => {
  assert.equal(autoCategory(card('連支*統一超商')), '餐飲／超商');
  assert.equal(autoCategory(card('優步-QTaxi車隊')), '交通／計程車');
  assert.equal(autoCategory(card('優步-Burger K')), '餐飲／外送');
  assert.equal(autoCategory(card('富邦momo-EC')), '購物／網購');
  assert.equal(autoCategory(card('威秀影城股份有限公司新店分')), '娛樂／電影');
  assert.equal(autoCategory(card('ANTHROPIC* CLAUDE SUB')), '娛樂／訂閱');
  assert.equal(autoCategory(card('國外交易服務費')), '其他／手續費');
  assert.equal(autoCategory(card('勝博殿日式炸豬排-光復店')), '餐飲');
  assert.equal(autoCategory(card('客茶館')), '餐飲');
  assert.equal(autoCategory(card('中華電信話費291')), '居家／電信');
  // A gateway name says nothing; the paired invoice does.
  assert.equal(autoCategory(card('紅陽科技股份有限公司六本松')), '其他');
  assert.equal(
    autoCategory(card('紅陽科技股份有限公司六本松'), {
      invoice: { sellerName: '筑員屋餐飲股份有限公司', items: [] }
    }),
    '餐飲'
  );
  assert.equal(autoCategory(bank('凱基信用卡款', 16533, 0)), '內部轉帳／繳卡費');
  assert.equal(autoCategory(bank('中信證券', 100000, 0)), '內部轉帳／買股票');
  assert.equal(autoCategory(bank('11509薪', 0, 56171)), '薪資／薪水');
  assert.equal(autoCategory(bank('115中秋禮', 0, 1000)), '薪資／獎金');
  assert.equal(autoCategory(bank('股利', 0, 630)), '投資／股利');
  assert.equal(autoCategory(bank('ATM跨行轉', 0, 10000)), '其他收入／收到轉帳');
  assert.equal(autoCategory(bank('跨行轉', 100, 0)), '內部轉帳／帳戶互轉');
  assert.equal(autoCategory(bank('連結帳戶交易', 1500, 0), { state: '儲值' }), '內部轉帳／儲值');
  assert.equal(
    autoCategory(bank('連結帳戶交易', 278, 0), {
      invoice: { sellerName: '全聯實業股份有限公司', items: [] }
    }),
    '日用品／超市'
  );
  assert.equal(autoCategory(card('本行扣繳', { cardKind: '繳款', expense: null })), '內部轉帳／繳卡費');
  assert.equal(autoCategory({ kind: 'LINE Pay', summary: '台北捷運乘車碼', expense: 20 }), '交通／大眾運輸');
  assert.equal(autoCategory({ kind: 'LINE Pay', gapLabel: '轉帳給別人', expense: 200 }), '人情／轉帳給別人');
});
test('older flat category names map into the tree', () => {
  assert.equal(normalizeCategory('轉帳給別人'), '人情／轉帳給別人');
  assert.equal(normalizeCategory('收到轉帳', '收入'), '其他收入／收到轉帳');
  assert.equal(normalizeCategory('餐飲'), '餐飲');
  assert.equal(normalizeCategory('餐飲／午餐'), '餐飲／午餐');
  assert.equal(normalizeCategory('寵物'), '其他／寵物');
  assert.equal(normalizeCategory(''), '');
  assert.ok(validCategory('交通／計程車') && !validCategory('不存在'));
});
test('overrides use their own prefix, the latest wins and undo restores the rules', () => {
  const rows = [
    DECISION_HEADERS,
    ['1', '分類', 'cat:card:a', '分類', '', '娛樂／遊戲', '2026-10-01T00:00:00Z', ''],
    ['2', '分類', 'cat:card:a', '分類', '', '購物／3C', '2026-10-02T00:00:00Z', ''],
    ['3', '分類', 'cat:card:b', '分類', '', '餐飲', '2026-10-01T00:00:00Z', ''],
    ['4', '分類', 'cat:card:b', '撤銷', '', '', '2026-10-03T00:00:00Z', ''],
    ['5', '銀行', 'bank:c', '儲值', '', 'LINE Pay 錢包', '2026-10-01T00:00:00Z', '']
  ];
  const overrides = categoryOverrides(rows);
  assert.deepEqual([...overrides], [['card:a', '購物／3C']]);
  const history = [
    { kind: '信用卡', id: 'a', summary: '連支*統一超商', expense: 39, cardKind: '消費' },
    { kind: '信用卡', id: 'b', summary: '連支*統一超商', expense: 39, cardKind: '消費' },
    { kind: '手動記帳', id: 'm', summary: '', expense: 200, category: '轉帳給別人' },
    { kind: '股票股數', id: 's', summary: '台積電', expense: 0 }
  ];
  history.forEach(h => (h.recordKey = recordKeyOf(h)));
  categorize(history, overrides);
  assert.deepEqual(
    history.map(h => [h.category, h.categorySource]),
    [
      ['購物／3C', '手動設定'],
      ['餐飲／超商', '自動'],
      ['人情／轉帳給別人', '手動記帳'],
      [undefined, undefined]
    ]
  );
});
test('monthly totals leave out internal transfers and stock movements; refunds reduce spending', () => {
  const rows = [
    { kind: '信用卡', expense: 100, category: '餐飲' },
    { kind: '信用卡', expense: -30, category: '其他收入／退款' },
    { kind: '銀行存款', expense: 16533, category: '內部轉帳／繳卡費' },
    { kind: '銀行存款', expense: 0, income: 56171, category: '薪資／薪水' },
    { kind: '股票股數', expense: 10, income: 0, category: undefined },
    { kind: '手動記帳', expense: 85.5, category: '餐飲' }
  ];
  assert.deepEqual(monthTotals(rows), { expenseCents: 15550, incomeCents: 5617100 });
  assert.ok(isInternal('內部轉帳／儲值'));
});
test('history filters by month and main category', () => {
  const rows = [
    { kind: '信用卡', date: '2026-10-05', category: '餐飲／超商', summary: 'a' },
    { kind: '信用卡', date: '2026-09-30', category: '餐飲', summary: 'b' },
    { kind: '銀行存款', date: '2026-10-01', category: '內部轉帳／繳卡費', summary: 'c' }
  ];
  assert.deepEqual(
    filterHistory(rows, { month: '2026-10', category: '餐飲' }).map(r => r.summary),
    ['a']
  );
  assert.deepEqual(
    filterHistory(rows, { query: '繳卡費' }).map(r => r.summary),
    ['c']
  );
});
test('the calculator evaluates sums and differences exactly', () => {
  assert.equal(evaluateAmount('120+35-5'), '150');
  assert.equal(evaluateAmount('19.9+0.1'), '20');
  assert.equal(evaluateAmount('10.05'), '10.05');
  assert.equal(evaluateAmount(''), '');
  assert.throws(() => evaluateAmount('1*2'), /MANUAL_EXPRESSION/);
  assert.throws(() => evaluateAmount('1..2'), /MANUAL_EXPRESSION/);
});
