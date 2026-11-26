# DIAMO_TREADING

Offline-first desktop ERP and accrual accounting software built with **Electron**, **React**, **TypeScript**, and **SQLite (`better-sqlite3`)** for diamond trading businesses.

---

## Repository Structure

```text
DIAMO_Treading/
├── application/                  # Desktop application source, SQL migrations, tests, and build config
│   ├── src/main/                 # Electron main process, SQLite databases, IPC, accounting & recovery services
│   ├── src/preload/              # Context-isolated IPC bridge (contextIsolation + sandbox)
│   ├── src/renderer/             # React + TypeScript UI (side-drawer workflows, custom dropdowns, 18 views)
│   ├── src/shared/               # Zod command contracts & Decimal.js exact arithmetic helpers
│   ├── tests/                    # Vitest accounting/system integration tests & Playwright desktop E2E tests
│   └── resources/                # Bundled fonts and application branding icon
├── DIAMO_Treading_Development_Kit/ # Read-only reference specifications, baseline SQL, and fixtures
├── AGENTS.md                     # Workspace rules & engineering constraints
├── DEVELOPMENT_PROGRESS.md       # Initial analysis and progress tracker
└── LICENSE                       # MIT License
```

---

## Key Features

- **100% Offline Architecture**: Runs entirely locally with zero runtime network requests, CDN assets, telemetry, or remote auth (`webRequest` blocks outbound traffic in the main process).
- **Exact Financial & Carat Precision**: Monetary values stored in integer **paise** (`100 = ₹1.00`), weights in **1/100th carat**, and decimal rate calculations handled via `decimal.js`.
- **Double-Entry Accrual Accounting**: Atomic, balanced postings across Purchases (FIFO & manual lot costing, expenses), Sales (COGS, brokerages, adjustments), Payments & Advances, Loans (monthly/yearly accrual interest & settlements), Cash/Bank Transfers, and Journal Vouchers.
- **Multi-Company Isolation & Default Company**: Each company uses an isolated SQLite database; mark any company as **Default** in **Manage Companies** to open it automatically right after sign-in.
- **Offline Two-Channel Password Recovery**:
  - **Channel A (Recovery Code)**: 256-bit key hashed with Argon2id (`hash-wasm`), staged atomically as a hidden local PDF via Chromium `printToPDF`, and rotatable in **Settings**.
  - **Channel B (Device PIN)**: Optional 6-digit PIN encrypted via OS SafeStorage (macOS Keychain / Windows DPAPI) and bound to hardware machine identity + account hash with a crash-proof 5-attempt budget.
- **Side-Drawer Workflows & Branded UI**: Right-side creation/review drawers, confirmation dialogs, and in-app CSS customizable dropdowns (`appearance: base-select`) across all 18 views.
- **Backups & Exports**: Integrity-checked gzipped `.diamo` full and per-company backups/restores plus CSV, Excel (`.xlsx`), and PDF exports.

> **Production Data Location**: Runtime application databases, backups, and device recovery files live outside the source and install directories in OS-derived app data paths.

---

## Development Setup

All commands run from the `application/` directory:

```sh
cd application
npm install
```

### Common Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start Electron + Vite in development mode |
| `npm run typecheck` | Run TypeScript typechecking (`tsc --noEmit`) |
| `npm run build` | Build main, preload, and renderer bundles (`electron-vite build`) |
| `npm test` | Run Vitest unit & integration test suite (`node scripts/test.cjs`) |
| `npm run test:ui` | Build/launch Electron and run Playwright desktop E2E tests |
| `npm run package:mac` | Package macOS DMG installer into `application/dist/` |
| `npm run package:win` | Package Windows NSIS installer into `application/dist/` |

---

## License

See [LICENSE](./LICENSE).
