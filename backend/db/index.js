'use strict';
/**
 * หน้าต่อฐานข้อมูลของทั้งระบบ (ADR-0004)
 *
 * ระบบใช้ MariaDB 11.4 ตัวเดียว ไม่มีการแปลง SQL อีกแล้ว
 * ทุกคำสั่ง SQL ในโค้ดเป็น MariaDB โดยตรง
 *
 *   const row  = await db.prepare('SELECT ... WHERE id = ?').get(id)
 *   const rows = await db.prepare('SELECT ...').all()
 *   await db.prepare('INSERT ...').run(a, b)
 *   await db.exec('...')            // รันหลายคำสั่งต่อกันได้
 *   await db.transaction(async (tx) => { ... })
 */
const config = require('./config');
const { MysqlDriver } = require('./driver-mysql');

let driver = null;
let ready = false;

async function init() {
  if (ready) return api;
  driver = new MysqlDriver(config.resolve());
  await driver.init();
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

const api = {
  get isMaria() {
    return driver ? driver.isMaria : false;
  },

  get collation() {
    return config.resolve().collation;
  },

  get connectionInfo() {
    return driver ? config.describe(config.resolve()) : '(ยังไม่ได้เชื่อมต่อ)';
  },

  /** เวอร์ชัน MariaDB ที่เชื่อมต่ออยู่ เช่น 11.4.13-MariaDB */
  get driverVersion() {
    return driver ? driver.version : null;
  },

  init,
  close,

  /**
   * เตรียมคำสั่ง SQL — ใช้รูปแบบเดิม แต่ .get/.all/.run คืน Promise
   */
  prepare(sqlText) {
    const d = assertReady();
    return {
      get: (...params) => d.get(sqlText, params),
      all: (...params) => d.all(sqlText, params),
      run: (...params) => d.run(sqlText, params),
    };
  },

  /** รัน SQL ที่ไม่ต้องคืนแถว — แยกทีละคำสั่งเพราะ mysql2 ปิด multipleStatements */
  async exec(sqlText) {
    const d = assertReady();
    for (const stmt of splitStatements(sqlText)) {
      if (!stmt.trim()) continue;
      await d.exec(stmt);
    }
    return undefined;
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
    return {
      get: (...params) => txDriver.get(sqlText, params),
      all: (...params) => txDriver.all(sqlText, params),
      run: (...params) => txDriver.run(sqlText, params),
    };
  },

  isReady: () => ready,
};

/** facade สำหรับใช้ภายใน transaction */
function makeTxFacade(txDriver) {
  return {
    prepare: (sqlText) => api.prepareTx(txDriver, sqlText),
    exec: (sqlText) => txDriver.exec(sqlText),
    transaction: (fn) => api.transaction(fn),
    columns: (table) => driver.columns(table),
    tables: () => driver.tables(),
    get isMaria() {
      return driver.isMaria;
    },
  };
}

/** แยกคำสั่ง SQL ที่ปนกันในสตริงเดียว */
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