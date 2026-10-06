<script setup>
/**
 * TravelDoc — แบบฟอร์ม A4 "ขออนุมัติ/อนุญาตเดินทางไปราชการ" (ฉบับสำเร็จ)
 *
 * ย้ายจาก TravelView.openView() ที่ประกอบ DOM เอง
 * เป็น Vue component ที่อ่านข้อมูลจาก record โดยตรง
 *
 * ข้อควรระวัง: เอกสารนี้ถูกส่งออกเป็นหนังสือราชการ
 *   - ข้อความและลำดับบรรทัดต้องตรงกับของเดิมทุกตัวอักษร
 *   - ห้ามเปลี่ยนขนาด/สี/ระยะห่างที่ทำให้กระดาษไม่ลง A4
 */
import { computed } from 'vue';
import { UI } from '../../ui/ui.js';
import AppModal from './AppModal.vue';
import StatusBadge from './StatusBadge.vue';
import ApprovalSteps from './ApprovalSteps.vue';

const props = defineProps({
  record: { type: Object, required: true },
});

const emit = defineEmits(['close']);

/* ---------- ข้อมูลจาก form_data ---------- */
const fd = computed(() => {
  const out = {};
  try {
    const raw = props.record.form_data;
    Object.assign(out, typeof raw === 'string' ? JSON.parse(raw) : raw || {});
  } catch {
    /* form_data เสียรูปแบบ → ใช้ค่าว่างแทน */
  }
  return out;
});

const fullName = computed(() => {
  const r = props.record;
  const first = [(r.user_title || '') + (r.first_name || ''), r.last_name || '']
    .filter(Boolean)
    .join(' ');
  return first || r.full_name || '-';
});

const posText = computed(() => props.record.position || '-');
const deptText = computed(
  () => props.record.workplace || props.record.department || props.record.group || '-',
);

/** วันที่แบบไทยแบบเต็ม ใช้ในส่วนหัวเอกสาร */
function thaiFull(d) {
  if (!d) return '-';
  const p = String(d).slice(0, 10).split('-');
  if (p.length !== 3) return String(d);
  const months = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
  ];
  return `วันที่ ${parseInt(p[2], 10)} ${months[parseInt(p[1], 10) - 1]} พ.ศ.${parseInt(p[0], 10) + 543}`;
}

/* ---------- ค่าใช้จ่ายที่ขอเบิก ---------- */
const expenseLines = computed(() => {
  const ei = fd.value.expense_items || {};
  const map = [
    ['baht', 'ค่าเบี้ยเลี้ยง'],
    ['hotel', 'ค่าเช่าที่พัก'],
    ['transport', 'ค่าพาหนะ'],
    ['other', 'ค่าใช้จ่ายอื่น'],
  ];
  return map.filter(([k]) => Number(ei[k]) > 0).map(([k, label]) => `${label} ${ei[k]} บาท`);
});

const expenseTypeLine = computed(() => {
  const v = fd.value;
  if (v.expense_type === 'budget') {
    return (
      '☑ ขอเบิกค่าใช้จ่ายตามสิทธิจากเงินงบประมาณ ค่าใช้จ่ายบริหารจัดการเขตพื้นที่การศึกษา ของ สพป.แพร่ เขต 2 ' +
      'ตามระเบียบกระทรวงการคลังว่าด้วยค่าใช้จ่ายในการเดินทางไปราชการ จำนวน ' +
      (v.expense_budget_amount || 0) +
      ' บาท'
    );
  }
  if (v.expense_type === 'project') {
    return (
      '☑ ขอเบิกค่าใช้จ่ายตามสิทธิจากเงินที่ได้รับจัดสรรจาก ' +
      (v.expense_fund_source || '-') +
      ' โครงการ ' +
      (v.expense_project || '-') +
      ' ตามระเบียบกระทรวงการคลังว่าด้วยค่าใช้จ่ายในการเดินทางไปราชการ จำนวน ' +
      (v.expense_project_amount || 0) +
      ' บาท'
    );
  }
  return '☑ ไม่ขอเบิกค่าใช้จ่าย';
});

const vehicleLine = computed(() => {
  const v = fd.value;
  if (v.vehicle_type === 'personal') return '☑ รถยนต์ส่วนตัว หมายเลขทะเบียน ' + (v.plate_number || '-');
  if (v.vehicle_type === 'other') return '☑ อื่นๆ ระบุ ' + (v.other_vehicle || '-');
  return '☑ รถยนต์ราชการ';
});

/* ---------- คอลัมน์ความเห็นผู้อนุมัติ ----------
 * สาย สพป. แสดง ขั้น1 = ผู้บังคับบัญชาขั้นต้น, ขั้น2 = ผู้อนุมัติ
 * สายสถานศึกษา แสดง ขั้น2 = ผู้บังคับบัญชาขั้นต้น, ขั้น3 = ผู้อนุมัติ
 * (ไม่แสดงความเห็นของผู้ตรวจสอบ เพราะเป็นแค่การเสนอเรื่อง)
 */
const reqIsSchool = computed(
  () =>
    (props.record.user_group ||
      (String(props.record.school_code || '') === '54020000' ? 'office' : 'school')) === 'school',
);

function approvalAt(level) {
  return (props.record.approvals || []).find((a) => a.level === level) || null;
}

const col1 = computed(() => approvalAt(reqIsSchool.value ? 2 : 1));
const col2 = computed(() => approvalAt(reqIsSchool.value ? 3 : 2));

/** ตัวเลือกของแต่ละคอลัมน์ — ข้อความต่างกันตามสาย */
const col1Options = computed(() =>
  reqIsSchool.value
    ? ['อนุมัติ', 'ไม่อนุมัติ', 'อนุญาต', 'ไม่อนุญาต']
    : ['ควรอนุมัติ', 'ไม่ควรอนุมัติ', 'ควรอนุญาต', 'ไม่ควรอนุญาต'],
);
const col2Options = computed(() => ['อนุมัติ', 'ไม่อนุมัติ', 'อนุญาต', 'ไม่อนุญาต']);

/** ตัวเลือกที่ต้องใส่เหตุผล (ขึ้นต้นด้วย "ไม่") */
function isReasonKey(key) {
  return key.startsWith('ไม่');
}

/** แปลง note ที่บันทึกไว้ (JSON) มาเป็นรายการที่ติ๊ก */
function parseNote(a) {
  if (!a) return { choices: [], reasonMap: {} };
  try {
    const o = JSON.parse(a.note);
    return {
      choices: o.choices || [],
      reasonMap: o.reasonMap || (o.reasons ? { 'ไม่อนุมัติ': o.reasons } : {}),
    };
  } catch {
    return { choices: [], reasonMap: {}, legacy: !!a.note };
  }
}

/**
 * แยกตำแหน่งเป็น 2 บรรทัดเมื่อมีคำว่า "รักษาราชการแทน" หรือ "ปฏิบัติหน้าที่/ปฏิบัติราชการแทน"
 * แยกจากตำแหน่งจริง ไม่ใส่ตำแหน่งอื่นแทน
 */
function splitPosition(pos) {
  if (!pos) return ['-'];
  const i = pos.search(/รักษาราชการแทน|ปฏิบัติหน้าที่|ปฏิบัติราชการแทน/);
  if (i > 0) return [pos.slice(0, i).trim(), pos.slice(i).trim()];
  return [pos];
}

/* ---------- พิมพ์ ---------- */
function printDoc() {
  const el = document.getElementById('travel-doc-print');
  if (!el) return;
  const css = document.querySelector('link[href*="theme"], link[href*="index-"]');
  const styleTag = css ? `<link rel="stylesheet" href="${css.href}">` : '';
  const w = window.open('', '_blank', 'width=900,height=1200');
  if (!w) return UI.toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต pop-up', 'error');
  w.document.write(
    `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">` +
      `<title>ใบขออนุมัติ/อนุญาตเดินทางไปราชการ ${props.record.travel_no || ''}</title>${styleTag}` +
      `<style>@page{size:A4;margin:1.5cm}body{background:#f0f2f5;padding:24px;margin:0}` +
      `@media print{body{background:#fff;padding:0}}</style>` +
      `</head><body>${el.outerHTML}</body></html>`,
  );
  w.document.close();
  setTimeout(() => {
    w.focus();
    w.print();
  }, 400);
}

const PARAGRAPH = { textIndent: '80px', margin: '0 0 5px 0', fontSize: '20px' };
</script>

<template>
  <AppModal
    :title="'👁️ รายละเอียดคำขอไปราชการ ' + (record.travel_no || '')"
    size="lg"
    footer
    @close="emit('close')"
  >
    <div
      id="travel-doc-print"
      style="max-width: 900px; margin: 0 auto; padding: 21px 5px 0 35px; font-family: 'THSarabunIT๙', 'TH Sarabun', 'THSarabun', sans-serif; font-size: 20px; line-height: 1.55; color: #1f2937; background: #fff; position: relative"
    >
      <!-- ---------- ส่วนหัว ---------- -->
      <div style="text-align: center; margin-bottom: 15px">
        <div style="font-size: 26px; font-weight: bold; text-decoration: underline; margin-bottom: 15px">
          แบบขออนุมัติ/อนุญาตเดินทางไปราชการ
        </div>
      </div>

      <div style="text-align: right; margin-bottom: 10px; font-size: 20px">
        <div>เขียนที่ {{ fd.writing_at || '-' }}</div>
      </div>

      <div style="text-indent: 50%; margin-bottom: 10px; font-size: 20px">
        {{ fd.form_date ? thaiFull(fd.form_date) : '-' }}
      </div>

      <div style="margin-bottom: 8px; font-size: 20px">
        <span style="font-weight: bold">เรื่อง&nbsp;&nbsp;</span>ขออนุมัติ/อนุญาตเดินทางไปราชการ
      </div>

      <div style="margin-bottom: 15px; font-size: 20px">
        <span style="font-weight: bold">เรียน&nbsp;&nbsp;</span>ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2
      </div>

      <!-- ---------- เนื้อหา ---------- -->
      <div style="font-size: 20px; line-height: 1.5; text-align: justify; margin-top: 10px">
        <p :style="{ ...PARAGRAPH, margin: '0 0 2px 0' }">
          <span style="margin-right: 40px">ข้าพเจ้า</span>{{ fullName }}
          <span style="margin-right: 40px; margin-left: 40px">ตำแหน่ง</span>{{ posText }}
        </p>

        <p style="margin: 0 0 2px 0">
          <span style="margin-right: 20px">กลุ่ม/หน่วย</span>{{ deptText }}
          <span style="margin-left: 10px">สังกัดสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2</span>
        </p>

        <p style="margin: 0 0 2px 0">
          พร้อมด้วยคณะ จำนวน {{ fd.companions || 0 }} คน
          <span style="margin-left: 10px">ตามรายชื่อแนบท้ายเอกสารนี้ (โปรดระบุด้านหลัง)</span>
        </p>

        <p :style="PARAGRAPH">
          มีความประสงค์ขออนุมัติ/อนุญาตเดินทางไปราชการ เรื่อง
          {{ fd.travel_subject || record.destination || '-' }}
          <br />
          สถานที่ {{ record.destination || '-' }} ตามหนังสือ/คำสั่งที่ {{ fd.order_doc || '-' }} ลงวันที่
          {{ fd.order_date ? thaiFull(fd.order_date) : '-' }}
          <br />
          ตั้งแต่วันที่ {{ UI.thaiDate(record.date_from) }} ถึงวันที่ {{ UI.thaiDate(record.date_to) }}
          รวมไปราชการครั้งนี้ {{ record.days }} วัน
        </p>

        <p :style="{ ...PARAGRAPH, margin: 0 }">โดยข้าพเจ้า</p>
        <p :style="PARAGRAPH">{{ expenseTypeLine }}</p>

        <p :style="PARAGRAPH">ขอเบิกค่าใช้จ่าย</p>
        <p :style="PARAGRAPH">{{ expenseLines.length ? expenseLines.join(', ') : '-' }}</p>

        <p :style="PARAGRAPH">ไปราชการด้วย</p>
        <p :style="PARAGRAPH">{{ vehicleLine }}</p>

        <p :style="{ ...PARAGRAPH, margin: '10px 0 5px 0' }">จึงเรียนมาเพื่อโปรดพิจารณา</p>
      </div>

      <!-- ---------- ลงชื่อผู้ขอ ---------- -->
      <div style="text-align: right; margin-top: 30px; margin-bottom: 15px; padding-right: 50px">
        <div style="font-size: 20px; display: inline-flex; align-items: center; gap: 10px; margin-bottom: 5px">
          <span>(ลงชื่อ)</span>
          <span style="display: inline-flex; flex-direction: column; align-items: center; margin-right: 10px">
            <img
              v-if="record.user_signature"
              :src="'/uploads/' + UI.encodePath(record.user_signature)"
              style="max-height: 60px; display: block; margin-bottom: 2px"
              alt="ลายเซ็น"
            />
            <span v-else style="height: 60px; display: block"></span>
            <span style="font-size: 20px; white-space: nowrap">{{ fullName }}</span>
            <span style="font-size: 20px; white-space: nowrap">{{ posText }}</span>
          </span>
          <span>ผู้ขออนุญาต</span>
        </div>
      </div>

      <!-- ---------- คอลัมน์ความเห็นผู้อนุมัติ ---------- -->
      <div v-if="col1 || col2" style="margin-top: 25px; display: flex; gap: 20px">
        <div style="flex: 1">
          <div style="font-size: 20px; margin-bottom: 5px; text-align: left">ความเห็นของผู้บังคับบัญชาขั้นต้น</div>

          <template v-if="col1">
            <div
              v-for="k in col1Options"
              :key="'c1' + k"
              style="font-size: 20px; margin-bottom: 3px; text-align: left; display: flex; align-items: baseline; gap: 4px"
            >
              <span>{{ parseNote(col1).choices.includes(k) ? '☑ ' : '☐ ' }}{{ k }}</span>
              <span v-if="isReasonKey(k) && parseNote(col1).reasonMap[k]" style="font-size: 18px; color: #64748b; margin-left: 8px">
                (เนื่องจาก {{ parseNote(col1).reasonMap[k] }})
              </span>
            </div>
            <!-- ข้อมูลเก่าที่ไม่ได้เก็บเป็น JSON → แสดงแบบข้อความเดียว -->
            <div v-if="!parseNote(col1).choices.length && col1.note" style="font-size: 20px; margin-bottom: 5px; text-align: left">
              ☑ เห็นควรอนุมัติ/อนุญาต
            </div>

            <div style="font-size: 20px; display: inline-flex; align-items: center; gap: 10px; margin-bottom: 5px">
              <span>(ลงชื่อ)</span>
              <span style="display: inline-flex; flex-direction: column; align-items: center">
                <img
                  v-if="col1.signature"
                  :src="'/uploads/' + UI.encodePath(col1.signature)"
                  style="max-height: 60px; display: block; margin-bottom: 2px"
                  alt="ลายเซ็น"
                />
                <span v-else style="height: 60px; display: block"></span>
                <span style="font-size: 20px; white-space: nowrap">{{ col1.name || '-' }}</span>
                <span
                  v-for="(pp, i) in splitPosition(col1.position)"
                  :key="'p1' + i"
                  style="font-size: 20px; white-space: nowrap"
                  >{{ pp }}</span
                >
                <span style="font-size: 20px; white-space: nowrap">
                  {{ col1.at ? UI.thaiDate(col1.at.slice(0, 10)) : '-' }}
                </span>
              </span>
            </div>
          </template>
        </div>

        <div style="flex: 1">
          <div style="font-size: 20px; margin-bottom: 5px; text-align: left">ความเห็นของผู้อนุมัติ/อนุญาต</div>

          <template v-if="col2">
            <div
              v-for="k in col2Options"
              :key="'c2' + k"
              style="font-size: 20px; margin-bottom: 3px; text-align: left; display: flex; align-items: baseline; gap: 4px"
            >
              <span>{{ parseNote(col2).choices.includes(k) ? '☑ ' : '☐ ' }}{{ k }}</span>
              <span v-if="isReasonKey(k) && parseNote(col2).reasonMap[k]" style="font-size: 18px; color: #64748b; margin-left: 8px">
                (เนื่องจาก {{ parseNote(col2).reasonMap[k] }})
              </span>
            </div>
            <div v-if="!parseNote(col2).choices.length && col2.note" style="font-size: 20px; margin-bottom: 5px; text-align: left">
              ☑ อนุมัติ/อนุญาต
            </div>

            <div style="font-size: 20px; display: inline-flex; align-items: center; gap: 10px; margin-bottom: 5px">
              <span>(ลงชื่อ)</span>
              <span style="display: inline-flex; flex-direction: column; align-items: center">
                <img
                  v-if="col2.signature"
                  :src="'/uploads/' + UI.encodePath(col2.signature)"
                  style="max-height: 60px; display: block; margin-bottom: 2px"
                  alt="ลายเซ็น"
                />
                <span v-else style="height: 60px; display: block"></span>
                <span style="font-size: 20px; white-space: nowrap">{{ col2.name || '-' }}</span>
                <span
                  v-for="(pp, i) in splitPosition(col2.position)"
                  :key="'p2' + i"
                  style="font-size: 20px; white-space: nowrap"
                  >{{ pp }}</span
                >
                <span style="font-size: 20px; white-space: nowrap">
                  {{ col2.at ? UI.thaiDate(col2.at.slice(0, 10)) : '-' }}
                </span>
              </span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <template #footer>
      <div style="display: flex; align-items: center; width: 100%">
        <div style="flex: 1; text-align: left">
          <div style="display: flex; align-items: center; gap: 10px; font-size: 16px">
            <span>สถานะ:</span>
            <StatusBadge :status="record.status" />
          </div>
          <ApprovalSteps :record="record" inline />
        </div>
        <div style="flex: 0; text-align: right">
          <button class="btn btn-primary" style="font-size: 16px; padding: 8px 24px" @click="printDoc">
            ⬢ พิมพ์
          </button>
        </div>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
