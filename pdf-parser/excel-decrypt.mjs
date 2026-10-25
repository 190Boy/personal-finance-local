import { readExcel } from './excel-core.mjs';
// Only encrypted OOXML containers enter OfficeCrypto; plain Excel keeps the existing parser.
export async function readExcelWithPassword(bytes, name, XLSX, OfficeCrypto, password = '') {
  if (bytes.byteLength > 25 * 1024 * 1024) throw Error('FILE_TOO_LARGE');
  const data = new Uint8Array(bytes);
  const ole = data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0;
  if (!ole || !name.toLowerCase().endsWith('.xlsx')) return readExcel(bytes, name, XLSX);
  let info, pack;
  try {
    const cfb = XLSX.CFB.read(data, { type: 'array' });
    info = XLSX.CFB.find(cfb, 'EncryptionInfo')?.content;
    pack = XLSX.CFB.find(cfb, 'EncryptedPackage')?.content;
  } catch {
    throw Error('EXCEL_READ_FAILED');
  }
  if (!info || !pack) throw Error('EXCEL_FORMAT');
  info = new Uint8Array(info);
  pack = new Uint8Array(pack);
  if (info.length < 12 || info.length > 65536 || pack.length < 8) throw Error('EXCEL_READ_FAILED');
  const header = new DataView(info.buffer, info.byteOffset, info.byteLength);
  const major = header.getUint16(0, true),
    minor = header.getUint16(2, true);
  if (!([2, 3, 4].includes(major) && minor === 2) && !(major === 4 && minor === 4))
    throw Error('EXCEL_ENCRYPTION_UNSUPPORTED');
  if (minor === 2) {
    if (
      info.length < 44 ||
      header.getUint32(20, true) !== 0x660e ||
      header.getUint32(24, true) !== 0x8004 ||
      header.getUint32(28, true) !== 128
    )
      throw Error('EXCEL_ENCRYPTION_UNSUPPORTED');
  } else {
    const xml = new TextDecoder().decode(info.subarray(8));
    const spin = Number(xml.match(/\bspinCount="(\d+)"/)?.[1]);
    if (!Number.isSafeInteger(spin) || spin < 0 || spin > 1000000)
      throw Error('EXCEL_ENCRYPTION_UNSUPPORTED');
  }
  const size = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  if (size.getUint32(4, true) !== 0 || size.getUint32(0, true) > 25 * 1024 * 1024) throw Error('EXCEL_LIMIT');
  if (!password) throw Error('EXCEL_PASSWORD_REQUIRED');
  if (password.length > 255) throw Error('EXCEL_PASSWORD_LENGTH');
  let decrypted;
  try {
    try {
      decrypted = await OfficeCrypto.decrypt(data, { password });
    } catch (e) {
      throw Error(/password.*incorrect/i.test(e.message) ? 'EXCEL_WRONG_PASSWORD' : 'EXCEL_DECRYPT_FAILED');
    }
    if (decrypted[0] !== 80 || decrypted[1] !== 75) throw Error('EXCEL_DECRYPT_FAILED');
    return readExcel(decrypted, name, XLSX);
  } finally {
    password = '';
    decrypted?.fill(0);
  }
}
