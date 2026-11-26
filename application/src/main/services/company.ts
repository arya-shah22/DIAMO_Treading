import Decimal from 'decimal.js'
import type { Db } from '../database'
import {
  commands,
  type Command,
  type Trade,
  type Payment,
  type Loan,
  type Journal,
  type Row,
  type Query,
} from '../../shared/contracts'
import { addDays, allocate, fy, integer, interest, lineValue } from '../../shared/math'
export class CompanyService {
  private beforeFunds: Record<string, { date: string; balance: number }[]> = {}
  private numberOverride?: string
  constructor(public db: Db) {}
  captureFunds() {
    this.beforeFunds = {}
    for (const a of this.all(
      "SELECT id FROM accounts WHERE code='CASH' OR id IN(SELECT account_id FROM bank_accounts)",
    )) {
      let balance = 0
      this.beforeFunds[a.id] = this.all(
        "SELECT j.entry_date date,sum(l.debit-l.credit) delta FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_id WHERE j.status='posted' AND l.account_id=? GROUP BY j.entry_date ORDER BY j.entry_date",
        a.id,
      ).map((r) => ({ date: r.date, balance: (balance += r.delta) }))
    }
  }
  resolve(kind: string, id: number) {
    return (
      this.all(
        'SELECT record_id FROM document_versions WHERE kind=? AND root_id=? AND current=1',
        kind,
        id,
      )[0]?.record_id ?? id
    )
  }
  publicDocument(kind: string, d: Row): Row {
    const v = this.all(
      'SELECT * FROM document_versions WHERE kind=? AND record_id=?',
      kind,
      d.id,
    )[0]
    return v
      ? { ...d, id: v.root_id, revisionId: d.id, number: v.number, current: !!v.current }
      : { ...d, revisionId: d.id, current: true }
  }
  all(sql: string, ...p: any[]): Row[] {
    return this.db.prepare(sql).all(...p) as Row[]
  }
  one(sql: string, ...p: any[]): Row {
    const r = this.db.prepare(sql).get(...p) as Row | undefined
    if (!r) throw Error('Record not found')
    return r
  }
  run(sql: string, ...p: any[]) {
    return this.db.prepare(sql).run(...p)
  }
  account(code: string) {
    return this.one('SELECT id FROM accounts WHERE code=?', code).id as number
  }
  audit(
    type: string,
    id: number,
    action: string,
    before: unknown,
    after: unknown,
    reason = '',
    date = '',
  ) {
    this.run(
      'INSERT INTO audit_logs(entity_type,entity_id,action,reason,before_json,after_json,effective_date) VALUES(?,?,?,?,?,?,?)',
      type,
      id,
      action,
      reason,
      JSON.stringify(before),
      JSON.stringify(after),
      date,
    )
  }
  sequence(kind: string, date: string) {
    if (this.numberOverride && kind !== 'GL') {
      const n = this.numberOverride
      this.numberOverride = undefined
      return n
    }
    const year = fy(date)
    const y = Number(year.slice(0, 4))
    this.run(
      'INSERT OR IGNORE INTO financial_years VALUES(?,?,?)',
      year,
      `${y}-04-01`,
      `${y + 1}-03-31`,
    )
    this.run('INSERT OR IGNORE INTO number_sequences VALUES(?,?,1)', year, kind)
    const n = this.one(
      'SELECT next_number FROM number_sequences WHERE fy=? AND kind=?',
      year,
      kind,
    ).next_number
    this.run(
      'UPDATE number_sequences SET next_number=next_number+1 WHERE fy=? AND kind=?',
      year,
      kind,
    )
    return `${kind}/${year}/${String(n).padStart(4, '0')}`
  }
  validateDate(date: string) {
    const start = this.one('SELECT start_date FROM company_profile').start_date
    if (date < start) throw Error('Transaction date precedes company opening date')
  }
  party(id: number, role?: string) {
    const p = this.one('SELECT * FROM parties WHERE id=? AND active=1', id)
    if (
      role &&
      !this.all('SELECT role FROM party_roles WHERE party_id=? AND role=?', id, role).length
    )
      throw Error(`Party must have the ${role} role`)
    return p
  }
  fund(id: number) {
    const a = this.one(
      "SELECT * FROM accounts WHERE id=? AND active=1 AND (code='CASH' OR id IN (SELECT account_id FROM bank_accounts))",
      id,
    )
    return a
  }
  journal(
    date: string,
    source: string,
    sourceId: number,
    lines: { accountId: number; debit: number; credit: number }[],
    narration: string,
    number?: string,
    reversalOf?: number,
    reference?: string,
  ) {
    const clean = lines.filter((l) => l.debit || l.credit)
    if (clean.length < 2 || clean.reduce((s, l) => s + l.debit - l.credit, 0) !== 0)
      throw Error('Journal must balance with at least two nonzero lines')
    for (const l of clean) {
      if (
        !Number.isSafeInteger(l.debit) ||
        !Number.isSafeInteger(l.credit) ||
        l.debit < 0 ||
        l.credit < 0 ||
        Boolean(l.debit) === Boolean(l.credit)
      )
        throw Error('Each journal line requires one positive debit or credit')
      this.one('SELECT id FROM accounts WHERE id=?', l.accountId)
    }
    const jid = Number(
      this.run(
        'INSERT INTO journal_entries(number,entry_date,source_type,source_id,narration,reversal_of,reference) VALUES(?,?,?,?,?,?,?)',
        number ?? this.sequence('GL', date),
        date,
        source,
        sourceId,
        narration,
        reversalOf ?? null,
        reference ?? null,
      ).lastInsertRowid,
    )
    for (const l of clean)
      this.run(
        'INSERT INTO journal_lines(journal_id,account_id,debit,credit) VALUES(?,?,?,?)',
        jid,
        l.accountId,
        l.debit,
        l.credit,
      )
    this.run("UPDATE journal_entries SET status='posted' WHERE id=?", jid)
    return jid
  }
  entry(code: string, amount: number) {
    return {
      accountId: this.account(code),
      debit: Math.max(0, amount),
      credit: Math.max(0, -amount),
    }
  }
  balance(accountId: number, to = '9999-12-31') {
    return this.one(
      "SELECT coalesce(sum(l.debit-l.credit),0) balance FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_id WHERE j.status='posted' AND l.account_id=? AND j.entry_date<=?",
      accountId,
      to,
    ).balance as number
  }
  fundsCheck(confirm: boolean) {
    for (const a of this.all(
      "SELECT id,name FROM accounts WHERE code='CASH' OR id IN(SELECT account_id FROM bank_accounts)",
    )) {
      let b = 0
      for (const row of this.all(
        "SELECT j.entry_date,sum(l.debit-l.credit) delta FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_id WHERE j.status='posted' AND l.account_id=? GROUP BY j.entry_date ORDER BY j.entry_date",
        a.id,
      )) {
        b += row.delta
        const previous =
          [...(this.beforeFunds[a.id] ?? [])].reverse().find((r) => r.date <= row.entry_date)
            ?.balance ?? 0
        if (b < 0 && b < previous && !confirm)
          throw Error(
            `NEGATIVE_FUNDS: ${a.name} becomes negative on ${row.entry_date}. Review and explicitly confirm to proceed.`,
          )
      }
    }
  }
  openItem(
    partyId: number,
    kind: string,
    sourceId: number,
    amount: number,
    date: string,
    due: string,
    reference: string,
  ) {
    const code = kind === 'sale' ? 'AR' : kind === 'brokerage' ? 'BROKER' : 'AP'
    const col = kind === 'purchase' ? 'purchase_id' : kind === 'sale' ? 'sale_id' : 'brokerage_id'
    return Number(
      this.run(
        `INSERT INTO open_items(party_id,account_id,kind,${col},reference,bill_date,due_date,amount) VALUES(?,?,?,?,?,?,?,?)`,
        partyId,
        this.account(code),
        kind,
        sourceId,
        reference,
        date,
        due,
        amount,
      ).lastInsertRowid,
    )
  }
  outstanding(id: number) {
    return this.one(
      `SELECT o.*,o.amount-coalesce((SELECT sum(a.amount) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.open_item_id=o.id AND a.active=1 AND p.status='posted'),0)-coalesce((SELECT sum(a.amount) FROM advance_allocations a WHERE a.open_item_id=o.id AND a.active=1),0) outstanding FROM open_items o WHERE o.id=? AND o.active=1`,
      id,
    )
  }
  tradePreview(t: Trade, kind: 'purchase' | 'sale') {
    this.validateDate(t.date)
    this.party(t.partyId, kind === 'purchase' ? 'supplier' : 'customer')
    const lines = t.lines.map((l) => {
      this.one('SELECT id FROM qualities WHERE id=? AND active=1', l.qualityId)
      if (
        this.all(
          "SELECT d.id FROM sales d JOIN sale_items s ON s.sale_id=d.id WHERE d.status='posted' AND s.quality_id=? AND d.bill_date>? LIMIT 1",
          l.qualityId,
          t.date,
        ).length
      )
        throw Error(
          'Later sales depend on this category. Reverse them before inserting a backdated stock transaction.',
        )
      return { ...l, ...lineValue(l.carats, l.rate, l.less), cost: 0 }
    })
    const net = lines.reduce((s, l) => s + l.net, 0)
    let supplier = net,
      stock = net
    if (kind === 'purchase') {
      if (t.brokerages.length || t.adjustments.length)
        throw Error('Purchase cannot contain sale adjustments/brokerage')
      for (const e of t.expenses) {
        const splits = allocate(
          e.amount,
          lines.map((l) => l.net),
        )
        splits.forEach((v, i) => (lines[i].cost += v))
        stock += e.amount
        if (e.mode === 'supplier') supplier += e.amount
        else {
          if (!e.accountId) throw Error('Choose a cash/bank account for separately paid expenses')
          this.fund(e.accountId)
        }
      }
      lines.forEach((l) => (l.cost += l.net))
    } else if (t.expenses.length)
      throw Error('Use sale adjustments or journal vouchers for sale expenses')
    const invoice = net + t.adjustments.reduce((s, a) => s + a.amount, 0)
    if (invoice < 0) throw Error('Invoice total cannot be negative')
    if (
      t.brokerages.some((b) => b.itemIndex === null) &&
      t.brokerages.some((b) => b.itemIndex !== null)
    )
      throw Error('Choose invoice brokerage or line brokerage, not both')
    const brokerages = t.brokerages.map((b) => {
      this.party(b.brokerId, 'broker')
      if (b.itemIndex !== null && !lines[b.itemIndex]) throw Error('Invalid brokerage line')
      const base = b.itemIndex === null ? net : lines[b.itemIndex].net
      return {
        ...b,
        amount:
          b.mode === 'fixed'
            ? integer(new Decimal(b.value).mul(100))
            : integer(new Decimal(base).mul(b.value).div(100)),
      }
    })
    const brokerTotal = brokerages.reduce((s, b) => s + b.amount, 0)
    return {
      lines,
      net,
      supplier,
      stock,
      invoice,
      brokerages,
      brokerTotal,
      proceeds: invoice - brokerTotal,
    }
  }
  purchase(t: Trade) {
    const p = this.tradePreview(t, 'purchase')
    const number = this.sequence('PUR', t.date)
    const id = Number(
      this.run(
        "INSERT INTO purchases(number,party_id,bill_date,due_days,due_date,remarks,status,supplier_total,stock_total) VALUES(?,?,?,?,?,?,'posted',?,?)",
        number,
        t.partyId,
        t.date,
        t.dueDays,
        addDays(t.date, t.dueDays),
        t.remarks,
        p.supplier,
        p.stock,
      ).lastInsertRowid,
    )
    const items: number[] = []
    for (const l of p.lines) {
      const item = Number(
        this.run(
          'INSERT INTO purchase_items(purchase_id,quality_id,carats,rate,less_pct,gross,net) VALUES(?,?,?,?,?,?,?)',
          id,
          l.qualityId,
          l.carats,
          l.rate,
          l.less,
          l.gross,
          l.net,
        ).lastInsertRowid,
      )
      items.push(item)
      const lot = Number(
        this.run(
          'INSERT INTO stock_lots(quality_id,purchase_item_id,acquired_date,original_carats,original_cost,remaining_carats,remaining_cost) VALUES(?,?,?,?,?,?,?)',
          l.qualityId,
          item,
          t.date,
          l.carats,
          l.cost,
          l.carats,
          l.cost,
        ).lastInsertRowid,
      )
      this.run(
        'INSERT INTO stock_movements(lot_id,movement_date,carats_delta,cost_delta,source_type,source_id) VALUES(?,?,?,?,?,?)',
        lot,
        t.date,
        l.carats,
        l.cost,
        'purchase',
        id,
      )
    }
    const entries = [this.entry('INV', p.stock), this.entry('AP', -p.supplier)]
    for (const e of t.expenses) {
      const eid = Number(
        this.run(
          'INSERT INTO purchase_expenses(purchase_id,description,amount,mode,fund_account_id) VALUES(?,?,?,?,?)',
          id,
          e.description,
          e.amount,
          e.mode,
          e.mode === 'separate' ? e.accountId : null,
        ).lastInsertRowid,
      )
      allocate(
        e.amount,
        p.lines.map((l) => l.net),
      ).forEach((v, i) =>
        this.run('INSERT INTO purchase_expense_allocations VALUES(?,?,?)', eid, items[i], v),
      )
      if (e.mode === 'separate')
        entries.push({ accountId: e.accountId!, debit: 0, credit: e.amount })
    }
    if (p.stock) {
      const jid = this.journal(t.date, 'purchase', id, entries, number)
      this.run('UPDATE purchases SET journal_id=? WHERE id=?', jid, id)
    }
    this.openItem(t.partyId, 'purchase', id, p.supplier, t.date, addDays(t.date, t.dueDays), number)
    this.fundsCheck(t.confirmNegative)
    this.audit('purchase', id, 'post', null, t, '', t.date)
    return { id, number, ...p }
  }
  sale(t: Trade) {
    const p = this.tradePreview(t, 'sale')
    const number = this.sequence('SAL', t.date)
    const id = Number(
      this.run(
        "INSERT INTO sales(number,party_id,bill_date,due_days,due_date,remarks,status,invoice_total) VALUES(?,?,?,?,?,?,'posted',?)",
        number,
        t.partyId,
        t.date,
        t.dueDays,
        addDays(t.date, t.dueDays),
        t.remarks,
        p.invoice,
      ).lastInsertRowid,
    )
    let cogs = 0
    const items: number[] = []
    for (const l of p.lines) {
      const item = Number(
        this.run(
          'INSERT INTO sale_items(sale_id,quality_id,carats,rate,less_pct,gross,net) VALUES(?,?,?,?,?,?,?)',
          id,
          l.qualityId,
          l.carats,
          l.rate,
          l.less,
          l.gross,
          l.net,
        ).lastInsertRowid,
      )
      items.push(item)
      let needed = l.carats
      const eligible = this.all(
        'SELECT * FROM stock_lots WHERE quality_id=? AND acquired_date<=? AND remaining_carats>0 ORDER BY acquired_date,id',
        l.qualityId,
        t.date,
      )
      if (l.lots.length && l.lots.reduce((s, a) => s + a.carats, 0) !== l.carats)
        throw Error('Manual lot quantities must equal the sale quantity')
      if (new Set(l.lots.map((a) => a.lotId)).size !== l.lots.length)
        throw Error('Duplicate manual lot selection')
      const selections = l.lots.length
        ? l.lots
        : eligible.map((lot) => ({ lotId: lot.id, carats: Math.min(needed, lot.remaining_carats) }))
      for (const selection of selections) {
        if (!needed) break
        const lot = eligible.find((x) => x.id === selection.lotId)
        if (!lot) throw Error('Selected lot is not eligible on sale date')
        const qty = l.lots.length ? selection.carats : Math.min(needed, lot.remaining_carats)
        if (qty > lot.remaining_carats || qty > needed) throw Error('Insufficient lot stock')
        const cost =
          qty === lot.remaining_carats
            ? lot.remaining_cost
            : integer(new Decimal(lot.remaining_cost).mul(qty).div(lot.remaining_carats))
        this.run(
          'UPDATE stock_lots SET remaining_carats=remaining_carats-?,remaining_cost=remaining_cost-? WHERE id=?',
          qty,
          cost,
          lot.id,
        )
        this.run(
          'INSERT INTO sale_stock_allocations(sale_item_id,lot_id,carats,cost,mode) VALUES(?,?,?,?,?)',
          item,
          lot.id,
          qty,
          cost,
          l.lots.length ? 'manual' : 'fifo',
        )
        this.run(
          'INSERT INTO stock_movements(lot_id,movement_date,carats_delta,cost_delta,source_type,source_id) VALUES(?,?,?,?,?,?)',
          lot.id,
          t.date,
          -qty,
          -cost,
          'sale',
          id,
        )
        needed -= qty
        cogs += cost
      }
      if (needed) throw Error('Insufficient stock available on the sale date')
    }
    for (const a of t.adjustments)
      this.run(
        'INSERT INTO sale_adjustments(sale_id,description,amount) VALUES(?,?,?)',
        id,
        a.description,
        a.amount,
      )
    for (const b of p.brokerages) {
      const bid = Number(
        this.run(
          'INSERT INTO sale_brokerages(sale_id,item_id,broker_id,mode,input_value,amount) VALUES(?,?,?,?,?,?)',
          id,
          b.itemIndex === null ? null : items[b.itemIndex],
          b.brokerId,
          b.mode,
          b.value,
          b.amount,
        ).lastInsertRowid,
      )
      this.openItem(
        b.brokerId,
        'brokerage',
        bid,
        b.amount,
        t.date,
        addDays(t.date, t.dueDays),
        number,
      )
    }
    const entries = [
      this.entry('AR', p.invoice),
      this.entry('SALES', -p.invoice),
      this.entry('COGS', cogs),
      this.entry('INV', -cogs),
      this.entry('BROKER_EXP', p.brokerTotal),
      this.entry('BROKER', -p.brokerTotal),
    ]
    if (entries.some((e) => e.debit || e.credit)) {
      const jid = this.journal(t.date, 'sale', id, entries, number)
      this.run('UPDATE sales SET journal_id=? WHERE id=?', jid, id)
    }
    this.openItem(t.partyId, 'sale', id, p.invoice, t.date, addDays(t.date, t.dueDays), number)
    this.stockCheck()
    this.audit('sale', id, 'post', null, t, '', t.date)
    return { id, number, ...p, cogs, profit: p.proceeds - cogs }
  }
  stockCheck() {
    for (const lot of this.all('SELECT id FROM stock_lots')) {
      let qty = 0,
        cost = 0
      for (const m of this.all(
        'SELECT movement_date,sum(carats_delta) qty,sum(cost_delta) cost FROM stock_movements WHERE lot_id=? GROUP BY movement_date ORDER BY movement_date',
        lot.id,
      )) {
        qty += m.qty
        cost += m.cost
        if (qty < 0 || cost < 0 || (qty === 0 && cost !== 0))
          throw Error('Historical stock or residual cost would be invalid')
      }
    }
  }
  payment(t: Payment) {
    this.validateDate(t.date)
    this.party(t.partyId)
    this.fund(t.accountId)
    const number = this.sequence(t.direction === 'pay' ? 'PAY' : 'REC', t.date)
    const id = Number(
      this.run(
        "INSERT INTO payments(number,party_id,payment_date,direction,fund_account_id,amount,mode,reference,remarks,status) VALUES(?,?,?,?,?,?,?,?,?,'posted')",
        number,
        t.partyId,
        t.date,
        t.direction,
        t.accountId,
        t.amount,
        t.mode,
        t.reference,
        t.remarks,
      ).lastInsertRowid,
    )
    let remaining = t.amount
    const entries: { accountId: number; debit: number; credit: number }[] = []
    const candidates = t.automatic
      ? this.all(
          'SELECT id FROM open_items WHERE party_id=? AND active=1 AND bill_date<=? ORDER BY bill_date,id',
          t.partyId,
          t.date,
        ).map((o) => ({ itemId: o.id, amount: Number.MAX_SAFE_INTEGER }))
      : t.allocations
    if (new Set(candidates.map((c) => c.itemId)).size !== candidates.length)
      throw Error('Duplicate invoice allocation')
    for (const a of candidates) {
      const o = this.outstanding(a.itemId)
      const receivable = ['sale', 'opening_receivable'].includes(o.kind)
      if (t.automatic && receivable !== (t.direction === 'receive')) continue
      if (
        o.party_id !== t.partyId ||
        receivable !== (t.direction === 'receive') ||
        o.bill_date > t.date
      )
        throw Error('Payment allocation has incompatible party, direction or date')
      const v = t.automatic ? Math.min(remaining, o.outstanding) : a.amount
      if (!v) continue
      if (v > remaining || v > o.outstanding)
        throw Error('Allocation exceeds payment or invoice outstanding')
      this.run(
        'INSERT INTO payment_allocations(payment_id,open_item_id,amount) VALUES(?,?,?)',
        id,
        o.id,
        v,
      )
      entries.push({
        accountId: o.account_id,
        debit: t.direction === 'pay' ? v : 0,
        credit: t.direction === 'receive' ? v : 0,
      })
      remaining -= v
      if (!remaining && t.automatic) break
    }
    if (remaining) {
      const code = t.direction === 'pay' ? 'ADV_PAID' : 'ADV_REC'
      this.run(
        'INSERT INTO advances(party_id,payment_id,account_id,direction,amount) VALUES(?,?,?,?,?)',
        t.partyId,
        id,
        this.account(code),
        t.direction === 'pay' ? 'paid' : 'received',
        remaining,
      )
      entries.push(this.entry(code, t.direction === 'pay' ? remaining : -remaining))
    }
    entries.push({
      accountId: t.accountId,
      debit: t.direction === 'receive' ? t.amount : 0,
      credit: t.direction === 'pay' ? t.amount : 0,
    })
    const jid = this.journal(t.date, 'payment', id, entries, number)
    this.run('UPDATE payments SET journal_id=? WHERE id=?', jid, id)
    this.fundsCheck(t.confirmNegative)
    this.audit('payment', id, 'post', null, t, '', t.date)
    return { id, number, advance: remaining }
  }
  applyAdvance(t: { advanceId: number; itemId: number; amount: number; date: string }) {
    const a = this.one(
      'SELECT a.*,coalesce(p.payment_date,o.opening_date) date FROM advances a LEFT JOIN payments p ON p.id=a.payment_id LEFT JOIN opening_balances o ON o.id=a.opening_id WHERE a.id=? AND a.active=1',
      t.advanceId,
    )
    const o = this.outstanding(t.itemId)
    const used = this.one(
      'SELECT coalesce(sum(amount),0) n FROM advance_allocations WHERE advance_id=? AND active=1',
      a.id,
    ).n
    if (
      a.party_id !== o.party_id ||
      t.amount > a.amount - used ||
      t.amount > o.outstanding ||
      t.date < a.date ||
      t.date < o.bill_date ||
      ['sale', 'opening_receivable'].includes(o.kind) !== (a.direction === 'received')
    )
      throw Error('Invalid advance allocation, date, direction or amount')
    const entries = [
      {
        accountId: a.account_id,
        debit: a.direction === 'received' ? t.amount : 0,
        credit: a.direction === 'paid' ? t.amount : 0,
      },
      {
        accountId: o.account_id,
        debit: a.direction === 'paid' ? t.amount : 0,
        credit: a.direction === 'received' ? t.amount : 0,
      },
    ]
    const jid = this.journal(t.date, 'advance', a.id, entries, 'Apply advance')
    const id = Number(
      this.run(
        'INSERT INTO advance_allocations(advance_id,open_item_id,amount,allocation_date,journal_id) VALUES(?,?,?,?,?)',
        a.id,
        o.id,
        t.amount,
        t.date,
        jid,
      ).lastInsertRowid,
    )
    this.audit('advance', id, 'apply', null, t, '', t.date)
    return { id }
  }
  loan(t: Loan) {
    this.validateDate(t.date)
    this.party(t.partyId)
    this.fund(t.accountId)
    if (t.returnDate && t.returnDate < t.date) throw Error('Return date precedes loan date')
    const number = this.sequence(t.kind === 'taken' ? 'LT' : 'LG', t.date)
    const id = Number(
      this.run(
        "INSERT INTO loans(number,party_id,kind,principal,rate,frequency,loan_date,return_date,fund_account_id,status,remarks) VALUES(?,?,?,?,?,?,?,?,?,'open',?)",
        number,
        t.partyId,
        t.kind,
        t.principal,
        t.rate,
        t.frequency,
        t.date,
        t.returnDate,
        t.accountId,
        t.remarks,
      ).lastInsertRowid,
    )
    const jid = this.journal(
      t.date,
      'loan',
      id,
      [
        this.entry(
          t.kind === 'taken' ? 'LOAN_T' : 'LOAN_G',
          t.kind === 'taken' ? -t.principal : t.principal,
        ),
        {
          accountId: t.accountId,
          debit: t.kind === 'taken' ? t.principal : 0,
          credit: t.kind === 'given' ? t.principal : 0,
        },
      ],
      number,
    )
    this.run('UPDATE loans SET journal_id=? WHERE id=?', jid, id)
    this.fundsCheck(t.confirmNegative)
    this.audit('loan', id, 'post', null, t, '', t.date)
    return { id, number }
  }
  loanAccrual(l: Row, to: string) {
    if (l.status === 'cancelled') return { accrued: 0, paid: 0, outstanding: 0, closed: false }
    const settlement = this.all(
      'SELECT * FROM loan_settlements WHERE loan_id=? AND active=1 AND settlement_date<=?',
      l.id,
      to,
    )[0]
    const end = settlement ? settlement.settlement_date : to
    const opening = this.all(
      "SELECT * FROM loan_interest_entries WHERE loan_id=? AND kind='opening' AND active=1",
      l.id,
    )[0]
    const accrued = opening
      ? opening.amount + interest(l.principal, l.rate, l.frequency, opening.entry_date, end)
      : interest(l.principal, l.rate, l.frequency, l.loan_date, end)
    const paid = this.one(
      "SELECT coalesce(sum(amount),0) n FROM loan_interest_entries WHERE loan_id=? AND active=1 AND kind='payment' AND entry_date<=?",
      l.id,
      to,
    ).n
    return { accrued, paid, outstanding: Math.max(0, accrued - paid), closed: !!settlement }
  }
  settle(t: {
    id: number
    date: string
    accountId: number
    interest: number
    close: boolean
    confirmNegative: boolean
  }) {
    t = { ...t, id: this.resolve('loan', t.id) }
    const l = this.one("SELECT * FROM loans WHERE id=? AND status='open'", t.id)
    this.fund(t.accountId)
    if (t.date < l.loan_date) throw Error('Settlement precedes loan')
    const last = this.one(
      'SELECT max(entry_date) date FROM loan_interest_entries WHERE loan_id=? AND active=1',
      l.id,
    ).date
    if (last && t.date < last) throw Error('Cannot backdate before an existing interest entry')
    const accrual = this.loanAccrual(l, t.date)
    if (t.interest > accrual.outstanding || (t.close && t.interest !== accrual.outstanding))
      throw Error(
        'Full settlement must include all outstanding interest; interest payment cannot exceed accrual',
      )
    if (!t.close && !t.interest) throw Error('Enter a positive interest payment')
    const taken = l.kind === 'taken'
    const accruedPosted = this.one(
      "SELECT coalesce(sum(amount),0) n FROM loan_interest_entries WHERE loan_id=? AND kind IN ('accrual','opening') AND active=1",
      l.id,
    ).n
    const newAccrual = accrual.accrued - accruedPosted
    if (newAccrual > 0) {
      const aj = this.journal(
        t.date,
        'interest',
        l.id,
        [
          this.entry(taken ? 'INT_EXP' : 'INT_AR', newAccrual),
          this.entry(taken ? 'INT_AP' : 'INT_INC', -newAccrual),
        ],
        'Interest accrual',
      )
      this.run(
        "INSERT INTO loan_interest_entries(loan_id,entry_date,kind,amount,journal_id) VALUES(?,?,'accrual',?,?)",
        l.id,
        t.date,
        newAccrual,
        aj,
      )
    }
    const principal = t.close ? l.principal : 0
    const entries = [
      this.entry(taken ? 'INT_AP' : 'INT_AR', taken ? t.interest : -t.interest),
      {
        accountId: t.accountId,
        debit: taken ? 0 : principal + t.interest,
        credit: taken ? principal + t.interest : 0,
      },
    ]
    if (principal)
      entries.push(this.entry(taken ? 'LOAN_T' : 'LOAN_G', taken ? principal : -principal))
    const jid = this.journal(
      t.date,
      'settlement',
      l.id,
      entries,
      t.close ? 'Full loan settlement' : 'Interest payment',
    )
    if (t.interest)
      this.run(
        "INSERT INTO loan_interest_entries(loan_id,entry_date,kind,amount,fund_account_id,journal_id) VALUES(?,?,'payment',?,?,?)",
        l.id,
        t.date,
        t.interest,
        t.accountId,
        jid,
      )
    if (t.close) {
      this.run(
        'INSERT INTO loan_settlements(loan_id,settlement_date,principal,interest,fund_account_id,journal_id) VALUES(?,?,?,?,?,?)',
        l.id,
        t.date,
        principal,
        t.interest,
        t.accountId,
        jid,
      )
      this.run("UPDATE loans SET status='closed' WHERE id=?", l.id)
    }
    this.fundsCheck(t.confirmNegative)
    this.audit('loan', l.id, 'settle', l, t, '', t.date)
    return { id: l.id }
  }
  postJournal(t: Journal) {
    this.validateDate(t.date)
    for (const l of t.lines) {
      const a = this.one('SELECT * FROM accounts WHERE id=? AND active=1', l.accountId)
      if (
        a.control &&
        a.code !== 'CASH' &&
        !this.all('SELECT id FROM bank_accounts WHERE account_id=?', a.id).length
      )
        throw Error(`${a.name} requires its subledger workflow`)
      if (a.party_id) throw Error('Party adjustments require an invoice/settlement workflow')
    }
    const number = this.sequence('JV', t.date)
    const id = this.journal(
      t.date,
      'journal',
      0,
      t.lines,
      t.narration,
      number,
      undefined,
      t.reference,
    )
    this.fundsCheck(t.confirmNegative)
    this.audit('journal', id, 'post', null, t, '', t.date)
    return { id, number }
  }
  transfer(t: {
    date: string
    source: number
    destination: number
    amount: number
    confirmNegative: boolean
  }) {
    this.validateDate(t.date)
    this.fund(t.source)
    this.fund(t.destination)
    if (t.source === t.destination) throw Error('Choose two different accounts')
    const number = this.sequence('TRF', t.date)
    const id = Number(
      this.run(
        "INSERT INTO fund_transfers(number,transfer_date,source_account,destination_account,amount,status) VALUES(?,?,?,?,?,'posted')",
        number,
        t.date,
        t.source,
        t.destination,
        t.amount,
      ).lastInsertRowid,
    )
    const jid = this.journal(
      t.date,
      'transfer',
      id,
      [
        { accountId: t.destination, debit: t.amount, credit: 0 },
        { accountId: t.source, debit: 0, credit: t.amount },
      ],
      number,
    )
    this.run('UPDATE fund_transfers SET journal_id=? WHERE id=?', jid, id)
    this.fundsCheck(t.confirmNegative)
    this.audit('transfer', id, 'post', null, t, '', t.date)
    return { id, number }
  }
  reverse(journalId: number, reason: string) {
    const j = this.one("SELECT * FROM journal_entries WHERE id=? AND status='posted'", journalId)
    if (this.all('SELECT id FROM journal_entries WHERE reversal_of=?', journalId).length)
      throw Error('Already reversed')
    const lines = this.all('SELECT * FROM journal_lines WHERE journal_id=?', journalId).map(
      (l) => ({ accountId: l.account_id, debit: l.credit, credit: l.debit }),
    )
    return this.journal(j.entry_date, 'reversal', j.id, lines, reason, undefined, j.id)
  }
  cancel(kind: string, id: number, reason: string) {
    id = this.resolve(kind, id)
    const tables: Record<string, string> = {
      purchase: 'purchases',
      sale: 'sales',
      payment: 'payments',
      loan: 'loans',
      journal: 'journal_entries',
      transfer: 'fund_transfers',
    }
    const table = tables[kind]
    if (!table) throw Error('Unsupported document')
    const d = this.one(`SELECT * FROM ${table} WHERE id=?`, id)
    if (d.status === 'cancelled') throw Error('Already cancelled')
    if (kind === 'purchase' || kind === 'sale') {
      const items = this.all(
        `SELECT id FROM open_items WHERE ${kind === 'purchase' ? 'purchase_id' : 'sale_id'}=? OR brokerage_id IN (SELECT id FROM sale_brokerages WHERE sale_id=?)`,
        kind === 'purchase' ? id : id,
        kind === 'sale' ? id : -1,
      )
      for (const item of items) {
        const o = this.outstanding(item.id)
        if (o.outstanding !== o.amount)
          throw Error('Reverse dependent payments/advance applications first')
      }
      if (kind === 'purchase') {
        const lots = this.all(
          'SELECT l.* FROM stock_lots l JOIN purchase_items p ON p.id=l.purchase_item_id WHERE p.purchase_id=?',
          id,
        )
        for (const lot of lots) {
          if (
            this.all('SELECT id FROM sale_stock_allocations WHERE lot_id=? AND active=1', lot.id)
              .length
          )
            throw Error('Purchase stock has been consumed; cancel dependent sales first')
          this.run('UPDATE stock_lots SET remaining_carats=0,remaining_cost=0 WHERE id=?', lot.id)
          this.run(
            'INSERT INTO stock_movements(lot_id,movement_date,carats_delta,cost_delta,source_type,source_id) VALUES(?,?,?,?,?,?)',
            lot.id,
            d.bill_date,
            -lot.original_carats,
            -lot.original_cost,
            'purchase_cancel',
            id,
          )
        }
      } else {
        for (const a of this.all(
          'SELECT a.* FROM sale_stock_allocations a JOIN sale_items s ON s.id=a.sale_item_id WHERE s.sale_id=? AND a.active=1',
          id,
        )) {
          if (
            this.all(
              'SELECT a.id FROM sale_stock_allocations a JOIN sale_items s ON s.id=a.sale_item_id JOIN sales d ON d.id=s.sale_id WHERE a.lot_id=? AND a.active=1 AND s.sale_id<>? AND (d.bill_date>? OR (d.bill_date=? AND d.id>?))',
              a.lot_id,
              id,
              d.bill_date,
              d.bill_date,
              id,
            ).length
          )
            throw Error('A later sale uses this lot; reverse it first to preserve residual costing')
          this.run(
            'UPDATE stock_lots SET remaining_carats=remaining_carats+?,remaining_cost=remaining_cost+? WHERE id=?',
            a.carats,
            a.cost,
            a.lot_id,
          )
          this.run(
            'INSERT INTO stock_movements(lot_id,movement_date,carats_delta,cost_delta,source_type,source_id) VALUES(?,?,?,?,?,?)',
            a.lot_id,
            d.bill_date,
            a.carats,
            a.cost,
            'sale_cancel',
            id,
          )
          this.run('UPDATE sale_stock_allocations SET active=0 WHERE id=?', a.id)
        }
      }
      for (const item of items) this.run('UPDATE open_items SET active=0 WHERE id=?', item.id)
    }
    if (kind === 'payment') {
      if (
        this.all(
          'SELECT aa.id FROM advance_allocations aa JOIN advances a ON a.id=aa.advance_id WHERE a.payment_id=? AND aa.active=1',
          id,
        ).length
      )
        throw Error('This payment advance has been applied; reverse the application first')
      this.run('UPDATE payment_allocations SET active=0 WHERE payment_id=?', id)
      this.run('UPDATE advances SET active=0 WHERE payment_id=?', id)
    }
    if (kind === 'loan') {
      if (d.opening_id) throw Error('Opening loans cannot be cancelled individually')
      if (
        this.all('SELECT id FROM loan_interest_entries WHERE loan_id=? AND active=1', id).length ||
        this.all('SELECT id FROM loan_settlements WHERE loan_id=? AND active=1', id).length
      )
        throw Error('Loan has dependent interest or settlement entries')
    }
    if (kind === 'journal') {
      if (d.source_type !== 'journal') throw Error('Use the source transaction workflow')
      this.reverse(id, reason)
    } else {
      if (d.journal_id) this.reverse(d.journal_id, reason)
      this.run(`UPDATE ${table} SET status='cancelled' WHERE id=?`, id)
    }
    this.stockCheck()
    this.fundsCheck(false)
    this.audit(
      kind,
      id,
      'cancel',
      d,
      null,
      reason,
      d.bill_date ?? d.payment_date ?? d.loan_date ?? d.transfer_date ?? d.entry_date,
    )
    return { id }
  }
  opening(t: any) {
    if (this.all('SELECT id FROM opening_balances').length)
      throw Error('Opening balances have already been posted')
    const profile = this.one('SELECT * FROM company_profile')
    if (t.date !== profile.start_date) throw Error('Opening date must match company start date')
    if (this.all('SELECT id FROM journal_entries').length)
      throw Error('Opening balances must be entered before transactions')
    const oid = Number(
      this.run(
        'INSERT INTO opening_balances(opening_date,description) VALUES(?,?)',
        t.date,
        'Opening balances',
      ).lastInsertRowid,
    )
    const entries = [...t.lines]
    for (const line of entries) {
      const a = this.one('SELECT * FROM accounts WHERE id=?', line.accountId)
      if (
        a.control &&
        a.code !== 'CASH' &&
        !this.all('SELECT id FROM bank_accounts WHERE account_id=?', a.id).length
      )
        throw Error('Enter controlled balances in stock, bills, advances or loans sections')
    }
    for (const l of t.lots) {
      this.one('SELECT id FROM qualities WHERE id=? AND active=1', l.qualityId)
      if (l.date > t.date) throw Error('Opening lot acquisition date cannot be after opening date')
      const lid = Number(
        this.run(
          'INSERT INTO stock_lots(quality_id,opening_id,acquired_date,original_carats,original_cost,remaining_carats,remaining_cost) VALUES(?,?,?,?,?,?,?)',
          l.qualityId,
          oid,
          l.date,
          l.carats,
          l.cost,
          l.carats,
          l.cost,
        ).lastInsertRowid,
      )
      this.run(
        'INSERT INTO stock_movements(lot_id,movement_date,carats_delta,cost_delta,source_type,source_id) VALUES(?,?,?,?,?,?)',
        lid,
        t.date,
        l.carats,
        l.cost,
        'opening',
        oid,
      )
      entries.push(this.entry('INV', l.cost))
    }
    for (const b of t.bills) {
      this.party(b.partyId, b.direction === 'pay' ? 'supplier' : 'customer')
      if (b.date > t.date || b.dueDate < b.date) throw Error('Invalid opening invoice dates')
      const code = b.direction === 'pay' ? 'AP' : 'AR'
      this.run(
        'INSERT INTO open_items(party_id,account_id,kind,opening_id,reference,bill_date,due_date,amount) VALUES(?,?,?,?,?,?,?,?)',
        b.partyId,
        this.account(code),
        b.direction === 'pay' ? 'opening_payable' : 'opening_receivable',
        oid,
        b.reference,
        b.date,
        b.dueDate,
        b.amount,
      )
      entries.push(this.entry(code, b.direction === 'pay' ? -b.amount : b.amount))
    }
    for (const a of t.advances) {
      this.party(a.partyId)
      const code = a.direction === 'paid' ? 'ADV_PAID' : 'ADV_REC'
      this.run(
        'INSERT INTO advances(party_id,opening_id,account_id,direction,amount) VALUES(?,?,?,?,?)',
        a.partyId,
        oid,
        this.account(code),
        a.direction,
        a.amount,
      )
      entries.push(this.entry(code, a.direction === 'paid' ? a.amount : -a.amount))
    }
    for (const l of t.loans) {
      this.party(l.partyId)
      if (l.date > t.date) throw Error('Opening loan starts after opening date')
      const total = interest(l.principal, l.rate, l.frequency, l.date, t.date)
      if (total !== l.paidInterest + l.accruedInterest)
        throw Error('Opening loan paid plus accrued interest must match elapsed-day interest')
      const number = this.sequence(l.kind === 'taken' ? 'LT' : 'LG', t.date)
      const lid = Number(
        this.run(
          "INSERT INTO loans(number,party_id,kind,principal,rate,frequency,loan_date,opening_id,status) VALUES(?,?,?,?,?,?,?,?,'open')",
          number,
          l.partyId,
          l.kind,
          l.principal,
          l.rate,
          l.frequency,
          l.date,
          oid,
        ).lastInsertRowid,
      )
      this.run(
        "INSERT INTO loan_interest_entries(loan_id,entry_date,kind,amount,prior_paid) VALUES(?,?,'opening',?,?)",
        lid,
        t.date,
        l.accruedInterest,
        l.paidInterest,
      )
      entries.push(
        this.entry(
          l.kind === 'taken' ? 'LOAN_T' : 'LOAN_G',
          l.kind === 'taken' ? -l.principal : l.principal,
        ),
      )
      entries.push(
        this.entry(
          l.kind === 'taken' ? 'INT_AP' : 'INT_AR',
          l.kind === 'taken' ? -l.accruedInterest : l.accruedInterest,
        ),
      )
    }
    const jid = this.journal(t.date, 'opening', oid, entries, 'Opening balances')
    this.run('UPDATE opening_balances SET journal_id=? WHERE id=?', jid, oid)
    this.fundsCheck(false)
    this.audit('opening', oid, 'post', null, t, '', t.date)
    return { id: oid }
  }
  execute(name: Command, input: unknown, operationKey?: string) {
    const t: any = commands[name].parse(input)
    const isPreview = name.endsWith('.preview') || name === 'document.previewEdit'
    this.captureFunds()
    return this.db.transaction(() => {
      if (operationKey && !isPreview) {
        const existing = this.all('SELECT result FROM operation_keys WHERE key=?', operationKey)[0]
        if (existing) return JSON.parse(existing.result)
      }
      const result = (() => {
        switch (name) {
          case 'party.save': {
            const values = [
              t.name,
              t.contactPerson,
              t.phone,
              t.email,
              t.address,
              t.pan,
              t.gstin,
              t.creditDays,
              t.remarks,
              +t.active,
            ]
            let key = t.id
            const before = key ? this.one('SELECT * FROM parties WHERE id=?', key) : null
            if (key)
              this.run(
                'UPDATE parties SET name=?,contact_person=?,phone=?,email=?,address=?,pan=?,gstin=?,credit_days=?,remarks=?,active=? WHERE id=?',
                ...values,
                key,
              )
            else
              key = Number(
                this.run(
                  'INSERT INTO parties(name,contact_person,phone,email,address,pan,gstin,credit_days,remarks,active) VALUES(?,?,?,?,?,?,?,?,?,?)',
                  ...values,
                ).lastInsertRowid,
              )
            if (before) {
              const roles = this.all('SELECT role FROM party_roles WHERE party_id=?', key).map(
                (r) => r.role,
              )
              for (const role of roles)
                if (
                  !t.roles.includes(role) &&
                  this.all('SELECT id FROM open_items WHERE party_id=?', key).length
                )
                  throw Error('Cannot remove a role from a party with transaction history')
            }
            this.run('DELETE FROM party_roles WHERE party_id=?', key)
            for (const role of new Set(t.roles))
              this.run('INSERT INTO party_roles VALUES(?,?)', key, role)
            this.audit('party', key, 'save', before, t)
            return { id: key }
          }
          case 'quality.save': {
            const before = t.id ? this.one('SELECT * FROM qualities WHERE id=?', t.id) : null
            const key =
              t.id ??
              Number(
                this.run(
                  'INSERT INTO qualities(name,description,hike_pct,active) VALUES(?,?,?,?)',
                  t.name,
                  t.description,
                  t.hike,
                  +t.active,
                ).lastInsertRowid,
              )
            if (t.id)
              this.run(
                'UPDATE qualities SET name=?,description=?,hike_pct=?,active=? WHERE id=?',
                t.name,
                t.description,
                t.hike,
                +t.active,
                t.id,
              )
            this.audit('quality', key, 'save', before, t)
            return { id: key }
          }
          case 'bank.save': {
            let key = t.id
            const before = key ? this.one('SELECT * FROM bank_accounts WHERE id=?', key) : null
            if (key) {
              this.run(
                'UPDATE bank_accounts SET bank_name=?,holder=?,account_number=?,ifsc=? WHERE id=?',
                t.name,
                t.holder,
                t.number,
                t.ifsc,
                key,
              )
              this.run(
                'UPDATE accounts SET name=?,active=? WHERE id=?',
                t.name,
                +t.active,
                before!.account_id,
              )
            } else {
              const aid = Number(
                this.run(
                  "INSERT INTO accounts(code,name,kind,control,active) VALUES(?,?,'asset',1,?)",
                  `BANK_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  t.name,
                  +t.active,
                ).lastInsertRowid,
              )
              key = Number(
                this.run(
                  'INSERT INTO bank_accounts(account_id,bank_name,holder,account_number,ifsc) VALUES(?,?,?,?,?)',
                  aid,
                  t.name,
                  t.holder,
                  t.number,
                  t.ifsc,
                ).lastInsertRowid,
              )
            }
            this.audit('bank', key, 'save', before, t)
            return { id: key }
          }
          case 'account.save': {
            const key = Number(
              this.run(
                'INSERT INTO accounts(code,name,kind) VALUES(?,?,?)',
                `CUSTOM_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                t.name,
                t.kind,
              ).lastInsertRowid,
            )
            this.audit('account', key, 'create', null, t)
            return { id: key }
          }
          case 'purchase.preview':
            return this.tradePreview(t, 'purchase')
          case 'sale.preview': {
            this.db.exec('SAVEPOINT preview')
            try {
              return this.sale(t)
            } finally {
              this.db.exec('ROLLBACK TO preview; RELEASE preview')
            }
          }
          case 'purchase.post':
            return this.purchase(t)
          case 'sale.post':
            return this.sale(t)
          case 'payment.post':
            return this.payment(t)
          case 'loan.post':
            return this.loan(t)
          case 'loan.settle':
            return this.settle(t)
          case 'journal.post':
            return this.postJournal(t)
          case 'transfer.post':
            return this.transfer(t)
          case 'advance.apply':
            return this.applyAdvance(t)
          case 'document.cancel':
            return this.cancel(t.kind, t.id, t.reason)
          case 'opening.post':
            return this.opening(t)
          case 'document.previewEdit': {
            this.db.exec('SAVEPOINT edit_preview')
            try {
              return this.edit(t)
            } finally {
              this.db.exec('ROLLBACK TO edit_preview; RELEASE edit_preview')
            }
          }
          case 'document.edit':
            return this.edit(t)
          case 'advance.reverse':
            return this.reverseAdvance(t)
          case 'loan.reverseSettlement':
            return this.reverseSettlement(t)
          case 'settings.numbering': {
            const y = Number(t.year.slice(0, 4))
            if (t.year !== fy(`${y}-04-01`)) throw Error('Invalid financial year')
            this.run(
              'INSERT OR IGNORE INTO financial_years VALUES(?,?,?)',
              t.year,
              `${y}-04-01`,
              `${y + 1}-03-31`,
            )
            const old =
              this.all(
                'SELECT next_number FROM number_sequences WHERE fy=? AND kind=?',
                t.year,
                t.kind,
              )[0]?.next_number ?? 1
            if (t.nextNumber < old)
              throw Error('Next number cannot move backwards or reuse an issued number')
            this.run(
              'INSERT INTO number_sequences(fy,kind,next_number) VALUES(?,?,?) ON CONFLICT(fy,kind) DO UPDATE SET next_number=excluded.next_number',
              t.year,
              t.kind,
              t.nextNumber,
            )
            this.audit('sequence', 1, 'configure', { nextNumber: old }, t)
            return { saved: true }
          }
          case 'settings.save': {
            const before = this.one('SELECT * FROM company_profile')
            this.run(
              'UPDATE company_profile SET name=?,address=?,contact=?',
              t.name,
              t.address,
              t.contact,
            )
            this.run("INSERT OR REPLACE INTO company_settings VALUES('global_hike_pct',?)", t.hike)
            this.run(
              "INSERT OR REPLACE INTO company_settings VALUES('default_credit_days',?)",
              String(t.creditDays),
            )
            this.audit('settings', 1, 'save', before, t)
            return { saved: true }
          }
          default:
            throw Error('Unsupported company command')
        }
      })()
      const kind = name.split('.')[0]
      if (
        name.endsWith('.post') &&
        ['purchase', 'sale', 'payment', 'loan', 'journal', 'transfer'].includes(kind)
      ) {
        const r = result as any
        this.run(
          'INSERT INTO document_versions(kind,root_id,record_id,number,current) VALUES(?,?,?,?,1)',
          kind,
          r.id,
          r.id,
          r.number,
        )
      }
      if (operationKey && !isPreview) {
        this.run(
          'INSERT INTO operation_keys(key,result) VALUES(?,?)',
          operationKey,
          JSON.stringify(result),
        )
      }
      return result
    })()
  }
  edit(t: { kind: string; id: number; reason: string; input: unknown }) {
    const command = (t.kind + '.post') as Command
    const input: any = commands[command].parse(t.input)
    const tables: Record<string, string> = {
      purchase: 'purchases',
      sale: 'sales',
      payment: 'payments',
      loan: 'loans',
      journal: 'journal_entries',
      transfer: 'fund_transfers',
    }
    const recordId = this.resolve(t.kind, t.id)
    const old = this.one(`SELECT * FROM ${tables[t.kind]} WHERE id=?`, recordId)
    const oldDate =
      old.bill_date ?? old.payment_date ?? old.loan_date ?? old.entry_date ?? old.transfer_date
    if (fy(oldDate) !== fy(input.date))
      throw Error('Financial-year-changing edits require cancellation and re-entry')
    const version = this.all(
      'SELECT * FROM document_versions WHERE kind=? AND record_id=?',
      t.kind,
      recordId,
    )[0]
    const root = version?.root_id ?? t.id
    const number = version?.number ?? old.number
    this.cancel(t.kind, root, t.reason)
    this.run('UPDATE document_versions SET current=0 WHERE kind=? AND root_id=?', t.kind, root)
    const count = this.one(
      'SELECT count(*) n FROM document_versions WHERE kind=? AND root_id=?',
      t.kind,
      root,
    ).n
    this.numberOverride = number + '~r' + (count + 1)
    let result: any
    try {
      switch (t.kind) {
        case 'purchase':
          result = this.purchase(input)
          break
        case 'sale':
          result = this.sale(input)
          break
        case 'payment':
          result = this.payment(input)
          break
        case 'loan':
          result = this.loan(input)
          break
        case 'journal':
          result = this.postJournal(input)
          break
        case 'transfer':
          result = this.transfer(input)
          break
      }
    } finally {
      this.numberOverride = undefined
    }
    this.run(
      'INSERT INTO document_versions(kind,root_id,record_id,number,current) VALUES(?,?,?,?,1)',
      t.kind,
      root,
      result.id,
      number,
    )
    this.audit(t.kind, root, 'edit', old, { ...input, revisionId: result.id }, t.reason, input.date)
    return { ...result, id: root, number }
  }
  reverseAdvance(t: { id: number; reason: string }) {
    const a = this.one('SELECT * FROM advance_allocations WHERE id=? AND active=1', t.id)
    this.reverse(a.journal_id, t.reason)
    this.run('UPDATE advance_allocations SET active=0 WHERE id=?', a.id)
    this.audit('advance', a.id, 'reverse', a, null, t.reason, a.allocation_date)
    return { id: a.id }
  }
  reverseSettlement(t: { id: number; reason: string }) {
    const loanId = this.resolve('loan', t.id)
    const l = this.one('SELECT * FROM loans WHERE id=?', loanId)
    const payment = this.all(
      "SELECT * FROM loan_interest_entries WHERE loan_id=? AND kind='payment' AND active=1 ORDER BY entry_date DESC,id DESC",
      loanId,
    )[0]
    const settlement = this.all(
      'SELECT * FROM loan_settlements WHERE loan_id=? AND active=1',
      loanId,
    )[0]
    if (!payment && !settlement) throw Error('No loan payment or settlement to reverse')
    const jid = settlement?.journal_id ?? payment.journal_id
    const targetDate = settlement?.settlement_date ?? payment.entry_date
    const prevPayment = this.all(
      "SELECT id FROM loan_interest_entries WHERE loan_id=? AND kind='payment' AND active=1 AND entry_date=? AND id<? ORDER BY id DESC LIMIT 1",
      loanId,
      targetDate,
      payment?.id ?? Number.MAX_SAFE_INTEGER,
    )[0]
    const accruals = this.all(
      "SELECT * FROM loan_interest_entries WHERE loan_id=? AND kind='accrual' AND active=1 AND entry_date=? AND id>? AND id<?",
      loanId,
      targetDate,
      prevPayment?.id ?? 0,
      payment?.id ?? Number.MAX_SAFE_INTEGER,
    )
    this.reverse(jid, t.reason)
    this.run("UPDATE loan_interest_entries SET active=0 WHERE journal_id=? AND kind='payment'", jid)
    for (const acc of accruals) {
      if (
        acc.journal_id &&
        !this.all('SELECT id FROM journal_entries WHERE reversal_of=?', acc.journal_id).length
      )
        this.reverse(acc.journal_id, t.reason)
      this.run('UPDATE loan_interest_entries SET active=0 WHERE id=?', acc.id)
    }
    this.run('UPDATE loan_settlements SET active=0 WHERE journal_id=?', jid)
    this.run("UPDATE loans SET status='open' WHERE id=?", loanId)
    this.fundsCheck(false)
    this.audit('loan', loanId, 'reverse settlement', l, null, t.reason, targetDate)
    return { id: t.id }
  }
  snapshot(q: Query) {
    const profile = this.one('SELECT * FROM company_profile')
    const settings = Object.fromEntries(
      this.all('SELECT * FROM company_settings').map((r) => [r.key, r.value]),
    )
    const parties = this.all('SELECT * FROM parties ORDER BY name').map((p) => ({
      ...p,
      roles: this.all('SELECT role FROM party_roles WHERE party_id=?', p.id).map((r) => r.role),
    }))
    const accounts = this.all('SELECT * FROM accounts ORDER BY id').map<Row>((a) => ({
      ...a,
      balance: this.balance(a.id, q.to),
    }))
    const banks = this.all(
      'SELECT b.*,a.active FROM bank_accounts b JOIN accounts a ON a.id=b.account_id',
    )
    const lots = this.all(
      'SELECT l.*,q.name quality FROM stock_lots l JOIN qualities q ON q.id=l.quality_id WHERE l.acquired_date<=?',
      q.to,
    ).map<Row>((l) => {
      const m = this.one(
        'SELECT coalesce(sum(carats_delta),0) qty,coalesce(sum(cost_delta),0) cost FROM stock_movements WHERE lot_id=? AND movement_date<=?',
        l.id,
        q.to,
      )
      return { ...l, available: m.qty, cost: m.cost }
    })
    const qualities = this.all('SELECT * FROM qualities ORDER BY name')
    const inventory: Row[] = qualities.map((c) => {
      const ls = lots.filter((l) => l.quality_id === c.id)
      const carats = ls.reduce((s, l) => s + l.available, 0)
      const cost = ls.reduce((s, l) => s + l.cost, 0)
      const hike = c.hike_pct ?? settings.global_hike_pct
      const projected = ls.reduce(
        (s, l) => s + integer(new Decimal(l.cost).mul(new Decimal(100).plus(hike)).div(100)),
        0,
      )
      const movements = this.one(
        "SELECT coalesce(sum(CASE WHEN source_type='opening' THEN carats_delta ELSE 0 END),0) opening,coalesce(sum(CASE WHEN source_type IN ('purchase','purchase_cancel') THEN carats_delta ELSE 0 END),0) purchased,coalesce(-sum(CASE WHEN source_type IN ('sale','sale_cancel') THEN carats_delta ELSE 0 END),0) sold FROM stock_movements m JOIN stock_lots l ON l.id=m.lot_id WHERE l.quality_id=? AND m.movement_date<=?",
        c.id,
        q.to,
      )
      return {
        ...c,
        ...movements,
        carats,
        cost,
        average: carats ? integer(new Decimal(cost).mul(100).div(carats)) : 0,
        hike,
        projected,
        profit: projected - cost,
      }
    })
    const openItems = this.all(
      'SELECT o.*,p.name party FROM open_items o JOIN parties p ON p.id=o.party_id WHERE o.active=1 AND o.bill_date<=? ORDER BY o.bill_date,o.id',
      q.to,
    ).map<Row>((o) => {
      const paid = this.one(
        "SELECT coalesce(sum(a.amount),0) n FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.open_item_id=? AND a.active=1 AND p.status='posted' AND p.payment_date<=?",
        o.id,
        q.to,
      ).n
      const advances = this.one(
        'SELECT coalesce(sum(amount),0) n FROM advance_allocations WHERE open_item_id=? AND active=1 AND allocation_date<=?',
        o.id,
        q.to,
      ).n
      return {
        ...o,
        paid: paid + advances,
        outstanding: o.amount - paid - advances,
        overdue: Boolean(o.due_date && o.due_date < q.to),
      }
    })
    const purchases = this.all(
      'SELECT d.*,p.name party FROM purchases d JOIN parties p ON p.id=d.party_id WHERE d.bill_date BETWEEN ? AND ? ORDER BY d.bill_date DESC,d.id DESC',
      q.from,
      q.to,
    ).map((d) => ({
      ...d,
      items: this.all(
        'SELECT i.*,q.name quality FROM purchase_items i JOIN qualities q ON q.id=i.quality_id WHERE i.purchase_id=?',
        d.id,
      ),
      expenses: this.all(
        'SELECT e.*,a.name account FROM purchase_expenses e LEFT JOIN accounts a ON a.id=e.fund_account_id WHERE e.purchase_id=?',
        d.id,
      ),
      outstanding: openItems
        .filter((o) => o.purchase_id === d.id)
        .reduce((s, o) => s + o.outstanding, 0),
    }))
    const sales = this.all(
      'SELECT d.*,p.name party FROM sales d JOIN parties p ON p.id=d.party_id WHERE d.bill_date BETWEEN ? AND ? ORDER BY d.bill_date DESC,d.id DESC',
      q.from,
      q.to,
    ).map((d) => {
      const cogs =
        d.status === 'cancelled'
          ? 0
          : this.one(
              'SELECT coalesce(sum(a.cost),0) n FROM sale_stock_allocations a JOIN sale_items s ON s.id=a.sale_item_id WHERE s.sale_id=? AND a.active=1',
              d.id,
            ).n
      const brokerage =
        d.status === 'cancelled'
          ? 0
          : this.one('SELECT coalesce(sum(amount),0) n FROM sale_brokerages WHERE sale_id=?', d.id)
              .n
      return {
        ...d,
        items: this.all(
          'SELECT s.*,q.name quality FROM sale_items s JOIN qualities q ON q.id=s.quality_id WHERE s.sale_id=?',
          d.id,
        ).map((l) => ({
          ...l,
          lots: this.all(
            'SELECT lot_id,carats,mode FROM sale_stock_allocations WHERE sale_item_id=? AND active=1',
            l.id,
          ),
        })),
        brokerages: this.all(
          'SELECT b.*,p.name broker FROM sale_brokerages b JOIN parties p ON p.id=b.broker_id WHERE b.sale_id=?',
          d.id,
        ),
        adjustments: this.all('SELECT * FROM sale_adjustments WHERE sale_id=?', d.id),
        cogs,
        brokerage,
        profit: d.status === 'cancelled' ? 0 : d.invoice_total - brokerage - cogs,
        outstanding: openItems
          .filter((o) => o.sale_id === d.id)
          .reduce((s, o) => s + o.outstanding, 0),
      }
    })
    const payments = this.all(
      'SELECT d.*,p.name party FROM payments d JOIN parties p ON p.id=d.party_id WHERE d.payment_date BETWEEN ? AND ? ORDER BY d.payment_date DESC,d.id DESC',
      q.from,
      q.to,
    ).map((p) => ({
      ...p,
      allocations: this.all(
        'SELECT pa.*,o.reference FROM payment_allocations pa JOIN open_items o ON o.id=pa.open_item_id WHERE pa.payment_id=?',
        p.id,
      ),
    }))
    const advances = this.all(
      'SELECT a.*,p.name party,coalesce(py.payment_date,o.opening_date) date FROM advances a JOIN parties p ON p.id=a.party_id LEFT JOIN payments py ON py.id=a.payment_id LEFT JOIN opening_balances o ON o.id=a.opening_id WHERE a.active=1 AND coalesce(py.payment_date,o.opening_date)<=?',
      q.to,
    ).map((a) => ({
      ...a,
      remaining:
        a.amount -
        this.one(
          'SELECT coalesce(sum(amount),0) n FROM advance_allocations WHERE advance_id=? AND active=1 AND allocation_date<=?',
          a.id,
          q.to,
        ).n,
    }))
    const loans = this.all(
      'SELECT l.*,p.name party FROM loans l JOIN parties p ON p.id=l.party_id WHERE loan_date<=?',
      q.to,
    ).map<Row>((l) => ({
      ...l,
      ...this.loanAccrual(l, q.to),
      hasSettlement:
        this.all(
          "SELECT 1 FROM loan_interest_entries WHERE loan_id=? AND kind='payment' AND active=1 UNION ALL SELECT 1 FROM loan_settlements WHERE loan_id=? AND active=1 LIMIT 1",
          l.id,
          l.id,
        ).length > 0,
    }))
    const journals = this.all(
      "SELECT j.*,EXISTS(SELECT 1 FROM journal_entries r WHERE r.reversal_of=j.id) reversed FROM journal_entries j WHERE j.status='posted' AND j.entry_date BETWEEN ? AND ? ORDER BY j.entry_date DESC,j.id DESC",
      q.from,
      q.to,
    ).map<Row>((j) => ({
      ...j,
      lines: this.all(
        'SELECT l.*,a.name account FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.journal_id=?',
        j.id,
      ),
    }))
    const ledger = this.all(
      "SELECT j.entry_date date,j.number,j.source_type,j.source_id,j.narration,l.account_id,a.name account,a.kind,l.debit,l.credit FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id WHERE j.status='posted' AND j.entry_date<=? ORDER BY j.entry_date,j.id,l.id",
      q.to,
    )
    const reportAccounts: Row[] = accounts.map((a) => ({
      ...a,
      period: ledger
        .filter((l) => l.account_id === a.id && l.date >= q.from)
        .reduce((s, l) => s + l.debit - l.credit, 0),
    }))
    // Add only unposted earned/incurred interest. Reading a report never writes journals.
    const adjustmentsAt = (to: string) => {
      let given = 0,
        taken = 0
      if (to < profile.start_date) return { given, taken }
      for (const l of loans.filter((l) => l.status !== 'cancelled' && l.loan_date <= to)) {
        const accrued = this.loanAccrual(l, to).accrued
        const posted = this.one(
          "SELECT coalesce(sum(amount),0) n FROM loan_interest_entries WHERE loan_id=? AND kind IN ('opening','accrual') AND active=1 AND entry_date<=?",
          l.id,
          to,
        ).n
        const n = accrued - posted
        if (l.kind === 'given') given += n
        else taken += n
      }
      return { given, taken }
    }
    const end = adjustmentsAt(q.to),
      start = adjustmentsAt(addDays(q.from, -1))
    for (const a of reportAccounts) {
      const delta =
        a.code === 'INT_AR'
          ? end.given
          : a.code === 'INT_INC'
            ? -end.given
            : a.code === 'INT_AP'
              ? -end.taken
              : a.code === 'INT_EXP'
                ? end.taken
                : 0
      const prior =
        a.code === 'INT_AR'
          ? start.given
          : a.code === 'INT_INC'
            ? -start.given
            : a.code === 'INT_AP'
              ? -start.taken
              : a.code === 'INT_EXP'
                ? start.taken
                : 0
      a.balance += delta
      a.period += delta - prior
    }
    const sum = (kind: string, field: string) =>
      reportAccounts.filter((a) => a.kind === kind).reduce((s, a) => s + a[field], 0)
    const profit = -sum('income', 'period') - sum('expense', 'period') || 0
    const earnings = -sum('income', 'balance') - sum('expense', 'balance')
    const assets = sum('asset', 'balance'),
      liabilities = -sum('liability', 'balance'),
      equity = -sum('equity', 'balance') + earnings
    const partyLedger: Row[] = []
    const appendParty = (row: Row, partyId: number, code: string, debit: number, credit: number) =>
      partyLedger.push({ ...row, partyId, category: code, debit, credit })
    for (const row of this.all(
      "SELECT j.id journalId,j.entry_date date,j.number,j.narration,j.source_type,j.source_id,j.reversal_of,l.account_id,a.code,a.name account,l.debit,l.credit FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id WHERE j.status='posted' AND j.entry_date<=? ORDER BY j.entry_date,j.id,l.id",
      q.to,
    )) {
      if (
        ![
          'AR',
          'AP',
          'BROKER',
          'ADV_PAID',
          'ADV_REC',
          'LOAN_G',
          'LOAN_T',
          'INT_AR',
          'INT_AP',
        ].includes(row.code)
      )
        continue
      const source = row.reversal_of
        ? this.one('SELECT source_type,source_id FROM journal_entries WHERE id=?', row.reversal_of)
        : row
      let partyId: number | undefined
      if (source.source_type === 'purchase')
        partyId = this.one('SELECT party_id FROM purchases WHERE id=?', source.source_id).party_id
      else if (source.source_type === 'sale') {
        if (row.code === 'BROKER') {
          for (const b of this.all(
            'SELECT broker_id,sum(amount) amount FROM sale_brokerages WHERE sale_id=? GROUP BY broker_id',
            source.source_id,
          ))
            appendParty(
              row,
              b.broker_id,
              row.code,
              row.debit ? b.amount : 0,
              row.credit ? b.amount : 0,
            )
          continue
        }
        partyId = this.one('SELECT party_id FROM sales WHERE id=?', source.source_id).party_id
      } else if (source.source_type === 'payment')
        partyId = this.one('SELECT party_id FROM payments WHERE id=?', source.source_id).party_id
      else if (['loan', 'interest', 'settlement'].includes(source.source_type))
        partyId = this.one('SELECT party_id FROM loans WHERE id=?', source.source_id).party_id
      else if (source.source_type === 'advance')
        partyId = this.one('SELECT party_id FROM advances WHERE id=?', source.source_id).party_id
      if (partyId) appendParty(row, partyId, row.code, row.debit, row.credit)
    }
    if (q.to >= profile.start_date) {
      for (const o of this.all('SELECT * FROM open_items WHERE opening_id IS NOT NULL'))
        appendParty(
          {
            date: profile.start_date,
            number: o.reference,
            narration: 'Opening invoice',
            account: o.kind,
          },
          o.party_id,
          o.kind,
          o.kind === 'opening_receivable' ? o.amount : 0,
          o.kind === 'opening_payable' ? o.amount : 0,
        )
      for (const a of this.all('SELECT * FROM advances WHERE opening_id IS NOT NULL'))
        appendParty(
          {
            date: profile.start_date,
            number: 'Opening',
            narration: 'Opening advance',
            account: a.direction,
          },
          a.party_id,
          a.direction,
          a.direction === 'paid' ? a.amount : 0,
          a.direction === 'received' ? a.amount : 0,
        )
      for (const l of loans.filter((l) => l.opening_id)) {
        appendParty(
          {
            date: profile.start_date,
            number: l.number,
            narration: 'Opening principal',
            account: l.kind,
          },
          l.party_id,
          l.kind,
          l.kind === 'given' ? l.principal : 0,
          l.kind === 'taken' ? l.principal : 0,
        )
        const o = this.one(
          "SELECT * FROM loan_interest_entries WHERE loan_id=? AND kind='opening'",
          l.id,
        )
        appendParty(
          {
            date: profile.start_date,
            number: l.number,
            narration: 'Opening accrued interest',
            account: 'Interest',
          },
          l.party_id,
          'interest',
          l.kind === 'given' ? o.amount : 0,
          l.kind === 'taken' ? o.amount : 0,
        )
      }
      for (const l of loans.filter((l) => l.status !== 'cancelled')) {
        const posted = this.one(
          "SELECT coalesce(sum(amount),0) n FROM loan_interest_entries WHERE loan_id=? AND active=1 AND kind IN ('accrual','opening') AND entry_date<=?",
          l.id,
          q.to,
        ).n
        const pending = l.accrued - posted
        if (pending)
          appendParty(
            {
              date: q.to,
              number: l.number,
              narration: 'Unposted interest accrued through report date',
              account: 'Accrued interest',
            },
            l.party_id,
            'interest',
            l.kind === 'given' ? pending : 0,
            l.kind === 'taken' ? pending : 0,
          )
      }
    }
    partyLedger.sort(
      (a, b) => a.date.localeCompare(b.date) || (a.journalId ?? 0) - (b.journalId ?? 0),
    )
    return {
      stockMovements: this.all(
        'SELECT m.*,q.name quality FROM stock_movements m JOIN stock_lots l ON l.id=m.lot_id JOIN qualities q ON q.id=l.quality_id WHERE m.movement_date<=? ORDER BY m.movement_date,m.id',
        q.to,
      ),
      sequences: this.all('SELECT * FROM number_sequences'),
      partyLedger,
      advanceApplications: this.all(
        'SELECT aa.*,p.name party,o.reference FROM advance_allocations aa JOIN advances a ON a.id=aa.advance_id JOIN parties p ON p.id=a.party_id JOIN open_items o ON o.id=aa.open_item_id WHERE aa.active=1',
      ),
      profile,
      settings,
      parties,
      accounts,
      banks,
      qualities,
      lots,
      inventory,
      openItems,
      purchases: purchases.map((d) => this.publicDocument('purchase', d)).filter((d) => d.current),
      sales: sales.map((d) => this.publicDocument('sale', d)).filter((d) => d.current),
      payments: payments.map((d) => this.publicDocument('payment', d)).filter((d) => d.current),
      advances,
      loans: loans.map((d) => this.publicDocument('loan', d)).filter((d) => d.current),
      journals: journals
        .map((d) => (d.source_type === 'journal' ? this.publicDocument('journal', d) : d))
        .filter((d) => d.current !== false),
      ledger,
      reportAccounts,
      transfers: this.all(
        'SELECT * FROM fund_transfers WHERE transfer_date BETWEEN ? AND ? ORDER BY id DESC',
        q.from,
        q.to,
      )
        .map((d) => this.publicDocument('transfer', d))
        .filter((d) => d.current),
      audit: this.all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500'),
      openingDone: !!this.all('SELECT id FROM opening_balances').length,
      totals: {
        profit,
        earnings,
        assets,
        liabilities,
        equity,
        balanceDifference: assets - liabilities - equity,
        trialDifference: reportAccounts.reduce((s, a) => s + a.balance, 0),
        stockCost: inventory.reduce((s, c) => s + c.cost, 0),
        stockCarats: inventory.reduce((s, c) => s + c.carats, 0),
        projected: inventory.reduce((s, c) => s + c.projected, 0),
      },
    }
  }
}
