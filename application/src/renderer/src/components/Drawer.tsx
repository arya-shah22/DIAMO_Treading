import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

export type DrawerSize = 'md' | 'lg' | 'xl'

export function Drawer({
  title,
  subtitle = 'DIAMO WORKSPACE',
  size = 'lg',
  children,
  close,
}: {
  title: string
  subtitle?: string
  size?: DrawerSize
  children: ReactNode
  close: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div
      className="drawer-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <aside className={`drawer drawer-${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-header">
          <div>
            <small>{subtitle}</small>
            <h2>{title}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close drawer" onClick={close}>
            <X size={20} />
          </button>
        </header>
        {children}
      </aside>
    </div>
  )
}
