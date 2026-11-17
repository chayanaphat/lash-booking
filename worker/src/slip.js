// Slip verification
// - ถ้าตั้ง secret EASYSLIP_API_KEY: ตรวจสลิปอัตโนมัติผ่าน EasySlip (ยอดเงิน, สลิปซ้ำ, ชื่อผู้รับ)
// - ถ้าไม่ตั้ง: ส่งเข้าคิว "รอแอดมินตรวจ" ให้แอดมินกดยืนยันเองในหน้า admin

const REJECT_MESSAGES = {
  duplicate_slip: 'สลิปนี้เคยถูกใช้แล้ว',
  slip_not_found: 'ไม่พบข้อมูลสลิปนี้ในระบบธนาคาร',
  qrcode_not_found: 'ไม่พบ QR code ในรูป กรุณาส่งรูปสลิปที่ชัดเจน',
  invalid_payload: 'QR code บนสลิปไม่ถูกต้อง',
  invalid_image: 'รูปภาพไม่ถูกต้อง',
  image_size_too_large: 'รูปใหญ่เกินไป',
};

/**
 * @returns {Promise<{status:'ok'|'rejected'|'manual', reason?:string, transRef?:string, amount?:number}>}
 */
export async function verifySlip(env, { bytes, mime, payload }, expectedAmount) {
  if (!env.EASYSLIP_API_KEY) return { status: 'manual', reason: 'ยังไม่ได้ตั้งค่าระบบตรวจสลิปอัตโนมัติ' };

  const base = env.EASYSLIP_BASE || 'https://developer.easyslip.com/api/v1';
  const headers = { authorization: `Bearer ${env.EASYSLIP_API_KEY}` };
  let r;
  try {
    if (payload) {
      const q = new URLSearchParams({ payload, checkDuplicate: 'true' });
      r = await fetch(`${base}/verify?${q}`, { headers });
    } else {
      // multipart upload (documented as: -F file=@slip.jpg)
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: mime || 'image/jpeg' }), 'slip.jpg');
      form.append('checkDuplicate', 'true');
      r = await fetch(`${base}/verify`, { method: 'POST', headers, body: form });
    }
  } catch (e) {
    return { status: 'manual', reason: 'เชื่อมต่อระบบตรวจสลิปไม่ได้' };
  }

  let body;
  try {
    body = await r.json();
  } catch {
    return { status: 'manual', reason: 'ระบบตรวจสลิปตอบกลับผิดรูปแบบ' };
  }

  if (body.status !== 200 || !body.data) {
    const code = body.message || 'unknown';
    // payload-based check found no slip -> retry once with the image (QR may have been misread)
    if (payload && bytes && (code === 'slip_not_found' || code === 'invalid_payload')) {
      return verifySlip(env, { bytes, mime, payload: null }, expectedAmount);
    }
    if (REJECT_MESSAGES[code]) return { status: 'rejected', reason: REJECT_MESSAGES[code], code };
    // quota_exceeded / unauthorized / server errors -> let a human decide
    return { status: 'manual', reason: `ตรวจอัตโนมัติไม่ได้ (${code})` };
  }

  const d = body.data;
  const amount = Number(d.amount?.amount ?? 0);
  const transRef = d.transRef;
  if (amount + 0.001 < expectedAmount) {
    return { status: 'rejected', reason: `ยอดโอน ${amount} บาท ไม่ครบ ${expectedAmount} บาท`, transRef, amount };
  }

  // ตรวจชื่อผู้รับ (ถ้าตั้ง SLIP_RECEIVER_KEYWORD เช่น "ชญาน" หรือ "CHAYA")
  const kw = (env.SLIP_RECEIVER_KEYWORD || '').trim().toLowerCase();
  if (kw) {
    const acc = d.receiver?.account || {};
    const names = [acc.name?.th, acc.name?.en, d.receiver?.displayName].filter(Boolean).join(' ').toLowerCase();
    if (!names.includes(kw)) {
      return { status: 'rejected', reason: 'ชื่อบัญชีผู้รับไม่ตรงกับร้าน', transRef, amount };
    }
  }
  return { status: 'ok', transRef, amount };
}
