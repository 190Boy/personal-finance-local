import test from 'node:test';
import assert from 'node:assert/strict';
import {REMEMBER_KEY,rememberedAccount,rememberAccount} from '../cloud/login-preferences.mjs';
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),values};};
test('no account is remembered by default',()=>assert.equal(rememberedAccount(memory()),''));
test('only an email is persisted',()=>{const s=memory();assert.equal(rememberAccount(s,'sample@example.com'),true);assert.deepEqual(JSON.parse(s.getItem(REMEMBER_KEY)),{email:'sample@example.com'});assert.equal(rememberedAccount(s),'sample@example.com');assert.equal(s.values.size,1);});
test('forget removes the identity',()=>{const s=memory();rememberAccount(s,'sample@example.com');rememberAccount(s,'');assert.equal(s.values.size,0);});
test('malformed settings never become a login hint',()=>{const s=memory();for(const v of ['invalid','null','{"email":123}','{"email":"not an email"}']){s.setItem(REMEMBER_KEY,v);assert.equal(rememberedAccount(s),'');}});
test('blocked storage does not prevent connection',()=>{const s={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};assert.equal(rememberedAccount(s),'');assert.equal(rememberAccount(s,'sample@example.com'),false);assert.equal(rememberedAccount(null),'');});
