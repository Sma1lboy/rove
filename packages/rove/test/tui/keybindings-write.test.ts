import { describe, expect, it } from "vitest"
import { type KeybindingEdit, editKeybindingsYaml } from "../../src/tui/lib/keybindings-write"

const keymap = () => [
  { id: "chat.tab.new", scope: "workspace", keys: ["ctrl+t"], prefixKeys: ["t"] },
  { id: "focus.sidebar", scope: "workspace", keys: ["ctrl+q"], prefixKeys: ["q"] },
  { id: "sidebar.nav", scope: "sidebar", keys: ["j", "k", "down", "up"] },
]

const edit = (text: string, change: KeybindingEdit, platform: NodeJS.Platform = "darwin") =>
  editKeybindingsYaml(text, change, keymap(), platform)

const textOf = (result: ReturnType<typeof edit>): string => {
  if (!result.ok) throw new Error(result.reasons.join("; "))
  return result.text
}

describe("editKeybindingsYaml", () => {
  it("adds a direct chord to an empty file and keeps the file's comments", () => {
    const out = textOf(edit("# mine\n", { id: "chat.tab.new", mode: "direct", keys: ["ctrl+g"] }))
    expect(out).toContain("# mine")
    expect(out).toContain("chat.tab.new: ctrl+g")
  })

  it("writes a prefix stroke under prefix.bindings and leaves other entries alone", () => {
    const out = textOf(
      edit("bindings:\n  focus.sidebar: ctrl+o # keep\n", { id: "chat.tab.new", mode: "prefix", keys: ["n"] }),
    )
    expect(out).toContain("focus.sidebar: ctrl+o # keep")
    expect(out).toMatch(/prefix:\n {2}bindings:\n {4}chat\.tab\.new: n/)
  })

  it("drops a platform entry that would win over the new chord", () => {
    const before = "bindings:\n  chat.tab.new: ctrl+g\ndarwin:\n  bindings:\n    chat.tab.new: cmd+t\n"
    const out = textOf(edit(before, { id: "chat.tab.new", mode: "direct", keys: ["ctrl+y"] }))
    expect(out).toContain("chat.tab.new: ctrl+y")
    expect(out).not.toContain("cmd+t")
    expect(out).not.toContain("darwin")
  })

  it("restores the default by removing the override", () => {
    const out = textOf(
      edit("bindings:\n  chat.tab.new: ctrl+g\n", { id: "chat.tab.new", mode: "direct", keys: "default" }),
    )
    expect(out).not.toContain("chat.tab.new")
    expect(out).not.toContain("{}")
  })

  it("unbinds with null", () => {
    expect(textOf(edit("", { id: "chat.tab.new", mode: "direct", keys: [] }))).toContain("chat.tab.new: null")
  })

  it("refuses a chord the loader would drop, with the loader's reason", () => {
    const bare = edit("", { id: "chat.tab.new", mode: "direct", keys: ["g"] })
    expect(bare).toMatchObject({ ok: false })
    expect(!bare.ok && bare.reasons.join(" ")).toContain("steal typed input")
    expect(edit("", { id: "sidebar.nav", mode: "direct", keys: ["w"] })).toMatchObject({ ok: false })
  })

  it("refuses to touch a file that does not parse", () => {
    expect(edit("bindings: [", { id: "chat.tab.new", mode: "direct", keys: ["ctrl+g"] })).toMatchObject({ ok: false })
  })
})
