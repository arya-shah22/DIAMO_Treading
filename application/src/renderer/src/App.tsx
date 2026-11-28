import React, { useEffect, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowLeftRight,
  ArrowUpRight,
  BookOpen,
  Building2,
  ChartNoAxesCombined,
  CheckCircle2,
  DatabaseBackup,
  ExternalLink,
  Eye,
  EyeOff,
  Gem,
  HandCoins,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Plus,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Users,
  X,
} from 'lucide-react'
import type { Command, Query, Row, SystemInfo, UpdateInfo } from '../../shared/contracts'
import { days, fy, money, today } from '../../shared/math'
import logo from '../../../resources/branding/icon.png'
import { ConfirmDialog, type ConfirmState } from './components/ConfirmDialog'
import { col, DataTable, ReportContext } from './components/DataTable'
import { Drawer, type DrawerSize } from './components/Drawer'
import { ct, displayDate, Field, ListEditor, units } from './components/FormFields'
import {
  ForgotPasswordDrawer,
  OnboardingRecoveryDrawer,
  SettingsRecoveryDrawer,
} from './components/RecoveryDrawers'
import { SoftwareInfoPanel, SoftwareUpdateModal } from './components/UpdateModalAndInfo'
import {
  assignAutoSrToLines,
  certificateVerifyUrl,
  CurrencyAmount,
  EMPTY_STONE_SPECS,
  formatMeasurements,
  hydrateStoneForEdit,
  PurchaseStoneLineEditor,
  SaleStoneLineEditor,
  StoneAvailabilityChip,
  summarizeLinesCurrency,
} from './components/StoneInventoryUI'

const pages = [
  ['Overview', 'Dashboard', LayoutDashboard],
  ['Masters', 'Parties Master', Users],
  ['Masters', 'Quality Master', Gem],
  ['Masters', 'Bank Accounts', Landmark],
  ['Trading', 'Stock Inventory', Package],
  ['Trading', 'Purchase', ShoppingBag],
  ['Trading', 'Sale', Receipt],
  ['Finance', 'Loans', HandCoins],
  ['Finance', 'Payments', ArrowLeftRight],
  ['Finance', 'Cash & Bank', Landmark],
  ['Finance', 'Journal Voucher', BookOpen],
  ['Reports', 'Party Ledger', BookOpen],
  ['Reports', 'Balance Sheet', ChartNoAxesCombined],
  ['Reports', 'Profit & Loss', ChartNoAxesCombined],
  ['Reports', 'Day Book', BookOpen],
  ['Administration', 'Manage Companies', Building2],
  ['Administration', 'Settings', Settings],
  ['Administration', 'Backup & Restore', DatabaseBackup],
] as const

const drawerTitles: Record<string, string> = {
  party: 'Party details',
  partyProfile: 'Party profile',
  quality: 'Quality details',
  bank: 'Bank account',
  company: 'Create company',
  purchase: 'Purchase invoice',
  sale: 'Sale invoice',
  payment: 'Payment / receipt',
  loan: 'Loan',
  settle: 'Loan interest & settlement',
  journal: 'Journal voucher',
  transfer: 'Cash / bank transfer',
  advance: 'Apply advance',
  opening: 'Opening balances',
  settings: 'Company settings',
  username: 'Change username',
  password: 'Change password',
  account: 'Custom ledger account',
  backupOptions: 'Backup preferences',
  numbering: 'Document numbering',
  lot: 'Stock lot movements',
  stoneDetail: 'Diamond stone specifications',
  dues: 'Due notifications',
}

function getDrawerSize(modal: string): DrawerSize {
  if (['purchase', 'sale', 'opening', 'detail', 'partyProfile'].includes(modal)) return 'xl'
  if (['payment', 'journal', 'lot', 'stoneDetail', 'dues'].includes(modal)) return 'lg'
  return 'md'
}

export default function App() {
  const [state, setState] = useState<Row>({ authenticated: false })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [page, setPage] = useState('Dashboard')
  const [collapsed, setCollapsed] = useState(false)
  const [modal, setModal] = useState<string | null>(null)
  const [form, setForm] = useState<Row>({})
  const [detail, setDetail] = useState<Row | null>(null)
  const [query, setQuery] = useState<Query>({
    from: fy(today()).slice(0, 4) + '-04-01',
    to: today(),
  })
  const [partyFilter, setPartyFilter] = useState('')
  const [fundFilter, setFundFilter] = useState('')
  const [backupHistory, setBackupHistory] = useState<Row[]>([])
  const [showPassword, setShowPassword] = useState(false)
  const [globalSearch, setGlobalSearch] = useState('')
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [forgotOpen, setForgotOpen] = useState(false)
  const [loginNotice, setLoginNotice] = useState('')
  const [recoveryModal, setRecoveryModal] = useState<
    'rotateRecovery' | 'enrollPin' | 'removePin' | null
  >(null)
  const [settingsTab, setSettingsTab] = useState<'general' | 'software'>('general')
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateModalOpen, setUpdateModalOpen] = useState(false)

  async function refresh(companyId = state.companyId, q = query) {
    const result = await window.diamo.state(companyId, q)
    if (result.ok) {
      setState(result.data)
      if (Array.isArray(result.data?.backupHistory)) {
        setBackupHistory(result.data.backupHistory)
      }
      setError('')
    } else {
      setError(result.error)
    }
    setLoading(false)
  }

  useEffect(() => {
    void refresh(undefined)
  }, [])

  useEffect(() => {
    if (state.authenticated) {
      void refresh(state.companyId, query)
    }
  }, [query.from, query.to, page])

  useEffect(() => {
    if (!state.authenticated) {
      setSystemInfo(null)
      setUpdateInfo(null)
      setUpdateModalOpen(false)
      setCheckingUpdate(false)
      return
    }
    let active = true
    void window.diamo.systemInfo().then((res) => {
      if (active && res.ok) setSystemInfo(res.data)
    })
    const timer = window.setTimeout(async () => {
      const res = await window.diamo.checkUpdate()
      if (!active || !res.ok) return
      setUpdateInfo(res.data)
      if (res.data.status === 'success' && res.data.updateAvailable) {
        setUpdateModalOpen(true)
      }
    }, 3000)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [state.authenticated])

  async function runManualUpdateCheck() {
    setCheckingUpdate(true)
    try {
      const res = await window.diamo.checkUpdate()
      if (res.ok) {
        setUpdateInfo(res.data)
      } else {
        setError(res.error)
      }
    } finally {
      setCheckingUpdate(false)
    }
  }

  async function openExternalUrl(url: string) {
    const res = await window.diamo.openExternal(url)
    if (!res.ok) setError(res.error)
  }

  const patch = (key: string, value: any) =>
    setForm((f) => {
      const next: Row = {
        ...f,
        [key]: value,
        _preview: null,
        _previewSignature: null,
        _opKey: crypto.randomUUID(),
      }
      if ((modal === 'purchase' || modal === 'sale') && !f._edit && key === 'partyId') {
        const p = (state.parties ?? []).find((x: Row) => x.id === Number(value))
        next.dueDays = p
          ? Number(p.credit_days ?? 0)
          : Number(state.settings?.default_credit_days ?? 0)
      }
      return next
    })

  async function executeConfirmed(
    name: Command,
    input: Row,
    close: boolean,
    opKey?: string,
  ): Promise<any> {
    setBusy(true)
    setError('')
    try {
      let result = await window.diamo.command(name, input as never, state.companyId, opKey)
      if (!result.ok && result.error.startsWith('NEGATIVE_FUNDS:')) {
        const warningText = result.error.replace(/^NEGATIVE_FUNDS:\s*/, '')
        setBusy(false)
        setConfirmState({
          title: 'Negative balance warning',
          message: `${warningText}\n\nDo you want to proceed and post this transaction with a negative cash/bank balance?`,
          confirmLabel: 'Confirm & post anyway',
          danger: true,
          onConfirm: async () => {
            setConfirmState(null)
            await executeConfirmed(
              name,
              { ...input, confirmNegative: true },
              close,
              crypto.randomUUID(),
            )
          },
        })
        return null
      }
      if (!result.ok) throw Error(result.error)
      if (close) setModal(null)
      setForm((f) => ({ ...f, _opKey: crypto.randomUUID() }))
      if (name === 'auth.logout') {
        setPage('Dashboard')
        setForm({})
        setDetail(null)
        setPartyFilter('')
        setFundFilter('')
        setNotice('')
      } else {
        setNotice('Saved successfully')
      }
      await refresh(
        name === 'companies.create' || name === 'companies.select'
          ? result.data.id
          : name === 'auth.login'
            ? result.data.companyId
            : state.companyId,
      )
      return result.data
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  async function command(name: Command, input: Row, close = true) {
    setBusy(true)
    setError('')
    try {
      if (
        (name === 'purchase.post' || name === 'sale.post') &&
        form._previewSignature !== JSON.stringify(input)
      ) {
        const previewName = form._edit
          ? 'document.previewEdit'
          : name === 'purchase.post'
            ? 'purchase.preview'
            : 'sale.preview'
        const previewInput = form._edit
          ? { kind: form._edit.kind, id: form._edit.id, reason: form.editReason, input }
          : input
        const result = await window.diamo.command(
          previewName,
          previewInput as never,
          state.companyId,
        )
        if (!result.ok) throw Error(result.error)
        setForm((f) => ({
          ...f,
          _preview: result.data,
          _previewSignature: JSON.stringify(input),
        }))
        return result.data
      }
      if (form._edit && name === form._edit.kind + '.post') {
        input = { kind: form._edit.kind, id: form._edit.id, reason: form.editReason, input }
        name = 'document.edit'
      }
      const opKey =
        modal && name !== 'stone.setStatus'
          ? (form._opKey as string | undefined) || crypto.randomUUID()
          : crypto.randomUUID()
      return await executeConfirmed(name, input, close, opKey)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  function open(kind: string, row?: Row) {
    setError('')
    setModal(kind)
    setDetail(null)
    const initial: Row = {
      _opKey: crypto.randomUUID(),
      date: today(),
      name: '',
      slipNo: '',
      remarks: '',
      reference: '',
      dueDays: Number(state.settings?.default_credit_days ?? 0),
      active: true,
      inventoryMode: 'bulk',
      roles: ['supplier'],
      creditDays: 0,
      lines: [
        {
          qualityId: '',
          carats: '',
          rate: '',
          less: '0',
          lots: [],
          stone: { ...EMPTY_STONE_SPECS },
        },
      ],
      expenses: [],
      brokerages: [],
      adjustments: [],
      direction: 'pay',
      amount: '',
      mode: 'BANK TRANSFER',
      automatic: true,
      allocations: [],
      kind: 'taken',
      principal: '',
      rate: '0',
      frequency: 'monthly',
      returnDate: '',
      narration: '',
      journalLines: [
        { accountId: '', debit: '', credit: '' },
        { accountId: '', debit: '', credit: '' },
      ],
      lots: [],
      bills: [],
      advances: [],
      loans: [],
      ...row,
    }
    if (kind === 'party' && row) {
      Object.assign(initial, { contactPerson: row.contact_person, creditDays: row.credit_days })
    }
    if (kind === 'quality' && row) {
      initial.hike = row.hike_pct
      initial.inventoryMode = row.inventory_mode ?? 'bulk'
    }
    if (kind === 'bank' && row) {
      Object.assign(initial, { name: row.bank_name, number: row.account_number })
    }
    if (kind === 'opening') initial.date = state.profile.start_date
    if (kind === 'backupOptions') {
      Object.assign(initial, {
        intervalHours: 24,
        retention: 30,
        onExit: true,
        scope: 'full',
        ...row,
      })
    }
    if (kind === 'numbering')
      Object.assign(initial, { kind: 'PUR', year: fy(today()), nextNumber: 1 })
    if (kind === 'settings') {
      Object.assign(initial, {
        ...state.profile,
        hike: state.settings.global_hike_pct,
        creditDays: state.settings.default_credit_days ?? 0,
      })
    }
    if (kind === 'settle')
      Object.assign(initial, { interest: (row?.outstanding ?? 0) / 100, close: true })
    setForm(initial)
  }

  const active = (name: string) => (state[name] ?? []).filter((r: Row) => r.active !== 0)
  const options = (name: string, label = 'name') =>
    active(name).map((r: Row) => ({ value: r.id, label: r[label] }))
  const funds = (state.accounts ?? [])
    .filter(
      (a: Row) =>
        a.active && (a.code === 'CASH' || state.banks?.some((b: Row) => b.account_id === a.id)),
    )
    .map((a: Row) => ({ value: a.id, label: a.name }))

  const f = (
    key: string,
    label: string,
    type = 'text',
    opts?: { value: any; label: string }[],
    required = false,
    uppercase?: boolean,
  ) => (
    <Field
      key={key}
      label={label}
      value={form[key]}
      onChange={(v) => patch(key, v)}
      type={type}
      options={opts}
      required={required}
      uppercase={uppercase}
    />
  )

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const n = (key: string) => Number(form[key])
      const text = (key: string) => String(form[key] ?? '')
      switch (modal) {
        case 'backupOptions':
          return void backup(form.action ?? 'configure', {
            intervalHours: Number(form.intervalHours),
            retention: Number(form.retention),
            onExit: form.onExit,
            scope: form.scope,
          })
        case 'numbering':
          return void command('settings.numbering', {
            kind: form.kind,
            year: form.year,
            nextNumber: Number(form.nextNumber),
          })
        case 'company':
          return void command('companies.create', {
            name: form.name,
            date: form.date,
            address: text('address'),
            contact: text('contact'),
          })
        case 'username':
          return void command('auth.username', {
            newUsername: form.newUsername,
            currentPassword: form.currentPassword,
          })
        case 'password':
          return void command('auth.password', {
            oldPassword: form.oldPassword,
            newPassword: form.newPassword,
          })
        case 'party':
          return void command('party.save', {
            id: form.id,
            name: form.name,
            roles: form.roles,
            contactPerson: text('contactPerson'),
            phone: text('phone'),
            email: text('email'),
            address: text('address'),
            pan: text('pan'),
            gstin: text('gstin'),
            creditDays: n('creditDays'),
            remarks: text('remarks'),
            active: form.active,
          })
        case 'quality':
          return void command('quality.save', {
            id: form.id,
            name: form.name,
            description: text('description'),
            hike: form.hike === '' || form.hike == null ? null : String(form.hike),
            inventoryMode: form.inventoryMode === 'individual' ? 'individual' : 'bulk',
            active: form.active,
          })
        case 'bank':
          return void command('bank.save', {
            id: form.id,
            name: form.name,
            holder: text('holder'),
            number: text('number'),
            ifsc: text('ifsc'),
            active: form.active,
          })
        case 'account':
          return void command('account.save', { name: form.name, kind: form.kind })
        case 'purchase':
        case 'sale':
          return void command(modal === 'purchase' ? 'purchase.post' : 'sale.post', {
            date: form.date,
            partyId: n('partyId'),
            dueDays: n('dueDays'),
            slipNo: text('slipNo'),
            remarks: text('remarks'),
            lines: form.lines.map((l: Row) => {
              const qRow = (state.qualities ?? []).find((q: Row) => q.id === Number(l.qualityId))
              const isIndividual = qRow?.inventory_mode === 'individual'
              const s = { ...EMPTY_STONE_SPECS, ...(l.stone ?? {}) }
              if (s.priceCurrency === 'USD' && (!s.exchangeRate || Number(s.exchangeRate) <= 0)) {
                throw Error('Enter a valid USD to INR exchange rate for USD-priced stones')
              }
              if (modal === 'purchase' && isIndividual) {
                return {
                  qualityId: Number(l.qualityId),
                  carats: units(l.carats),
                  rate: String(l.rate || s.rateInr),
                  less: String(l.less || '0'),
                  lots: [],
                  priceCurrency: s.priceCurrency === 'USD' ? 'USD' : 'INR',
                  exchangeRate: String(s.exchangeRate ?? ''),
                  rateUsd: String(s.rateUsd ?? ''),
                  totalUsd: String(s.totalUsd ?? ''),
                  stone: {
                    ...s,
                    srNo: String(s.srNo ?? ''),
                    availability: s.availability === 'hold' ? 'hold' : 'available',
                    unbilled: Boolean(s.unbilled),
                    growth: s.growth === 'CVD' || s.growth === 'HPHT' ? s.growth : '',
                    priceCurrency: s.priceCurrency === 'USD' ? 'USD' : 'INR',
                  },
                }
              }
              return {
                qualityId: Number(l.qualityId),
                carats: units(l.carats),
                rate: String(l.rate || s.rateInr || ''),
                less: String(l.less || '0'),
                lots: (l.lots ?? []).map((a: Row) => ({
                  lotId: Number(a.lotId),
                  carats: units(a.carats),
                })),
                priceCurrency: s.priceCurrency === 'USD' ? 'USD' : 'INR',
                exchangeRate: String(s.exchangeRate ?? ''),
                rateUsd: String(s.rateUsd ?? ''),
                totalUsd: String(s.totalUsd ?? ''),
              }
            }),
            expenses: form.expenses.map((x: Row) => ({
              ...x,
              amount: units(x.amount),
              accountId: x.mode === 'separate' ? Number(x.accountId) : null,
            })),
            brokerages: form.brokerages.map((x: Row) => ({
              brokerId: Number(x.brokerId),
              itemIndex: x.itemIndex === '' || x.itemIndex == null ? null : Number(x.itemIndex),
              mode: x.mode,
              value: String(x.value),
            })),
            adjustments: form.adjustments.map((x: Row) => ({
              ...x,
              amount: units(x.amount),
            })),
          })
        case 'payment':
          return void command('payment.post', {
            date: form.date,
            partyId: n('partyId'),
            direction: form.direction,
            accountId: n('accountId'),
            amount: units(form.amount),
            mode: form.mode,
            reference: text('reference'),
            remarks: text('remarks'),
            automatic: form.automatic,
            allocations: form.allocations.map((a: Row) => ({
              itemId: Number(a.itemId),
              amount: units(a.amount),
            })),
          })
        case 'advance':
          return void command('advance.apply', {
            advanceId: n('advanceId'),
            itemId: n('itemId'),
            amount: units(form.amount),
            date: form.date,
          })
        case 'loan':
          return void command('loan.post', {
            date: form.date,
            partyId: n('partyId'),
            kind: form.kind,
            principal: units(form.principal),
            rate: text('rate'),
            frequency: form.frequency,
            returnDate: form.returnDate || null,
            accountId: n('accountId'),
            remarks: text('remarks'),
          })
        case 'settle':
          return void command('loan.settle', {
            id: form.id,
            date: form.date,
            accountId: n('accountId'),
            interest: units(form.interest),
            close: form.close,
          })
        case 'journal':
          return void command('journal.post', {
            date: form.date,
            reference: text('reference'),
            narration: form.narration,
            lines: form.journalLines.map((l: Row) => ({
              accountId: Number(l.accountId),
              debit: units(l.debit || 0),
              credit: units(l.credit || 0),
            })),
          })
        case 'transfer':
          return void command('transfer.post', {
            date: form.date,
            source: n('source'),
            destination: n('destination'),
            amount: units(form.amount),
          })
        case 'settings':
          return void command('settings.save', {
            name: form.name,
            address: text('address'),
            contact: text('contact'),
            hike: text('hike'),
            creditDays: n('creditDays'),
          })
        case 'opening':
          return void command('opening.post', {
            date: form.date,
            lines: form.journalLines
              .filter((l: Row) => l.accountId)
              .map((l: Row) => ({
                accountId: Number(l.accountId),
                debit: units(l.debit || 0),
                credit: units(l.credit || 0),
              })),
            lots: form.lots.map((l: Row) => ({
              qualityId: Number(l.qualityId),
              date: l.date,
              carats: units(l.carats),
              cost: units(l.cost),
            })),
            bills: form.bills.map((l: Row) => ({
              ...l,
              partyId: Number(l.partyId),
              amount: units(l.amount),
            })),
            advances: form.advances.map((l: Row) => ({
              ...l,
              partyId: Number(l.partyId),
              amount: units(l.amount),
            })),
            loans: form.loans.map((l: Row) => ({
              ...l,
              partyId: Number(l.partyId),
              principal: units(l.principal),
              paidInterest: units(l.paidInterest),
              accruedInterest: units(l.accruedInterest),
            })),
          })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function requestCancel(kind: string, row: Row) {
    setConfirmState({
      title: `Cancel ${kind} ${row.number ?? ''}`.trim(),
      message: `This will reverse all accounting, stock, and settlement effects on the original effective date (${displayDate(row.bill_date ?? row.payment_date ?? row.loan_date ?? row.entry_date ?? row.transfer_date)}). Cancelled numbers are never reused.`,
      confirmLabel: 'Cancel document',
      danger: true,
      requireReason: true,
      reasonLabel: 'Reason for cancellation *',
      reasonPlaceholder: 'Enter reason for audit log…',
      onConfirm: async (reason) => {
        setConfirmState(null)
        await executeConfirmed('document.cancel', { kind, id: row.id, reason }, false)
      },
    })
  }

  function requestReverseSettlement(row: Row) {
    setConfirmState({
      title: `Reverse latest settlement on ${row.number}`,
      message: `This will reverse the most recent interest payment or full closure for ${row.party} and reopen the loan if closed.`,
      confirmLabel: 'Reverse settlement',
      danger: true,
      requireReason: true,
      reasonLabel: 'Reason for reversal *',
      onConfirm: async (reason) => {
        setConfirmState(null)
        await executeConfirmed('loan.reverseSettlement', { id: row.id, reason }, false)
      },
    })
  }

  function requestReverseAdvance(row: Row) {
    setConfirmState({
      title: `Reverse advance application (${row.reference})`,
      message: `This will restore ${money(row.amount)} back to ${row.party}'s available advance and reopen the bill outstanding balance.`,
      confirmLabel: 'Reverse application',
      danger: true,
      requireReason: true,
      reasonLabel: 'Reason for reversal *',
      onConfirm: async (reason) => {
        setConfirmState(null)
        await executeConfirmed('advance.reverse', { id: row.id, reason }, false)
      },
    })
  }

  async function backup(
    action: 'create' | 'configure' | 'restore' | 'history',
    options?: {
      intervalHours: number
      retention: number
      onExit: boolean
      scope: 'full' | 'company'
    },
  ) {
    setBusy(true)
    const result = await window.diamo.backup(action, options)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
    } else if (action === 'history') {
      setBackupHistory(result.data)
    } else if (result.data) {
      setNotice(
        action === 'restore' ? 'Backup restored. Please sign in.' : 'Backup completed successfully',
      )
      setModal(null)
      await refresh(action === 'restore' && !result.data.individual ? undefined : state.companyId)
    }
  }

  function edit(kind: string, r: Row) {
    open(kind, r)
    const values: Row = {
      _edit: { kind, id: r.id },
      editReason: '',
      date: r.bill_date ?? r.payment_date ?? r.loan_date ?? r.entry_date ?? r.transfer_date,
      partyId: r.party_id,
      dueDays: r.due_days,
      accountId: r.fund_account_id,
    }
    if (kind === 'purchase' || kind === 'sale') {
      values.slipNo = r.slip_no ?? ''
      values.remarks = r.remarks ?? ''
      values.lines = r.items.map((l: Row) => ({
        qualityId: l.quality_id,
        carats: l.carats / 100,
        rate: l.rate,
        less: l.less_pct,
        lots: (l.lots ?? [])
          .filter((a: Row) => a.mode === 'manual')
          .map((a: Row) => ({ lotId: a.lot_id, carats: a.carats / 100 })),
        stoneLotId: l.lots?.[0]?.lot_id ?? '',
        stone: hydrateStoneForEdit(l),
      }))
      values.expenses = (r.expenses ?? []).map((a: Row) => ({
        ...a,
        amount: a.amount / 100,
        accountId: a.fund_account_id,
      }))
      values.brokerages = (r.brokerages ?? []).map((a: Row) => ({
        brokerId: a.broker_id,
        itemIndex: a.item_id ? r.items.findIndex((l: Row) => l.id === a.item_id) : '',
        mode: a.mode,
        value: a.input_value,
      }))
      values.adjustments = (r.adjustments ?? []).map((a: Row) => ({
        ...a,
        amount: a.amount / 100,
      }))
    }
    if (kind === 'payment') {
      values.amount = r.amount / 100
      values.automatic = false
      values.allocations = r.allocations
        .filter((a: Row) => a.active)
        .map((a: Row) => ({ itemId: a.open_item_id, amount: a.amount / 100 }))
    }
    if (kind === 'loan') {
      values.principal = r.principal / 100
      values.returnDate = r.return_date ?? ''
    }
    if (kind === 'journal') {
      values.journalLines = r.lines.map((l: Row) => ({
        accountId: l.account_id,
        debit: l.debit / 100,
        credit: l.credit / 100,
      }))
    }
    if (kind === 'transfer') {
      Object.assign(values, {
        source: r.source_account,
        destination: r.destination_account,
        amount: r.amount / 100,
      })
    }
    setForm((f) => ({ ...f, ...values }))
  }

  function startSaleForStone(stone: Row) {
    setPage('Sale')
    open('sale', {
      lines: [
        {
          qualityId: stone.quality_id,
          carats: stone.carats / 100,
          rate: '',
          less: '0',
          lots: [{ lotId: stone.lot_id, carats: stone.carats / 100 }],
          stoneLotId: stone.lot_id,
          stone: { ...EMPTY_STONE_SPECS },
        },
      ],
    })
  }

  const actions = (kind: string) => (r: Row) => (
    <>
      <button
        type="button"
        onClick={() => {
          setDetail({ ...r, _kind: kind })
          setModal('detail')
        }}
      >
        View
      </button>
      {r.status !== 'cancelled' && !r.reversed && (
        <button type="button" onClick={() => edit(kind, r)}>
          Edit
        </button>
      )}
      {r.status !== 'cancelled' && !r.reversed && (
        <button type="button" className="danger-text" onClick={() => requestCancel(kind, r)}>
          Cancel
        </button>
      )}
    </>
  )

  if (loading) return <div className="loading">Loading your workspace…</div>

  if (!state.authenticated) {
    return (
      <main className="login">
        <div className="login-brand">
          <img src={logo} alt="DIAMO logo" />
          <strong>DIAMO</strong>
        </div>
        <form
          className="login-card"
          onSubmit={async (e) => {
            e.preventDefault()
            await command('auth.login', {
              email: form.email ?? '',
              password: form.password ?? '',
            })
          }}
        >
          <h1>Welcome back</h1>
          <p>Sign in to your account</p>
          {loginNotice && (
            <div className="success banner" role="status">
              <CheckCircle2 size={17} />
              {loginNotice}
            </div>
          )}
          {f('email', 'Username', 'text', undefined, true, false)}
          <div className="password-field">
            {f('password', 'Password', showPassword ? 'text' : 'password', undefined, true, false)}
            <button
              type="button"
              aria-label="Toggle password visibility"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <button
            type="button"
            className="forgot-link"
            onClick={() => {
              setError('')
              setLoginNotice('')
              setForgotOpen(true)
            }}
          >
            Forgot password?
          </button>
        </form>
        <footer>
          DIAMO v1.0.0 <b>·</b> Offline Mode <b>·</b> Local Data Storage
        </footer>
        {forgotOpen && (
          <ForgotPasswordDrawer
            initialStatus={state.recoveryStatus}
            close={() => setForgotOpen(false)}
            onResetSuccess={(msg) => {
              setForm({})
              setError('')
              setLoginNotice(msg)
              void refresh(undefined)
            }}
          />
        )}
      </main>
    )
  }

  const journalEditor = (
    <ListEditor
      title="Ledger entries"
      items={form.journalLines ?? []}
      setItems={(v) => patch('journalLines', v)}
      empty={{ accountId: '', debit: '', credit: '' }}
    >
      {(r, u) => (
        <>
          <Field
            label="Account"
            value={r.accountId}
            onChange={(v) => u('accountId', v)}
            options={options('accounts')}
            required
          />
          <Field label="Debit ₹" value={r.debit} onChange={(v) => u('debit', v)} type="number" />
          <Field label="Credit ₹" value={r.credit} onChange={(v) => u('credit', v)} type="number" />
        </>
      )}
    </ListEditor>
  )

  const formContent = () => {
    switch (modal) {
      case 'backupOptions':
        return (
          <>
            <div className="form-grid">
              {f(
                'scope',
                'Backup scope',
                'text',
                [
                  { value: 'full', label: 'All companies and administrator' },
                  { value: 'company', label: 'Current company only' },
                ],
                true,
              )}
              {f('intervalHours', 'Automatic interval (hours)', 'number', undefined, true)}
              {f('retention', 'Backups to retain', 'number', undefined, true)}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={form.onExit}
                onChange={(e) => patch('onExit', e.target.checked)}
              />
              Also back up on exit
            </label>
            <p className="muted">
              Choose a destination folder after saving. Individual backups restore as a separate
              company.
            </p>
          </>
        )
      case 'numbering':
        return (
          <div className="form-grid">
            {f(
              'kind',
              'Document type',
              'text',
              ['PUR', 'SAL', 'PAY', 'REC', 'LT', 'LG', 'JV', 'TRF'].map((v) => ({
                value: v,
                label: v,
              })),
              true,
            )}
            {f('year', 'Financial year (YYYY-YY)', 'text', undefined, true)}
            {f('nextNumber', 'Next number (forward only)', 'number', undefined, true)}
          </div>
        )
      case 'company':
        return (
          <div className="form-grid">
            {f('name', 'Company name', 'text', undefined, true)}
            {f('date', 'Opening date', 'date', undefined, true)}
            {f('address', 'Address')}
            {f('contact', 'Contact')}
          </div>
        )
      case 'username':
        return (
          <>
            <p className="muted">
              Enter your new login username (or email) and confirm with your current password.
            </p>
            <div className="form-grid">
              {f('newUsername', 'New username', 'text', undefined, true, false)}
              {f('currentPassword', 'Current password', 'password', undefined, true)}
            </div>
          </>
        )
      case 'password':
        return (
          <>
            <p className="muted">
              Use at least 6 characters. Your password is stored locally as a secure hash.
            </p>
            <div className="form-grid">
              {f('oldPassword', 'Current password', 'password', undefined, true)}
              {f('newPassword', 'New password', 'password', undefined, true)}
            </div>
          </>
        )
      case 'party':
        return (
          <>
            <div className="form-grid">
              {f('name', 'Party name', 'text', undefined, true)}
              {f('contactPerson', 'Contact person')}
              {f('phone', 'Phone')}
              {f('email', 'Email', 'email')}
              {f('address', 'Address')}
              {f('creditDays', 'Credit days', 'number')}
              {f('pan', 'PAN (informational)')}
              {f('gstin', 'GSTIN (informational)')}
            </div>
            <div className="checks">
              {['supplier', 'customer', 'broker', 'other'].map((role) => (
                <label key={role}>
                  <input
                    type="checkbox"
                    checked={form.roles.includes(role)}
                    onChange={(e) =>
                      patch(
                        'roles',
                        e.target.checked
                          ? [...form.roles, role]
                          : form.roles.filter((r: string) => r !== role),
                      )
                    }
                  />
                  {role}
                </label>
              ))}
            </div>
            {f('remarks', 'Remarks', 'textarea')}
            <label className="check">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => patch('active', e.target.checked)}
              />
              Active party
            </label>
          </>
        )
      case 'quality':
        return (
          <>
            <div className="form-grid">
              {f('name', 'Quality name', 'text', undefined, true)}
              {f(
                'inventoryMode',
                'Inventory type',
                'text',
                [
                  { value: 'bulk', label: 'Standard (Carats / Lots)' },
                  { value: 'individual', label: 'Individual Stone (e.g. IGI Certified)' },
                ],
                true,
              )}
              {f('hike', 'Hike override % (blank uses company default)', 'number')}
              {f('description', 'Description')}
            </div>
            <p className="muted">
              Standard qualities track weight by bulk lots. Individual Stone qualities record
              piece-level specs, certificates, and USD/INR pricing per diamond.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => patch('active', e.target.checked)}
              />
              Active quality
            </label>
          </>
        )
      case 'bank':
        return (
          <>
            <div className="form-grid">
              {f('name', 'Bank name', 'text', undefined, true)}
              {f('holder', 'Account holder')}
              {f('number', 'Account number')}
              {f('ifsc', 'IFSC')}
            </div>
            <p className="muted">Enter initial balances through the balanced opening wizard.</p>
            <label className="check">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => patch('active', e.target.checked)}
              />
              Active account
            </label>
          </>
        )
      case 'account':
        return (
          <div className="form-grid">
            {f('name', 'Ledger name', 'text', undefined, true)}
            {f(
              'kind',
              'Account type',
              'text',
              ['asset', 'liability', 'equity', 'income', 'expense'].map((v) => ({
                value: v,
                label: v,
              })),
              true,
            )}
          </div>
        )
      case 'purchase':
      case 'sale':
        return (
          <>
            <div className="form-grid">
              {f('date', 'Invoice date', 'date', undefined, true)}
              {f(
                'partyId',
                modal === 'purchase' ? 'Supplier' : 'Customer',
                'text',
                active('parties')
                  .filter((p: Row) =>
                    p.roles.includes(modal === 'purchase' ? 'supplier' : 'customer'),
                  )
                  .map((p: Row) => ({ value: p.id, label: p.name })),
                true,
              )}
              {f('dueDays', 'Due days', 'number')}
              {f('slipNo', 'Slip no.')}
              {f('remarks', 'Remarks')}
            </div>
            <ListEditor
              title="Diamond lines"
              items={form.lines}
              setItems={(v) =>
                patch(
                  'lines',
                  modal === 'purchase' ? assignAutoSrToLines(v, state.qualities ?? []) : v,
                )
              }
              empty={{
                qualityId: '',
                carats: '',
                rate: '',
                less: '0',
                lots: [],
                stoneLotId: '',
                stone: { ...EMPTY_STONE_SPECS },
              }}
            >
              {(r, u, i) => {
                const lineQuality = (state.qualities ?? []).find(
                  (q: Row) => q.id === Number(r.qualityId),
                )
                const isIndividual = lineQuality?.inventory_mode === 'individual'

                if (modal === 'purchase' && isIndividual) {
                  return (
                    <PurchaseStoneLineEditor
                      index={i}
                      line={r}
                      qualities={options('qualities')}
                      onReplaceLine={(nextLine) =>
                        patch(
                          'lines',
                          form.lines.map((row: Row, idx: number) => (idx === i ? nextLine : row)),
                        )
                      }
                      onChangeQuality={(v) =>
                        patch(
                          'lines',
                          assignAutoSrToLines(
                            form.lines.map((row: Row, idx: number) =>
                              idx === i ? { ...row, qualityId: v } : row,
                            ),
                            state.qualities ?? [],
                          ),
                        )
                      }
                      onOpenExternal={(url) => void openExternalUrl(url)}
                    />
                  )
                }

                if (modal === 'sale' && isIndividual) {
                  const chosenLotIds = new Set(
                    form.lines
                      .filter((_: Row, idx: number) => idx !== i)
                      .map((row: Row) => Number(row.stoneLotId || row.lots?.[0]?.lotId || 0))
                      .filter(Boolean),
                  )
                  const availableStones = (state.stones ?? []).filter(
                    (s: Row) =>
                      s.quality_id === Number(r.qualityId) &&
                      (s.availability === 'available' || s.availability === 'hold') &&
                      (!form.date || s.acquired_date <= form.date) &&
                      !chosenLotIds.has(s.lot_id),
                  )
                  const selectedLotId = Number(r.stoneLotId || r.lots?.[0]?.lotId || 0) || ''
                  return (
                    <SaleStoneLineEditor
                      index={i}
                      line={r}
                      qualities={options('qualities')}
                      availableStones={availableStones}
                      selectedLotId={selectedLotId}
                      onSelectQuality={(v) =>
                        patch(
                          'lines',
                          form.lines.map((row: Row, idx: number) =>
                            idx === i
                              ? {
                                  ...row,
                                  qualityId: v,
                                  carats: '',
                                  lots: [],
                                  stoneLotId: '',
                                  rate: '',
                                  stone: { ...EMPTY_STONE_SPECS },
                                }
                              : row,
                          ),
                        )
                      }
                      onSelectStone={(v) => {
                        const picked = availableStones.find((s: Row) => s.lot_id === Number(v))
                        patch(
                          'lines',
                          form.lines.map((row: Row, idx: number) =>
                            idx === i
                              ? {
                                  ...row,
                                  stoneLotId: picked ? picked.lot_id : '',
                                  carats: picked ? picked.carats / 100 : '',
                                  lots: picked
                                    ? [{ lotId: picked.lot_id, carats: picked.carats / 100 }]
                                    : [],
                                }
                              : row,
                          ),
                        )
                      }}
                      onReplaceLine={(nextLine) =>
                        patch(
                          'lines',
                          form.lines.map((row: Row, idx: number) => (idx === i ? nextLine : row)),
                        )
                      }
                    />
                  )
                }

                return (
                  <>
                    <Field
                      label="Quality"
                      value={r.qualityId}
                      onChange={(v) => {
                        if (modal === 'purchase') {
                          patch(
                            'lines',
                            assignAutoSrToLines(
                              form.lines.map((row: Row, idx: number) =>
                                idx === i ? { ...row, qualityId: v } : row,
                              ),
                              state.qualities ?? [],
                            ),
                          )
                          return
                        }
                        u('qualityId', v)
                      }}
                      options={options('qualities')}
                      required
                    />
                    <Field
                      label="Carats"
                      value={r.carats}
                      onChange={(v) => u('carats', v)}
                      type="number"
                      required
                    />
                    <Field
                      label="Rate ₹ / ct"
                      value={r.rate}
                      onChange={(v) => u('rate', v)}
                      type="number"
                      step="any"
                      required
                    />
                    <Field
                      label="Less %"
                      value={r.less}
                      onChange={(v) => u('less', v)}
                      type="number"
                      step="any"
                    />
                    {modal === 'sale' && (
                      <div className="lot-editor">
                        <small>
                          Available:{' '}
                          {ct(
                            state.inventory?.find((q: Row) => q.id === Number(r.qualityId))
                              ?.carats ?? 0,
                          )}{' '}
                          ct · Leave manual lots empty for FIFO
                        </small>
                        <ListEditor
                          title={`Manual lots for line ${i + 1}`}
                          items={r.lots ?? []}
                          setItems={(v) => u('lots', v)}
                          empty={{ lotId: '', carats: '' }}
                        >
                          {(a, update) => (
                            <>
                              <Field
                                label="Lot"
                                value={a.lotId}
                                onChange={(v) => update('lotId', v)}
                                options={(state.lots ?? [])
                                  .filter(
                                    (l: Row) =>
                                      l.quality_id === Number(r.qualityId) &&
                                      l.available > 0 &&
                                      (!form.date || l.acquired_date <= form.date),
                                  )
                                  .map((l: Row) => ({
                                    value: l.id,
                                    label: `Lot ${l.id} · ${ct(l.available)} ct · ${displayDate(l.acquired_date)}`,
                                  }))}
                              />
                              <Field
                                label="Carats"
                                type="number"
                                value={a.carats}
                                onChange={(v) => update('carats', v)}
                              />
                            </>
                          )}
                        </ListEditor>
                      </div>
                    )}
                  </>
                )
              }}
            </ListEditor>
            {modal === 'purchase' ? (
              <ListEditor
                title="Purchase expenses"
                items={form.expenses}
                setItems={(v) => patch('expenses', v)}
                empty={{ description: '', amount: '', mode: 'supplier', accountId: '' }}
              >
                {(r, u) => (
                  <>
                    <Field
                      label="Description"
                      value={r.description}
                      onChange={(v) => u('description', v)}
                      required
                    />
                    <Field
                      label="Amount ₹"
                      value={r.amount}
                      onChange={(v) => u('amount', v)}
                      type="number"
                      required
                    />
                    <Field
                      label="Paid by"
                      value={r.mode}
                      onChange={(v) => u('mode', v)}
                      options={[
                        { value: 'supplier', label: 'Supplier billed' },
                        { value: 'separate', label: 'Separate cash / bank' },
                      ]}
                    />
                    {r.mode === 'separate' && (
                      <Field
                        label="Funds account"
                        value={r.accountId}
                        onChange={(v) => u('accountId', v)}
                        options={funds}
                        required
                      />
                    )}
                  </>
                )}
              </ListEditor>
            ) : (
              <>
                <ListEditor
                  title="Brokerage"
                  items={form.brokerages}
                  setItems={(v) => patch('brokerages', v)}
                  empty={{ brokerId: '', itemIndex: '', mode: 'percent', value: '' }}
                >
                  {(r, u) => (
                    <>
                      <Field
                        label="Broker"
                        value={r.brokerId}
                        onChange={(v) => u('brokerId', v)}
                        options={active('parties')
                          .filter((p: Row) => p.roles.includes('broker'))
                          .map((p: Row) => ({ value: p.id, label: p.name }))}
                        required
                      />
                      <Field
                        label="Scope (blank = invoice)"
                        value={r.itemIndex}
                        onChange={(v) => u('itemIndex', v)}
                        options={form.lines.map((_: Row, i: number) => ({
                          value: i,
                          label: `Line ${i + 1}`,
                        }))}
                      />
                      <Field
                        label="Mode"
                        value={r.mode}
                        onChange={(v) => u('mode', v)}
                        options={[
                          { value: 'percent', label: 'Percentage' },
                          { value: 'fixed', label: 'Fixed INR' },
                        ]}
                      />
                      <Field
                        label="Value"
                        value={r.value}
                        onChange={(v) => u('value', v)}
                        type="number"
                        required
                      />
                    </>
                  )}
                </ListEditor>
                <ListEditor
                  title="Invoice adjustments"
                  items={form.adjustments}
                  setItems={(v) => patch('adjustments', v)}
                  empty={{ description: '', amount: '' }}
                >
                  {(r, u) => (
                    <>
                      <Field
                        label="Description"
                        value={r.description}
                        onChange={(v) => u('description', v)}
                        required
                      />
                      <Field
                        label="Signed amount ₹ (+ / −)"
                        value={r.amount}
                        onChange={(v) => u('amount', v)}
                        type="number"
                        required
                      />
                    </>
                  )}
                </ListEditor>
              </>
            )}
            {(() => {
              const liveTotals = summarizeLinesCurrency(form.lines ?? [])
              return (
                <div className="preview-bar">
                  <span>After-less line total</span>
                  <CurrencyAmount
                    currency={liveTotals.currency}
                    inrPaise={liveTotals.inrPaise}
                    usdAmount={liveTotals.usdAmount}
                    exchangeRate={liveTotals.exchangeRate}
                    size="lg"
                  />
                  <small>
                    Final amounts are validated and calculated by the accounting engine.
                  </small>
                </div>
              )
            })()}
          </>
        )
      case 'payment':
        return (
          <>
            <div className="form-grid">
              {f('date', 'Payment date', 'date', undefined, true)}
              {f(
                'direction',
                'Direction',
                'text',
                [
                  { value: 'pay', label: 'Pay' },
                  { value: 'receive', label: 'Receive' },
                ],
                true,
              )}
              {f('partyId', 'Party', 'text', options('parties'), true)}
              {f('accountId', 'Cash / bank account', 'text', funds, true)}
              {f('amount', 'Amount ₹', 'number', undefined, true)}
              {f('mode', 'Payment mode', 'text', undefined, true)}
              {f('reference', 'Reference')}
              {f('remarks', 'Remarks')}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={form.automatic}
                onChange={(e) => patch('automatic', e.target.checked)}
              />
              Allocate oldest invoices first; excess becomes an advance
            </label>
            {!form.automatic && (
              <ListEditor
                title="Bill allocations"
                items={form.allocations}
                setItems={(v) => patch('allocations', v)}
                empty={{ itemId: '', amount: '' }}
              >
                {(r, u) => (
                  <>
                    <Field
                      label="Outstanding bill"
                      value={r.itemId}
                      onChange={(v) => u('itemId', v)}
                      options={(state.openItems ?? [])
                        .filter(
                          (o: Row) =>
                            o.party_id === Number(form.partyId) &&
                            o.outstanding > 0 &&
                            ['sale', 'opening_receivable'].includes(o.kind) ===
                              (form.direction === 'receive'),
                        )
                        .map((o: Row) => ({
                          value: o.id,
                          label: `${o.reference} · ${money(o.outstanding)}`,
                        }))}
                      required
                    />
                    <Field
                      label="Allocate ₹"
                      value={r.amount}
                      onChange={(v) => u('amount', v)}
                      type="number"
                      required
                    />
                  </>
                )}
              </ListEditor>
            )}
          </>
        )
      case 'advance':
        return (
          <div className="form-grid">
            {f('date', 'Application date', 'date', undefined, true)}
            {f(
              'advanceId',
              'Available advance',
              'text',
              (state.advances ?? [])
                .filter((a: Row) => a.remaining > 0)
                .map((a: Row) => ({
                  value: a.id,
                  label: `${a.party} · ${a.direction} · ${money(a.remaining)}`,
                })),
              true,
            )}
            {f(
              'itemId',
              'Outstanding bill',
              'text',
              (state.openItems ?? [])
                .filter((a: Row) => a.outstanding > 0)
                .map((a: Row) => ({
                  value: a.id,
                  label: `${a.party} · ${a.reference} · ${money(a.outstanding)}`,
                })),
              true,
            )}
            {f('amount', 'Apply ₹', 'number', undefined, true)}
          </div>
        )
      case 'loan':
        return (
          <div className="form-grid">
            {f(
              'kind',
              'Loan direction',
              'text',
              [
                { value: 'taken', label: 'Loan taken' },
                { value: 'given', label: 'Loan given' },
              ],
              true,
            )}
            {f('partyId', 'Party', 'text', options('parties'), true)}
            {f('principal', 'Principal ₹', 'number', undefined, true)}
            {f('rate', 'Interest rate %', 'number', undefined, true)}
            {f(
              'frequency',
              'Interest basis',
              'text',
              [
                { value: 'monthly', label: 'Monthly (30 days)' },
                { value: 'yearly', label: 'Yearly (365 days)' },
              ],
              true,
            )}
            {f('date', 'Loan date', 'date', undefined, true)}
            {f('returnDate', 'Expected return date (optional)', 'date')}
            {f('accountId', 'Cash / bank account', 'text', funds, true)}
            {f('remarks', 'Remarks')}
          </div>
        )
      case 'settle':
        return (
          <>
            <div className="form-grid">
              {f('date', 'Payment / settlement date', 'date', undefined, true)}
              {f('accountId', 'Cash / bank account', 'text', funds, true)}
              {f('interest', 'Interest payment ₹', 'number', undefined, true)}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={form.close}
                onChange={(e) => patch('close', e.target.checked)}
              />
              Fully repay principal of {money(form.principal ?? 0)} and close loan
            </label>
            <p className="muted">
              Uncheck for interest-only payment. Partial principal repayment is not supported.
              Interest must match the selected settlement date.
            </p>
          </>
        )
      case 'journal':
        return (
          <>
            <div className="form-grid">
              {f('date', 'Voucher date', 'date', undefined, true)}
              {f('reference', 'Reference')}
              {f('narration', 'Narration', 'text', undefined, true)}
            </div>
            {journalEditor}
            <p className="muted">
              Controlled stock, invoice and loan accounts must use their own workflows.
            </p>
          </>
        )
      case 'transfer':
        return (
          <div className="form-grid">
            {f('date', 'Transfer date', 'date', undefined, true)}
            {f('source', 'From account', 'text', funds, true)}
            {f('destination', 'To account', 'text', funds, true)}
            {f('amount', 'Transfer amount ₹', 'number', undefined, true)}
          </div>
        )
      case 'settings':
        return (
          <div className="form-grid">
            {f('name', 'Company name', 'text', undefined, true)}
            {f('address', 'Address')}
            {f('contact', 'Contact')}
            {f('hike', 'Default stock hike %', 'number', undefined, true)}
            {f('creditDays', 'Default credit days', 'number')}
          </div>
        )
      case 'opening':
        return (
          <>
            <p className="info">
              Opening balances must balance exactly. Create parties, qualities and bank accounts
              first. Enter capital and other balances in ledger entries; subledger sections generate
              their control entries automatically.
            </p>
            {f('date', 'Opening date', 'date', undefined, true)}
            {journalEditor}
            <ListEditor
              title="Opening stock"
              items={form.lots}
              setItems={(v) => patch('lots', v)}
              empty={{ qualityId: '', date: form.date, carats: '', cost: '' }}
            >
              {(r, u) => (
                <>
                  <Field
                    label="Quality"
                    value={r.qualityId}
                    onChange={(v) => u('qualityId', v)}
                    options={options('qualities')}
                    required
                  />
                  <Field
                    label="Acquisition date"
                    type="date"
                    value={r.date}
                    onChange={(v) => u('date', v)}
                    required
                  />
                  <Field
                    label="Carats"
                    type="number"
                    value={r.carats}
                    onChange={(v) => u('carats', v)}
                    required
                  />
                  <Field
                    label="Total cost ₹"
                    type="number"
                    value={r.cost}
                    onChange={(v) => u('cost', v)}
                    required
                  />
                </>
              )}
            </ListEditor>
            <ListEditor
              title="Opening bills"
              items={form.bills}
              setItems={(v) => patch('bills', v)}
              empty={{
                partyId: '',
                direction: 'pay',
                amount: '',
                reference: '',
                date: form.date,
                dueDate: form.date,
              }}
            >
              {(r, u) => (
                <>
                  <Field
                    label="Party"
                    value={r.partyId}
                    onChange={(v) => u('partyId', v)}
                    options={options('parties')}
                    required
                  />
                  <Field
                    label="Direction"
                    value={r.direction}
                    onChange={(v) => u('direction', v)}
                    options={[
                      { value: 'pay', label: 'Payable' },
                      { value: 'receive', label: 'Receivable' },
                    ]}
                  />
                  <Field
                    label="Amount ₹"
                    type="number"
                    value={r.amount}
                    onChange={(v) => u('amount', v)}
                    required
                  />
                  <Field
                    label="Reference"
                    value={r.reference}
                    onChange={(v) => u('reference', v)}
                    required
                  />
                  <Field
                    label="Bill date"
                    type="date"
                    value={r.date}
                    onChange={(v) => u('date', v)}
                    required
                  />
                  <Field
                    label="Due date"
                    type="date"
                    value={r.dueDate}
                    onChange={(v) => u('dueDate', v)}
                    required
                  />
                </>
              )}
            </ListEditor>
            <ListEditor
              title="Opening advances"
              items={form.advances}
              setItems={(v) => patch('advances', v)}
              empty={{ partyId: '', direction: 'paid', amount: '' }}
            >
              {(r, u) => (
                <>
                  <Field
                    label="Party"
                    value={r.partyId}
                    onChange={(v) => u('partyId', v)}
                    options={options('parties')}
                    required
                  />
                  <Field
                    label="Direction"
                    value={r.direction}
                    onChange={(v) => u('direction', v)}
                    options={[
                      { value: 'paid', label: 'Paid advance' },
                      { value: 'received', label: 'Received advance' },
                    ]}
                  />
                  <Field
                    label="Amount ₹"
                    type="number"
                    value={r.amount}
                    onChange={(v) => u('amount', v)}
                    required
                  />
                </>
              )}
            </ListEditor>
            <ListEditor
              title="Opening loans"
              items={form.loans}
              setItems={(v) => patch('loans', v)}
              empty={{
                partyId: '',
                kind: 'taken',
                principal: '',
                rate: '0',
                frequency: 'monthly',
                date: form.date,
                paidInterest: '0',
                accruedInterest: '0',
              }}
            >
              {(r, u) => (
                <>
                  <Field
                    label="Party"
                    value={r.partyId}
                    onChange={(v) => u('partyId', v)}
                    options={options('parties')}
                    required
                  />
                  <Field
                    label="Kind"
                    value={r.kind}
                    onChange={(v) => u('kind', v)}
                    options={[
                      { value: 'taken', label: 'Taken' },
                      { value: 'given', label: 'Given' },
                    ]}
                  />
                  <Field
                    label="Principal ₹"
                    type="number"
                    value={r.principal}
                    onChange={(v) => u('principal', v)}
                    required
                  />
                  <Field
                    label="Original start date"
                    type="date"
                    value={r.date}
                    onChange={(v) => u('date', v)}
                    required
                  />
                  <Field
                    label="Rate %"
                    type="number"
                    value={r.rate}
                    onChange={(v) => u('rate', v)}
                  />
                  <Field
                    label="Basis"
                    value={r.frequency}
                    onChange={(v) => u('frequency', v)}
                    options={[
                      { value: 'monthly', label: 'Monthly' },
                      { value: 'yearly', label: 'Yearly' },
                    ]}
                  />
                  <Field
                    label="Previously paid interest ₹"
                    type="number"
                    value={r.paidInterest}
                    onChange={(v) => u('paidInterest', v)}
                  />
                  <Field
                    label="Unpaid accrued interest ₹"
                    type="number"
                    value={r.accruedInterest}
                    onChange={(v) => u('accruedInterest', v)}
                  />
                </>
              )}
            </ListEditor>
          </>
        )
      default:
        return null
    }
  }

  const summary = (title: string, value: ReactNode, subtitle: string, icon: ReactNode) => (
    <div className="metric">
      <div>
        <span>{title}</span>
        <div className="metric-icon">{icon}</div>
      </div>
      <strong>{value}</strong>
      <small>{subtitle}</small>
    </div>
  )

  const table = (
    title: string,
    rows: Row[],
    columns: any[],
    action?: (r: Row) => ReactNode,
    showTotals = true,
  ) => (
    <DataTable
      key={title}
      title={title}
      rows={rows}
      columns={columns}
      action={action}
      showTotals={showTotals}
    />
  )

  const ledgerTable = (rows: Row[], title: string) => {
    let balance = rows
      .filter((r) => r.date < query.from)
      .reduce((s, r) => s + r.debit - r.credit, 0)
    const opening = balance
    const data = rows
      .filter((r) => r.date >= query.from)
      .map((r) => ({ ...r, running: (balance += r.debit - r.credit) }))
    return (
      <>
        <div className="reconciliation">
          <span>
            Opening <b>{money(opening)}</b>
          </span>
          <span>
            Closing <b>{money(balance)}</b>
          </span>
        </div>
        {table(title, data, [
          col('date', 'Date', displayDate),
          col('number', 'Reference'),
          col('account', 'Account'),
          col('narration', 'Particulars'),
          col('debit', 'Debit', money),
          col('credit', 'Credit', money),
          col('running', 'Running balance', money),
        ])}
      </>
    )
  }

  const openDues = (state.openItems ?? []).filter((o: Row) => o.outstanding > 0)
  const buildAgeing = (items: Row[]) =>
    [
      { label: 'Not due', filter: (o: Row) => !o.due_date || o.due_date >= query.to },
      {
        label: '1–30 days',
        filter: (o: Row) =>
          o.due_date && days(o.due_date, query.to) >= 1 && days(o.due_date, query.to) <= 30,
      },
      {
        label: '31–60 days',
        filter: (o: Row) =>
          o.due_date && days(o.due_date, query.to) >= 31 && days(o.due_date, query.to) <= 60,
      },
      {
        label: '61–90 days',
        filter: (o: Row) =>
          o.due_date && days(o.due_date, query.to) >= 61 && days(o.due_date, query.to) <= 90,
      },
      {
        label: '90+ days',
        filter: (o: Row) => o.due_date && days(o.due_date, query.to) > 90,
      },
    ].map((b) => ({
      label: b.label,
      amount: items.filter(b.filter).reduce((s: number, o: Row) => s + o.outstanding, 0),
      count: items.filter(b.filter).length,
    }))
  const receivableAgeing = buildAgeing(
    openDues.filter((o: Row) => ['sale', 'opening_receivable'].includes(o.kind)),
  )
  const payableAgeing = buildAgeing(
    openDues.filter((o: Row) => !['sale', 'opening_receivable'].includes(o.kind)),
  )

  const content = () => {
    if (!state.companyId && page !== 'Settings' && page !== 'Manage Companies') {
      return (
        <div className="welcome panel">
          <Building2 size={44} />
          <h2>Your business, in one place.</h2>
          <p>
            Create your company to begin. Each company has its own private books, stock and
            settings.
          </p>
          <button type="button" className="primary" onClick={() => open('company')}>
            <Plus size={17} />
            Create company
          </button>
        </div>
      )
    }

    switch (page) {
      case 'Dashboard': {
        const periodPurchases = state.purchases
          .filter((r: Row) => r.status === 'posted')
          .reduce((s: number, r: Row) => s + r.supplier_total, 0)
        const periodSales = state.sales
          .filter((r: Row) => r.status === 'posted')
          .reduce((s: number, r: Row) => s + r.invoice_total, 0)
        const cashBank = state.accounts
          .filter(
            (a: Row) => a.code === 'CASH' || state.banks.some((b: Row) => b.account_id === a.id),
          )
          .reduce((s: number, a: Row) => s + a.balance, 0)
        const receivables = state.accounts.find((a: Row) => a.code === 'AR')?.balance ?? 0
        const tradePayables = -(state.accounts.find((a: Row) => a.code === 'AP')?.balance ?? 0)
        const brokerPayables = -(state.accounts.find((a: Row) => a.code === 'BROKER')?.balance ?? 0)
        const payables = tradePayables + brokerPayables
        const loansGiven = state.accounts.find((a: Row) => a.code === 'LOAN_G')?.balance ?? 0
        const loansTaken = -(state.accounts.find((a: Row) => a.code === 'LOAN_T')?.balance ?? 0)

        return (
          <>
            <div className="metrics">
              {summary('Sales', money(periodSales), 'Selected period', <Receipt size={20} />)}
              {summary(
                'Purchases',
                money(periodPurchases),
                'Selected period',
                <ShoppingBag size={20} />,
              )}
              {summary(
                'Available stock',
                `${ct(state.totals.stockCarats)} ct`,
                'As of ' + displayDate(query.to),
                <Gem size={20} />,
              )}
              {summary(
                'Actual net profit',
                money(state.totals.profit),
                'Accrual basis · selected period',
                <ChartNoAxesCombined size={20} />,
              )}
              {summary(
                'Cash & bank',
                money(cashBank),
                'Combined closing balance',
                <Landmark size={20} />,
              )}
              {summary(
                'Receivables',
                money(receivables),
                'As of ' + displayDate(query.to),
                <HandCoins size={20} />,
              )}
              {summary(
                'Payables',
                money(payables),
                brokerPayables
                  ? `Trade ${money(tradePayables)} · Broker ${money(brokerPayables)}`
                  : 'As of ' + displayDate(query.to),
                <HandCoins size={20} />,
              )}
              {summary(
                'Loans (given / taken)',
                `${money(loansGiven)} / ${money(loansTaken)}`,
                'Principal as of ' + displayDate(query.to),
                <BookOpen size={20} />,
              )}
            </div>

            <div className="dashboard-grid">
              <section className="panel overview">
                <div className="section-heading">
                  <div>
                    <small>INVENTORY OVERVIEW</small>
                    <h2>Know what your stock is worth</h2>
                  </div>
                  <Gem size={28} />
                </div>
                <div className="valuation">
                  <div>
                    <span>Actual inventory cost</span>
                    <strong>{money(state.totals.stockCost)}</strong>
                  </div>
                  <div>
                    <span>Projected value</span>
                    <strong>{money(state.totals.projected)}</strong>
                  </div>
                  <div>
                    <span>Projected gain</span>
                    <strong className="positive">
                      {money(state.totals.projected - state.totals.stockCost)}
                    </strong>
                  </div>
                </div>
                <p className="muted">
                  Projections are estimates and do not enter your accounting profit.
                </p>
                <button type="button" onClick={() => setPage('Stock Inventory')}>
                  Explore stock inventory <ArrowUpRight size={16} />
                </button>
              </section>
              <section className="panel health">
                <ShieldCheck size={25} />
                <h3>Books reconciliation</h3>
                <p>Balance sheet difference</p>
                <strong className={state.totals.balanceDifference ? 'negative' : 'positive'}>
                  {money(state.totals.balanceDifference)}
                </strong>
                <p>Trial balance difference: {money(state.totals.trialDifference)}</p>
                <button type="button" onClick={() => setPage('Balance Sheet')}>
                  View financial statements
                </button>
              </section>
            </div>

            <section className="panel ageing-bar">
              <div className="section-heading">
                <h2>Outstanding ageing</h2>
                <small>As of {displayDate(query.to)}</small>
              </div>
              <p className="muted" style={{ marginBottom: 10 }}>
                Receivables ageing
              </p>
              <div className="ageing-grid" style={{ marginBottom: 16 }}>
                {receivableAgeing.map((b) => (
                  <div key={'rec-' + b.label} className="ageing-bucket">
                    <span>{b.label}</span>
                    <strong>{money(b.amount)}</strong>
                    <small>
                      {b.count} bill{b.count === 1 ? '' : 's'}
                    </small>
                  </div>
                ))}
              </div>
              <p className="muted" style={{ marginBottom: 10 }}>
                Payables & brokerage ageing
              </p>
              <div className="ageing-grid">
                {payableAgeing.map((b) => (
                  <div key={'pay-' + b.label} className="ageing-bucket">
                    <span>{b.label}</span>
                    <strong>{money(b.amount)}</strong>
                    <small>
                      {b.count} bill{b.count === 1 ? '' : 's'}
                    </small>
                  </div>
                ))}
              </div>
            </section>

            <div className="section-heading">
              <h2>Outstanding & upcoming dues</h2>
              <button type="button" onClick={() => setPage('Payments')}>
                Manage payments <ArrowUpRight size={16} />
              </button>
            </div>
            {table(
              'Outstanding dues',
              openDues,
              [
                col('party', 'Party'),
                col('reference', 'Invoice'),
                col('kind', 'Type'),
                col('due_date', 'Due date', displayDate),
                col('outstanding', 'Outstanding', money),
                col('overdue', 'Overdue', (v) => (v ? 'Yes' : 'No')),
              ],
              undefined,
              false,
            )}
          </>
        )
      }

      case 'Parties Master':
        return table(
          'Parties',
          state.parties,
          [
            col('name', 'Party'),
            col('roles', 'Roles', (v) => v.join(', ')),
            col('phone', 'Phone'),
            col('credit_days', 'Credit days'),
            col('active', 'Status', (v) => (v ? 'Active' : 'Inactive')),
          ],
          (r) => (
            <>
              <button
                type="button"
                onClick={() => {
                  setDetail(r)
                  setModal('partyProfile')
                }}
              >
                Profile
              </button>
              <button type="button" onClick={() => open('party', r)}>
                Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  setPartyFilter(String(r.id))
                  setPage('Party Ledger')
                }}
              >
                Ledger
              </button>
            </>
          ),
        )

      case 'Quality Master':
        return table(
          'Qualities',
          state.qualities,
          [
            col('name', 'Quality'),
            col('inventory_mode', 'Inventory type', (v) =>
              v === 'individual' ? 'Individual Stone' : 'Standard (Lots)',
            ),
            col('description', 'Description'),
            col('hike_pct', 'Hike %', (v) => v ?? `Default (${state.settings.global_hike_pct}%)`),
            col('active', 'Status', (v) => (v ? 'Active' : 'Inactive')),
          ],
          (r) => (
            <button type="button" onClick={() => open('quality', r)}>
              Edit
            </button>
          ),
        )

      case 'Bank Accounts':
        return table(
          'Bank accounts',
          state.banks,
          [
            col('bank_name', 'Bank'),
            col('holder', 'Account holder'),
            col('account_number', 'Account number'),
            col('ifsc', 'IFSC'),
            col('account_id', 'Balance', (v) =>
              money(state.accounts.find((a: Row) => a.id === v)?.balance ?? 0),
            ),
          ],
          (r) => (
            <>
              <button type="button" onClick={() => open('bank', r)}>
                Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  setFundFilter(String(r.account_id))
                  setPage('Cash & Bank')
                }}
              >
                Ledger
              </button>
            </>
          ),
        )

      case 'Stock Inventory':
        return (
          <>
            {table('Inventory', state.inventory, [
              col('name', 'Quality'),
              col('opening', 'Opening ct', ct),
              col('purchased', 'Purchased ct', ct),
              col('sold', 'Sold ct', ct),
              col('carats', 'Available ct', ct),
              col('cost', 'Actual cost', money),
              col('average', 'Avg ₹ / ct', money),
              col('hike', 'Hike %'),
              col('projected', 'Projected value', money),
              col('profit', 'Projected profit', money),
            ])}
            <h2 className="section-title">Individual / Certified Stones</h2>
            {table(
              'Individual stones',
              state.stones ?? [],
              [
                col('sr_no', 'Sr.'),
                col('availability', 'Availability', (_v, r) => (
                  <StoneAvailabilityChip
                    stone={r}
                    onChangeStatus={(stoneId, availability) =>
                      void command('stone.setStatus', { id: stoneId, availability })
                    }
                    onMarkSold={startSaleForStone}
                  />
                )),
                col('quality', 'Quality'),
                col('slip_no', 'Slip No.', (v) => v || '—'),
                col('shape', 'Shape', (v) => v || '—'),
                col('carats', 'Carat Weight', ct),
                col('color', 'Color / Fancy', (_v, r) =>
                  r.fancy_color
                    ? [r.fancy_color, r.color_intensity, r.color_overtone]
                        .filter(Boolean)
                        .join(' · ')
                    : r.color || '—',
                ),
                col('clarity', 'Clarity', (v) => v || '—'),
                col(
                  'cut',
                  'Cut / Pol / Sym',
                  (_v, r) => [r.cut, r.polish, r.symmetry].filter(Boolean).join(' / ') || '—',
                ),
                col('length_mm', 'Measurements', (_v, r) => formatMeasurements(r)),
                col('report_number', 'Lab & Report #', (_v, r) => {
                  const url = certificateVerifyUrl(r.lab, r.report_number)
                  if (!r.report_number) return r.lab || '—'
                  return (
                    <span className="report-cell">
                      <span>{[r.lab, r.report_number].filter(Boolean).join(' #')}</span>
                      {url && (
                        <button
                          type="button"
                          className="verify-link-btn"
                          title="Verify certificate online"
                          onClick={() => void openExternalUrl(url)}
                        >
                          <ExternalLink size={12} />
                          Verify
                        </button>
                      )}
                    </span>
                  )
                }),
                col('growth', 'Growth', (v) => v || '—'),
                col('price_per_ct_inr', 'Price / ct', (_v, r) => (
                  <CurrencyAmount
                    currency={r.price_currency}
                    inrPaise={Number(r.price_per_ct_inr || 0) * 100}
                    usdAmount={r.price_per_ct_usd}
                    exchangeRate={r.exchange_rate}
                    size="sm"
                  />
                )),
                col('total_price_inr', 'Total Price', (_v, r) => (
                  <CurrencyAmount
                    currency={r.price_currency}
                    inrPaise={r.total_price_inr || 0}
                    usdAmount={r.total_price_usd}
                    exchangeRate={r.exchange_rate}
                    size="sm"
                  />
                )),
              ],
              (r) => (
                <button
                  type="button"
                  onClick={() => {
                    setDetail(r)
                    setModal('stoneDetail')
                  }}
                >
                  Specs
                </button>
              ),
              false,
            )}
            <h2 className="section-title">Stock lots</h2>
            {table(
              'Stock lots',
              state.lots,
              [
                col('id', 'Lot'),
                col('quality', 'Quality'),
                col('acquired_date', 'Acquired', displayDate),
                col('available', 'Available ct', ct),
                col('cost', 'Remaining cost', money),
              ],
              (r) => (
                <button
                  type="button"
                  onClick={() => {
                    setDetail(r)
                    setModal('lot')
                  }}
                >
                  Movements
                </button>
              ),
            )}
          </>
        )

      case 'Purchase':
        return (
          <>
            <div className="metrics">
              {summary(
                'Purchase invoices',
                state.purchases.filter((r: Row) => r.status === 'posted').length,
                'Selected period',
                <ShoppingBag size={20} />,
              )}
              {summary(
                'Supplier total',
                money(
                  state.purchases
                    .filter((r: Row) => r.status === 'posted')
                    .reduce((s: number, r: Row) => s + r.supplier_total, 0),
                ),
                'Selected period',
                <Receipt size={20} />,
              )}
              {summary(
                'Inventory acquired',
                money(
                  state.purchases
                    .filter((r: Row) => r.status === 'posted')
                    .reduce((s: number, r: Row) => s + r.stock_total, 0),
                ),
                'Including allocated expenses',
                <Package size={20} />,
              )}
            </div>
            {table(
              'Purchases',
              state.purchases,
              [
                col('number', 'Invoice'),
                col('slip_no', 'Slip No.', (v) => v || '—'),
                col('bill_date', 'Date', displayDate),
                col('party', 'Supplier'),
                col(
                  'supplier_total',
                  'Supplier total',
                  (_v, r) => (
                    <CurrencyAmount
                      currency={r.display_currency}
                      inrPaise={r.supplier_total}
                      usdAmount={r.total_usd}
                      exchangeRate={r.exchange_rate}
                      size="sm"
                    />
                  ),
                  true,
                ),
                col('stock_total', 'Inventory cost', money),
                col('outstanding', 'Outstanding', money),
                col('due_date', 'Due date', displayDate),
                col('status', 'Status'),
              ],
              actions('purchase'),
            )}
          </>
        )

      case 'Sale':
        return (
          <>
            <div className="metrics">
              {summary(
                'Sale invoices',
                state.sales.filter((r: Row) => r.status === 'posted').length,
                'Selected period',
                <Receipt size={20} />,
              )}
              {summary(
                'Invoice total',
                money(
                  state.sales
                    .filter((r: Row) => r.status === 'posted')
                    .reduce((s: number, r: Row) => s + r.invoice_total, 0),
                ),
                'Customer receivables',
                <HandCoins size={20} />,
              )}
              {summary(
                'Trading profit',
                money(
                  state.sales
                    .filter((r: Row) => r.status === 'posted')
                    .reduce((s: number, r: Row) => s + r.profit, 0),
                ),
                'After COGS and brokerage',
                <ChartNoAxesCombined size={20} />,
              )}
            </div>
            {table(
              'Sales',
              state.sales,
              [
                col('number', 'Invoice'),
                col('slip_no', 'Slip No.', (v) => v || '—'),
                col('bill_date', 'Date', displayDate),
                col('party', 'Customer'),
                col(
                  'invoice_total',
                  'Invoice total',
                  (_v, r) => (
                    <CurrencyAmount
                      currency={r.display_currency}
                      inrPaise={r.invoice_total}
                      usdAmount={r.total_usd}
                      exchangeRate={r.exchange_rate}
                      size="sm"
                    />
                  ),
                  true,
                ),
                col('brokerage', 'Brokerage', money),
                col('cogs', 'COGS', money),
                col('profit', 'Trading profit', money),
                col('outstanding', 'Outstanding', money),
                col('status', 'Status'),
              ],
              actions('sale'),
            )}
          </>
        )

      case 'Loans': {
        const activeLoans = state.loans.filter((l: Row) => l.status !== 'cancelled')
        const takenPrincipal = activeLoans
          .filter((l: Row) => l.kind === 'taken' && l.status === 'open')
          .reduce((s: number, l: Row) => s + l.principal, 0)
        const givenPrincipal = activeLoans
          .filter((l: Row) => l.kind === 'given' && l.status === 'open')
          .reduce((s: number, l: Row) => s + l.principal, 0)
        const takenDue = activeLoans
          .filter((l: Row) => l.kind === 'taken')
          .reduce((s: number, l: Row) => s + l.outstanding, 0)
        const givenDue = activeLoans
          .filter((l: Row) => l.kind === 'given')
          .reduce((s: number, l: Row) => s + l.outstanding, 0)
        return (
          <>
            <div className="metrics">
              {summary(
                'Loans taken (open)',
                money(takenPrincipal),
                'Principal payable',
                <HandCoins size={20} />,
              )}
              {summary(
                'Loans given (open)',
                money(givenPrincipal),
                'Principal receivable',
                <HandCoins size={20} />,
              )}
              {summary(
                'Interest payable due',
                money(takenDue),
                'As of ' + displayDate(query.to),
                <BookOpen size={20} />,
              )}
              {summary(
                'Interest receivable due',
                money(givenDue),
                'As of ' + displayDate(query.to),
                <BookOpen size={20} />,
              )}
            </div>
            {table(
              'Loans',
              state.loans,
              [
                col('number', 'Loan'),
                col('party', 'Party'),
                col('kind', 'Direction'),
                col('principal', 'Principal', money),
                col('rate', 'Rate %'),
                col('frequency', 'Basis'),
                col('accrued', 'Accrued interest', money),
                col('paid', 'Interest paid', money),
                col('outstanding', 'Interest due', money),
                col('status', 'Status'),
              ],
              (r) => (
                <>
                  {actions('loan')(r)}
                  {r.status === 'open' && (
                    <button type="button" onClick={() => open('settle', r)}>
                      Settle / interest
                    </button>
                  )}
                  {r.status !== 'cancelled' && (r.paid > 0 || r.closed || r.hasSettlement) && (
                    <button type="button" onClick={() => requestReverseSettlement(r)}>
                      Reverse settlement
                    </button>
                  )}
                </>
              ),
              false,
            )}
          </>
        )
      }

      case 'Payments': {
        const postedPayments = state.payments.filter((p: Row) => p.status === 'posted')
        const totalPaid = postedPayments
          .filter((p: Row) => p.direction === 'pay')
          .reduce((s: number, p: Row) => s + p.amount, 0)
        const totalReceived = postedPayments
          .filter((p: Row) => p.direction === 'receive')
          .reduce((s: number, p: Row) => s + p.amount, 0)
        const advPaid = state.advances
          .filter((a: Row) => a.direction === 'paid')
          .reduce((s: number, a: Row) => s + a.remaining, 0)
        const advRec = state.advances
          .filter((a: Row) => a.direction === 'received')
          .reduce((s: number, a: Row) => s + a.remaining, 0)

        return (
          <>
            <div className="metrics">
              {summary(
                'Total paid',
                money(totalPaid),
                'Selected period',
                <ArrowLeftRight size={20} />,
              )}
              {summary(
                'Total received',
                money(totalReceived),
                'Selected period',
                <ArrowLeftRight size={20} />,
              )}
              {summary(
                'Advances paid (available)',
                money(advPaid),
                'Unapplied supplier advances',
                <HandCoins size={20} />,
              )}
              {summary(
                'Advances received (available)',
                money(advRec),
                'Unapplied customer advances',
                <HandCoins size={20} />,
              )}
            </div>
            {table(
              'Payments',
              state.payments,
              [
                col('number', 'Payment'),
                col('payment_date', 'Date', displayDate),
                col('party', 'Party'),
                col('direction', 'Direction'),
                col('amount', 'Amount', money),
                col('reference', 'Reference'),
                col('status', 'Status'),
              ],
              actions('payment'),
              false,
            )}
            <div className="section-heading">
              <h2>Advances</h2>
              <button type="button" onClick={() => open('advance')}>
                Apply advance
              </button>
            </div>
            {table(
              'Advances',
              state.advances,
              [
                col('party', 'Party'),
                col('direction', 'Direction'),
                col('amount', 'Original amount', money),
                col('remaining', 'Available', money),
              ],
              undefined,
              false,
            )}
            <h2 className="section-title">Advance applications</h2>
            {table(
              'Advance applications',
              state.advanceApplications,
              [
                col('party', 'Party'),
                col('reference', 'Invoice'),
                col('allocation_date', 'Date', displayDate),
                col('amount', 'Amount', money),
              ],
              (r) => (
                <button type="button" onClick={() => requestReverseAdvance(r)}>
                  Reverse application
                </button>
              ),
            )}
          </>
        )
      }

      case 'Cash & Bank':
        return (
          <>
            <div className="metrics">
              {state.accounts
                .filter(
                  (a: Row) =>
                    a.code === 'CASH' || state.banks.some((b: Row) => b.account_id === a.id),
                )
                .map((a: Row) => (
                  <React.Fragment key={a.id}>
                    {summary(a.name, money(a.balance), 'Closing balance', <Landmark size={20} />)}
                  </React.Fragment>
                ))}
            </div>
            <Field
              label="Account ledger"
              value={fundFilter}
              onChange={setFundFilter}
              options={funds}
            />
            {fundFilter &&
              ledgerTable(
                state.ledger.filter((l: Row) => l.account_id === Number(fundFilter)),
                'Cash / bank ledger',
              )}
            <h2 className="section-title">Transfers</h2>
            {table(
              'Fund transfers',
              state.transfers,
              [
                col('number', 'Transfer'),
                col('transfer_date', 'Date', displayDate),
                col(
                  'source_account',
                  'From',
                  (v) => state.accounts.find((a: Row) => a.id === v)?.name,
                ),
                col(
                  'destination_account',
                  'To',
                  (v) => state.accounts.find((a: Row) => a.id === v)?.name,
                ),
                col('amount', 'Amount', money),
                col('status', 'Status'),
              ],
              actions('transfer'),
            )}
          </>
        )

      case 'Journal Voucher':
        return (
          <>
            {table(
              'Journal vouchers',
              state.journals
                .filter((j: Row) => j.source_type === 'journal')
                .map((j: Row) => ({
                  ...j,
                  amount: (j.lines ?? []).reduce(
                    (s: number, l: Row) => s + Number(l.debit || 0),
                    0,
                  ),
                })),
              [
                col('number', 'Voucher'),
                col('entry_date', 'Date', displayDate),
                col('narration', 'Narration'),
                col('amount', 'Amount', money),
                col('reversed', 'State', (v) => (v ? 'Reversed' : 'Posted')),
              ],
              actions('journal'),
            )}
            <button type="button" className="section-title" onClick={() => open('account')}>
              Add custom ledger account
            </button>
          </>
        )

      case 'Party Ledger':
        return (
          <>
            <Field
              label="Party"
              value={partyFilter}
              onChange={setPartyFilter}
              options={options('parties')}
            />
            {partyFilter && (
              <>
                {table(
                  'Party outstanding',
                  state.openItems.filter((o: Row) => o.party_id === Number(partyFilter)),
                  [
                    col('reference', 'Reference'),
                    col('kind', 'Type'),
                    col('bill_date', 'Date', displayDate),
                    col('amount', 'Original', money),
                    col('paid', 'Settled', money),
                    col('outstanding', 'Outstanding', money),
                  ],
                  undefined,
                  false,
                )}
                {ledgerTable(
                  state.partyLedger.filter((l: Row) => l.partyId === Number(partyFilter)),
                  'Party ledger',
                )}
              </>
            )}
          </>
        )

      case 'Balance Sheet':
        return (
          <>
            <div className="metrics">
              {summary(
                'Assets',
                money(state.totals.assets),
                'As of ' + displayDate(query.to),
                <Landmark size={20} />,
              )}
              {summary(
                'Liabilities',
                money(state.totals.liabilities),
                'Including accrued interest',
                <BookOpen size={20} />,
              )}
              {summary(
                'Equity & earnings',
                money(state.totals.equity),
                'Continuous balances across FY',
                <ChartNoAxesCombined size={20} />,
              )}
              {summary(
                'Difference',
                money(state.totals.balanceDifference),
                'Must equal zero',
                <ShieldCheck size={20} />,
              )}
            </div>
            {table(
              'Balance sheet',
              state.reportAccounts
                .filter((a: Row) => ['asset', 'liability', 'equity'].includes(a.kind))
                .map((a: Row) => ({ ...a, display: a.kind === 'asset' ? a.balance : -a.balance }))
                .concat([
                  {
                    id: 'earnings',
                    name: 'Retained and current earnings',
                    kind: 'equity',
                    display: state.totals.earnings,
                  },
                ]),
              [
                col('name', 'Account'),
                col('kind', 'Classification'),
                col('display', 'Balance', money),
              ],
              undefined,
              false,
            )}
            <h2 className="section-title">Trial balance</h2>
            {table(
              'Trial balance',
              state.reportAccounts.map((a: Row) => ({
                ...a,
                debit: Math.max(0, a.balance),
                credit: Math.max(0, -a.balance),
              })),
              [
                col('name', 'Account'),
                col('debit', 'Debit', money),
                col('credit', 'Credit', money),
              ],
            )}
          </>
        )

      case 'Profit & Loss': {
        const salesRev = -(state.reportAccounts.find((a: Row) => a.code === 'SALES')?.period ?? 0)
        const cogsAmt = state.reportAccounts.find((a: Row) => a.code === 'COGS')?.period ?? 0
        const grossProfit = salesRev - cogsAmt
        const totalRevenue = -state.reportAccounts
          .filter((a: Row) => a.kind === 'income')
          .reduce((s: number, a: Row) => s + a.period, 0)
        const marginPct =
          totalRevenue > 0 ? ((state.totals.profit / totalRevenue) * 100).toFixed(2) + '%' : '—'

        return (
          <>
            <div className="metrics">
              {summary(
                'Revenue',
                money(totalRevenue),
                'Selected period · accrual basis',
                <Receipt size={20} />,
              )}
              {summary(
                'Gross trading profit',
                money(grossProfit),
                'Sales less COGS',
                <Package size={20} />,
              )}
              {summary(
                'Net profit',
                money(state.totals.profit),
                'Actual income less expenses',
                <ChartNoAxesCombined size={20} />,
              )}
              {summary(
                'Net margin',
                marginPct,
                'Net profit / total revenue',
                <ShieldCheck size={20} />,
              )}
            </div>
            {table(
              'Profit and loss',
              state.reportAccounts
                .filter((a: Row) => ['income', 'expense'].includes(a.kind))
                .map((a: Row) => ({ ...a, amount: a.kind === 'income' ? -a.period : a.period })),
              [
                col('name', 'Account'),
                col('kind', 'Classification'),
                col('amount', 'Amount', money),
              ],
              undefined,
              false,
            )}
          </>
        )
      }

      case 'Day Book':
        return table(
          'Day book',
          state.ledger.filter((r: Row) => r.date >= query.from),
          [
            col('date', 'Date', displayDate),
            col('number', 'Reference'),
            col('source_type', 'Type'),
            col('account', 'Account'),
            col('narration', 'Particulars'),
            col('debit', 'Debit', money),
            col('credit', 'Credit', money),
          ],
        )

      case 'Manage Companies':
        return (
          <>
            <div className="company-cards">
              {state.companies.map((c: Row) => (
                <section
                  className={
                    c.is_default ? 'panel company-card default-company' : 'panel company-card'
                  }
                  key={c.id}
                >
                  <div className="company-card-head">
                    <Building2 size={28} />
                    {Boolean(c.is_default) && <span className="default-badge">Default</span>}
                  </div>
                  <h2>{c.name}</h2>
                  <p>
                    {c.id === state.companyId
                      ? 'Current company · Active workspace'
                      : c.is_default
                        ? 'Default company · Opens automatically on sign in'
                        : 'Independent company books'}
                  </p>
                  <div className="company-card-actions">
                    <button
                      type="button"
                      onClick={() => command('companies.select', { id: c.id })}
                      disabled={c.id === state.companyId}
                    >
                      Open company
                    </button>
                    <button
                      type="button"
                      className={c.is_default ? 'default-btn active' : 'default-btn'}
                      aria-pressed={Boolean(c.is_default)}
                      onClick={() =>
                        command('companies.setDefault', { id: c.is_default ? null : c.id })
                      }
                    >
                      {c.is_default ? 'Default ✓' : 'Set as default'}
                    </button>
                  </div>
                </section>
              ))}
              {!state.companies.length && (
                <section className="panel company-card">
                  <Building2 size={28} />
                  <h2>No companies created</h2>
                  <p>Create your first company to begin recording transactions.</p>
                  <button type="button" className="primary" onClick={() => open('company')}>
                    <Plus size={17} />
                    Create company
                  </button>
                </section>
              )}
            </div>
            {state.companyId && (
              <section className="panel settings-card">
                <h2>Opening balances</h2>
                <p>
                  Bring in your opening stock, bills, advances, loans and balanced ledger balances.
                </p>
                <button
                  type="button"
                  className="primary"
                  disabled={state.openingDone}
                  onClick={() => open('opening')}
                >
                  {state.openingDone ? 'Opening balances posted' : 'Enter opening balances'}
                </button>
              </section>
            )}
          </>
        )

      case 'Settings':
        return (
          <>
            <div
              className="settings-tabs"
              role="tablist"
              aria-label="Settings sections"
              onKeyDown={(e) => {
                if (
                  e.key === 'ArrowRight' ||
                  e.key === 'ArrowLeft' ||
                  e.key === 'Home' ||
                  e.key === 'End'
                ) {
                  e.preventDefault()
                  const nextTab =
                    e.key === 'Home'
                      ? 'general'
                      : e.key === 'End'
                        ? 'software'
                        : settingsTab === 'general'
                          ? 'software'
                          : 'general'
                  setSettingsTab(nextTab)
                  document.getElementById(`tab-settings-${nextTab}`)?.focus()
                }
              }}
            >
              <button
                type="button"
                role="tab"
                id="tab-settings-general"
                aria-selected={settingsTab === 'general'}
                tabIndex={settingsTab === 'general' ? 0 : -1}
                onClick={() => setSettingsTab('general')}
              >
                General &amp; Security
              </button>
              <button
                type="button"
                role="tab"
                id="tab-settings-software"
                aria-selected={settingsTab === 'software'}
                tabIndex={settingsTab === 'software' ? 0 : -1}
                onClick={() => setSettingsTab('software')}
              >
                Software info &amp; updates
              </button>
            </div>
            <div
              role="tabpanel"
              aria-labelledby="tab-settings-general"
              hidden={settingsTab !== 'general'}
            >
              <section className="panel settings-card">
                <h2>Account security</h2>
                <p>
                  Signed in as <strong>{state.username ?? 'admin@gmail.com'}</strong>. Administrator
                  credentials and offline recovery keys are stored locally on this computer.
                </p>
                <dl>
                  <dt>Recovery code</dt>
                  <dd>
                    {state.recoveryStatus?.hasRecovery
                      ? 'Configured (hidden PDF saved)'
                      : 'Not configured'}
                  </dd>
                  <dt>Device PIN</dt>
                  <dd>
                    {!state.recoveryStatus?.canEnroll
                      ? 'Unavailable on this OS'
                      : !state.recoveryStatus?.enrolled
                        ? 'Not configured'
                        : (state.recoveryStatus.remaining ?? 0) <= 0
                          ? 'Locked (5 failed attempts — set a new PIN to unlock)'
                          : `Enrolled · ${state.recoveryStatus.remaining} of 5 attempts remaining`}
                  </dd>
                </dl>
                <div className="button-row">
                  <button type="button" onClick={() => open('username', { newUsername: '' })}>
                    Change username
                  </button>
                  <button type="button" onClick={() => open('password')}>
                    Change password
                  </button>
                  <button type="button" onClick={() => setRecoveryModal('rotateRecovery')}>
                    Generate / rotate recovery code
                  </button>
                  {state.recoveryStatus?.canEnroll && (
                    <button type="button" onClick={() => setRecoveryModal('enrollPin')}>
                      {state.recoveryStatus?.enrolled ? 'Change device PIN' : 'Set up device PIN'}
                    </button>
                  )}
                  {state.recoveryStatus?.enrolled && (
                    <button
                      type="button"
                      className="danger-text"
                      onClick={() => setRecoveryModal('removePin')}
                    >
                      Remove device PIN
                    </button>
                  )}
                </div>
              </section>
              {state.companyId && (
                <>
                  <section className="panel settings-card">
                    <h2>Company preferences</h2>
                    <dl>
                      <dt>Company</dt>
                      <dd>{state.profile.name}</dd>
                      <dt>Financial year</dt>
                      <dd>April – March</dd>
                      <dt>Currency / precision</dt>
                      <dd>INR · 2 decimals</dd>
                      <dt>Default stock hike</dt>
                      <dd>{state.settings.global_hike_pct}%</dd>
                      <dt>Accounting</dt>
                      <dd>Accrual · original-date corrections</dd>
                    </dl>
                    <div className="button-row">
                      <button type="button" onClick={() => open('settings')}>
                        Edit company settings
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const r = await window.diamo.logo(state.companyId)
                          if (!r.ok) setError(r.error)
                          else await refresh()
                        }}
                      >
                        Choose company logo
                      </button>
                      <button type="button" onClick={() => open('numbering')}>
                        Configure numbering
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const r = await window.diamo.export('xlsx', 'Company settings', [
                            {
                              Company: state.profile.name,
                              Address: state.profile.address ?? '',
                              Contact: state.profile.contact ?? '',
                              Currency: 'INR',
                              Precision: 2,
                              Hike: state.settings.global_hike_pct,
                              Accounting: 'Accrual',
                            },
                          ])
                          if (!r.ok) setError(r.error)
                        }}
                      >
                        Export settings
                      </button>
                    </div>
                  </section>
                  <section className="panel settings-card">
                    <h2>Ledger accounts</h2>
                    <button type="button" onClick={() => open('account')}>
                      Add ledger account
                    </button>
                    {table('Ledger accounts', state.accounts, [
                      col('code', 'Code'),
                      col('name', 'Name'),
                      col('kind', 'Type'),
                      col('control', 'Protected', (v) => (v ? 'Yes' : 'No')),
                    ])}
                  </section>
                  <h2 className="section-title">Audit history</h2>
                  {table('Audit history', state.audit, [
                    col('created_at', 'Recorded'),
                    col('entity_type', 'Type'),
                    col('entity_id', 'Document'),
                    col('action', 'Action'),
                    col('effective_date', 'Effective date', displayDate),
                    col('reason', 'Reason'),
                  ])}
                </>
              )}
            </div>
            <div
              role="tabpanel"
              aria-labelledby="tab-settings-software"
              hidden={settingsTab !== 'software'}
            >
              <SoftwareInfoPanel
                systemInfo={systemInfo}
                updateInfo={updateInfo}
                checking={checkingUpdate}
                onCheckUpdate={() => void runManualUpdateCheck()}
                onOpenExternal={(url) => void openExternalUrl(url)}
              />
            </div>
          </>
        )

      case 'Backup & Restore':
        return (
          <>
            <section className="panel settings-card">
              <DatabaseBackup size={32} />
              <h2>Protect your local books</h2>
              <p>
                Full backups include all companies and administrator credentials. Store them in a
                location you control. Restore validates checksums and creates a recovery backup
                first.
              </p>
              <div className="button-row">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => open('backupOptions', { action: 'create' })}
                >
                  Back up now
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => open('backupOptions', { action: 'configure' })}
                >
                  Configure automatic backup
                </button>
                <button type="button" disabled={busy} onClick={() => backup('restore')}>
                  Restore backup
                </button>
                <button type="button" disabled={busy} onClick={() => backup('history')}>
                  Refresh history
                </button>
              </div>
              <p className="muted">
                Automatic backups run while the app is open and on exit. Retention and interval
                follow your selected settings.
              </p>
              {state.backupJobs?.map((j: Row) => (
                <p key={j.id} className="info">
                  Every {j.interval_minutes / 60} hours · retain {j.retention} ·{' '}
                  {j.on_exit ? 'also on exit' : 'running only'} ·{' '}
                  {j.company_id ? 'individual company' : 'all companies'}
                  <br />
                  {j.destination}
                </p>
              ))}
            </section>
            {table('Backup history', backupHistory, [
              col('created_at', 'Created'),
              col('status', 'Status'),
              col('path', 'Location'),
              col('message', 'Result'),
            ])}
          </>
        )

      default:
        return null
    }
  }

  const addMap: Record<string, [string, string]> = {
    'Parties Master': ['party', 'Add party'],
    'Quality Master': ['quality', 'Add quality'],
    'Bank Accounts': ['bank', 'Add bank'],
    Purchase: ['purchase', 'Add purchase'],
    Sale: ['sale', 'Add sale'],
    Loans: ['loan', 'Add loan'],
    Payments: ['payment', 'Add payment'],
    'Cash & Bank': ['transfer', 'Transfer funds'],
    'Journal Voucher': ['journal', 'Add journal voucher'],
    'Manage Companies': ['company', 'Create company'],
  }

  const drawerContent = () => {
    if (modal === 'stoneDetail' && detail) {
      const verifyUrl = certificateVerifyUrl(detail.lab, detail.report_number)
      return (
        <div className="drawer-body">
          <div className="button-row" style={{ marginBottom: 14 }}>
            <StoneAvailabilityChip
              stone={detail}
              onChangeStatus={(stoneId, availability) => {
                void command('stone.setStatus', { id: stoneId, availability }, true)
              }}
              onMarkSold={startSaleForStone}
            />
            {verifyUrl && (
              <button
                type="button"
                className="primary"
                onClick={() => void openExternalUrl(verifyUrl)}
              >
                <ExternalLink size={15} />
                Verify certificate ({detail.lab || 'Lab'} #{detail.report_number})
              </button>
            )}
          </div>
          <dl className="detail-grid">
            <dt>Sr.</dt>
            <dd>{detail.sr_no || '—'}</dd>
            <dt>Quality</dt>
            <dd>{detail.quality || '—'}</dd>
            <dt>Shape</dt>
            <dd>{detail.shape || '—'}</dd>
            <dt>Carat Weight</dt>
            <dd>{ct(detail.carats)} ct</dd>
            <dt>Color</dt>
            <dd>{detail.color || '—'}</dd>
            <dt>Fancy Color</dt>
            <dd>{detail.fancy_color || '—'}</dd>
            <dt>Color Intensity</dt>
            <dd>{detail.color_intensity || '—'}</dd>
            <dt>Color Overtone</dt>
            <dd>{detail.color_overtone || '—'}</dd>
            <dt>Clarity</dt>
            <dd>{detail.clarity || '—'}</dd>
            <dt>Cut / Polish / Symmetry</dt>
            <dd>{[detail.cut || '—', detail.polish || '—', detail.symmetry || '—'].join(' / ')}</dd>
            <dt>Ratio</dt>
            <dd>{detail.ratio || '—'}</dd>
            <dt>Measurements</dt>
            <dd>{formatMeasurements(detail)}</dd>
            <dt>Depth % / Table %</dt>
            <dd>{`${detail.depth_pct || '—'}% / ${detail.table_pct || '—'}%`}</dd>
            <dt>Fluorescence</dt>
            <dd>{detail.fluorescence || '—'}</dd>
            <dt>Lab &amp; Report #</dt>
            <dd>{[detail.lab, detail.report_number].filter(Boolean).join(' #') || '—'}</dd>
            <dt>Growth</dt>
            <dd>{detail.growth || '—'}</dd>
            <dt>Pricing currency &amp; FX</dt>
            <dd>
              {detail.price_currency}
              {detail.exchange_rate ? ` · ₹${detail.exchange_rate} / $` : ''}
            </dd>
            <dt>Price / ct</dt>
            <dd>
              <CurrencyAmount
                currency={detail.price_currency}
                inrPaise={Number(detail.price_per_ct_inr || 0) * 100}
                usdAmount={detail.price_per_ct_usd}
                exchangeRate={detail.exchange_rate}
                size="sm"
              />
            </dd>
            <dt>Total Price</dt>
            <dd>
              <CurrencyAmount
                currency={detail.price_currency}
                inrPaise={detail.total_price_inr || 0}
                usdAmount={detail.total_price_usd}
                exchangeRate={detail.exchange_rate}
                size="sm"
              />
            </dd>
            <dt>Purchase Reference</dt>
            <dd>
              {detail.purchase_number || '—'}
              {detail.purchase_slip_no ? ` · Slip ${detail.purchase_slip_no}` : ''}
            </dd>
            <dt>Sale Reference</dt>
            <dd>
              {detail.sale_number || '—'}
              {detail.sale_slip_no ? ` · Slip ${detail.sale_slip_no}` : ''}
            </dd>
          </dl>
        </div>
      )
    }
    if (modal === 'lot') {
      return (
        <div className="drawer-body">
          {table(
            'Lot movements',
            state.stockMovements.filter((m: Row) => m.lot_id === detail?.id),
            [
              col('movement_date', 'Date', displayDate),
              col('source_type', 'Transaction'),
              col('source_id', 'Reference'),
              col('carats_delta', 'Carat movement', ct),
              col('cost_delta', 'Cost movement', money),
            ],
          )}
        </div>
      )
    }
    if (modal === 'dues') {
      return (
        <div className="drawer-body">
          {table('Due notifications', openDues, [
            col('party', 'Party'),
            col('reference', 'Invoice'),
            col('due_date', 'Due date', displayDate),
            col('outstanding', 'Outstanding', money),
          ])}
        </div>
      )
    }
    if (modal === 'partyProfile' && detail) {
      const pid = detail.id
      const partyOpen = (state.openItems ?? []).filter((o: Row) => o.party_id === pid)
      const partyPurchases = (state.purchases ?? []).filter((d: Row) => d.party_id === pid)
      const partySales = (state.sales ?? []).filter((d: Row) => d.party_id === pid)
      const partyPayments = (state.payments ?? []).filter((d: Row) => d.party_id === pid)
      const partyLoans = (state.loans ?? []).filter((d: Row) => d.party_id === pid)
      const partyAdv = (state.advances ?? []).filter((a: Row) => a.party_id === pid)
      return (
        <div className="drawer-body">
          <dl className="detail-grid">
            <dt>Party</dt>
            <dd>{detail.name}</dd>
            <dt>Roles</dt>
            <dd>{detail.roles?.join(', ') || '—'}</dd>
            <dt>Contact person</dt>
            <dd>{detail.contact_person || '—'}</dd>
            <dt>Phone / Email</dt>
            <dd>{[detail.phone, detail.email].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>Address</dt>
            <dd>{detail.address || '—'}</dd>
            <dt>PAN / GSTIN</dt>
            <dd>{[detail.pan, detail.gstin].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>Credit days</dt>
            <dd>{detail.credit_days ?? 0}</dd>
          </dl>
          <div className="metrics">
            {summary(
              'Open bills',
              money(partyOpen.reduce((s: number, o: Row) => s + o.outstanding, 0)),
              `${partyOpen.filter((o: Row) => o.outstanding > 0).length} pending`,
              <Receipt size={18} />,
            )}
            {summary(
              'Available advances',
              money(partyAdv.reduce((s: number, a: Row) => s + a.remaining, 0)),
              'Unapplied balance',
              <HandCoins size={18} />,
            )}
          </div>
          {partyPurchases.length > 0 && (
            <>
              <h3 className="section-title">Purchases</h3>
              {table('Party purchases', partyPurchases, [
                col('number', 'Invoice'),
                col('bill_date', 'Date', displayDate),
                col('supplier_total', 'Total', money),
                col('outstanding', 'Outstanding', money),
                col('status', 'Status'),
              ])}
            </>
          )}
          {partySales.length > 0 && (
            <>
              <h3 className="section-title">Sales</h3>
              {table('Party sales', partySales, [
                col('number', 'Invoice'),
                col('bill_date', 'Date', displayDate),
                col('invoice_total', 'Total', money),
                col('outstanding', 'Outstanding', money),
                col('status', 'Status'),
              ])}
            </>
          )}
          {partyPayments.length > 0 && (
            <>
              <h3 className="section-title">Payments</h3>
              {table('Party payments', partyPayments, [
                col('number', 'Payment'),
                col('payment_date', 'Date', displayDate),
                col('direction', 'Direction'),
                col('amount', 'Amount', money),
                col('status', 'Status'),
              ])}
            </>
          )}
          {partyLoans.length > 0 && (
            <>
              <h3 className="section-title">Loans</h3>
              {table('Party loans', partyLoans, [
                col('number', 'Loan'),
                col('kind', 'Kind'),
                col('principal', 'Principal', money),
                col('outstanding', 'Interest due', money),
                col('status', 'Status'),
              ])}
            </>
          )}
          <div className="button-row section-title">
            <button
              type="button"
              className="primary"
              onClick={() => {
                setPartyFilter(String(pid))
                setModal(null)
                setPage('Party Ledger')
              }}
            >
              Open full party ledger
            </button>
          </div>
        </div>
      )
    }
    if (modal === 'detail') {
      return (
        <div className="drawer-body">
          <div className="invoice-brand">
            <img src={state.companyLogo ?? logo} alt="Company logo" />
            <div>
              <h2>{state.profile.name}</h2>
              <p>{state.profile.address}</p>
              <p>{state.profile.contact}</p>
            </div>
          </div>
          <dl className="detail-grid">
            <dt>Document number</dt>
            <dd>{detail?.number}</dd>
            {detail?.slip_no !== undefined && (
              <>
                <dt>Slip No.</dt>
                <dd>{detail.slip_no || '—'}</dd>
              </>
            )}
            <dt>Party</dt>
            <dd>{detail?.party ?? '—'}</dd>
            <dt>Date</dt>
            <dd>
              {displayDate(
                detail?.bill_date ??
                  detail?.payment_date ??
                  detail?.loan_date ??
                  detail?.entry_date ??
                  detail?.transfer_date,
              )}
            </dd>
            <dt>Status</dt>
            <dd>{detail?.reversed ? 'Reversed' : detail?.status}</dd>
            {detail?.due_date && (
              <>
                <dt>Due date</dt>
                <dd>{displayDate(detail.due_date)}</dd>
              </>
            )}
            <dt>Narration / remarks</dt>
            <dd>{detail?.narration ?? detail?.remarks ?? '—'}</dd>
          </dl>

          {detail?.items &&
            table(
              'Invoice lines',
              detail.items.map((l: Row) => ({
                ...l,
                quality: l.quality ?? state.qualities.find((q: Row) => q.id === l.quality_id)?.name,
              })),
              [
                col('quality', 'Quality'),
                col('carats', 'Carats', ct),
                col('rate', 'Rate / ct', (_v, r) => (
                  <CurrencyAmount
                    currency={r.price_currency}
                    inrPaise={Number(r.rate || 0) * 100}
                    usdAmount={r.rate_usd}
                    exchangeRate={r.exchange_rate}
                    size="sm"
                  />
                )),
                col('less_pct', 'Less %'),
                col('gross', 'Gross', money),
                col(
                  'net',
                  'After less',
                  (_v, r) => (
                    <CurrencyAmount
                      currency={r.price_currency}
                      inrPaise={r.net}
                      usdAmount={r.total_usd}
                      exchangeRate={r.exchange_rate}
                      size="sm"
                    />
                  ),
                  true,
                ),
              ],
            )}

          {(() => {
            const lineStones: Row[] = (detail?.items ?? []).flatMap((l: Row) =>
              l.stone ? [l.stone] : (l.stones ?? []),
            )
            if (!lineStones.length) return null
            return (
              <>
                <h3 className="section-title">Diamond stone specifications</h3>
                {table(
                  'Stone specs',
                  lineStones,
                  [
                    col('sr_no', 'Sr.'),
                    col('shape', 'Shape', (v) => v || '—'),
                    col('carats', 'Carats', ct),
                    col('color', 'Color', (_v, r) => r.fancy_color || r.color || '—'),
                    col('clarity', 'Clarity', (v) => v || '—'),
                    col(
                      'cut',
                      'Cut/Pol/Sym',
                      (_v, r) => [r.cut, r.polish, r.symmetry].filter(Boolean).join('/') || '—',
                    ),
                    col('length_mm', 'Measurements', (_v, r) => formatMeasurements(r)),
                    col('report_number', 'Lab & Report #', (_v, r) => {
                      const url = certificateVerifyUrl(r.lab, r.report_number)
                      if (!r.report_number) return r.lab || '—'
                      return (
                        <span className="report-cell">
                          <span>{[r.lab, r.report_number].filter(Boolean).join(' #')}</span>
                          {url && (
                            <button
                              type="button"
                              className="verify-link-btn"
                              onClick={() => void openExternalUrl(url)}
                            >
                              <ExternalLink size={12} />
                              Verify
                            </button>
                          )}
                        </span>
                      )
                    }),
                    col('growth', 'Growth', (v) => v || '—'),
                  ],
                  undefined,
                  false,
                )}
              </>
            )
          })()}

          {detail?.expenses?.length > 0 && (
            <>
              <h3 className="section-title">Purchase expenses</h3>
              {table('Purchase expenses', detail!.expenses, [
                col('description', 'Description'),
                col('mode', 'Paid by'),
                col('account', 'Account'),
                col('amount', 'Amount', money),
              ])}
            </>
          )}

          {detail?.brokerages?.length > 0 && (
            <>
              <h3 className="section-title">Brokerage</h3>
              {table('Sale brokerage', detail!.brokerages, [
                col('broker', 'Broker'),
                col('mode', 'Mode'),
                col('input_value', 'Input value'),
                col('amount', 'Brokerage', money),
              ])}
            </>
          )}

          {detail?.adjustments?.length > 0 && (
            <>
              <h3 className="section-title">Invoice adjustments</h3>
              {table('Invoice adjustments', detail!.adjustments, [
                col('description', 'Description'),
                col('amount', 'Amount', money),
              ])}
            </>
          )}

          {detail?.lines &&
            table('Voucher entries', detail.lines, [
              col('account', 'Account'),
              col('debit', 'Debit', money),
              col('credit', 'Credit', money),
            ])}

          {detail?.allocations?.length > 0 && (
            <>
              <h3 className="section-title">Bill allocations</h3>
              {table(
                'Payment allocations',
                detail!.allocations.filter((a: Row) => a.active !== 0),
                [col('reference', 'Invoice'), col('amount', 'Allocated', money)],
              )}
            </>
          )}

          <dl className="detail-grid">
            {[
              [
                'Invoice total',
                detail?.supplier_total ??
                  detail?.invoice_total ??
                  detail?.amount ??
                  detail?.principal,
              ],
              ['Inventory cost', detail?.stock_total],
              ['Brokerage', detail?.brokerage],
              ['Cost of goods sold', detail?.cogs],
              ['Trading profit', detail?.profit],
              ['Outstanding', detail?.outstanding],
            ]
              .filter(([, v]) => v !== undefined)
              .map(([label, value]) => (
                <React.Fragment key={String(label)}>
                  <dt>{label}</dt>
                  <dd>{money(Number(value))}</dd>
                </React.Fragment>
              ))}
          </dl>

          <div className="button-row">
            {(['pdf', 'xlsx', 'print'] as const).map((format) => (
              <button
                type="button"
                key={format}
                onClick={async () => {
                  const rows: Row[] = detail?.items
                    ? [
                        ...detail.items.map((l: Row) => ({
                          Item:
                            l.quality ??
                            state.qualities.find((q: Row) => q.id === l.quality_id)?.name ??
                            '',
                          Carats: ct(l.carats),
                          'Rate ₹ / ct': money(Number(l.rate) * 100),
                          'Less %': l.less_pct,
                          Amount: money(l.net),
                        })),
                        ...(detail.expenses ?? []).map((x: Row) => ({
                          Item: `Expense (${x.mode}): ${x.description}`,
                          Carats: '',
                          'Rate ₹ / ct': '',
                          'Less %': '',
                          Amount: money(x.amount),
                        })),
                        ...(detail.adjustments ?? []).map((x: Row) => ({
                          Item: `Adjustment: ${x.description}`,
                          Carats: '',
                          'Rate ₹ / ct': '',
                          'Less %': '',
                          Amount: money(x.amount),
                        })),
                        ...(detail.brokerages ?? []).map((x: Row) => ({
                          Item: `Brokerage (${x.broker ?? x.broker_id})`,
                          Carats: '',
                          'Rate ₹ / ct': x.mode,
                          'Less %': x.input_value,
                          Amount: money(x.amount),
                        })),
                      ]
                    : detail?.lines
                      ? detail.lines.map((l: Row) => ({
                          Account: l.account,
                          Debit: money(l.debit),
                          Credit: money(l.credit),
                        }))
                      : [
                          {
                            Reference: detail?.number,
                            Amount: money(detail?.amount ?? detail?.principal ?? 0),
                          },
                        ]
                  rows.push(
                    Object.fromEntries(
                      Object.keys(rows[0] ?? {}).map((k, i) => [
                        k,
                        i === 0
                          ? 'Document total'
                          : i === Object.keys(rows[0] ?? {}).length - 1
                            ? money(
                                detail?.supplier_total ??
                                  detail?.invoice_total ??
                                  detail?.amount ??
                                  detail?.principal ??
                                  0,
                              )
                            : '',
                      ]),
                    ),
                  )
                  const r = await window.diamo.export(
                    format,
                    `${detail?.number} · ${detail?.party ?? ''} · ${displayDate(detail?.bill_date ?? detail?.payment_date ?? detail?.entry_date ?? detail?.loan_date)}`,
                    rows,
                  )
                  if (!r.ok) setError(r.error)
                }}
              >
                {format === 'print' ? 'Print document' : `Export ${format.toUpperCase()}`}
              </button>
            ))}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )
    }

    return (
      <form className="drawer-form" onSubmit={submit}>
        <div className="drawer-body">
          {form._edit && f('editReason', 'Reason for edit', 'text', undefined, true)}
          {formContent()}
          {form._preview && (
            <section className="review-totals">
              <h3>Review calculated totals</h3>
              <dl>
                {[
                  [
                    'Invoice total',
                    form._preview.supplier ?? form._preview.invoice,
                    form._preview.supplierUsd ?? form._preview.invoiceUsd,
                  ],
                  ['Inventory cost', form._preview.stock, form._preview.stockUsd],
                  ['Brokerage', form._preview.brokerTotal, undefined],
                  ['Net proceeds', form._preview.proceeds, form._preview.proceedsUsd],
                  ['Cost of goods sold', form._preview.cogs, undefined],
                  ['Trading profit', form._preview.profit, undefined],
                ]
                  .filter(([, v]) => v !== undefined)
                  .map(([label, value, usdVal]) => (
                    <React.Fragment key={String(label)}>
                      <dt>{label}</dt>
                      <dd>
                        {usdVal !== undefined ? (
                          <CurrencyAmount
                            currency={form._preview.displayCurrency}
                            inrPaise={Number(value)}
                            usdAmount={usdVal ? String(usdVal) : ''}
                            exchangeRate={form._preview.exchangeRate}
                            size="md"
                            align="right"
                          />
                        ) : (
                          money(Number(value))
                        )}
                      </dd>
                    </React.Fragment>
                  ))}
              </dl>
              <p>Confirm to save this transaction and its accounting entries.</p>
            </section>
          )}
          {error && (
            <div className="error banner" role="alert">
              {error}
            </div>
          )}
        </div>
        <footer className="drawer-footer">
          <button type="button" onClick={() => setModal(null)}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy
              ? 'Saving…'
              : modal === 'purchase' || modal === 'sale'
                ? form._preview
                  ? 'Confirm & post'
                  : 'Review totals'
                : 'Save'}
          </button>
        </footer>
      </form>
    )
  }

  return (
    <ReportContext.Provider value={`${displayDate(query.from)} to ${displayDate(query.to)}`}>
      <div className={'app ' + (collapsed ? 'collapsed' : '')}>
        <aside className="sidebar">
          <div className="sidebar-brand">
            <img src={state.companyLogo ?? logo} alt="DIAMO brand" />
            <div>
              <strong>DIAMO</strong>
              <small>TRADING WORKSPACE</small>
            </div>
          </div>
          <nav>
            {pages.map(([group, name, Icon], i) => (
              <React.Fragment key={name}>
                {(i === 0 || pages[i - 1][0] !== group) && <div className="nav-group">{group}</div>}
                <button
                  type="button"
                  title={name}
                  className={page === name ? 'selected' : ''}
                  onClick={() => {
                    setPage(name)
                    setError('')
                  }}
                >
                  <Icon size={18} />
                  <span>{name}</span>
                </button>
              </React.Fragment>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <button type="button" onClick={() => setCollapsed(!collapsed)}>
              <Menu size={18} />
              <span>{collapsed ? 'Expand menu' : 'Collapse menu'}</span>
            </button>
            <button type="button" onClick={() => command('auth.logout', {})}>
              <LogOut size={18} />
              <span>Administrator · Sign out</span>
            </button>
            <small>
              <span className="online-dot" />
              Offline · Local storage
            </small>
          </div>
        </aside>

        <div className="workspace">
          <header className="topbar">
            <div className="company-selector">
              <Building2 size={19} />
              <select
                aria-label="Active company"
                name="active_company"
                value={state.companyId ?? ''}
                onChange={(e) => command('companies.select', { id: e.target.value })}
              >
                <option value="">Select company</option>
                {state.companies?.map((c: Row) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="global-search">
              <Search size={15} />
              <input
                aria-label="Search workspace"
                placeholder="Search pages, invoices, slip no. or stone Sr.…"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
              />
              {globalSearch && (
                <div className="search-results">
                  {pages
                    .filter(([, name]) => name.toLowerCase().includes(globalSearch.toLowerCase()))
                    .map(([, name]) => (
                      <button
                        type="button"
                        key={name}
                        onClick={() => {
                          setPage(name)
                          setGlobalSearch('')
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  {[
                    ...(state.purchases ?? []).map((d: Row) => ({ ...d, _kind: 'purchase' })),
                    ...(state.sales ?? []).map((d: Row) => ({ ...d, _kind: 'sale' })),
                  ]
                    .filter((d) =>
                      `${d.number} ${d.slip_no ?? ''} ${d.party}`
                        .toLowerCase()
                        .includes(globalSearch.toLowerCase()),
                    )
                    .slice(0, 6)
                    .map((d) => (
                      <button
                        type="button"
                        key={d._kind + d.id}
                        onClick={() => {
                          setDetail(d)
                          setModal('detail')
                          setGlobalSearch('')
                        }}
                      >
                        {d.number}
                        {d.slip_no ? ` (Slip ${d.slip_no})` : ''} · {d.party}
                      </button>
                    ))}
                  {(state.stones ?? [])
                    .filter((s: Row) =>
                      `${s.sr_no} ${s.report_number ?? ''} ${s.quality} ${s.slip_no ?? ''}`
                        .toLowerCase()
                        .includes(globalSearch.toLowerCase()),
                    )
                    .slice(0, 6)
                    .map((s: Row) => (
                      <button
                        type="button"
                        key={`stone-${s.id}`}
                        onClick={() => {
                          setDetail(s)
                          setModal('stoneDetail')
                          setGlobalSearch('')
                        }}
                      >
                        {s.sr_no || `#${s.id}`} · {s.quality}
                        {s.report_number ? ` · ${s.lab || 'Lab'} #${s.report_number}` : ''}
                        {s.slip_no ? ` · Slip ${s.slip_no}` : ''}
                      </button>
                    ))}
                </div>
              )}
            </div>
            <div className="topbar-right">
              {state.companyId && (
                <button type="button" className="due-button" onClick={() => setModal('dues')}>
                  {openDues.filter((o: Row) => o.overdue).length} overdue
                </button>
              )}
              <select
                aria-label="Financial year"
                name="financial_year"
                className="fy"
                value={fy(query.to)}
                onChange={(e) => {
                  const y = e.target.value.slice(0, 4)
                  setQuery({ from: y + '-04-01', to: Number(y) + 1 + '-03-31' })
                }}
              >
                {Array.from({ length: 15 }, (_, i) => Number(fy(today()).slice(0, 4)) - 10 + i).map(
                  (y) => (
                    <option key={y} value={`${y}-${String(y + 1).slice(2)}`}>
                      FY {y}-{String(y + 1).slice(2)}
                    </option>
                  ),
                )}
              </select>
              <span className="local-badge">
                <span className="online-dot" />
                Offline
              </span>
              <div className="avatar">A</div>
            </div>
          </header>

          <main className="content">
            <div className="page-heading">
              <div>
                <div className="eyebrow">YOUR BUSINESS, CLEARLY</div>
                <h1>{page}</h1>
                <p>
                  {page === 'Dashboard'
                    ? 'A clear view of your trading, stock and financial position.'
                    : `Manage and review your ${page.toLowerCase()} in one place.`}
                </p>
              </div>
              {addMap[page] && (
                <button
                  type="button"
                  className="primary"
                  disabled={!state.companyId && page !== 'Manage Companies'}
                  onClick={() => open(addMap[page][0])}
                >
                  <Plus size={18} />
                  {addMap[page][1]}
                </button>
              )}
            </div>

            {state.companyId && (
              <div className="date-bar">
                <label>
                  From{' '}
                  <input
                    aria-label="From date"
                    type="date"
                    value={query.from}
                    onChange={(e) => setQuery({ ...query, from: e.target.value })}
                  />
                </label>
                <label>
                  Through{' '}
                  <input
                    aria-label="Through date"
                    type="date"
                    value={query.to}
                    onChange={(e) => setQuery({ ...query, to: e.target.value })}
                  />
                </label>
                <button type="button" onClick={() => setQuery({ from: today(), to: today() })}>
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setQuery({ from: today().slice(0, 7) + '-01', to: today() })}
                >
                  This month
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setQuery({ from: fy(today()).slice(0, 4) + '-04-01', to: today() })
                  }
                >
                  This FY
                </button>
                <span className="spacer" />
                <small>Balances as of {displayDate(query.to)}</small>
              </div>
            )}

            {error && !modal && (
              <div className="error banner" role="alert">
                <AlertCircle size={18} />
                {error}
              </div>
            )}
            {notice && (
              <div className="success banner">
                <CheckCircle2 size={17} />
                {notice}
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  onClick={() => setNotice('')}
                >
                  <X size={15} />
                </button>
              </div>
            )}

            {content()}
          </main>

          <footer className="app-footer">
            DIAMO_TREADING · INR · Accrual accounting
            <span>All data stays on your computer</span>
          </footer>
        </div>

        {modal && (
          <Drawer
            title={
              modal === 'detail'
                ? (detail?.number ?? 'Transaction details')
                : modal === 'partyProfile'
                  ? (detail?.name ?? 'Party profile')
                  : (drawerTitles[modal] ?? 'Details')
            }
            size={getDrawerSize(modal)}
            close={() => {
              setModal(null)
              setError('')
            }}
          >
            {drawerContent()}
          </Drawer>
        )}

        {confirmState && (
          <ConfirmDialog state={confirmState} busy={busy} close={() => setConfirmState(null)} />
        )}

        {state.recoveryPrompt && state.pendingRecoveryKey && !modal && (
          <OnboardingRecoveryDrawer
            recoveryKey={state.pendingRecoveryKey}
            canEnrollPin={Boolean(state.recoveryStatus?.canEnroll)}
            onDone={async () => {
              await refresh(state.companyId)
            }}
          />
        )}

        {recoveryModal && (
          <SettingsRecoveryDrawer
            kind={recoveryModal}
            close={() => setRecoveryModal(null)}
            onSuccess={async (msg) => {
              setNotice(msg)
              await refresh(state.companyId)
            }}
          />
        )}

        <SoftwareUpdateModal
          open={
            updateModalOpen && !state.recoveryPrompt && !modal && !confirmState && !recoveryModal
          }
          info={
            updateInfo && updateInfo.status === 'success' && updateInfo.updateAvailable
              ? updateInfo
              : null
          }
          onDismiss={() => setUpdateModalOpen(false)}
          onDownload={(url) => {
            setUpdateModalOpen(false)
            void openExternalUrl(url)
          }}
        />
      </div>
    </ReportContext.Provider>
  )
}
