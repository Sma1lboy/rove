import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)

/** `@sma1lboy/rove-core`'s source root, found by package resolution so a directory move cannot strand it. */
export const CORE_SRC = join(dirname(require.resolve("@sma1lboy/rove-core/package.json")), "src")

/** `@sma1lboy/rove-client`'s source root, found by package resolution so a directory move cannot strand it. */
export const CLIENT_SRC = join(dirname(require.resolve("@sma1lboy/rove-client/package.json")), "src")

/** `@sma1lboy/rove-api`'s source root, found by package resolution so a directory move cannot strand it. */
export const API_SRC = join(dirname(require.resolve("@sma1lboy/rove-api/package.json")), "src")

/** Absolute file path of a rove-core module, for child processes that import it by path. */
export const corePath = (subpath: string): string => require.resolve(`@sma1lboy/rove-core/${subpath}`)

/** Absolute file path of a rove-api module, for child processes that import it by path. */
export const apiPath = (subpath: string): string => require.resolve(`@sma1lboy/rove-api/${subpath}`)
