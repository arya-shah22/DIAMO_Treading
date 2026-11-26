import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('Software Info tab, offline-safe update checker, post-login update modal & external URL guard', async () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    version: string
  }
  let mode: 'update' | 'uptodate' | 'notfound' | 'forbidden' = 'update'

  const server = createServer((_req, res) => {
    if (mode === 'notfound') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: 'Not Found' }))
      return
    }
    if (mode === 'forbidden') {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: 'API rate limit exceeded' }))
      return
    }
    const tag = mode === 'update' ? 'v99.0.0' : `v${pkg.version}`
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        tag_name: tag,
        name: `DIAMO_TREADING ${tag}`,
        body: '- Performance improvements\n- Offline recovery enhancements',
        published_at: '2026-11-26T12:00:00Z',
        html_url: `https://github.com/arya-shah22/DIAMO_Treading/releases/tag/${tag}`,
        assets: [
          {
            name: `DIAMO_TREADING-${tag.slice(1)}-mac-arm64.dmg`,
            browser_download_url: `https://objects.githubusercontent.com/assets/diamo-${tag}-arm64.dmg`,
          },
          {
            name: `DIAMO_TREADING-${tag.slice(1)}-mac-x64.dmg`,
            browser_download_url: `https://objects.githubusercontent.com/assets/diamo-${tag}-x64.dmg`,
          },
          {
            name: `DIAMO_TREADING-${tag.slice(1)}-win-x64.exe`,
            browser_download_url: `https://release-assets.githubusercontent.com/assets/diamo-${tag}-win-x64.exe`,
          },
        ],
      }),
    )
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address() as { port: number }
  const mockUrl = `http://127.0.0.1:${addr.port}/releases/latest`

  const dir = mkdtempSync(join(tmpdir(), 'diamo-updater-'))
  const env: Record<string, string | undefined> = {
    ...process.env,
    DIAMO_TEST_DATA: dir,
    DIAMO_TEST_UPDATE_URL: mockUrl,
  }
  delete env.ELECTRON_RUN_AS_NODE

  const app = await electron.launch({
    args: ['.', '--use-mock-keychain'],
    env: env as Record<string, string>,
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const network: string[] = []
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) network.push(r.url())
  })

  try {
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()

    // Unauthenticated callers cannot query system info, check updates, or open external URLs
    const unauthInfo = await page.evaluate(() => window.diamo.systemInfo())
    expect(unauthInfo).toMatchObject({ ok: false, error: 'Please sign in' })
    const unauthCheck = await page.evaluate(() => window.diamo.checkUpdate())
    expect(unauthCheck).toMatchObject({ ok: false, error: 'Please sign in' })
    const unauthOpen = await page.evaluate(() =>
      window.diamo.openExternal('https://github.com/arya-shah22/DIAMO_Treading/releases'),
    )
    expect(unauthOpen).toMatchObject({ ok: false, error: 'Please sign in' })

    // Sign in and dismiss first-login onboarding drawer
    await page.getByLabel('Username').fill('admin@gmail.com')
    await page.getByLabel('Password', { exact: true }).fill('Admin@123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('button', { name: /Continue/ }).click()
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click()
    await expect(page.locator('.drawer')).toHaveCount(0)

    // 3s background update check triggers the Software update available modal
    const modal = page.locator('dialog.update-dialog')
    await expect(modal).toBeVisible({ timeout: 10000 })
    await expect(modal.getByRole('heading', { name: 'Software update available' })).toBeVisible()
    await expect(modal).toContainText(`v${pkg.version}`)
    await expect(modal).toContainText('v99.0.0')
    await expect(modal).toContainText('Offline recovery enhancements')
    await page.getByRole('button', { name: 'Remind me later', exact: true }).click()
    await expect(modal).not.toBeVisible()

    // Navigate to Settings -> Software info & updates tab
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('tab', { name: 'Software info & updates', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Software info & updates' })).toBeVisible()
    const softwarePanel = page.getByRole('tabpanel', { name: 'Software info & updates' })
    await expect(softwarePanel.getByText(`v${pkg.version}`, { exact: true })).toBeVisible()
    await expect(softwarePanel.getByText(dir, { exact: true })).toBeVisible()
    await expect(
      softwarePanel.getByText(`Update available: v${pkg.version} → v99.0.0`),
    ).toBeVisible()

    // Manual check: Up to date
    mode = 'uptodate'
    await page.getByRole('button', { name: 'Check for updates', exact: true }).click()
    await expect(
      page.getByText(`You are running the latest version (v${pkg.version}).`),
    ).toBeVisible()

    // Manual check: HTTP 404 (private or no public releases)
    mode = 'notfound'
    await page.getByRole('button', { name: 'Check for updates', exact: true }).click()
    await expect(
      page.getByText('No public releases found or repository is currently private.'),
    ).toBeVisible()

    // Manual check: HTTP 403 rate-limit -> graceful offline message
    mode = 'forbidden'
    await page.getByRole('button', { name: 'Check for updates', exact: true }).click()
    await expect(
      page.getByText('Could not reach GitHub. Please check your internet connection.'),
    ).toBeVisible()

    // Manual check: server stopped (offline / ECONNREFUSED)
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await page.getByRole('button', { name: 'Check for updates', exact: true }).click()
    await expect(
      page.getByText('Could not reach GitHub. Please check your internet connection.'),
    ).toBeVisible()

    // External URL validation rejects untrusted URLs via IPC
    for (const badUrl of [
      'http://github.com/arya-shah22/DIAMO_Treading',
      'https://github.com/other/repo',
      'javascript:alert(1)',
      'file:///etc/passwd',
    ]) {
      const res = await page.evaluate((u) => window.diamo.openExternal(u), badUrl)
      expect(res).toMatchObject({ ok: false, error: 'Blocked untrusted external URL' })
    }

    expect(network).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await app.close()
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    rmSync(dir, { recursive: true, force: true })
  }
})
