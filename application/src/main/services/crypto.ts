import { createHash, randomBytes } from 'node:crypto'
import { argon2id, argon2Verify } from 'hash-wasm'
import bcrypt from 'bcryptjs'

export async function hashArgon2id(secret: string): Promise<string> {
  return argon2id({
    password: secret,
    salt: randomBytes(16),
    parallelism: 1,
    iterations: 3,
    memorySize: 65536,
    hashLength: 32,
    outputType: 'encoded',
  })
}

export async function verifySecret(
  storedHash: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!storedHash || !secret) return false
  if (storedHash.startsWith('$argon2id$')) {
    return argon2Verify({ password: secret, hash: storedHash })
  }
  if (
    storedHash.startsWith('$2a$') ||
    storedHash.startsWith('$2b$') ||
    storedHash.startsWith('$2y$')
  ) {
    return bcrypt.compareSync(secret, storedHash)
  }
  return false
}

export function isLegacyBcryptHash(storedHash: string | null | undefined): boolean {
  return Boolean(
    storedHash &&
    (storedHash.startsWith('$2a$') ||
      storedHash.startsWith('$2b$') ||
      storedHash.startsWith('$2y$')),
  )
}

export function generateRecoveryKey(): string {
  return randomBytes(32).toString('hex').match(/.{8}/g)!.join('-')
}

export function normalizeRecoveryKey(key: string): string {
  return key.trim().replace(/\s+/g, '').toLowerCase()
}

export function canonicalRecoverySecret(key: string): string {
  return key
    .trim()
    .replace(/[\s-]+/g, '')
    .toLowerCase()
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
