import { useEffect, useState } from 'react'
import { Check, Copy, Download, KeyRound, Lock, ShieldCheck } from 'lucide-react'
import type { Row } from '../../../shared/contracts'
import { Drawer } from './Drawer'

export interface RecoveryStatus {
  hasRecovery: boolean
  canEnroll: boolean
  enrolled: boolean
  remaining: number | null
}

export function normalizeRecoveryInput(value: string) {
  return value.trim().replace(/\s+/g, '').toLowerCase()
}

export function ForgotPasswordDrawer({
  initialStatus,
  close,
  onResetSuccess,
}: {
  initialStatus?: RecoveryStatus
  close: () => void
  onResetSuccess: (msg: string) => void
}) {
  const [status, setStatus] = useState<RecoveryStatus>(
    initialStatus ?? { hasRecovery: false, canEnroll: false, enrolled: false, remaining: null },
  )
  const [mode, setMode] = useState<'code' | 'pin'>(
    initialStatus?.enrolled && (initialStatus.remaining ?? 0) > 0 ? 'pin' : 'code',
  )
  const [username, setUsername] = useState('')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [pin, setPin] = useState('')
  const [pass, setPass] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function loadStatus() {
    const res = await window.diamo.command('auth.recoveryStatus', {})
    if (res.ok) {
      const s = res.data as RecoveryStatus
      setStatus(s)
      if (!s.enrolled || (s.remaining ?? 0) <= 0) {
        setMode('code')
      }
    }
  }

  useEffect(() => {
    void loadStatus()
  }, [])

  const pinLocked = status.enrolled && (status.remaining ?? 0) <= 0
  const pinAvailable = status.enrolled && (status.remaining ?? 0) > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (pass.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (pass !== repeat) {
      setError('Passwords must match.')
      return
    }

    setBusy(true)
    try {
      if (mode === 'pin') {
        if (!/^\d{6}$/.test(pin)) {
          throw Error('Enter a 6-digit Device PIN.')
        }
        const res = await window.diamo.command('auth.resetPin', {
          username: username.trim(),
          pin,
          newPassword: pass,
        })
        if (!res.ok) {
          await loadStatus()
          throw Error(res.error)
        }
      } else {
        const sanitizedKey = normalizeRecoveryInput(recoveryKey)
        if (!sanitizedKey) {
          throw Error('Enter your recovery code.')
        }
        const res = await window.diamo.command('auth.reset', {
          username: username.trim(),
          recoveryKey: sanitizedKey,
          newPassword: pass,
        })
        if (!res.ok) throw Error(res.error)
      }
      onResetSuccess('Password reset. Sign in with your new password.')
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      title="Recover account password"
      subtitle="100% OFFLINE RECOVERY"
      size="md"
      close={close}
    >
      <form className="drawer-form" onSubmit={handleSubmit}>
        <div className="drawer-body">
          <p className="muted" style={{ marginBottom: 16 }}>
            Reset your administrator password offline using your 71-character Recovery Code or this
            computer’s 6-digit Device PIN.
          </p>

          {status.enrolled && (
            <div className="recovery-tabs">
              <button
                type="button"
                className={mode === 'code' ? 'primary' : ''}
                onClick={() => {
                  setMode('code')
                  setError('')
                }}
              >
                <KeyRound size={15} />
                Use recovery code
              </button>
              <button
                type="button"
                className={mode === 'pin' ? 'primary' : ''}
                disabled={!pinAvailable}
                onClick={() => {
                  setMode('pin')
                  setError('')
                }}
              >
                <Lock size={15} />
                Use this computer’s PIN
              </button>
            </div>
          )}

          {status.enrolled && (
            <p className={pinLocked ? 'error' : 'info'} style={{ marginBottom: 16 }}>
              {pinLocked
                ? 'Device PIN locked after 5 failed attempts. Use your Recovery Code.'
                : `PIN attempts remaining: ${status.remaining}`}
            </p>
          )}

          <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
            <label className="field">
              <span>Username *</span>
              <input
                aria-label="Recovery username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </label>

            {mode === 'pin' && pinAvailable ? (
              <label className="field">
                <span>6-digit Device PIN *</span>
                <input
                  aria-label="6-digit Device PIN"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                />
              </label>
            ) : (
              <label className="field">
                <span>Recovery code *</span>
                <textarea
                  aria-label="Recovery code"
                  placeholder="Paste your 71-character recovery code…"
                  value={recoveryKey}
                  onChange={(e) => setRecoveryKey(normalizeRecoveryInput(e.target.value))}
                  required
                />
              </label>
            )}

            <label className="field">
              <span>New password *</span>
              <input
                aria-label="Recovery new password"
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                required
              />
            </label>

            <label className="field">
              <span>Repeat new password *</span>
              <input
                aria-label="Repeat new password"
                type="password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                required
              />
            </label>
          </div>

          {error && (
            <div className="error banner" role="alert">
              {error}
            </div>
          )}
        </div>

        <footer className="drawer-footer">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Resetting…' : 'Reset password'}
          </button>
        </footer>
      </form>
    </Drawer>
  )
}

export function OnboardingRecoveryDrawer({
  recoveryKey,
  canEnrollPin,
  onDone,
}: {
  recoveryKey: string
  canEnrollPin: boolean
  onDone: () => Promise<void>
}) {
  const [step, setStep] = useState<'key' | 'pin'>('key')
  const [copied, setCopied] = useState(false)
  const [pdfNotice, setPdfNotice] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function downloadPdf() {
    setError('')
    setPdfNotice('')
    const res = await window.diamo.saveRecoveryPdf()
    if (!res.ok) setError(res.error)
    else if (res.data) setPdfNotice(`Saved recovery PDF to ${res.data}`)
  }

  async function acknowledgeAndNext() {
    setBusy(true)
    setError('')
    try {
      const res = await window.diamo.command('auth.acknowledgeRecovery', {})
      if (!res.ok) throw Error(res.error)
      if (canEnrollPin) {
        setStep('pin')
      } else {
        await onDone()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function savePin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!/^\d{6}$/.test(pin)) {
      setError('Device PIN must be exactly 6 digits.')
      return
    }
    if (pin !== confirmPin) {
      setError('PINs must match.')
      return
    }
    setBusy(true)
    try {
      const res = await window.diamo.command('auth.enrollPin', {
        currentPassword,
        pin,
      })
      if (!res.ok) throw Error(res.error)
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      title={step === 'key' ? 'Your offline recovery code' : 'Set up 6-digit device PIN'}
      subtitle="ACCOUNT RECOVERY SETUP"
      size="md"
      close={() => {
        if (step === 'pin') void onDone()
        else void acknowledgeAndNext()
      }}
    >
      {step === 'key' ? (
        <div className="drawer-form">
          <div className="drawer-body">
            <p className="info">
              DIAMO works 100% offline. If you ever forget your password, this Recovery Code lets
              you reset it on any computer. A hidden backup PDF has also been saved in your local
              DIAMO data folder.
            </p>
            <div className="recovery-key-box">
              <small>MASTER RECOVERY CODE (71 CHARACTERS)</small>
              <code>{recoveryKey}</code>
              <div className="button-row" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(recoveryKey)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? 'Copied' : 'Copy code'}
                </button>
                <button type="button" onClick={() => void downloadPdf()}>
                  <Download size={15} />
                  Download recovery PDF
                </button>
              </div>
            </div>
            {pdfNotice && <p className="success banner">{pdfNotice}</p>}
            {error && (
              <div className="error banner" role="alert">
                {error}
              </div>
            )}
          </div>
          <footer className="drawer-footer">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void acknowledgeAndNext()}
            >
              {busy ? 'Saving…' : canEnrollPin ? 'Continue to 6-digit PIN setup' : 'Done'}
            </button>
          </footer>
        </div>
      ) : (
        <form className="drawer-form" onSubmit={savePin}>
          <div className="drawer-body">
            <p className="info">
              <ShieldCheck size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Bind a 6-digit PIN strictly to this physical computer using OS Keychain / DPAPI
              encryption (maximum 5 attempts). You can reuse it for future resets or change it
              anytime in Settings.
            </p>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
              <label className="field">
                <span>Current password *</span>
                <input
                  aria-label="Current password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>6-digit Device PIN *</span>
                <input
                  aria-label="6-digit Device PIN"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                />
              </label>
              <label className="field">
                <span>Confirm 6-digit PIN *</span>
                <input
                  aria-label="Confirm 6-digit PIN"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                />
              </label>
            </div>
            {error && (
              <div className="error banner" role="alert">
                {error}
              </div>
            )}
          </div>
          <footer className="drawer-footer">
            <button type="button" disabled={busy} onClick={() => void onDone()}>
              Skip for now
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Saving PIN…' : 'Save Device PIN'}
            </button>
          </footer>
        </form>
      )}
    </Drawer>
  )
}

export function SettingsRecoveryDrawer({
  kind,
  close,
  onSuccess,
}: {
  kind: 'rotateRecovery' | 'enrollPin' | 'removePin'
  close: () => void
  onSuccess: (msg: string) => Promise<void>
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [newKey, setNewKey] = useState('')
  const [copied, setCopied] = useState(false)
  const [pdfNotice, setPdfNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const titles: Record<typeof kind, string> = {
    rotateRecovery: 'Generate / rotate recovery code',
    enrollPin: 'Set / change 6-digit device PIN',
    removePin: 'Remove device PIN',
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (kind === 'rotateRecovery') {
        const res = await window.diamo.command('auth.rotateRecovery', { currentPassword })
        if (!res.ok) throw Error(res.error)
        setNewKey((res.data as Row).recoveryKey)
        await onSuccess('New recovery code generated and hidden PDF updated.')
      } else if (kind === 'enrollPin') {
        if (!/^\d{6}$/.test(pin)) throw Error('Device PIN must be exactly 6 digits.')
        if (pin !== confirmPin) throw Error('PINs must match.')
        const res = await window.diamo.command('auth.enrollPin', { currentPassword, pin })
        if (!res.ok) throw Error(res.error)
        await onSuccess('6-digit Device PIN saved for this computer.')
        close()
      } else {
        const res = await window.diamo.command('auth.removePin', { currentPassword })
        if (!res.ok) throw Error(res.error)
        await onSuccess('Device PIN removed from this computer.')
        close()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer title={titles[kind]} subtitle="ACCOUNT SECURITY" size="md" close={close}>
      {newKey ? (
        <div className="drawer-form">
          <div className="drawer-body">
            <p className="info">
              Your previous recovery code has been replaced, and the hidden recovery PDF in your
              local DIAMO folder has been updated automatically.
            </p>
            <div className="recovery-key-box">
              <small>NEW MASTER RECOVERY CODE</small>
              <code>{newKey}</code>
              <div className="button-row" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(newKey)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? 'Copied' : 'Copy code'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setError('')
                    const res = await window.diamo.saveRecoveryPdf()
                    if (!res.ok) setError(res.error)
                    else if (res.data) setPdfNotice(`Saved recovery PDF to ${res.data}`)
                  }}
                >
                  <Download size={15} />
                  Download recovery PDF
                </button>
              </div>
            </div>
            {pdfNotice && <p className="success banner">{pdfNotice}</p>}
            {error && (
              <div className="error banner" role="alert">
                {error}
              </div>
            )}
          </div>
          <footer className="drawer-footer">
            <button type="button" className="primary" onClick={close}>
              Done
            </button>
          </footer>
        </div>
      ) : (
        <form className="drawer-form" onSubmit={handleSubmit}>
          <div className="drawer-body">
            {kind === 'rotateRecovery' && (
              <p className="muted" style={{ marginBottom: 14 }}>
                Generates a new 71-character Recovery Code, replaces the hidden recovery PDF on
                disk, and preserves any enrolled Device PIN on this computer.
              </p>
            )}
            {kind === 'enrollPin' && (
              <p className="muted" style={{ marginBottom: 14 }}>
                Sets or updates your 6-digit hardware-bound Device PIN (5-attempt protection).
              </p>
            )}
            {kind === 'removePin' && (
              <p className="muted" style={{ marginBottom: 14 }}>
                Removes the Device PIN file from this computer. Your Recovery Code will still work.
              </p>
            )}
            <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
              <label className="field">
                <span>Current password *</span>
                <input
                  aria-label="Current password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </label>
              {kind === 'enrollPin' && (
                <>
                  <label className="field">
                    <span>6-digit Device PIN *</span>
                    <input
                      aria-label="6-digit Device PIN"
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Confirm 6-digit PIN *</span>
                    <input
                      aria-label="Confirm 6-digit PIN"
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      value={confirmPin}
                      onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      required
                    />
                  </label>
                </>
              )}
            </div>
            {error && (
              <div className="error banner" role="alert">
                {error}
              </div>
            )}
          </div>
          <footer className="drawer-footer">
            <button type="button" onClick={close}>
              Cancel
            </button>
            <button
              type="submit"
              className={kind === 'removePin' ? 'danger-btn' : 'primary'}
              disabled={busy}
            >
              {busy ? 'Processing…' : kind === 'removePin' ? 'Remove PIN' : 'Save'}
            </button>
          </footer>
        </form>
      )}
    </Drawer>
  )
}
