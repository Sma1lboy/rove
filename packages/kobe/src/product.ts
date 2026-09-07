/** Stable names used while the product moves from kobe to rove. */
import * as compatEnv from "@sma1lboy/kobe-daemon/compat-env"

// Re-bound one at a time, deliberately, instead of the shorter
// `import { X } from …; export { X }`. That barrel form makes Bun 1.3.14's
// bundler emit two chunks for this module and fail the whole build with
// "Multiple files share the same output path" the moment `splitting` is on
// (scripts/build.ts) — and splitting is what keeps `rove --version` and the
// `api` verbs from evaluating the TUI. Collapsing this back into a re-export
// takes cold start from ~65ms to ~150ms via a red build, not a slow one.
export const LEGACY_KOBE_CONFIG_DIR_BASENAME = compatEnv.LEGACY_KOBE_CONFIG_DIR_BASENAME
export const LEGACY_KOBE_PRODUCT_NAME = compatEnv.LEGACY_KOBE_PRODUCT_NAME
export const LEGACY_KOBE_STATE_DIR_BASENAME = compatEnv.LEGACY_KOBE_STATE_DIR_BASENAME
export const ROVE_CONFIG_DIR_BASENAME = compatEnv.ROVE_CONFIG_DIR_BASENAME
export const ROVE_PRODUCT_NAME = compatEnv.ROVE_PRODUCT_NAME
export const ROVE_STATE_DIR_BASENAME = compatEnv.ROVE_STATE_DIR_BASENAME

export type ProductCliName = typeof ROVE_PRODUCT_NAME | typeof LEGACY_KOBE_PRODUCT_NAME
