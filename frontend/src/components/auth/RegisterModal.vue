<script setup>
/**
 * RegisterModal — ลงทะเบียนสมาชิกใหม่
 *
 * ย้ายจาก Auth.openRegister() + Auth.openRegisterForm() ใน auth-legacy.js
 * มี 2 ขั้นตอน: เลือกประเภท (สพป. / สถานศึกษา) → กรอกฟอร์ม
 *
 * ฟิลด์ทั้งหมด ลำดับการแสดงผล ข้อความ validate และเงื่อนไข (required / maxlength)
 * ตรงกับของเดิมทุกจุด — ต่างเพียงเปลี่ยนจากการอ่าน DOM เป็น v-model
 */
import { ref, reactive, computed, watch } from 'vue';
import AppModal from '../ui/AppModal.vue';
import ThaiBirthPicker from '../ui/ThaiBirthPicker.vue';
import FilePicker from '../ui/FilePicker.vue';
import { useAuthStore } from '../../stores/auth.js';
import { UI } from '../../ui/ui.js';
import { CONSTANTS } from '../../constants/index.js';

const LOGO = '/logo.png';
const MAX_SECONDARY = 5;

const store = useAuthStore();

const open = computed(() => store.registerOpen);
const step = computed(() => store.registerStep);
const isSchool = computed(() => step.value === 'school');

/** ทุกช่องของฟอร์ม */
const f = reactive({
  citizen_id: '',
  title: '',
  first_name: '',
  last_name: '',
  position: '',
  academic_rank: 'ไม่มี',
  workplace: '',
  nickname: '',
  blood_type: 'ไม่ทราบ',
  highest_education: '',
  birth_date: '',
  age: '',
  phone: '',
  email: '',
  telegram_token: '',
  telegram_chat_id: '',
  username: '',
  password: '',
  confirm_password: '',
  photo: null,
  signature: null,
});

/** สถานศึกษาเพิ่มเติม (เจ้าหน้าที่สถานศึกษาที่ปฏิบัติงานหลายแห่ง) */
const secondary = ref(['']);
const showSecondary = ref(false);

const busy = ref(false);

/* ---------------- ตัวเลือกใน dropdown ---------------- */
const titles = CONSTANTS.TITLES;
const positions = computed(() => (isSchool.value ? CONSTANTS.SCHOOL_POSITIONS : CONSTANTS.POSITIONS));
const ranks = computed(() => (isSchool.value ? CONSTANTS.SCHOOL_ACADEMIC_RANKS : CONSTANTS.ACADEMIC_RANKS));
const bloodTypes = CONSTANTS.BLOOD_TYPES;
const workplaces = computed(() => (isSchool.value ? store.schoolOptions : CONSTANTS.WORKPLACES));

/* ---------------- ตัวช่วย validate ---------------- */

/** เลขบัตรประชาชน 13 หลัก (ตรรกะเดียวกับ UI.citizenIdValid) */
function citizenIdValid(id) {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(id[i], 10) * (13 - i);
  return ((11 - (sum % 11)) % 10) === parseInt(id[12], 10);
}

/** อายุจากวันเกิด (ค.ศ. YYYY-MM-DD) — คืน '' ถ้าไม่มี/ไม่ถูกต้อง */
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

/** เก็บเฉพาะตัวเลขของเลขบัตรประชาชน (ของเดิมทำแบบ realtime ตอนพิมพ์) */
function onCitizenInput() {
  f.citizen_id = f.citizen_id.replace(/\D/g, '');
}
const cidHint = computed(() => {
  if (f.citizen_id.length === 13) {
    return citizenIdValid(f.citizen_id)
      ? { text: '✅ เลขบัตรประชาชนถูกต้อง', color: '#16a34a' }
      : { text: '❌ เลขบัตรประชาชนไม่ถูกต้อง', color: '#dc2626' };
  }
  return { text: 'ใช้เป็นรหัสอ้างอิงตัวตนในระบบ (13 หลัก)', color: '' };
});

/** เกณฑ์ความแข็งแรงรหัสผ่าน — ลำดับและข้อความตามของเดิม */
const PASS_RULES = [
  [/^.{8,}$/, 'อย่างน้อย 8 ตัวอักษร'],
  [/[A-Z]/, 'ตัวพิมพ์ใหญ่'],
  [/[a-z]/, 'ตัวพิมพ์เล็ก'],
  [/\d/, 'ตัวเลข'],
  [/[^A-Za-z0-9]/, 'อักขระพิเศษ'],
];
const passHint = computed(() => {
  const v = f.password;
  if (!v) return { text: 'ต้องมีตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก ตัวเลข และอักขระพิเศษ', color: '' };
  const missing = PASS_RULES.filter(([re]) => !re.test(v)).map(([, t]) => t);
  if (missing.length === 0) return { text: '✅ รหัสผ่านผ่านเกณฑ์แล้ว', color: '#16a34a' };
  return { text: 'ยังขาด: ' + missing.join(', '), color: '#d97706' };
});

/* ---------------- วงจรชีวิตของหน้าต่าง ---------------- */

watch(open, (v) => {
  if (v) reset();
});

watch(step, async (v) => {
  if (v === 'school') {
    await store.loadSchools();
    f.workplace = '';
  } else {
    f.workplace = '';
  }
});

/** เลือกวันเกิด → คำนวณอายุอัตโนมัติ (ของเดิมคำนวณตอน change ของแต่ละ select) */
watch(
  () => f.birth_date,
  (v) => {
    f.age = v ? ageFromBirth(v) : '';
  },
);

function reset() {
  Object.assign(f, {
    citizen_id: '',
    title: '',
    first_name: '',
    last_name: '',
    position: '',
    academic_rank: 'ไม่มี',
    workplace: '',
    nickname: '',
    blood_type: 'ไม่ทราบ',
    highest_education: '',
    birth_date: '',
    age: '',
    phone: '',
    email: '',
    telegram_token: '',
    telegram_chat_id: '',
    username: '',
    password: '',
    confirm_password: '',
    photo: null,
    signature: null,
  });
  secondary.value = [''];
  showSecondary.value = false;
  busy.value = false;
}

function close() {
  if (busy.value) return;
  store.closeRegister();
}

function pick(kind) {
  store.registerStep = kind;
}

/** เพิ่มช่องสถานศึกษาเพิ่มเติม (สูงสุด 5 แห่ง) */
function addSecondary() {
  if (secondary.value.length >= MAX_SECONDARY) return;
  showSecondary.value = true;
  secondary.value.push('');
}

function removeSecondary(i) {
  secondary.value.splice(i, 1);
  if (secondary.value.length === 0) secondary.value = [''];
}

/* ---------------- ส่งใบสมัคร ---------------- */

async function submit() {
  if (busy.value) return;

  // ตรวจข้อมูลจำเป็น (ข้อความและลำดับตามของเดิม)
  if (!f.citizen_id || !f.first_name || !f.last_name || !f.position || !f.workplace || !f.username || !f.password) {
    return UI.toast('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน (เลขบัตร ชื่อ นามสกุล ตำแหน่ง กลุ่มงาน ชื่อผู้ใช้ รหัสผ่าน)', 'error');
  }
  if (!citizenIdValid(f.citizen_id)) return UI.toast('เลขบัตรประชาชนไม่ถูกต้อง', 'error');
  if (f.password !== f.confirm_password) return UI.toast('ยืนยันรหัสผ่านไม่ตรงกัน', 'error');

  const form = new FormData();
  const group = isSchool.value ? 'school' : 'office';
  const put = (k, v) => form.append(k, v || '');

  put('citizen_id', f.citizen_id);
  put('title', f.title);
  put('first_name', f.first_name);
  put('last_name', f.last_name);
  put('position', f.position);
  put('academic_rank', f.academic_rank);
  put('workplace', f.workplace);
  put('nickname', f.nickname);
  put('blood_type', f.blood_type);
  put('highest_education', f.highest_education);
  put('birth_date', f.birth_date);
  put('age', f.age);
  put('phone', f.phone);
  put('email', f.email);
  put('telegram_token', f.telegram_token);
  put('telegram_chat_id', f.telegram_chat_id);
  put('username', f.username);
  put('password', f.password);
  put('user_group', group);

  if (group === 'school') {
    put('workplace_secondary', JSON.stringify(secondary.value.filter((s) => s)));
  }
  if (f.photo) form.append('photo', f.photo);
  if (f.signature) form.append('signature', f.signature);

  busy.value = true;
  try {
    const res = await store.register(form);
    UI.toast(res.message);
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppModal
    v-if="open && step === 'select'"
    title="📝 ลงทะเบียนสมาชิกใหม่"
    @close="close"
  >
    <div style="text-align: center; padding: 20px 0">
      <div style="text-align: center; margin-bottom: 16px">
        <img class="modal-logo" :src="LOGO" alt="สพป.แพร่ เขต 2" />
      </div>
      <div style="font-size: 18px; font-weight: bold; margin-bottom: 24px">เลือกประเภทการลงทะเบียน</div>
      <div style="display: flex; flex-direction: column; gap: 12px; align-items: center">
        <button
          class="btn btn-primary"
          style="width: 320px; padding: 14px 20px; font-size: 16px"
          @click="pick('office')"
        >
          ⬡ ลงทะเบียนเจ้าหน้าที่ สพป.แพร่ เขต 2
        </button>
        <button
          class="btn btn-accent"
          style="width: 320px; padding: 14px 20px; font-size: 16px"
          @click="pick('school')"
        >
          ⊕ ลงทะเบียนเจ้าหน้าที่สถานศึกษา
        </button>
      </div>
    </div>
  </AppModal>

  <AppModal
    v-else-if="open"
    :title="isSchool ? '📝 ลงทะเบียนสมาชิกใหม่ (เจ้าหน้าที่สถานศึกษา)' : '📝 ลงทะเบียนสมาชิกใหม่'"
    size="lg"
    footer
    @close="close"
  >
    <div style="text-align: center; margin-bottom: 10px">
      <img class="modal-logo" :src="LOGO" alt="สพป.แพร่ เขต 2" />
    </div>
    <div style="text-align: center; margin-bottom: 16px; font-size: 15px; color: var(--primary)">
      {{ isSchool ? '⊕ ลงทะเบียนเจ้าหน้าที่สถานศึกษา' : '⬡ ลงทะเบียนเจ้าหน้าที่ สพป.แพร่ เขต 2' }}
    </div>

    <form @submit.prevent="submit">
      <!-- ---------- ข้อมูลส่วนตัว ---------- -->
      <div class="card-title">📇 ข้อมูลส่วนตัว</div>
      <div class="form-grid">
        <div class="form-group full">
          <label>เลขบัตรประชาชน 13 หลัก <span class="req"> *</span></label>
          <input
            id="reg-cid"
            name="citizen_id"
            v-model="f.citizen_id"
            type="text"
            inputmode="numeric"
            maxlength="13"
            placeholder="เช่น 1579900123456"
            @input="onCitizenInput"
          />
          <div id="reg-cid-hint" class="hint" :style="{ color: cidHint.color }">{{ cidHint.text }}</div>
        </div>

        <div class="form-group">
          <label>คำนำหน้า <span class="req"> *</span></label>
          <select name="title" v-model="f.title">
            <option v-for="t in titles" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>

        <div class="form-group">
          <label>ชื่อ <span class="req"> *</span></label>
          <input name="first_name" v-model="f.first_name" type="text" placeholder="เช่น สมชาย" />
        </div>

        <div class="form-group">
          <label>นามสกุล <span class="req"> *</span></label>
          <input name="last_name" v-model="f.last_name" type="text" placeholder="เช่น ใจดี" />
        </div>

        <div class="form-group full">
          <label>ตำแหน่ง <span class="req"> *</span></label>
          <select id="reg-position" name="position" v-model="f.position">
            <option value="">-- เลือกตำแหน่ง --</option>
            <option v-for="p in positions" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>

        <div class="form-group">
          <label>วิทยฐานะ / ระดับ</label>
          <select id="reg-rank" name="academic_rank" v-model="f.academic_rank">
            <option v-for="r in ranks" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>

        <div class="form-group">
          <label>{{ isSchool ? 'สถานศึกษา' : 'สังกัด / กลุ่มงาน' }} <span class="req"> *</span></label>
          <select id="reg-workplace" name="workplace" v-model="f.workplace">
            <option value="">{{ isSchool ? '-- เลือกสถานศึกษา --' : '-- เลือกกลุ่มงาน --' }}</option>
            <option v-for="w in workplaces" :key="w" :value="w">{{ w }}</option>
          </select>
        </div>

        <!-- ปฏิบัติงานหลายแห่ง (เฉพาะเจ้าหน้าที่สถานศึกษา) -->
        <div v-if="isSchool" id="reg-multi-school-wrap" class="form-group full">
          <button
            type="button"
            class="btn btn-sm btn-outline"
            style="font-size: 13px"
            @click="addSecondary"
          >
            📍 ปฏิบัติงานหลายแห่ง
          </button>
          <div id="reg-multi-schools" v-if="showSecondary" style="margin-top: 8px">
            <div
              v-for="(s, i) in secondary"
              :key="i"
              class="form-group"
              style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px"
            >
              <span style="font-size: 14px; min-width: 20px">{{ i + 1 }}.</span>
              <select :id="'reg-workplace-' + i" v-model="secondary[i]" style="flex: 1">
                <option value="">-- เลือกสถานศึกษาเพิ่มเติม --</option>
                <option v-for="w in workplaces" :key="w" :value="w">{{ w }}</option>
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
          <input name="nickname" v-model="f.nickname" type="text" placeholder="เช่น บอล" />
        </div>

        <div class="form-group">
          <label>กรุ๊ปเลือด</label>
          <select name="blood_type" v-model="f.blood_type">
            <option v-for="b in bloodTypes" :key="b" :value="b">{{ b }}</option>
          </select>
        </div>

        <div class="form-group">
          <label>วุฒิการศึกษาสูงสุด</label>
          <input name="highest_education" v-model="f.highest_education" type="text" placeholder="เช่น ปริญญาโท ครุศาสตรมหาบัณฑิต" />
        </div>

        <div class="form-group full">
          <label>วัน/เดือน/ปี เกิด (พ.ศ.)</label>
          <ThaiBirthPicker prefix="reg-birth" v-model="f.birth_date" />
          <div class="hint">เลือกวัน เดือน และปี พ.ศ. เกิด</div>
        </div>

        <div class="form-group">
          <label>อายุ (ปี)</label>
          <input id="reg-age" name="age" v-model="f.age" type="text" readonly placeholder="คำนวณจากวันเกิด" />
        </div>

        <div class="form-group">
          <label>เบอร์โทรศัพท์</label>
          <input name="phone" v-model="f.phone" type="tel" placeholder="เช่น 081-2345678" />
        </div>

        <div class="form-group">
          <label>อีเมล</label>
          <input name="email" v-model="f.email" type="email" placeholder="เช่น name@example.com" />
        </div>
      </div>

      <!-- ---------- Telegram ---------- -->
      <div class="card-title" style="margin-top: 18px">🤖 การแจ้งเตือนผ่าน Telegram Bot</div>
      <div class="form-grid">
        <div class="form-group">
          <label>Token Key</label>
          <input name="telegram_token" v-model="f.telegram_token" type="text" placeholder="เช่น 123456789:ABCdef..." />
          <div class="hint">ได้รับจาก @BotFather บน Telegram</div>
        </div>
        <div class="form-group">
          <label>Chat ID</label>
          <input name="telegram_chat_id" v-model="f.telegram_chat_id" type="text" placeholder="เช่น 123456789" />
          <div class="hint">สำหรับรับการแจ้งเตือนสถานะคำขอของคุณ</div>
        </div>
      </div>

      <!-- ---------- บัญชีผู้ใช้ ---------- -->
      <div class="card-title" style="margin-top: 18px">🔐 บัญชีผู้ใช้</div>
      <div class="form-grid">
        <div class="form-group">
          <label>ชื่อผู้ใช้ (Username) <span class="req"> *</span></label>
          <input name="username" v-model="f.username" type="text" placeholder="ตัวอักษร/ตัวเลข 3-30 ตัว" />
        </div>
        <div class="form-group">
          <label>รหัสผ่าน <span class="req"> *</span></label>
          <input id="reg-pass" name="password" v-model="f.password" type="password" placeholder="อย่างน้อย 8 ตัวอักษร" />
          <div id="reg-pass-hint" class="hint" :style="{ color: passHint.color }">{{ passHint.text }}</div>
        </div>
        <div class="form-group">
          <label>ยืนยันรหัสผ่าน <span class="req"> *</span></label>
          <input id="reg-pass2" name="confirm_password" v-model="f.confirm_password" type="password" />
        </div>
      </div>

      <!-- ---------- รูปถ่าย / ลายเซ็น ---------- -->
      <div class="card-title" style="margin-top: 18px">🖼️ รูปถ่ายและลายเซ็น</div>
      <div class="form-grid">
        <FilePicker id="reg-photo" name="photo" v-model="f.photo" accept="image/*" label="รูปถ่าย (ไฟล์ภาพ)" required />
        <FilePicker id="reg-sig-file" name="signature" v-model="f.signature" accept="image/*" label="ลายเซ็น (อัปโหลดภาพ)" required />
      </div>

      <div class="hint" style="margin-top: 14px; text-align: center">
        รูปถ่ายและลายเซ็นจะถูกเก็บอ้างอิงตามเลขบัตรประชาชน 13 หลัก — หลังส่งใบสมัครแล้ว
        กรุณารอผู้ดูแลระบบอนุมัติ ถึงจะสามารถเข้าสู่ระบบได้
      </div>
    </form>

    <template #footer>
      <button class="btn btn-outline" :disabled="busy" @click="close">ยกเลิก</button>
      <button id="reg-submit" class="btn btn-accent" :disabled="busy" @click="submit">
        {{ busy ? 'กำลังส่งใบสมัคร...' : 'ส่งใบสมัคร' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
