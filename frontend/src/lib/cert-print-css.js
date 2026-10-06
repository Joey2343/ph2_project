/**
 * CSS ของหน้าต่างพิมพ์แบบฟอร์มหนังสือรับรอง A4
 *
 * แยกไว้ในไฟล์ JS เพราะต้องฝังลงหน้าต่างพิมพ์ที่เปิดด้วย window.open
 * (inline <style> ในหน้าเดิมที่ถูกโหลดแยกจะไม่มีผลกับเอกสารใหม่)
 *
 * port มาจาก DocumentsView.printCertificateA4() — ห้ามแก้ให้ต่างจากต้นฉบับ
 * เพราะผลลัพธ์คือเอกสารที่ส่งออกไปใช้งานจริง
 */
export const CERT_PRINT_CSS = `
  @page { size: A4; margin: 0; }
  @font-face { font-family: 'THSarabunIT๙'; src: url('/fonts/THSarabunIT๙.ttf') format('truetype'); font-weight: 400; }
  @font-face { font-family: 'THSarabunIT๙'; src: url('/fonts/THSarabunIT๙ Bold.ttf') format('truetype'); font-weight: 700; }
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'THSarabunIT๙', 'TH Sarabun', 'THSarabun', sans-serif; font-size: 22px; }
  body { background: #f0f2f5; padding: 24px; }
  .cert-doc { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 15mm 14mm; padding-left: calc(14mm - 15px); padding-right: 60px; background: #fff; box-shadow: 0 2px 16px rgba(0,0,0,.12); color: #000; line-height: 1.55; position: relative; }
  .cert-doc-logo { display: flex; justify-content: center; margin-bottom: 8px; }
  .cert-doc-logo img { height: 110px; object-fit: contain; }
  .cert-doc-headrow { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-top: -44px; position: relative; line-height: 1.35; }
  .cert-doc-no { white-space: nowrap; text-indent: 2em; }
  .cert-doc-addr { text-align: right; margin-top: -6px; }
  .cert-doc-officeblock { width: max-content; text-align: left; }.cert-doc-body { margin-top: 28px; }
.cert-doc-body p { font-size: 22px; line-height: 1.4; margin: 0 0 2px; text-align: justify; padding-left: 44px; text-indent: 0; }
.cert-doc-body p.indent { text-indent: calc(6em - 44px); }
.cert-doc-date { margin-top: 16px; text-align: center; font-size: 22px; }
.cert-doc-note-line { position: absolute; left: 0; right: 0; bottom: calc(15mm + 126px); text-align: center; font-size: 22px; }
.cert-doc-check { position: absolute; right: calc(9mm + 12px); bottom: 15mm; border: 0.5px solid #000; padding: 8px 20px; font-size: 22px; line-height: 1.5; white-space: nowrap; }

  .toolbar { max-width: 210mm; margin: 0 auto 14px; display: flex; gap: 10px; justify-content: flex-end; }
  .toolbar button { padding: 8px 22px; border: none; border-radius: 8px; font-size: 15px; cursor: pointer; }
  .btn-print { background: #0f766e; color: #fff; }
  .btn-close { background: #64748b; color: #fff; }
  @media print { body { background: #fff; padding: 0; } .toolbar { display: none; } .cert-doc { box-shadow: none; margin: 0; } }
`;
