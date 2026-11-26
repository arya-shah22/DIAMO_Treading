import Database from 'better-sqlite3'
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
  if (version > 5) {
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

  return db
}
