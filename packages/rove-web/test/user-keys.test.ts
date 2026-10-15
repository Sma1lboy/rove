import { afterEach, describe, expect, test } from "bun:test"
import { RoveKeymap } from "@sma1lboy/rove/src/tui/context/keybindings-table.ts"
import { type KeyPress, chordCandidates } from "../src/chord.ts"
import { allCommands, registerCommands } from "../src/commands.ts"
import {
  DEFAULT_USER_KEYS,
  type PluginChord,
  type UserKeys,
  pluginChordsLive,
  pluginHit,
  prefixHint,
  setUserKeys,
  userKeys,
} from "../src/user-keys.ts"

const press = (key: string, extra: Partial<KeyPress> = {}): KeyPress => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
})

const row = (id: string) => RoveKeymap.find((r) => r.id === id)

describe("chordCandidates", () => {
  test("a typed letter, an uppercase one (shift form first), and a named key", () => {
    expect(chordCandidates(press("n"))).toEqual(["n"])
    expect(chordCandidates(press("P", { shiftKey: true }))).toEqual(["shift+p", "p"])
    expect(chordCandidates(press("Enter"))).toEqual(["return", "enter"])
    expect(chordCandidates(press("ArrowDown"))).toEqual(["down"])
    expect(chordCandidates(press(" "))).toEqual(["space"])
  })

  test("modifiers come in the dispatcher's order and shift only joins a named key", () => {
    expect(chordCandidates(press("a", { ctrlKey: true }))).toEqual(["ctrl+a"])
    expect(chordCandidates(press("k", { metaKey: true, altKey: true }))).toEqual(["cmd+alt+k"])
    expect(chordCandidates(press("Tab", { shiftKey: true }))).toEqual(["shift+tab"])
    expect(chordCandidates(press("F1"))).toEqual(["f1"])
  })

  test("Ctrl+Shift+letter has no chord, so it can never fire the plain Ctrl+letter binding", () => {
    expect(chordCandidates(press("A", { ctrlKey: true, shiftKey: true }))).toEqual([])
  })

  test("Option names the physical key, not the character a Mac types for it", () => {
    expect(chordCandidates(press("å", { altKey: true, code: "KeyA" }))).toEqual(["alt+a"])
    expect(chordCandidates(press("¡", { altKey: true, code: "Digit1" }))).toEqual(["alt+1"])
  })
})

describe("the user's keybindings.yaml on the page", () => {
  afterEach(() => setUserKeys(DEFAULT_USER_KEYS))

  const file = (over: Partial<UserKeys>): UserKeys => ({ ...DEFAULT_USER_KEYS, exists: true, ...over })

  test("rows the file changed are written onto the keymap, and a later file without them restores the defaults", () => {
    setUserKeys(file({ rows: [{ id: "task.new.global", keys: [], prefixKeys: ["t"] }] }))
    expect(row("task.new.global")?.prefixKeys).toEqual(["t"])
    setUserKeys(DEFAULT_USER_KEYS)
    expect(row("task.new.global")?.prefixKeys).toEqual(["n"])
  })

  test("the prefix hint shows the user's key and stroke, and nothing when the layer is off", () => {
    expect(prefixHint("task.new.global")).toBe("⌃ A n")
    setUserKeys(
      file({
        prefix: { key: "ctrl+b", firstStrokes: ["ctrl+b"], timeoutMs: 5000 },
        rows: [{ id: "task.new.global", keys: [], prefixKeys: ["t"] }],
      }),
    )
    expect(prefixHint("task.new.global")).toBe("⌃ B t")
    setUserKeys(file({ prefix: { key: null, firstStrokes: [], timeoutMs: 5000 } }))
    expect(prefixHint("task.new.global")).toBe("")
    expect(userKeys.get().prefix.key).toBeNull()
  })

  describe("commands", () => {
    const run = () => {}
    registerCommands(() => [
      { id: "task.new.global", chords: ["n"], prefix: true, run },
      { id: "chat.tab.close", chords: ["w"], prefix: true, run },
      { id: "chat.tab.rename", chords: ["f2"], prefix: false, surface: "workspace", run },
    ])
    const of = (id: string, prefix: boolean) => allCommands().find((c) => c.id === id && c.prefix === prefix)

    test("an id the file rebinds runs on the file's chords; the others keep theirs", () => {
      setUserKeys(
        file({
          rows: [
            { id: "task.new.global", keys: [], prefixKeys: ["t"] },
            { id: "chat.tab.rename", keys: ["ctrl+g"] },
          ],
        }),
      )
      expect(of("task.new.global", true)?.chords).toEqual(["t"])
      expect(of("chat.tab.rename", false)?.chords).toEqual(["ctrl+g"])
    })

    test("unbinding leaves the command with no chord", () => {
      setUserKeys(file({ rows: [{ id: "chat.tab.rename", keys: [] }] }))
      expect(of("chat.tab.rename", false)?.chords).toEqual([])
    })

    test("a direct chord for an id the web reaches only by prefix becomes its own command, scoped as the keymap scopes it", () => {
      setUserKeys(file({ rows: [{ id: "task.new.global", keys: ["ctrl+g"], prefixKeys: ["n"] }] }))
      expect(of("task.new.global", false)).toMatchObject({ chords: ["ctrl+g"] })
      expect(of("task.new.global", true)?.chords).toEqual(["n"])
    })

    test("a file that only moved the prefix stroke does not invent a direct chord from the row's defaults", () => {
      setUserKeys(file({ rows: [{ id: "chat.tab.close", keys: ["ctrl+w"], prefixKeys: ["x"] }] }))
      expect(allCommands().some((c) => c.id === "chat.tab.close" && !c.prefix)).toBe(false)
    })
  })
})

describe("plugin chords against the TUI's dispatch", () => {
  const ping: PluginChord = { chord: "ctrl+k", kind: "action", target: "acme.ping" }
  const board: PluginChord = { chord: "f8", kind: "pane", target: "acme.board" }
  const upper: PluginChord = { chord: "shift+p", kind: "pane", target: "acme.upper" }
  const lower: PluginChord = { chord: "p", kind: "pane", target: "acme.lower" }

  test("a press is matched by candidate order, not by the order of the file: shift+p beats p", () => {
    expect(pluginHit([lower, upper], chordCandidates(press("P", { shiftKey: true })))).toBe(upper)
    expect(pluginHit([lower, upper], chordCandidates(press("p")))).toBe(lower)
  })

  test("a chord the file does not bind is no hit, and a modifier is part of the chord", () => {
    expect(pluginHit([ping, board], chordCandidates(press("k")))).toBeUndefined()
    expect(pluginHit([ping, board], chordCandidates(press("k", { ctrlKey: true })))).toBe(ping)
    expect(pluginHit([ping, board], chordCandidates(press("F8")))).toBe(board)
  })

  test("live like the TUI's pagesClosed: off under a dialog, Worktrees or Update; Kanban and the rest stay live", () => {
    expect(pluginChordsLive({ dialog: false, page: null })).toBe(true)
    expect(pluginChordsLive({ dialog: false, page: "kanban" })).toBe(true)
    expect(pluginChordsLive({ dialog: true, page: null })).toBe(false)
    expect(pluginChordsLive({ dialog: false, page: "worktrees" })).toBe(false)
    expect(pluginChordsLive({ dialog: false, page: "update" })).toBe(false)
  })
})
