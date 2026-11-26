import { describe, expect, it } from 'vitest'
import {
  checkUpdate,
  compareVersions,
  DEFAULT_REPO,
  findPlatformAsset,
  isTrustedExternalUrl,
  parseSemver,
  type FetchJsonFn,
} from '../src/main/services/updater'

describe('Software updater unit & security checks', () => {
  it('parses and compares 3-part, 4-part, prefixed, pre-release, and empty version strings', () => {
    expect(parseSemver('v1.2.3')).toEqual([1, 2, 3])
    expect(parseSemver('V2.0.1.4-beta.1')).toEqual([2, 0, 1, 4])
    expect(parseSemver('')).toEqual([])
    expect(parseSemver('invalid')).toEqual([])

    expect(compareVersions('1.0.1', '1.0.0')).toBe(1)
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0)
    expect(compareVersions('V1.0.0.1', '1.0.0')).toBe(1)
    expect(compareVersions('1.2.0-rc1', '1.2.0')).toBe(0)
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1)
    expect(compareVersions('', '1.0.0')).toBe(-1)
    expect(compareVersions('', '')).toBe(0)
  })

  it('selects matching platform installer and ignores blockmaps and uninstallers', () => {
    const assets = [
      {
        name: 'DIAMO_TREADING-1.1.0-win-x64__uninstaller.exe',
        browser_download_url:
          'https://github.com/arya-shah22/DIAMO_Treading/releases/download/v1.1.0/uninstaller.exe',
      },
      {
        name: 'DIAMO_TREADING-1.1.0-mac-arm64.dmg.blockmap',
        browser_download_url:
          'https://github.com/arya-shah22/DIAMO_Treading/releases/download/v1.1.0/mac-arm64.dmg.blockmap',
      },
      {
        name: 'DIAMO_TREADING-1.1.0-mac-x64.dmg',
        browser_download_url:
          'https://github.com/arya-shah22/DIAMO_Treading/releases/download/v1.1.0/mac-x64.dmg',
      },
      {
        name: 'DIAMO_TREADING-1.1.0-mac-arm64.dmg',
        browser_download_url:
          'https://github.com/arya-shah22/DIAMO_Treading/releases/download/v1.1.0/mac-arm64.dmg',
      },
      {
        name: 'DIAMO_TREADING-1.1.0-win-x64.exe',
        browser_download_url:
          'https://github.com/arya-shah22/DIAMO_Treading/releases/download/v1.1.0/win-x64.exe',
      },
    ]

    expect(findPlatformAsset(assets, 'darwin', 'arm64')).toContain('mac-arm64.dmg')
    expect(findPlatformAsset(assets, 'darwin', 'x64')).toContain('mac-x64.dmg')
    expect(findPlatformAsset(assets, 'win32', 'x64')).toContain('win-x64.exe')
    expect(
      findPlatformAsset(
        [
          {
            name: 'DIAMO_TREADING-1.1.0.dmg',
            browser_download_url:
              'https://github.com/arya-shah22/DIAMO_Treading/releases/v1.1.0/app.dmg',
          },
        ],
        'darwin',
        'arm64',
      ),
    ).toContain('app.dmg')
    expect(findPlatformAsset(assets.slice(0, 2), 'win32', 'x64')).toBeNull()
    expect(findPlatformAsset(assets, 'linux', 'x64')).toBeNull()
  })

  it('handles update available, up-to-date, HTTP 404 private, HTTP 403 rate limit, missing tag, and offline errors', async () => {
    const releasePayload = {
      tag_name: 'v1.2.0',
      name: 'Release 1.2.0',
      body: '- Bug fixes\n- Faster stock report',
      published_at: '2026-11-26T12:00:00Z',
      html_url: `https://github.com/${DEFAULT_REPO}/releases/tag/v1.2.0`,
      assets: [
        {
          name: 'DIAMO_TREADING-1.2.0-mac-arm64.dmg',
          browser_download_url:
            'https://objects.githubusercontent.com/github-production-release-asset/mac-arm64.dmg',
        },
        {
          name: 'DIAMO_TREADING-1.2.0-win-x64.exe',
          browser_download_url:
            'https://release-assets.githubusercontent.com/github-production-release-asset/win-x64.exe',
        },
      ],
    }

    const okMac = await checkUpdate({
      currentVersion: '1.0.0',
      platform: 'darwin',
      arch: 'arm64',
      fetchJson: async () => ({ statusCode: 200, data: releasePayload }),
    })
    expect(okMac.status).toBe('success')
    if (okMac.status === 'success') {
      expect(okMac.updateAvailable).toBe(true)
      expect(okMac.downloadUrl).toContain('mac-arm64.dmg')
    }

    const okWin = await checkUpdate({
      currentVersion: '1.0.0',
      platform: 'win32',
      arch: 'x64',
      fetchJson: async () => ({ statusCode: 200, data: releasePayload }),
    })
    expect(okWin.status).toBe('success')
    if (okWin.status === 'success') {
      expect(okWin.updateAvailable).toBe(true)
      expect(okWin.downloadUrl).toContain('win-x64.exe')
    }

    const upToDate = await checkUpdate({
      currentVersion: '1.2.0',
      platform: 'darwin',
      arch: 'arm64',
      fetchJson: async () => ({ statusCode: 200, data: releasePayload }),
    })
    expect(upToDate.status).toBe('success')
    expect(upToDate.updateAvailable).toBe(false)

    const notFound = await checkUpdate({
      currentVersion: '1.0.0',
      platform: 'darwin',
      arch: 'arm64',
      fetchJson: async () => ({ statusCode: 404 }),
    })
    expect(notFound).toMatchObject({
      status: 'unavailable',
      updateAvailable: false,
      message: 'No public releases found or repository is currently private.',
    })

    const missingTag = await checkUpdate({
      currentVersion: '1.0.0',
      platform: 'darwin',
      arch: 'arm64',
      fetchJson: async () => ({ statusCode: 200, data: { assets: [] } }),
    })
    expect(missingTag.status).toBe('unavailable')

    const rateLimited = await checkUpdate({
      currentVersion: '1.0.0',
      platform: 'win32',
      arch: 'x64',
      fetchJson: async () => ({ statusCode: 403 }),
    })
    expect(rateLimited).toMatchObject({
      status: 'offline',
      updateAvailable: false,
      message: 'Could not reach GitHub. Please check your internet connection.',
    })

    const networkDown: FetchJsonFn = async () => {
      throw new Error('ENOTFOUND api.github.com')
    }
    const offline = await checkUpdate({
      currentVersion: '1.0.0',
      platform: 'darwin',
      arch: 'arm64',
      fetchJson: networkDown,
    })
    expect(offline.status).toBe('offline')
  })

  it('validates trusted external HTTPS GitHub URLs and rejects all others', () => {
    expect(isTrustedExternalUrl(`https://github.com/${DEFAULT_REPO}/releases`)).toBe(true)
    expect(isTrustedExternalUrl(`https://GITHUB.com/${DEFAULT_REPO}/releases/tag/v1.0.1`)).toBe(
      true,
    )
    expect(isTrustedExternalUrl('https://objects.githubusercontent.com/assets/release.dmg')).toBe(
      true,
    )
    expect(
      isTrustedExternalUrl('https://release-assets.githubusercontent.com/assets/release.exe'),
    ).toBe(true)

    expect(isTrustedExternalUrl(`http://github.com/${DEFAULT_REPO}/releases`)).toBe(false)
    expect(isTrustedExternalUrl('https://github.com/other-user/other-repo')).toBe(false)
    expect(isTrustedExternalUrl(`https://github.com/${DEFAULT_REPO}-evil/releases`)).toBe(false)
    expect(isTrustedExternalUrl('https://evil.example.com/payload.exe')).toBe(false)
    expect(isTrustedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isTrustedExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isTrustedExternalUrl('')).toBe(false)
    expect(isTrustedExternalUrl(null)).toBe(false)
  })
})
