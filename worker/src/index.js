// Lash booking API — Cloudflare Worker
import {
  PUBLIC_SETTING_KEYS, adminIds, envAdminIds, notifyAdminIds, getBookingByCode, getHolidays, getHours, getImage, getPromotions,
  getSettings, getStyles, isAdmin, parseBooking, parsePromo, saveImage, saveSettings, upsertUser,
} from './db.js';
import { buildQuote, cancelOwn, changeStatus, createBooking, expirePending, processSlip, sendReminders, slotsFor } from './bookings.js';
import { userFromRequest } from './line.js';
import { handleWebhook } from './webhook.js';
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
    ctx.waitUntil(Promise.all([expirePending(env), sendReminders(env)]));
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
  const [settings, styles, promos, hours, holidays] = await Promise.all([
    getSettings(env), getStyles(env, { activeOnly: true }), getPromotions(env), getHours(env), getHolidays(env, today),
  ]);
  return json({
    today,
    settings: Object.fromEntries(PUBLIC_SETTING_KEYS.map((k) => [k, settings[k]])),
    styles,
    promotions: promos.filter((p) => p.active && (!p.end_date || p.end_date >= today)),
    hours,
    holidays,
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
  };
  if (!s.name || s.price < 0 || s.duration_min < 15) throw new HttpError(400, 'invalid_style');
  return s;
}
on('GET', '/api/admin/styles', 'admin', async ({ env }) => json({ styles: await getStyles(env) }));
on('POST', '/api/admin/styles', 'admin', async ({ env, req }) => {
  const s = styleInput(await readJson(req));
  const r = await env.DB.prepare('INSERT INTO styles (name, description, price, duration_min, image_id, sort, active, category, kind) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(s.name, s.description, s.price, s.duration_min, s.image_id, s.sort, s.active, s.category, s.kind).run();
  return json({ id: r.meta.last_row_id }, 201);
});
on('PUT', '/api/admin/styles/:id', 'admin', async ({ env, req, params }) => {
  const s = styleInput(await readJson(req));
  await env.DB.prepare('UPDATE styles SET name=?, description=?, price=?, duration_min=?, image_id=?, sort=?, active=?, category=?, kind=? WHERE id=?')
    .bind(s.name, s.description, s.price, s.duration_min, s.image_id, s.sort, s.active, s.category, s.kind, int(params.id)).run();
  return json({ ok: true });
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

// settings
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
      { bounds: { x: 1250, y: 0, width: 1250, height: 421 }, action: { type: 'uri', label: 'โปรโมชั่น', uri: liff('?p=promos') } },
      { bounds: { x: 1250, y: 421, width: 1250, height: 422 }, action: { type: 'uri', label: 'แต้มสะสม', uri: liff('?p=my') } },
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
