# DIAMO_TREADING — implementation plan

Date: 26 November 2026 (Asia/Kolkata)
Status: analysis complete for supplied kit; application implementation not started.

## 1. Scope and authority

The latest instruction limits this stage to analysis and a professional implementation plan. Creating the application directory and planning/governance documents does not mean the application foundation has been implemented.

Sources reviewed: development-kit AGENTS.md, MASTER_PROMPT.md, README.md; all seven docs; app.sql, company.sql, database README and verify.py; SAMPLE_DATA.json; both UI screenshots; logo README and icon.png. The kit is preserved. A SHA-256 inventory is recorded in application/docs/analysis/kit-sha256.json.

The connected project chat “DIAMO Trading Software Plan” was inspected. Its available response contains recent user messages, but older assistant content is represented by unresolved content-reference markers, and no older pagination is offered. The local synced sources directory is empty. Therefore full historical requirements parity is not verified. Use the supplied confirmed V3 specification as the current baseline; reconcile any additional historical requirements before affected features are finalized. Do not import requirements from unrelated DIAMO projects.

Latest user confirmations: accrual accounting is approved; resources/logo/icon.png is the final logo. Copy it into application resources during implementation and derive platform icons from that copy. Installation folder name must be exactly DIAMO_TREADING.

## 2. Product scope

A fully offline Windows/macOS desktop ERP for personal diamond trading, one administrator and independently isolated companies. Electron, React, TypeScript, Node.js main-process services and SQLite/better-sqlite3 are required. INR only, no GST calculation, two-decimal carats and money, April–March financial years with continuous balances.

Included: balanced opening migration; parties with multiple roles; categories; bank accounts; purchases and expenses; lot inventory; FIFO/manual sales; brokerage; payments, advances and ageing; loans and interest; cash/bank transfers; journal vouchers; reconciled reports; exports/printing; settings, backups and safe restore.

Excluded by supplied specification: manufacturing, purchase/sale returns, manual stock adjustments, automatic intercompany transfers, cloud sync, runtime network dependencies and separate complex capital/expense modules. Capital, drawings and ordinary expenses use JV. Screenshot USD, rough/polished manufacturing, scan and cloud controls do not expand scope.

### Navigation inventory — 18 destinations

| Group | Destinations | Required supporting views |
|---|---|---|
| Overview | Dashboard | Date filters, point-in-time balances versus period flows, due/overdue drill-down |
| Masters | Parties Master; Quality Master; Bank Accounts | Party profile, roles, category hike, account ledger, inactive history |
| Trading | Stock Inventory; Purchase; Sale | Lots/movements, preview/post/detail/edit/cancel, FIFO/manual allocations |
| Finance | Loans; Payments; Cash & Bank; Journal Voucher | Interest/settlement, bill allocation, advances, transfers, custom ledgers |
| Reports | Party Ledger; Balance Sheet; Profit & Loss; Day Book | Trial Balance, ageing, loan/journal registers, lot/projection reports, cash/bank books |
| Administration | Manage Companies; Settings; Backup & Restore | Opening wizard, company isolation, password, backup history and restore |

SRS calls this 17 pages; its listed destinations total 18 when Settings and Backup & Restore are separate. Preserve every destination; treat the number as a documentation counting error.

Every applicable register: search, sort, pagination, date/party/category/status filters, details and exact filtered PDF/Excel/CSV export with totals. Export all matching records, not merely the displayed page. Invoices/vouchers print individually. Dashboard and financial statements support PDF/Excel/print. Settings export excludes secrets.

## 3. Workspace and distribution

```text
DIAMO_Treading/
  AGENTS.md
  DEVELOPMENT_PROGRESS.md
  DIAMO_Treading_Development_Kit/       # preserved reference only
  application/
    docs/IMPLEMENTATION_PLAN.md
    docs/analysis/kit-sha256.json
    src/main/{database,ipc,repositories,services}/
    src/preload/
    src/renderer/src/{pages,components,layouts,stores}/
    src/shared/{types,schemas,calculations}/
    resources/{branding,fonts}/
    tests/{unit,integration,e2e}/
    scripts/
    dist/                             # distributable installers
```

All application source, configuration, migrations, dependencies, tests, assets and user/build documentation belong under application. Root progress and root AGENTS are the requested exceptions. Keep development-kit relative references in documentation only. Distributed code must resolve platform paths through Electron and path utilities, never this Mac's absolute development path.

Planned installation identity: Windows binary folder DIAMO_TREADING; macOS application bundle DIAMO_TREADING.app in Applications. Use a stable application identifier across upgrades. Installer outputs go to application/dist, with OS/architecture/version in filenames to prevent collisions.

Use Electron's platform application-data base plus DIAMO_TREADING for writable runtime data; this intentionally normalizes the kit's mixed-case example to the user's naming requirement. Store app.sqlite, companies/<uuid>.sqlite, company assets and logs there. Do not store live databases inside source or the binary installation folder. Preserve data on upgrade, uninstall and reinstall unless explicitly deleted by the user.

Git exclusions: node_modules, generated build outputs, dist, coverage, test results, temporary data, SQLite DB/WAL/SHM files, backups, logs, private configuration, signing keys/certificates and .env files; retain sanitized .env.example if needed. Never ignore source SQL migrations or public branding assets. No application dependencies or generated artifacts in workspace root.

## 4. Architecture and invariants

### Process boundaries

Renderer owns presentation only. A narrow typed preload bridge exposes validated commands and queries. Main process owns authentication, active company, SQLite connections, business calculations, exports and file dialogs. Enforce context isolation, sandbox, no renderer Node access, restrictive content policy, authenticated IPC sender checks and rejection of arbitrary SQL/path IPC. Use single-instance locking.

Service boundaries: auth, companies, masters, opening, accounting, sequences, purchase, inventory, sale, payments/advances, loans, funds, reports, exports, backup and audit. Parameterized SQL only. Main validates session/company on every call; company switching invalidates caches and rejects stale requests. Coordinate backup/restore/company lifecycle with a write lock.

Use the kit's UI/library stack; pin compatible versions and a lockfile after an Electron/native-module compatibility spike. Verify current official documentation at that implementation step rather than invent version pins in this plan. Node backend is embedded; no separately installed web server or local HTTP API is needed.

### Financial integrity

- Store integer paise and integer hundredths of carats, with explicit safe bounds; use decimal.js for rates/percentages and conversion. Half-up monetary rounding and deterministic largest-remainder allocations; final lot depletion consumes residual paise exactly.
- Dates are validated calendar dates, independent of timezone conversion. Loan interest excludes the start day; monthly divisor 30, yearly 365 even in leap years.
- Each command atomically validates dependencies, reserves a sequence, writes document/subledger/journal/audit and commits. Failure rolls back all effects. Idempotency/request deduplication prevents double posting after retries or double-clicks.
- Every journal balances; posted records are immutable. Edits/cancellations use recorded reason, before/after audit, linked reversal and replacement revisions. Document identity stays stable; cancelled numbers are never reused. FY-changing edits require cancel/re-enter.
- Validate stock at every affected historical date. FIFO sorts eligible lots by acquisition date then stable lot ID. Manual selection must exactly match sale quantity and category. Unsafe historical edits are blocked with affected-document links; never silently recost existing sales.
- Supplier-billed versus separately paid expenses have different creditors but both enter inventory cost. Brokerage never reduces customer receivable and is expensed once, with subsequent payment clearing payable.
- Payments allocate only to compatible party/direction/company obligations, within payment and outstanding limits. Excess becomes a correctly classified advance; application of an advance causes no second cash movement.
- Loans allow interest-only payments or full principal settlement, not partial principal repayments. Preserve opening interest history and original start dates. Compute earned/incurred interest through reporting dates without double-counting posted accruals.
- Negative funds require explicit confirmation bound to the reviewed transaction and revalidation at posting. Negative stock is always rejected.
- JV must not bypass inventory, invoice, loan-principal or other controlled subledgers. Opening balances must reconcile without a hidden balancing plug.
- Projection uses remaining actual lot cost and category/company hike; never post unrealized projected profit into accounts. Prior FY earnings roll into equity in reporting, without resetting balances.

### Reporting model

Use a common effective-date query layer for screens, dashboard, exports and reconciliations. Current mutable remaining balances alone cannot answer historical reports. Use dated stock movements, settlement/allocation history and immutable journal revisions. Retain originals and their offsetting reversals consistently. Define whether a cancellation corrects the original date or posts on a later date before lifecycle implementation; record both effective date and audit timestamp.

For accrual reporting, calculate outstanding interest as of the report date, reconcile previously posted accruals and paid interest, and include only the remaining required accrual. Reports must not write journals merely by being opened. Settlement uses the same calculation and clears accrued balances.

## 5. Database analysis and migration work

Both supplied scripts ran successfully in isolated in-memory SQLite databases. app.sql creates 6 tables; company.sql creates 34. Both returned integrity_check=ok and no foreign-key violations. The supplied smoke test rejected unbalanced posting and deletion of posted journal lines.

Independent probes identified baseline gaps:

1. A posted journal can be changed back to draft, after which its lines can be deleted. Add lifecycle/immutability guards, including relevant header changes and reversal linkage.
2. Duplicate journal numbers and invalid calendar date strings are accepted. Define journal-revision identity separately from stable business-document numbering; add appropriate uniqueness, date validation and migration tests.
3. Declared INTEGER affinity alone is insufficient for strict monetary typing. Validate integer storage/bounds and add constraints where appropriate.
4. Cross-row amount limits, same-category/party consistency, same-source ownership and historical stock protection require services and additional database guards.
5. Current active flags alone do not preserve as-of settlement/cancellation semantics. Extend revision/effective-date history and audit fields before implementing edits.
6. Opening loan records need an unambiguous distinction between prior interest paid and outstanding accrued interest; baseline opening interest entries alone do not express the full wizard contract clearly.
7. Fund transfers, loan interest and loan settlement must link coherently to payment/register views without duplicate financial entries.
8. Add opening completion state, sequence uniqueness/non-null requirements, useful query indexes, document revisions and operation deduplication as required by service contracts.

Use supplied SQL as migration v1, with versioned follow-up migrations for improvements; do not alter the reference SQL. Pre-upgrade backups, transactional migration application, version compatibility checks and failure recovery are release requirements. Test with better-sqlite3 separately: Python schema validation is not proof of Electron/native driver compatibility.

## 6. Phase plan and exit criteria

| Phase | Deliverables and dependencies | Evidence required before completion |
|---|---|---|
| 0 — Requirements | This plan, governance, progress, source inventory, contradiction register; reconcile available chat | Both schema smoke tests and reference review recorded; remaining decisions visible |
| 1 — Desktop foundation | Electron/electron-vite, React/TS, Node main, better-sqlite3, validated IPC, routing, local fonts/logo, test/build scripts, app naming | Desktop launches; renderer cannot access Node/DB; native DB round-trip; typecheck/build and IPC validation tests |
| 2 — Identity and company lifecycle | App DB, one-time hashed bootstrap, forced first password change default, logout/password changes, company create/select/switch, versioned migrations; opening wizard shell | T01/T02; persistence across restart; stale company requests rejected; no sample seed; migration failures recover |
| 3 — Accounting and opening engine | Decimal/date utilities, balanced journal lifecycle, immutable revisions, numbering/FY, audit, opening posting backend | T20/T21/T25/T32/T33; balanced opening; rollback; no posted rewrite; sequence/FY boundaries. Opening UI completes after phase 4 masters |
| 4 — Masters and opening completion | Parties/roles, qualities/hike, banks, custom ledgers, opening wizard for stock/bills/advances/loans/funds/equity | Referential restrictions; inactive history; opening totals reconcile and cannot post twice; isolated companies |
| 5 — Purchases and inventory | Purchase preview/post/register/detail/edit/cancel; expense allocation; lots/movements; stock as-of and projections | T03 purchase side, T07–T09/T22/T24/T33; cost equals inventory ledger; dependent edits rejected atomically |
| 6 — Sales and brokerage | Multi-line sale, FIFO/manual allocation, availability, adjustments, broker dues, COGS/profit, revision lifecycle | T03–T06/T10/T11/T23/T24; historical stock nonnegative; cost conserved; receivable/broker/COGS reconcile |
| 7 — Payments and advances | Pay/receive, oldest/manual allocation, partial payments, broker settlement, opening bills, advance application, ageing | T12–T14/T18; no over-allocation; no second cash on advance use; dependency-safe reversal |
| 8 — Loans and funds | Taken/given loans, exact-day accrual, opening history, interest-only/full settlement; cash/bank ledgers and transfers | T15–T19; no partial principal; no duplicate accrual; correct date/leap boundaries; transfers preserve combined funds |
| 9 — JV, reports and dashboard | JV UI with protected controls, dashboard, Party Ledger, BS/P&L/Day Book, Trial Balance and all subreports | T20/T26; end-to-end reconciliations; as-of before/after edits; period flows separate from balances; no projected profit in P&L |
| 10 — Exports, settings and recovery | PDF/Excel/CSV/print, settings, scheduled/manual/exit backups, retention, full/individual restore, user guide drafts | T27–T29/T31; matching filtered totals, INR font, integrity/checksum validation, corrupt restore rollback, no unrelated company overwrite |
| 11 — Release qualification | Complete regression, accessibility, disconnected runtime, performance dataset, target-native installers, user/build/migration documentation | T01–T35 all addressed; T30/T34/T35 on targets; signed/unsigned status disclosed; clean install/upgrade/reinstall tested |

Implement each phase as real persistent vertical workflows, including backend validation, usable UI and relevant tests. Start unit/integration/Electron UI testing in phase 1; phase 11 is full regression, not the first testing phase. Do not advance through a failed accounting/stock/isolation gate. Exports and backup infrastructure can begin earlier when useful, but their release gates remain phase 10.

No fixed schedule is promised before the foundation spike, target OS availability and unresolved lifecycle policy are known. Progress is reported by deliverable and test evidence rather than arbitrary percent complete.

## 7. UI plan

Login: navy #050B1E, gold #BD9331, centered DIAMO logo/wordmark, white 400–440px rounded card, username/password with visibility toggle, Enter submission, validation/loading, offline footer. Use the confirmed local icon asset, not a screenshot crop.

ERP: navy sidebar #1D283A, selected #29446A, light #F5F7FA content, white cards and gold primary actions. Group the 18 destinations, make navigation collapsible, include company/FY context, working search, due notifications and user/logout. Maintain consistent title, summary cards, filters, table, pagination and detail patterns.

Currency: Indian grouping and INR glyph; dates dd/mm/yyyy; carats two decimals. Keyboard operation, visible focus, contrast, accessible labels and empty/loading/error states are required. Dialogs for cancellation, negative funds and restore must show concrete effects. No fake metrics, inert toolbar controls or irrelevant screenshot functionality. Appearance preference may begin with required light theme; optional dark mode is not a release blocker unless later requested.

## 8. Backups and deployment

Use SQLite online backup, coordinated across app/company DBs and assets. Include manifest, checksums, schema/app versions and company identities. Stage then atomically finalize, verify integrity, log failures, and prune only owned backups. Default daily plus exit, retain 30; schedules operate while running/on exit and catch up on next launch. User chooses accessible destination.

Restore checks archive traversal, manifest, compatibility, checksums and DB integrity before replacement. Make pre-restore backup; close connections, stage replacements, rollback all files on failure. Individual-company restore must not overwrite unrelated company data or registry identities. Test interrupted restore and failure recovery, including restart.

Release targets: Windows x64 EXE; macOS Intel and Apple Silicon DMGs. Rebuild native dependency for each target and verify on suitable Windows/macOS hosts. Record OS/architecture, installer hash, build version, signing/notarization status and test results. All final installers under application/dist. Windows availability and signing identities are release dependencies, not reasons to mislabel untested builds as complete.

## 9. Decisions and remaining questions

| Item | Status / treatment |
|---|---|
| Accrual basis | Confirmed by user on 26 November 2026 |
| Final logo | User confirmed resources/logo/icon.png; supersedes kit's pending-logo note |
| Installation name | Confirmed DIAMO_TREADING; macOS bundle DIAMO_TREADING.app |
| Page count | Include all 18 named destinations; no feature removed |
| Kit extraction/root instructions | Latest workspace rules override kit's generic extract-into-repository instructions |
| Progress filename | Root DEVELOPMENT_PROGRESS.md is canonical; do not create divergent progress.md |
| First-login password change | Use kit's recommended forced-change default; bootstrap only once |
| Company DB, payment order, backup retention | Use supplied separate-company DB, oldest-first and daily+exit/30 defaults; configurable where specified |
| Default hike | Baseline 5%, configurable; projections only |
| Historical correction date | Needs policy confirmation before phase 3 lifecycle completion: original-date correction versus cancellation-date reversal affects earlier reports and FIFO validation |
| Zero-net purchase with expenses | Reject per supplied rule unless an explicit allocation rule is later approved |
| Original chat coverage | Limited retrieval; any requirements absent from kit must be supplied/recovered before claiming complete historical parity |
| Target release hosts/signing | Inventory during foundation; resolve before release qualification |

Recommended historical policy for discussion: corrections reverse/repost at original effective date with full audit and downstream validation; any case affecting consumed stock or used settlements is blocked until dependencies are safely addressed. This is a proposal, not a confirmed business rule.

## 10. Definition of done

All supplied requirements map to working features and evidence. All 35 test vectors pass or have explicit target-native manual evidence; every page/action uses persistent SQLite. Inventory cost equals inventory control; party/broker balances equal bills/settlements/advances; loan balances and interest reconcile; cash/bank equal ledger; Trial Balance and Balance Sheet balance. Exports match screens and print correctly. Backup/restore, upgrades and offline operation pass failure-path testing. Both supported platforms are installed and exercised; limitations are disclosed. Final logo and documentation included; no production demo data, placeholders or runtime network requirements.
