/**
 * Settings → Engines → Skip permission prompts: hosted launches carry each
 * engine's `permissionBypass` flag. Read fresh from state.json per launch. On by default.
 */

import { getPersistedBool } from "@sma1lboy/rove-core/state/store.ts"

export const PERMISSION_BYPASS_KEY = "engines.permissionBypass"

export function permissionBypassEnabled(): boolean {
  return getPersistedBool(PERMISSION_BYPASS_KEY, true)
}
