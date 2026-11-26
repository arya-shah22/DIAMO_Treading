import { randomUUID, createHash } from 'node:crypto'
import { join } from 'node:path'
import {
    mkdirSync,
    readFileSync,
    writeFileSync,
    renameSync,
    rmSync,
    existsSync,
    readdirSync,
} from 'node:fs'
import { gzipSync, gunzipSync } from 'node:zlib'
import bcrypt from 'bcryptjs'
import { openDatabase, type Db } from '../database'
import { CompanyService } from './company'
import {
    canonicalRecoverySecret,
    generateRecoveryKey,
    hashArgon2id,
    isLegacyBcryptHash,
    sha256Hex,
    verifySecret,
} from './crypto'
import { MAX_PIN_ATTEMPTS, RecoveryService, type RecoveryOptions } from './recovery'
import { commands, date, type Command, type Query, type Row } from '../../shared/contracts'
import { today } from '../../shared/math'

export class ApplicationService {
    appDb: Db
    company?: CompanyService
    companyId?: string
    authenticated = false
    mustChange = false
    recovery: RecoveryService
    pendingRecoveryKey?: string
    pendingRecoveryPdf?: Buffer

    constructor(
        public dataPath: string,
        recoveryOptions: Partial<RecoveryOptions> = {},
    ) {
        this.recoverInterruptedRestore()
        mkdirSync(join(dataPath, 'companies'), { recursive: true })
        this.recovery = new RecoveryService({ dataPath, ...recoveryOptions })
        this.appDb = openDatabase(join(dataPath, 'app.sqlite'), 'app')
        if (!this.appDb.prepare('SELECT id FROM users').get())
            this.appDb
                .prepare('INSERT INTO users(id,email,password_hash) VALUES(1,?,?)')
                .run('admin@gmail.com', bcrypt.hashSync('Admin@123', 12))
    }
    companies() {
        return this.appDb
            .prepare('SELECT id,name,is_default FROM companies ORDER BY is_default DESC, name ASC')
            .all()
    }
    requireAuth() {
        if (!this.authenticated) throw Error('Please sign in')
    }
    requireCompany(id?: string) {
        this.requireAuth()
        if (!id || id !== this.companyId || !this.company)
            throw Error('Company changed. Select the company and retry.')
        return this.company
    }
    select(id: string) {
        const c = this.appDb.prepare('SELECT * FROM companies WHERE id=?').get(id) as Row | undefined
        if (!c) throw Error('Company not found')
        this.company?.db.close()
        this.company = new CompanyService(
            openDatabase(join(this.dataPath, 'companies', c.db_filename), 'company'),
        )
        this.companyId = id
        return { id }
    }
    async execute(name: Command, input: unknown, companyId?: string, operationKey?: string) {
        const t: any = commands[name].parse(input)
        if (name === 'auth.recoveryStatus') {
            const u = this.appDb.prepare('SELECT recovery_hash FROM users WHERE id=1').get() as Row
            return this.recovery.status(u?.recovery_hash ?? null)
        }
        if (name === 'auth.login') {
            const u = this.appDb.prepare('SELECT * FROM users WHERE id=1').get() as Row
            if (
                t.email.toLowerCase() !== u.email.toLowerCase() ||
                !(await verifySecret(u.password_hash, t.password))
            )
                throw Error('Incorrect username or password')
            if (isLegacyBcryptHash(u.password_hash)) {
                this.appDb
                    .prepare('UPDATE users SET password_hash=? WHERE id=1')
                    .run(await hashArgon2id(t.password))
            }
            if (!u.recovery_hash || !u.recovery_acknowledged) {
                const key = generateRecoveryKey()
                const recHash = await hashArgon2id(canonicalRecoverySecret(key))
                const pdfBytes = await this.recovery.renderRecoveryPdf(u.email, key, recHash)
                this.recovery.saveHiddenRecoveryPdf(u.email, recHash, pdfBytes)
                if (u.recovery_hash) {
                    this.recovery.updatePinAccount(u.recovery_hash, recHash)
                }
                this.appDb
                    .prepare('UPDATE users SET recovery_hash=?,recovery_acknowledged=0 WHERE id=1')
                    .run(recHash)
                this.pendingRecoveryKey = key
                this.pendingRecoveryPdf = pdfBytes
            } else {
                this.pendingRecoveryKey = undefined
                this.pendingRecoveryPdf = undefined
            }
            this.authenticated = true
            this.mustChange = false
            const defaultCompany = this.appDb
                .prepare('SELECT id FROM companies WHERE is_default=1 LIMIT 1')
                .get() as { id: string } | undefined
            if (defaultCompany) {
                try {
                    this.select(defaultCompany.id)
                } catch {
                    // Leave company unselected if default company database is unavailable
                }
            }
            return {
                mustChange: false,
                recoveryPrompt: Boolean(this.pendingRecoveryKey),
                companyId: this.companyId,
            }
        }
        if (name === 'auth.logout') {
            this.authenticated = false
            this.mustChange = false
            this.pendingRecoveryKey = undefined
            this.pendingRecoveryPdf = undefined
            this.company?.db.close()
            this.company = undefined
            this.companyId = undefined
            return { loggedOut: true }
        }
        if (name === 'auth.reset') {
            const u = this.appDb.prepare('SELECT * FROM users WHERE id=1').get() as Row
            if (!u.recovery_hash) throw Error('No recovery code is configured for this account')
            const canonical = canonicalRecoverySecret(t.recoveryKey)
            const usernameMatches = t.username.trim().toLowerCase() === u.email.toLowerCase()
            const keyMatches = canonical.length === 64 && (await verifySecret(u.recovery_hash, canonical))
            if (!usernameMatches || !keyMatches) throw Error('Invalid username or recovery code')
            const newHash = await hashArgon2id(t.newPassword)
            this.appDb.prepare('UPDATE users SET password_hash=?,must_change=0 WHERE id=1').run(newHash)
            this.authenticated = false
            this.mustChange = false
            this.pendingRecoveryKey = undefined
            this.pendingRecoveryPdf = undefined
            this.company?.db.close()
            this.company = undefined
            this.companyId = undefined
            return { reset: true }
        }
        if (name === 'auth.resetPin') {
            const u = this.appDb.prepare('SELECT * FROM users WHERE id=1').get() as Row
            const record = this.recovery.readPin(u.recovery_hash ?? null)
            if (!record) throw Error('Device PIN is not configured for this computer')
            if (record.failures >= MAX_PIN_ATTEMPTS)
                throw Error('Device PIN is locked after 5 failed attempts. Use your Recovery Code.')
            record.failures += 1
            this.recovery.writePin(record)
            const usernameMatches = t.username.trim().toLowerCase() === u.email.toLowerCase()
            const pinMatches = await verifySecret(record.hash, t.pin)
            if (!usernameMatches || !pinMatches) {
                const left = Math.max(0, MAX_PIN_ATTEMPTS - record.failures)
                throw Error(
                    left > 0
                        ? `Incorrect username or Device PIN (${left} attempt${left === 1 ? '' : 's'} remaining)`
                        : 'Device PIN is locked after 5 failed attempts. Use your Recovery Code.',
                )
            }
            record.failures = 0
            this.recovery.writePin(record)
            const newHash = await hashArgon2id(t.newPassword)
            this.appDb.prepare('UPDATE users SET password_hash=?,must_change=0 WHERE id=1').run(newHash)
            this.authenticated = false
            this.mustChange = false
            this.pendingRecoveryKey = undefined
            this.pendingRecoveryPdf = undefined
            this.company?.db.close()
            this.company = undefined
            this.companyId = undefined
            return { reset: true }
        }
        if (name === 'auth.acknowledgeRecovery') {
            this.requireAuth()
            this.appDb.prepare('UPDATE users SET recovery_acknowledged=1 WHERE id=1').run()
            this.pendingRecoveryKey = undefined
            return { acknowledged: true }
        }
        if (name === 'auth.rotateRecovery') {
            this.requireAuth()
            const u = this.appDb.prepare('SELECT * FROM users WHERE id=1').get() as Row
            if (!(await verifySecret(u.password_hash, t.currentPassword)))
                throw Error('Current password is incorrect')
            const key = generateRecoveryKey()
            const recHash = await hashArgon2id(canonicalRecoverySecret(key))
            const pdfBytes = await this.recovery.renderRecoveryPdf(u.email, key, recHash)
            this.recovery.saveHiddenRecoveryPdf(u.email, recHash, pdfBytes)
            if (u.recovery_hash) {
                this.recovery.updatePinAccount(u.recovery_hash, recHash)
            }
            this.appDb
                .prepare('UPDATE users SET recovery_hash=?,recovery_acknowledged=1 WHERE id=1')
                .run(recHash)
            this.pendingRecoveryKey = undefined
            this.pendingRecoveryPdf = pdfBytes
            return { recoveryKey: key }
        }
        if (name === 'auth.enrollPin') {
            this.requireAuth()
            const u = this.appDb.prepare('SELECT * FROM users WHERE id=1').get() as Row
            if (!(await verifySecret(u.password_hash, t.currentPassword)))
                throw Error('Current password is incorrect')
            if (!this.recovery.canEnroll(u.recovery_hash ?? null))
                throw Error('Hardware-bound Device PIN encryption is not available on this device')
            const deviceId = this.recovery.getDeviceId()!
            const pinHash = await hashArgon2id(t.pin)
            this.recovery.writePin({
                device: deviceId,
                account: sha256Hex(u.recovery_hash),
                hash: pinHash,
                failures: 0,
            })
            return { enrolled: true, remaining: MAX_PIN_ATTEMPTS }
        }
        if (name === 'auth.removePin') {
            this.requireAuth()
            const u = this.appDb.prepare('SELECT * FROM users WHERE id=1').get() as Row
            if (!(await verifySecret(u.password_hash, t.currentPassword)))
                throw Error('Current password is incorrect')
            this.recovery.removePin()
            return { enrolled: false }
        }
        if (name === 'auth.username') {
            if (!this.authenticated) throw Error('Please sign in')
            const u = this.appDb.prepare('SELECT * FROM users WHERE id=1').get() as Row
            if (!(await verifySecret(u.password_hash, t.currentPassword)))
                throw Error('Current password is incorrect')
            const nextUsername = t.newUsername.trim()
            if (nextUsername === u.email) throw Error('Choose a different username')
            this.appDb.prepare('UPDATE users SET email=? WHERE id=1').run(nextUsername)
            return { changed: true, username: nextUsername }
        }
        if (name === 'auth.password') {
            if (!this.authenticated) throw Error('Please sign in')
            const u = this.appDb.prepare('SELECT * FROM users WHERE id=1').get() as Row
            if (!(await verifySecret(u.password_hash, t.oldPassword)))
                throw Error('Current password is incorrect')
            if (t.oldPassword === t.newPassword) throw Error('Choose a different password')
            this.appDb
                .prepare('UPDATE users SET password_hash=?,must_change=0 WHERE id=1')
                .run(await hashArgon2id(t.newPassword))
            this.mustChange = false
            return { changed: true }
        }
        this.requireAuth()
        if (name === 'companies.create') {
            const id = randomUUID()
            const filename = id + '.sqlite'
            const path = join(this.dataPath, 'companies', filename)
            const db = openDatabase(path, 'company')
            try {
                db.prepare(
                    'INSERT INTO company_profile(id,name,address,contact,start_date) VALUES(1,?,?,?,?)',
                ).run(t.name, t.address, t.contact, t.date)
                this.appDb
                    .prepare('INSERT INTO companies(id,name,db_filename) VALUES(?,?,?)')
                    .run(id, t.name, filename)
            } catch (e) {
                db.close()
                rmSync(path, { force: true })
                throw e
            }
            db.close()
            return this.select(id)
        }
        if (name === 'companies.select') return this.select(t.id)
        if (name === 'companies.setDefault') {
            this.appDb.transaction(() => {
                this.appDb.prepare('UPDATE companies SET is_default=0 WHERE is_default=1').run()
                if (t.id) {
                    const updated = this.appDb
                        .prepare('UPDATE companies SET is_default=1 WHERE id=?')
                        .run(t.id)
                    if (!updated.changes) throw Error('Company not found')
                }
            })()
            return { defaultCompanyId: t.id }
        }
        if (name === 'companies.setDefault') {
            this.appDb.transaction(() => {
                this.appDb.prepare('UPDATE companies SET is_default=0 WHERE is_default=1').run()
                if (t.id) {
                    const updated = this.appDb.prepare('UPDATE companies SET is_default=1 WHERE id=?').run(t.id)
                    if (!updated.changes) throw Error('Company not found')
                }
            })()
            return { defaultCompanyId: t.id }
        }
        const result = this.requireCompany(companyId).execute(name, t, operationKey)
        if (name === 'settings.save')
            this.appDb.prepare('UPDATE companies SET name=? WHERE id=?').run(t.name, companyId)
        return result
    }
    state(companyId?: string, query?: Query) {
        if (!this.authenticated) {
            const user = this.appDb.prepare('SELECT recovery_hash FROM users WHERE id=1').get() as Row
            return {
                authenticated: false,
                recoveryStatus: this.recovery.status(user?.recovery_hash ?? null),
            }
        }
        const user = this.appDb
            .prepare('SELECT email, recovery_hash FROM users WHERE id=1')
            .get() as Row
        const q = query ?? { from: today().slice(0, 4) + '-04-01', to: today() }
        date.parse(q.from)
        date.parse(q.to)
        if (q.from > q.to) throw Error('Start date must not be after end date')
        const companyLogo =
            this.companyId && existsSync(join(this.dataPath, 'assets', this.companyId + '.png'))
                ? 'data:image/png;base64,' +
                readFileSync(join(this.dataPath, 'assets', this.companyId + '.png')).toString('base64')
                : null
        return {
            companyLogo,
            username: user.email,
            recoveryPrompt: Boolean(this.pendingRecoveryKey),
            pendingRecoveryKey: this.pendingRecoveryKey ?? null,
            recoveryStatus: this.recovery.status(user?.recovery_hash ?? null),
            backupJobs: this.appDb.prepare('SELECT * FROM backup_jobs WHERE enabled=1').all(),
            backupHistory: this.appDb
                .prepare('SELECT * FROM backup_history ORDER BY id DESC LIMIT 100')
                .all(),
            authenticated: true,
            mustChange: false,
            companies: this.companies(),
            companyId: this.companyId,
            ...((companyId ?? this.companyId)
                ? this.requireCompany(companyId ?? this.companyId).snapshot(q)
                : {}),
        }
    }
    recoverInterruptedRestore() {
        const marker = join(this.dataPath, 'restore-state.json')
        if (!existsSync(marker)) return
        const state = JSON.parse(readFileSync(marker, 'utf8'))
        if (!/^rollback-[0-9a-f-]{36}$/.test(state.folder))
            throw Error('Invalid restore recovery marker')
        for (const item of ['app.sqlite', 'companies', 'assets']) {
            const old = join(this.dataPath, state.folder, item)
            if (existsSync(old)) {
                rmSync(join(this.dataPath, item), { recursive: true, force: true })
                renameSync(old, join(this.dataPath, item))
            }
        }
        rmSync(marker, { force: true })
    }
    async backup(destination: string, companyId?: string) {
        this.requireAuth()
        mkdirSync(destination, { recursive: true })
        const stage = join(this.dataPath, 'backup-stage-' + randomUUID())
        mkdirSync(stage)
        const snapshots: Record<string, string> = {}
        try {
            if (!companyId) {
                await this.appDb.backup(join(stage, 'app.sqlite'))
                snapshots['app.sqlite'] = readFileSync(join(stage, 'app.sqlite')).toString('base64')
            }
            const companies = (this.appDb.prepare('SELECT * FROM companies').all() as Row[]).filter(
                (c) => !companyId || c.id === companyId,
            )
            if (companyId && !companies.length) throw Error('Company not found')
            for (const c of companies) {
                const db =
                    c.id === this.companyId
                        ? this.company!.db
                        : openDatabase(join(this.dataPath, 'companies', c.db_filename), 'company')
                try {
                    await db.backup(join(stage, c.db_filename))
                    snapshots[companyId ? 'company.sqlite' : 'companies/' + c.db_filename] = readFileSync(
                        join(stage, c.db_filename),
                    ).toString('base64')
                } finally {
                    if (c.id !== this.companyId) db.close()
                }
            }
            const assets = join(this.dataPath, 'assets')
            if (existsSync(assets))
                for (const name of readdirSync(assets)) {
                    if (/^[0-9a-f-]{36}\.png$/.test(name) && (!companyId || name === companyId + '.png'))
                        snapshots['assets/' + name] = readFileSync(join(assets, name)).toString('base64')
                }
            const manifest = {
                format: 'DIAMO_BACKUP_V1',
                scope: companyId ? 'company' : 'full',
                company: companyId ? { id: companyId, name: companies[0].name } : undefined,
                createdAt: new Date().toISOString(),
                files: Object.fromEntries(
                    Object.entries(snapshots).map(([name, data]) => [
                        name,
                        {
                            data,
                            sha256: createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex'),
                        },
                    ]),
                ),
            }
            const name = 'DIAMO_TREADING-' + new Date().toISOString().replaceAll(':', '-') + '.diamo'
            const path = join(destination, name)
            writeFileSync(path + '.tmp', gzipSync(JSON.stringify(manifest)), { mode: 0o600 })
            renameSync(path + '.tmp', path)
            this.appDb
                .prepare(
                    "INSERT INTO backup_history(path,status,message) VALUES(?,'success','Full verified snapshot')",
                )
                .run(path)
            return path
        } catch (e) {
            this.appDb
                .prepare("INSERT INTO backup_history(status,message) VALUES('failed',?)")
                .run(String(e))
            throw e
        } finally {
            rmSync(stage, { recursive: true, force: true })
        }
    }
    async restore(path: string) {
        this.requireAuth()
        const raw = gunzipSync(readFileSync(path), { maxOutputLength: 512 * 1024 * 1024 })
        const archive = JSON.parse(raw.toString())
        if (
            archive.format !== 'DIAMO_BACKUP_V1' ||
            !(archive.files?.['app.sqlite'] || archive.files?.['company.sqlite'])
        )
            throw Error('Invalid DIAMO backup')
        const stage = join(this.dataPath, 'restore-' + randomUUID())
        mkdirSync(join(stage, 'companies'), { recursive: true })
        mkdirSync(join(stage, 'assets'), { recursive: true })
        try {
            for (const [name, entry] of Object.entries(archive.files) as [string, any][]) {
                if (
                    !/^(app\.sqlite|company\.sqlite|companies\/[0-9a-f-]{36}\.sqlite|assets\/[0-9a-f-]{36}\.png)$/.test(
                        name,
                    )
                )
                    throw Error('Unsafe backup filename')
                const bytes = Buffer.from(entry.data, 'base64')
                if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
                    throw Error('Backup checksum mismatch')
                writeFileSync(join(stage, name), bytes, { mode: 0o600 })
                if (name.startsWith('assets/')) continue
                const db = openDatabase(join(stage, name), name === 'app.sqlite' ? 'app' : 'company')
                try {
                    if (
                        db.pragma('integrity_check', { simple: true }) !== 'ok' ||
                        (db.pragma('foreign_key_check') as unknown[]).length
                    )
                        throw Error('Backup database integrity failed')
                } finally {
                    db.close()
                }
            }
            if (archive.scope === 'company') {
                if (!archive.files['company.sqlite']) throw Error('Missing company snapshot')
                await this.backup(join(this.dataPath, 'pre-restore-backups'))
                const id = randomUUID()
                const filename = id + '.sqlite'
                const db = openDatabase(join(stage, 'company.sqlite'), 'company')
                let name: string
                try {
                    name =
                        String(
                            db.prepare('SELECT name FROM company_profile').get() &&
                            (db.prepare('SELECT name FROM company_profile').get() as Row).name,
                        ) + ' (restored)'
                    db.prepare('UPDATE company_profile SET name=?,logo_path=NULL').run(name)
                } finally {
                    db.close()
                }
                renameSync(join(stage, 'company.sqlite'), join(this.dataPath, 'companies', filename))
                try {
                    this.appDb
                        .prepare('INSERT INTO companies(id,name,db_filename) VALUES(?,?,?)')
                        .run(id, name, filename)
                    const oldLogo = join(stage, 'assets', String(archive.company?.id) + '.png')
                    if (existsSync(oldLogo)) {
                        mkdirSync(join(this.dataPath, 'assets'), { recursive: true })
                        renameSync(oldLogo, join(this.dataPath, 'assets', id + '.png'))
                        const restored = openDatabase(join(this.dataPath, 'companies', filename), 'company')
                        restored.prepare('UPDATE company_profile SET logo_path=?').run(id + '.png')
                        restored.close()
                    }
                } catch (e) {
                    rmSync(join(this.dataPath, 'companies', filename), { force: true })
                    throw e
                }
                return { restored: true, companyId: id, individual: true }
            }
            const registry = openDatabase(join(stage, 'app.sqlite'), 'app')
            try {
                for (const c of registry.prepare('SELECT * FROM companies').all() as Row[])
                    if (
                        !/^[0-9a-f-]{36}\.sqlite$/.test(c.db_filename) ||
                        !existsSync(join(stage, 'companies', c.db_filename))
                    )
                        throw Error('Backup is missing a company database')
            } finally {
                registry.close()
            }
            await this.backup(join(this.dataPath, 'pre-restore-backups'))
            this.company?.db.close()
            this.company = undefined
            this.companyId = undefined
            this.appDb.close()
            const rollback = join(this.dataPath, 'rollback-' + randomUUID())
            mkdirSync(rollback)
            const marker = join(this.dataPath, 'restore-state.json')
            writeFileSync(marker, JSON.stringify({ folder: rollback.split(/[/\\]/).pop() }), {
                mode: 0o600,
            })
            const moved: string[] = []
            try {
                for (const item of ['app.sqlite', 'companies', 'assets']) {
                    if (!existsSync(join(this.dataPath, item)))
                        mkdirSync(join(this.dataPath, item), { recursive: true })
                    renameSync(join(this.dataPath, item), join(rollback, item))
                    moved.push(item)
                    renameSync(join(stage, item), join(this.dataPath, item))
                }
                this.appDb = openDatabase(join(this.dataPath, 'app.sqlite'), 'app')
                rmSync(marker, { force: true })
            } catch (e) {
                for (const item of moved.reverse()) {
                    rmSync(join(this.dataPath, item), { recursive: true, force: true })
                    renameSync(join(rollback, item), join(this.dataPath, item))
                }
                this.appDb = openDatabase(join(this.dataPath, 'app.sqlite'), 'app')
                rmSync(marker, { force: true })
                throw e
            }
            this.authenticated = false
            this.mustChange = false
            return { restored: true }
        } finally {
            rmSync(stage, { recursive: true, force: true })
        }
    }
    close() {
        this.company?.db.close()
        this.appDb.close()
    }
}
