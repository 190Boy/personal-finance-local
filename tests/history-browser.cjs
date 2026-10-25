const { chromium } = require('playwright'),
  assert = require('node:assert/strict'),
  http = require('node:http'),
  fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(__dirname, '..'),
  base = 'http://127.0.0.1:4192';
const server = http.createServer((req, res) => {
  const p = path.resolve(root, '.' + new URL(req.url, base).pathname.replace(/\/$/, '/index.html'));
  if (!p.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(p, (e, b) => {
    res.writeHead(e ? 404 : 200, {
      'Content-Type': /\.(mjs|js)$/.test(p)
        ? 'text/javascript'
        : /html$/.test(p)
          ? 'text/html'
          : /css$/.test(p)
            ? 'text/css'
            : 'application/octet-stream'
    });
    res.end(e ? '' : b);
  });
});
(async () => {
  await new Promise(r => server.listen(4192, '127.0.0.1', r));
  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true
  });
  try {
    const page = await browser.newPage({ serviceWorkers: 'block' }),
      sheets = [],
      rows = {},
      errors = [],
      writes = [];
    page.on('pageerror', e => errors.push(e.message));
    const { HEADERS } = await import('../cloud/records.mjs');
    const { OLD_IMPORT_HEADERS, LEGACY_STOCK_HEADERS } = await import('../cloud/ledger.mjs');
    const { STOCK_SCHEMAS } = await import('../cloud/stocks.mjs');
    rows['銀行存款'] = [
      HEADERS,
      ...Array.from({ length: 205 }, (_, n) => [
        'bank-' + n,
        '測試銀行',
        n % 2 ? '儲蓄' : '主要',
        '2026-10-' + String((n % 20) + 1).padStart(2, '0'),
        '10:00:00',
        n === 0 ? '薪資' : '測試交易' + n,
        10,
        0,
        0,
        100 + n,
        n === 0 ? 'fail' : 'pass',
        n === 0 ? '需要人工核對' : '',
        'excel',
        'bank-log',
        n,
        '2026-10-21',
        '銀行存款',
        n,
        'esun'
      ])
    ];
    rows['銀行存款'].push([...rows['銀行存款'][1]]);
    const conflict = [...rows['銀行存款'][1]];
    conflict[9] = 999;
    rows['銀行存款'].push(conflict);
    rows['匯入紀錄'] = [
      OLD_IMPORT_HEADERS,
      ['bank-log', '測試銀行', '主要', '銀行存款', '2026-10-21', 205, 205]
    ];
    rows['股票匯入紀錄'] = [
      LEGACY_STOCK_HEADERS,
      ['stock-log', '測試券商', '證券帳戶', '2026-10-21', 'b', 'c', '人工確認']
    ];
    rows['股票異動'] = [
      STOCK_SCHEMAS['股票異動'],
      ['stock-1', '測試券商', '證券帳戶', '2026-10-21', '1234', '虛構股票', '買進', 0, 20, 20]
    ];
    for (const title of Object.keys(rows)) sheets.push({ title, sheetId: sheets.length + 1 });
    await page.route('https://accounts.google.com/gsi/client', r =>
      r.fulfill({
        contentType: 'text/javascript',
        body: "window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:o=>({requestAccessToken:()=>o.callback({access_token:'synthetic-token',expires_in:3600})})}}};"
      })
    );
    await page.route('https://www.googleapis.com/**', r =>
      r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(
          r.request().url().includes('/about?')
            ? { user: { displayName: '合成測試', emailAddress: 'synthetic@example.com' } }
            : r.request().method() === 'POST'
              ? { id: 'synthetic-sheet' }
              : { files: [] }
        )
      })
    );
    await page.route('https://sheets.googleapis.com/**', async route => {
      const req = route.request(),
        url = req.url();
      let out = {};
      const body = req.postData() ? JSON.parse(req.postData()) : null;
      if (body) {
        writes.push(JSON.stringify(body));
        assert.ok(!JSON.stringify(body).includes('synthetic-password'));
      }
      if (url.includes('/values/')) {
        const tab = decodeURIComponent(url.split('/values/')[1].split('?')[0]).split("'")[1];
        if (req.method() === 'PUT') rows[tab] = body.values;
        else out = { values: rows[tab] || [] };
      } else if (req.method() === 'GET') out = { sheets: sheets.map(properties => ({ properties })) };
      else
        for (const r of body.requests) {
          if (r.updateCells) {
            const tab = sheets.find(s => s.sheetId === r.updateCells.range.sheetId).title;
            rows[tab][0] = r.updateCells.rows[0].values.map(v => v.userEnteredValue.stringValue);
          }
          if (r.updateSheetProperties)
            Object.assign(
              sheets.find(s => s.sheetId === r.updateSheetProperties.properties.sheetId),
              r.updateSheetProperties.properties
            );
          if (r.addSheet) sheets.push({ ...r.addSheet.properties, sheetId: sheets.length + 1 });
          if (r.appendCells) {
            const tab = sheets.find(s => s.sheetId === r.appendCells.sheetId).title;
            rows[tab].push(
              ...r.appendCells.rows.map(r =>
                r.values.map(v => v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue)
              )
            );
          }
        }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(out) });
    });
    await page.goto(base + '/web/#login');
    await page.waitForFunction(
      () => !!window.google?.accounts && !document.querySelector('#loginGoogle').disabled
    );
    await page.click('#loginGoogle');
    await page.waitForFunction(() => location.hash === '#home');
    assert.equal(sheets.find(s => s.title === '股票匯入紀錄').hidden, true);
    assert.equal(rows['匯入紀錄'][0].length, 10);
    assert.equal(rows['匯入紀錄'].length, 3);
    assert.equal(rows['匯入紀錄'][2][3], '股票資產');
    assert.equal(rows['股票匯入紀錄'].length, 2);
    await page.evaluate(() => (location.hash = 'transactions'));
    assert.ok((await page.textContent('#historyCount')).includes('207 筆'));
    assert.equal(await page.locator('#historyRows tr').count(), 100);
    await page.click('#historyMore');
    assert.equal(await page.locator('#historyRows tr').count(), 200);
    await page.click('#historyMore');
    assert.equal(await page.locator('#historyRows tr').count(), 207);
    await page.locator('#historyFilters summary').click();
    await page.selectOption('#historyKind', '股票股數');
    assert.equal(await page.locator('#historyRows tr').count(), 1);
    assert.ok((await page.textContent('#historyRows')).includes('股'));
    await page.selectOption('#historyKind', '銀行存款');
    await page.fill('#historyQuery', '薪資');
    assert.equal(await page.locator('#historyRows tr').count(), 2);
    assert.ok((await page.textContent('#historyRows')).includes('內容衝突'));
    assert.ok((await page.textContent('#historyRows')).includes('需要人工核對'));
    await page.click('#historyReset');
    await page.selectOption('#historyAccount', JSON.stringify(['測試銀行', '儲蓄']));
    assert.ok((await page.textContent('#historyRows')).includes('儲蓄'));
    assert.ok(!(await page.textContent('#historyRows')).includes('主要'));
    await page.click('#historyReset');
    await page.fill('#historyFrom', '2027-01-01');
    assert.equal(await page.locator('#historyRows tr').count(), 0);
    await page.click('#historyReset');
    await page.evaluate(() => (location.hash = 'import'));
    assert.equal(await page.locator('#view-import-hub').isVisible(), true);
    assert.equal(await page.locator('#pdfForm').isVisible(), false);
    await page.click('#view-import-hub a[href="#bank-import"]');
    assert.equal(await page.locator('#pdfForm').isVisible(), true);
    assert.equal(await page.textContent('[data-nav="import"] span'), '匯入');
    await page.evaluate(() => (location.hash = 'transactions'));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.reload();
    assert.equal(await page.locator('#historyRows tr').count(), 0);
    await page.evaluate(() => (location.hash = 'login'));
    await page.waitForFunction(
      () => !!window.google?.accounts && !document.querySelector('#loginGoogle').disabled
    );
    await page.click('#loginGoogle');
    await page.waitForFunction(() => location.hash === '#home');
    await page.evaluate(() => (location.hash = 'transactions'));
    assert.ok((await page.textContent('#historyCount')).includes('207 筆'));
    assert.equal(rows['匯入紀錄'].length, 3);
    await page.evaluate(() => (location.hash = 'settings'));
    await page.click('#connectGoogle');
    assert.equal(await page.locator('#historyRows tr').count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      'PASS: legacy ledger migration/hiding without deletion, shared categories, bank pending history, duplicate/conflict preservation, 100-row incremental display, filters, re-login history reload, import chooser, unchanged bank form, mobile width, logout clearing.'
    );
  } finally {
    await browser.close();
    server.closeAllConnections();
    server.close();
  }
})().catch(e => {
  console.error(e.stack);
  server.close();
  process.exitCode = 1;
});
