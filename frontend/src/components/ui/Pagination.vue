<script setup>
/**
 * Pagination — แบ่งรายการเป็นหน้า + เลขหน้าให้กดเลือก
 *
 * ใช้ร่วมกันทุกหน้ารายการ (ลา · ยานพาหนะ · ห้องประชุม · บันทึกข้อความ · ไปราชการ)
 * หน้าละ 25 รายการ และ "หน้า 1 = รายการล่าสุด" เพราะทุกรายการเรียงใหม่→เก่าอยู่แล้ว
 *
 * ทำไมแยก component
 * ─────────────────
 * หน้าละ 25 + เลขหน้า + ปุ่มก่อน/ถัดไป ต้องเหมือนกันทุกหน้า
 * ถ้าเขียนซ้ำ 5 ที่ วันหนึ่งแก้ที่เดียวแล้วอีก 4 ที่ไม่ตรงกัน
 *
 * ใช้:
 *   <Pagination :total="rows.length" :page="curPage" @update:page="page = $event" />
 *   (per-page ค่าเริ่มต้น 25)
 */
import { computed } from 'vue';

const props = defineProps({
  /** จำนวนรายการทั้งหมด */
  total: { type: Number, default: 0 },
  /** จำนวนรายการต่อหน้า */
  perPage: { type: Number, default: 25 },
  /** หน้าปัจจุบัน (1 = หน้าแรก) */
  page: { type: Number, default: 1 },
  /** คำเรียกในข้อความสรุป เช่น "รายการ" */
  label: { type: String, default: 'รายการ' },
});

const emit = defineEmits(['update:page']);

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.perPage)));

/** ช่วงรายการในหน้านี้ เช่น "รายการที่ 26–50 จาก 60" */
const rangeText = computed(() => {
  if (!props.total) return 'ไม่มีรายการ';
  const from = (props.page - 1) * props.perPage + 1;
  const to = Math.min(props.total, props.page * props.perPage);
  return `รายการที่ ${from}–${to} จาก ${props.total}`;
});

/**
 * เลขหน้าที่จะแสดง — มากกว่า 7 หน้าใช้ … คั่น
 * (หน้าแรก · หน้ารอบปัจจุบัน · หน้าสุดท้าย)
 */
const items = computed(() => {
  const n = pageCount.value;
  const cur = props.page;
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
  const keep = new Set([1, n, cur, cur - 1, cur + 1]);
  const nums = [...keep].filter((p) => p >= 1 && p <= n).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of nums) {
    if (prev && p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
});

function go(p) {
  if (typeof p !== 'number') return;
  if (p < 1 || p > pageCount.value || p === props.page) return;
  emit('update:page', p);
}
</script>

<template>
  <!-- มีหน้าเดียวไม่ต้องแสดง (ไม่รกหน้า) -->
  <div v-if="total > perPage" class="pager">
    <div class="pager-info">
      {{ rangeText }} · หน้า {{ page }}/{{ pageCount }}
    </div>
    <div class="pager-btns">
      <button
        class="btn btn-outline btn-sm"
        :disabled="page <= 1"
        title="หน้าก่อนหน้า"
        @click="go(page - 1)"
      >
        « ก่อนหน้า
      </button>

      <template v-for="(it, i) in items" :key="i">
        <span v-if="it === '…'" class="pager-dots">…</span>
        <button
          v-else
          class="btn btn-sm"
          :class="it === page ? 'btn-primary' : 'btn-outline'"
          :title="'ไปหน้า ' + it"
          @click="go(it)"
        >
          {{ it }}
        </button>
      </template>

      <button
        class="btn btn-outline btn-sm"
        :disabled="page >= pageCount"
        title="หน้าถัดไป"
        @click="go(page + 1)"
      >
        ถัดไป »
      </button>
    </div>
  </div>
</template>

<style scoped>
.pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 0 2px 8px;
}
.pager-info {
  font-size: 13px;
  color: var(--text-muted, #6b7280);
  white-space: nowrap;
}
.pager-btns {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.pager-btns .btn {
  min-width: 34px;
}
.pager-dots {
  padding: 0 4px;
  color: #9ca3af;
  line-height: 1;
}
</style>
