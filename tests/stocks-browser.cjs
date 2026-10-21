const {chromium}=require('playwright'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),base='http://127.0.0.1:4191';
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,base).pathname.replace(/\/$/,'/index.html'));if(!p.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}fs.readFile(p,(e,b)=>{res.writeHead(e?404:200,{'Content-Type':/\.(mjs|js)$/.test(p)?'text/javascript':/html$/.test(p)?'text/html':/css$/.test(p)?'text/css':'application/octet-stream'});res.end(e?'':b);});});
(async()=>{
 await new Promise(r=>server.listen(4191,'127.0.0.1',r));
 const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),headless:true});
 try{
 const page=await browser.newPage({serviceWorkers:'block'}),sheets=[],rows={},errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'text/javascript',body:"window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:o=>({requestAccessToken:()=>o.callback({access_token:'synthetic-token',expires_in:3600})})}}};"}));
 await page.route('https://www.googleapis.com/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(r.request().url().includes('/about?')?{user:{displayName:'合成測試',emailAddress:'synthetic@example.com'}}:r.request().method()==='POST'?{id:'synthetic-sheet'}:{files:[]})}));
 await page.route('https://sheets.googleapis.com/**',async route=>{
  const req=route.request(),url=req.url();let out={};const body=req.postData()?JSON.parse(req.postData()):null;
  if(body){writes.push(JSON.stringify(body));assert.ok(!JSON.stringify(body).includes('synthetic-password'));}
  if(url.includes('/values/')){const tab=decodeURIComponent(url.split('/values/')[1].split('?')[0]).split("'")[1];if(req.method()==='PUT')rows[tab]=body.values;else out={values:rows[tab]||[]};}
  else if(req.method()==='GET')out={sheets:sheets.map(properties=>({properties}))};
  else for(const r of body.requests){if(r.addSheet)sheets.push({...r.addSheet.properties,sheetId:sheets.length+1});if(r.appendCells){const tab=sheets.find(s=>s.sheetId===r.appendCells.sheetId).title;rows[tab].push(...r.appendCells.rows.map(r=>r.values.map(v=>v.userEnteredValue.stringValue??v.userEnteredValue.numberValue)));}}
  await route.fulfill({contentType:'application/json',body:JSON.stringify(out)});
 });
 const i=(str,x,y,w=12)=>({str,x:x*1000,y,w,h:10});
 const items=[i('證券存摺庫存資料-普通餘額',.4,20),i('檔案產製時間：115年10月21日 10:12',.05,40,200),i('證券商名稱：中國信託綜合證券',.4,40,200),i('帳號：1234567890',.05,60,90),i('證券代號',.11,100),i('證券名稱',.2,100),i('收盤價日期',.76,100),i('市值',.86,100),i('1',.07,130),i('1234',.11,130),i('虛構測試股票',.16,130),i('20',.34,130),i('7.50',.7,130),i('115/10/20',.76,130,40),i('150',.86,130)];
 await page.route('**/pdf-parser/extract.mjs',r=>r.fulfill({contentType:'text/javascript',body:'export const PDFJS_VERSION="synthetic";export async function extractLocalPdf(){return '+JSON.stringify({pages:[{number:1,width:1000,height:700,items}],info:{pages:1}})+';}'}));
 await page.goto(base+'/web/#login');await page.waitForFunction(()=>!!window.google?.accounts&&!document.querySelector('#loginGoogle').disabled);await page.click('#loginGoogle');await page.waitForFunction(()=>location.hash==='#home');
 await page.evaluate(()=>location.hash='stocks');await page.setInputFiles('#stockHoldingsFile',{name:'synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-synthetic')});await page.fill('#stockPassword','synthetic-password');await page.fill('#stockAccount','測試券商帳戶');await page.check('#stockTwd');await page.click('#stockParse');await page.waitForFunction(()=>document.querySelector('#stockStatus').textContent.includes('解析完成'));
 assert.equal(await page.inputValue('#stockPassword'),'');assert.equal(await page.locator('#stockSave').isDisabled(),true);assert.equal(rows['匯入紀錄'].length,1);
 await page.check('#stockConfirmed');await page.click('#stockSave');await page.waitForFunction(()=>document.querySelector('#stockStatus').textContent.includes('已儲存'));
 assert.equal(rows['股票快照'],undefined);assert.equal(rows['股票庫存'].length,3);assert.equal(rows['股票異動'].length,1);assert.equal(rows['匯入紀錄'].length,2);assert.equal(rows['股票匯入紀錄'],undefined);assert.equal(rows['匯入紀錄'][1][3],'股票資產');
 assert.equal(writes.some(s=>s.includes('1234567890')),false);await page.click('#stockSave');await page.waitForFunction(()=>document.querySelector('#stockStatus').textContent.includes('已記錄'));assert.equal(rows['股票快照'],undefined);
 await page.evaluate(()=>location.hash='home');assert.ok((await page.textContent('#stockAssets')).includes('150.00'));assert.equal(await page.locator('#assetPie svg').count(),1);
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>location.hash='stocks');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.reload();await page.evaluate(()=>location.hash='login');await page.waitForFunction(()=>!!window.google?.accounts&&!document.querySelector('#loginGoogle').disabled);await page.click('#loginGoogle');await page.waitForFunction(()=>location.hash==='#home');assert.ok((await page.textContent('#stockAssets')).includes('150.00'));
 await page.evaluate(()=>location.hash='settings');await page.click('#connectGoogle');assert.equal(await page.textContent('#stockAssets'),'尚未同步');assert.equal(await page.locator('#assetPie svg').count(),0);assert.deepEqual(errors,[]);
 console.log('PASS: synthetic stock preview, confirmation gate, merged stock inventory and shared import log, retry dedup, homepage chart, re-login reload, logout clearing, no password/raw account in sync, mobile width.');
 }finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(e=>{console.error(e.stack);server.close();process.exitCode=1;});
