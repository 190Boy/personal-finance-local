// 現金記帳的 Google 試算表：第一次連接時由網站自己建立「現金記帳」，之後每次同步：
// 1. 讀「異動紀錄」（每次新增、修改、刪除各一列，只增不改）與「設定」；
// 2. 和手機上的記帳合併，新的版本勝出；把手機上較新的版本補進「異動紀錄」；
// 3. 依合併結果整份重寫「記帳明細」「月份統計」「設定」「選項」，讓 BOT 只要讀「記帳明細」就是最新狀態。
// 權限只用 drive.file：網站只看得到它自己建立的檔案，看不到雲端硬碟裡的其他檔案。
import {
  LOG_SHEET,
  LOG_HEADERS,
  DETAIL_SHEET,
  MONTH_SHEET,
  SETTING_SHEET,
  OPTION_SHEET,
  LOG_HEADERS_V1,
  latest,
  mergeOptions,
  readOptions,
  optionRows,
  mergeEntries,
  mergeSetting,
  readLog,
  logRow,
  ledger,
  cashNow,
  detailRows,
  monthRows,
  settingRows,
  readSetting
} from './cash.mjs';

export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const APP = 'personal-finance-cash-v1';
export const FILE_NAME = '現金記帳';
const SHEET_ORDER = [DETAIL_SHEET, MONTH_SHEET, SETTING_SHEET, OPTION_SHEET, LOG_SHEET];
const range = (sheet, cell = '') => encodeURIComponent("'" + sheet + "'" + (cell ? '!' + cell : ''));

export class CashStore {
  constructor({ fetcher = (...a) => fetch(...a) } = {}) {
    this.fetcher = fetcher;
    this.token = '';
    this.expires = 0;
    this.epoch = 0;
    this.file = null;
    this.user = null;
  }
  get connected() {
    return !!this.token && Date.now() < this.expires;
  }
  authorize(token, expiresIn) {
    this.epoch++;
    this.token = token;
    this.expires = Date.now() + Math.max(0, Number(expiresIn) - 60) * 1000;
  }
  disconnect() {
    this.epoch++;
    this.token = '';
    this.expires = 0;
    this.file = null;
    this.user = null;
  }
  async api(url, { method = 'GET', body } = {}) {
    if (!this.connected) throw Error('GOOGLE_LOGIN_REQUIRED');
    const epoch = this.epoch,
      controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await this.fetcher(url, {
        method,
        headers: {
          Authorization: 'Bearer ' + this.token,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
      });
    } catch {
      throw Error('GOOGLE_NETWORK');
    } finally {
      clearTimeout(timer);
    }
    if (epoch !== this.epoch) throw Error('GOOGLE_LOGIN_REQUIRED');
    if (response.status === 401) {
      this.disconnect();
      throw Error('GOOGLE_LOGIN_REQUIRED');
    }
    if (!response.ok) throw Error(response.status === 403 ? 'GOOGLE_PERMISSION' : 'GOOGLE_API');
    return response.status === 204 ? {} : response.json();
  }
  async profile() {
    const data = await this.api(DRIVE + '/about?fields=user(displayName,emailAddress,photoLink)');
    return (this.user = data.user || {});
  }
  // Find the spreadsheet this site created before, or create it. `hint` is the ID this device used last time.
  async open(hint = '') {
    const q =
      "trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet' and appProperties has { key='cashApp' and value='" +
      APP +
      "' }";
    const found = await this.api(
      DRIVE +
        '/files?' +
        new URLSearchParams({
          q,
          fields: 'files(id,name,webViewLink,createdTime)',
          orderBy: 'createdTime',
          pageSize: '20'
        })
    );
    const files = found.files || [];
    this.file = files.find(f => f.id === hint) || files[0] || null;
    if (!this.file) {
      this.file = await this.api(DRIVE + '/files?fields=id,name,webViewLink', {
        method: 'POST',
        body: {
          name: FILE_NAME,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          appProperties: { cashApp: APP }
        }
      });
    }
    await this.ensureSheets();
    return this.file;
  }
  async ensureSheets() {
    const id = this.file.id;
    const data = await this.api(SHEETS + '/' + id + '?fields=sheets.properties');
    const sheets = (data.sheets || []).map(s => s.properties);
    const requests = [];
    // A new spreadsheet comes with one empty sheet: rename it instead of leaving a stray 工作表1.
    const spare = sheets.length === 1 && !SHEET_ORDER.includes(sheets[0].title) ? sheets[0] : null;
    SHEET_ORDER.forEach((title, index) => {
      if (sheets.some(s => s.title === title)) return;
      if (spare && title === DETAIL_SHEET)
        requests.push({
          updateSheetProperties: {
            properties: { sheetId: spare.sheetId, title, gridProperties: { frozenRowCount: 1 } },
            fields: 'title,gridProperties.frozenRowCount'
          }
        });
      else
        requests.push({ addSheet: { properties: { title, index, gridProperties: { frozenRowCount: 1 } } } });
    });
    if (requests.length)
      await this.api(SHEETS + '/' + id + ':batchUpdate', { method: 'POST', body: { requests } });
    const log = await this.read(LOG_SHEET);
    // Empty, or a v1.0.0 log without the 渠道 column: write the current header row (old rows read as cash).
    if (!log.length || JSON.stringify(log[0]) === JSON.stringify(LOG_HEADERS_V1))
      await this.api(SHEETS + '/' + id + '/values/' + range(LOG_SHEET, 'A1') + '?valueInputOption=RAW', {
        method: 'PUT',
        body: { values: [LOG_HEADERS] }
      });
  }
  async read(sheet) {
    const data = await this.api(
      SHEETS + '/' + this.file.id + '/values/' + range(sheet) + '?valueRenderOption=UNFORMATTED_VALUE'
    );
    return data.values || [];
  }
  // local: Map of this device's records; localSetting: this device's cash setting (or null).
  // localOptions: Map of this device's own channels and categories.
  async sync(local, localSetting, localOptions = new Map()) {
    if (!this.file) throw Error('GOOGLE_LOGIN_REQUIRED');
    const id = this.file.id;
    const remote = latest(readLog(await this.read(LOG_SHEET)));
    const remoteSetting = readSetting(await this.read(SETTING_SHEET));
    const { merged, upload } = mergeEntries(local, remote);
    const setting = mergeSetting(localSetting, remoteSetting);
    const options = mergeOptions(localOptions, readOptions(await this.read(OPTION_SHEET)));
    if (upload.length)
      await this.api(
        SHEETS +
          '/' +
          id +
          '/values/' +
          range(LOG_SHEET, 'A1') +
          ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
        { method: 'POST', body: { values: upload.map(logRow) } }
      );
    const rows = ledger(merged.values(), setting);
    await this.api(SHEETS + '/' + id + '/values:batchClear', {
      method: 'POST',
      body: { ranges: [DETAIL_SHEET, MONTH_SHEET, SETTING_SHEET, OPTION_SHEET].map(s => "'" + s + "'") }
    });
    await this.api(SHEETS + '/' + id + '/values:batchUpdate', {
      method: 'POST',
      body: {
        valueInputOption: 'RAW',
        data: [
          { range: "'" + DETAIL_SHEET + "'!A1", values: detailRows(rows) },
          { range: "'" + MONTH_SHEET + "'!A1", values: monthRows(rows) },
          { range: "'" + OPTION_SHEET + "'!A1", values: optionRows(options) },
          {
            range: "'" + SETTING_SHEET + "'!A1",
            values: settingRows(setting, cashNow(merged.values(), setting))
          }
        ]
      }
    });
    return { entries: merged, setting, options, uploaded: upload.length, fileId: id };
  }
}
