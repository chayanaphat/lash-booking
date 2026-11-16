// สร้าง PromptPay QR payload (EMVCo) — เบอร์มือถือ / เลขบัตรประชาชน / e-Wallet
function tlv(id, value) {
  return id + String(value.length).padStart(2, '0') + value;
}
function crc16(s) {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
  }
  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}
export function promptPayPayload(target, amount) {
  const id = String(target).replace(/[^0-9]/g, '');
  let acc;
  if (id.length >= 15) acc = tlv('03', id); // e-wallet
  else if (id.length >= 13) acc = tlv('02', id); // national id / tax id
  else acc = tlv('01', ('0000000000000' + id.replace(/^0/, '66')).slice(-13)); // mobile
  const merchant = tlv('00', 'A000000677010111') + acc;
  let data =
    tlv('00', '01') +
    tlv('01', amount ? '12' : '11') +
    tlv('29', merchant) +
    tlv('58', 'TH') +
    tlv('53', '764') +
    (amount ? tlv('54', Number(amount).toFixed(2)) : '');
  data += '6304';
  return data + crc16(data);
}
