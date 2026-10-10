<script setup>
/**
 * MemoDoc — แบบฟอร์มบันทึกข้อความตามฟอร์มทางการ (form_bunteugkokeam)
 *
 * ย้ายจาก MemosView.formDocument()
 *
 * ใช้ 3 จุด:
 *   1. หน้าดูบันทึกข้อความ
 *   2. หน้าต่างอนุมัติ (ให้ผู้อนุมัติอ่านตรวจสอบก่อนตัดสินใจ)
 *   3. หลังกด "ส่ง" เสร็จ — เปิดให้พิมพ์ทันที
 *
 * หมายเหตุ: เป็นเอกสารทางการ ห้ามเปลี่ยนข้อความ/ลำดับบรรทัด/คลาส CSS
 */
import { computed } from 'vue';
import { UI } from '../../ui/ui.js';

const props = defineProps({
  memo: { type: Object, required: true },
});

const m = computed(() => props.memo);

/** ผู้จัดทำ — คำนำหน้าชื่อแยกเป็น maker_title */
function maker() {
  return {
    title: m.value.maker_title,
    full_name: m.value.full_name,
    first_name: m.value.first_name,
    last_name: m.value.last_name,
  };
}

/** ส่วนราชการ: ถ้ามีส่วนราชการเฉพาะหน่วย ให้เติม "สพป.แพร่ เขต 2" ต่อท้าย */
const officeLine = computed(() => {
  const o = (m.value.office || '').trim();
  return `${o}${o && o !== 'สพป.แพร่ เขต 2' ? ' ' : ''}สพป.แพร่ เขต 2`;
});

function approvalAt(level) {
  return (m.value.approvals || []).find((a) => Number(a.level) === level) || null;
}

/**
 * คอลัมน์ลายเซ็น (ลายเซ็น + ชื่อ + ตำแหน่ง + ความเห็นก่อนหน้า)
 * extraClass ใช้จัดตำแหน่งให้ตรงตามแบบฟอร์ม
 */
function sigCol(sig, name, pos, lines, extraClass) {
  const arr = Array.isArray(lines) ? lines : lines ? [lines] : [];
  return { sig, name, pos, lines: arr, cls: extraClass || '' };
}

/** ผู้อนุมัติขั้นที่ 1 — ความเห็นเป็นคำเดียว */
function sigColL1() {
  const a = approvalAt(1);
  if (!a) return null;
  const lines = a.decide ? [`☑ ${a.decide}`] : [];
  return sigCol(a.signature, UI.personName(a), a.position || '-', lines, 'sig-approver');
}

/**
 * ผู้อนุมัติขั้นที่ 2 — 2 แบบ
 *   ผ่านเรื่อง → ความเห็นบนลายเซ็น + ความเห็นเพิ่มเติม
 *   ปฏิบัติราชการแทน → ตัวเลือกที่ติ๊กได้หลายช่อง + ความเห็นเพิ่มเติม
 */
function sigColL2() {
  const a = approvalAt(2);
  if (!a) return null;
  const lines = [];
  if (a.mode === 'act') {
    if (Array.isArray(a.act_choices) && a.act_choices.length) lines.push(`☑ ${a.act_choices.join(', ')}`);
  } else if (a.decide) {
    lines.push(`☑ ${a.decide}`);
  }
  if (a.comment) lines.push(a.comment);
  return sigCol(a.signature, UI.personName(a), a.position || '-', lines, 'sig-approver sig-pos-single');
}

/** ผู้อนุมัติขั้นที่ 3 (สุดท้าย) — บันทึกสั่งการ */
function sigColL3() {
  const a = approvalAt(3);
  if (!a) return null;
  const lines = [];
  if (Array.isArray(a.act_choices) && a.act_choices.length) lines.push(`☑ ${a.act_choices.join(', ')}`);
  else if (a.decide) lines.push(`☑ ${a.decide}`);
  if (a.comment) lines.push(a.comment);
  return sigCol(a.signature, UI.personName(a), a.position || '-', lines, 'sig-pos-single');
}

/** พิมพ์แบบฟอร์มนี้เป็นเอกสาร (เปิดหน้าต่างใหม่) */
function printDoc() {
  const el = document.getElementById('memo-doc-print');
  if (!el) return;
  const css = document.querySelector('link[rel="stylesheet"][href*="theme"], link[rel="stylesheet"][href*="index-"]');
  const styleTag = css ? `<link rel="stylesheet" href="${css.href}">` : '';
  const w = window.open('', '_blank', 'width=900,height=1200');
  if (!w) return UI.toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต pop-up', 'error');
  w.document.write(
    `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>บันทึกข้อความ</title>${styleTag}` +
      `<style>body{background:#f0f2f5;padding:32px;margin:0}@media print{body{background:#fff;padding:0}}</style>` +
      `</head><body>${el.outerHTML}</body></html>`,
  );
  w.document.close();
  setTimeout(() => {
    w.focus();
    w.print();
  }, 400);
}

defineExpose({ printDoc });

const cols = computed(() => ({
  l1: sigColL1(),
  l2: sigColL2(),
  l3: sigColL3(),
  maker: sigCol(m.value.maker_signature, UI.personName(maker()), m.value.maker_position || '-', null, ''),
}));
</script>

<template>
  <div id="memo-doc-print" class="doc memo-doc">
    <div class="memo-doc-head">
      <!--
        ตราอยู่ที่ backend/form/krut.png และเสิร์ฟที่ /form/krut.png
        ต้องผูกด้วย :src เป็น runtime URL — ถ้าใช้ src="..." ตรง ๆ
        Vite จะพยายามหาไฟล์ในโปรเจกต์ตอน build แล้ว fail
      -->
      <img class="memo-doc-emblem" :src="'/form/krut.png'" alt="" />
      <div class="memo-doc-title">บันทึกข้อความ</div>
    </div>

    <!-- บรรทัดที่ 1: ส่วนราชการ -->
    <div class="memo-line">
      <span class="memo-label">ส่วนราชการ </span>
      <span>{{ officeLine }}</span>
    </div>

    <!-- บรรทัดที่ 2: ที่ + วันที่ -->
    <div class="memo-line">
      <span class="memo-label">ที่ </span>
      <span>{{ m.doc_no || '' }}</span>
      <span class="memo-label" style="margin-left: 50px">วันที่ </span>
      <span>{{ UI.thaiDate(m.date) }}</span>
    </div>

    <!-- บรรทัดที่ 3: เรื่อง -->
    <div class="memo-line">
      <span class="memo-label">เรื่อง </span>
      <span>{{ m.title }}</span>
    </div>

    <div class="memo-line">
      <span class="memo-label">เรียน </span>
      <span>{{ m.to_text || 'ผู้อำนวยการสำนักงานเขตพื้นที่การศึกษาประถมศึกษาแพร่ เขต 2' }}</span>
    </div>

    <div class="memo-divider"></div>

    <div class="memo-content" v-html="m.content || '-'"></div>

    <div class="memo-sig">
      <!-- แถวบน: ผู้อนุมัติขั้นที่ 1 + ผู้บันทึก -->
      <div class="memo-sig-row">
        <div
          v-if="cols.l1"
          class="memo-sig-col sig-approver"
        >
          <div v-for="(t, i) in cols.l1.lines" :key="'l1' + i" class="memo-sig-decide">{{ t }}</div>
          <img v-if="cols.l1.sig" class="doc-sig" :src="'/uploads/' + UI.encodePath(cols.l1.sig)" alt="ลายเซ็น" />
          <div v-else class="doc-sig-empty">(ยังไม่มีลายเซ็น)</div>
          <div class="doc-sig-name">{{ cols.l1.name }}</div>
          <div class="doc-sig-pos">{{ cols.l1.pos || '-' }}</div>
        </div>
        <div class="memo-sig-col">
          <img
            v-if="cols.maker.sig"
            class="doc-sig"
            :src="'/uploads/' + UI.encodePath(cols.maker.sig)"
            alt="ลายเซ็น"
          />
          <div v-else class="doc-sig-empty">(ยังไม่มีลายเซ็น)</div>
          <div class="doc-sig-name">{{ cols.maker.name }}</div>
          <div class="doc-sig-pos">{{ cols.maker.pos || '-' }}</div>
        </div>
      </div>

      <!-- แถวล่าง: ผู้อนุมัติขั้นที่ 2 + ขั้นที่ 3 -->
      <div class="memo-sig-row">
        <div v-for="c in [{ key: 'l2', c: cols.l2 }, { key: 'l3', c: cols.l3 }]" :key="c.key">
          <div v-if="c.c" class="memo-sig-col" :class="c.c.cls">
            <div v-for="(t, i) in c.c.lines" :key="c.key + i" class="memo-sig-decide">{{ t }}</div>
            <img v-if="c.c.sig" class="doc-sig" :src="'/uploads/' + UI.encodePath(c.c.sig)" alt="ลายเซ็น" />
            <div v-else class="doc-sig-empty">(ยังไม่มีลายเซ็น)</div>
            <div class="doc-sig-name">{{ c.c.name }}</div>
            <div class="doc-sig-pos">{{ c.c.pos || '-' }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของเดิมทั้งหมด */
</style>
