/**
 * `kobe plugin install` / `kobe plugin link` — getting a plugin registered.
 *
 * Install takes GitHub shorthand (`owner/repo[/subdir...]`) in two phases:
 * `preparePluginInstall` clones and previews every command it WOULD run;
 * `commit()` runs them, moves the checkout to `~/.rove/plugins/<id>/` and
 * registers it. No caller may skip the approval between — `[[build]]` is
 * arbitrary code.
 *
 * Link registers a local directory as-is, no build. Neither needs the daemon;
 * it file-watches the registry.
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
  /** Stream git/build output to our stdio. CLI only — in the TUI it would
   *  shred the frame, so output is captured instead. */
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

/** Async on purpose: `spawnSync` would block the TUI render loop for a whole clone/install. */
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

/** Stage inside the plugins root, not `/tmp`: that's often tmpfs (always under
 *  WSL2), and cross-device `rename(2)` fails with EXDEV. */
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
  // 0700 like the daemon: config holds the `.env` with API keys. The first
  // creator sets the mode (`mkdirSync` never chmods), so 0755 here would stick.
  mkdirSync(pluginConfigDir(entry.id), { recursive: true, mode: 0o700 })
  mkdirSync(pluginStateDir(entry.id), { recursive: true, mode: 0o700 })
}

/** Clone + inspect, running nothing plugin-authored. Every refusal (bad spec,
 *  manifest, version gate, platform, existing link) happens HERE, so an
 *  approved preview can actually be carried out. */
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

          // A build that rewrites the manifest voids the approved preview.
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
  // Warn, don't refuse: developing a Windows-only plugin on a Mac is legitimate.
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
