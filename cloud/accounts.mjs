export function savedAccounts(rows) {
  const banks = new Map();
  for (const row of rows) {
    const bank = String(row[1] || '').trim(),
      account = String(row[2] || '').trim();
    if (!bank || !account) continue;
    if (!banks.has(bank)) banks.set(bank, new Set());
    banks.get(bank).add(account);
  }
  return Object.fromEntries(
    [...banks].map(([bank, names]) => [bank, [...names].sort((a, b) => a.localeCompare(b, 'zh-Hant'))])
  );
}
export function initAccounts() {
  const $ = id => document.getElementById(id),
    bankName = () => ({ esun: '玉山銀行', ctbc: '中國信託' })[$('bank').value];
  let accounts = {},
    last = new Map();
  const selects = [$('existingAccount'), $('syncAccountSelect')],
    inputs = [$('account'), $('syncAccount')];
  function draw() {
    const names = accounts[bankName()] || [];
    let chosen = $('account').value.trim() || last.get(bankName()) || '';
    if (!chosen && names.length === 1) chosen = names[0];
    for (const input of inputs) input.value = chosen;
    for (const select of selects) {
      select.replaceChildren();
      const fresh = document.createElement('option');
      fresh.value = '';
      fresh.textContent = names.length ? '新增帳戶（在下方輸入）' : '尚無雲端帳戶，請在下方新增';
      select.append(fresh);
      for (const name of names) {
        const o = document.createElement('option');
        o.value = name;
        o.textContent = name;
        select.append(o);
      }
      select.value = names.includes(chosen) ? chosen : '';
    }
    $('accountChoiceHint').textContent =
      names.length > 1 && !chosen
        ? '這家銀行有多個帳戶，請選擇本次來源。'
        : names.length === 1 && chosen === names[0]
          ? '已帶入這家銀行唯一的帳戶代稱。'
          : '選擇已有帳戶，或輸入新帳戶代稱。';
  }
  for (const select of selects)
    select.addEventListener('change', () => {
      const name = select.value;
      for (const input of inputs) input.value = name;
      last.set(bankName(), name);
      selects.forEach(s => (s.value = name));
      $('accountChoiceHint').textContent = name ? '已選擇雲端帳戶：' + name : '請在下方輸入新帳戶代稱。';
    });
  for (const input of inputs)
    input.addEventListener('input', () => {
      for (const other of inputs) if (other !== input) other.value = input.value;
      last.set(bankName(), input.value.trim());
      selects.forEach(
        s => (s.value = (accounts[bankName()] || []).includes(input.value.trim()) ? input.value.trim() : '')
      );
    });
  $('bank').addEventListener('change', draw);
  window.addEventListener('account-source-reset', draw);
  return {
    update(value) {
      accounts = value;
      draw();
    },
    clear() {
      accounts = {};
      last.clear();
      inputs.forEach(i => (i.value = ''));
      draw();
    },
    refresh: draw
  };
}
