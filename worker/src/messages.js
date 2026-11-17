// LINE message builders (Flex / text)
import { baht, bkkNow, thaiDate } from './util.js';

const ROSE = '#8E5BA8';
const MUTED = '#8A7A90';

/** 'คนที่ 1', 'คนที่ 2', '+ เสริม' */
export function itemLabels(items) {
  let n = 0;
  return items.map((it) => (it.kind === 'addon' ? '+ เสริม' : `คนที่ ${++n}`));
}

export const liffUrl = (env, params = {}) => {
  const q = new URLSearchParams(params).toString();
  return `https://liff.line.me/${env.LIFF_ID}${q ? '?' + q : ''}`;
};

const row = (label, value, bold = false) => ({
  type: 'box',
  layout: 'baseline',
  spacing: 'sm',
  contents: [
    { type: 'text', text: label, size: 'sm', color: MUTED, flex: 3 },
    { type: 'text', text: String(value), size: 'sm', wrap: true, flex: 6, weight: bold ? 'bold' : 'regular', align: 'end' },
  ],
});

function bookingRows(b) {
  return [
    row('รหัสจอง', b.code, true),
    row('วันที่', thaiDate(b.date)),
    row('เวลา', `${b.start_time} – ${b.end_time} น.`),
    ...((labels) => b.items.map((it, i) =>
      row(labels[i], `${it.name}  ${it.reward ? 'ฟรี (สะสมแต้ม)' : baht(it.price)}`),
    ))(itemLabels(b.items)),
    { type: 'separator', margin: 'md' },
    row('ยอดรวม', baht(b.total), true),
  ];
}

export function depositFlex(env, b, settings) {
  const expire = b.expires_at ? bkkNow(Date.parse(b.expires_at)).time : null;
  const pay = [
    row('มัดจำ', baht(b.deposit_amount), true),
    settings.bank_name ? row('ธนาคาร', settings.bank_name) : null,
    settings.bank_account_no ? row('เลขบัญชี', settings.bank_account_no) : null,
    settings.promptpay_name ? row('ชื่อบัญชี', settings.promptpay_name) : null,
  ].filter(Boolean);
  return {
    type: 'flex',
    altText: `รอชำระมัดจำ ${baht(b.deposit_amount)} (${b.code})`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: ROSE, paddingAll: '16px',
        contents: [
          { type: 'text', text: 'รับคำขอจองแล้ว 💕', color: '#FFFFFF', weight: 'bold', size: 'lg' },
          { type: 'text', text: 'กรุณาโอนมัดจำเพื่อยืนยันคิว (ที่เหลือชำระวันทำ)', color: '#F3E6FA', size: 'sm', wrap: true },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          ...bookingRows(b),
          { type: 'separator', margin: 'md' },
          ...pay,
          expire
            ? { type: 'text', text: `⏰ โปรดโอนภายใน ${expire} น. มิฉะนั้นคิวจะถูกยกเลิกอัตโนมัติ`, size: 'xs', color: ROSE, wrap: true, margin: 'md' }
            : null,
          { type: 'text', text: '📎 โอนแล้วส่ง "รูปสลิป" ในแชทนี้ได้เลย ระบบจะตรวจให้อัตโนมัติ', size: 'xs', color: MUTED, wrap: true, margin: 'sm' },
        ].filter(Boolean),
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [
          {
            type: 'button', style: 'primary', color: ROSE,
            action: { type: 'uri', label: 'ชำระมัดจำ / ส่งสลิป', uri: liffUrl(env, { p: 'pay', code: b.code }) },
          },
        ],
      },
    },
  };
}

export function locationMessage(settings) {
  if (!settings.shop_lat || !settings.shop_lng) return null;
  return {
    type: 'location',
    title: settings.shop_name || 'ร้าน',
    address: (settings.shop_address || 'แตะเพื่อเปิดแผนที่').slice(0, 100),
    latitude: Number(settings.shop_lat),
    longitude: Number(settings.shop_lng),
  };
}

export function confirmedFlex(env, b, settings = {}) {
  return {
    type: 'flex',
    altText: `ยืนยันคิวแล้ว ${thaiDate(b.date)} ${b.start_time} น.`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#3E8E6E', paddingAll: '16px',
        contents: [
          { type: 'text', text: 'ยืนยันคิวเรียบร้อย ✅', color: '#FFFFFF', weight: 'bold', size: 'lg' },
          { type: 'text', text: 'แล้วพบกันนะคะ', color: '#E2F5EC', size: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          ...bookingRows(b),
          row('มัดจำแล้ว', baht(b.deposit_amount)),
          row('ชำระที่ร้าน', baht(Math.max(0, b.total - b.deposit_amount)), true),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        spacing: 'sm',
        contents: [
          settings.map_url ? { type: 'button', style: 'primary', color: ROSE, action: { type: 'uri', label: '📍 แผนที่ร้าน', uri: settings.map_url } } : null,
          { type: 'button', style: 'secondary', action: { type: 'uri', label: 'ดูคิวของฉัน', uri: liffUrl(env, { p: 'my' }) } },
        ].filter(Boolean),
      },
    },
  };
}

export const text = (t) => ({ type: 'text', text: t });

function bubble(color, title, subtitle, bodyContents, buttons) {
  return {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: color, paddingAll: '16px',
      contents: [
        { type: 'text', text: title, color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true },
        subtitle ? { type: 'text', text: subtitle, color: '#F3E6FA', size: 'sm', wrap: true } : null,
      ].filter(Boolean),
    },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: bodyContents },
    footer: buttons.length ? { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons } : undefined,
  };
}
const uriButton = (label, uri, primary = false) => ({
  type: 'button', style: primary ? 'primary' : 'secondary', ...(primary ? { color: ROSE } : {}),
  action: { type: 'uri', label, uri },
});

/** เตือนนัดล่วงหน้า 1 วัน */
export function reminderFlex(env, b, settings = {}) {
  const due = Math.max(0, b.total - (b.deposit_amount || 0));
  return {
    type: 'flex',
    altText: `พรุ่งนี้มีนัดนะคะ ${thaiDate(b.date)} ${b.start_time} น.`,
    contents: bubble(ROSE, 'พรุ่งนี้มีนัดนะคะ 💜', `${thaiDate(b.date)} · ${b.start_time} น.`, [
      ...bookingRows(b),
      row('ชำระที่ร้าน', baht(due), true),
      { type: 'text', text: 'มาสายได้ไม่เกิน 5–10 นาที หากต้องการเลื่อนนัด แจ้งในแชทล่วงหน้าอย่างน้อย 1 ชั่วโมงค่ะ', size: 'xs', color: MUTED, wrap: true, margin: 'md' },
    ], [
      settings.map_url ? uriButton('📍 นำทางไปร้าน', settings.map_url, true) : null,
      uriButton('ดูรายละเอียดคิว', liffUrl(env, { p: 'pay', code: b.code })),
    ].filter(Boolean)),
  };
}

/** ขอบคุณหลังใช้บริการ + ชวนรีวิว */
export function thankYouFlex(env, b, settings = {}, stamps = 0) {
  const req = settings.stamps_required || 10;
  const stampLine = b.use_reward
    ? 'ใช้สิทธิ์ฟรีจากแต้มสะสมเรียบร้อยค่ะ'
    : stamps >= req ? `🎁 ครบ ${req} แต้มแล้ว! ครั้งหน้าใช้สิทธิ์ฟรี 1 ทรงได้เลย` : `💗 แต้มสะสม ${stamps}/${req} · อีก ${req - stamps} ครั้งรับฟรี 1 ทรง`;
  return {
    type: 'flex',
    altText: 'ขอบคุณที่มาใช้บริการค่ะ 💜',
    contents: bubble(ROSE, 'ขอบคุณที่มาใช้บริการค่ะ 💜', settings.shop_name || '', [
      { type: 'text', text: stampLine, size: 'sm', wrap: true, weight: 'bold' },
      settings.review_url
        ? { type: 'text', text: 'ถ้าชอบผลงาน รบกวนช่วยรีวิวร้านบน Google ให้หน่อยนะคะ ช่วยร้านเล็ก ๆ ได้มากเลย 🙏', size: 'sm', color: MUTED, wrap: true, margin: 'md' }
        : null,
    ].filter(Boolean), [
      settings.review_url ? uriButton('⭐ รีวิวร้านบน Google', settings.review_url, true) : null,
      uriButton('จองคิวครั้งถัดไป', liffUrl(env)),
    ].filter(Boolean)),
  };
}

export function adminNotice(b, kind) {
  const head = {
    new: '🆕 มีคิวใหม่ (รอมัดจำ)',
    verifying: '🧾 มีสลิปรอตรวจ',
    confirmed: '✅ มัดจำผ่านอัตโนมัติ',
  }[kind] || 'แจ้งเตือน';
  const items = b.items.map((i) => i.name).join(', ');
  return text(
    `${head}\n${b.code} · ${b.customer_name} ${b.phone}\n${thaiDate(b.date)} ${b.start_time}-${b.end_time}\n${items}\nยอด ${baht(b.total)} มัดจำ ${baht(b.deposit_amount)}`,
  );
}
