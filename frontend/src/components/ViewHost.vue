<script setup>
/**
 * ViewHost — จุดที่ Vue ฝั่งเส้นทางเชื่อมกับหน้าแบบเดิม
 *
 * ระบบเดิมสร้างแต่ละหน้าด้วย UI.h() ลงใน #app โดยตรง (795 KB โค้ด 13 ไฟล์)
 * รุ่นนี้คงโค้ดหน้าไว้ทุกตัวอักษร แต่ให้ Vue ดูแลส่วนที่ต้อง reactive แทน คือ:
 *   - เส้นทาง (vue-router)
 *   - สิทธิ์การเข้าถึง (ตรวจก่อนเรียก view)
 *   - การโหลดโมดุลแบบ dynamic import
 *   - การเลื่อนขึ้นบนสุดทุกครั้งที่เปลี่ยนหน้า
 *
 * ข้อได้เปรียบคือได้ความเหมือนเดิม 100% โดยไม่ต้องเขียนหน้าใหม่ 8 ร้อยกิโลไบต์
 *
 * หมายเหตุสำคัญ: prop ชื่อนี้ต้องไม่ใช่ "key"
 *   เพราะ Vue ถือว่า key เป็นชื่อสงวนของ vnode — vue-router จะดึงค่าไปใช้เป็น
 *   vnode key แทนที่จะส่งมาเป็น prop ของ component ทำให้ค่าที่ได้เป็น undefined
 *   และ watcher ไม่ยิงเมื่อเปลี่ยนหน้า (พบและแก้แล้วระหว่างทดสอบ)
 */
import { ref, shallowRef, onMounted, watch, nextTick } from 'vue';
import { UI } from '../ui/ui.js';
import { loadView } from '../views/registry.js';
import { canAccess } from '../router/menus.js';
import AccessDenied from './AccessDenied.vue';

const props = defineProps({
  /** key ของเมนู เช่น office, travel-school, home */
  viewKey: { type: String, default: 'home' },
});

const host = ref(null);
/** ตัวนับ ใช้กันการแข่งขันเมื่อผู้ใช้คลิกเมนูรัว ๆ */
const epoch = ref(0);
/** แสดงหน้า "ไม่มีสิทธิ์" แทนการวาด view */
const denied = ref(false);
const deniedKey = ref('');
/** ถ้าหน้านี้เขียนเป็น Vue แล้ว ให้ Vue วาดแทน (component ที่ได้จาก registry) */
const vueComp = shallowRef(null);
/** scope ของหน้าปัจจุบัน (เช่น 'office'/'school' ของ TravelPage) — undefined = ไม่มี */
const vueScope = ref(undefined);

/** เปิดด้วย window.__P2_DEBUG__ = true เพื่อดูลำดับการวาดหน้าในคอนโซล */
function log(m) {
  if (!window.__P2_DEBUG__) return;
  (window.__P2_LOG__ = window.__P2_LOG__ || []).push(m);
  console.log('[ViewHost]', m);
}

/** วาดหน้าปัจจุบันลง container */
async function draw() {
  const el = host.value;
  if (!el) return;

  const key = props.viewKey || 'home';
  const startedAt = epoch.value;

  // โค้ดเดิมเขียนลงในกรอบนี้ — หน้าที่เขียนเป็น Vue แล้วจะไม่แตะกรอบนี้เลย
  el.innerHTML = '';
  if (!host.value) return;
  // สปินเนอร์กำลังโหลดใส่กรอบชั่วคราว (นอกจากกรอบของ Vue) แล้วลบทิ้งเมื่อโหลดเสร็จ
  // ต้องแยกไว้นอกกรอบ เพราะถ้าอยู่ในกรอบเดียวกับ view ที่เขียนเป็น Vue
  // สปินเนอร์จะค้างอยู่ตลอด เพราะ Vue ไม่รู้จักต้องลบ
  const spinner = UI.loading();
  spinner.style.cssText = 'position:absolute;top:0;left:0;right:0;z-index:1;pointer-events:none';
  const spinWrap = document.createElement('div');
  spinWrap.className = 'view-loading-host';
  spinWrap.append(spinner);
  el.parentElement.insertBefore(spinWrap, el);

  const loaded = await loadView(key);

  // ถ้าระหว่างรอโหลดผู้ใช้เปลี่ยนหน้าไปแล้ว — ยกเลิกการวาดครั้งนี้
  if (epoch.value !== startedAt || host.value !== el) {
    spinWrap.remove();
    return;
  }

  denied.value = false;
  deniedKey.value = '';
  vueComp.value = null;
  vueScope.value = undefined;
  await nextTick();

  // บอกไว้ก่อนว่าหน้านี้ "ยังไม่" วาดอะไร เผื่อโหลดไม่สำเร็จ เทสต์จะได้ไม่เข้าใจผิดว่าเป็น legacy
  el.dataset.viewKind = 'pending';
  delete el.dataset.viewKey;

  // เนื้อหาเริ่มมีแล้ว — เอาสปินเนอร์ออก
  spinWrap.remove();

  // หน้าแรกไม่ต้องตรวจสิทธิ์ — ระบบเดิมมี if (key === 'home') มาก่อน canAccess()
  // (home ไม่ได้อยู่ในรายการเมนู จึงไม่มีสิทธิ์กำกับ)
  const isHome = key === 'home';

  // ไม่รู้จักเมนูนี้ หรือผู้ใช้ไม่มีสิทธิ์เข้าถึง → ใช้ component แทนการต่อ DOM เอง
  if (loaded.kind === 'none' || (!isHome && !canAccess(key))) {
    log('denied key=' + key);
    denied.value = true;
    deniedKey.value = key;
    window.scrollTo(0, 0);
    return;
  }

  // --- หน้าที่เขียนเป็น Vue แล้ว: ให้ Vue วาดเอง ไม่ต้องล้างกรอบ ---
  if (loaded.kind === 'vue') {
    log('vue key=' + key + (loaded.scope ? ' scope=' + loaded.scope : ''));
    el.innerHTML = '';
    vueComp.value = loaded.component;
    vueScope.value = loaded.scope;
    window.scrollTo(0, 0);
    return;
  }

  // --- หน้าที่ยังเป็นโค้ดเดิม ---
  log('legacy key=' + key + (loaded.scope ? ' scope=' + loaded.scope : ''));
  const view = loaded.view;
  try {
    await view.render(el, loaded.scope);
    el.dataset.viewKind = 'legacy';
    el.dataset.viewKey = key;
    if (loaded.scope) el.dataset.viewScope = loaded.scope;
  } catch (e) {
    el.innerHTML = '';
    el.append(UI.empty(e && e.message ? e.message : 'เกิดข้อผิดพลาดในการแสดงผลหน้านี้', '⚠️'));
    el.dataset.viewKind = 'error';
    el.dataset.viewKey = key;
  }

  // ระบบเดิมเลื่อนขึ้นบนสุดทุกครั้งที่เปลี่ยนหน้า
  window.scrollTo(0, 0);
}

onMounted(async () => {
  // view ที่ port มาจากรุ่นเดิมเรียก render() เพื่อวาดหน้าใหม่
  // จึงต้องมีตัวแทนของฟังก์ชันนั้นไว้บน window
  window.__P2_RERENDER__ = () => {
    epoch.value++;
    draw();
  };
  await draw();
});

watch(
  () => props.viewKey,
  async (k) => {
    log('watch key=' + JSON.stringify(k));
    epoch.value++;
    // ล้างหน้า Vue ที่ค้างอยู่ก่อนวาดใหม่ ไม่งั้นจะเห็นสองหน้าซ้อนกัน
    vueComp.value = null;
    await nextTick();
    draw();
  },
);
</script>

<template>
  <!--
    สำคัญ: host ต้องเป็นกรอบของตัวเอง ไม่มี component ของ Vue อยู่ข้างใน
    เพราะโค้ดหน้าแบบเดิมสั่ง el.innerHTML = '' แล้ว append ลูกเอง
    ถ้า Vue มี child อยู่ในกรอบเดียวกัน Vue จะ reconcile กับ DOM ที่ถูกแทนที่
    → เกิด TypeError: Cannot read properties of null (reading 'insertBefore')
    (เจอจริงระหว่างทดสอบ — ต้องให้ AccessDenied เป็นพี่น้องคนละกรอบ)
  -->
  <div ref="host" class="view-host"></div>
  <AccessDenied v-if="denied" :view-key="deniedKey" />
  <!--
    ห่อไว้ด้วย data-view-kind เพื่อให้เทสต์ยืนยันได้ว่าหน้านี้วาดด้วย Vue จริง
    (เคยเจอกรณี registry ประกาศ key ซ้ำ → legacy ทับ Vue เงียบ ๆ
     เทสต์ที่ดูแค่ "หน้าโหลดได้" ผ่านหมด เพราะ legacy วาด DOM คล้ายกัน)
  -->
  <div
    v-if="vueComp"
    :key="props.viewKey"
    class="view-vue-host"
    :data-view-kind="'vue'"
    :data-view-key="props.viewKey"
    :data-view-scope="vueScope || ''"
  >
    <component :is="vueComp" :scope="vueScope" />
  </div>
</template>

<style scoped>
/* ไม่เพิ่มสไตล์ใด ๆ — หน้าแต่ละหน้าใช้ class จาก theme.css ของระบบเดิมทั้งหมด */
.view-host {
  display: block;
}
</style>
