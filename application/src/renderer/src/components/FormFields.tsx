import { type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import type { Row } from '../../../shared/contracts'

export const displayDate = (d: string) =>
  d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : d

export const ct = (v: number) => (v / 100).toFixed(2)

export const units = (v: unknown) => {
  const n = Number(v)
  if (
    !Number.isFinite(n) ||
    Math.abs(n) > 1e11 ||
    Math.abs(n * 100 - Math.round(n * 100)) > 0.00001
  ) {
    throw Error('Enter an amount with at most two decimal places')
  }
  return Math.round(n * 100)
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  options,
  required = false,
  step = '0.01',
}: {
  label: string
  value: any
  onChange: (v: any) => void
  type?: string
  options?: { value: any; label: string }[]
  required?: boolean
  step?: string
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required ? ' *' : ''}
      </span>
      {options ? (
        <select
          aria-label={label}
          name={label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          required={required}
        >
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : type === 'textarea' ? (
        <textarea
          aria-label={label}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          aria-label={label}
          value={value ?? ''}
          type={type}
          step={type === 'number' ? step : undefined}
          onChange={(e) => onChange(e.target.value)}
          required={required}
        />
      )}
    </label>
  )
}

export function ListEditor({
  title,
  items,
  setItems,
  empty,
  children,
}: {
  title: string
  items: Row[]
  setItems: (v: Row[]) => void
  empty: Row
  children: (r: Row, update: (key: string, value: any) => void, i: number) => ReactNode
}) {
  return (
    <section className="form-section">
      <div className="section-heading">
        <h3>{title}</h3>
        <button type="button" onClick={() => setItems([...items, { ...empty }])}>
          <Plus size={14} />
          Add row
        </button>
      </div>
      {items.map((r, i) => (
        <div className="entry-row" key={i}>
          {children(
            r,
            (key, value) => setItems(items.map((v, j) => (j === i ? { ...v, [key]: value } : v))),
            i,
          )}
          <button
            type="button"
            className="remove"
            aria-label={`Remove ${title} row ${i + 1}`}
            onClick={() => setItems(items.filter((_, j) => i !== j))}
          >
            <X size={16} />
          </button>
        </div>
      ))}
      {!items.length && <p className="muted">No {title.toLowerCase()} added.</p>}
    </section>
  )
}
