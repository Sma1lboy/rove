/**
 * `rove skill install | status | print` — presentation over
 * `lib/skill-install.ts`, which owns detection and the copy.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type SkillTarget,
  bundledSkillDir,
  installSkill,
  installedSkillDiffersFromBundled,
  skillOverview,
  skillTargets,
} from "../lib/skill-install.ts"
import { ROVE_PRODUCT_NAME } from "../product.ts"
import { SUBCOMMAND_VERBS } from "./subcommands.ts"

const CLI_NAME = ROVE_PRODUCT_NAME

const SKILL_VERBS = SUBCOMMAND_VERBS.skill

function skillUsage(): string {
  return [
    `usage: ${CLI_NAME} skill <verb>`,
    "",
    "verbs:",
    "  install [--agent ENGINE]…  Copy the Rove agent skill into every engine set up on this machine",
    "  status                     Show which engines have the skill, and whether it is current",
    `  print                      Print the bundled SKILL.md (also: \`${CLI_NAME} --skill\`)`,
    "",
    `The skill teaches a coding agent how to drive \`${CLI_NAME} api\`. Installs are`,
    "user-level. --agent takes a Rove engine id (claude, codex, …) and may repeat.",
    "Installed copies refresh themselves when Rove upgrades.",
  ].join("\n")
}

function fail(message: string): never {
  process.stderr.write(`${CLI_NAME} skill: ${message}\n`)
  process.exit(2)
}

function parseAgents(rest: readonly string[]): string[] {
  const agents: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === "--agent") {
      const v = rest[i + 1]
      if (!v || v.startsWith("--")) fail("--agent requires a value")
      agents.push(v)
      i++
    } else if (arg.startsWith("--agent=")) {
      agents.push(arg.slice("--agent=".length))
    } else {
      fail(`unknown flag "${arg}"\n\n${skillUsage()}`)
    }
  }
  return agents
}

function describe(target: SkillTarget): string {
  const state =
    target.state === "installed"
      ? `✓ v${target.version}`
      : target.state === "outdated"
        ? `⚠ ${target.version === null ? "unstamped" : `v${target.version}`}, out of date`
        : "✗ not installed"
  return `  ${target.displayName.padEnd(14)} ${state.padEnd(24)} ${target.dir}`
}

function noTargetsMessage(): string {
  return `no supported coding agent found on this machine.\nFor another agent, save the skill yourself: ${CLI_NAME} --skill > <skills dir>/rove/SKILL.md`
}

export async function runSkillSubcommand(argv: readonly string[]): Promise<void> {
  const [verb, ...rest] = argv
  if (!verb || verb === "--help" || verb === "-h" || verb === "help") {
    process.stdout.write(`${skillUsage()}\n`)
    if (!verb) process.exitCode = 2
    return
  }
  if (!SKILL_VERBS.includes(verb)) fail(`unknown verb "${verb}"\n\n${skillUsage()}`)

  if (verb === "print") {
    const bundled = bundledSkillDir()
    if (!bundled) {
      process.stderr.write(`${CLI_NAME} skill: this build ships no SKILL.md\n`)
      process.exit(1)
    }
    process.stdout.write(readFileSync(join(bundled, "SKILL.md"), "utf8"))
    return
  }

  if (verb === "status") {
    const overview = skillOverview()
    if (overview.targets.length === 0) {
      process.stdout.write(`${CLI_NAME} skill: ${noTargetsMessage()}\n`)
      return
    }
    const drifted = overview.targets.filter((t) => t.state === "installed" && installedSkillDiffersFromBundled(t.dir))
    const needsInstall = overview.targets.some((t) => t.state !== "installed")
    process.stdout.write(
      [
        `${CLI_NAME} skill:`,
        ...overview.targets.map(describe),
        ...drifted.map((t) => `  ⚠ ${t.displayName}: content differs from this build at the same version`),
        ...(needsInstall || drifted.length > 0 ? [`  → run \`${CLI_NAME} skill install\``] : []),
        "",
      ].join("\n"),
    )
    return
  }

  const agents = parseAgents(rest)
  const all = skillTargets()
  if (all.length === 0) {
    process.stderr.write(`${CLI_NAME} skill: ${noTargetsMessage()}\n`)
    process.exit(1)
  }
  const unknown = agents.filter((a) => !all.some((t) => t.vendor === a))
  if (unknown.length > 0) {
    fail(
      `not set up on this machine (or no skills dir): ${unknown.join(", ")}\n  available: ${all.map((t) => t.vendor).join(", ")}`,
    )
  }
  const targets = agents.length === 0 ? all : all.filter((t) => agents.includes(t.vendor))
  let results: ReturnType<typeof installSkill>
  try {
    results = installSkill(targets)
  } catch (error) {
    process.stderr.write(`${CLI_NAME} skill: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
  for (const { target, error } of results) {
    if (error) process.stderr.write(`  ✗ ${target.displayName}: ${error}\n`)
    else process.stdout.write(`  ✓ ${target.displayName.padEnd(14)} ${target.dir}\n`)
  }
  if (results.some((r) => r.error)) process.exit(1)
  process.stdout.write(`${CLI_NAME} skill: installed.\n`)
}
