import { HttpError, nowISO, parseJSON } from './util.js';

export const DEFAULT_SETTINGS = {
  shop_name: 'Kingyo Eyelash',
  shop_phone: '',
  shop_address: '',
  map_url: '', // ลิงก์ Google Maps ของร้าน
  shop_lat: '', // พิกัด สำหรับส่ง location ในแชท
  shop_lng: '',
  review_url: '', // ลิงก์เขียนรีวิว Google
  deposit_amount: 100,
  promptpay_id: '', // เบอร์มือถือ / เลขบัตรประชาชน
  promptpay_name: '', // ชื่อบัญชี (แสดงให้ลูกค้าเห็น)
  bank_name: '',
  bank_account_no: '',
  slot_step_min: 30,
  capacity: 1, // จำนวนช่าง/คิวที่ทำพร้อมกันได้
  booking_days_ahead: 30,
  min_lead_min: 120, // ต้องจองล่วงหน้าอย่างน้อยกี่นาที
  deposit_timeout_min: 10, // ถือคิวรอโอนมัดจำกี่นาที
  max_people: 4,
  stamps_required: 10,
  notify_admins: 1, // push แจ้งแอดมินเมื่อมีคิวใหม่/รอตรวจสลิป (ใช้โควต้าข้อความ)
  notify_admin_ids: '', // แอดมินที่รับแจ้งเตือน (คั่นด้วย ,) ว่าง = ทุกคน
  notify_customer: 1, // push แจ้งลูกค้าเมื่อแอดมินยืนยัน/ปฏิเสธสลิป
  review_request: 1, // push ขอบคุณ + ชวนรีวิว Google เมื่อกด "มาใช้บริการแล้ว"
  remind_day_before: 1, // push เตือนนัดล่วงหน้า 1 วัน พร้อมแผนที่
  remind_hour: 18, // เวลาที่ส่งเตือน (ชั่วโมง, เวลาไทย)
  policy_text: 'มัดจำ 100 บาท (ที่เหลือชำระวันทำ)',
  // ---- โพสต์เพจ Facebook อัตโนมัติ
  fb_mode: 'approve', // approve = โพสต์เฉพาะที่แอดมินอนุมัติ · auto = โพสต์ร่างได้เลย
  fb_themes: 'โชว์ทรง,โปรโมชัน,รีวิวลูกค้า,ชวนจองคิวว่าง,ทิปดูแลขนตา',
  fb_tone: 'เป็นกันเอง อบอุ่น ลงท้ายด้วย "ค่ะ" ใช้อีโมจิ 💜 ✨ ไม่เกิน 3–4 ตัว',
  fb_draft_time: '07:00', // เวลาที่ให้ AI ร่างโพสต์ของวัน
  fb_model: 'gemini-flash-latest',
  fb_phone: '', // เบอร์ที่ใส่ในโพสต์เพจ (ว่าง = ใช้เบอร์ร้าน) เช่น 098-450-4663 (ทราย)
  // ---- ระบบ (ไม่ได้แก้จากหน้าตั้งค่า)
  img_cleanup_date: '', // วันที่ล้างรูปค้างล่าสุด
  img_cleanup_deleted: 0, // จำนวนรูปที่ลบรอบล่าสุด
};
const NUMERIC = new Set(
  Object.entries(DEFAULT_SETTINGS)
    .filter(([, v]) => typeof v === 'number')
    .map(([k]) => k),
);
export const PUBLIC_SETTING_KEYS = [
  'shop_name', 'shop_phone', 'shop_address', 'deposit_amount', 'promptpay_id', 'promptpay_name', 'bank_name', 'bank_account_no', 'map_url', 'review_url',
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
// styles.stamps = แต้มที่ได้ต่อ 1 ครั้งที่ทำบริการนี้ (0 = ไม่ได้แต้ม) — เพิ่มคอลัมน์ให้อัตโนมัติถ้ายังไม่มี
let stylesStampsReady = false;
export async function ensureStyleStamps(env) {
  if (stylesStampsReady) return;
  try {
    await env.DB.prepare('ALTER TABLE styles ADD COLUMN stamps INTEGER NOT NULL DEFAULT 0').run();
  } catch (e) {
    if (!/duplicate column/i.test(String(e?.message || e))) throw e;
  }
  // styles.redeemable = แลกฟรีด้วยแต้มได้ (ครั้งแรกที่เพิ่มคอลัมน์: ตั้งตามทรงที่ได้แต้ม)
  try {
    await env.DB.prepare('ALTER TABLE styles ADD COLUMN redeemable INTEGER NOT NULL DEFAULT 0').run();
    await env.DB.prepare('UPDATE styles SET redeemable = 1 WHERE stamps > 0').run();
  } catch (e) {
    if (!/duplicate column/i.test(String(e?.message || e))) throw e;
  }
  // styles.gallery = รูปผลงานทั้งหมดของทรง (JSON array ของ image id) · image_id = รูปหลักที่โชว์ในหน้าจอง
  try {
    await env.DB.prepare("ALTER TABLE styles ADD COLUMN gallery TEXT NOT NULL DEFAULT '[]'").run();
    await env.DB.prepare(`UPDATE styles SET gallery = json_array(image_id) WHERE image_id IS NOT NULL AND image_id <> ''`).run();
  } catch (e) {
    if (!/duplicate column/i.test(String(e?.message || e))) throw e;
  }
  // styles.gallery_wm = รูปสำหรับโพสต์เพจ (ใส่ลายน้ำ + ชื่อทรง ทำในเบราว์เซอร์แอดมิน)
  // {"v": เวอร์ชันดีไซน์, "mark": ลายน้ำ (ชื่อร้าน), "name": ชื่อทรงที่ใส่ในรูป, "map": {รูปต้นฉบับ: {"id": รูปที่ใส่ลายน้ำ+ชื่อแล้ว}}}
  try {
    await env.DB.prepare("ALTER TABLE styles ADD COLUMN gallery_wm TEXT NOT NULL DEFAULT '{}'").run();
  } catch (e) {
    if (!/duplicate column/i.test(String(e?.message || e))) throw e;
  }
  // ลบ flag "plain" (มีลายน้ำแล้ว) ที่เลิกใช้ ออกจากข้อมูลเดิม
  const { results: oldWm } = await env.DB.prepare(`SELECT id, gallery_wm FROM styles WHERE gallery_wm LIKE '%"plain"%'`).all();
  for (const r of oldWm) {
    await env.DB.prepare('UPDATE styles SET gallery_wm = ? WHERE id = ?').bind(JSON.stringify(parseWm(r.gallery_wm)), r.id).run();
  }
  stylesStampsReady = true;
}
/** รูปทั้งหมดของทรง โดยรูปหลักอยู่หน้าสุด */
export function styleGallery(s) {
  const g = parseJSON(s.gallery, []);
  const list = Array.isArray(g) ? g.filter(Boolean) : [];
  if (s.image_id && !list.includes(s.image_id)) list.unshift(s.image_id);
  return s.image_id ? [s.image_id, ...list.filter((x) => x !== s.image_id)] : list;
}
export function parseWm(raw) {
  const w = parseJSON(raw, {}) || {};
  return {
    v: Number(w.v) || 1, // เวอร์ชันดีไซน์ — เปลี่ยนดีไซน์แล้วรูปเก่าจะถูกทำใหม่
    mark: typeof w.mark === 'string' ? w.mark : '',
    name: typeof w.name === 'string' ? w.name : '',
    map: Object.fromEntries(
      Object.entries(w.map && typeof w.map === 'object' && !Array.isArray(w.map) ? w.map : {})
        .filter(([, e]) => typeof e?.id === 'string')
        .map(([k, e]) => [k, { id: e.id }]),
    ),
  };
}
export async function getStyles(env, { activeOnly = false } = {}) {
  await ensureStyleStamps(env);
  const sql = `SELECT * FROM styles ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort, id`;
  const { results } = await env.DB.prepare(sql).all();
  return results.map(({ gallery_wm, ...r }) => ({ ...r, gallery: styleGallery(r), wm: parseWm(gallery_wm) }));
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
// ---------- time blocks (ปิดรับคิวบางช่วงเวลา เช่น ไปธุระ / ลูกค้าจองผ่าน FB) ----------
let blocksReady = false;
export async function ensureBlocks(env) {
  if (blocksReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS time_blocks (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       date TEXT NOT NULL,
       start_time TEXT NOT NULL,
       end_time TEXT NOT NULL,
       note TEXT NOT NULL DEFAULT '',
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  ).run();
  blocksReady = true;
}
export async function getBlocks(env, from, to) {
  await ensureBlocks(env);
  const { results } = await env.DB.prepare(
    'SELECT * FROM time_blocks WHERE date >= ? AND date <= ? ORDER BY date, start_time',
  ).bind(from, to || '9999-12-31').all();
  return results;
}

// ---------- reviews: อัลบั้มไฮไลต์ (แสดงแบบสตอรี่ในหน้าจอง) ----------
let reviewsReady = false;
export async function ensureReviews(env) {
  if (reviewsReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS review_albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS review_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id INTEGER NOT NULL,
      image_id TEXT NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      style_id INTEGER,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_review_photos_album ON review_photos(album_id, sort)'),
  ]);
  reviewsReady = true;
}
/** albums with their photos; publicOnly = only active albums that have photos */
export async function getReviewAlbums(env, { publicOnly = false } = {}) {
  await ensureReviews(env);
  const [{ results: albums }, { results: photos }] = await Promise.all([
    env.DB.prepare(`SELECT * FROM review_albums ${publicOnly ? 'WHERE active = 1' : ''} ORDER BY sort, id`).all(),
    env.DB.prepare('SELECT id, album_id, image_id, caption, style_id, sort FROM review_photos ORDER BY sort, id').all(),
  ]);
  const by = {};
  for (const p of photos) (by[p.album_id] ||= []).push(p);
  const list = albums.map((a) => ({ ...a, active: !!a.active, photos: by[a.id] || [] }));
  return publicOnly ? list.filter((a) => a.photos.length) : list;
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
/** แอดมินที่รับแจ้งเตือน: ถ้าตั้ง notify_admin_ids ไว้ ส่งเฉพาะคนในรายการ (ที่ยังเป็นแอดมินอยู่) */
export async function notifyAdminIds(env, settings) {
  const all = await adminIds(env);
  const pick = String(settings.notify_admin_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  return pick.length ? all.filter((id) => pick.includes(id)) : all;
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
