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
 *
 * ⚠️ ต้อง "คงจำนวนพารามิเตอร์" ของเดิมไว้ ไม่งั้น Express จะสับสน
 *
 * Express 4 ตัดสินว่าจะเรียกฟังก์ชันแบบไหนด้วย fn.length
 *   - fn.length > 3  → ข้ามไป ไม่เรียกเป็น handler ปกติ (เป็น error middleware)
 *   - fn.length === 4 → เรียกเป็น (err, req, res, next) เมื่อมี error
 *
 * ถ้าห่อด้วย (...args) จะกลายเป็น length = 0 ทำให้ error middleware
 * อย่าง uploadErrorHandler ถูกเรียกผิดแบบ → "res.status is not a function"
 * และพังทุก endpoint ที่แนบไฟล์ (หนังสือ · บันทึกข้อความ · ไปราชการ · ลา · ยานพาหนะ)
 *
 * @param {Function} fn handler เดิม
 * @returns {Function} handler ที่จัดการ error ให้
 */
function wrapHandler(fn) {
  if (typeof fn !== 'function') return fn;
  // ห่อซ้ำได้ (ไม่เป็นไร)
  if (fn.__wrapped) return fn;

  /** เรียก handler เดิม แล้วส่ง error ไปที่ next */
  function invoke(self, args) {
    const next = args[args.length - 1];
    const canNext = typeof next === 'function';

    let result;
    try {
      result = fn.apply(self, args);
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
  }

  // สร้าง wrapper ที่ length ตรงกับของเดิมทุกกรณี
  let wrapped;
  if (fn.length >= 4) {
    wrapped = function (err, req, res, next) { return invoke(this, arguments); };
  } else if (fn.length === 3) {
    wrapped = function (req, res, next) { return invoke(this, arguments); };
  } else if (fn.length === 2) {
    wrapped = function (req, res) { return invoke(this, arguments); };
  } else if (fn.length === 1) {
    wrapped = function (req) { return invoke(this, arguments); };
  } else {
    wrapped = function () { return invoke(this, arguments); };
  }

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

  /*
   * สำคัญมาก: route ส่วนใหญ่ถูกลงทะเบียนไว้ก่อนเรียก wrapRouter()
   * การ patch router.get/post จึงไม่กระทบ route ที่ลงทะเบียนไปแล้ว
   * ต้องไล่ห่อใน router.stack ด้วย ไม่งั้น error จะหลุดเป็น unhandled rejection
   * แล้ว Node จะปิดทั้งเซิร์ฟเวอร์ (ผู้ใช้ทุกคนหลุดจากระบบพร้อมกัน)
   *
   * เคยเจอจริงที่ /my-incoming: ใช้ GLOB ซึ่ง MariaDB ไม่รู้จัก → SQL error
   * → ไม่มีใคร catch → ทั้งเซิร์ฟเวอร์ล่ม
   */
  return wrapExistingRoutes(router);
}

/** ห่อ handler ที่ลงทะเบียนไว้แล้วใน router.stack (ของ Express 4) */
function wrapExistingRoutes(router) {
  const stack = router && router.stack;
  if (!Array.isArray(stack)) return router;

  for (const layer of stack) {
    if (layer.route && Array.isArray(layer.route.stack)) {
      for (const r of layer.route.stack) {
        if (typeof r.handle === 'function') r.handle = wrapHandler(r.handle);
      }
      continue;
    }
    // router.use(fn) — ห่อตัว middleware
    if (!layer.route && typeof layer.handle === 'function') {
      layer.handle = wrapHandler(layer.handle);
    }
  }
  return router;
}

module.exports = { wrapHandler, wrapRouter, wrapExistingRoutes };
