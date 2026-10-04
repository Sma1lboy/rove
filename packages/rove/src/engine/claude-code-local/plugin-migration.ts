/**
 * Claude Code plugin takeover detection — the migration hard-gate.
 *
 * With the Rove plugin (`claude-plugin/`, enabled as `rove@<marketplace>`)
 * carrying the activity hooks + skill, two legacy installs double-register:
 *
 *   1. the settings.json activity-hook block (every event fires twice), and
 *   2. a pre-plugin skill copy (Claude Code loads both).
 *
 * PROMPT-ONLY: never edits settings.json or deletes a skill dir. Cleanup is the
 * user-invoked `rove hook cleanup` plus removing the skill dir by hand.
 */

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { installedSkillDirs } from "../../lib/skill-install.ts"
import { hasKobeActivityHooks, isObject } from "../json-hooks.ts"
import { CLAUDE_HOOK_EVENT_MAP, claudeSettingsPath } from "./hook-adapter.ts"

/** From `claude-plugin/.claude-plugin/plugin.json`. Keys are
 *  `<plugin>@<marketplace>`; the marketplace half varies, so match the plugin half. */
const PLUGIN_NAME = "rove"

function readSettings(path: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** True when the Rove Claude Code plugin is installed AND enabled. */
export function isRovePluginEnabled(settingsFilePath: string = claudeSettingsPath()): boolean {
  const settings = readSettings(settingsFilePath)
  if (!settings || !isObject(settings.enabledPlugins)) return false
  return Object.entries(settings.enabledPlugins).some(([key, on]) => on === true && key.split("@")[0] === PLUGIN_NAME)
}

/** What the migration gate found — each entry is a double-registration risk. */
export interface MigrationFindings {
  /** settings.json still carries kobe's activity/worktree-watch hook groups. */
  readonly legacyHooks: boolean
  /** Pre-plugin skill directories Claude Code would load alongside the plugin's copy. */
  readonly legacySkillDirs: readonly string[]
}

export function detectLegacyInstalls(opts: { settingsFilePath?: string; home?: string } = {}): MigrationFindings {
  const settingsFilePath = opts.settingsFilePath ?? claudeSettingsPath()
  const home = opts.home ?? homedir()
  const settings = readSettings(settingsFilePath)
  // "worktree-created" isn't an activity verb, so the watch hook needs its own check.
  const legacyHooks =
    settings !== null && (hasKobeActivityHooks(settings, CLAUDE_HOOK_EVENT_MAP) || settingsHasWorktreeWatch(settings))
  // Not just `.claude/skills/{rove,kobe}`: the agent-skills CLI writes into
  // `.agents/skills` and symlinks agent dirs at it.
  const legacySkillDirs = installedSkillDirs(home)
  return { legacyHooks, legacySkillDirs }
}

function settingsHasWorktreeWatch(settings: Record<string, unknown>): boolean {
  const hooks = isObject(settings.hooks) ? settings.hooks : {}
  return Object.values(hooks).some(
    (groups) =>
      Array.isArray(groups) &&
      groups.some(
        (g) =>
          isObject(g) &&
          Array.isArray(g.hooks) &&
          g.hooks.some(
            (h) =>
              isObject(h) &&
              typeof h.command === "string" &&
              h.command.includes("worktree-created") &&
              // The plugin's own hook has the marker too; only non-plugin-root is legacy.
              !h.command.includes("CLAUDE_PLUGIN_ROOT"),
          ),
      ),
  )
}

/** Stderr notice; repeats every launch until cleaned (an active
 *  misconfiguration, not a tip). Never edits anything. */
export function migrationHint(findings: MigrationFindings, cliName: string): string | null {
  if (!findings.legacyHooks && findings.legacySkillDirs.length === 0) return null
  const lines = [`${cliName}: the Rove Claude Code plugin is enabled, but legacy installs remain:`]
  if (findings.legacyHooks) {
    lines.push(
      "  • ~/.claude/settings.json still has the settings-managed Rove hooks (every event fires TWICE).",
      `    Run \`${cliName} hook cleanup\` to remove them (only Rove's own entries are touched).`,
    )
  }
  for (const dir of findings.legacySkillDirs) {
    lines.push(
      `  • legacy skill copy at ${dir} (the plugin bundles the skill — two copies double-register).`,
      `    Remove that directory to keep the plugin's copy only.`,
    )
  }
  lines.push("  Reading this inside a session? Just ask your agent to run the cleanup for you.")
  return `${lines.join("\n")}\n`
}
