// โพสต์ลงเพจ Facebook อัตโนมัติ: Gemini ร่างคอนเทนต์ล่วงหน้า → แอดมินดู/แก้/อนุมัติ → cron โพสต์ตามเวลา
import { getPromotions, getReviewAlbums, getSettings, getStyles } from './db.js';
import { notifyAdmins, slotsFor } from './bookings.js';
import { liffUrl, text } from './messages.js';
import { activePromotions, promoPrice } from './pricing.js';
import { addDays, bkkNow, nowISO, parseJSON, thaiDate, toMin, weekdayOf } from './util.js';

const GRAPH_DEFAULT = 'https://graph.facebook.com/v24.0';
const graphBase = (env) => env.FB_GRAPH_BASE || GRAPH_DEFAULT; // override ได้ตอนทดสอบในเครื่อง
export const FB_THEMES = ['โชว์ทรง', 'โปรโมชัน', 'รีวิวลูกค้า', 'ชวนจองคิวว่าง', 'ทิปดูแลขนตา'];

// ---------------------------------------------------------------- tables
let ready = false;
export async function ensureFb(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS fb_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL, days TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
      theme TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS fb_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, schedule_id INTEGER, date TEXT NOT NULL, time TEXT NOT NULL,
      theme TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '', image_ids TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft', source TEXT NOT NULL DEFAULT 'ai', price_ok INTEGER NOT NULL DEFAULT 1,
      fb_post_id TEXT, error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, posted_at TEXT)`),
    env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_fb_posts_slot ON fb_posts(schedule_id, date)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS fb_fallbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, image_ids TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)`),
  ]);
  try {
    await env.DB.prepare("ALTER TABLE fb_posts ADD COLUMN permalink TEXT NOT NULL DEFAULT ''").run();
  } catch (e) {
    if (!/duplicate column/i.test(String(e.message))) throw e;
  }
  ready = true;
}

export const parsePost = (p) => (p ? { ...p, image_ids: parseJSON(p.image_ids, []), price_ok: !!p.price_ok } : null);
export const parseSchedule = (s) => ({ ...s, days: parseJSON(s.days, []), active: !!s.active });

export function fbConfigured(env) {
  return { facebook: !!env.FB_PAGE_TOKEN, gemini: !!env.GEMINI_API_KEY };
}

// ---------------------------------------------------------------- pure helpers (tested)
/** ตารางที่ต้องโพสต์ในวันนั้น */
export function schedulesForDate(schedules, date) {
  const wd = weekdayOf(date);
  return schedules.filter((s) => s.active && s.days.includes(wd));
}

/** ธีมของโพสต์: ใช้ธีมที่ตารางกำหนด ไม่งั้นหมุนตามลำดับไม่ให้ซ้ำโพสต์ก่อน */
export function pickTheme(schedule, themes, recentThemes = []) {
  if (schedule.theme) return schedule.theme;
  const list = themes.length ? themes : FB_THEMES;
  const last = recentThemes[0];
  const idx = last ? list.indexOf(last) : -1;
  return list[(idx + 1) % list.length];
}

/** ตัวเลขราคาในข้อความต้องเป็นราคาที่มีอยู่จริงในระบบ (กัน AI แต่งราคาเอง) */
export function priceCheck(message, validPrices) {
  const valid = new Set(validPrices.map(Number));
  const found = [];
  const re = /(?:฿\s*([\d,]{2,6}))|(?:([\d,]{2,6})\s*(?:บาท|฿|\.-))/g;
  let m;
  while ((m = re.exec(message))) found.push(Number((m[1] || m[2]).replace(/,/g, '')));
  const bad = found.filter((n) => !valid.has(n));
  return { ok: bad.length === 0, bad };
}

export function validPrices(styles, promos, settings, date) {
  const out = new Set([Number(settings.deposit_amount) || 0]);
  for (const s of styles) out.add(Number(s.price));
  for (const p of activePromotions(promos, date)) {
    if (p.type === 'discount' || !p.type) out.add(Number(p.discount));
    for (const s of styles) {
      const price = promoPrice(p, s);
      if (price == null) continue;
      out.add(price); // ราคาหลังลด
      out.add(s.price - price); // ส่วนลดเป็นบาท
    }
  }
  return [...out].filter((n) => Number.isFinite(n) && n > 0);
}

// ---------------------------------------------------------------- Gemini
async function shopContext(env, date) {
  const [settings, styles, promos, albums] = await Promise.all([
    getSettings(env), getStyles(env, { activeOnly: true }), getPromotions(env), getReviewAlbums(env, { publicOnly: true }),
  ]);
  return { settings, styles, promos, promoList: activePromotions(promos, date), albums };
}

async function freeSlotsTomorrow(env, date, settings) {
  const d = addDays(date, 1);
  try {
    const slots = await slotsFor(env, d, 120, settings);
    return { date: d, times: (slots.slots || []).filter((s) => s.available).map((s) => s.time) };
  } catch {
    return { date: d, times: [] };
  }
}

export const PHONE_EMOJIS = ['🤙🏻', '📞', '📱'];
/** สลับอีโมจิหน้าเบอร์โทร: ใช้ตัวถัดจากที่โพสต์ล่าสุดใช้ */
export function nextPhoneEmoji(recentTexts) {
  for (const t of recentTexts) {
    const i = PHONE_EMOJIS.findIndex((e) => t.includes(e));
    if (i !== -1) return PHONE_EMOJIS[(i + 1) % PHONE_EMOJIS.length];
  }
  return PHONE_EMOJIS[0];
}

function buildPrompt(env, ctx, theme, recent, freeTomorrow, instruction, current, phoneEmoji = PHONE_EMOJIS[0]) {
  const { settings: s, styles, promoList } = ctx;
  const styleLines = styles.map((x) => `- id ${x.id}: ${x.name} ราคา ${x.price} บาท (${x.kind === 'addon' ? 'บริการเสริม' : 'บริการหลัก'}) — ${String(x.description || '').replace(/\s+/g, ' ').slice(0, 160)}`).join('\n');
  const promoLines = promoList.length
    ? promoList.map((p) => {
        const items = p.type === 'fixed_price'
          ? Object.entries(p.fixed_prices || {}).map(([id, v]) => `${styles.find((x) => x.id === Number(id))?.name || id} เหลือ ${v} บาท`).join(', ')
          : p.type === 'percent' ? `ลด ${p.discount}%` : `ลด ${p.discount} บาท`;
        return `- ${p.name}: ${items}${p.min_people > 1 ? ` (มา ${p.min_people} คนขึ้นไป)` : ''}${p.end_date ? ` ถึง ${thaiDate(p.end_date)}` : ''}`;
      }).join('\n')
    : '- (ไม่มีโปรตอนนี้ ห้ามพูดถึงโปรหรือส่วนลด)';
  const free = freeTomorrow.times.length ? `${thaiDate(freeTomorrow.date)} ว่าง ${freeTomorrow.times.slice(0, 6).join(', ')} น.` : 'พรุ่งนี้คิวเต็มหรือร้านปิด (ห้ามบอกว่ามีคิวว่าง)';
  return `คุณเป็นแอดมินเพจร้านต่อขนตา "${s.shop_name}" เขียนโพสต์ Facebook ภาษาไทย 1 โพสต์
ธีมของโพสต์นี้: ${theme}
โทนภาษา: ${s.fb_tone}

ข้อมูลร้าน (ใช้เฉพาะข้อมูลนี้ ห้ามแต่งราคา โปร หรือบริการที่ไม่มี):
ร้านอยู่หนองคาย${s.shop_phone ? `\nเบอร์โทรร้าน: ${s.shop_phone}` : ''}
บริการและราคา:
${styleLines}
โปรโมชันที่ใช้ได้ตอนนี้:
${promoLines}
คิวพรุ่งนี้: ${free}
ลิงก์จองคิว: ${liffUrl(env)}

โพสต์ล่าสุดของเพจ (ห้ามซ้ำทั้งประโยคเปิดและมุมเล่า):
${recent.map((r, i) => `${i + 1}. [${r.theme}] ${r.text.replace(/\s+/g, ' ').slice(0, 140)}`).join('\n') || '(ยังไม่มี)'}
${current ? `\nร่างปัจจุบัน:\n${current}\nสิ่งที่แอดมินอยากให้ปรับ: ${instruction || 'เขียนใหม่ให้ต่างจากเดิม'}\n` : ''}
ข้อกำหนด:
- แบ่งเป็น 3–6 บรรทัดสั้น ๆ คั่นแต่ละบรรทัดด้วยการขึ้นบรรทัดใหม่ (\\n ใน JSON) อ่านง่ายบนมือถือ
- บรรทัดสุดท้ายเป็น "📅 จองคิว 👉 " ตามด้วยลิงก์จองคิว
- ถ้าพูดถึงราคา ต้องตรงกับข้อมูลข้างบนทุกตัวเลข${s.shop_phone ? `\n- ถ้าใส่เบอร์โทร ให้เขียนเป็น "🤙🏻 ${s.shop_phone}" ตรงตามนี้ทุกตัวอักษร` : ''}
- เลือก id บริการที่เกี่ยวข้องที่สุด 1–3 รายการ ระบบจะใช้รูปผลงานของบริการนั้นประกอบโพสต์ (วนรูปให้เอง)
ตอบเป็น JSON เท่านั้น: {"text": "...", "style_ids": [..]}`;
}

async function geminiOnce(env, model, prompt) {
  const res = await fetch(`${env.GEMINI_BASE || 'https://generativelanguage.googleapis.com'}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 1 },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`gemini_${res.status}: ${data.error?.message || ''}`.slice(0, 200));
    err.retry = res.status === 429 || res.status >= 500;
    throw err;
  }
  const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  const out = parseJSON(raw.replace(/^```json|```$/g, '').trim(), null);
  if (!out?.text) throw Object.assign(new Error('gemini_bad_output'), { retry: true });
  return { text: String(out.text).trim(), style_ids: (out.style_ids || []).map(Number).filter(Boolean) };
}

/** เรียก Gemini: ลองซ้ำเมื่อโมเดลยุ่ง (503/429) แล้วสลับไปรุ่นเบากว่า */
async function gemini(env, settings, prompt) {
  const models = [...new Set([settings.fb_model || 'gemini-flash-latest', 'gemini-flash-lite-latest'])];
  let last;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await geminiOnce(env, model, prompt);
      } catch (e) {
        last = e;
        if (!e.retry) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }
  throw last;
}

/** เลือกรูปที่ใช้ไม่นานที่สุดก่อน (ยังไม่เคยใช้ = ก่อนสุด) — รูปจึงวนครบทุกรูปในแกลเลอรี */
export function rotateImages(images, recentUsed, n) {
  const lastUse = (id) => {
    const i = recentUsed.indexOf(id);
    return i === -1 ? Infinity : i; // index 0 = ใช้ล่าสุด
  };
  return [...images].sort((a, b) => lastUse(b) - lastUse(a)).slice(0, n);
}

export function imagesFor(ctx, styleIds, theme, recentUsed = []) {
  const imgs = [];
  if (theme === 'รีวิวลูกค้า') imgs.push(...rotateImages(ctx.albums.flatMap((a) => a.photos.map((p) => p.image_id)), recentUsed, 4));
  const chosen = styleIds.map((id) => ctx.styles.find((x) => x.id === id)).filter((s) => s?.gallery?.length);
  const per = chosen.length ? Math.max(1, Math.min(3, Math.floor(4 / chosen.length))) : 0;
  for (const s of chosen) imgs.push(...rotateImages(s.gallery, recentUsed, per));
  if (!imgs.length) {
    const all = ctx.styles.filter((s) => s.kind !== 'addon').flatMap((s) => s.gallery || []);
    imgs.push(...rotateImages(all, recentUsed, 3));
  }
  return [...new Set(imgs)].slice(0, 4);
}

async function recentImages(env) {
  const { results } = await env.DB.prepare(
    `SELECT image_ids FROM fb_posts WHERE status IN ('posted','approved','draft') ORDER BY date DESC, time DESC LIMIT 40`,
  ).all();
  return results.flatMap((r) => parseJSON(r.image_ids, []));
}

async function recentPosts(env, limit = 10) {
  const { results } = await env.DB.prepare(
    `SELECT theme, text FROM fb_posts WHERE text <> '' AND status IN ('posted','approved','draft') ORDER BY date DESC, time DESC LIMIT ?`,
  ).bind(limit).all();
  return results;
}

/** ร่างข้อความด้วย AI (หรือคอนเทนต์สำรองถ้า AI ใช้ไม่ได้) */
export async function composeDraft(env, { date, theme, instruction = '', current = '' }) {
  const ctx = await shopContext(env, date);
  const prices = validPrices(ctx.styles, ctx.promos, ctx.settings, date);
  if (env.GEMINI_API_KEY) {
    try {
      const [recentAll, free] = await Promise.all([recentPosts(env), freeSlotsTomorrow(env, date, ctx.settings)]);
      const recent = recentAll.filter((r) => r.text.trim() !== current.trim());
      const out = await gemini(env, ctx.settings, buildPrompt(env, ctx, theme, recent, free, instruction, current, nextPhoneEmoji(recentAll.map((r) => r.text))));
      return { text: out.text, image_ids: imagesFor(ctx, out.style_ids, theme, await recentImages(env)), source: 'ai', price_ok: priceCheck(out.text, prices).ok };
    } catch (e) {
      console.error('gemini', e);
      if (current) throw e; // กดสร้างใหม่เอง → แจ้ง error ให้แอดมินเห็น
    }
  }
  const fb = await env.DB.prepare('SELECT * FROM fb_fallbacks ORDER BY RANDOM() LIMIT 1').first();
  if (fb) {
    const own = parseJSON(fb.image_ids, []);
    return { text: fb.text, image_ids: own.length ? own : imagesFor(ctx, [], theme, await recentImages(env)), source: 'fallback', price_ok: priceCheck(fb.text, prices).ok };
  }
  return { text: '', image_ids: imagesFor(ctx, [], theme, await recentImages(env)), source: 'empty', price_ok: true };
}

// ---------------------------------------------------------------- drafts / publish
export async function getSchedules(env) {
  await ensureFb(env);
  const { results } = await env.DB.prepare('SELECT * FROM fb_schedules ORDER BY time').all();
  return results.map(parseSchedule);
}

/** สร้างร่างของวันนั้นให้ครบทุกตาราง (ข้ามตารางที่มีร่างแล้ว) */
export async function ensureDrafts(env, date) {
  await ensureFb(env);
  const settings = await getSettings(env);
  const due = schedulesForDate(await getSchedules(env), date);
  const made = [];
  for (const s of due) {
    const exists = await env.DB.prepare('SELECT id FROM fb_posts WHERE schedule_id = ? AND date = ?').bind(s.id, date).first();
    if (exists) continue;
    const recent = await env.DB.prepare('SELECT theme FROM fb_posts ORDER BY date DESC, time DESC LIMIT 1').all();
    const theme = pickTheme(s, settings.fb_themes.split(',').map((t) => t.trim()).filter(Boolean), recent.results.map((r) => r.theme));
    const d = await composeDraft(env, { date, theme });
    const now = nowISO();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO fb_posts (schedule_id, date, time, theme, text, image_ids, status, source, price_ok, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    ).bind(s.id, date, s.time, theme, d.text, JSON.stringify(d.image_ids), d.source, d.price_ok ? 1 : 0, now, now).run();
    made.push(s.time);
  }
  // ร่างที่ยังว่าง (AI ล่มตอนร่าง) → ลองร่างใหม่ก่อนถึงเวลาโพสต์
  const now = bkkNow();
  const { results: empty } = await env.DB.prepare(
    `SELECT * FROM fb_posts WHERE date = ? AND status = 'draft' AND text = '' AND (date > ? OR time > ?) LIMIT 2`,
  ).bind(date, now.date, now.time).all();
  for (const p of empty) {
    const d = await composeDraft(env, { date, theme: p.theme });
    if (!d.text) continue;
    await env.DB.prepare('UPDATE fb_posts SET text = ?, image_ids = ?, source = ?, price_ok = ?, updated_at = ? WHERE id = ? AND text = \'\'')
      .bind(d.text, JSON.stringify(d.image_ids), d.source, d.price_ok ? 1 : 0, nowISO(), p.id).run();
    made.push(p.time);
  }
  return made;
}

export function imageUrl(env, id) {
  return `${(env.PUBLIC_API_URL || '').replace(/\/$/, '')}/img/${id}.jpg`;
}

async function graph(env, path, params) {
  const body = new URLSearchParams({ ...params, access_token: env.FB_PAGE_TOKEN });
  const res = await fetch(`${graphBase(env)}/${path}`, { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error((data.error?.message || `facebook_${res.status}`).slice(0, 200));
  return data;
}

export async function pageInfo(env) {
  const res = await fetch(`${graphBase(env)}/me?fields=id,name&access_token=${encodeURIComponent(env.FB_PAGE_TOKEN)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error((data.error?.message || 'facebook_error').slice(0, 200));
  return data;
}

/** โพสต์ลงเพจ: รูป (ถ้ามี) อัปโหลดแบบยังไม่เผยแพร่ แล้วแนบในโพสต์เดียว */
export async function publishToPage(env, post) {
  const page = await pageInfo(env);
  const media = [];
  for (const id of post.image_ids.slice(0, 4)) {
    const r = await graph(env, `${page.id}/photos`, { url: imageUrl(env, id), published: 'false' });
    media.push(r.id);
  }
  const params = { message: post.text };
  media.forEach((m, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: m })));
  const r = await graph(env, `${page.id}/feed`, params);
  return { id: r.id, permalink: await postInfo(env, r.id).then((i) => i.permalink_url || '').catch(() => '') };
}

/** ข้อมูลโพสต์จาก Facebook: ลิงก์ถาวร สถานะเผยแพร่ และใครเห็นได้ */
export async function postInfo(env, id) {
  const res = await fetch(`${graphBase(env)}/${id}?fields=permalink_url,is_published,privacy,created_time&access_token=${encodeURIComponent(env.FB_PAGE_TOKEN)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error((data.error?.message || 'facebook_error').slice(0, 200));
  return data;
}

async function markPost(env, id, patch) {
  const keys = Object.keys(patch);
  await env.DB.prepare(`UPDATE fb_posts SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map((k) => patch[k]), nowISO(), id).run();
}

export async function publishPost(env, post) {
  try {
    if (!post.text.trim()) throw new Error('ไม่มีข้อความ');
    const r = await publishToPage(env, post);
    await markPost(env, post.id, { status: 'posted', fb_post_id: r.id, permalink: r.permalink, error: '', posted_at: nowISO() });
    return { ok: true, fb_post_id: r.id, permalink: r.permalink };
  } catch (e) {
    await markPost(env, post.id, { status: 'failed', error: String(e.message || e).slice(0, 200) });
    await notifyAdmins(env, text(`⚠️ โพสต์เพจไม่สำเร็จ (${thaiDate(post.date)} ${post.time})\n${String(e.message || e).slice(0, 150)}\nดู/ลองใหม่ได้ที่หน้าแอดมิน → 📣 โพสต์เพจ`));
    return { ok: false, error: String(e.message || e) };
  }
}

/** cron: ร่างของวันนี้หลังเวลาร่าง และโพสต์ที่ถึงเวลา */
export async function runFbCron(env) {
  if (!env.FB_PAGE_TOKEN && !env.GEMINI_API_KEY) return;
  await ensureFb(env);
  const settings = await getSettings(env);
  const now = bkkNow();
  if (toMin(now.time) >= toMin(settings.fb_draft_time || '07:00')) await ensureDrafts(env, now.date);
  if (!env.FB_PAGE_TOKEN) return;
  const statuses = settings.fb_mode === 'auto' ? ['approved', 'draft'] : ['approved'];
  const { results } = await env.DB.prepare(
    `SELECT * FROM fb_posts WHERE date = ? AND time <= ? AND time >= ? AND status IN (${statuses.map(() => '?').join(',')}) ORDER BY time`,
  ).bind(now.date, now.time, fromMinSafe(toMin(now.time) - 180), ...statuses).all(); // เลยเวลาเกิน 3 ชม. ไม่โพสต์ย้อนหลัง
  for (const p of results.map(parsePost)) {
    if (settings.fb_mode === 'auto' && !p.price_ok) {
      await markPost(env, p.id, { status: 'failed', error: 'ราคาในข้อความไม่ตรงกับระบบ — ไม่ได้โพสต์' });
      continue;
    }
    await publishPost(env, p);
  }
  // ร่างที่ไม่ได้อนุมัติ เลยเวลามา 3 ชม. → ข้าม
  await env.DB.prepare(`UPDATE fb_posts SET status = 'skipped', updated_at = ? WHERE status IN ('draft','approved') AND (date < ? OR (date = ? AND time < ?))`)
    .bind(nowISO(), now.date, now.date, fromMinSafe(toMin(now.time) - 180)).run();
}
const fromMinSafe = (m) => (m < 0 ? '00:00' : String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
