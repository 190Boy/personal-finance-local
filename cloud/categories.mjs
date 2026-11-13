// 收支分類：主分類／子分類與圖示。現金記帳的「支出」「收入」各用一組；提款、存入不需要分類。

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
  ]
};
const ALL = Object.values(CATEGORY_TREE).flat();
export const MAIN_CATEGORIES = ALL.map(c => c.name);
export function mainOf(category) {
  return String(category || '').split('／')[0];
}
export const iconOf = category => ALL.find(c => c.name === mainOf(category))?.icon || '📦';
export function validCategory(category, type = '支出') {
  const [main, sub] = String(category || '').split('／');
  const group = (CATEGORY_TREE[type] || []).find(c => c.name === main);
  return !!group && (sub === undefined || group.subs.includes(sub));
}
