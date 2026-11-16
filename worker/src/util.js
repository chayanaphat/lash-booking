export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

export const errorResponse = (status, message, extra = {}) => json({ error: message, ...extra }, status);

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

// ---------- time (Asia/Bangkok, UTC+7, no DST) ----------
const TZ_OFFSET_MS = 7 * 3600 * 1000;

export function bkkNow(ms = Date.now()) {
  const iso = new Date(ms + TZ_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
export const nowISO = () => new Date().toISOString();
export const isoAfterMinutes = (min) => new Date(Date.now() + min * 60000).toISOString();

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const weekdayOf = (dateStr) => new Date(dateStr + 'T00:00:00Z').getUTCDay();
export const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const fromMin = (m) =>
  String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

export const isDate = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
export const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

const TH_DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export function thaiDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${TH_DAYS[weekdayOf(dateStr)]} ${d} ${TH_MONTHS[m - 1]} ${String(y + 543).slice(2)}`;
}
export const baht = (n) => '฿' + Number(n).toLocaleString('en-US');

// ---------- ids / encoding ----------
export function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = crypto.getRandomValues(new Uint8Array(6));
  let s = 'BK';
  for (const b of a) s += chars[b % chars.length];
  return s;
}

export function b64FromBytes(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function bytesFromB64(b64) {
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
export function parseDataUrl(s) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(s || '');
  if (!m) throw new HttpError(400, 'invalid_image');
  return { mime: m[1], bytes: bytesFromB64(m[2]) };
}

export const parseJSON = (s, fallback) => {
  if (s == null) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

export const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
export const int = (v, def = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};
