# Acceptance test vectors
| ID | Scenario | Expected |
|---|---|---|
| T01 | First launch, restart, change password | Seed once; old password rejected after change |
| T02 | Two companies same party and invoice number | Independent data, no leakage |
| T03 | ROUND 50+100, FENCY 200; sell ROUND40 and FENCY50 | ROUND110, FENCY150, total260 |
| T04 | ROUND 50@4000 +100@5000, sell40 FIFO | COGS160000, stock540000 |
| T05 | Same but manual second lot | COGS200000, stock500000 |
| T06 | Sell beyond stock or backdate before acquisition | Reject atomically |
| T07 | Net lines190000/294000, expense5000 | 1962.81/3037.19; total489000 |
| T08 | Purchase100000 expense2000 separately | supplier100000, funds−2000, inventory102000 |
| T09 | Same expense supplier billed | supplier102000, funds unchanged |
| T10 | Sale100000 less5%, +1000, brokerage2%, COGS80000 | receivable96000, broker1900, profit14100 |
| T11 | Fixed brokerage and negative adjustment; per-line vs invoice | correct totals, no duplicate expense |
| T12 | Bills50000/100000/75000, pay125000 | allocations50000/75000/0, remaining100000 |
| T13 | Pay250000 against same bills | advance25000; future application no new cash movement |
| T14 | Manual partial allocation, cancel payment | exact selected bills restored |
| T15 | 500000 loan 1% monthly 81 days, paid5000 interest | accrued13500, remaining8500, settlement508500 |
| T16 | 365-day yearly 12% on500000 | interest60000; zero rate yields zero |
| T17 | Interest-only payment, partial principal attempt | principal unchanged; partial principal rejected |
| T18 | Negative funds | warning; cancel no writes; confirm posts |
| T19 | Cash deposit/withdrawal/bank transfer | total funds unchanged; no P&L |
| T20 | JV debit50000 credit50000 capital | balanced; unequal or both sides on line rejected |
| T21 | Opening balances with stock and bills | balanced; FIFO and settlement eligible |
| T22 | Hike5% on500000, override8% on300000 | projection849000; ledger unchanged |
| T23 | Edit/cancel sale | restore lots, COGS, broker/customer balances; audit |
| T24 | Reduce purchase below consumed quantity | reject; no partial writes |
| T25 | FY rollover | sequence resets; balances continuous; cancelled ID not reused |
| T26 | Trial balance and balance sheet | debit=credit; assets=liabilities+equity |
| T27 | Filter/export each page | exact filtered rows/totals; INR glyphs and dates |
| T28 | Manual/automatic/exit backup, unavailable path | valid snapshot or visible failure; retention |
| T29 | Restore full/individual, corrupt archive | data recovered; corrupt rejected; rollback safe |
| T30 | Offline launch and all workflows | no network required |
| T31 | Upgrade with existing DB | migration preserves records/password |
| T32 | Fault injection mid-post | no partial journal/stock/sequence changes |
| T33 | Rounding 3-way expense and final lot depletion | exact paise conservation |
| T34 | UI login and every action | keyboard, validation, real persistence |
| T35 | Windows/macOS install/uninstall/reinstall | native launch; data preserved unless explicit deletion |
Tests must cover date boundaries, multiple lines same category, inactive masters, duplicate IDs, audit, report as-of dates, interest accrual without double counting and backup assets. Use fixtures only in isolated test DBs.
