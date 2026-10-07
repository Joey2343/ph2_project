'use strict';
/**
 * ตรวจ SQL ทุกประเภทคำสั่งเทียบกับ schema จริงของฐานข้อมูล
 *
 * จุดประสงค์: จับ "คอลัมน์ที่ไม่มีอยู่จริง" ซึ่งเป็นบั๊กเงียบที่ MariaDB จะไม่แจ้ง
 * จนกว่าจะรัน query นั้น — เช่นบั๊กที่พบ `memos.created_by` (ตาราง memos ไม่มีคอลัมน์นี้)
 * การตรวจแบบนี้จับได้ทั้งระบบในครั้งเดียว
 *
 * ตรวจ 4 รูปแบบ:
 *   1. table.column          → ตรวจว่าคอลัมน์นั้นมีในตารางนั้นไหม
 *   2. INSERT INTO t (a,b,c) → ตรวจทุกคอลัมน์
 *   3. UPDATE t SET a=...     → ตรวจคอลัมน์ที่ถูก set
 *   4. SELECT <cols> FROM t   → ตรวจคอลัมน์ที่ระบุชัด (ข้าม SELECT * และ alias)
 *
 * ใช้: node scripts/check-sql-schema.js [--json]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const BACKEND = path.join(__dirname, '..');
const SQL_HINT =
  /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WHERE|FROM|JOIN)\b/i;

// ── ชุดคำที่อนุญาตให้ใช้เป็น "คอลัมน์" ──────────────────────────────────────
const NOT_COLUMNS = new Set([
  'count', 'sum', 'coalesce', 'ifnull', 'max', 'min', 'avg', 'total', 'trim',
  'cast', 'date', 'datetime', 'strftime', 'julianday', 'substr', 'substring',
  'length', 'lower', 'upper', 'replace', 'round', 'abs', 'json_extract',
  'row_number', 'rank', 'dense_rank', 'group_concat', 'exists', 'in',
  'and', 'or', 'not', 'null', 'case', 'when', 'then', 'else', 'end', 'as',
  'select', 'from', 'where', 'group', 'order', 'by', 'limit', 'offset',
  'insert', 'into', 'values', 'update', 'set', 'delete', 'distinct', 'having',
  'join', 'left', 'right', 'inner', 'outer', 'on', 'between', 'like', 'is',
]);

/** ชื่อตารางที่ query อ้างถึง (รองรับ alias) */
function tableAliases(sql) {
  const map = new Map(); // alias -> table
  const re =
    /\b(?:from|join|into|update)\s+`?(\w+)`?(?:\s+(?:as\s+)?`?(\w+)`?)?/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const table = m[1];
    const alias = m[2];
    map.set(table.toLowerCase(), table);
    if (alias && !['on', 'set', 'where', 'values', 'group', 'order'].includes(alias.toLowerCase())) {
      map.set(alias.toLowerCase(), table);
    }
  }
  return map;
}

/** ตรวจ table.column */
function checkQualified(sql, schema) {
  const problems = [];
  const aliases = tableAliases(sql);
  const re = /\b(`?\w+`?)\s*\.\s*(`?\w+`?)/g;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const tRaw = m[1].replace(/`/g, '');
    const cRaw = m[2].replace(/`/g, '');
    if (NOT_COLUMNS.has(tRaw.toLowerCase())) continue;
    const table = aliases.get(tRaw.toLowerCase());
    if (!table) continue; // alias ที่ไม่รู้จัก — ข้าม
    if (!schema.has(table)) continue; // ไม่ใช่ตารางที่รู้จัก (อาจเป็น alias ซ้อน)
    const cols = schema.get(table);
    if (!cols.has(cRaw)) {
      problems.push({ kind: 'qualified', table, column: cRaw, snippet: m[0] });
    }
  }
  return problems;
}

/** ตรวจ INSERT INTO t (a, b, c) */
function checkInsert(sql, schema) {
  const problems = [];
  const re = /\binsert\s+(?:or\s+\w+\s+)?into\s+`?(\w+)`?\s*\(([^)]*)\)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const table = m[1];
    if (!schema.has(table)) continue;
    const cols = schema.get(table);
    for (const raw of m[2].split(',')) {
      const c = raw.trim().replace(/`/g, '');
      if (!c || !/^\w+$/.test(c)) continue;
      if (!cols.has(c)) problems.push({ kind: 'insert', table, column: c, snippet: m[0].slice(0, 60) });
    }
  }
  return problems;
}

/** ตรวจ UPDATE t SET a=..., b=? */
function checkUpdate(sql, schema) {
  const problems = [];
  const re = /\bupdate\s+`?(\w+)`?\s+set\s+([\s\S]*?)(?:\bwhere\b|$)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const table = m[1];
    if (!schema.has(table)) continue;
    const cols = schema.get(table);
    for (const part of m[2].split(',')) {
      const c = part.trim().split(/[=:]/)[0].trim().replace(/`/g, '');
      if (!c || !/^\w+$/.test(c)) continue;
      if (!cols.has(c)) problems.push({ kind: 'update', table, column: c, snippet: part.trim().slice(0, 40) });
    }
  }
  return problems;
}

/**
 * ตรวจคอลัมน์ที่ไม่มี prefix ตาราง ใน query ที่มีตารางเดียว
 *
 * เช่น  SELECT doc_no FROM memos WHERE created_by IN (...)
 *        → created_by เป็นคอลัมน์ของ memos แต่ไม่มีใน schema
 *
 * ทำไมต้องจำกัด "ตารางเดียว" — ถ้ามีหลายตาราง (JOIN) จะระบุไม่ได้ว่า
 * identifier เป็นคอลัมน์ของตารางไหน การตรวจแบบนี้จะยิง false positive เยอะ
 */
function checkUnqualifiedSingleTable(sql, schema) {
  // ── ตัด subquery ออกก่อน ────────────────────────────────────────────
  // โค้ดเดิมประกอบ SQL เป็นสตริงย่อยหลายชิ้น เช่น
  //   " AND user_id IN (SELECT id FROM users WHERE school_code = ?)"
  // ถ้าไม่ตัดวงเล็บออก จะเข้าใจผิดว่าคอลัมน์ด้านหน้าเป็นของตารางใน subquery
  const outer = stripParens(sql);

  const problems = [];
  // หาตารางจากข้อความที่ตัด subquery แล้ว (ไม่ใช่ของเดิม)
  const aliases = tableAliases(outer);
  const tables = new Set(aliases.values());
  // ไม่มีตารางที่ชัดเจน (เช่น เป็นสตริงย่อยของ WHERE) → ตรวจไม่ได้ ข้าม
  if (tables.size !== 1) return problems;
  const table = [...tables][0];
  if (!schema.has(table)) return problems;
  const cols = schema.get(table);

  // ตัดส่วนที่เป็นค่าคงที่ใน quote ออก
  const stripped = outer.replace(/'[^']*'/g, "''").replace(/`[^`]*`/g, '``');

  const seen = new Set();
  const re = /(?<![.\w`])(\w+)/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const name = m[1];
    const lower = name.toLowerCase();
    if (NOT_COLUMNS.has(lower)) continue;
    if (lower === table.toLowerCase()) continue;
    if (cols.has(name)) continue;
    if (seen.has(name)) continue;
    // ตัวเลข (เช่น LIMIT 50, CASE ... 1)
    if (/^\d+$/.test(name)) continue;
    // alias ที่ตั้งด้วย AS — ไม่ใช่คอลัมน์
    const before = stripped.slice(0, m.index);
    if (/\bas\s+$/i.test(before)) continue;
    // คำสั่งที่คล้ายคอลัมน์
    if (/^(desc|asc|ignore|replace|integer|seq|no|c)$/i.test(name)) continue;
    // ตามด้วยวงเล็บ → ฟังก์ชัน
    const after = stripped.slice(m.index + name.length);
    if (/^\s*\(/.test(after)) continue;
    seen.add(name);
    problems.push({ kind: 'unqualified', table, column: name, snippet: name });
  }
  return problems;
}

/**
 * ตัดวงเล็บที่เป็น subquery ออก
 *
 * เก็บวงเล็บชั้นนอกสุดไว้ (เช่น ของ CASE ... WHEN (x) ...) แล้วลบเนื้อหาข้างใน
 */
function stripParens(sql) {
  let out = sql;
  let guard = 0;
  while (guard < 20) {
    guard += 1;
    // หาวงเล็บที่มี SELECT ข้างใน แล้วลบทั้งก้อน
    const m = /\(([^()]*\bSELECT\b[^()]*)\)/i.exec(out);
    if (!m) break;
    out = out.slice(0, m.index) + ' ' + out.slice(m.index + m[0].length);
  }
  return out;
}

/**
 * อ่าน schema จริงจาก MariaDB ผ่าน information_schema
 *
 * เดิมอ่านจากไฟล์ SQLite ซึ่งไม่มีแล้วหลังย้ายมาใช้ dialect เดียว
 */
async function loadSchemaFromMysql() {
  const db = require('../db');
  await db.init();
  const schema = new Map();
  const tables = await db.tables();
  for (const t of tables) {
    const cols = await db.columns(t);
    schema.set(t, new Set(cols.map((c) => c.name)));
  }
  const info = db.connectionInfo;
  await db.close();
  return { schema, info };
}

async function main() {
  const { schema, info } = await loadSchemaFromMysql();
  console.log(`อ่าน schema จาก ${info}: ${schema.size} ตาราง\n`);

  const files = [];
  for (const root of ['routes', 'lib']) {
    const dir = path.join(BACKEND, root);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.js')) files.push(path.join(dir, f));
    }
  }

  let total = 0;
  for (const p of files) {
    const code = fs.readFileSync(p, 'utf8');
    let ast;
    try {
      ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script' });
    } catch (e) {
      console.log(`✖ parse ${path.relative(BACKEND, p)}: ${e.message}`);
      continue;
    }
    const found = [];
    const seen = new Set();

    const checkAll = (sql, line) => {
      for (const pr of [
        ...checkQualified(sql, schema),
        ...checkInsert(sql, schema),
        ...checkUpdate(sql, schema),
        ...checkUnqualifiedSingleTable(sql, schema),
      ]) {
        const key = `${pr.kind}:${pr.table}.${pr.column}:${pr.snippet}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ ...pr, line });
      }
    };

    walk.simple(ast, {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        checkAll(node.value, code.slice(0, node.start).split('\n').length);
      },
      TemplateLiteral(node) {
        const text = node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('?');
        checkAll(text, code.slice(0, node.start).split('\n').length);
      },
    });

    if (found.length) {
      total += found.length;
      console.log(`\n${path.relative(BACKEND, p)}`);
      for (const f of found) {
        console.log(`  [บรรทัด ${f.line}] ${f.kind}: ${f.table}.${f.column}  — ไม่มีใน schema`);
      }
    }
  }

  console.log(total === 0 ? '\n✔ ไม่พบคอลัมน์ที่ไม่มีใน schema' : `\nรวม ${total} จุด`);
  process.exit(total === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('✖ ตรวจไม่สำเร็จ:', e.message);
    process.exit(1);
  });
}

module.exports = { checkQualified, checkInsert, checkUpdate, loadSchemaFromMysql };
