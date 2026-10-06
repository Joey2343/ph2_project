/**
 * เมนูหลัก + สิทธิ์การเข้าถึงแต่ละเมนู
 *
 * port จาก public/js/app.js ของระบบเดิม (ส่วน MENUS / canAccess) — คงข้อมูลและตรรกะเดิมทุกจุด
 * ย้ายออกมาเป็นโมดูลเพื่อให้ทั้ง router และหน้าแรก (HomeView) ใช้ร่วมกันได้
 */
import { session, isLoggedIn, isAdmin } from '../stores/session.js';

export const MENUS = [
  { key: 'office', icon: '⊞', title: 'ข้อมูลพื้นฐาน สพป.แพร่ เขต 2', desc: 'ประวัติ วิสัยทัศน์ โครงสร้าง และการติดต่อ', grad: 'linear-gradient(135deg,#0f766e,#14b8a6)', pub: true },
  { key: 'schools', icon: '⊙', title: 'พิกัดโรงเรียนในสังกัด', desc: 'แผนที่และข้อมูลโรงเรียนในสังกัด', grad: 'linear-gradient(135deg,#1d4ed8,#3b82f6)', pub: true },
  { key: 'documents', icon: '✉', title: 'หนังสือราชการ', desc: 'ทะเบียนหนังสือราชการรับ-ส่ง', grad: 'linear-gradient(135deg,#92400e,#d97706)', member: true },
  { key: 'clock', icon: '◷', title: 'ลงเวลาทำงาน', desc: 'ลงเวลาเข้างาน-ออกงานประจำวัน', grad: 'linear-gradient(135deg,#b45309,#f59e0b)', member: true, hideFromGrid: true },
  { key: 'vehicles', icon: '🚐', title: 'จองยานพาหนะ', desc: 'ขอใช้ยานพาหนะของทางราชการ', grad: 'linear-gradient(135deg,#15803d,#22c55e)', member: true },
  { key: 'rooms', icon: '⌂', title: 'จองห้องประชุม', desc: 'จองห้องประชุมสำหรับการประชุมและอบรม', grad: 'linear-gradient(135deg,#7c3aed,#a78bfa)', member: true },
  { key: 'memos', icon: '✎', title: 'บันทึกข้อความ', desc: 'จัดทำและส่งบันทึกข้อความภายในหน่วยงาน', grad: 'linear-gradient(135deg,#475569,#94a3b8)', member: true },
  { key: 'travel', icon: '✈', title: 'ขออนุญาตไปราชการ', desc: 'ยื่นคำขอเดินทางไปราชการ (เจ้าหน้าที่ สพป.แพร่ เขต 2)', grad: 'linear-gradient(135deg,#be123c,#f43f5e)', member: true },
  { key: 'travel-school', icon: '✈', title: 'ขออนุญาตไปราชการ (สถานศึกษา)', desc: 'ยื่นคำขอเดินทางไปราชการ (เจ้าหน้าที่สถานศึกษา)', grad: 'linear-gradient(135deg,#9f1239,#fb7185)', member: true },
  { key: 'leave', icon: '☀', title: 'ขออนุญาตลา', desc: 'ยื่นคำขอลาประเภทต่าง ๆ', grad: 'linear-gradient(135deg,#ea580c,#fb923c)', member: true },
  { key: 'budgets', icon: '฿', title: 'บริหารงบประมาณ', desc: 'แผนงบประมาณและการใช้จ่าย', grad: 'linear-gradient(135deg,#047857,#10b981)', member: true },
  { key: 'academic', icon: '📖', title: 'บริหารงานวิชาการ', desc: 'โครงการและกิจกรรมทางวิชาการ', grad: 'linear-gradient(135deg,#4338ca,#6366f1)', member: true },
  { key: 'staff', icon: '☺', title: 'เจ้าหน้าที่ในสำนักงาน', desc: 'จัดการสมาชิกและอนุมัติการสมัคร', grad: 'linear-gradient(135deg,#0891b2,#06b6d4)', member: true, adminOnly: true },
];

export function getMenu(key) {
  return MENUS.find((m) => m.key === key);
}

/* เมนูที่เจ้าหน้าที่สถานศึกษาเข้าถึงได้ (นอกเหนือจาก pub) */
const SCHOOL_ALLOWED = ['documents'];
const SCHOOL_DIRECTOR_ALLOWED = ['travel', 'travel-school', 'leave'];

export function canAccess(key) {
  const menu = getMenu(key);
  if (!menu) return false;
  if (menu.pub) return true;
  if (!isLoggedIn()) return false;
  if (menu.adminOnly && !isAdmin()) return false;
  // เจ้าหน้าที่สถานศึกษา: เข้าได้เฉพาะ pub + SCHOOL_ALLOWED
  // ผู้อำนวยการสถานศึกษา: เข้าได้เพิ่ม travel, leave
  if (session.user && session.user.user_group === 'school') {
    if (menu.pub) return true;
    // หน้าของ สพป. — เจ้าหน้าที่สถานศึกษาใช้หน้า travel-school แทน
    if (key === 'travel') return false;
    if (SCHOOL_ALLOWED.includes(key)) return true;
    // ผู้อำนวยการสถานศึกษา: เข้า travel-school, leave ได้
    var pos = session.user.position || '';
    if (SCHOOL_DIRECTOR_ALLOWED.includes(key) && pos.indexOf('ผู้อำนวยการสถานศึกษา') !== -1) return true;
    return false;
  }
  // หน้าของสถานศึกษา (travel-school) — เจ้าหน้าที่สถานศึกษา, admin และผู้ตรวจสอบ (ขั้นที่ 1)
  // สายสถานศึกษาเท่านั้น (เจ้าหน้าที่ สพป. ทั่วไปเข้าไม่ได้)
  if (key === 'travel-school' && session.user.role !== 'admin' && !session.user.is_school_travel_approver) return false;
  return true;
}
