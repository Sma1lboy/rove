/**
 * Composes the per-namespace `./messages/` files (one per surface, so
 * translation work parallelizes) into `en` / `zh` trees. English is the SOURCE
 * OF TRUTH; `zh` must carry the exact key set, enforced by `bun run check-i18n`
 * and `test/tui/i18n-catalog.test.ts`, including `{placeholder}`s. Pure data,
 * vitest-safe (the `t()` runtime is `./index.ts`). Prose is translated;
 * literal config syntax (YAML keys, shell commands) stays in the calling code.
 */

import { en as automations, zh as automationsZh } from "./messages/automations"
import { en as common, zh as commonZh } from "./messages/common"
import { en as doctor, zh as doctorZh } from "./messages/doctor"
import { en as files, zh as filesZh } from "./messages/files"
import { en as help, zh as helpZh } from "./messages/help"
import { en as hints, zh as hintsZh } from "./messages/hints"
import { en as kanban, zh as kanbanZh } from "./messages/kanban"
import { en as keys, zh as keysZh } from "./messages/keys"
import { en as newTask, zh as newTaskZh } from "./messages/newTask"
import { en as onboarding, zh as onboardingZh } from "./messages/onboarding"
import { en as ops, zh as opsZh } from "./messages/ops"
import { en as quickTask, zh as quickTaskZh } from "./messages/quickTask"
import { en as settings, zh as settingsZh } from "./messages/settings"
import { en as tasks, zh as tasksZh } from "./messages/tasks"
import { en as terminal, zh as terminalZh } from "./messages/terminal"
import { en as update, zh as updateZh } from "./messages/update"
import { en as workItems, zh as workItemsZh } from "./messages/workItems"
import { en as workspace, zh as workspaceZh } from "./messages/workspace"
import { en as worktrees, zh as worktreesZh } from "./messages/worktrees"

export const en = {
  settings,
  tasks,
  terminal,
  files,
  newTask,
  onboarding,
  ops,
  update,
  quickTask,
  help,
  hints,
  common,
  keys,
  workspace,
  worktrees,
  kanban,
  automations,
  workItems,
  doctor,
}

/** Each namespace `zh` is typed `typeof en`, so this annotation just documents the contract. */
export type Messages = typeof en

const zh: Messages = {
  settings: settingsZh,
  tasks: tasksZh,
  terminal: terminalZh,
  files: filesZh,
  newTask: newTaskZh,
  onboarding: onboardingZh,
  ops: opsZh,
  update: updateZh,
  quickTask: quickTaskZh,
  help: helpZh,
  hints: hintsZh,
  common: commonZh,
  keys: keysZh,
  workspace: workspaceZh,
  worktrees: worktreesZh,
  kanban: kanbanZh,
  automations: automationsZh,
  workItems: workItemsZh,
  doctor: doctorZh,
}

/**
 * Display order. `intl` is the BCP-47 tag for `Intl`/`toLocale*`; a catalog
 * id isn't one. A bare `toLocaleDateString()` uses the OS locale, wrong both
 * ways (zh UI on `en-US` printed `8/3/2026`, en UI on `zh-CN` `2026/8/3`).
 */
export const LOCALES = [
  { id: "en", label: "English", intl: "en-US" },
  { id: "zh", label: "中文", intl: "zh-CN" },
] as const

export type LocaleId = (typeof LOCALES)[number]["id"]

export const CATALOGS: Record<LocaleId, Messages> = { en, zh }

export const DEFAULT_LOCALE: LocaleId = "en"

export function isLocaleId(value: unknown): value is LocaleId {
  return typeof value === "string" && LOCALES.some((l) => l.id === value)
}
