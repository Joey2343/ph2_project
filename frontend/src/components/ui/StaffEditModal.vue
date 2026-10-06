<script setup>
/**
 * StaffEditModal — แก้ไขข้อมูลเจ้าหน้าที่ (admin)
 *
 * ย้ายจาก StaffView.editStaff() (195 บรรทัด)
 *
 * ต่างจากฝั่ง สพป.:
 *   รายการตำแหน่ง/วิทยฐานะมาจาก SCHOOL_POSITIONS / SCHOOL_ACADEMIC_RANKS
 *   ช่อง "กลุ่มงาน" เป็นรายชื่อโรงเรียนจาก /schools
 *   มีปุ่ม "ปฏิบัติงานหลายแห่ง" เพิ่มสถานศึกษาได้อีก 4 แห่ง (เก็บเป็น workplace_secondary)
 *   ตัวเลือกสิทธิ์จำกัดไว้ที่ admin / school_staff
 */
import { ref, computed, watch, onMounted } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import { CONSTANTS } from '../../constants/index.js';
import AppModal from './AppModal.vue';
import ThaiBirthPicker from './ThaiBirthPicker.vue';

const props = defineProps({
  staff: { type: Object, required: true },
});

const emit = defineEmits(['close', 'saved']);

const u = computed(() => props.staff);
const isSchool = computed(() => u.value.user_group === 'school');
const busy = ref(false);

/* ---------- ค่าเริ่มต้น ---------- */
const f = ref(blank());

function blank() {
  const x = u.value;
  return {
    citizen_id: x.citizen_id || '',
    staff_no: x.staff_no || '',
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
    age: UI.ageFromBirth(x.birth_date) || '',
    phone: x.phone || '',
    email: x.email || '',
    telegram_token: x.telegram_token || '',
    telegram_chat_id: x.telegram_chat_id || '',
    role: x.role || 'member',
    can_approve: x.can_approve ? '1' : '0',
    workplace_secondary: parseSecondary(x.workplace_secondary),
  };
}

function parseSecondary(json) {
  try {
    const d = JSON.parse(json || '[]');
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

const posList = computed(() => (isSchool.value ? CONSTANTS.SCHOOL_POSITIONS : CONSTANTS.POSITIONS));
const rankList = computed(() => (isSchool.value ? CONSTANTS.SCHOOL_ACADEMIC_RANKS : CONSTANTS.ACADEMIC_RANKS));
const workLabel = computed(() => (isSchool.value ? 'สถานศึกษา' : 'สังกัด/กลุ่มงาน'));
const roleOptions = computed(() =>
  (isSchool.value
    ? CONSTANTS.ROLES.filter((r) => ['admin', 'school_staff'].includes(r.value))
    : CONSTANTS.ROLES.filter((r) => r.value !== 'school_staff')),
);

/* ---------- รายชื่อโรงเรียน (ฝั่งสถานศึกษา) ---------- */
const schools = ref([]);

onMounted(async () => {
  if (!isSchool.value) return;
  try {
    const d = await api.get('/schools');
    schools.value = (d.schools || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } catch {
    schools.value = [];
  }
});

/** ป้ายสถานศึกษา = "รหัส ชื่อ" (ถ้ามีรหัส) */
const schoolLabels = computed(() =>
  schools.value.map((s) => (s.code ? s.code + ' ' + s.name : s.name)).filter(Boolean),
);

/** ตรวจว่าค่าในช่องตรงกับสถานศึกษาตัวไหน (รองรับทั้ง "รหัส ชื่อ" และ "ชื่อ") */
function matchesSchool(val, s) {
  if (!val) return false;
  const label = s.code ? s.code + ' ' + s.name : s.name;
  return val === label || val === s.name || label.endsWith(val);
}

/* ---------- ปฏิบัติงานหลายแห่ง (สูงสุด 5) ---------- */
const MAX_SECONDARY = 5;

function addSchool() {
  if (f.value.workplace_secondary.length >= MAX_SECONDARY) return;
  f.value.workplace_secondary.push('');
}

function removeSchool(i) {
  f.value.workplace_secondary.splice(i, 1);
}

/* ---------- รูปและลายเซ็น ---------- */
const photoFile = ref(null);
const photoPreview = ref(u.value.photo ? '/uploads/' + UI.encodePath(u.value.photo) : '');
const sigFile = ref(null);
const sigPreview = ref(u.value.signature ? '/uploads/' + UI.encodePath(u.value.signature) : '');

function onPickPhoto(e) {
  const file = e.target.files && e.target.files[0];
  photoFile.value = file || null;
  photoPreview.value = file
    ? URL.createObjectURL(file)
    : u.value.photo
      ? '/uploads/' + UI.encodePath(u.value.photo)
      : '';
}

function onPickSig(e) {
  const file = e.target.files && e.target.files[0];
  sigFile.value = file || null;
  sigPreview.value = file
    ? URL.createObjectURL(file)
    : u.value.signature
      ? '/uploads/' + UI.encodePath(u.value.signature)
      : '';
}

/** อายุคำนวณจากวันเกิดแบบ realtime */
function calcAge() {
  f.value.age = f.value.birth_date ? UI.ageFromBirth(f.value.birth_date) || '' : '';
}
watch(() => f.value.birth_date, calcAge);

/* ---------- บันทึก ---------- */
async function save() {
  const v = f.value;
  if (!v.citizen_id.trim() || !v.first_name.trim() || !v.last_name.trim()) {
    return UI.toast('กรุณากรอกเลขบัตร ชื่อ และนามสกุลให้ครบถ้วน', 'error');
  }
  if (v.citizen_id.trim().length !== 13) {
    return UI.toast('เลขบัตรประชาชนต้องเป็น 13 หลัก', 'error');
  }

  const fd = new FormData();
  const fields = {
    citizen_id: v.citizen_id.trim(),
    staff_no: v.staff_no.trim(),
    title: v.title,
    first_name: v.first_name.trim(),
    last_name: v.last_name.trim(),
    position: v.position,
    academic_rank: v.academic_rank,
    workplace: v.workplace,
    nickname: v.nickname.trim(),
    blood_type: v.blood_type,
    highest_education: v.highest_education.trim(),
    birth_date: v.birth_date || '',
    phone: v.phone.trim(),
    email: v.email.trim(),
    telegram_token: v.telegram_token.trim(),
    telegram_chat_id: v.telegram_chat_id.trim(),
    role: v.role,
    can_approve: v.can_approve === '1' ? '1' : '0',
  };
  if (isSchool.value) {
    fields.workplace_secondary = JSON.stringify(v.workplace_secondary.filter(Boolean));
  }
  for (const [k, val] of Object.entries(fields)) fd.append(k, val);
  if (photoFile.value) fd.append('photo', photoFile.value);
  if (sigFile.value) fd.append('signature', sigFile.value);

  busy.value = true;
  try {
    const res = await api.putForm(`/staff/${u.value.id}`, fd);
    UI.toast(res.message);
    emit('saved');
    emit('close');
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppModal title="✎ แก้ไขข้อมูลเจ้าหน้าที่" size="lg" footer @close="emit('close')">
    <div class="form-grid">
      <div class="form-group full">
        <label>เลขบัตรประชาชน 13 หลัก<span class="req"> *</span></label>
        <input v-model="f.citizen_id" type="text" inputmode="numeric" maxlength="13" />
      </div>

      <div class="form-group">
        <label>ลำดับเจ้าหน้าที่</label>
        <input v-model="f.staff_no" type="text" placeholder="เช่น 001, 002 ... (ไม่บังคับ)" />
        <div class="hint">ใช้สำหรับจัดเรียงในบางเมนู — ใส่หรือไม่ใส่ก็ได้</div>
      </div>

      <div class="form-group">
        <label>คำนำหน้า</label>
        <select v-model="f.title">
          <option v-for="t in CONSTANTS.TITLES" :key="t" :value="t">{{ t }}</option>
        </select>
      </div>

      <div class="form-group">
        <label>ชื่อ<span class="req"> *</span></label>
        <input v-model="f.first_name" />
      </div>

      <div class="form-group">
        <label>นามสกุล<span class="req"> *</span></label>
        <input v-model="f.last_name" />
      </div>

      <div class="form-group full">
        <label>ตำแหน่ง</label>
        <select v-model="f.position">
          <option value="">-- เลือกตำแหน่ง --</option>
          <option v-for="p in posList" :key="p" :value="p">{{ p }}</option>
        </select>
      </div>

      <div class="form-group">
        <label>วิทยฐานะ/ระดับ</label>
        <select v-model="f.academic_rank">
          <option v-for="r in rankList" :key="r" :value="r">{{ r }}</option>
        </select>
      </div>

      <div class="form-group">
        <label>{{ workLabel }}</label>
        <!-- ฝั่งสถานศึกษา: รายชื่อโรงเรียนจาก /schools -->
        <select v-if="isSchool" v-model="f.workplace">
          <option value="">-- เลือกสถานศึกษา --</option>
          <option
            v-for="(s, i) in schools"
            :key="i"
            :value="s.code ? s.code + ' ' + s.name : s.name"
          >
            {{ s.code ? s.code + ' ' + s.name : s.name }}
          </option>
        </select>
        <!-- ฝั่ง สพป.: กลุ่มงานจากค่าคงที่ -->
        <select v-else v-model="f.workplace">
          <option v-for="w in CONSTANTS.WORKPLACES" :key="w" :value="w">{{ w }}</option>
        </select>
      </div>

      <!-- ---------- ปฏิบัติงานหลายแห่ง (เฉพาะสถานศึกษา) ---------- -->
      <template v-if="isSchool">
        <div class="form-group full">
          <button type="button" class="btn btn-sm btn-outline" style="font-size: 13px" @click="addSchool">
            📍 ปฏิบัติงานหลายแห่ง
          </button>
          <div style="margin-top: 8px">
            <div
              v-for="(val, i) in f.workplace_secondary"
              :key="i"
              class="form-group"
              style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px"
            >
              <span style="font-size: 14px; min-width: 20px">{{ i + 1 }}.</span>
              <select v-model="f.workplace_secondary[i]" style="flex: 1">
                <option value="">-- เลือกสถานศึกษาเพิ่มเติม --</option>
                <option v-for="label in schoolLabels" :key="label" :value="label">{{ label }}</option>
              </select>
              <button
                type="button"
                class="btn btn-sm"
                style="color: #e53e3e; background: none; border: none; cursor: pointer; font-size: 16px"
                @click="removeSchool(i)"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      </template>

      <div class="form-group">
        <label>ชื่อเล่น</label>
        <input v-model="f.nickname" />
      </div>

      <div class="form-group">
        <label>กรุ๊ปเลือด</label>
        <select v-model="f.blood_type">
          <option v-for="b in CONSTANTS.BLOOD_TYPES" :key="b" :value="b">{{ b }}</option>
        </select>
      </div>

      <div class="form-group">
        <label>วุฒิการศึกษาสูงสุด</label>
        <input v-model="f.highest_education" />
      </div>

      <div class="form-group">
        <label>วัน/เดือน/ปี เกิด (พ.ศ.)</label>
        <ThaiBirthPicker id="ed-birth" v-model="f.birth_date" />
      </div>

      <div class="form-group">
        <label>อายุ (ปี)</label>
        <input v-model="f.age" type="text" readonly />
      </div>

      <div class="form-group">
        <label>เบอร์โทรศัพท์</label>
        <input v-model="f.phone" />
      </div>

      <div class="form-group">
        <label>อีเมล</label>
        <input v-model="f.email" />
      </div>

      <div class="form-group">
        <label>Telegram Token Key</label>
        <input v-model="f.telegram_token" />
      </div>

      <div class="form-group">
        <label>Telegram Chat ID</label>
        <input v-model="f.telegram_chat_id" />
      </div>

      <div class="form-group">
        <label>สิทธิ์การใช้งาน</label>
        <select v-model="f.role">
          <option v-for="r in roleOptions" :key="r.value" :value="r.value">{{ r.icon }} {{ r.label }}</option>
        </select>
      </div>

      <div class="form-group">
        <label>สิทธิ์อนุมัติคำขอ</label>
        <select v-model="f.can_approve">
          <option value="0">ไม่มีสิทธิ์อนุมัติ</option>
          <option value="1">● อนุมัติได้ตามบทบาท</option>
        </select>
      </div>

      <!-- ---------- รูปถ่าย ---------- -->
      <div class="form-group">
        <label>รูปถ่าย (เปลี่ยนใหม่)<span v-if="!u.photo" class="req"> *</span></label>
        <div class="file-preview">
          <img v-if="photoPreview" class="preview-thumb" :src="photoPreview" alt="รูปปัจจุบัน" />
        </div>
        <input type="file" accept="image/*" @change="onPickPhoto" />
        <div class="hint">
          {{ u.photo ? 'รูปปัจจุบันแสดงด้านบน — เลือกไฟล์เพื่อแทนที่' : 'ไฟล์ภาพ (jpg, png)' }}
        </div>
      </div>

      <!-- ---------- ลายเซ็น ---------- -->
      <div class="form-group">
        <label>ลายเซ็น (เปลี่ยนใหม่)<span v-if="!u.signature" class="req"> *</span></label>
        <div class="file-preview">
          <img v-if="sigPreview" class="preview-thumb" :src="sigPreview" alt="ลายเซ็นปัจจุบัน" />
        </div>
        <input type="file" accept="image/*" @change="onPickSig" />
        <div class="hint">
          {{ u.signature ? 'ลายเซ็นปัจจุบันแสดงด้านบน — เลือกไฟล์เพื่อแทนที่' : 'ไฟล์ภาพ (jpg, png)' }}
        </div>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="busy" @click="emit('close')">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="busy" @click="save">
        {{ busy ? 'กำลังบันทึก…' : '▽ บันทึกข้อมูล' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
