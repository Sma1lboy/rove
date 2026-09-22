/**
 * `kobe skill install | status | command | print`.
 *
 * Install shells out to the agent-skills CLI, pointed at the bundled SKILL.md
 * (a repo clone only when none is bundled; `lib/skill-install.ts`). With no
 * `--agent` that CLI detects installed agents and prompts, so kobe carries no
 * agent list. Installs are GLOBAL by default — the skill drives a machine-wide
 * daemon; `--project` opts into a per-project install.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  NPX_MISSING_EXIT,
  bundledSkillDir,
  installedSkillDiffersFromBundled,
  kobeSkillPaths,
  kobeSkillState,
  npxSkillsCommand,
  runNpxSkillsInstall,
} from "../lib/skill-install.ts"
import { activeCliName } from "./rename-compat.ts"
import { SUBCOMMAND_VERBS } from "./subcommands.ts"

const CLI_NAME = activeCliName()

const SKILL_VERBS = SUBCOMMAND_VERBS.skill

function skillUsage(): string {
  return [
    `usage: ${CLI_NAME} skill <verb>`,
    "",
    "verbs:",
    "  install [--global|-g | --project|-p] [--agent NAME]…  Install the Rove agent skill (wraps `npx skills add`)",
    "  status                                                Show whether the skill is installed",
    "  command [--global|-g | --project|-p] [--agent NAME]…  Print the underlying npx command without running it",
    `  print                                                 Print the bundled SKILL.md (also: \`${CLI_NAME} --skill\`)`,
    "",
    `The skill teaches a coding agent how to drive \`${CLI_NAME} api\`. Installs are`,
    "global (user-level) by default; --global/-g says so explicitly, --project/-p",
    "installs into the current project instead. With no --agent, the agent-skills",
    "CLI detects your installed agents and asks; repeat --agent to name them",
    "(e.g. --agent claude-code --agent codex).",
  ].join("\n")
}

/** Empty `agents` = let the agent-skills CLI ask. Scope defaults to global. */
function parseInstallFlags(rest: readonly string[]): { agents: string[]; global: boolean } {
  let global = true
  const agents: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === "--project" || arg === "-p") {
      global = false
    } else if (arg === "--global" || arg === "-g") {
      global = true
    } else if (arg === "--agent") {
      const v = rest[i + 1]
      if (!v || v.startsWith("--")) {
        process.stderr.write(`${CLI_NAME} skill: --agent requires a value\n`)
        process.exit(2)
      }
      agents.push(v)
      i++
    } else if (arg.startsWith("--agent=")) {
      agents.push(arg.slice("--agent=".length))
    } else {
      process.stderr.write(`${CLI_NAME} skill: unknown flag "${arg}"\n\n${skillUsage()}\n`)
      process.exit(2)
    }
  }
  // The agent-skills CLI rejects a comma-joined list; say so up front.
  const joined = agents.find((a) => a.includes(","))
  if (joined) {
    process.stderr.write(
      `${CLI_NAME} skill: --agent takes one name; repeat the flag instead of "${joined}"\n` +
        `  e.g. ${joined
          .split(",")
          .map((a) => `--agent ${a.trim()}`)
          .join(" ")}\n`,
    )
    process.exit(2)
  }
  return { agents, global }
}

export async function runSkillSubcommand(argv: readonly string[]): Promise<void> {
  const [verb, ...rest] = argv
  if (!verb || verb === "--help" || verb === "-h" || verb === "help") {
    process.stdout.write(`${skillUsage()}\n`)
    if (!verb) process.exitCode = 2
    return
  }
  if (!SKILL_VERBS.includes(verb)) {
    process.stderr.write(`${CLI_NAME} skill: unknown verb "${verb}"\n\n${skillUsage()}\n`)
    process.exit(2)
  }

  if (verb === "print") {
    // The bundled copy always matches this binary; an installed copy is the
    // fallback so `kobe --skill` still answers on an unbuilt environment.
    const bundled = bundledSkillDir()
    const path = bundled ? join(bundled, "SKILL.md") : kobeSkillPaths().find((p) => existsSync(p))
    if (!path) {
      process.stderr.write(
        `${CLI_NAME} skill: no SKILL.md found (not bundled, not installed) — run \`${CLI_NAME} skill install\`\n`,
      )
      process.exit(1)
    }
    process.stdout.write(readFileSync(path, "utf8"))
    return
  }

  if (verb === "status") {
    const { isRovePluginEnabled } = await import("../engine/claude-code-local/plugin-migration.ts")
    const state = kobeSkillState()
    const paths = kobeSkillPaths()
    const pluginNote = isRovePluginEnabled()
      ? "  note: the Rove Claude Code plugin is enabled — for Claude Code the skill ships\n        inside the plugin and versions with it (staleness prompts are suppressed).\n"
      : ""
    const head = !state.installed
      ? "✗ not installed"
      : state.stale
        ? `⚠ out of date (installed ${state.installedVersion === null ? "unstamped" : `v${state.installedVersion}`}, this Rove wants v${state.currentVersion})`
        : `✓ installed (v${state.installedVersion})`
    // `stale` compares versions only, so an edit without a bump reads ✓.
    // Diagnostic only: the startup prompt stays version-based.
    const contentDrift = state.installed && !state.stale && !!state.path && installedSkillDiffersFromBundled(state.path)
    process.stdout.write(
      [
        `${CLI_NAME} skill: ${head}`,
        ...(contentDrift
          ? [
              "  ⚠ content differs from the copy bundled with this Rove at the same version —",
              `    run \`${CLI_NAME} --skill > ${state.path}\` to refresh it`,
            ]
          : []),
        // Agents load every skill dir, so a `kobe`-named copy teaches an old `api`.
        ...state.legacyCopies.map(
          (copy) =>
            `  ⚠ stale duplicate: ${copy.path}${copy.version === null ? "" : ` (v${copy.version})`} — remove it; agents load both`,
        ),
        `  looked in: ${paths.join("\n             ")}`,
        state.installed && !state.stale ? "" : `  → run \`${CLI_NAME} skill install\` to install / refresh`,
        "",
      ].join("\n") + pluginNote,
    )
    return
  }

  if (verb === "command") {
    const flags = parseInstallFlags(rest)
    process.stdout.write(`${npxSkillsCommand({ agent: flags.agents, global: flags.global })}\n`)
    return
  }

  // stdio is inherited, so with no --agent the CLI's picker runs interactively.
  const { agents, global } = parseInstallFlags(rest)
  const bundled = bundledSkillDir()
  process.stdout.write(
    `${CLI_NAME} skill: running \`${npxSkillsCommand({ agent: agents, global })}\`\n${
      bundled ? "" : `${CLI_NAME} skill: no bundled skill found — falling back to a repo clone (large download).\n`
    }`,
  )
  const code = await runNpxSkillsInstall(agents, global)
  if (code !== 0) {
    // NPX_MISSING_EXIT: already explained; "run it yourself" needs the same missing npx.
    if (code !== NPX_MISSING_EXIT) {
      process.stderr.write(
        `\n${CLI_NAME} skill install failed (npx exited ${code}).\n` +
          `You can run it yourself: ${npxSkillsCommand({ agent: agents, global })}\n`,
      )
    }
    process.exit(code || 1)
  }
  process.stdout.write(`${CLI_NAME} skill: installed.\n`)
}
