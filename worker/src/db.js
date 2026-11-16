import { HttpError, nowISO, parseJSON } from './util.js';

export const DEFAULT_SETTINGS = {
  shop_name: 'Kingyo Eyelash',
  shop_phone: '',
  shop_address: '',
  deposit_amount: 100,
  promptpay_id: '', // เบอร์มือถือ / เลขบัตรประชาชน
  promptpay_name: '', // ชื่อบัญชี (แสดงให้ลูกค้าเห็น)
  bank_name: '',
  bank_account_no: '',
  slot_step_min: 30,
  capacity: 1, // จำนวนช่าง/คิวที่ทำพร้อมกันได้
  booking_days_ahead: 30,
  min_lead_min: 120, // ต้องจองล่วงหน้าอย่างน้อยกี่นาที
  deposit_timeout_min: 30, // ถือคิวรอโอนมัดจำกี่นาที
  max_people: 4,
  stamps_required: 10,
  notify_admins: 1, // push แจ้งแอดมินเมื่อมีคิวใหม่/รอตรวจสลิป (ใช้โควต้าข้อความ)
  notify_customer: 1, // push แจ้งลูกค้าเมื่อแอดมินยืนยัน/ปฏิเสธสลิป
  policy_text: 'มัดจำ 100 บาท (ที่เหลือชำระวันทำ)',
};
const NUMERIC = new Set(
  Object.entries(DEFAULT_SETTINGS)
    .filter(([, v]) => typeof v === 'number')
    .map(([k]) => k),
);
export const PUBLIC_SETTING_KEYS = [
  'shop_name', 'shop_phone', 'shop_address', 'deposit_amount', 'promptpay_id', 'promptpay_name', 'bank_name', 'bank_account_no',
  'booking_days_ahead', 'max_people', 'stamps_required', 'policy_text', 'deposit_timeout_min', 'min_lead_min',
];

export async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of results) {
    if (!(r.key in DEFAULT_SETTINGS)) continue;
    s[r.key] = NUMERIC.has(r.key) ? Number(r.value) : r.value;
  }
  return s;
}

export async function saveSettings(env, patch) {
  const stmts = [];
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    let val = v;
    if (NUMERIC.has(k)) {
      val = Number(v);
      if (!Number.isFinite(val) || val < 0) throw new HttpError(400, 'invalid_setting:' + k);
    }
    stmts.push(
      env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .bind(k, String(val)),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
}

// ---------- styles / promotions ----------
export async function getStyles(env, { activeOnly = false } = {}) {
  const sql = `SELECT * FROM styles ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort, id`;
  const { results } = await env.DB.prepare(sql).all();
  return results;
}
export const styleMap = (list) => Object.fromEntries(list.map((s) => [s.id, s]));

export const parsePromo = (p) => ({
  ...p,
  active: !!p.active,
  style_ids: parseJSON(p.style_ids, null),
  fixed_prices: parseJSON(p.fixed_prices, null),
});
export async function getPromotions(env) {
  const { results } = await env.DB.prepare('SELECT * FROM promotions ORDER BY id DESC').all();
  return results.map(parsePromo);
}

export async function getHours(env) {
  const { results } = await env.DB.prepare('SELECT * FROM business_hours ORDER BY weekday').all();
  return results.map((h) => ({ ...h, closed: !!h.closed }));
}
export async function getHolidays(env, fromDate) {
  const { results } = await env.DB.prepare('SELECT * FROM holidays WHERE date >= ? ORDER BY date').bind(fromDate || '0000').all();
  return results;
}

// ---------- users / admins ----------
export async function upsertUser(env, user) {
  await env.DB.prepare(
    `INSERT INTO users (line_user_id, display_name, picture_url) VALUES (?, ?, ?)
     ON CONFLICT(line_user_id) DO UPDATE SET
       display_name = CASE WHEN excluded.display_name <> '' THEN excluded.display_name ELSE users.display_name END,
       picture_url = COALESCE(excluded.picture_url, users.picture_url),
       updated_at = datetime('now')`,
  ).bind(user.userId, user.name || '', user.picture || null).run();
  return env.DB.prepare('SELECT * FROM users WHERE line_user_id = ?').bind(user.userId).first();
}

export function envAdminIds(env) {
  return (env.ADMIN_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
}
export async function adminIds(env) {
  const { results } = await env.DB.prepare('SELECT line_user_id FROM admins').all();
  return [...new Set([...envAdminIds(env), ...results.map((r) => r.line_user_id)])];
}
export async function isAdmin(env, userId) {
  if (envAdminIds(env).includes(userId)) return true;
  return !!(await env.DB.prepare('SELECT 1 FROM admins WHERE line_user_id = ?').bind(userId).first());
}

// ---------- images ----------
const MAX_IMAGE_BYTES = 1_500_000; // D1 row limit is 2MB
export async function saveImage(env, bytes, mime, kind = 'style') {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, 'image_too_large');
  const id = crypto.randomUUID().replace(/-/g, '');
  await env.DB.prepare('INSERT INTO images (id, kind, mime, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, kind, mime, bytes, nowISO()).run();
  return id;
}
export async function getImage(env, id) {
  const r = await env.DB.prepare('SELECT mime, data FROM images WHERE id = ?').bind(id).first();
  if (!r) return null;
  return { mime: r.mime, bytes: new Uint8Array(r.data) };
}

// ---------- bookings ----------
export const BLOCKING_SQL = `(status IN ('verifying','confirmed','completed') OR (status = 'pending_deposit' AND expires_at > ?))`;

export const parseBooking = (b) => (b ? { ...b, items: parseJSON(b.items, []), use_reward: !!b.use_reward } : null);

export async function getBookingByCode(env, code) {
  return parseBooking(await env.DB.prepare('SELECT * FROM bookings WHERE code = ?').bind(code).first());
}
export async function busyForDate(env, date, excludeCode = null) {
  const { results } = await env.DB.prepare(
    `SELECT start_time, end_time FROM bookings WHERE date = ? AND ${BLOCKING_SQL} AND code <> ?`,
  ).bind(date, nowISO(), excludeCode || '').all();
  return results;
}
