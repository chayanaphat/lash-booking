// Pure slot calculator — no I/O
import { addDays, fromMin, toMin, weekdayOf } from './util.js';

/**
 * @param date      YYYY-MM-DD
 * @param duration  minutes needed (sum of all styles in the booking)
 * @param hours     array of {weekday, open_time, close_time, closed}
 * @param holidays  Set of YYYY-MM-DD
 * @param busy      array of {start_time, end_time} blocking bookings that day
 * @param blocks    array of {start_time, end_time} admin time blocks (close the shop for that range)
 * @param settings  {slot_step_min, capacity, booking_days_ahead, min_lead_min}
 * @param now       {date, time} in shop timezone
 */
export function computeSlots({ date, duration, hours, holidays, busy, blocks = [], settings, now }) {
  const out = { date, closed: false, reason: null, open_time: null, close_time: null, slots: [] };
  if (date < now.date) return { ...out, closed: true, reason: 'past' };
  if (date > addDays(now.date, settings.booking_days_ahead)) return { ...out, closed: true, reason: 'too_far' };
  if (holidays.has(date)) return { ...out, closed: true, reason: 'holiday' };
  const h = hours.find((x) => Number(x.weekday) === weekdayOf(date));
  if (!h || h.closed) return { ...out, closed: true, reason: 'closed' };

  const open = toMin(h.open_time);
  const close = toMin(h.close_time);
  const step = Math.max(5, settings.slot_step_min || 30);
  const minStart = date === now.date ? toMin(now.time) + (settings.min_lead_min || 0) : -1;
  const capacity = Math.max(1, settings.capacity || 1);

  out.open_time = h.open_time;
  out.close_time = h.close_time;
  for (let t = open; t + duration <= close; t += step) {
    if (t < minStart) continue;
    const end = t + duration;
    const overlap = busy.filter((b) => toMin(b.start_time) < end && toMin(b.end_time) > t).length;
    const blocked = blocks.some((b) => toMin(b.start_time) < end && toMin(b.end_time) > t);
    out.slots.push({ time: fromMin(t), end: fromMin(end), available: !blocked && overlap < capacity });
  }
  return out;
}
