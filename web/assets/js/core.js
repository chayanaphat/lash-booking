import { CONFIG } from './config.js?v=1795023629';

let idToken = null;
let devUser = null;
export let profile = null;

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

export async function initLiff() {
  const qs = new URLSearchParams(location.search);
  if (isLocal) {
    devUser = qs.get('dev') || localStorage.getItem('devUser') || 'Udevuser';
    localStorage.setItem('devUser', devUser);
    profile = { userId: devUser, displayName: 'Dev ' + devUser, pictureUrl: '' };
    return { dev: true };
  }
  await liff.init({ liffId: CONFIG.LIFF_ID });
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: location.href });
    return new Promise(() => {});
  }
  try {
    profile = await liff.getProfile();
  } catch {
    profile = { userId: '', displayName: '' };
  }
  idToken = liff.getIDToken();
  if (idToken && tokenExpired(idToken)) idToken = null;
  if (!idToken) {
    // บาง client ไม่คืน ID token — ใช้ access token แทน (server ตรวจกับ LINE ว่าเป็นของ channel นี้)
    const at = liff.getAccessToken();
    if (at) idToken = 'at:' + at;
    else if (relogin()) return new Promise(() => {});
    else throw new Error('no_token');
  }
  return { dev: false };
}

// login ใหม่ได้ครั้งเดียวต่อ 2 นาที กันวนลูป
function relogin() {
  const last = Number(sessionStorage.getItem('relogin_at') || 0);
  if (Date.now() - last < 120_000) return false;
  sessionStorage.setItem('relogin_at', String(Date.now()));
  if (liff.isInClient()) {
    location.reload();
  } else {
    liff.logout();
    liff.login({ redirectUri: location.href });
  }
  return true;
}

function tokenExpired(t) {
  try {
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return p.exp * 1000 < Date.now() + 60_000;
  } catch {
    return true;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (devUser) headers['x-dev-user'] = devUser;
  else if (idToken) headers.authorization = 'Bearer ' + idToken;
  const res = await fetch(CONFIG.API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (res.status === 401 && !devUser && window.liff && relogin()) return new Promise(() => {});
  if (!res.ok) throw Object.assign(new Error(data.error || 'request_failed'), { status: res.status, data });
  return data;
}

export const imgUrl = (id) => (id ? `${CONFIG.API_BASE}/img/${id}.jpg` : '');
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const baht = (n) => '฿' + Number(n || 0).toLocaleString('en-US');

const TH_DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const TH_DAYS_FULL = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const weekday = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
export const dayName = (w, full = false) => (full ? TH_DAYS_FULL : TH_DAYS)[w];
export function thaiDate(d, { year = true } = {}) {
  const [y, m, dd] = d.split('-').map(Number);
  return `${TH_DAYS[weekday(d)]} ${dd} ${TH_MONTHS[m - 1]}${year ? ' ' + String(y + 543).slice(2) : ''}`;
}
export const monthShort = (d) => TH_MONTHS[Number(d.split('-')[1]) - 1];
export function addDays(d, n) {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
export const bkkToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
export const bkkTime = (iso) => new Date(Date.parse(iso) + 7 * 3600e3).toISOString().slice(11, 16);

export const STATUS = {
  pending_deposit: 'รอชำระมัดจำ',
  verifying: 'รอตรวจสลิป',
  confirmed: 'ยืนยันแล้ว',
  completed: 'ใช้บริการแล้ว',
  cancelled: 'ยกเลิก',
};
export const ERR = {
  too_many_images: 'ใส่รูปได้สูงสุด 5 รูปต่อทรง',
  slot_unavailable: 'ขออภัย เวลานี้เพิ่งถูกจองไป กรุณาเลือกเวลาใหม่',
  has_pending_booking: 'คุณมีคิวที่รอชำระมัดจำอยู่ กรุณาชำระหรือยกเลิกก่อน',
  phone_required: 'กรุณากรอกเบอร์โทรให้ถูกต้อง',
  name_required: 'กรุณากรอกชื่อ',
  not_enough_stamps: 'แต้มสะสมยังไม่พอ',
  image_too_large: 'รูปใหญ่เกินไป',
  forbidden: 'ไม่มีสิทธิ์เข้าถึง',
  booking_not_awaiting_deposit: 'การจองนี้ไม่อยู่ในสถานะรอชำระมัดจำ',
  too_many_people: 'เลือกจำนวนคนเกินที่ร้านรับได้',
  too_many_addons: 'บริการเสริมเลือกได้คนละ 1 ครั้ง',
  reward_not_eligible: 'สิทธิ์ฟรีใช้ได้กับทรงที่ร่วมรายการแลกแต้มเท่านั้น',
  invalid_time_range: 'เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด',
};
export const errText = (e) => ERR[e?.message] || 'เกิดข้อผิดพลาด (' + (e?.message || 'unknown') + ')';

let toastTimer;
export function toast(msg, ms = 2600) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

/** read a File, scale down and return {dataUrl, imageData} */
export function loadImage(file, maxSide = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve({ dataUrl: c.toDataURL('image/jpeg', quality), imageData: ctx.getImageData(0, 0, w, h), w, h });
    };
    img.onerror = reject;
    img.src = url;
  });
}

/** decode the mini-QR on a bank slip (needs jsQR on window) */
export async function readSlipQR(file) {
  if (!window.jsQR) return null;
  // try full-res first: slip QR codes are small
  const { imageData } = await loadImage(file, 2000, 0.92);
  const r = window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
  return r?.data || null;
}

export function promoText(p, styles = []) {
  if (p.description) return p.description;
  const who = (p.min_people || 1) > 1 ? `มา ${p.min_people} คน ` : '';
  if (p.type === 'discount') return `${who}ลดทรงละ ${p.discount} บาท`;
  if (p.type === 'percent') return `${who}ลด ${p.discount}%`;
  const parts = Object.entries(p.fixed_prices || {}).map(([id, v]) => {
    const s = styles.find((x) => String(x.id) === String(id));
    return s ? `${s.name} ${s.price}→${v}` : `#${id} ${v}`;
  });
  return `${who}ราคาพิเศษ ${parts.join(', ')}`;
}
export function promoRange(p) {
  if (!p.start_date && !p.end_date) return '';
  return `${p.start_date ? thaiDate(p.start_date) : 'วันนี้'} – ${p.end_date ? thaiDate(p.end_date) : 'ไม่มีกำหนด'}`;
}
