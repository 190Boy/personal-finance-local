const {chromium}=require('playwright');
const assert=require('assert/strict'),path=require('path'),fs=require('fs');
const ROOT=path.resolve(__dirname,'..'),BASE=process.env.FINANCE_TEST_URL||'http://127.0.0.1:4178';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const page=await browser.newPage({serviceWorkers:'block'}),sheets=[],rows={},errors=[];let appendCount=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/pdf-parser/extract.mjs',r=>r.fulfill({contentType:'text/javascript',body:'export const PDFJS_VERSION="test";'}));
 await page.route('https://accounts.google.com/gsi/client',r=>r.fulfill({contentType:'text/javascript',body:`window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:o=>(window.testClientId=o.client_id,{requestAccessToken:()=>o.callback({access_token:'synthetic-token',expires_in:window.testExpires||3600,scope:'https://www.googleapis.com/auth/drive.file'})})}}};`}));
 await page.route('https://www.googleapis.com/**',async route=>{
  const req=route.request();assert.ok(!(req.postData()||'').includes('synthetic-only'));
  const body=req.url().includes('/about?')?{user:{displayName:'測試使用者',emailAddress:'synthetic@example.com',photoLink:'https://lh3.googleusercontent.com/test-avatar'}}:req.method()==='POST'?{id:'test-sheet',name:'我的理財紀錄',webViewLink:'https://docs.google.com/spreadsheets/d/test-sheet/edit'}:{files:[]};
  await route.fulfill({headers:{'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,PUT,OPTIONS'},contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.route('https://lh3.googleusercontent.com/test-avatar',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52"><rect width="52" height="52" fill="blue"/></svg>'}));
 await page.route('https://sheets.googleapis.com/**',async route=>{
  const req=route.request(),url=req.url(),method=req.method();let output={};
  assert.ok(!(req.postData()||'').includes('synthetic-only'));
  if(url.includes('/values/')){
   const range=decodeURIComponent(url.split('/values/')[1].split('?')[0]),tab=range.split("'")[1];
   if(method==='PUT')rows[tab]=JSON.parse(req.postData()).values;
   else output={values:rows[tab]||[]};
  }else if(method==='GET')output={sheets:sheets.map(properties=>({properties}))};
  else{
   const body=JSON.parse(req.postData());
   for(const r of body.requests){
    if(r.addSheet)sheets.push({...r.addSheet.properties,sheetId:sheets.length+1});
    if(r.appendCells){appendCount++;const tab=sheets.find(s=>s.sheetId===r.appendCells.sheetId).title;rows[tab].push(...r.appendCells.rows.map(r=>r.values.map(v=>v.userEnteredValue.stringValue??v.userEnteredValue.numberValue)));}
   }
  }
  await route.fulfill({headers:{'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,PUT,OPTIONS'},contentType:'application/json',body:JSON.stringify(output)});
 });
 await page.goto(BASE+'/web/#settings');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('工具已就緒'));
 assert.equal(await page.locator('#googleClientId').count(),0);
 await page.waitForFunction(()=>!!window.google?.accounts);await page.click('#connectGoogle');
 await page.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.startsWith('Google 已連接'),null,{timeout:7000}).catch(async e=>{console.log('Cloud status:',await page.textContent('#cloudStatus'));throw e;});
 assert.equal(await page.textContent('#connectGoogle'),'登出');assert.equal(await page.textContent('#googleAccountName'),'測試使用者');assert.equal(await page.textContent('#googleAccountEmail'),'synthetic@example.com');assert.equal(await page.locator('#googleAvatar').isVisible(),true);
 await page.evaluate(()=>location.hash='bank-import');await page.selectOption('#bank','esun');await page.fill('#account','測試帳戶');
 const X=require(path.join(ROOT,'web/vendor/sheetjs/xlsx.full.min.js')),OC=require(path.join(ROOT,'web/vendor/officecrypto/officecrypto.min.js'));const wb=X.utils.book_new();X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([['交易日期','摘要','提','存','帳戶餘額'],['2026/10/01','虛構',10,0,90]]),'Synthetic');const input=OC.encrypt(X.write(wb,{type:'buffer',bookType:'xlsx'}),{password:'synthetic-only',type:'standard'});await page.setInputFiles('#pdfFile',{name:'synthetic.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(input)});await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('需要開啟密碼'));
 await page.fill('#password','synthetic-only');await page.click('#parse');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('請確認欄位對應'));
 await page.click('#parse');await page.waitForFunction(()=>document.querySelector('#syncNotice').textContent.includes('新增 1 筆'));
 assert.equal(rows['銀行存款'].length,2);assert.equal(rows['匯入紀錄'].length,2);assert.equal(rows['銀行存款'][1][1],'玉山銀行');
 await page.click('#syncCloud');await page.waitForFunction(()=>document.querySelector('#syncNotice').textContent.includes('已記錄'));
 assert.equal(appendCount,2);
 assert.equal(await page.inputValue('#syncAccountSelect'),'測試帳戶');assert.equal(await page.inputValue('#existingAccount'),'測試帳戶');await page.fill('#syncAccount','新的測試帳戶');assert.equal(await page.inputValue('#account'),'新的測試帳戶');await page.selectOption('#syncAccountSelect','測試帳戶');assert.equal(await page.inputValue('#account'),'測試帳戶');
 await page.evaluate(()=>location.hash='bank-import');await page.selectOption('#bank','ctbc');assert.equal(await page.inputValue('#account'),'');await page.selectOption('#bank','esun');assert.equal(await page.inputValue('#account'),'測試帳戶');
 await page.evaluate(()=>location.hash='home');assert.ok((await page.textContent('#bankDeposit')).includes('90.00'));
 await page.evaluate(()=>location.hash='settings');await page.click('#connectGoogle');assert.equal(await page.textContent('#connectGoogle'),'連接 Google');assert.equal(await page.locator('#googleAccount').isVisible(),false);assert.equal(await page.textContent('#googleAccountEmail'),'');assert.equal(await page.getAttribute('#googleAvatar','src'),null);assert.equal(await page.textContent('#bankDeposit'),'尚未同步');
 const stored=await page.evaluate(()=>Object.keys(localStorage));assert.deepEqual(stored,[]);assert.equal(await page.evaluate(()=>window.testClientId),'568410548395-j0o7udch6i3q3g2qsg4ob2k2n3mtkrib.apps.googleusercontent.com');assert.deepEqual(errors,[]);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.evaluate(()=>{window.testExpires=31;});await page.click('#connectGoogle');await page.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.includes('授權已過期'));assert.equal(await page.locator('#googleAccount').isVisible(),false);assert.equal(await page.textContent('#connectGoogle'),'連接 Google');
 console.log('PASS: account name/email/avatar, single logout button, expiry clearing,  mocked OAuth/Drive/Sheets, auto-save from encrypted import, category tab, ledger, repeated save, homepage balance, disconnect, no credential storage and shared Client ID and mobile width.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exit(1);});
