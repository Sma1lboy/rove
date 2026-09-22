/**
 * Paths to Rove's PRODUCT data (user settings files), keyed by home; runtime
 * ADDRESSES (sockets, pidfiles, logs) are `paths.ts`. Here because both the
 * daemon and the TUI (`packages/kobe/src/env.ts`) derive them, and kobe
 * depends on kobe-daemon, never back.
 */

import { homedir } from "node:os"
import { join } from "node:path"
import { ROVE_CONFIG_DIR_BASENAME, ROVE_STATE_DIR_BASENAME, readRoveHomeDirEnv } from "../compat-env.ts"

/**
 * The ambient state root: `ROVE_HOME_DIR` / `KOBE_HOME_DIR`, else the OS home.
 * A daemon with an EXPLICIT home uses
 * {@link import("./paths.ts").resolveDaemonHomeDir}, which layers on this.
 * An EMPTY variable means unset, not `""` (that would make every state path
 * cwd-relative).
 */
export function resolveProductHomeDir(): string {
  return readRoveHomeDirEnv() ?? homedir()
}

/** `<home>/.config/rove/state.json`, the flat KV blob. Written only via
 *  `packages/kobe/src/state/store.ts`; the daemon only WATCHES it. */
export function defaultUiPrefsStatePath(homeDir = resolveProductHomeDir()): string {
  return join(homeDir, ".config", ROVE_CONFIG_DIR_BASENAME, "state.json")
}

/** `<home>/.rove/settings/keybindings.yaml`. The TUI falls back to `.yml`, and
 *  the daemon watches the DIRECTORY so both names trigger a re-read. */
export function defaultKeybindingsPath(homeDir = resolveProductHomeDir()): string {
  return join(homeDir, ROVE_STATE_DIR_BASENAME, "settings", "keybindings.yaml")
}
