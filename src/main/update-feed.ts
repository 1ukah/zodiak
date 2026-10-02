import { net } from 'electron'
import type { UpdateChannel } from '../shared/types'
import { isRecord } from './parse'

const owner = '1ukah'
const repo = 'zodiak'

/** Beta must stay on beta builds, even when a newer stable release exists. */
export async function getUpdateFeed(channel: UpdateChannel) {
  if (channel === 'stable') return { provider: 'github' as const, owner, repo }

  // The built-in GitHub beta channel also accepts stable releases. Resolve a
  // beta tag explicitly, then let electron-updater verify/download its assets.
  for (let page = 1; page <= 10; page++) {
    const response = await net.fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`GitHub could not list Beta releases (HTTP ${response.status}). Try again later.`)
    const releases: unknown = await response.json()
    if (!Array.isArray(releases)) throw new Error('GitHub returned an invalid release list.')
    for (const release of releases) {
      if (!isRecord(release) || release.draft || release.prerelease !== true || typeof release.tag_name !== 'string') continue
      if (!/^v?\d+\.\d+\.\d+-beta(?:\.\d+)*$/.test(release.tag_name)) continue
      const assets = Array.isArray(release.assets) ? release.assets : []
      if (!assets.some(asset => isRecord(asset) && asset.name === 'beta.yml')) {
        throw new Error('The latest Beta release is missing its update manifest. Try again after it finishes publishing.')
      }
      return {
        provider: 'generic' as const,
        url: `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(release.tag_name)}/`,
        channel: 'beta',
        useMultipleRangeRequest: false,
      }
    }
    if (releases.length < 100) break
  }
  throw new Error('No Beta release is published yet. Choose Stable or try again later.')
}
