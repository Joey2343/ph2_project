<script setup>
/**
 * BudgetsPage — เมนู 11: บริหารงบประมาณ
 *
 * Phase 3: เขียนใหม่เป็น Vue component
 * (เดิมเป็น src/views/BudgetsView.js แบบ UI.h())
 *
 * ฟีเจอร์เท่าเดิม:
 *   - การ์ดสรุป 3 ช่อง (งบรวม / ใช้จ่ายแล้ว / คงเหลือ)
 *   - การ์ดรายหมวดพร้อมแถบความคืบหน้า (สีเตือนเมื่อใกล้เต็ม)
 *   - คลิกการ์ดเพื่อดูรายการเดินบัญชีของหมวดนั้น
 *   - admin: เพิ่ม/แก้/ลบหมวดงบ + เพิ่ม/ลบรายการเดินบัญชี
 */
import { ref, computed, onMounted, watch } from 'vue';
import api from '../api/client.js';
import { UI } from '../ui/ui.js';
import { Auth } from '../stores/auth.js';
import AppModal from '../components/ui/AppModal.vue';
import ThaiDateField from '../components/ui/ThaiDateField.vue';

const loading = ref(true);
const error = ref('');
const budgets = ref([]);
const summary = ref({ totalPlan: 0, totalUsed: 0, totalRemaining: 0 });

/** หมวดที่เลือกดูรายการเดินบัญชี */
const activeId = ref(null);
const txLoading = ref(false);
const txError = ref('');
const transactions = ref([]);

/* ---------- ฟอร์มเพิ่มรายการเดินบัญชี (admin) ---------- */
const tx = ref({ date: '', type: 'expense', amount: null, description: '' });
const txSaving = ref(false);

/* ---------- ฟอร์มหมวดงบ (admin) ---------- */
const budgetOpen = ref(false);
const budgetSaving = ref(false);
const bf = ref({ id: null, year: 0, category: '', plan: 0, sort: 0, note: '' });

const stats = computed(() => [
  { icon: '📊', label: 'งบประมาณรวม', value: UI.money(summary.value.totalPlan) + ' บาท', bg: 'var(--info-light)' },
  { icon: '💸', label: 'ใช้จ่ายแล้ว', value: UI.money(summary.value.totalUsed) + ' บาท', bg: 'var(--danger-light)' },
  { icon: '💎', label: 'คงเหลือ', value: UI.money(summary.value.totalRemaining) + ' บาท', bg: 'var(--success-light)' },
]);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api.get('/budgets');
    budgets.value = data.budgets || [];
    summary.value = {
      totalPlan: data.totalPlan,
      totalUsed: data.totalUsed,
      totalRemaining: data.totalRemaining,
    };
    // คงหมวดที่เลือกไว้ถ้ายังมีอยู่ ไม่งั้นเลือกหมวดแรก
    if (!budgets.value.some((b) => b.id === activeId.value)) {
      activeId.value = budgets.value.length ? budgets.value[0].id : null;
    }
  } catch (e) {
    error.value = e.message;
    budgets.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadTx() {
  if (!activeId.value) {
    transactions.value = [];
    return;
  }
  txLoading.value = true;
  txError.value = '';
  try {
    const data = await api.get(`/budgets/${activeId.value}/transactions`);
    transactions.value = data.transactions || [];
  } catch (e) {
    txError.value = e.message;
    transactions.value = [];
  } finally {
    txLoading.value = false;
  }
}

watch(activeId, async () => {
  // รีเซ็ตฟอร์มเพิ่มรายการให้วันที่เป็นวันปัจจุบันเสมอ (เหมือนของเดิม)
  tx.value = { date: UI.today(), type: 'expense', amount: null, description: '' };
  await loadTx();
});

const activeBudget = computed(() => budgets.value.find((b) => b.id === activeId.value) || null);

function openBudgetCreate() {
  bf.value = {
    id: null,
    year: new Date().getFullYear() + 543,
    category: '',
    plan: 0,
    sort: 0,
    note: '',
  };
  budgetOpen.value = true;
}

function openBudgetEdit(b) {
  bf.value = {
    id: b.id,
    year: b.year,
    category: b.category || '',
    plan: b.plan || 0,
    sort: b.sort || 0,
    note: b.note || '',
  };
  budgetOpen.value = true;
}

async function saveBudget() {
  if (!bf.value.category.trim()) {
    return UI.toast('กรุณากรอกหมวดงบประมาณ', 'error');
  }
  const data = {
    year: parseInt(bf.value.year, 10) || new Date().getFullYear() + 543,
    category: bf.value.category.trim(),
    plan: parseFloat(bf.value.plan) || 0,
    sort: parseInt(bf.value.sort, 10) || 0,
    note: bf.value.note.trim(),
  };
  budgetSaving.value = true;
  try {
    const res = bf.value.id ? await api.put('/budgets/' + bf.value.id, data) : await api.post('/budgets', data);
    UI.toast(res.message);
    budgetOpen.value = false;
    await load();
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    budgetSaving.value = false;
  }
}

async function removeBudget(b) {
  const yes = await UI.confirm(`ต้องการลบหมวด "${b.category}" พร้อมรายการเดินบัญชีทั้งหมด ใช่หรือไม่?`, { danger: true, okText: 'ลบ' });
  if (!yes) return;
  try {
    const res = await api.del('/budgets/' + b.id);
    UI.toast(res.message);
    activeId.value = null;
    await load();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

async function addTx() {
  if (!tx.value.description.trim()) return UI.toast('กรุณากรอกรายละเอียดรายการ', 'error');
  if (!tx.value.amount || tx.value.amount <= 0) return UI.toast('กรุณาระบุจำนวนเงินที่ถูกต้อง', 'error');
  const data = {
    date: tx.value.date,
    type: tx.value.type,
    amount: parseFloat(tx.value.amount),
    description: tx.value.description.trim(),
  };
  txSaving.value = true;
  try {
    const res = await api.post(`/budgets/${activeId.value}/transactions`, data);
    UI.toast(res.message);
    tx.value = { date: UI.today(), type: 'expense', amount: null, description: '' };
    await Promise.all([load(), loadTx()]);
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    txSaving.value = false;
  }
}

async function removeTx(t) {
  const yes = await UI.confirm('ต้องการลบรายการนี้ใช่หรือไม่?', { danger: true, okText: 'ลบ' });
  if (!yes) return;
  try {
    const res = await api.del(`/budgets/${activeId.value}/transactions/${t.id}`);
    UI.toast(res.message);
    await Promise.all([load(), loadTx()]);
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

/** สีแถบความคืบหน้า: เตือนเมื่อใช้ไปมาก */
function pctOf(b) {
  return b.plan > 0 ? Math.min(100, Math.round((b.used / b.plan) * 100)) : 0;
}
function barClass(pct) {
  return pct >= 90 ? 'progress-fill high' : pct >= 70 ? 'progress-fill mid' : 'progress-fill';
}

onMounted(async () => {
  await load();
  await loadTx();
});
</script>

<template>
  <div class="page-head">
    <div>
      <div class="page-title"><span class="pi">💰</span>บริหารงบประมาณ</div>
      <div class="page-desc">แผนงบประมาณและการใช้จ่ายของหน่วยงาน</div>
    </div>
    <button v-if="Auth.isAdmin()" class="btn btn-primary" @click="openBudgetCreate">+ เพิ่มรายการงบประมาณ</button>
  </div>

  <div v-if="loading" class="card">
    <div class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
  </div>

  <div v-else-if="error" class="card">
    <div class="empty-state"><span class="em">⚠️</span>{{ error }}</div>
  </div>

  <template v-else>
    <!-- ---------- สรุปภาพรวม ---------- -->
    <div class="stat-grid">
      <div v-for="(s, i) in stats" :key="i" class="stat-card">
        <div class="stat-icon" :style="{ background: s.bg }">{{ s.icon }}</div>
        <div>
          <div class="stat-value" style="font-size: 17px">{{ s.value }}</div>
          <div class="stat-label">{{ s.label }}</div>
        </div>
      </div>
    </div>

    <!-- ---------- รายการงบประมาณรายหมวด ---------- -->
    <div v-if="budgets.length === 0" class="card">
      <div class="empty-state"><span class="em">💰</span>ยังไม่มีรายการงบประมาณ</div>
    </div>

    <div
      v-else
      style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; margin-bottom: 18px"
    >
      <div
        v-for="b in budgets"
        :key="b.id"
        class="card"
        style="margin-bottom: 0; cursor: pointer"
        :style="b.id === activeId ? { outline: '2px solid var(--primary)' } : null"
        @click="activeId = b.id"
      >
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px">
          <div>
            <div style="font-weight: 800; font-size: 15.5px">{{ b.category }}</div>
            <div class="hint">ปีงบประมาณ {{ b.year }}{{ b.note ? ' • ' + b.note : '' }}</div>
          </div>
          <div v-if="Auth.isAdmin()" class="status-btns" @click.stop>
            <button class="btn btn-xs btn-outline" @click="openBudgetEdit(b)">✎</button>
            <button class="btn btn-xs btn-outline danger-btn" @click="removeBudget(b)">✕</button>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; margin: 10px 0 6px; font-size: 13.5px">
          <span class="hint">แผน {{ UI.money(b.plan) }} บาท</span>
          <span class="hint">ใช้แล้ว {{ UI.money(b.used) }} บาท</span>
        </div>
        <div class="progress-wrap">
          <div :class="barClass(pctOf(b))" :style="{ width: pctOf(b) + '%' }"></div>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 14px">
          <span>คงเหลือ</span>
          <span class="money" :class="{ negative: b.remaining < 0 }">{{ UI.money(b.remaining) }} บาท</span>
        </div>
      </div>
    </div>

    <!-- ---------- รายการเดินบัญชีของหมวดที่เลือก ---------- -->
    <div v-if="activeBudget" class="card">
      <div class="card-title">🧾 รายการเดินบัญชี — {{ activeBudget.category }}</div>

      <div v-if="Auth.isAdmin()" class="form-grid" style="margin-bottom: 16px">
        <div class="form-group">
          <label>วันที่</label>
          <ThaiDateField id="bt-date" v-model="tx.date" />
        </div>
        <div class="form-group">
          <label>ประเภท</label>
          <select id="bt-type" v-model="tx.type">
            <option value="expense">💸 รายจ่าย</option>
            <option value="income">💵 รายรับ</option>
          </select>
        </div>
        <div class="form-group">
          <label>จำนวนเงิน (บาท)</label>
          <input id="bt-amount" v-model.number="tx.amount" type="number" min="0" step="0.01" />
        </div>
        <div class="form-group full">
          <label>รายละเอียด</label>
          <input id="bt-desc" v-model="tx.description" placeholder="เช่น ค่าจ้างเหมาทำอาหารกลางวัน เดือน ก.ค." />
        </div>
        <div class="form-group full" style="display: flex; justify-content: flex-end">
          <button class="btn btn-primary" :disabled="txSaving" @click="addTx">
            {{ txSaving ? 'กำลังบันทึก...' : '+ บันทึกรายการ' }}
          </button>
        </div>
      </div>

      <div v-if="txLoading" class="center-load"><span class="spin"></span> กำลังโหลดข้อมูล...</div>
      <div v-else-if="txError" class="empty-state"><span class="em">⚠️</span>{{ txError }}</div>
      <div v-else-if="transactions.length === 0" class="empty-state">
        <span class="em">🧾</span>ยังไม่มีรายการเดินบัญชี
      </div>

      <div v-else class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>วันที่</th>
              <th>ประเภท</th>
              <th>รายละเอียด</th>
              <th class="num">จำนวนเงิน</th>
              <th v-if="Auth.isAdmin()"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in transactions" :key="t.id">
              <td>{{ UI.date(t.date) }}</td>
              <td>
                <span
                  class="status-pill"
                  :style="t.type === 'expense'
                    ? { background: '#fee2e2', color: '#b91c1c', padding: '3px 10px', borderRadius: '999px', fontWeight: 700, fontSize: '12.5px' }
                    : { background: '#dcfce7', color: '#15803d', padding: '3px 10px', borderRadius: '999px', fontWeight: 700, fontSize: '12.5px' }"
                >
                  {{ t.type === 'expense' ? '💸 รายจ่าย' : '💵 รายรับ' }}
                </span>
              </td>
              <td>{{ t.description }}</td>
              <td class="num">
                <span class="money" :class="{ negative: t.type === 'expense' }">
                  {{ (t.type === 'expense' ? '- ' : '+ ') + UI.money(t.amount) }}
                </span>
              </td>
              <td v-if="Auth.isAdmin()">
                <button class="btn btn-xs btn-outline danger-btn" @click="removeTx(t)">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </template>

  <!-- ---------- ฟอร์มหมวดงบ ---------- -->
  <AppModal
    v-if="budgetOpen"
    :title="bf.id ? '✎ แก้ไขงบประมาณ' : '+ เพิ่มรายการงบประมาณ'"
    footer
    @close="budgetOpen = false"
  >
    <div class="form-grid">
      <div class="form-group">
        <label>ปีงบประมาณ</label>
        <input id="bf-year" v-model.number="bf.year" type="number" />
      </div>
      <div class="form-group">
        <label>หมวดงบประมาณ <span class="req"> *</span></label>
        <input id="bf-cat" v-model="bf.category" placeholder="เช่น งบดำเนินงาน" />
      </div>
      <div class="form-group">
        <label>วงเงินงบประมาณ (บาท)</label>
        <input id="bf-plan" v-model.number="bf.plan" type="number" min="0" step="0.01" />
      </div>
      <div class="form-group">
        <label>ลำดับการแสดง</label>
        <input id="bf-sort" v-model.number="bf.sort" type="number" />
      </div>
      <div class="form-group full">
        <label>หมายเหตุ</label>
        <input id="bf-note" v-model="bf.note" />
      </div>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="budgetSaving" @click="budgetOpen = false">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="budgetSaving" @click="saveBudget">
        {{ budgetSaving ? 'กำลังบันทึก...' : '▽ บันทึก' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของระบบเดิมทั้งหมด */
</style>
