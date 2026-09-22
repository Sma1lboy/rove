/**
 * Version check against the npm registry.
 *
 * - "Latest" is `registry.npmjs.org/<name>/<dist-tag>`: only that tag's
 *   manifest, far smaller than full metadata; anonymous.
 * - Checked on every launch, uncached (a cache misses freshly published
 *   versions); async and capped at 3s so startup never waits on npm.
 * - Every failure returns `null`: worst case is no update chip this session.
 * - Informational only: we render a chip, the user runs the install command.
 */

import { fileURLToPath } from "node:url"
import pkg from "../package.json" with { type: "json" }
import { isDev } from "./env.ts"

/** Current build's version, read from package.json at compile time. */
export const CURRENT_VERSION: string = pkg.version

/** npm package name we resolve "latest" against. */
export const PACKAGE_NAME: string = pkg.name

/** `owner/repo` from `package.json#repository.url` for the GitHub releases API; null if not github.com. */
export function repoSlug(): string | null {
  const url = (pkg.repository as { url?: string } | undefined)?.url
  if (!url) return null
  // git+https://github.com/o/r.git, git@github.com:o/r.git, https://github.com/o/r
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
  if (!m || !m[1] || !m[2]) return null
  return `${m[1]}/${m[2]}`
}

/** Remote update script URL. Kept on GitHub so install flow changes don't require a binary release. */
export const UPDATE_SCRIPT_URL = "https://raw.githubusercontent.com/Sma1lboy/rove/main/scripts/update.sh"

/** Standard update command shown in the update dialog. */
export const UPDATE_COMMAND = `curl -fsSL ${UPDATE_SCRIPT_URL} | sh`

/**
 * npm prefix owning this build, from `<prefix>/lib/node_modules/<pkg>/…`; null
 * for bun installs, dev checkouts, or any non-npm-global layout.
 */
export function owningNpmPrefix(modulePath: string = fileURLToPath(import.meta.url)): string | null {
  const marker = "/lib/node_modules/"
  const at = modulePath.indexOf(marker)
  if (at <= 0) return null
  return modulePath.slice(0, at)
}

/**
 * Manual fallback when the self-update helper is unavailable. Pins `--prefix`
 * when known: a bare `npm install -g` writes to whichever node runs npm, which
 * with several installs (nvm + homebrew) may not be the one on PATH, leaving
 * the stale copy running.
 */
export function recommendedGlobalInstallCommand(prefix = owningNpmPrefix()): string {
  const target = `${PACKAGE_NAME}@latest`
  return prefix === null ? `npm install -g ${target}` : `npm install -g --prefix ${prefix} ${target}`
}

/**
 * Versions with a breaking state/daemon change: crossing one (either
 * direction) requires `reset` before the app starts. Hand-maintained, see
 * docs/RELEASING.md §"Breaking releases". Read by src/cli/reset-gate.ts and
 * `update`'s pre-install warning.
 */
export const BREAKING_VERSIONS: readonly string[] = []

/** Direction-agnostic (downgrades are as incompatible): B is crossed when min(from,to) < B ≤ max(from,to). */
export function breakingVersionsCrossed(
  from: string,
  to: string,
  breaking: readonly string[] = BREAKING_VERSIONS,
): string[] {
  const [lo, hi] = compareSemver(from, to) <= 0 ? [from, to] : [to, from]
  return breaking.filter((b) => compareSemver(b, lo) > 0 && compareSemver(b, hi) <= 0)
}

const FETCH_TIMEOUT_MS = 3_000

/** npm dist-tag an install follows; `nightly` is the automated cut from `main` (`.github/workflows/nightly.yml`). */
export type ReleaseChannel = "latest" | "nightly"

export const RELEASE_CHANNELS: readonly ReleaseChannel[] = ["latest", "nightly"]

export const DEFAULT_RELEASE_CHANNEL: ReleaseChannel = "latest"

/**
 * Channel derived from the RUNNING version (`-nightly.*` tail → nightly), so
 * no stored preference can drift. Switching channels IS installing from the other.
 */
export function channelOf(version: string = CURRENT_VERSION): ReleaseChannel {
  const pre = prereleaseOf(version)
  return pre?.split(".")[0] === "nightly" ? "nightly" : DEFAULT_RELEASE_CHANNEL
}

export type UpdateInfo = {
  current: string
  latest: string
  hasUpdate: boolean
  /** The channel `latest` was resolved from — what the UI should name. */
  channel: ReleaseChannel
}

async function fetchLatestFromRegistry(packageName: string, channel: ReleaseChannel): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    // Registry expects the scope's "/" as %2F; the next segment is the dist-tag.
    const encoded = packageName.replace("/", "%2F")
    const res = await fetch(`https://registry.npmjs.org/${encoded}/${channel}`, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { version?: unknown }
    if (typeof body.version !== "string") return null
    return body.version
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Update-check ordering: `x.y.z`, then the `-prerelease` tail. The tail is
 * required because nightlies share a core (`0.9.13-nightly.20260830` vs
 * `…31`); cores alone never report an update. Deliberately not
 * {@link compareSemver}, which the reset gate needs tail-blind.
 */
export function isNewerSemver(latest: string, current: string): boolean {
  const core = compareSemver(latest, current)
  if (core !== 0) return core > 0
  return comparePrerelease(prereleaseOf(latest), prereleaseOf(current)) > 0
}

function prereleaseOf(version: string): string | undefined {
  const dash = version.indexOf("-")
  return dash === -1 ? undefined : version.slice(dash + 1) || undefined
}

/** Semver §11 prerelease ordering for equal cores. */
function comparePrerelease(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0
  // Absent tail = the release itself, which outranks any of its prereleases.
  if (a === undefined) return 1
  if (b === undefined) return -1
  const aParts = a.split(".")
  const bParts = b.split(".")
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const av = aParts[i]
    const bv = bParts[i]
    // A shorter run of identifiers sorts lower when all preceding ones match.
    if (av === undefined) return -1
    if (bv === undefined) return 1
    if (av === bv) continue
    const an = /^\d+$/.test(av) ? Number.parseInt(av, 10) : null
    const bn = /^\d+$/.test(bv) ? Number.parseInt(bv, 10) : null
    // Numeric identifiers compare numerically and sort below alphanumeric ones.
    if (an !== null && bn !== null) return an > bn ? 1 : -1
    if (an !== null) return -1
    if (bn !== null) return 1
    return av > bv ? 1 : -1
  }
  return 0
}

/**
 * Compares `x.y.z` cores only; prerelease tails are stripped. The reset gate
 * (`cli/reset-gate.ts`) needs this: a nightly carrying a breaking change must
 * count as having crossed it, so `0.9.13-nightly.x` reads as `0.9.13`. Ordering
 * the tail would sort it below the release and let the breaking nightly run
 * ungated. Update checks use {@link isNewerSemver}.
 */
export function compareSemver(aVersion: string, bVersion: string): number {
  const norm = (v: string) => v.split("-")[0] ?? v
  const a = norm(aVersion)
    .split(".")
    .map((s) => Number.parseInt(s, 10))
  const b = norm(bVersion)
    .split(".")
    .map((s) => Number.parseInt(s, 10))
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (Number.isNaN(av) || Number.isNaN(bv)) return 0
    if (av > bv) return 1
    if (av < bv) return -1
  }
  return 0
}

/**
 * Latest published version; null on any failure so "no info" and "no update"
 * render the same.
 *
 * @param opts.force — bypass dev-mode suppression.
 * @param opts.channel — dist-tag to check; defaults to the running build's channel.
 */
export async function checkLatestVersion(
  opts: { force?: boolean; channel?: ReleaseChannel } = {},
): Promise<UpdateInfo | null> {
  const channel = opts.channel ?? channelOf()
  // Debug hook, bypasses dev suppression and the network to exercise the update
  // UI: `KOBE_FAKE_UPDATE=99.0.0 bun run dev:sandbox`. A lower fake reads as no update.
  const fake = process.env.KOBE_FAKE_UPDATE
  if (fake) {
    return { current: CURRENT_VERSION, latest: fake, hasUpdate: isNewerSemver(fake, CURRENT_VERSION), channel }
  }

  // Dev runs (KOBE_DEV=1) are usually a few patches behind `latest`; don't nag.
  if (isDev() && !opts.force) return null

  const latest = await fetchLatestFromRegistry(PACKAGE_NAME, channel)
  if (!latest) return null
  return {
    current: CURRENT_VERSION,
    latest,
    hasUpdate: isNewerSemver(latest, CURRENT_VERSION),
    channel,
  }
}

/* Release notes for the update dialog. */

export type ReleaseNotes = {
  /** Plain markdown body — the same content the release workflow writes from CHANGELOG.md. */
  body: string
  /** Browser URL for the release page on GitHub. */
  url: string
  /** Version the notes correspond to (e.g. "0.0.2"). */
  version: string
}

export type ReleaseNotesRangeItem = ReleaseNotes

export type ReleaseSummary = {
  /** Version without the leading `v` tag prefix. */
  version: string
  /** Browser URL for the release page on GitHub. */
  url: string
}

function versionFromTagName(tagName: unknown): string | null {
  if (typeof tagName !== "string") return null
  const match = tagName.match(/^v(\d+\.\d+\.\d+)$/)
  return match?.[1] ?? null
}

/**
 * GitHub release body for `vX.Y.Z`. Anonymous (60/hr/IP) and uncached: the
 * dialog opens on demand, not per launch. Null on failure so the caller falls
 * back to a release-page link.
 */
export async function fetchReleaseNotes(version: string): Promise<ReleaseNotes | null> {
  const slug = repoSlug()
  if (!slug) return null
  const tag = `v${version}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}/releases/tags/${tag}`, {
      signal: ctrl.signal,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { body?: unknown; html_url?: unknown }
    if (typeof body.body !== "string" || typeof body.html_url !== "string") return null
    return { body: body.body, url: body.html_url, version }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Notes for every release in (`current`, `latest`], newest first, so skipped releases show too. */
export async function fetchReleaseNotesRange(args: {
  current: string
  latest: string
  limit?: number
}): Promise<ReleaseNotesRangeItem[]> {
  const slug = repoSlug()
  if (!slug) return []
  const limit = args.limit ?? 100
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}/releases?per_page=${limit}`, {
      signal: ctrl.signal,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    })
    if (!res.ok) return []
    const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown; body?: unknown }[]
    if (!Array.isArray(body)) return []
    return body
      .map((release) => {
        const version = versionFromTagName(release.tag_name)
        if (!version || typeof release.html_url !== "string" || typeof release.body !== "string") return null
        if (compareSemver(version, args.current) <= 0) return null
        if (compareSemver(version, args.latest) > 0) return null
        return { version, url: release.html_url, body: release.body }
      })
      .filter((release): release is ReleaseNotesRangeItem => release !== null)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

/** Recent releases for the version picker; bodies come per row via {@link fetchReleaseNotes} to save API budget. */
export async function fetchReleaseSummaries(limit = 12): Promise<ReleaseSummary[]> {
  const slug = repoSlug()
  if (!slug) return []
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}/releases?per_page=${limit}`, {
      signal: ctrl.signal,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    })
    if (!res.ok) return []
    const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown }[]
    if (!Array.isArray(body)) return []
    return body
      .map((release) => {
        const version = versionFromTagName(release.tag_name)
        if (!version || typeof release.html_url !== "string") return null
        return { version, url: release.html_url }
      })
      .filter((release): release is ReleaseSummary => release !== null)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

/** Fallback URL when fetchReleaseNotes can't reach GitHub. */
export function releasePageUrl(version: string): string | null {
  const slug = repoSlug()
  if (!slug) return null
  return `https://github.com/${slug}/releases/tag/v${version}`
}
