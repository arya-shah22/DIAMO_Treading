import { useEffect, useRef, useState } from 'react'
import Decimal from 'decimal.js'
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Gem } from 'lucide-react'
import type { Row } from '../../../shared/contracts'
import { formatSrNo, money, srPrefix, usd } from '../../../shared/math'
import { ct, Field } from './FormFields'

export function CurrencyAmount({
  currency = 'INR',
  inrPaise,
  usdAmount,
  exchangeRate,
  size = 'md',
  align = 'left',
}: {
  currency?: string
  inrPaise: number
  usdAmount?: string | number | null
  exchangeRate?: string | number | null
  size?: 'sm' | 'md' | 'lg'
  align?: 'left' | 'right'
}) {
  const cur = currency === 'USD' ? 'USD' : 'INR'
  const ex = dec(exchangeRate)
  const fxText = ex && ex.gt(0) ? ` @ ₹${ex.toString()} / $` : ''
  let resolvedUsd = dec(usdAmount)
  if (!resolvedUsd && ex && ex.gt(0) && inrPaise) {
    resolvedUsd = new Decimal(inrPaise).div(100).div(ex)
  }
  const stackCls = `currency-stack ${size}${align === 'right' ? ' right' : ''}`

  if (cur === 'USD') {
    const usdMain = resolvedUsd ? usd(resolvedUsd.toNumber()) : usd(0)
    return (
      <span className={stackCls}>
        <strong className="currency-main">{usdMain}</strong>
        <small className="currency-sub">
          {money(inrPaise)}
          {fxText}
        </small>
      </span>
    )
  }

  return (
    <span className={stackCls}>
      <strong className="currency-main">{money(inrPaise)}</strong>
      {resolvedUsd && ex && ex.gt(0) && (
        <small className="currency-sub">
          {usd(resolvedUsd.toNumber())}
          {fxText}
        </small>
      )}
    </span>
  )
}

export function summarizeLinesCurrency(lines: Row[]): {
  currency: 'INR' | 'USD'
  inrPaise: number
  usdAmount: string
  exchangeRate: string
} {
  let inrPaise = 0
  let sumUsd = new Decimal(0)
  const rates = new Set<string>()
  const currencies = new Set<string>()

  for (const l of lines) {
    const carats = dec(l.carats)
    const rate = dec(l.rate)
    const factor = netFactor(l.less)
    const s = l.stone
    const lineCur = s?.priceCurrency === 'USD' ? 'USD' : 'INR'
    currencies.add(lineCur)
    const exStr = String(s?.exchangeRate ?? '').trim()
    if (exStr && dec(exStr)?.gt(0)) rates.add(exStr)

    if (carats && rate) {
      const lineInr = rate
        .mul(carats)
        .mul(factor)
        .mul(100)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      inrPaise += lineInr.toNumber()
      const lineUsd = dec(s?.totalUsd)
      if (lineUsd) {
        sumUsd = sumUsd.plus(lineUsd)
      } else if (exStr && dec(exStr)?.gt(0)) {
        sumUsd = sumUsd.plus(lineInr.div(100).div(dec(exStr)!))
      }
    } else if (dec(s?.totalUsd)) {
      sumUsd = sumUsd.plus(dec(s.totalUsd)!)
    }
  }

  const allUsd = lines.length > 0 && currencies.size === 1 && currencies.has('USD')
  const uniformRate = rates.size === 1 ? [...rates][0] : ''
  return {
    currency: allUsd ? 'USD' : 'INR',
    inrPaise,
    usdAmount: sumUsd.gt(0) ? fmtDec(sumUsd, 2) : '',
    exchangeRate: uniformRate,
  }
}

export const EMPTY_STONE_SPECS: Row = {
  srNo: '',
  _autoSr: true,
  _srQualityId: 0,
  availability: 'available',
  unbilled: false,
  shape: '',
  color: '',
  fancyColor: '',
  colorIntensity: '',
  colorOvertone: '',
  clarity: '',
  cut: '',
  polish: '',
  symmetry: '',
  ratio: '',
  lengthMm: '',
  widthMm: '',
  heightMm: '',
  depthPct: '',
  tablePct: '',
  fluorescence: '',
  lab: '',
  reportNumber: '',
  growth: '',
  priceCurrency: 'INR',
  exchangeRate: '',
  rateUsd: '',
  totalUsd: '',
  rateInr: '',
  totalInr: '',
}

export function certificateVerifyUrl(lab: string, reportNumber: string): string | null {
  const report = String(reportNumber ?? '').trim()
  if (!report) return null
  const upper = String(lab ?? '')
    .trim()
    .toUpperCase()
  if (upper.includes('GIA')) {
    return `https://www.gia.gov/report-check?reportno=${encodeURIComponent(report)}`
  }
  if (upper.includes('HRD')) {
    return `https://my.hrdantwerp.com/?record_number=${encodeURIComponent(report)}`
  }
  return `https://www.igi.org/Verify-Your-Report/?r=${encodeURIComponent(report)}`
}

export function formatMeasurements(s: Row): string {
  const l = String(s.length_mm ?? s.lengthMm ?? '').trim()
  const w = String(s.width_mm ?? s.widthMm ?? '').trim()
  const h = String(s.height_mm ?? s.heightMm ?? '').trim()
  if (!l && !w && !h) return '—'
  return `${l || '?'} × ${w || '?'} × ${h || '?'} mm`
}

function dec(v: unknown): Decimal | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  try {
    const d = new Decimal(s)
    return d.isFinite() && d.gte(0) ? d : null
  } catch {
    return null
  }
}

function fmtDec(d: Decimal, places = 2): string {
  return d.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places)
}

function netFactor(lessPct: unknown): Decimal {
  const l = dec(lessPct) ?? new Decimal(0)
  const factor = new Decimal(100).minus(l).div(100)
  return factor.gt(0) ? factor : new Decimal(1)
}

/** Recompute linked Rate, Price/ct, Total Price, and Exchange Rate values without float drift. */
export function updateStoneLinePricing(
  line: Row,
  changed: 'carats' | 'less' | 'currency' | 'exchangeRate' | 'rate' | 'total',
  value: any,
): Row {
  const stone: Row = { ...EMPTY_STONE_SPECS, ...(line.stone ?? {}) }
  const nextLine: Row = { ...line, stone }

  if (changed === 'carats') nextLine.carats = value
  if (changed === 'less') nextLine.less = value
  if (changed === 'currency') stone.priceCurrency = value
  if (changed === 'exchangeRate') stone.exchangeRate = value

  const carats = dec(nextLine.carats)
  const exRate = dec(stone.exchangeRate)
  const factor = netFactor(nextLine.less)
  const currency = stone.priceCurrency === 'USD' ? 'USD' : 'INR'

  if (currency === 'USD') {
    if (changed === 'rate') {
      stone.rateUsd = String(value ?? '')
      const rUsd = dec(value)
      if (rUsd && carats && carats.gt(0)) {
        stone.totalUsd = fmtDec(rUsd.mul(carats).mul(factor), 2)
      } else if (value === '') {
        stone.totalUsd = ''
      }
    } else if (changed === 'total') {
      stone.totalUsd = String(value ?? '')
      const tUsd = dec(value)
      if (tUsd && carats && carats.gt(0)) {
        stone.rateUsd = fmtDec(tUsd.div(carats.mul(factor)), 4).replace(/\.?0+$/, '')
      } else if (value === '') {
        stone.rateUsd = ''
      }
    } else if (
      (changed === 'carats' || changed === 'less') &&
      dec(stone.rateUsd) &&
      carats &&
      carats.gt(0)
    ) {
      stone.totalUsd = fmtDec(dec(stone.rateUsd)!.mul(carats).mul(factor), 2)
    } else if (changed === 'currency') {
      // Switching INR -> USD: convert existing INR fields if exchange rate exists
      const rInr = dec(nextLine.rate)
      if (rInr && exRate && exRate.gt(0)) {
        const rUsd = rInr.div(exRate)
        stone.rateUsd = fmtDec(rUsd, 2)
        if (carats && carats.gt(0)) {
          stone.totalUsd = fmtDec(rUsd.mul(carats).mul(factor), 2)
        }
      }
    }

    const rUsdNow = dec(stone.rateUsd)
    const tUsdNow = dec(stone.totalUsd)
    if (exRate && exRate.gt(0)) {
      if (tUsdNow && carats && carats.gt(0)) {
        const tInr = tUsdNow.mul(exRate)
        const rInr = tInr.div(carats.mul(factor))
        stone.totalInr = fmtDec(tInr, 2)
        stone.rateInr = rInr.toDecimalPlaces(8).toString()
        nextLine.rate = stone.rateInr
      } else if (rUsdNow) {
        const rInr = rUsdNow.mul(exRate)
        stone.rateInr = rInr.toDecimalPlaces(8).toString()
        nextLine.rate = stone.rateInr
        if (carats && carats.gt(0)) {
          stone.totalInr = fmtDec(rInr.mul(carats).mul(factor), 2)
        }
      }
    }
  } else {
    if (changed === 'rate') {
      stone.rateInr = String(value ?? '')
      nextLine.rate = stone.rateInr
      const rInr = dec(value)
      if (rInr && carats && carats.gt(0)) {
        stone.totalInr = fmtDec(rInr.mul(carats).mul(factor), 2)
      } else if (value === '') {
        stone.totalInr = ''
      }
    } else if (changed === 'total') {
      stone.totalInr = String(value ?? '')
      const tInr = dec(value)
      if (tInr && carats && carats.gt(0)) {
        const rInr = tInr.div(carats.mul(factor))
        stone.rateInr = rInr.toDecimalPlaces(8).toString()
        nextLine.rate = stone.rateInr
      } else if (value === '') {
        stone.rateInr = ''
        nextLine.rate = ''
      }
    } else if (
      (changed === 'carats' || changed === 'less') &&
      dec(nextLine.rate) &&
      carats &&
      carats.gt(0)
    ) {
      stone.rateInr = String(nextLine.rate)
      stone.totalInr = fmtDec(dec(nextLine.rate)!.mul(carats).mul(factor), 2)
    } else if (changed === 'currency') {
      const rInr = dec(nextLine.rate)
      if (rInr) {
        stone.rateInr = rInr.toString()
        if (carats && carats.gt(0)) {
          stone.totalInr = fmtDec(rInr.mul(carats).mul(factor), 2)
        }
      }
    }

    const rInrNow = dec(nextLine.rate)
    if (exRate && exRate.gt(0) && rInrNow) {
      stone.rateUsd = fmtDec(rInrNow.div(exRate), 2)
      if (carats && carats.gt(0)) {
        stone.totalUsd = fmtDec(rInrNow.div(exRate).mul(carats).mul(factor), 2)
      }
    } else if (changed === 'exchangeRate' && !exRate) {
      stone.rateUsd = ''
      stone.totalUsd = ''
    }
  }

  return nextLine
}

export function assignAutoSrToLines(lines: Row[], qualities: Row[]): Row[] {
  const qMap = new Map<number, Row>(qualities.map((q) => [Number(q.id), q]))
  const manualSr = new Set<string>(
    lines
      .filter((l) => {
        const q = qMap.get(Number(l.qualityId))
        return q?.inventory_mode === 'individual' && l.stone?._autoSr === false && l.stone?.srNo
      })
      .map((l) => String(l.stone.srNo).trim().toUpperCase()),
  )
  const cursors = new Map<number, number>()
  return lines.map((line) => {
    const qId = Number(line.qualityId)
    const q = qMap.get(qId)
    if (q?.inventory_mode !== 'individual') return line
    const stone: Row = { ...EMPTY_STONE_SPECS, ...(line.stone ?? {}) }
    const sameQuality = Number(stone._srQualityId || 0) === qId
    if (stone._autoSr === false && String(stone.srNo ?? '').trim() && sameQuality) {
      return line
    }
    const prefix = String(q.sr_prefix ?? '') || srPrefix(q.name)
    let seq = cursors.get(qId) ?? Number(q.next_sr_seq ?? 1)
    let candidate = formatSrNo(prefix, seq)
    while (manualSr.has(candidate.toUpperCase())) {
      seq += 1
      candidate = formatSrNo(prefix, seq)
    }
    cursors.set(qId, seq + 1)
    return {
      ...line,
      stone: {
        ...stone,
        srNo: candidate,
        _autoSr: true,
        _srQualityId: qId,
      },
    }
  })
}

export function hydrateStoneForEdit(item: Row): Row {
  const s = item.stone
  const carats = item.carats / 100
  const factor = netFactor(item.less_pct)
  const rInr = dec(item.rate)
  const fallbackTotalInr = rInr ? fmtDec(rInr.mul(carats).mul(factor), 2) : ''
  if (!s) {
    return {
      ...EMPTY_STONE_SPECS,
      priceCurrency: item.price_currency === 'USD' ? 'USD' : 'INR',
      exchangeRate: item.exchange_rate ?? '',
      rateUsd: item.rate_usd ?? '',
      totalUsd: item.total_usd ?? '',
      rateInr: String(item.rate),
      totalInr: fallbackTotalInr,
    }
  }
  return {
    srNo: s.sr_no ?? '',
    _autoSr: false,
    _srQualityId: item.quality_id,
    availability: s.availability === 'hold' ? 'hold' : 'available',
    unbilled: Boolean(s.unbilled),
    shape: s.shape ?? '',
    color: s.color ?? '',
    fancyColor: s.fancy_color ?? '',
    colorIntensity: s.color_intensity ?? '',
    colorOvertone: s.color_overtone ?? '',
    clarity: s.clarity ?? '',
    cut: s.cut ?? '',
    polish: s.polish ?? '',
    symmetry: s.symmetry ?? '',
    ratio: s.ratio ?? '',
    lengthMm: s.length_mm ?? '',
    widthMm: s.width_mm ?? '',
    heightMm: s.height_mm ?? '',
    depthPct: s.depth_pct ?? '',
    tablePct: s.table_pct ?? '',
    fluorescence: s.fluorescence ?? '',
    lab: s.lab ?? '',
    reportNumber: s.report_number ?? '',
    growth: s.growth ?? '',
    priceCurrency: s.price_currency === 'USD' ? 'USD' : 'INR',
    exchangeRate: s.exchange_rate ?? '',
    rateUsd: s.price_per_ct_usd ?? '',
    totalUsd: s.total_price_usd ?? '',
    rateInr: s.price_per_ct_inr || String(item.rate),
    totalInr: s.total_price_inr ? (s.total_price_inr / 100).toFixed(2) : fallbackTotalInr,
  }
}

function CurrencyPriceControls({
  index,
  line,
  onReplaceLine,
}: {
  index: number
  line: Row
  onReplaceLine: (nextLine: Row) => void
}) {
  const stone: Row = { ...EMPTY_STONE_SPECS, ...(line.stone ?? {}) }
  const isUsd = stone.priceCurrency === 'USD'
  return (
    <>
      <div className="field">
        <span>Currency</span>
        <div className="currency-toggle" role="group" aria-label={`Currency for line ${index + 1}`}>
          <button
            type="button"
            className={!isUsd ? 'active' : ''}
            onClick={() => onReplaceLine(updateStoneLinePricing(line, 'currency', 'INR'))}
          >
            INR ₹
          </button>
          <button
            type="button"
            className={isUsd ? 'active' : ''}
            onClick={() => onReplaceLine(updateStoneLinePricing(line, 'currency', 'USD'))}
          >
            USD $
          </button>
        </div>
      </div>
      <Field
        label="Exchange Rate (₹ / $)"
        value={stone.exchangeRate}
        onChange={(v) => onReplaceLine(updateStoneLinePricing(line, 'exchangeRate', v))}
        type="number"
        step="any"
        required={isUsd}
      />
      <Field
        label={isUsd ? 'Price / ct ($)' : 'Price / ct (₹)'}
        value={isUsd ? stone.rateUsd : stone.rateInr || line.rate}
        onChange={(v) => onReplaceLine(updateStoneLinePricing(line, 'rate', v))}
        type="number"
        step="any"
        required
      />
      <Field
        label={isUsd ? 'Total Price ($)' : 'Total Price (₹)'}
        value={isUsd ? stone.totalUsd : stone.totalInr}
        onChange={(v) => onReplaceLine(updateStoneLinePricing(line, 'total', v))}
        type="number"
        step="any"
        required
      />
      <Field
        label="Less %"
        value={line.less}
        onChange={(v) => onReplaceLine(updateStoneLinePricing(line, 'less', v))}
        type="number"
        step="any"
      />
    </>
  )
}

export function SaleStoneLineEditor({
  index,
  line,
  qualities,
  availableStones,
  selectedLotId,
  onSelectQuality,
  onSelectStone,
  onReplaceLine,
}: {
  index: number
  line: Row
  qualities: { value: any; label: string }[]
  availableStones: Row[]
  selectedLotId: any
  onSelectQuality: (qualityId: any) => void
  onSelectStone: (lotId: any) => void
  onReplaceLine: (nextLine: Row) => void
}) {
  const summary = summarizeLinesCurrency([line])
  return (
    <div className="stone-line-wrap">
      <div className="stone-line-main">
        <Field
          label="Quality"
          value={line.qualityId}
          onChange={onSelectQuality}
          options={qualities}
          required
        />
        <Field
          label="Stone (Report # / Sr.)"
          value={selectedLotId}
          onChange={onSelectStone}
          options={availableStones.map((s: Row) => ({
            value: s.lot_id,
            label: stoneSummaryLabel(s),
          }))}
          required
        />
        <Field
          label="Carats (whole stone)"
          value={line.carats}
          onChange={() => {}}
          type="number"
          required
        />
        <CurrencyPriceControls index={index} line={line} onReplaceLine={onReplaceLine} />
      </div>
      {(summary.inrPaise > 0 || summary.usdAmount) && (
        <div className="stone-line-bar">
          <span className="stone-fx-preview">
            <CurrencyAmount
              currency={summary.currency}
              inrPaise={summary.inrPaise}
              usdAmount={summary.usdAmount}
              exchangeRate={summary.exchangeRate}
              size="sm"
              align="right"
            />
          </span>
        </div>
      )}
    </div>
  )
}

export function PurchaseStoneLineEditor({
  index,
  line,
  qualities,
  onReplaceLine,
  onChangeQuality,
  onOpenExternal,
}: {
  index: number
  line: Row
  qualities: { value: any; label: string }[]
  onReplaceLine: (nextLine: Row) => void
  onChangeQuality: (qualityId: any) => void
  onOpenExternal: (url: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const stone: Row = { ...EMPTY_STONE_SPECS, ...(line.stone ?? {}) }
  const summary = summarizeLinesCurrency([line])
  const verifyUrl = certificateVerifyUrl(stone.lab, stone.reportNumber)

  const patchStone = (key: string, val: any) => {
    onReplaceLine({ ...line, stone: { ...stone, [key]: val } })
  }

  const summaryBits = [
    stone.shape,
    stone.color || stone.fancyColor,
    stone.clarity,
    [stone.cut, stone.polish, stone.symmetry].filter(Boolean).join('/'),
    stone.reportNumber ? `${stone.lab || 'Lab'} #${stone.reportNumber}` : '',
    stone.growth,
  ].filter(Boolean)

  return (
    <div className="stone-line-wrap">
      <div className="stone-line-main">
        <Field
          label="Sr."
          value={stone.srNo}
          onChange={(v) =>
            onReplaceLine({
              ...line,
              stone: {
                ...stone,
                srNo: v,
                _autoSr: String(v).trim() === '',
                _srQualityId: Number(line.qualityId || 0),
              },
            })
          }
          placeholder="Auto per quality"
          required={false}
        />
        <Field
          label="Quality"
          value={line.qualityId}
          onChange={onChangeQuality}
          options={qualities}
          required
        />
        <Field
          label="Carat Weight"
          value={line.carats}
          onChange={(v) => onReplaceLine(updateStoneLinePricing(line, 'carats', v))}
          type="number"
          required
        />
        <CurrencyPriceControls index={index} line={line} onReplaceLine={onReplaceLine} />
      </div>

      <div className="stone-line-bar">
        <button
          type="button"
          className="stone-expand-btn"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Gem size={14} />
          Stone details (all optional)
        </button>
        {summaryBits.length > 0 && <span className="muted">{summaryBits.join(' · ')}</span>}
        {(summary.inrPaise > 0 || summary.usdAmount) && (
          <span className="stone-fx-preview">
            <CurrencyAmount
              currency={summary.currency}
              inrPaise={summary.inrPaise}
              usdAmount={summary.usdAmount}
              exchangeRate={summary.exchangeRate}
              size="sm"
              align="right"
            />
          </span>
        )}
      </div>

      {expanded && (
        <div className="stone-specs-panel">
          <div className="stone-specs-grid">
            <Field
              label="Availability"
              value={stone.availability}
              onChange={(v) => patchStone('availability', v)}
              options={[
                { value: 'available', label: 'Available' },
                { value: 'hold', label: 'Hold' },
              ]}
            />
            <Field label="Shape" value={stone.shape} onChange={(v) => patchStone('shape', v)} />
            <Field label="Color" value={stone.color} onChange={(v) => patchStone('color', v)} />
            <Field
              label="Fancy Color"
              value={stone.fancyColor}
              onChange={(v) => patchStone('fancyColor', v)}
            />
            <Field
              label="Color Intensity"
              value={stone.colorIntensity}
              onChange={(v) => patchStone('colorIntensity', v)}
            />
            <Field
              label="Color Overtone"
              value={stone.colorOvertone}
              onChange={(v) => patchStone('colorOvertone', v)}
            />
            <Field
              label="Clarity"
              value={stone.clarity}
              onChange={(v) => patchStone('clarity', v)}
            />
            <Field label="Cut" value={stone.cut} onChange={(v) => patchStone('cut', v)} />
            <Field
              label="Pol (Polish)"
              value={stone.polish}
              onChange={(v) => patchStone('polish', v)}
            />
            <Field
              label="Sym (Symmetry)"
              value={stone.symmetry}
              onChange={(v) => patchStone('symmetry', v)}
            />
            <Field
              label="Ratio"
              value={stone.ratio}
              onChange={(v) => patchStone('ratio', v)}
              type="number"
              step="any"
            />
            <Field
              label="Length (mm)"
              value={stone.lengthMm}
              onChange={(v) => patchStone('lengthMm', v)}
              type="number"
              step="any"
            />
            <Field
              label="Width (mm)"
              value={stone.widthMm}
              onChange={(v) => patchStone('widthMm', v)}
              type="number"
              step="any"
            />
            <Field
              label="Height (mm)"
              value={stone.heightMm}
              onChange={(v) => patchStone('heightMm', v)}
              type="number"
              step="any"
            />
            <Field
              label="Depth %"
              value={stone.depthPct}
              onChange={(v) => patchStone('depthPct', v)}
              type="number"
              step="any"
            />
            <Field
              label="Table %"
              value={stone.tablePct}
              onChange={(v) => patchStone('tablePct', v)}
              type="number"
              step="any"
            />
            <Field
              label="Fluor (Fluorescence)"
              value={stone.fluorescence}
              onChange={(v) => patchStone('fluorescence', v)}
            />
            <Field label="Lab" value={stone.lab} onChange={(v) => patchStone('lab', v)} />
            <div className="field">
              <span>Report #</span>
              <div className="report-verify-row">
                <input
                  aria-label="Report #"
                  value={stone.reportNumber ?? ''}
                  onChange={(e) => {
                    const el = e.target
                    const next = el.value.toUpperCase()
                    if (el.value !== next) {
                      const start = el.selectionStart
                      const end = el.selectionEnd
                      el.value = next
                      if (start !== null && end !== null) {
                        requestAnimationFrame(() => el.setSelectionRange(start, end))
                      }
                    }
                    patchStone('reportNumber', next)
                  }}
                />
                {verifyUrl && (
                  <button
                    type="button"
                    title="Verify certificate online"
                    onClick={() => onOpenExternal(verifyUrl)}
                  >
                    <ExternalLink size={13} />
                    Verify
                  </button>
                )}
              </div>
            </div>
            <Field
              label="Growth"
              value={stone.growth}
              onChange={(v) => patchStone('growth', v)}
              options={[
                { value: 'CVD', label: 'CVD' },
                { value: 'HPHT', label: 'HPHT' },
              ]}
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(stone.unbilled)}
              onChange={(e) => patchStone('unbilled', e.target.checked)}
            />
            Show unbilled warning chip on this stone
          </label>
        </div>
      )}
    </div>
  )
}

export function StoneAvailabilityChip({
  stone,
  onChangeStatus,
  onMarkSold,
}: {
  stone: Row
  onChangeStatus: (stoneId: number, availability: 'available' | 'hold') => void
  onMarkSold: (stone: Row) => void
}) {
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuPos) return
    const syncPos = () => {
      const rect = btnRef.current?.getBoundingClientRect()
      if (rect) setMenuPos({ top: rect.bottom + 4, left: rect.left })
    }
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuPos(null)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuPos(null)
    }
    window.addEventListener('mousedown', onDocClick)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', syncPos, true)
    window.addEventListener('resize', syncPos)
    return () => {
      window.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', syncPos, true)
      window.removeEventListener('resize', syncPos)
    }
  }, [Boolean(menuPos)])

  const status = String(stone.availability ?? 'available')
  const label = status === 'hold' ? 'Hold' : status === 'sold' ? 'Sold' : 'Available'

  return (
    <div className="stone-status-cell" ref={wrapRef}>
      {status === 'sold' ? (
        <span
          className="status-chip sold"
          title={stone.sale_number ? `Billed on ${stone.sale_number}` : undefined}
        >
          Sold{stone.sale_number ? ` · ${stone.sale_number}` : ''}
        </span>
      ) : (
        <button
          ref={btnRef}
          type="button"
          className={`status-chip ${status}`}
          aria-expanded={Boolean(menuPos)}
          onClick={() => {
            if (menuPos) {
              setMenuPos(null)
              return
            }
            const rect = btnRef.current?.getBoundingClientRect()
            if (rect) {
              setMenuPos({ top: rect.bottom + 4, left: rect.left })
            }
          }}
        >
          {label}
          <ChevronDown size={12} />
        </button>
      )}
      {Boolean(stone.unbilled) && status !== 'sold' && (
        <span className="unbilled-chip" title="Unbilled warning">
          <AlertTriangle size={12} />
          Unbilled
        </span>
      )}
      {menuPos && (
        <div
          className="status-popover"
          role="menu"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {status !== 'available' && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuPos(null)
                onChangeStatus(stone.id, 'available')
              }}
            >
              Available
            </button>
          )}
          {status !== 'hold' && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuPos(null)
                onChangeStatus(stone.id, 'hold')
              }}
            >
              Hold
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="sell-action"
            onClick={() => {
              setMenuPos(null)
              onMarkSold(stone)
            }}
          >
            Sold (New Sale Invoice)
          </button>
        </div>
      )}
    </div>
  )
}

export function stoneSummaryLabel(stone: Row) {
  const parts = [
    stone.sr_no ? `Sr.${stone.sr_no}` : `Stone #${stone.id}`,
    stone.report_number ? `${stone.lab || 'Lab'} #${stone.report_number}` : '',
    stone.shape,
    `${ct(stone.carats)} ct`,
    [stone.color || stone.fancy_color, stone.clarity].filter(Boolean).join(' '),
    stone.availability === 'hold' ? '[Hold]' : '',
    money(stone.remaining_cost ?? stone.original_cost ?? 0),
  ].filter(Boolean)
  return parts.join(' · ')
}
