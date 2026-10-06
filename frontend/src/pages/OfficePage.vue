<script setup>
/**
 * OfficePage — เมนู 1: ข้อมูลพื้นฐาน สพป.แพร่ เขต 2
 *
 * Phase 3: เขียนใหม่เป็น Vue component (เดิมเป็น src/views/OfficeView.js แบบ UI.h())
 *
 * ฟีเจอร์เท่าเดิมทุกอย่าง:
 *   - แสดงหัวข้อ + เนื้อหาแต่ละหัวข้อที่ admin แก้ไว้
 *   - admin กด "แก้ไขข้อมูล" ได้: เพิ่ม/ลบ/แก้หัวข้อ แล้วบันทึกทั้งชุด
 *
 * ต่างจากของเดิม: state เป็น ref/reactive ของ Vue แทนการอ่านค่าจาก DOM
 */
import { ref, onMounted } from 'vue';
import api from '../api/client.js';
import { UI } from '../ui/ui.js';
import { Auth } from '../stores/auth.js';

const loading = ref(true);
const error = ref('');
const sections = ref([]);

/** ตัวเลือกหัวข้อที่กำลังแก้ไข (แยกจากของจริง จนกว่าจะกดบันทึก) */
const editing = ref(false);
const draft = ref([]);
const saving = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api.get('/office');
    sections.value = data.sections || [];
  } catch (e) {
    error.value = e.message;
    sections.value = [];
  } finally {
    loading.value = false;
  }
}

function openEdit() {
  draft.value = sections.value.map((s) => ({ title: s.title || '', content: s.content || '' }));
  editing.value = true;
}

function closeEdit() {
  editing.value = false;
  draft.value = [];
}

function addSection() {
  draft.value.push({ title: 'หัวข้อใหม่', content: '' });
}

function removeSection(i) {
  draft.value.splice(i, 1);
}

async function save() {
  // กรองหัวข้อที่ไม่มีชื่อออก (เหมือนของเดิม)
  const valid = draft.value.filter((s) => s.title && String(s.title).trim());
  if (valid.length === 0) {
    return UI.toast('กรุณาใส่หัวข้ออย่างน้อย 1 หัวข้อ', 'error');
  }
  saving.value = true;
  try {
    const res = await api.put('/office', { sections: valid });
    UI.toast(res.message);
    editing.value = false;
    draft.value = [];
    await load();
    window.__P2_RERENDER__ && window.__P2_RERENDER__();
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page-head">
    <div>
      <div class="page-title"><span class="pi">🏛️</span>ข้อมูลพื้นฐาน สพป.แพร่ เขต 2</div>
      <div class="page-desc">ประวัติ วิสัยทัศน์ โครงสร้างหน่วยงาน และข้อมูลการติดต่อ</div>
    </div>
    <button v-if="Auth.isAdmin() && !editing" class="btn btn-primary" @click="openEdit">
      ✏️ แก้ไขข้อมูล
    </button>
  </div>

  <div class="card">
    <div v-if="loading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>

    <div v-else-if="error" class="empty-state"><span class="em">⚠️</span>{{ error }}</div>

    <div v-else-if="!editing && sections.length === 0" class="empty-state">
      <span class="em">📭</span>ยังไม่มีข้อมูล
    </div>

    <!-- ---------- โหมดดู ---------- -->
    <template v-else-if="!editing">
      <div v-for="(s, i) in sections" :key="i" class="content-block">
        <h3>{{ s.title }}</h3>
        <div class="content-text">{{ s.content || '-' }}</div>
      </div>
    </template>

    <!-- ---------- โหมดแก้ไข ---------- -->
    <template v-else>
      <p class="hint" style="margin-bottom: 12px">
        แก้ไขเนื้อหาข้อมูลพื้นฐานของหน่วยงาน (สมาชิกทั่วไปสามารถดูได้)
      </p>

      <div v-for="(s, i) in draft" :key="i" class="card" style="padding: 14px; margin-bottom: 12px">
        <div class="form-grid">
          <div class="form-group full">
            <label>หัวข้อที่ {{ i + 1 }}</label>
            <input v-model="s.title" placeholder="ชื่อหัวข้อ เช่น ประวัติความเป็นมา" />
          </div>
          <div class="form-group full">
            <label>เนื้อหา</label>
            <textarea v-model="s.content" rows="5" placeholder="รายละเอียดเนื้อหา"></textarea>
          </div>
          <div class="form-actions" style="margin-top: 0; grid-column: 1 / -1; justify-content: space-between">
            <span></span>
            <button class="btn btn-danger btn-sm" @click="removeSection(i)">🗑️ ลบหัวข้อนี้</button>
          </div>
        </div>
      </div>

      <button class="btn btn-outline btn-sm" @click="addSection">➕ เพิ่มหัวข้อ</button>

      <div class="form-actions" style="margin-top: 14px">
        <button class="btn btn-outline" :disabled="saving" @click="closeEdit">ยกเลิก</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">
          {{ saving ? 'กำลังบันทึก...' : '💾 บันทึกข้อมูล' }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของระบบเดิมทั้งหมด */
</style>
