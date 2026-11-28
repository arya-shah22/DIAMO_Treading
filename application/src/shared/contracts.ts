import { z } from 'zod'
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + 'T00:00:00Z')
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === v
  }, 'Enter a valid calendar date')
export const decimal = z
  .string()
  .regex(/^\d+(\.\d{1,8})?$/, 'Use a nonnegative decimal, up to 8 decimal places')
  .refine((v) => Number(v) <= 1e10, 'Amount exceeds supported limit')
export const amount = z.number().int().min(0).max(1e13)
export const id = z.number().int().positive()
export const text = z.string().trim().min(1).max(250)
export const upperText = text.transform((v) => v.toUpperCase())
const optionalText = z.string().max(2000).default('')
const upperOptionalText = optionalText.transform((v) => v.toUpperCase())
const shortField = z.string().trim().max(120).default('')
const upperShortField = shortField.transform((v) => v.toUpperCase())
const optionalDecimal = z
  .string()
  .trim()
  .refine(
    (v) => v === '' || (/^\d+(\.\d{1,8})?$/.test(v) && Number(v) <= 1e10),
    'Use a nonnegative decimal, up to 8 decimal places',
  )
  .default('')
export const stoneSpecs = z.object({
  srNo: upperShortField,
  availability: z.enum(['available', 'hold']).default('available'),
  unbilled: z.boolean().default(false),
  shape: upperShortField,
  color: upperShortField,
  fancyColor: upperShortField,
  colorIntensity: upperShortField,
  colorOvertone: upperShortField,
  clarity: upperShortField,
  cut: upperShortField,
  polish: upperShortField,
  symmetry: upperShortField,
  ratio: optionalDecimal,
  lengthMm: optionalDecimal,
  widthMm: optionalDecimal,
  heightMm: optionalDecimal,
  depthPct: optionalDecimal,
  tablePct: optionalDecimal,
  fluorescence: upperShortField,
  lab: upperShortField,
  reportNumber: upperShortField,
  growth: z.enum(['', 'CVD', 'HPHT']).default(''),
  priceCurrency: z.enum(['INR', 'USD']).default('INR'),
  exchangeRate: optionalDecimal,
  rateUsd: optionalDecimal,
  totalUsd: optionalDecimal,
  rateInr: optionalDecimal,
  totalInr: optionalDecimal,
})
const line = z.object({
  qualityId: id,
  carats: amount.refine((v) => v > 0),
  rate: decimal,
  less: decimal.default('0').refine((v) => Number(v) <= 100),
  lots: z.array(z.object({ lotId: id, carats: amount.refine((v) => v > 0) })).default([]),
  priceCurrency: z.enum(['INR', 'USD']).optional(),
  exchangeRate: optionalDecimal,
  rateUsd: optionalDecimal,
  totalUsd: optionalDecimal,
  stone: stoneSpecs.optional(),
})
const brokerage = z.object({
  brokerId: id,
  itemIndex: z.number().int().min(0).nullable(),
  mode: z.enum(['fixed', 'percent']),
  value: decimal,
})
export const trade = z.object({
  date,
  partyId: id,
  dueDays: z.number().int().min(0).max(36500),
  slipNo: upperShortField,
  remarks: upperOptionalText,
  lines: z.array(line).min(1).max(200),
  expenses: z
    .array(
      z.object({
        description: upperText,
        amount: amount.refine((v) => v > 0),
        mode: z.enum(['supplier', 'separate']),
        accountId: id.nullable(),
      }),
    )
    .default([]),
  brokerages: z.array(brokerage).default([]),
  adjustments: z
    .array(z.object({ description: upperText, amount: z.number().int().min(-1e13).max(1e13) }))
    .default([]),
  confirmNegative: z.boolean().default(false),
})
export const payment = z.object({
  date,
  partyId: id,
  direction: z.enum(['pay', 'receive']),
  accountId: id,
  amount: amount.refine((v) => v > 0),
  mode: upperText,
  reference: upperOptionalText,
  remarks: upperOptionalText,
  automatic: z.boolean().default(true),
  allocations: z.array(z.object({ itemId: id, amount: amount.refine((v) => v > 0) })).default([]),
  confirmNegative: z.boolean().default(false),
})
export const loan = z.object({
  date,
  partyId: id,
  kind: z.enum(['taken', 'given']),
  principal: amount.refine((v) => v > 0),
  rate: decimal,
  frequency: z.enum(['monthly', 'yearly']),
  returnDate: date.nullable(),
  accountId: id,
  remarks: upperOptionalText,
  confirmNegative: z.boolean().default(false),
})
export const journal = z.object({
  date,
  reference: upperOptionalText,
  narration: upperText,
  lines: z
    .array(z.object({ accountId: id, debit: amount, credit: amount }))
    .min(2)
    .max(200),
  confirmNegative: z.boolean().default(false),
})
export const commands = {
  'auth.login': z.object({ email: text, password: z.string().min(1).max(200) }),
  'auth.logout': z.object({}),
  'auth.recoveryStatus': z.object({}),
  'auth.acknowledgeRecovery': z.object({}),
  'auth.rotateRecovery': z.object({ currentPassword: z.string().min(1).max(200) }),
  'auth.enrollPin': z.object({
    currentPassword: z.string().min(1).max(200),
    pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
  }),
  'auth.removePin': z.object({ currentPassword: z.string().min(1).max(200) }),
  'auth.reset': z.object({
    username: text,
    recoveryKey: z.string().min(1).max(500),
    newPassword: z.string().min(6).max(200),
  }),
  'auth.resetPin': z.object({
    username: text,
    pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
    newPassword: z.string().min(6).max(200),
  }),
  'auth.username': z.object({
    newUsername: text,
    currentPassword: z.string().min(1).max(200),
  }),
  'auth.password': z.object({ oldPassword: z.string(), newPassword: z.string().min(6).max(200) }),
  'companies.create': z.object({
    name: upperText,
    date,
    address: upperOptionalText,
    contact: upperOptionalText,
  }),
  'companies.select': z.object({ id: z.string().uuid() }),
  'companies.setDefault': z.object({ id: z.string().uuid().nullable() }),
  'party.save': z.object({
    id: id.optional(),
    name: upperText,
    roles: z.array(z.enum(['supplier', 'customer', 'broker', 'other'])).min(1),
    contactPerson: upperOptionalText,
    phone: upperOptionalText,
    email: optionalText,
    address: upperOptionalText,
    pan: upperOptionalText,
    gstin: upperOptionalText,
    creditDays: z.number().int().min(0).max(36500),
    remarks: upperOptionalText,
    active: z.boolean(),
  }),
  'quality.save': z.object({
    id: id.optional(),
    name: upperText,
    description: upperOptionalText,
    hike: decimal.nullable(),
    inventoryMode: z.enum(['bulk', 'individual']).default('bulk'),
    active: z.boolean(),
  }),
  'stone.setStatus': z.object({
    id,
    availability: z.enum(['available', 'hold']),
    unbilled: z.boolean().optional(),
  }),
  'bank.save': z.object({
    id: id.optional(),
    name: upperText,
    holder: upperOptionalText,
    number: upperOptionalText,
    ifsc: upperOptionalText,
    active: z.boolean(),
  }),
  'account.save': z.object({
    name: upperText,
    kind: z.enum(['asset', 'liability', 'equity', 'income', 'expense']),
  }),
  'purchase.post': trade,
  'sale.post': trade,
  'purchase.preview': trade,
  'sale.preview': trade,
  'payment.post': payment,
  'advance.apply': z.object({
    advanceId: id,
    itemId: id,
    amount: amount.refine((v) => v > 0),
    date,
  }),
  'loan.post': loan,
  'loan.settle': z.object({
    id,
    date,
    accountId: id,
    interest: amount,
    close: z.boolean(),
    confirmNegative: z.boolean().default(false),
  }),
  'journal.post': journal,
  'transfer.post': z.object({
    date,
    source: id,
    destination: id,
    amount: amount.refine((v) => v > 0),
    confirmNegative: z.boolean().default(false),
  }),
  'document.previewEdit': z.object({
    kind: z.enum(['purchase', 'sale', 'payment', 'loan', 'journal', 'transfer']),
    id,
    reason: upperText,
    input: z.unknown(),
  }),
  'document.edit': z.object({
    kind: z.enum(['purchase', 'sale', 'payment', 'loan', 'journal', 'transfer']),
    id,
    reason: upperText,
    input: z.unknown(),
  }),
  'advance.reverse': z.object({ id, reason: upperText }),
  'loan.reverseSettlement': z.object({ id, reason: upperText }),
  'document.cancel': z.object({
    kind: z.enum(['purchase', 'sale', 'payment', 'loan', 'journal', 'transfer']),
    id,
    reason: upperText,
  }),
  'settings.numbering': z.object({
    kind: z.enum(['PUR', 'SAL', 'PAY', 'REC', 'LT', 'LG', 'JV', 'TRF']),
    year: z.string().regex(/^\d{4}-\d{2}$/),
    nextNumber: z.number().int().min(1).max(999999999),
  }),
  'settings.save': z.object({
    name: upperText,
    address: upperOptionalText,
    contact: upperOptionalText,
    hike: decimal,
    creditDays: z.number().int().min(0).max(36500),
  }),
  'opening.post': z.object({
    date,
    lines: z.array(z.object({ accountId: id, debit: amount, credit: amount })).min(1),
    lots: z.array(
      z.object({ qualityId: id, date, carats: amount.refine((v) => v > 0), cost: amount }),
    ),
    bills: z.array(
      z.object({
        partyId: id,
        direction: z.enum(['pay', 'receive']),
        amount: amount.refine((v) => v > 0),
        reference: upperText,
        date,
        dueDate: date,
      }),
    ),
    advances: z.array(
      z.object({
        partyId: id,
        direction: z.enum(['paid', 'received']),
        amount: amount.refine((v) => v > 0),
      }),
    ),
    loans: z.array(
      z.object({
        partyId: id,
        kind: z.enum(['taken', 'given']),
        principal: amount.refine((v) => v > 0),
        rate: decimal,
        frequency: z.enum(['monthly', 'yearly']),
        date,
        paidInterest: amount,
        accruedInterest: amount,
      }),
    ),
  }),
} as const
export type Command = keyof typeof commands
export type Input<C extends Command> = z.input<(typeof commands)[C]>
export type Trade = z.infer<typeof trade>
export type Payment = z.infer<typeof payment>
export type Loan = z.infer<typeof loan>
export type Journal = z.infer<typeof journal>
export type Row = Record<string, any>
export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string }
export type Query = { from: string; to: string; partyId?: number }
export interface SystemInfo {
  version: string
  platform: string
  arch: string
  isPackaged: boolean
  repo: string
  dataPath: string
}
export type UpdateInfo =
  | {
      status: 'success'
      currentVersion: string
      latestVersion: string
      updateAvailable: boolean
      releaseName: string
      releaseNotes: string
      publishedAt: string
      downloadUrl: string
      releaseUrl: string
    }
  | {
      status: 'unavailable' | 'offline'
      currentVersion: string
      updateAvailable: false
      message: string
      releaseUrl: string
    }
export interface Api {
  command<C extends Command>(
    name: C,
    input: Input<C>,
    companyId?: string,
    operationKey?: string,
  ): Promise<Result<any>>
  state(companyId?: string, query?: Query): Promise<Result<any>>
  export(
    format: 'csv' | 'xlsx' | 'pdf' | 'print',
    title: string,
    rows: Row[],
  ): Promise<Result<string>>
  logo(companyId: string): Promise<Result<string>>
  saveRecoveryPdf(): Promise<Result<string>>
  systemInfo(): Promise<Result<SystemInfo>>
  checkUpdate(): Promise<Result<UpdateInfo>>
  openExternal(url: string): Promise<Result<boolean>>
  backup(
    action: 'create' | 'restore' | 'configure' | 'history',
    options?: {
      intervalHours: number
      retention: number
      onExit: boolean
      scope: 'full' | 'company'
    },
  ): Promise<Result<any>>
}
declare global {
  interface Window {
    diamo: Api
  }
}
