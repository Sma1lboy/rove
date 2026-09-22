/**
 * Plugin marketplace: GitHub topics `rove-plugin` + legacy `kobe-plugin`, plus
 * a first-party list that doubles as the offline fallback. `fetchMarketplace`
 * is the data layer (also Settings → Marketplace).
 */

import { activeCliName } from "./rename-compat.ts"

const SEARCH_TIMEOUT_MS = 5_000
const CLI_NAME = activeCliName()

/** First-party examples under Sma1lboy/kobe-plugins/ — also the offline fallback. */
const FIRST_PARTY: readonly { ref: string; desc: string }[] = [
  { ref: "Sma1lboy/kobe-plugins/notify", desc: "Desktop/ntfy notifications when an agent finishes or needs input" },
  { ref: "Sma1lboy/kobe-plugins/github-start", desc: "Start a Rove task from a GitHub issue or PR" },
  { ref: "Sma1lboy/kobe-plugins/worktree-include", desc: "Copy .worktreeinclude-matched files into new worktrees" },
  { ref: "Sma1lboy/kobe-plugins/linear-start", desc: "Pick a Linear issue (fzf) and start a task on its branch" },
  { ref: "Sma1lboy/kobe-plugins/lazygit", desc: "lazygit on the task worktree, as a pane tab" },
  { ref: "Sma1lboy/kobe-plugins/browser", desc: "Chromium rendered as terminal cells (carbonyl) in a pane tab" },
]

export interface MarketEntry {
  readonly ref: string
  readonly desc: string
  readonly stars?: number
  readonly firstParty?: boolean
}

export interface MarketplaceResult {
  readonly entries: readonly MarketEntry[]
  /** Both topic searches failed — `entries` is the first-party list only. */
  readonly offline: boolean
}

async function fetchTopic(topic: string, query: string | undefined): Promise<MarketEntry[] | null> {
  const q = encodeURIComponent(`topic:${topic}${query ? ` ${query}` : ""}`)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=50`, {
      signal: ctrl.signal,
      headers: { accept: "application/vnd.github+json" },
    })
    if (!res.ok) return null
    const body = (await res.json()) as {
      items?: { full_name?: string; description?: string; stargazers_count?: number }[]
    }
    if (!Array.isArray(body.items)) return null
    return body.items
      .filter((r) => typeof r.full_name === "string")
      .map((r) => ({ ref: r.full_name as string, desc: r.description ?? "", stars: r.stargazers_count }))
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Both topics + seeds, de-duplicated by repo ref. Never rejects: offline
 *  returns the seeds with `offline: true` (the TUI has no error surface). */
export async function fetchMarketplace(query?: string): Promise<MarketplaceResult> {
  const topicResults = await Promise.all([fetchTopic("rove-plugin", query), fetchTopic("kobe-plugin", query)])
  const lower = query?.toLowerCase()
  const seeds = FIRST_PARTY.filter((s) => !lower || `${s.ref} ${s.desc}`.toLowerCase().includes(lower)).map((s) => ({
    ...s,
    firstParty: true,
  }))
  return {
    entries: dedupeEntries([...seeds, ...topicResults.flatMap((result) => result ?? [])]),
    offline: topicResults.every((result) => result === null),
  }
}

export async function searchMarketplace(query: string | undefined): Promise<void> {
  const { entries, offline } = await fetchMarketplace(query)
  if (offline) {
    console.error("(GitHub search unreachable — showing first-party plugins only)")
  }
  if (entries.length === 0) {
    console.log(query ? `no plugins match \`${query}\`` : "no plugins found")
    return
  }
  const width = Math.min(48, Math.max(...entries.map((e) => e.ref.length)) + 2)
  for (const e of entries) {
    const stars = e.stars !== undefined ? `★${e.stars}` : e.firstParty ? "first-party" : ""
    console.log(`${e.ref.padEnd(width)}${stars.padEnd(12)}${e.desc}`)
  }
  console.log(`\ninstall: ${CLI_NAME} plugin install <owner/repo[/subdir]> — browse: https://rove.run/plugins`)
}

function dedupeEntries(entries: readonly MarketEntry[]): MarketEntry[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    const key = entry.ref.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
