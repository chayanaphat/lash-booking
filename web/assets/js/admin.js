import {
  STATUS, addDays, api, baht, bkkToday, dayName, errText, esc, imgUrl, initLiff, loadImage, profile,
  promoRange, promoText, thaiDate, toast,
} from './core.js?v=1794894413';

const $app = document.getElementById('app');
const TABS = [
  ['bookings', '📅 คิว'],
  ['styles', '👁️ ทรงขนตา'],
  ['promos', '🎀 โปรโมชั่น'],
  ['hours', '🕘 เวลาเปิด-ปิด'],
  ['holidays', '🏖️ วันหยุด'],
  ['users', '💗 ลูกค้า/แต้ม'],
  ['settings', '⚙️ ตั้งค่า'],
];
const st = { tab: 'bookings', styles: [], range: 'today', from: bkkToday(), status: '' };

(async function boot() {
  try {
    await initLiff();
    const me = await api('/api/me');
    if (!me.is_admin) {
      $app.innerHTML = `
        <div class="card mt2 center">
          <h3>ไม่มีสิทธิ์เข้าหน้าแอดมิน</h3>
          <p class="small muted">ส่ง LINE User ID ด้านล่างให้เจ้าของระบบ เพื่อเพิ่มเป็นแอดมิน<br>(ใส่ใน ADMIN_USER_IDS ของ worker หรือเพิ่มจากหน้า ตั้งค่า โดยแอดมินอีกคน)</p>
          <p><span class="code" id="uid">${esc(me.user.line_user_id)}</span></p>
          <button class="btn sm" id="copy">คัดลอก ID</button>
          <p class="mt"><a href="./${location.search}">← กลับหน้าจองคิว</a></p>
        </div>`;
      document.getElementById('copy').onclick = () => navigator.clipboard?.writeText(me.user.line_user_id).then(() => toast('คัดลอกแล้ว'));
      return;
    }
    st.me = me;
    st.styles = (await api('/api/admin/styles')).styles;
    renderShell();
  } catch (e) {
    $app.innerHTML = `<div class="empty">โหลดไม่สำเร็จ: ${esc(errText(e))}<br><span class="tiny">${esc(e.data?.detail || '')}</span>
      ${profile?.userId ? `<p class="small">LINE User ID ของคุณ:<br><span class="code">${esc(profile.userId)}</span></p>` : ''}
      <button class="btn sm" onclick="sessionStorage.clear();location.reload()">ลองใหม่</button></div>`;
  }
})();

function renderShell() {
  $app.innerHTML = `
    <div class="row between mb">
      <div><div class="tiny muted">แอดมิน</div><b>${esc(st.me.user.display_name || profile?.displayName || '')}</b></div>
      <a class="chip-btn" href="./${location.search}" style="text-decoration:none;color:inherit">หน้าลูกค้า →</a>
    </div>
    <nav class="tabs">${TABS.map(([k, l]) => `<button class="tab ${st.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>
    <section id="view"></section>
    <dialog id="dlg"></dialog>`;
  $app.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      st.tab = b.dataset.tab;
      $app.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      show();
    }),
  );
  show();
}
const $view = () => document.getElementById('view');
const $dlg = () => document.getElementById('dlg');

function show() {
  $view().innerHTML = '<div class="loading" style="min-height:30vh"><div class="spinner"></div></div>';
  const fn = { bookings, styles, promos, hours, holidays, users, settings }[st.tab];
  fn().catch((e) => ($view().innerHTML = `<div class="empty">${esc(errText(e))}</div>`));
}

function dialog(title, body, { onSave, saveText = 'บันทึก', extraFoot = '' } = {}) {
  const d = $dlg();
  d.innerHTML = `<div class="dh"><span>${title}</span><button class="back" data-x>✕</button></div>
    <div class="db">${body}</div>
    ${onSave || extraFoot ? `<div class="df">${extraFoot}<button class="btn outline" data-x style="flex:1">ปิด</button>${onSave ? `<button class="btn" data-save style="flex:2">${saveText}</button>` : ''}</div>` : ''}`;
  d.querySelectorAll('[data-x]').forEach((b) => (b.onclick = () => d.close()));
  if (onSave) {
    d.querySelector('[data-save]').onclick = async (ev) => {
      ev.target.disabled = true;
      try {
        await onSave(d);
        d.close();
      } catch (e) {
        toast(errText(e));
      } finally {
        ev.target.disabled = false;
      }
    };
  }
  d.showModal();
  return d;
}
const val = (root, sel) => root.querySelector(sel)?.value?.trim() ?? '';

// =================================================================== bookings
async function bookings() {
  const today = bkkToday();
  const ranges = { today: [today, today], tomorrow: [addDays(today, 1), addDays(today, 1)], week: [today, addDays(today, 6)], month: [today, addDays(today, 30)] };
  let q;
  if (st.range === 'verifying') q = '?status=verifying';
  else if (st.range === 'date') q = `?from=${st.from}&to=${st.from}`;
  else q = `?from=${ranges[st.range][0]}&to=${ranges[st.range][1]}`;
  if (st.status && st.range !== 'verifying') q += `&status=${st.status}`;
  const { bookings: list } = await api('/api/admin/bookings' + q);

  const groups = {};
  for (const b of list) (groups[b.date] ||= []).push(b);
  const chip = (k, l) => `<button class="tab ${st.range === k ? 'on' : ''}" data-range="${k}">${l}</button>`;

  $view().innerHTML = `
    <div class="row wrapflex" style="gap:6px">
      ${chip('today', 'วันนี้')}${chip('tomorrow', 'พรุ่งนี้')}${chip('week', '7 วัน')}${chip('month', '30 วัน')}${chip('verifying', '🧾 รอตรวจสลิป')}
    </div>
    <div class="row mt">
      <input type="date" class="input" id="pick" value="${st.range === 'date' ? st.from : ''}" />
      <select class="input" id="fstatus" style="max-width:150px">
        <option value="">ทุกสถานะ</option>
        ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${st.status === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    ${list.length ? Object.entries(groups).map(([d, arr]) => `
      <div class="daygroup">${thaiDate(d)} · ${arr.filter((b) => b.status !== 'cancelled').length} คิว</div>
      ${arr.map(bookingCard).join('')}`).join('') : '<div class="empty">ไม่มีคิว</div>'}
  `;
  $view().querySelectorAll('[data-range]').forEach((b) => (b.onclick = () => ((st.range = b.dataset.range), show())));
  $view().querySelector('#pick').onchange = (e) => {
    if (!e.target.value) return;
    st.range = 'date';
    st.from = e.target.value;
    show();
  };
  $view().querySelector('#fstatus').onchange = (e) => ((st.status = e.target.value), show());
  $view().querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => bookingAction(list.find((x) => x.code === b.dataset.code), b.dataset.act)));
  $view().querySelectorAll('[data-slip]').forEach((b) => (b.onclick = () => dialog('สลิป', `<img class="slipimg" src="${imgUrl(b.dataset.slip)}">`, {})));
}

function bookingCard(b) {
  const acts = {
    pending_deposit: [['confirm', 'ยืนยันมัดจำ (รับเงินแล้ว)', 'ok'], ['cancel', 'ยกเลิก', 'outline']],
    verifying: [['confirm', '✅ สลิปถูกต้อง', 'ok'], ['reject_slip', '❌ สลิปไม่ถูกต้อง', 'bad'], ['cancel', 'ยกเลิก', 'outline']],
    confirmed: [['complete', '💗 มาใช้บริการแล้ว (+1 แต้ม)', 'dark'], ['reschedule', 'เลื่อนนัด', 'outline'], ['cancel', 'ยกเลิก', 'outline']],
  }[b.status] || [];
  return `
    <div class="card">
      <div class="row between"><b>${b.start_time}–${b.end_time} น.</b><span class="st ${b.status}">${STATUS[b.status]}</span></div>
      <div class="list-item mt">
        ${b.picture_url ? `<img class="avatar" src="${esc(b.picture_url)}">` : ''}
        <div class="grow">
          <div><b>${esc(b.customer_name)}</b> <a href="tel:${esc(b.phone)}" class="small">${esc(b.phone)}</a></div>
          <div class="tiny muted">LINE: ${esc(b.display_name || '-')} · แต้ม ${b.stamps ?? 0} · ${b.code}</div>
        </div>
      </div>
      ${((labels) => b.items.map((it, i) => `<div class="line small"><span>${labels[i]} · ${esc(it.name)} ${it.promotion ? `<span class="tag">${esc(it.promotion.name)}</span>` : ''}${it.reward ? '<span class="tag">ฟรีจากแต้ม</span>' : ''}</span><span>${baht(it.price)}</span></div>`).join(''))((() => { let n = 0; return b.items.map((it) => (it.kind === 'addon' ? '+ เสริม' : `คนที่ ${++n}`)); })())}
      <div class="line small"><span class="muted">รวม / มัดจำ / ค้างชำระ</span><b>${baht(b.total)} / ${baht(b.deposit_amount)} / ${baht(b.total - (['confirmed', 'completed'].includes(b.status) ? b.deposit_amount : 0))}</b></div>
      ${b.note ? `<div class="small mt">📝 ${esc(b.note)}</div>` : ''}
      ${b.slip_note || b.slip_trans_ref ? `<div class="tiny muted mt">สลิป: ${esc(b.slip_note)} ${b.slip_trans_ref ? '· ref ' + esc(b.slip_trans_ref) : ''} ${b.slip_amount ? '· ' + baht(b.slip_amount) : ''}</div>` : ''}
      ${b.admin_note ? `<div class="tiny muted">หมายเหตุแอดมิน: ${esc(b.admin_note)}</div>` : ''}
      <div class="actions">
        ${b.slip_image_id ? `<button class="btn sm ghost" data-slip="${b.slip_image_id}">🧾 ดูสลิป</button>` : ''}
        ${acts.map(([a, l, c]) => `<button class="btn sm ${c}" data-act="${a}" data-code="${b.code}">${l}</button>`).join('')}
      </div>
    </div>`;
}

function bookingAction(b, action) {
  const titles = { confirm: 'ยืนยันมัดจำ', reject_slip: 'ปฏิเสธสลิป', complete: 'ลูกค้ามาใช้บริการแล้ว', cancel: 'ยกเลิกคิว', reschedule: 'เลื่อนนัด' };
  const extra = action === 'reschedule'
    ? `<div class="grid2"><div><label class="f">วันที่ใหม่</label><input type="date" class="input" id="d" value="${b.date}"></div>
       <div><label class="f">เวลาเริ่มใหม่</label><input type="time" class="input" id="t" value="${b.start_time}" step="900"></div></div>
       <p class="tiny muted">ระบบไม่เช็คคิวชน กรุณาตรวจตารางก่อนเลื่อน</p>`
    : '';
  dialog(`${titles[action]} · ${b.code}`, `
    <p>${esc(b.customer_name)} · ${thaiDate(b.date)} ${b.start_time} น.</p>${extra}
    <label class="f">${action === 'reject_slip' ? 'เหตุผล (ส่งให้ลูกค้า)' : 'หมายเหตุ (ไม่บังคับ)'}</label>
    <input class="input" id="note" maxlength="300" />
    ${['confirm', 'reject_slip', 'cancel', 'reschedule'].includes(action) ? '<p class="tiny muted">ระบบจะแจ้งลูกค้าทาง LINE อัตโนมัติ (ถ้าเปิดไว้ในตั้งค่า)</p>' : ''}`, {
    saveText: 'ยืนยัน',
    onSave: async (d) => {
      await api(`/api/admin/bookings/${b.code}/status`, { method: 'POST', body: { action, note: val(d, '#note'), date: val(d, '#d'), time: val(d, '#t') } });
      toast('บันทึกแล้ว');
      show();
    },
  });
}

// =================================================================== styles
async function styles() {
  st.styles = (await api('/api/admin/styles')).styles;
  $view().innerHTML = `
    <button class="btn" id="add">+ เพิ่มทรงขนตา</button>
    <div class="mt">${st.styles.map((s) => `
      <div class="card list-item" ${s.active ? '' : 'style="opacity:.5"'}>
        ${s.image_id ? `<img class="thumb" src="${imgUrl(s.image_id)}">` : '<div class="thumb">👁️</div>'}
        <div class="grow"><b>${esc(s.name)}</b> ${s.active ? '' : '<span class="tag">ซ่อน</span>'}
          <div class="small muted">${esc(s.description)}</div>
          <div class="small">${baht(s.price)} · ${s.duration_min} นาที · ลำดับ ${s.sort}</div>
          <div class="tiny muted">${esc(s.category || '')}${s.kind === 'addon' ? ' · บริการเสริม' : ''}</div></div>
        <button class="btn sm outline" data-edit="${s.id}">แก้ไข</button>
      </div>`).join('') || '<div class="empty">ยังไม่มีทรง</div>'}</div>`;
  $view().querySelector('#add').onclick = () => styleForm({ name: '', description: '', price: '', duration_min: 120, sort: st.styles.length + 1, active: 1, category: st.styles[0]?.category || 'ต่อขนตา (เลือกทรง)', kind: 'main' });
  $view().querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => styleForm(st.styles.find((s) => s.id === Number(b.dataset.edit)))));
}

function styleForm(s) {
  let imageId = s.image_id || null;
  const d = dialog(s.id ? 'แก้ไขทรง' : 'เพิ่มทรง', `
    <label class="f">รูป</label>
    <div class="row"><div class="thumb" id="pv" style="width:96px;height:96px;flex-basis:96px;background-size:cover;background-position:center;${imageId ? `background-image:url(${imgUrl(imageId)})` : ''}">${imageId ? '' : '👁️'}</div>
      <div><input type="file" accept="image/*" id="file" class="hidden"><button class="btn sm ghost" id="pick">เลือกรูป</button><div class="tiny muted mt">ระบบย่อรูปให้อัตโนมัติ</div></div></div>
    <label class="f">ชื่อทรง / บริการ</label><input class="input" id="name" value="${esc(s.name)}" maxlength="80">
    <div class="grid2">
      <div><label class="f">หมวด (หัวข้อในหน้าจอง)</label><input class="input" id="cat" list="cats" value="${esc(s.category || '')}" maxlength="60">
        <datalist id="cats">${[...new Set(st.styles.map((x) => x.category).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div><label class="f">ประเภท</label><select class="input" id="kind">
        <option value="main">บริการหลัก (นับเป็น 1 คน)</option>
        <option value="addon" ${s.kind === 'addon' ? 'selected' : ''}>บริการเสริม (เพิ่มคู่บริการหลัก)</option></select></div>
    </div>
    <label class="f">คำอธิบาย</label><input class="input" id="desc" value="${esc(s.description)}" maxlength="300">
    <div class="grid2">
      <div><label class="f">ราคา (บาท)</label><input class="input" id="price" type="number" min="0" value="${s.price}"></div>
      <div><label class="f">ใช้เวลา (นาที)</label><input class="input" id="dur" type="number" min="15" step="15" value="${s.duration_min}"></div>
      <div><label class="f">ลำดับการแสดง</label><input class="input" id="sort" type="number" value="${s.sort}"></div>
      <div><label class="f">สถานะ</label><select class="input" id="active"><option value="1">แสดง</option><option value="0" ${s.active ? '' : 'selected'}>ซ่อน</option></select></div>
    </div>`, {
    extraFoot: s.id ? '<button class="btn bad" id="del" style="flex:1">ลบ</button>' : '',
    onSave: async (d) => {
      await api(`/api/admin/styles${s.id ? '/' + s.id : ''}`, {
        method: s.id ? 'PUT' : 'POST',
        body: { name: val(d, '#name'), description: val(d, '#desc'), price: val(d, '#price'), duration_min: val(d, '#dur'), sort: val(d, '#sort'), active: val(d, '#active') === '1', image_id: imageId, category: val(d, '#cat'), kind: val(d, '#kind') },
      });
      toast('บันทึกแล้ว');
      show();
    },
  });
  const file = d.querySelector('#file');
  d.querySelector('#pick').onclick = () => file.click();
  file.onchange = async () => {
    if (!file.files[0]) return;
    const pv = d.querySelector('#pv');
    pv.textContent = '⏳';
    try {
      const { dataUrl } = await loadImage(file.files[0], 1080, 0.85);
      imageId = (await api('/api/admin/images', { method: 'POST', body: { image: dataUrl } })).id;
      pv.style.backgroundImage = `url(${dataUrl})`;
      pv.textContent = '';
    } catch (e) {
      pv.textContent = '⚠️';
      toast(errText(e));
    }
  };
  d.querySelector('#del')?.addEventListener('click', async () => {
    if (!confirm('ลบทรงนี้? (การจองเก่าไม่ได้รับผลกระทบ) แนะนำให้ "ซ่อน" แทนถ้ายังอยากเก็บไว้')) return;
    await api('/api/admin/styles/' + s.id, { method: 'DELETE' });
    d.close();
    show();
  });
}

// =================================================================== promotions
async function promos() {
  const { promotions } = await api('/api/admin/promotions');
  const today = bkkToday();
  const state = (p) => (!p.active ? 'ปิด' : p.end_date && p.end_date < today ? 'หมดอายุ' : p.start_date && p.start_date > today ? 'ยังไม่เริ่ม' : 'ใช้งานอยู่');
  $view().innerHTML = `
    <button class="btn" id="add">+ เพิ่มโปรโมชั่น</button>
    <p class="tiny muted">โปรคิดจาก "วันที่มาใช้บริการ" · ถ้ามีหลายโปร ระบบเลือกราคาที่ถูกที่สุดให้ลูกค้าต่อทรง</p>
    ${promotions.map((p) => `
      <div class="card">
        <div class="row between"><b>${esc(p.name)}</b><span class="st ${state(p) === 'ใช้งานอยู่' ? 'confirmed' : 'completed'}">${state(p)}</span></div>
        <div class="small">${esc(promoText(p, st.styles))}</div>
        <div class="tiny muted">${esc(promoRange(p) || 'ไม่จำกัดวัน')} ${p.style_ids?.length ? '· เฉพาะ ' + p.style_ids.map((id) => esc(st.styles.find((s) => s.id === id)?.name || '#' + id)).join(', ') : ''}</div>
        <div class="actions"><button class="btn sm outline" data-edit="${p.id}">แก้ไข</button></div>
      </div>`).join('') || '<div class="empty">ยังไม่มีโปรโมชั่น</div>'}`;
  $view().querySelector('#add').onclick = () => promoForm({ name: '', type: 'discount', min_people: 2, discount: 50, active: true });
  $view().querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => promoForm(promotions.find((p) => p.id === Number(b.dataset.edit)))));
}

function promoForm(p) {
  const d = dialog(p.id ? 'แก้ไขโปรโมชั่น' : 'เพิ่มโปรโมชั่น', `
    <label class="f">ชื่อโปร (แสดงให้ลูกค้าเห็น)</label><input class="input" id="name" value="${esc(p.name)}" placeholder="เช่น โปรเดือนมกรา มา 2 ลด 50">
    <label class="f">ประเภท</label>
    <select class="input" id="type">
      <option value="discount" ${p.type === 'discount' ? 'selected' : ''}>ลดเป็นจำนวนเงิน ต่อทรง</option>
      <option value="percent" ${p.type === 'percent' ? 'selected' : ''}>ลดเป็น % ต่อทรง</option>
      <option value="fixed_price" ${p.type === 'fixed_price' ? 'selected' : ''}>ราคาพิเศษรายทรง (เช่น ทรง A 590 → 450)</option>
    </select>
    <div class="grid2">
      <div><label class="f">ต้องมากี่คนขึ้นไป</label><input class="input" id="minp" type="number" min="1" max="10" value="${p.min_people || 1}"></div>
      <div id="discBox"><label class="f" id="discLabel">ลดทรงละ (บาท)</label><input class="input" id="disc" type="number" min="0" value="${p.discount || 0}"></div>
    </div>
    <div id="fixedBox">
      <label class="f">ราคาพิเศษ (เว้นว่าง = ไม่ร่วมโปร)</label>
      ${st.styles.map((s) => `<div class="row" style="margin:6px 0"><span class="grow small">${esc(s.name)} <span class="muted">(${s.price})</span></span><input class="input" style="max-width:110px" type="number" min="0" data-fp="${s.id}" value="${p.fixed_prices?.[s.id] ?? ''}"></div>`).join('')}
    </div>
    <div id="scopeBox">
      <label class="f">ใช้กับทรง (ไม่เลือก = ทุกทรง)</label>
      ${st.styles.map((s) => `<label class="switch" style="margin:4px 10px 4px 0"><input type="checkbox" data-sid="${s.id}" ${p.style_ids?.includes(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}
    </div>
    <div class="grid2">
      <div><label class="f">เริ่ม (วันที่มารับบริการ)</label><input class="input" id="start" type="date" value="${p.start_date || ''}"></div>
      <div><label class="f">สิ้นสุด</label><input class="input" id="end" type="date" value="${p.end_date || ''}"></div>
    </div>
    <label class="f">คำอธิบาย (ไม่บังคับ — เว้นว่างระบบเขียนให้)</label><input class="input" id="desc" value="${esc(p.description || '')}">
    <label class="switch mt"><input type="checkbox" id="active" ${p.active ? 'checked' : ''}> เปิดใช้งาน</label>`, {
    extraFoot: p.id ? '<button class="btn bad" id="del" style="flex:1">ลบ</button>' : '',
    onSave: async (d) => {
      const type = val(d, '#type');
      const fixed = {};
      d.querySelectorAll('[data-fp]').forEach((i) => i.value !== '' && (fixed[i.dataset.fp] = Number(i.value)));
      const ids = [...d.querySelectorAll('[data-sid]:checked')].map((i) => Number(i.dataset.sid));
      await api(`/api/admin/promotions${p.id ? '/' + p.id : ''}`, {
        method: p.id ? 'PUT' : 'POST',
        body: {
          name: val(d, '#name'), type, min_people: val(d, '#minp'), discount: val(d, '#disc'),
          fixed_prices: type === 'fixed_price' ? fixed : null, style_ids: type === 'fixed_price' ? null : ids,
          start_date: val(d, '#start'), end_date: val(d, '#end'), description: val(d, '#desc'), active: d.querySelector('#active').checked,
        },
      });
      toast('บันทึกแล้ว');
      show();
    },
  });
  const sync = () => {
    const t = d.querySelector('#type').value;
    d.querySelector('#fixedBox').classList.toggle('hidden', t !== 'fixed_price');
    d.querySelector('#scopeBox').classList.toggle('hidden', t === 'fixed_price');
    d.querySelector('#discBox').classList.toggle('hidden', t === 'fixed_price');
    d.querySelector('#discLabel').textContent = t === 'percent' ? 'ลดทรงละ (%)' : 'ลดทรงละ (บาท)';
  };
  d.querySelector('#type').onchange = sync;
  sync();
  d.querySelector('#del')?.addEventListener('click', async () => {
    if (!confirm('ลบโปรโมชั่นนี้?')) return;
    await api('/api/admin/promotions/' + p.id, { method: 'DELETE' });
    d.close();
    show();
  });
}

// =================================================================== hours
function timeOptions(selected) {
  const out = [];
  for (let m = 5 * 60; m <= 24 * 60 - 30; m += 30) {
    const t = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    out.push(t);
  }
  if (selected && !out.includes(selected)) out.push(selected), out.sort();
  return out.map((t) => `<option value="${t}" ${t === selected ? 'selected' : ''}>${t} น.</option>`).join('');
}

async function hours() {
  const { hours } = await api('/api/public/info');
  const order = [1, 2, 3, 4, 5, 6, 0];
  $view().innerHTML = `
    <div class="card">
      ${order.map((w) => {
        const h = hours.find((x) => x.weekday === w) || { weekday: w, open_time: '10:00', close_time: '20:00', closed: false };
        return `<div class="hours-row" data-w="${w}">
          <b>${dayName(w, true).slice(0, 6)}</b>
          <select class="input" data-o>${timeOptions(h.open_time)}</select>
          <select class="input" data-c>${timeOptions(h.close_time)}</select>
          <label class="switch"><input type="checkbox" data-closed ${h.closed ? 'checked' : ''}>ปิด</label></div>`;
      }).join('')}
      <p class="tiny muted">เวลาปิด = เวลาที่ต้องทำเสร็จ เช่น ปิด 20:00 ทรง 2 ชม. จองได้ถึง 18:00</p>
      <button class="btn mt" id="save">บันทึกเวลาเปิด-ปิด</button>
    </div>`;
  $view().querySelector('#save').onclick = async () => {
    const rows = [...$view().querySelectorAll('[data-w]')].map((r) => ({
      weekday: Number(r.dataset.w), open_time: r.querySelector('[data-o]').value, close_time: r.querySelector('[data-c]').value, closed: r.querySelector('[data-closed]').checked,
    }));
    try {
      await api('/api/admin/hours', { method: 'PUT', body: { hours: rows } });
      toast('บันทึกแล้ว');
    } catch (e) {
      toast(e.message === 'invalid_hours' ? 'เวลาเปิดต้องน้อยกว่าเวลาปิด' : errText(e));
    }
  };
}

// =================================================================== holidays
async function holidays() {
  const { holidays: list } = await api('/api/admin/holidays');
  $view().innerHTML = `
    <div class="card">
      <div class="grid2">
        <div><label class="f">ตั้งแต่วันที่</label><input class="input" type="date" id="d1" min="${bkkToday()}"></div>
        <div><label class="f">ถึงวันที่ (ถ้าหยุดหลายวัน)</label><input class="input" type="date" id="d2"></div>
      </div>
      <label class="f">หมายเหตุ</label><input class="input" id="note" placeholder="เช่น หยุดสงกรานต์">
      <button class="btn mt" id="add">+ เพิ่มวันหยุด</button>
    </div>
    <div class="mt">${list.map((h) => `
      <div class="card row between"><div><b>${thaiDate(h.date)}</b> <span class="small muted">${esc(h.note)}</span></div>
      <button class="btn sm outline" data-del="${h.date}">ลบ</button></div>`).join('') || '<div class="empty">ยังไม่มีวันหยุดพิเศษ</div>'}</div>`;
  $view().querySelector('#add').onclick = async () => {
    const date = val($view(), '#d1');
    if (!date) return toast('เลือกวันที่');
    try {
      await api('/api/admin/holidays', { method: 'POST', body: { date, end_date: val($view(), '#d2'), note: val($view(), '#note') } });
      toast('เพิ่มแล้ว');
      show();
    } catch (e) {
      toast(errText(e));
    }
  };
  $view().querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    await api('/api/admin/holidays/' + b.dataset.del, { method: 'DELETE' });
    show();
  }));
}

// =================================================================== users & stamps
async function users(q = st.q || '') {
  st.q = q;
  const { users: list } = await api('/api/admin/users?q=' + encodeURIComponent(q));
  const req = st.me.stamps_required;
  $view().innerHTML = `
    <input class="input" id="q" placeholder="ค้นหาชื่อ / เบอร์โทร" value="${esc(q)}">
    <div class="mt">${list.map((u) => `
      <div class="card list-item">
        ${u.picture_url ? `<img class="avatar" src="${esc(u.picture_url)}">` : '<div class="avatar"></div>'}
        <div class="grow"><b>${esc(u.display_name || '-')}</b> <span class="small muted">${esc(u.phone)}</span>
          <div class="tiny muted">มาแล้ว ${u.total_visits} ครั้ง · แต้ม <b style="color:var(--rose)">${u.stamps}/${req}</b></div></div>
        <div class="row" style="gap:4px"><button class="btn sm outline" data-st="${u.line_user_id}" data-v="${u.stamps - 1}">−</button><button class="btn sm ghost" data-st="${u.line_user_id}" data-v="${u.stamps + 1}">+</button></div>
      </div>`).join('') || '<div class="empty">ไม่พบลูกค้า</div>'}</div>`;
  let t;
  $view().querySelector('#q').oninput = (e) => {
    clearTimeout(t);
    t = setTimeout(() => users(e.target.value).then(() => {
      const i = $view().querySelector('#q');
      i.focus();
      i.setSelectionRange(i.value.length, i.value.length);
    }), 400);
  };
  $view().querySelectorAll('[data-st]').forEach((b) => (b.onclick = async () => {
    await api('/api/admin/users/' + b.dataset.st, { method: 'PUT', body: { stamps: Math.max(0, Number(b.dataset.v)) } });
    users(st.q);
  }));
}

// =================================================================== settings
async function settings() {
  const [{ settings: s, slip_auto }, adm] = await Promise.all([api('/api/admin/settings'), api('/api/admin/admins')]);
  const f = (k, label, type = 'text', hint = '') => `<div class="field"><label class="f">${label}</label><input class="input" data-k="${k}" type="${type}" ${type === 'number' ? 'inputmode="numeric" min="0"' : ''} value="${esc(s[k])}">${hint ? `<div class="tiny muted" style="margin-top:4px">${hint}</div>` : ''}</div>`;
  $view().innerHTML = `
    <div class="card">
      <b>ข้อมูลร้าน</b>
      ${f('shop_name', 'ชื่อร้าน')}${f('shop_phone', 'เบอร์ร้าน')}${f('shop_address', 'ที่อยู่')}
      ${f('map_url', 'ลิงก์ Google Maps', 'url', 'ปุ่ม "เปิด Google Maps" ในหน้าจอง และในการ์ดยืนยันคิว')}
      <div class="grid2">${f('shop_lat', 'ละติจูด')}${f('shop_lng', 'ลองจิจูด')}</div>
      <div class="tiny muted" style="margin-top:4px">พิกัดใช้ส่งหมุดแผนที่ในแชท เมื่อลูกค้าพิมพ์ "แผนที่" หรือ "ร้านอยู่ไหน"</div>
      ${f('review_url', 'ลิงก์รีวิว Google', 'url', 'แสดงปุ่มชวนรีวิวให้ลูกค้าที่ใช้บริการแล้ว')}
      <label class="f">เงื่อนไขการจอง (1 บรรทัด = 1 ข้อ)</label><textarea class="input" data-k="policy_text" rows="5">${esc(s.policy_text)}</textarea>
    </div>
    <div class="card">
      <b>มัดจำ</b>
      <div class="grid2">${f('deposit_amount', 'ยอดมัดจำ (บาท)', 'number')}${f('deposit_timeout_min', 'ถือคิวรอโอน (นาที)', 'number')}</div>
      ${f('promptpay_id', 'พร้อมเพย์ (เบอร์ / เลขบัตร / e-Wallet ID)', 'text', 'ใช้สร้าง QR ที่ใส่ยอดมัดจำให้อัตโนมัติ')}${f('promptpay_name', 'ชื่อบัญชี')}
      <div class="grid2">${f('bank_name', 'ธนาคาร')}${f('bank_account_no', 'เลขบัญชี')}</div>
      <div class="tiny mt">ตรวจสลิปอัตโนมัติ: ${slip_auto ? '<b style="color:var(--ok)">เปิด (EasySlip)</b>' : '<b>ปิด</b> — แอดมินตรวจเอง (ตั้ง EASYSLIP_API_KEY เพื่อเปิด)'}</div>
    </div>
    <div class="card">
      <b>การจอง</b>
      <div class="grid2">
        ${f('slot_step_min', 'ช่วงเวลาให้เลือกทุกกี่นาที', 'number')}${f('capacity', 'รับพร้อมกันได้กี่คิว (จำนวนช่าง)', 'number')}
        ${f('booking_days_ahead', 'จองล่วงหน้าได้กี่วัน', 'number')}${f('min_lead_min', 'ต้องจองก่อนอย่างน้อย (นาที)', 'number')}
        ${f('max_people', 'จองพร้อมกันได้สูงสุด (คน)', 'number')}${f('stamps_required', 'สะสมกี่ครั้ง ฟรี 1', 'number')}
      </div>
    </div>
    <div class="card">
      <b>แจ้งเตือน LINE</b>
      <label class="switch mt" style="display:flex"><input type="checkbox" data-kb="notify_admins" ${s.notify_admins ? 'checked' : ''}> แจ้งแอดมินเมื่อมีคิวใหม่ / สลิปรอตรวจ</label>
      <label class="switch mt" style="display:flex"><input type="checkbox" data-kb="notify_customer" ${s.notify_customer ? 'checked' : ''}> แจ้งลูกค้าเมื่อแอดมินยืนยัน/ปฏิเสธ/ยกเลิก</label>
      <label class="switch mt" style="display:flex"><input type="checkbox" data-kb="review_request" ${s.review_request ? 'checked' : ''}> ส่งข้อความขอบคุณ + ชวนรีวิว Google เมื่อกด "มาใช้บริการแล้ว"</label>
      <label class="switch mt" style="display:flex"><input type="checkbox" data-kb="remind_day_before" ${s.remind_day_before ? 'checked' : ''}> เตือนนัดลูกค้าล่วงหน้า 1 วัน พร้อมแผนที่</label>
      <div class="grid2">${f('remind_hour', 'ส่งเตือนเวลา (ชั่วโมง 0–23)', 'number')}<div></div></div>
      <div class="tiny muted mt">การแจ้งเตือนแบบ push ใช้โควต้าข้อความฟรีของ LINE OA ต่อเดือน (ข้อความตอบกลับในแชทไม่นับ) · ข้อความ 1 ครั้งต่อลูกค้านับเป็น 1 ข้อความ</div>
    </div>
    <button class="btn mt" id="save">บันทึกการตั้งค่า</button>

    <div class="card mt2">
      <b>Rich menu ของ LINE OA</b>
      <img src="assets/richmenu.jpg?v=1794894413" style="border-radius:10px;margin-top:10px" alt="">
      <div class="tiny muted mt">กดเพื่อตั้งเมนู จองคิว / โปรโมชั่น / แต้มสะสม เป็นเมนูหลักของ OA (แทนเมนูเดิม)</div>
      <button class="btn ghost mt" id="richmenu">ติดตั้ง Rich menu</button>
    </div>

    <div class="card mt2">
      <b>แอดมิน</b>
      ${adm.env_admins.map((id) => `<div class="small mt"><span class="code">${esc(id)}</span> <span class="tag">ตั้งใน worker</span></div>`).join('')}
      ${adm.admins.map((a) => `<div class="row between mt"><div class="small">${esc(a.name || a.display_name || '')} <span class="code">${esc(a.line_user_id)}</span></div>
        ${a.line_user_id !== st.me.user.line_user_id ? `<button class="btn sm outline" data-rmadm="${a.line_user_id}">ลบ</button>` : ''}</div>`).join('')}
      <label class="f">เพิ่มแอดมิน (LINE User ID ขึ้นต้นด้วย U)</label>
      <div class="row"><input class="input" id="newadm" placeholder="U1234..."><input class="input" id="newname" placeholder="ชื่อ" style="max-width:110px"><button class="btn sm" id="addadm">เพิ่ม</button></div>
      <div class="tiny muted mt">ให้คนที่จะเป็นแอดมินเปิดลิงก์ LIFF /admin.html จะเห็น User ID ของตัวเอง</div>
      <div class="tiny muted mt">User ID ของคุณ: <span class="code">${esc(st.me.user.line_user_id)}</span></div>
    </div>`;
  $view().querySelector('#save').onclick = async () => {
    const body = {};
    $view().querySelectorAll('[data-k]').forEach((i) => (body[i.dataset.k] = i.value));
    $view().querySelectorAll('[data-kb]').forEach((i) => (body[i.dataset.kb] = i.checked ? 1 : 0));
    try {
      await api('/api/admin/settings', { method: 'PUT', body });
      st.me = await api('/api/me');
      toast('บันทึกแล้ว');
    } catch (e) {
      toast(errText(e));
    }
  };
  $view().querySelector('#richmenu').onclick = async (e) => {
    if (!confirm('ตั้ง Rich menu นี้เป็นเมนูหลักของ LINE OA?')) return;
    e.target.disabled = true;
    try {
      await api('/api/admin/richmenu', { method: 'POST', body: { image_url: new URL('assets/richmenu.jpg?v=1794894413', location.href).href } });
      toast('ติดตั้ง Rich menu แล้ว ✅ เปิดแชท OA เพื่อดู');
    } catch (err) {
      toast(err.message === 'line_token_missing' ? 'ยังไม่ได้ใส่ LINE_CHANNEL_ACCESS_TOKEN ใน Cloudflare' : errText(err) + ' ' + (err.data?.detail || ''), 5000);
    } finally {
      e.target.disabled = false;
    }
  };
  $view().querySelector('#addadm').onclick = async () => {
    try {
      await api('/api/admin/admins', { method: 'POST', body: { line_user_id: val($view(), '#newadm'), name: val($view(), '#newname') } });
      toast('เพิ่มแอดมินแล้ว');
      show();
    } catch (e) {
      toast(e.message === 'invalid_user_id' ? 'User ID ไม่ถูกต้อง' : errText(e));
    }
  };
  $view().querySelectorAll('[data-rmadm]').forEach((b) => (b.onclick = async () => {
    if (!confirm('ลบแอดมินคนนี้?')) return;
    await api('/api/admin/admins/' + b.dataset.rmadm, { method: 'DELETE' });
    show();
  }));
}
