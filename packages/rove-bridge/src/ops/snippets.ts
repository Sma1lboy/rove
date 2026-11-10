/**
 * Prompt snippets: a name and some text, typed back as `@name` in a web composer. They live in
 * state.json so every client of this Mac sees one list. The text is only ever inserted into a
 * prompt the user is writing; nothing here runs it or hands it to the Mac as a command.
 */

import { type StateSnapshot, loadStateFile, updateStateFile } from "@sma1lboy/rove/src/state/store.ts"
import { BridgeError } from "../protocol.ts"
import { text } from "./args.ts"
import type { OpTable } from "./types.ts"

export const SNIPPETS_KEY = "prompt.snippets"
export const SNIPPET_NAME = /^[A-Za-z0-9][\w-]{0,31}$/
export const SNIPPET_TEXT_MAX = 8000
export const SNIPPETS_MAX = 100

export interface Snippet {
  readonly name: string
  readonly text: string
}

/** Entries that don't fit the shape are dropped, so a hand-edited state.json can't break the list. */
export function readSnippets(state: StateSnapshot): Snippet[] {
  const raw = state[SNIPPETS_KEY]
  if (!Array.isArray(raw)) return []
  const out: Snippet[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const { name, text: body } = item as Record<string, unknown>
    if (typeof name === "string" && SNIPPET_NAME.test(name) && typeof body === "string" && body.length > 0) {
      out.push({ name, text: body })
    }
  }
  return out
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export interface SnippetsDeps {
  readonly load: () => StateSnapshot
  /** Locked read-modify-write: `compute` sees the file as it is now. */
  readonly update: (compute: (fresh: StateSnapshot) => StateSnapshot) => void
}

const realDeps: SnippetsDeps = {
  load: loadStateFile,
  update: (compute) =>
    void updateStateFile((state) => {
      const next = compute(state)
      for (const [key, value] of Object.entries(next)) state[key] = value
      return undefined
    }),
}

function name(a: Readonly<Record<string, unknown>>): string {
  const value = text(a, "name", 32)
  if (!SNIPPET_NAME.test(value)) {
    throw new BridgeError(
      "BAD_ARGS",
      "name must be letters, digits, - or _ (up to 32), starting with a letter or digit",
    )
  }
  return value
}

export function createSnippetOps(deps: SnippetsDeps): OpTable {
  return {
    "snippets.get": {
      kind: "read",
      destructive: false,
      wraps: "state.json prompt.snippets (name and text pairs)",
      async run() {
        return { snippets: readSnippets(deps.load()) }
      },
    },
    "snippets.save": {
      kind: "write",
      destructive: false,
      wraps: "state.json prompt.snippets: adds a snippet, or replaces the one with that name (case-insensitive)",
      async run(a) {
        const key = name(a)
        const body = text(a, "text", SNIPPET_TEXT_MAX)
        deps.update((fresh) => {
          const all = readSnippets(fresh)
          const index = all.findIndex((s) => same(s.name, key))
          if (index < 0 && all.length >= SNIPPETS_MAX)
            throw new BridgeError("BAD_ARGS", `at most ${SNIPPETS_MAX} snippets`)
          if (index < 0) all.push({ name: key, text: body })
          else all[index] = { name: key, text: body }
          return { [SNIPPETS_KEY]: all }
        })
        return { snippets: readSnippets(deps.load()) }
      },
    },
    "snippets.remove": {
      kind: "write",
      destructive: true,
      wraps: "state.json prompt.snippets: drops the snippet with that name (case-insensitive)",
      async run(a) {
        const key = name(a)
        deps.update((fresh) => ({ [SNIPPETS_KEY]: readSnippets(fresh).filter((s) => !same(s.name, key)) }))
        return { snippets: readSnippets(deps.load()) }
      },
    },
  }
}

export const snippetOps: OpTable = createSnippetOps(realDeps)
