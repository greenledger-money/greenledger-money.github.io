// 備份檔的壓縮與加密（Edge Function 和 解密腳本 共用；改了要複製到 supabase/functions/backup/）
// 格式：'GLBK1'(5 bytes) + salt(16) + iv(12) + AES-256-GCM 密文（內容是 gzip 過的 JSON）
// 金鑰：PBKDF2-SHA256(密碼, salt, 310000 次)。只用 Web Crypto，Deno、Node、Bun、瀏覽器都能跑。

const MAGIC = new TextEncoder().encode('GLBK1');
const ITER = 310000;

async function deriveKey(passphrase, salt) {
  if (!passphrase || passphrase.length < 12) throw new Error('備份密碼至少要 12 個字');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** 物件 → 加密後的 bytes */
export async function encryptBackup(obj, passphrase) {
  const gz = await pipe(new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream('gzip'));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, gz));
  const out = new Uint8Array(MAGIC.length + 16 + 12 + ct.length);
  out.set(MAGIC, 0); out.set(salt, 5); out.set(iv, 21); out.set(ct, 33);
  return out;
}

/** 加密的 bytes → 物件。密碼錯或檔案壞掉會丟錯誤 */
export async function decryptBackup(bytes, passphrase) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 34 || new TextDecoder().decode(b.slice(0, 5)) !== 'GLBK1') throw new Error('不是小綠記帳的備份檔');
  const key = await deriveKey(passphrase, b.slice(5, 21));
  let gz;
  try { gz = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(21, 33) }, key, b.slice(33)); }
  catch { throw new Error('解不開：密碼不對，或檔案損毀'); }
  const json = await pipe(new Uint8Array(gz), new DecompressionStream('gzip'));
  return JSON.parse(new TextDecoder().decode(json));
}

/** bytes → base64（GitHub API 用）；分段處理，避免大檔超過參數上限 */
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
