import {
  CARD_HEADERS,
  cardSummary,
  cardHistory,
  cardRowsToAppend,
  cardTable,
  cardSheetRows
} from './credit-cards.mjs';
import { rowsToAppend } from './dedup.mjs';
import { INVOICE_HEADERS, invoiceTable, invoiceRowsToAppend, invoiceSheetRows } from './invoices.mjs';
import { HABIT_HEADERS, DEFAULT_HABITS, DECISION_HEADERS, readHabits, computeMatches } from './matching.mjs';
import {
  LINEPAY_HEADERS,
  linePayTable,
  linePayRowsToAppend,
  linePaySheetRows,
  linePayEvents,
  walletGaps
} from './linepay.mjs';
import { MANUAL_HEADERS, manualTable, manualSheetRows, manualEntries, manualHistoryRow } from './manual.mjs';
import { mergeStockTables } from './stock-layout.mjs';
import { ledgerPlan, migrationId } from './ledger.mjs';
import { cloudHistory } from './history.mjs';
import { STOCK_SCHEMAS, stockSummary } from './stocks.mjs';
import { savedAccounts } from './accounts.mjs';
import { HEADERS, IMPORT_HEADERS, BANK_TABS, bankSummary } from './records.mjs';
export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const APP = 'personal-finance-local-v1',
  DRIVE = 'https://www.googleapis.com/drive/v3',
  SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const literal = value =>
  typeof value === 'number' ? { numberValue: value } : { stringValue: String(value ?? '') };
const readReason = e =>
  ({
    CARD_AMOUNT: '信用卡金額或單位無法安全辨識，未改寫',
    SHEET_SCHEMA: '工作表欄位與版本不符',
    GOOGLE_PERMISSION: 'Google 權限不足',
    GOOGLE_NETWORK: '連線未完成',
    GOOGLE_API: 'Google 未完成操作',
    CLOUD_ROW_LIMIT: '資料超過目前讀取上限'
  })[e.message] || '暫時無法讀取';
const cardFormats = sheetId =>
  [11, 15, 16].map(i => ({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0.00' } } },
      fields: 'userEnteredFormat.numberFormat'
    }
  }));
const CARD_UNITS_GUARD = {
  metadataId: 2000000000,
  metadataKey: 'fw2',
  metadataValue: 'cards-yuan-v1',
  visibility: 'DOCUMENT',
  location: { spreadsheet: true }
};
const cells = rows => rows.map(row => ({ values: row.map(value => ({ userEnteredValue: literal(value) })) }));
// Spreadsheet developer metadata is size-capped, so coordination markers must not grow forever.
// The newest KEEP_REVISIONS revision markers are kept: a writer that read revision R can only be wrongly
// accepted if marker R+1 was created and later deleted, which needs KEEP_REVISIONS writes during one attempt.
const KEEP_REVISIONS = 20,
  PRUNE_LIMIT = 1000,
  METADATA_BUDGET = 28000;
// Per-import markers written up to v0.7.1; the revision marker already serializes every writer.
const LEGACY_IMPORT_KEYS = new Set(['financeImport', 'financeStockImport', 'financeStockSnapshot']);
const metadataSize = m => (m.metadataKey || '').length + (m.metadataValue || '').length;
export class GoogleStore {
  constructor({ fetcher = (...args) => globalThis.fetch(...args) } = {}) {
    this.fetcher = fetcher;
    this.token = '';
    this.expires = 0;
    this.file = null;
    this.sheets = [];
    this.user = null;
    this.saving = false;
    this.epoch = 0;
  }
  authorize(token, expires) {
    this.disconnect();
    this.token = token;
    this.expires = Date.now() + Math.max(0, Number(expires) - 30) * 1000;
  }
  disconnect() {
    this.epoch++;
    this.token = '';
    this.expires = 0;
    this.file = null;
    this.sheets = [];
    this.user = null;
  }
  get connected() {
    return !!this.token && Date.now() < this.expires;
  }
  async api(url, { method = 'GET', body } = {}) {
    if (!this.connected) throw Error('GOOGLE_LOGIN_REQUIRED');
    const epoch = this.epoch;
    const controller = new AbortController(),
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
    this.user = data.user || {};
    return this.user;
  }
  async open() {
    const query =
      "trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet' and appProperties has { key='financeApp' and value='" +
      APP +
      "' }";
    const found = await this.api(
      DRIVE +
        '/files?' +
        new URLSearchParams({ q: query, fields: 'files(id,name,webViewLink),nextPageToken', pageSize: '100' })
    );
    const files = found.files || [];
    if (found.nextPageToken || files.length > 1) throw Error('MULTIPLE_SPREADSHEETS');
    this.file =
      files[0] ||
      (await this.api(DRIVE + '/files?fields=id,name,webViewLink', {
        method: 'POST',
        body: {
          name: '我的理財紀錄',
          mimeType: 'application/vnd.google-apps.spreadsheet',
          appProperties: { financeApp: APP }
        }
      }));
    await this.metadata();
    return this.file;
  }
  async metadata() {
    if (!this.file) throw Error('GOOGLE_LOGIN_REQUIRED');
    const data = await this.api(
      SHEETS + '/' + encodeURIComponent(this.file.id) + '?fields=sheets.properties'
    );
    this.sheets = (data.sheets || []).map(s => s.properties);
  }
  async ensure(tab, headers) {
    let sheet = this.sheets.find(s => s.title === tab);
    if (!sheet) {
      let failure = null;
      try {
        await this.api(SHEETS + '/' + this.file.id + ':batchUpdate', {
          method: 'POST',
          body: {
            requests: [{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } }]
          }
        });
      } catch (e) {
        failure = e;
      }
      await this.metadata();
      sheet = this.sheets.find(s => s.title === tab);
      if (!sheet) throw failure || Error('GOOGLE_API');
    }
    const rows = await this.read(tab);
    if (!rows.length) {
      await this.api(
        SHEETS +
          '/' +
          this.file.id +
          '/values/' +
          encodeURIComponent("'" + tab + "'!A1") +
          '?valueInputOption=RAW',
        { method: 'PUT', body: { values: [headers] } }
      );
    } else if (JSON.stringify(rows[0]) !== JSON.stringify(headers)) throw Error('SHEET_SCHEMA');
    return sheet;
  }
  async read(tab) {
    if (!this.sheets.some(s => s.title === tab)) return [];
    const data = await this.api(
      SHEETS +
        '/' +
        this.file.id +
        '/values/' +
        encodeURIComponent("'" + tab + "'!A:Z") +
        '?valueRenderOption=UNFORMATTED_VALUE'
    );
    const rows = data.values || [];
    if (rows.length > 100001) throw Error('CLOUD_ROW_LIMIT');
    return rows;
  }

  async unifiedLog() {
    if (!this.sheets.some(s => s.title === '匯入紀錄')) await this.ensure('匯入紀錄', IMPORT_HEADERS);
    let current = await this.read('匯入紀錄');
    if (!current.length) {
      await this.ensure('匯入紀錄', IMPORT_HEADERS);
      current = await this.read('匯入紀錄');
    }
    const legacy = await this.read('股票匯入紀錄'),
      plan = ledgerPlan(current, legacy),
      oldSheet = this.sheets.find(s => s.title === '股票匯入紀錄');
    const hide = oldSheet && !oldSheet.hidden;
    if (!plan.rewriteHeader && !plan.rows.length && !hide)
      return this.sheets.find(s => s.title === '匯入紀錄');
    const sheet = this.sheets.find(s => s.title === '匯入紀錄'),
      fileId = this.file.id;
    const requests = [
      {
        createDeveloperMetadata: {
          developerMetadata: {
            metadataId: await migrationId(fileId, { ...plan, hide: !!hide }),
            metadataKey: 'financeUnifiedLog',
            metadataValue: 'v1',
            visibility: 'DOCUMENT',
            location: { spreadsheet: true }
          }
        }
      }
    ];
    if (plan.rewriteHeader)
      requests.push({
        updateCells: {
          range: {
            sheetId: sheet.sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: IMPORT_HEADERS.length
          },
          rows: cells([IMPORT_HEADERS]),
          fields: 'userEnteredValue'
        }
      });
    if (plan.rows.length)
      requests.push({
        appendCells: { sheetId: sheet.sheetId, rows: cells(plan.rows), fields: 'userEnteredValue' }
      });
    if (hide)
      requests.push({
        updateSheetProperties: { properties: { sheetId: oldSheet.sheetId, hidden: true }, fields: 'hidden' }
      });
    try {
      await this.api(SHEETS + '/' + fileId + ':batchUpdate', { method: 'POST', body: { requests } });
    } catch (error) {
      const check = ledgerPlan(await this.read('匯入紀錄'), legacy);
      if (check.rewriteHeader || check.rows.length) throw error;
    }
    await this.metadata();
    return this.sheets.find(s => s.title === '匯入紀錄');
  }

  async summary() {
    let rows = [],
      warnings = [];
    for (const tab of BANK_TABS) {
      const values = await this.read(tab);
      if (values.length && JSON.stringify(values[0]) !== JSON.stringify(HEADERS)) throw Error('SHEET_SCHEMA');
      rows.push(...values.slice(1));
    }
    let moves = [];
    try {
      moves = await this.stockMovements();
    } catch (e) {
      if (e.message === 'GOOGLE_LOGIN_REQUIRED') throw e;
      warnings.push('股票異動讀取失敗：' + readReason(e));
    }
    let stocks = { totalCents: 0, accounts: [], pending: [] };
    try {
      await this.unifiedLog();
      await this.mergedStocks();
      const values = await this.read('股票庫存');
      if (values.length && JSON.stringify(values[0]) !== JSON.stringify(STOCK_SCHEMAS['股票庫存']))
        throw Error('SHEET_SCHEMA');
      stocks = stockSummary({ 股票庫存: values.slice(1) });
    } catch (e) {
      if (e.message === 'GOOGLE_LOGIN_REQUIRED') throw e;
      warnings.push('股票資產或紀錄轉換尚未完成：' + readReason(e));
      stocks.pending.push({ account: '股票資料', reason: '載入或轉換失敗，未列入合計' });
    }
    let cardRowsForMatching = [];
    let credits = { totalCents: 0, accounts: [], pending: [] },
      creditHistory = { rows: [], duplicates: 0 };
    try {
      await this.cardCurrency();
      const values = cardTable(await this.read('信用卡')).rows;
      cardRowsForMatching = values;
      credits = cardSummary(values);
      creditHistory = cardHistory(values);
    } catch (e) {
      if (e.message === 'GOOGLE_LOGIN_REQUIRED') throw e;
      warnings.push('信用卡讀取未完成：' + readReason(e));
      credits.pending.push({ bank: '信用卡', account: '', reason: '載入失敗' });
    }
    let matching = null,
      manual = [];
    try {
      manual = manualEntries(manualTable(await this.read('手動記帳')));
    } catch (e) {
      if (e.message === 'GOOGLE_LOGIN_REQUIRED') throw e;
      warnings.push('手動記帳讀取未完成：' + readReason(e));
    }
    try {
      if (this.sheets.some(s => ['發票', 'LINE Pay', '手動記帳'].includes(s.title))) {
        const events = linePayEvents(linePayTable(await this.read('LINE Pay')));
        matching = computeMatches({
          invoiceRows: invoiceTable(await this.read('發票')),
          cardRows: cardRowsForMatching,
          bankRows: rows,
          habits: readHabits(await this.read('付款習慣')),
          decisionRows: await this.read('配對紀錄'),
          linePayEvents: events,
          wallet: events.length ? walletGaps(events, rows) : null,
          manualEntries: manual
        });
      }
    } catch (e) {
      if (e.message === 'GOOGLE_LOGIN_REQUIRED') throw e;
      warnings.push('發票配對讀取未完成：' + readReason(e));
    }
    const history = cloudHistory(rows, moves);
    history.rows.push(...creditHistory.rows);
    history.rows.sort(
      (a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.ordinal - a.ordinal
    );
    history.duplicates += creditHistory.duplicates;
    manual.forEach((e, n) => history.rows.push(manualHistoryRow(e, n)));
    if (!matching)
      history.rows.sort(
        (a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.ordinal - a.ordinal
      );
    if (matching) {
      // Wallet payments and the gaps the user explained are spending the statements never show.
      matching.walletRecords.forEach((r, n) =>
        history.rows.push({
          kind: 'LINE Pay',
          id: r.key.slice('linepay:'.length),
          source: 'LINE Pay',
          account: '錢包',
          date: r.date,
          time: r.time,
          code: '',
          summary: r.summary,
          expense: r.amountCents / 100,
          income: null,
          fee: null,
          balance: null,
          review: '錢包付款',
          conflict: false,
          ordinal: n,
          financial: r.key
        })
      );
      for (const g of matching.wallet?.gaps || [])
        // A gap explained by a hand-entered record is already in the history through that record.
        if (g.label && g.label !== '已手動補記')
          history.rows.push({
            kind: 'LINE Pay',
            id: g.id,
            source: 'LINE Pay',
            account: '錢包',
            date: g.to.date,
            time: g.to.time,
            code: '',
            summary: g.label + '（錢包餘額落差，' + g.from.date.slice(5) + '～' + g.to.date.slice(5) + '）',
            expense: g.direction === 'out' ? g.amountCents / 100 : null,
            income: g.direction === 'in' ? g.amountCents / 100 : null,
            fee: null,
            balance: null,
            review: '依錢包餘額推算，沒有通知',
            conflict: false,
            ordinal: 0,
            financial: g.id
          });
      const prefix = { 信用卡: 'card:', 銀行存款: 'bank:', 'LINE Pay': 'linepay:', 手動記帳: 'manual:' };
      for (const h of history.rows) {
        const link = matching.recordLinks.get(prefix[h.kind] + h.id);
        if (link) h.match = link;
      }
      history.rows.sort(
        (a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.ordinal - a.ordinal
      );
    }
    return {
      ...bankSummary(rows),
      accounts: savedAccounts(rows),
      cardAccounts: savedAccounts(cardRowsForMatching.map(r => ['', r[3], r[4]])),
      stocks,
      credits,
      matching,
      manual,
      history: { ...history, warnings }
    };
  }
  async stockMovements() {
    const values = await this.read('股票異動');
    if (values.length && JSON.stringify(values[0]) !== JSON.stringify(STOCK_SCHEMAS['股票異動']))
      throw Error('SHEET_SCHEMA');
    return values.slice(1);
  }
  async saveBankOnce(batch, revision) {
    const epoch = this.epoch,
      fileId = this.file?.id;
    const logSheet = await this.unifiedLog(),
      sheet = await this.ensure(batch.tab, HEADERS);
    let logs = (await this.read('匯入紀錄')).slice(1);
    if (logs.some(row => row[0] === batch.id)) return { added: 0, repeated: true };
    const all = [];
    for (const tab of BANK_TABS) all.push(...(await this.read(tab)).slice(1));
    const { fresh } = rowsToAppend(all, batch.rows);
    const log = [...batch.log];
    log[6] = fresh.length;
    // One atomic batch: rows and import ledger succeed or fail together.
    // The revision marker rejects a concurrent write of the same import; the retry then finds its ledger row.
    const requests = [
      ...this.revisionRequests(revision),
      ...(fresh.length
        ? [{ appendCells: { sheetId: sheet.sheetId, rows: cells(fresh), fields: 'userEnteredValue' } }]
        : []),
      { appendCells: { sheetId: logSheet.sheetId, rows: cells([log]), fields: 'userEnteredValue' } }
    ];
    if (epoch !== this.epoch || fileId !== this.file?.id) throw Error('GOOGLE_LOGIN_REQUIRED');
    try {
      await this.api(SHEETS + '/' + fileId + ':batchUpdate', { method: 'POST', body: { requests } });
    } catch (error) {
      logs = (await this.read('匯入紀錄')).slice(1);
      if (logs.some(row => row[0] === batch.id)) return { added: 0, repeated: true };
      throw error;
    }
    return { added: fresh.length, repeated: false };
  }
  async saveStockOnce(batch, revision) {
    const epoch = this.epoch,
      fileId = this.file?.id;

    const logSheet = await this.unifiedLog(),
      sheets = {};
    for (const [tab, headers] of Object.entries(STOCK_SCHEMAS)) sheets[tab] = await this.ensure(tab, headers);
    const logs = (await this.read('匯入紀錄')).slice(1);
    if (logs.some(r => r[0] === batch.id)) return { repeated: true };
    const existingSnapshots = (await this.read('股票庫存')).slice(1),
      existingMoves = (await this.read('股票異動')).slice(1);
    const hasSnapshot = existingSnapshots.some(
      r => r[1] === batch.snapshotId && ['快照', '空庫存'].includes(r[0])
    );
    // The revision marker serializes concurrent imports; a retry re-reads the ledger and snapshot rows.
    const requests = [...this.revisionRequests(revision)];
    let added = 0;
    for (const [tab, input] of Object.entries(batch.tables)) {
      let rows = input;
      if (hasSnapshot && tab === '股票庫存') rows = [];
      if (tab === '股票異動') rows = rowsToAppend(existingMoves, rows, { kind: 'stock' }).fresh;
      if (['股票庫存', '股票異動'].includes(tab))
        added += rows.filter(r => tab !== '股票庫存' || r[0] === '持股').length;
      if (rows.length)
        requests.push({
          appendCells: { sheetId: sheets[tab].sheetId, rows: cells(rows), fields: 'userEnteredValue' }
        });
    }
    const log = [...batch.log];
    log[6] = added;
    requests.push({
      appendCells: { sheetId: logSheet.sheetId, rows: cells([log]), fields: 'userEnteredValue' }
    });
    if (epoch !== this.epoch || fileId !== this.file?.id) throw Error('GOOGLE_LOGIN_REQUIRED');
    try {
      await this.api(SHEETS + '/' + fileId + ':batchUpdate', { method: 'POST', body: { requests } });
    } catch (e) {
      if ((await this.read('匯入紀錄')).slice(1).some(r => r[0] === batch.id)) return { repeated: true };
      throw e;
    }
    return { repeated: false };
  }

  async mergedStocks() {
    const old = await this.read('股票庫存'),
      snapshots = await this.read('股票快照');
    if (!old.length && !snapshots.length) return null;
    const plan = mergeStockTables(old, snapshots);
    if (!this.sheets.some(s => s.title === '股票庫存'))
      await this.ensure('股票庫存', STOCK_SCHEMAS['股票庫存']);
    const sheet = this.sheets.find(s => s.title === '股票庫存'),
      legacy = this.sheets.find(s => s.title === '股票快照'),
      hide = legacy && !legacy.hidden;
    if (!plan.rewrite && !hide) return sheet;
    const requests = [
      {
        createDeveloperMetadata: {
          developerMetadata: {
            metadataId: await migrationId(this.file.id, { stockMerge: plan, hide: !!hide }),
            metadataKey: 'financeStockMerge',
            metadataValue: 'v2',
            visibility: 'DOCUMENT',
            location: { spreadsheet: true }
          }
        }
      }
    ];
    if (plan.rewrite)
      requests.push({
        updateCells: {
          range: {
            sheetId: sheet.sheetId,
            startRowIndex: 0,
            endRowIndex: Math.max(old.length, plan.rows.length + 1),
            startColumnIndex: 0,
            endColumnIndex: STOCK_SCHEMAS['股票庫存'].length
          },
          rows: cells([STOCK_SCHEMAS['股票庫存'], ...plan.rows]),
          fields: 'userEnteredValue'
        }
      });
    if (hide)
      requests.push({
        updateSheetProperties: { properties: { sheetId: legacy.sheetId, hidden: true }, fields: 'hidden' }
      });
    try {
      await this.api(SHEETS + '/' + this.file.id + ':batchUpdate', { method: 'POST', body: { requests } });
    } catch (error) {
      if (mergeStockTables(await this.read('股票庫存'), snapshots).rewrite) throw error;
    }
    await this.metadata();
    return this.sheets.find(s => s.title === '股票庫存');
  }
  async writeRevision() {
    const data = await this.api(
      SHEETS + '/' + this.file.id + '?fields=developerMetadata(metadataId,metadataKey,metadataValue,location)'
    );
    const all = data.developerMetadata || [],
      entries = all.filter(m => m.location?.spreadsheet);
    let revision = 0;
    this.cardUnitsGuard = false;
    this.prune = null;
    const markers = [];
    for (const m of all)
      if (m.metadataKey === 'fw2') {
        // An explicit schema barrier makes pre-yuan clients refuse stale writes.
        if (
          m.metadataId === CARD_UNITS_GUARD.metadataId &&
          m.metadataValue === CARD_UNITS_GUARD.metadataValue
        ) {
          this.cardUnitsGuard = true;
          continue;
        }
        const value = Number(m.metadataValue);
        if (!Number.isSafeInteger(value) || value < 1 || m.metadataId !== 1000000000 + value)
          throw Error('SYNC_REVISION_INVALID');
        revision = Math.max(revision, value);
        markers.push({ id: m.metadataId, value });
      }
    // Only markers observed in this read are deleted, and only inside the next revision batch:
    // if another writer removed one meanwhile, it also took this revision and the batch is rejected anyway.
    const stale = new Set(markers.filter(m => m.value <= revision + 1 - KEEP_REVISIONS).map(m => m.id));
    const ids = all
        .filter(m => stale.has(m.metadataId) || LEGACY_IMPORT_KEYS.has(m.metadataKey))
        .map(m => m.metadataId)
        .slice(0, PRUNE_LIMIT),
      removing = new Set(ids);
    // Budget what remains after this write's cleanup, so a store already at the cap can still recover.
    if (
      entries.filter(m => !removing.has(m.metadataId)).reduce((s, m) => s + metadataSize(m), 0) >
      METADATA_BUDGET
    )
      throw Error('SYNC_METADATA_LIMIT');
    this.prune = { revision, ids };
    return revision;
  }
  revisionRequests(revision) {
    const ids = this.prune?.revision === revision ? this.prune.ids : [];
    return [
      {
        createDeveloperMetadata: {
          developerMetadata: {
            metadataId: 1000000001 + revision,
            metadataKey: 'fw2',
            metadataValue: String(revision + 1),
            visibility: 'DOCUMENT',
            location: { spreadsheet: true }
          }
        }
      },
      ...ids.map(metadataId => ({
        deleteDeveloperMetadata: { dataFilter: { developerMetadataLookup: { metadataId } } }
      }))
    ];
  }
  async coordinated(write) {
    for (let attempt = 0; attempt < 4; attempt++) {
      // Read revision before reading IDs. An atomic unique marker rejects stale writers.
      const revision = await this.writeRevision();
      try {
        return await write(revision);
      } catch (error) {
        if (!this.connected || error.message === 'GOOGLE_LOGIN_REQUIRED') throw error;
        let latest;
        try {
          latest = await this.writeRevision();
        } catch {
          throw error;
        }
        if (latest <= revision) throw error;
      }
    }
    throw Error('SYNC_RETRY');
  }
  async save(batch) {
    if (this.saving) throw Error('SYNC_BUSY');
    this.saving = true;
    try {
      await this.unifiedLog();
      return await this.coordinated(revision => this.saveBankOnce(batch, revision));
    } finally {
      this.saving = false;
    }
  }
  async saveStocks(batch) {
    if (this.saving) throw Error('SYNC_BUSY');
    this.saving = true;
    try {
      await this.unifiedLog();
      await this.mergedStocks();
      return await this.coordinated(revision => this.saveStockOnce(batch, revision));
    } finally {
      this.saving = false;
    }
  }

  async cardCurrency() {
    if (!this.sheets.some(s => s.title === '信用卡')) return;
    await this.coordinated(async revision => {
      const values = await this.read('信用卡'),
        plan = cardTable(values);
      if (!plan.legacy && this.cardUnitsGuard) return;
      const sheetId = this.sheets.find(s => s.title === '信用卡').sheetId;
      // Header, values and display format migrate together; revision rejects stale writers.
      const requests = [
        ...this.revisionRequests(revision),
        ...(!this.cardUnitsGuard
          ? [{ createDeveloperMetadata: { developerMetadata: CARD_UNITS_GUARD } }]
          : []),
        ...(plan.legacy
          ? [
              {
                updateCells: {
                  range: {
                    sheetId,
                    startRowIndex: 0,
                    endRowIndex: values.length,
                    startColumnIndex: 0,
                    endColumnIndex: CARD_HEADERS.length
                  },
                  rows: cells([CARD_HEADERS, ...cardSheetRows(plan.rows)]),
                  fields: 'userEnteredValue'
                }
              }
            ]
          : []),
        ...cardFormats(sheetId)
      ];
      try {
        await this.api(SHEETS + '/' + this.file.id + ':batchUpdate', { method: 'POST', body: { requests } });
      } catch (error) {
        if (cardTable(await this.read('信用卡')).legacy) throw error;
        await this.writeRevision();
        if (!this.cardUnitsGuard) throw error;
      }
    });
  }

  async saveCards(batch) {
    if (this.saving) throw Error('SYNC_BUSY');
    this.saving = true;
    try {
      await this.unifiedLog();
      if (!this.sheets.some(s => s.title === '信用卡')) await this.ensure('信用卡', CARD_HEADERS);
      await this.cardCurrency();
      return await this.coordinated(async revision => {
        await this.ensure('信用卡', CARD_HEADERS);
        const epoch = this.epoch,
          fileId = this.file?.id,
          logs = (await this.read('匯入紀錄')).slice(1);
        if (logs.some(r => r[0] === batch.id)) return { repeated: true, added: 0 };
        const fresh = cardRowsToAppend(cardTable(await this.read('信用卡')).rows, batch.rows),
          log = [...batch.log];
        log[6] = fresh.filter(r => r[0] === '明細').length;
        const requests = [
          ...this.revisionRequests(revision),
          ...cardFormats(this.sheets.find(s => s.title === '信用卡').sheetId),
          ...(fresh.length
            ? [
                {
                  appendCells: {
                    sheetId: this.sheets.find(s => s.title === '信用卡').sheetId,
                    rows: cells(cardSheetRows(fresh)),
                    fields: 'userEnteredValue'
                  }
                }
              ]
            : []),
          {
            appendCells: {
              sheetId: this.sheets.find(s => s.title === '匯入紀錄').sheetId,
              rows: cells([log]),
              fields: 'userEnteredValue'
            }
          }
        ];
        if (epoch !== this.epoch || fileId !== this.file?.id) throw Error('GOOGLE_LOGIN_REQUIRED');
        try {
          await this.api(SHEETS + '/' + fileId + ':batchUpdate', { method: 'POST', body: { requests } });
        } catch (e) {
          if ((await this.read('匯入紀錄')).slice(1).some(r => r[0] === batch.id))
            return { repeated: true, added: 0 };
          throw e;
        }
        return { repeated: false, added: log[6] };
      });
    } finally {
      this.saving = false;
    }
  }

  async saveInvoices(batch) {
    if (this.saving) throw Error('SYNC_BUSY');
    this.saving = true;
    try {
      await this.unifiedLog();
      return await this.coordinated(async revision => {
        const sheet = await this.ensure('發票', INVOICE_HEADERS);
        const epoch = this.epoch,
          fileId = this.file?.id,
          logs = (await this.read('匯入紀錄')).slice(1);
        if (logs.some(r => r[0] === batch.id)) return { repeated: true, added: 0, skipped: 0, changed: 0 };
        const plan = invoiceRowsToAppend(invoiceTable(await this.read('發票')), batch.rows),
          log = [...batch.log];
        log[6] = plan.added;
        // Invoice rows and the import ledger succeed or fail together; the revision rejects stale writers.
        const requests = [
          ...this.revisionRequests(revision),
          ...(plan.fresh.length
            ? [
                {
                  appendCells: {
                    sheetId: sheet.sheetId,
                    rows: cells(invoiceSheetRows(plan.fresh)),
                    fields: 'userEnteredValue'
                  }
                }
              ]
            : []),
          {
            appendCells: {
              sheetId: this.sheets.find(s => s.title === '匯入紀錄').sheetId,
              rows: cells([log]),
              fields: 'userEnteredValue'
            }
          }
        ];
        if (epoch !== this.epoch || fileId !== this.file?.id) throw Error('GOOGLE_LOGIN_REQUIRED');
        try {
          await this.api(SHEETS + '/' + fileId + ':batchUpdate', { method: 'POST', body: { requests } });
        } catch (e) {
          if ((await this.read('匯入紀錄')).slice(1).some(r => r[0] === batch.id))
            return { repeated: true, added: 0, skipped: 0, changed: 0 };
          throw e;
        }
        return { repeated: false, added: plan.added, skipped: plan.skipped, changed: plan.changed };
      });
    } finally {
      this.saving = false;
    }
  }

  // Matching decisions are append-only; the latest decision per target wins when read back.
  // The habits sheet is created with the default rules on the first decision.
  async saveDecisions(rows) {
    if (this.saving) throw Error('SYNC_BUSY');
    if (!rows.length) return { added: 0 };
    this.saving = true;
    try {
      await this.unifiedLog();
      return await this.coordinated(async revision => {
        const habitsExisted = this.sheets.some(s => s.title === '付款習慣');
        const habits = await this.ensure('付款習慣', HABIT_HEADERS),
          log = await this.ensure('配對紀錄', DECISION_HEADERS),
          epoch = this.epoch,
          fileId = this.file?.id;
        const seed = !habitsExisted && (await this.read('付款習慣')).length === 1;
        const requests = [
          ...this.revisionRequests(revision),
          ...(seed
            ? [
                {
                  appendCells: {
                    sheetId: habits.sheetId,
                    rows: cells(DEFAULT_HABITS),
                    fields: 'userEnteredValue'
                  }
                }
              ]
            : []),
          { appendCells: { sheetId: log.sheetId, rows: cells(rows), fields: 'userEnteredValue' } }
        ];
        if (epoch !== this.epoch || fileId !== this.file?.id) throw Error('GOOGLE_LOGIN_REQUIRED');
        try {
          await this.api(SHEETS + '/' + fileId + ':batchUpdate', { method: 'POST', body: { requests } });
        } catch (e) {
          const ids = new Set((await this.read('配對紀錄')).slice(1).map(r => r[0]));
          if (rows.every(r => ids.has(r[0]))) return { added: 0, repeated: true };
          throw e;
        }
        return { added: rows.length };
      });
    } finally {
      this.saving = false;
    }
  }

  async saveLinePay(batch) {
    if (this.saving) throw Error('SYNC_BUSY');
    this.saving = true;
    try {
      await this.unifiedLog();
      return await this.coordinated(async revision => {
        const sheet = await this.ensure('LINE Pay', LINEPAY_HEADERS);
        const epoch = this.epoch,
          fileId = this.file?.id,
          logs = (await this.read('匯入紀錄')).slice(1);
        if (logs.some(r => r[0] === batch.id)) return { repeated: true, added: 0, skipped: 0 };
        const plan = linePayRowsToAppend(linePayTable(await this.read('LINE Pay')), batch.rows),
          log = [...batch.log];
        log[6] = plan.fresh.length;
        const requests = [
          ...this.revisionRequests(revision),
          ...(plan.fresh.length
            ? [
                {
                  appendCells: {
                    sheetId: sheet.sheetId,
                    rows: cells(linePaySheetRows(plan.fresh)),
                    fields: 'userEnteredValue'
                  }
                }
              ]
            : []),
          {
            appendCells: {
              sheetId: this.sheets.find(s => s.title === '匯入紀錄').sheetId,
              rows: cells([log]),
              fields: 'userEnteredValue'
            }
          }
        ];
        if (epoch !== this.epoch || fileId !== this.file?.id) throw Error('GOOGLE_LOGIN_REQUIRED');
        try {
          await this.api(SHEETS + '/' + fileId + ':batchUpdate', { method: 'POST', body: { requests } });
        } catch (e) {
          if ((await this.read('匯入紀錄')).slice(1).some(r => r[0] === batch.id))
            return { repeated: true, added: 0, skipped: 0 };
          throw e;
        }
        return { repeated: false, added: plan.fresh.length, skipped: plan.skipped };
      });
    } finally {
      this.saving = false;
    }
  }

  // Hand-entered records are append-only like the decisions; a decision can be saved in the same batch,
  // e.g. marking the wallet gap the record explains.
  async saveManual(rows, decisions = []) {
    if (this.saving) throw Error('SYNC_BUSY');
    if (!rows.length) return { added: 0 };
    this.saving = true;
    try {
      await this.unifiedLog();
      return await this.coordinated(async revision => {
        const sheet = await this.ensure('手動記帳', MANUAL_HEADERS),
          log = decisions.length ? await this.ensure('配對紀錄', DECISION_HEADERS) : null,
          epoch = this.epoch,
          fileId = this.file?.id;
        const requests = [
          ...this.revisionRequests(revision),
          {
            appendCells: {
              sheetId: sheet.sheetId,
              rows: cells(manualSheetRows(rows)),
              fields: 'userEnteredValue'
            }
          },
          ...(log
            ? [{ appendCells: { sheetId: log.sheetId, rows: cells(decisions), fields: 'userEnteredValue' } }]
            : [])
        ];
        if (epoch !== this.epoch || fileId !== this.file?.id) throw Error('GOOGLE_LOGIN_REQUIRED');
        try {
          await this.api(SHEETS + '/' + fileId + ':batchUpdate', { method: 'POST', body: { requests } });
        } catch (e) {
          const saved = new Set((await this.read('手動記帳')).slice(1).map(r => r[0] + '|' + r[10]));
          if (rows.every(r => saved.has(r[0] + '|' + r[10]))) return { added: 0, repeated: true };
          throw e;
        }
        return { added: rows.length };
      });
    } finally {
      this.saving = false;
    }
  }
}
