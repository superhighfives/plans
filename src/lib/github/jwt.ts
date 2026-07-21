import { fromBase64, toBase64Url } from '~/lib/crypto'

/**
 * Mint a GitHub App JWT (RS256) using WebCrypto. Accepts the App private key as
 * either PKCS#8 ("BEGIN PRIVATE KEY") or PKCS#1 ("BEGIN RSA PRIVATE KEY", the
 * format GitHub hands you) — PKCS#1 is transparently wrapped into PKCS#8 since
 * WebCrypto only imports PKCS#8.
 */
export async function createAppJwt(
  appId: string,
  privateKeyPem: string,
): Promise<string> {
  const key = await importRsaPrivateKey(privateKeyPem)
  const nowSec = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    // Back-date iat by 60s to tolerate clock skew against GitHub.
    iat: nowSec - 60,
    exp: nowSec + 9 * 60,
    iss: appId,
  }
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  )
  return `${signingInput}.${toBase64Url(new Uint8Array(sig))}`
}

function b64urlJson(obj: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(obj)))
}

async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
  // Normalize escaped newlines (common when a PEM is stored as a single-line secret).
  const normalized = pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem
  const isPkcs1 = /BEGIN RSA PRIVATE KEY/.test(normalized)
  const der = pemBody(normalized)
  const pkcs8 = isPkcs1 ? wrapPkcs1InPkcs8(der) : der
  return crypto.subtle.importKey(
    'pkcs8',
    // Copy into a fresh ArrayBuffer so the buffer type is exactly ArrayBuffer.
    pkcs8.slice().buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

function pemBody(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '')
  return fromBase64(b64)
}

// --- Minimal DER helpers to wrap PKCS#1 RSAPrivateKey into PKCS#8 ----------

function derLength(len: number): Uint8Array {
  if (len < 0x80) return new Uint8Array([len])
  const bytes: number[] = []
  let n = len
  while (n > 0) {
    bytes.unshift(n & 0xff)
    n >>= 8
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes])
}

function derTlv(tag: number, content: Uint8Array): Uint8Array {
  const len = derLength(content.length)
  const out = new Uint8Array(1 + len.length + content.length)
  out[0] = tag
  out.set(len, 1)
  out.set(content, 1 + len.length)
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

/**
 * Wrap a PKCS#1 RSAPrivateKey DER into a PKCS#8 PrivateKeyInfo:
 *   SEQUENCE { INTEGER 0, AlgorithmIdentifier(rsaEncryption, NULL), OCTET STRING(pkcs1) }
 */
function wrapPkcs1InPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = new Uint8Array([0x02, 0x01, 0x00]) // INTEGER 0
  // AlgorithmIdentifier: SEQUENCE { OID 1.2.840.113549.1.1.1, NULL }
  const algId = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ])
  const privateKeyOctet = derTlv(0x04, pkcs1) // OCTET STRING
  return derTlv(0x30, concat(version, algId, privateKeyOctet)) // SEQUENCE
}
