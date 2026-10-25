import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readExcelWithPassword } from '../pdf-parser/excel-decrypt.mjs';
const require = createRequire(import.meta.url);
const XLSX = require('../web/vendor/sheetjs/xlsx.full.min.js');
const OfficeCrypto = require('../web/vendor/officecrypto/officecrypto.min.js');
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  book,
  XLSX.utils.aoa_to_sheet([
    ['交易日期', '摘要', '提', '存', '帳戶餘額'],
    ['2026/10/01', '虛構測試', 10, 0, 90]
  ]),
  'Synthetic'
);
const plain = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
const password = 'synthetic-only';
for (const type of ['standard', 'agile']) {
  const encrypted = OfficeCrypto.encrypt(plain, { password, ...(type === 'standard' ? { type } : {}) });
  test(type + ': asks for a password before decrypting', async () => {
    await assert.rejects(
      readExcelWithPassword(encrypted, 'synthetic.xlsx', XLSX, OfficeCrypto),
      /EXCEL_PASSWORD_REQUIRED/
    );
  });
  test(type + ': wrong password is distinct from format failure and permits retry', async () => {
    await assert.rejects(
      readExcelWithPassword(encrypted, 'synthetic.xlsx', XLSX, OfficeCrypto, 'wrong'),
      /EXCEL_WRONG_PASSWORD/
    );
    const book = await readExcelWithPassword(encrypted, 'synthetic.xlsx', XLSX, OfficeCrypto, password);
    assert.equal(book.sheets[0].rows[1].cells[1], '虛構測試');
  });
}
test('plain XLSX continues to work without a password', async () => {
  const book = await readExcelWithPassword(plain, 'synthetic.xlsx', XLSX, OfficeCrypto);
  assert.equal(book.sheets[0].rows.length, 2);
});
test('unsupported encryption version is not reported as a bad password', async () => {
  const cfb = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(cfb, 'EncryptionInfo', new Uint8Array([4, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  XLSX.CFB.utils.cfb_add(cfb, 'EncryptedPackage', new Uint8Array(24));
  const bytes = XLSX.CFB.write(cfb, { type: 'buffer' });
  await assert.rejects(
    readExcelWithPassword(bytes, 'synthetic.xlsx', XLSX, OfficeCrypto, password),
    /EXCEL_ENCRYPTION_UNSUPPORTED/
  );
});
