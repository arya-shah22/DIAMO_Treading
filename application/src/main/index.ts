import { app, BrowserWindow, ipcMain, dialog, session, nativeImage, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  rmSync,
} from 'node:fs'
import { ApplicationService } from './services/application'
import { buildRecoveryPdfHtml, type RecoveryPdfInput } from './services/recovery-pdf'
import { commands, type Command } from '../shared/contracts'
import { z } from 'zod'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { writeReport, printHtml } from './services/reports'

async function renderRecoveryPdfWindow(input: RecoveryPdfInput): Promise<Buffer> {
  const tmpHtml = join(app.getPath('temp'), `diamo-recovery-${randomUUID()}.html`)
  const resizedLogo =
    input.logoPath &&
    (() => {
      try {
        const img = nativeImage.createFromPath(input.logoPath)
        return img.isEmpty() ? undefined : img.resize({ width: 128 }).toDataURL()
      } catch {
        return undefined
      }
    })()
  writeFileSync(tmpHtml, buildRecoveryPdfHtml({ ...input, logoDataUri: resizedLogo }), {
    encoding: 'utf8',
    mode: 0o600,
  })
  const pdfWin = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  try {
    await pdfWin.loadFile(tmpHtml)
    return await pdfWin.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
  } finally {
    pdfWin.destroy()
    rmSync(tmpHtml, { force: true })
  }
}
let win: BrowserWindow
let service: ApplicationService
let queue: Promise<unknown> = Promise.resolve()
let quitting = false
const dataPath = process.env.DIAMO_TEST_DATA || join(app.getPath('appData'), 'DIAMO_TREADING')
app.setPath('userData', dataPath)
if (!app.requestSingleInstanceLock()) app.quit()
function result<T>(f: () => T | Promise<T>) {
  return Promise.resolve()
    .then(f)
    .then((data) => ({ ok: true, data }))
    .catch((e: unknown) => ({
      ok: false,
      error: e instanceof Error ? e.message : 'Operation failed',
    }))
}
function handle(channel: string, f: (input: any) => unknown) {
  ipcMain.handle(channel, (event, input) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
      return { ok: false, error: 'Untrusted sender' }
    const task = queue.then(() => result(() => f(input)))
    queue = task
    return task
  })
}
async function scheduledBackup() {
  if (!service.authenticated || service.mustChange) return
  for (const job of service.appDb
    .prepare('SELECT * FROM backup_jobs WHERE enabled=1')
    .all() as any[]) {
    const last = service.appDb
      .prepare(
        "SELECT created_at FROM backup_history WHERE status='success' AND job_id=? ORDER BY id DESC LIMIT 1",
      )
      .get(job.id) as { created_at: string } | undefined
    if (!last || Date.now() - Date.parse(last.created_at + 'Z') > job.interval_minutes * 60000) {
      const path = await service.backup(job.destination, job.company_id ?? undefined)
      service.appDb.prepare('UPDATE backup_history SET job_id=? WHERE path=?').run(job.id, path)
      prune(job.destination, job.retention)
    }
  }
}
function prune(folder: string, retention = 30) {
  const own = readdirSync(folder)
    .filter((n) => /^DIAMO_TREADING-\d{4}-.*\.diamo$/.test(n))
    .sort()
    .reverse()
  for (const name of own.slice(retention))
    if (statSync(join(folder, name)).isFile()) unlinkSync(join(folder, name))
}
app.whenReady().then(async () => {
  service = new ApplicationService(dataPath, {
    safeStorage,
    pdfRenderer: renderRecoveryPdfWindow,
    logoPath: join(app.getAppPath(), 'resources/branding/icon.png'),
    fontPath: join(app.getAppPath(), 'resources/fonts/Inter-Regular.ttf'),
  })
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  )
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const dev = process.env.ELECTRON_RENDERER_URL
    callback({
      cancel:
        !details.url.startsWith('file:') &&
        !details.url.startsWith('data:') &&
        !details.url.startsWith('devtools:') &&
        !(dev && details.url.startsWith(dev)),
    })
  })
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1000,
    minHeight: 700,
    title: 'DIAMO_TREADING',
    backgroundColor: '#050B1E',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  handle('diamo:command', async (input) => {
    const envelope = z
      .object({
        name: z.enum(Object.keys(commands) as [Command, ...Command[]]),
        input: z.unknown(),
        companyId: z.string().uuid().optional(),
        operationKey: z.string().min(1).max(128).optional(),
      })
      .parse(input)
    const result = await service.execute(
      envelope.name,
      envelope.input,
      envelope.companyId,
      envelope.operationKey,
    )
    if (envelope.name === 'auth.login' || envelope.name === 'auth.password')
      setTimeout(() => {
        queue = queue.then(() => scheduledBackup()).catch(() => {})
      }, 0)
    return result
  })
  handle('diamo:saveRecoveryPdf', async () => {
    service.requireAuth()
    if (!service.pendingRecoveryPdf) throw Error('No recovery PDF is available to save')
    const chosen = await dialog.showSaveDialog(win, {
      title: 'Save Account Recovery PDF',
      defaultPath: 'DIAMO-Recovery-Key.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (chosen.canceled || !chosen.filePath) return ''
    writeFileSync(chosen.filePath, service.pendingRecoveryPdf, { mode: 0o600 })
    return chosen.filePath
  })
  handle('diamo:state', (input) => {
    const t = z
      .object({
        companyId: z.string().uuid().optional(),
        query: z
          .object({ from: z.string(), to: z.string(), partyId: z.number().optional() })
          .optional(),
      })
      .parse(input)
    return service.state(t.companyId, t.query)
  })
  handle('diamo:logo', async (input) => {
    const companyId = z.string().uuid().parse(input.companyId)
    const c = service.requireCompany(companyId)
    const selected = await dialog.showOpenDialog(win, {
      title: 'Choose company logo',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
    })
    if (selected.canceled) return ''
    const bytes = readFileSync(selected.filePaths[0])
    if (bytes.length > 10 * 1024 * 1024) throw Error('Logo must be smaller than 10 MB')
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) throw Error('Image cannot be decoded')
    const png = image.resize({ width: 512 }).toPNG()
    mkdirSync(join(dataPath, 'assets'), { recursive: true })
    writeFileSync(join(dataPath, 'assets', companyId + '.png'), png, { mode: 0o600 })
    c.run('UPDATE company_profile SET logo_path=?', companyId + '.png')
    c.audit('company', 1, 'logo', null, { filename: companyId + '.png' })
    return 'Logo updated'
  })
  handle('diamo:backup', async (input) => {
    service.requireAuth()
    const action = z.enum(['create', 'restore', 'configure', 'history']).parse(input.action)
    const options = z
      .object({
        intervalHours: z.number().int().min(1).max(8760),
        retention: z.number().int().min(1).max(1000),
        onExit: z.boolean(),
        scope: z.enum(['full', 'company']),
      })
      .parse(input.options ?? { intervalHours: 24, retention: 30, onExit: true, scope: 'full' })
    if (action === 'history')
      return service.appDb.prepare('SELECT * FROM backup_history ORDER BY id DESC LIMIT 100').all()
    if (action === 'restore') {
      const chosen = await dialog.showOpenDialog(win, {
        title: 'Restore DIAMO backup',
        properties: ['openFile'],
        filters: [{ name: 'DIAMO backup', extensions: ['diamo'] }],
      })
      if (chosen.canceled) return null
      const confirm = await dialog.showMessageBox(win, {
        type: 'warning',
        title: 'Restore selected backup?',
        message:
          'Full snapshots replace local companies and credentials. Individual snapshots create a separate restored company. A recovery backup is made first.',
        buttons: ['Cancel', 'Restore'],
        defaultId: 0,
        cancelId: 0,
      })
      if (confirm.response !== 1) return null
      return service.restore(chosen.filePaths[0])
    }
    const chosen = await dialog.showOpenDialog(win, {
      title: action === 'configure' ? 'Choose automatic backup folder' : 'Save backup',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (chosen.canceled) return null
    const companyId = options.scope === 'company' ? service.companyId : undefined
    if (options.scope === 'company' && !companyId) throw Error('Select a company first')
    let jobId: number | undefined
    if (action === 'configure') {
      service.appDb.prepare('UPDATE backup_jobs SET enabled=0').run()
      jobId = Number(
        service.appDb
          .prepare(
            'INSERT INTO backup_jobs(destination,interval_minutes,retention,enabled,on_exit,company_id) VALUES(?,?,?,1,?,?)',
          )
          .run(
            chosen.filePaths[0],
            options.intervalHours * 60,
            options.retention,
            +options.onExit,
            companyId ?? null,
          ).lastInsertRowid,
      )
    }
    const path = await service.backup(chosen.filePaths[0], companyId)
    if (jobId)
      service.appDb.prepare('UPDATE backup_history SET job_id=? WHERE path=?').run(jobId, path)
    prune(chosen.filePaths[0], options.retention)
    return path
  })
  handle('diamo:export', async (input) => {
    service.requireAuth()
    const t = z
      .object({
        format: z.enum(['csv', 'xlsx', 'pdf', 'print']),
        title: z.string().min(1).max(250),
        rows: z
          .array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])))
          .max(100000),
      })
      .parse(input)
    const company = service.company?.one('SELECT name FROM company_profile').name ?? 'DIAMO'
    if (t.format === 'print') {
      const printing = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      })
      await printing.loadURL(
        'data:text/html;charset=utf-8,' + encodeURIComponent(printHtml(t.title, company, t.rows)),
      )
      await new Promise<void>((resolve, reject) =>
        printing.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
          printing.destroy()
          if (success || reason === 'cancelled') resolve()
          else reject(Error(reason))
        }),
      )
      return 'Print dialog completed'
    }
    const chosen = await dialog.showSaveDialog(win, {
      defaultPath: t.title.replace(/[^a-zA-Z0-9 -]/g, '').slice(0, 100) + '.' + t.format,
      filters: [{ name: t.format.toUpperCase(), extensions: [t.format] }],
    })
    if (chosen.canceled || !chosen.filePath) return ''
    await writeReport(
      t.format,
      chosen.filePath,
      t.title,
      company,
      t.rows,
      join(app.getAppPath(), 'resources/fonts/Inter-Regular.ttf'),
      join(app.getAppPath(), 'resources/branding/icon.png'),
    )
    return chosen.filePath
  })

  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await win.loadFile(join(__dirname, '../renderer/index.html'))
  void scheduledBackup().catch(() => {})
  setInterval(() => {
    queue = queue.then(() => scheduledBackup()).catch(() => {})
  }, 60000).unref()
})
app.on('second-instance', () => {
  win?.show()
  win?.focus()
})
app.on('window-all-closed', () => app.quit())
app.on('before-quit', (event) => {
  if (quitting || !service) return
  event.preventDefault()
  quitting = true
  queue.then(async () => {
    if (service.authenticated && !service.mustChange)
      for (const job of service.appDb
        .prepare('SELECT * FROM backup_jobs WHERE enabled=1 AND on_exit=1')
        .all() as any[])
        try {
          const path = await service.backup(job.destination, job.company_id ?? undefined)
          service.appDb.prepare('UPDATE backup_history SET job_id=? WHERE path=?').run(job.id, path)
          prune(job.destination, job.retention)
        } catch (e) {
          dialog.showErrorBox('Exit backup failed', String(e))
        }
    service.close()
    app.quit()
  })
})
