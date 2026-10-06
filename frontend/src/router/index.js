/**
 * Router ของระบบ — vue-router แบบ hash history
 *
 * คง URL ให้เหมือนระบบเดิมทุกรูปแบบ:  #/  #/office  #/travel-school
 * ทั้งนี้เพราะต้องให้ลิงก์ที่เคยแจกไปยังใช้ได้ และไม่ต้องตั้งค่า rewrite บน server
 */
import { createRouter, createWebHashHistory } from 'vue-router';
import ViewHost from '../components/ViewHost.vue';

/** ป้ายกำกับสำหรับ route ที่ไม่รู้จัก */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    // หน้าแรก
    {
      path: '/',
      name: 'home',
      component: ViewHost,
      props: () => ({ viewKey: 'home' }),
    },
    // ทุกเมนูเข้าผ่าน ViewHost ตัวเดียวกัน — การตรวจสิทธิ์ทำใน ViewHost
    // (ตรงกับระบบเดิมที่ตรวจใน render() ก่อนเรียก view)
    //
    // หมายเหตุ: ส่งเป็น viewKey ไม่ใช่ key
    //   เพราะ key เป็นชื่อ prop สงวนของ Vue — vue-router จะดึงไปใช้เป็น vnode key
    //   ทำให้ component ไม่ได้รับค่าและไม่วาดหน้าใหม่เมื่อเปลี่ยนเมนู
    {
      path: '/:viewKey',
      name: 'menu',
      component: ViewHost,
      props: (route) => ({ viewKey: route.params.viewKey }),
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

/**
 * ฟังก์ชันที่โค้ดรุ่นเดิมเรียกใช้ — ลงทะเบียนไว้บน window เพื่อให้ view ที่ port มาเรียกได้
 * ตอนนี้ vue-router ทำหน้าที่แทน hash แบบเดิมแล้ว
 */
export function installLegacyRouterHooks(navigate) {
  window.__P2_NAV_HOME__ = () => navigate('/');
  window.__P2_GO__ = (key) => navigate('/' + key);
}

export default router;
