/**
 * How a running tab's title looks in the sidebar: `shimmer` sweeps a light
 * band across it while its engine works; `still` keeps the plain muted label.
 */

export const RUNNING_TITLE_KEY = "appearance.runningTitle"

export const RUNNING_TITLES = ["shimmer", "still"] as const
export type RunningTitle = (typeof RUNNING_TITLES)[number]

export const DEFAULT_RUNNING_TITLE: RunningTitle = "shimmer"

/** Coerce a persisted value; anything unrecognized → the default. */
export function normalizeRunningTitle(raw: unknown): RunningTitle {
  return RUNNING_TITLES.includes(raw as RunningTitle) ? (raw as RunningTitle) : DEFAULT_RUNNING_TITLE
}
