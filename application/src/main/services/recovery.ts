import { execFileSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { sha256Hex } from './crypto'
import { renderRecoveryPdfFallback, type RecoveryPdfInput } from './recovery-pdf'

export interface PinRecord {
  device: string
  account: string
  hash: string
  failures: number
}

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface RecoveryOptions {
  dataPath: string
  safeStorage?: SafeStorageAdapter
  machineUuidProvider?: () => string | null
  pdfRenderer?: (input: RecoveryPdfInput) => Promise<Buffer>
  logoPath?: string
  fontPath?: string
}

export const MAX_PIN_ATTEMPTS = 5

export class RecoveryService {
  constructor(private options: RecoveryOptions) {}

  get pinPath() {
    return join(this.options.dataPath, '.diamo-device')
  }

  hiddenPdfPath(username: string, recoveryHash: string) {
    const digest = sha256Hex(username + recoveryHash)
    return join(this.options.dataPath, `.diamo-recovery-${digest}.pdf`)
  }

  integrityTag(username: string, recoveryHash: string) {
    return sha256Hex(username + recoveryHash).slice(0, 16)
  }

  getMachineUuid(): string | null {
    if (this.options.machineUuidProvider) {
      return this.options.machineUuidProvider()
    }
    try {
      if (process.platform === 'darwin') {
        const out = execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
          encoding: 'utf8',
          timeout: 3000,
        })
        const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
        return match?.[1]?.trim() || null
      }
      if (process.platform === 'win32') {
        const out = execFileSync(
          'reg',
          ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
          { encoding: 'utf8', timeout: 3000 },
        )
        const match = out.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i)
        return match?.[1]?.trim() || null
      }
    } catch {
      return null
    }
    return null
  }

  getDeviceId(): string | null {
    const uuid = this.getMachineUuid()
    return uuid ? sha256Hex(uuid) : null
  }

  isEncryptionAvailable(): boolean {
    try {
      return Boolean(this.options.safeStorage?.isEncryptionAvailable())
    } catch {
      return false
    }
  }

  canEnroll(recoveryHash?: string | null): boolean {
    return Boolean(recoveryHash && this.isEncryptionAvailable() && this.getDeviceId())
  }

  writeHiddenAtomic(targetPath: string, data: Buffer | string) {
    mkdirSync(dirname(targetPath), { recursive: true })
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
    const fd = openSync(tmpPath, 'w', 0o600)
    try {
      let offset = 0
      while (offset < buf.length) {
        offset += writeSync(fd, buf, offset, buf.length - offset)
      }
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmpPath, targetPath)
    if (process.platform === 'win32') {
      try {
        execFileSync('attrib', ['+H', targetPath], { timeout: 2000 })
      } catch {
        // Ignore non-fatal attribute errors
      }
    }
  }

  async renderRecoveryPdf(
    username: string,
    recoveryKey: string,
    recoveryHash: string,
  ): Promise<Buffer> {
    const now = new Date()
    const createdAt = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`
    const input: RecoveryPdfInput = {
      username,
      recoveryKey,
      integrityTag: this.integrityTag(username, recoveryHash),
      createdAt,
      logoPath: this.options.logoPath,
      fontPath: this.options.fontPath,
    }
    if (this.options.pdfRenderer) {
      return this.options.pdfRenderer(input)
    }
    return renderRecoveryPdfFallback(input)
  }

  saveHiddenRecoveryPdf(username: string, recoveryHash: string, pdfBytes: Buffer): string {
    mkdirSync(this.options.dataPath, { recursive: true })
    const target = this.hiddenPdfPath(username, recoveryHash)
    this.writeHiddenAtomic(target, pdfBytes)
    for (const entry of readdirSync(this.options.dataPath)) {
      if (/^\.diamo-recovery-[0-9a-f]{64}\.pdf$/.test(entry)) {
        const full = join(this.options.dataPath, entry)
        if (full !== target) rmSync(full, { force: true })
      }
    }
    return target
  }

  readPin(recoveryHash: string | null): PinRecord | null {
    if (!recoveryHash || !existsSync(this.pinPath) || !this.isEncryptionAvailable()) return null
    const deviceId = this.getDeviceId()
    if (!deviceId) return null
    try {
      const encrypted = readFileSync(this.pinPath)
      const decrypted = this.options.safeStorage!.decryptString(encrypted)
      const parsed = JSON.parse(decrypted) as Partial<PinRecord>
      if (
        !parsed ||
        typeof parsed.device !== 'string' ||
        typeof parsed.account !== 'string' ||
        typeof parsed.hash !== 'string' ||
        typeof parsed.failures !== 'number'
      ) {
        return null
      }
      if (parsed.device !== deviceId || parsed.account !== sha256Hex(recoveryHash)) {
        return null
      }
      return {
        device: parsed.device,
        account: parsed.account,
        hash: parsed.hash,
        failures: Math.max(0, Math.min(MAX_PIN_ATTEMPTS, Math.trunc(parsed.failures))),
      }
    } catch {
      return null
    }
  }

  writePin(record: PinRecord) {
    if (!this.isEncryptionAvailable()) {
      throw Error('Device encryption is not available on this operating system')
    }
    const encrypted = this.options.safeStorage!.encryptString(JSON.stringify(record))
    this.writeHiddenAtomic(this.pinPath, encrypted)
  }

  updatePinAccount(oldRecoveryHash: string | null, newRecoveryHash: string): boolean {
    const existing = this.readPin(oldRecoveryHash)
    if (!existing) return false
    this.writePin({
      ...existing,
      account: sha256Hex(newRecoveryHash),
    })
    return true
  }

  removePin() {
    rmSync(this.pinPath, { force: true })
  }

  status(recoveryHash: string | null) {
    const canEnroll = this.canEnroll(recoveryHash)
    const pinRecord = this.readPin(recoveryHash)
    return {
      hasRecovery: Boolean(recoveryHash),
      canEnroll,
      enrolled: Boolean(pinRecord),
      remaining: pinRecord ? Math.max(0, MAX_PIN_ATTEMPTS - pinRecord.failures) : null,
    }
  }
}
