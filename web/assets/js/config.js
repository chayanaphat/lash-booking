// ===== แก้ 2 ค่านี้หลัง deploy =====
export const CONFIG = {
  // LIFF ID จาก LINE Developers > LINE Login channel > LIFF  (เช่น "2001234567-AbCdEfGh")
  LIFF_ID: '2012646909-vMsNI4wU',
  // URL ของ Cloudflare Worker (ไม่มี / ท้าย)
  API_BASE: 'https://lash-booking-api.k-chayanaphat.workers.dev',
  // LINE OA ที่ผูกกับ LIFF (ใช้กับปุ่มเพิ่มเพื่อน)
  OA_ID: '@xkr5690w',
};

// ทดสอบบนเครื่อง: เปิด http://localhost:5500/?dev=Utest1  (worker ต้องรันด้วย npm run dev)
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  CONFIG.API_BASE = new URLSearchParams(location.search).get('api') || 'http://localhost:8787';
}
