/**
 * Qoder CLI hook adapter. Its hook schema mirrors Claude's settings.json
 * (docs.qoder.com/cli/hooks); everything but the id, table and path comes
 * from {@link SessionStartHookAdapter}, whose doc explains the one-entry table.
 */

import { homedir } from "node:os"
import { join } from "node:path"
import { SessionStartHookAdapter, sessionStartOnly } from "../session-hook-adapter.ts"

/** Qodercli hook event → normalized Rove verb. Qodercli's schema takes a
 *  matcher the way Claude's does, and `"*"` is the no-op value. */
export const QODERCLI_HOOK_EVENT_MAP = sessionStartOnly("*")

/** `$QODERCLI_CONFIG_DIR/settings.json`, else `~/.qoder/settings.json`. Not in
 *  `../vendor-home.ts`: this is its only reader. */
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
