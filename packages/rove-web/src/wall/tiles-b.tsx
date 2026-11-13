/** Wall tiles: the diff, the agent menu, checks, the board, search, the inbox, usage and toasts. */

import type { CSSProperties } from "react"
import { NERD } from "../rail-glyphs.ts"
import { Button } from "../ui/button.tsx"
import { CK, CK_AGE, CK_GLYPH, CK_NAME, CK_ROW } from "../ui/checks.ts"
import { DIFF_FILE_NAME, DIFF_GUTTER, OLD_GUTTER, diffCodeClass, diffRowClass, diffSignClass } from "../ui/diff-row.ts"
import { EngineIcon } from "../ui/engine-icon.tsx"
import { PEEK, PEEK_CHOICES, PEEK_FIELD, PEEK_QUESTION, PEEK_REPLY, PEEK_TAIL } from "../ui/inbox-peek.ts"
import {
  KB_CARD_FOOT,
  KB_CARD_HEAD,
  kbCardClass,
  kbCardTitleClass,
  kbLaneClass,
  kbLaneHeadClass,
} from "../ui/kanban.ts"
import {
  INBOX_AGE,
  INBOX_BADGE,
  INBOX_LINE,
  MENU_CHECK,
  MENU_SEP,
  menuClass,
  menuItemClass,
  menuKeyClass,
  toastClass,
} from "../ui/overlay.ts"
import {
  PR_LIST_GLYPH,
  PR_LIST_ITEM,
  PR_LIST_LINE,
  PR_LIST_META,
  PR_LIST_STATE,
  PR_LIST_STATS,
  PR_LIST_TITLE,
} from "../ui/rail.ts"
import {
  SEARCH_HEAD,
  SEARCH_MARK,
  SEARCH_ROW_HEAD,
  SEARCH_ROW_META,
  SEARCH_ROW_TITLE,
  SEARCH_SNIPPET,
  searchRowClass,
} from "../ui/search.ts"
import { INPUT, KICKER } from "../ui/text.ts"
import { USG_BAR, USG_BAR_CELL, USG_DAYS, USG_FIGURE, USG_ROW, USG_SEG } from "../ui/usage.ts"
import { at, typed, useT } from "./clock.ts"
import { CLAUDE_ICON, CODEX_ICON, COPILOT_ICON, KIMI_ICON } from "./icons.ts"

const DIFF: readonly (readonly [string, string, string, string])[] = [
  ["hunk", "", "", "@@ -18,6 +18,9 @@ test('logs in')"],
  ["ctx", "18", "18", "  await page.goto('/login')"],
  ["del", "19", "", "  await page.click('#submit')"],
  ["add", "", "19", "  await page.getByRole('button',"],
  ["add", "", "20", "    { name: 'Sign in' }).click()"],
  ["add", "", "21", "  await page.waitForURL('/home')"],
  ["ctx", "20", "22", "  expect(await title()).toBe('Home')"],
  ["hunk", "", "", "@@ -41,3 +43,4 @@ test('logs out')"],
  ["ctx", "41", "43", "  await page.click('#menu')"],
  ["add", "", "44", "  await page.waitForSelector('#out')"],
  ["ctx", "42", "45", "  await page.click('#out')"],
]
const SIGN: Record<string, string> = { add: "+", del: "-" }

export function DiffTile() {
  const t = useT(600)
  const shown = Math.min(DIFF.length, 1 + Math.floor(t / 420))
  const cursor = t > 4600 ? 3 + (Math.floor((t - 4600) / 700) % 3) : -1
  return (
    <div className="group/preview @container/preview -mx-3 h-full font-mono text-meta leading-normal">
      <div className={diffRowClass("file", { cursor: false, noted: false }).replace("mt-2 border-t-hairline", "")}>
        <span className={DIFF_FILE_NAME.replace("col-span-3", "col-span-4")}>
          login.spec.ts
          <span className="font-normal text-diff-added">
            +{DIFF.slice(0, shown).filter(([k]) => k === "add").length}
          </span>
          <span className="font-normal text-diff-removed">
            −{DIFF.slice(0, shown).filter(([k]) => k === "del").length}
          </span>
        </span>
      </div>
      {DIFF.slice(0, shown).map(([kind, a, b, code], i) => (
        <div
          key={code + b}
          className={`${diffRowClass(kind, { cursor: i === cursor, noted: false })} motion-safe:animate-rise-in`}
        >
          <span className={OLD_GUTTER}>{a}</span>
          <span className={DIFF_GUTTER}>{b}</span>
          <span className={diffSignClass(kind, false)}>{SIGN[kind] ?? " "}</span>
          <span className={diffCodeClass(kind)}>{code}</span>
        </div>
      ))}
    </div>
  )
}

const AGENTS = [
  ["Claude Code", CLAUDE_ICON, "⌥1"],
  ["Codex", CODEX_ICON, "⌥2"],
  ["Copilot", COPILOT_ICON, "⌥3"],
  ["Kimi", KIMI_ICON, "⌥4"],
] as const

export function AgentMenuTile() {
  const t = useT(1100)
  const cursor = at(t, [
    [0, 0],
    [1800, 1],
    [3400, 2],
    [4200, 1],
    [6600, 0],
  ])
  const picked = t > 4800 && t < 7400 ? 1 : 0
  return (
    <div className="flex h-full flex-col justify-center gap-1.5">
      <p className={`${KICKER} px-1 text-muted`}>Out of quota? Switch agent</p>
      <div className={menuClass().replace("fixed", "relative").replace("min-w-50", "")}>
        {AGENTS.map(([name, icon, key], i) => (
          <div key={name} className={menuItemClass({ selected: i === cursor })}>
            <span className="flex items-center gap-2">
              <EngineIcon icon={icon} />
              {name}
            </span>
            {i === picked ? <span className={MENU_CHECK}>✓</span> : <span className={menuKeyClass({})}>{key}</span>}
          </div>
        ))}
        <hr className={MENU_SEP} />
        <div className={menuItemClass({})}>
          Add an agent…<span className={menuKeyClass({})}>⌘,</span>
        </div>
      </div>
    </div>
  )
}

const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
const JOBS = [
  ["lint", 1400, "8s"],
  ["typecheck", 2600, "21s"],
  ["unit tests", 4200, "47s"],
  ["end-to-end", 5400, "1m"],
  ["build", 6400, "1m"],
] as const

export function ChecksTile() {
  const t = useT(200)
  const passed = JOBS.filter(([, end]) => t >= end).length
  return (
    <div className={`${CK} h-full justify-center px-0! pb-0!`}>
      <div className="flex items-center gap-2 text-ink">
        <span className={passed === JOBS.length ? "text-success" : "text-warning"}>
          {passed === JOBS.length ? "✓" : "●"}
        </span>
        Checks
        <span className="text-muted">
          {passed} of {JOBS.length}
        </span>
      </div>
      {JOBS.map(([name, end, age]) => {
        const ok = t >= end
        return (
          <div key={name} className={CK_ROW}>
            <span className={`${CK_GLYPH} ${ok ? "text-success" : "text-info"}`}>
              {ok ? "✓" : SPIN[Math.floor(t / 80) % SPIN.length]}
            </span>
            <span className={CK_NAME}>{name}</span>
            <span className={CK_AGE}>{ok ? age : ""}</span>
          </div>
        )
      })}
    </div>
  )
}

export function PrTile() {
  const t = useT(700)
  const merged = t > 4500
  return (
    <div className={`${PR_LIST_ITEM} h-full justify-center px-1! py-0!`}>
      <span className={PR_LIST_TITLE}>Upgrade to React 19</span>
      <span className={PR_LIST_LINE}>
        <span className={`${PR_LIST_STATE} ${merged ? "text-merged" : "text-success"}`}>
          <span className={PR_LIST_GLYPH}>{merged ? NERD.prMerged : NERD.prOpen}</span>
          {merged ? "Merged" : "Open"}
        </span>
        <span className={PR_LIST_META}>, #1204</span>
        <span className={PR_LIST_STATS}>
          <span className="text-diff-added">+318</span>
          <span className="text-diff-removed">−290</span>
        </span>
      </span>
    </div>
  )
}

const CARDS = [
  ["Fix login test", "Claude", 3000],
  ["React 19", "Codex", 5200],
  ["CI to Bun", "Claude", 99_999],
  ["Release notes", "Kimi", 99_999],
  ["Dark mode", "Codex", 0],
  ["Passkey login", "Claude", 0],
] as const

function Lane(p: { name: string; laneKey: string; cards: readonly (readonly [string, string, number])[]; t: number }) {
  return (
    <div className={kbLaneClass(true)}>
      <h3 className={kbLaneHeadClass(p.laneKey)}>
        {p.name}
        <span className="font-normal text-muted">{p.cards.length}</span>
      </h3>
      <div className="flex flex-col gap-2">
        {p.cards.map(([title, agent, done]) => (
          <div
            key={title}
            className={`${kbCardClass({ selected: Math.abs(p.t - done) < 500, attention: false })} motion-safe:animate-rise-in`}
          >
            <div className={KB_CARD_HEAD}>
              <span className={kbCardTitleClass(p.laneKey === "done")}>{title}</span>
            </div>
            <div className={`${KB_CARD_FOOT} text-muted`}>
              <span>{agent}</span>
              <span>{p.laneKey === "done" ? "merged" : "12m"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function BoardTile() {
  const t = useT()
  return (
    <div className="grid h-full grid-cols-2 gap-2 font-sans text-meta">
      <Lane name="In progress" laneKey="in_progress" t={t} cards={CARDS.filter(([, , done]) => t < done)} />
      <Lane name="Done" laneKey="done" t={t} cards={CARDS.filter(([, , done]) => t >= done)} />
    </div>
  )
}

const HITS = [
  ["Fix the flaky ", "login", " test", "task · running"],
  ["Add ", "login", " with a passkey", "task · done"],
  ["the ", "login", " button moved, so the click missed", "chat · 2m"],
  ["retry the ", "login", " step once", "chat · 1h"],
] as const

export function SearchTile() {
  const t = useT(2000)
  const query = t > 7000 ? "" : typed("login", t, 500, 160)
  const cursor = at(t, [
    [0, 0],
    [3200, 1],
    [4400, 2],
    [5600, 1],
  ])
  const found = query.length >= 3
  return (
    <div className="flex h-full flex-col gap-1.5 font-sans">
      <div className={`${INPUT} flex items-center gap-2`}>
        <span className="text-subtle">⌘K</span>
        {query || <span className="text-subtle">Search tasks and chats</span>}
        {query && <span className="-ml-2 inline-block h-3.5 w-px bg-accent" />}
      </div>
      {found && <p className={SEARCH_HEAD}>Tasks and chats</p>}
      {found &&
        HITS.map(([a, hit, b, meta], i) => (
          <div key={meta} className={`${searchRowClass(i === cursor)} motion-safe:animate-rise-in`}>
            <div className={SEARCH_ROW_HEAD}>
              <span className={i < 2 ? SEARCH_ROW_TITLE : `${SEARCH_SNIPPET} min-w-0 flex-1 truncate`}>
                {a}
                <mark className={SEARCH_MARK}>{hit}</mark>
                {b}
              </span>
              <span className={SEARCH_ROW_META}>{meta}</span>
            </div>
          </div>
        ))}
    </div>
  )
}

const REPLY = "Follow the system setting."

export function InboxTile() {
  const t = useT(3600)
  const sent = t > 6200
  const reply = typed(REPLY, t, 2600, 60)
  return (
    <div className="flex h-full flex-col justify-center font-sans">
      <div className={INBOX_LINE}>
        <span className={`${INBOX_BADGE} ${sent ? "text-info" : "text-warning"}`}>{sent ? "working" : "asks you"}</span>
        <span className="min-w-0 flex-1 truncate font-semibold">Add a dark mode toggle</span>
        <span className={INBOX_AGE}>2m</span>
      </div>
      <div className={`${PEEK} mx-0!`}>
        <pre className={PEEK_TAIL}>{"● Added the toggle to Settings.\n● One thing I need from you:"}</pre>
        <p className={PEEK_QUESTION}>Which theme should be the default?</p>
        <div className={PEEK_CHOICES}>
          <span className="text-accent">[ dark ]</span>
          <span className="text-accent">[ light ]</span>
          <span className={t > 1400 && t < 2400 ? "text-ink underline" : "text-accent"}>[ type an answer ]</span>
        </div>
        <div className={PEEK_REPLY}>
          <span className={`${PEEK_FIELD} min-h-7 ${sent ? "text-subtle!" : ""}`}>
            {sent ? "Sent to the agent" : reply || <span className="text-subtle">Reply…</span>}
          </span>
          <Button variant="filled" style={{ scale: t > 6000 && t < 6200 ? "0.94" : "1", transition: "scale 120ms" }}>
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}

const DAYS = [
  ["Mon", 6, "1.2M"],
  ["Tue", 11, "2.3M"],
  ["Wed", 8, "1.7M"],
  ["Thu", 14, "3.0M"],
  ["Fri", 9, "1.9M"],
] as const

export function UsageTile() {
  const t = useT(4400)
  const grow = Math.min(1, t / 2400)
  return (
    <div className="flex h-full flex-col justify-center">
      <p className={`${KICKER} mb-1 text-muted`}>Tokens this week</p>
      <div className={USG_DAYS}>
        {DAYS.map(([day, len, tokens], i) => (
          <div key={day} className={USG_ROW}>
            <span className="text-muted">{day}</span>
            <span className={USG_BAR_CELL}>
              <span
                className={USG_BAR}
                style={{ "--fill": `${(len / 14) * Math.min(1, grow * (1 + i * 0.15)) * 100}%` } as CSSProperties}
              >
                <span className={`${USG_SEG} grow bg-accent`} />
              </span>
            </span>
            <span className={`${USG_FIGURE} col-span-3`}>{tokens}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const TOASTS = ["The login test is fixed", "PR #1204 was merged", "Codex took over the task"] as const

export function ToastTile() {
  const t = useT(5200)
  const which = Math.floor(t / 2667) % 3
  return (
    <div className="flex h-full items-center">
      <div key={which} className={`${toastClass(false)} flex w-full items-baseline justify-between gap-3`}>
        {TOASTS[which]}
        <span className="font-mono text-accent">[ open ]</span>
      </div>
    </div>
  )
}
