/**
 * Reads an /api response as JSON. A proxy can replace the JSON body with an HTML warmup or
 * error page, so non-JSON bodies are turned into user-facing errors instead of parse failures.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function parseApiResponse<T = any>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  const text = await response.text();
  if (response.status === 413) {
    throw new Error(
      'ไฟล์วิดีโอมีขนาดใหญ่เกินกว่าที่เครือข่ายอนุญาตในคำขอเดียว (HTTP 413 Payload Too Large)'
    );
  }
  const lowerText = text.toLowerCase();
  if (lowerText.includes('<!doctype html') || lowerText.includes('<html')) {
    throw new Error('เซิร์ฟเวอร์กำลังสลับการเชื่อมต่อชั่วคราว กรุณาลองกดดำเนินการต่ออีกครั้ง');
  }
  if (!response.ok) {
    throw new Error(
      `เซิร์ฟเวอร์ตอบกลับรหัสข้อผิดพลาด HTTP ${response.status} (${response.statusText || 'Error'})`
    );
  }
  throw new Error(`รูปแบบข้อมูลที่ได้รับจากเซิร์ฟเวอร์ไม่ถูกต้อง: ${text.slice(0, 100)}`);
}
