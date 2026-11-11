/** Wall tiles: the rail, the composer, the status marks, settings controls and keys. */

import type { RowStatus } from "rove-bridge/protocol"
import { NERD } from "../rail-glyphs.ts"
import { AttachThumbs, type Thumb } from "../ui/attach-thumbs.tsx"
import { Button } from "../ui/button.tsx"
import { Chip } from "../ui/chip.tsx"
import { BAR, CARD, CARD_ACTIONS, ICON, cardIcon, chipClass } from "../ui/composer.ts"
import { EngineIcon } from "../ui/engine-icon.tsx"
import { Keycap } from "../ui/keycap.tsx"
import { CHILD_INDENT, PR_CHIP, guideClass, projectHead } from "../ui/rail.ts"
import { CHIPS, ROW_TITLE_RAIL, ROW_TITLE_RUNNING, rowClass } from "../ui/row.ts"
import { Segmented } from "../ui/segmented.tsx"
import { Select } from "../ui/select.tsx"
import { StatusDots } from "../ui/status-dots.tsx"
import { Switch } from "../ui/switch.tsx"
import { Tabs } from "../ui/tabs.tsx"
import { KICKER } from "../ui/text.ts"
import { at, typed, useT } from "./clock.ts"
import { CLAUDE_ICON, CODEX_ICON } from "./icons.ts"

const st = (kind: RowStatus["kind"], reason?: RowStatus["reason"]): RowStatus => ({
  kind,
  since: 0,
  ...(reason ? { reason } : {}),
})
const RUN = st("running")
const ASK = st("needs-input")
const DONE = st("unseen")
const IDLE = st("idle")
const FAIL = st("attention", "error")
const noop = () => {}

function RailRow(p: {
  title: string
  status: RowStatus
  selected: boolean
  child?: "tee" | "elbow"
  chips?: React.ReactNode
}) {
  return (
    <div className={rowClass({ selected: p.selected })}>
      {p.child && (
        <span className={CHILD_INDENT}>
          <span className={guideClass(p.child)} />
        </span>
      )}
      <StatusDots status={p.status} />
      <span className={`${ROW_TITLE_RAIL} ${p.status.kind === "running" ? ROW_TITLE_RUNNING : ""}`}>{p.title}</span>
      {p.chips && <span className={CHIPS}>{p.chips}</span>}
    </div>
  )
}

export function RailTile() {
  const t = useT()
  const cursor = at(t, [
    [0, 0],
    [1600, 3],
    [3200, 4],
    [4800, 5],
    [6400, 1],
  ])
  const merged = t > 5200
  const head = projectHead({ moving: false, dragging: false, grab: false })
  return (
    <div className="flex h-full flex-col">
      <div className={head}>rove</div>
      <RailRow
        title="Fix the flaky login test"
        selected={cursor === 0}
        status={at(t, [
          [0, RUN],
          [3000, DONE],
          [6200, IDLE],
        ])}
        chips={
          <>
            <Chip tone="added">+42</Chip>
            <Chip tone="removed">−7</Chip>
          </>
        }
      />
      <RailRow title="attempt with Claude" child="tee" selected={cursor === 1} status={t < 2400 ? RUN : DONE} />
      <RailRow title="attempt with Codex" child="elbow" selected={false} status={t < 3000 ? RUN : IDLE} />
      <RailRow
        title="Add a dark mode toggle"
        selected={cursor === 3}
        status={at(t, [
          [0, ASK],
          [2200, RUN],
        ])}
      />
      <RailRow
        title="Upgrade to React 19"
        selected={cursor === 4}
        status={merged ? IDLE : RUN}
        chips={
          <span className={`${PR_CHIP} ${merged ? "text-merged" : "text-success"}`}>
            {merged ? NERD.prMerged : NERD.prOpen} <span className="font-sans">#1204</span>
          </span>
        }
      />
      <RailRow
        title="Move CI to Bun"
        selected={cursor === 5}
        status={at(t, [
          [0, FAIL],
          [5600, RUN],
        ])}
      />
      <div className={`${head} mt-3!`}>docs-site</div>
      <RailRow title="Write the release notes" selected={false} status={t > 4000 ? RUN : IDLE} />
      <RailRow title="Translate the guide" selected={false} status={t > 6800 ? DONE : RUN} />
      <RailRow title="Check every link" selected={false} status={t > 2800 && t < 6000 ? ASK : IDLE} />
      <RailRow title="Shrink the images" selected={false} status={IDLE} />
    </div>
  )
}

const PROMPT = "Fix the flaky login test, then open a PR. Use the trace I attached and keep the change small."
const FILES: readonly Thumb[] = [
  { id: "a", name: "trace.log", size: 48_210, pending: true },
  { id: "b", name: "spec.pdf", size: 912_004, pending: true },
]

export function ComposerTile() {
  const t = useT(400)
  const sent = t > 6600
  const text = sent ? "" : typed(PROMPT, t, 300, 38)
  const files = sent
    ? []
    : FILES.slice(
        0,
        at(t, [
          [0, 0],
          [3000, 1],
          [3500, 2],
        ]),
      ).map((f, i) => ({
        ...f,
        pending: t < 3400 + i * 500,
      }))
  const codex = t > 4800 && !sent
  const worktree = t > 4000 || sent
  return (
    <div className="flex h-full flex-col gap-2 font-mono text-meta leading-normal">
      <div className={`${CARD} min-h-0 flex-1`}>
        <AttachThumbs items={files} onRemove={noop} />
        <div className="min-h-9 flex-1 text-ink">
          {text || <span className="text-subtle">What should the agent do?</span>}
          {text && !sent && <span className="ml-px inline-block h-3.5 w-px translate-y-0.5 bg-accent" />}
        </div>
        <div className={CARD_ACTIONS}>
          <span className={cardIcon(files.length > 0)}>
            <svg className={ICON} viewBox="0 0 14 14" aria-hidden="true">
              <path d="M9.5 3.5 5 8a1.4 1.4 0 0 0 2 2l4.6-4.6a2.6 2.6 0 0 0-3.7-3.7L3.2 6.4a3.8 3.8 0 0 0 5.4 5.4L11.5 9" />
            </svg>
          </span>
          <Button variant="filled" style={{ scale: t > 6400 && t < 6600 ? "0.94" : "1", transition: "scale 120ms" }}>
            Start
          </Button>
        </div>
      </div>
      <div className={BAR}>
        <span className={chipClass()}>
          <EngineIcon icon={codex ? CODEX_ICON : CLAUDE_ICON} />
          {codex ? "Codex" : "Claude Code"}
        </span>
        <span className={chipClass(worktree)}>Worktree</span>
        <span className={chipClass()}>main</span>
        <span className={chipClass()}>Later</span>
      </div>
    </div>
  )
}

const LOOKS: readonly (readonly [string, RowStatus])[] = [
  ["working", RUN],
  ["waiting", ASK],
  ["done", DONE],
  ["failed", FAIL],
  ["idle", IDLE],
]

export function DotsTile() {
  return (
    <div className="flex h-full items-center justify-around gap-2 font-mono text-meta text-muted">
      {LOOKS.map(([name, status]) => (
        <span key={name} className="flex flex-col items-center gap-2">
          <span className="scale-180">
            <StatusDots status={status} />
          </span>
          {name}
        </span>
      ))}
    </div>
  )
}

export function WordmarkTile() {
  return (
    <div className="flex h-full items-baseline justify-between gap-2 px-1 pt-3">
      <span className="font-mono leading-none font-bold text-accent" style={{ fontSize: 26 }}>
        rove
      </span>
      <span className="font-mono text-meta text-muted">web components</span>
    </div>
  )
}

const PREFS = ["Shimmer on running tasks", "Tell me when a task finishes", "Open links in the side panel"] as const

export function SwitchTile() {
  const t = useT(900)
  const on = [t > 1200 && t < 6800, t < 3600 || t > 7200, t > 2600]
  return (
    <div className="flex h-full flex-col justify-center gap-2.5">
      <p className={`${KICKER} text-muted`}>Appearance</p>
      {PREFS.map((label, i) => (
        <div key={label} className="flex items-center justify-between gap-3 font-sans text-body">
          {label}
          <Switch on={on[i] ?? false} aria-label={label} />
        </div>
      ))}
    </div>
  )
}

const TABS = [
  { id: "term", label: "Terminal" },
  { id: "chat", label: "Chat" },
  { id: "files", label: "Files" },
  { id: "diff", label: "Diff" },
] as const
const THEMES = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "Auto" },
] as const

export function TabsTile() {
  const t = useT(1500)
  const tab = TABS[Math.floor(t / 2000) % 4]?.id ?? "term"
  return (
    <div className="group/pane flex h-full items-center justify-center">
      <Tabs tabs={TABS} value={tab} onChange={noop} />
    </div>
  )
}

export function ThemeTile() {
  const t = useT(2200)
  const theme = THEMES[Math.floor(t / 2667) % 3]?.value ?? "dark"
  return (
    <div className="flex h-full items-center justify-center">
      <Segmented label="Theme" value={theme} picks={THEMES} onPick={noop} />
    </div>
  )
}

export function StartTile() {
  const t = useT(3100)
  return (
    <div className="flex h-full items-center justify-between gap-2">
      <Select label="Model" value="opus" picks={[{ value: "opus", label: "Opus 5.5" }]} onPick={noop} />
      <Button variant="filled" style={{ scale: t > 1000 && t < 1220 ? "0.94" : "1", transition: "scale 120ms" }}>
        Start
      </Button>
    </div>
  )
}

/** One engine's mark, breathing as it does on a working row. */
export function MarkTile() {
  return (
    <div className="grid h-full place-items-center">
      <span className="scale-260">
        <EngineIcon icon={CLAUDE_ICON} status={{ look: "working", tone: "accent" }} />
      </span>
    </div>
  )
}

export function KeysTile() {
  const t = useT(2300)
  const recording = t > 2400 && t < 4400
  const changed = t >= 4400
  return (
    <div className="flex h-full items-center justify-between gap-3 font-sans text-body">
      <span className="flex items-center gap-2">
        New task
        <Keycap label="New task" onPress={noop}>
          ⌘N
        </Keycap>
      </span>
      <span className="flex items-center gap-2">
        Search
        <Keycap label="Search" onPress={noop}>
          ⌘K
        </Keycap>
      </span>
      <span className="flex items-center gap-2">
        Next task
        <Keycap label="Next task" tone={recording ? "active" : changed ? "changed" : "idle"} onPress={noop}>
          {recording ? "press…" : changed ? "⌃J" : "⌥↓"}
        </Keycap>
      </span>
    </div>
  )
}
