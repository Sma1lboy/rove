/** A wall of the web client's own components, each running a short loop: the source of the promo film. */

import type { ReactNode } from "react"
import {
  ComposerTile,
  DotsTile,
  KeysTile,
  MarkTile,
  RailTile,
  StartTile,
  SwitchTile,
  TabsTile,
  ThemeTile,
  WordmarkTile,
} from "./tiles-a.tsx"
import {
  AgentMenuTile,
  BoardTile,
  ChecksTile,
  DiffTile,
  InboxTile,
  PrTile,
  SearchTile,
  ToastTile,
  UsageTile,
} from "./tiles-b.tsx"

/** `grid-area`: row start / column start / row end / column end, on a 12 × 10 grid. */
const TILES: readonly (readonly [string, ReactNode])[] = [
  ["1 / 1 / 5 / 4", <RailTile key="rail" />],
  ["1 / 4 / 4 / 9", <ComposerTile key="composer" />],
  ["1 / 9 / 2 / 12", <DotsTile key="dots" />],
  ["1 / 12 / 2 / 13", <MarkTile key="mark" />],
  ["2 / 9 / 4 / 13", <SwitchTile key="switch" />],
  ["4 / 4 / 5 / 7", <TabsTile key="tabs" />],
  ["4 / 7 / 5 / 9", <ThemeTile key="theme" />],
  ["4 / 9 / 5 / 13", <KeysTile key="keys" />],
  ["5 / 1 / 9 / 4", <BoardTile key="board" />],
  ["5 / 4 / 8 / 8", <DiffTile key="diff" />],
  ["5 / 8 / 8 / 11", <AgentMenuTile key="agents" />],
  ["5 / 11 / 7 / 13", <ChecksTile key="checks" />],
  ["7 / 11 / 8 / 13", <StartTile key="start" />],
  ["9 / 1 / 11 / 4", <UsageTile key="usage" />],
  ["8 / 4 / 11 / 7", <SearchTile key="search" />],
  ["8 / 7 / 11 / 10", <InboxTile key="inbox" />],
  ["8 / 10 / 9 / 13", <ToastTile key="toast" />],
  ["9 / 10 / 10 / 13", <PrTile key="pr" />],
  ["10 / 10 / 11 / 13", <WordmarkTile key="word" />],
]

export function Wall() {
  return (
    <main className="grid h-225 w-300 grid-cols-12 grid-rows-10 gap-2.5 overflow-hidden bg-paper p-4">
      {TILES.map(([area, tile], i) => (
        <section
          key={area}
          style={{ gridArea: area, animationDelay: `${i * 40}ms` }}
          className="wall-tile min-h-0 min-w-0 overflow-hidden rounded-md border-hairline border-line bg-surface px-3 py-2.5"
        >
          <div className="wall-body h-full min-h-0" style={{ animationDelay: `${650 + i * 40}ms` }}>
            {tile}
          </div>
        </section>
      ))}
    </main>
  )
}
