import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import ExcelJS from 'exceljs'
import { CompanyService } from '../src/main/services/company'
import { ApplicationService } from '../src/main/services/application'
import { openDatabase } from '../src/main/database'
import { writeReport } from '../src/main/services/reports'
import { hashArgon2id, isLegacyBcryptHash, verifySecret } from '../src/main/services/crypto'
import type { SafeStorageAdapter } from '../src/main/services/recovery'
import appV1Sql from '../src/main/database/migrations/app-v1.sql?raw'
import companyV1Sql from '../src/main/database/migrations/company-v1.sql?raw'
import { allocate, interest, fy, lineValue } from '../src/shared/math'
import { date } from '../src/shared/contracts'

let dir: string, c: CompanyService
let supplier: number, customer: number, broker: number, quality: number, cash: number

const trade = (partyId: number, lines: any[], extra = {}) => ({
  date: '2026-11-03',
  partyId,
  dueDays: 0,
  remarks: '',
  lines: lines.map((l) => ({
    qualityId: quality,
    carats: l[0] * 100,
    rate: String(l[1]),
    less: '0',
    lots: [],
  })),
  expenses: [],
  brokerages: [],
  adjustments: [],
  ...extra,
})

const purchase = (ct: number, rate: number, d = '2026-11-01', extra = {}) =>
  c.execute('purchase.post', trade(supplier, [[ct, rate]], { date: d, ...extra }))

const sale = (ct: number, rate = 6000, extra = {}) =>
  c.execute('sale.post', trade(customer, [[ct, rate]], extra))

const payment = (amount: number, extra = {}) =>
  c.execute('payment.post', {
    date: '2026-11-04',
    partyId: supplier,
    direction: 'pay',
    accountId: cash,
    amount: amount * 100,
    mode: 'Cash',
    reference: '',
    remarks: '',
    automatic: true,
    allocations: [],
    confirmNegative: true,
    ...extra,
  })

const snap = () => c.snapshot({ from: '2026-04-01', to: '2027-03-31' })

function balanced() {
  const s = snap()
  expect(s.totals.balanceDifference).toBe(0)
  expect(s.totals.trialDifference).toBe(0)
  expect(s.totals.stockCost).toBe(c.balance(c.account('INV')))
  expect(c.db.pragma('integrity_check', { simple: true })).toBe('ok')
  expect(c.db.pragma('foreign_key_check')).toEqual([])
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'diamo-test-'))
  c = new CompanyService(openDatabase(join(dir, 'company.sqlite'), 'company'))
  c.run("INSERT INTO company_profile(id,name,start_date) VALUES(1,'Test','2026-04-01')")
  const party = (name: string, roles: string[]) => {
    const r = c.execute('party.save', { name, roles, creditDays: 0, active: true }) as any
    return r.id
  }
  supplier = party('Supplier', ['supplier'])
  customer = party('Customer', ['customer'])
  broker = party('Broker', ['broker'])
  quality = (c.execute('quality.save', { name: 'CVD ROUND', hike: null, active: true }) as any).id
  cash = c.account('CASH')
})

afterEach(() => {
  c.db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('Financial invariants and supplied acceptance vectors', () => {
  it('T04 FIFO and T26 reconciliation', () => {
    purchase(50, 4000)
    purchase(100, 5000, '2026-11-02')
    const s = sale(40) as any
    expect(s.cogs).toBe(16000000)
    expect(snap().totals.stockCost).toBe(54000000)
    expect(snap().totals.stockCarats).toBe(11000)
    balanced()
  })

  it('T05 manual second-lot selection', () => {
    purchase(50, 4000)
    purchase(100, 5000, '2026-11-02')
    const result = c.execute(
      'sale.post',
      trade(customer, [[40, 6000]], {
        lines: [
          {
            qualityId: quality,
            carats: 4000,
            rate: '6000',
            less: '0',
            lots: [{ lotId: 2, carats: 4000 }],
          },
        ],
      }),
    ) as any
    expect(result.cogs).toBe(20000000)
    expect(snap().totals.stockCost).toBe(50000000)
    balanced()
  })

  it('T03 multiple categories reconcile independently', () => {
    purchase(50, 4000)
    purchase(100, 5000)
    const q = (c.execute('quality.save', { name: 'CVD FENCY', hike: null, active: true }) as any).id
    c.execute(
      'purchase.post',
      trade(supplier, [], {
        date: '2026-11-01',
        lines: [{ qualityId: q, carats: 20000, rate: '1000', less: '0' }],
      }),
    )
    sale(40)
    c.execute(
      'sale.post',
      trade(customer, [], { lines: [{ qualityId: q, carats: 5000, rate: '1500', less: '0' }] }),
    )
    expect(snap().totals.stockCarats).toBe(26000)
    balanced()
  })

  it('T06 oversell and acquisition-date rejection rolls back document and sequence', () => {
    purchase(10, 100)
    const before = c.all('SELECT * FROM number_sequences')
    expect(() => sale(11)).toThrow('Insufficient')
    expect(() => sale(1, 200, { date: '2026-10-01' })).toThrow('Insufficient')
    expect(c.all('SELECT * FROM sales')).toHaveLength(0)
    expect(c.all('SELECT * FROM number_sequences')).toEqual(before)
    balanced()
  })

  it('T07 expense proportional allocation', () => {
    const result = c.execute(
      'purchase.post',
      trade(
        supplier,
        [
          [50, 4000],
          [100, 3000],
        ],
        {
          lines: [
            { qualityId: quality, carats: 5000, rate: '4000', less: '5' },
            { qualityId: quality, carats: 10000, rate: '3000', less: '2' },
          ],
          expenses: [{ description: 'Freight', amount: 500000, mode: 'supplier', accountId: null }],
        },
      ),
    ) as any
    expect(c.all('SELECT amount FROM purchase_expense_allocations').map((r) => r.amount)).toEqual([
      196281, 303719,
    ])
    expect(result.stock).toBe(48900000)
    balanced()
  })

  it.each(['supplier', 'separate'] as const)('T08/T09 expense creditor %s', (mode) => {
    const r = c.execute(
      'purchase.post',
      trade(supplier, [[10, 10000]], {
        expenses: [
          {
            description: 'Expense',
            amount: 200000,
            mode,
            accountId: mode === 'separate' ? cash : null,
          },
        ],
        confirmNegative: true,
      }),
    ) as any
    expect(r.stock).toBe(10200000)
    expect(r.supplier).toBe(mode === 'supplier' ? 10200000 : 10000000)
    expect(c.balance(cash)).toBe(mode === 'supplier' ? 0 : -200000)
    balanced()
  })

  it('T10 receivable, brokerage and profit + broker settlement clears payable', () => {
    purchase(10, 8000)
    const s = c.execute(
      'sale.post',
      trade(customer, [[10, 10000]], {
        lines: [{ qualityId: quality, carats: 1000, rate: '10000', less: '5' }],
        brokerages: [{ brokerId: broker, itemIndex: null, mode: 'percent', value: '2' }],
        adjustments: [{ description: 'Additional charge', amount: 100000 }],
      }),
    ) as any
    expect(s.invoice).toBe(9600000)
    expect(s.brokerTotal).toBe(190000)
    expect(s.profit).toBe(1410000)
    // Settle brokerage payable without expensing twice
    c.execute('payment.post', {
      date: '2026-11-05',
      partyId: broker,
      direction: 'pay',
      accountId: cash,
      amount: 190000,
      mode: 'Cash',
      reference: 'BRK-1',
      remarks: '',
      automatic: true,
      allocations: [],
      confirmNegative: true,
    })
    expect(c.balance(c.account('BROKER'))).toBe(0)
    expect(c.balance(c.account('BROKER_EXP'))).toBe(190000)
    balanced()
  })

  it('T11 fixed brokerage and deduction; per-line brokerage; disallow duplicate scope', () => {
    purchase(10, 100)
    const s = sale(5, 200, {
      brokerages: [{ brokerId: broker, itemIndex: 0, mode: 'fixed', value: '50' }],
      adjustments: [{ description: 'Discount', amount: -1000 }],
    }) as any
    expect(s.invoice).toBe(99000)
    expect(s.brokerTotal).toBe(5000)
    expect(() =>
      sale(1, 200, {
        brokerages: [
          { brokerId: broker, itemIndex: 0, mode: 'fixed', value: '5' },
          { brokerId: broker, itemIndex: null, mode: 'fixed', value: '5' },
        ],
      }),
    ).toThrow('not both')
    balanced()
  })

  it('T12 oldest-first payment allocation', () => {
    purchase(1, 50000)
    purchase(1, 100000)
    purchase(1, 75000)
    payment(125000)
    expect(c.all('SELECT amount FROM payment_allocations').map((r) => r.amount)).toEqual([
      5000000, 7500000,
    ])
    expect(snap().openItems.reduce((s, o) => s + o.outstanding, 0)).toBe(10000000)
    balanced()
  })

  it('T13 advance application never moves cash twice & advance.reverse restores state', () => {
    purchase(1, 50000)
    purchase(1, 100000)
    purchase(1, 75000)
    payment(250000)
    expect(snap().advances[0].remaining).toBe(2500000)
    purchase(1, 30000, '2026-11-05')
    const cashBefore = c.balance(cash)
    const applied = c.execute('advance.apply', {
      advanceId: 1,
      itemId: 4,
      amount: 2500000,
      date: '2026-11-05',
    }) as any
    expect(c.balance(cash)).toBe(cashBefore)
    expect(c.outstanding(4).outstanding).toBe(500000)
    expect(() => c.execute('document.cancel', { kind: 'payment', id: 1, reason: 'test' })).toThrow(
      'advance has been applied',
    )
    c.execute('advance.reverse', { id: applied.id, reason: 'Undo advance application' })
    expect(c.balance(cash)).toBe(cashBefore)
    expect(c.outstanding(4).outstanding).toBe(3000000)
    expect(snap().advances[0].remaining).toBe(2500000)
    balanced()
  })

  it('T14 manual partial allocation and cancellation', () => {
    purchase(1, 50000)
    payment(10000, { automatic: false, allocations: [{ itemId: 1, amount: 1000000 }] })
    c.execute('document.cancel', { kind: 'payment', id: 1, reason: 'Incorrect entry' })
    expect(c.outstanding(1).outstanding).toBe(5000000)
    balanced()
  })

  it('T15 loan 81-day interest, full settlement & reverseSettlement cleanup', () => {
    const l = c.execute('loan.post', {
      date: '2026-11-26',
      partyId: supplier,
      kind: 'taken',
      principal: 50000000,
      rate: '1',
      frequency: 'monthly',
      returnDate: null,
      accountId: cash,
    }) as any
    c.execute('loan.settle', {
      id: l.id,
      date: '2026-12-26',
      accountId: cash,
      interest: 500000,
      close: false,
      confirmNegative: true,
    })
    const loan = c.one('SELECT * FROM loans')
    expect(c.loanAccrual(loan, '2027-02-15').outstanding).toBe(850000)
    c.execute('loan.settle', {
      id: l.id,
      date: '2027-02-15',
      accountId: cash,
      interest: 850000,
      close: true,
      confirmNegative: true,
    })
    expect(c.one('SELECT * FROM loan_settlements').principal).toBe(50000000)
    expect(snap().loans[0].outstanding).toBe(0)
    // Reverse full settlement, then reverse interest payment, then cancel loan cleanly
    c.execute('loan.reverseSettlement', { id: l.id, reason: 'Reopen closed loan' })
    expect(c.one('SELECT status FROM loans WHERE id=?', l.id).status).toBe('open')
    expect(c.loanAccrual(loan, '2027-02-15').outstanding).toBe(850000)
    c.execute('loan.reverseSettlement', { id: l.id, reason: 'Reverse first interest payment' })
    expect(
      c.all('SELECT * FROM loan_interest_entries WHERE loan_id=? AND active=1', l.id),
    ).toHaveLength(0)
    c.execute('document.cancel', { kind: 'loan', id: l.id, reason: 'Cancel cleanly' })
    const cancelledLoan = snap().loans.find((x) => x.id === l.id)
    expect(cancelledLoan).toMatchObject({
      status: 'cancelled',
      accrued: 0,
      paid: 0,
      outstanding: 0,
    })
    const dayBookDebits = snap().ledger.reduce((s, r) => s + r.debit, 0)
    const dayBookCredits = snap().ledger.reduce((s, r) => s + r.credit, 0)
    expect(dayBookDebits).toBe(dayBookCredits)
    balanced()
  })

  it('T16 yearly and zero interest; T17 principal remains until full settlement', () => {
    expect(interest(50000000, '12', 'yearly', '2026-01-01', '2027-01-01')).toBe(6000000)
    expect(interest(50000000, '0', 'monthly', '2026-01-01', '2027-01-01')).toBe(0)
    const l = c.execute('loan.post', {
      date: '2026-11-01',
      partyId: supplier,
      kind: 'taken',
      principal: 10000000,
      rate: '1',
      frequency: 'monthly',
      returnDate: null,
      accountId: cash,
    }) as any
    c.execute('loan.settle', {
      id: l.id,
      date: '2026-12-01',
      accountId: cash,
      interest: 100000,
      close: false,
    })
    expect(c.one('SELECT principal,status FROM loans')).toEqual({
      principal: 10000000,
      status: 'open',
    })
    expect(() =>
      c.execute('loan.settle', {
        id: l.id,
        date: '2026-12-02',
        accountId: cash,
        interest: 999999,
        close: false,
      }),
    ).toThrow()
    balanced()
  })

  it('T18 negative funds warning is atomic', () => {
    purchase(1, 100)
    expect(() => payment(100, { confirmNegative: false })).toThrow('NEGATIVE_FUNDS')
    expect(c.all('SELECT * FROM payments')).toHaveLength(0)
    payment(100)
    expect(c.balance(cash)).toBe(-10000)
    balanced()
  })

  it('T19 transfer preserves funds and P&L, supports edit and cancel', () => {
    c.execute('journal.post', {
      date: '2026-11-01',
      narration: 'Capital',
      lines: [
        { accountId: cash, debit: 5000000, credit: 0 },
        { accountId: c.account('CAP'), debit: 0, credit: 5000000 },
      ],
    })
    c.execute('bank.save', { name: 'Bank', active: true })
    const bank = c.one('SELECT account_id FROM bank_accounts').account_id
    const trf = c.execute('transfer.post', {
      date: '2026-11-02',
      source: cash,
      destination: bank,
      amount: 2000000,
    }) as any
    expect(c.balance(cash) + c.balance(bank)).toBe(5000000)
    expect(snap().totals.profit).toBe(0)
    c.execute('document.edit', {
      kind: 'transfer',
      id: trf.id,
      reason: 'Update amount',
      input: { date: '2026-11-02', source: cash, destination: bank, amount: 1500000 },
    })
    expect(c.balance(bank)).toBe(1500000)
    expect(snap().transfers).toHaveLength(1)
    expect(snap().transfers[0].number).toBe(trf.number)
    c.execute('document.cancel', { kind: 'transfer', id: trf.id, reason: 'Cancel transfer' })
    expect(c.balance(bank)).toBe(0)
    balanced()
  })

  it('T20 unbalanced journals, protected controls, JV edit/cancel', () => {
    expect(() =>
      c.execute('journal.post', {
        date: '2026-11-01',
        narration: 'bad',
        lines: [
          { accountId: cash, debit: 100, credit: 0 },
          { accountId: c.account('CAP'), debit: 0, credit: 99 },
        ],
      }),
    ).toThrow('balance')
    expect(() =>
      c.execute('journal.post', {
        date: '2026-11-01',
        narration: 'bad',
        lines: [
          { accountId: c.account('INV'), debit: 100, credit: 0 },
          { accountId: c.account('CAP'), debit: 0, credit: 100 },
        ],
      }),
    ).toThrow('subledger')

    const jv = c.execute('journal.post', {
      date: '2026-11-01',
      narration: 'Initial capital',
      lines: [
        { accountId: cash, debit: 5000000, credit: 0 },
        { accountId: c.account('CAP'), debit: 0, credit: 5000000 },
      ],
    }) as any
    c.execute('document.edit', {
      kind: 'journal',
      id: jv.id,
      reason: 'Adjust capital',
      input: {
        date: '2026-11-01',
        narration: 'Updated capital',
        lines: [
          { accountId: cash, debit: 6000000, credit: 0 },
          { accountId: c.account('CAP'), debit: 0, credit: 6000000 },
        ],
      },
    })
    expect(c.balance(cash)).toBe(6000000)
    balanced()
  })

  it('T21 balanced opening stock, bills, advances and loans with prior interest', () => {
    // Loan taken 30 days before 2026-04-01: 100000 * 1% / 30 * 30 = 1000 Rs (100000 paise)
    // Paid 400 Rs (40000 paise), unpaid accrued 600 Rs (60000 paise)
    // Assets: Cash 500000 + Stock 100000 + AR 50000 + AdvPaid 20000 = 670000
    // Liabilities: LoanTaken 10000000 + IntPayable 60000 -> wait let's balance Capital to match!
    c.execute('opening.post', {
      date: '2026-04-01',
      lines: [
        { accountId: cash, debit: 10000000, credit: 0 },
        { accountId: c.account('CAP'), debit: 0, credit: 120000 },
      ],
      lots: [{ qualityId: quality, date: '2026-03-01', carats: 100, cost: 100000 }],
      bills: [
        {
          partyId: customer,
          direction: 'receive',
          amount: 50000,
          reference: 'OLD-1',
          date: '2026-03-01',
          dueDate: '2026-04-01',
        },
      ],
      advances: [{ partyId: supplier, direction: 'paid', amount: 30000 }],
      loans: [
        {
          partyId: supplier,
          kind: 'taken',
          principal: 10000000,
          rate: '1',
          frequency: 'monthly',
          date: '2026-03-02',
          paidInterest: 40000,
          accruedInterest: 60000,
        },
      ],
    })
    expect(snap().inventory[0].purchased).toBe(0)
    sale(1, 2000)
    expect(c.outstanding(1).outstanding).toBe(50000)
    expect(c.snapshot({ from: '2026-04-01', to: '2026-04-01' }).loans[0].outstanding).toBe(60000)
    expect(snap().loans[0].outstanding).toBe(1273333)
    balanced()
  })

  it('T22 projections do not affect ledger', () => {
    purchase(1, 500000)
    c.execute('quality.save', { id: quality, name: 'CVD ROUND', hike: '8', active: true })
    expect(snap().totals.projected).toBe(54000000)
    expect(c.balance(c.account('INV'))).toBe(50000000)
    balanced()
  })

  it('T23 sale edit & cancellation restore lots, COGS and clear row metrics', () => {
    purchase(50, 4000)
    const s = sale(40) as any
    // Preview edit first (does not mutate DB)
    const preview = c.execute('document.previewEdit', {
      kind: 'sale',
      id: s.id,
      reason: 'Preview change',
      input: trade(customer, [[30, 6500]], { date: '2026-11-03' }),
    }) as any
    expect(preview.cogs).toBe(12000000)
    expect(snap().totals.stockCarats).toBe(1000)
    // Apply edit
    c.execute('document.edit', {
      kind: 'sale',
      id: s.id,
      reason: 'Reduce qty',
      input: trade(customer, [[30, 6500]], { date: '2026-11-03' }),
    })
    expect(snap().totals.stockCarats).toBe(2000)
    expect(snap().sales).toHaveLength(1)
    expect(snap().sales[0].number).toBe(s.number)
    // Cancel edited sale
    c.execute('document.cancel', { kind: 'sale', id: s.id, reason: 'Wrong invoice' })
    expect(snap().totals.stockCost).toBe(20000000)
    expect(c.balance(c.account('COGS'))).toBe(0)
    expect(snap().openItems.filter((o) => o.kind === 'sale')).toHaveLength(0)
    expect(snap().sales[0].status).toBe('cancelled')
    expect(snap().sales[0].cogs).toBe(0)
    expect(snap().sales[0].profit).toBe(0)
    balanced()
  })

  it('T24 cannot cancel or edit consumed purchase; purchase edit works before consumption', () => {
    const p = purchase(50, 4000) as any
    c.execute('document.edit', {
      kind: 'purchase',
      id: p.id,
      reason: 'Fix rate',
      input: trade(supplier, [[50, 4200]], { date: '2026-11-01' }),
    })
    expect(snap().totals.stockCost).toBe(21000000)
    sale(40)
    expect(() =>
      c.execute('document.cancel', { kind: 'purchase', id: p.id, reason: 'Wrong' }),
    ).toThrow('consumed')
    expect(() =>
      c.execute('document.edit', {
        kind: 'purchase',
        id: p.id,
        reason: 'Edit after sale',
        input: trade(supplier, [[30, 4200]], { date: '2026-11-01' }),
      }),
    ).toThrow('consumed')
    balanced()
  })

  it('T25 FY sequence reset, FY-changing edit blocked, no cancelled number reuse', () => {
    const p = purchase(1, 100) as any
    expect(() =>
      c.execute('document.edit', {
        kind: 'purchase',
        id: p.id,
        reason: 'Move FY',
        input: trade(supplier, [[1, 100]], { date: '2027-04-01' }),
      }),
    ).toThrow('Financial-year')
    c.execute('document.cancel', { kind: 'purchase', id: p.id, reason: 'Wrong' })
    const second = purchase(1, 100) as any
    const next = purchase(1, 100, '2027-04-01') as any
    expect(second.number).toBe('PUR/2026-27/0002')
    expect(next.number).toBe('PUR/2027-28/0001')
    expect(fy('2027-03-31')).toBe('2026-27')
  })

  it('T32 fault injection rolls back all intermediate writes', () => {
    c.db.exec(
      "CREATE TEMP TRIGGER simulate_disk_failure BEFORE INSERT ON stock_movements BEGIN SELECT RAISE(ABORT,'Injected failure'); END;",
    )
    expect(() => purchase(1, 100)).toThrow('Injected failure')
    expect(c.all('SELECT * FROM purchases')).toHaveLength(0)
    expect(c.all('SELECT * FROM stock_lots')).toHaveLength(0)
    expect(c.all('SELECT * FROM number_sequences')).toHaveLength(0)
  })

  it('T33 allocation conservation, final depletion & zero-net expense rejection', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(() =>
      c.execute(
        'purchase.post',
        trade(supplier, [[10, 0]], {
          expenses: [{ description: 'Freight', amount: 1000, mode: 'supplier', accountId: null }],
        }),
      ),
    ).toThrow('zero-value')
    purchase(0.03, 33.333333)
    sale(0.01, 100)
    sale(0.01, 100)
    sale(0.01, 100)
    expect(snap().totals.stockCost).toBe(0)
    balanced()
  })

  it('idempotency operationKey prevents duplicate posting on retries', () => {
    const first = c.execute(
      'purchase.post',
      trade(supplier, [[10, 1000]], { date: '2026-11-01' }),
      'op-key-123',
    ) as any
    const second = c.execute(
      'purchase.post',
      trade(supplier, [[10, 1000]], { date: '2026-11-01' }),
      'op-key-123',
    ) as any
    expect(second).toEqual(first)
    expect(c.all('SELECT * FROM purchases')).toHaveLength(1)
    balanced()
  })

  it('rejects malformed dates, invalid quantity, bad roles, duplicate manual lots, role removal with history', () => {
    expect(() => date.parse('2026-02-30')).toThrow()
    expect(() => sale(-1)).toThrow()
    expect(() => c.execute('purchase.post', trade(customer, [[1, 1]]))).toThrow('supplier')
    expect(lineValue(100, '1.005', '0').gross).toBe(101)
    purchase(1, 100)
    expect(() =>
      c.execute('party.save', {
        id: supplier,
        name: 'Supplier',
        roles: ['customer'],
        creditDays: 0,
        active: true,
      }),
    ).toThrow('Cannot remove a role')
  })

  it('posted journal is immutable and cannot revert to draft', () => {
    purchase(1, 100)
    expect(() => c.run("UPDATE journal_entries SET status='draft'")).toThrow('immutable')
    expect(() => c.run('DELETE FROM journal_lines')).toThrow('immutable')
    balanced()
  })

  it('as-of interest accrual is read-only and not double counted after payment', () => {
    c.execute('loan.post', {
      date: '2026-11-01',
      partyId: supplier,
      kind: 'taken',
      principal: 10000000,
      rate: '1',
      frequency: 'monthly',
      returnDate: null,
      accountId: cash,
    })
    const before = c.all('SELECT * FROM journal_entries')
    const s = c.snapshot({ from: '2026-11-01', to: '2026-12-01' })
    expect(s.totals.profit).toBe(-100000)
    expect(c.all('SELECT * FROM journal_entries')).toEqual(before)
    c.execute('loan.settle', {
      id: 1,
      date: '2026-12-01',
      accountId: cash,
      interest: 100000,
      close: false,
    })
    expect(c.snapshot({ from: '2026-11-01', to: '2026-12-01' }).totals.profit).toBe(-100000)
    balanced()
  })

  it('T27 exports produce valid CSV (with formula guard), XLSX and PDF with INR font', async () => {
    const rows = [
      { Reference: 'SAL/2026-27/0001', Party: '=CMD()', Amount: '₹1,00,000.00' },
      { Reference: 'Filtered totals (active)', Party: '', Amount: '₹1,00,000.00' },
    ]
    const csvPath = join(dir, 'report.csv')
    const xlsxPath = join(dir, 'report.xlsx')
    const pdfPath = join(dir, 'report.pdf')
    const fontPath = join(process.cwd(), 'resources/fonts/Inter-Regular.ttf')
    const logoPath = join(process.cwd(), 'resources/branding/icon.png')

    await writeReport('csv', csvPath, 'Sales', 'Test Co', rows, fontPath, logoPath)
    const csv = readFileSync(csvPath, 'utf8')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain("'=CMD()")
    expect(csv).toContain('₹1,00,000.00')

    await writeReport('xlsx', xlsxPath, 'Sales', 'Test Co', rows, fontPath, logoPath)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(xlsxPath)
    expect(wb.getWorksheet('Report')?.rowCount).toBe(3)

    await writeReport('pdf', pdfPath, 'Sales', 'Test Co', rows, fontPath, logoPath)
    const pdf = readFileSync(pdfPath)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(2000)
  })
})

describe('Application identity, isolation, backup, restore and DB upgrades', () => {
  const mockSafeStorage: SafeStorageAdapter = {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from('ENC:' + Buffer.from(plain, 'utf8').toString('base64')),
    decryptString: (buf) => {
      const s = buf.toString('utf8')
      if (!s.startsWith('ENC:')) throw Error('Decrypt failed')
      return Buffer.from(s.slice(4), 'base64').toString('utf8')
    },
  }

  it('T01 bootstrap only once, direct login without forced change, username & password changes persist; T02 company isolation; no stray pre-v2 backups on fresh DBs', async () => {
    const a = new ApplicationService(join(dir, 'app'))
    const login = (await a.execute('auth.login', {
      email: 'admin@gmail.com',
      password: 'Admin@123',
    })) as any
    expect(login.mustChange).toBe(false)
    expect(login.recoveryPrompt).toBe(true)
    const storedHash = (a.appDb.prepare('SELECT password_hash FROM users WHERE id=1').get() as any)
      .password_hash
    expect(storedHash.startsWith('$argon2id$')).toBe(true)
    expect(isLegacyBcryptHash(storedHash)).toBe(false)

    // Can create companies immediately without forced password change
    const first = (await a.execute('companies.create', { name: 'A', date: '2026-04-01' })) as any
    const second = (await a.execute('companies.create', { name: 'B', date: '2026-04-01' })) as any
    expect(first.id).not.toBe(second.id)
    expect(() => a.state(first.id)).toThrow('Company changed')
    expect(readdirSync(join(dir, 'app')).some((n) => n.includes('pre-v2'))).toBe(false)
    expect(readdirSync(join(dir, 'app/companies')).some((n) => n.includes('pre-v2'))).toBe(false)

    // Optional username & password changes in Settings (6+ char password allowed)
    await expect(
      a.execute('auth.username', { newUsername: 'arya', currentPassword: 'wrong' }),
    ).rejects.toThrow('Current password is incorrect')
    await a.execute('auth.username', { newUsername: 'arya', currentPassword: 'Admin@123' })
    expect((a.state() as any).username).toBe('arya')
    await expect(
      a.execute('auth.password', { oldPassword: 'Admin@123', newPassword: '12345' }),
    ).rejects.toThrow()
    await a.execute('auth.password', { oldPassword: 'Admin@123', newPassword: 'pass12' })
    a.close()

    const b = new ApplicationService(join(dir, 'app'))
    await expect(
      b.execute('auth.login', { email: 'admin@gmail.com', password: 'Admin@123' }),
    ).rejects.toThrow('Incorrect')
    await expect(b.execute('auth.login', { email: 'arya', password: 'Admin@123' })).rejects.toThrow(
      'Incorrect',
    )
    await b.execute('auth.login', { email: 'arya', password: 'pass12' })
    expect(b.companies()).toHaveLength(2)
    b.close()
  })

  it('T28/T29 full and individual snapshot, corrupt archive rejection, restore and interrupted restore rollback', async () => {
    const a = new ApplicationService(join(dir, 'app'))
    await a.execute('auth.login', { email: 'admin@gmail.com', password: 'Admin@123' })
    await a.execute('auth.password', { oldPassword: 'Admin@123', newPassword: 'NewPassword@123' })
    const orig = (await a.execute('companies.create', {
      name: 'Original',
      date: '2026-04-01',
    })) as any
    const fullPath = await a.backup(join(dir, 'backups'))
    const companyPath = await a.backup(join(dir, 'backups'), orig.id)

    writeFileSync(join(dir, 'bad.diamo'), 'bad')
    await expect(a.restore(join(dir, 'bad.diamo'))).rejects.toThrow()

    // Individual restore creates a new isolated company without overwriting Original
    const ind = (await a.restore(companyPath)) as any
    expect(ind.individual).toBe(true)
    expect(a.companies()).toHaveLength(2)
    expect(a.companies().some((x: any) => x.name === 'ORIGINAL (RESTORED)')).toBe(true)

    // Full restore replaces registry cleanly
    await a.execute('companies.create', { name: 'Later', date: '2026-04-01' })
    await a.restore(fullPath)
    expect(a.companies()).toHaveLength(1)
    expect(a.companies()[0]).toMatchObject({ name: 'ORIGINAL' })
    a.close()
  })

  it('T31 upgrades pre-existing v1 app and company databases cleanly preserving data', () => {
    const v1CompanyPath = join(dir, 'legacy-company.sqlite')
    const legacy = new Database(v1CompanyPath)
    legacy.exec(companyV1Sql)
    legacy
      .prepare("INSERT INTO company_profile(id,name,start_date) VALUES(1,'Legacy Co','2026-04-01')")
      .run()
    legacy.prepare("INSERT INTO parties(name,active) VALUES('Legacy Party',1)").run()
    const jid = Number(
      legacy
        .prepare(
          "INSERT INTO journal_entries(number,entry_date,source_type,source_id,narration,reference,status) VALUES('JV/2026-27/0001','2026-04-01','journal',1,'Legacy cash','ref-1','draft')",
        )
        .run().lastInsertRowid,
    )
    legacy
      .prepare('INSERT INTO journal_lines(journal_id,account_id,debit,credit) VALUES(?,1,1000,0)')
      .run(jid)
    legacy
      .prepare('INSERT INTO journal_lines(journal_id,account_id,debit,credit) VALUES(?,12,0,1000)')
      .run(jid)
    legacy.prepare("UPDATE journal_entries SET status='posted' WHERE id=?").run(jid)
    legacy.close()

    const upgraded = openDatabase(v1CompanyPath, 'company')
    expect((upgraded.prepare('SELECT max(version) v FROM schema_migrations').get() as any).v).toBe(
      9,
    )
    const qualityCols = upgraded
      .prepare("PRAGMA table_info('qualities')")
      .all()
      .map((c: any) => c.name)
    expect(qualityCols).toContain('inventory_mode')
    const purchaseCols = upgraded
      .prepare("PRAGMA table_info('purchases')")
      .all()
      .map((c: any) => c.name)
    expect(purchaseCols).toContain('slip_no')
    const saleCols = upgraded
      .prepare("PRAGMA table_info('sales')")
      .all()
      .map((c: any) => c.name)
    expect(saleCols).toContain('slip_no')
    const stoneTable = upgraded
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='diamond_stones'")
      .get()
    expect(stoneTable).toBeTruthy()
    const seqTable = upgraded
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='quality_sequences'")
      .get()
    expect(seqTable).toBeTruthy()
    expect((upgraded.prepare('SELECT name FROM company_profile').get() as any).name).toBe(
      'LEGACY CO',
    )
    expect((upgraded.prepare('SELECT name FROM parties').get() as any).name).toBe('LEGACY PARTY')
    expect(readdirSync(dir).some((n) => n.startsWith('legacy-company.sqlite.pre-v2-'))).toBe(true)
    upgraded.close()

    const v1AppPath = join(dir, 'legacy-app.sqlite')
    const legacyApp = new Database(v1AppPath)
    legacyApp.exec(appV1Sql)
    legacyApp
      .prepare(
        "INSERT INTO users(id,email,password_hash,must_change) VALUES(1,'admin@gmail.com','hash',0)",
      )
      .run()
    legacyApp
      .prepare(
        "INSERT INTO companies(id,name,db_filename) VALUES('co-1','legacy co','co-1.sqlite')",
      )
      .run()
    legacyApp.close()
    const upgradedApp = openDatabase(v1AppPath, 'app')
    expect(
      (upgradedApp.prepare('SELECT max(version) v FROM schema_migrations').get() as any).v,
    ).toBe(9)
    expect((upgradedApp.prepare('SELECT email FROM users WHERE id=1').get() as any).email).toBe(
      'admin@gmail.com',
    )
    expect(
      (upgradedApp.prepare('SELECT name FROM companies WHERE id=?').get('co-1') as any).name,
    ).toBe('LEGACY CO')
    expect(
      (upgradedApp.prepare('SELECT must_change FROM users WHERE id=1').get() as any).must_change,
    ).toBe(0)
    const userCols = upgradedApp
      .prepare("PRAGMA table_info('users')")
      .all()
      .map((c: any) => c.name)
    expect(userCols).toContain('recovery_hash')
    expect(userCols).toContain('recovery_acknowledged')
    const companyCols = upgradedApp
      .prepare("PRAGMA table_info('companies')")
      .all()
      .map((c: any) => c.name)
    expect(companyCols).toContain('is_default')
    upgradedApp.close()
  })

  it('Default company persists, switches exclusively, clears cleanly, and auto-opens on login', async () => {
    const appDir = join(dir, 'default-company-app')
    const a = new ApplicationService(appDir)
    await a.execute('auth.login', { email: 'admin@gmail.com', password: 'Admin@123' })
    const c1 = (await a.execute('companies.create', {
      name: 'Alpha Diamonds',
      date: '2026-04-01',
    })) as any
    const c2 = (await a.execute('companies.create', {
      name: 'Beta Diamonds',
      date: '2026-04-01',
    })) as any

    // Without a default set, relogin opens no company automatically
    await a.execute('auth.logout', {})
    const loginNone = (await a.execute('auth.login', {
      email: 'admin@gmail.com',
      password: 'Admin@123',
    })) as any
    expect(loginNone.companyId).toBeUndefined()
    expect((a.state() as any).companyId).toBeUndefined()

    // Set Beta Diamonds as default -> relogin auto-opens Beta Diamonds
    await a.execute('companies.setDefault', { id: c2.id })
    await a.execute('auth.logout', {})
    const loginB = (await a.execute('auth.login', {
      email: 'admin@gmail.com',
      password: 'Admin@123',
    })) as any
    expect(loginB.companyId).toBe(c2.id)
    expect((a.state() as any).companyId).toBe(c2.id)
    expect((a.state() as any).profile.name).toBe('BETA DIAMONDS')

    // Switch default to Alpha Diamonds -> previous default cleared automatically
    await a.execute('companies.setDefault', { id: c1.id })
    await a.execute('auth.logout', {})
    const loginA = (await a.execute('auth.login', {
      email: 'admin@gmail.com',
      password: 'Admin@123',
    })) as any
    expect(loginA.companyId).toBe(c1.id)
    expect((a.state() as any).profile.name).toBe('ALPHA DIAMONDS')
    expect(a.companies().filter((c: any) => c.is_default === 1)).toHaveLength(1)

    // Clearing default disables auto-open on next login
    await a.execute('companies.setDefault', { id: null })
    await a.execute('auth.logout', {})
    const loginCleared = (await a.execute('auth.login', {
      email: 'admin@gmail.com',
      password: 'Admin@123',
    })) as any
    expect(loginCleared.companyId).toBeUndefined()
    a.close()
  })

  it('Offline recovery Channel A (Recovery Code + hidden PDF + reuse + rotation) and Channel B (Device PIN + hardware binding + reuse + 5-attempt lockout)', async () => {
    const appDir = join(dir, 'recovery-app')
    const uuid = '11111111-2222-3333-4444-555555555555'
    const a = new ApplicationService(appDir, {
      safeStorage: mockSafeStorage,
      machineUuidProvider: () => uuid,
    })

    // First login generates 71-char recovery key and atomic hidden PDF
    await a.execute('auth.login', { email: 'admin@gmail.com', password: 'Admin@123' })
    const s1 = a.state() as any
    expect(s1.recoveryPrompt).toBe(true)
    expect(s1.pendingRecoveryKey).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{8}){7}$/)
    expect(s1.pendingRecoveryKey).toHaveLength(71)
    const key1 = s1.pendingRecoveryKey as string

    // Plaintext recovery key is never stored in SQLite
    const userRow = a.appDb.prepare('SELECT * FROM users WHERE id=1').get() as any
    expect(userRow.recovery_hash).toMatch(/^\$argon2id\$/)
    expect(JSON.stringify(userRow)).not.toContain(key1)

    // Hidden PDF exists and is valid PDF
    const hiddenPdfs1 = readdirSync(appDir).filter((n) => /^\.diamo-recovery-.*\.pdf$/.test(n))
    expect(hiddenPdfs1).toHaveLength(1)
    expect(readFileSync(join(appDir, hiddenPdfs1[0])).subarray(0, 5).toString()).toBe('%PDF-')

    // Acknowledge recovery key and enroll 6-digit Device PIN
    await a.execute('auth.acknowledgeRecovery', {})
    expect((a.state() as any).recoveryPrompt).toBe(false)
    await a.execute('auth.enrollPin', { currentPassword: 'Admin@123', pin: '246810' })
    expect(readdirSync(appDir)).toContain('.diamo-device')
    expect(readFileSync(join(appDir, '.diamo-device'), 'utf8')).not.toContain('246810')

    // Channel A reset works with messy whitespace/newlines/uppercase & stays reusable multiple times
    await a.execute('auth.logout', {})
    await a.execute('auth.reset', {
      username: 'admin@gmail.com',
      recoveryKey: `  ${key1.slice(0, 18).toUpperCase()}\n  ${key1.slice(18)}  `,
      newPassword: 'ResetOne@1',
    })
    await a.execute('auth.login', { email: 'admin@gmail.com', password: 'ResetOne@1' })
    expect((a.state() as any).recoveryPrompt).toBe(false)

    // Reuse same recovery code a second time -> still works!
    await a.execute('auth.logout', {})
    await a.execute('auth.reset', {
      username: 'admin@gmail.com',
      recoveryKey: key1,
      newPassword: 'ResetTwo@2',
    })
    await a.execute('auth.login', { email: 'admin@gmail.com', password: 'ResetTwo@2' })

    // Channel B Device PIN works multiple times and resets failure count to 0
    await a.execute('auth.logout', {})
    await a.execute('auth.resetPin', {
      username: 'admin@gmail.com',
      pin: '246810',
      newPassword: 'PinReset1!',
    })
    await a.execute('auth.resetPin', {
      username: 'admin@gmail.com',
      pin: '246810',
      newPassword: 'PinReset2!',
    })
    expect((await a.execute('auth.recoveryStatus', {})) as any).toMatchObject({
      enrolled: true,
      remaining: 5,
    })

    // Rotate recovery code -> updates hidden PDF (replaces old) and preserves existing Device PIN
    await a.execute('auth.login', { email: 'admin@gmail.com', password: 'PinReset2!' })
    const rotated = (await a.execute('auth.rotateRecovery', {
      currentPassword: 'PinReset2!',
    })) as any
    const key2 = rotated.recoveryKey as string
    expect(key2).not.toBe(key1)
    const hiddenPdfs2 = readdirSync(appDir).filter((n) => /^\.diamo-recovery-.*\.pdf$/.test(n))
    expect(hiddenPdfs2).toHaveLength(1)
    expect(hiddenPdfs2[0]).not.toBe(hiddenPdfs1[0])

    // Old recovery key rejected; new key and existing PIN both work
    await a.execute('auth.logout', {})
    await expect(
      a.execute('auth.reset', {
        username: 'admin@gmail.com',
        recoveryKey: key1,
        newPassword: 'ShouldFail1',
      }),
    ).rejects.toThrow('Invalid username or recovery code')
    await a.execute('auth.resetPin', {
      username: 'admin@gmail.com',
      pin: '246810',
      newPassword: 'AfterRotatePin1',
    })

    // Hardware mismatch rejects Device PIN
    a.close()
    const wrongHardware = new ApplicationService(appDir, {
      safeStorage: mockSafeStorage,
      machineUuidProvider: () => '99999999-9999-9999-9999-999999999999',
    })
    expect(await wrongHardware.execute('auth.recoveryStatus', {})).toMatchObject({
      enrolled: false,
      remaining: null,
    })
    await expect(
      wrongHardware.execute('auth.resetPin', {
        username: 'admin@gmail.com',
        pin: '246810',
        newPassword: 'HackAttempt1',
      }),
    ).rejects.toThrow('not configured')
    wrongHardware.close()

    // Crash-proof 5-attempt budget persists across restarts, resets on attempt 5 success, locks on 5 failures
    const b = new ApplicationService(appDir, {
      safeStorage: mockSafeStorage,
      machineUuidProvider: () => uuid,
    })
    for (let i = 1; i <= 4; i++) {
      await expect(
        b.execute('auth.resetPin', {
          username: 'admin@gmail.com',
          pin: '000000',
          newPassword: 'Nope12',
        }),
      ).rejects.toThrow(`${5 - i} attempt`)
    }
    b.close()

    const cApp = new ApplicationService(appDir, {
      safeStorage: mockSafeStorage,
      machineUuidProvider: () => uuid,
    })
    expect(await cApp.execute('auth.recoveryStatus', {})).toMatchObject({ remaining: 1 })
    // 5th attempt succeeds -> resets remaining to 5
    await cApp.execute('auth.resetPin', {
      username: 'admin@gmail.com',
      pin: '246810',
      newPassword: 'SavedOnFifth1',
    })
    expect(await cApp.execute('auth.recoveryStatus', {})).toMatchObject({ remaining: 5 })

    // 5 wrong attempts -> permanent lock until re-enrolled in Settings
    for (let i = 0; i < 5; i++) {
      await expect(
        cApp.execute('auth.resetPin', {
          username: 'admin@gmail.com',
          pin: '999999',
          newPassword: 'Nope12',
        }),
      ).rejects.toThrow()
    }
    expect(await cApp.execute('auth.recoveryStatus', {})).toMatchObject({
      enrolled: true,
      remaining: 0,
    })
    await expect(
      cApp.execute('auth.resetPin', {
        username: 'admin@gmail.com',
        pin: '246810',
        newPassword: 'LockedOut1',
      }),
    ).rejects.toThrow('locked after 5 failed attempts')

    // Channel A still works while PIN is locked, and PIN stays locked until re-set in Settings
    await cApp.execute('auth.reset', {
      username: 'admin@gmail.com',
      recoveryKey: key2,
      newPassword: 'RecoveredByKey2',
    })
    expect(await cApp.execute('auth.recoveryStatus', {})).toMatchObject({ remaining: 0 })
    await cApp.execute('auth.login', { email: 'admin@gmail.com', password: 'RecoveredByKey2' })
    await cApp.execute('auth.enrollPin', { currentPassword: 'RecoveredByKey2', pin: '135790' })
    expect(await cApp.execute('auth.recoveryStatus', {})).toMatchObject({ remaining: 5 })
    cApp.close()

    // Direct Argon2id helper sanity
    const h = await hashArgon2id('MySecret123')
    expect(await verifySecret(h, 'MySecret123')).toBe(true)
    expect(await verifySecret(h, 'Wrong')).toBe(false)
  })

  it('Individual stone quality workflow: USD/INR purchase conversion, optional specs, Hold status switch, whole-stone sale & cancel restore', () => {
    const stoneDb = openDatabase(join(dir, 'stone-co.sqlite'), 'company')
    stoneDb
      .prepare("INSERT INTO company_profile(id,name,start_date) VALUES(1,'Stone Co','2026-04-01')")
      .run()
    const c = new CompanyService(stoneDb)
    try {
      const sup = (
        c.execute('party.save', {
          name: 'IGI Supplier',
          roles: ['supplier'],
          creditDays: 30,
          active: true,
        }) as any
      ).id
      const cust = (
        c.execute('party.save', {
          name: 'IGI Buyer',
          roles: ['customer'],
          creditDays: 15,
          active: true,
        }) as any
      ).id
      const igiQuality = (
        c.execute('quality.save', {
          name: 'IGI Certified',
          description: 'Piece-level stone tracking',
          hike: '10',
          inventoryMode: 'individual',
          active: true,
        }) as any
      ).id

      // USD purchase without exchange rate is rejected
      expect(() =>
        c.execute('purchase.post', {
          date: '2026-04-10',
          partyId: sup,
          dueDays: 30,
          lines: [
            {
              qualityId: igiQuality,
              carats: 150,
              rate: '85000',
              less: '0',
              stone: {
                priceCurrency: 'USD',
                exchangeRate: '',
                rateUsd: '1000',
                totalUsd: '1500.00',
              },
            },
          ],
        }),
      ).toThrow('exchange rate')

      // Valid USD individual stone purchase with auto-generated Sr. & Slip No.
      const pur = c.execute('purchase.post', {
        date: '2026-04-10',
        partyId: sup,
        dueDays: 30,
        slipNo: 'SLIP-P-101',
        lines: [
          {
            qualityId: igiQuality,
            carats: 150,
            rate: '85000',
            less: '0',
            stone: {
              srNo: '',
              availability: 'available',
              unbilled: true,
              shape: 'Round',
              color: 'E',
              clarity: 'VVS1',
              cut: 'EX',
              polish: 'EX',
              symmetry: 'EX',
              ratio: '1.01',
              lengthMm: '7.35',
              widthMm: '7.38',
              heightMm: '4.52',
              depthPct: '61.4',
              tablePct: '57',
              fluorescence: 'None',
              lab: 'IGI',
              reportNumber: 'LG6543210',
              growth: 'CVD',
              priceCurrency: 'USD',
              exchangeRate: '85',
              rateUsd: '1000',
              totalUsd: '1500.00',
              rateInr: '85000',
              totalInr: '127500.00',
            },
          },
        ],
      }) as any
      expect(pur.stock).toBe(12750000)

      // Duplicate active Sr. is rejected
      expect(() =>
        c.execute('purchase.post', {
          date: '2026-04-10',
          partyId: sup,
          dueDays: 30,
          lines: [
            {
              qualityId: igiQuality,
              carats: 100,
              rate: '50000',
              less: '0',
              stone: { srNo: 'IGI-CERTIFIED-0001' },
            },
          ],
        }),
      ).toThrow('already assigned')

      // Cancelled stone purchase does not reuse sequence numbers
      const tempPur = c.execute('purchase.post', {
        date: '2026-04-10',
        partyId: sup,
        dueDays: 30,
        lines: [
          {
            qualityId: igiQuality,
            carats: 100,
            rate: '50000',
            less: '0',
            stone: { srNo: '' },
          },
        ],
      }) as any
      c.execute('document.cancel', { kind: 'purchase', id: tempPur.id, reason: 'Wrong lot' })
      const seqSnap = c.snapshot({ from: '2026-04-01', to: '2026-12-31' })
      const igiQMeta = seqSnap.qualities.find((q: any) => q.id === igiQuality)
      expect(igiQMeta?.next_sr_no).toBe('IGI-CERTIFIED-0003')

      // Cannot flip inventory type of quality after purchase exists
      expect(() =>
        c.execute('quality.save', {
          id: igiQuality,
          name: 'IGI Certified',
          hike: '10',
          inventoryMode: 'bulk',
          active: true,
        }),
      ).toThrow('Cannot change inventory type')

      let snap = c.snapshot({ from: '2026-04-01', to: '2026-12-31' })
      expect(snap.stones).toHaveLength(1)
      expect(snap.purchases.find((p: any) => p.id === pur.id)?.slip_no).toBe('SLIP-P-101')
      const stone = snap.stones[0]
      expect(stone).toMatchObject({
        sr_no: 'IGI-CERTIFIED-0001',
        purchase_slip_no: 'SLIP-P-101',
        availability: 'available',
        unbilled: 1,
        shape: 'ROUND',
        lab: 'IGI',
        report_number: 'LG6543210',
        growth: 'CVD',
        price_currency: 'USD',
        total_price_inr: 12750000,
      })

      // Status transition: Available -> Hold -> Available -> sell while Hold works too
      c.execute('stone.setStatus', { id: stone.id, availability: 'hold' })
      expect(c.snapshot({ from: '2026-04-01', to: '2026-12-31' }).stones[0].availability).toBe(
        'hold',
      )

      // Selling individual quality without selecting specific stone fails
      expect(() =>
        c.execute('sale.post', {
          date: '2026-04-12',
          partyId: cust,
          dueDays: 15,
          lines: [{ qualityId: igiQuality, carats: 150, rate: '95000', less: '0' }],
        }),
      ).toThrow('Select specific stone')

      // Partial carat sale from an individual stone is blocked
      expect(() =>
        c.execute('sale.post', {
          date: '2026-04-12',
          partyId: cust,
          dueDays: 15,
          lines: [
            {
              qualityId: igiQuality,
              carats: 100,
              rate: '95000',
              less: '0',
              lots: [{ lotId: stone.lot_id, carats: 100 }],
            },
          ],
        }),
      ).toThrow('whole units')

      // Sell whole stone cleanly with Slip No. -> marks sold, clears unbilled, exact COGS ₹127,500, profit ₹15,000
      const sale = c.execute('sale.post', {
        date: '2026-04-12',
        partyId: cust,
        dueDays: 15,
        slipNo: 'SLIP-S-202',
        lines: [
          {
            qualityId: igiQuality,
            carats: 150,
            rate: '95000',
            less: '0',
            lots: [{ lotId: stone.lot_id, carats: 150 }],
          },
        ],
      }) as any
      expect(sale.invoice).toBe(14250000)

      snap = c.snapshot({ from: '2026-04-01', to: '2026-12-31' })
      expect(snap.stones[0]).toMatchObject({
        availability: 'sold',
        unbilled: 0,
        sale_id: sale.id,
        purchase_slip_no: 'SLIP-P-101',
        sale_slip_no: 'SLIP-S-202',
      })
      expect(snap.sales[0].slip_no).toBe('SLIP-S-202')
      expect(snap.totals.profit).toBe(1500000)
      expect(snap.totals.balanceDifference).toBe(0)

      // Cannot change status directly while sold
      expect(() =>
        c.execute('stone.setStatus', { id: stone.id, availability: 'available' }),
      ).toThrow('sold')

      // Cancelling sale restores stone back to available & zeros profit
      c.execute('document.cancel', { kind: 'sale', id: sale.id, reason: 'Returned stone' })
      snap = c.snapshot({ from: '2026-04-01', to: '2026-12-31' })
      expect(snap.stones[0].availability).toBe('available')
      expect(snap.totals.profit).toBe(0)

      // Cancelling purchase marks stone cancelled
      c.execute('document.cancel', { kind: 'purchase', id: pur.id, reason: 'Cancelled buy' })
      expect(c.snapshot({ from: '2026-04-01', to: '2026-12-31' }).stones).toHaveLength(0)
    } finally {
      c.db.close()
    }
  })

  it('Multi-stone purchase auto-series, custom jump, purchase & sale edits, and double-sell blocking', () => {
    const db = openDatabase(join(dir, 'stone-multi.sqlite'), 'company')
    db.prepare(
      "INSERT INTO company_profile(id,name,start_date) VALUES(1,'MULTI CO','2026-04-01')",
    ).run()
    const svc = new CompanyService(db)
    try {
      const sup = (
        svc.execute('party.save', {
          name: 'Multi Supplier',
          roles: ['supplier'],
          creditDays: 30,
          active: true,
        }) as any
      ).id
      const cust = (
        svc.execute('party.save', {
          name: 'Multi Customer',
          roles: ['customer'],
          creditDays: 15,
          active: true,
        }) as any
      ).id
      const igiQ = (
        svc.execute('quality.save', {
          name: 'IGI',
          inventoryMode: 'individual',
          hike: '5',
          active: true,
        }) as any
      ).id
      const bulkQ = (
        svc.execute('quality.save', {
          name: 'Mix Lots',
          inventoryMode: 'bulk',
          hike: '5',
          active: true,
        }) as any
      ).id

      // Duplicate manual Sr. within the SAME multi-line purchase throws
      expect(() =>
        svc.execute('purchase.post', {
          date: '2026-04-05',
          partyId: sup,
          dueDays: 30,
          lines: [
            { qualityId: igiQ, carats: 100, rate: '10000', less: '0', stone: { srNo: 'igi-99' } },
            { qualityId: igiQ, carats: 120, rate: '11000', less: '0', stone: { srNo: 'IGI-99' } },
          ],
        }),
      ).toThrow('already assigned')

      // Mixed multi-line purchase (2 individual stones with auto Sr. + 1 bulk lot)
      const pur = svc.execute('purchase.post', {
        date: '2026-04-05',
        partyId: sup,
        dueDays: 30,
        slipNo: 'p-10',
        lines: [
          {
            qualityId: igiQ,
            carats: 100,
            rate: '50000',
            less: '0',
            stone: { srNo: '', shape: 'round' },
          },
          {
            qualityId: igiQ,
            carats: 150,
            rate: '60000',
            less: '0',
            stone: { srNo: '', shape: 'oval' },
          },
          { qualityId: bulkQ, carats: 500, rate: '2000', less: '0' },
        ],
      }) as any

      let snap = svc.snapshot({ from: '2026-04-01', to: '2026-12-31' })
      expect(snap.stones.map((s: any) => s.sr_no).sort()).toEqual(['IGI-0001', 'IGI-0002'])
      expect(snap.qualities.find((q: any) => q.id === igiQ)?.next_sr_no).toBe('IGI-0003')

      // Edit unconsumed individual purchase keeping same Sr. numbers & updating slip/shape
      const editedPur = svc.execute('document.edit', {
        kind: 'purchase',
        id: pur.id,
        reason: 'fix slip & shape',
        input: {
          date: '2026-04-05',
          partyId: sup,
          dueDays: 30,
          slipNo: 'p-11',
          remarks: 'edited buy',
          lines: [
            {
              qualityId: igiQ,
              carats: 100,
              rate: '50000',
              less: '0',
              stone: { srNo: 'IGI-0001', shape: 'pear' },
            },
            {
              qualityId: igiQ,
              carats: 150,
              rate: '60000',
              less: '0',
              stone: { srNo: 'IGI-0002', shape: 'oval' },
            },
            { qualityId: bulkQ, carats: 500, rate: '2000', less: '0' },
          ],
        },
      }) as any
      snap = svc.snapshot({ from: '2026-04-01', to: '2026-12-31' })
      expect(snap.stones).toHaveLength(2)
      const stone1 = snap.stones.find((s: any) => s.sr_no === 'IGI-0001')
      if (!stone1) throw Error('Expected stone IGI-0001 to exist')
      expect(stone1.shape).toBe('PEAR')
      expect(stone1.purchase_slip_no).toBe('P-11')

      // Custom series jump (IGI-0010) advances next auto-fetched sequence to IGI-0011
      svc.execute('purchase.post', {
        date: '2026-04-06',
        partyId: sup,
        dueDays: 30,
        lines: [
          { qualityId: igiQ, carats: 100, rate: '40000', less: '0', stone: { srNo: 'igi-0010' } },
        ],
      })
      snap = svc.snapshot({ from: '2026-04-01', to: '2026-12-31' })
      expect(snap.qualities.find((q: any) => q.id === igiQ)?.next_sr_no).toBe('IGI-0011')

      // Sell stone1 -> edit posted sale -> verify double-sell & consumed-purchase edit are blocked
      const sale = svc.execute('sale.post', {
        date: '2026-04-10',
        partyId: cust,
        dueDays: 15,
        slipNo: 's-1',
        lines: [
          {
            qualityId: igiQ,
            carats: 100,
            rate: '65000',
            less: '0',
            lots: [{ lotId: stone1.lot_id, carats: 100 }],
          },
        ],
      }) as any
      expect(() =>
        svc.execute('sale.post', {
          date: '2026-04-11',
          partyId: cust,
          dueDays: 15,
          lines: [
            {
              qualityId: igiQ,
              carats: 100,
              rate: '70000',
              less: '0',
              lots: [{ lotId: stone1.lot_id, carats: 100 }],
            },
          ],
        }),
      ).toThrow()

      svc.execute('document.edit', {
        kind: 'sale',
        id: sale.id,
        reason: 'update sale slip',
        input: {
          date: '2026-04-10',
          partyId: cust,
          dueDays: 15,
          slipNo: 's-2',
          lines: [
            {
              qualityId: igiQ,
              carats: 100,
              rate: '70000',
              less: '0',
              lots: [{ lotId: stone1.lot_id, carats: 100 }],
            },
          ],
        },
      })
      snap = svc.snapshot({ from: '2026-04-01', to: '2026-12-31' })
      expect(snap.stones.find((s: any) => s.sr_no === 'IGI-0001')).toMatchObject({
        availability: 'sold',
        sale_slip_no: 'S-2',
      })
      expect(snap.totals.profit).toBe(2000000)

      expect(() =>
        svc.execute('document.edit', {
          kind: 'purchase',
          id: editedPur.id,
          reason: 'cannot edit consumed',
          input: {
            date: '2026-04-05',
            partyId: sup,
            dueDays: 30,
            lines: [
              {
                qualityId: igiQ,
                carats: 100,
                rate: '50000',
                less: '0',
                stone: { srNo: 'IGI-0001' },
              },
            ],
          },
        }),
      ).toThrow()
    } finally {
      db.close()
    }
  })

  it('Enforces ALL CAPS across all business fields while keeping emails & system accounts intact, and switches multi-company DBs cleanly', async () => {
    const appDir = join(dir, 'caps-app')
    const a = new ApplicationService(appDir)
    await a.execute('auth.login', { email: 'admin@gmail.com', password: 'Admin@123' })
    const c1 = (await a.execute('companies.create', {
      name: 'DiAmO',
      date: '2026-04-01',
      address: 'Surat Bazar',
      contact: 'info@diamo.local',
    })) as any
    const c2 = (await a.execute('companies.create', {
      name: 'hErO',
      date: '2026-04-01',
    })) as any

    await a.execute('companies.select', { id: c1.id })
    const cashId = (a.state(c1.id) as any).accounts.find((x: any) => x.code === 'CASH').id
    const capId = (a.state(c1.id) as any).accounts.find((x: any) => x.code === 'CAP').id
    const pSup = (
      await a.execute(
        'party.save',
        {
          name: 'Acme Diamonds',
          roles: ['supplier', 'customer'],
          contactPerson: 'Ramesh Shah',
          phone: '+91 abc 123',
          email: 'sales@acme.com',
          address: 'Varachha Road',
          pan: 'abcde1234f',
          gstin: '24abcde1234f1z5',
          creditDays: 10,
          remarks: 'trusted party',
          active: true,
        },
        c1.id,
      )
    ).id
    const qId = (
      await a.execute(
        'quality.save',
        { name: 'Fancy Oval', description: 'gia graded', hike: '10', active: true },
        c1.id,
      )
    ).id
    await a.execute(
      'bank.save',
      {
        name: 'Axis Bank',
        holder: 'Diamo Co',
        number: 'acc-99',
        ifsc: 'utib0001',
        active: true,
      },
      c1.id,
    )
    await a.execute('account.save', { name: 'Office Travel', kind: 'expense' }, c1.id)
    await a.execute(
      'opening.post',
      {
        date: '2026-04-01',
        lines: [
          { accountId: cashId, debit: 5000000, credit: 0 },
          { accountId: capId, debit: 0, credit: 4900000 },
        ],
        lots: [],
        bills: [
          {
            partyId: pSup,
            direction: 'pay',
            amount: 100000,
            reference: 'op-bill-1',
            date: '2026-04-01',
            dueDate: '2026-04-15',
          },
        ],
        advances: [],
        loans: [],
      },
      c1.id,
    )
    await a.execute(
      'purchase.post',
      {
        date: '2026-04-02',
        partyId: pSup,
        dueDays: 10,
        slipNo: 'bk-1',
        remarks: 'mixed parcel',
        lines: [{ qualityId: qId, carats: 100, rate: '5000', less: '0' }],
        expenses: [
          { description: 'courier charge', amount: 5000, mode: 'supplier', accountId: null },
        ],
      },
      c1.id,
    )
    await a.execute(
      'payment.post',
      {
        date: '2026-04-03',
        partyId: pSup,
        direction: 'pay',
        accountId: cashId,
        amount: 50000,
        mode: 'neft',
        reference: 'utr-77',
        remarks: 'part pay',
        automatic: true,
      },
      c1.id,
    )
    await a.execute(
      'journal.post',
      {
        date: '2026-04-04',
        reference: 'jv-ref',
        narration: 'misc expense',
        lines: [
          { accountId: capId, debit: 1000, credit: 0 },
          { accountId: cashId, debit: 0, credit: 1000 },
        ],
      },
      c1.id,
    )

    // Verify all business fields stored UPPERCASE, while party email & default accounts stay intact
    const st = a.state(c1.id) as any
    expect(st.profile.name).toBe('DIAMO')
    expect(st.profile.address).toBe('SURAT BAZAR')
    expect(st.parties[0]).toMatchObject({
      name: 'ACME DIAMONDS',
      contact_person: 'RAMESH SHAH',
      email: 'sales@acme.com',
      pan: 'ABCDE1234F',
      gstin: '24ABCDE1234F1Z5',
      remarks: 'TRUSTED PARTY',
    })
    expect(st.qualities[0]).toMatchObject({ name: 'FANCY OVAL', description: 'GIA GRADED' })
    expect(st.banks[0]).toMatchObject({
      bank_name: 'AXIS BANK',
      holder: 'DIAMO CO',
      ifsc: 'UTIB0001',
    })
    expect(st.accounts.find((x: any) => x.code === 'CASH').name).toBe('Cash in Hand')
    expect(st.accounts.find((x: any) => x.name === 'OFFICE TRAVEL')).toBeTruthy()
    expect(st.purchases[0]).toMatchObject({ slip_no: 'BK-1', remarks: 'MIXED PARCEL' })
    expect(st.purchases[0].expenses[0].description).toBe('COURIER CHARGE')
    expect(st.payments[0]).toMatchObject({ mode: 'NEFT', reference: 'UTR-77', remarks: 'PART PAY' })
    expect(st.journals.find((j: any) => j.reference === 'JV-REF')?.narration).toBe('MISC EXPENSE')
    expect(st.openItems.find((o: any) => o.kind === 'opening_payable')?.reference).toBe('OP-BILL-1')

    // Switch back and forth between HERO and DIAMO with posted journals intact
    await a.execute('companies.select', { id: c2.id })
    expect((a.state(c2.id) as any).profile.name).toBe('HERO')
    await a.execute('companies.select', { id: c1.id })
    expect((a.state(c1.id) as any).profile.name).toBe('DIAMO')
    a.close()

    // Reopen fresh instance (simulates app restart) and switch into DIAMO cleanly
    const a2 = new ApplicationService(appDir)
    await a2.execute('auth.login', { email: 'admin@gmail.com', password: 'Admin@123' })
    await a2.execute('companies.select', { id: c1.id })
    expect((a2.state(c1.id) as any).journals.length).toBeGreaterThan(0)
    a2.close()
  })

  it('v8 migration uppercases pre-v8 banks, custom accounts, stones & slips without breaking posted journals', () => {
    const dbPath = join(dir, 'pre-v8-full.sqlite')
    const raw = new Database(dbPath)
    raw.exec(companyV1Sql)
    raw
      .prepare(
        "INSERT INTO company_profile(id,name,address,start_date) VALUES(1,'old co','surat','2026-04-01')",
      )
      .run()
    const supId = Number(
      raw
        .prepare(
          "INSERT INTO parties(name,email,pan,active) VALUES('old sup','keep@lower.com','ab123',1)",
        )
        .run().lastInsertRowid,
    )
    const qId = Number(
      raw
        .prepare("INSERT INTO qualities(name,description,active) VALUES('igi','cert stone',1)")
        .run().lastInsertRowid,
    )
    const customAcc = Number(
      raw
        .prepare("INSERT INTO accounts(code,name,kind) VALUES('CUSTOM_123','my travel','expense')")
        .run().lastInsertRowid,
    )
    const jid = Number(
      raw
        .prepare(
          "INSERT INTO journal_entries(number,entry_date,source_type,source_id,narration,reference,status) VALUES('JV/2026-27/0001','2026-04-01','journal',1,'old narration','old-ref','draft')",
        )
        .run().lastInsertRowid,
    )
    raw
      .prepare('INSERT INTO journal_lines(journal_id,account_id,debit,credit) VALUES(?,1,1000,0)')
      .run(jid)
    raw
      .prepare('INSERT INTO journal_lines(journal_id,account_id,debit,credit) VALUES(?,?,0,1000)')
      .run(jid, customAcc)
    raw.prepare("UPDATE journal_entries SET status='posted' WHERE id=?").run(jid)
    raw
      .prepare(
        "INSERT INTO purchases(number,party_id,bill_date,due_days,due_date,remarks,status,supplier_total,stock_total) VALUES('PUR/2026-27/0001',?,'2026-04-01',0,'2026-04-01','mixed remark','posted',1000,1000)",
      )
      .run(supId)
    raw.close()

    const migrated = openDatabase(dbPath, 'company')
    try {
      expect(
        (migrated.prepare('SELECT max(version) v FROM schema_migrations').get() as any).v,
      ).toBe(9)
      expect(
        migrated.prepare('SELECT name,address FROM company_profile').get() as any,
      ).toMatchObject({
        name: 'OLD CO',
        address: 'SURAT',
      })
      expect(
        migrated.prepare('SELECT name,email,pan FROM parties WHERE id=?').get(supId) as any,
      ).toMatchObject({
        name: 'OLD SUP',
        email: 'keep@lower.com',
        pan: 'AB123',
      })
      expect((migrated.prepare('SELECT name FROM qualities WHERE id=?').get(qId) as any).name).toBe(
        'IGI',
      )
      expect(
        (migrated.prepare('SELECT name FROM accounts WHERE code=?').get('CASH') as any).name,
      ).toBe('Cash in Hand')
      expect(
        (migrated.prepare('SELECT name FROM accounts WHERE id=?').get(customAcc) as any).name,
      ).toBe('MY TRAVEL')
      expect((migrated.prepare('SELECT remarks FROM purchases').get() as any).remarks).toBe(
        'MIXED REMARK',
      )

      const svc = new CompanyService(migrated)
      const snap = svc.snapshot({ from: '2026-04-01', to: '2026-12-31' })
      expect(snap.journals[0]).toMatchObject({ narration: 'OLD NARRATION', reference: 'OLD-REF' })
    } finally {
      migrated.close()
    }
  })

  it('Computes invoice currency display summaries and rejects USD sales without exchange rate', () => {
    const db = openDatabase(join(dir, 'currency-summary.sqlite'), 'company')
    db.prepare(
      "INSERT INTO company_profile(id,name,start_date) VALUES(1,'FX CO','2026-04-01')",
    ).run()
    const svc = new CompanyService(db)
    try {
      const sup = (
        svc.execute('party.save', {
          name: 'SUP',
          roles: ['supplier'],
          creditDays: 0,
          active: true,
        }) as any
      ).id
      const cust = (
        svc.execute('party.save', {
          name: 'CUST',
          roles: ['customer'],
          creditDays: 0,
          active: true,
        }) as any
      ).id
      const qId = (
        svc.execute('quality.save', {
          name: 'IGI',
          inventoryMode: 'individual',
          hike: '5',
          active: true,
        }) as any
      ).id

      const pur = svc.execute('purchase.post', {
        date: '2026-04-10',
        partyId: sup,
        dueDays: 0,
        lines: [
          {
            qualityId: qId,
            carats: 812,
            rate: '10070',
            less: '0',
            priceCurrency: 'USD',
            exchangeRate: '95',
            rateUsd: '106',
            totalUsd: '860.72',
            stone: {
              srNo: '',
              priceCurrency: 'USD',
              exchangeRate: '95',
              rateUsd: '106',
              totalUsd: '860.72',
            },
          },
        ],
      }) as any
      expect(pur.displayCurrency).toBe('USD')
      expect(pur.exchangeRate).toBe('95')
      expect(pur.supplierUsd).toBe('860.72')

      let snap = svc.snapshot({ from: '2026-04-01', to: '2026-12-31' })
      const lotId = snap.stones[0].lot_id
      expect(snap.purchases[0]).toMatchObject({
        display_currency: 'USD',
        exchange_rate: '95',
        total_usd: '860.72',
      })

      expect(() =>
        svc.execute('sale.post', {
          date: '2026-04-12',
          partyId: cust,
          dueDays: 0,
          lines: [
            {
              qualityId: qId,
              carats: 812,
              rate: '12000',
              less: '0',
              lots: [{ lotId, carats: 812 }],
              priceCurrency: 'USD',
              exchangeRate: '',
            },
          ],
        }),
      ).toThrow('exchange rate')

      const sale = svc.execute('sale.post', {
        date: '2026-04-12',
        partyId: cust,
        dueDays: 0,
        lines: [
          {
            qualityId: qId,
            carats: 812,
            rate: '11400',
            less: '0',
            lots: [{ lotId, carats: 812 }],
            priceCurrency: 'USD',
            exchangeRate: '95',
            rateUsd: '120',
            totalUsd: '974.40',
          },
        ],
      }) as any
      expect(sale.displayCurrency).toBe('USD')
      expect(sale.invoiceUsd).toBe('974.40')

      snap = svc.snapshot({ from: '2026-04-01', to: '2026-12-31' })
      expect(snap.sales[0]).toMatchObject({
        display_currency: 'USD',
        exchange_rate: '95',
        total_usd: '974.40',
      })
    } finally {
      db.close()
    }
  })
})
