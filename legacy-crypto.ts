const te = new TextEncoder();
const td = new TextDecoder();
export const PBKDF2_ITERATIONS = 210000;
export const CONVENIENCE_PBKDF2_ITERATIONS = 100000;
export const DEVICE_LOCAL_PBKDF2_ITERATIONS = 120000;
const AES = 'AES-GCM';

export function bytesToBase64(bytes) {
  let s = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) s += String.fromCharCode(...arr.subarray(i, i + chunk));
  return btoa(s);
}
export function base64ToBytes(value) {
  const bin = atob(value || '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function randomBytes(n = 32) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}
export async function importAesKey(raw, extractable = false) {
  return crypto.subtle.importKey('raw', raw, { name: AES }, extractable, ['encrypt', 'decrypt']);
}
export async function exportRaw(key) {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}
export async function derivePasswordKek(secret, saltB64, iterations = PBKDF2_ITERATIONS) {
  if (!secret) throw new Error('密钥材料不能为空');
  const base = await crypto.subtle.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: base64ToBytes(saltB64), iterations, hash: 'SHA-256' },
    base,
    { name: AES, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
export async function deriveKek(recoveryCode, saltB64) {
  if (!recoveryCode || recoveryCode.length < 12) throw new Error('恢复码至少需要 12 个字符');
  return derivePasswordKek(recoveryCode, saltB64, PBKDF2_ITERATIONS);
}
export async function deriveConvenienceKey(githubToken, saltB64, iterations = CONVENIENCE_PBKDF2_ITERATIONS) {
  if (!githubToken) throw new Error('未配置 GitHub Token');
  return derivePasswordKek(githubToken, saltB64, iterations);
}
async function encryptBytes(bytes, key) {
  const iv = randomBytes(12);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: AES, iv, tagLength: 128 }, key, bytes));
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(cipher) };
}
export async function decryptBytes(payload, key) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: AES, iv: base64ToBytes(payload.iv), tagLength: 128 }, key, base64ToBytes(payload.ciphertext)));
}
export async function wrapMasterKey(masterRaw, secret, mode = 'convenience') {
  const salt = bytesToBase64(randomBytes(16));
  const iterations = mode === 'recovery' ? PBKDF2_ITERATIONS : CONVENIENCE_PBKDF2_ITERATIONS;
  const kek = mode === 'recovery' ? await deriveKek(secret, salt) : await deriveConvenienceKey(secret, salt, iterations);
  return {
    salt,
    iterations,
    wrappedMasterKey: await encryptBytes(masterRaw, kek)
  };
}
export async function unwrapMasterWithSecret(secret, wrapper, mode = wrapper?.type) {
  if (!wrapper?.salt || !wrapper?.wrappedMasterKey) throw new Error('云端缺少密钥包装材料');
  const iterations = Number(wrapper.iterations || (mode === 'recovery' ? PBKDF2_ITERATIONS : CONVENIENCE_PBKDF2_ITERATIONS));
  const kek = mode === 'recovery' ? await deriveKek(secret, wrapper.salt) : await deriveConvenienceKey(secret, wrapper.salt, iterations);
  try {
    const raw = await decryptBytes(wrapper.wrappedMasterKey, kek);
    return importAesKey(raw, true);
  } catch {
    throw new Error(mode === 'recovery' ? '恢复码错误或密钥已轮换' : 'GitHub Token 无法解锁当前同步密钥');
  }
}
export async function generateMasterMaterial() {
  const masterRaw = randomBytes(32);
  const masterKey = await importAesKey(masterRaw, true);
  return { masterKey, masterRaw };
}
export async function generateRecoveryMaterial(recoveryCode) {
  const { masterKey, masterRaw } = await generateMasterMaterial();
  const wrapper = await wrapMasterKey(masterRaw, recoveryCode, 'recovery');
  return { ...wrapper, masterKey, masterRaw };
}
export async function generateConvenienceMaterial(githubToken) {
  const { masterKey, masterRaw } = await generateMasterMaterial();
  const wrapper = await wrapMasterKey(masterRaw, githubToken, 'convenience');
  return { ...wrapper, masterKey, masterRaw };
}
export async function unwrapMasterKey(recoveryCode, cryptoMeta) {
  const wrapper = cryptoMeta?.wrappers?.find(x => x.type === 'recovery' && x.status !== 'revoked') || cryptoMeta;
  return unwrapMasterWithSecret(recoveryCode, wrapper, 'recovery');
}
export async function deriveDeviceKey(masterRaw, deviceId) {
  const base = await crypto.subtle.importKey('raw', masterRaw, 'HKDF', false, ['deriveKey']);
  const info = te.encode(`chromium-cloud-sync/device/${deviceId}/v7`);
  const salt = await crypto.subtle.digest('SHA-256', te.encode('chromium-cloud-sync-device-salt-v7'));
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info }, base, { name: AES, length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptJson(value, key) {
  const data = te.encode(JSON.stringify(value));
  const payload = await encryptBytes(data, key);
  return JSON.stringify({ v: 7, alg: AES, enc: 'utf-8', ...payload });
}
export async function decryptJson(text, key) {
  const payload = typeof text === 'string' ? JSON.parse(text) : text;
  if (payload?.v !== 7 || payload?.alg !== AES) throw new Error('不支持的加密数据格式');
  const bytes = await decryptBytes(payload, key);
  return JSON.parse(td.decode(bytes));
}
export async function checksumBytes(value) {
  const bytes = te.encode(typeof value === 'string' ? value : JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToBase64(new Uint8Array(hash));
}
export { AES };
