/**
 * Qoder CLI hook adapter.
 *
 * Qodercli reads `~/.qoder/settings.json` (`$QODERCLI_CONFIG_DIR` under its own
 * override), and its hook schema mirrors Claude's settings.json — a top-level
 * `hooks` object keyed by event name, each entry a matcher plus a list of
 * `{type: "command", command, timeout?}` invocations, per its own docs
 * (docs.qoder.com/cli/hooks) and refs/herdr
 * `src/integration/targets.rs#install_qodercli`. Everything but the id, the
 * table and the path comes from {@link SessionStartHookAdapter} — read its
 * module doc for why the table has one entry.
 */

import { homedir } from "node:os"
import { join } from "node:path"
import { SessionStartHookAdapter, sessionStartOnly } from "../session-hook-adapter.ts"

/** Qodercli hook event → normalized Rove verb. The `"*"` matcher is what herdr
 *  writes into this engine's entries; qodercli's schema takes one the way
 *  Claude's does, and a wildcard is the no-op value. */
export const QODERCLI_HOOK_EVENT_MAP = sessionStartOnly("*")

/** Qodercli's config directory: its own `QODERCLI_CONFIG_DIR` override, else
 *  `~/.qoder`. Not in `../vendor-home.ts` because this is the only reader of
 *  it in Rove — one call site, one derivation, same as cursor's. */
export function qodercliSettingsPath(home: string = homedir()): string {
  const override = process.env.QODERCLI_CONFIG_DIR?.trim()
  return join(override || join(home, ".qoder"), "settings.json")
}

export class QodercliHookAdapter extends SessionStartHookAdapter {
  readonly vendor = "qodercli" as const
  protected readonly eventMap = QODERCLI_HOOK_EVENT_MAP

  globalSettingsPath(): string {
    return qodercliSettingsPath()
  }
}
