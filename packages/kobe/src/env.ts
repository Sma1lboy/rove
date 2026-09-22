/**
 * Every production env/runtime flag read goes through here: `ROVE_*` first,
 * falling back to the `KOBE_*` alias. Test-only vars (`KOBE_TEST_ENGINE`,
 * `KOBE_TEST_FAKE_PORT`, per-pane `KOBE_*_HOST` fixtures) stay at their use
 * sites.
 *
 * Not a config layer: no `.env` loading, no config-file cascade.
 */

import { createHash } from "node:crypto"
import { join } from "node:path"
import { readRoveEnv } from "@sma1lboy/kobe-daemon/compat-env"
import {
  defaultKeybindingsPath,
  defaultUiPrefsStatePath,
  resolveProductHomeDir,
} from "@sma1lboy/kobe-daemon/daemon/product-paths"
import { LEGACY_KOBE_CONFIG_DIR_BASENAME, LEGACY_KOBE_STATE_DIR_BASENAME, ROVE_STATE_DIR_BASENAME } from "./product.ts"

/**
 * `ROVE_DEV=1` / `KOBE_DEV=1` — running from a developer checkout. Suppresses
 * the npm "↑ vX.Y.Z available" chip; the installed CLI never sets it.
 */
export function isDev(): boolean {
  return readRoveEnv("DEV") === "1"
}

/**
 * `ROVE_HOME_DIR` / `KOBE_HOME_DIR` — overrides `os.homedir()` for everything
 * Rove persists; tests point it at a temp dir.
 */
export function homeDir(): string {
  return resolveProductHomeDir()
}

/** `<home>/.rove/`. Not created here — writers mkdir at the write site. */
export function roveStateDir(): string {
  return join(homeDir(), ROVE_STATE_DIR_BASENAME)
}

/** Compatibility root for data created before the Rove migration. */
export function legacyKobeStateDir(): string {
  return join(homeDir(), LEGACY_KOBE_STATE_DIR_BASENAME)
}

/**
 * Shared flat-JSON KV blob (`~/.config/rove/state.json`), read by the TUI's
 * `KVProvider` and CLI modules. All I/O goes through `src/state/store.ts`;
 * this is the one place the path is spelled.
 */
export function kvStatePath(): string {
  return defaultUiPrefsStatePath(homeDir())
}

/** Compatibility path copied on first launch after upgrade. */
export function legacyKobeKvStatePath(): string {
  return join(homeDir(), ".config", LEGACY_KOBE_CONFIG_DIR_BASENAME, "state.json")
}

/**
 * `~/.rove/settings/` — hand-authored YAML the user owns (unlike the
 * machine-written KV blob). A missing dir means "no overrides"; writers mkdir.
 */
export function roveSettingsDir(): string {
  return join(roveStateDir(), "settings")
}

/**
 * `~/.rove/settings/keybindings.yaml` (`.yml` accepted when `.yaml` is absent).
 * Loaded once per process at TUI boot.
 */
export function keybindingsConfigPath(): string {
  return defaultKeybindingsPath(homeDir())
}

/**
 * `<home>/.rove/attachments/` — clipboard screenshots saved so their path can
 * travel in a prompt. Created lazily; timestamp+nonce names never collide.
 */
export function promptAttachmentsDir(): string {
  return join(roveStateDir(), "attachments")
}

/**
 * SSH ControlMaster socket, one per host/user/port. Hashed so a long
 * `user@host:port` stays under the ~104-char unix-socket path limit.
 */
export function remoteControlSocketPath(host: string, user: string, port?: number): string {
  const hash = createHash("sha1")
    .update(`${user}@${host}:${port ?? 22}`)
    .digest("hex")
    .slice(0, 16)
  return join(roveStateDir(), "ssh", `${hash}.sock`)
}

/**
 * Marker that the repo init script already ran for a worktree. Under
 * `<home>/.rove/`, not the worktree, so it never shows as an uncommitted
 * change. A worktree recreated at the same path reuses it — intentionally.
 */
export function worktreeInitMarkerPath(worktreePath: string): string {
  const hash = createHash("sha1").update(worktreePath).digest("hex").slice(0, 16)
  return join(roveStateDir(), "worktree-init", hash)
}
