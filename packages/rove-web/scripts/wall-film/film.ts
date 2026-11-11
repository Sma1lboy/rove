// Films src/wall frame by frame: the page clock moves one frame, then a screenshot, so the result is exactly 60 fps.
//   bunx vite dev --port 5197 --strictPort            (in packages/rove-web)
//   bun scripts/wall-film/film.ts http://localhost:5197/wall.html <outDir> 17.4 60
//   ffmpeg -framerate 60 -i <outDir>/f%05d.jpg -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -movflags +faststart wall.mp4
// A fifth argument "1400,5000" writes PNG stills at those milliseconds instead. CHROME overrides the browser binary.
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
const [url, out, secs, fpsArg, only] = process.argv.slice(2)
const fps = Number(fpsArg ?? 30)
const stills = only ? only.split(",").map(Number) : null
const CHROME =
  process.env.CHROME ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const port = 9400 + Math.floor(Math.random() * 300)
mkdirSync(out, { recursive: true })
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    "--hide-scrollbars",
    "--no-first-run",
    `--user-data-dir=${out}/.profile`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
)
await Bun.sleep(3000)
const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as {
  type: string
  webSocketDebuggerUrl: string
}[]
const ws = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl)
await new Promise((r) => {
  ws.onopen = r
})
let id = 0
const waits = new Map<number, (v: { data: string }) => void>()
ws.onmessage = (m) => {
  const d = JSON.parse(String(m.data))
  if (d.id && waits.has(d.id)) {
    waits.get(d.id)!(d.result ?? d.error)
    waits.delete(d.id)
  }
}
const send = (method: string, params: object = {}) =>
  new Promise<{ data: string }>((r) => {
    waits.set(++id, r)
    ws.send(JSON.stringify({ id, method, params }))
  })
await send("Page.enable")
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1.6, mobile: false })
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: await Bun.file(`${import.meta.dir}/clock-inject.js`).text(),
})
await send("Page.navigate", { url })
await Bun.sleep(3000)
await send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => 1)", awaitPromise: true })
const step = 1000 / fps
const total = Math.round(Number(secs) * fps)
for (let f = 0; f < total; f++) {
  await send("Runtime.evaluate", { expression: `__advance(${step})`, awaitPromise: true })
  const ms = Math.round((f + 1) * step)
  if (stills && !stills.some((s) => Math.abs(s - ms) < step / 2)) continue
  const shot = await send("Page.captureScreenshot", { format: stills ? "png" : "jpeg", quality: 95 })
  writeFileSync(
    `${out}/f${String(stills ? ms : f).padStart(5, "0")}.${stills ? "png" : "jpg"}`,
    Buffer.from(shot.data, "base64"),
  )
}
ws.close()
chrome.kill()
console.log("frames", total)
