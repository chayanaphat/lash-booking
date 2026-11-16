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

export function confirmedFlex(env, b) {
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
        contents: [{ type: 'button', style: 'secondary', action: { type: 'uri', label: 'ดูคิวของฉัน', uri: liffUrl(env, { p: 'my' }) } }],
      },
    },
  };
}

export const text = (t) => ({ type: 'text', text: t });

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
