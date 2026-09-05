import { ROVE_PRODUCT_NAME } from "@sma1lboy/kobe-daemon/compat-env"

/**
 * Default CLI product name. In a packaged build this is "rove"; the legacy
 * "kobe" wrapper still works at runtime but web-facing command hints fall back
 * to the build-time product name because the dashboard cannot synchronously
 * know which wrapper launched the daemon. Async callers should prefer
 * `/api/cli-invocation` (see {@link fetchCliInvocation}).
 */
export const DEFAULT_CLI_NAME = ROVE_PRODUCT_NAME

/** Capitalized display form, e.g. "Rove". */
export function displayProductName(name = DEFAULT_CLI_NAME): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}
