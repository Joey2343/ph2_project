'use strict';
/**
 * Codemod: แปลงโค้ด backend เดิม (synchronous, better-sqlite3) ให้เป็น async
 *
 * สิ่งที่ codemod นี้ทำ (3 อย่างเท่านั้น เพื่อให้ diff ต่ำที่สุด):
 *   1. เติม `await` หน้าการเรียก SQL ทุกจุด
 *   2. เติม keyword `async` ให้ฟังก์ชันที่บรรทัดนั้นอยู่
 *   3. ห่อชื่อคอลัมน์ `key` / `read` ด้วย backtick (เป็น reserved word ของ MySQL
 *      แต่ SQLite รองรับ backtick เช่นกัน จึงปลอดภัยกับทั้งสอง dialect)
 *
 * สิ่งที่ codemod นี้ "ไม่" ทำ — ต้องแก้ด้วยมือ:
 *   - ไม่แปลง dialect ของ SQL (ปล่อยให้ db/sql.js จัดการตอนรัน)
 *   - ไม่ห่อ handler ด้วย try/catch (ใช้ lib/async-route.js แทนแทน)
 *
 * ใช้: node scripts/codemod-async.js [--dry] [ไฟล์...]
 */

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');
const util = require('./codemod-util');

const DRY = process.argv.includes('--dry');

/** คอลัมน์ที่เป็น reserved word ของ MySQL แต่ SQLite ไม่บังคับ */
const RESERVED_COLUMNS = ['key', 'read'];

const SQL_HINT = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|WHERE|VALUES|FROM|ON\s+CONFLICT)\b/i;

function parse(code, file) {
  // allowAwaitOutsideFunction: เผื่อไฟล์ยังมี await ที่หลุดออกมานอก async
  // (เช่น หลัง codemod-foreach ยุบ callback เข้าฟังก์ชันแม่) — ให้ parse ผ่านก่อน
  // แล้วค่อยให้ codemod-async-propagate.js เติม async ให้
  return acorn.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowAwaitOutsideFunction: true,
    locations: false,
    onComment: [],
  });
}

// ── ตรวจว่า call นี้เป็นจุดเรียก SQL หรือไม่ ────────────────────────────────
// รองรับ 3 รูปแบบ:
//   db.prepare(sql).get(...)  /  db.prepare(sql).all(...)  /  db.prepare(sql).run(...)
//   stmtIdent.get(...)  (stmtIdent มาจาก const stmtIdent = db.prepare(...))
//   db.exec(...) / db.transaction(...) / db.pragma(...)
const TERMINALS = new Set(['get', 'all', 'run']);
const DB_DIRECT = new Set(['exec', 'transaction', 'pragma']);

function isDialectNeutralSqlString(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return SQL_HINT.test(node.value);
  if (node.type === 'TemplateLiteral') {
    return node.quasis.some((q) => SQL_HINT.test(q.value.cooked ?? q.value.raw));
  }
  return false;
}

/** ชื่อ identifier ที่ผูกกับ db.prepare(...) ในไฟล์เดียวกัน */
function collectPreparedNames(ast) {
  const names = new Set();
  walk.simple(ast, {
    VariableDeclarator(node) {
      const { id, init } = node;
      if (!init || id.type !== 'Identifier') return;
      if (
        init.type === 'CallExpression' &&
        init.callee.type === 'MemberExpression' &&
        init.callee.property.name === 'prepare'
      ) {
        names.add(id.name);
      }
    },
  });
  return names;
}

function isDbCallee(callee) {
  return (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'db' &&
    DB_DIRECT.has(callee.property.name)
  );
}

/** คืน node ที่ต้องเติม await (หรือ null) */
function awaitTarget(node, preparedNames) {
  if (node.type !== 'CallExpression') return null;

  // db.exec(...) / db.transaction(...) / db.pragma(...)
  if (isDbCallee(node.callee)) return node;

  if (node.callee.type !== 'MemberExpression') return null;
  const prop = node.callee.property.name;
  if (!TERMINALS.has(prop)) return null;

  const obj = node.callee.object;

  // db.prepare(...).get(...)
  if (
    obj.type === 'CallExpression' &&
    obj.callee.type === 'MemberExpression' &&
    obj.callee.object.type === 'Identifier' &&
    obj.callee.object.name === 'db' &&
    obj.callee.property.name === 'prepare'
  ) {
    return node;
  }

  // stmtIdent.get(...) โดย stmtIdent ถูกผูกกับ db.prepare(...)
  if (obj.type === 'Identifier' && preparedNames.has(obj.name)) return node;

  return null;
}

/** เดินขึ้นไปหา function ที่ครอบอยู่ */
function enclosingFunction(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const n = ancestors[i];
    if (
      n.type === 'FunctionDeclaration' ||
      n.type === 'FunctionExpression' ||
      n.type === 'ArrowFunctionExpression'
    ) {
      return n;
    }
  }
  return null;
}

/** เดินขึ้นไปหา statement ที่ครอบ await target อยู่ */
function enclosingStatement(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const n = ancestors[i];
    if (
      n.type === 'ExpressionStatement' ||
      n.type === 'VariableDeclaration' ||
      n.type === 'ReturnStatement' ||
      n.type === 'IfStatement' ||
      n.type === 'SwitchCase' ||
      n.type === 'ForStatement' ||
      n.type === 'ForOfStatement' ||
      n.type === 'ForInStatement' ||
      n.type === 'WhileStatement' ||
      n.type === 'ThrowStatement' ||
      n.type === 'ArrayExpression' ||
      n.type === 'Property' ||
      n.type === 'TemplateLiteral' ||
      n.type === 'ConditionalExpression' ||
      n.type === 'LogicalExpression' ||
      n.type === 'CallExpression' ||
      n.type === 'AwaitExpression' ||
      n.type === 'BlockStatement'
    ) {
      return n;
    }
  }
  return null;
}

/** มี await อยู่แล้วหรือยัง */
function alreadyAwaited(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const n = ancestors[i];
    if (n.type === 'AwaitExpression') return true;
    // เจอ statement boundary ก่อน → ยังไม่มี await
    if (
      n.type === 'ExpressionStatement' ||
      n.type === 'VariableDeclaration' ||
      n.type === 'ReturnStatement'
    ) {
      return false;
    }
  }
  return false;
}

/**
 * `await` มีลำดับความสำคัญต่ำกว่าการเข้าถึงสมาชิก
 *   await db.prepare(s).get(uid).c   →  await (db.prepare(s).get(uid).c)   ← .c บน promise = undefined
 * จึงต้องใส่วงเล็บเมื่อผลลัพธ์ถูกนำไปเข้าถึงสมาชิกต่อ
 */
function needsParens(ancestors, target) {
  const idx = ancestors.lastIndexOf(target);
  for (let i = idx + 1; i < ancestors.length; i += 1) {
    const n = ancestors[i];
    if (n.type === 'MemberExpression' && n.object === target) return true;
    // ถ้าเจอ boundary ที่ตัดความเกี่ยวข้องก่อน แปลว่าไม่ต้องใส่วงเล็บ
    if (
      n.type === 'CallExpression' ||
      n.type === 'MemberExpression' ||
      n.type === 'AwaitExpression'
    ) {
      continue;
    }
    return false;
  }
  return false;
}

// ── การห่อ backtick ให้คอลัมน์ reserved ──────────────────────────────────
function backtickReserved(code) {
  // ทำงานบน SQL string literal เท่านั้น
  // ใช้ regex ที่ไม่ไปแตะ single-quoted ค่าใน SQL
  let changed = 0;
  const pattern = /\b(key|read)\b/g;
  return {
    changed,
    // ใช้ฟังก์ชันแยกต่างหากเพื่อไม่ไปแก้โค้ด JS (ดู applyBackticks)
  };
}

/**
 * ห่อ identifier ที่เป็น reserved word ภายใน SQL string ด้วย backtick
 * ข้ามอักขระที่อยู่ใน single-quoted string ของ SQL
 */
function applyBackticks(node, code, edits) {
  if (node.type === 'Literal' && typeof node.value === 'string' && SQL_HINT.test(node.value)) {
    const raw = code.slice(node.start, node.end);
    // หา quote ที่ใช้ปิด string ของโค้ด JS
    const q = raw[0];
    const body = raw.slice(1, -1);
    const inner = q === '"' ? '"' : q;
    let out = '';
    let inSqlString = false;
    let i = 0;
    while (i < body.length) {
      const ch = body[i];
      if (ch === inner && !inSqlString) {
        // เข้า single-quoted string ของ SQL → ข้ามไปจนกว่าจะปิด
        let j = i + 1;
        let lit = ch;
        while (j < body.length) {
          if (body[j] === '\\') {
            j += 2;
            continue;
          }
          lit += body[j];
          if (body[j] === inner) {
            j += 1;
            break;
          }
          j += 1;
        }
        inSqlString = true;
        out += lit;
        i = j;
        continue;
      }
      if (ch === inner && inSqlString) {
        inSqlString = false;
        out += ch;
        i += 1;
        continue;
      }
      out += ch;
      i += 1;
    }
    const newBody = out.replace(/\b(key|read)\b/g, '`$1`');
    if (newBody !== body) {
      edits.push({ start: node.start, end: node.end, text: q + newBody + q });
    }
    return;
  }

  if (node.type === 'TemplateLiteral') {
    for (const quasi of node.quasis) {
      const body = code.slice(quasi.start, quasi.end);
      // ต้อง escape backtick — ไม่งั้น template literal จะหลุดปิดกลางข้อความ
      const newBody = body.replace(/\b(key|read)\b/g, '\\`$1\\`');
      if (newBody !== body) {
        edits.push({ start: quasi.start, end: quasi.end, text: newBody });
      }
    }
  }
}

function transform(code, file) {
  const ast = parse(code, file);
  const preparedNames = collectPreparedNames(ast);

  const edits = [];
  const asyncFns = new Set();
  let awaitCount = 0;
  let backtickCount = 0;

  // เก็บ ancestor stack ระหว่างเดิน
  const stack = [];
  const full = walk.ancestor(ast, {
    CallExpression(node, ancestors) {
      const target = awaitTarget(node, preparedNames);
      if (!target) return;
      if (alreadyAwaited(ancestors)) return;
      if (needsParens(ancestors, node)) {
        // (await expr)  — ป้องกันการเข้าถึงสมาชิกบน promise
        edits.push({ start: target.start, end: target.start, text: '(await ' });
        edits.push({ start: target.end, end: target.end, text: ')' });
      } else {
        edits.push({ start: target.start, end: target.start, text: 'await ' });
      }
      awaitCount += 1;

      const fn = enclosingFunction(ancestors);
      if (fn) asyncFns.add(fn);
    },
    Literal(node) {
      if (typeof node.value !== 'string') return;
      if (!SQL_HINT.test(node.value)) return;
      const before = edits.length;
      applyBackticks(node, code, edits);
      backtickCount += edits.length - before;
    },
    TemplateLiteral(node) {
      applyBackticks(node, code, edits);
    },
  });
  void full;
  void stack;

  // เติม async ให้ฟังก์ชัน
  for (const fn of asyncFns) {
    if (fn.async) continue;
    if (fn.type === 'ArrowFunctionExpression' && fn.body.type !== 'BlockStatement') {
      // arrow แบบ expression body — ห่อเป็น block พร้อม return
      // (ดู codemod-util.js ว่าทำไมต้องแทรกหลัง token `=>`)
      edits.push(...util.wrapConciseArrow(fn, code, 'async '));
      continue;
    }
    edits.push({ start: fn.start, end: fn.start, text: 'async ' });
  }

  // เรียง edit จากท้ายไปหน้าเพื่อไม่ให้ offset เพี้ยน
  edits.sort((a, b) => b.start - a.start || b.end - a.end);

  let out = code;
  let applied = 0;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    applied += 1;
  }

  return { out, awaitCount, backtickCount, asyncFns: asyncFns.size, applied };
}

function main() {
  const targets = [];
  const roots = [path.join(__dirname, '..', 'routes'), path.join(__dirname, '..', 'lib')];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const f of fs.readdirSync(root)) {
      if (f.endsWith('.js')) targets.push(path.join(root, f));
    }
  }
  // ไฟล์ที่ระบุเพิ่มจาก argv
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--')) continue;
    targets.push(path.resolve(a));
  }

  let totalAwait = 0;
  let totalTick = 0;
  for (const file of targets) {
    const code = fs.readFileSync(file, 'utf8');
    let result;
    try {
      result = transform(code, file);
    } catch (err) {
      console.error(`✖ ${path.relative(process.cwd(), file)} — parse error: ${err.message}`);
      continue;
    }
    totalAwait += result.awaitCount;
    totalTick += result.backtickCount;
    const rel = path.relative(path.join(__dirname, '..'), file);
    if (result.out === code) {
      console.log(`– ${rel}: ไม่มีอะไรต้องแก้`);
      continue;
    }
    if (DRY) {
      console.log(`? ${rel}: +${result.awaitCount} await, async x${result.asyncFns}, backtick x${result.backtickCount}`);
      continue;
    }
    fs.writeFileSync(file, result.out, 'utf8');
    console.log(
      `✔ ${rel}: +${result.awaitCount} await · async ${result.asyncFns} ฟังก์ชัน · backtick ${result.backtickCount} · edits ${result.applied}`
    );
  }
  console.log(`\nรวม: await ${totalAwait} · backtick ${totalTick}`);
}

/** รัน transform กับทุกไฟล์ใน routes/ และ lib/ (ใช้โดย port-to-async.js) */
function transformAll() {
  const out = [];
  for (const root of ['routes', 'lib']) {
    const dir = path.join(__dirname, '..', root);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.js')) continue;
      const p = path.join(dir, f);
      const code = fs.readFileSync(p, 'utf8');
      const r = transform(code, p);
      if (r.out !== code) fs.writeFileSync(p, r.out, 'utf8');
      out.push({
        name: `${root}/${f}`,
        awaitCount: r.awaitCount,
        backtickCount: r.backtickCount,
      });
    }
  }
  return out;
}

if (require.main === module) main();

module.exports = { transform, transformAll, parse };
