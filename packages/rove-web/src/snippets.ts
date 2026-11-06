/**
 * Prompt snippets: a name and some text, typed as `@name` in a composer. The list is kept by the Mac
 * (`snippets.*`), so every browser and phone shows the same one.
 */

import type { BridgeClient } from "./bridge.ts"
import { createStore, useStore } from "./store.ts"

export interface Snippet {
  readonly name: string
  readonly text: string
}

interface Reply {
  readonly snippets: readonly Snippet[]
}

const store = createStore<readonly Snippet[]>([])

export const useSnippets = (): readonly Snippet[] => useStore(store)

export async function loadSnippets(client: BridgeClient): Promise<void> {
  store.set((await client.request<Reply>("snippets.get")).snippets)
}

export async function saveSnippet(client: BridgeClient, snippet: Snippet): Promise<void> {
  store.set((await client.request<Reply>("snippets.save", { name: snippet.name, text: snippet.text })).snippets)
}

export async function removeSnippet(client: BridgeClient, name: string): Promise<void> {
  store.set((await client.request<Reply>("snippets.remove", { name })).snippets)
}

/** A snippet name as the Mac accepts it. */
export const SNIPPET_NAME = /^[A-Za-z0-9][\w-]{0,31}$/

/** `start`..`end` spans the whole `@word`; `query` is the part before the caret. */
export interface SnippetToken {
  readonly start: number
  readonly end: number
  readonly query: string
}

/** The `@word` the caret is in the middle of or right after: it starts a word and holds only name characters. */
export function snippetToken(text: string, caret: number): SnippetToken | null {
  let i = caret
  while (i > 0 && /[\w-]/.test(text[i - 1] ?? "")) i--
  if (i === 0 || text[i - 1] !== "@") return null
  const before = text[i - 2]
  if (before !== undefined && !/\s/.test(before)) return null
  let end = caret
  while (end < text.length && /[\w-]/.test(text[end] ?? "")) end++
  return { start: i - 1, end, query: text.slice(i, caret) }
}

/** Snippets whose name starts with what was typed, the exact name first. */
export function matchSnippets(all: readonly Snippet[], query: string): Snippet[] {
  const q = query.toLowerCase()
  const hits = all.filter((s) => s.name.toLowerCase().startsWith(q))
  return [...hits.filter((s) => s.name.toLowerCase() === q), ...hits.filter((s) => s.name.toLowerCase() !== q)]
}

/** `text` with the `@query` at `start` replaced by the snippet, and where the caret goes. */
export function expandSnippet(text: string, token: SnippetToken, snippet: Snippet): { text: string; caret: number } {
  return {
    text: text.slice(0, token.start) + snippet.text + text.slice(token.end),
    caret: token.start + snippet.text.length,
  }
}
