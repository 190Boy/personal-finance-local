const fs = require('node:fs/promises'),
  http = require('node:http'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'),
  fixtures = path.resolve(process.argv[2]),
  output = path.resolve(process.argv[3]),
  base = '/personal-finance-local/',
  origin = 'http://127.0.0.1:4175';
const files = JSON.parse(
    require('node:fs')
      .readFileSync(path.join(root, 'sw.js'), 'utf8')
      .match(/const FILES = ([\s\S]*?);\nconst ALLOWED/)[1]
  ),
  allowed = new Set([...files, 'sw.js', 'web/']);
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, origin);
  let rel = u.pathname.slice(base.length);
  if (req.method !== 'GET' || u.search || !u.pathname.startsWith(base) || !allowed.has(rel)) {
    res.writeHead(404);
    res.end();
    return;
  }
  if (rel === 'web/') rel = 'web/index.html';
  try {
    const bytes = await fs.readFile(path.join(root, rel));
    const mime =
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.webmanifest': 'application/manifest+json'
      }[path.extname(rel)] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self'; manifest-src 'self'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
const results = [],
  requests = [],
  errors = [];
let browser, ctx, page;
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'pass' });
  } catch (e) {
    results.push({ name, status: 'fail', error: e.message });
  }
}
async function load(file = 'synthetic.xlsx') {
  await page.locator('[data-nav=import]').click();
  if ((await page.locator('#bank').inputValue()) !== 'esun') await page.locator('#bank').selectOption('esun');
  await page.locator('#clear').click();
  await page.locator('#pdfFile').setInputFiles(path.join(fixtures, file));
  await page.waitForFunction(() => !document.getElementById('parse').disabled);
  await page.locator('#opening').fill('1050');
}
async function parse() {
  await page.locator('#parse').click();
  await page.waitForFunction(() => !document.getElementById('parse').disabled);
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  await new Promise(r => server.listen(4175, '127.0.0.1', r));
  browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
  });
  ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
  ctx.on('request', r => requests.push({ url: r.url(), method: r.method(), body: r.postData() }));
  page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + base + 'web/');
  await page.locator('[data-nav=import]').click();
  await page.waitForFunction(() => !document.getElementById('parse').disabled);
  await check('bank routing separates Excel from PDF and password entry', async () => {
    await page.locator('#bank').selectOption('esun');
    assert.equal(await page.locator('#passwordField').isVisible(), false);
    assert.ok((await page.locator('#pdfFile').getAttribute('accept')).includes('.xlsx'));
    assert.equal(await page.locator('#pdfColumns').isVisible(), false);
  });
  await check('XLSX worker loads locally, finds correct sheet and maps independent fee column', async () => {
    await load();
    assert.equal(await page.locator('#excelSheet').inputValue(), '1');
    assert.equal(await page.locator('#excel-expense').inputValue(), '3');
    assert.equal(await page.locator('#excel-fee').inputValue(), '4');
    assert.equal(await page.locator('#excel-income').inputValue(), '5');
    await parse();
    assert.equal(await page.locator('#rows tr').count(), 2, await page.locator('#status').innerText());
    assert.ok((await page.locator('#validation').innerText()).includes('完整餘額檢查：通過'));
    assert.equal(await page.locator('#textDetails').isVisible(), false);
  });
  await check('real legacy XLS workbook has same dates, times and amounts', async () => {
    await load('synthetic.xls');
    await parse();
    const t = await page.locator('#rows tr').first().innerText();
    assert.ok(t.includes('2026-09-02'));
    assert.ok(t.includes('12:30:01'));
    assert.ok(t.includes('1,100.00'));
    assert.ok((await page.locator('#validation').innerText()).includes('完整餘額檢查：通過'));
  });
  await check('fee on a deposit stays separate instead of becoming both directions', async () => {
    await load('with-fee.xlsx');
    await parse();
    const cells = await page.locator('#rows tr').first().locator('td').allTextContents();
    assert.equal(cells[3], '0.00');
    assert.equal(cells[4], '100.00');
    assert.equal(cells[5], '15.00');
    assert.ok(!cells.join('').includes('同時有收入與支出'));
    assert.ok(cells.join('').includes('手續費需確認'));
  });
  await check('explicit JSON/CSV downloads preserve source and fee without automatic upload', async () => {
    await page.locator('#confirmExport').check();
    let d = page.waitForEvent('download');
    await page.locator('#json').click();
    const download = await d;
    await download.saveAs(path.join(output, 'synthetic-preview.json'));
    const j = JSON.parse(await fs.readFile(path.join(output, 'synthetic-preview.json'), 'utf8'));
    assert.equal(j.sourceType, 'excel');
    assert.equal(j.transactions[0].feeCents, 1500);
    d = page.waitForEvent('download');
    await page.locator('#csv').click();
    await (await d).saveAs(path.join(output, 'synthetic-preview.csv'));
    assert.ok((await fs.readFile(path.join(output, 'synthetic-preview.csv'), 'utf8')).includes('"fee"'));
  });
  await check('conflicting mapping is rejected and can be corrected without reselecting file', async () => {
    await load();
    await page.locator('#excel-income').selectOption('3');
    await parse();
    assert.ok((await page.locator('#status').innerText()).includes('不可對應到同一欄'));
    await page.locator('#excel-income').selectOption('5');
    await parse();
    assert.equal(await page.locator('#rows tr').count(), 2);
  });
  await check('switching sources clears prior rows, input file and mapping state', async () => {
    await page.locator('[data-nav=import]').click();
    await page.locator('#bank').selectOption('ctbc');
    assert.equal(await page.locator('#passwordField').isVisible(), true);
    assert.equal(await page.locator('#rows tr').count(), 0);
    assert.equal(await page.locator('#pdfFile').inputValue(), '');
    assert.equal(await page.locator('#excelMapping select').count(), 0);
  });
  await check(
    'Excel worker and library remain available offline without restoring prior transactions',
    async () => {
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
      await load();
      await parse();
      await ctx.setOffline(true);
      await page.reload();
      await page.locator('[data-nav=import]').click();
      await page.waitForFunction(() => !document.getElementById('parse').disabled);
      assert.equal(await page.locator('#rows tr').count(), 0);
      await load();
      await parse();
      assert.equal(await page.locator('#rows tr').count(), 2);
      await ctx.setOffline(false);
    }
  );
  await check('mobile Excel file picker, mapping and cards fit without page overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-nav=import]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(output, 'mobile-excel-import.png'), fullPage: true });
    await page.locator('[data-nav=transactions]').click();
    assert.equal(await page.locator('#mobileRows article').count(), 2);
    await page.screenshot({ path: path.join(output, 'mobile-excel-preview.png'), fullPage: true });
  });
  await check('cache and browser storage exclude workbook bytes, private rows and file names', async () => {
    const r = await page.evaluate(async () => {
      let privateData = false,
        workbooks = false;
      for (const key of await caches.keys()) {
        const c = await caches.open(key);
        for (const req of await c.keys()) {
          if (/\.(xls|xlsx)(?:$|\?)/i.test(req.url)) workbooks = true;
          const text = await (await c.match(req)).text();
          if (text.includes('PRIVATE_EXCEL_7931') || text.includes('synthetic.xlsx')) privateData = true;
        }
      }
      return {
        privateData,
        workbooks,
        local: localStorage.length,
        session: sessionStorage.length,
        cookie: document.cookie
      };
    });
    assert.deepEqual(r, { privateData: false, workbooks: false, local: 0, session: 0, cookie: '' });
  });
  await check('observed requests are public same-origin GET only, without body or query', async () => {
    for (const r of requests) {
      const u = new URL(r.url);
      assert.equal(r.method, 'GET');
      assert.equal(r.body, null);
      assert.equal(u.origin, origin);
      assert.equal(u.search, '');
      assert.ok(allowed.has(u.pathname.slice(base.length)), u.pathname);
    }
    assert.deepEqual(errors, []);
  });
  const report = {
    version: '0.4.0',
    browser: 'Windows Chrome ' + browser.version(),
    fixtures: 'fabricated workbooks only',
    iphoneSafari: 'not tested',
    android: 'not tested',
    results,
    network: {
      requests: requests.length,
      dataRequests: requests.filter(r => r.body || new URL(r.url).search).length
    },
    pageErrors: errors
  };
  await fs.writeFile(path.join(output, 'excel-browser-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
  process.exit(results.some(r => r.status === 'fail') ? 1 : 0);
})().catch(async e => {
  console.error(e);
  await browser?.close();
  server.close();
  process.exit(1);
});
