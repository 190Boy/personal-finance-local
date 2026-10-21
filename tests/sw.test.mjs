import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
const code=await fs.readFile(new URL('../sw.js',import.meta.url),'utf8');
const handlers={};
const context=vm.createContext({URL,Request,Set,self:{location:{href:'https://example.github.io/personal-finance-local/sw.js'},addEventListener:(n,f)=>handlers[n]=f}});
vm.runInContext(code,context);
const accepts=(url,options)=>vm.runInContext('safe',context)(new Request(url,options));
test('Service Worker accepts only public resources within this repository path',()=>{
 assert.equal(accepts('https://example.github.io/personal-finance-local/web/app.mjs'),true);
 assert.equal(accepts('https://example.github.io/personal-finance-local/web/'),true);
 for(const url of [
 'https://example.github.io/other/web/app.mjs',
 'https://evil.test/personal-finance-local/web/app.mjs',
 'https://example.github.io/personal-finance-local/bank.pdf',
 'https://example.github.io/personal-finance-local/transactions.json',
 'https://example.github.io/personal-finance-local/oauth/callback',
 'https://www.googleapis.com/drive/v3/files',
 'https://example.github.io/personal-finance-local/web/app.mjs?token=synthetic',
 'blob:https://example.github.io/fixture'
 ])assert.equal(accepts(url),false,url);
});
test('authenticated, partial and non-GET requests never enter the cache handler',()=>{
 const url='https://example.github.io/personal-finance-local/web/app.mjs';
 assert.equal(accepts(url,{headers:{Authorization:'Bearer SYNTHETIC'}}),false);
 assert.equal(accepts(url,{headers:{Range:'bytes=0-5'}}),false);
 assert.equal(accepts(url,{method:'POST',body:'synthetic test data'}),false);
 assert.equal(accepts(url,{method:'HEAD'}),false);
});
test('bypassed requests are not intercepted',()=>{
 let intercepted=false;
 handlers.fetch({request:new Request('https://example.github.io/personal-finance-local/bank.pdf'),respondWith(){intercepted=true;}});
 assert.equal(intercepted,false);
});
test('allowlist contains no sensitive formats, APIs or user data stores',()=>{
 const files=vm.runInContext('FILES',context);
 assert.ok(files.length>150);
 assert.ok(files.includes('web/manifest.webmanifest'));
 assert.ok(files.includes('cloud/dedup.mjs'));
 assert.ok(files.includes('cloud/stock-layout.mjs'));
 assert.ok(files.includes('web/icons/icon-180.png'));
 assert.ok(!files.some(f=>/\.pdf$|\.csv$|oauth|transactions|legacy-gas|source-wallet|test-results/i.test(f)));
 assert.ok(!code.includes('skipWaiting('));
 assert.ok(!code.includes('cache.put('));
});

test('known client routes work offline without caching arbitrary OAuth fragments',()=>{
 assert.equal(accepts('https://example.github.io/personal-finance-local/web/#transactions'),true);
 assert.equal(accepts('https://example.github.io/personal-finance-local/web/#stocks'),true);
 assert.equal(accepts('https://example.github.io/personal-finance-local/web/#cards'),true);
 assert.equal(accepts('https://example.github.io/personal-finance-local/web/#bank-import'),true);
 assert.equal(accepts('https://example.github.io/personal-finance-local/web/#access_token=synthetic'),false);
});
