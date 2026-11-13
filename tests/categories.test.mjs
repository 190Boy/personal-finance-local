import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORY_TREE, iconOf, mainOf, validCategory } from '../cloud/categories.mjs';

test('spending and income each have their own categories with icons', () => {
  assert.deepEqual(Object.keys(CATEGORY_TREE), ['支出', '收入']);
  assert.equal(iconOf('餐飲／午餐'), '🍜');
  assert.equal(iconOf('不存在'), '📦');
  assert.equal(mainOf('交通／計程車'), '交通');
  assert.ok(validCategory('餐飲／午餐'));
  assert.ok(validCategory('薪資', '收入'));
  assert.ok(!validCategory('薪資', '支出'));
  assert.ok(!validCategory('餐飲／不存在'));
});
