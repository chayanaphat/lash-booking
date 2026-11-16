// Pure pricing engine — no I/O, unit-tested in test/logic.test.mjs

/** promotions that apply to a service date (YYYY-MM-DD) */
export function activePromotions(promos, date) {
  return promos.filter(
    (p) => p.active && (!p.start_date || p.start_date <= date) && (!p.end_date || p.end_date >= date),
  );
}

function promoPrice(p, style) {
  const base = style.price;
  if (p.style_ids && p.style_ids.length && !p.style_ids.map(Number).includes(Number(style.id))) return null;
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
 * @param styleIds    one entry per person, e.g. [1, 2]  (2 people)
 * @param promos      all promotions (parsed)
 * @param date        service date
 * @param useReward   redeem loyalty reward -> most expensive item free
 */
export function quote(styles, styleIds, promos, date, { useReward = false } = {}) {
  const people = styleIds.length;
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
      duration_min: s.duration_min || 120,
      base_price: s.price,
      price: best,
      promotion: bestPromo ? { id: bestPromo.id, name: bestPromo.name } : null,
      reward: false,
    };
  });

  if (useReward && items.length) {
    let idx = 0;
    items.forEach((it, i) => {
      if (it.price > items[idx].price) idx = i;
    });
    items[idx] = { ...items[idx], price: 0, reward: true, promotion: null };
  }

  const subtotal = items.reduce((a, i) => a + i.base_price, 0);
  const total = items.reduce((a, i) => a + i.price, 0);
  const duration_min = items.reduce((a, i) => a + i.duration_min, 0);

  // hints: promotions the customer could unlock by bringing more people
  const hints = active
    .filter((p) => (p.min_people || 1) > people)
    .map((p) => ({ id: p.id, name: p.name, need_people: p.min_people }));

  return { items, subtotal, discount: subtotal - total, total, duration_min, hints };
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
