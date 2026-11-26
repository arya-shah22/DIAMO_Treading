# Implementation phases
1. Scaffold Electron/React/Node, typed IPC, security, build and tests.
2. App DB, auth, company isolation, migrations, opening wizard.
3. Ledger engine, sequence, FY, audit, money/date utilities.
4. Parties/brokers, qualities, bank and ledger masters.
5. Purchases, expenses, stock lots, projections.
6. Sales, FIFO/manual allocation, brokerage, edits/cancellations.
7. Payments, advances, settlement and ageing.
8. Loans, exact-day accrual, interest-only/full settlement, cash/bank transfers.
9. JV, dashboard, all reports and reconciliation.
10. Exports, settings, backup/restore and migration safety.
11. Unit/integration/E2E tests, accessibility, offline checks, installers and user guide.
For each phase implement real DB integration, run tests, record evidence and outstanding issues. Do not advance past failed core invariants. Keep progress.md updated. Build and test on Windows and macOS separately.
