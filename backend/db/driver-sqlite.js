'use strict';
/**
 * ไดรเวอร์ SQLite — ใช้ node:sqlite (โมดูลในตัวของ Node 22+/24)
 *
 * เลิกใช้ better-sqlite3 เพราะเป็น native module ที่ต้อง compile ให้ตรงกับ
 * NODE_MODULE_VERSION ของ Node ที่ติดตั้ง (เครื่องนี้เจอปัญหาตอน Node 24)
 * การใช้โมดูลในตัวตัดปัญหานี้ทิ้งไปทั้งหมด
 *
 * ข้อต่างสำคัญจาก better-sqlite3 ที่โค้ดเดิมเคยพึ่ง:
 *   - ไม่มี db.transaction()      → ใช้ BEGIN/COMMIT + SAVEPOINT สำหรับ transaction ซ้อน
 *   - ไม่มี named parameter        → ใช้ ? เท่านั้น (โค้ดเดิมใช้ ? อยู่แล้ว)
 *   - ไม่ยอม boolean/undefined เป็น parameter → normalize ให้เป็น 0/1 และ null
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

/** แปลงค่าให้เป็นชนิดที่ node:sqlite ยอมรับ */
function normalizeParams(params) {
  return params.map((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'number' && !Number.isFinite(v)) return null;
    return v;
  });
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (typeof v === 'bigint') row[k] = Number(v);
  }
  return row;
}

class SqliteDriver {
  constructor(cfg) {
    this.dialect = 'sqlite';
    this.isMaria = false;
    this.file = cfg.file;
    this._db = null;
    this._txDepth = 0;
  }

  async init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this._db = new DatabaseSync(this.file);
    // WAL ให้เขียน/อ่านคู่ขนานได้ (ของเดิมใช้แบบเดียวกัน)
    this._db.exec('PRAGMA journal_mode = WAL');
    this._db.exec('PRAGMA foreign_keys = ON');
    this._db.exec('PRAGMA busy_timeout = 5000');
    return this;
  }

  async close() {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }

  _stmt(sql) {
    return this._db.prepare(sql);
  }

  /** คืน statement จริง (ไม่ต้อง await) — ใช้ตอนอยู่ใน transaction */
  syncPrepare(sql) {
    return this._stmt(sql);
  }

  async exec(sql) {
    this._db.exec(sql);
  }

  async pragma(key, value) {
    if (value === undefined) return this._db.prepare(`PRAGMA ${key}`).all();
    this._db.exec(`PRAGMA ${key} = ${value}`);
    return undefined;
  }

  /** รายชื่อคอลัมน์ของตาราง */
  async columns(table) {
    return this._db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => ({
      name: c.name,
      type: c.type,
      notnull: !!c.notnull,
      dflt_value: c.dflt_value,
      pk: !!c.pk,
    }));
  }

  async tables() {
    return this._db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => r.name);
  }

  async all(sql, params) {
    return this._stmt(sql).all(...normalizeParams(params)).map(normalizeRow);
  }

  async get(sql, params) {
    const row = this._stmt(sql).get(...normalizeParams(params));
    return row === undefined ? undefined : normalizeRow(row);
  }

  async run(sql, params) {
    const r = this._stmt(sql).run(...normalizeParams(params));
    return {
      changes: Number(r.changes),
      lastInsertRowid: Number(r.lastInsertRowid),
      insertId: Number(r.lastInsertRowid),
    };
  }

  /**
   * transaction รองรับการซ้อนด้วย SAVEPOINT
   * @param {Function} fn async (txDriver) => result
   */
  async transaction(fn) {
    const outer = this._txDepth === 0;
    const sp = `sp_${this._txDepth}`;
    this._db.exec(outer ? 'BEGIN' : `SAVEPOINT ${sp}`);
    this._txDepth += 1;
    try {
      const result = await fn(this);
      this._txDepth -= 1;
      this._db.exec(outer ? 'COMMIT' : `RELEASE ${sp}`);
      return result;
    } catch (err) {
      this._txDepth -= 1;
      try {
        this._db.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${sp}`);
        if (!outer) this._db.exec(`RELEASE ${sp}`);
      } catch {
        /* rollback ซ้ำไม่ได้ — ปล่อยให้ error ต้นทางเป็นตัวที่โยนออก */
      }
      throw err;
    }
  }
}

module.exports = { SqliteDriver, normalizeParams, normalizeRow };
