'use strict';
/**
 * เครื่องมือร่วมของ codemod
 *
 * ปัญหาที่แก้: การเปลี่ยน arrow แบบ expression body ให้เป็น block
 *   เดิม:  (r) => ({ ...r, a: await f() })
 *   ต้อง:  async (r) => { return { ...r, a: await f() } }
 *
 * ข้อควรระวัง: body อาจเป็น ObjectExpression ที่อยู่ในวงเล็บ
 *   body.start จึงชี้ที่ `{` ไม่ใช่ `(` การแทรกตรง body.start จะได้
 *   async (r) => ({ return { ... } }) ซึ่งพัง
 *
 * วิธีที่ถูก: แทรกหลัง token `=>` และปิดท้ายสุดท้ายของ arrow
 */

/**
 * สร้าง edits สำหรับการห่อ arrow แบบ expression body ให้เป็น async block
 * @param {object} fn  ArrowFunctionExpression node (body ไม่ใช่ BlockStatement)
 * @param {string} code  ซอร์สทั้งไฟล์
 * @param {string} keyword  'async ' หรือ ''
 * @returns {Array<{start,end,text}>}
 */
function wrapConciseArrow(fn, code, keyword = 'async ') {
  const arrow = findArrowToken(fn, code);
  if (arrow === -1) return [];
  return [
    { start: fn.start, end: fn.start, text: keyword },
    { start: arrow + 2, end: arrow + 2, text: ' { return ' },
    { start: fn.end, end: fn.end, text: ' }' },
  ];
}

/**
 * หาตำแหน่ง token `=>` ของ arrow
 * มองจากปลาย params ไปถึงต้น body แล้วเอา `=>` ตัวสุดท้าย
 */
function findArrowToken(fn, code) {
  const bodyStart = fn.body.start;
  // ปลายสุดท้ายของพารามิเตอร์ตัวสุดท้าย
  let paramEnd = fn.start;
  for (const p of fn.params) paramEnd = Math.max(paramEnd, p.end);
  if (fn.id) paramEnd = Math.max(paramEnd, fn.id.end);
  const slice = code.slice(paramEnd, bodyStart);
  const idx = slice.lastIndexOf('=>');
  return idx === -1 ? -1 : paramEnd + idx;
}

/**
 * แทรก async ให้ฟังก์ชันที่มี block body ปกติ
 * @returns {Array<{start,end,text}>}
 */
function markAsync(fn, code) {
  if (fn.async) return [];
  if (fn.type === 'ArrowFunctionExpression' && fn.body.type !== 'BlockStatement') {
    return wrapConciseArrow(fn, code);
  }
  return [{ start: fn.start, end: fn.start, text: 'async ' }];
}

module.exports = { wrapConciseArrow, findArrowToken, markAsync };
