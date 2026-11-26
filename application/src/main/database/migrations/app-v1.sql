PRAGMA foreign_keys=ON;
CREATE TABLE users(id INTEGER PRIMARY KEY CHECK(id=1), email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 1 CHECK(must_change IN(0,1)));
CREATE TABLE companies(id TEXT PRIMARY KEY, name TEXT NOT NULL, db_filename TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE backup_jobs(id INTEGER PRIMARY KEY, destination TEXT NOT NULL, interval_minutes INTEGER NOT NULL CHECK(interval_minutes>0), retention INTEGER NOT NULL CHECK(retention>0), enabled INTEGER NOT NULL CHECK(enabled IN(0,1)), on_exit INTEGER NOT NULL CHECK(on_exit IN(0,1)), company_id TEXT REFERENCES companies(id));
CREATE TABLE backup_history(id INTEGER PRIMARY KEY, job_id INTEGER REFERENCES backup_jobs(id), path TEXT, status TEXT NOT NULL CHECK(status IN('success','failed')), message TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP);
INSERT INTO schema_migrations(version) VALUES(1);
