'use strict';
/* จัดการ session ฝั่ง client: สถานะผู้ใช้, ปุ่ม login/register, modal ต่าง ๆ */

const Auth = {
  user: null,

  async init() {
    try {
      const data = await API.get('/auth/me');
      Auth.user = data.user;
    } catch (e) { /* ยังไม่เข้าสู่ระบบ */ }
    Auth.renderTopbar();
  },

  isLoggedIn() { return !!Auth.user && Auth.user.status === 'active'; },
  isAdmin() { return Auth.isLoggedIn() && Auth.user.role === 'admin'; },

  avatar(user) {
    const u = user || Auth.user;
    if (!u) return null;
    if (u.photo) {
      return UI.h('img', { className: 'user-avatar', src: '/uploads/' + encodeURIComponent(u.photo), alt: u.full_name });
    }
    const initial = (u.full_name || u.username || '?').trim().charAt(0);
    return UI.h('div', { className: 'user-avatar' }, initial);
  },

  renderTopbar() {
    const box = document.getElementById('topbar-right');
    box.innerHTML = '';
    if (!Auth.isLoggedIn()) {
      box.append(
        UI.h('button', { className: 'btn btn-white', onclick: () => Auth.openLogin() }, '🔑 เข้าสู่ระบบ'),
        UI.h('button', { className: 'btn btn-accent', onclick: () => Auth.openRegister() }, '📝 ลงทะเบียน'),
      );
      return;
    }
    const u = Auth.user;
    const chip = UI.h('div', { className: 'user-chip', style: { cursor: 'pointer' }, onclick: () => Auth.openProfile() },
      Auth.avatar(u),
      UI.h('div', {},
        UI.h('div', { className: 'user-name' }, u.full_name),
        UI.h('div', { className: 'user-role' },
          u.user_group === 'school'
            ? (u.current_school || u.workplace || '') + (u.position ? ' • ' + u.position : '')
            : (u.role_label || (u.role === 'admin' ? 'ผู้ดูแลระบบ' : 'สมาชิก')) + (u.position ? ' • ' + u.position : ''))),
      );
    box.append(
      chip,
      ...(Auth.isMultiSchool() ? [UI.h('button', {
        className: 'btn btn-white btn-sm',
        title: 'สลับสถานศึกษา',
        style: { marginRight: '6px' },
        onclick: () => Auth.openSwitchSchool(),
      }, '🔄 สลับสถานศึกษา')] : []),
      UI.h('button', {
        className: 'btn btn-white btn-sm',
        title: 'ออกจากระบบ',
        onclick: () => Auth.logout(),
      }, '⎋ ออกจากระบบ'),
    );
  },

  onSessionExpired() {
    Auth.user = null;
    Auth.renderTopbar();
    setTimeout(() => Auth.openLogin(), 250);
  },

  showSchoolSelect(schools) {
    const body = UI.h('div', { style: { textAlign: 'center', padding: '10px 0' } },
      UI.h('div', { style: { fontSize: '16px', marginBottom: '15px', color: '#374151' } }, '⊕ กรุณาเลือกสถานศึกษาที่ต้องการเข้าใช้งาน'),
      ...schools.map((s, idx) => UI.h('button', {
        className: 'btn btn-primary',
        style: { width: '100%', marginBottom: '10px', textAlign: 'left', padding: '12px 16px', fontSize: '15px' },
        onclick: async () => {
          Auth.user.current_school = s;
          Auth.user.school_code = (s.split(' ')[0] || '').trim();
          Auth.renderTopbar();
          try { await API.post('/auth/select-school', { school: s }); } catch (_e) {}
          m.close();
          if (location.hash === '' || location.hash === '#/' || location.hash === '#') {
            if (typeof render === 'function') render();
          } else {
            location.hash = '#/';
          }
          UI.toast(`ยินดีต้อนรับคุณ ${Auth.user.full_name} — ${s}`);
        }
      }, `${idx + 1}. ${s}`))
    );
    const m = UI.modal({ title: '⊕ เลือกสถานศึกษา', body, size: 'sm' });
  },

  async logout() {
    const ok = await UI.confirm('ต้องการออกจากระบบ ใช่หรือไม่?', { okText: 'ออกจากระบบ', danger: true });
    if (!ok) return;
    try { await API.post('/auth/logout'); } catch (e) { /* ignore */ }
    Auth.user = null;
    if (window.__SIM_DATE) window.__SIM_DATE.refresh(); // ออกจากระบบแล้วไม่ต้อง patch วันที่จำลองต่อ
    Auth.renderTopbar();
    if (location.hash === '' || location.hash === '#/' || location.hash === '#') {
      if (typeof render === 'function') render();
    } else {
      location.hash = '#/';
    }
    UI.toast('ออกจากระบบเรียบร้อย');
  },

  openLogin() {
    const body = UI.h('div', {},
      UI.h('div', { style: { textAlign: 'center', marginBottom: '14px' } },
        UI.h('img', { className: 'modal-logo', src: 'logo.png', alt: 'สพป.แพร่ เขต 2' })),
      UI.h('div', { className: 'form-grid' },
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'ชื่อผู้ใช้ (Username)'),
        UI.h('input', { id: 'login-user', type: 'text', placeholder: 'กรอกชื่อผู้ใช้', autocomplete: 'username', onkeydown: enterSubmit })),
      UI.h('div', { className: 'form-group full' },
        UI.h('label', {}, 'รหัสผ่าน'),
        UI.h('input', { id: 'login-pass', type: 'password', placeholder: 'กรอกรหัสผ่าน', autocomplete: 'current-password', onkeydown: enterSubmit })),
      UI.h('div', { className: 'hint full', style: { gridColumn: '1 / -1', textAlign: 'center' } },
        'ยังไม่มีบัญชี? ',
        UI.h('a', { href: '#', onclick: (e) => { e.preventDefault(); m.close(); Auth.openRegister(); } }, 'ลงทะเบียนสมาชิก')),
      ),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { id: 'login-submit', className: 'btn btn-primary', onclick: doLogin }, 'เข้าสู่ระบบ'));

    const m = UI.modal({ title: '🔑 เข้าสู่ระบบ', body, footer: foot });
    setTimeout(() => document.getElementById('login-user').focus(), 50);

    function enterSubmit(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        doLogin();
      }
    }

    async function doLogin() {
      const btn = document.getElementById('login-submit');
      const user = document.getElementById('login-user').value.trim();
      const pass = document.getElementById('login-pass').value;
      if (!user || !pass) return UI.toast('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน', 'error');
      btn.disabled = true; btn.textContent = 'กำลังตรวจสอบ...';
      try {
        const data = await API.post('/auth/login', { username: user, password: pass });
        Auth.user = data.user;
        Auth.renderTopbar();
        m.close();
        // ถ้าเป็นเจ้าหน้าที่สถานศึกษาที่มีหลายแห่ง ให้แสดงหน้าเลือกสถานศึกษา
        if (data.user.user_group === 'school') {
          let allSchools = [];
          if (data.user.workplace) allSchools.push(data.user.workplace);
          try {
            const extra = JSON.parse(data.user.workplace_secondary || '[]');
            allSchools = allSchools.concat(extra);
          } catch (_e) {}
          allSchools = allSchools.filter(s => s && s.trim());
          if (allSchools.length > 1) {
            Auth.showSchoolSelect(allSchools);
            return;
          } else if (allSchools.length === 1) {
            Auth.user.current_school = allSchools[0];
            Auth.user.school_code = (allSchools[0].split(' ')[0] || '').trim();
          }
        }
        // ถ้าอยู่หน้าแรกอยู่แล้ว (hash ไม่เปลี่ยน) ให้ render เอง ไม่เช่นนั้น hashchange จะ render ให้
        if (location.hash === '' || location.hash === '#/' || location.hash === '#') {
          if (typeof render === 'function') render();
        } else {
          location.hash = '#/';
        }
        if (window.__SIM_DATE) window.__SIM_DATE.refresh(); // ดึงวันที่จำลอง (ถ้าเปิดใช้) มาใช้กับฟอร์ม/ปฏิทินทันที
        UI.toast(`ยินดีต้อนรับคุณ ${data.user.full_name}`);
      } catch (e) {
        UI.toast(e.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
      }
    }
  },

  openRegister() {
    // แสดงหน้าเลือกประเภทลงทะเบียนก่อน
    const selectBody = UI.h('div', { style: { textAlign: 'center', padding: '20px 0' } },
      UI.h('div', { style: { textAlign: 'center', marginBottom: '16px' } },
        UI.h('img', { className: 'modal-logo', src: 'logo.png', alt: 'สพป.แพร่ เขต 2' })),
      UI.h('div', { style: { fontSize: '18px', fontWeight: 'bold', marginBottom: '24px' } }, 'เลือกประเภทการลงทะเบียน'),
      UI.h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' } },
        UI.h('button', { className: 'btn btn-primary', style: { width: '320px', padding: '14px 20px', fontSize: '16px' },
          onclick: () => { m.close(); Auth.openRegisterForm('office'); } }, '⬡ ลงทะเบียนเจ้าหน้าที่ สพป.แพร่ เขต 2'),
        UI.h('button', { className: 'btn btn-accent', style: { width: '320px', padding: '14px 20px', fontSize: '16px' },
          onclick: () => { m.close(); Auth.openRegisterForm('school'); } }, '⊕ ลงทะเบียนเจ้าหน้าที่สถานศึกษา'),
      ),
    );
    const m = UI.modal({ title: '📝 ลงทะเบียนสมาชิกใหม่', body: selectBody });
  },

  openRegisterForm(userGroup) {
    const body = UI.h('div', {},
      UI.h('div', { style: { textAlign: 'center', marginBottom: '10px' } },
        UI.h('img', { className: 'modal-logo', src: 'logo.png', alt: 'สพป.แพร่ เขต 2' })),
      UI.h('div', { style: { textAlign: 'center', marginBottom: '16px', fontSize: '15px', color: 'var(--primary)' } },
        userGroup === 'school' ? '⊕ ลงทะเบียนเจ้าหน้าที่สถานศึกษา' : '⬡ ลงทะเบียนเจ้าหน้าที่ สพป.แพร่ เขต 2'),
      // ---- ข้อมูลส่วนตัว (เลขบัตรประชาชนขึ้นก่อน) ----
      UI.h('div', { className: 'card-title' }, '📇 ข้อมูลส่วนตัว'),
      UI.h('div', { className: 'form-grid' },
        UI.h('div', { className: 'form-group full' },
          UI.h('label', {}, 'เลขบัตรประชาชน 13 หลัก', UI.h('span', { className: 'req' }, ' *')),
          UI.h('input', { name: 'citizen_id', id: 'reg-cid', type: 'text', inputmode: 'numeric', maxlength: '13', placeholder: 'เช่น 1579900123456' }),
          UI.h('div', { className: 'hint', id: 'reg-cid-hint' }, 'ใช้เป็นรหัสอ้างอิงตัวตนในระบบ รวมถึงรูปถ่ายและลายเซ็น')),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'คำนำหน้า', UI.h('span', { className: 'req' }, ' *')),
          UI.h('select', { name: 'title' }, CONSTANTS.selectOptions(CONSTANTS.TITLES))),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'ชื่อ', UI.h('span', { className: 'req' }, ' *')),
          UI.h('input', { name: 'first_name', type: 'text', placeholder: 'เช่น สมชาย' })),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'นามสกุล', UI.h('span', { className: 'req' }, ' *')),
          UI.h('input', { name: 'last_name', type: 'text', placeholder: 'เช่น ใจดี' })),
        UI.h('div', { className: 'form-group full' },
          UI.h('label', {}, 'ตำแหน่ง', UI.h('span', { className: 'req' }, ' *')),
          UI.h('select', { name: 'position', id: 'reg-position' }, CONSTANTS.selectOptions(userGroup === 'school' ? CONSTANTS.SCHOOL_POSITIONS : CONSTANTS.POSITIONS))),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'วิทยฐานะ / ระดับ'),
          UI.h('select', { name: 'academic_rank', id: 'reg-rank' }, CONSTANTS.selectOptions(userGroup === 'school' ? CONSTANTS.SCHOOL_ACADEMIC_RANKS : CONSTANTS.ACADEMIC_RANKS, 'ไม่มี'))),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, userGroup === 'school' ? 'สถานศึกษา' : 'สังกัด / กลุ่มงาน', UI.h('span', { className: 'req' }, ' *')),
          UI.h('select', { name: 'workplace', id: 'reg-workplace' }, [])),
        userGroup === 'school' ? UI.h('div', { className: 'form-group full', id: 'reg-multi-school-wrap', style: { display: 'none' } },
          UI.h('button', { type: 'button', className: 'btn btn-sm btn-outline', style: { fontSize: '13px' }, onclick: () => {
            const wrap = document.getElementById('reg-multi-school-wrap');
            const container = document.getElementById('reg-multi-schools');
            if (wrap.style.display === 'none') {
              wrap.style.display = 'block';
            }
            const idx = container.children.length;
            if (idx >= 5) return;
            const row = UI.h('div', { className: 'form-group', style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' } },
              UI.h('span', { style: { fontSize: '14px', minWidth: '20px' } }, String(idx + 1) + '.'),
              UI.h('select', { id: 'reg-workplace-' + idx, style: { flex: 1 } }, []),
              UI.h('button', { type: 'button', className: 'btn btn-sm', style: { color: '#e53e3e', background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }, onclick: (e) => { e.target.closest('div.form-group').remove(); } }, '✕'));
            container.append(row);
            // Load schools into the new select
            (async () => {
              try {
                const data = await API.get('/schools');
                const schools = (data.schools || []).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                const sel = document.getElementById('reg-workplace-' + idx);
                if (sel) {
                  sel.innerHTML = '';
                  sel.append(UI.h('option', { value: '' }, '-- เลือกสถานศึกษาเพิ่มเติม --'));
                  schools.forEach(s => {
                    const label = s.code ? s.code + ' ' + s.name : s.name;
                    sel.append(UI.h('option', { value: label }, label));
                  });
                }
              } catch (_e) {}
            })();
          } }, '📍 ปฏิบัติงานหลายแห่ง'),
          UI.h('div', { id: 'reg-multi-schools', style: { marginTop: '8px' } })) : null,
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'ชื่อเล่น'),
          UI.h('input', { name: 'nickname', type: 'text', placeholder: 'เช่น บอล' })),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'กรุ๊ปเลือด'),
          UI.h('select', { name: 'blood_type' }, CONSTANTS.selectOptions(CONSTANTS.BLOOD_TYPES, 'ไม่ทราบ'))),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'วุฒิการศึกษาสูงสุด'),
          UI.h('input', { name: 'highest_education', type: 'text', placeholder: 'เช่น ปริญญาโท ครุศาสตรมหาบัณฑิต' })),
        UI.h('div', { className: 'form-group full' },
          UI.h('label', {}, 'วัน/เดือน/ปี เกิด (พ.ศ.)'),
          UI.thaiBirthPicker('reg-birth'),
          UI.h('div', { className: 'hint' }, 'เลือกวัน เดือน และปี พ.ศ. เกิด')),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'อายุ (ปี)'),
          UI.h('input', { name: 'age', id: 'reg-age', type: 'text', readonly: true, placeholder: 'คำนวณจากวันเกิด' })),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'เบอร์โทรศัพท์'),
          UI.h('input', { name: 'phone', type: 'tel', placeholder: 'เช่น 081-2345678' })),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'อีเมล'),
          UI.h('input', { name: 'email', type: 'email', placeholder: 'เช่น name@example.com' }))),

      // ---- Telegram Bot ----
      UI.h('div', { className: 'card-title', style: { marginTop: '18px' } }, '🤖 การแจ้งเตือนผ่าน Telegram Bot'),
      UI.h('div', { className: 'form-grid' },
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'Token Key'),
          UI.h('input', { name: 'telegram_token', type: 'text', placeholder: 'เช่น 123456789:ABCdef...' }),
          UI.h('div', { className: 'hint' }, 'ได้รับจาก @BotFather บน Telegram')),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'Chat ID'),
          UI.h('input', { name: 'telegram_chat_id', type: 'text', placeholder: 'เช่น 123456789' }),
          UI.h('div', { className: 'hint' }, 'สำหรับรับการแจ้งเตือนสถานะคำขอของคุณ'))),

      // ---- บัญชีผู้ใช้ ----
      UI.h('div', { className: 'card-title', style: { marginTop: '18px' } }, '🔐 บัญชีผู้ใช้'),
      UI.h('div', { className: 'form-grid' },
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'ชื่อผู้ใช้ (Username)', UI.h('span', { className: 'req' }, ' *')),
          UI.h('input', { name: 'username', type: 'text', placeholder: 'ตัวอักษร/ตัวเลข 3-30 ตัว' })),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'รหัสผ่าน', UI.h('span', { className: 'req' }, ' *')),
          UI.h('input', { name: 'password', id: 'reg-pass', type: 'password', placeholder: 'อย่างน้อย 8 ตัวอักษร' }),
          UI.h('div', { className: 'hint', id: 'reg-pass-hint' }, 'ต้องมีตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก ตัวเลข และอักขระพิเศษ')),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'ยืนยันรหัสผ่าน', UI.h('span', { className: 'req' }, ' *')),
          UI.h('input', { name: 'confirm_password', id: 'reg-pass2', type: 'password' }))),

      // ---- รูปถ่ายและลายเซ็น (อัปโหลดภาพเท่านั้น) ----
      UI.h('div', { className: 'card-title', style: { marginTop: '18px' } }, '🖼️ รูปถ่ายและลายเซ็น'),
      UI.h('div', { className: 'form-grid' },
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'รูปถ่าย (ไฟล์ภาพ)', UI.h('span', { className: 'req' }, ' *')),
          UI.h('input', { name: 'photo', id: 'reg-photo', type: 'file', accept: 'image/*' }),
          UI.h('div', { className: 'file-preview' })),
        UI.h('div', { className: 'form-group' },
          UI.h('label', {}, 'ลายเซ็น (อัปโหลดภาพ)', UI.h('span', { className: 'req' }, ' *')),
          UI.h('input', { name: 'signature', id: 'reg-sig-file', type: 'file', accept: 'image/*' }),
          UI.h('div', { className: 'file-preview' }))),

      UI.h('div', { className: 'hint', style: { marginTop: '14px', textAlign: 'center' } },
        'รูปถ่ายและลายเซ็นจะถูกเก็บอ้างอิงตามเลขบัตรประชาชน 13 หลัก — หลังส่งใบสมัครแล้ว กรุณารอผู้ดูแลระบบอนุมัติ ถึงจะสามารถเข้าสู่ระบบได้'),
    );
    const foot = UI.h('div', {},
      UI.h('button', { className: 'btn btn-outline', onclick: () => m.close() }, 'ยกเลิก'),
      UI.h('button', { id: 'reg-submit', className: 'btn btn-accent', onclick: doRegister }, 'ส่งใบสมัคร'));

    const m = UI.modal({ title: '📝 ลงทะเบียนสมาชิกใหม่' + (userGroup === 'school' ? ' (เจ้าหน้าที่สถานศึกษา)' : ''), body, footer: foot, size: 'lg' });

    // โหลดรายชื่อโรงเรียนสำหรับเจ้าหน้าที่สถานศึกษา
    if (userGroup === 'school') {
      (async () => {
        try {
          const data = await API.get('/schools');
          const schools = (data.schools || []).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
          const sel = document.getElementById('reg-workplace');
          if (sel) {
            sel.innerHTML = '';
            sel.append(UI.h('option', { value: '' }, '-- เลือกสถานศึกษา --'));
            schools.forEach(s => {
              const label = s.code ? s.code + ' ' + s.name : s.name;
              sel.append(UI.h('option', { value: label }, label));
            });
          }
        } catch (e) { /* ignore */ }
      })();
    } else {
      // สำหรับเจ้าหน้าที่ สพป. ใช้ WORKPLACES ปกติ
      const sel = document.getElementById('reg-workplace');
      if (sel) {
        sel.innerHTML = '';
        CONSTANTS.WORKPLACES.forEach(name => sel.append(UI.h('option', { value: name }, name)));
      }
    }

    // ตรวจสอบเลขบัตรประชาชนแบบ realtime
    document.getElementById('reg-cid').addEventListener('input', () => {
      const v = document.getElementById('reg-cid').value.replace(/\D/g, '');
      document.getElementById('reg-cid').value = v;
      const hint = document.getElementById('reg-cid-hint');
      if (v.length === 13) {
        hint.textContent = UI.citizenIdValid(v) ? '✅ เลขบัตรประชาชนถูกต้อง' : '❌ เลขบัตรประชาชนไม่ถูกต้อง';
        hint.style.color = UI.citizenIdValid(v) ? '#16a34a' : '#dc2626';
      } else {
        hint.textContent = 'ใช้เป็นรหัสอ้างอิงตัวตนในระบบ (13 หลัก)';
        hint.style.color = '';
      }
    });

    // คำนวณอายุจากวันเกิดแบบ realtime (เลือก วัน/เดือน/ปี พ.ศ.)
    const calcAge = () => {
      const v = UI.readThaiBirth('reg-birth');
      const ageEl = document.getElementById('reg-age');
      if (!v) { ageEl.value = ''; return; }
      const bd = new Date(v + 'T00:00:00');
      if (isNaN(bd) || bd > new Date()) { ageEl.value = 'ไม่ถูกต้อง'; return; }
      ageEl.value = UI.ageFromBirth(v);
    };
    for (const id of ['reg-birth-day', 'reg-birth-month', 'reg-birth-year']) {
      document.getElementById(id).addEventListener('change', calcAge);
    }

    // ตรวจสอบความแข็งแรงของรหัสผ่าน
    const passHints = [
      [/^.{8,}$/, 'อย่างน้อย 8 ตัวอักษร'],
      [/[A-Z]/, 'ตัวพิมพ์ใหญ่'],
      [/[a-z]/, 'ตัวพิมพ์เล็ก'],
      [/\d/, 'ตัวเลข'],
      [/[^A-Za-z0-9]/, 'อักขระพิเศษ'],
    ];
    document.getElementById('reg-pass').addEventListener('input', () => {
      const v = document.getElementById('reg-pass').value;
      const missing = passHints.filter(([re]) => !re.test(v)).map(([, t]) => t);
      const hint = document.getElementById('reg-pass-hint');
      if (v && missing.length === 0) { hint.textContent = '✅ รหัสผ่านผ่านเกณฑ์แล้ว'; hint.style.color = '#16a34a'; }
      else if (v) { hint.textContent = 'ยังขาด: ' + missing.join(', '); hint.style.color = '#d97706'; }
      else { hint.textContent = 'ต้องมีตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก ตัวเลข และอักขระพิเศษ'; hint.style.color = ''; }
    });

    // รูปถ่ายและลายเซ็น preview
    for (const id of ['reg-photo', 'reg-sig-file']) {
      document.getElementById(id).addEventListener('change', (e) => {
        const box = e.target.parentElement.querySelector('.file-preview');
        box.innerHTML = '';
        if (e.target.files[0]) box.append(UI.h('img', { src: URL.createObjectURL(e.target.files[0]), alt: 'preview' }));
      });
    }

    async function doRegister() {
      const btn = document.getElementById('reg-submit');
      const form = new FormData();
      // อ่านค่าจาก inputs ใน modal body
      const get = (name) => (document.querySelector(`#modal-root [name="${name}"]`) || {}).value || '';
      const data = {
        citizen_id: get('citizen_id'), title: get('title'), first_name: get('first_name'), last_name: get('last_name'),
        position: get('position'), academic_rank: get('academic_rank'), workplace: get('workplace'),
        nickname: get('nickname'), blood_type: get('blood_type'), highest_education: get('highest_education'),
        birth_date: UI.readThaiBirth('reg-birth'), phone: get('phone'), email: get('email'),
        telegram_token: get('telegram_token'), telegram_chat_id: get('telegram_chat_id'),
        username: get('username'), password: get('password'), confirm_password: get('confirm_password'),
        user_group: userGroup,
      };
      // เก็บสถานศึกษาเพิ่มเติม (ถ้ามี)
      if (userGroup === 'school') {
        const extraSchools = [];
        for (let i = 0; i < 5; i++) {
          const el = document.getElementById('reg-workplace-' + i);
          if (el && el.value) extraSchools.push(el.value);
        }
        data.workplace_secondary = JSON.stringify(extraSchools);
      }
      const citizenOk = UI.citizenIdValid(data.citizen_id || '');
      if (!data.citizen_id || !data.first_name || !data.last_name || !data.position || !data.workplace || !data.username || !data.password) {
        return UI.toast('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน (เลขบัตร ชื่อ นามสกุล ตำแหน่ง กลุ่มงาน ชื่อผู้ใช้ รหัสผ่าน)', 'error');
      }
      if (!citizenOk) return UI.toast('เลขบัตรประชาชนไม่ถูกต้อง', 'error');
      if (data.password !== data.confirm_password) return UI.toast('ยืนยันรหัสผ่านไม่ตรงกัน', 'error');
      for (const k of Object.keys(data)) {
        if (k === 'confirm_password') continue;
        form.append(k, data[k] || '');
      }
      const photoFile = document.getElementById('reg-photo').files[0];
      if (photoFile) form.append('photo', photoFile);
      const sigFile = document.getElementById('reg-sig-file').files[0];
      if (sigFile) form.append('signature', sigFile);
      btn.disabled = true; btn.textContent = 'กำลังส่งใบสมัคร...';
      try {
        const res = await API.postForm('/auth/register', form);
        UI.toast(res.message);
        m.close();
        Auth.openLogin();
      } catch (e) {
        UI.toast(e.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'ส่งใบสมัคร';
      }
    }
  },

  /** หน้าโปรไฟล์ของสมาชิก (แก้ไขข้อมูล เปลี่ยนรหัสผ่าน) */
  async openProfile() {
    const m = UI.modal({ title: '👤 โปรไฟล์ของฉัน', body: UI.loading(), size: 'lg' });
    const u = Auth.user;
    const body = m.bodyEl;
    const isSchool = u.user_group === 'school';
    const posList = isSchool ? CONSTANTS.SCHOOL_POSITIONS : CONSTANTS.POSITIONS;
    const rankList = isSchool ? CONSTANTS.SCHOOL_ACADEMIC_RANKS : CONSTANTS.ACADEMIC_RANKS;
    const workLabel = isSchool ? 'สถานศึกษา' : 'สังกัด/กลุ่มงาน';

    const profileCard = UI.h('div', {},
      UI.h('div', { style: { display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap', marginBottom: '16px' } },
        u.photo
          ? UI.h('img', { className: 'profile-photo', src: '/uploads/' + encodeURIComponent(u.photo) })
          : UI.h('div', { className: 'profile-photo', style: { display: 'grid', placeItems: 'center', fontSize: '32px', background: 'var(--primary-light)', color: 'var(--primary-deep)' } }, (u.full_name || '?').charAt(0)),
        UI.h('div', {},
          UI.h('div', { style: { fontSize: '19px', fontWeight: 800 } }, u.full_name),
          UI.h('div', { style: { color: 'var(--muted)', fontSize: '14px' } }, u.position || '-'),
          UI.h('div', { style: { marginTop: '6px' } }, u.role === 'admin' ? UI.h('span', { className: 'badge badge-admin' }, 'ผู้ดูแลระบบ') : (isSchool ? UI.h('span', { className: 'badge badge-member' }, '⊕ เจ้าหน้าที่สถานศึกษา') : UI.h('span', { className: 'badge badge-member' }, '⬡ เจ้าหน้าที่ สพป.'))),
        )),
      UI.h('div', { className: 'form-grid', style: { marginBottom: '14px' } },
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'คำนำหน้า'), UI.h('select', { id: 'pf-title' }, CONSTANTS.selectOptions(CONSTANTS.TITLES, u.title || 'นาย'))),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ชื่อ'), UI.h('input', { id: 'pf-fname', value: u.first_name || '' })),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'นามสกุล'), UI.h('input', { id: 'pf-lname', value: u.last_name || '' })),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'เลขบัตรประชาชน'), UI.h('input', { value: u.citizen_id || '-', disabled: true })),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ตำแหน่ง'), UI.h('select', { id: 'pf-pos' }, CONSTANTS.selectOptions(posList, u.position || ''))),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'วิทยฐานะ / ระดับ'), UI.h('select', { id: 'pf-rank' }, CONSTANTS.selectOptions(rankList, u.academic_rank || 'ไม่มี'))),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, workLabel), UI.h('select', { id: 'pf-work' }, [])),
        isSchool ? UI.h('div', { className: 'form-group full', id: 'pf-multi-school-wrap' },
          UI.h('button', { type: 'button', className: 'btn btn-sm btn-outline', style: { fontSize: '13px' }, onclick: () => {
            const container = document.getElementById('pf-multi-schools');
            const idx = container.children.length;
            if (idx >= 5) return;
            const row = UI.h('div', { className: 'form-group', style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' } },
              UI.h('span', { style: { fontSize: '14px', minWidth: '20px' } }, String(idx + 1) + '.'),
              UI.h('select', { id: 'pf-work-' + idx, style: { flex: 1 } }, []),
              UI.h('button', { type: 'button', className: 'btn btn-sm', style: { color: '#e53e3e', background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }, onclick: (e) => { e.target.closest('div.form-group').remove(); } }, '✕'));
            container.append(row);
            (async () => {
              try {
                const data = await API.get('/schools');
                const schools = (data.schools || []).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                const sel = document.getElementById('pf-work-' + idx);
                if (sel) {
                  sel.innerHTML = '';
                  sel.append(UI.h('option', { value: '' }, '-- เลือกสถานศึกษาเพิ่มเติม --'));
                  schools.forEach(s => {
                    const label = s.code ? s.code + ' ' + s.name : s.name;
                    sel.append(UI.h('option', { value: label }, label));
                  });
                }
              } catch (_e) {}
            })();
          } }, '📍 ปฏิบัติงานหลายแห่ง'),
          UI.h('div', { id: 'pf-multi-schools', style: { marginTop: '8px' } })) : null,
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ชื่อเล่น'), UI.h('input', { id: 'pf-nick', value: u.nickname || '' })),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'กรุ๊ปเลือด'), UI.h('select', { id: 'pf-blood' }, CONSTANTS.selectOptions(CONSTANTS.BLOOD_TYPES, u.blood_type || 'ไม่ทราบ'))),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'วุฒิการศึกษาสูงสุด'), UI.h('input', { id: 'pf-edu', value: u.highest_education || '' })),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'วัน/เดือน/ปี เกิด (พ.ศ.)'), UI.thaiBirthPicker('pf-birth', u.birth_date || '')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'อายุ (ปี)'), UI.h('input', { id: 'pf-age', type: 'text', readonly: true, value: UI.ageFromBirth(u.birth_date) || '' })),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'เบอร์โทรศัพท์'), UI.h('input', { id: 'pf-phone', value: u.phone || '' })),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'อีเมล'), UI.h('input', { id: 'pf-email', value: u.email || '' })),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'Telegram Token Key'), UI.h('input', { id: 'pf-tgtok', value: u.telegram_token || '', placeholder: 'Token จาก @BotFather' })),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'Telegram Chat ID'), UI.h('input', { id: 'pf-tgcid', value: u.telegram_chat_id || '', placeholder: 'Chat ID สำหรับรับการแจ้งเตือน' })),
        UI.h('div', { className: 'form-group', style: { display: 'flex', alignItems: 'flex-end', gap: '8px' } },
          UI.h('button', { type: 'button', className: 'btn', style: { background: '#bae6fd', color: '#0369a1', border: '1px solid #7dd3fc', marginTop: '26px', alignSelf: 'flex-start' }, onclick: (e) => testTelegram(e.currentTarget) }, '📣 ทดสอบส่งข้อความ')),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'รูปถ่าย (ใหม่)'), UI.h('input', { id: 'pf-photo', type: 'file', accept: 'image/*' })),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'ลายเซ็น (ใหม่)'), UI.h('input', { id: 'pf-sig', type: 'file', accept: 'image/*' })),
      ),
      UI.h('div', { className: 'form-actions', style: { marginTop: '4px' } },
        UI.h('button', { className: 'btn btn-primary', onclick: saveProfile }, '💾 บันทึกข้อมูล')),
      UI.h('div', { className: 'card-title', style: { marginTop: '20px' } }, '🔐 เปลี่ยนรหัสผ่าน'),
      UI.h('div', { className: 'form-grid' },
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'รหัสผ่านเดิม'), UI.h('input', { id: 'cp-old', type: 'password' })),
        UI.h('div', { className: 'form-group' }, UI.h('label', {}, 'รหัสผ่านใหม่'), UI.h('input', { id: 'cp-new', type: 'password', placeholder: 'อย่างน้อย 8 ตัวอักษร' })),
      ),
      UI.h('div', { className: 'form-actions' },
        UI.h('button', { className: 'btn btn-outline', onclick: changePass }, 'เปลี่ยนรหัสผ่าน')),

      u.signature ? UI.h('div', { style: { marginTop: '18px' } },
        UI.h('div', { className: 'card-title' }, '✍️ ลายเซ็นของฉัน'),
        UI.h('img', { className: 'signature-img', src: '/uploads/' + encodeURIComponent(u.signature) })) : null,
    );
    body.innerHTML = '';
    body.append(profileCard);

    // โหลดรายชื่อโรงเรียนสำหรับเจ้าหน้าที่สถานศึกษา
    if (isSchool) {
      (async () => {
        try {
          const data = await API.get('/schools');
          const schools = (data.schools || []).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
          const sel = document.getElementById('pf-work');
          if (sel) {
            sel.innerHTML = '';
            schools.forEach(s => {
              const label = s.code ? s.code + ' ' + s.name : s.name;
              // Match by school name (workplace may or may not have code prefix)
              const isSelected = u.workplace && (u.workplace === label || u.workplace === s.name || label.endsWith(u.workplace));
              sel.append(UI.h('option', { value: label, selected: isSelected }, label));
            });
          }
          // โหลดสถานศึกษาเพิ่มเติมที่บันทึกไว้
          let extra = [];
          try { extra = JSON.parse(u.workplace_secondary || '[]'); } catch (_e) {}
          if (extra.length > 0) {
            const container = document.getElementById('pf-multi-schools');
            if (container) {
              extra.forEach((val, idx) => {
                const row = UI.h('div', { className: 'form-group', style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' } },
                  UI.h('span', { style: { fontSize: '14px', minWidth: '20px' } }, String(idx + 1) + '.'),
                  UI.h('select', { id: 'pf-work-' + idx, style: { flex: 1 } }, []),
                  UI.h('button', { type: 'button', className: 'btn btn-sm', style: { color: '#e53e3e', background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }, onclick: (e) => { e.target.closest('div.form-group').remove(); } }, '✕'));
                container.append(row);
                schools.forEach(s => {
                  const label = s.code ? s.code + ' ' + s.name : s.name;
                  const isSelected = val === label || val === s.name || label.endsWith(val);
                  document.getElementById('pf-work-' + idx).append(UI.h('option', { value: label, selected: isSelected }, label));
                });
              });
            }
          }
        } catch (e) { /* ignore */ }
      })();
    } else {
      const sel = document.getElementById('pf-work');
      if (sel) {
        CONSTANTS.WORKPLACES.forEach(name => sel.append(UI.h('option', { value: name, selected: name === u.workplace }, name)));
      }
    }

    async function testTelegram(btn) {
      const tokenEl = document.getElementById('pf-tgtok');
      const chatEl = document.getElementById('pf-tgcid');
      const token = tokenEl ? tokenEl.value.trim() : '';
      const chatId = chatEl ? chatEl.value.trim() : '';
      if (!token || !chatId) return UI.toast('กรุณากรอก Telegram Token Key และ Telegram Chat ID ก่อนทดสอบ', 'error');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ กำลังส่ง...'; }
      try {
        const res = await API.post('/auth/profile/test-telegram', { telegram_token: token, telegram_chat_id: chatId });
        UI.toast(res.message || 'ส่งข้อความทดสอบสำเร็จ');
      } catch (e) {
        UI.toast(e.message || 'ส่งข้อความไม่สำเร็จ', 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📣 ทดสอบส่งข้อความ'; }
      }
    }

    async function saveProfile() {
      const fd = new FormData();
      for (const [id, key] of [
        ['pf-title', 'title'], ['pf-fname', 'first_name'], ['pf-lname', 'last_name'],
        ['pf-pos', 'position'], ['pf-rank', 'academic_rank'], ['pf-work', 'workplace'],
        ['pf-nick', 'nickname'], ['pf-blood', 'blood_type'], ['pf-edu', 'highest_education'],
        ['pf-phone', 'phone'], ['pf-email', 'email'], ['pf-tgtok', 'telegram_token'], ['pf-tgcid', 'telegram_chat_id'],
      ]) {
        fd.append(key, document.getElementById(id).value);
      }
      const ph = document.getElementById('pf-photo').files[0];
      const sg = document.getElementById('pf-sig').files[0];
      if (ph) fd.append('photo', ph);
      if (sg) fd.append('signature', sg);
      const pfBirth = UI.readThaiBirth('pf-birth');
      if (pfBirth) fd.append('birth_date', pfBirth);
      // เก็บสถานศึกษาเพิ่มเติม (ถ้ามี)
      if (Auth.user.user_group === 'school') {
        const extraSchools = [];
        for (let i = 0; i < 5; i++) {
          const el = document.getElementById('pf-work-' + i);
          if (el && el.value) extraSchools.push(el.value);
        }
        fd.append('workplace_secondary', JSON.stringify(extraSchools));
      }
      try {
        const res = await API.putForm('/auth/profile', fd);
        Auth.user = res.user;
        Auth.renderTopbar();
        UI.toast(res.message);
      } catch (e) { UI.toast(e.message, 'error'); }
    }

    async function changePass() {
      const oldP = document.getElementById('cp-old').value;
      const newP = document.getElementById('cp-new').value;
      try {
        const res = await API.post('/auth/change-password', { old_password: oldP, new_password: newP });
        UI.toast(res.message);
        document.getElementById('cp-old').value = '';
        document.getElementById('cp-new').value = '';
      } catch (e) { UI.toast(e.message, 'error'); }
    }
  },

  openSwitchSchool() {
    const u = Auth.user;
    let allSchools = [];
    if (u.workplace) allSchools.push(u.workplace);
    try {
      var extra = JSON.parse(u.workplace_secondary || '[]');
      allSchools = allSchools.concat(extra);
    } catch (_e) {}
    allSchools = allSchools.filter(function(s) { return s && s.trim(); });
    if (allSchools.length <= 1) {
      UI.toast('คุณมีสถานศึกษาแห่งเดียว ไม่ต้องสลับ');
      return;
    }
    Auth.showSchoolSelect(allSchools);
  },

  isMultiSchool() {
    var u = Auth.user;
    if (!u) return false;
    var schools = [];
    if (u.workplace) schools.push(u.workplace);
    try {
      var extra = JSON.parse(u.workplace_secondary || '[]');
      schools = schools.concat(extra);
    } catch (_e) {}
    return schools.filter(function(s) { return s && s.trim(); }).length > 1;
  },
};
