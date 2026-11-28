import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Download, Package, Search } from 'lucide-react'
import type { Row } from '../../../shared/contracts'
import { money } from '../../../shared/math'

export const ReportContext = createContext('')

export const col = (
  key: string,
  label: string,
  format?: (v: any, r: Row) => ReactNode,
  sumMoney = false,
) => ({
  key,
  label,
  format,
  sumMoney,
})

export function DataTable({
  title,
  rows,
  columns,
  action,
  exportRows = true,
  showTotals = true,
}: {
  title: string
  rows: Row[]
  columns: {
    key: string
    label: string
    format?: (v: any, r: Row) => ReactNode
    sumMoney?: boolean
  }[]
  action?: (r: Row) => ReactNode
  exportRows?: boolean
  showTotals?: boolean
}) {
  const context = useContext(ReportContext)
  const [search, setSearch] = useState('')
  const [facet, setFacet] = useState('')
  const [sort, setSort] = useState('')
  const [desc, setDesc] = useState(false)
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState('')
  const [exportError, setExportError] = useState('')

  const facetKey = columns.find((c) => ['party', 'quality', 'kind'].includes(c.key))?.key

  const filtered = rows
    .filter(
      (r) =>
        (!status || r.status === status) &&
        (!facet || !facetKey || String(r[facetKey]) === facet) &&
        columns.some((c) =>
          String(r[c.key] ?? '')
            .toLowerCase()
            .includes(search.toLowerCase()),
        ),
    )
    .sort((a, b) =>
      !sort
        ? 0
        : (typeof a[sort] === 'number'
            ? a[sort] - b[sort]
            : String(a[sort] ?? '').localeCompare(String(b[sort] ?? ''))) * (desc ? -1 : 1),
    )

  useEffect(() => setPage(0), [search, status, facet, rows.length])

  const statuses = [...new Set(rows.map((r) => r.status).filter(Boolean))]
  const totals: Row = {}
  if (showTotals) {
    for (const c of columns) {
      if ((c.format === money || c.sumMoney) && !['average', 'running'].includes(c.key)) {
        totals[c.label] = money(
          filtered
            .filter((r) => r.status !== 'cancelled' && !r.reversed)
            .reduce((s, r) => s + Number(r[c.key] || 0), 0),
        )
      }
    }
  }

  const exportData = () =>
    filtered.map((r) =>
      Object.fromEntries(
        columns.map((c) => {
          const formatted = c.format ? c.format(r[c.key], r) : r[c.key]
          return [
            c.label,
            typeof formatted === 'object'
              ? c.sumMoney
                ? money(r[c.key])
                : String(r[c.key] ?? '')
              : (formatted ?? ''),
          ]
        }),
      ),
    )

  async function save(format: 'csv' | 'xlsx' | 'pdf' | 'print') {
    setExportError('')
    const data = exportData()
    if (Object.keys(totals).length && columns.length) {
      data.push({
        ...Object.fromEntries(columns.map((c) => [c.label, ''])),
        [columns[0].label]: 'Filtered totals (active)',
        ...totals,
      })
    }
    const result = await window.diamo.export(format, `${title} · ${context}`, data)
    if (!result.ok) setExportError(result.error)
  }

  return (
    <section className="panel table-panel">
      <div className="table-toolbar">
        <div className="search">
          <Search size={17} />
          <input
            aria-label={`Search ${title}`}
            placeholder={`Search ${title.toLowerCase()}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {statuses.length > 0 && (
          <select
            aria-label="Status filter"
            name="status_filter"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
        {facetKey && (
          <select
            aria-label={`Filter ${facetKey}`}
            name={`filter_${facetKey}`}
            value={facet}
            onChange={(e) => setFacet(e.target.value)}
          >
            <option value="">All {facetKey}</option>
            {[...new Set(rows.map((r) => String(r[facetKey] ?? '')))].filter(Boolean).map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        )}
        <div className="spacer" />
        {exportRows && (
          <>
            <button type="button" onClick={() => save('csv')}>
              CSV
            </button>
            <button type="button" onClick={() => save('xlsx')}>
              Excel
            </button>
            <button type="button" onClick={() => save('pdf')}>
              <Download size={14} />
              PDF
            </button>
            <button type="button" onClick={() => save('print')}>
              Print
            </button>
          </>
        )}
      </div>
      {exportError && (
        <div className="error banner" role="alert">
          {exportError}
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>
                  <button
                    type="button"
                    onClick={() => {
                      setSort(c.key)
                      setDesc(sort === c.key ? !desc : false)
                    }}
                  >
                    {c.label} {sort === c.key ? (desc ? '↓' : '↑') : '↕'}
                  </button>
                </th>
              ))}
              {action && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(page * 20, (page + 1) * 20).map((r, i) => (
              <tr key={r.id ?? i}>
                {columns.map((c) => (
                  <td key={c.key}>
                    {c.format ? (
                      c.format(r[c.key], r)
                    ) : c.key === 'status' ? (
                      <span className={'status ' + r[c.key]}>{r[c.key]}</span>
                    ) : (
                      String(r[c.key] ?? '—')
                    )}
                  </td>
                ))}
                {action && (
                  <td>
                    <div className="row-actions">{action(r)}</div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <div className="empty">
            <Package size={30} />
            <h3>No records found</h3>
            <p>Add your first record or adjust the filters.</p>
          </div>
        )}
      </div>
      {Object.keys(totals).length > 0 && (
        <div className="table-totals">
          <small>Filtered totals · active records</small>
          {Object.entries(totals).map(([label, value]) => (
            <span key={label}>
              {label} <b>{String(value)}</b>
            </span>
          ))}
        </div>
      )}
      <footer className="table-footer">
        <span>
          {filtered.length} records ·{' '}
          {filtered.length ? Math.min(page * 20 + 1, filtered.length) : 0}–
          {Math.min((page + 1) * 20, filtered.length)} shown
        </span>
        <div>
          <button type="button" disabled={!page} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            {' '}
            {page + 1} / {Math.max(1, Math.ceil(filtered.length / 20))}{' '}
          </span>
          <button
            type="button"
            disabled={(page + 1) * 20 >= filtered.length}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </footer>
    </section>
  )
}
