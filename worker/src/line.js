// LINE Messaging API + LINE Login helpers
import { HttpError, b64FromBytes } from './util.js';

const API = 'https://api.line.me/v2/bot';
const DATA_API = 'https://api-data.line.me/v2/bot';

async function call(env, path, body) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.warn('LINE_CHANNEL_ACCESS_TOKEN not set; skip', path);
    return null;
  }
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.error('LINE API', path, r.status, await r.text());
  return r;
}

export const reply = (env, replyToken, messages) =>
  call(env, '/message/reply', { replyToken, messages: [].concat(messages).slice(0, 5) });

export const push = (env, to, messages) => call(env, '/message/push', { to, messages: [].concat(messages).slice(0, 5) });

export async function multicast(env, to, messages) {
  if (!to.length) return null;
  return call(env, '/message/multicast', { to, messages: [].concat(messages).slice(0, 5) });
}

export async function getMessageContent(env, messageId) {
  const r = await fetch(`${DATA_API}/message/${messageId}/content`, {
    headers: { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (!r.ok) throw new Error('content_fetch_failed ' + r.status);
  return { mime: r.headers.get('content-type') || 'image/jpeg', bytes: new Uint8Array(await r.arrayBuffer()) };
}

export async function verifySignature(secret, body, signature) {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expected = b64FromBytes(mac);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

// ---------- LIFF access token -> user (fallback when the client has no ID token) ----------
async function userFromAccessToken(env, token) {
  const at = token.slice(3);
  const v = await fetch('https://api.line.me/oauth2/v2.1/verify?access_token=' + encodeURIComponent(at));
  const vj = await v.json().catch(() => ({}));
  if (!v.ok) throw new HttpError(401, 'invalid_token', { detail: vj.error_description || 'access token verify failed' });
  if (String(vj.client_id) !== String(env.LINE_LOGIN_CHANNEL_ID)) throw new HttpError(401, 'invalid_token', { detail: 'token from another channel' });
  const pr = await fetch('https://api.line.me/v2/profile', { headers: { authorization: `Bearer ${at}` } });
  if (!pr.ok) throw new HttpError(401, 'invalid_token', { detail: 'profile fetch failed' });
  const p = await pr.json();
  const user = { userId: p.userId, name: p.displayName || '', picture: p.pictureUrl || null };
  if (tokenCache.size > 500) tokenCache.clear();
  tokenCache.set(token, { user, exp: Date.now() + Math.min((vj.expires_in || 600) * 1000, 10 * 60000) });
  return user;
}

// ---------- LIFF ID token -> user ----------
const tokenCache = new Map();

export async function userFromRequest(req, env) {
  if (env.DEV_AUTH === '1') {
    const dev = req.headers.get('x-dev-user');
    if (dev) return { userId: dev, name: 'Dev ' + dev, picture: null };
  }
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) throw new HttpError(401, 'unauthorized');

  const hit = tokenCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;
  if (token.startsWith('at:')) return userFromAccessToken(env, token);

  const r = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: token, client_id: env.LINE_LOGIN_CHANNEL_ID || '' }),
  });
  if (!r.ok) {
    let detail = '';
    try {
      const e = await r.json();
      detail = e.error_description || e.error || '';
    } catch {}
    console.warn('id_token verify failed', r.status, detail);
    throw new HttpError(401, 'invalid_token', { detail });
  }
  const p = await r.json();
  const user = { userId: p.sub, name: p.name || '', picture: p.picture || null };
  if (tokenCache.size > 500) tokenCache.clear();
  tokenCache.set(token, { user, exp: Math.min(p.exp * 1000, Date.now() + 10 * 60000) });
  return user;
}
