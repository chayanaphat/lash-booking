// ล้างรูปที่ไม่มีที่ไหนใช้แล้ว (รูปทรง/รีวิวที่ถูกเปลี่ยนหรือลบ) — ไม่แตะรูปสลิป
import { ensureReviews, ensureStyleStamps, getSettings, saveSettings } from './db.js';
import { ensureFb } from './fbpost.js';
import { bkkNow, toMin } from './util.js';

const CLEANUP_TIME = '03:00'; // ล้างวันละครั้งหลังเวลานี้ (เวลาไทย)
const KEEP_HOURS = 24; // รูปที่เพิ่งอัปโหลด (ยังไม่กดบันทึกฟอร์ม) ไม่ลบ

const js = (col) => `json_each(CASE WHEN json_valid(${col}) THEN ${col} ELSE '[]' END)`;
/** รูปทุกรูปที่ยังถูกอ้างถึงในระบบ (แยกเป็นหลายคำสั่ง เพราะ D1 จำกัดจำนวน UNION ต่อคำสั่ง) */
export const USED_IMAGE_QUERIES = [
  'SELECT image_id AS id FROM styles',
  `SELECT j.value AS id FROM styles, ${js('styles.gallery')} j`,
  `SELECT json_extract(j.value, '$.id') AS id FROM styles, json_each(CASE WHEN json_valid(styles.gallery_wm) THEN styles.gallery_wm ELSE '{}' END, '$.map') j`,
  'SELECT image_id AS id FROM review_photos',
  `SELECT json_extract(j.value, '$.image_id') AS id FROM bookings, ${js('bookings.items')} j`,
  'SELECT slip_image_id AS id FROM bookings',
  `SELECT j.value AS id FROM fb_posts, ${js('fb_posts.image_ids')} j`,
  `SELECT j.value AS id FROM fb_fallbacks, ${js('fb_fallbacks.image_ids')} j`,
];

async function ensureAll(env) {
  await Promise.all([ensureStyleStamps(env), ensureReviews(env), ensureFb(env)]);
}

export async function cleanupImages(env) {
  await ensureAll(env);
  const cutoff = new Date(Date.now() - KEEP_HOURS * 3600e3).toISOString();
  const [cand, ...used] = await env.DB.batch([
    env.DB.prepare("SELECT id FROM images WHERE kind <> 'slip' AND created_at < ?").bind(cutoff),
    ...USED_IMAGE_QUERIES.map((q) => env.DB.prepare(q)),
  ]);
  const inUse = new Set(used.flatMap((r) => r.results.map((x) => x.id)).filter(Boolean));
  const orphans = cand.results.map((r) => r.id).filter((id) => !inUse.has(id));
  for (let i = 0; i < orphans.length; i += 90) {
    const chunk = orphans.slice(i, i + 90);
    await env.DB.prepare(`DELETE FROM images WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).run();
  }
  await saveSettings(env, { img_cleanup_date: bkkNow().date, img_cleanup_deleted: orphans.length });
  return orphans.length;
}

/** cron: วันละครั้งหลัง 03:00 */
export async function runImageCleanup(env) {
  const now = bkkNow();
  if (toMin(now.time) < toMin(env.IMG_CLEANUP_TIME || CLEANUP_TIME)) return;
  const s = await getSettings(env);
  if (s.img_cleanup_date === now.date) return;
  await cleanupImages(env);
}

export async function imageStats(env) {
  await ensureAll(env);
  const [{ results }, s] = await Promise.all([
    env.DB.prepare('SELECT kind, COUNT(*) AS n, COALESCE(SUM(length(data)), 0) AS bytes FROM images GROUP BY kind').all(),
    getSettings(env),
  ]);
  const by = Object.fromEntries(results.map((r) => [r.kind, { n: r.n, bytes: r.bytes }]));
  const total = results.reduce((a, r) => ({ n: a.n + r.n, bytes: a.bytes + r.bytes }), { n: 0, bytes: 0 });
  return { total, by, last_cleanup: s.img_cleanup_date || null, last_deleted: Number(s.img_cleanup_deleted) || 0 };
}
