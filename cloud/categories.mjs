// 收支分類：主分類／子分類、圖示，以及匯入交易的自動分類規則。
// 「內部轉帳」是錢在自己的帳戶之間移動（繳卡費、儲值、買股票），不算支出也不算收入，避免同一筆錢算兩次。

export const CATEGORY_TREE = {
  支出: [
    { name: '餐飲', icon: '🍜', subs: ['早餐', '午餐', '晚餐', '飲料', '點心', '超商', '外送'] },
    { name: '交通', icon: '🚌', subs: ['大眾運輸', '計程車', '加油', '停車', '高鐵火車'] },
    { name: '日用品', icon: '🧴', subs: ['超市', '生活用品', '美妝'] },
    { name: '購物', icon: '🛍️', subs: ['服飾', '網購', '3C'] },
    { name: '娛樂', icon: '🎬', subs: ['電影', '遊戲', '訂閱', '旅遊'] },
    { name: '居家', icon: '🏠', subs: ['房租', '水電', '電信', '保險'] },
    { name: '醫療', icon: '💊', subs: ['看診', '藥品'] },
    { name: '人情', icon: '🎁', subs: ['轉帳給別人', '禮金', '請客'] },
    { name: '其他', icon: '📦', subs: ['手續費', '其他'] }
  ],
  收入: [
    { name: '薪資', icon: '💰', subs: ['薪水', '獎金'] },
    { name: '投資', icon: '📈', subs: ['股利', '利息'] },
    { name: '其他收入', icon: '🪙', subs: ['收到轉帳', '退款', '回饋', '其他'] }
  ],
  轉帳: [{ name: '內部轉帳', icon: '🔁', subs: ['繳卡費', '儲值', '提款', '買股票', '帳戶互轉'] }]
};
export const INTERNAL = '內部轉帳';
const ALL = Object.values(CATEGORY_TREE).flat();
export const MAIN_CATEGORIES = ALL.map(c => c.name);
export const iconOf = category => ALL.find(c => c.name === mainOf(category))?.icon || '📦';
export function mainOf(category) {
  return String(category || '').split('／')[0];
}
export const isInternal = category => mainOf(category) === INTERNAL;
export function validCategory(category) {
  const [main, sub] = String(category || '').split('／');
  const c = ALL.find(x => x.name === main);
  return !!c && (!sub || c.subs.includes(sub) || sub.length <= 20);
}

// Keyword rules, first match wins. Tested against the statement summary, the shop name and, when an invoice
// is paired, the invoice seller and item names.
const RULES = [
  [/優步.*(taxi|車隊|計程|uber\s*trip)|台灣大車隊|計程車/i, '交通／計程車'],
  [/優食|優步|uber\s*eats|foodpanda|熊貓/i, '餐飲／外送'],
  [/捷運|乘車碼|悠遊|一卡通|台鐵|客運|公車/, '交通／大眾運輸'],
  [/高鐵|台灣高速鐵路/, '交通／高鐵火車'],
  [/停車|詮營|嘟嘟房|俥亭/, '交通／停車'],
  [/加油|中油|台塑石油|全國加油/, '交通／加油'],
  [/統一超商|7-?eleven|7-11|全家|familymart|萊爾富|ok超商|ok mart/i, '餐飲／超商'],
  [/全聯|家樂福|美廉社|好市多|costco|頂好|超市/i, '日用品／超市'],
  [/寶雅|poya|屈臣氏|康是美|大創|daiso/i, '日用品／生活用品'],
  [
    /麥當勞|mcdonal|肯德基|kfc|摩斯|鬍鬚張|丸龜|薩莉亞|達美樂|popeyes|八方雲集|吃到飽|便當|鍋貼|麵|餐|食堂|食館|飯|豬排|牛排|火鍋|燒肉|壽司|拉麵|小吃|茶館|早午餐|美食街/i,
    '餐飲'
  ],
  [/星巴克|starbucks|cama|咖啡|先喝道|飲料|茶飲|手搖/i, '餐飲／飲料'],
  [/威秀|影城|國賓|秀泰/, '娛樂／電影'],
  [/mycard|智冠|steam|playstation|nintendo|遊戲/i, '娛樂／遊戲'],
  [/openai|anthropic|claude|netflix|spotify|youtube|disney|apple\.com|google\s*\*|訂閱/i, '娛樂／訂閱'],
  [/momo|蝦皮|shopee|pchome|91app|酷澎|coupang|博客來/i, '購物／網購'],
  [/uniqlo|zara|h&m|服飾/i, '購物／服飾'],
  [/中華電信|台灣大哥大|遠傳|亞太電信|台灣之星|電信/, '居家／電信'],
  [/台電|台灣電力|自來水|瓦斯|欣欣/, '居家／水電'],
  [/產險|人壽|保險/, '居家／保險'],
  [/診所|醫院|牙醫|藥局|藥妝/, '醫療'],
  [/國外交易服務費|手續費|年費|跨行費/, '其他／手續費']
];
// Bank lines describe money movements more often than purchases.
const BANK_RULES = [
  [/信用卡款|卡費|中信卡|凱基信用卡|玉山卡|本行扣繳/, '內部轉帳／繳卡費'],
  [/證券|股票|交割/, '內部轉帳／買股票'],
  [/提款|atm提/i, '內部轉帳／提款'],
  // Transfers out of a bank account usually go to the user's own accounts; changeable per record.
  [/轉帳|跨行轉|轉帳提|非約|約轉/, '內部轉帳／帳戶互轉'],
  [/薪|薪資|salary/i, '薪資／薪水'],
  [/獎金|中秋禮|年終|禮金/, '薪資／獎金'],
  [/股利|股息/, '投資／股利'],
  [/利息/, '投資／利息']
];

const GAP_CATEGORIES = {
  轉帳給別人: '人情／轉帳給別人',
  乘車碼: '交通／大眾運輸',
  其他支出: '其他',
  收到轉帳: '其他收入／收到轉帳',
  儲值: '內部轉帳／儲值',
  退款: '其他收入／退款',
  其他收入: '其他收入／其他'
};
// Older hand-entered records used a flat list; map those names into the tree.
export function normalizeCategory(category, type = '支出') {
  const c = String(category || '').trim();
  if (!c) return '';
  if (MAIN_CATEGORIES.includes(mainOf(c))) return c;
  const tree = type === '收入' ? CATEGORY_TREE.收入 : [...CATEGORY_TREE.支出, ...CATEGORY_TREE.轉帳];
  const owner = [...tree, ...ALL].find(x => x.subs.includes(c));
  return owner ? owner.name + '／' + c : '其他／' + c;
}

export function autoCategory(row, link) {
  if (row.gapLabel) return GAP_CATEGORIES[row.gapLabel] || '其他';
  if (link?.state === '儲值') return '內部轉帳／儲值';
  if (row.kind === '信用卡' && row.cardKind === '繳款') return '內部轉帳／繳卡費';
  if (row.kind === '信用卡' && row.cardKind === '退款') return '其他收入／退款';
  const income = Number(row.income) > 0 && !(Number(row.expense) > 0);
  const text = [row.summary, link?.invoice?.sellerName, ...(link?.invoice?.items || []).map(i => i.name)]
    .filter(Boolean)
    .join(' ');
  if (row.kind === '銀行存款')
    for (const [re, category] of BANK_RULES)
      if (re.test(row.summary)) {
        // An expense line that only looks like income keeps looking for a spending rule.
        if (!income && /^(薪資|投資)/.test(category)) continue;
        // Money arriving by transfer is income from someone unless the user says it is their own account.
        if (income && category === '內部轉帳／帳戶互轉') continue;
        return category;
      }
  if (income) return /轉/.test(row.summary) ? '其他收入／收到轉帳' : '其他收入／其他';
  for (const [re, category] of RULES) if (re.test(text)) return category;
  return '其他';
}

// Rows carry a category from the manual entry itself, a user override, or the rules.
export function categorize(rows, overrides = new Map()) {
  for (const r of rows) {
    if (r.kind === '股票股數') continue;
    const key = r.recordKey;
    if (r.kind === '手動記帳' && r.category) {
      r.category = normalizeCategory(r.category, r.income > 0 ? '收入' : '支出');
      r.categorySource = '手動記帳';
    } else if (key && overrides.has(key)) {
      r.category = overrides.get(key);
      r.categorySource = '手動設定';
    } else {
      r.category = autoCategory(r, r.match);
      r.categorySource = '自動';
    }
  }
  return rows;
}

export function monthTotals(rows) {
  let expense = 0,
    income = 0;
  for (const r of rows) {
    if (r.kind === '股票股數' || isInternal(r.category)) continue;
    const e = Number(r.expense),
      i = Number(r.income);
    if (Number.isFinite(e) && e > 0) expense += Math.round(e * 100);
    if (Number.isFinite(i) && i > 0) income += Math.round(i * 100);
    // Card refunds are negative expenses.
    if (r.kind === '信用卡' && Number.isFinite(e) && e < 0) expense += Math.round(e * 100);
  }
  return { expenseCents: expense, incomeCents: income };
}

// Category overrides live in 配對紀錄 under their own target prefix, so they never collide with a matching
// decision about the same record. The latest per record wins; 「撤銷」 restores the automatic category.
export function categoryOverrides(decisionRows) {
  const out = new Map();
  const rows = decisionRows
    .slice(1)
    .map((r, n) => ({
      target: String(r[2] || ''),
      action: String(r[3] || ''),
      category: String(r[5] || ''),
      at: String(r[6] || ''),
      n
    }))
    .filter(d => d.target.startsWith('cat:'))
    .sort((a, b) => a.at.localeCompare(b.at) || a.n - b.n);
  for (const d of rows) {
    const key = d.target.slice(4);
    if (d.action === '撤銷') out.delete(key);
    else if (d.action === '分類' && validCategory(d.category)) out.set(key, d.category);
  }
  return out;
}
export const recordKeyOf = row =>
  row.kind === '信用卡'
    ? 'card:' + row.id
    : row.kind === '銀行存款'
      ? 'bank:' + row.id
      : row.kind === '手動記帳'
        ? 'manual:' + row.id
        : row.kind === 'LINE Pay'
          ? String(row.id).startsWith('gap:')
            ? row.id
            : 'linepay:' + row.id
          : '';
