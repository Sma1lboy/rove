#!/usr/bin/env node
/**
 * The published `rove` / `kobe` bin. `bun install -g` runs it under Bun;
 * `npm install -g` / `npx` under node. Under Bun it imports the real entry;
 * under node it re-execs through a Bun it finds, or offers to install one.
 *
 * Every install path passes here, so the Bun VERSION floor is enforced here
 * (`bun-runtime.ts`): too old a Bun gives terminals that silently never paint,
 * and no package manager checks `engines`.
 *
 * Built `target: "node"` to `dist/cli/{rove,kobe}.js`, fronting
 * `<name>-run.js`. It must never import Bun-only code at load time.
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
  // Same remedy for a too-old Bun: the installer's `~/.bun` copy is preferred next time.
  const prompt = found.stale
    ? `${cliName}: Bun ${found.stale.version} is too old for Rove (needs ${MIN_BUN_VERSION}+). Install the latest Bun now? [Y/n] `
    : `${cliName}: Rove runs on the Bun runtime, and none is installed. Install Bun now? [Y/n] `
  if (!(await confirm(prompt))) return found
  return { bun: installBun(lookup), stale: found.stale, unusable: found.unusable }
}

const runningBun = (globalThis as { Bun?: { version?: string } }).Bun

if (runningBun) {
  // Already under Bun: load in-process. This is the ONLY version gate on the
  // `bun install -g` path.
  const version = runningBun.version
  if (version && !bunVersionCheckDisabled() && !isBunAtLeast(version)) {
    process.stderr.write(staleBunMessage(process.execPath, version, cliName))
    process.exit(1)
  }
  await import(pathToFileURL(entry).href)
} else {
  const { bun, stale, unusable } = await bunForRelaunch()
  if (!bun) {
    // Most specific diagnosis first: too old, then won't run, then missing.
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
