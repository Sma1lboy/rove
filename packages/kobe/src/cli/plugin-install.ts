/**
 * `kobe plugin install` / `kobe plugin link` — getting a plugin registered.
 *
 * Install accepts GitHub shorthand only (`owner/repo[/subdir...]`) and runs in
 * two phases so the confirmation gate is a real one: `preparePluginInstall`
 * clones, parses the manifest and reports every command the install WOULD run;
 * `commit()` is what actually runs them, moves the checkout under
 * `~/.rove/plugins/<id>/` and registers it. The CLI prints that preview and
 * asks on stdin; the TUI's Marketplace section renders it in a confirm dialog.
 * Neither may skip the phase boundary — a plugin's `[[build]]` is arbitrary
 * code on the user's machine.
 *
 * Link registers a local working directory as-is and runs no build — authors
 * build their own tree. Both work with no daemon running; the daemon
 * file-watches the registry and picks changes up live.
 */

import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { createInterface } from "node:readline/promises"
import {
  PLUGIN_MANIFEST_FILENAMES,
  type ParsedPluginManifest,
  currentPluginPlatform,
  parsePluginManifest,
  pluginManifestPath,
  supportsPlatform,
} from "@sma1lboy/kobe-daemon/plugins/manifest"
import {
  pluginCheckoutDir,
  pluginConfigDir,
  pluginStateDir,
  pluginsRootDir,
} from "@sma1lboy/kobe-daemon/plugins/plugin-paths"
import {
  type PluginRegistryEntry,
  loadPluginRegistry,
  savePluginRegistry,
  upsertPluginEntry,
} from "@sma1lboy/kobe-daemon/plugins/registry"
import { CURRENT_VERSION, compareSemver } from "../version.ts"

const GITHUB_SPEC_RE = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)(\/.+)?$/

export class PluginCliError extends Error {}

function fail(message: string): never {
  throw new PluginCliError(message)
}

interface PluginManifestSnapshot extends ParsedPluginManifest {
  readonly manifestPath: string
  readonly manifestSource: string
}

function readManifestAt(root: string): PluginManifestSnapshot {
  const path = pluginManifestPath(root)
  if (!path) fail(`no ${PLUGIN_MANIFEST_FILENAMES.join(" or ")} found at ${root}`)
  const source = readFileSync(path, "utf8")
  return { ...parsePluginManifest(source, basename(path)), manifestPath: path, manifestSource: source }
}

function checkVersionGate(parsed: ParsedPluginManifest): void {
  const min = parsed.manifest.minKobeVersion
  if (compareSemver(CURRENT_VERSION, min) < 0) {
    fail(`plugin requires Rove >= ${min} (this is ${CURRENT_VERSION}); update Rove first`)
  }
}

/** Everything the install would do, for a human to approve before it happens. */
export interface PluginInstallPreview {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly description: string | null
  /** `github.com/owner/repo[/subdir]` — where the checkout came from. */
  readonly source: string
  /** Every command this install would run, labelled (`build: npm ci`). */
  readonly commands: readonly string[]
  readonly warnings: readonly string[]
}

/** A staged checkout awaiting approval. Exactly one of commit/discard. */
export interface PreparedPluginInstall {
  readonly preview: PluginInstallPreview
  /** Run the build commands, then move + register. Resolves the plugin id. */
  commit(): Promise<string>
  /** Throw the staged checkout away without running anything. */
  discard(): void
}

export interface PluginInstallOptions {
  /** Branch/tag/sha to check out instead of the default branch's tip. */
  readonly ref?: string
  /**
   * Stream git/build output straight to this process's stdio. True for the
   * CLI; the TUI must leave it false — inherited output lands mid-frame and
   * shreds the rendered screen, so there it is captured and reported instead.
   */
  readonly inherit?: boolean
}

function commandLines(parsed: ParsedPluginManifest): string[] {
  const m = parsed.manifest
  const lines: string[] = []
  for (const c of m.build) lines.push(`build: ${c.command.join(" ")}`)
  for (const c of m.startup) lines.push(`startup: ${c.command.join(" ")}`)
  for (const a of m.actions) lines.push(`action ${a.id}: ${a.command.join(" ")}`)
  for (const e of m.events) lines.push(`on ${e.on}: ${e.command.join(" ")}`)
  return lines
}

/** Tail of a failed command's output — enough to diagnose, bounded. */
const CAPTURE_TAIL_BYTES = 4096

/**
 * One child process, awaited. Async on purpose: `spawnSync` would block the
 * TUI's render loop for the whole of a `git clone` or an `npm install`.
 */
function run(
  cmd: string,
  args: readonly string[],
  opts: { cwd?: string; inherit: boolean },
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args as string[], {
      cwd: opts.cwd,
      stdio: opts.inherit ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"],
    })
    let output = ""
    const collect = (chunk: unknown) => {
      output = `${output}${String(chunk)}`.slice(-CAPTURE_TAIL_BYTES)
    }
    child.stdout?.on("data", collect)
    child.stderr?.on("data", collect)
    child.on("error", (err) => resolve({ code: null, output: `${output}${err.message}` }))
    child.on("close", (code) => resolve({ code, output }))
  })
}

/** Message tail for a failed step: captured output, or nothing when inherited. */
function outputTail(output: string): string {
  const trimmed = output.trim()
  return trimmed ? `: ${trimmed.split("\n").slice(-3).join(" / ")}` : ""
}

async function git(args: readonly string[], opts: { cwd?: string; inherit: boolean }): Promise<void> {
  const { code, output } = await run("git", args, opts)
  if (code !== 0) fail(`git ${args[0]} failed${outputTail(output)}`)
}

async function runBuildCommands(parsed: ParsedPluginManifest, root: string, opts: { inherit: boolean }): Promise<void> {
  const platform = currentPluginPlatform()
  for (const [i, step] of parsed.manifest.build.entries()) {
    if (!supportsPlatform(step, parsed.manifest, platform)) continue
    const [cmd, ...args] = step.command
    if (opts.inherit) console.log(`build[${i}]: ${step.command.join(" ")}`)
    const { code, output } = await run(cmd as string, args, { cwd: root, inherit: opts.inherit })
    if (code !== 0) {
      fail(`build[${i}] failed (exit ${code ?? "spawn error"}); plugin not registered${outputTail(output)}`)
    }
  }
}

/**
 * Stage the clone inside the plugins root, not the OS temp dir: `/tmp` is a
 * separate filesystem on most Linux setups (tmpfs, and always so under WSL2),
 * and `rename(2)` across devices fails with EXDEV. Staging next to the
 * destination keeps the final move an atomic same-device rename.
 */
function makeStagingDir(): string {
  const root = pluginsRootDir()
  mkdirSync(root, { recursive: true })
  return mkdtempSync(join(root, ".staging-"))
}

/** Rename, falling back to copy+delete if the two paths still span devices. */
function movePluginTree(from: string, to: string): void {
  try {
    renameSync(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err
    cpSync(from, to, { recursive: true, verbatimSymlinks: true })
    rmSync(from, { recursive: true, force: true })
  }
}

function register(entry: PluginRegistryEntry): void {
  savePluginRegistry(upsertPluginEntry(loadPluginRegistry(), entry))
  // 0700, matching the daemon's own mkdir: config holds the settings `.env`
  // (the documented home for API keys) and state is plugin-owned data.
  // Whoever creates the directory FIRST sets its mode — `mkdirSync` never
  // chmods an existing one — so a 0755 here would outlive every later 0700.
  mkdirSync(pluginConfigDir(entry.id), { recursive: true, mode: 0o700 })
  mkdirSync(pluginStateDir(entry.id), { recursive: true, mode: 0o700 })
}

/**
 * Clone + inspect, stopping short of running anything the plugin authored.
 * Everything that can refuse the install (bad spec, unreadable manifest,
 * version gate, unsupported platform, an existing local link) refuses HERE,
 * so an approved preview is one the install can actually carry out.
 */
export async function preparePluginInstall(
  spec: string,
  opts: PluginInstallOptions = {},
): Promise<PreparedPluginInstall> {
  const match = spec.match(GITHUB_SPEC_RE)
  if (!match) fail(`install takes GitHub shorthand (owner/repo[/subdir]), got \`${spec}\``)
  const [, owner, repo, subdirRaw] = match
  const subdir = subdirRaw?.replace(/^\//, "")
  const inherit = opts.inherit ?? false

  const tmp = makeStagingDir()
  try {
    const url = `https://github.com/${owner}/${repo}.git`
    if (inherit) console.log(`cloning ${url}${opts.ref ? ` @ ${opts.ref}` : ""}`)
    if (opts.ref) {
      await git(["clone", "--quiet", url, tmp], { inherit })
      await git(["checkout", "--quiet", opts.ref], { cwd: tmp, inherit })
    } else {
      await git(["clone", "--quiet", "--depth", "1", url, tmp], { inherit })
    }
    const rootInClone = subdir ? join(tmp, subdir) : tmp
    const parsed = readManifestAt(rootInClone)
    checkVersionGate(parsed)
    const id = parsed.manifest.id

    const existing = loadPluginRegistry().plugins.find((p) => p.id === id)
    if (existing?.source.kind === "link") {
      fail(`\`${id}\` is locally linked at ${existing.root}; unlink it first`)
    }
    if (!supportsPlatform({}, parsed.manifest, currentPluginPlatform())) {
      fail(`plugin declares platforms [${parsed.manifest.platforms?.join(", ")}]; this machine is unsupported`)
    }

    return {
      preview: {
        id,
        name: parsed.manifest.name,
        version: parsed.manifest.version,
        description: parsed.manifest.description ?? null,
        source: `github.com/${owner}/${repo}${subdir ? `/${subdir}` : ""}`,
        commands: commandLines(parsed),
        warnings: parsed.warnings,
      },
      commit: async () => {
        try {
          await runBuildCommands(parsed, rootInClone, { inherit })

          // Re-read after build: a build that rewrites the manifest voids the
          // preview the user approved, so the install stops rather than
          // registering something nobody agreed to.
          const manifestPath = pluginManifestPath(rootInClone)
          if (!manifestPath) fail("manifest disappeared during build; aborting")
          if (manifestPath !== parsed.manifestPath) fail("manifest changed during build; aborting")
          const after = readFileSync(manifestPath, "utf8")
          if (after !== parsed.manifestSource) fail("manifest changed during build; aborting")

          const checkout = pluginCheckoutDir(id)
          rmSync(checkout, { recursive: true, force: true })
          mkdirSync(join(checkout, ".."), { recursive: true })
          movePluginTree(tmp, checkout)
          register({
            id,
            source: { kind: "github", spec },
            root: subdir ? join(checkout, subdir) : checkout,
            enabled: true,
            version: parsed.manifest.version,
            installedAt: Date.now(),
          })
          return id
        } finally {
          rmSync(tmp, { recursive: true, force: true })
        }
      },
      discard: () => rmSync(tmp, { recursive: true, force: true }),
    }
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true })
    throw err
  }
}

function printPreview(preview: PluginInstallPreview): void {
  console.log(`\n${preview.name} (${preview.id}) v${preview.version} — ${preview.description ?? "no description"}`)
  console.log(`source: ${preview.source}`)
  for (const line of preview.commands) console.log(`  ${line}`)
  for (const w of preview.warnings) console.log(`  warning: ${w}`)
  console.log("")
}

async function confirmOrBail(yes: boolean): Promise<void> {
  if (yes) return
  if (!process.stdin.isTTY) {
    fail("refusing to install without confirmation in a non-interactive terminal; pass --yes")
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question("Install this plugin and run its build commands? [y/N] ")).trim().toLowerCase()
  rl.close()
  if (answer !== "y" && answer !== "yes") fail("aborted")
}

/** Installs and returns the plugin id the manifest declared. */
export async function installPlugin(spec: string, opts: { yes: boolean; ref?: string }): Promise<string> {
  const prepared = await preparePluginInstall(spec, { ref: opts.ref, inherit: true })
  printPreview(prepared.preview)
  try {
    await confirmOrBail(opts.yes)
  } catch (err) {
    prepared.discard()
    throw err
  }
  const id = await prepared.commit()
  console.log(`installed ${id} v${prepared.preview.version}`)
  return id
}

export function linkPlugin(dir: string): void {
  const root = resolve(dir)
  if (!existsSync(root)) fail(`no such directory: ${root}`)
  const parsed = readManifestAt(root)
  checkVersionGate(parsed)
  const id = parsed.manifest.id
  const existing = loadPluginRegistry().plugins.find((p) => p.id === id)
  if (existing?.source.kind === "github") {
    fail(`\`${id}\` is installed from GitHub; uninstall it before linking a local copy`)
  }
  for (const w of parsed.warnings) console.log(`warning: ${w}`)
  // A warning, not a refusal: `install` fails here, but developing a
  // Windows-only plugin on a Mac is legitimate. What is not legitimate is
  // registering it with no hint that nothing will ever run it.
  if (!supportsPlatform({}, parsed.manifest, currentPluginPlatform())) {
    console.log(
      `warning: declares platforms [${parsed.manifest.platforms?.join(", ")}]; nothing will run on this machine`,
    )
  }
  register({
    id,
    source: { kind: "link" },
    root,
    enabled: true,
    version: parsed.manifest.version,
    installedAt: Date.now(),
  })
  console.log(`linked ${id} v${parsed.manifest.version} → ${root}`)
}
