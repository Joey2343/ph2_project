'use strict';
/**
 * ไดรเวอร์ MySQL 8.0+ / MariaDB 10.4+ (ผ่าน mysql2/promise)
 *
 * การตั้งค่าสำคัญเพื่อให้พฤติกรรมตรงกับ SQLite เดิม:
 *   - decimalNumbers  → เงิน/ตัวเลขทศนิยมคืนเป็น number ไม่ใช่ string
 *   - dateStrings     → คืนค่าวันที่เป็น string (ตารางเก็บวันที่เป็น VARCHAR อยู่แล้ว)
 *   - charset utf8mb4 → รองรับภาษาไทยเต็มรูปแบบ (สำคัญมากสำหรับระบบนี้)
 *   - PIPES_AS_CONCAT → `||` ต่อสตริงได้เหมือน SQLite (ดู config.js)
 *   - ONLY_FULL_GROUP_BY ถูกปลด → GROUP BY แบบ SQLite ที่ไม่ aggregate ทุกคอลัมน์ยังรันได้
 */
const mysql = require('mysql2/promise');

class MysqlDriver {
  constructor(cfg) {
    this.dialect = 'mysql';
    this.isMaria = false;
    this.cfg = cfg;
    this.pool = null;
    this._txDepth = 0;
    this._txConn = null;
  }

  async init() {
    this.pool = mysql.createPool({
      host: this.cfg.host,
      port: this.cfg.port,
      user: this.cfg.user,
      password: this.cfg.password,
      database: this.cfg.database,
      waitForConnections: true,
      connectionLimit: this.cfg.connectionLimit,
      queueLimit: 0,
      charset: this.cfg.charset,
      decimalNumbers: true,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: false,
      multipleStatements: false,
      namedPlaceholders: false,
      timezone: '+07:00',
    });

    // ตั้ง sql_mode ให้ทุก connection ที่ pool สร้างใหม่
    this.pool.on('connection', (conn) => {
      conn.query(`SET SESSION sql_mode = '${this.cfg.sqlMode}'`);
    });

    // ตรวจว่าเป็น MariaDB หรือ MySQL (DDL ของ TEXT DEFAULT ต่างกัน)
    const [rows] = await this.pool.query('SELECT VERSION() AS v');
    const version = rows && rows[0] ? String(rows[0].v) : '';
    this.isMaria = /mariadb/i.test(version);
    this.version = version;
    return this;
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async exec(sql) {
    // ใช้ query() เพราะต้องรัน DDL หลายคำสั่งต่อกันได้
    const [result] = await this.pool.query(sql);
    return result;
  }

  async pragma() {
    // SQLite-only — การตั้งค่าสำหรับ MySQL ไม่มี
    return [];
  }

  async columns(table) {
    const [rows] = await this.pool.query(
      `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable,
              COLUMN_DEFAULT AS dflt_value, COLUMN_KEY AS colkey
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [this.cfg.database, table]
    );
    return rows.map((c) => ({
      name: c.name,
      type: c.type,
      notnull: c.nullable === 'NO',
      dflt_value: c.dflt_value,
      pk: c.colkey === 'PRI',
    }));
  }

  async tables() {
    const [rows] = await this.pool.query(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
      [this.cfg.database]
    );
    return rows.map((r) => r.name);
  }

  async all(sql, params) {
    const [rows] = await this.pool.execute(sql, params);
    return rows;
  }

  async get(sql, params) {
    const [rows] = await this.pool.execute(sql, params);
    return rows && rows.length ? rows[0] : undefined;
  }

  async run(sql, params) {
    const [result] = await this.pool.execute(sql, params);
    return {
      changes: result.affectedRows ?? 0,
      lastInsertRowid: result.insertId ?? 0,
      insertId: result.insertId ?? 0,
    };
  }

  /**
   * transaction รองรับการซ้อนด้วย SAVEPOINT
   * transaction ระดับนอกจะกัน connection ไว้ตลอดช่วง เพื่อให้ทุกคำสั่งใน fn
   * อยู่บน connection เดียวกัน
   */
  async transaction(fn) {
    const outer = this._txDepth === 0;
    let conn = this._txConn;

    if (outer) {
      conn = await this.pool.getConnection();
      this._txConn = conn;
      await conn.beginTransaction();
    } else {
      const sp = `sp_${this._txDepth}`;
      await conn.query(`SAVEPOINT ${sp}`);
      this._spStack = this._spStack || [];
      this._spStack.push(sp);
    }

    this._txDepth += 1;
    try {
      const scoped = conn ? new ScopedMysqlDriver(this, conn) : this;
      const result = await fn(scoped);
      this._txDepth -= 1;
      if (outer) {
        await conn.commit();
        conn.release();
        this._txConn = null;
      } else {
        await conn.query(`RELEASE ${this._spStack.pop()}`);
      }
      return result;
    } catch (err) {
      this._txDepth -= 1;
      try {
        if (outer) {
          await conn.rollback();
          conn.release();
          this._txConn = null;
        } else {
          const sp = this._spStack.pop();
          await conn.query(`ROLLBACK TO ${sp}`);
          await conn.query(`RELEASE ${sp}`);
        }
      } catch {
        /* ignore rollback failure */
      }
      throw err;
    }
  }
}

/** ตัวห่อที่บังคับให้คำสั่งทั้งหมดใน transaction ใช้ connection เดียวกัน */
class ScopedMysqlDriver {
  constructor(driver, conn) {
    this.dialect = 'mysql';
    this.isMaria = driver.isMaria;
    this._driver = driver;
    this._conn = conn;
  }

  exec(sql) {
    return this._conn.query(sql);
  }

  all(sql, params) {
    return this._conn.execute(sql, params).then(([rows]) => rows);
  }

  get(sql, params) {
    return this._conn
      .execute(sql, params)
      .then(([rows]) => (rows && rows.length ? rows[0] : undefined));
  }

  run(sql, params) {
    return this._conn.execute(sql, params).then(([r]) => ({
      changes: r.affectedRows ?? 0,
      lastInsertRowid: r.insertId ?? 0,
      insertId: r.insertId ?? 0,
    }));
  }

  columns(table) {
    return this._driver.columns(table);
  }

  tables() {
    return this._driver.tables();
  }

  transaction(fn) {
    return this._driver.transaction(fn);
  }
}

module.exports = { MysqlDriver };
