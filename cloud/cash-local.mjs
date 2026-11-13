// 先存手機：每一筆記帳都先寫進這台裝置，連上 Google 時再同步到試算表。
// 只存現金記帳本身與現金設定；Google 授權 Token 從不寫入這裡。
import { makeEntry } from './cash.mjs';

export const LOCAL_KEY = 'cash-ledger-v1';
const empty = () => ({ entries: [], setting: null, pending: [], fileId: '', lastSync: '' });

export class CashLocal {
  constructor(storage) {
    this.storage = storage;
    this.state = empty();
    this.ok = true;
    try {
      const raw = JSON.parse(storage?.getItem(LOCAL_KEY) || 'null');
      if (raw && Array.isArray(raw.entries)) {
        this.state = { ...empty(), ...raw };
        this.state.entries = raw.entries.flatMap(e => {
          try {
            return [makeEntry(e)];
          } catch {
            return [];
          }
        });
      }
    } catch {
      this.ok = false;
    }
  }
  save() {
    try {
      this.storage.setItem(LOCAL_KEY, JSON.stringify(this.state));
      this.ok = true;
    } catch {
      this.ok = false;
    }
    return this.ok;
  }
  get entries() {
    return this.state.entries;
  }
  get map() {
    return new Map(this.state.entries.map(e => [e.id, e]));
  }
  get live() {
    return this.state.entries.filter(e => !e.deleted);
  }
  get setting() {
    return this.state.setting;
  }
  get pendingCount() {
    return this.state.pending.length + (this.state.settingPending ? 1 : 0);
  }
  // Save a new or edited record; it is marked to be uploaded.
  put(entry) {
    const list = this.state.entries.filter(e => e.id !== entry.id);
    list.push(entry);
    this.state.entries = list;
    if (!this.state.pending.includes(entry.id)) this.state.pending.push(entry.id);
    return this.save();
  }
  remove(entry, now = new Date().toISOString()) {
    return this.put({ ...entry, deleted: true, updatedAt: now });
  }
  setSetting(cents, date, now = new Date().toISOString()) {
    this.state.setting = { cents, date, updatedAt: now };
    this.state.settingPending = true;
    return this.save();
  }
  // After a successful sync. `entries` and `setting` are what the sheet now holds; anything changed on this
  // device while the sync was running is newer, so it is kept and stays pending for the next sync.
  synced({ entries, setting, fileId, at = new Date().toISOString() }) {
    const out = new Map(entries),
      pending = [];
    for (const e of this.state.entries) {
      const s = entries.get(e.id);
      if (!s || e.updatedAt > s.updatedAt) {
        out.set(e.id, e);
        pending.push(e.id);
      }
    }
    this.state.entries = [...out.values()];
    this.state.pending = pending;
    const mine = this.state.setting;
    this.state.settingPending = !!(mine && (!setting || mine.updatedAt > setting.updatedAt));
    this.state.setting = this.state.settingPending ? mine : setting;
    this.state.fileId = fileId || this.state.fileId;
    this.state.lastSync = at;
    return this.save();
  }
  clear() {
    this.state = empty();
    try {
      this.storage.removeItem(LOCAL_KEY);
    } catch {
      // Nothing else to do when storage is blocked.
    }
  }
}
