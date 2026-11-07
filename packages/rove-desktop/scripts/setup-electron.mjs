/**
 * Electron's npm package is a stub whose own postinstall downloads the app; Bun does not run it, even
 * with the package on `trustedDependencies`. Run it here so `bun install` leaves a usable runtime.
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const electronDir = dirname(require.resolve("electron/package.json"))
if (existsSync(join(electronDir, "dist"))) process.exit(0)
const installer = join(electronDir, "install.js")
if (!existsSync(installer)) process.exit(0)
console.log("rove-desktop: downloading the Electron runtime")
const run = spawnSync(process.execPath, [installer], { stdio: "inherit" })
process.exit(run.status ?? 0)
