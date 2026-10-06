<script setup>
/**
 * SchoolsPage — เมนู 2: พิกัดโรงเรียนในสังกัด
 *
 * Phase 3: เขียนใหม่เป็น Vue component
 * (เดิมเป็น src/views/SchoolsView.js แบบ UI.h() — 473 บรรทัด)
 *
 * ฟีเจอร์เท่าเดิมทุกอย่าง:
 *   - แผนที่ Leaflet + marker clustering (ซูมเข้าแล้วค่อยแยกเป็นรายโรงเรียน)
 *   - ตัวกรอง: ค้นหาชื่อ/รหัส · อำเภอ · ประเภทภัยธรรมชาติ (หมุดสีส้มกะพริบ)
 *   - คำนวณระยะทางตามถนนจริง (OSRM) + วาดเส้นทาง + หมุด A/B
 *   - รายการโรงเรียน คลิกแล้วซูมไปที่หมุดนั้นและเปิดป้าย
 *   - admin: เพิ่ม/แก้/ลบ พร้อมเลือกพิกัดบนแผนที่ + อัปโหลดรูปความเสียหาย
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import L from 'leaflet';
import 'leaflet.markercluster';
import api from '../api/client.js';
import { UI } from '../ui/ui.js';
import { Auth } from '../stores/auth.js';
import AppModal from '../components/ui/AppModal.vue';

const loading = ref(true);
const error = ref('');
const schools = ref([]);
const districts = ref([]);

/* ---------- ตัวกรอง ---------- */
const query = ref('');
const districtFilter = ref('');
const disasterFilter = ref('');

const DISASTERS = ['น้ำท่วม', 'พายุ', 'แผ่นดินไหว'];
const DISASTER_ICON = { 'น้ำท่วม': '🌊', 'พายุ': '💨', 'แผ่นดินไหว': '🏚️' };

function matchesDisaster(s) {
  if (!disasterFilter.value) return true;
  const d = s.disaster || '';
  if (disasterFilter.value === 'ไม่เกิดภัยธรรมชาติ') return d === '' || d === 'ไม่เกิดภัยธรรมชาติ';
  return d === disasterFilter.value;
}

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return schools.value.filter((s) => {
    if (districtFilter.value && s.district !== districtFilter.value) return false;
    if (!matchesDisaster(s)) return false;
    if (q && !(s.name || '').toLowerCase().includes(q) && !(s.code || '').toLowerCase().includes(q)) return false;
    return true;
  });
});

/** จำนวนที่แสดง: เลือกตัวกรองภัย → นับเฉพาะที่ตรงประเภท (เหมือนของเดิม) */
const shownCount = computed(() =>
  disasterFilter.value ? schools.value.filter(matchesDisaster).length : schools.value.length,
);

/* ---------- แผนที่หลัก ---------- */
const mapEl = ref(null);
let map = null;
let cluster = null;
let markers = [];

function popupHtml(s) {
  const d = s.disaster || '';
  const dTag =
    d && d !== 'ไม่เกิดภัยธรรมชาติ'
      ? `<span style="display:inline-block;padding:2px 9px;border-radius:999px;background:#fff7ed;color:#c2410c;border:1px solid #fdba74;font-size:11.5px;font-weight:700;margin-top:4px">${DISASTER_ICON[d] || '⚠️'} ${UI.esc(d)}</span>`
      : '';
  return `<div style="min-width:180px">
      <b>${UI.esc(s.name)}</b><br>
      <span style="color:#64748b">${UI.esc(s.district ? 'อำเภอ' + s.district : '')}${s.code ? ' • รหัส ' + UI.esc(s.code) : ''}</span><br>
      ${s.address ? UI.esc(s.address) + '<br>' : ''}
      ${s.principal ? '👤 ' + UI.esc(s.principal) + '<br>' : ''}
      ${s.phone ? '📞 ' + UI.esc(s.phone) + '<br>' : ''}
      ${s.level ? '🎓 ' + UI.esc(s.level) : ''}
      ${dTag}
      ${s.disaster_image ? `<div style="margin-top:6px"><img src="/uploads/${UI.esc(s.disaster_image)}" alt="รูปความเสียหาย" style="width:100%;max-width:220px;max-height:150px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;cursor:pointer" onclick="window.open(this.src,&#39;_blank&#39;)" title="คลิกเพื่อดูรูปเต็ม"></div>` : ''}
    </div>`;
}

/** หมุดสีส้มกะพริบ (ใช้เมื่อเลือกตัวกรองภัยธรรมชาติ) */
function orangeMarkerIcon() {
  return L.divIcon({
    className: '',
    html: '<div class="disaster-marker"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -12],
  });
}

function destroyMap() {
  if (map) {
    try {
      map.remove();
    } catch (e) {
      /* ignore */
    }
    map = null;
  }
  cluster = null;
  markers = [];
}

function initMap() {
  if (!mapEl.value) return;
  destroyMap();

  map = L.map(mapEl.value).setView([18.15, 100.0], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  // หมุดรวมเป็นกลุ่มตามโซน — ซูมเข้าถึงค่อยแยกเป็นพิกัดรายโรงเรียน
  cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 55,
    spiderfyOnMaxZoom: true,
  });

  const bounds = [];
  const orangeIcon = disasterFilter.value ? orangeMarkerIcon() : null;
  for (const s of schools.value) {
    if (s.lat == null || s.lng == null) continue;
    if (!matchesDisaster(s)) continue;
    const m = L.marker([s.lat, s.lng], orangeIcon ? { icon: orangeIcon } : {});
    m.bindPopup(popupHtml(s));
    cluster.addLayer(m);
    markers.push(m);
    bounds.push([s.lat, s.lng]);
  }
  map.addLayer(cluster);
  if (bounds.length > 0) map.fitBounds(bounds, { padding: [40, 40] });
}

/* ---------- คำนวณระยะทาง ---------- */
const routeFrom = ref(null);
const routeTo = ref(null);
const routeResult = ref('');
const routeHint = ref('');
const routeBusy = ref(false);
let routeLayer = null;
let routeMarkers = [];

const routeOptions = computed(() =>
  schools.value
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ id: s.id, label: `${s.name} (อ.${s.district || '-'})` })),
);

function pickRoute(which, id) {
  if (!id) {
    (which === 'from' ? routeFrom : routeTo).value = null;
    drawRouteMarkers();
    return;
  }
  const s = schools.value.find((x) => String(x.id) === String(id));
  if (!s) return;
  (which === 'from' ? routeFrom : routeTo).value = { lat: s.lat, lng: s.lng, label: s.name };
  drawRouteMarkers();
  if (map) map.setView([s.lat, s.lng], 13);
  clearRouteLine();
  routeResult.value = '';
  routeHint.value = 'พร้อมคำนวณ — กด ▣ คำนวณระยะทาง';
}

/** วาดหมุด ต้นทาง (เขียว A) / ปลายทาง (แดง B) */
function drawRouteMarkers() {
  for (const mk of routeMarkers) {
    try {
      map.removeLayer(mk);
    } catch (e) {
      /* ignore */
    }
  }
  routeMarkers = [];
  if (!map) return;
  const mkIcon = (color, label) =>
    L.divIcon({
      className: '',
      html: `<div style="background:${color};color:#fff;border:2px solid #fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,.4)">${label}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14],
    });
  if (routeFrom.value) {
    const m = L.marker([routeFrom.value.lat, routeFrom.value.lng], { icon: mkIcon('#16a34a', 'A') }).addTo(map);
    m.bindPopup(`<b>ต้นทาง:</b> ${UI.esc(routeFrom.value.label)}`);
    routeMarkers.push(m);
  }
  if (routeTo.value) {
    const m = L.marker([routeTo.value.lat, routeTo.value.lng], { icon: mkIcon('#dc2626', 'B') }).addTo(map);
    m.bindPopup(`<b>ปลายทาง:</b> ${UI.esc(routeTo.value.label)}`);
    routeMarkers.push(m);
  }
}

function clearRouteLine() {
  if (routeLayer) {
    try {
      map.removeLayer(routeLayer);
    } catch (e) {
      /* ignore */
    }
    routeLayer = null;
  }
}

function clearRoute() {
  routeFrom.value = null;
  routeTo.value = null;
  drawRouteMarkers();
  clearRouteLine();
  routeResult.value = '';
  routeHint.value = '';
}

/** คำนวณระยะทางตามถนนจริง (OSRM route API) แล้ววาดเส้นทางบนแผนที่ */
async function calcRoute() {
  const from = routeFrom.value;
  const to = routeTo.value;
  if (!from || !to) return UI.toast('กรุณาเลือกทั้งต้นทางและปลายทาง', 'error');
  if (from.lat === to.lat && from.lng === to.lng) {
    return UI.toast('ต้นทางและปลายทางต้องไม่ใช่ที่เดียวกัน', 'error');
  }
  routeBusy.value = true;
  routeResult.value = '◷ กำลังคำนวณ...';
  routeHint.value = '';
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('เซิร์ฟเวอร์เส้นทางไม่ตอบสนอง');
    const data = await r.json();
    if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
      throw new Error('ไม่พบเส้นทางระหว่างจุดสองจุดนี้');
    }
    const route = data.routes[0];
    const km = (route.distance / 1000).toFixed(2);
    const mins = Math.round(route.duration / 60);
    clearRouteLine();
    routeLayer = L.geoJSON(route.geometry, { style: { color: '#2563eb', weight: 6, opacity: 0.85 } }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [60, 60] });
    routeResult.value = `▣ ${km} กม. (ประมาณ ${mins} นาที)`;
    routeHint.value = `เส้นทางจาก ${from.label} → ${to.label} ตามถนนจริง`;
    UI.toast(`ระยะทาง ${km} กม.`);
  } catch (e) {
    routeResult.value = '';
    routeHint.value = '';
    UI.toast(e.message, 'error');
  } finally {
    routeBusy.value = false;
  }
}

/* ---------- รายการโรงเรียน ---------- */
function focusSchool(s) {
  if (s.lat == null || s.lng == null || !map) return;
  const mk = markers.find((m) => m.getLatLng().lat === s.lat && m.getLatLng().lng === s.lng);
  if (!mk) return;
  // ซูมไปที่หมุดนั้น (ผ่าน cluster) แล้วเปิดป้ายข้อมูล
  if (cluster) cluster.zoomToShowLayer(mk, () => mk.openPopup());
  else {
    map.setView([s.lat, s.lng], 14);
    mk.openPopup();
  }
}

function disasterTag(s) {
  const d = s.disaster || '';
  if (!d || d === 'ไม่เกิดภัยธรรมชาติ') return null;
  return { icon: DISASTER_ICON[d] || '⚠️', text: d };
}

/* ---------- ฟอร์มเพิ่ม/แก้โรงเรียน ---------- */
const formOpen = ref(false);
const formSaving = ref(false);
const editing = ref(null);
const f = ref(emptySchool());
const pickMapEl = ref(null);
const clearImage = ref(false);
const disasterImage = ref(null);
let pickMap = null;
let pickMarker = null;

function emptySchool() {
  return {
    code: '',
    name: '',
    district: '',
    level: '',
    address: '',
    principal: '',
    phone: '',
    lat: null,
    lng: null,
    notes: '',
    disaster: '',
    disaster_image: '',
  };
}

function openCreate() {
  editing.value = null;
  f.value = emptySchool();
  clearImage.value = false;
  disasterImage.value = null;
  formOpen.value = true;
}

function openEdit(s) {
  editing.value = s;
  f.value = { ...emptySchool(), ...s };
  clearImage.value = false;
  disasterImage.value = null;
  formOpen.value = true;
}

function destroyPickMap() {
  if (pickMap) {
    try {
      pickMap.remove();
    } catch (e) {
      /* ignore */
    }
    pickMap = null;
    pickMarker = null;
  }
}

/** สร้างแผนที่เลือกพิกัดหลัง modal เปิด (ต้องรอ DOM พร้อม) */
/** แผนที่เลือกพิกัดต้องรอให้ modal วาง DOM เสร็จก่อน */
watch(formOpen, async (v) => {
  if (v) await mountPickMap();
  else destroyPickMap();
});

async function mountPickMap() {
  await nextTick();
  if (!pickMapEl.value) return;
  destroyPickMap();
  const lat = f.value.lat != null ? f.value.lat : 18.15;
  const lng = f.value.lng != null ? f.value.lng : 100.0;
  pickMap = L.map(pickMapEl.value).setView([lat, lng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(pickMap);
  pickMarker = L.marker([lat, lng]).addTo(pickMap);
  pickMap.on('click', (e) => {
    f.value.lat = e.latlng.lat;
    f.value.lng = e.latlng.lng;
    pickMarker.setLatLng(e.latlng);
  });
}

/** พิมพ์ lat/lng → เลื่อนแผนที่ไปตาม (เหมือนของเดิม) */
function onCoordInput() {
  const lat = parseFloat(f.value.lat);
  const lng = parseFloat(f.value.lng);
  if (!pickMap) return;
  pickMap.setView([lat || 18.15, lng || 100.0], 13);
  if (pickMarker) pickMarker.setLatLng([lat || 18.15, lng || 100.0]);
}

function closeForm() {
  destroyPickMap();
  formOpen.value = false;
}

async function saveSchool() {
  if (!f.value.name.trim()) return UI.toast('กรุณากรอกชื่อโรงเรียน', 'error');
  // ส่งแบบ multipart/form-data (รองรับรูปภาพความเสียหายจากภัยธรรมชาติ)
  const fd = new FormData();
  fd.append('code', f.value.code.trim());
  fd.append('name', f.value.name.trim());
  fd.append('district', f.value.district);
  fd.append('level', f.value.level.trim());
  fd.append('address', f.value.address.trim());
  fd.append('principal', f.value.principal.trim());
  fd.append('phone', f.value.phone.trim());
  fd.append('lat', f.value.lat != null ? f.value.lat : '');
  fd.append('lng', f.value.lng != null ? f.value.lng : '');
  fd.append('notes', f.value.notes.trim());
  fd.append('disaster', f.value.disaster);
  if (disasterImage.value) fd.append('disaster_image', disasterImage.value);
  if (clearImage.value) fd.append('disaster_image_clear', '1');

  formSaving.value = true;
  try {
    const res = editing.value
      ? await api.putForm('/schools/' + editing.value.id, fd)
      : await api.postForm('/schools', fd);
    UI.toast(res.message);
    closeForm();
    await load();
  } catch (e) {
    UI.toast(e.message, 'error');
  } finally {
    formSaving.value = false;
  }
}

async function removeSchool(s) {
  const yes = await UI.confirm(`ต้องการลบโรงเรียน "${s.name}" ใช่หรือไม่?`, { danger: true, okText: 'ลบ' });
  if (!yes) return;
  try {
    const res = await api.del('/schools/' + s.id);
    UI.toast(res.message);
    schools.value = schools.value.filter((x) => x.id !== s.id);
    await nextTick();
    initMap();
  } catch (e) {
    UI.toast(e.message, 'error');
  }
}

/* ---------- โหลดข้อมูล ---------- */
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api.get('/schools');
    schools.value = data.schools || [];
    districts.value = [...new Set(schools.value.map((s) => s.district).filter(Boolean))].sort();
    await nextTick();
    initMap();
  } catch (e) {
    error.value = e.message;
    schools.value = [];
  } finally {
    loading.value = false;
  }
}

// เปลี่ยนตัวกรองภัยธรรมชาติ → ต้องวาดหมุดใหม่ (สีส้มกะพริบ)
watch(disasterFilter, async () => {
  await nextTick();
  initMap();
});

onMounted(load);

onBeforeUnmount(() => {
  destroyMap();
  destroyPickMap();
});
</script>

<template>
  <div class="page-head">
    <div>
      <div class="page-title"><span class="pi">🗺️</span>พิกัดโรงเรียนในสังกัด</div>
      <div class="page-desc">แผนที่และข้อมูลโรงเรียนในสังกัด สพป.แพร่ เขต 2</div>
    </div>
    <button v-if="Auth.isAdmin()" class="btn btn-primary" @click="openCreate">+ เพิ่มโรงเรียน</button>
  </div>

  <!-- ---------- แผนที่ (อยู่บนสุด) ---------- -->
  <div class="card" style="padding: 0; overflow: hidden">
    <div ref="mapEl" id="sch-map" class="map-container" style="border: none; border-radius: 0; height: 480px"></div>
  </div>

  <!-- ---------- คำนวณระยะทาง ---------- -->
  <div class="card">
    <div class="card-title">🧭 คำนวณระยะทาง (ตามถนนจริง)</div>
    <div class="form-grid" style="margin-bottom: 4px">
      <div class="form-group">
        <label>ต้นทาง</label>
        <select
          id="rt-from"
          :value="routeFrom ? routeFrom.id : ''"
          @change="pickRoute('from', $event.target.value)"
        >
          <option value="">— เลือกโรงเรียน —</option>
          <option v-for="o in routeOptions" :key="'f' + o.id" :value="String(o.id)">{{ o.label }}</option>
        </select>
      </div>
      <div class="form-group">
        <label>ปลายทาง</label>
        <select id="rt-to" :value="routeTo ? routeTo.id : ''" @change="pickRoute('to', $event.target.value)">
          <option value="">— เลือกโรงเรียน —</option>
          <option v-for="o in routeOptions" :key="'t' + o.id" :value="String(o.id)">{{ o.label }}</option>
        </select>
      </div>
    </div>
    <div class="filter-row" style="gap: 8px; flex-wrap: wrap">
      <button class="btn btn-primary" :disabled="routeBusy" @click="calcRoute">▣ คำนวณระยะทาง</button>
      <button class="btn btn-outline" @click="clearRoute">🧹 ล้างเส้นทาง</button>
      <span id="rt-result" class="hint" style="font-weight: 700; font-size: 16px">{{ routeResult }}</span>
      <span id="rt-hint" class="hint">{{ routeHint }}</span>
    </div>
  </div>

  <!-- ---------- ตัวกรอง ---------- -->
  <div class="filter-row">
    <input
      id="sch-search"
      v-model="query"
      type="search"
      placeholder="⊙ ค้นหาชื่อโรงเรียน..."
      style="min-width: 220px"
    />
    <select id="sch-district" v-model="districtFilter">
      <option value="">ทุกอำเภอ</option>
      <option v-for="d in districts" :key="d" :value="d">อำเภอ{{ d }}</option>
    </select>
    <select id="sch-disaster" v-model="disasterFilter">
      <option value="">⚠️ ทุกประเภทภัยธรรมชาติ</option>
      <option value="น้ำท่วม">🌊 น้ำท่วม</option>
      <option value="พายุ">💨 พายุ</option>
      <option value="แผ่นดินไหว">🏚️ แผ่นดินไหว</option>
      <option value="ไม่เกิดภัยธรรมชาติ">● ไม่เกิดภัยธรรมชาติ</option>
    </select>
    <span id="sch-count" class="hint">{{ shownCount }} แห่ง</span>
  </div>

  <!-- ---------- รายการโรงเรียน ---------- -->
  <div class="card">
    <div v-if="loading" class="center-load"><span class="spin"></span> กำลังโหลดโรงเรียน...</div>
    <div v-else-if="error" class="empty-state"><span class="em">⚠️</span>{{ error }}</div>
    <template v-else>
      <div class="card-title">🏫 รายชื่อโรงเรียนในสังกัด ({{ filtered.length }} แห่ง)</div>

      <div v-if="filtered.length === 0" class="empty-state"><span class="em">⊙</span>ไม่พบโรงเรียน</div>

      <div v-else style="display: grid; gap: 8px">
        <div
          v-for="s in filtered"
          :key="s.id"
          class="card"
          style="padding: 12px 16px; margin-bottom: 0; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap"
          @click="focusSchool(s)"
        >
          <div>
            <div style="font-weight: 700">
              {{ s.name }} {{ s.code ? '(' + s.code + ')' : '' }}
              <span
                v-if="disasterTag(s)"
                class="disaster-tag"
                :title="'ภัยธรรมชาติ: ' + disasterTag(s).text"
              >
                {{ disasterTag(s).icon }} {{ disasterTag(s).text }}
              </span>
            </div>
            <div class="hint">
              {{ s.district ? 'อำเภอ' + s.district : '' }}{{ s.address ? ' • ' + s.address : '' }}{{ s.level ? ' • ' + s.level : '' }}
            </div>
          </div>
          <div v-if="Auth.isAdmin()" class="status-btns" @click.stop>
            <button class="btn btn-xs btn-outline" @click="openEdit(s)">✎</button>
            <button class="btn btn-xs btn-outline danger-btn" @click="removeSchool(s)">✕</button>
          </div>
        </div>
      </div>
    </template>
  </div>

  <!-- ---------- ฟอร์มเพิ่ม/แก้โรงเรียน ---------- -->
  <AppModal
    v-if="formOpen"
    :title="editing ? '✎ แก้ไขโรงเรียน' : '+ เพิ่มโรงเรียน'"
    size="lg"
    footer
    @close="closeForm"
  >
    <div class="form-grid">
      <div class="form-group">
        <label>รหัสโรงเรียน (SMIS)</label>
        <input id="f-code" v-model="f.code" placeholder="เช่น 10130101" />
      </div>
      <div class="form-group">
        <label>ชื่อโรงเรียน <span class="req"> *</span></label>
        <input id="f-name" v-model="f.name" placeholder="เช่น โรงเรียนบ้านดอนมูล" />
      </div>
      <div class="form-group">
        <label>อำเภอ</label>
        <select id="f-district" v-model="f.district">
          <option value="">— ไม่ระบุ —</option>
          <option v-for="d in districts" :key="d" :value="d">อำเภอ{{ d }}</option>
        </select>
      </div>
      <div class="form-group">
        <label>ระดับชั้นที่เปิดสอน</label>
        <input id="f-level" v-model="f.level" placeholder="เช่น อนุบาล - ป.6" />
      </div>
      <div class="form-group full">
        <label>ที่อยู่</label>
        <input id="f-address" v-model="f.address" placeholder="เช่น ต.เด่นชัย อ.เด่นชัย จ.แพร่" />
      </div>
      <div class="form-group">
        <label>ผู้อำนวยการโรงเรียน</label>
        <input id="f-principal" v-model="f.principal" />
      </div>
      <div class="form-group">
        <label>เบอร์โทรศัพท์</label>
        <input id="f-phone" v-model="f.phone" />
      </div>
      <div class="form-group">
        <label>ละติจูด (Latitude)</label>
        <input id="f-lat" v-model.number="f.lat" type="number" step="any" @input="onCoordInput" />
      </div>
      <div class="form-group">
        <label>ลองจิจูด (Longitude)</label>
        <input id="f-lng" v-model.number="f.lng" type="number" step="any" @input="onCoordInput" />
      </div>
      <div class="form-group full">
        <label>หมายเหตุ</label>
        <input id="f-notes" v-model="f.notes" />
      </div>
      <div class="form-group">
        <label>⚠️ ภัยธรรมชาติ</label>
        <select id="f-disaster" v-model="f.disaster">
          <option value="">ไม่เกิดภัยธรรมชาติ</option>
          <option value="น้ำท่วม">🌊 น้ำท่วม</option>
          <option value="พายุ">💨 พายุ</option>
          <option value="แผ่นดินไหว">🏚️ แผ่นดินไหว</option>
        </select>
      </div>
      <div class="form-group">
        <label>📷 รูปภาพความเสียหายจากภัยธรรมชาติ</label>
        <input
          id="f-disaster-image"
          type="file"
          accept="image/*"
          style="padding: 6px 0"
          @change="disasterImage = $event.target.files[0] || null"
        />
        <div v-if="editing && editing.disaster_image && !disasterImage" style="margin-top: 6px">
          <img
            :src="'/uploads/' + editing.disaster_image"
            alt="รูปความเสียหาย"
            style="max-width: 100%; max-height: 160px; border-radius: 8px; border: 1px solid #e2e8f0"
          />
          <label style="display: flex; gap: 6px; align-items: center; margin-top: 4px; font-size: 13px; color: #64748b">
            <input id="f-disaster-image-clear" v-model="clearImage" type="checkbox" />
            ลบรูปภาพนี้
          </label>
        </div>
      </div>
      <div class="form-group full">
        <label>ตำแหน่งบนแผนที่ (คลิกบนแผนที่เพื่อกำหนดพิกัด)</label>
        <div ref="pickMapEl" id="pick-map" class="map-container" style="height: 260px"></div>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-outline" :disabled="formSaving" @click="closeForm">ยกเลิก</button>
      <button class="btn btn-primary" :disabled="formSaving" @click="saveSchool">
        {{ formSaving ? 'กำลังบันทึก...' : '▽ บันทึก' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
/* ใช้คลาสจาก theme.css ของระบบเดิมทั้งหมด */
</style>
