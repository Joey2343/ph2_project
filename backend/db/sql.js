'use strict';
/**
 * แปลง DDL จาก SQLite เป็น MySQL 8.0+ / MariaDB 10.4+
 *
 * หลักการ (ADR-0006)
 *   โค้ดเดิมประกาศ schema แบบ SQLite (TEXT เป็นชนิดเดียว ไม่ต้องระบุความยาว)
 *   MySQL ต้องระบุความยาว และ "ห้าม DEFAULT บน TEXT/BLOB" จึงต้องเลือกชนิดตามลักษณะ
 *
 * การแมปชนิดข้อมูล
 *   INTEGER PRIMARY KEY AUTOINCREMENT → INT NOT NULL AUTO_INCREMENT PRIMARY KEY
 *   INTEGER                           → INT
 *   REAL                              → DOUBLE
 *   TEXT  + PRIMARY KEY / UNIQUE      → VARCHAR(191)   (จำกัดความยาวคีย์ 3072 ไบต์)
 *   TEXT  + DEFAULT                   → VARCHAR(1000)  (MySQL อนุญาต DEFAULT บน VARCHAR)
 *   TEXT  + ชื่อคอลัมน์เนื้อหายาว    → MEDIUMTEXT     (ไม่ใส่ DEFAULT)
 *   TEXT  อื่น ๆ                      → VARCHAR(2000)
 *   created_at / decided_at / ...     → VARCHAR(30)  + DEFAULT (NOW())
 *
 * ทำไมต้องแยกแบบนี้
 *   - ใช้ VARCHAR(16000) ทั้งหมดไม่ได้ เพราะ utf8mb4 ทำให้แถวเกินขีดจำกัด 65535 ไบต์
 *     (ตาราง documents มี ~30 คอลัมน์ → เกินทันที)
 *   - ใช้ LONGTEXT ทั้งหมดไม่ได้ เพราะ MySQL ไม่ยอม DEFAULT (ER_BLOB_CANT_HAVE_DEFAULT)
 *
 * @param {string} text  DDL จาก db.js รุ่นเดิม
 * @param {object} opts  { isMaria: boolean }
 */
/**
 * Collation ที่ใช้กับคอลัมน์ข้อความใน MySQL
 *
 * ค่าเริ่มต้นคือ utf8mb4_bin เพราะ:
 *   SQLite เรียงและเปรียบเทียบข้อความด้วย "binary" (เทียบตาม byte ของ UTF-8)
 *   ถ้า MySQL ใช้ utf8mb4_unicode_ci (ค่าเริ่มต้นของ MySQL) ลำดับการเรียง
 *   จะต่างจากระบบเดิม เช่น รายชื่อโรงเรียนใน /api/schools จะสลับลำดับ
 *   การเปรียบเทียบด้วย = ก็จะต่างกัน (SQLite แยกตัวพิมพ์ใหญ่/เล็ก)
 *
 *   utf8mb4_bin จึงทำให้ MySQL ให้ผลลัพธ์ตรงกับ SQLite ทุกประการ
 *
 * ปรับได้ผ่านตัวแปรสภาพแวดล้อน DB_COLLATION (เช่น utf8mb4_unicode_ci)
 * ดูค่าเริ่มต้นใน db/config.js
 */
const DEFAULT_COLLATION = 'utf8mb4_bin';

function translateDDL(text, opts = {}) {
  const isMaria = !!opts.isMaria;
  const collation = opts.collation || DEFAULT_COLLATION;
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!/^\s*CREATE\s+TABLE/i.test(line)) {
      out.push(translateGeneric(line, isMaria));
      i += 1;
      continue;
    }

    // สะสมทั้งบล็อกจนกว่าจะเจอวงเล็บปิดระดับเดียวกับ CREATE
    const block = [line];
    let opens = (line.match(/\(/g) || []).length;
    let closes = (line.match(/\)/g) || []).length;
    i += 1;
    while (i < lines.length && closes < opens) {
      block.push(lines[i]);
      opens += (lines[i].match(/\(/g) || []).length;
      closes += (lines[i].match(/\)/g) || []).length;
      i += 1;
    }
    out.push(...translateTableBlock(block, isMaria, collation));
  }

  return out.join('\n');
}

/**
 * แปลงทั้งบล็อก CREATE TABLE
 * เก็บชื่อคอลัมน์ที่อยู่ในดัชนี (PRIMARY KEY / UNIQUE ทั้งแบบ inline และระดับตาราง)
 * แล้วส่งเข้า set ให้ translateLine
 */
function translateTableBlock(block, isMaria, collation = DEFAULT_COLLATION) {
  const indexed = new Set();

  for (const l of block) {
    // UNIQUE (a, b, c) / PRIMARY KEY (a, b) ระดับตาราง
    const m = /\b(?:unique|primary\s+key)\s*\(([^)]*)\)/gi.exec(l);
    if (m) {
      for (const part of m[1].split(',')) {
        const c = part.trim().replace(/`/g, '').split(/\s*\(/)[0].trim();
        if (/^\w+$/.test(c)) indexed.add(c);
      }
    }
    // UNIQUE / PRIMARY KEY ที่อยู่ติดกับชื่อคอลัมน์ในบรรทัดเดียว
    const inline = /^(\s*)(`?)(\w+)\2(.*\b(?:unique|primary\s+key)\b.*)$/i.exec(l);
    if (inline) indexed.add(inline[3]);
  }

  return block.map((l) => translateBodyLine(l, isMaria, indexed, collation));
}

/**
 * แปลงหนึ่งบรรทัดของ body ตาราง
 *
 * ตารางที่ถูกแก้ไขในอดีตด้วย ALTER TABLE จะมีคอลัมน์หลายตัวต่อบรรทัดเดียว
 * เช่น  created_at TEXT DEFAULT (...), as_school TEXT DEFAULT ""
 * จึงต้องแยกตาม comma ที่ระดับบนสุดก่อนแปลงทีละคอลัมน์
 */
function translateBodyLine(line, isMaria, indexed, collation = DEFAULT_COLLATION) {
  const segs = splitTopLevel(line);
  if (segs.length <= 1) return translateLine(line, isMaria, indexed, collation);
  return segs.map((s) => translateLine(s, isMaria, indexed, collation)).join(', ');
}

/** แยกข้อความตาม comma ที่อยู่นอกวงเล็บและนอก quote */
function splitTopLevel(line) {
  const out = [];
  let buf = '';
  let depth = 0;
  let quote = null;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      buf += ch;
      if (ch === '\\') {
        if (i + 1 < line.length) {
          buf += line[i + 1];
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
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out;
}

/** คอลัมน์ที่เก็บเนื้อหายาว — ต้องใช้ชนิดที่ไม่จำกัดความยาว
 *
 * หมายเหตุเรื่อง `value` (ตาราง settings)
 *   ปัจจุบันค่ายาวสุดแค่ ~345 ตัวอักษร แต่เก็บ JSON ที่โตตามจำนวนผู้อนุมัติ
 *   และจำนวนบุคลากร จึงต้องเผื่อไว้มาก ๆ
 *   ขนาด VARCHAR(8000) = 32000 ไบต์ ยังอยู่ในขีดจำกัดแถว 65535 ไบต์
 */
const LARGE_COLUMNS = new Set([
  'content', 'body_text', 'detail', 'notes', 'result', 'text', 'file',
  'form_data', 'ref_files', 'enc_files', 'draft_file', 'approval_data',
  'inspection', 'opinion', 'value',
]);

/** คอลัมน์เวลา — เก็บเป็นสตริงความยาวคงที่ */
const TIME_COLUMNS = new Set([
  'created_at', 'approved_at', 'decided_at', 'read_at', 'expires_at',
]);

/**
 * คำสงวนของ MySQL 8 ที่ใช้เป็นชื่อคอลัมน์ใน schema นี้
 * SQLite ไม่บังคับให้ห่อด้วย backtick แต่ MySQL บังคับ
 * ตรงนี้เติม backtick เฉพาะตอนแปลงเป็น MySQL (DDL ของ SQLite ไม่ถูกแตะ)
 */
const MYSQL_RESERVED = new Set([
  'accessible', 'add', 'all', 'alter', 'and', 'as', 'asc', 'before', 'between',
  'bigint', 'binary', 'blob', 'both', 'by', 'call', 'cascade', 'case', 'change',
  'char', 'character', 'check', 'collate', 'column', 'condition', 'constraint',
  'continue', 'convert', 'create', 'cross', 'cube', 'cume_dist', 'current_date',
  'current_time', 'current_timestamp', 'current_user', 'cursor', 'database',
  'databases', 'day_hour', 'day_microsecond', 'day_minute', 'day_second', 'dec',
  'decimal', 'declare', 'default', 'delayed', 'delete', 'dense_rank', 'desc',
  'describe', 'deterministic', 'distinct', 'distinctrow', 'div', 'double', 'drop',
  'dual', 'each', 'else', 'elseif', 'empty', 'enclosed', 'escaped', 'except',
  'exists', 'exit', 'explain', 'false', 'fetch', 'first_value', 'float',
  'float4', 'float8', 'for', 'force', 'foreign', 'from', 'fulltext', 'function',
  'generated', 'get', 'grant', 'group', 'grouping', 'groups', 'having',
  'high_priority', 'if', 'ignore', 'in', 'index', 'infile', 'inner', 'inout',
  'insensitive', 'insert', 'int', 'integer', 'interval', 'into', 'is', 'iterate',
  'join', 'json_table', 'key', 'keys', 'kill', 'lag', 'last_value', 'lateral',
  'lead', 'leading', 'leave', 'left', 'like', 'limit', 'linear', 'lines', 'load',
  'localtime', 'localtimestamp', 'lock', 'long', 'longblob', 'longtext', 'loop',
  'low_priority', 'master_bind', 'match', 'maxvalue', 'mediumblob', 'mediumint',
  'mediumtext', 'middleint', 'minute_microsecond', 'minute_second', 'mod',
  'modifies', 'natural', 'not', 'no_write_to_binlog', 'nth_value', 'ntile',
  'null', 'numeric', 'of', 'on', 'optimize', 'optimizer_costs', 'option',
  'optionally', 'or', 'order', 'out', 'outer', 'outfile', 'over', 'partition',
  'percent_rank', 'precision', 'primary', 'procedure', 'purge', 'range', 'rank',
  'read', 'reads', 'read_write', 'real', 'recursive', 'references', 'regexp',
  'release', 'rename', 'repeat', 'replace', 'require', 'resignal', 'restrict',
  'return', 'revoke', 'right', 'rlike', 'row', 'rows', 'schema', 'schemas',
  'second_microsecond', 'select', 'sensitive', 'separator', 'set', 'show',
  'signal', 'smallint', 'spatial', 'specific', 'sql', 'sqlexception', 'sqlstate',
  'sqlwarning', 'ssl', 'starting', 'stored', 'straight_join', 'system', 'table',
  'terminated', 'then', 'tinyblob', 'tinyint', 'tinytext', 'to', 'trailing',
  'trigger', 'true', 'undo', 'union', 'unique', 'unlock', 'unsigned', 'update',
  'usage', 'use', 'using', 'utc_date', 'utc_time', 'utc_timestamp', 'values',
  'varbinary', 'varchar', 'varcharacter', 'varying', 'virtual', 'when', 'where',
  'while', 'window', 'with', 'write', 'xor',
]);

function quoteIfReserved(name, tick) {
  if (tick) return tick + name + tick;
  return MYSQL_RESERVED.has(name.toLowerCase()) ? `\`${name}\`` : name;
}

function translateLine(line, isMaria, indexed = new Set(), collation = DEFAULT_COLLATION) {
  // ── คีย์หลักอัตโนมัติ ───────────────────────────────────────────────
  if (/^\s*id\s+INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/i.test(line)) {
    return translateGeneric(
      line.replace(
        /INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/i,
        'INT NOT NULL AUTO_INCREMENT PRIMARY KEY'
      ),
      isMaria
    );
  }

  // ── นิยามคอลัมน์:  name TYPE ...  ──────────────────────────────────
  const m = /^(\s*)(`?)(\w+)\2(\s+)(\w+)([\s\S]*)$/.exec(line);
  if (!m) {
    return translateGeneric(line, isMaria);
  }

  const [, indent, tick, name, , type, rest] = m;
  const lowerType = type.toUpperCase();
  const nameLower = name.toLowerCase();
  const col = quoteIfReserved(name, tick);
  const head = `${indent}${col} `;

  let result;

  if (lowerType === 'INTEGER') {
    result = `${head}INT${rest}`;
  } else if (lowerType === 'REAL') {
    result = `${head}DOUBLE${rest}`;
  } else if (lowerType === 'TEXT') {
    result = translateTextColumn(head, nameLower, rest, indexed, collation);
  } else {
    return translateGeneric(line, isMaria);
  }

  return translateGeneric(result, isMaria);
}

/** เลือกชนิดข้อมูล MySQL สำหรับคอลัมน์ที่ประกาศเป็น TEXT ใน SQLite */
function translateTextColumn(head, nameLower, rest, indexed, collation) {
  // ถ้ามีการระบุ COLLATE ไว้แล้ว ไม่ต้องเติม
  const coll = /\bCOLLATE\b/i.test(rest) ? '' : ` COLLATE ${collation}`;

  // คอลัมน์เวลา → VARCHAR(30) และแปลง datetime('now') เป็น NOW()
  if (TIME_COLUMNS.has(nameLower)) {
    return `${head}VARCHAR(30)${coll}${rest}`;
  }

  // ใช้เป็นคีย์ (ทั้งแบบ inline และระดับตาราง) → ต้องจำกัดความยาว
  // MySQL จำกัดดัชนีไว้ที่ 3072 ไบต์ (utf8mb4 → 191 ตัวอักษร)
  if (/PRIMARY\s+KEY|UNIQUE/i.test(rest) || indexed.has(nameLower)) {
    return `${head}VARCHAR(191)${coll}${rest}`;
  }

  const hasDefault = /\bDEFAULT\b/i.test(rest);

  // เนื้อหายาว → MEDIUMTEXT นับขนาดแถวแค่ ~12 ไบต์ (เก็บนอกแถว)
  // MEDIUMTEXT ไม่รับ DEFAULT จึงต้องใช้ VARCHAR ขนาดใหญ่แทน
  if (LARGE_COLUMNS.has(nameLower)) {
    return hasDefault
      ? `${head}VARCHAR(8000)${coll}${rest}`
      : `${head}MEDIUMTEXT${coll}${rest}`;
  }

  // คอลัมน์สั้นที่มี DEFAULT → VARCHAR (MySQL อนุญาต DEFAULT บน VARCHAR)
  if (hasDefault) {
    return `${head}VARCHAR(255)${coll}${rest}`;
  }

  // อื่น ๆ → MEDIUMTEXT (ประหยัดขนาดแถว)
  return `${head}MEDIUMTEXT${coll}${rest}`;
}

/** กฎที่ใช้กับทุกบรรทัด (ไม่ว่าจะเป็นนิยามคอลัมน์หรือไม่) */
function translateGeneric(line, isMaria) {
  let out = line;
  // กรณีสลับลำดับ: PRIMARY KEY AUTOINCREMENT
  out = out.replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi,
    'INT NOT NULL AUTO_INCREMENT PRIMARY KEY');
  // ฟังก์ชันเวลาใน DEFAULT
  out = out.replace(/\bdatetime\s*\(\s*'now'\s*(?:,\s*'localtime'\s*)?\)/gi, 'NOW()');
  // MariaDB ใช้ DEFAULT แบบ literal ได้, MySQL ต้องเป็น expression
  // (VARCHAR รับทั้งสองแบบ แต่ expression ใช้ได้ทั้ง MySQL และ MariaDB จึงเลือกแบบเดียว)
  if (!isMaria) {
    out = out.replace(
      /(\bVARCHAR\s*\(\s*\d+\s*\)\s+NOT\s+NULL\s+DEFAULT\s+)('(?:[^']|'')*')/g,
      (_whole, head, lit) => `${head}(${lit})`
    );
  }

  // ── DEFAULT ที่เป็น "คำลอย" ต้องใส่ quote ────────────────────────────
  // SQLite เก็บ DDL ใน sqlite_master โดยตัด quote ทิ้ง เช่น
  //   DEFAULT 'office'  →  DEFAULT office
  // MySQL/MariaDB ต้องการ DEFAULT 'office' จึงต้องใส่ quote กลับ
  // (ค่าที่เป็นฟังก์ชันหรือคำสงวนของ SQL ไม่ต้องแตะ)
  out = out.replace(
    /\bDEFAULT\s+([A-Za-z_][A-Za-z0-9_]*)(\s*(?=[,)])|$)/g,
    (whole, word) => {
      const SAFE = /^(NOW|CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|NULL|TRUE|FALSE|CURDATE)$/i;
      if (SAFE.test(word)) return whole;
      return whole.replace(word, `'${word}'`);
    }
  );

  return out;
}

/**
 * แปลง SQL ประเภท SELECT/INSERT/UPDATE/DELETE ให้เป็น MySQL
 * (DDL ใช้ฟังก์ชัน translateDDL แยกต่างหาก)
 */
function translate(sql) {
  if (typeof sql !== 'string' || sql === '') return sql;
  let out = sql;

  // 1) INSERT ... ON CONFLICT(cols) DO UPDATE SET
  //    MySQL ไม่ต้องระบุ key ซ้ำ ใช้ VALUES(col) แทน excluded.col
  out = out.replace(
    /\sON\s+CONFLICT\s*\([^)]*\)\s+DO\s+UPDATE\s+SET\s+/gi,
    ' ON DUPLICATE KEY UPDATE '
  );
  out = out.replace(/\bexcluded\s*\.\s*/gi, '');
  out = out.replace(/\sON\s+CONFLICT\s+DO\s+NOTHING/gi, '');

  // 2) INSERT OR ...
  out = out.replace(/\bINSERT\s+OR\s+IGNORE\b/gi, 'INSERT IGNORE');
  out = out.replace(/\bINSERT\s+OR\s+REPLACE\b/gi, 'REPLACE');
  out = out.replace(/\bINSERT\s+OR\s+ABORT\b/gi, 'INSERT');
  out = out.replace(/\bINSERT\s+OR\s+FAIL\b/gi, 'INSERT');

  // 3) ฟังก์ชันเวลาปัจจุบัน
  out = out.replace(/\bdatetime\s*\(\s*'now'\s*(?:,\s*'localtime'\s*)?\)/gi, 'NOW()');
  out = out.replace(/\bdate\s*\(\s*'now'\s*(?:,\s*'localtime'\s*)?\)/gi, 'CURDATE()');

  // 4) CAST(x AS INTEGER) → CAST(x AS SIGNED)  (MySQL ไม่รู้จัก INTEGER ใน CAST)
  out = out.replace(/\bCAST\s*\(([\s\S]*?)\s+AS\s+INTEGER\s*\)/gi, 'CAST($1 AS SIGNED)');

  return out;
}

/**
 * สร้างคำสั่ง ALTER TABLE ... ADD COLUMN ที่ถูกต้องสำหรับ dialect ปัจจุบัน
 *
 * จำเป็นเพราะรายการ migration ใน db.js เขียนชนิดข้อมูลแบบ SQLite ไว้
 * (เช่น "TEXT DEFAULT 'office'") และ MySQL รับไม่ได้
 *
 * @param {string} table
 * @param {string} col
 * @param {string} ddl   นิยามคอลัมน์แบบ SQLite เช่น "TEXT DEFAULT 'office'"
 * @param {boolean} isMaria
 * @returns {string} คำสั่ง SQL ที่พร้อมใช้
 */
function addColumnSql(table, col, ddl, isMaria, collation = DEFAULT_COLLATION) {
  // ประกอบเป็นบรรทัดนิยามคอลัมน์ปลอม แล้วให้ translateLine จัดการเหมือนของเดิม
  const fakeLine = `  ${col} ${ddl}`;
  const translated = translateLine(fakeLine, isMaria, new Set(), collation).trim();

  // SQLite ใช้ double quote ครอบค่า default ได้ แต่ MySQL จะตีความเป็นชื่อตาราง/คอลัมน์
  // จึงต้องแปลงเป็น single quote
  const fixed = isMaria
    ? translated.replace(/(DEFAULT\s+)"((?:[^"]|"")*)"/gi, (_m, head, lit) =>
        `${head}'${lit.replace(/""/g, '"')}'`
      )
    : translated;

  return `ALTER TABLE ${quoteIfReserved(table, '')} ADD COLUMN ${fixed}`;
}

/** แปลง DDL ของคำสั่งที่รวมหลายคำสั่งไว้ในสตริงเดียว (ใช้กับ ALTER TABLE ที่ค้างอยู่) */
module.exports = { translate, translateDDL, addColumnSql, LARGE_COLUMNS, TIME_COLUMNS, MYSQL_RESERVED };
