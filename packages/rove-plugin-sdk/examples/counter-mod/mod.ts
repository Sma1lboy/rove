/**
 * The mod's whole state lives here, so the TUI and the web always agree:
 * press "+1" in the browser and the TUI redraws the same count; a note typed
 * in the TUI shows up in the browser.
 */
import { Box, Button, Input, RoveSocket, Text, runMod } from "@sma1lboy/rove-plugin-sdk"

const mod = runMod()
let count = 0
let tasks: number | null = null
let lastCreated: string | null = null
const notes: string[] = []

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
        Input({
          key: "note",
          placeholder: "Add a note and press Enter",
          onSubmit: (value) => {
            if (!value.trim()) return
            notes.push(value.trim())
            draw()
          },
        }),
        ...notes.map((note) => Text(`• ${note}`)),
        Text({ text: tasks === null ? "Tasks: connecting…" : `Tasks: ${tasks}`, tone: "muted" }),
        Text({ text: `Last task created: ${lastCreated ?? "none yet"}`, tone: "muted" }),
      ],
    }),
  )
}

function bump(delta: number): void {
  count += delta
  draw()
}

// Plugin events reach a running mod directly; no `[[events]]` hook needed.
mod.on("task.created", (event) => {
  lastCreated = event.task?.title ?? event.taskId ?? "?"
  draw()
})

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
