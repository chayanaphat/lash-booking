// LINE Messaging API webhook
import { getBookingByCode, getPromotions, getSettings, getStyles, parseBooking, styleMap, upsertUser } from './db.js';
import { latestPendingFor, processSlip } from './bookings.js';
import { getMessageContent, reply, verifySignature } from './line.js';
import { confirmedFlex, depositFlex, liffUrl, text } from './messages.js';
import { activePromotions, promoText } from './pricing.js';
import { bkkNow, errorResponse, json, thaiDate } from './util.js';

export async function handleWebhook(req, env, ctx) {
  const body = await req.text();
  const ok = await verifySignature(env.LINE_CHANNEL_SECRET, body, req.headers.get('x-line-signature'));
  if (!ok) return errorResponse(401, 'bad_signature');
  const data = JSON.parse(body);
  ctx.waitUntil(Promise.all((data.events || []).map((e) => handleEvent(e, env).catch((err) => console.error('event', err)))));
  return json({ ok: true });
}

const STATUS_TH = {
  pending_deposit: 'รอชำระมัดจำ',
  verifying: 'รอแอดมินตรวจสลิป',
  confirmed: 'ยืนยันแล้ว',
  completed: 'ใช้บริการแล้ว',
  cancelled: 'ยกเลิก',
};

async function handleEvent(e, env) {
  const userId = e.source?.userId;
  if (!userId || !e.replyToken) return;

  if (e.type === 'follow') {
    await upsertUser(env, { userId, name: '', picture: null });
    const s = await getSettings(env);
    return reply(env, e.replyToken, text(
      `ยินดีต้อนรับสู่ ${s.shop_name} 💕\nกดเมนู "จองคิว" ด้านล่าง เพื่อเลือกทรงขนตาและวันเวลาได้เลยค่ะ\n${liffUrl(env)}`,
    ));
  }
  if (e.type !== 'message') return;

  // ---------- slip image ----------
  if (e.message.type === 'image') {
    const booking = await latestPendingFor(env, userId);
    if (!booking) return; // not a slip – let staff handle the chat
    const img = await getMessageContent(env, e.message.id);
    const r = await processSlip(env, booking, { ...img, payload: null });
    if (r.status === 'confirmed') return reply(env, e.replyToken, confirmedFlex(env, r.booking));
    if (r.status === 'verifying') {
      return reply(env, e.replyToken, text(`ได้รับสลิปแล้วค่ะ 🧾 (รหัส ${booking.code})\nแอดมินจะตรวจสอบและยืนยันคิวให้เร็วที่สุดนะคะ`));
    }
    return reply(env, e.replyToken, text(`❗ ตรวจสลิปไม่ผ่าน: ${r.reason}\nกรุณาส่งรูปสลิปใหม่อีกครั้งค่ะ`));
  }

  if (e.message.type !== 'text') return;
  const msg = e.message.text.trim();

  // message sent from LIFF after booking: contains "รหัส: BKXXXXXX"
  const m = /(BK[A-Z0-9]{6})/.exec(msg);
  if (m) {
    const b = await getBookingByCode(env, m[1]);
    if (!b || b.line_user_id !== userId) return;
    const s = await getSettings(env);
    if (b.status === 'pending_deposit') return reply(env, e.replyToken, depositFlex(env, b, s));
    if (b.status === 'confirmed') return reply(env, e.replyToken, confirmedFlex(env, b));
    return reply(env, e.replyToken, text(`รหัส ${b.code}: ${STATUS_TH[b.status]}`));
  }

  if (/โปร/.test(msg)) {
    const [promos, styles] = await Promise.all([getPromotions(env), getStyles(env)]);
    const today = bkkNow().date;
    const list = promos.filter((p) => p.active && (!p.end_date || p.end_date >= today));
    if (!list.length) return reply(env, e.replyToken, text('ตอนนี้ยังไม่มีโปรโมชั่นค่ะ ติดตามได้เร็ว ๆ นี้ 💕'));
    const map = styleMap(styles);
    const lines = list.map((p) => {
      const range = p.start_date || p.end_date ? ` (${p.start_date ? thaiDate(p.start_date) : ''} – ${p.end_date ? thaiDate(p.end_date) : ''})` : '';
      const now = activePromotions([p], today).length ? '' : ' [เร็ว ๆ นี้]';
      return `🎀 ${p.name}${now}\n   ${promoText(p, map)}${range}`;
    });
    return reply(env, e.replyToken, text(`โปรโมชั่น\n\n${lines.join('\n\n')}\n\nจองเลย 👉 ${liffUrl(env)}`));
  }

  if (/แต้ม|สะสม|บัตร/.test(msg)) {
    const [u, s] = await Promise.all([upsertUser(env, { userId, name: '', picture: null }), getSettings(env)]);
    const filled = '●'.repeat(Math.min(u.stamps, s.stamps_required)) + '○'.repeat(Math.max(0, s.stamps_required - u.stamps));
    const extra = u.stamps >= s.stamps_required ? '\n🎁 ใช้สิทธิ์ต่อขนตาฟรี 1 ทรงได้แล้ว! เลือกตอนจองคิวได้เลย' : `\nอีก ${s.stamps_required - u.stamps} ครั้ง รับฟรี 1 ทรง`;
    return reply(env, e.replyToken, text(`บัตรสะสมแต้ม\n${filled}\n${u.stamps}/${s.stamps_required}${extra}`));
  }

  if (/คิว|นัด/.test(msg)) {
    const { results } = await env.DB.prepare(
      `SELECT * FROM bookings WHERE line_user_id = ? AND date >= ? AND status IN ('pending_deposit','verifying','confirmed') ORDER BY date, start_time LIMIT 5`,
    ).bind(userId, bkkNow().date).all();
    if (!results.length) return reply(env, e.replyToken, text(`ยังไม่มีคิวที่จองไว้ค่ะ\nจองได้ที่ 👉 ${liffUrl(env)}`));
    const lines = results.map(parseBooking).map((b) => `• ${thaiDate(b.date)} ${b.start_time} น. – ${b.items.map((i) => i.name).join(', ')}\n  ${b.code} · ${STATUS_TH[b.status]}`);
    return reply(env, e.replyToken, text(`คิวของคุณ\n${lines.join('\n')}`));
  }
}
