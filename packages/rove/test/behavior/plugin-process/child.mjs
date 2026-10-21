import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const [mode, root, generation = "initial"] = process.argv.slice(2)
writeFileSync(join(root, `${generation}-${mode}.pid`), String(process.pid))
if (mode === "leaf") {
  setInterval(() => {}, 1000)
} else if (mode === "descendant") {
  spawn(process.execPath, [import.meta.filename, "leaf", root, generation], { stdio: "inherit" })
  setInterval(() => {}, 1000)
} else if (mode === "output") {
  console.log("hook stdout received")
  console.error("hook stderr received")
} else {
  spawn(process.execPath, [import.meta.filename, "descendant", root, generation], { stdio: "inherit" })
  if (mode === "mod") {
    let count = 0
    const draw = () =>
      console.log(
        JSON.stringify({
          type: "pane",
          id: "counter",
          title: "Windows Counter",
          tree: {
            type: "box",
            direction: "column",
            children: [
              { type: "text", text: `Native count: ${count}` },
              { type: "button", key: "inc", label: "Increment native counter" },
            ],
          },
        }),
      )
    draw()
    let pending = ""
    process.stdin.on("data", (chunk) => {
      pending += chunk
      let newline = pending.indexOf("\n")
      while (newline >= 0) {
        const message = JSON.parse(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
        newline = pending.indexOf("\n")
        if (message.type === "press") {
          count++
          draw()
        }
      }
    })
  } else console.log("hanging hook ready")
  setInterval(() => {}, 1000)
}
