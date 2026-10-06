# คู่มือการจัดการไฟล์ Upload ตามเมนู

## โครงสร้างโฟล์เดอร์

```
public/uploads/
├── documents/    ← หนังสือราชการ
├── staff/        ← รูปโปรไฟล์, ลายเซ็นเจ้าหน้าที่
├── profile/      ← ลงทะเบียน/แก้ไขโปรไฟล์
├── vehicles/     ← รูปรถยนต์ราชการ
├── memos/        ← ไฟล์แนบบันทึกข้อความ
├── travel/       ← เอกสารแนบไปราชการ
└── leaves/       ← เอกสารแนบขอลา
```

## ขั้นตอนการเพิ่มเมนู upload ใหม่

### 1. เพิ่มโฟล์เดอร์ใน `lib/uploads.js`

```javascript
const SUBFOLDERS = [
  'documents',
  'staff',
  'profile',
  'vehicles',
  'memos',
  'travel',
  'leaves',
  'reports',      // ← เพิ่มใหม่
];
```

### 2. สร้าง upload object

```javascript
const uploadReports = createMenuUpload('reports');
// หรือถ้าต้องการแค่รูปภาพ:
// const uploadReports = createMenuUpload('reports', { imageOnly: true });
// หรือกำหนดขนาดไฟล์:
// const uploadReports = createMenuUpload('reports', { fileSize: 20 * 1024 * 1024 });
```

### 3. เพิ่มใน module.exports

```javascript
module.exports = {
  // ... existing
  uploadReports,  // ← เพิ่มใหม่
};
```

### 4. ใช้ใน route file

```javascript
const { uploadReports, uploadErrorHandler, deleteUploadedFile } = require('../lib/uploads');

router.post('/reports', auth.requireAuth, uploadReports.single('file'), uploadErrorHandler, (req, res) => {
  const file = req.file ? 'reports/' + req.file.filename : null;
  // ... เก็บ file path ใน DB
});
```

### 5. Frontend ใช้ path จาก DB โดยตรง

```javascript
// DB เก็บ: 'reports/1234567890-abc12345.pdf'
// Frontend ใช้:
const fileUrl = '/uploads/' + report.file;  // → /uploads/reports/1234567890-abc12345.pdf
```

## สรุปRULES

| ขั้นตอน | ทำอะไร |
|---------|--------|
| **SUBFOLDERS** | เพิ่มชื่อโฟล์เดอร์ใหม่ |
| **createMenuUpload()** | สร้าง upload object สำหรับเมนูนั้น |
| **Route** | ใช้ upload object + เก็บ path เป็น `subfolder/filename` |
| **DB** | เก็บ path เต็ม เช่น `reports/abc.pdf` |
| **Frontend** | ใช้ `/uploads/` + path จาก DB |
| **Delete** | ใช้ `deleteUploadedFile(path)` ค้นหาและลบในโฟล์เดอร์ที่ถูกต้อง |

## ตัวอย่าง createMenuUpload options

```javascript
// ไฟล์ทั่วไป 10MB (ค่าเริ่มต้น)
createMenuUpload('reports')

// รูปภาพเท่านั้น 5MB
createMenuUpload('reports', { imageOnly: true })

// ไฟล์ทั่วไป 20MB
createMenuUpload('reports', { fileSize: 20 * 1024 * 1024 })

// ไฟล์แนบบันทึกข้อความ (fieldSize ใหญ่สำหรับ rich text)
createMenuUpload('reports', { fileSize: 5 * 1024 * 1024, fieldSize: 8 * 1024 * 1024 })
```

## ไฟล์ที่เกี่ยวข้อง

- `lib/uploads.js` — สร้าง upload object + helpers
- `routes/*.js` — ใช้ upload object ใน route
- `public/js/views/*.js` — Frontend โหลดไฟล์จาก `/uploads/`
