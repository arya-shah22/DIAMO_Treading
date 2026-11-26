import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('offline desktop UI side drawers, full transaction workflows, confirmations and all 18 destinations', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'diamo-desktop-'))
  const env: Record<string, string | undefined> = { ...process.env, DIAMO_TEST_DATA: dir }
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
  mkdirSync('test-results/screenshots', { recursive: true })

  try {
    // 1. Login goes straight into workspace (no forced password change prompt)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    await page.screenshot({ path: 'test-results/screenshots/01-login.png' })

    await page.getByLabel('Username').fill('admin@gmail.com')
    await page.getByLabel('Password', { exact: true }).fill('wrong')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Incorrect')

    await page.getByLabel('Password', { exact: true }).fill('Admin@123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    // First-login non-blocking Side Drawer shows auto-generated Recovery Code + hidden PDF created -> Step 2 PIN setup
    await expect(page.locator('.drawer')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your offline recovery code' })).toBeVisible()
    const initialKey = (await page.locator('.recovery-key-box code').innerText()).trim()
    expect(initialKey).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{8}){7}$/)
    const hiddenBefore = readdirSync(dir).filter((n) => /^\.diamo-recovery-.*\.pdf$/.test(n))
    expect(hiddenBefore).toHaveLength(1)

    await page.getByRole('button', { name: /Continue/ }).click()
    await expect(page.getByRole('heading', { name: 'Set up 6-digit device PIN' })).toBeVisible()
    await page.locator('.drawer').getByLabel('Current password').fill('Admin@123')
    await page.locator('.drawer').getByLabel('6-digit Device PIN').fill('654321')
    await page.locator('.drawer').getByLabel('Confirm 6-digit PIN').fill('654321')
    await page.getByRole('button', { name: 'Save Device PIN', exact: true }).click()
    await expect(page.locator('.drawer')).toHaveCount(0)

    // 2. Create company directly via Side Drawer
    await page.getByRole('button', { name: 'Create company', exact: true }).click()
    await expect(page.locator('.drawer')).toBeVisible()
    await page.getByLabel('Company name').fill('Parth Diamond Trading')
    await page.getByLabel('Opening date').fill('2026-04-01')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()

    // 3. Create Masters via Side Drawer (Parties, Quality, Bank)
    await page.getByRole('button', { name: 'Parties Master', exact: true }).click()
    await page.getByRole('button', { name: 'Add party', exact: true }).click()
    await expect(page.locator('.drawer')).toBeVisible()
    await page.getByLabel('Party name').fill('Test Supplier')
    await page.getByLabel('Credit days').fill('15')
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    await page.getByRole('button', { name: 'Add party', exact: true }).click()
    await page.getByLabel('Party name').fill('Test Customer')
    await page.getByLabel('supplier').uncheck()
    await page.getByLabel('customer').check()
    await page.getByLabel('Credit days').fill('30')
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    await page.getByRole('button', { name: 'Add party', exact: true }).click()
    await page.getByLabel('Party name').fill('Test Broker')
    await page.getByLabel('supplier').uncheck()
    await page.getByLabel('broker').check()
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    await page.getByRole('button', { name: 'Quality Master', exact: true }).click()
    await page.getByRole('button', { name: 'Add quality', exact: true }).click()
    await expect(page.locator('.drawer')).toBeVisible()
    await page.getByLabel('Quality name').fill('CVD ROUND')
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    await page.getByRole('button', { name: 'Bank Accounts', exact: true }).click()
    await page.getByRole('button', { name: 'Add bank', exact: true }).click()
    await expect(page.locator('.drawer')).toBeVisible()
    await page.getByLabel('Bank name').fill('HDFC Trading Bank')
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    // 4. Capital JV via Side Drawer so funds are positive
    await page.getByRole('button', { name: 'Journal Voucher', exact: true }).click()
    await page.getByRole('button', { name: 'Add journal voucher', exact: true }).click()
    await expect(page.locator('.drawer')).toBeVisible()
    await page.getByLabel('Invoice date', { exact: false }).count()
    await page.getByLabel('Voucher date').fill('2026-11-01')
    await page.getByLabel('Narration').fill('Opening capital')
    const accountSelects = page.locator('.drawer select[aria-label="Account"]')
    await accountSelects.nth(0).selectOption({ label: 'Cash in Hand' })
    await page.locator('.drawer input[aria-label="Debit ₹"]').nth(0).fill('500000')
    await accountSelects.nth(1).selectOption({ label: 'Capital' })
    await page.locator('.drawer input[aria-label="Credit ₹"]').nth(1).fill('500000')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.locator('.drawer')).toHaveCount(0)

    // 5. Purchase via Side Drawer (Verify right-side drawer position & Review -> Confirm & post)
    await page.getByRole('button', { name: 'Purchase', exact: true }).click()
    await page.getByRole('button', { name: 'Add purchase', exact: true }).click()
    const purchaseDrawer = page.locator('.drawer')
    await expect(purchaseDrawer).toBeVisible()
    await expect(async () => {
      const box = await purchaseDrawer.boundingBox()
      const viewport = page.viewportSize()
      expect(box).not.toBeNull()
      if (box && viewport) {
        expect(Math.abs(box.x + box.width - viewport.width)).toBeLessThanOrEqual(2)
      }
    }).toPass()
    await page.getByLabel('Invoice date').fill('2026-11-01')
    const supplierSelect = page.getByLabel('Supplier')
    expect(await supplierSelect.evaluate((el) => getComputedStyle(el).appearance)).toBe(
      'base-select',
    )
    expect(
      await page.getByLabel('Active company').evaluate((el) => getComputedStyle(el).appearance),
    ).toBe('base-select')
    expect(
      await page.getByLabel('Financial year').evaluate((el) => getComputedStyle(el).appearance),
    ).toBe('base-select')
    await supplierSelect.click()
    await expect(page.locator('select:open')).toHaveCount(1)
    await expect(async () => {
      const opacity = await supplierSelect.evaluate(
        (el) => getComputedStyle(el, '::picker(select)').opacity,
      )
      expect(opacity).toBe('1')
    }).toPass()
    await page.screenshot({ path: 'test-results/screenshots/custom-dropdown-open.png' })
    await page.locator('select:open option', { hasText: 'Test Supplier' }).click()
    await page.getByLabel('Quality').selectOption({ label: 'CVD ROUND' })
    await page.getByLabel('Carats').fill('50')
    await page.getByLabel('Rate ₹ / ct').fill('4000')
    await page.screenshot({ path: 'test-results/screenshots/side-drawer-purchase.png' })
    await page.getByRole('button', { name: 'Review totals', exact: true }).click()
    await expect(page.getByText('Review calculated totals')).toBeVisible()
    await page.getByRole('button', { name: 'Confirm & post', exact: true }).click()
    await expect(page.locator('.drawer')).toHaveCount(0)
    await expect(page.getByText('PUR/2026-27/0001')).toBeVisible()
    expect(
      await page.getByLabel('Status filter').evaluate((el) => getComputedStyle(el).appearance),
    ).toBe('base-select')

    // 6. Sale via Side Drawer (with Brokerage + Adjustment)
    await page.getByRole('button', { name: 'Sale', exact: true }).click()
    await page.getByRole('button', { name: 'Add sale', exact: true }).click()
    const saleDrawer = page.locator('.drawer')
    await expect(saleDrawer).toBeVisible()
    await expect(async () => {
      const box = await saleDrawer.boundingBox()
      const viewport = page.viewportSize()
      expect(box).not.toBeNull()
      if (box && viewport) {
        expect(Math.abs(box.x + box.width - viewport.width)).toBeLessThanOrEqual(2)
      }
    }).toPass()
    await page.getByLabel('Invoice date').fill('2026-11-10')
    await page.getByLabel('Customer').selectOption({ label: 'Test Customer' })
    await page.getByLabel('Quality').selectOption({ label: 'CVD ROUND' })
    await page.getByLabel('Carats').fill('10')
    await page.getByLabel('Rate ₹ / ct').fill('6000')
    await page.screenshot({ path: 'test-results/screenshots/side-drawer-sale.png' })
    await page.getByRole('button', { name: 'Review totals', exact: true }).click()
    await expect(page.getByText('Review calculated totals')).toBeVisible()
    await page.getByRole('button', { name: 'Confirm & post', exact: true }).click()
    await expect(page.locator('.drawer')).toHaveCount(0)
    await expect(page.getByText('SAL/2026-27/0001')).toBeVisible()

    // 7. Edit & Cancel Sale via Side Drawer + ConfirmDialog (verifies no window.prompt failure!)
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
    await expect(page.locator('.drawer')).toBeVisible()
    await page.getByLabel('Reason for edit').fill('Update remarks')
    await page.getByLabel('Remarks').fill('Edited remark')
    await page.getByRole('button', { name: 'Review totals', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm & post', exact: true }).click()
    await expect(page.locator('.drawer')).toHaveCount(0)

    await page.getByRole('button', { name: 'Cancel', exact: true }).first().click()
    await expect(page.locator('.confirm-dialog')).toBeVisible()
    await page.getByLabel('Reason for cancellation').fill('Test cancellation flow')
    await page.getByRole('button', { name: 'Cancel document', exact: true }).click()
    await expect(page.locator('.confirm-dialog')).toHaveCount(0)
    await expect(page.locator('.status.cancelled')).toBeVisible()

    // Re-post Sale for Dashboard & Reports checks
    await page.getByRole('button', { name: 'Add sale', exact: true }).click()
    await page.getByLabel('Invoice date').fill('2026-11-10')
    await page.getByLabel('Customer').selectOption({ label: 'Test Customer' })
    await page.getByLabel('Quality').selectOption({ label: 'CVD ROUND' })
    await page.getByLabel('Carats').fill('10')
    await page.getByLabel('Rate ₹ / ct').fill('6000')
    await page.getByRole('button', { name: 'Review totals', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm & post', exact: true }).click()

    // 8. Payment via Side Drawer & Negative Funds ConfirmDialog test
    await page.getByRole('button', { name: 'Payments', exact: true }).click()
    await page.getByRole('button', { name: 'Add payment', exact: true }).click()
    await expect(page.locator('.drawer')).toBeVisible()
    await page.locator('.drawer').getByLabel('Payment date').fill('2026-11-12')
    await page
      .locator('.drawer')
      .getByLabel('Party', { exact: true })
      .selectOption({ label: 'Test Supplier' })
    await page
      .locator('.drawer')
      .getByLabel('Cash / bank account')
      .selectOption({ label: 'HDFC Trading Bank' })
    await page.locator('.drawer').getByLabel('Amount ₹').fill('10000')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.locator('.confirm-dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Confirm & post anyway', exact: true }).click()
    await expect(page.locator('.confirm-dialog')).toHaveCount(0)
    await expect(page.locator('.drawer')).toHaveCount(0)
    await expect(page.getByText('PAY/2026-27/0001')).toBeVisible()

    // 9. Loan & Settle via Side Drawer + Reverse settlement via ConfirmDialog
    await page.getByRole('button', { name: 'Loans', exact: true }).click()
    await page.getByRole('button', { name: 'Add loan', exact: true }).click()
    await page
      .locator('.drawer')
      .getByLabel('Party', { exact: true })
      .selectOption({ label: 'Test Supplier' })
    await page.locator('.drawer').getByLabel('Principal ₹').fill('100000')
    await page.locator('.drawer').getByLabel('Interest rate %').fill('1')
    await page.locator('.drawer').getByLabel('Loan date').fill('2026-11-01')
    await page
      .locator('.drawer')
      .getByLabel('Cash / bank account')
      .selectOption({ label: 'Cash in Hand' })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('LT/2026-27/0001')).toBeVisible()

    await page.getByRole('button', { name: 'Settle / interest', exact: true }).click()
    await page.locator('.drawer').getByLabel('Payment / settlement date').fill('2026-12-01')
    await page
      .locator('.drawer')
      .getByLabel('Cash / bank account')
      .selectOption({ label: 'Cash in Hand' })
    await page.locator('.drawer').getByLabel('Interest payment ₹').fill('1000')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.locator('.status.closed')).toBeVisible()

    await page.getByRole('button', { name: 'Reverse settlement', exact: true }).click()
    await expect(page.locator('.confirm-dialog')).toBeVisible()
    await page.getByLabel('Reason for reversal').fill('Test reverse settlement')
    await page
      .locator('.confirm-dialog')
      .getByRole('button', { name: 'Reverse settlement', exact: true })
      .click()
    await expect(page.locator('.status.open')).toBeVisible()

    // Check Party Profile Side Drawer & Sale View Detail Side Drawer
    await page.getByRole('button', { name: 'Parties Master', exact: true }).click()
    await page.getByRole('button', { name: 'Profile', exact: true }).first().click()
    await expect(page.locator('.drawer')).toBeVisible()
    await page.getByRole('button', { name: 'Close drawer' }).click()

    await page.getByRole('button', { name: 'Sale', exact: true }).click()
    await page.getByRole('button', { name: 'View', exact: true }).first().click()
    await expect(page.locator('.drawer')).toBeVisible()
    await page.getByRole('button', { name: 'Close drawer' }).click()

    // 10. Verify date filters and all 18 destinations cleanly
    await page.getByRole('button', { name: 'This FY', exact: true }).click()
    await page.getByLabel('Through date').fill('2026-11-26')

    for (const name of [
      'Dashboard',
      'Parties Master',
      'Quality Master',
      'Bank Accounts',
      'Stock Inventory',
      'Purchase',
      'Sale',
      'Loans',
      'Payments',
      'Cash & Bank',
      'Journal Voucher',
      'Party Ledger',
      'Balance Sheet',
      'Profit & Loss',
      'Day Book',
      'Manage Companies',
      'Settings',
      'Backup & Restore',
    ]) {
      await page.getByRole('button', { name, exact: true }).click()
      await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible()
      await expect(page.locator('.error.banner')).toHaveCount(0)
      if (['Dashboard', 'Purchase', 'Balance Sheet'].includes(name)) {
        await page.screenshot({
          path: `test-results/screenshots/${name.replaceAll(' ', '-')}.png`,
          fullPage: true,
        })
      }
    }

    // 11. Change username & password from Settings and verify login with new credentials
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByText('Signed in as admin@gmail.com')).toBeVisible()

    await page.getByRole('button', { name: 'Change username', exact: true }).click()
    await expect(page.locator('.drawer')).toBeVisible()
    await page.getByLabel('New username').fill('arya_admin')
    await page.getByLabel('Current password').fill('Admin@123')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.locator('.drawer')).toHaveCount(0)
    await expect(page.getByText('Signed in as arya_admin')).toBeVisible()

    await page.getByRole('button', { name: 'Change password', exact: true }).click()
    await expect(page.locator('.drawer')).toBeVisible()
    await page.getByLabel('Current password').fill('Admin@123')
    await page.getByLabel('New password').fill('pass12')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.locator('.drawer')).toHaveCount(0)

    await page.getByRole('button', { name: 'Administrator · Sign out', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    await page.getByLabel('Username').fill('arya_admin')
    await page.getByLabel('Password', { exact: true }).fill('pass12')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
    await page.getByLabel('Active company').selectOption({ label: 'Parth Diamond Trading' })
    await expect(page.getByText('Actual net profit')).toBeVisible()

    // Set Parth Diamond Trading as default company in Manage Companies and confirm it auto-opens on next login
    await page.getByRole('button', { name: 'Manage Companies', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Set as default', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Set as default', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Default ✓', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Administrator · Sign out', exact: true }).click()
    await page.getByLabel('Username').fill('arya_admin')
    await page.getByLabel('Password', { exact: true }).fill('pass12')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
    await expect(page.getByText('Actual net profit')).toBeVisible()

    // 12. Offline Forgot Password flows: Channel B (Device PIN) & Channel A (Recovery Code) + Rotate Key
    await page.getByRole('button', { name: 'Administrator · Sign out', exact: true }).click()
    await page.getByRole('button', { name: 'Forgot password?', exact: true }).click()
    await expect(page.locator('.drawer')).toBeVisible()
    await expect(page.getByText('PIN attempts remaining: 5')).toBeVisible()

    // Wrong PIN decrements counter
    await page.getByLabel('Recovery username').fill('arya_admin')
    await page.getByLabel('6-digit Device PIN').fill('000000')
    await page.getByLabel('Recovery new password').fill('ResetPin1!')
    await page.getByLabel('Repeat new password').fill('ResetPin1!')
    await page.getByRole('button', { name: 'Reset password', exact: true }).click()
    await expect(page.getByText('PIN attempts remaining: 4')).toBeVisible()

    // Correct PIN resets password and restores 5 attempts
    await page.getByLabel('6-digit Device PIN').fill('654321')
    await page.getByRole('button', { name: 'Reset password', exact: true }).click()
    await expect(page.locator('.drawer')).toHaveCount(0)
    await expect(page.getByText('Password reset. Sign in with your new password.')).toBeVisible()

    // Sign in with PIN-reset password, sign out, and reset again via Recovery Code (Channel A)
    await page.getByLabel('Username').fill('arya_admin')
    await page.getByLabel('Password', { exact: true }).fill('ResetPin1!')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('button', { name: 'Administrator · Sign out', exact: true }).click()

    await page.getByRole('button', { name: 'Forgot password?', exact: true }).click()
    await expect(page.getByText('PIN attempts remaining: 5')).toBeVisible()
    await page.getByRole('button', { name: 'Use recovery code', exact: true }).click()
    await page.getByLabel('Recovery username').fill('arya_admin')
    await page.getByLabel('Recovery code').fill(`  ${initialKey.toUpperCase()} \n `)
    await page.getByLabel('Recovery new password').fill('ResetCode1!')
    await page.getByLabel('Repeat new password').fill('ResetCode1!')
    await page.getByRole('button', { name: 'Reset password', exact: true }).click()
    await expect(page.locator('.drawer')).toHaveCount(0)

    // Sign in, rotate recovery key in Settings -> hidden PDF updates -> Device PIN still works!
    await page.getByLabel('Username').fill('arya_admin')
    await page.getByLabel('Password', { exact: true }).fill('ResetCode1!')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Generate / rotate recovery code', exact: true }).click()
    await page.locator('.drawer').getByLabel('Current password').fill('ResetCode1!')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const rotatedKey = (await page.locator('.recovery-key-box code').innerText()).trim()
    expect(rotatedKey).not.toBe(initialKey)
    const hiddenAfter = readdirSync(dir).filter((n) => /^\.diamo-recovery-.*\.pdf$/.test(n))
    expect(hiddenAfter).toHaveLength(1)
    expect(hiddenAfter[0]).not.toBe(hiddenBefore[0])
    await page.getByRole('button', { name: 'Done', exact: true }).click()

    // Confirm PIN still works after rotating recovery code
    await page.getByRole('button', { name: 'Administrator · Sign out', exact: true }).click()
    await page.getByRole('button', { name: 'Forgot password?', exact: true }).click()
    await page.getByLabel('Recovery username').fill('arya_admin')
    await page.getByLabel('6-digit Device PIN').fill('654321')
    await page.getByLabel('Recovery new password').fill('FinalPass1!')
    await page.getByLabel('Repeat new password').fill('FinalPass1!')
    await page.getByRole('button', { name: 'Reset password', exact: true }).click()
    await page.getByLabel('Username').fill('arya_admin')
    await page.getByLabel('Password', { exact: true }).fill('FinalPass1!')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()

    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined')
    expect(network).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
