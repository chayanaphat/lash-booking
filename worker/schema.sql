-- Lash booking — Cloudflare D1 schema
-- apply:  npx wrangler d1 execute lash-booking --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'style',   -- style | slip
  mime       TEXT NOT NULL,
  data       BLOB NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS styles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  price        INTEGER NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 120,
  image_id     TEXT,
  sort         INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  category     TEXT NOT NULL DEFAULT 'ต่อขนตา (เลือกทรง)',   -- หัวข้อที่แสดงในหน้าจอง
  kind         TEXT NOT NULL DEFAULT 'main',               -- main = บริการหลัก (นับเป็น 1 คน) | addon = บริการเสริม
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- weekday: 0 = Sunday ... 6 = Saturday
CREATE TABLE IF NOT EXISTS business_hours (
  weekday    INTEGER PRIMARY KEY,
  open_time  TEXT NOT NULL DEFAULT '10:00',
  close_time TEXT NOT NULL DEFAULT '20:00',
  closed     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS holidays (
  date TEXT PRIMARY KEY,          -- YYYY-MM-DD
  note TEXT NOT NULL DEFAULT ''
);

-- type: discount  = ลดทรงละ X บาท (min_people=2 -> "มา 2 ลดทรงละ X")
--       percent   = ลด X %
--       fixed_price = ราคาพิเศษต่อทรง (fixed_prices = {"styleId": price})
CREATE TABLE IF NOT EXISTS promotions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  type         TEXT NOT NULL CHECK (type IN ('discount','percent','fixed_price')),
  min_people   INTEGER NOT NULL DEFAULT 1,
  discount     INTEGER NOT NULL DEFAULT 0,
  style_ids    TEXT,              -- JSON array; NULL = ทุกทรง
  fixed_prices TEXT,              -- JSON object
  start_date   TEXT,              -- YYYY-MM-DD (วันที่มาใช้บริการ)
  end_date     TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  line_user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  picture_url  TEXT,
  phone        TEXT NOT NULL DEFAULT '',
  stamps       INTEGER NOT NULL DEFAULT 0,
  total_visits INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admins (
  line_user_id TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT ''
);

-- status: pending_deposit -> (verifying) -> confirmed -> completed | cancelled
CREATE TABLE IF NOT EXISTS bookings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,
  line_user_id    TEXT NOT NULL,
  customer_name   TEXT NOT NULL,
  phone           TEXT NOT NULL DEFAULT '',
  note            TEXT NOT NULL DEFAULT '',
  date            TEXT NOT NULL,
  start_time      TEXT NOT NULL,
  end_time        TEXT NOT NULL,
  items           TEXT NOT NULL,        -- JSON snapshot
  subtotal        INTEGER NOT NULL,
  discount        INTEGER NOT NULL,
  total           INTEGER NOT NULL,
  use_reward      INTEGER NOT NULL DEFAULT 0,
  reward_stamps   INTEGER NOT NULL DEFAULT 0,
  deposit_amount  INTEGER NOT NULL,
  status          TEXT NOT NULL,
  expires_at      TEXT,                 -- ISO UTC, for pending_deposit
  slip_image_id   TEXT,
  slip_trans_ref  TEXT,
  slip_amount     REAL,
  slip_note       TEXT NOT NULL DEFAULT '',
  admin_note      TEXT NOT NULL DEFAULT '',
  reminded_at     TEXT,                 -- เวลาที่ส่งเตือนนัดล่วงหน้าแล้ว
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookings_date   ON bookings(date, status);
CREATE INDEX IF NOT EXISTS idx_bookings_user   ON bookings(line_user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_transref ON bookings(slip_trans_ref) WHERE slip_trans_ref IS NOT NULL;

-- ---------- seed ----------
INSERT OR IGNORE INTO business_hours (weekday, open_time, close_time, closed) VALUES
  (0,'10:00','20:00',0),(1,'10:00','20:00',0),(2,'10:00','20:00',0),(3,'10:00','20:00',1),
  (4,'10:00','20:00',0),(5,'10:00','20:00',0),(6,'10:00','20:00',0);

INSERT INTO styles (name, description, price, duration_min, sort)
SELECT 'ทรง A – Natural', 'ธรรมชาติ ใส่ทุกวันได้', 590, 120, 1
WHERE NOT EXISTS (SELECT 1 FROM styles);
INSERT INTO styles (name, description, price, duration_min, sort)
SELECT 'ทรง B – Doll Eye', 'ตาโต หวาน แบบตุ๊กตา', 550, 120, 2
WHERE (SELECT COUNT(*) FROM styles) = 1;
INSERT INTO styles (name, description, price, duration_min, sort)
SELECT 'ทรง C – Volume', 'แน่น ฟู ชัดเจน', 450, 120, 3
WHERE (SELECT COUNT(*) FROM styles) = 2;

-- ตัวอย่างโปรโมชั่น (ปิดไว้ก่อน เปิดได้ในหน้าแอดมิน)
INSERT INTO promotions (name, type, min_people, discount, start_date, end_date, active)
SELECT 'มา 2 ลดทรงละ 50', 'discount', 2, 50, '2027-01-01', '2027-01-31', 0
WHERE NOT EXISTS (SELECT 1 FROM promotions);
INSERT INTO promotions (name, type, min_people, fixed_prices, active)
SELECT 'ทรง A ราคาพิเศษ 450', 'fixed_price', 1, '{"1":450}', 0
WHERE (SELECT COUNT(*) FROM promotions) = 1;

-- ---------- migration (ฐานข้อมูลที่สร้างก่อนมีบริการเสริม) ----------
-- ALTER TABLE styles ADD COLUMN category TEXT NOT NULL DEFAULT 'ต่อขนตา (เลือกทรง)';
-- ALTER TABLE styles ADD COLUMN kind TEXT NOT NULL DEFAULT 'main';
-- ALTER TABLE bookings ADD COLUMN reminded_at TEXT;

-- ปิดรับคิวบางช่วงในวัน (ไปธุระ / ลูกค้าจองผ่าน FB) — worker สร้างให้อัตโนมัติถ้ายังไม่มี
CREATE TABLE IF NOT EXISTS time_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_blocks_date ON time_blocks(date);

-- อัลบั้มรีวิว/ไฮไลต์ (แสดงแบบสตอรี่ในหน้าจอง) — worker สร้างให้อัตโนมัติถ้ายังไม่มี
CREATE TABLE IF NOT EXISTS review_albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS review_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL,
  image_id TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  style_id INTEGER,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_review_photos_album ON review_photos(album_id, sort);
-- styles.stamps (แต้มต่อทรง 0–5) — worker เพิ่มคอลัมน์ให้อัตโนมัติ
