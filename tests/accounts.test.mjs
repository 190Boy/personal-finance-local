import test from 'node:test';
import assert from 'node:assert/strict';
import {savedAccounts} from '../cloud/accounts.mjs';
test('saved account names are unique and separated by bank',()=>{assert.deepEqual(savedAccounts([['a','玉山銀行','主要'],['b','玉山銀行','主要'],['c','中國信託','主要'],['d','玉山銀行','儲蓄'],['e','',''],['f','玉山銀行','  ']]),{'玉山銀行':['主要','儲蓄'].sort((a,b)=>a.localeCompare(b,'zh-Hant')),'中國信託':['主要']});});
