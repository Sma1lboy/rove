import { PassThrough } from "node:stream"
import { validateModTree } from "@sma1lboy/rove-plugin-sdk/contract"
import { describe, expect, it } from "vitest"
import { Box, Button, Input, Text, runMod } from "../src/mod.ts"

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

  it("hands a submitted input value to onSubmit and subscribes to the events it listens for", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const lines: Record<string, unknown>[] = []
    output.on("data", (chunk) => {
      for (const l of chunk.toString().trim().split("\n")) lines.push(JSON.parse(l))
    })
    const got: string[] = []
    const mod = runMod({ input, output })
    mod.pane("main", "T", Input({ key: "note", placeholder: "note", onSubmit: (v) => void got.push(v) }))
    mod.on("task.created", (e) => void got.push(`event:${e.taskId}`))
    expect(lines.at(-1)).toEqual({ type: "subscribe", events: ["task.created"] })

    input.write(`${JSON.stringify({ type: "submit", pane: "main", key: "note", value: "buy milk" })}\n`)
    input.write(`${JSON.stringify({ type: "event", event: { event: "task.created", taskId: "T1" } })}\n`)
    await new Promise((r) => setTimeout(r, 10))
    expect(got).toEqual(["buy milk", "event:T1"])
  })
})
