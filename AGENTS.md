# DIAMO_Treading workspace instructions

## Scope and layout

These instructions apply throughout this workspace, including application/.
Preserve DIAMO_Treading_Development_Kit and every original file. It is read-only reference material. Do not move, rename, delete, rewrite or develop inside it. All actual application code, dependencies, configuration, migrations, assets, tests, build scripts and application documentation belong in application/, a sibling of the kit. Do not create a nested DIAMO_Treading directory or touch other projects.

Read the kit AGENTS.md, MASTER_PROMPT.md, README.md, docs/, database/, fixtures/, references/ and resources/ before implementation. Apply the kit requirements in conjunction with the latest explicit user instructions. Do not interpret its generic extraction instructions as permission to relocate the kit.

The current stage is analysis and planning only. Do not infer that a foundation or business feature exists from its directory or checklist. Follow application/docs/IMPLEMENTATION_PLAN.md when implementation is requested. Keep root DEVELOPMENT_PROGRESS.md as the canonical record of requirements, status, tests and unresolved issues; do not create a divergent progress.md.

## Confirmed user decisions

- Installation folder name is exactly DIAMO_TREADING; planned macOS bundle DIAMO_TREADING.app.
- Accrual accounting is confirmed, including earned/incurred loan interest in reports before payment.
- Development-kit resources/logo/icon.png is the final logo. Copy it into application resources and derive icons there; never modify the original.
- Preserve all listed destinations: 18 including separate Settings and Backup & Restore, despite the SRS heading's count of 17.
- Installer output directory is application/dist.
- Production data must live outside the source and install directories, using platform-derived application data paths. Never hardcode this Mac's development path in distributed code.
- Exclude dependencies, generated builds, databases/WAL/SHM, backups, logs and sensitive configuration from Git. Keep SQL migrations tracked. Do not commit private business data or signing credentials.

## Incorporated development-kit AGENTS.md

The following is the complete instruction text from the kit, preserved here so it applies to application/:

# Repository instructions
Read all docs, SQL and fixtures before implementation. Follow confirmed scope; record any ambiguity and proposed resolution before changing business rules. Use Electron, React TypeScript, Node.js and better-sqlite3. No network dependency at runtime, CDN, telemetry or remote auth. No production mocks, dead buttons or unfinished screens. Use validated typed IPC, context isolation, sandbox, no renderer Node access. Main process owns DB and session. Use integer paise and hundredths of carat, decimal arithmetic for rates and rounding. All business writes atomic, balanced and audited. Never mix companies, permit negative stock, reuse cancelled numbers or delete posted transactions. Warn and require confirmation for negative funds. Preserve data on upgrades. Maintain progress checklist and run unit, integration and UI tests after each phase. Never claim completion without evidence; report untested platform builds. Do not commit real databases, credentials beyond the specified bootstrap credential, or private business data.

## Evidence and unresolved requirements

Original conversation retrieval is incomplete; do not claim all historical messages were read. The supplied V3 requirements are the available baseline. Record conflicts and ask about material business ambiguities before implementing affected behavior. In particular, effective dates for historical corrections/reversals need confirmation. No silent changes to cost, loan, settlement or accounting rules.

A passed schema smoke test is not full application validation. Close the documented journal lifecycle gaps through executable migrations and service guards. Run relevant unit, integration and UI checks after each phase; log commands, results and limitations. Do not claim Windows/macOS installer validation without native target evidence.
