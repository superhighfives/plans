import { describe, expect, it } from 'vitest'
import {
  decryptSecret,
  encryptSecret,
  fromBase64Url,
  hmacHex,
  hmacSign,
  hmacVerify,
  timingSafeEqual,
  toBase64,
  toBase64Url,
} from './crypto'

const key32 = toBase64(new Uint8Array(32).fill(7)) // deterministic 32-byte key

describe('base64url', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64])
    expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes))
  })
})

describe('AES-GCM secret encryption', () => {
  it('encrypts and decrypts round-trip', async () => {
    const secret = 'ghs_installationtoken_abc123'
    const enc = await encryptSecret(key32, secret)
    expect(enc).not.toContain(secret)
    expect(await decryptSecret(key32, enc)).toBe(secret)
  })

  it('produces distinct ciphertexts (random IV)', async () => {
    const a = await encryptSecret(key32, 'same')
    const b = await encryptSecret(key32, 'same')
    expect(a).not.toBe(b)
  })

  it('rejects a wrong-length key', async () => {
    await expect(encryptSecret(toBase64(new Uint8Array(16)), 'x')).rejects.toThrow()
  })
})

describe('HMAC', () => {
  it('signs and verifies', async () => {
    const sig = await hmacSign('secret', 'message')
    expect(await hmacVerify('secret', 'message', sig)).toBe(true)
    expect(await hmacVerify('secret', 'tampered', sig)).toBe(false)
    expect(await hmacVerify('wrong', 'message', sig)).toBe(false)
  })

  it('hmacHex matches a known GitHub-style signature', async () => {
    // Reference value computed with Node crypto for secret "It's a Secret to Everybody"
    // over the body "Hello, World!" — the example from GitHub's webhook docs.
    const hex = await hmacHex("It's a Secret to Everybody", 'Hello, World!')
    expect(hex).toBe('757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17')
  })
})

describe('timingSafeEqual', () => {
  it('compares strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })
})
