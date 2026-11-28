/**
 * Release channels and the version tail that names one — the browser-safe half
 * of `version.ts`, which also reads package.json, the filesystem and env.
 * `rove-web`'s Settings picker and the update view import from here.
 */

/**
 * npm dist-tag an install follows: `latest` is stable (cut by hand), `next` is
 * every push to `main` (`.github/workflows/next.yml`), `nightly` the daily cut
 * (`.github/workflows/nightly.yml`).
 */
export type ReleaseChannel = "latest" | "next" | "nightly"

export const RELEASE_CHANNELS: readonly ReleaseChannel[] = ["latest", "next", "nightly"]

export const DEFAULT_RELEASE_CHANNEL: ReleaseChannel = "latest"

/** The channel a version string names, by its prerelease tail (`0.9.1-next.3` → `next`). */
export function channelFor(version: string): ReleaseChannel {
  const dash = version.indexOf("-")
  const tag = dash === -1 ? undefined : version.slice(dash + 1).split(".")[0]
  return tag === "nightly" || tag === "next" ? tag : DEFAULT_RELEASE_CHANNEL
}
