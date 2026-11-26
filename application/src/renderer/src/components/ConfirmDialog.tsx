import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

export interface ConfirmState {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  requireReason?: boolean
  reasonLabel?: string
  reasonPlaceholder?: string
  onConfirm: (reason: string) => Promise<void> | void
}

export function ConfirmDialog({
  state,
  busy,
  close,
}: {
  state: ConfirmState
  busy: boolean
  close: () => void
}) {
  const [reason, setReason] = useState('')
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, close])

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault()
    if (state.requireReason && !reason.trim()) {
      setLocalError('Please enter a reason before proceeding.')
      return
    }
    setLocalError('')
    await state.onConfirm(reason.trim())
  }

  return (
    <div
      className="confirm-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) close()
      }}
    >
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={state.title}
      >
        <header className="confirm-header">
          <div className="confirm-title">
            <AlertTriangle size={20} className={state.danger ? 'negative' : 'warn-icon'} />
            <h2>{state.title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close confirmation"
            disabled={busy}
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        <form onSubmit={handleConfirm}>
          <div className="confirm-body">
            <p className="confirm-message">{state.message}</p>
            {state.requireReason && (
              <label className="field">
                <span>{state.reasonLabel ?? 'Reason *'}</span>
                <textarea
                  aria-label={state.reasonLabel ?? 'Reason'}
                  placeholder={state.reasonPlaceholder ?? 'Enter audit reason…'}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  autoFocus
                />
              </label>
            )}
            {localError && (
              <p className="error" role="alert">
                {localError}
              </p>
            )}
          </div>
          <footer className="drawer-footer">
            <button type="button" disabled={busy} onClick={close}>
              Cancel
            </button>
            <button
              type="submit"
              className={state.danger ? 'danger-btn' : 'primary'}
              disabled={busy}
            >
              {busy ? 'Processing…' : state.confirmLabel}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
