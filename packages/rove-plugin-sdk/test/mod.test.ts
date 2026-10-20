import { PassThrough } from "node:stream"
import { validateModTree } from "@sma1lboy/rove-plugin-sdk/contract"
import { describe, expect, it } from "vitest"
import { Box, Button, Text, runMod } from "../src/mod.ts"

describe("runMod", () => {
  it("sends a tree the host accepts and calls onPress for a press from the host", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const lines: string[] = []
    output.on("data", (chunk) => lines.push(...chunk.toString().trim().split("\n")))
    let pressed = 0
    const mod = runMod({ input, output })
    mod.pane(
      "main",
      "T",
      Box({ children: [Text("hi"), Button({ key: "go", label: "Go", onPress: () => void pressed++ })] }),
    )

    const sent = JSON.parse(lines[0] ?? "{}")
    expect(sent).toMatchObject({ type: "pane", id: "main", title: "T" })
    expect(validateModTree(sent.tree).ok).toBe(true)

    input.write(`${JSON.stringify({ type: "press", pane: "main", key: "go" })}\n`)
    await new Promise((r) => setTimeout(r, 10))
    expect(pressed).toBe(1)
  })
})
