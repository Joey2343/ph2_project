/**
 * check-ref-payload.mjs — กันไม่ให้ส่ง Vue ref/computed เข้า payload ของ API โดยไม่แก้ .value
 *
 * บั๊กที่เจอจริง (หน้า "วันลาพักผ่อนสะสม" — LeaveBalance.vue):
 *   api.put('/leave-balances/1', { year, vacation_accumulated: … })
 *                      ^^^^ คือ Ref object ไม่ใช่ตัวเลข
 *   → JSON.stringify() โยน "Converting circular structure to JSON"
 *   → fetch ไม่ถูกเรียกเลย ผู้ใช้กด "บันทึก" แล้วไม่มีอะไรเกิดขึ้น
 *
 * วิธีตรวจ: หา object literal ที่ส่งเป็น argument ตัวที่ 2 ของ api.put / api.post
 * แล้วแยก property ที่ระดับบนสุด ดูว่าตัวไหนมีค่าเป็นชื่อที่ประกาศด้วย ref()/computed()
 * โดยไม่มี .value ต่อท้าย
 *
 * ใช้: node scripts/check-ref-payload.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(vue|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** ตัด comment ออก (แทนที่ด้วยช่องว่าง ยาวเท่าเดิม เพื่อให้เลขบรรทัดยังตรง) */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c2 = src.slice(i, i + 2);
    if (c2 === '//') {
      while (i < n && src[i] !== '\n') { out += ' '; i += 1; }
    } else if (c2 === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (; i < stop; i += 1) out += src[i] === '\n' ? '\n' : ' ';
    } else if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
      const q = src[i];
      out += src[i]; i += 1;
      while (i < n) {
        if (src[i] === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i += 1; break; }
        i += 1;
      }
    } else {
      out += src[i]; i += 1;
    }
  }
  return out;
}

/** ชื่อที่ประกาศด้วย ref() / computed() / shallowRef() */
function reactiveNames(src) {
  const names = new Set();
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:ref|computed|shallowRef)\s*\(/g;
  let m;
  while ((m = re.exec(src))) names.add(m[1]);
  return names;
}

function lineOf(src, idx) {
  let n = 1;
  for (let i = 0; i < idx && i < src.length; i += 1) if (src[i] === '\n') n += 1;
  return n;
}

/** จับคู่วงเล็บปีกกา โดยข้ามสตริง */
function matchPair(src, start, open, close) {
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i += 1;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i += 1; i += 1; }
      continue;
    }
    if (c === open) depth += 1;
    else if (c === close) { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** แบ่ง object literal เป็น property ที่ระดับบนสุด → [{ start, text }] */
function splitProps(body) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i += 1;
      while (i < body.length && body[i] !== q) { if (body[i] === '\\') i += 1; i += 1; }
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) {
      if (body.slice(start, i).trim()) out.push({ start, text: body.slice(start, i) });
      start = i + 1;
    }
  }
  if (body.slice(start).trim()) out.push({ start, text: body.slice(start) });
  return out;
}

/** ถ้าค่าของ property เป็นชื่อตัวแปรเดี่ยว (ไม่มี . ต่อท้าย) ให้คืนชื่อนั้น */
function bareIdentifier(expr) {
  const s = expr.trim();
  if (!s || s.startsWith('...')) return null;
  if (!/^[A-Za-z_$][\w$]*$/.test(s)) return null;
  return s;
}

const problems = [];
const files = walk(join(ROOT, 'src'));

for (const f of files) {
  const rel = relative(ROOT, f);
  const src = stripComments(readFileSync(f, 'utf8'));
  const names = reactiveNames(src);
  if (!names.size) continue;

  const callRe = /\bapi\.(?:put|post)\s*\(/g;
  let m;
  while ((m = callRe.exec(src))) {
    const argList = matchPair(src, callRe.lastIndex - 1, '(', ')');
    if (argList === -1) continue;

    // เดินหา argument ตัวที่ 2 (ข้ามตัวแรก แล้วข้าม , ที่ระดับบนสุด)
    let i = callRe.lastIndex;
    let depth = 1;
    while (i < argList && depth > 0) {
      const c = src[i];
      if (c === '"' || c === "'" || c === '`') {
        const q = c; i += 1;
        while (i < argList && src[i] !== q) { if (src[i] === '\\') i += 1; i += 1; }
        i += 1; continue;
      }
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') depth -= 1;
      else if (c === ',' && depth === 1) break;
      i += 1;
    }
    let a = i + 1;
    while (a < argList && /\s/.test(src[a])) a += 1;
    if (src[a] !== '{') continue;
    const end = matchPair(src, a, '{', '}');
    if (end === -1) continue;
    const body = src.slice(a + 1, end);

    for (const prop of splitProps(body)) {
      const raw = prop.text;
      // หา ":" ที่ระดับบนสุดของ property นี้
      let k = 0;
      let d = 0;
      let colon = -1;
      while (k < raw.length) {
        const c = raw[k];
        if (c === '"' || c === "'" || c === '`') {
          const q = c; k += 1;
          while (k < raw.length && raw[k] !== q) { if (raw[k] === '\\') k += 1; k += 1; }
          k += 1; continue;
        }
        if (c === '(' || c === '[' || c === '{') d += 1;
        else if (c === ')' || c === ']' || c === '}') d -= 1;
        else if (c === ':' && d === 0) { colon = k; break; }
        k += 1;
      }

      let valueName;
      let valueOffset;
      if (colon === -1) {
        valueName = bareIdentifier(raw);
        valueOffset = 0;
      } else {
        valueName = bareIdentifier(raw.slice(colon + 1));
        valueOffset = colon + 1;
      }
      if (!valueName || !names.has(valueName)) continue;
      problems.push({ file: rel, line: lineOf(src, a + 1 + prop.start + valueOffset), name: valueName });
    }
  }
}

const lines = [];
if (!problems.length) {
  lines.push('ผ่าน — ไม่พบการส่ง ref/computed เข้า payload ของ api.put/api.post โดยไม่แก้ .value');
} else {
  lines.push('ไม่ผ่าน — พบ ' + problems.length + ' จุดที่ส่ง ref/computed เข้า payload โดยไม่แก้ .value');
  lines.push('');
  for (const pr of problems) {
    lines.push('  ' + pr.file + ':' + pr.line);
    lines.push('      → ส่ง "' + pr.name + '" เข้า payload (ต้องเป็น ' + pr.name + '.value)');
  }
  lines.push('');
  lines.push('อาการ: JSON.stringify จะโยน "Converting circular structure to JSON"');
  lines.push('       → fetch ไม่ถูกเรียก ผู้ใช้กด "บันทึก" แล้วไม่มีอะไรเกิดขึ้น');
}
console.log(lines.join('\n'));
process.exit(problems.length ? 1 : 0);