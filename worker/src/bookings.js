// Booking service — shared by REST API, LINE webhook and cron
import {
  BLOCKING_SQL, busyForDate, notifyAdminIds, getBookingByCode, getHolidays, getHours, getPromotions,
  getSettings, getStyles, parseBooking, saveImage, styleMap,
} from './db.js';
import { push, multicast } from './line.js';
import { adminNotice, confirmedFlex, locationMessage, reminderFlex, text, thankYouFlex } from './messages.js';
import { quote } from './pricing.js';
import { verifySlip } from './slip.js';
import { computeSlots } from './slots.js';
import { HttpError, addDays, bkkNow, fromMin, genCode, isDate, isTime, isoAfterMinutes, nowISO, str, toMin } from './util.js';

export async function buildQuote(env, { date, style_ids, use_reward = false }, settings) {
  if (!isDate(date)) throw new HttpError(400, 'invalid_date');
  const ids = (style_ids || []).map(Number).filter(Boolean);
  if (!ids.length) throw new HttpError(400, 'no_styles');
  if (ids.length > settings.max_people * 3) throw new HttpError(400, 'too_many_items');
  const [styles, promos] = await Promise.all([getStyles(env, { activeOnly: true }), getPromotions(env)]);
  const map = styleMap(styles);
  for (const id of ids) if (!map[id]) throw new HttpError(400, 'style_not_found');
  if (ids.filter((id) => map[id].kind !== 'addon').length > settings.max_people) throw new HttpError(400, 'too_many_people');
  const q = quote(map, ids, promos, date, { useReward: use_reward });
  q.deposit_amount = Math.min(settings.deposit_amount, q.total);
  return q;
}

export async function slotsFor(env, date, duration, settings, excludeCode = null) {
  const [hours, holidays, busy] = await Promise.all([getHours(env), getHolidays(env, date), busyForDate(env, date, excludeCode)]);
  return computeSlots({
    date, duration, hours, busy, settings, now: bkkNow(),
    holidays: new Set(holidays.map((h) => h.date)),
  });
}

export async function createBooking(env, user, dbUser, body) {
  const settings = await getSettings(env);
  const { date, time } = body;
  if (!isTime(time)) throw new HttpError(400, 'invalid_time');
  const name = str(body.customer_name, 80) || dbUser.display_name;
  const phone = str(body.phone, 20).replace(/[^0-9+]/g, '');
  if (!name) throw new HttpError(400, 'name_required');
  if (phone.length < 9) throw new HttpError(400, 'phone_required');

  // one pending booking at a time (prevents slot hogging)
  const pending = await env.DB.prepare(
    `SELECT code FROM bookings WHERE line_user_id = ? AND status = 'pending_deposit' AND expires_at > ?`,
  ).bind(user.userId, nowISO()).first();
  if (pending) throw new HttpError(409, 'has_pending_booking', { code: pending.code });

  const useReward = !!body.use_reward;
  if (useReward && dbUser.stamps < settings.stamps_required) throw new HttpError(400, 'not_enough_stamps');

  const q = await buildQuote(env, { date, style_ids: body.style_ids, use_reward: useReward }, settings);
  const slots = await slotsFor(env, date, q.duration_min, settings);
  const slot = slots.slots.find((s) => s.time === time);
  if (!slot || !slot.available) throw new HttpError(409, 'slot_unavailable');

  const now = nowISO();
  const deposit = q.deposit_amount;
  const status = deposit > 0 ? 'pending_deposit' : 'confirmed';
  const code = genCode();
  const stmts = [
    env.DB.prepare(
      `INSERT INTO bookings (code, line_user_id, customer_name, phone, note, date, start_time, end_time, items,
        subtotal, discount, total, use_reward, reward_stamps, deposit_amount, status, expires_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      code, user.userId, name, phone, str(body.note, 300), date, time, fromMin(toMin(time) + q.duration_min),
      JSON.stringify(q.items), q.subtotal, q.discount, q.total, useReward ? 1 : 0,
      useReward ? settings.stamps_required : 0, deposit, status,
      deposit > 0 ? isoAfterMinutes(settings.deposit_timeout_min) : null, now, now,
    ),
    env.DB.prepare(`UPDATE users SET phone = ?, updated_at = datetime('now') WHERE line_user_id = ?`).bind(phone, user.userId),
  ];
  if (useReward) {
    stmts.push(env.DB.prepare('UPDATE users SET stamps = stamps - ? WHERE line_user_id = ?').bind(settings.stamps_required, user.userId));
  }
  await env.DB.batch(stmts);
  const booking = await getBookingByCode(env, code);
  if (settings.notify_admins) await notifyAdmins(env, adminNotice(booking, status === 'confirmed' ? 'confirmed' : 'new'));
  return booking;
}

export async function notifyAdmins(env, message) {
  try {
    const to = await notifyAdminIds(env, await getSettings(env));
    if (to.length) await multicast(env, to, message);
  } catch (e) {
    console.error('notifyAdmins', e);
  }
}

/** Store slip and verify it. Returns {status, reason, booking} */
export async function processSlip(env, booking, { bytes, mime, payload }) {
  if (!['pending_deposit', 'verifying'].includes(booking.status)) throw new HttpError(409, 'booking_not_awaiting_deposit');
  const settings = await getSettings(env);
  const imageId = await saveImage(env, bytes, mime, 'slip');
  const result = await verifySlip(env, { bytes, mime, payload }, booking.deposit_amount);
  const now = nowISO();

  if (result.status === 'ok') {
    const used = await env.DB.prepare('SELECT code FROM bookings WHERE slip_trans_ref = ? AND code <> ?')
      .bind(result.transRef, booking.code).first();
    if (used) {
      result.status = 'rejected';
      result.reason = 'สลิปนี้เคยถูกใช้กับการจองอื่นแล้ว';
    }
  }

  if (result.status === 'ok') {
    await env.DB.prepare(
      `UPDATE bookings SET status='confirmed', slip_image_id=?, slip_trans_ref=?, slip_amount=?, slip_note='ตรวจอัตโนมัติผ่าน', updated_at=? WHERE code=?`,
    ).bind(imageId, result.transRef, result.amount, now, booking.code).run();
  } else if (result.status === 'manual') {
    await env.DB.prepare(
      `UPDATE bookings SET status='verifying', slip_image_id=?, slip_note=?, updated_at=? WHERE code=?`,
    ).bind(imageId, result.reason || '', now, booking.code).run();
  } else {
    await env.DB.prepare(`UPDATE bookings SET slip_image_id=?, slip_note=?, updated_at=? WHERE code=?`)
      .bind(imageId, result.reason || '', now, booking.code).run();
  }

  const updated = await getBookingByCode(env, booking.code);
  if (settings.notify_admins && result.status !== 'rejected') {
    await notifyAdmins(env, adminNotice(updated, result.status === 'ok' ? 'confirmed' : 'verifying'));
  }
  return { status: result.status === 'ok' ? 'confirmed' : result.status, reason: result.reason || null, booking: updated };
}

/** Admin status transitions */
export async function changeStatus(env, code, action, { note = '', date, time } = {}) {
  const b = await getBookingByCode(env, code);
  if (!b) throw new HttpError(404, 'booking_not_found');
  const settings = await getSettings(env);
  const now = nowISO();
  const stmts = [];
  let customerMsg = null;

  switch (action) {
    case 'confirm':
      if (!['pending_deposit', 'verifying'].includes(b.status)) throw new HttpError(409, 'invalid_transition');
      stmts.push(env.DB.prepare(`UPDATE bookings SET status='confirmed', slip_note='แอดมินยืนยัน', admin_note=?, updated_at=? WHERE code=?`).bind(note, now, code));
      customerMsg = 'confirmed';
      break;
    case 'reject_slip':
      if (b.status !== 'verifying') throw new HttpError(409, 'invalid_transition');
      stmts.push(env.DB.prepare(`UPDATE bookings SET status='pending_deposit', slip_note=?, expires_at=?, updated_at=? WHERE code=?`)
        .bind(note || 'สลิปไม่ถูกต้อง', isoAfterMinutes(settings.deposit_timeout_min), now, code));
      customerMsg = text(`❗ สลิปของรหัส ${code} ไม่ผ่านการตรวจสอบ${note ? `\nเหตุผล: ${note}` : ''}\nกรุณาส่งสลิปใหม่ในแชทนี้ภายใน ${settings.deposit_timeout_min} นาทีค่ะ`);
      break;
    case 'complete':
      if (b.status !== 'confirmed') throw new HttpError(409, 'invalid_transition');
      stmts.push(env.DB.prepare(`UPDATE bookings SET status='completed', admin_note=?, updated_at=? WHERE code=?`).bind(note, now, code));
      // สะสม 1 แต้มต่อการมาใช้บริการ 1 ครั้ง (ครั้งที่ใช้สิทธิ์ฟรีไม่นับแต้ม)
      stmts.push(env.DB.prepare(
        `UPDATE users SET stamps = stamps + ?, total_visits = total_visits + 1, updated_at = datetime('now') WHERE line_user_id = ?`,
      ).bind(b.use_reward ? 0 : 1, b.line_user_id));
      break;
    case 'cancel':
      if (['cancelled', 'completed'].includes(b.status)) throw new HttpError(409, 'invalid_transition');
      stmts.push(env.DB.prepare(`UPDATE bookings SET status='cancelled', admin_note=?, updated_at=? WHERE code=?`).bind(note, now, code));
      if (b.reward_stamps) stmts.push(env.DB.prepare('UPDATE users SET stamps = stamps + ? WHERE line_user_id = ?').bind(b.reward_stamps, b.line_user_id));
      customerMsg = text(`คิวรหัส ${code} (${b.date} ${b.start_time}) ถูกยกเลิกแล้ว${note ? `\nหมายเหตุ: ${note}` : ''}`);
      break;
    case 'reschedule': {
      if (!isDate(date) || !isTime(time)) throw new HttpError(400, 'invalid_datetime');
      if (['cancelled', 'completed'].includes(b.status)) throw new HttpError(409, 'invalid_transition');
      const duration = toMin(b.end_time) - toMin(b.start_time);
      stmts.push(env.DB.prepare(`UPDATE bookings SET date=?, start_time=?, end_time=?, admin_note=?, updated_at=?, reminded_at=NULL WHERE code=?`)
        .bind(date, time, fromMin(toMin(time) + duration), note, now, code));
      customerMsg = 'confirmed';
      break;
    }
    default:
      throw new HttpError(400, 'unknown_action');
  }
  await env.DB.batch(stmts);
  const updated = await getBookingByCode(env, code);
  if (settings.notify_customer && customerMsg) {
    await push(env, b.line_user_id, customerMsg === 'confirmed' ? confirmedFlex(env, updated, settings) : customerMsg).catch(console.error);
  }
  if (action === 'complete' && settings.review_request) {
    const u = await env.DB.prepare('SELECT stamps FROM users WHERE line_user_id = ?').bind(b.line_user_id).first();
    await push(env, b.line_user_id, thankYouFlex(env, updated, settings, u?.stamps || 0)).catch(console.error);
  }
  return updated;
}

/** customer cancels own pending booking */
export async function cancelOwn(env, user, code) {
  const b = await getBookingByCode(env, code);
  if (!b || b.line_user_id !== user.userId) throw new HttpError(404, 'booking_not_found');
  if (b.status !== 'pending_deposit') throw new HttpError(409, 'cannot_cancel');
  await env.DB.batch([
    env.DB.prepare(`UPDATE bookings SET status='cancelled', admin_note='ลูกค้ายกเลิกเอง', updated_at=? WHERE code=?`).bind(nowISO(), code),
    ...(b.reward_stamps ? [env.DB.prepare('UPDATE users SET stamps = stamps + ? WHERE line_user_id = ?').bind(b.reward_stamps, b.line_user_id)] : []),
  ]);
  return getBookingByCode(env, code);
}

/** cron: cancel bookings whose deposit window expired */
export async function expirePending(env) {
  const now = nowISO();
  const { results } = await env.DB.prepare(
    `SELECT code, line_user_id, reward_stamps FROM bookings WHERE status='pending_deposit' AND expires_at <= ?`,
  ).bind(now).all();
  if (!results.length) return 0;
  const stmts = [];
  for (const b of results) {
    stmts.push(env.DB.prepare(`UPDATE bookings SET status='cancelled', admin_note='หมดเวลาชำระมัดจำ', updated_at=? WHERE code=?`).bind(now, b.code));
    if (b.reward_stamps) stmts.push(env.DB.prepare('UPDATE users SET stamps = stamps + ? WHERE line_user_id = ?').bind(b.reward_stamps, b.line_user_id));
  }
  await env.DB.batch(stmts);
  return results.length;
}

/** cron: เตือนนัดล่วงหน้า 1 วัน (ส่งช่วง remind_hour ถึง remind_hour+3 เวลาไทย) */
export async function sendReminders(env) {
  const settings = await getSettings(env);
  if (!settings.remind_day_before) return 0;
  const now = bkkNow();
  const hour = Number(now.time.slice(0, 2));
  const start = Math.min(23, settings.remind_hour);
  if (hour < start || hour >= start + 3) return 0;
  const tomorrow = addDays(now.date, 1);
  const { results } = await env.DB.prepare(
    `SELECT * FROM bookings WHERE date = ? AND status = 'confirmed' AND reminded_at IS NULL AND created_at < ? LIMIT 50`,
  ).bind(tomorrow, isoAfterMinutes(-120)).all();
  let sent = 0;
  for (const row of results) {
    const b = parseBooking(row);
    const msgs = [reminderFlex(env, b, settings), locationMessage(settings)].filter(Boolean);
    const r = await push(env, b.line_user_id, msgs).catch((e) => (console.error('reminder', e), null));
    // mark even on failure so a bad recipient is not retried every 10 minutes
    await env.DB.prepare('UPDATE bookings SET reminded_at = ? WHERE code = ?').bind(nowISO(), b.code).run();
    if (r?.ok) sent++;
  }
  return sent;
}

export async function latestPendingFor(env, userId) {
  return parseBooking(
    await env.DB.prepare(
      `SELECT * FROM bookings WHERE line_user_id = ? AND status = 'pending_deposit' ORDER BY created_at DESC LIMIT 1`,
    ).bind(userId).first(),
  );
}

export { BLOCKING_SQL };
