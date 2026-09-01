#!/usr/bin/env node
/**
 * The `rove` / `kobe` bin, as published.
 *
 * Installers disagree about which runtime starts a bin file: `bun install -g`
 * symlinks it (Bun runs it), `npm install -g` and `npx` hand it to node. This
 * launcher works under both — under Bun it just imports the real entry, under
 * node it finds a Bun runtime and re-execs through it, and when there is no
 * Bun at all it offers to install one instead of dying with
 * `env: bun: No such file or directory`.
 *
 * It is also the one funnel every install path passes through, so the Bun
 * VERSION floor is enforced here (src/cli/bun-runtime.ts): a Bun that is too
 * old costs the user a Rove whose terminals silently never paint, and no
 * package manager checks `engines` for us.
 *
 * Built with `target: "node"` and copied to `dist/cli/rove.js` and
 * `dist/cli/kobe.js`; the Bun bundles it fronts are `<name>-run.js` beside it
 * (see scripts/build.ts). It must never import Bun-only code at load time.
 */

import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import { pathToFileURL } from "node:url"
import {
  type BunResolution,
  MIN_BUN_VERSION,
  bunVersionCheckDisabled,
  canOfferBunInstall,
  installBun,
  isBunAtLeast,
  launcherDirOf,
  launcherNameOf,
  missingBunMessage,
  relaunchWithBun,
  resolveUsableBun,
  staleBunMessage,
  unusableBunMessage,
} from "./bun-runtime.ts"

const launcherDir = launcherDirOf(import.meta.url)
const cliName = launcherNameOf(import.meta.url)
const entry = join(launcherDir, `${cliName}-run.js`)

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(question)).trim().toLowerCase()
    return answer === "" || answer === "y" || answer === "yes"
  } finally {
    rl.close()
  }
}

async function bunForRelaunch(): Promise<BunResolution> {
  const lookup = { launcherDir }
  const found = resolveUsableBun(lookup)
  if (found.bun || !canOfferBunInstall()) return found
  // A too-old Bun has the same remedy as no Bun at all — the official
  // installer puts a current one in `~/.bun`, which resolveUsableBun then
  // prefers over the stale one it just skipped.
  const prompt = found.stale
    ? `${cliName}: Bun ${found.stale.version} is too old for Rove (needs ${MIN_BUN_VERSION}+). Install the latest Bun now? [Y/n] `
    : `${cliName}: Rove runs on the Bun runtime, and none is installed. Install Bun now? [Y/n] `
  if (!(await confirm(prompt))) return found
  return { bun: installBun(lookup), stale: found.stale, unusable: found.unusable }
}

const runningBun = (globalThis as { Bun?: { version?: string } }).Bun

if (runningBun) {
  // Already under Bun (`bun install -g`, `bunx`, the daemon re-spawning the
  // CLI with process.execPath): load the real entry in-process, no relaunch.
  // Nothing filtered this Bun by version on the way in, so the floor is
  // checked here instead — this is the ONLY gate on the `bun install -g` path.
  const version = runningBun.version
  if (version && !bunVersionCheckDisabled() && !isBunAtLeast(version)) {
    process.stderr.write(staleBunMessage(process.execPath, version, cliName))
    process.exit(1)
  }
  await import(pathToFileURL(entry).href)
} else {
  const { bun, stale, unusable } = await bunForRelaunch()
  if (!bun) {
    // Order is most-specific-first: a too-old Bun is the actionable diagnosis,
    // a Bun that will not run is the next one, and only with neither is
    // "install Bun" the right thing to say.
    const message = stale
      ? staleBunMessage(stale.path, stale.version, cliName)
      : unusable
        ? unusableBunMessage(unusable, cliName)
        : missingBunMessage(cliName)
    process.stderr.write(message)
    process.exit(1)
  }
  process.exit(relaunchWithBun(bun, entry, process.argv.slice(2)))
}
