# 💗 Lash Booking — ระบบจองคิวต่อขนตาผ่าน LINE OA + LIFF

ระบบจองคิวต่อขนตา ทุกส่วน deploy ฟรี

| ส่วน | ใช้อะไร | ค่าใช้จ่าย |
|---|---|---|
| หน้า LIFF (ลูกค้า + แอดมิน) | GitHub Pages — `https://chayanaphat.github.io/lash-booking/` | ฟรี (repo ต้องเป็น public) |
| API + LINE webhook + cron | Cloudflare Workers | ฟรี 100,000 req/วัน |
| ฐานข้อมูล + รูปภาพ | Cloudflare D1 (SQLite) | ฟรี 5 GB |
| แชท / Rich menu | LINE Official Account (Free plan) | ฟรี (ข้อความตอบกลับไม่จำกัด, push มีโควต้า/เดือน) |
| ตรวจสลิปอัตโนมัติ | EasySlip API | **ไม่บังคับ** — ถ้าไม่ใส่ แอดมินกดยืนยันสลิปเองในหน้าแอดมิน |

## ฟีเจอร์

- **Rich menu** 3 ปุ่ม: จองคิว / โปรโมชั่น / แต้มสะสม & คิวของฉัน (`web/assets/richmenu.jpg`) ติดตั้งจากหน้าแอดมิน → ⚙️ ตั้งค่า → ติดตั้ง Rich menu
- **บริการแยกหมวด**: ทรงต่อขนตา (มีรูป), บริการอื่น ๆ (ถอด/เติม/ลิฟติ้ง) และ *บริการเสริม* เช่น ต่อขนตาล่าง ที่เพิ่มคู่บริการหลักได้ (ไม่นับเป็นคน และไม่โดนโปร "ทุกทรง")
- **จองคิวใน LIFF**: เลือกบริการ → เพิ่มให้เพื่อนได้ (สูงสุด 4 คน) → เลือกวัน/เวลาว่าง (คิดจากเวลาเปิด-ปิด, วันหยุด, คิวที่จองแล้ว, ทรงละ 2 ชม.) → ยืนยัน
- **ส่งเข้าแชท OA**: หลังจองระบบส่ง *รูปทรงขนตา + วันเวลา + รหัสจอง* เข้าแชท LINE OA (ผ่าน `liff.sendMessages`) แล้วบอทตอบกลับด้วยการ์ดมัดจำ
- **มัดจำ 100 บาท**: แสดง QR พร้อมเพย์ตามยอด, ถือคิวไว้ 30 นาที (ตั้งได้) เกินเวลายกเลิกอัตโนมัติ
- **ตรวจสลิป**: ลูกค้าส่งรูปสลิปในแชท หรืออัปโหลดใน LIFF → ตรวจยอด/สลิปซ้ำ/ชื่อบัญชีผู้รับ อัตโนมัติ (EasySlip) หรือเข้าคิว "รอตรวจสลิป" ให้แอดมินกด ✅/❌
- **โปรโมชั่น** (แอดมินตั้งเอง กำหนดช่วงวันที่ได้):
  - *ลดเป็นจำนวนเงินต่อทรง* + *ต้องมากี่คน* → เช่น "มา 2 ลดทรงละ 50" (A 450→400, B 550→500)
  - *ลดเป็น %*
  - *ราคาพิเศษรายทรง* → เช่น ทรง A 590→450
  - ถ้ามีหลายโปร ระบบเลือกราคาที่ถูกที่สุดให้ลูกค้าแต่ละทรงอัตโนมัติ
- **สะสม 10 ครั้ง ฟรี 1**: แอดมินกด "มาใช้บริการแล้ว" = +1 แต้ม, ครบแล้วลูกค้าติ๊ก "ใช้สิทธิ์ฟรี" ตอนจอง (ทรงที่แพงสุดฟรี)
- **หน้าแอดมิน** (LIFF ตัวเดียวกัน `/admin.html`, เช็คสิทธิ์จาก LINE userId): คิว, ทรงขนตา+รูป, โปรโมชั่น, เวลาเปิด-ปิด, วันหยุด, ลูกค้า/แต้ม, ตั้งค่า, จัดการแอดมิน
- **คีย์เวิร์ดในแชท**: พิมพ์ "โปร", "แต้ม", "คิว" บอทตอบให้

```
lash-booking/
├── web/                     ← GitHub Pages (LIFF)
│   ├── index.html           ← หน้าลูกค้า
│   ├── admin.html           ← หน้าแอดมิน
│   └── assets/js/config.js  ← ★ ใส่ LIFF_ID และ API_BASE
├── worker/                  ← Cloudflare Worker (API + webhook)
│   ├── wrangler.toml        ← ★ ใส่ database_id, LIFF_ID, LINE_LOGIN_CHANNEL_ID, ADMIN_USER_IDS
│   ├── schema.sql
│   └── src/
└── .github/workflows/       ← auto deploy Pages (+ worker ถ้าตั้ง secret)
```

---

## วิธีติดตั้ง (ทำครั้งเดียว ~30 นาที)

ต้องมี: Node.js 18+, บัญชี GitHub `chayanaphat`, บัญชี Cloudflare (สมัครฟรี), บัญชี LINE Developers

### 1) GitHub — ขึ้นโค้ด + เปิด Pages

```bash
cd lash-booking
mv _move_to_.github .github                # (ถ้ายังมีโฟลเดอร์นี้) ย้าย workflow เข้าที่
git init && git add . && git commit -m "init lash booking"
git branch -M main
git remote add origin https://github.com/chayanaphat/lash-booking.git   # สร้าง repo ชื่อ lash-booking (Public) ก่อน
git push -u origin main
```

GitHub → repo → **Settings → Pages → Source: GitHub Actions**
รอ Action เสร็จ จะได้ `https://chayanaphat.github.io/lash-booking/`

### 2) Cloudflare — สร้าง DB และ deploy API

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create lash-booking        # คัดลอก database_id ไปใส่ใน wrangler.toml
npm run db:init                            # สร้างตาราง + ข้อมูลตัวอย่าง
npx wrangler deploy                        # ได้ URL เช่น https://lash-booking-api.<ชื่อ>.workers.dev
```

### 3) LINE — สร้าง 2 channel ภายใต้ **Provider เดียวกัน** (สำคัญ: userId จะได้ตรงกัน)

**3.1 Messaging API channel (= LINE OA)**
- Basic settings → คัดลอก **Channel secret**
- Messaging API → Issue **Channel access token (long-lived)**
- Webhook URL = `https://lash-booking-api.<ชื่อ>.workers.dev/webhook` → กด Verify → เปิด **Use webhook**
- LINE OA Manager → ตั้งค่าการตอบกลับ: ปิด *ข้อความตอบกลับอัตโนมัติ*, เปิด *Webhook* (เปิดแชทได้ตามปกติ)

```bash
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
```

**3.2 LINE Login channel → สร้าง LIFF app**
- Size: **Full**
- Endpoint URL: `https://chayanaphat.github.io/lash-booking/`
- Scopes: `openid`, `profile`, `chat_message.write` ✅ (จำเป็นสำหรับส่งรูปเข้าแชท)
- Add friend option: **On (Aggressive)** เลือก OA จากข้อ 3.1 (Basic settings → Linked OA)
- คัดลอก **LIFF ID** และ **Channel ID** ของ LINE Login channel
- เปลี่ยนสถานะ channel จาก *Developing* เป็น **Published** (ไม่งั้นใช้ได้เฉพาะ tester)

### 4) ใส่ค่า config แล้ว deploy อีกรอบ

`worker/wrangler.toml`
```toml
LIFF_ID = "2001234567-AbCdEfGh"
LINE_LOGIN_CHANNEL_ID = "2001234567"
```
`web/assets/js/config.js`
```js
LIFF_ID: '2001234567-AbCdEfGh',
API_BASE: 'https://lash-booking-api.<ชื่อ>.workers.dev',
```
```bash
cd worker && npx wrangler deploy
cd .. && git commit -am "config" && git push        # Pages deploy อัตโนมัติ
```

### 5) Rich menu

เข้าหน้าแอดมิน → ⚙️ ตั้งค่า → กด **ติดตั้ง Rich menu** (ระบบใช้ token ของ worker สร้างเมนูให้)
อยากเปลี่ยนรูป แทนที่ `web/assets/richmenu.jpg` (2500×843) แล้ว push จากนั้นกดติดตั้งใหม่

### 6) ตั้งแอดมิน 2 คน

1. แอดมินแต่ละคนเปิด `https://liff.line.me/<LIFF_ID>/admin.html` ในแชท LINE → จะเห็น **LINE User ID** (ขึ้นต้นด้วย U) กดคัดลอก
2. ใส่ใน `wrangler.toml` → `ADMIN_USER_IDS = "Uxxxx,Uyyyy"` แล้ว `npx wrangler deploy`
   (หรือใส่คนแรกคนเดียว แล้วเพิ่มคนที่สองจากหน้า **ตั้งค่า → แอดมิน**)
3. ทางลัด: เพิ่มปุ่มเมนูแอดมินใน LINE OA Manager หรือบุ๊กมาร์กลิงก์ข้างบน — ในหน้าลูกค้าแอดมินจะเห็นปุ่ม ⚙️ แอดมิน

### 7) ตั้งค่าร้านในหน้าแอดมิน

- **ตั้งค่า**: ชื่อร้าน, พร้อมเพย์ (เบอร์/เลขบัตร) + ชื่อบัญชี, ยอดมัดจำ, เวลาถือคิว, จำนวนช่าง, สะสมกี่ครั้งฟรี
- **ทรงขนตา**: แก้ชื่อ/ราคา/อัปโหลดรูป (ข้อมูลตัวอย่าง ทรง A/B/C แก้หรือลบได้)
- **เวลาเปิด-ปิด**, **วันหยุด**, **โปรโมชั่น** (มีตัวอย่าง "มา 2 ลดทรงละ 50" และ "ทรง A 450" ปิดไว้ให้)

### 8) (ไม่บังคับ) ตรวจสลิปอัตโนมัติ

สมัคร [EasySlip](https://developer.easyslip.com) → เอา API key มาใส่
```bash
npx wrangler secret put EASYSLIP_API_KEY
```
และตั้ง `SLIP_RECEIVER_KEYWORD` ใน wrangler.toml เป็นบางส่วนของชื่อบัญชีร้าน (เช่น `"ชญาน"`) เพื่อกันโอนผิดบัญชี
ระบบเช็ค: ยอด ≥ มัดจำ, สลิปไม่ซ้ำ (ทั้งใน EasySlip และในระบบเอง), ชื่อผู้รับ — ถ้าตรวจไม่ได้ (เช่น โควต้าหมด) จะส่งให้แอดมินตรวจเองแทน

---

## Flow การจอง

```
Rich menu "จองคิว" → LIFF เลือกทรง → เลือกวันเวลา → ยืนยัน
   └─ สร้างการจอง (pending_deposit, ถือคิว 30 นาที)
   └─ liff.sendMessages → [รูปทรง] + "รหัส: BKXXXXXX ..." เข้าแชท OA
        └─ webhook เห็นรหัส → ตอบการ์ด "โอนมัดจำ ฿100" + ปุ่มเปิด QR
ลูกค้าส่งรูปสลิปในแชท (หรืออัปโหลดใน LIFF)
   ├─ ผ่าน      → confirmed  → ตอบการ์ด "ยืนยันคิวเรียบร้อย ✅"
   ├─ ตรวจไม่ได้ → verifying  → แจ้งแอดมิน → แอดมินกด ✅/❌ → แจ้งลูกค้า
   └─ ไม่ผ่าน    → ให้ส่งใหม่
วันมาร้าน: แอดมินกด "มาใช้บริการแล้ว" → completed, +1 แต้ม
ไม่โอนภายในเวลา → cron ยกเลิกอัตโนมัติ (ทุก 10 นาที)
```

สถานะ: `pending_deposit` → `verifying` → `confirmed` → `completed` / `cancelled`

ข้อความ push (แจ้งแอดมิน / แจ้งลูกค้าเมื่อแอดมินกดยืนยัน) ใช้โควต้าฟรีรายเดือนของ LINE OA — ปิดได้ในหน้าตั้งค่า ส่วนข้อความที่บอทตอบในแชท (reply) ไม่นับโควต้า

## พัฒนา/ทดสอบบนเครื่อง

```bash
cd worker
npm install
npm run db:init:local
npm run dev              # API ที่ http://localhost:8787 (DEV_AUTH=1 ข้ามการ login LINE)
npm test                 # unit test ราคา/โปร/ช่วงเวลา

# อีก terminal
cd web && python3 -m http.server 5500
# ลูกค้า: http://localhost:5500/?dev=Utest1
# แอดมิน: npm run dev -- --var ADMIN_USER_IDS:Uadmin  แล้วเปิด http://localhost:5500/admin.html?dev=Uadmin
```

> ห้ามตั้ง `DEV_AUTH = "1"` บน production

## หมายเหตุ

- คิวหนึ่งคิวใช้ช่าง 1 คน: มา 2 คน = ต่อกัน 4 ชม. (ถ้ามีช่าง 2 คน ตั้ง *จำนวนช่าง* = 2 เพื่อรับ 2 คิวซ้อนกันได้)
- ลูกค้ามีคิว "รอมัดจำ" ค้างได้ทีละ 1 คิว (กันการจองกั๊กคิว)
- รูปถูกย่อในเครื่องลูกค้าก่อนอัปโหลด และเก็บใน D1 (ไม่ต้องเปิด R2/บัตรเครดิต)
- ใช้สิทธิ์ฟรีแล้วยกเลิก/หมดเวลา → คืนแต้มอัตโนมัติ; ครั้งที่ใช้สิทธิ์ฟรีไม่นับแต้มเพิ่ม
