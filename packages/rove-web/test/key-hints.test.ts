import { describe, expect, test } from "bun:test"
import { touchHint } from "../src/key-hints.ts"

describe("a legend on a touch screen", () => {
  test("keeps what it says and drops the keys a soft keyboard lacks, in both languages", () => {
    expect(touchHint("who hands prompts to whom · click a session to open it · q close")).toBe(
      "who hands prompts to whom · click a session to open it",
    )
    expect(
      touchHint(
        "enter open the focused action · tab fields · ←→ status · unlink returns the card to Backlog · esc save & close",
      ),
    ).toBe("unlink returns the card to Backlog")
    expect(touchHint("已选 2 项 · enter 切换选中 · ctrl+a 全选 · 创建 导入")).toBe("已选 2 项 · 创建 导入")
  })

  test("a sentence opening with 'a' or 'I' is not a key", () => {
    expect(touchHint("a tap opens it · I/O stays live · x drop")).toBe("a tap opens it · I/O stays live")
  })

  test("a legend made only of keys says nothing", () => {
    expect(touchHint("ctrl+s save · enter/ctrl+enter save & start · tab fields · esc cancel")).toBe("")
    expect(touchHint("↑↓/tab 移动 · enter 按下 · esc 返回")).toBe("")
    expect(touchHint("· q to close")).toBe("")
  })
})
