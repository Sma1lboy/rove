/**
 * state.json `update.channel`: the release channel a bare `rove update`, the
 * update check and Settings follow. Written when the user picks a channel
 * (`rove update --nightly`, Settings); unset = the running build's channel,
 * so an install that never chose keeps behaving as it was installed.
 */

import { RELEASE_CHANNELS, type ReleaseChannel, channelOf } from "../version.ts"
import { type StateSnapshot, loadStateFile, patchStateFile } from "./store.ts"

export const UPDATE_CHANNEL_KEY = "update.channel"

export function normalizeReleaseChannel(value: unknown): ReleaseChannel | null {
  return RELEASE_CHANNELS.includes(value as ReleaseChannel) ? (value as ReleaseChannel) : null
}

export function preferredReleaseChannel(state: StateSnapshot = loadStateFile()): ReleaseChannel {
  return normalizeReleaseChannel(state[UPDATE_CHANNEL_KEY]) ?? channelOf()
}

/** What Settings' install button offers: the channel this build is NOT on. */
export function tryOutChannel(): ReleaseChannel {
  return channelOf() === "nightly" ? "latest" : "nightly"
}

export function rememberReleaseChannel(channel: ReleaseChannel): void {
  patchStateFile({ [UPDATE_CHANNEL_KEY]: channel })
}
