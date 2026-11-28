/**
 * `bun run tour` — screenshots every page, dialog, menu and Settings section of rove-web for review, on throwaway
 * homes under the system temp dir. Usage and flags: docs/agents/dev-loop.md § Screenshot tour.
 */

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { chromium } from "@playwright/test"
import { electronWindow } from "./electron.ts"
import { uncovered } from "./manifest.ts"
import {
  type Change,
  NOISE_PIXELS,
  comparePage,
  diffPixels,
  gridPage,
  jpegDataUrl,
  splitBySize,
  writeIndex,
} from "./report.ts"
import { type Shot, type Variant, shoot } from "./shoot.ts"

const REPO = resolve(import.meta.dirname, "../../../..")
const argv = process.argv.slice(2)
// `--compare` alone means `--compare main`.
const at = argv.indexOf("--compare")
if (at >= 0 && (argv[at + 1] === undefined || argv[at + 1]!.startsWith("--"))) argv.splice(at + 1, 0, "main")
const { values: flags } = parseArgs({
  args: argv,
  options: {
    viewports: { type: "string", default: "desktop,phone" },
    variants: { type: "string", default: "" },
    only: { type: "string" },
    electron: { type: "boolean", default: false },
    compare: { type: "string" },
    share: { type: "boolean", default: false },
    out: { type: "string" },
    keep: { type: "boolean", default: false },
  },
})

const log = (line: string) => console.log(line)
const sh = (cmd: string, args: string[], cwd: string) => execFileSync(cmd, args, { cwd, stdio: "pipe", encoding: "utf8" }).trim()
const started = Date.now()
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
const out = resolve(flags.out ?? join(REPO, ".scratch", "tour", stamp))
const runRoot = await mkdtemp(join(tmpdir(), "rove-tour-"))
const variants: Variant[] = ["default", ...(flags.variants!.split(",").filter(Boolean) as Variant[])]
const viewports = flags.viewports!.split(",").filter(Boolean) as ("desktop" | "phone")[]
const filter = flags.only ? new RegExp(flags.only) : undefined
const head = (dir: string) => sh("git", ["rev-parse", "--short", "HEAD"], dir)

const missing = uncovered()
if (missing.length > 0) log(`manifest misses: ${missing.join(", ")}`)

async function pass(checkout: string, dir: string): Promise<{ shots: Shot[]; failures: string[] }> {
  log(`building rove-web in ${checkout}`)
  sh("bun", ["run", "build"], join(checkout, "packages/rove-web"))
  const window = flags.electron ? await electronWindow(join(runRoot, "electron"), REPO) : undefined
  try {
    const result = await shoot({ checkout, out: dir, runRoot: join(runRoot, dir === out ? "now" : "ref"), viewports, variants, filter, window }, log)
    const sha = head(checkout)
    const note = `${result.shots.length} shots of ${sha}${flags.electron ? " in the Electron window" : ""}, ${new Date().toLocaleString()}.${result.failures.length ? ` ${result.failures.length} failed: ${result.failures.join("; ")}` : ""}`
    await writeIndex(dir, `Rove screenshot tour · ${sha}`, note, result.shots)
    return result
  } finally {
    await window?.close()
  }
}

let refCheckout: string | null = null
let exitCode = 0
try {
  if (!flags.compare) {
    const { shots, failures } = await pass(REPO, out)
    exitCode = failures.length > 0 ? 1 : 0
    log(`\n${shots.length} shots, ${failures.length} failed, ${((Date.now() - started) / 1000).toFixed(0)}s → ${join(out, "index.html")}`)
    if (flags.share) await share(`rove-tour-${head(REPO)}`, await sharePages(shots))
  } else {
    refCheckout = join(runRoot, "ref-checkout")
    log(`checking out ${flags.compare} at ${refCheckout}`)
    sh("git", ["worktree", "add", "--detach", refCheckout, flags.compare], REPO)
    sh("bun", ["install", "--frozen-lockfile"], refCheckout)
    const before = await pass(refCheckout, join(out, "before"))
    const after = await pass(REPO, join(out, "after"))
    const changes = await compare(before.shots, after.shots)
    exitCode = before.failures.length + after.failures.length > 0 ? 1 : 0
    const title = `Rove UI: ${flags.compare} (${head(refCheckout)}) → ${head(REPO)}`
    const note = `${changes.length} of ${after.shots.length} shots differ by more than ${NOISE_PIXELS} pixels.`
    const src = (side: "before" | "after", file: string) => `${side}/${file}`
    await writeFile(join(out, "compare.html"), comparePage(title, note, changes, src))
    log(`\n${changes.length} changed of ${after.shots.length}, ${((Date.now() - started) / 1000).toFixed(0)}s → ${join(out, "compare.html")}`)
    for (const c of changes) log(`  ${c.kind} ${c.shot.file}${c.pixels ? ` (${c.pixels}px)` : ""}`)
    if (flags.share && changes.length > 0) await share(`rove-ui-${head(REPO)}`, await shareCompare(title, note, changes))
  }
} finally {
  if (refCheckout) sh("git", ["worktree", "remove", "--force", refCheckout], REPO)
  if (!flags.keep) await rm(runRoot, { recursive: true, force: true })
}
process.exit(exitCode)

async function compare(before: readonly Shot[], after: readonly Shot[]): Promise<Change[]> {
  const browser = await chromium.launch()
  const bench = await browser.newPage()
  const changes: Change[] = []
  const old = new Map(before.map((s) => [s.file, s]))
  for (const shot of after) {
    if (!old.delete(shot.file)) {
      changes.push({ shot, kind: "added" })
      continue
    }
    const [a, b] = await Promise.all([readFile(join(out, "before", shot.file)), readFile(join(out, "after", shot.file))])
    if (a.equals(b)) continue
    const pixels = await diffPixels(bench, a, b)
    if (pixels > NOISE_PIXELS) changes.push({ shot, kind: "changed", pixels })
  }
  for (const shot of old.values()) changes.push({ shot, kind: "removed" })
  await browser.close()
  return changes
}

/** Images inlined as JPEG: the share host takes one self-contained page per round. */
async function inline(files: string[]): Promise<Map<string, string>> {
  const browser = await chromium.launch()
  const bench = await browser.newPage()
  const urls = new Map<string, string>()
  for (const file of files) urls.set(file, await jpegDataUrl(bench, await readFile(file), file.includes("-phone") ? 780 : 1440))
  await browser.close()
  return urls
}

async function sharePages(shots: readonly Shot[]): Promise<string[]> {
  const urls = await inline(shots.map((s) => join(out, s.file)))
  const parts = splitBySize(shots, (s) => urls.get(join(out, s.file))!.length)
  return parts.map((part, i) =>
    gridPage(`Rove screenshot tour · ${head(REPO)} (${i + 1}/${parts.length})`, `${shots.length} shots in all.`, part, (f) => urls.get(join(out, f))!),
  )
}

async function shareCompare(title: string, note: string, changes: readonly Change[]): Promise<string[]> {
  const files = changes.flatMap((c) => ["before", "after"].map((side) => join(out, side, c.shot.file))).filter((f) => existsSync(f))
  const urls = await inline(files)
  const size = (c: Change) => ["before", "after"].reduce((n, side) => n + (urls.get(join(out, side, c.shot.file))?.length ?? 0), 0)
  const parts = splitBySize(changes, size)
  return parts.map((part, i) => comparePage(`${title} (${i + 1}/${parts.length})`, note, part, (side, f) => urls.get(join(out, side, f)) ?? ""))
}

/** Publishes each page as one round of a series through the owner's share tool, when this machine has it. */
async function share(series: string, pages: string[]): Promise<void> {
  const bin = [join(homedir(), ".local/bin/brand-studio-share")].find((p) => existsSync(p))
  if (!bin) {
    log("--share: brand-studio-share is not installed here; the pages stay local")
    return
  }
  const slug = `${series}-${stamp.slice(5, 16)}`
  let link = ""
  for (const [i, html] of pages.entries()) {
    const file = join(out, `share-${i + 1}.html`)
    await writeFile(file, html)
    link = sh(bin, [file, "--series", slug, "--round", String(i + 1), "--title", `Rove tour ${i + 1}/${pages.length}`], out)
  }
  log(`shared ${pages.length} round(s): ${link}`)
}
