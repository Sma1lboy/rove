/**
 * The Chat tab's data: an `output.read` history page (the engine's neutral `Message`s, claude and codex alike) as the
 * readable entries the tab draws, merged page by page as older ones load and new ones arrive. Pure, so the shaping,
 * search and export rules can be tested without a page.
 */

/** The slice of an `output.read` reply the tab reads. */
export interface ReadReply {
  readonly source?: "history" | "terminal"
  readonly history?: {
    readonly messages?: readonly RawMessage[]
    readonly firstIndex?: number
    readonly totalMessages?: number
  }
  readonly terminal?: { readonly tail?: readonly string[] }
  readonly cursor?: string | null
  readonly olderCursor?: string | null
  readonly fallbackReason?: string | null
}

export interface RawMessage {
  readonly role?: string
  readonly timestamp?: string
  readonly blocks?: readonly RawBlock[]
}

export type RawBlock = {
  readonly type?: string
  readonly text?: string
  readonly callId?: string
  readonly name?: string
  readonly input?: unknown
  readonly output?: unknown
  readonly isError?: boolean
}

export interface ToolLine {
  readonly callId: string
  readonly name: string
  /** The one argument that says what the call did: a command, a path, a pattern. */
  readonly summary: string
}

export interface Entry {
  /** Transcript index: stable while the conversation grows, and what a page's `firstIndex` counts. */
  readonly index: number
  readonly role: "user" | "assistant" | "system"
  readonly at: string
  readonly text: string
  readonly tools: readonly ToolLine[]
}

export interface Transcript {
  /** Ascending by index, one per message that has something to read. */
  readonly entries: readonly Entry[]
  /** Calls whose result came back as an error; a result may land on a later page than its call. */
  readonly failed: ReadonlySet<string>
}

export const EMPTY: Transcript = { entries: [], failed: new Set() }

const SUMMARY_KEYS = ["command", "cmd", "file_path", "path", "pattern", "query", "url", "description", "prompt"]
const SUMMARY_CHARS = 100

function clip(text: string): string {
  const line = (text.split("\n").find((l) => l.trim() !== "") ?? "").trim()
  return line.length > SUMMARY_CHARS ? `${line.slice(0, SUMMARY_CHARS - 1)}…` : line
}

/** What a tool call was about, from its vendor-shaped input: a command line, a file, a pattern; "" when none reads as text. */
export function toolSummary(input: unknown): string {
  if (typeof input === "string") return clip(input)
  if (!input || typeof input !== "object") return ""
  const fields = input as Record<string, unknown>
  const as = (value: unknown): string =>
    typeof value === "string"
      ? value
      : Array.isArray(value) && value.every((v) => typeof v === "string")
        ? value.join(" ")
        : ""
  for (const key of SUMMARY_KEYS) {
    const text = as(fields[key])
    if (text.trim()) return clip(text)
  }
  for (const value of Object.values(fields)) {
    const text = as(value)
    if (text.trim()) return clip(text)
  }
  return ""
}

function roleOf(role: string | undefined): Entry["role"] | null {
  return role === "user" || role === "assistant" || role === "system" ? role : null
}

/** One history page's messages as entries; a message that only carries tool results or thinking has nothing to read and is skipped. */
function parsePage(messages: readonly RawMessage[], firstIndex: number): { entries: Entry[]; failed: string[] } {
  const entries: Entry[] = []
  const failed: string[] = []
  messages.forEach((message, offset) => {
    const role = roleOf(message.role)
    if (!role) return
    const texts: string[] = []
    const tools: ToolLine[] = []
    for (const block of message.blocks ?? []) {
      if (block.type === "text" && block.text?.trim()) texts.push(block.text.trim())
      else if (block.type === "tool_call") {
        tools.push({ callId: block.callId ?? "", name: block.name ?? "tool", summary: toolSummary(block.input) })
      } else if (block.type === "tool_result" && block.isError && block.callId) failed.push(block.callId)
    }
    if (texts.length === 0 && tools.length === 0) return
    entries.push({ index: firstIndex + offset, role, at: message.timestamp ?? "", text: texts.join("\n\n"), tools })
  })
  return { entries, failed }
}

/** `page` folded into `base`: its entries replace any of the same index, and the whole stays in index order. */
export function addPage(base: Transcript, messages: readonly RawMessage[], firstIndex: number): Transcript {
  const page = parsePage(messages, firstIndex)
  const byIndex = new Map(base.entries.map((entry) => [entry.index, entry]))
  for (const entry of page.entries) byIndex.set(entry.index, entry)
  const failed = page.failed.length > 0 ? new Set([...base.failed, ...page.failed]) : base.failed
  return { entries: [...byIndex.values()].sort((a, b) => a.index - b.index), failed }
}

/** Indexes of the entries whose words or tool lines hold `query` (case-insensitive), in order. */
export function findEntries(entries: readonly Entry[], query: string): number[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  return entries
    .filter(
      (entry) =>
        entry.text.toLowerCase().includes(needle) ||
        entry.tools.some((tool) => `${tool.name} ${tool.summary}`.toLowerCase().includes(needle)),
    )
    .map((entry) => entry.index)
}

/** A palette conversation hit (`sessions.search`): when it was said, by whom, and the words around the match. */
export interface HitRef {
  readonly at: string
  readonly role: string
  readonly snippet: string
}

/** Words only: the search snippet and the message may differ in ellipses, spacing and emphasis marks. */
const plain = (text: string): string =>
  text
    .replace(/[*_`]+/g, "")
    .replace(/[…\s]+/g, " ")
    .trim()
    .toLowerCase()

/** The entry a hit points at: the one stamped with its time and role, else the first by that role holding its words. */
export function locateHit(entries: readonly Entry[], hit: HitRef): number | null {
  const exact = entries.find((entry) => entry.at === hit.at && entry.role === hit.role)
  if (exact) return exact.index
  const words = plain(hit.snippet)
  if (!words) return null
  return entries.find((entry) => entry.role === hit.role && plain(entry.text).includes(words))?.index ?? null
}

/** Whether a hit can still be older than what is loaded: the oldest entry is later than it (or has no time to compare). */
export function hitIsOlder(entries: readonly Entry[], hit: HitRef): boolean {
  const first = entries[0]
  if (!first) return true
  const [a, b] = [Date.parse(first.at), Date.parse(hit.at)]
  return Number.isNaN(a) || Number.isNaN(b) ? true : a > b
}

/** One message as Markdown, for Copy and Export: its words, then its tool calls as one line each. */
export function entryMarkdown(entry: Entry, failed: ReadonlySet<string>): string {
  const calls = entry.tools.map(
    (tool) =>
      `- \`${tool.name}\`${tool.summary ? ` ${tool.summary}` : ""}${failed.has(tool.callId) ? " (failed)" : ""}`,
  )
  return [entry.text, calls.join("\n")].filter((part) => part !== "").join("\n\n")
}

/** What Copy puts on the clipboard: the words alone, or the tool lines when the message said nothing. */
export function entryCopyText(entry: Entry, failed: ReadonlySet<string>): string {
  return entry.text !== "" ? entry.text : entryMarkdown(entry, failed)
}

/** The whole loaded thread as a Markdown document. */
export function exportMarkdown(
  title: string,
  entries: readonly Entry[],
  failed: ReadonlySet<string>,
  names: { readonly user: string; readonly assistant: string; readonly system: string },
): string {
  const parts = entries.map((entry) => {
    const head = `## ${names[entry.role]}${entry.at ? ` · ${entry.at}` : ""}`
    return `${head}\n\n${entryMarkdown(entry, failed)}`
  })
  return `# ${title}\n\n${parts.join("\n\n")}\n`
}
