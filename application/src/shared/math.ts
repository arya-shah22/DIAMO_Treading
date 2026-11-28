import Decimal from 'decimal.js'
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })
export function integer(v: Decimal.Value): number {
  const n = new Decimal(v).toDecimalPlaces(0).toNumber()
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1e13)
    throw Error('Amount exceeds supported precision')
  return n
}
export function lineValue(carats: number, rate: string, less: string) {
  const gross = integer(new Decimal(carats).mul(rate))
  return { gross, net: integer(new Decimal(gross).mul(new Decimal(100).minus(less)).div(100)) }
}
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (!sum) {
    if (total) throw Error('Expenses cannot be allocated across zero-value lines')
    return weights.map(() => 0)
  }
  const values = weights.map((w, i) => {
    const exact = new Decimal(total).mul(w).div(sum)
    const floor = exact.floor().toNumber()
    return { i, floor, fraction: exact.minus(floor) }
  })
  let left = total - values.reduce((a, b) => a + b.floor, 0)
  for (const v of [...values].sort((a, b) => b.fraction.cmp(a.fraction) || a.i - b.i)) {
    if (left-- > 0) v.floor++
  }
  return values.map((v) => v.floor)
}
export function addDays(d: string, n: number) {
  return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
}
export function days(a: string, b: string) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)
}
export function interest(
  principal: number,
  rate: string,
  frequency: string,
  start: string,
  end: string,
) {
  return integer(
    new Decimal(principal)
      .mul(rate)
      .div(100)
      .mul(Math.max(0, days(start, end)))
      .div(frequency === 'monthly' ? 30 : 365),
  )
}
export function fy(date: string) {
  const y = Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 4 ? 1 : 0)
  return `${y}-${String(y + 1).slice(2)}`
}
export const money = (v: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((v || 0) / 100)
export const usd = (v: number | string) => {
  const n = Number(v || 0)
  const decimals = Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) > 0.0001 ? 4 : 2
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  }).format(Number.isFinite(n) ? n : 0)
}
export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function srPrefix(qualityName: string): string {
  const slug = String(qualityName ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'ST'
}
export function formatSrNo(prefix: string, seq: number): string {
  return `${prefix}-${String(Math.max(1, seq)).padStart(4, '0')}`
}
export function parseSrSequence(srNo: string, prefix: string): number | null {
  const clean = String(srNo ?? '')
    .trim()
    .toUpperCase()
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = clean.match(new RegExp(`^${escaped}-(\\d+)$`))
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}
