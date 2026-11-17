// Pure pricing engine — no I/O, unit-tested in test/logic.test.mjs

/** promotions that apply to a service date (YYYY-MM-DD) */
export function activePromotions(promos, date) {
  return promos.filter(
    (p) => p.active && (!p.start_date || p.start_date <= date) && (!p.end_date || p.end_date >= date),
  );
}

function promoPrice(p, style) {
  const base = style.price;
  const listed = p.style_ids && p.style_ids.length;
  if (listed && !p.style_ids.map(Number).includes(Number(style.id))) return null;
  // โปร "ทุกทรง" ไม่รวมบริการเสริม (add-on) ยกเว้นเลือกไว้ใน style_ids
  if (!listed && p.type !== 'fixed_price' && style.kind === 'addon') return null;
  switch (p.type) {
    case 'fixed_price': {
      const v = p.fixed_prices?.[style.id] ?? p.fixed_prices?.[String(style.id)];
      return v == null || v === '' ? null : Math.max(0, Number(v));
    }
    case 'percent':
      return Math.max(0, Math.round((base * (100 - (p.discount || 0))) / 100));
    case 'discount':
    default:
      return Math.max(0, base - (p.discount || 0));
  }
}

/**
 * @param styles      map id -> {id,name,price,duration_min,image_id}
 * @param styleIds    services in the booking; each 'main' service = 1 person, 'addon' items attach to them
 * @param promos      all promotions (parsed)
 * @param date        service date
 * @param useReward   redeem loyalty reward -> most expensive item free
 */
export function quote(styles, styleIds, promos, date, { useReward = false } = {}) {
  const people = Math.max(1, styleIds.filter((id) => styles[id]?.kind !== 'addon').length);
  const active = activePromotions(promos, date);

  const items = styleIds.map((sid) => {
    const s = styles[sid];
    if (!s) throw new Error('style_not_found:' + sid);
    let best = s.price;
    let bestPromo = null;
    for (const p of active) {
      if (people < (p.min_people || 1)) continue;
      const price = promoPrice(p, s);
      if (price != null && price < best) {
        best = price;
        bestPromo = p;
      }
    }
    return {
      style_id: s.id,
      name: s.name,
      image_id: s.image_id || null,
      kind: s.kind || 'main',
      stamps: Number(s.stamps) || 0,
      duration_min: s.duration_min || 120,
      base_price: s.price,
      price: best,
      promotion: bestPromo ? { id: bestPromo.id, name: bestPromo.name } : null,
      reward: false,
    };
  });

  // ใช้สิทธิ์ฟรี: ฟรีทรงที่แพงที่สุด เฉพาะทรงที่ได้แต้ม (stamps > 0)
  if (useReward) {
    let idx = -1;
    items.forEach((it, i) => {
      if (it.stamps > 0 && (idx < 0 || it.price > items[idx].price)) idx = i;
    });
    if (idx < 0) throw new Error('reward_not_eligible');
    items[idx] = { ...items[idx], price: 0, reward: true, promotion: null };
  }

  const subtotal = items.reduce((a, i) => a + i.base_price, 0);
  const total = items.reduce((a, i) => a + i.price, 0);
  const duration_min = items.reduce((a, i) => a + i.duration_min, 0);

  // hints: promotions the customer could unlock by bringing more people
  const hints = active
    .filter((p) => (p.min_people || 1) > people)
    .map((p) => ({ id: p.id, name: p.name, need_people: p.min_people }));

  // แต้มที่จะได้เมื่อมาใช้บริการ (ทรงที่ใช้สิทธิ์ฟรีไม่ได้แต้ม)
  const stamps_earned = items.reduce((a, i) => a + (i.reward ? 0 : i.stamps), 0);

  return { items, subtotal, discount: subtotal - total, total, duration_min, stamps_earned, hints };
}

export function promoText(p, styles = {}) {
  if (p.description) return p.description;
  const who = (p.min_people || 1) > 1 ? `มา ${p.min_people} คน ` : '';
  if (p.type === 'discount') return `${who}ลดทรงละ ${p.discount} บาท`;
  if (p.type === 'percent') return `${who}ลด ${p.discount}%`;
  const parts = Object.entries(p.fixed_prices || {})
    .filter(([, v]) => v !== '' && v != null)
    .map(([id, v]) => {
      const s = styles[id];
      return s ? `${s.name} ${s.price}→${v}` : `ทรง #${id} ${v}`;
    });
  return `${who}ราคาพิเศษ ${parts.join(', ')}`;
}
