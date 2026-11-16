import {
  STATUS, addDays, api, baht, bkkTime, dayName, errText, esc, imgUrl, initLiff, loadImage, monthShort,
  profile, promoRange, promoText, readSlipQR, thaiDate, toast, weekday,
} from './core.js?v=1794863268';
import { promptPayPayload } from './promptpay.js?v=1794863268';

const $app = document.getElementById('app');
const $bar = document.getElementById('bar');

const state = {
  info: null, // public info
  me: null, // {user, is_admin, stamps_required}
  cart: [], // style ids, one per person
  date: null,
  time: null,
  useReward: false,
  quote: null,
  form: { name: '', phone: '', note: '' },
};

// ------------------------------------------------------------------ boot
(async function boot() {
  try {
    await initLiff();
    const [info, me] = await Promise.all([api('/api/public/info'), api('/api/me')]);
    state.info = info;
    state.me = me;
    state.form.name = me.user.display_name || profile?.displayName || '';
    state.form.phone = me.user.phone || '';
    document.title = info.settings.shop_name;

    const qs = new URLSearchParams(location.search);
    const p = qs.get('p');
    if (p === 'pay' && qs.get('code')) location.hash = '#/pay/' + qs.get('code');
    else if (p === 'my') location.hash = '#/my';
    else if (p === 'promos') location.hash = '#/promos';
    window.addEventListener('hashchange', render);
    render();
  } catch (e) {
    console.error(e);
    $app.innerHTML = `<div class="empty">โหลดไม่สำเร็จ<br><span class="small">${esc(e.message)} ${esc(e.data?.detail || '')}</span><br><br><button class="btn sm" onclick="sessionStorage.clear();location.reload()">ลองใหม่</button></div>`;
  }
})();

function render() {
  const [, view, arg] = (location.hash || '#/').split('/');
  window.scrollTo(0, 0);
  $bar.classList.add('hidden');
  if (view === 'book') return state.cart.length ? viewBook() : go('#/');
  if (view === 'pay') return viewPay(arg);
  if (view === 'my') return viewMy();
  if (view === 'promos') return viewPromos();
  return viewHome();
}
const go = (h) => (location.hash = h);
const styleById = (id) => state.info.styles.find((s) => s.id === Number(id));
const isAddon = (id) => styleById(id)?.kind === 'addon';
const peopleCount = () => state.cart.filter((id) => !isAddon(id)).length;
/** 'คนที่ 1', 'คนที่ 2', '+ เสริม' */
const itemLabels = (items) => {
  let n = 0;
  return items.map((it) => (it.kind === 'addon' ? '+ เสริม' : `คนที่ ${++n}`));
};
const policyList = (text) => {
  const lines = String(text || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
  return lines.length ? `<ul class="policy">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '';
};

// ------------------------------------------------------------------ home
function viewHome() {
  const { settings, styles, promotions } = state.info;
  const u = state.me.user;
  const req = state.me.stamps_required;
  const nowPromos = promotions.filter((p) => !p.start_date || p.start_date <= state.info.today);

  $app.innerHTML = `
    <section class="hero">
      <div class="row">
        <img class="logo" src="assets/logo.jpg" alt="${esc(settings.shop_name)}">
        <div class="grow">
          <h1 class="brand">${esc(settings.shop_name)}</h1>
          <div class="small muted">สวัสดีค่ะ คุณ${esc(u.display_name || profile?.displayName || '')}</div>
        </div>
        ${profile?.pictureUrl ? `<img class="avatar" src="${esc(profile.pictureUrl)}" alt="">` : ''}
      </div>
      <div class="row mt wrapflex">
        <button class="chip-btn" data-go="#/my">💗 แต้มสะสม ${u.stamps}/${req}</button>
        <button class="chip-btn" data-go="#/my">📅 คิวของฉัน</button>
        ${promotions.length ? `<button class="chip-btn" data-go="#/promos">🎀 โปรโมชั่น</button>` : ''}
        ${state.me.is_admin ? `<a class="chip-btn" href="admin.html${location.search.includes('dev=') ? location.search : ''}" style="text-decoration:none;color:inherit">⚙️ แอดมิน</a>` : ''}
      </div>
    </section>

    ${nowPromos.map((p) => `
      <div class="promo"><div class="t">🎀 ${esc(p.name)}</div><div class="d">${esc(promoText(p, styles))}${promoRange(p) ? ' · ' + esc(promoRange(p)) : ''}</div></div>`).join('')}

    ${u.stamps >= req ? `<div class="card mt" style="background:#fff8ec">🎁 <b>คุณมีสิทธิ์ต่อขนตาฟรี 1 ทรง!</b><div class="small muted">เลือกใช้สิทธิ์ได้ในขั้นตอนเลือกวันเวลา</div></div>` : ''}

    <div class="section-title">เลือกบริการ</div>
    <p class="small muted" style="margin-top:-6px">ต่อขนตาใช้เวลาประมาณ 2 ชั่วโมง · มากับเพื่อน? เลือกให้เพื่อนเพิ่มได้ (สูงสุด ${settings.max_people} คน)</p>
    ${groupByCategory(styles).map(([cat, list]) => `
      <div class="cat-title">${esc(cat)}</div>
      <div class="styles">${list.map(styleCard).join('')}</div>`).join('')}
    ${styles.length ? '' : '<div class="empty">ยังไม่มีทรงให้เลือก</div>'}
    ${settings.shop_address || settings.shop_phone ? `<p class="center small muted mt2">${esc(settings.shop_address)}<br>${esc(settings.shop_phone)}</p>` : ''}
  `;
  bindGo();
  $app.querySelectorAll('[data-add]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = Number(b.dataset.add);
      if (!isAddon(id) && peopleCount() >= settings.max_people) return toast(`เลือกได้สูงสุด ${settings.max_people} คน`);
      state.cart.push(id);
      state.time = null;
      viewHome();
      toast(isAddon(id) ? 'เพิ่มบริการเสริมแล้ว' : `เพิ่มคนที่ ${peopleCount()} แล้ว`);
    }),
  );
  renderCartBar();
}

function groupByCategory(list) {
  const map = new Map();
  for (const st of list) {
    const k = st.category || 'บริการ';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(st);
  }
  return [...map.entries()];
}

function styleCard(s) {
  const n = state.cart.filter((x) => x === s.id).length;
  const addon = s.kind === 'addon';
  return `
    <div class="style rel ${n ? 'sel' : ''} ${addon ? 'addon' : ''}">
      ${s.image_id ? `<img class="ph" src="${imgUrl(s.image_id)}" alt="${esc(s.name)}" loading="lazy">` : `<div class="ph">${addon ? '✨' : '👁️'}</div>`}
      ${n ? `<span class="badge-n">${n}</span>` : ''}
      <div class="b">
        <div class="n">${esc(s.name)}</div>
        ${s.description ? `<div class="tiny muted">${esc(s.description)}</div>` : ''}
        <div class="p">${baht(s.price)}</div>
        <button class="btn sm ghost add" data-add="${s.id}">${addon ? '+ เพิ่มบริการนี้' : '+ เลือก'}</button>
      </div>
    </div>`;
}

function renderCartBar() {
  if (!state.cart.length) return $bar.classList.add('hidden');
  $bar.classList.remove('hidden');
  const total = state.cart.reduce((a, id) => a + (styleById(id)?.price || 0), 0);
  $bar.innerHTML = `
    <div class="in" style="flex-direction:column;align-items:stretch;gap:10px">
      <div class="cart">
        ${((labels) => state.cart.map((id, i) => `<span class="c">${labels[i]}: ${esc(styleById(id)?.name)} <button data-rm="${i}" aria-label="ลบ">×</button></span>`).join(''))(itemLabels(state.cart.map((id) => ({ kind: styleById(id)?.kind }))))}
      </div>
      <div class="row">
        <div class="grow"><div class="tiny muted">${Math.max(1, peopleCount())} คน · ราคาปกติ</div><b>${baht(total)}</b></div>
        <button class="btn" id="next">เลือกวันเวลา →</button>
      </div>
    </div>`;
  $bar.querySelectorAll('[data-rm]').forEach((b) =>
    b.addEventListener('click', () => {
      state.cart.splice(Number(b.dataset.rm), 1);
      state.time = null;
      viewHome();
    }),
  );
  $bar.querySelector('#next').addEventListener('click', () => go('#/book'));
}

// ------------------------------------------------------------------ book (date/time/form)
function openDates() {
  const { settings, hours, holidays, today } = state.info;
  const hol = new Set(holidays.map((h) => h.date));
  const out = [];
  for (let i = 0; i <= settings.booking_days_ahead; i++) {
    const d = addDays(today, i);
    const h = hours.find((x) => x.weekday === weekday(d));
    out.push({ date: d, open: !!h && !h.closed && !hol.has(d)});
  }
  return out;
}

async function viewBook() {
  const dates = openDates();
  if (!state.date || !dates.find((d) => d.date === state.date && d.open)) state.date = dates.find((d) => d.open)?.date || null;
  const canReward = state.me.user.stamps >= state.me.stamps_required;

  $app.innerHTML = `
    <button class="back" data-go="#/">← กลับไปเลือกทรง</button>
    <div class="section-title" style="margin-top:6px">เลือกวัน</div>
    <div class="dates" id="dates">
      ${dates.map((d) => `
        <button class="date ${d.date === state.date ? 'sel' : ''}" data-date="${d.date}" ${d.open ? '' : 'disabled'}>
          <div class="w">${dayName(weekday(d.date))}</div><div class="d">${Number(d.date.slice(8))}</div><div class="m">${d.open ? monthShort(d.date) : 'ปิด'}</div>
        </button>`).join('')}
    </div>
    <div class="section-title">เลือกเวลา <span class="small muted" id="dur"></span></div>
    <div id="slots"><div class="spinner"></div></div>

    <div class="section-title">ข้อมูลผู้จอง</div>
    <div class="card">
      <label class="f">ชื่อ</label>
      <input class="input" id="name" value="${esc(state.form.name)}" maxlength="80" />
      <label class="f">เบอร์โทร</label>
      <input class="input" id="phone" value="${esc(state.form.phone)}" inputmode="tel" maxlength="15" placeholder="08xxxxxxxx" />
      <label class="f">หมายเหตุ (ถ้ามี)</label>
      <textarea class="input" id="note" rows="2" maxlength="300" placeholder="เช่น แพ้กาว, ขอช่างคนเดิม">${esc(state.form.note)}</textarea>
    </div>
    ${canReward ? `
      <label class="check mt"><input type="checkbox" id="reward" ${state.useReward ? 'checked' : ''}/>
        <div><b>🎁 ใช้สิทธิ์ฟรี 1 ทรง</b><div class="tiny muted">ใช้ ${state.me.stamps_required} แต้ม (คุณมี ${state.me.user.stamps})</div></div></label>` : ''}

    <div class="section-title">สรุปราคา</div>
    <div class="card" id="summary"><div class="spinner"></div></div>
    <div class="mt"><b class="small">เงื่อนไขการจอง</b>${policyList(state.info.settings.policy_text)}</div>
  `;
  bindGo();
  $app.querySelectorAll('[data-date]').forEach((b) =>
    b.addEventListener('click', () => {
      state.date = b.dataset.date;
      state.time = null;
      $app.querySelectorAll('[data-date]').forEach((x) => x.classList.toggle('sel', x === b));
      loadSlots();
      loadQuote();
    }),
  );
  for (const k of ['name', 'phone', 'note']) $app.querySelector('#' + k).addEventListener('input', (e) => (state.form[k] = e.target.value));
  $app.querySelector('#reward')?.addEventListener('change', (e) => {
    state.useReward = e.target.checked;
    loadQuote();
  });
  $app.querySelector('.date.sel')?.scrollIntoView({ inline: 'center', block: 'nearest' });

  $bar.classList.remove('hidden');
  $bar.innerHTML = `<div class="in"><div class="grow"><div class="tiny muted" id="barinfo">เลือกเวลา</div><b id="bartotal"></b></div><button class="btn" id="confirm" disabled>ยืนยันการจอง</button></div>`;
  $bar.querySelector('#confirm').addEventListener('click', submitBooking);

  if (!state.date) {
    $app.querySelector('#slots').innerHTML = '<div class="empty">ไม่มีวันว่างในช่วงนี้</div>';
    return;
  }
  loadSlots();
  loadQuote();
}

async function loadSlots() {
  const el = $app.querySelector('#slots');
  el.innerHTML = '<div class="spinner"></div>';
  try {
    const r = await api(`/api/slots?date=${state.date}&styles=${state.cart.join(',')}`);
    const hrs = state.cart.reduce((a, id) => a + (styleById(id)?.duration_min || 120), 0) / 60;
    $app.querySelector('#dur').textContent = `(ใช้เวลาประมาณ ${hrs} ชม.)`;
    if (r.closed || !r.slots.length) {
      el.innerHTML = `<div class="empty">${r.reason === 'holiday' ? 'ร้านหยุดวันนี้' : 'ไม่มีเวลาว่างในวันนี้'}</div>`;
      return;
    }
    el.innerHTML = `<div class="slots">${r.slots.map((s) => `<button class="slot ${s.time === state.time ? 'sel' : ''}" data-time="${s.time}" ${s.available ? '' : 'disabled'}>${s.time}</button>`).join('')}</div>
      ${r.slots.some((s) => s.available) ? '' : '<div class="empty">เต็มทุกช่วงเวลา ลองเลือกวันอื่นนะคะ</div>'}`;
    el.querySelectorAll('[data-time]').forEach((b) =>
      b.addEventListener('click', () => {
        state.time = b.dataset.time;
        el.querySelectorAll('[data-time]').forEach((x) => x.classList.toggle('sel', x === b));
        const slot = r.slots.find((s) => s.time === state.time);
        $bar.querySelector('#barinfo').textContent = `${thaiDate(state.date)} · ${slot.time}–${slot.end} น.`;
        $bar.querySelector('#confirm').disabled = false;
      }),
    );
  } catch (e) {
    el.innerHTML = `<div class="empty">${esc(errText(e))}</div>`;
  }
}

async function loadQuote() {
  const el = $app.querySelector('#summary');
  try {
    const q = await api('/api/quote', { method: 'POST', body: { date: state.date, style_ids: state.cart, use_reward: state.useReward } });
    state.quote = q;
    el.innerHTML = `
      ${((labels) => q.items.map((it, i) => `
        <div class="line"><div>${labels[i]} · ${esc(it.name)}
          ${it.promotion ? `<div><span class="tag">${esc(it.promotion.name)}</span></div>` : ''}
          ${it.reward ? `<div><span class="tag" style="background:#fff3d6;color:#a2742a">ฟรีจากแต้มสะสม</span></div>` : ''}</div>
          <div class="center">${it.price !== it.base_price ? `<span class="strike small">${baht(it.base_price)}</span><br>` : ''}<b>${baht(it.price)}</b></div></div>`).join(''))(itemLabels(q.items))}
      ${q.discount ? `<div class="line small"><span class="muted">ส่วนลด</span><span style="color:var(--ok)">−${baht(q.discount)}</span></div>` : ''}
      <div class="line total"><span>ยอดรวม</span><span>${baht(q.total)}</span></div>
      <div class="line small"><span class="muted">มัดจำวันนี้</span><b style="color:var(--rose)">${baht(q.deposit_amount)}</b></div>
      <div class="line small"><span class="muted">ชำระที่ร้าน</span><span>${baht(q.total - q.deposit_amount)}</span></div>
      ${q.hints.map((h) => `<div class="tiny mt" style="color:var(--rose)">💡 มากับเพื่อนอีก ${h.need_people - Math.max(1, peopleCount())} คน ได้โปร "${esc(h.name)}"</div>`).join('')}
    `;
    $bar.querySelector('#bartotal').textContent = `${baht(q.total)} · มัดจำ ${baht(q.deposit_amount)}`;
  } catch (e) {
    el.innerHTML = `<div class="empty">${esc(errText(e))}</div>`;
  }
}

async function submitBooking() {
  const btn = $bar.querySelector('#confirm');
  if (!state.time) return toast('กรุณาเลือกเวลา');
  if (!state.form.name.trim()) return toast('กรุณากรอกชื่อ');
  if (state.form.phone.replace(/\D/g, '').length < 9) return toast('กรุณากรอกเบอร์โทร');
  btn.disabled = true;
  btn.textContent = 'กำลังจอง…';
  try {
    const { booking } = await api('/api/bookings', {
      method: 'POST',
      body: {
        date: state.date, time: state.time, style_ids: state.cart, use_reward: state.useReward,
        customer_name: state.form.name, phone: state.form.phone, note: state.form.note,
      },
    });
    await sendToChat(booking);
    state.cart = [];
    state.time = null;
    state.useReward = false;
    if (booking.use_reward) state.me.user.stamps -= state.me.stamps_required;
    go('#/pay/' + booking.code);
  } catch (e) {
    toast(errText(e), 3500);
    if (e.message === 'has_pending_booking' && e.data?.code) go('#/pay/' + e.data.code);
    else if (e.message === 'slot_unavailable') loadSlots();
    btn.disabled = false;
    btn.textContent = 'ยืนยันการจอง';
  }
}

/** ส่งรูปทรงขนตา + รายละเอียดการจองเข้าแชท LINE OA (ต้องเปิดจากในแชท และมี scope chat_message.write) */
async function sendToChat(b) {
  if (!window.liff || !liff.isInClient?.()) return;
  const ctx = liff.getContext?.();
  if (!ctx || ctx.type === 'none' || ctx.type === 'external') return;
  const images = [...new Set(b.items.map((i) => i.image_id).filter(Boolean))].slice(0, 4);
  const lines = [
    `📌 จองคิวต่อขนตา`,
    `รหัส: ${b.code}`,
    ...((labels) => b.items.map((it, i) => `${labels[i]}: ${it.name}${it.reward ? ' (ฟรี)' : ''} ${baht(it.price)}`))(itemLabels(b.items)),
    `วันที่: ${thaiDate(b.date)}`,
    `เวลา: ${b.start_time}–${b.end_time} น.`,
    `ยอดรวม: ${baht(b.total)} (มัดจำ ${baht(b.deposit_amount)})`,
  ];
  if (b.note) lines.push(`หมายเหตุ: ${b.note}`);
  const msgs = images.map((id) => ({ type: 'image', originalContentUrl: imgUrl(id), previewImageUrl: imgUrl(id) }));
  msgs.push({ type: 'text', text: lines.join('\n') });
  try {
    await liff.sendMessages(msgs);
  } catch (e) {
    console.warn('sendMessages failed', e);
  }
}

// ------------------------------------------------------------------ pay
let countdownTimer;
async function viewPay(code) {
  clearInterval(countdownTimer);
  $app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  let b;
  try {
    b = (await api('/api/bookings/' + encodeURIComponent(code))).booking;
  } catch (e) {
    $app.innerHTML = `<div class="empty">ไม่พบการจอง<br><button class="btn sm mt" onclick="location.hash='#/'">กลับหน้าแรก</button></div>`;
    return;
  }
  const s = state.info.settings;
  const pending = b.status === 'pending_deposit';

  $app.innerHTML = `
    <button class="back" data-go="#/my">← คิวของฉัน</button>
    <div class="card">
      <div class="row between"><b>รหัส ${esc(b.code)}</b><span class="st ${b.status}">${STATUS[b.status]}</span></div>
      <div class="mt">📅 ${thaiDate(b.date)} · ${b.start_time}–${b.end_time} น.</div>
      ${((labels) => b.items.map((it, i) => `<div class="line small"><span>${labels[i]} · ${esc(it.name)}</span><span>${it.reward ? 'ฟรี' : baht(it.price)}</span></div>`).join(''))(itemLabels(b.items))}
      <div class="line total"><span>ยอดรวม</span><span>${baht(b.total)}</span></div>
      ${b.deposit_amount ? `<div class="line small"><span class="muted">มัดจำ</span><span>${baht(b.deposit_amount)}</span></div>
      <div class="line small"><span class="muted">ชำระที่ร้าน</span><span>${baht(b.total - b.deposit_amount)}</span></div>` : ''}
    </div>

    ${pending ? `
      <div class="card center mt">
        <div class="small muted">โอนมัดจำผ่านพร้อมเพย์</div>
        <div class="big">${baht(b.deposit_amount)}</div>
        ${s.promptpay_id ? `<div class="qr" id="qr"></div>
          <div class="tiny muted">QR นี้ใส่ยอด ${baht(b.deposit_amount)} ไว้ให้แล้ว · กดค้างเพื่อบันทึกรูป แล้วสแกนจากแอปธนาคาร</div>` : ''}
        ${s.bank_account_no || s.promptpay_name ? `<div class="bankbox small">
          ${s.bank_name ? `<div>ธนาคาร: <b>${esc(s.bank_name)}</b></div>` : ''}
          ${s.bank_account_no ? `<div>เลขบัญชี: <b>${esc(s.bank_account_no)}</b> <button class="chip-btn" id="copyacc" style="padding:2px 8px">คัดลอก</button></div>` : ''}
          ${s.promptpay_name ? `<div>ชื่อบัญชี: <b>${esc(s.promptpay_name)}</b></div>` : ''}
        </div>` : ''}
        ${!s.promptpay_id && !s.bank_account_no ? `<div class="small muted">ร้านยังไม่ได้ตั้งค่าบัญชีรับเงิน กรุณาติดต่อร้าน</div>` : ''}
        ${b.expires_at ? `<div class="small mt" style="color:var(--rose)">⏰ กรุณาโอนภายใน ${bkkTime(b.expires_at)} น. <span id="cd"></span></div>` : ''}
        ${b.slip_note ? `<div class="result bad small">${esc(b.slip_note)}</div>` : ''}
        <input type="file" accept="image/*" id="slip" class="hidden" />
        <button class="btn mt" id="up">📎 อัปโหลดสลิป</button>
        <div class="tiny muted mt">หรือส่งรูปสลิปในแชท LINE ของร้านก็ได้ค่ะ</div>
        <div id="res"></div>
      </div>
      <div class="card mt"><b class="small">เงื่อนไขการจอง</b>${policyList(s.policy_text)}</div>
      <button class="btn outline mt" id="cancel">ยกเลิกการจองนี้</button>` : ''}

    ${b.status === 'verifying' ? `<div class="result wait">🧾 ได้รับสลิปแล้ว แอดมินกำลังตรวจสอบ จะแจ้งผลทาง LINE ค่ะ</div>` : ''}
    ${b.status === 'confirmed' ? `<div class="result ok">✅ ยืนยันคิวเรียบร้อย แล้วพบกันนะคะ 💕</div>` : ''}
    ${b.status === 'cancelled' ? `<div class="result bad">คิวนี้ถูกยกเลิก${b.admin_note ? ' — ' + esc(b.admin_note) : ''}</div>` : ''}
    ${window.liff?.isInClient?.() ? `<button class="btn ghost mt" id="close">ปิดหน้าต่าง</button>` : ''}
  `;
  bindGo();
  $app.querySelector('#close')?.addEventListener('click', () => liff.closeWindow());

  if (!pending) return;
  if (s.promptpay_id) drawQR($app.querySelector('#qr'), promptPayPayload(s.promptpay_id, b.deposit_amount));
  $app.querySelector('#copyacc')?.addEventListener('click', () =>
    navigator.clipboard?.writeText(s.bank_account_no.replace(/[^0-9]/g, '')).then(() => toast('คัดลอกเลขบัญชีแล้ว')),
  );
  if (b.expires_at) {
    const cd = $app.querySelector('#cd');
    const tick = () => {
      const left = Date.parse(b.expires_at) - Date.now();
      if (left <= 0) {
        cd.textContent = '(หมดเวลา)';
        return clearInterval(countdownTimer);
      }
      cd.textContent = `(เหลือ ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')})`;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }
  const input = $app.querySelector('#slip');
  $app.querySelector('#up').addEventListener('click', () => input.click());
  input.addEventListener('change', () => input.files[0] && uploadSlip(b, input.files[0]));
  $app.querySelector('#cancel').addEventListener('click', async () => {
    if (!confirm('ยืนยันยกเลิกการจองนี้?')) return;
    try {
      await api(`/api/bookings/${b.code}/cancel`, { method: 'POST' });
      toast('ยกเลิกแล้ว');
      viewPay(b.code);
    } catch (e) {
      toast(errText(e));
    }
  });
}

function drawQR(el, payload) {
  if (!el) return;
  const draw = () => {
    if (!window.qrcode) return setTimeout(draw, 150);
    const qr = qrcode(0, 'M');
    qr.addData(payload);
    qr.make();
    el.innerHTML = qr.createImgTag(6, 0);
  };
  draw();
}

async function uploadSlip(b, file) {
  const res = $app.querySelector('#res');
  const btn = $app.querySelector('#up');
  btn.disabled = true;
  btn.textContent = 'กำลังตรวจสลิป…';
  res.innerHTML = '';
  try {
    const payload = await readSlipQR(file).catch(() => null);
    const { dataUrl } = await loadImage(file, 1280, 0.85);
    const r = await api(`/api/bookings/${b.code}/slip`, { method: 'POST', body: { image: dataUrl, payload } });
    if (r.status === 'rejected') {
      res.innerHTML = `<div class="result bad">❗ ${esc(r.reason)}</div>`;
      btn.disabled = false;
      btn.textContent = '📎 อัปโหลดสลิปใหม่';
      return;
    }
    toast(r.status === 'confirmed' ? 'ยืนยันคิวเรียบร้อย ✅' : 'ส่งสลิปแล้ว รอแอดมินตรวจ');
    viewPay(b.code);
  } catch (e) {
    res.innerHTML = `<div class="result bad">${esc(errText(e))}</div>`;
    btn.disabled = false;
    btn.textContent = '📎 อัปโหลดสลิป';
  }
}

// ------------------------------------------------------------------ my bookings & stamps
async function viewMy() {
  const req = state.me.stamps_required;
  $app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const [{ bookings }, me] = await Promise.all([api('/api/bookings/mine'), api('/api/me')]);
  state.me = me;
  const st = me.user.stamps;
  const today = state.info.today;
  const upcoming = bookings.filter((b) => b.date >= today && ['pending_deposit', 'verifying', 'confirmed'].includes(b.status)).reverse();
  const past = bookings.filter((b) => !upcoming.includes(b));

  const card = (b) => `
    <div class="card" data-go="#/pay/${b.code}" style="cursor:pointer">
      <div class="row between"><b>${thaiDate(b.date)} · ${b.start_time} น.</b><span class="st ${b.status}">${STATUS[b.status]}</span></div>
      <div class="small muted">${b.items.map((i) => esc(i.name)).join(', ')}</div>
      <div class="row between small mt"><span class="muted">${b.code}</span><span>${baht(b.total)}</span></div>
    </div>`;

  $app.innerHTML = `
    <button class="back" data-go="#/">← หน้าแรก</button>
    <div class="stampcard mt">
      <div class="row between"><div><div class="tiny" style="opacity:.7">บัตรสะสมแต้ม</div><div class="brand" style="font-size:20px">${esc(state.info.settings.shop_name)}</div></div>
      <div style="font-size:26px;font-weight:700">${Math.min(st, req)}<span style="font-size:14px;opacity:.7">/${req}</span></div></div>
      <div class="stamps">
        ${Array.from({ length: req }, (_, i) => `<div class="stamp ${i < st ? 'on' : ''} ${i === req - 1 ? 'gift' : ''}">${i < st ? '💗' : i === req - 1 ? '🎁' : ''}</div>`).join('')}
      </div>
      <div class="small mt" style="opacity:.85">${st >= req ? '🎁 ใช้สิทธิ์ต่อขนตาฟรี 1 ทรง ได้ในการจองครั้งถัดไป!' : `สะสมครบ ${req} ครั้ง รับฟรี 1 ทรง · อีก ${req - st} ครั้ง`}</div>
    </div>

    <div class="section-title">คิวที่กำลังจะถึง</div>
    ${upcoming.length ? upcoming.map(card).join('') : `<div class="empty">ยังไม่มีคิว<br><button class="btn sm mt" data-go="#/">จองคิวเลย</button></div>`}
    ${past.length ? `<div class="section-title">ประวัติ</div>${past.map(card).join('')}` : ''}
  `;
  bindGo();
}

// ------------------------------------------------------------------ promotions
function viewPromos() {
  const { promotions, styles, today } = state.info;
  $app.innerHTML = `
    <button class="back" data-go="#/">← หน้าแรก</button>
    <div class="section-title">โปรโมชั่น</div>
    ${promotions.length ? promotions.map((p) => `
      <div class="promo"><div class="t">🎀 ${esc(p.name)} ${p.start_date && p.start_date > today ? '<span class="tag" style="background:#fff">เร็ว ๆ นี้</span>' : ''}</div>
      <div class="d">${esc(promoText(p, styles))}</div>${promoRange(p) ? `<div class="d">${esc(promoRange(p))}</div>` : ''}</div>`).join('') : '<div class="empty">ยังไม่มีโปรโมชั่น</div>'}
    <button class="btn mt2" data-go="#/">จองคิวเลย</button>
  `;
  bindGo();
}

function bindGo() {
  $app.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => go(el.dataset.go)));
}
