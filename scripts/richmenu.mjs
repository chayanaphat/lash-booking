// สร้าง Rich Menu ให้ LINE OA (รันครั้งเดียว)
// ใช้: LINE_CHANNEL_ACCESS_TOKEN=xxx LIFF_ID=2001234567-AbCdEfGh node scripts/richmenu.mjs
// ต้องใช้ Node 18+
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LIFF_ID = process.env.LIFF_ID;
if (!TOKEN || !LIFF_ID) {
  console.error('ต้องตั้ง LINE_CHANNEL_ACCESS_TOKEN และ LIFF_ID');
  process.exit(1);
}
const liff = (q = '') => `https://liff.line.me/${LIFF_ID}${q}`;
const auth = { authorization: `Bearer ${TOKEN}` };

const menu = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: 'lash-booking-main',
  chatBarText: 'จองคิว / โปรโมชั่น',
  areas: [
    { bounds: { x: 0, y: 0, width: 1250, height: 843 }, action: { type: 'uri', label: 'จองคิว', uri: liff() } },
    { bounds: { x: 1250, y: 0, width: 1250, height: 421 }, action: { type: 'uri', label: 'โปรโมชั่น', uri: liff('?p=promos') } },
    { bounds: { x: 1250, y: 421, width: 1250, height: 422 }, action: { type: 'uri', label: 'แต้มสะสม', uri: liff('?p=my') } },
  ],
};

async function main() {
  // ลบ rich menu ชื่อเดิม (ถ้ารันซ้ำ)
  const list = await (await fetch('https://api.line.me/v2/bot/richmenu/list', { headers: auth })).json();
  for (const m of list.richmenus || []) {
    if (m.name === menu.name) {
      await fetch(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { method: 'DELETE', headers: auth });
      console.log('ลบเมนูเก่า', m.richMenuId);
    }
  }

  const r = await fetch('https://api.line.me/v2/bot/richmenu', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(menu),
  });
  const { richMenuId, message } = await r.json();
  if (!richMenuId) throw new Error('สร้างเมนูไม่สำเร็จ: ' + message);
  console.log('สร้างเมนู', richMenuId);

  const img = await readFile(join(dirname(fileURLToPath(import.meta.url)), 'richmenu.jpg'));
  const up = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'image/jpeg' },
    body: img,
  });
  if (!up.ok) throw new Error('อัปโหลดรูปไม่สำเร็จ: ' + (await up.text()));

  const def = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, { method: 'POST', headers: auth });
  if (!def.ok) throw new Error('ตั้งเป็นเมนูหลักไม่สำเร็จ: ' + (await def.text()));
  console.log('✅ เสร็จแล้ว — เปิดแชท LINE OA เพื่อดูเมนู');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
