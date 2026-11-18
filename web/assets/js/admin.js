import {
  STATUS, addDays, api, baht, bkkToday, dayName, errText, esc, imgUrl, initLiff, loadImage, profile,
  promoRange, promoText, thaiDate, toast,
} from './core.js?v=1795017758';

const $app = document.getElementById('app');
const TABS = [
  ['bookings', '📅 คิว'],
  ['styles', '👁️ ทรงขนตา'],
  ['reviews', '🌟 รีวิว'],
  ['fbpost', '📣 โพสต์เพจ'],
  ['promos', '🎀 โปรโมชั่น'],
  ['hours', '🕘 เวลาเปิด-ปิด'],
  ['holidays', '🏖️ วันหยุด/ปิดช่วง'],
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
  const fn = { bookings, styles, reviews, fbpost, promos, hours, holidays, users, settings }[st.tab];
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
  const [from, to] = st.range === 'date' ? [st.from, st.from] : ranges[st.range] || [null, null];
  const [{ bookings: list }, blockRes] = await Promise.all([
    api('/api/admin/bookings' + q),
    from ? api(`/api/admin/blocks?from=${from}&to=${to}`).catch(() => ({ blocks: [] })) : { blocks: [] },
  ]);
  const blocks = st.status ? [] : blockRes.blocks;

  const groups = {};
  for (const b of list) (groups[b.date] ||= []).push(b);
  const blocksBy = {};
  for (const b of blocks) (blocksBy[b.date] ||= []).push(b), (groups[b.date] ||= []);
  const days = Object.keys(groups).sort();
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
    ${days.length ? days.map((d) => `
      <div class="daygroup">${thaiDate(d)} · ${groups[d].filter((b) => b.status !== 'cancelled').length} คิว</div>
      ${(blocksBy[d] || []).map((b) => `<div class="card small" style="border-left:4px solid var(--gold)">⛔ ปิดรับคิว ${b.start_time}–${b.end_time} น.${b.note ? ` · ${esc(b.note)}` : ''}</div>`).join('')}
      ${groups[d].map(bookingCard).join('')}`).join('') : '<div class="empty">ไม่มีคิว</div>'}
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

// แต้มที่ลูกค้าจะได้จากคิวนี้ (คิวเก่าที่ยังไม่มีข้อมูลแต้มตามทรง = 1 แต้ม)
function stampsOf(b) {
  const items = b.items || [];
  if (!items.some((i) => 'stamps' in i)) return b.use_reward ? 0 : 1;
  return items.reduce((a, i) => a + (i.reward ? 0 : Number(i.stamps) || 0), 0);
}

function bookingCard(b) {
  const acts = {
    pending_deposit: [['confirm', 'ยืนยันมัดจำ (รับเงินแล้ว)', 'ok'], ['cancel', 'ยกเลิก', 'outline']],
    verifying: [['confirm', '✅ สลิปถูกต้อง', 'ok'], ['reject_slip', '❌ สลิปไม่ถูกต้อง', 'bad'], ['cancel', 'ยกเลิก', 'outline']],
    confirmed: [['complete', `💗 มาใช้บริการแล้ว (+${stampsOf(b)} แต้ม)`, 'dark'], ['reschedule', 'เลื่อนนัด', 'outline'], ['cancel', 'ยกเลิก', 'outline']],
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
          <div class="small muted desc">${esc(s.description)}</div>
          <div class="small">${baht(s.price)} · ${s.duration_min} นาที · ลำดับ ${s.sort}</div>
          <div class="tiny muted">${esc(s.category || '')}${s.kind === 'addon' ? ' · บริการเสริม' : ''}${s.stamps > 0 ? ` · <span style="color:var(--rose)">💗 +${s.stamps} แต้ม</span>` : ' · ไม่ได้แต้ม'}${Number(s.redeemable) ? ' · <span style="color:#a2742a">🎁 แลกแต้มได้</span>' : ''}</div></div>
        <button class="btn sm outline" data-edit="${s.id}">แก้ไข</button>
      </div>`).join('') || '<div class="empty">ยังไม่มีทรง</div>'}</div>`;
  $view().querySelector('#add').onclick = () => styleForm({ name: '', description: '', price: '', duration_min: 120, sort: st.styles.length + 1, active: 1, category: st.styles[0]?.category || 'ต่อขนตา (เลือกทรง)', kind: 'main', stamps: 0, redeemable: 0 });
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
    <label class="f">คำอธิบาย <span class="tiny muted">(กด Enter เพื่อขึ้นบรรทัดใหม่)</span></label><textarea class="input" id="desc" rows="3" maxlength="300">${esc(s.description)}</textarea>
    <div class="grid2">
      <div><label class="f">ราคา (บาท)</label><input class="input" id="price" type="number" min="0" value="${s.price}"></div>
      <div><label class="f">ใช้เวลา (นาที)</label><input class="input" id="dur" type="number" min="15" step="15" value="${s.duration_min}"></div>
      <div><label class="f">ลำดับการแสดง</label><input class="input" id="sort" type="number" value="${s.sort}"></div>
      <div><label class="f">สถานะ</label><select class="input" id="active"><option value="1">แสดง</option><option value="0" ${s.active ? '' : 'selected'}>ซ่อน</option></select></div>
      <div><label class="f">แลกฟรีด้วยแต้ม</label><select class="input" id="redeem"><option value="0">แลกไม่ได้</option><option value="1" ${Number(s.redeemable) ? 'selected' : ''}>🎁 แลกได้</option></select></div>
      <div><label class="f">แต้มสะสมที่ได้</label><select class="input" id="stamps">${[0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${Number(s.stamps || 0) === n ? 'selected' : ''}>${n ? `💗 +${n} แต้ม` : 'ไม่ได้แต้ม'}</option>`).join('')}</select></div>
    </div>`, {
    extraFoot: s.id ? '<button class="btn bad" id="del" style="flex:1">ลบ</button>' : '',
    onSave: async (d) => {
      await api(`/api/admin/styles${s.id ? '/' + s.id : ''}`, {
        method: s.id ? 'PUT' : 'POST',
        body: { name: val(d, '#name'), description: val(d, '#desc'), price: val(d, '#price'), duration_min: val(d, '#dur'), sort: val(d, '#sort'), active: val(d, '#active') === '1', image_id: imageId, category: val(d, '#cat'), kind: val(d, '#kind'), stamps: val(d, '#stamps'), redeemable: val(d, '#redeem') },
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

// =================================================================== reviews (อัลบั้มไฮไลต์ แสดงแบบสตอรี่ในหน้าจอง)
async function reviews() {
  const [{ albums }, { styles: list }] = await Promise.all([api('/api/admin/reviews'), api('/api/admin/styles')]);
  st.styles = list;
  if (!albums.find((a) => a.id === st.album)) st.album = albums[0]?.id || null;
  const cur = albums.find((a) => a.id === st.album);
  const styleName = (id) => list.find((s) => s.id === id)?.name || '';
  const cover = (a) => (a.photos[0] ? `<img src="${imgUrl(a.photos[0].image_id)}" alt="">` : '');

  $view().innerHTML = `
    <div class="row between"><b>อัลบั้มไฮไลต์</b><button class="btn sm ghost" id="newalbum">+ อัลบั้มใหม่</button></div>
    <div class="small muted mt">ลูกค้าเห็นเป็นวงกลมใต้หัวหน้าจอง แตะแล้วดูรูปแบบสตอรี่ (อัลบั้มที่ยังไม่มีรูปจะไม่แสดง)</div>
    <div class="hl-row mt">${albums.map((a) => `
      <button class="hl ${a.id === st.album ? 'on' : ''}" data-album="${a.id}">
        <span class="ring ${a.active ? '' : 'off'}"><span class="in">${cover(a)}</span></span>
        <span class="nm">${esc(a.name)}</span><span class="tiny muted">${a.photos.length} รูป${a.active ? '' : ' · ซ่อน'}</span>
      </button>`).join('') || '<div class="empty" style="padding:12px 0">ยังไม่มีอัลบั้ม กด "+ อัลบั้มใหม่" เช่น ขนตา / คิ้ว & ลิฟติ้ง / แชทรีวิว</div>'}</div>
    ${cur ? `
      <div class="card mt">
        <div class="row between"><b>${esc(cur.name)} · ${cur.photos.length} รูป</b>
          <div class="row" style="gap:6px"><button class="btn sm outline" id="editalbum">แก้ชื่อ/ซ่อน</button><button class="btn sm outline" id="delalbum">ลบ</button></div></div>
        <input type="file" accept="image/*" multiple id="files" class="hidden">
        <button class="btn mt" id="addphotos" style="width:100%">+ เพิ่มรูปในอัลบั้มนี้ (เลือกได้หลายรูป)</button>
        <div class="tiny muted mt">รูปแคปแชทรีวิว หรือรูปผลงานที่ลูกค้ายินยอมให้ลง · ระบบย่อรูปให้อัตโนมัติ</div>
        <div class="mt">${cur.photos.map((p, i) => `
          <div class="rv-item">
            <img class="rv-thumb" src="${imgUrl(p.image_id)}" alt="">
            <div class="grow"><b class="small">รูปที่ ${i + 1}</b>
              <div class="tiny muted">${esc(p.caption || '') || 'ไม่มีคำอธิบาย'}${p.style_id ? ` · ${esc(styleName(p.style_id))}` : ''}</div></div>
            <div class="rv-acts">
              <button class="btn sm outline" data-up="${i}" ${i ? '' : 'disabled'} aria-label="เลื่อนขึ้น">↑</button>
              <button class="btn sm outline" data-down="${i}" ${i < cur.photos.length - 1 ? '' : 'disabled'} aria-label="เลื่อนลง">↓</button>
              <button class="btn sm outline" data-ph="${p.id}">แก้</button>
            </div>
          </div>`).join('') || '<div class="empty" style="padding:14px 0">ยังไม่มีรูป</div>'}</div>
      </div>` : ''}`;

  $view().querySelectorAll('[data-album]').forEach((b) => (b.onclick = () => ((st.album = Number(b.dataset.album)), show())));
  $view().querySelector('#newalbum').onclick = () => dialog('อัลบั้มใหม่', `
    <label class="f">ชื่ออัลบั้ม (สั้น ๆ แสดงใต้วงกลม)</label><input class="input" id="an" maxlength="30" placeholder="เช่น ขนตา / คิ้ว & ลิฟติ้ง / แชทรีวิว">`, {
    onSave: async (d) => {
      const r = await api('/api/admin/review-albums', { method: 'POST', body: { name: val(d, '#an') } });
      st.album = r.id;
      show();
    },
  });
  if (!cur) return;
  $view().querySelector('#editalbum').onclick = () => dialog('แก้อัลบั้ม', `
    <label class="f">ชื่ออัลบั้ม</label><input class="input" id="an" maxlength="30" value="${esc(cur.name)}">
    <label class="f">การแสดงผล</label><select class="input" id="aa"><option value="1">แสดงในหน้าจอง</option><option value="0" ${cur.active ? '' : 'selected'}>ซ่อน</option></select>`, {
    onSave: async (d) => {
      await api('/api/admin/review-albums/' + cur.id, { method: 'PUT', body: { name: val(d, '#an'), active: val(d, '#aa') === '1' } });
      show();
    },
  });
  $view().querySelector('#delalbum').onclick = async () => {
    if (!confirm(`ลบอัลบั้ม "${cur.name}" และรูปทั้งหมด ${cur.photos.length} รูป? ลบแล้วกู้คืนไม่ได้`)) return;
    await api('/api/admin/review-albums/' + cur.id, { method: 'DELETE' });
    st.album = null;
    show();
  };
  const files = $view().querySelector('#files');
  $view().querySelector('#addphotos').onclick = () => files.click();
  files.onchange = async () => {
    const list = [...files.files];
    if (!list.length) return;
    const btn = $view().querySelector('#addphotos');
    btn.disabled = true;
    let done = 0;
    for (const f of list) {
      btn.textContent = `กำลังอัปโหลด ${done + 1}/${list.length}…`;
      try {
        const { dataUrl } = await loadImage(f, 1080, 0.82);
        await api('/api/admin/review-photos', { method: 'POST', body: { album_id: cur.id, image: dataUrl } });
        done++;
      } catch (e) {
        toast(errText(e));
      }
    }
    toast(`เพิ่มแล้ว ${done} รูป`);
    show();
  };
  const reorder = async (from, to) => {
    const ids = cur.photos.map((p) => p.id);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await api('/api/admin/review-photos/reorder', { method: 'POST', body: { ids } });
    show();
  };
  $view().querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => reorder(Number(b.dataset.up), Number(b.dataset.up) - 1)));
  $view().querySelectorAll('[data-down]').forEach((b) => (b.onclick = () => reorder(Number(b.dataset.down), Number(b.dataset.down) + 1)));
  $view().querySelectorAll('[data-ph]').forEach((b) => (b.onclick = () => {
    const p = cur.photos.find((x) => x.id === Number(b.dataset.ph));
    dialog('แก้รูปรีวิว', `
      <img src="${imgUrl(p.image_id)}" alt="" style="width:100%;max-height:300px;object-fit:contain;border-radius:12px;background:#f3eaf5">
      <label class="f">คำอธิบายสั้น ๆ (ถ้ามี)</label><input class="input" id="pc" maxlength="120" value="${esc(p.caption || '')}" placeholder="เช่น ทรงนี้ใส่ได้ทุกวัน">
      <label class="f">ทรงในรูป (ลูกค้ากด "จองทรงนี้" จากสตอรี่ได้)</label>
      <select class="input" id="ps"><option value="">ไม่ระบุ</option>${list.filter((s) => s.active).map((s) => `<option value="${s.id}" ${p.style_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`, {
      extraFoot: '<button class="btn bad" id="delph" style="flex:1">ลบ</button>',
      onSave: async (d) => {
        await api('/api/admin/review-photos/' + p.id, { method: 'PUT', body: { caption: val(d, '#pc'), style_id: val(d, '#ps') } });
        show();
      },
    });
    $dlg().querySelector('#delph').onclick = async () => {
      if (!confirm('ลบรูปนี้?')) return;
      await api('/api/admin/review-photos/' + p.id, { method: 'DELETE' });
      $dlg().close();
      show();
    };
  }));
}

// =================================================================== holidays & time blocks
async function holidays() {
  const [{ holidays: list }, { blocks }] = await Promise.all([api('/api/admin/holidays'), api('/api/admin/blocks')]);
  $view().innerHTML = `
    <div class="card">
      <b>⛔ ปิดรับคิวบางช่วงเวลา</b>
      <div class="small muted">เช่น ไปทำธุระ หรือรับลูกค้าที่จองผ่าน Facebook / โทร — ช่วงนี้ลูกค้าจะจองผ่าน LINE ไม่ได้</div>
      <div class="field mt"><label class="f">วันที่</label><input class="input" type="date" id="bd" min="${bkkToday()}" value="${bkkToday()}"></div>
      <div class="grid2">
        <div class="field"><label class="f">ตั้งแต่</label><select class="input" id="bs">${timeOptions('13:00')}</select></div>
        <div class="field"><label class="f">ถึง</label><select class="input" id="be">${timeOptions('15:00')}</select></div>
      </div>
      <div class="field"><label class="f">หมายเหตุ (เห็นเฉพาะแอดมิน)</label><input class="input" id="bn" maxlength="100" placeholder="เช่น ไปธุระ / ลูกค้า FB: คุณเอ ต่อขนตา"></div>
      <button class="btn mt" id="addblock">+ ปิดช่วงเวลานี้</button>
    </div>
    <div class="mt">${blocks.map((b) => `
      <div class="card row between"><div><b>${thaiDate(b.date)}</b> · ${b.start_time}–${b.end_time} น.
        ${b.note ? `<div class="small muted">${esc(b.note)}</div>` : ''}</div>
      <button class="btn sm outline" data-delblock="${b.id}">ลบ</button></div>`).join('') || '<div class="empty">ยังไม่มีช่วงที่ปิดไว้</div>'}</div>

    <div class="card mt2">
      <b>🏖️ วันหยุดทั้งวัน</b>
      <div class="grid2 mt">
        <div class="field"><label class="f">ตั้งแต่วันที่</label><input class="input" type="date" id="d1" min="${bkkToday()}"></div>
        <div class="field"><label class="f">ถึงวันที่ (ถ้าหยุดหลายวัน)</label><input class="input" type="date" id="d2"></div>
      </div>
      <div class="field"><label class="f">หมายเหตุ</label><input class="input" id="note" placeholder="เช่น หยุดสงกรานต์"></div>
      <button class="btn mt" id="add">+ เพิ่มวันหยุด</button>
    </div>
    <div class="mt">${list.map((h) => `
      <div class="card row between"><div><b>${thaiDate(h.date)}</b> <span class="small muted">${esc(h.note)}</span></div>
      <button class="btn sm outline" data-del="${h.date}">ลบ</button></div>`).join('') || '<div class="empty">ยังไม่มีวันหยุดพิเศษ</div>'}</div>`;
  $view().querySelector('#addblock').onclick = async (e) => {
    const body = { date: val($view(), '#bd'), start_time: val($view(), '#bs'), end_time: val($view(), '#be'), note: val($view(), '#bn') };
    if (!body.date) return toast('เลือกวันที่');
    if (body.start_time >= body.end_time) return toast('เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด');
    e.target.disabled = true;
    try {
      await api('/api/admin/blocks', { method: 'POST', body });
      toast('ปิดช่วงเวลาแล้ว ✅');
      show();
    } catch (err) {
      toast(errText(err));
      e.target.disabled = false;
    }
  };
  $view().querySelectorAll('[data-delblock]').forEach((b) => (b.onclick = async () => {
    if (!confirm('เปิดรับคิวช่วงนี้อีกครั้ง?')) return;
    await api('/api/admin/blocks/' + b.dataset.delblock, { method: 'DELETE' });
    show();
  }));
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
      <img src="assets/richmenu.jpg?v=1795017758" style="border-radius:10px;margin-top:10px" alt="">
      <div class="tiny muted mt">กดเพื่อตั้งเมนู จองคิว / แต้มสะสม &amp; คิวของฉัน เป็นเมนูหลักของ OA (แทนเมนูเดิม)</div>
      <button class="btn ghost mt" id="richmenu">ติดตั้ง Rich menu</button>
    </div>

    <div class="card mt2">
      <b>แอดมิน</b>
      <div class="tiny muted" style="margin-top:4px">🔔 = รับแจ้งเตือนคิวใหม่ / สลิปรอตรวจ ทาง LINE (1 ข้อความต่อคนต่อครั้ง)</div>
      ${adm.list.map((a) => `<div class="row between mt adminrow">
        <label class="switch grow" style="min-width:0"><input type="checkbox" data-notify="${esc(a.line_user_id)}" ${a.notify ? 'checked' : ''}> 🔔
          <span class="small" style="min-width:0"><b>${esc(a.name || '-')}</b> ${a.main ? '<span class="tag">แอดมินหลัก</span>' : ''}<br><span class="code">${esc(a.line_user_id)}</span></span></label>
        ${!a.main && a.line_user_id !== st.me.user.line_user_id ? `<button class="btn sm outline" data-rmadm="${a.line_user_id}">ลบ</button>` : ''}</div>`).join('')}
      <div class="tiny muted mt">แอดมินหลักกำหนดไว้ในระบบ ลบจากหน้านี้ไม่ได้ (กันร้านถูกล็อกออก)</div>
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
      await api('/api/admin/richmenu', { method: 'POST', body: { image_url: new URL('assets/richmenu.jpg?v=1795017758', location.href).href } });
      toast('ติดตั้ง Rich menu แล้ว ✅ เปิดแชท OA เพื่อดู');
    } catch (err) {
      toast(err.message === 'line_token_missing' ? 'ยังไม่ได้ใส่ LINE_CHANNEL_ACCESS_TOKEN ใน Cloudflare' : errText(err) + ' ' + (err.data?.detail || ''), 5000);
    } finally {
      e.target.disabled = false;
    }
  };
  $view().querySelectorAll('[data-notify]').forEach((cb) => (cb.onchange = async () => {
    const ids = [...$view().querySelectorAll('[data-notify]:checked')].map((x) => x.dataset.notify);
    try {
      // ไม่มีใครถูกเลือก = ปิดแจ้งเตือนแอดมินทั้งหมด
      await api('/api/admin/settings', { method: 'PUT', body: ids.length ? { notify_admin_ids: ids.join(','), notify_admins: 1 } : { notify_admins: 0 } });
      const nb = $view().querySelector('[data-kb="notify_admins"]');
      if (nb) nb.checked = ids.length > 0;
      toast(ids.length ? `แจ้งเตือน ${ids.length} คน` : 'ปิดแจ้งเตือนแอดมินแล้ว');
    } catch (e) {
      toast(errText(e));
    }
  }));
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

// =================================================================== โพสต์เพจ Facebook
const FB_STATUS = {
  draft: ['รออนุมัติ', 'fb-warn'], approved: ['อนุมัติแล้ว', 'fb-ok'], posted: ['โพสต์แล้ว', 'fb-ok'],
  failed: ['ไม่สำเร็จ', 'fb-bad'], skipped: ['ข้าม (ไม่ได้อนุมัติ)', 'fb-mute'],
};
const FB_SRC = { ai: 'ร่างโดย Gemini', fallback: 'คอนเทนต์สำรอง', empty: 'ยังไม่มีข้อความ' };
const DAY_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const fbPill = (s) => `<span class="fb-pill ${FB_STATUS[s]?.[1] || ''}">${FB_STATUS[s]?.[0] || s}</span>`;
const fbThumbs = (ids, cls = 'fb-th') => `<div class="fb-thumbs">${ids.map((id) => `<img class="${cls}" src="${imgUrl(id)}" alt="">`).join('')}</div>`;

async function fbpost() {
  st.fbsub ||= 'drafts';
  const data = await api('/api/admin/fb');
  st.fb = data;
  const sub = (k, l) => `<button class="tab ${st.fbsub === k ? 'on' : ''}" data-fbsub="${k}">${l}</button>`;
  $view().innerHTML = `<div class="tabs" style="margin-top:0">${sub('drafts', 'ร่างโพสต์')}${sub('schedule', 'ตารางโพสต์ & AI')}${sub('history', 'ประวัติ')}</div><div id="fbv"></div>`;
  $view().querySelectorAll('[data-fbsub]').forEach((b) => (b.onclick = () => ((st.fbsub = b.dataset.fbsub), fbpost().catch((e) => toast(errText(e))))));
  await { drafts: fbDrafts, schedule: fbSchedule, history: fbHistory }[st.fbsub]();
}
const $fbv = () => document.getElementById('fbv');

function fbStatusCard() {
  const { configured: c, page } = st.fb;
  const fbLine = !c.facebook ? '<span class="fb-bad-t">● ยังไม่ได้เชื่อมเพจ (ใส่ FB_PAGE_TOKEN ใน worker)</span>'
    : page?.error ? `<span class="fb-bad-t">● เชื่อมเพจไม่ได้: ${esc(page.error)}</span>` : `<span class="fb-ok-t">● เพจ ${esc(page?.name || '')} เชื่อมแล้ว</span>`;
  const aiLine = c.gemini ? '<span class="fb-ok-t">● Gemini พร้อมใช้</span>' : '<span class="fb-bad-t">● ยังไม่ได้ใส่ GEMINI_API_KEY (จะใช้คอนเทนต์สำรองแทน)</span>';
  return `<div class="card small"><div>${fbLine}</div><div>${aiLine}</div></div>`;
}

async function fbDrafts() {
  const { posts, schedules, today } = st.fb;
  const settings = (await api('/api/admin/settings')).settings;
  const mode = settings.fb_mode === 'auto' ? 'โพสต์อัตโนมัติ (ไม่ต้องอนุมัติ)' : 'อนุมัติก่อนโพสต์';
  const groups = {};
  for (const p of posts) (groups[p.date] ||= []).push(p);
  $fbv().innerHTML = `${fbStatusCard()}
    <div class="row between mt"><div class="small muted">โหมด: <b>${mode}</b> · ร่างอัตโนมัติทุกวัน ${esc(settings.fb_draft_time)} น.</div></div>
    ${schedules.some((s) => s.active) ? `<button class="btn ghost mt" id="fbgen" style="width:100%">✨ ร่างโพสต์ของวันนี้ตอนนี้</button>`
      : '<div class="empty">ยังไม่มีตารางโพสต์ ไปที่ "ตารางโพสต์ &amp; AI" เพื่อตั้งเวลาโพสต์ก่อน</div>'}
    ${Object.keys(groups).sort().map((d) => `<div class="section-title mt">${d === today ? 'วันนี้ · ' : ''}${esc(thaiDate(d))}</div>
      ${groups[d].map(fbCard).join('')}`).join('') || (schedules.some((s) => s.active) ? `<div class="empty">ยังไม่มีร่างของวันนี้ (ระบบร่างให้อัตโนมัติ ${esc(settings.fb_draft_time)} น.)</div>` : '')}`;
  $fbv().querySelector('#fbgen')?.addEventListener('click', async (ev) => {
    ev.target.disabled = true; ev.target.textContent = 'กำลังให้ AI ร่าง…';
    try {
      const r = await api('/api/admin/fb/generate', { method: 'POST' });
      toast(r.made.length ? `ร่างแล้ว ${r.made.length} โพสต์` : 'ร่างของวันนี้มีครบแล้ว');
      await fbpost();
    } catch (e) { toast(errText(e)); ev.target.disabled = false; }
  });
  $fbv().querySelectorAll('[data-fbedit]').forEach((b) => (b.onclick = () => fbEdit(posts.find((p) => p.id === Number(b.dataset.fbedit)))));
  $fbv().querySelectorAll('[data-fbregen]').forEach((b) => (b.onclick = () => fbRegen(Number(b.dataset.fbregen), '', b)));
  $fbv().querySelectorAll('[data-fbappr]').forEach((b) => (b.onclick = () => fbSetStatus(posts.find((p) => p.id === Number(b.dataset.fbappr)), b.dataset.to)));
  $fbv().querySelectorAll('[data-fbpub]').forEach((b) => (b.onclick = () => fbPublish(Number(b.dataset.fbpub), b)));
}

function fbCard(p) {
  const editable = !['posted'].includes(p.status);
  return `<div class="card fb-card">
    <div class="row" style="gap:8px"><b class="fb-time">${esc(p.time)}</b><span class="tag">${esc(p.theme || '-')}</span><span class="grow"></span>${fbPill(p.status)}</div>
    ${p.image_ids.length ? fbThumbs(p.image_ids) : ''}
    <div class="fb-text">${esc(p.text) || '<span class="muted">ยังไม่มีข้อความ กด "แก้" เพื่อเขียน หรือ "สร้างใหม่" ให้ AI ร่าง</span>'}</div>
    <div class="tiny muted">${FB_SRC[p.source] || ''}${p.price_ok ? ' · <span class="fb-ok-t">✓ ราคาตรงกับระบบ</span>' : ' · <span class="fb-bad-t">⚠ มีราคาที่ไม่ตรงกับระบบ ตรวจก่อนอนุมัติ</span>'}</div>
    ${p.error ? `<div class="tiny fb-bad-t">${esc(p.error)}</div>` : ''}
    ${editable ? `<div class="row fb-acts">
      <button class="btn sm outline" data-fbedit="${p.id}">✏️ แก้</button>
      <button class="btn sm ghost" data-fbregen="${p.id}">✨ สร้างใหม่</button>
      ${p.status === 'approved' ? `<button class="btn sm outline" data-fbappr="${p.id}" data-to="draft">ยกเลิกอนุมัติ</button>`
        : p.status === 'failed' ? `<button class="btn sm" data-fbpub="${p.id}">ลองโพสต์อีกครั้ง</button>`
        : `<button class="btn sm" data-fbappr="${p.id}" data-to="approved">✅ อนุมัติ</button>`}
    </div>` : p.fb_post_id ? `<a class="small" href="https://www.facebook.com/${esc(p.fb_post_id)}" target="_blank" rel="noopener">ดูโพสต์บน Facebook →</a>` : ''}
  </div>`;
}

async function fbSetStatus(p, status) {
  try {
    await api(`/api/admin/fb/posts/${p.id}`, { method: 'PUT', body: { status } });
    toast(status === 'approved' ? `อนุมัติแล้ว จะโพสต์เวลา ${p.time} น.` : 'ยกเลิกอนุมัติแล้ว');
    await fbpost();
  } catch (e) { toast(errText(e)); }
}

async function fbRegen(id, instruction, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'AI กำลังเขียน…'; }
  try {
    const r = await api(`/api/admin/fb/posts/${id}/regenerate`, { method: 'POST', body: { instruction, keep_images: !!instruction } });
    if (!instruction) { toast('สร้างร่างใหม่แล้ว'); await fbpost(); }
    return r.post;
  } catch (e) {
    toast(e.data?.detail ? `AI ไม่ตอบ: ${e.data.detail}` : errText(e));
    if (btn) { btn.disabled = false; btn.textContent = '✨ สร้างใหม่'; }
  }
}

async function fbPublish(id, btn) {
  if (!confirm('โพสต์ลงเพจตอนนี้เลยไหม?')) return;
  if (btn) btn.disabled = true;
  try {
    const r = await api(`/api/admin/fb/posts/${id}/publish`, { method: 'POST' });
    toast(r.ok ? 'โพสต์ลงเพจแล้ว ✅' : `โพสต์ไม่สำเร็จ: ${r.error}`);
    $dlg().open && $dlg().close();
    await fbpost();
  } catch (e) { toast(errText(e)); if (btn) btn.disabled = false; }
}

async function fbImagePool() {
  const [{ styles: list }, { albums }] = await Promise.all([api('/api/admin/styles'), api('/api/admin/reviews')]);
  const ids = [...list.filter((s) => s.image_id).map((s) => s.image_id), ...albums.flatMap((a) => a.photos.map((p) => p.image_id))];
  return [...new Set(ids)];
}

async function fbEdit(p) {
  const pool = await fbImagePool();
  let picked = [...p.image_ids];
  const chips = ['สั้นลง', 'เป็นกันเองขึ้น', 'เน้นโปร', 'เพิ่ม hashtag', 'ชวนจองคิวให้ชัดขึ้น'];
  const pickHtml = () => [...new Set([...picked, ...pool])].map((id) => {
    const n = picked.indexOf(id) + 1;
    return `<button type="button" class="fb-pick ${n ? 'on' : ''}" data-img="${esc(id)}"><img src="${imgUrl(id)}" alt="">${n ? `<span>${n}</span>` : ''}</button>`;
  }).join('');
  const d = dialog(`แก้โพสต์ ${esc(p.time)} · ${esc(p.theme)}`, `
    <label class="f" for="fbt">ข้อความ</label>
    <textarea class="input" id="fbt" rows="8">${esc(p.text)}</textarea>
    <div class="tiny muted mt">✨ ให้ AI ปรับ</div>
    <div class="row mt" style="gap:6px;flex-wrap:wrap">${chips.map((c) => `<button type="button" class="chip-btn" data-ai="${esc(c)}">${c}</button>`).join('')}</div>
    <label class="f mt">รูป (เลือกได้สูงสุด 4 · เรียงตามตัวเลข)</label>
    <div class="fb-pickgrid" id="fbpick">${pickHtml()}</div>`, {
    saveText: 'บันทึก + อนุมัติ',
    extraFoot: `<button class="btn outline" data-only style="flex:1">บันทึก</button>`,
    onSave: async (dd) => {
      await api(`/api/admin/fb/posts/${p.id}`, { method: 'PUT', body: { text: val(dd, '#fbt'), image_ids: picked, status: 'approved' } });
      toast(`อนุมัติแล้ว จะโพสต์เวลา ${p.time} น.`);
      await fbpost();
    },
  });
  const bindPick = () => d.querySelectorAll('[data-img]').forEach((b) => (b.onclick = () => {
    const id = b.dataset.img;
    if (picked.includes(id)) picked = picked.filter((x) => x !== id);
    else if (picked.length < 4) picked.push(id);
    else return toast('เลือกได้สูงสุด 4 รูป');
    d.querySelector('#fbpick').innerHTML = pickHtml();
    bindPick();
  }));
  bindPick();
  d.querySelector('[data-only]').onclick = async () => {
    try {
      await api(`/api/admin/fb/posts/${p.id}`, { method: 'PUT', body: { text: val(d, '#fbt'), image_ids: picked, status: 'draft' } });
      d.close(); toast('บันทึกแล้ว'); await fbpost();
    } catch (e) { toast(errText(e)); }
  };
  d.querySelectorAll('[data-ai]').forEach((b) => (b.onclick = async () => {
    await api(`/api/admin/fb/posts/${p.id}`, { method: 'PUT', body: { text: val(d, '#fbt'), image_ids: picked, status: 'draft' } });
    const label = b.textContent; b.disabled = true; b.textContent = 'กำลังปรับ…';
    const np = await fbRegen(p.id, b.dataset.ai);
    b.disabled = false; b.textContent = label;
    if (np) { d.querySelector('#fbt').value = np.text; toast(np.price_ok ? 'ปรับแล้ว' : '⚠ ปรับแล้ว แต่มีราคาที่ไม่ตรงกับระบบ'); }
  }));
}

async function fbSchedule() {
  const { schedules, themes, fallbacks } = st.fb;
  const s = (await api('/api/admin/settings')).settings;
  const on = new Set(s.fb_themes.split(',').map((t) => t.trim()));
  $fbv().innerHTML = `
    <div class="section-title">เวลาโพสต์</div>
    ${schedules.map((x) => `<div class="card row fb-sched">
      <b class="fb-time">${esc(x.time)}</b>
      <div class="grow"><div class="small"><b>${x.days.length === 7 ? 'ทุกวัน' : x.days.map((d) => DAY_SHORT[d]).join(' · ')}</b></div>
        <div class="tiny muted">${x.theme ? `ธีม: ${esc(x.theme)}` : 'ธีมหมุนเวียน'}${x.active ? '' : ' · ปิดอยู่'}</div></div>
      <button class="btn sm outline" data-sched="${x.id}">แก้</button></div>`).join('') || '<div class="empty" style="padding:12px 0">ยังไม่มีเวลาโพสต์</div>'}
    <button class="btn ghost" id="addsched" style="width:100%">+ เพิ่มเวลาโพสต์</button>

    <div class="section-title mt">ตั้งค่า AI</div>
    <div class="card">
      <label class="f">โหมด</label>
      <select class="input" id="fbmode"><option value="approve" ${s.fb_mode !== 'auto' ? 'selected' : ''}>อนุมัติก่อนโพสต์ (แนะนำ)</option><option value="auto" ${s.fb_mode === 'auto' ? 'selected' : ''}>โพสต์อัตโนมัติ ไม่ต้องอนุมัติ</option></select>
      <label class="f">ธีมที่ให้ AI หมุนเวียน</label>
      <div class="row" style="gap:6px;flex-wrap:wrap">${themes.map((t) => `<label class="chip-btn"><input type="checkbox" data-theme="${esc(t)}" ${on.has(t) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>
      <label class="f" for="fbtone">โทนภาษาของร้าน</label><textarea class="input" id="fbtone" rows="2">${esc(s.fb_tone)}</textarea>
      <div class="row" style="gap:10px">
        <div class="grow"><label class="f" for="fbdraft">ร่างล่วงหน้าทุกวันเวลา</label><input class="input" type="time" id="fbdraft" value="${esc(s.fb_draft_time)}"></div>
        <div class="grow"><label class="f" for="fbmodel">โมเดล Gemini</label><input class="input" id="fbmodel" value="${esc(s.fb_model)}"></div>
      </div>
      <button class="btn mt" id="savefb" style="width:100%">บันทึกตั้งค่า AI</button>
    </div>

    <div class="section-title mt">คอนเทนต์สำรอง (${fallbacks.length})</div>
    <div class="small muted">ใช้แทนเมื่อ AI ใช้ไม่ได้ เช่น โควต้าฟรีหมด</div>
    ${fallbacks.map((f) => `<div class="card row"><div class="grow fb-text small" style="max-height:80px">${esc(f.text)}</div><button class="btn sm outline" data-delfb="${f.id}">ลบ</button></div>`).join('')}
    <button class="btn ghost mt" id="addfb" style="width:100%">+ เพิ่มคอนเทนต์สำรอง</button>`;

  $fbv().querySelector('#addsched').onclick = () => fbSchedForm();
  $fbv().querySelectorAll('[data-sched]').forEach((b) => (b.onclick = () => fbSchedForm(schedules.find((x) => x.id === Number(b.dataset.sched)))));
  $fbv().querySelector('#savefb').onclick = async () => {
    const th = [...$fbv().querySelectorAll('[data-theme]:checked')].map((c) => c.dataset.theme);
    if (!th.length) return toast('เลือกธีมอย่างน้อย 1 ธีม');
    try {
      await api('/api/admin/settings', { method: 'PUT', body: { fb_mode: val($fbv(), '#fbmode'), fb_themes: th.join(','), fb_tone: val($fbv(), '#fbtone'), fb_draft_time: val($fbv(), '#fbdraft') || '07:00', fb_model: val($fbv(), '#fbmodel') || 'gemini-flash-latest' } });
      toast('บันทึกแล้ว');
    } catch (e) { toast(errText(e)); }
  };
  $fbv().querySelector('#addfb').onclick = () => dialog('คอนเทนต์สำรอง', `<label class="f" for="fbft">ข้อความ</label><textarea class="input" id="fbft" rows="7" placeholder="เขียนโพสต์ที่ใช้ได้ทุกเมื่อ เช่น แนะนำร้าน + ลิงก์จองคิว"></textarea>`, {
    onSave: async (d) => { await api('/api/admin/fb/fallbacks', { method: 'POST', body: { text: val(d, '#fbft') } }); await fbpost(); },
  });
  $fbv().querySelectorAll('[data-delfb]').forEach((b) => (b.onclick = async () => {
    if (!confirm('ลบคอนเทนต์สำรองนี้?')) return;
    await api(`/api/admin/fb/fallbacks/${b.dataset.delfb}`, { method: 'DELETE' }); await fbpost();
  }));
}

function fbSchedForm(x) {
  const days = new Set(x ? x.days : [0, 1, 2, 3, 4, 5, 6]);
  dialog(x ? 'แก้เวลาโพสต์' : 'เพิ่มเวลาโพสต์', `
    <label class="f" for="sct">เวลา</label><input class="input" type="time" id="sct" value="${esc(x?.time || '10:00')}">
    <label class="f">วัน</label>
    <div class="row" style="gap:6px;flex-wrap:wrap">${DAY_SHORT.map((l, i) => `<label class="chip-btn"><input type="checkbox" data-day="${i}" ${days.has(i) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    <label class="f" for="scth">ธีม</label>
    <select class="input" id="scth"><option value="">หมุนเวียนตามตั้งค่า AI</option>${st.fb.themes.map((t) => `<option ${x?.theme === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    <label class="row mt" style="gap:8px"><input type="checkbox" id="scon" ${!x || x.active ? 'checked' : ''}> เปิดใช้</label>`, {
    extraFoot: x ? '<button class="btn outline" data-del style="flex:1">ลบ</button>' : '',
    onSave: async (d) => {
      const body = { time: val(d, '#sct'), days: [...d.querySelectorAll('[data-day]:checked')].map((c) => Number(c.dataset.day)), theme: val(d, '#scth'), active: d.querySelector('#scon').checked };
      await api(x ? `/api/admin/fb/schedules/${x.id}` : '/api/admin/fb/schedules', { method: x ? 'PUT' : 'POST', body });
      await fbpost();
    },
  });
  $dlg().querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm('ลบเวลาโพสต์นี้?')) return;
    await api(`/api/admin/fb/schedules/${x.id}`, { method: 'DELETE' }); $dlg().close(); await fbpost();
  });
}

async function fbHistory() {
  const { posts } = await api('/api/admin/fb/history');
  $fbv().innerHTML = posts.map((p) => `<div class="card row fb-hist">
    ${p.image_ids[0] ? `<img class="fb-th" src="${imgUrl(p.image_ids[0])}" alt="">` : '<div class="fb-th"></div>'}
    <div class="grow" style="min-width:0">
      <div class="row" style="gap:6px"><b class="small">${esc(thaiDate(p.date))} · ${esc(p.time)}</b><span class="tag">${esc(p.theme)}</span><span class="grow"></span>${fbPill(p.status)}</div>
      <div class="tiny muted fb-one">${esc(p.text)}</div>
      ${p.fb_post_id ? `<a class="tiny" href="https://www.facebook.com/${esc(p.fb_post_id)}" target="_blank" rel="noopener">ดูบน Facebook →</a>` : p.error ? `<div class="tiny fb-bad-t">${esc(p.error)}</div>` : ''}
    </div></div>`).join('') || '<div class="empty">ยังไม่มีประวัติ</div>';
}
