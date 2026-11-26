import { useEffect, useRef } from 'react'
import { AlertCircle, CheckCircle2, Download, ExternalLink, Info, RefreshCw, X } from 'lucide-react'
import type { SystemInfo, UpdateInfo } from '../../../shared/contracts'

export function formatPlatform(platform: string, arch: string) {
  const osName =
    platform === 'darwin'
      ? 'macOS'
      : platform === 'win32'
        ? 'Windows'
        : platform === 'linux'
          ? 'Linux'
          : platform
  return arch ? `${osName} (${arch})` : osName
}

function downloadLabel(platform?: string) {
  if (platform === 'darwin') return 'Download update for macOS'
  if (platform === 'win32') return 'Download update for Windows'
  return 'Download update'
}

export function SoftwareUpdateModal({
  open,
  info,
  onDismiss,
  onDownload,
}: {
  open: boolean
  info: Extract<UpdateInfo, { status: 'success' }> | null
  onDismiss: () => void
  onDownload: (url: string) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && info && !dialog.open) {
      dialog.showModal()
    } else if ((!open || !info) && dialog.open) {
      dialog.close()
    }
  }, [open, info])

  return (
    <dialog
      ref={dialogRef}
      className="update-dialog"
      aria-labelledby="update-modal-title"
      onCancel={(e) => {
        e.preventDefault()
        onDismiss()
      }}
    >
      {info && (
        <>
          <header className="confirm-header">
            <div className="confirm-title">
              <Download size={20} className="update-icon" />
              <h1 id="update-modal-title" className="update-modal-heading">
                Software update available
              </h1>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Close update notice"
              onClick={onDismiss}
            >
              <X size={18} />
            </button>
          </header>
          <div className="confirm-body">
            <div className="update-version-row">
              <span>
                Installed: <strong>v{info.currentVersion.replace(/^[vV]/, '')}</strong>
              </span>
              <span>
                Latest:{' '}
                <strong className="update-latest">
                  v{info.latestVersion.replace(/^[vV]/, '')}
                </strong>
              </span>
            </div>
            {info.releaseName && (
              <p className="update-release-name">
                <strong>{info.releaseName}</strong>
              </p>
            )}
            <div className="update-notes" tabIndex={0} aria-label="Release notes">
              {info.releaseNotes.trim() || 'No release notes provided for this version.'}
            </div>
          </div>
          <footer className="drawer-footer">
            <button type="button" autoFocus onClick={onDismiss}>
              Remind me later
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => onDownload(info.downloadUrl || info.releaseUrl)}
            >
              <Download size={16} />
              Download update
            </button>
          </footer>
        </>
      )}
    </dialog>
  )
}

export function SoftwareInfoPanel({
  systemInfo,
  updateInfo,
  checking,
  onCheckUpdate,
  onOpenExternal,
}: {
  systemInfo: SystemInfo | null
  updateInfo: UpdateInfo | null
  checking: boolean
  onCheckUpdate: () => void
  onOpenExternal: (url: string) => void
}) {
  const repo = systemInfo?.repo ?? 'arya-shah22/DIAMO_Treading'
  const releasesUrl = `https://github.com/${repo}/releases`

  return (
    <section className="panel settings-card">
      <h2>Software info &amp; updates</h2>
      <p>
        DIAMO_TREADING runs 100% locally on your computer. Update checks perform a read-only lookup
        against public GitHub Releases only when connected to the internet and never transmit your
        accounting books or credentials.
      </p>
      <dl>
        <dt>Installed version</dt>
        <dd>{systemInfo ? `v${systemInfo.version}` : 'Loading…'}</dd>
        <dt>Platform &amp; architecture</dt>
        <dd>{systemInfo ? formatPlatform(systemInfo.platform, systemInfo.arch) : 'Loading…'}</dd>
        <dt>Local data storage</dt>
        <dd>{systemInfo?.dataPath ?? 'Offline local storage'}</dd>
        <dt>Update source</dt>
        <dd>{repo} (GitHub Releases)</dd>
      </dl>
      <div className="button-row">
        <button type="button" className="primary" disabled={checking} onClick={onCheckUpdate}>
          <RefreshCw size={15} className={checking ? 'spin' : undefined} />
          {checking ? 'Checking for updates...' : 'Check for updates'}
        </button>
        <button type="button" onClick={() => onOpenExternal(releasesUrl)}>
          <ExternalLink size={15} />
          View releases on GitHub
        </button>
      </div>

      {updateInfo && updateInfo.status === 'success' && updateInfo.updateAvailable && (
        <div className="software-status-box available" role="status">
          <div className="software-status-head">
            <Download size={18} />
            <strong>
              Update available: v{updateInfo.currentVersion.replace(/^[vV]/, '')} → v
              {updateInfo.latestVersion.replace(/^[vV]/, '')}
            </strong>
          </div>
          {updateInfo.releaseNotes.trim() && (
            <div className="update-notes">{updateInfo.releaseNotes}</div>
          )}
          <div className="button-row">
            <button
              type="button"
              className="primary"
              onClick={() => onOpenExternal(updateInfo.downloadUrl || updateInfo.releaseUrl)}
            >
              <Download size={15} />
              {downloadLabel(systemInfo?.platform)}
            </button>
          </div>
        </div>
      )}

      {updateInfo && updateInfo.status === 'success' && !updateInfo.updateAvailable && (
        <div className="software-status-box uptodate" role="status">
          <CheckCircle2 size={18} />
          <span>You are running the latest version (v{updateInfo.currentVersion}).</span>
        </div>
      )}

      {updateInfo && updateInfo.status !== 'success' && (
        <div className="software-status-box neutral" role="status">
          {updateInfo.status === 'offline' ? <AlertCircle size={18} /> : <Info size={18} />}
          <span>{updateInfo.message}</span>
        </div>
      )}
    </section>
  )
}
