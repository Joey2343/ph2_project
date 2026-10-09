<script setup>
/**
 * LoginModal — หน้าต่างเข้าสู่ระบบ
 *
 * ย้ายจาก Auth.openLogin() ใน auth-legacy.js มาเป็น Vue component
 * ข้อความ / class / ลำดับช่องกรอก / ข้อความ error ตรงกับของเดิมทุกจุด
 */
import { ref, computed, nextTick, watch } from 'vue';
import AppModal from '../ui/AppModal.vue';
import { useAuthStore, Auth } from '../../stores/auth.js';
import { UI } from '../../ui/ui.js';

/** โลโก้ผูกแบบ dynamic เพื่อไม่ให้ Vite พยายาม bundle (เสิร์ฟโดย backend) */
const LOGO = '/logo.png';

const store = useAuthStore();

const username = ref('');
const password = ref('');
const busy = ref(false);
const userInput = ref(null);

const open = computed(() => store.loginOpen);

// โฟกัสช่องชื่อผู้ใช้ทันทีที่เปิด (ของเดิมใช้ setTimeout 50ms)
watch(open, async (v) => {
  if (!v) return;
  username.value = '';
  password.value = '';
  busy.value = false;
  await nextTick();
  if (userInput.value) userInput.value.focus();
});

function close() {
  if (busy.value) return;
  store.closeLogin();
}

async function submit() {
  if (busy.value) return;
  busy.value = true;
  try {
    const r = await store.login(username.value, password.value);
    if (r === 'fail') return;
    if (r === 'need-school') {
      // ต้องเลือกสถานศึกษาก่อน — ปิดหน้าต่างนี้ แล้ว SchoolSelectModal จะเปิดแทน
      store.closeLogin();
      return;
    }
    store.closeLogin();
    password.value = '';
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}

function goRegister() {
  store.closeLogin();
  Auth.openRegister();
}
</script>

<template>
  <AppModal v-if="open" title="🔑 เข้าสู่ระบบ" footer @close="close">
    <div style="text-align: center; margin-bottom: 14px">
      <img class="modal-logo" :src="LOGO" alt="สพป.แพร่ เขต 2" />
    </div>

    <!-- ปุ่ม "เข้าสู่ระบบ" อยู่ใน #footer ซึ่งอยู่นอก <form> นี้
         ถ้าไม่ผูก id + form="..." browser จะไม่มีปุ่ม submit ให้กด
         → กด Enter ในช่องกรอกแล้วไม่เกิดอะไร ต้องใช้เมาส์คลิกปุ่มเท่านั้น -->
    <form id="login-form" class="form-grid" @submit.prevent="submit">
      <div class="form-group full">
        <label>ชื่อผู้ใช้ (Username)</label>
        <input
          id="login-user"
          ref="userInput"
          v-model="username"
          type="text"
          placeholder="กรอกชื่อผู้ใช้"
          autocomplete="username"
        />
      </div>
      <div class="form-group full">
        <label>รหัสผ่าน</label>
        <input
          id="login-pass"
          v-model="password"
          type="password"
          placeholder="กรอกรหัสผ่าน"
          autocomplete="current-password"
        />
      </div>
      <div class="hint full" style="grid-column: 1 / -1; text-align: center">
        ยังไม่มีบัญชี?
        <a href="#" @click.prevent="goRegister">ลงทะเบียนสมาชิก</a>
      </div>
    </form>

    <template #footer>
      <button class="btn btn-outline" :disabled="busy" @click="close">ยกเลิก</button>
      <!-- type="submit" + form="login-form" = ผูกปุ่มนี้เข้ากับฟอร์มข้างบน
           ทำให้กด Enter ในช่องชื่อผู้ใช้/รหัสผ่านแล้วยืนยันอัตโนมัติ
           (ไม่ต้องย้ายปุ่มเข้าไปในฟอร์ม ซึ่งจะทำให้ layout ของเดิมเสีย) -->
      <button id="login-submit" type="submit" form="login-form" class="btn btn-primary" :disabled="busy">
        {{ busy ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
