'use strict';
/**
 * หน้าต่อฐานข้อมูลของทั้งระบบ (ADR-0004)
 *
 * โค้ดทั้งโปรเจกต์เรียกผ่านโมดูลนี้โดยตรง และ API คงรูปแบบเดิมของ better-sqlite3
 * แต่ทุกเมธอดคืน Promise แทนค่าตรง ๆ:
 *
 *   const row  = await db.prepare('SELECT ... WHERE id = ?').get(id)
 *   const rows = await db.prepare('SELECT ...').all(a, b)
 *   await db.prepare('INSERT ...').run(a, b)
 *   await db.exec('...')
 *   await db.transaction(async (tx) => { ... })
 *
 * ข้อดีคือ diff จากระบบเดิมมีแค่เติม `await` — ไม่ต้องเขียน SQL ใหม่
 * และ SQL ชุดเดิมยังรันได้ทั้ง SQLite และ MySQL (แปลง dialect อัตโนมัติ)
 */
const config = require('./config');
const sql = require('./sql');
const { SqliteDriver } = require('./driver-sqlite');

let driver = null;
let dialect = null;
let ready = false;

/** สร้าง driver ตามค่าตั้งค่าปัจจุบัน (ยังไม่เชื่อมต่อ) */
function createDriver() {
  const cfg = config.resolve();
  if (cfg.dialect === 'mysql') {
    // โหลดแบบ lazy เพื่อไม่ให้ mysql2 ถูกโหลดเมื่อใช้ SQLite
    const { MysqlDriver } = require('./driver-mysql');
    return { cfg, driver: new MysqlDriver(cfg) };
  }
  return { cfg, driver: new SqliteDriver(cfg) };
}

/** เปิดการเชื่อมต่อ — ต้องเรียกครั้งเดียวก่อนรับ request */
async function init() {
  if (ready) return api;
  const created = createDriver();
  driver = created.driver;
  await driver.init();
  dialect = driver.dialect;
  ready = true;
  return api;
}

async function close() {
  if (driver) await driver.close();
  driver = null;
  ready = false;
}

function assertReady() {
  if (!ready) {
    throw new Error(
      'ยังไม่ได้เชื่อมต่อฐานข้อมูล — ต้องเรียก db.init() ก่อนใช้งาน'
    );
  }
  return driver;
}

/** ถ้าเป็น MySQL ให้แปลง SQL ก่อนส่ง */
function render(sqlText) {
  return dialect === 'mysql' ? sql.translate(sqlText) : sqlText;
}

const api = {
  /** @returns {'sqlite'|'mysql'} */
  get dialect() {
    return dialect;
  },

  get collation() {
    return dialect === 'mysql' ? config.resolve().collation : null;
  },

  get isMaria() {
    return driver ? driver.isMaria : false;
  },

  get isSQLite() {
    return dialect === 'sqlite';
  },

  get isMySQL() {
    return dialect === 'mysql';
  },

  get connectionInfo() {
    return driver ? config.describe(config.resolve()) : '(ยังไม่ได้เชื่อมต่อ)';
  },

  init,
  close,

  /**
   * เตรียมคำสั่ง SQL — ใช้รูปแบบเดิม แต่ .get/.all/.run คืน Promise
   */
  prepare(sqlText) {
    const d = assertReady();
    const finalSql = render(sqlText);
    return {
      get: (...params) => d.get(finalSql, params),
      all: (...params) => d.all(finalSql, params),
      run: (...params) => d.run(finalSql, params),
      /** สำหรับ driver ที่อยู่ใน transaction (ใช้ต่อเนื่องหลายครั้งได้) */
      sync: () => d.syncPrepare ? d.syncPrepare(finalSql) : null,
    };
  },

  /** รัน SQL ที่ไม่ต้องคืนแถว (DDL หลายคำสั่ง, PRAGMA ฯลฯ) */
  async exec(sqlText) {
    const d = assertReady();
    if (dialect === 'mysql') {
      // แปลงทีละคำสั่ง: DDL ของเดิมมีหลายคำสั่งค้างกันใน exec เดียว
      for (const stmt of splitStatements(sqlText)) {
        if (!stmt.trim()) continue;
        await d.exec(sql.translateDDL(stmt, { isMaria: d.isMaria, collation: config.resolve().collation }));
      }
      return undefined;
    }
    return d.exec(sqlText);
  },

  async pragma(key, value) {
    return assertReady().pragma(key, value);
  },

  async columns(table) {
    return assertReady().columns(table);
  },

  async tables() {
    return assertReady().tables();
  },

  /**
   * transaction — คืนฟังก์ชัน async ที่รับ connection ของ transaction เป็นอาร์กิวเมนต์แรก
   * รองรับการซ้อน (SAVEPOINT)
   */
  transaction(fn) {
    assertReady();
    return async (...args) => {
      const d = driver;
      return d.transaction(async (txDriver) => {
        // ถ้า callback ใช้ connection ที่ส่งให้ (tx.prepare) ให้ผูกไว้กับ connection นั้น
        if (txDriver && typeof txDriver.prepare === 'function') {
          const txApi = makeTxFacade(txDriver);
          return fn(txApi, ...args);
        }
        return fn(d, ...args);
      });
    };
  },

  /** คืน facade ที่ผูกกับ connection ภายใน transaction */
  prepareTx(txDriver, sqlText) {
    const finalSql = render(sqlText);
    return {
      get: (...params) => txDriver.get(finalSql, params),
      all: (...params) => txDriver.all(finalSql, params),
      run: (...params) => txDriver.run(finalSql, params),
    };
  },

  isReady: () => ready,
};

/** facade สำหรับใช้ภายใน transaction */
function makeTxFacade(txDriver) {
  return {
    prepare: (sqlText) => api.prepareTx(txDriver, sqlText),
    exec: (sqlText) => txDriver.exec(render(sqlText)),
    transaction: (fn) => api.transaction(fn),
    get dialect() {
      return dialect;
    },
    get isMySQL() {
      return dialect === 'mysql';
    },
    get isSQLite() {
      return dialect === 'sqlite';
    },
  };
}

/** แยกคำสั่ง SQL ที่ปนกันในสตริงเดียว (ใช้เฉพาะฝั่ง MySQL) */
function splitStatements(text) {
  const out = [];
  let buf = '';
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      buf += ch;
      if (ch === '\\') {
        if (i + 1 < text.length) {
          buf += text[i + 1];
          i += 1;
        }
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '-' && text[i + 1] === '-') {
      while (i < text.length && text[i] !== '\n') i += 1;
      buf += '\n';
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
      buf += ' ';
      continue;
    }
    if (ch === ';') {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out;
}

module.exports = api;
