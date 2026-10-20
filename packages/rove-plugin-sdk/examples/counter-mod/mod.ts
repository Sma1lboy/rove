/**
 * The mod's whole state lives here, so the TUI and the web always agree:
 * press "+1" in the browser and the TUI redraws the same count.
 */
import { Box, Button, RoveSocket, Text, runMod } from "@sma1lboy/rove-plugin-sdk"

const mod = runMod()
let count = 0
let tasks: number | null = null

function draw(): void {
  mod.pane(
    "main",
    "Counter",
    Box({
      direction: "column",
      gap: 1,
      children: [
        Text({ text: `Count: ${count}`, bold: true }),
        Box({
          direction: "row",
          gap: 2,
          children: [
            Button({ key: "inc", label: "+1", tone: "success", onPress: () => bump(1) }),
            Button({ key: "dec", label: "-1", onPress: () => bump(-1) }),
            Button({ key: "reset", label: "Reset", tone: "warning", onPress: () => bump(-count) }),
          ],
        }),
        Text({ text: tasks === null ? "Tasks: connecting…" : `Tasks: ${tasks}`, tone: "muted" }),
      ],
    }),
  )
}

function bump(delta: number): void {
  count += delta
  draw()
}

function connect(): void {
  const daemon = new RoveSocket()
  daemon.onClose(() => {
    tasks = null
    draw()
    setTimeout(connect, 1000)
  })
  daemon
    .connect()
    .then(() =>
      daemon.subscribe(
        (name, payload) => {
          if (name !== "task.snapshot") return
          tasks = ((payload as { tasks?: unknown[] }).tasks ?? []).length
          draw()
        },
        ["task.snapshot"],
      ),
    )
    .catch(() => {}) // onClose scheduled the retry
}

draw()
connect()
