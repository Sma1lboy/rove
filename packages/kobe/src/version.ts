/**
 * Version check — compares the running build's version against the
 * latest published on the npm registry.
 *
 * Design notes:
 *
 *   - Current version is imported from `package.json` directly (Bun and
 *     TS 5+ both honour the `with { type: "json" }` import attribute).
 *     Single source of truth — bump in package.json, no string sync.
 *
 *   - "Latest" comes from `https://registry.npmjs.org/<name>/latest`.
 *     This endpoint returns *only* the latest dist-tag's manifest, which
 *     is much smaller than the full package metadata. Anonymous, no
 *     auth, generous rate limit.
 *
 *   - The TUI checks the registry on every launch, uncached (a cache
 *     makes the topbar miss freshly published versions).
 *     The request is still async and capped at 3s, so startup does not
 *     wait for npm.
 *
 *   - All failure paths return `null`. Offline, network error, registry
 *     500, parse error — none of them should crash the TUI or surface
 *     a scary banner. Worst case: no update notification this session.
 *
 *   - Update behaviour is *informational only* — see the user request:
 *     "如果有新版本提示更新 暂时不提供更新api". We render a chip; the
 *     user runs the install command themselves.
 */

import { fileURLToPath } from "node:url"
import pkg from "../package.json" with { type: "json" }
import { isDev } from "./env.ts"

/** Current build's version, read from package.json at compile time. */
export const CURRENT_VERSION: string = pkg.version

/** npm package name we resolve "latest" against. */
export const PACKAGE_NAME: string = pkg.name

/**
 * `owner/repo` slug derived from `package.json#repository.url`. Used to
 * hit the GitHub releases API for changelog fetching. Returns null when
 * the URL doesn't look like a github.com repo (e.g. when running from
 * a fork or when someone deletes the field).
 */
export function repoSlug(): string | null {
  const url = (pkg.repository as { url?: string } | undefined)?.url
  if (!url) return null
  // Accept any of: git+https://github.com/owner/repo.git, git@github.com:owner/repo.git,
  // https://github.com/owner/repo, etc.
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
  if (!m || !m[1] || !m[2]) return null
  return `${m[1]}/${m[2]}`
}

/** Remote update script URL. Kept on GitHub so install flow changes don't require a binary release. */
export const UPDATE_SCRIPT_URL = "https://raw.githubusercontent.com/Sma1lboy/rove/main/scripts/update.sh"

/** Standard update command shown in the update dialog. */
export const UPDATE_COMMAND = `curl -fsSL ${UPDATE_SCRIPT_URL} | sh`

/**
 * The npm prefix that owns this running build, derived from where this
 * module actually lives: `<prefix>/lib/node_modules/<pkg>/…`. Returns null
 * for a bun install, a dev checkout, or any layout that isn't npm-global.
 *
 * Exported for the test; callers want {@link recommendedGlobalInstallCommand}.
 */
export function owningNpmPrefix(modulePath: string = fileURLToPath(import.meta.url)): string | null {
  const marker = "/lib/node_modules/"
  const at = modulePath.indexOf(marker)
  if (at <= 0) return null
  return modulePath.slice(0, at)
}

/**
 * Portable manual fallback when the self-update helper is unavailable.
 *
 * A bare `npm install -g` writes to the prefix of whichever node runs npm,
 * which on a machine with several node installs (nvm + homebrew, say) is
 * not necessarily the prefix holding the binary the user just ran — so the
 * update lands somewhere PATH never looks and the stale copy keeps running.
 * When we can see which prefix owns this build, pin it explicitly.
 */
export function recommendedGlobalInstallCommand(prefix = owningNpmPrefix()): string {
  const target = `${PACKAGE_NAME}@latest`
  return prefix === null ? `npm install -g ${target}` : `npm install -g --prefix ${prefix} ${target}`
}

/**
 * Versions that ship a breaking state/daemon change: moving an install
 * ACROSS one of these (either direction) requires `kobe reset` before the
 * app starts again. Maintained by hand at release time — see
 * docs/RELEASING.md §"Breaking releases". The boot gate
 * (src/cli/reset-gate.ts) and `kobe update`'s pre-install warning both
 * read this list.
 */
export const BREAKING_VERSIONS: readonly string[] = []

/**
 * The breaking versions crossed when moving an install `from` → `to`.
 * Direction-agnostic (a downgrade back across a breaking version is just
 * as incompatible): a version B is crossed when min(from,to) < B ≤
 * max(from,to). Same-version moves cross nothing.
 */
export function breakingVersionsCrossed(
  from: string,
  to: string,
  breaking: readonly string[] = BREAKING_VERSIONS,
): string[] {
  const [lo, hi] = compareSemver(from, to) <= 0 ? [from, to] : [to, from]
  return breaking.filter((b) => compareSemver(b, lo) > 0 && compareSemver(b, hi) <= 0)
}

/** Network timeout for the registry call. */
const FETCH_TIMEOUT_MS = 3_000

/**
 * Which published line an install follows. These are npm dist-tag names —
 * `latest` is the stable release line, `nightly` is the automated cut from
 * `main` (see `.github/workflows/nightly.yml`).
 */
export type ReleaseChannel = "latest" | "nightly"

export const RELEASE_CHANNELS: readonly ReleaseChannel[] = ["latest", "nightly"]

export const DEFAULT_RELEASE_CHANNEL: ReleaseChannel = "latest"

/**
 * The channel an install is ON, derived from the version it is RUNNING.
 * There is no stored preference to drift out of sync with reality: a
 * nightly build carries a `-nightly.*` tail, so it checks `nightly`, and
 * `rove update` (no args) reinstalls from whichever channel it names.
 * Switching channels IS installing from the other one.
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
    // Encode the scope's "/" — registry expects %2F in the path segment.
    // The segment AFTER the name is an npm dist-tag, so one endpoint
    // serves every channel: `/latest` and `/nightly` alike.
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
 * Compare two versions the way an UPDATE CHECK must: `x.y.z` first, then
 * the `-prerelease` tail. Returns true when `latest` outranks `current`.
 *
 * The tail is what makes the nightly channel work at all. Two nightlies
 * share an `x.y.z` core (`0.9.13-nightly.20260830` vs `…20260831`), so
 * comparing cores alone reports "no update" forever and every nightly user
 * silently stays on whatever build they first installed.
 *
 * Deliberately NOT the same function as {@link compareSemver}: the reset
 * gate needs the opposite treatment — see that function's note.
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

/**
 * Order the `-prerelease` tails of two versions with equal `x.y.z` cores,
 * per semver §11: a version WITHOUT a tail outranks the same version with
 * one, and otherwise identifiers compare field by field — numeric ones
 * numerically, the rest as strings.
 */
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
    // Numeric identifiers compare numerically and sort below alphanumeric
    // ones; a mixed pair falls back to that rule.
    if (an !== null && bn !== null) return an > bn ? 1 : -1
    if (an !== null) return -1
    if (bn !== null) return 1
    return av > bv ? 1 : -1
  }
  return 0
}

/**
 * Compare the `x.y.z` cores only — `-rc.1` and friends are stripped.
 *
 * The reset gate (`cli/reset-gate.ts`) depends on this: a nightly cut from
 * a main that already carries a breaking change must count as HAVING
 * crossed it, so `0.9.13-nightly.x` has to read as `0.9.13`. Ordering the
 * tail here instead would sort the nightly BELOW the release and move the
 * `rove reset` demand one release later — i.e. the user runs the breaking
 * nightly ungated, which is the one thing that gate exists to prevent.
 * Update checks want the opposite; they call {@link isNewerSemver}.
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
 * Resolve the latest published version from the npm registry.
 *
 * Returns null on any failure (offline, slow network, parse error) so
 * callers can treat "no info" and "no update" as the same UI state.
 *
 * @param opts.force — bypass dev-mode suppression. Useful for an explicit
 *                     "check for updates" command once we wire one up.
 * @param opts.channel — which dist-tag to resolve against. Defaults to the
 *                     channel the RUNNING build belongs to, so a nightly
 *                     install compares itself against nightlies and a
 *                     stable one against stable.
 */
export async function checkLatestVersion(
  opts: { force?: boolean; channel?: ReleaseChannel } = {},
): Promise<UpdateInfo | null> {
  const channel = opts.channel ?? channelOf()
  // Debug hook: `KOBE_FAKE_UPDATE=<version>` returns a synthetic UpdateInfo
  // (bypassing dev suppression AND the network) so the "update available"
  // UI — the brand-header chip, the update page — can be exercised in the
  // sandbox. e.g. `KOBE_FAKE_UPDATE=99.0.0 bun run dev:sandbox`. Compared via
  // semver so a lower fake version still reads as "no update".
  const fake = process.env.KOBE_FAKE_UPDATE
  if (fake) {
    return { current: CURRENT_VERSION, latest: fake, hasUpdate: isNewerSemver(fake, CURRENT_VERSION), channel }
  }

  // Dev runs (KOBE_DEV=1, set by `bun run dev`) suppress the check
  // entirely — devs are usually working from a `package.json` that's
  // a few patches behind the published `latest` and don't need the
  // chip nagging them. `force: true` overrides so a manual "check
  // for updates" command still works in dev if we ever wire one up.
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

/* ------------------------------------------------------------------- */
/*  Release notes — for the update dialog's "what's new" section        */
/* ------------------------------------------------------------------- */

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
 * Pull the GitHub release body for `vX.Y.Z`. Anonymous request to the
 * REST API — rate limit is 60/hr/IP for unauthenticated traffic, well
 * inside what one user opening one dialog will spend. We don't cache
 * because the dialog is opened on demand (not on every launch); a
 * second open within seconds will just re-hit the API which is fine.
 *
 * Returns null on any failure so the caller can fall back to a "see
 * the release page" link without surfacing an error banner.
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

/**
 * Fetch release notes for every published version newer than `current`
 * through `latest`, newest first. This powers the update page's from→to
 * changelog; a user several versions behind should see every skipped
 * release, not just the latest one.
 */
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

/**
 * Fetch recent GitHub releases for the version picker in the release
 * dialog. The release body is intentionally omitted; selecting a row
 * still goes through {@link fetchReleaseNotes} so one dialog open does
 * not spend API budget downloading every changelog body.
 */
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
