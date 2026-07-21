/**
 * Crypto helpers built on the WebCrypto API (available on Cloudflare Workers
 * and in Node 20+). No Node `crypto` import, so this runs anywhere.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// --- base64 / base64url ---------------------------------------------------

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function fromBase64Url(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  return fromBase64(b64 + pad)
}

// --- random / ids ---------------------------------------------------------

export function randomBytes(len: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(len))
}

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export function newId(): string {
  return crypto.randomUUID()
}

// --- HMAC-SHA256 (cookie signing) ----------------------------------------

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function hmacSign(
  secret: string,
  message: string,
): Promise<string> {
  const sig = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(message),
  )
  return toBase64Url(new Uint8Array(sig))
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/** HMAC-SHA256 as a lowercase hex string (GitHub webhook signature format). */
export async function hmacHex(
  secret: string,
  message: string,
): Promise<string> {
  const sig = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(message),
  )
  return toHex(new Uint8Array(sig))
}

/** Length-safe constant-time string comparison. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Constant-time-ish signature verification for a signed message. */
export async function hmacVerify(
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> {
  const key = await hmacKey(secret)
  let expected: Uint8Array<ArrayBuffer>
  try {
    expected = fromBase64Url(signature)
  } catch {
    return false
  }
  return crypto.subtle.verify('HMAC', key, expected, encoder.encode(message))
}

// --- AES-256-GCM (installation-token encryption at rest) ------------------

async function aesKey(base64Key: string): Promise<CryptoKey> {
  const raw = fromBase64(base64Key)
  if (raw.length !== 32) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 of 32 random bytes).',
    )
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/** Encrypt plaintext; returns `base64(iv).base64(ciphertext)`. */
export async function encryptSecret(
  base64Key: string,
  plaintext: string,
): Promise<string> {
  const key = await aesKey(base64Key)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  )
  return `${toBase64(iv)}.${toBase64(new Uint8Array(ct))}`
}

export async function decryptSecret(
  base64Key: string,
  payload: string,
): Promise<string> {
  const [ivPart, ctPart] = payload.split('.')
  if (!ivPart || !ctPart) throw new Error('Malformed encrypted payload')
  const key = await aesKey(base64Key)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivPart) },
    key,
    fromBase64(ctPart),
  )
  return decoder.decode(pt)
}
