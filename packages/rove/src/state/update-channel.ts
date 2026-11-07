/**
 * state.json `update.channel`: the release channel a bare `rove update`, the
 * update check and Settings follow. Written when the user picks a channel
 * (`rove update --nightly`, Settings); unset = the running build's channel,
 * so an install that never chose keeps behaving as it was installed.
 * `update.notify` (default on) decides whether the update chip shows at all;
 * the explicit "check for updates" always reports.
 */

import { RELEASE_CHANNELS, type ReleaseChannel, channelOf } from "../version.ts"
import { type StateSnapshot, loadStateFile, patchStateFile } from "./store.ts"

export const UPDATE_CHANNEL_KEY = "update.channel"
/** Hand-edited: hours a release must be out before the update chip offers it. */
export const UPDATE_DELAY_KEY = "update.delayHours"
export const UPDATE_NOTIFY_KEY = "update.notify"

export function normalizeReleaseChannel(value: unknown): ReleaseChannel | null {
  return RELEASE_CHANNELS.includes(value as ReleaseChannel) ? (value as ReleaseChannel) : null
}

export function preferredReleaseChannel(state: StateSnapshot = loadStateFile()): ReleaseChannel {
  return normalizeReleaseChannel(state[UPDATE_CHANNEL_KEY]) ?? channelOf()
}

/** The stored `update.notify` value: anything but an explicit `false` reads as on. */
export function updateNotifyEnabled(raw: unknown): boolean {
  return raw !== false
}

export function rememberReleaseChannel(channel: ReleaseChannel): void {
  patchStateFile({ [UPDATE_CHANNEL_KEY]: channel })
}

/** `update.delayHours`; anything but a non-negative finite number reads as no delay. */
export function updateDelayHours(state: StateSnapshot = loadStateFile()): number {
  const value = state[UPDATE_DELAY_KEY]
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}
