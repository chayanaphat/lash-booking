import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quote, promoText } from '../src/pricing.js';
import { computeSlots } from '../src/slots.js';

const styles = {
  1: { id: 1, name: 'A', price: 450, duration_min: 120, stamps: 1, redeemable: 1 },
  2: { id: 2, name: 'B', price: 550, duration_min: 120, stamps: 1, redeemable: 1 },
  3: { id: 3, name: 'A+', price: 590, duration_min: 120, stamps: 1, redeemable: 1 },
};
const jan = { start_date: '2027-01-01', end_date: '2027-01-31', active: true };
const come2 = { id: 10, name: 'มา 2 ลด 50', type: 'discount', min_people: 2, discount: 50, ...jan };
const fixed = { id: 11, name: 'A+ 450', type: 'fixed_price', min_people: 1, fixed_prices: { 3: 450 }, active: true };

test('มา 2 ลดทรงละ 50', () => {
  const q = quote(styles, [1, 2], [come2], '2027-01-15');
  assert.deepEqual(q.items.map((i) => i.price), [400, 500]);
  assert.equal(q.total, 900);
  assert.equal(q.discount, 100);
  assert.equal(q.duration_min, 240);
});
test('มาคนเดียวไม่ได้โปร มา 2 + มี hint', () => {
  const q = quote(styles, [1], [come2], '2027-01-15');
  assert.equal(q.total, 450);
  assert.equal(q.hints[0].need_people, 2);
});
test('นอกช่วงวันที่ไม่ได้โปร', () => {
  assert.equal(quote(styles, [1, 2], [come2], '2027-02-01').total, 1000);
});
test('ราคาพิเศษ ทรง A 590 -> 450', () => {
  const q = quote(styles, [3], [fixed], '2026-12-01');
  assert.equal(q.items[0].price, 450);
});
test('เลือกโปรที่ถูกที่สุดต่อทรง', () => {
  const q = quote(styles, [3, 1], [fixed, come2], '2027-01-10');
  assert.deepEqual(q.items.map((i) => i.price), [450, 400]);
});
test('ใช้สิทธิ์สะสมแต้ม: ทรงที่แพงที่สุดฟรี', () => {
  const q = quote(styles, [1, 2], [], '2026-12-01', { useReward: true });
  assert.deepEqual(q.items.map((i) => i.price), [450, 0]);
  assert.equal(q.items[1].reward, true);
});
test('promoText', () => {
  assert.equal(promoText(come2), 'มา 2 คน ลดทรงละ 50 บาท');
  assert.match(promoText(fixed, styles), /590→450/);
});

const hours = [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, open_time: '10:00', close_time: '20:00', closed: w === 3 }));
const settings = { slot_step_min: 60, capacity: 1, booking_days_ahead: 30, min_lead_min: 120 };
const now = { date: '2026-11-17', time: '09:00' };

test('slots: 2 ชม. ร้านเปิด 10-20 → เริ่มได้ถึง 18:00', () => {
  const r = computeSlots({ date: '2026-11-19', duration: 120, hours, holidays: new Set(), busy: [], settings, now });
  assert.equal(r.slots[0].time, '10:00');
  assert.equal(r.slots.at(-1).time, '18:00');
});
test('slots: วันพุธปิด / วันหยุด', () => {
  assert.equal(computeSlots({ date: '2026-11-18', duration: 120, hours, holidays: new Set(), busy: [], settings, now }).reason, 'closed');
  assert.equal(computeSlots({ date: '2026-11-19', duration: 120, hours, holidays: new Set(['2026-11-19']), busy: [], settings, now }).reason, 'holiday');
});
test('slots: คิวซ้อนกันไม่ได้', () => {
  const r = computeSlots({ date: '2026-11-19', duration: 120, hours, holidays: new Set(), busy: [{ start_time: '13:00', end_time: '15:00' }], settings, now });
  const map = Object.fromEntries(r.slots.map((s) => [s.time, s.available]));
  assert.equal(map['11:00'], true);
  assert.equal(map['12:00'], false);
  assert.equal(map['14:00'], false);
  assert.equal(map['15:00'], true);
});
test('slots: วันนี้ต้องจองล่วงหน้า 2 ชม.', () => {
  const r = computeSlots({ date: '2026-11-17', duration: 120, hours, holidays: new Set(), busy: [], settings, now: { date: '2026-11-17', time: '11:10' } });
  assert.equal(r.slots[0].time, '14:00');
});

test('บริการเสริมไม่นับเป็นคน และไม่โดนโปร "ทุกทรง"', () => {
  const st = { ...styles, 9: { id: 9, name: 'ล่าง', price: 150, duration_min: 30, kind: 'addon' } };
  const q = quote(st, [1, 9], [come2], '2027-01-15');
  assert.equal(q.total, 600); // มาคนเดียว ไม่ได้โปร มา 2
  const q2 = quote(st, [1, 2, 9], [come2], '2027-01-15');
  assert.deepEqual(q2.items.map((i) => i.price), [400, 500, 150]);
  assert.equal(q2.duration_min, 270);
  const q3 = quote(st, [1, 9], [], '2026-12-01', { useReward: true });
  assert.deepEqual(q3.items.map((i) => i.price), [0, 150]);
});

test('slots: แอดมินปิดช่วงเวลา (ไปธุระ / ลูกค้า FB) จองทับไม่ได้ แม้ capacity > 1', () => {
  const r = computeSlots({
    date: '2026-11-19', duration: 120, hours, holidays: new Set(), busy: [],
    blocks: [{ start_time: '13:00', end_time: '14:00' }], settings: { ...settings, capacity: 2 }, now,
  });
  const map = Object.fromEntries(r.slots.map((s) => [s.time, s.available]));
  assert.equal(map['11:00'], true);
  assert.equal(map['12:00'], false);
  assert.equal(map['13:00'], false);
  assert.equal(map['14:00'], true);
});

test('แต้มตามทรง: เฉพาะทรงที่ตั้งแต้มไว้ · ทรงที่ใช้สิทธิ์ฟรีไม่ได้แต้ม', () => {
  const st = {
    ...styles,
    7: { id: 7, name: 'ลิฟติ้ง', price: 399, duration_min: 60, stamps: 0 },
    9: { id: 9, name: 'ถอด', price: 100, duration_min: 30, kind: 'addon', stamps: 0 },
  };
  assert.equal(quote(st, [1, 9], [], '2026-12-01').stamps_earned, 1);
  assert.equal(quote(st, [1, 2], [], '2026-12-01').stamps_earned, 2);
  assert.equal(quote(st, [7], [], '2026-12-01').stamps_earned, 0);
  const r = quote(st, [2, 7], [], '2026-12-01', { useReward: true });
  assert.deepEqual(r.items.map((i) => i.price), [0, 399]); // ฟรีเฉพาะทรงที่ได้แต้ม
  assert.equal(r.stamps_earned, 0);
  assert.throws(() => quote(st, [7], [], '2026-12-01', { useReward: true }), /reward_not_eligible/);
});

test('แลกแต้มได้เฉพาะทรงที่ตั้ง redeemable (แยกจากการได้แต้ม)', () => {
  const st = {
    1: { id: 1, name: 'A', price: 450, duration_min: 120, stamps: 1, redeemable: 0 },
    2: { id: 2, name: 'Lift', price: 399, duration_min: 60, stamps: 0, redeemable: 1 },
  };
  const q = quote(st, [1, 2], [], '2026-12-01', { useReward: true });
  assert.deepEqual(q.items.map((i) => i.price), [450, 0]);
  assert.equal(q.stamps_earned, 1);
  assert.throws(() => quote(st, [1], [], '2026-12-01', { useReward: true }), /reward_not_eligible/);
});

// ---------------- โพสต์เพจ Facebook
import { pickTheme, priceCheck, schedulesForDate, validPrices } from '../src/fbpost.js';

test('fb: schedules for a weekday', () => {
  const s = [{ id: 1, active: true, days: [0, 1, 2, 3, 4, 5, 6] }, { id: 2, active: true, days: [1, 3, 5] }, { id: 3, active: false, days: [3] }];
  assert.deepEqual(schedulesForDate(s, '2026-11-18').map((x) => x.id), [1, 2]); // พุธ
  assert.deepEqual(schedulesForDate(s, '2026-11-19').map((x) => x.id), [1]); // พฤหัส
});

test('fb: theme rotation skips the last used theme', () => {
  assert.equal(pickTheme({ theme: 'รีวิวลูกค้า' }, ['a', 'b'], []), 'รีวิวลูกค้า');
  assert.equal(pickTheme({ theme: '' }, ['a', 'b', 'c'], ['a']), 'b');
  assert.equal(pickTheme({ theme: '' }, ['a', 'b', 'c'], ['c']), 'a');
  assert.equal(pickTheme({ theme: '' }, ['a', 'b', 'c'], []), 'a');
});

test('fb: price check catches invented prices', () => {
  const styles = [{ id: 3, price: 590, kind: 'main' }, { id: 8, price: 190, kind: 'addon' }];
  const promos = [{ active: true, type: 'fixed_price', fixed_prices: { 3: 450 }, style_ids: null }];
  const valid = validPrices(styles, promos, { deposit_amount: 100 }, '2026-11-18');
  assert.ok(valid.includes(450) && valid.includes(140) && valid.includes(590));
  assert.equal(priceCheck('ขนตา YY จาก 590 เหลือ 450 บาท ลด ฿140', valid).ok, true);
  assert.deepEqual(priceCheck('วันนี้เหลือ 399 บาท', valid).bad, [399]);
  assert.equal(priceCheck('เปิด 10:00–19:00 จองได้ 24 ชม.', valid).ok, true);
});

import { imagesFor, rotateImages } from '../src/fbpost.js';
test('fb: images rotate through the gallery, least recently used first', () => {
  assert.deepEqual(rotateImages(['a', 'b', 'c'], [], 2), ['a', 'b']);
  assert.deepEqual(rotateImages(['a', 'b', 'c'], ['a', 'b'], 2), ['c', 'b']);
  assert.deepEqual(rotateImages(['a', 'b', 'c'], ['c', 'a', 'b'], 1), ['b']);
  const ctx = { albums: [], styles: [{ id: 1, kind: 'main', gallery: ['x1', 'x2', 'x3', 'x4'] }, { id: 2, kind: 'main', gallery: ['y1', 'y2'] }] };
  assert.deepEqual(imagesFor(ctx, [1], 'โชว์ทรง', ['x1']), ['x2', 'x3', 'x4']);
  assert.deepEqual(imagesFor(ctx, [1, 2], 'โชว์ทรง', ['x2', 'y1']), ['x1', 'x3', 'y2', 'y1']);
});

import { nextPhoneEmoji } from '../src/fbpost.js';
test('fb: phone emoji rotates 🤙🏻 → 📞 → 📱', () => {
  assert.equal(nextPhoneEmoji([]), '🤙🏻');
  assert.equal(nextPhoneEmoji(['โทร 🤙🏻 098', 'x']), '📞');
  assert.equal(nextPhoneEmoji(['ไม่มีเบอร์', '📞 098']), '📱');
  assert.equal(nextPhoneEmoji(['📱 098']), '🤙🏻');
});

import { wmLookup } from '../src/fbpost.js';
import { parseWm } from '../src/db.js';
test('fb: posts use the watermarked copy when one exists', () => {
  const look = wmLookup([{ wm: parseWm('{"name":"YY","map":{"a":{"id":"a2","plain":0}}}') }, { wm: parseWm('oops') }]);
  assert.equal(look('a'), 'a2');
  assert.equal(look('b'), 'b');
  assert.deepEqual(parseWm(''), { name: '', plain: [], map: {} });
});
