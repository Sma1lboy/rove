/**
 * Paths to Rove's PRODUCT data — the files a user's settings live in, keyed by
 * the home the reader serves. Distinct from `paths.ts`, which resolves runtime
 * ADDRESSES (sockets, pidfiles, logs) and carries the legacy-layout liveness
 * rule that goes with them.
 *
 * Both sides of the wire derive these: the daemon's watchers resolve them from
 * the homeDir the server was started with, and the TUI's zero-argument
 * accessors in `packages/kobe/src/env.ts` wrap them with its own ambient home.
 * The derivation lives here (kobe -> kobe-daemon, never back) so the two can no
 * longer drift — the same move `lib/poll-scheduling.ts` already made.
 */

import { homedir } from "node:os"
import { join } from "node:path"
import { ROVE_CONFIG_DIR_BASENAME, ROVE_STATE_DIR_BASENAME, readRoveHomeDirEnv } from "../compat-env.ts"

/**
 * The ambient state root: `ROVE_HOME_DIR` / `KOBE_HOME_DIR`, else the OS home.
 * Tests point the env var at a temp dir so they never trample the real
 * `~/.rove/`. A daemon started with an EXPLICIT home uses
 * {@link import("./paths.ts").resolveDaemonHomeDir} instead — that one layers
 * the constructor's argument on top of this.
 *
 * An EMPTY variable means unset (`readRoveHomeDirEnv`), not a home of `""` —
 * the latter made every state path relative to the process's cwd.
 */
export function resolveProductHomeDir(): string {
  return readRoveHomeDirEnv() ?? homedir()
}

/**
 * The small flat-JSON KV blob shared between the TUI's `KVProvider` and
 * CLI-side modules — `<home>/.config/rove/state.json`. All reads/writes go
 * through `packages/kobe/src/state/store.ts` (tmp + atomic rename); the daemon
 * only WATCHES it, to fan visual prefs out to every attached pane.
 */
export function defaultUiPrefsStatePath(homeDir = resolveProductHomeDir()): string {
  return join(homeDir, ".config", ROVE_CONFIG_DIR_BASENAME, "state.json")
}

/**
 * User keybinding overrides — `<home>/.rove/settings/keybindings.yaml`. The
 * `.yml` spelling is honoured too: the TUI falls back to it when the `.yaml`
 * file is absent, and the daemon watches the DIRECTORY, so both filenames
 * trigger the re-read ping.
 */
export function defaultKeybindingsPath(homeDir = resolveProductHomeDir()): string {
  return join(homeDir, ROVE_STATE_DIR_BASENAME, "settings", "keybindings.yaml")
}
