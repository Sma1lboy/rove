/**
 * Every page, dialog, menu and Settings section the tour shoots, and how a person reaches it. Adding a screen is
 * adding one entry. Each entry starts from a fresh load of its home (storage cleared), so entries never depend on
 * each other. `PAGE_IDS` and `SECTION_GROUPS` come from rove-web itself; `uncovered()` names any the list misses.
 */

import { PAGE_IDS } from "../../../rove-web/src/ui.ts"
import { SECTION_GROUPS } from "../../../rove-web/src/settings-sections.ts"

/** Text a control shows or its aria-label (exact, else prefix); `{ t }` an i18n key, so a step reads in any language. */
export type Target = string | { readonly t: string } | { readonly css: string } | { readonly label: string }
export type Step =
  | { readonly click: Target }
  | { readonly right: Target }
  | { readonly hover: Target }
  | { readonly wait: Target }
  /** A key, sent to the element `on` names (the sidebar's own keys need it focused) or to whatever has focus. */
  | { readonly press: string; readonly on?: string }
  | { readonly type: string }

export type Viewport = "desktop" | "phone"
export type HomeKind = "full" | "empty" | "token"

export interface Entry {
  readonly id: string
  readonly caption: string
  /** Default `full`. */
  readonly home?: HomeKind
  /** Default desktop only. */
  readonly on?: readonly Viewport[]
  /** `sessionStorage` set before the load: the way into a page with no control of its own. `{round}` = the seeded Compare round. */
  readonly storage?: Readonly<Record<string, string>>
  readonly steps?: readonly Step[]
  /** Replaces `steps` on a phone. */
  readonly phoneSteps?: readonly Step[]
  /** Up to this many further screenfuls of the biggest scroller. */
  readonly pages?: number
  /** Also shot in the `light` / `zh` variants. Steps must then name controls by `{ t }`, `{ css }` or seeded data. */
  readonly variants?: true
  /** Only in the Electron window (the install window has no web twin). */
  readonly electron?: "only"
  /** The bridge goes away after the steps (the page's reconnect states). */
  readonly offline?: true
  /** The Electron setup window's installer command (`electron: "only"` entries). */
  readonly installCmd?: string
}

const open = (title: string): Step[] => [{ click: title }, { wait: { css: ".xterm canvas" } }]
const settings = (section: string, extra: Step[] = []): Step[] => [
  { click: { t: "rail.settings" } },
  { click: { css: `[data-section="${section}"]` } },
  ...extra,
]
const page = (id: string) => ({ "rove.web.page": JSON.stringify(id) })
const rowMenu = (title: string, ...more: Step[]): Step[] => [{ right: title }, { wait: { css: "[role=menuitem]" } }, ...more]
const composer: Step[] = [{ click: { t: "rail.newTask" } }, { wait: { css: "textarea" } }]
const phoneComposer: Step[] = [{ click: { t: "newTask.title" } }, { wait: { css: "textarea" } }]
/** The composer's chips by field (`repo`, `engine`, `model`, `more`, `branch`): their labels change with the pick. */
const chip = (field: string): Step => ({ click: { css: `[data-field="${field}"]` } })
const pickProject: Step[] = [chip("repo"), { click: "acme-api" }]
const inProject: Step[] = [...composer, ...pickProject]
const extension = (name: string): Step[] => [{ click: { t: "rail.extensions" } }, { click: name }]
const railKey = (...keys: string[]): Step[] => keys.map((press) => ({ press, on: ".rail" }))
const shellFor = (title: string): Step[] => [...open(title), { click: { css: ".xterm" } }]

export const MANIFEST: readonly Entry[] = [
  // ── Electron install window (no Rove on PATH) ──
  { id: "setup-rove-missing", caption: "Install window: Rove not found", electron: "only", installCmd: "true" },
  {
    id: "setup-installing",
    caption: "Install window: installing",
    electron: "only",
    installCmd: 'echo "==> Installing Bun"; sleep 600',
    steps: [{ click: "Install Rove" }, { wait: { css: "pre, .log, code" } }],
  },
  {
    id: "setup-install-failed",
    caption: "Install window: install failed",
    electron: "only",
    installCmd: 'echo "curl: (6) Could not resolve host: rove.run" >&2; exit 6',
    steps: [{ click: "Install Rove" }, { wait: "Try again" }],
  },

  // ── First run and empty states ──
  { id: "welcome", caption: "First run: welcome checklist", home: "empty", on: ["desktop", "phone"], variants: true, steps: [{ wait: { t: "firstRun.projectFix" } }] },
  { id: "welcome-pick-project", caption: "First run: Pick a project", home: "empty", steps: [{ click: { t: "firstRun.projectFix" } }] },
  { id: "empty-routines", caption: "Routines, none yet", home: "empty", on: ["desktop", "phone"], storage: page("routines") },
  { id: "empty-inbox", caption: "Inbox, empty", home: "empty", steps: [{ click: { t: "rail.inbox" } }] },
  { id: "empty-settings-engines", caption: "Settings › Engines on a fresh home", home: "empty", steps: settings("engines") },
  { id: "sign-in", caption: "Sign in: token required", home: "token", on: ["desktop", "phone"] },

  // ── The workspace ──
  { id: "sidebar", caption: "Sidebar with projects, a round and the inbox", on: ["desktop", "phone"], variants: true },
  {
    id: "task-terminal",
    caption: "A task's terminal",
    on: ["desktop", "phone"],
    variants: true,
    steps: [...shellFor("Add rate limiting to /auth"), { type: "git log --oneline\n" }],
    phoneSteps: open("Add rate limiting to /auth"),
  },
  { id: "task-terminal-child", caption: "A child task, with its parent in the path", steps: open("Write tests for limiter") },
  { id: "panel-context", caption: "Side panel: Context", steps: [...open("Fix login redirect loop"), { click: { label: "Context" } }] },
  { id: "panel-files", caption: "Side panel: Files", steps: [...open("Fix login redirect loop"), { click: { label: "Files" } }] },
  {
    id: "panel-files-expanded",
    caption: "Files with a folder open",
    steps: [...open("Fix login redirect loop"), { click: { label: "Files" } }, { click: "src" }, { wait: "redirect.ts" }],
  },
  {
    id: "file-preview",
    caption: "A file open from Files",
    steps: [...open("Fix login redirect loop"), { click: { label: "Files" } }, { click: "README.md" }],
  },
  {
    id: "panel-diff",
    caption: "Side panel: Diff",
    on: ["desktop", "phone"],
    steps: [...open("Add rate limiting to /auth"), { click: { label: "Diff" } }, { wait: "README.md" }],
    phoneSteps: [...open("Add rate limiting to /auth"), { click: { css: '[aria-label^="Views"]' } }, { click: "Diff" }, { wait: "README.md" }],
  },
  {
    id: "diff-base-picker",
    caption: "Diff: comparing against another base",
    steps: [
      ...open("Add rate limiting to /auth"),
      { click: { label: "Diff" } },
      { wait: "README.md" },
      { click: { css: ".side-panel button[aria-haspopup=menu]" } },
    ],
  },
  { id: "panel-browser", caption: "Side panel: Browser", steps: [...open("Fix login redirect loop"), { click: { label: "Browser" } }] },
  {
    id: "panels-all",
    caption: "Every side panel open",
    steps: [
      ...open("Add rate limiting to /auth"),
      { click: { label: "Context" } },
      { click: { label: "Files" } },
      { click: { label: "Diff" } },
    ],
  },
  { id: "rail-folded", caption: "Sidebar folded", steps: [...open("Fix login redirect loop"), { click: { label: "Fold the task list" } }] },

  // ── Inbox ──
  { id: "inbox", caption: "Inbox", on: ["desktop", "phone"], variants: true, steps: [{ click: { t: "rail.inbox" } }] },
  { id: "inbox-reply", caption: "Inbox: replying to a task", steps: [{ click: { t: "rail.inbox" } }, { click: "[ reply ]" }] },

  // ── Routines ──
  { id: "routines", caption: "Routines", on: ["desktop", "phone"], steps: [{ click: "Routines" }] },
  { id: "routine-ok", caption: "Routines: a passing routine", steps: [{ click: "Routines" }, { click: "Weekly dependency audit" }] },
  { id: "routine-failed-runs", caption: "Routines: runs filtered to failures", steps: [{ click: "Routines" }, { click: "[ failed ]" }] },
  { id: "routine-delete", caption: "Routines: delete confirm", steps: [{ click: "Routines" }, { click: "[ delete ]" }] },
  { id: "routine-paused", caption: "Routines: a paused prompt routine", steps: [{ click: "Routines" }, { click: "Weekly changelog draft" }] },
  { id: "routine-new", caption: "Routines: new routine", steps: [{ click: "Routines" }, { click: "[ new ]" }] },

  // ── Kanban and Issues ──
  { id: "kanban", caption: "Kanban", on: ["desktop", "phone"], steps: [{ click: "Kanban" }], phoneSteps: extension("Kanban") },
  { id: "kanban-card", caption: "Kanban: a card's detail", steps: [{ click: "Kanban" }, { click: "Retry failed webhooks" }] },
  { id: "kanban-new", caption: "Kanban: new card", steps: [{ click: "Kanban" }, { click: "[ new ]" }] },
  { id: "kanban-delete", caption: "Kanban: delete confirm", steps: [{ click: "Kanban" }, { click: "Retry failed webhooks" }, { click: "[ delete ]" }] },
  { id: "issues", caption: "Issues", on: ["desktop", "phone"], steps: [{ click: "Issues" }], phoneSteps: extension("Issues") },
  { id: "extensions", caption: "Extensions sheet", on: ["phone"], phoneSteps: [{ click: { t: "rail.extensions" } }, { wait: "Kanban" }] },

  // ── New task composer ──
  { id: "new-task", caption: "New task", on: ["desktop", "phone"], variants: true, steps: composer, phoneSteps: phoneComposer },
  { id: "new-task-project-menu", caption: "New task: project menu", on: ["desktop", "phone"], steps: [...composer, chip("repo")], phoneSteps: [...phoneComposer, chip("repo")] },
  { id: "new-task-engine-menu", caption: "New task: engine menu", on: ["desktop", "phone"], steps: [...composer, chip("engine")], phoneSteps: [...phoneComposer, chip("engine")] },
  { id: "new-task-model-menu", caption: "New task: model menu", steps: [...composer, chip("model")] },
  // The last project's `+` (titled New task, like the sidebar's own row).
  { id: "new-task-in-project", caption: "New task from a project's +", steps: [{ click: { css: 'button[title="New task"]' } }] },
  { id: "new-task-project", caption: "New task with a project picked", on: ["desktop", "phone"], steps: inProject, phoneSteps: [...phoneComposer, ...pickProject] },
  { id: "new-task-more-menu", caption: "New task: more options", steps: [...inProject, chip("more")] },
  { id: "new-task-later", caption: "New task: start later", steps: [...inProject, chip("more"), { click: { t: "newSession.later" } }] },
  { id: "new-task-branch-menu", caption: "New task: base branch", steps: [...inProject, chip("branch")] },
  { id: "new-task-worktree-off", caption: "New task: worktree off", steps: [...inProject, { click: { t: "newSession.worktreeOn" } }] },
  {
    id: "new-task-typed",
    caption: "New task with a prompt typed",
    steps: [...inProject, { click: { css: "textarea" } }, { type: "Add a /health endpoint that reports the build sha" }],
  },

  // ── Pages with no sidebar row ──
  { id: "page-worktrees", caption: "Worktrees (sidebar key w)", steps: railKey("w") },
  { id: "page-usage", caption: "Usage", storage: page("usage") },
  { id: "page-sessions", caption: "Sessions of a project (its name in the sidebar)", steps: [{ click: "acme-api" }] },
  { id: "page-sessions-archived", caption: "Sessions: archived", steps: [{ click: "acme-api" }, { click: "Archived" }] },
  { id: "page-mods", caption: "Mods", storage: page("mods") },
  { id: "page-update", caption: "Update (sidebar key u)", steps: railKey("u") },
  { id: "page-compare-empty", caption: "Compare with no round", storage: page("compare") },
  { id: "page-compare", caption: "Compare: a round's two attempts", on: ["desktop", "phone"], steps: [{ click: "Try two navbar layouts" }] },

  // ── Keyboard layers ──
  { id: "prefix-guide", caption: "Prefix guide (ctrl+a)", steps: railKey("Control+a") },
  { id: "palette", caption: "Command palette (ctrl+a /)", steps: [...railKey("Control+a", "/"), { wait: { css: ".palette input" } }] },
  // Typed only once the palette has the focus: in the sidebar these letters are commands.
  { id: "palette-search", caption: "Command palette: searching", steps: [...railKey("Control+a", "/"), { wait: { css: ".palette input" } }, { type: "rate" }] },
  { id: "help-keys", caption: "Keybindings help (F1)", steps: railKey("F1") },

  // ── A task row's menu ──
  { id: "row-menu", caption: "Task row menu", steps: rowMenu("Fix login redirect loop") },
  { id: "row-menu-status", caption: "Row menu › Set status", steps: rowMenu("Fix login redirect loop", { hover: "Set status" }) },
  { id: "row-menu-copy", caption: "Row menu › Copy", steps: rowMenu("Fix login redirect loop", { hover: "Copy" }) },
  { id: "row-menu-more", caption: "Row menu › More", steps: rowMenu("Fix login redirect loop", { hover: "More" }) },
  { id: "rename", caption: "Rename a task", steps: rowMenu("Fix login redirect loop", { click: "Rename" }) },
  { id: "remove-confirm", caption: "Remove a session: confirm", steps: rowMenu("Fix login redirect loop", { click: "Remove session" }) },
  { id: "land-confirm", caption: "Land into base branch: confirm", steps: rowMenu("Add rate limiting to /auth", { click: "Land into base branch" }) },
  // Never "New conversation": it starts the real engine at once.
  { id: "project-menu", caption: "Project header menu", steps: [{ right: "acme-api" }, { wait: { css: "[role=menuitem]" } }] },

  // ── Settings: every section, from SECTION_GROUPS ──
  ...SECTION_GROUPS.flatMap((group) =>
    group.sections.map(
      (section): Entry => ({
        id: `settings-${section}`,
        caption: `Settings › ${section}`,
        on: ["desktop", "phone"],
        pages: 6,
        ...(section === "general" || section === "appearance" ? { variants: true as const } : {}),
        steps: settings(section),
      }),
    ),
  ),
  { id: "settings-engine-claude", caption: "Settings › Engines › Claude", pages: 2, steps: settings("engines", [{ click: "Claude" }]) },
  { id: "settings-pair-phone", caption: "Settings › Connectors › pair a phone (QR)", steps: settings("connectors", [{ click: "Show QR code" }]) },

  { id: "bridge-lost", caption: "The bridge went away", on: ["desktop", "phone"], offline: true },

  // ── Last: these change the seeded state for every entry after them ──
  { id: "split-right", caption: "Terminal split right (ctrl+\\)", steps: [...shellFor("Dark mode for settings page"), { press: "Control+\\" }] },
  { id: "split-down", caption: "Terminal split down (ctrl+=)", steps: [...shellFor("Upgrade React to 19"), { press: "Control+=" }] },
]

/** Page ids and Settings sections rove-web has that no entry reaches (an entry `<page>` or `page-<page>`). */
export function uncovered(): string[] {
  const ids = new Set(MANIFEST.map((e) => e.id))
  return [
    ...PAGE_IDS.filter((id) => !ids.has(id) && !ids.has(`page-${id}`)).map((id) => `page ${id}`),
    ...SECTION_GROUPS.flatMap((g) => g.sections)
      .filter((s) => !ids.has(`settings-${s}`))
      .map((s) => `settings ${s}`),
  ]
}
