<script setup>
/**
 * StaffRoleModal — กำหนดสิทธิ์การใช้งาน 5 ระดับ
 *
 * ย้ายจาก StaffView.setRole()
 *
 * แสดงคำอธิบายสิทธิ์ของระดับที่เลือกอยู่เสมอ ด้านล่าง dropdown
 */
import { ref, computed } from 'vue';
import api from '../../api/client.js';
import { UI } from '../../ui/ui.js';
import { CONSTANTS } from '../../constants/index.js';
import AppModal from './AppModal.vue';

const props = defineProps({
  staff: { type: Object, required: true },
});

const emit = defineEmits(['close', 'saved']);

const busy = ref(false);

/**
 * บทบาทปัจจุบัน
 *
 * คงบทบาทเดิมไว้เสมอ (ไม่ว่าจะอยู่ในรายการของฝั่งหรือไม่)
 * เพราะรายการจะแสดงบทบาทเดิมต่อท้ายให้เห็น — ผู้ใช้จะได้เห็นว่าตอนนี้เป็นอะไร
 * และเลือกแก้ได้ถ้าผิดฝั่ง
 *
 * ถ้าไม่มีบทบาทเดิมเลย (เช่น ค่าว่าง) → ใช้รายการแรกของฝั่ง
 * ไม่ใช้ 'member' เพราะเป็นค่าของระบบเก่าที่ไม่อยู่ในรายการแล้ว
 * การใช้เป็นค่าเริ่มต้น → dropdown ไม่มีอะไรถูกเลือก ดูเหมือนกล่องว่าง
 */
const role = ref(
  (() => {
    if (props.staff.role) return props.staff.role;
    const list = CONSTANTS.rolesForGroup(props.staff.user_group);
    return (list[0] && list[0].value) || 'staff';
  })(),
);

/** ฝั่งของเจ้าหน้าที่คนนี้ — ฝั่งสถานศึกษาได้บทบาทของสถานศึกษา ฝั่ง สพป. ได้บทบาทของ สพป. */
const isSchool = computed(() => props.staff.user_group === 'school');

/** รายการบทบาทที่ให้เลือก */
const roleList = computed(() => CONSTANTS.rolesForGroup(props.staff.user_group));

/**
 * ถ้าผู้ใช้มีบทบาทที่ไม่อยู่ในรายการของฝั่งตัวเอง ให้แสดงบทบาทเดิมไว้ด้วย
 *
 * ⚠️ ต้องเทียบกับ props.staff.role (ค่าเดิมจากฐานข้อมูล) ไม่ใช่ role.value
 *    เพราะ role ถูกตั้งค่าเริ่มต้นเป็นรายการแรกของฝั่งไปแล้ว
 *    ถ้าเทียบกับ role.value → เทียบตัวเองกับตัวเองเสมอ → บทบาทเดิมไม่โผล่
 *    (เคยเจอจริง: เจ้าหน้าที่สถานศึกษาที่มี role='staff' ซึ่งเป็นบทบาทฝั่ง สพป.)
 *
 * ไม่งั้น dropdown จะไม่มีอะไรถูกเลือก และถ้ากดบันทึกทันที
 * บทบาทเดิมจะถูกเขียนทับโดยไม่ได้เตือน
 */
const roleOptions = computed(() => {
  const list = roleList.value.slice();
  const current = props.staff.role;
  if (current && !list.some((r) => r.value === current)) {
    const known = CONSTANTS.ROLES.find((r) => r.value === current);
    if (known) list.push({ ...known, legacy: true });
  }
  return list;
});

/** คำอธิบายของสิทธิ์ที่เลือก */
const desc = computed(() => {
  const r = roleOptions.value.find((x) => x.value === role.value);
  if (!r) return '';
  return `${r.icon} ${r.label} — ${r.desc}${r.legacy ? ' (บทบาทเดิม — กรุณาเลือกใหม่)' : ''}`;
});

async function save() {
  busy.value = true;
  try {
    const res = await api.put(`/staff/${props.staff.id}/role`, { role: role.value });
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
  <AppModal title="⊛ กำหนดสิทธิ์การใช้งาน" footer @close="emit('close')">
    <p style="margin-bottom: 4px; font-weight: 600">กำหนดสิทธิ์การใช้งานให้ "{{ UI.personName(staff) }}"</p>
    <p class="hint" style="margin-bottom: 12px">
      {{ isSchool ? 'เจ้าหน้าที่สถานศึกษา — เลือกบทบาทฝั่งสถานศึกษา' : 'เจ้าหน้าที่ สพป.แพร่ เขต 2 — เลือกบทบาทฝั่งสำนักงาน' }}
    </p>

    <select id="role-select" v-model="role" style="width: 100%; margin-bottom: 12px">
      <option v-for="r in roleOptions" :key="r.value" :value="r.value">
        {{ r.icon }} {{ r.label }}{{ r.legacy ? ' (บทบาทเดิม)' : '' }}
      </option>
    </select>

    <div class="hint" style="min-height: 40px">{{ desc }}</div>

    <template #footer>
      <button class="btn btn-outline" :disabled="busy" @click="emit('close')">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="busy" @click="save">
        {{ busy ? 'กำลังบันทึก…' : '▽ บันทึกสิทธิ์' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
