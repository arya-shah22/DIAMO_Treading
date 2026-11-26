import * as http from 'node:http'
import * as https from 'node:https'
import type { UpdateInfo } from '../../shared/contracts'

export const GITHUB_OWNER = 'arya-shah22'
export const GITHUB_REPO = 'DIAMO_Treading'
export const DEFAULT_REPO = `${GITHUB_OWNER}/${GITHUB_REPO}`
export const DEFAULT_TIMEOUT_MS = 3500

export interface ReleaseAsset {
  name?: string
  browser_download_url?: string
}

export interface GitHubReleasePayload {
  tag_name?: string
  name?: string | null
  body?: string | null
  published_at?: string | null
  html_url?: string | null
  assets?: ReleaseAsset[]
}

export interface FetchJsonResult {
  statusCode: number
  data?: GitHubReleasePayload
}

export type FetchJsonFn = (url: string, timeoutMs: number) => Promise<FetchJsonResult>

export interface CheckUpdateOptions {
  currentVersion: string
  platform: NodeJS.Platform | string
  arch: string
  repo?: string
  timeoutMs?: number
  fetchJson?: FetchJsonFn
  apiUrlOverride?: string
}

/** Parse a SemVer/numeric dot tag (stripping leading `v`/`V` and pre-release `-suffix`). */
export function parseSemver(version: string): number[] {
  const cleaned = String(version ?? '')
    .trim()
    .replace(/^[vV]/, '')
    .split('-')[0]
    .trim()
  if (!cleaned) return []
  const parts = cleaned.split('.')
  const numbers: number[] = []
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return []
    numbers.push(Number(part))
  }
  return numbers
}

/** Compare two version strings numerically; returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal. */
export function compareVersions(v1: string, v2: string): number {
  const a = parseSemver(v1)
  const b = parseSemver(v2)
  if (!a.length && !b.length) return 0
  if (!a.length) return -1
  if (!b.length) return 1
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left > right) return 1
    if (left < right) return -1
  }
  return 0
}

/** Verify that an external URL is strictly HTTPS targeting our GitHub repo or release asset CDN. */
export function isTrustedExternalUrl(urlString: unknown, repo = DEFAULT_REPO): boolean {
  if (typeof urlString !== 'string' || !urlString.trim()) return false
  let parsed: URL
  try {
    parsed = new URL(urlString.trim())
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  if (host === 'github.com') {
    const expectedPrefix = `/${repo.toLowerCase()}`
    const pathLower = parsed.pathname.toLowerCase()
    return pathLower === expectedPrefix || pathLower.startsWith(`${expectedPrefix}/`)
  }
  return host === 'objects.githubusercontent.com' || host === 'release-assets.githubusercontent.com'
}

/** Select the best platform installer asset URL while skipping blockmaps and uninstallers. */
export function findPlatformAsset(
  assets: ReleaseAsset[] | undefined,
  platform: string,
  arch: string,
): string | null {
  if (!Array.isArray(assets) || !assets.length) return null
  const ext = platform === 'darwin' ? '.dmg' : platform === 'win32' ? '.exe' : null
  if (!ext) return null
  const archToken = String(arch ?? '').toLowerCase()

  const candidates = assets.filter((asset) => {
    const name = typeof asset?.name === 'string' ? asset.name.toLowerCase() : ''
    const url = typeof asset?.browser_download_url === 'string' ? asset.browser_download_url : ''
    if (!name || !url) return false
    if (name.endsWith('.blockmap') || name.includes('__uninstaller')) return false
    return name.endsWith(ext)
  })

  if (!candidates.length) return null
  const archMatch = archToken
    ? candidates.find((asset) => asset.name!.toLowerCase().includes(archToken))
    : undefined
  return (archMatch ?? candidates[0]).browser_download_url ?? null
}

function defaultFetchJson(userAgent: string): FetchJsonFn {
  return (urlString: string, timeoutMs: number) =>
    new Promise<FetchJsonResult>((resolve, reject) => {
      let target: URL
      try {
        target = new URL(urlString)
      } catch {
        reject(new Error('Invalid update URL'))
        return
      }
      const isLoopbackHttp =
        target.protocol === 'http:' &&
        (target.hostname === '127.0.0.1' || target.hostname === 'localhost')
      if (target.protocol !== 'https:' && !isLoopbackHttp) {
        reject(new Error('Blocked insecure update endpoint'))
        return
      }
      const client = target.protocol === 'https:' ? https : http
      const req = client.get(
        target,
        {
          headers: {
            'User-Agent': userAgent,
            Accept: 'application/vnd.github.v3+json',
          },
        },
        (res) => {
          const statusCode = res.statusCode ?? 0
          let raw = ''
          res.setEncoding('utf8')
          res.on('data', (chunk) => {
            raw += chunk
            if (raw.length > 2 * 1024 * 1024) {
              req.destroy(new Error('Response too large'))
            }
          })
          res.on('end', () => {
            if (statusCode === 404) {
              resolve({ statusCode })
              return
            }
            if (statusCode !== 200) {
              resolve({ statusCode })
              return
            }
            try {
              resolve({ statusCode, data: JSON.parse(raw) as GitHubReleasePayload })
            } catch {
              reject(new Error('Invalid JSON response from GitHub'))
            }
          })
        },
      )
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('Update check timed out'))
      })
      req.on('error', (err) => reject(err))
    })
}

/** Check GitHub latest release offline-safely and return structured update status. */
export async function checkUpdate(options: CheckUpdateOptions): Promise<UpdateInfo> {
  const repo = options.repo ?? DEFAULT_REPO
  const releaseUrl = `https://github.com/${repo}/releases`
  const apiUrl = options.apiUrlOverride || `https://api.github.com/repos/${repo}/releases/latest`
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetcher = options.fetchJson ?? defaultFetchJson(`DIAMO_TREADING/${options.currentVersion}`)

  try {
    const response = await fetcher(apiUrl, timeoutMs)
    if (response.statusCode === 404) {
      return {
        status: 'unavailable',
        currentVersion: options.currentVersion,
        updateAvailable: false,
        message: 'No public releases found or repository is currently private.',
        releaseUrl,
      }
    }
    if (response.statusCode !== 200 || !response.data) {
      return {
        status: 'offline',
        currentVersion: options.currentVersion,
        updateAvailable: false,
        message: 'Could not reach GitHub. Please check your internet connection.',
        releaseUrl,
      }
    }

    const latestTag =
      typeof response.data.tag_name === 'string' ? response.data.tag_name.trim() : ''
    if (!latestTag) {
      return {
        status: 'unavailable',
        currentVersion: options.currentVersion,
        updateAvailable: false,
        message: 'No public releases found or repository is currently private.',
        releaseUrl,
      }
    }

    const pageUrl = isTrustedExternalUrl(response.data.html_url, repo)
      ? response.data.html_url!.trim()
      : releaseUrl
    const assetUrl = findPlatformAsset(response.data.assets, options.platform, options.arch)
    const safeDownloadUrl = assetUrl && isTrustedExternalUrl(assetUrl, repo) ? assetUrl : pageUrl

    return {
      status: 'success',
      currentVersion: options.currentVersion,
      latestVersion: latestTag,
      updateAvailable: compareVersions(latestTag, options.currentVersion) > 0,
      releaseName:
        typeof response.data.name === 'string' && response.data.name.trim()
          ? response.data.name.trim()
          : latestTag,
      releaseNotes: typeof response.data.body === 'string' ? response.data.body : '',
      publishedAt: typeof response.data.published_at === 'string' ? response.data.published_at : '',
      downloadUrl: safeDownloadUrl,
      releaseUrl: pageUrl,
    }
  } catch {
    return {
      status: 'offline',
      currentVersion: options.currentVersion,
      updateAvailable: false,
      message: 'Could not reach GitHub. Please check your internet connection.',
      releaseUrl,
    }
  }
}
