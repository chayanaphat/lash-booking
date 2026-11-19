// Lash booking API — Cloudflare Worker
import {
  PUBLIC_SETTING_KEYS, adminIds, envAdminIds, ensureBlocks, ensureReviews, ensureStyleStamps, getBlocks, getReviewAlbums, notifyAdminIds, getBookingByCode, getHolidays, getHours, getImage, getPromotions,
  getSettings, getStyles, isAdmin, parseBooking, parsePromo, saveImage, saveSettings, styleGallery, upsertUser,
} from './db.js';
import { buildQuote, cancelOwn, changeStatus, createBooking, expirePending, processSlip, sendReminders, slotsFor } from './bookings.js';
import { userFromRequest } from './line.js';
import { handleWebhook } from './webhook.js';
import { imageStats, runImageCleanup } from './cleanup.js';
import {
  FB_THEMES, composeDraft, ensureDrafts, ensureFb, fbConfigured, getSchedules, pageInfo, parsePost, publishPost, runFbCron,
} from './fbpost.js';
import {
  HttpError, addDays, bkkNow, errorResponse, int, isDate, isTime, json, parseDataUrl, readJson, str,
} from './util.js';

// ---------------------------------------------------------------- router
const routes = [];
const on = (method, path, auth, handler) => {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, auth, handler });
};

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), env);
    let res;
    try {
      res = await route(req, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) res = errorResponse(e.status, e.message, e.extra);
      else {
        console.error(e);
        res = errorResponse(500, 'internal_error');
      }
    }
    return cors(res, env);
  },
  async scheduled(_evt, env, ctx) {
    ctx.waitUntil(Promise.all([expirePending(env), sendReminders(env), runFbCron(env).catch((e) => console.error('fb cron', e)), runImageCleanup(env).catch((e) => console.error('image cleanup', e))]));
  },
};

function cors(res, env) {
  const h = new Headers(res.headers);
  h.set('access-control-allow-origin', env.ALLOWED_ORIGIN || '*');
  h.set('access-control-allow-headers', 'authorization, content-type, x-dev-user');
  h.set('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
  h.set('access-control-max-age', '86400');
  return new Response(res.body, { status: res.status, headers: h });
}

async function route(req, env, ctx) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const c = { req, env, ctx, url, params, query: url.searchParams };
    if (r.auth) {
      c.user = await userFromRequest(req, env);
      if (r.auth === 'admin' && !(await isAdmin(env, c.user.userId))) throw new HttpError(403, 'forbidden');
    }
    return r.handler(c);
  }
  return errorResponse(404, 'not_found');
}

// ---------------------------------------------------------------- public
on('GET', '/', false, () => json({ ok: true, service: 'lash-booking-api' }));
on('POST', '/webhook', false, ({ req, env, ctx }) => handleWebhook(req, env, ctx));

on('GET', '/img/:id', false, async ({ env, params }) => {
  const img = await getImage(env, params.id.replace(/\.(jpe?g|png|webp)$/, ''));
  if (!img) return errorResponse(404, 'not_found');
  return new Response(img.bytes, {
    headers: { 'content-type': img.mime, 'cache-control': 'public, max-age=31536000, immutable' },
  });
});

on('GET', '/api/public/info', false, async ({ env }) => {
  const today = bkkNow().date;
  const [settings, styles, promos, hours, holidays, reviews] = await Promise.all([
    getSettings(env), getStyles(env, { activeOnly: true }), getPromotions(env), getHours(env), getHolidays(env, today),
    getReviewAlbums(env, { publicOnly: true }).catch(() => []),
  ]);
  return json({
    today,
    settings: Object.fromEntries(PUBLIC_SETTING_KEYS.map((k) => [k, settings[k]])),
    styles,
    promotions: promos.filter((p) => p.active && (!p.end_date || p.end_date >= today)),
    hours,
    holidays,
    reviews: reviews.map((a) => ({ id: a.id, name: a.name, photos: a.photos.map((p) => ({ image_id: p.image_id, caption: p.caption, style_id: p.style_id })) })),
  });
});

on('GET', '/api/slots', false, async ({ env, query }) => {
  const date = query.get('date');
  if (!isDate(date)) throw new HttpError(400, 'invalid_date');
  const settings = await getSettings(env);
  const ids = (query.get('styles') || '').split(',').map(Number).filter(Boolean);
  let duration = 120;
  if (ids.length) {
    const styles = await getStyles(env, { activeOnly: true });
    duration = ids.reduce((a, id) => a + (styles.find((s) => s.id === id)?.duration_min || 120), 0);
  }
  return json(await slotsFor(env, date, duration, settings));
});

// ---------------------------------------------------------------- customer
on('GET', '/api/me', true, async ({ env, user }) => {
  const [u, settings, admin] = await Promise.all([upsertUser(env, user), getSettings(env), isAdmin(env, user.userId)]);
  return json({ user: u, is_admin: admin, stamps_required: settings.stamps_required });
});

on('POST', '/api/quote', true, async ({ env, req }) => {
  const body = await readJson(req);
  const settings = await getSettings(env);
  return json(await buildQuote(env, body, settings));
});

on('POST', '/api/bookings', true, async ({ env, req, user }) => {
  const body = await readJson(req);
  const dbUser = await upsertUser(env, user);
  return json({ booking: await createBooking(env, user, dbUser, body) }, 201);
});

on('GET', '/api/bookings/mine', true, async ({ env, user }) => {
  const { results } = await env.DB.prepare(
    `SELECT * FROM bookings WHERE line_user_id = ? ORDER BY date DESC, start_time DESC LIMIT 50`,
  ).bind(user.userId).all();
  return json({ bookings: results.map(parseBooking) });
});

async function ownBooking(env, user, code) {
  const b = await getBookingByCode(env, code);
  if (!b) throw new HttpError(404, 'booking_not_found');
  if (b.line_user_id !== user.userId && !(await isAdmin(env, user.userId))) throw new HttpError(404, 'booking_not_found');
  return b;
}

on('GET', '/api/bookings/:code', true, async ({ env, user, params }) => json({ booking: await ownBooking(env, user, params.code) }));

on('POST', '/api/bookings/:code/slip', true, async ({ env, req, user, params }) => {
  const b = await ownBooking(env, user, params.code);
  const body = await readJson(req);
  const { mime, bytes } = parseDataUrl(body.image);
  const payload = typeof body.payload === 'string' && body.payload.length <= 255 ? body.payload : null;
  const r = await processSlip(env, b, { bytes, mime, payload });
  return json(r);
});

on('POST', '/api/bookings/:code/cancel', true, async ({ env, user, params }) => json({ booking: await cancelOwn(env, user, params.code) }));

// ---------------------------------------------------------------- admin
on('GET', '/api/admin/bookings', 'admin', async ({ env, query }) => {
  const today = bkkNow().date;
  const from = isDate(query.get('from')) ? query.get('from') : today;
  const to = isDate(query.get('to')) ? query.get('to') : addDays(from, 6);
  const status = query.get('status');
  let sql = `SELECT b.*, u.display_name, u.picture_url, u.stamps FROM bookings b LEFT JOIN users u ON u.line_user_id = b.line_user_id WHERE `;
  const binds = [];
  if (status === 'verifying') sql += `b.status = 'verifying'`;
  else {
    sql += `b.date BETWEEN ? AND ?`;
    binds.push(from, to);
    if (status) {
      sql += ' AND b.status = ?';
      binds.push(status);
    }
  }
  sql += ' ORDER BY b.date, b.start_time LIMIT 300';
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ from, to, bookings: results.map(parseBooking) });
});

on('POST', '/api/admin/bookings/:code/status', 'admin', async ({ env, req, params }) => {
  const body = await readJson(req);
  return json({ booking: await changeStatus(env, params.code, body.action, { note: str(body.note, 300), date: body.date, time: body.time }) });
});

// styles
function styleInput(b) {
  const s = {
    name: str(b.name, 80),
    description: str(b.description, 300),
    price: int(b.price, -1),
    duration_min: int(b.duration_min, 120),
    image_id: b.image_id ? str(b.image_id, 64) : null,
    sort: int(b.sort, 0),
    active: b.active === false || b.active === 0 ? 0 : 1,
    category: str(b.category, 60) || 'บริการ',
    kind: b.kind === 'addon' ? 'addon' : 'main',
    stamps: Math.min(5, Math.max(0, int(b.stamps, 0))),
    redeemable: b.redeemable === true || b.redeemable === 1 || b.redeemable === '1' ? 1 : 0,
    gallery: JSON.stringify([...new Set((Array.isArray(b.gallery) ? b.gallery : []).map((x) => str(x, 64)).filter(Boolean))]),
  };
  // รูปหลักต้องอยู่ในแกลเลอรี · ไม่ได้เลือกรูปหลัก = ใช้รูปแรก
  const g = JSON.parse(s.gallery);
  if (s.image_id && !g.includes(s.image_id)) g.unshift(s.image_id);
  if (!s.image_id && g.length) s.image_id = g[0];
  if (g.length > 5) throw new HttpError(400, 'too_many_images'); // สูงสุด 5 รูปต่อทรง
  s.gallery = JSON.stringify(g);
  if (!s.name || s.price < 0 || s.duration_min < 15) throw new HttpError(400, 'invalid_style');
  return s;
}
on('GET', '/api/admin/styles', 'admin', async ({ env }) => json({ styles: await getStyles(env) }));
on('POST', '/api/admin/styles', 'admin', async ({ env, req }) => {
  const s = styleInput(await readJson(req));
  await ensureStyleStamps(env);
  const r = await env.DB.prepare('INSERT INTO styles (name, description, price, duration_min, image_id, sort, active, category, kind, stamps, redeemable, gallery) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(s.name, s.description, s.price, s.duration_min, s.image_id, s.sort, s.active, s.category, s.kind, s.stamps, s.redeemable, s.gallery).run();
  return json({ id: r.meta.last_row_id }, 201);
});
on('PUT', '/api/admin/styles/:id', 'admin', async ({ env, req, params }) => {
  const s = styleInput(await readJson(req));
  await ensureStyleStamps(env);
  await env.DB.prepare('UPDATE styles SET name=?, description=?, price=?, duration_min=?, image_id=?, sort=?, active=?, category=?, kind=?, stamps=?, redeemable=?, gallery=? WHERE id=?')
    .bind(s.name, s.description, s.price, s.duration_min, s.image_id, s.sort, s.active, s.category, s.kind, s.stamps, s.redeemable, s.gallery, int(params.id)).run();
  return json({ ok: true });
});
// รูปสำหรับโพสต์เพจของทรง (แอดมินเรนเดอร์ลายน้ำ+ชื่อทรงในเบราว์เซอร์ แล้วส่งแผนที่รูปมาเก็บ)
on('PUT', '/api/admin/styles/:id/wm', 'admin', async ({ env, req, params }) => {
  const b = await readJson(req);
  await ensureStyleStamps(env);
  const row = await env.DB.prepare('SELECT gallery, image_id FROM styles WHERE id = ?').bind(int(params.id)).first();
  if (!row) throw new HttpError(404, 'not_found');
  const gallery = styleGallery(row);
  const map = {};
  for (const [k, v] of Object.entries(b.map && typeof b.map === 'object' ? b.map : {})) {
    if (gallery.includes(k) && v && typeof v.id === 'string') map[k] = { id: str(v.id, 64), plain: v.plain ? 1 : 0 };
  }
  const wm = {
    name: str(b.name, 80),
    plain: (Array.isArray(b.plain) ? b.plain : []).map((x) => str(x, 64)).filter((x) => gallery.includes(x)),
    map,
  };
  await env.DB.prepare('UPDATE styles SET gallery_wm = ? WHERE id = ?').bind(JSON.stringify(wm), int(params.id)).run();
  return json({ ok: true, wm });
});
on('DELETE', '/api/admin/styles/:id', 'admin', async ({ env, params }) => {
  await env.DB.prepare('DELETE FROM styles WHERE id = ?').bind(int(params.id)).run();
  return json({ ok: true });
});

// promotions
function promoInput(b) {
  const type = ['discount', 'percent', 'fixed_price'].includes(b.type) ? b.type : null;
  const p = {
    name: str(b.name, 100),
    description: str(b.description, 300),
    type,
    min_people: Math.max(1, int(b.min_people, 1)),
    discount: Math.max(0, int(b.discount, 0)),
    style_ids: Array.isArray(b.style_ids) && b.style_ids.length ? JSON.stringify(b.style_ids.map(Number)) : null,
    fixed_prices: b.fixed_prices && typeof b.fixed_prices === 'object'
      ? JSON.stringify(Object.fromEntries(Object.entries(b.fixed_prices).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, int(v)])))
      : null,
    start_date: isDate(b.start_date) ? b.start_date : null,
    end_date: isDate(b.end_date) ? b.end_date : null,
    active: b.active === false || b.active === 0 ? 0 : 1,
  };
  if (!p.name || !p.type) throw new HttpError(400, 'invalid_promotion');
  if (p.type === 'percent' && p.discount > 100) throw new HttpError(400, 'invalid_percent');
  return p;
}
const PROMO_COLS = ['name', 'description', 'type', 'min_people', 'discount', 'style_ids', 'fixed_prices', 'start_date', 'end_date', 'active'];
on('GET', '/api/admin/promotions', 'admin', async ({ env }) => json({ promotions: await getPromotions(env) }));
on('POST', '/api/admin/promotions', 'admin', async ({ env, req }) => {
  const p = promoInput(await readJson(req));
  const r = await env.DB.prepare(`INSERT INTO promotions (${PROMO_COLS}) VALUES (${PROMO_COLS.map(() => '?')})`)
    .bind(...PROMO_COLS.map((k) => p[k])).run();
  return json({ id: r.meta.last_row_id }, 201);
});
on('PUT', '/api/admin/promotions/:id', 'admin', async ({ env, req, params }) => {
  const p = promoInput(await readJson(req));
  await env.DB.prepare(`UPDATE promotions SET ${PROMO_COLS.map((k) => k + '=?')} WHERE id=?`)
    .bind(...PROMO_COLS.map((k) => p[k]), int(params.id)).run();
  const row = await env.DB.prepare('SELECT * FROM promotions WHERE id=?').bind(int(params.id)).first();
  return json({ promotion: row && parsePromo(row) });
});
on('DELETE', '/api/admin/promotions/:id', 'admin', async ({ env, params }) => {
  await env.DB.prepare('DELETE FROM promotions WHERE id = ?').bind(int(params.id)).run();
  return json({ ok: true });
});

// business hours & holidays
on('PUT', '/api/admin/hours', 'admin', async ({ env, req }) => {
  const body = await readJson(req);
  const rows = (body.hours || []).filter((h) => h.weekday >= 0 && h.weekday <= 6);
  for (const h of rows) {
    if (!isTime(h.open_time) || !isTime(h.close_time) || h.open_time >= h.close_time) throw new HttpError(400, 'invalid_hours');
  }
  await env.DB.batch(rows.map((h) => env.DB.prepare(
    `INSERT INTO business_hours (weekday, open_time, close_time, closed) VALUES (?,?,?,?)
     ON CONFLICT(weekday) DO UPDATE SET open_time=excluded.open_time, close_time=excluded.close_time, closed=excluded.closed`,
  ).bind(int(h.weekday), h.open_time, h.close_time, h.closed ? 1 : 0)));
  return json({ hours: await getHours(env) });
});
on('GET', '/api/admin/holidays', 'admin', async ({ env }) => json({ holidays: await getHolidays(env, addDays(bkkNow().date, -30)) }));
on('POST', '/api/admin/holidays', 'admin', async ({ env, req }) => {
  const b = await readJson(req);
  if (!isDate(b.date)) throw new HttpError(400, 'invalid_date');
  const end = isDate(b.end_date) && b.end_date >= b.date ? b.end_date : b.date;
  const stmts = [];
  for (let d = b.date, i = 0; d <= end && i < 62; d = addDays(d, 1), i++) {
    stmts.push(env.DB.prepare('INSERT OR REPLACE INTO holidays (date, note) VALUES (?, ?)').bind(d, str(b.note, 100)));
  }
  await env.DB.batch(stmts);
  return json({ added: stmts.length }, 201);
});
on('DELETE', '/api/admin/holidays/:date', 'admin', async ({ env, params }) => {
  await env.DB.prepare('DELETE FROM holidays WHERE date = ?').bind(params.date).run();
  return json({ ok: true });
});

// time blocks: ปิดรับคิวบางช่วงในวัน (ไปธุระ / ลูกค้าจองผ่านช่องทางอื่น)
on('GET', '/api/admin/blocks', 'admin', async ({ env, url }) => {
  const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : bkkNow().date;
  const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : addDays(from, 90);
  return json({ blocks: await getBlocks(env, from, to) });
});
on('POST', '/api/admin/blocks', 'admin', async ({ env, req }) => {
  const b = await readJson(req);
  if (!isDate(b.date)) throw new HttpError(400, 'invalid_date');
  if (!isTime(b.start_time) || !isTime(b.end_time) || b.start_time >= b.end_time) throw new HttpError(400, 'invalid_time_range');
  await ensureBlocks(env);
  const r = await env.DB.prepare('INSERT INTO time_blocks (date, start_time, end_time, note) VALUES (?,?,?,?)')
    .bind(b.date, b.start_time, b.end_time, str(b.note, 100)).run();
  return json({ id: r.meta?.last_row_id }, 201);
});
on('DELETE', '/api/admin/blocks/:id', 'admin', async ({ env, params }) => {
  await ensureBlocks(env);
  await env.DB.prepare('DELETE FROM time_blocks WHERE id = ?').bind(int(params.id)).run();
  return json({ ok: true });
});

// settings
on('GET', '/api/admin/storage', 'admin', async ({ env }) => json(await imageStats(env)));
on('GET', '/api/admin/settings', 'admin', async ({ env }) => json({ settings: await getSettings(env), slip_auto: !!env.EASYSLIP_API_KEY }));
on('PUT', '/api/admin/settings', 'admin', async ({ env, req }) => {
  await saveSettings(env, await readJson(req));
  return json({ settings: await getSettings(env) });
});

// images (style photos)
on('POST', '/api/admin/images', 'admin', async ({ env, req }) => {
  const body = await readJson(req);
  const { mime, bytes } = parseDataUrl(body.image);
  return json({ id: await saveImage(env, bytes, mime, 'style') }, 201);
});

// reviews (อัลบั้มไฮไลต์)
// ---------------------------------------------------------------- admin: โพสต์เพจ Facebook
const fbPostById = async (env, id) => parsePost(await env.DB.prepare('SELECT * FROM fb_posts WHERE id = ?').bind(id).first());
const fbImages = (v) => (Array.isArray(v) ? v.map((x) => str(x, 64)).filter(Boolean).slice(0, 4) : []);
const fbDays = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();

on('GET', '/api/admin/fb', 'admin', async ({ env }) => {
  await ensureFb(env);
  const today = bkkNow().date;
  const [schedules, posts, fallbacks] = await Promise.all([
    getSchedules(env),
    env.DB.prepare('SELECT * FROM fb_posts WHERE date >= ? ORDER BY date, time').bind(today).all(),
    env.DB.prepare('SELECT * FROM fb_fallbacks ORDER BY id DESC').all(),
  ]);
  let page = null;
  if (env.FB_PAGE_TOKEN) {
    try { page = await pageInfo(env); } catch (e) { page = { error: String(e.message || e) }; }
  }
  return json({
    configured: fbConfigured(env), page, today, themes: FB_THEMES, schedules,
    posts: posts.results.map(parsePost), fallbacks: fallbacks.results.map((f) => ({ ...f, image_ids: JSON.parse(f.image_ids || '[]') })),
  });
});
on('GET', '/api/admin/fb/history', 'admin', async ({ env }) => {
  await ensureFb(env);
  const { results } = await env.DB.prepare(
    `SELECT * FROM fb_posts WHERE status IN ('posted','failed','skipped') OR date < ? ORDER BY date DESC, time DESC LIMIT 60`,
  ).bind(bkkNow().date).all();
  return json({ posts: results.map(parsePost) });
});
on('POST', '/api/admin/fb/schedules', 'admin', async ({ env, req }) => {
  await ensureFb(env);
  const b = await readJson(req);
  if (!isTime(b.time)) throw new HttpError(400, 'invalid_time');
  const days = fbDays(b.days);
  if (!days.length) throw new HttpError(400, 'days_required');
  await env.DB.prepare('INSERT INTO fb_schedules (time, days, theme, active, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(b.time, JSON.stringify(days), str(b.theme, 30), b.active === false ? 0 : 1, new Date().toISOString()).run();
  return json({ ok: true });
});
on('PUT', '/api/admin/fb/schedules/:id', 'admin', async ({ env, req, params }) => {
  await ensureFb(env);
  const b = await readJson(req);
  if (!isTime(b.time)) throw new HttpError(400, 'invalid_time');
  const days = fbDays(b.days);
  if (!days.length) throw new HttpError(400, 'days_required');
  await env.DB.prepare('UPDATE fb_schedules SET time = ?, days = ?, theme = ?, active = ? WHERE id = ?')
    .bind(b.time, JSON.stringify(days), str(b.theme, 30), b.active === false ? 0 : 1, int(params.id)).run();
  return json({ ok: true });
});
on('DELETE', '/api/admin/fb/schedules/:id', 'admin', async ({ env, params }) => {
  await ensureFb(env);
  await env.DB.prepare('DELETE FROM fb_schedules WHERE id = ?').bind(int(params.id)).run();
  return json({ ok: true });
});
// ร่างโพสต์ของวันนี้ทันที (ไม่ต้องรอเวลาร่าง)
on('POST', '/api/admin/fb/generate', 'admin', async ({ env }) => json({ made: await ensureDrafts(env, bkkNow().date) }));
on('PUT', '/api/admin/fb/posts/:id', 'admin', async ({ env, req, params }) => {
  await ensureFb(env);
  const p = await fbPostById(env, int(params.id));
  if (!p) throw new HttpError(404, 'not_found');
  if (['posted'].includes(p.status)) throw new HttpError(409, 'already_posted');
  const b = await readJson(req);
  const status = ['draft', 'approved', 'skipped'].includes(b.status) ? b.status : p.status === 'failed' ? 'draft' : p.status;
  await env.DB.prepare('UPDATE fb_posts SET text = ?, image_ids = ?, status = ?, price_ok = 1, error = ?, updated_at = ? WHERE id = ?')
    .bind(str(b.text ?? p.text, 3000), JSON.stringify(b.image_ids ? fbImages(b.image_ids) : p.image_ids), status, '', new Date().toISOString(), p.id).run();
  return json({ post: await fbPostById(env, p.id) });
});
on('POST', '/api/admin/fb/posts/:id/regenerate', 'admin', async ({ env, req, params }) => {
  await ensureFb(env);
  const p = await fbPostById(env, int(params.id));
  if (!p) throw new HttpError(404, 'not_found');
  if (p.status === 'posted') throw new HttpError(409, 'already_posted');
  if (!env.GEMINI_API_KEY) throw new HttpError(400, 'gemini_not_configured');
  const b = await readJson(req);
  let d;
  try {
    d = await composeDraft(env, { date: p.date, theme: p.theme, instruction: str(b.instruction, 200), current: p.text || ' ' });
  } catch (e) {
    throw new HttpError(502, 'ai_failed', { detail: String(e.message || e).slice(0, 200) });
  }
  await env.DB.prepare(`UPDATE fb_posts SET text = ?, image_ids = ?, source = 'ai', price_ok = ?, status = 'draft', error = '', updated_at = ? WHERE id = ?`)
    .bind(d.text, JSON.stringify(b.keep_images ? p.image_ids : d.image_ids), d.price_ok ? 1 : 0, new Date().toISOString(), p.id).run();
  return json({ post: await fbPostById(env, p.id) });
});
// โพสต์ทันที (ทดสอบ / ลองใหม่หลังล้มเหลว)
on('POST', '/api/admin/fb/posts/:id/publish', 'admin', async ({ env, params }) => {
  await ensureFb(env);
  const p = await fbPostById(env, int(params.id));
  if (!p) throw new HttpError(404, 'not_found');
  if (p.status === 'posted') throw new HttpError(409, 'already_posted');
  if (!env.FB_PAGE_TOKEN) throw new HttpError(400, 'facebook_not_configured');
  return json(await publishPost(env, p));
});
on('POST', '/api/admin/fb/fallbacks', 'admin', async ({ env, req }) => {
  await ensureFb(env);
  const b = await readJson(req);
  const t = str(b.text, 3000);
  if (!t) throw new HttpError(400, 'text_required');
  await env.DB.prepare('INSERT INTO fb_fallbacks (text, image_ids, created_at) VALUES (?, ?, ?)')
    .bind(t, JSON.stringify(fbImages(b.image_ids)), new Date().toISOString()).run();
  return json({ ok: true });
});
on('DELETE', '/api/admin/fb/fallbacks/:id', 'admin', async ({ env, params }) => {
  await ensureFb(env);
  await env.DB.prepare('DELETE FROM fb_fallbacks WHERE id = ?').bind(int(params.id)).run();
  return json({ ok: true });
});

on('GET', '/api/admin/reviews', 'admin', async ({ env }) => json({ albums: await getReviewAlbums(env) }));
on('POST', '/api/admin/review-albums', 'admin', async ({ env, req }) => {
  const b = await readJson(req);
  const name = str(b.name, 30);
  if (!name) throw new HttpError(400, 'name_required');
  await ensureReviews(env);
  const max = await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM review_albums').first();
  const r = await env.DB.prepare('INSERT INTO review_albums (name, sort) VALUES (?, ?)').bind(name, (max?.m || 0) + 1).run();
  return json({ id: r.meta.last_row_id }, 201);
});
on('PUT', '/api/admin/review-albums/:id', 'admin', async ({ env, req, params }) => {
  const b = await readJson(req);
  const name = str(b.name, 30);
  if (!name) throw new HttpError(400, 'name_required');
  await ensureReviews(env);
  await env.DB.prepare('UPDATE review_albums SET name = ?, active = ? WHERE id = ?').bind(name, b.active === false ? 0 : 1, int(params.id)).run();
  return json({ ok: true });
});
on('DELETE', '/api/admin/review-albums/:id', 'admin', async ({ env, params }) => {
  await ensureReviews(env);
  const id = int(params.id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM images WHERE id IN (SELECT image_id FROM review_photos WHERE album_id = ?)').bind(id),
    env.DB.prepare('DELETE FROM review_photos WHERE album_id = ?').bind(id),
    env.DB.prepare('DELETE FROM review_albums WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
});
on('POST', '/api/admin/review-photos', 'admin', async ({ env, req }) => {
  const b = await readJson(req);
  const { mime, bytes } = parseDataUrl(b.image);
  await ensureReviews(env);
  const album = await env.DB.prepare('SELECT id FROM review_albums WHERE id = ?').bind(int(b.album_id)).first();
  if (!album) throw new HttpError(404, 'album_not_found');
  const imageId = await saveImage(env, bytes, mime, 'review');
  const max = await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM review_photos WHERE album_id = ?').bind(album.id).first();
  const r = await env.DB.prepare('INSERT INTO review_photos (album_id, image_id, caption, style_id, sort) VALUES (?,?,?,?,?)')
    .bind(album.id, imageId, str(b.caption, 120), int(b.style_id, 0) || null, (max?.m || 0) + 1).run();
  return json({ id: r.meta.last_row_id, image_id: imageId }, 201);
});
on('PUT', '/api/admin/review-photos/:id', 'admin', async ({ env, req, params }) => {
  const b = await readJson(req);
  await ensureReviews(env);
  await env.DB.prepare('UPDATE review_photos SET caption = ?, style_id = ? WHERE id = ?')
    .bind(str(b.caption, 120), int(b.style_id, 0) || null, int(params.id)).run();
  return json({ ok: true });
});
on('POST', '/api/admin/review-photos/reorder', 'admin', async ({ env, req }) => {
  const b = await readJson(req);
  const ids = (b.ids || []).map((x) => int(x)).filter(Boolean).slice(0, 200);
  await ensureReviews(env);
  if (ids.length) await env.DB.batch(ids.map((id, i) => env.DB.prepare('UPDATE review_photos SET sort = ? WHERE id = ?').bind(i + 1, id)));
  return json({ ok: true });
});
on('DELETE', '/api/admin/review-photos/:id', 'admin', async ({ env, params }) => {
  await ensureReviews(env);
  const p = await env.DB.prepare('SELECT image_id FROM review_photos WHERE id = ?').bind(int(params.id)).first();
  if (p) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM review_photos WHERE id = ?').bind(int(params.id)),
      env.DB.prepare('DELETE FROM images WHERE id = ?').bind(p.image_id),
    ]);
  }
  return json({ ok: true });
});

// customers / stamps
on('GET', '/api/admin/users', 'admin', async ({ env, query }) => {
  const q = `%${str(query.get('q'), 50)}%`;
  const { results } = await env.DB.prepare(
    `SELECT * FROM users WHERE display_name LIKE ? OR phone LIKE ? OR line_user_id LIKE ? ORDER BY updated_at DESC LIMIT 100`,
  ).bind(q, q, q).all();
  return json({ users: results });
});
on('PUT', '/api/admin/users/:id', 'admin', async ({ env, req, params }) => {
  const b = await readJson(req);
  await env.DB.prepare(`UPDATE users SET stamps = ?, updated_at = datetime('now') WHERE line_user_id = ?`)
    .bind(Math.max(0, int(b.stamps, 0)), params.id).run();
  return json({ ok: true });
});

// rich menu — ใช้ token ของ worker เอง (ไม่ต้องคัดลอก token ไปรันสคริปต์)
on('POST', '/api/admin/richmenu', 'admin', async ({ env, req }) => {
  const body = await readJson(req);
  const imageUrl = str(body.image_url, 300);
  if (!/^https:\/\//.test(imageUrl)) throw new HttpError(400, 'invalid_image_url');
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) throw new HttpError(400, 'line_token_missing');
  const auth = { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` };
  const liff = (q = '') => `https://liff.line.me/${env.LIFF_ID}${q}`;
  const menu = {
    size: { width: 2500, height: 843 }, selected: true, name: 'lash-booking-main', chatBarText: 'เมนูจองคิว',
    areas: [
      { bounds: { x: 0, y: 0, width: 1250, height: 843 }, action: { type: 'uri', label: 'จองคิว', uri: liff() } },
      { bounds: { x: 1250, y: 0, width: 1250, height: 843 }, action: { type: 'uri', label: 'แต้มสะสม', uri: liff('?p=my') } },
    ],
  };
  const list = await (await fetch('https://api.line.me/v2/bot/richmenu/list', { headers: auth })).json();
  for (const m of list.richmenus || []) {
    if (m.name === menu.name) await fetch(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { method: 'DELETE', headers: auth });
  }
  const created = await (await fetch('https://api.line.me/v2/bot/richmenu', {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(menu),
  })).json();
  if (!created.richMenuId) throw new HttpError(502, 'richmenu_create_failed', { detail: created.message });
  const img = await fetch(imageUrl);
  if (!img.ok) throw new HttpError(400, 'image_fetch_failed');
  const up = await fetch(`https://api-data.line.me/v2/bot/richmenu/${created.richMenuId}/content`, {
    method: 'POST', headers: { ...auth, 'content-type': img.headers.get('content-type') || 'image/jpeg' }, body: await img.arrayBuffer(),
  });
  if (!up.ok) throw new HttpError(502, 'richmenu_upload_failed', { detail: await up.text() });
  const def = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${created.richMenuId}`, { method: 'POST', headers: auth });
  if (!def.ok) throw new HttpError(502, 'richmenu_default_failed', { detail: await def.text() });
  return json({ ok: true, richMenuId: created.richMenuId });
});

// admins (เพิ่มได้จากหน้าแอดมิน หรือใส่ใน ADMIN_USER_IDS)
on('GET', '/api/admin/admins', 'admin', async ({ env }) => {
  const { results } = await env.DB.prepare('SELECT a.line_user_id, a.name, u.display_name, u.picture_url FROM admins a LEFT JOIN users u ON u.line_user_id = a.line_user_id').all();
  const envIds = envAdminIds(env);
  const envUsers = envIds.length
    ? (await env.DB.prepare(`SELECT line_user_id, display_name FROM users WHERE line_user_id IN (${envIds.map(() => '?').join(',')})`).bind(...envIds).all()).results
    : [];
  const notify = await notifyAdminIds(env, await getSettings(env));
  const list = [
    ...envIds.map((id) => ({ line_user_id: id, name: envUsers.find((u) => u.line_user_id === id)?.display_name || '', main: true })),
    ...results.filter((a) => !envIds.includes(a.line_user_id)).map((a) => ({ line_user_id: a.line_user_id, name: a.name || a.display_name || '', main: false })),
  ].map((a) => ({ ...a, notify: notify.includes(a.line_user_id) }));
  return json({ env_admins: envIds, admins: results, all: await adminIds(env), list });
});
on('POST', '/api/admin/admins', 'admin', async ({ env, req }) => {
  const b = await readJson(req);
  const id = str(b.line_user_id, 64);
  if (!/^U[0-9a-f]{32}$/.test(id)) throw new HttpError(400, 'invalid_user_id');
  await env.DB.prepare('INSERT OR REPLACE INTO admins (line_user_id, name) VALUES (?, ?)').bind(id, str(b.name, 50)).run();
  return json({ ok: true }, 201);
});
on('DELETE', '/api/admin/admins/:id', 'admin', async ({ env, params, user }) => {
  if (params.id === user.userId) throw new HttpError(400, 'cannot_remove_self');
  await env.DB.prepare('DELETE FROM admins WHERE line_user_id = ?').bind(params.id).run();
  return json({ ok: true });
});
