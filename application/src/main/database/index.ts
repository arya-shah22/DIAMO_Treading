import Database from 'better-sqlite3'
import { parseSrSequence, srPrefix } from '../../shared/math'
import appSql from './migrations/app-v1.sql?raw'
import companySql from './migrations/company-v1.sql?raw'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

export type Db = Database.Database

export function openDatabase(path: string, kind: 'app' | 'company'): Db {
  mkdirSync(dirname(path), { recursive: true })
  const existedBeforeOpen = existsSync(path) && statSync(path).size > 0
  const db = new Database(path)
  db.pragma('foreign_keys=ON')
  db.pragma('journal_mode=WAL')
  db.pragma('busy_timeout=5000')

  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations'").get()) {
    db.transaction(() => db.exec(kind === 'app' ? appSql : companySql))()
  }

  const version = (
    db.prepare('SELECT max(version) AS v FROM schema_migrations').get() as { v: number }
  ).v
  if (version > 9) {
    throw Error('This database requires a newer application version')
  }

  if (version < 2) {
    if (existedBeforeOpen) {
      db.exec(`VACUUM INTO '${path.replaceAll("'", "''")}.pre-v2-${Date.now()}'`)
    }
    db.transaction(() => {
      if (kind === 'company') {
        db.exec(`
          CREATE TRIGGER immutable_journal_header BEFORE UPDATE ON journal_entries WHEN OLD.status IN ('posted','reversed') BEGIN SELECT RAISE(ABORT,'Posted journals are immutable; use reversal'); END;
          CREATE TRIGGER immutable_journal_delete BEFORE DELETE ON journal_entries WHEN OLD.status IN ('posted','reversed') BEGIN SELECT RAISE(ABORT,'Posted journals cannot be deleted'); END;
          CREATE UNIQUE INDEX journal_number_unique ON journal_entries(number);
          CREATE TABLE operation_keys(key TEXT PRIMARY KEY, result TEXT NOT NULL);
          ALTER TABLE loan_interest_entries ADD COLUMN prior_paid INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE audit_logs ADD COLUMN effective_date TEXT;
        `)
      }
      db.exec('INSERT INTO schema_migrations(version) VALUES(2)')
    })()
  }

  if (version < 3) {
    db.transaction(() => {
      if (kind === 'company') {
        db.exec(`
          CREATE TABLE document_versions(
            kind TEXT NOT NULL,
            root_id INTEGER NOT NULL,
            record_id INTEGER NOT NULL,
            number TEXT NOT NULL,
            current INTEGER NOT NULL CHECK(current IN(0,1)),
            PRIMARY KEY(kind,record_id)
          );
          CREATE UNIQUE INDEX current_document ON document_versions(kind,root_id) WHERE current=1;
        `)
      }
      db.exec('INSERT INTO schema_migrations(version) VALUES(3)')
    })()
  }

  if (version < 4) {
    db.transaction(() => {
      if (kind === 'app') {
        db.exec(`
          ALTER TABLE users ADD COLUMN recovery_hash TEXT;
          ALTER TABLE users ADD COLUMN recovery_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(recovery_acknowledged IN(0,1));
        `)
      }
      db.exec('INSERT INTO schema_migrations(version) VALUES(4)')
    })()
  }

  if (version < 5) {
    db.transaction(() => {
      if (kind === 'app') {
        db.exec(`
          ALTER TABLE companies ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN(0,1));
          CREATE UNIQUE INDEX companies_single_default ON companies(is_default) WHERE is_default=1;
        `)
      }
      db.exec('INSERT INTO schema_migrations(version) VALUES(5)')
    })()
  }

  if (version < 6) {
    db.transaction(() => {
      if (kind === 'company') {
        db.exec(`
          ALTER TABLE qualities ADD COLUMN inventory_mode TEXT NOT NULL DEFAULT 'bulk' CHECK(inventory_mode IN('bulk','individual'));
          ALTER TABLE purchase_items ADD COLUMN price_currency TEXT NOT NULL DEFAULT 'INR' CHECK(price_currency IN('INR','USD'));
          ALTER TABLE purchase_items ADD COLUMN exchange_rate TEXT;
          ALTER TABLE purchase_items ADD COLUMN rate_usd TEXT;
          ALTER TABLE purchase_items ADD COLUMN total_usd TEXT;
          CREATE TABLE diamond_stones(
            id INTEGER PRIMARY KEY,
            lot_id INTEGER UNIQUE NOT NULL REFERENCES stock_lots(id),
            purchase_item_id INTEGER UNIQUE NOT NULL REFERENCES purchase_items(id),
            quality_id INTEGER NOT NULL REFERENCES qualities(id),
            sr_no TEXT NOT NULL DEFAULT '',
            availability TEXT NOT NULL DEFAULT 'available' CHECK(availability IN('available','hold','sold','cancelled')),
            unbilled INTEGER NOT NULL DEFAULT 0 CHECK(unbilled IN(0,1)),
            shape TEXT NOT NULL DEFAULT '',
            carats INTEGER NOT NULL CHECK(carats>0),
            color TEXT NOT NULL DEFAULT '',
            fancy_color TEXT NOT NULL DEFAULT '',
            color_intensity TEXT NOT NULL DEFAULT '',
            color_overtone TEXT NOT NULL DEFAULT '',
            clarity TEXT NOT NULL DEFAULT '',
            cut TEXT NOT NULL DEFAULT '',
            polish TEXT NOT NULL DEFAULT '',
            symmetry TEXT NOT NULL DEFAULT '',
            ratio TEXT NOT NULL DEFAULT '',
            length_mm TEXT NOT NULL DEFAULT '',
            width_mm TEXT NOT NULL DEFAULT '',
            height_mm TEXT NOT NULL DEFAULT '',
            depth_pct TEXT NOT NULL DEFAULT '',
            table_pct TEXT NOT NULL DEFAULT '',
            fluorescence TEXT NOT NULL DEFAULT '',
            lab TEXT NOT NULL DEFAULT '',
            report_number TEXT NOT NULL DEFAULT '',
            growth TEXT NOT NULL DEFAULT '' CHECK(growth IN('','CVD','HPHT')),
            price_currency TEXT NOT NULL DEFAULT 'INR' CHECK(price_currency IN('INR','USD')),
            exchange_rate TEXT NOT NULL DEFAULT '',
            price_per_ct_usd TEXT NOT NULL DEFAULT '',
            total_price_usd TEXT NOT NULL DEFAULT '',
            price_per_ct_inr TEXT NOT NULL DEFAULT '',
            total_price_inr INTEGER NOT NULL DEFAULT 0 CHECK(total_price_inr>=0),
            sale_item_id INTEGER REFERENCES sale_items(id)
          );
          CREATE INDEX diamond_stones_quality ON diamond_stones(quality_id, availability);
        `)
      }
      db.exec('INSERT INTO schema_migrations(version) VALUES(6)')
    })()
  }

  if (version < 7) {
    db.transaction(() => {
      if (kind === 'company') {
        db.exec(`
          ALTER TABLE purchases ADD COLUMN slip_no TEXT NOT NULL DEFAULT '';
          ALTER TABLE sales ADD COLUMN slip_no TEXT NOT NULL DEFAULT '';
          CREATE TABLE quality_sequences(
            quality_id INTEGER PRIMARY KEY REFERENCES qualities(id),
            next_number INTEGER NOT NULL DEFAULT 1 CHECK(next_number>=1)
          );
          CREATE INDEX purchases_slip ON purchases(slip_no);
          CREATE INDEX sales_slip ON sales(slip_no);
          CREATE INDEX diamond_stones_sr ON diamond_stones(sr_no);
        `)
        const qualities = db.prepare('SELECT id, name FROM qualities').all() as {
          id: number
          name: string
        }[]
        const stoneStmt = db.prepare('SELECT sr_no FROM diamond_stones WHERE quality_id=?')
        const seqStmt = db.prepare(
          'INSERT OR REPLACE INTO quality_sequences(quality_id, next_number) VALUES(?,?)',
        )
        for (const q of qualities) {
          const prefix = srPrefix(q.name)
          const rows = stoneStmt.all(q.id) as { sr_no: string }[]
          if (!rows.length) continue
          const maxParsed = rows.reduce((max, r) => {
            const parsed = parseSrSequence(r.sr_no, prefix)
            return parsed && parsed > max ? parsed : max
          }, 0)
          seqStmt.run(q.id, Math.max(maxParsed + 1, rows.length + 1))
        }
      }
      db.exec('INSERT INTO schema_migrations(version) VALUES(7)')
    })()
  }

  if (version < 8) {
    db.transaction(() => {
      if (kind === 'app') {
        db.exec(`
          UPDATE companies SET name = upper(name);
        `)
      } else {
        db.exec(`
          UPDATE company_profile SET name = upper(name), address = upper(address), contact = upper(contact);
          UPDATE parties SET name = upper(name), contact_person = upper(contact_person), phone = upper(phone), address = upper(address), pan = upper(pan), gstin = upper(gstin), remarks = upper(remarks);
          UPDATE qualities SET name = upper(name), description = upper(description);
          UPDATE bank_accounts SET bank_name = upper(bank_name), holder = upper(holder), account_number = upper(account_number), ifsc = upper(ifsc);
          UPDATE accounts SET name = upper(name) WHERE code LIKE 'CUSTOM\\_%' ESCAPE '\\' OR id IN (SELECT account_id FROM bank_accounts);
          UPDATE purchases SET slip_no = upper(slip_no), remarks = upper(remarks);
          UPDATE purchase_expenses SET description = upper(description);
          UPDATE sales SET slip_no = upper(slip_no), remarks = upper(remarks);
          UPDATE sale_adjustments SET description = upper(description);
          UPDATE payments SET mode = upper(mode), reference = upper(reference), remarks = upper(remarks);
          UPDATE loans SET remarks = upper(remarks);
          UPDATE journal_entries SET narration = upper(narration), reference = upper(reference) WHERE status = 'draft';
          UPDATE opening_balances SET description = upper(description);
          UPDATE open_items SET reference = upper(reference);
          UPDATE diamond_stones SET sr_no = upper(sr_no), shape = upper(shape), color = upper(color), fancy_color = upper(fancy_color), color_intensity = upper(color_intensity), color_overtone = upper(color_overtone), clarity = upper(clarity), cut = upper(cut), polish = upper(polish), symmetry = upper(symmetry), fluorescence = upper(fluorescence), lab = upper(lab), report_number = upper(report_number);
        `)
      }
      db.exec('INSERT INTO schema_migrations(version) VALUES(8)')
    })()
  }

  if (version < 9) {
    db.transaction(() => {
      if (kind === 'company') {
        db.exec(`
          ALTER TABLE sale_items ADD COLUMN price_currency TEXT NOT NULL DEFAULT 'INR' CHECK(price_currency IN('INR','USD'));
          ALTER TABLE sale_items ADD COLUMN exchange_rate TEXT;
          ALTER TABLE sale_items ADD COLUMN rate_usd TEXT;
          ALTER TABLE sale_items ADD COLUMN total_usd TEXT;
        `)
      }
      db.exec('INSERT INTO schema_migrations(version) VALUES(9)')
    })()
  }

  return db
}
