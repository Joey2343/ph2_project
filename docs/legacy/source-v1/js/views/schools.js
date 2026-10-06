'use strict';
/* เมนู 2: พิกัดโรงเรียนในสังกัด */

const SchoolsView = {
  /** รายการอำเภอ — อัปเดตจากข้อมูลจริงตอนโหลด (รองรับอำเภอที่ไม่มีในรายการเดิม) */
  allDistricts: [],
  schools: [],
  map: null,
  markers: [],
  districtFilter: '',
  disasterFilter: '', // ตัวกรองภัยธรรมชาติ ('' = ทุกประเภท, 'น้ำท่วม'/'พายุ'/'แผ่นดินไหว'/'ไม่เกิดภัยธรรมชาติ')
  query: '',
  routeLayer: null,
  routeFrom: null, // {lat, lng, label}
  routeTo: null, // {lat, lng, label}
  routeMarkers: [],

  async render(app) {
    const head = UI.h('div', { className: 'page-head' },
      UI.h('div', {},
        UI.h('div', { className: 'page-title' }, UI.h('span', { className: 'pi' }, '🗺️'), 'พิกัดโรงเรียนในสังกัด'),
        UI.h('div', { className: 'page-desc' }, 'แผนที่และข้อมูลโรงเรียนในสังกัด สพป.แพร่ เขต 2')),
      Auth.isAdmin() ? UI.h('button', { className: 'btn btn-primary', onclick: () => SchoolsView.openForm() }, '+ เพิ่มโรงเรียน') : null,
    );
    app.append(head);

    // แผนที่อยู่บนสุด — หมุดรวมเป็นกลุ่มโซน เมื่อซูมเข้าแล้วค่อยแยกเป็นพิกัดรายโรงเรียน
    const mapCard = UI.h('div', { className: 'card', style: { padding: '0', overflow: 'hidden' } },
      UI.h('div', { id: 'sch-map', className: 'map-container', style: { border: 'none', borderRadius: '0', height: '480px' } }));
    app.append(mapCard);

    // การ์ดคำนวณระยะทาง (ต้นทาง → ปลายทาง ตามถนนจริง)
    const routeCard = UI.h('div', { className: 'card' },
      UI.h('div', { className: 'card-title' }, '🧭 คำนวณระยะทาง (ตามถนนจริง)'),
      UI.h('div', { className: 'form-grid', style: { marginBottom: '4px' } },
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'ต้นทาง'),
          UI.h('select', { id: 'rt-from', onchange: () => SchoolsView.routePick('from') },
            UI.h('option', { value: '' }, '— เลือกโรงเรียน —'))),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'ปลายทาง'),
          UI.h('select', { id: 'rt-to', onchange: () => SchoolsView.routePick('to') },
            UI.h('option', { value: '' }, '— เลือกโรงเรียน —'))),
      ),
      UI.h('div', { className: 'filter-row', style: { gap: '8px', flexWrap: 'wrap' } },
        UI.h('button', { className: 'btn btn-primary', onclick: () => SchoolsView.calcRoute() }, '▣ คำนวณระยะทาง'),
        UI.h('button', { className: 'btn btn-outline', onclick: () => SchoolsView.clearRoute() }, '🧹 ล้างเส้นทาง'),
        UI.h('span', { id: 'rt-result', className: 'hint', style: { fontWeight: 700, fontSize: '16px' } }),
        UI.h('span', { id: 'rt-hint', className: 'hint' }),
      ),
    );
    app.append(routeCard);

    const filterRow = UI.h('div', { className: 'filter-row' },
      UI.h('input', { id: 'sch-search', type: 'search', placeholder: '⊙ ค้นหาชื่อโรงเรียน...', style: { minWidth: '220px' }, oninput: (e) => { SchoolsView.query = e.target.value; SchoolsView.renderList(); } }),
      UI.h('select', { id: 'sch-district', onchange: (e) => { SchoolsView.districtFilter = e.target.value; SchoolsView.renderList(); } },
        UI.h('option', { value: '' }, 'ทุกอำเภอ'),
        SchoolsView.allDistricts.map((d) => UI.h('option', { value: d }, 'อำเภอ' + d))),
      UI.h('select', { id: 'sch-disaster', onchange: (e) => { SchoolsView.disasterFilter = e.target.value; SchoolsView.renderList(); SchoolsView.initMap(); SchoolsView.updateCount(); } },
        UI.h('option', { value: '' }, '⚠️ ทุกประเภทภัยธรรมชาติ'),
        UI.h('option', { value: 'น้ำท่วม' }, '🌊 น้ำท่วม'),
        UI.h('option', { value: 'พายุ' }, '💨 พายุ'),
        UI.h('option', { value: 'แผ่นดินไหว' }, '🏚️ แผ่นดินไหว'),
        UI.h('option', { value: 'ไม่เกิดภัยธรรมชาติ' }, '● ไม่เกิดภัยธรรมชาติ')),
      UI.h('span', { id: 'sch-count', className: 'hint' }),
    );
    app.append(filterRow);

    const listCard = UI.h('div', { className: 'card' }, UI.loading('กำลังโหลดโรงเรียน...'));
    SchoolsView.listCard = listCard;
    app.append(listCard);

    try {
      const data = await API.get('/schools');
      SchoolsView.schools = data.schools || [];
      SchoolsView.allDistricts = [...new Set(SchoolsView.schools.map((s) => s.district).filter(Boolean))].sort();
      const sel = document.getElementById('sch-district');
      if (sel) {
        sel.innerHTML = '';
        sel.append(UI.h('option', { value: '' }, 'ทุกอำเภอ'), ...SchoolsView.allDistricts.map((d) => UI.h('option', { value: d }, 'อำเภอ' + d)));
        sel.value = SchoolsView.districtFilter;
      }
      SchoolsView.fillRouteSelects();
      SchoolsView.renderList();
      SchoolsView.initMap();
      SchoolsView.updateCount();
    } catch (e) {
      listCard.innerHTML = '';
      listCard.append(UI.empty(e.message, '⚠️'));
    }
  },

  updateCount() {
    const el = document.getElementById('sch-count');
    if (!el) return;
    // เมื่อเลือกตัวกรองภัยธรรมชาติ → นับเฉพาะโรงเรียนที่ตรงกับประเภทที่เลือก
    const shown = SchoolsView.disasterFilter
      ? SchoolsView.schools.filter((s) => SchoolsView.matchesDisaster(s)).length
      : SchoolsView.schools.length;
    el.textContent = `${shown} แห่ง`;
  },

  /** ตรงกับตัวกรองภัยธรรมชาติหรือไม่ */
  matchesDisaster(s) {
    const f = SchoolsView.disasterFilter;
    if (!f) return true;
    const d = s.disaster || '';
    if (f === 'ไม่เกิดภัยธรรมชาติ') return d === '' || d === 'ไม่เกิดภัยธรรมชาติ';
    return d === f;
  },

  filtered() {
    const q = SchoolsView.query.trim().toLowerCase();
    return SchoolsView.schools.filter((s) => {
      if (SchoolsView.districtFilter && s.district !== SchoolsView.districtFilter) return false;
      if (!SchoolsView.matchesDisaster(s)) return false;
      if (q && !(s.name || '').toLowerCase().includes(q) && !(s.code || '').toLowerCase().includes(q)) return false;
      return true;
    });
  },

  /** ไอคอนหมุดสีส้มกะพริบ (ใช้เมื่อเลือกตัวกรองภัยธรรมชาติ) */
  orangeMarkerIcon() {
    return L.divIcon({
      className: '',
      html: '<div class="disaster-marker"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      popupAnchor: [0, -12],
    });
  },

  initMap() {
    if (SchoolsView.map) {
      SchoolsView.map.remove();
      SchoolsView.map = null;
      SchoolsView.markers = [];
    }
    const map = L.map('sch-map').setView([18.15, 100.0], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    SchoolsView.map = map;

    // หมุดรวมเป็นกลุ่มตามโซน (marker clustering) — ซูมเข้าถึงค่อยแยกเป็นพิกัดรายโรงเรียน
    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 55,
      spiderfyOnMaxZoom: true,
    });
    SchoolsView.cluster = cluster;

    const bounds = [];
    const orangeIcon = SchoolsView.disasterFilter ? SchoolsView.orangeMarkerIcon() : null;
    for (const s of SchoolsView.schools) {
      if (s.lat == null || s.lng == null) continue;
      // เมื่อเลือกตัวกรองภัยธรรมชาติ → แสดงเฉพาะโรงเรียนที่ตรงกับประเภทที่เลือก
      if (!SchoolsView.matchesDisaster(s)) continue;
      const m = L.marker([s.lat, s.lng], orangeIcon ? { icon: orangeIcon } : {});
      m.bindPopup(SchoolsView.popupHtml(s));
      cluster.addLayer(m);
      SchoolsView.markers.push(m);
      bounds.push([s.lat, s.lng]);
    }
    map.addLayer(cluster);
    if (bounds.length > 0) map.fitBounds(bounds, { padding: [40, 40] });
  },

  /** เติมรายชื่อโรงเรียนในตัวเลือกต้นทาง/ปลายทาง (ทน race condition จาก render หลายรอบ) */
  fillRouteSelects() {
    if (!SchoolsView.schools.length) return;
    const build = () => {
      const opts = SchoolsView.schools
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => UI.h('option', { value: String(s.id) }, `${s.name} (อ.${s.district || '-'})`));
      ['rt-from', 'rt-to'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el || el.options.length > 2) return; // skip if already filled
        el.innerHTML = '';
        el.append(UI.h('option', { value: '' }, '— เลือกโรงเรียน —'), ...opts);
      });
    };
    build();
    // เติมซ้ำหลัง frame ถัดไป เพื่อให้แน่ใจว่า DOM พร้อม
    requestAnimationFrame(() => build());
  },

  /** เลือกโรงเรียนจากดรอปดาวน์ — วางหมุดจุดต้นทาง/ปลายทางบนแผนที่ */
  routePick(which) {
    const sel = document.getElementById(which === 'from' ? 'rt-from' : 'rt-to');
    const id = sel.value;
    if (!id) { SchoolsView[which === 'from' ? 'routeFrom' : 'routeTo'] = null; SchoolsView.drawRouteMarkers(); return; }
    const s = SchoolsView.schools.find((x) => String(x.id) === String(id));
    if (!s) return;
    SchoolsView[which === 'from' ? 'routeFrom' : 'routeTo'] = { lat: s.lat, lng: s.lng, label: s.name };
    SchoolsView.drawRouteMarkers();
    if (SchoolsView.map) SchoolsView.map.setView([s.lat, s.lng], 13);
    SchoolsView.clearRouteLine();
    document.getElementById('rt-result').textContent = '';
    document.getElementById('rt-hint').textContent = 'พร้อมคำนวณ — กด ▣ คำนวณระยะทาง';
  },

  /** วาดหมุด ต้นทาง (เขียว) / ปลายทาง (แดง) บนแผนที่ */
  drawRouteMarkers() {
    for (const mk of SchoolsView.routeMarkers) { try { SchoolsView.map.removeLayer(mk); } catch (e) { /* ignore */ } }
    SchoolsView.routeMarkers = [];
    if (!SchoolsView.map) return;
    const mkIcon = (color, label) => L.divIcon({
      className: '',
      html: `<div style="background:${color};color:#fff;border:2px solid #fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,.4)">${label}</div>`,
      iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14],
    });
    if (SchoolsView.routeFrom) {
      const m = L.marker([SchoolsView.routeFrom.lat, SchoolsView.routeFrom.lng], { icon: mkIcon('#16a34a', 'A') }).addTo(SchoolsView.map);
      m.bindPopup(`<b>ต้นทาง:</b> ${UI.esc(SchoolsView.routeFrom.label)}`);
      SchoolsView.routeMarkers.push(m);
    }
    if (SchoolsView.routeTo) {
      const m = L.marker([SchoolsView.routeTo.lat, SchoolsView.routeTo.lng], { icon: mkIcon('#dc2626', 'B') }).addTo(SchoolsView.map);
      m.bindPopup(`<b>ปลายทาง:</b> ${UI.esc(SchoolsView.routeTo.label)}`);
      SchoolsView.routeMarkers.push(m);
    }
  },

  /** คำนวณระยะทางตามถนนจริง (OSRM route API) แล้ววาดเส้นทางบนแผนที่ */
  async calcRoute() {
    const from = SchoolsView.routeFrom, to = SchoolsView.routeTo;
    const hintEl = document.getElementById('rt-hint');
    const resEl = document.getElementById('rt-result');
    if (!from || !to) { UI.toast('กรุณาเลือกทั้งต้นทางและปลายทาง', 'error'); return; }
    if (from.lat === to.lat && from.lng === to.lng) { UI.toast('ต้นทางและปลายทางต้องไม่ใช่ที่เดียวกัน', 'error'); return; }
    resEl.textContent = '◷ กำลังคำนวณ...';
    hintEl.textContent = '';
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
      const r = await fetch(url);
      if (!r.ok) throw new Error('เซิร์ฟเวอร์เส้นทางไม่ตอบสนอง');
      const data = await r.json();
      if (data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error('ไม่พบเส้นทางระหว่างจุดสองจุดนี้');
      const route = data.routes[0];
      const km = (route.distance / 1000).toFixed(2);
      const mins = Math.round(route.duration / 60);
      SchoolsView.clearRouteLine();
      SchoolsView.routeLayer = L.geoJSON(route.geometry, {
        style: { color: '#2563eb', weight: 6, opacity: 0.85 },
      }).addTo(SchoolsView.map);
      SchoolsView.map.fitBounds(SchoolsView.routeLayer.getBounds(), { padding: [60, 60] });
      resEl.textContent = `▣ ${km} กม. (ประมาณ ${mins} นาที)`;
      hintEl.textContent = `เส้นทางจาก ${from.label} → ${to.label} ตามถนนจริง`;
      UI.toast(`ระยะทาง ${km} กม.`);
    } catch (e) {
      resEl.textContent = '';
      hintEl.textContent = '';
      UI.toast(e.message, 'error');
    }
  },

  clearRouteLine() {
    if (SchoolsView.routeLayer) { try { SchoolsView.map.removeLayer(SchoolsView.routeLayer); } catch (e) { /* ignore */ } SchoolsView.routeLayer = null; }
  },

  clearRoute() {
    SchoolsView.routeFrom = null;
    SchoolsView.routeTo = null;
    for (const id of ['rt-from', 'rt-to']) { const el = document.getElementById(id); if (el) el.value = ''; }
    SchoolsView.drawRouteMarkers();
    SchoolsView.clearRouteLine();
    const resEl = document.getElementById('rt-result');
    const hintEl = document.getElementById('rt-hint');
    if (resEl) resEl.textContent = '';
    if (hintEl) hintEl.textContent = '';
  },

  /** แสดงภัยธรรมชาติเป็นป้ายเล็ก ๆ ('' / 'ไม่เกิดภัยธรรมชาติ' → ไม่แสดง) */
  disasterTag(s) {
    const d = s.disaster || '';
    if (!d || d === 'ไม่เกิดภัยธรรมชาติ') return null;
    const icons = { 'น้ำท่วม': '🌊', 'พายุ': '💨', 'แผ่นดินไหว': '🏚️' };
    return UI.h('span', { className: 'disaster-tag', title: 'ภัยธรรมชาติ: ' + d }, `${icons[d] || '⚠️'} ${d}`);
  },

  popupHtml(s) {
    const d = s.disaster || '';
    const dTag = d && d !== 'ไม่เกิดภัยธรรมชาติ'
      ? `<span style="display:inline-block;padding:2px 9px;border-radius:999px;background:#fff7ed;color:#c2410c;border:1px solid #fdba74;font-size:11.5px;font-weight:700;margin-top:4px">${s.disaster === 'น้ำท่วม' ? '🌊' : s.disaster === 'พายุ' ? '💨' : s.disaster === 'แผ่นดินไหว' ? '🏚️' : '⚠️'} ${UI.esc(d)}</span>`
      : '';
    const html = `<div style="min-width:180px">
      <b>${UI.esc(s.name)}</b><br>
      <span style="color:#64748b">${UI.esc(s.district ? 'อำเภอ' + s.district : '')}${s.code ? ' • รหัส ' + UI.esc(s.code) : ''}</span><br>
      ${s.address ? UI.esc(s.address) + '<br>' : ''}
      ${s.principal ? '👤 ' + UI.esc(s.principal) + '<br>' : ''}
      ${s.phone ? '📞 ' + UI.esc(s.phone) + '<br>' : ''}
      ${s.level ? '🎓 ' + UI.esc(s.level) : ''}
      ${dTag}
      ${s.disaster_image ? '<div style="margin-top:6px"><img src="/uploads/' + s.disaster_image + '" alt="รูปความเสียหาย" style="width:100%;max-width:220px;max-height:150px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;cursor:pointer" onclick="window.open(this.src,&#39;_blank&#39;)" title="คลิกเพื่อดูรูปเต็ม"></div>' : ''}
    </div>`;
    return html;
  },

  renderList() {
    const card = SchoolsView.listCard;
    const filtered = SchoolsView.filtered();
    if (card) {
      card.innerHTML = '';
      card.append(UI.h('div', { className: 'card-title' }, `🏫 รายชื่อโรงเรียนในสังกัด (${filtered.length} แห่ง)`));
    }
    if (filtered.length === 0) {
      card.append(UI.empty('ไม่พบโรงเรียน', '⊙'));
      return;
    }
    const list = UI.h('div', { style: { display: 'grid', gap: '8px' } });
    for (const s of filtered) {
      const item = UI.h('div', {
        className: 'card',
        style: { padding: '12px 16px', marginBottom: '0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
        onclick: () => {
          if (s.lat != null && s.lng != null && SchoolsView.map) {
            const mk = SchoolsView.markers.find((m) => m.getLatLng().lat === s.lat && m.getLatLng().lng === s.lng);
            if (!mk) return;
            // ซูมไปที่หมุดนั้น (ผ่าน cluster) แล้วเปิดป้ายข้อมูล
            if (SchoolsView.cluster) SchoolsView.cluster.zoomToShowLayer(mk, () => mk.openPopup());
            else { SchoolsView.map.setView([s.lat, s.lng], 14); mk.openPopup(); }
          }
        },
      },
      UI.h('div', {},
        UI.h('div', { style: { fontWeight: 700 } }, `${s.name} ${s.code ? '(' + s.code + ')' : ''}`, SchoolsView.disasterTag(s)),
        UI.h('div', { className: 'hint' }, `${s.district ? 'อำเภอ' + s.district : ''}${s.address ? ' • ' + s.address : ''}${s.level ? ' • ' + s.level : ''}`)),
        Auth.isAdmin() ? UI.h('div', { className: 'status-btns', onclick: (e) => e.stopPropagation() },
          UI.h('button', { className: 'btn btn-xs btn-outline', onclick: () => SchoolsView.openForm(s) }, '✎'),
          UI.h('button', { className: 'btn btn-xs btn-outline danger-btn', onclick: () => SchoolsView.remove(s) }, '✕')) : null,
      );
      list.append(item);
    }
    card.append(list);
  },

  async remove(s) {
    const ok = await UI.confirm(`ต้องการลบโรงเรียน "${s.name}" ใช่หรือไม่?`, { danger: true, okText: 'ลบ' });
    if (!ok) return;
    try {
      const res = await API.del('/schools/' + s.id);
      UI.toast(res.message);
      SchoolsView.schools = SchoolsView.schools.filter((x) => x.id !== s.id);
      SchoolsView.renderList();
      SchoolsView.initMap();
      SchoolsView.updateCount();
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  openForm(school) {
    const s = school || {};
    let lat = s.lat, lng = s.lng;
    const body = UI.h('div', {},
      UI.h('div', { className: 'form-grid' },
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'รหัสโรงเรียน (SMIS)'),
          UI.h('input', { id: 'f-code', value: s.code || '', placeholder: 'เช่น 10130101' })),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'ชื่อโรงเรียน', UI.h('span', { className: 'req' }, ' *')),
          UI.h('input', { id: 'f-name', value: s.name || '', placeholder: 'เช่น โรงเรียนบ้านดอนมูล' })),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'อำเภอ'),
          UI.h('select', { id: 'f-district' },
            [''].concat(SchoolsView.allDistricts).map((d) => UI.h('option', { value: d, selected: s.district === d }, d ? 'อำเภอ' + d : '— ไม่ระบุ —')))),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'ระดับชั้นที่เปิดสอน'),
          UI.h('input', { id: 'f-level', value: s.level || '', placeholder: 'เช่น อนุบาล - ป.6' })),
        UI.h('div', { className: 'form-group full' },
          UI.h('label', {}, 'ที่อยู่'),
          UI.h('input', { id: 'f-address', value: s.address || '', placeholder: 'เช่น ต.เด่นชัย อ.เด่นชัย จ.แพร่' })),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'ผู้อำนวยการโรงเรียน'),
          UI.h('input', { id: 'f-principal', value: s.principal || '' })),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'เบอร์โทรศัพท์'),
          UI.h('input', { id: 'f-phone', value: s.phone || '' })),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'ละติจูด (Latitude)'),
          UI.h('input', { id: 'f-lat', type: 'number', step: 'any', value: lat != null ? lat : '', oninput: (e) => { lat = parseFloat(e.target.value); SchoolsView.pickMap.setView([lat || 18.15, lng || 100.0], 13); SchoolsView.pickMarker.setLatLng([lat || 18.15, lng || 100.0]); } })),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'ลองจิจูด (Longitude)'),
          UI.h('input', { id: 'f-lng', type: 'number', step: 'any', value: lng != null ? lng : '', oninput: (e) => { lng = parseFloat(e.target.value); SchoolsView.pickMap.setView([lat || 18.15, lng || 100.0], 13); SchoolsView.pickMarker.setLatLng([lat || 18.15, lng || 100.0]); } })),
        UI.h('div', { className: 'form-group full' },
          UI.h('label', {}, 'หมายเหตุ'),
          UI.h('input', { id: 'f-notes', value: s.notes || '' })),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, '⚠️ ภัยธรรมชาติ'),
          UI.h('select', { id: 'f-disaster' },
            UI.h('option', { value: '', selected: !s.disaster || s.disaster === 'ไม่เกิดภัยธรรมชาติ' }, 'ไม่เกิดภัยธรรมชาติ'),
            UI.h('option', { value: 'น้ำท่วม', selected: s.disaster === 'น้ำท่วม' }, '🌊 น้ำท่วม'),
            UI.h('option', { value: 'พายุ', selected: s.disaster === 'พายุ' }, '💨 พายุ'),
            UI.h('option', { value: 'แผ่นดินไหว', selected: s.disaster === 'แผ่นดินไหว' }, '🏚️ แผ่นดินไหว'))),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, '📷 รูปภาพความเสียหายจากภัยธรรมชาติ'),
          UI.h('input', { id: 'f-disaster-image', type: 'file', accept: 'image/*', style: { padding: '6px 0' } }),
          s.disaster_image ? UI.h('div', { style: { marginTop: '6px' } },
            UI.h('img', { src: '/uploads/' + s.disaster_image, alt: 'รูปความเสียหาย', style: { maxWidth: '100%', maxHeight: '160px', borderRadius: '8px', border: '1px solid #e2e8f0' } }),
            UI.h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px', fontSize: '13px', color: '#64748b' } },
              UI.h('input', { id: 'f-disaster-image-clear', type: 'checkbox' }), 'ลบรูปภาพนี้')) : null),
        UI.h('div', { className: 'form-group full' },
          UI.h('label', {}, 'ตำแหน่งบนแผนที่ (คลิกบนแผนที่เพื่อกำหนดพิกัด)'),
          UI.h('div', { id: 'pick-map', className: 'map-container', style: { height: '260px' } })),
      ),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { className: 'btn btn-primary', onclick: save }, '▽ บันทึก'));
    const m = UI.modal({ title: school ? '✎ แก้ไขโรงเรียน' : '+ เพิ่มโรงเรียน', body, footer: foot, size: 'lg' });

    // แผนที่เลือกพิกัด
    const pickMap = L.map('pick-map').setView([lat || 18.15, lng || 100.0], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(pickMap);
    const pickMarker = L.marker([lat || 18.15, lng || 100.0]).addTo(pickMap);
    pickMap.on('click', (e) => {
      lat = e.latlng.lat; lng = e.latlng.lng;
      pickMarker.setLatLng(e.latlng);
      document.getElementById('f-lat').value = lat.toFixed(6);
      document.getElementById('f-lng').value = lng.toFixed(6);
    });
    SchoolsView.pickMap = pickMap;
    SchoolsView.pickMarker = pickMarker;
    m.close = (() => { const orig = m.close; return () => { try { pickMap.remove(); } catch (e) { /* ignore */ } orig(); }; })();

    async function save() {
      const name = document.getElementById('f-name').value.trim();
      if (!name) return UI.toast('กรุณากรอกชื่อโรงเรียน', 'error');
      // ส่งแบบ multipart/form-data (รองรับรูปภาพความเสียหายจากภัยธรรมชาติ)
      const fd = new FormData();
      fd.append('code', document.getElementById('f-code').value.trim());
      fd.append('name', name);
      fd.append('district', document.getElementById('f-district').value);
      fd.append('level', document.getElementById('f-level').value.trim());
      fd.append('address', document.getElementById('f-address').value.trim());
      fd.append('principal', document.getElementById('f-principal').value.trim());
      fd.append('phone', document.getElementById('f-phone').value.trim());
      fd.append('lat', lat != null ? lat : '');
      fd.append('lng', lng != null ? lng : '');
      fd.append('notes', document.getElementById('f-notes').value.trim());
      fd.append('disaster', document.getElementById('f-disaster').value);
      const fileInput = document.getElementById('f-disaster-image');
      if (fileInput && fileInput.files.length) fd.append('disaster_image', fileInput.files[0]);
      const clearChk = document.getElementById('f-disaster-image-clear');
      if (clearChk && clearChk.checked) fd.append('disaster_image_clear', '1');
      try {
        const res = school
          ? await API.putForm('/schools/' + school.id, fd)
          : await API.postForm('/schools', fd);
        UI.toast(res.message);
        m.close();
        render();
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },
};
