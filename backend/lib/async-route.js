'use strict';
/**
 * ตัวห่อ async handler สำหรับ Express 4
 *
 * ปัญหา: Express 4 ไม่ catch promise ที่ reject — ถ้า route handler เป็น async
 * แล้ว throw จะกลายเป็น unhandled rejection ทำให้ request ค้างไม่ตอบกลับ
 * (Express 5 แก้เรื่องนี้แล้ว แต่โปรเจกต์นี้ใช้ Express 4 ตามรุ่นเดิม)
 *
 * วิธีแก้ที่เลือก: ห่อทุก handler ที่ลงทะเบียนกับ router
 * ถ้า error (ทั้ง throw แบบ sync และ reject) ให้ส่งต่อผ่าน next(err)
 * ซึ่งจะไปโดน error handler เดิมของโปรเจกต์ (คืน 500 + ข้อความไทย)
 *
 * การห่อที่ระดับ router แทนการแก้ทีละจุด ทำให้ diff จากระบบเดิมเล็กมาก
 * (แค่เพิ่มบรรทัดเดียวตอน export router)
 */

/**
 * ห่อ handler หนึ่งตัว
 * @param {Function} fn handler เดิม
 * @returns {Function} handler ที่จัดการ error ให้
 */
function wrapHandler(fn) {
  if (typeof fn !== 'function') return fn;
  // ห่อซ้ำได้ (ไม่เป็นไร)
  if (fn.__wrapped) return fn;

  const wrapped = function (...args) {
    const next = args[args.length - 1];
    const canNext = typeof next === 'function';

    let result;
    try {
      result = fn.apply(this, args);
    } catch (err) {
      if (canNext) return next(err);
      throw err;
    }

    // คืน promise (async handler) → ต้องรอและส่ง error ต่อ
    if (result && typeof result.then === 'function') {
      return result.catch((err) => {
        if (canNext) return next(err);
        throw err;
      });
    }
    return result;
  };

  wrapped.__wrapped = true;
  // คงชื่อไว้เพื่อให้ stack trace อ่านรู้เรื่อง
  try {
    Object.defineProperty(wrapped, 'name', { value: fn.name, configurable: true });
  } catch {
    /* บางกรณี defineProperty ไม่ได้ — ไม่เป็นไร */
  }
  return wrapped;
}

const METHODS = [
  'get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'all', 'use',
];

/**
 * ห่อทุก handler ที่ลงทะเบียนกับ router
 *
 * ใช้: module.exports = wrapRouter(router);
 *
 * @param {import('express').Router} router
 * @returns {import('express').Router} router เดิม (method ถูกแก้ให้ห่อแล้ว)
 */
function wrapRouter(router) {
  for (const method of METHODS) {
    const original = router[method];
    if (typeof original !== 'function') continue;
    // ห่วงกันการเรียกซ้ำ
    if (original.__routerWrapped) continue;

    const patched = function (...args) {
      // อาร์กิวเมนต์สุดท้ายคือ handler — ห่อตัวนี้
      const last = args.length - 1;
      if (last >= 0 && typeof args[last] === 'function') {
        args[last] = wrapHandler(args[last]);
      }
      // router.use(fn1, fn2, ...) — ห่อทุกตัวที่เป็นฟังก์ชัน
      if (method === 'use') {
        for (let i = 0; i < args.length; i += 1) {
          if (typeof args[i] === 'function') args[i] = wrapHandler(args[i]);
        }
      }
      return original.apply(this, args);
    };
    patched.__routerWrapped = true;
    router[method] = patched;
  }
  return router;
}

module.exports = { wrapHandler, wrapRouter };
