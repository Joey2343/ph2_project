<script setup>
/**
 * ProfileModal — โปรไฟล์ของฉัน (แก้ข้อมูล + เปลี่ยนรหัสผ่าน + ทดสอบ Telegram)
 *
 * ย้ายจาก Auth.openProfile() ใน auth-legacy.js
 * ฟิลด์ / ลำดับ / ป้าย / ค่าเริ่มต้น ตรงกับของเดิมทุกจุด
 */
import { ref, reactive, computed, watch } from 'vue';
import AppModal from '../ui/AppModal.vue';
import ThaiBirthPicker from '../ui/ThaiBirthPicker.vue';
import { useAuthStore } from '../../stores/auth.js';
import { UI } from '../../ui/ui.js';
import { CONSTANTS } from '../../constants/index.js';

const MAX_SECONDARY = 5;

const store = useAuthStore();
const open = computed(() => store.profileOpen);
const u = computed(() => store.user || {});

const isSchool = computed(() => u.value.user_group === 'school');

const positions = computed(() => (isSchool.value ? CONSTANTS.SCHOOL_POSITIONS : CONSTANTS.POSITIONS));
const ranks = computed(() => (isSchool.value ? CONSTANTS.SCHOOL_ACADEMIC_RANKS : CONSTANTS.ACADEMIC_RANKS));
const workLabel = computed(() => (isSchool.value ? 'สถานศึกษา' : 'สังกัด/กลุ่มงาน'));

/** ค่าในฟอร์ม — แยกจาก store เพื่อไม่ให้แก้ข้อมูลจริงก่อนกดบันทึก */
const f = reactive({
  title: '',
  first_name: '',
  last_name: '',
  position: '',
  academic_rank: '',
  workplace: '',
  nickname: '',
  blood_type: '',
  highest_education: '',
  birth_date: '',
  phone: '',
  email: '',
  telegram_token: '',
  telegram_chat_id: '',
});

const secondary = ref([]);
const showSecondary = ref(false);

const photo = ref(null);
const signature = ref(null);

const oldPassword = ref('');
const newPassword = ref('');

const saving = ref(false);
const testing = ref(false);

const birthAge = computed(() => (f.birth_date ? ageFromBirth(f.birth_date) : ''));

/** รายชื่อสถานศึกษาที่ผู้ใช้ปฏิบัติงาน (ใช้ทั้งช่องหลักและช่องรอง) */
const schoolOptions = computed(() => store.schoolOptions);

/* ---------------- วงจรชีวิต ---------------- */

watch(open, (v) => {
  if (v) load();
});

/** เติมค่าเริ่มต้นจากข้อมูลผู้ใช้ และโหลดรายชื่อสถานศึกษา */
async function load() {
  const x = store.user || {};
  Object.assign(f, {
    title: x.title || 'นาย',
    first_name: x.first_name || '',
    last_name: x.last_name || '',
    position: x.position || '',
    academic_rank: x.academic_rank || 'ไม่มี',
    workplace: x.workplace || '',
    nickname: x.nickname || '',
    blood_type: x.blood_type || 'ไม่ทราบ',
    highest_education: x.highest_education || '',
    birth_date: x.birth_date || '',
    phone: x.phone || '',
    email: x.email || '',
    telegram_token: x.telegram_token || '',
    telegram_chat_id: x.telegram_chat_id || '',
  });
  photo.value = null;
  signature.value = null;
  oldPassword.value = '';
  newPassword.value = '';

  let extra = [];
  try {
    extra = JSON.parse(x.workplace_secondary || '[]');
  } catch (e) {
    extra = [];
  }
  secondary.value = extra.length ? extra.slice(0, MAX_SECONDARY) : [];
  showSecondary.value = secondary.value.length > 0;

  if (isSchool.value) await store.loadSchools();
}

function close() {
  if (saving.value) return;
  store.closeProfile();
}

function addSecondary() {
  if (secondary.value.length >= MAX_SECONDARY) return;
  showSecondary.value = true;
  secondary.value.push('');
}

function removeSecondary(i) {
  secondary.value.splice(i, 1);
}

/* ---------------- อายุ ---------------- */
function ageFromBirth(birth) {
  if (!birth) return '';
  const m = String(birth).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const bd = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  if (isNaN(bd) || bd > now) return '';
  let age = now.getFullYear() - bd.getFullYear();
  const dm = now.getMonth() - bd.getMonth();
  if (dm < 0 || (dm === 0 && now.getDate() < bd.getDate())) age--;
  return age >= 0 ? String(age) : '';
}

/* ---------------- Telegram ---------------- */
async function testTelegram() {
  const token = f.telegram_token.trim();
  const chatId = f.telegram_chat_id.trim();
  if (!token || !chatId) {
    return UI.toast('กรุณากรอก Telegram Token Key และ Telegram Chat ID ก่อนทดสอบ', 'error');
  }
  testing.value = true;
  try {
    const res = await store.testTelegram(token, chatId);
    UI.toast(res.message || 'ส่งข้อความทดสอบสำเร็จ');
  } catch (e) {
    UI.toast(e.message || 'ส่งข้อความไม่สำเร็จ', 'error');
  } finally {
    testing.value = false;
  }
}

/* ---------------- บันทึก / เปลี่ยนรหัสผ่าน ---------------- */
async function saveProfile() {
  const fd = new FormData();
  const put = (k, v) => fd.append(k, v == null ? '' : v);
  put('title', f.title);
  put('first_name', f.first_name);
  put('last_name', f.last_name);
  put('position', f.position);
  put('academic_rank', f.academic_rank);
  put('workplace', f.workplace);
  put('nickname', f.nickname);
  put('blood_type', f.blood_type);
  put('highest_education', f.highest_education);
  put('phone', f.phone);
  put('email', f.email);
  put('telegram_token', f.telegram_token);
  put('telegram_chat_id', f.telegram_chat_id);
  if (f.birth_date) fd.append('birth_date', f.birth_date);
  if (isSchool.value) fd.append('workplace_secondary', JSON.stringify(secondary.value.filter((s) => s)));
  if (photo.value) fd.append('photo', photo.value);
  if (signature.value) fd.append('signature', signature.value);

  saving.value = true;
  try {
    const res = await store.saveProfile(fd);
    UI.toast(res.message);
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    saving.value = false;
  }
}

async function changePass() {
  try {
    const res = await store.changePassword(oldPassword.value, newPassword.value);
    UI.toast(res.message);
    oldPassword.value = '';
    newPassword.value = '';
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}
</script>

<template>
  <AppModal v-if="open" title="👤 โปรไฟล์ของฉัน" size="lg" @close="close">
    <!-- ---------- หัวโปรไฟล์ ---------- -->
    <div style="display: flex; align-items: center; gap: 18px; flex-wrap: wrap; margin-bottom: 16px">
      <img
        v-if="u.photo"
        class="profile-photo"
        :src="'/uploads/' + UI.encodePath(u.photo)"
      />
      <div
        v-else
        class="profile-photo"
        style="display: grid; place-items: center; font-size: 32px; background: var(--primary-light); color: var(--primary-deep)"
      >
        {{ (u.full_name || '?').charAt(0) }}
      </div>
      <div>
        <div style="font-size: 19px; font-weight: 800">{{ u.full_name }}</div>
        <div style="color: var(--muted); font-size: 14px">{{ u.position || '-' }}</div>
        <div style="margin-top: 6px">
          <span v-if="u.role === 'admin'" class="badge badge-admin">ผู้ดูแลระบบ</span>
          <span v-else-if="isSchool" class="badge badge-member">⊕ เจ้าหน้าที่สถานศึกษา</span>
          <span v-else class="badge badge-member">⬡ เจ้าหน้าที่ สพป.</span>
        </div>
      </div>
    </div>

    <!-- ---------- ข้อมูลส่วนตัว ---------- -->
    <div class="form-grid" style="margin-bottom: 14px">
      <div class="form-group">
        <label>คำนำหน้า</label>
        <select id="pf-title" v-model="f.title">
          <option v-for="t in CONSTANTS.TITLES" :key="t" :value="t">{{ t }}</option>
        </select>
      </div>

      <div class="form-group">
        <label>ชื่อ</label>
        <input id="pf-fname" v-model="f.first_name" />
      </div>

      <div class="form-group">
        <label>นามสกุล</label>
        <input id="pf-lname" v-model="f.last_name" />
      </div>

      <div class="form-group">
        <label>เลขบัตรประชาชน</label>
        <input :value="u.citizen_id || '-'" disabled />
      </div>

      <div class="form-group">
        <label>ตำแหน่ง</label>
        <select id="pf-pos" v-model="f.position">
          <option v-for="p in positions" :key="p" :value="p">{{ p }}</option>
        </select>
      </div>

      <div class="form-group">
        <label>วิทยฐานะ / ระดับ</label>
        <select id="pf-rank" v-model="f.academic_rank">
          <option v-for="r in ranks" :key="r" :value="r">{{ r }}</option>
        </select>
      </div>

      <div class="form-group">
        <label>{{ workLabel }}</label>
        <select v-if="isSchool" id="pf-work" v-model="f.workplace">
          <option value="">-- เลือกสถานศึกษา --</option>
          <option v-for="w in schoolOptions" :key="w" :value="w">{{ w }}</option>
        </select>
        <select v-else id="pf-work" v-model="f.workplace">
          <option v-for="w in CONSTANTS.WORKPLACES" :key="w" :value="w">{{ w }}</option>
        </select>
      </div>

      <!-- ปฏิบัติงานหลายแห่ง -->
      <div v-if="isSchool" id="pf-multi-school-wrap" class="form-group full">
        <button type="button" class="btn btn-sm btn-outline" style="font-size: 13px" @click="addSecondary">
          📍 ปฏิบัติงานหลายแห่ง
        </button>
        <div id="pf-multi-schools" v-if="showSecondary" style="margin-top: 8px">
          <div
            v-for="(s, i) in secondary"
            :key="i"
            class="form-group"
            style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px"
          >
            <span style="font-size: 14px; min-width: 20px">{{ i + 1 }}.</span>
            <select :id="'pf-work-' + i" v-model="secondary[i]" style="flex: 1">
              <option value="">-- เลือกสถานศึกษาเพิ่มเติม --</option>
              <option v-for="w in schoolOptions" :key="w" :value="w">{{ w }}</option>
            </select>
            <button
              type="button"
              class="btn btn-sm"
              style="color: #e53e3e; background: none; border: none; cursor: pointer; font-size: 16px"
              @click="removeSecondary(i)"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      <div class="form-group">
        <label>ชื่อเล่น</label>
        <input id="pf-nick" v-model="f.nickname" />
      </div>

      <div class="form-group">
        <label>กรุ๊ปเลือด</label>
        <select id="pf-blood" v-model="f.blood_type">
          <option v-for="b in CONSTANTS.BLOOD_TYPES" :key="b" :value="b">{{ b }}</option>
        </select>
      </div>

      <div class="form-group">
        <label>วุฒิการศึกษาสูงสุด</label>
        <input id="pf-edu" v-model="f.highest_education" />
      </div>

      <div class="form-group">
        <label>วัน/เดือน/ปี เกิด (พ.ศ.)</label>
        <ThaiBirthPicker prefix="pf-birth" v-model="f.birth_date" />
      </div>

      <div class="form-group">
        <label>อายุ (ปี)</label>
        <input id="pf-age" :value="birthAge" type="text" readonly />
      </div>

      <div class="form-group">
        <label>เบอร์โทรศัพท์</label>
        <input id="pf-phone" v-model="f.phone" />
      </div>

      <div class="form-group">
        <label>อีเมล</label>
        <input id="pf-email" v-model="f.email" />
      </div>

      <div class="form-group">
        <label>Telegram Token Key</label>
        <input id="pf-tgtok" v-model="f.telegram_token" placeholder="Token จาก @BotFather" />
      </div>

      <div class="form-group">
        <label>Telegram Chat ID</label>
        <input id="pf-tgcid" v-model="f.telegram_chat_id" placeholder="Chat ID สำหรับรับการแจ้งเตือน" />
      </div>

      <div class="form-group" style="display: flex; align-items: flex-end; gap: 8px">
        <button
          type="button"
          class="btn"
          style="background: #bae6fd; color: #0369a1; border: 1px solid #7dd3fc; margin-top: 26px; align-self: flex-start"
          :disabled="testing"
          @click="testTelegram"
        >
          {{ testing ? '⏳ กำลังส่ง...' : '📣 ทดสอบส่งข้อความ' }}
        </button>
      </div>

      <div class="form-group">
        <label>รูปถ่าย (ใหม่)</label>
        <input id="pf-photo" type="file" accept="image/*" @change="photo = $event.target.files[0] || null" />
      </div>

      <div class="form-group">
        <label>ลายเซ็น (ใหม่)</label>
        <input id="pf-sig" type="file" accept="image/*" @change="signature = $event.target.files[0] || null" />
      </div>
    </div>

    <div class="form-actions" style="margin-top: 4px">
      <button class="btn btn-primary" :disabled="saving" @click="saveProfile">
        {{ saving ? 'กำลังบันทึก...' : '💾 บันทึกข้อมูล' }}
      </button>
    </div>

    <!-- ---------- เปลี่ยนรหัสผ่าน ---------- -->
    <div class="card-title" style="margin-top: 20px">🔐 เปลี่ยนรหัสผ่าน</div>
    <div class="form-grid">
      <div class="form-group">
        <label>รหัสผ่านเดิม</label>
        <input id="cp-old" v-model="oldPassword" type="password" />
      </div>
      <div class="form-group">
        <label>รหัสผ่านใหม่</label>
        <input id="cp-new" v-model="newPassword" type="password" placeholder="อย่างน้อย 8 ตัวอักษร" />
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-outline" @click="changePass">เปลี่ยนรหัสผ่าน</button>
    </div>

    <!-- ---------- ลายเซ็น ---------- -->
    <div v-if="u.signature" style="margin-top: 18px">
      <div class="card-title">✍️ ลายเซ็นของฉัน</div>
      <img class="signature-img" :src="'/uploads/' + UI.encodePath(u.signature)" />
    </div>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
