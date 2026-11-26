from pathlib import Path
import sqlite3
root=Path(__file__).parent
for name in ('app','company'):
    db=sqlite3.connect(':memory:')
    db.executescript((root/(name+'.sql')).read_text())
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    if name=='company':
        db.execute("INSERT INTO journal_entries(number,entry_date,source_type) VALUES('JV/2026-27/0001','2026-11-26','journal')")
        db.execute("INSERT INTO journal_lines(journal_id,account_id,debit) SELECT 1,id,5000000 FROM accounts WHERE code='CASH'")
        try: db.execute("UPDATE journal_entries SET status='posted' WHERE id=1")
        except sqlite3.IntegrityError: pass
        else: raise AssertionError('unbalanced journal accepted')
        db.execute("INSERT INTO journal_lines(journal_id,account_id,credit) SELECT 1,id,5000000 FROM accounts WHERE code='CAP'")
        db.execute("UPDATE journal_entries SET status='posted' WHERE id=1")
        try: db.execute('DELETE FROM journal_lines WHERE journal_id=1')
        except sqlite3.IntegrityError: pass
        else: raise AssertionError('posted lines deleted')
    print(name, 'schema smoke test passed')
