'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * ===== คู่มือการเพิ่มเมนู upload ใหม่ =====
 *
 * ขั้นตอน:
 * 1. เพิ่มชื่อโฟล์เดอร์ใน SUBFOLDERS (ชื่อโฟล์เดอร์ = ชื่อเมนูภาษาอังกฤษ)
 * 2. สร้าง upload object ด้วย createMenuUpload()
 * 3. ใน route file ใช้ upload object นั้น
 * 4. เก็บ path ใน DB เป็น 'subfolder/filename'
 * 5. Frontend ใช้ '/uploads/' + path จาก DB
 *
 * ตัวอย่างการเพิ่มเมนูใหม่ (เช่น "รายงาน"):
 *   const uploadReports = createMenuUpload('reports');
 *   // ใน route:
 *   router.post('/reports', uploadReports.single('file'), ...);
 *   // เก็บใน DB:
 *   const filePath = 'reports/' + req.file.filename;
 */

// ===== โฟล์เดอร์ย่อยตามเมนู =====
// เพิ่มชื่อโฟล์เดอร์ใหม่ที่นี่เมื่อมีเมนู upload ใหม่
const SUBFOLDERS = [
  'documents',    // หนังสือราชการ
  'staff',        // ข้อมูลเจ้าหน้าที่ (รูปโปรไฟล์, ลายเซ็น)
  'profile',      // ลงทะเบียน/แก้ไขโปรไฟล์
  'vehicles',     // ยานพาหนะ (รูปรถ)
  'memos',        // บันทึกข้อความ
  'travel',       // ไปราชการ
  'leaves',       // ขอลา
  'honors',       // เกียรติบัตรที่บันทึกไว้ (พร้อมพิมพ์)
  'schools',      // พิกัดโรงเรียน (รูปความเสียหายจากภัยธรรมชาติ)
  // เพิ่มใหม่ที่นี่ เช่น: 'reports', 'budgets', 'training'
];
SUBFOLDERS.forEach(sub => {
  const dir = path.join(UPLOAD_DIR, sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ===== Filters =====
const imageFilter = (req, file, cb) => {
  if (/^image\//.test(file.mimetype)) return cb(null, true);
  cb(new Error('ไฟล์ต้องเป็นรูปภาพ (jpg, png, gif, webp) เท่านั้น'));
};

const fileFilter = (req, file, cb) => {
  if (/^(image\/|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|text\/|application\/zip)/.test(file.mimetype)) {
    return cb(null, true);
  }
  cb(new Error('ประเภทไฟล์ไม่ได้รับอนุญาต (อนุญาต: รูปภาพ, PDF, Word, Excel, เอกสารข้อความ, ZIP)'));
};

// ===== Factory Functions =====

/**
 * สร้าง multer upload object สำหรับเมนูใหม่
 *
 * @param {string} subfolder - ชื่อโฟล์เดอร์ (ต้องมีใน SUBFOLDERS)
 * @param {object} options
 * @param {boolean} options.imageOnly - อนุญาตเฉพาะรูปภาพ (default: false)
 * @param {number} options.fileSize - ขนาดไฟล์สูงสุด bytes (default: 10MB)
 * @param {number} options.fieldSize - ขนาด field สูงสุด bytes (default: undefined)
 * @returns {multer} multer instance
 *
 * ตัวอย่าง:
 *   const upload = createMenuUpload('reports');                    // ไฟล์ทั่วไป 10MB
 *   const upload = createMenuUpload('reports', { imageOnly: true }); // รูปภาพเท่านั้น 5MB
 *   const upload = createMenuUpload('reports', { fileSize: 20 * 1024 * 1024 }); // 20MB
 */
function createMenuUpload(subfolder, options = {}) {
  if (!SUBFOLDERS.includes(subfolder)) {
    console.warn(`[uploads] Warning: subfolder '${subfolder}' is not in SUBFOLDERS list. Add it to avoid issues.`);
  }
  const destDir = path.join(UPLOAD_DIR, subfolder);
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, destDir),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
      const safe = (ext || '.bin').slice(0, 10);
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${safe}`);
    },
  });
  const opts = { storage };
  if (options.imageOnly) {
    opts.fileFilter = imageFilter;
    opts.limits = { fileSize: options.fileSize || 5 * 1024 * 1024 };
  } else {
    opts.fileFilter = fileFilter;
    opts.limits = { fileSize: options.fileSize || 10 * 1024 * 1024 };
  }
  if (options.fieldSize) opts.limits.fieldSize = options.fieldSize;
  return multer(opts);
}

// ===== Upload objects สำหรับแต่ละเมนู (สร้างด้วย createMenuUpload) =====

const uploadDocuments = createMenuUpload('documents');
const uploadStaff    = createMenuUpload('staff', { imageOnly: true });
const uploadProfile  = createMenuUpload('profile', { imageOnly: true });
const uploadVehicles = createMenuUpload('vehicles', { imageOnly: true });
const uploadMemos    = createMenuUpload('memos', { fileSize: 5 * 1024 * 1024, fieldSize: 8 * 1024 * 1024 });
const uploadTravel   = createMenuUpload('travel');
const uploadLeaves   = createMenuUpload('leaves');

// Legacy aliases
const uploadImages    = uploadProfile;
const uploadFiles     = uploadDocuments;
const uploadMemoFiles = uploadMemos;

// ===== Helpers =====

function uploadErrorHandler(err, req, res, next) {
  if (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const mb = Math.round((err.limit || 5 * 1024 * 1024) / 1024 / 1024);
      return res.status(400).json({ error: `ไฟล์ใหญ่เกินไป — แต่ละไฟล์ต้องไม่เกิน ${mb} MB` });
    }
    if (err.code === 'LIMIT_FIELD_VALUE') {
      return res.status(400).json({ error: 'ข้อความหรือเนื้อหายาวเกินไป — กรุณาลดขนาดเนื้อหา แล้วลองใหม่' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'จำนวนไฟล์แนบเกินกำหนด' });
    }
    return res.status(400).json({ error: err.message || 'การอัปโหลดไฟล์ล้มเหลว' });
  }
  next();
}

function deleteUploadedFile(name) {
  if (!name || name.includes('..') || name.startsWith('/')) return;
  if (name.includes('/')) {
    const p = path.join(UPLOAD_DIR, name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return;
  }
  for (const sub of SUBFOLDERS) {
    const p = path.join(UPLOAD_DIR, sub, name);
    if (fs.existsSync(p)) { fs.unlinkSync(p); return; }
  }
  const p = path.join(UPLOAD_DIR, name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function renameAsCitizen(oldName, citizenId, kind) {
  if (!oldName) return null;
  const ext = path.extname(oldName) || '.bin';
  const newName = `${citizenId}_${kind}${ext.toLowerCase()}`;
  let oldPath = null;
  if (oldName.includes('/')) {
    oldPath = path.join(UPLOAD_DIR, oldName);
  } else {
    for (const sub of SUBFOLDERS) {
      const p = path.join(UPLOAD_DIR, sub, oldName);
      if (fs.existsSync(p)) { oldPath = p; break; }
    }
    if (!oldPath) oldPath = path.join(UPLOAD_DIR, oldName);
  }
  const newPath = path.join(UPLOAD_DIR, 'staff', newName);
  if (!fs.existsSync(oldPath)) return oldName;
  if (fs.existsSync(newPath) && oldPath !== newPath) fs.unlinkSync(newPath);
  fs.renameSync(oldPath, newPath);
  return `staff/${newName}`;
}


// ===== Dynamic Upload (separate folders by school) =====
function getUploadSubdir(req, subfolder) {
  if (req.user && req.user.school_code) {
    return req.user.school_code + '/' + subfolder;
  }
  return subfolder;
}

function createDynamicUpload(subfolder, options) {
  if (!SUBFOLDERS.includes(subfolder)) {
    console.warn('[uploads] Warning: subfolder ' + subfolder + ' is not in SUBFOLDERS list.');
  }
  var storage = multer.diskStorage({
    destination: function(req, file, cb) {
      var dir = path.join(UPLOAD_DIR, getUploadSubdir(req, subfolder));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: function(req, file, cb) {
      var ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
      var safe = (ext || '.bin').slice(0, 10);
      cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + safe);
    },
  });
  var opts = { storage: storage };
  if (options && options.imageOnly) {
    opts.fileFilter = imageFilter;
    opts.limits = { fileSize: options.fileSize || 5 * 1024 * 1024 };
  } else {
    opts.fileFilter = fileFilter;
    opts.limits = { fileSize: (options && options.fileSize) || 10 * 1024 * 1024 };
  }
  if (options && options.fieldSize) opts.limits.fieldSize = options.fieldSize;
  return multer(opts);
}
module.exports = {
  UPLOAD_DIR, SUBFOLDERS, createMenuUpload, createDynamicUpload, getUploadSubdir,
  uploadDocuments, uploadStaff, uploadProfile, uploadVehicles,
  uploadMemos, uploadTravel, uploadLeaves,
  uploadImages, uploadFiles, uploadMemoFiles,
  uploadErrorHandler, deleteUploadedFile, renameAsCitizen,
};
