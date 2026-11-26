import { existsSync, readFileSync } from 'node:fs'
import PDFDocument from 'pdfkit'

export interface RecoveryPdfInput {
  username: string
  recoveryKey: string
  integrityTag: string
  createdAt: string
  logoPath?: string
  logoDataUri?: string
  fontPath?: string
}

const escapeHtml = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

export function buildRecoveryPdfHtml(input: RecoveryPdfInput): string {
  const logoUri =
    input.logoDataUri ??
    (input.logoPath && existsSync(input.logoPath)
      ? 'data:image/png;base64,' + readFileSync(input.logoPath).toString('base64')
      : '')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">
<style>
  @page { size: A4; margin: 22mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #1e293b; margin: 0; }
  .header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #bd9331; padding-bottom: 16px; margin-bottom: 24px; }
  .header img { width: 52px; height: 52px; border-radius: 12px; }
  .eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 2px; color: #9c8144; text-transform: uppercase; }
  h1 { margin: 4px 0 0; font-size: 22px; color: #050b1e; }
  .box { background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 12px; padding: 20px; margin: 20px 0; }
  .label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #64748b; margin-bottom: 8px; }
  .key { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 15px; font-weight: 700; letter-spacing: 0.6px; color: #050b1e; word-break: break-all; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; }
  .meta { display: grid; grid-template-columns: 140px 1fr; gap: 8px 14px; font-size: 12.5px; margin-top: 16px; }
  .meta dt { color: #64748b; font-weight: 600; }
  .meta dd { margin: 0; font-weight: 600; color: #0f172a; }
  .warn { background: #fffbeb; border: 1px solid #fde68a; color: #78350f; border-radius: 10px; padding: 16px 18px; font-size: 12.5px; line-height: 1.6; }
  ul { margin: 8px 0 0 18px; padding: 0; }
  li { margin-bottom: 6px; }
  footer { margin-top: 36px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #64748b; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <div class="header">
    ${logoUri ? `<img src="${logoUri}" alt="DIAMO">` : ''}
    <div>
      <div class="eyebrow">DIAMO_TREADING · 100% OFFLINE RECOVERY</div>
      <h1>Account Recovery Sheet</h1>
    </div>
  </div>
  <p>This recovery key lets you reset your DIAMO_TREADING administrator password on <strong>any computer</strong> without internet, email, or SMS.</p>
  <div class="box">
    <div class="label">Master Recovery Code (71 characters)</div>
    <div class="key">${escapeHtml(input.recoveryKey)}</div>
    <dl class="meta">
      <dt>Username</dt>
      <dd>${escapeHtml(input.username)}</dd>
      <dt>Generated on</dt>
      <dd>${escapeHtml(input.createdAt)}</dd>
      <dt>Hashing</dt>
      <dd>Argon2id (m=65536, t=3, p=1)</dd>
    </dl>
  </div>
  <div class="warn">
    <strong>Keep this sheet private and safe:</strong>
    <ul>
      <li>Anyone with this key and your username can reset your administrator password.</li>
      <li>DIAMO_TREADING operates 100% offline; no cloud backup of this key exists.</li>
      <li>You can reuse this key whenever needed until you generate a new recovery key in Settings.</li>
    </ul>
  </div>
  <footer>
    <span>DIAMO_TREADING · Offline Sovereign Recovery</span>
    <span>Integrity SHA-256: ${escapeHtml(input.integrityTag)}</span>
  </footer>
</body>
</html>`
}

export async function renderRecoveryPdfFallback(input: RecoveryPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 45, size: 'A4' })
  const chunks: Buffer[] = []
  doc.on('data', (c) => chunks.push(c))
  const done = new Promise<void>((resolve, reject) => {
    doc.on('end', resolve)
    doc.on('error', reject)
  })
  if (input.fontPath && existsSync(input.fontPath)) doc.font(input.fontPath)
  if (input.logoPath && existsSync(input.logoPath)) {
    doc.image(input.logoPath, 45, 40, { width: 38, height: 38 })
  }
  doc.fillColor('#050b1e').fontSize(18).text('DIAMO_TREADING — Account Recovery Sheet', 95, 45)
  doc
    .fontSize(10)
    .fillColor('#64748b')
    .text('100% Offline Password Recovery · No Cloud Dependencies', 95, 68)
  doc.moveDown(2)
  doc.fontSize(11).fillColor('#334155').text(`Username: ${input.username}`)
  doc.text(`Generated on: ${input.createdAt}`)
  doc.moveDown(1)
  doc.fontSize(10).fillColor('#64748b').text('MASTER RECOVERY CODE (71 CHARACTERS)')
  doc.moveDown(0.4)
  doc.fontSize(12).fillColor('#050b1e').text(input.recoveryKey)
  doc.moveDown(1.5)
  doc
    .fontSize(10)
    .fillColor('#475569')
    .text(
      'Keep this recovery key private. Use it on the Login screen under "Forgot password?" to reset your password offline on any machine. This code stays valid for future resets until rotated in Settings.',
    )
  doc.moveDown(2)
  doc.fontSize(8).fillColor('#64748b').text(`Integrity SHA-256: ${input.integrityTag}`)
  doc.end()
  await done
  return Buffer.concat(chunks)
}
