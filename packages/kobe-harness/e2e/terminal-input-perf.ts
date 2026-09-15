/** Run against an isolated visual fixture with a shell tab:
 * HEADED=1 TEST_URL=http://localhost:5273 node e2e/terminal-input-perf.ts /tmp/rpaint-run
 * WebGL in headless Chromium can delay painting; record that mode explicitly. */
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium } from "@playwright/test"

type Sent = { prefix: string; at: number }
type Wire = { at: number; data: string }
type Probe = {
  record: boolean
  socket: WebSocket | null
  observer: MutationObserver | null
  prompt: string
  samples: number[]
  sent: string
  pending: Sent[]
  sends: Sent[]
  wire: Wire[]
}
declare global {
  interface Window { terminalProbe: Probe }
}
const root = process.argv[2]
if (!root || !/^\/tmp\/rpaint-[a-zA-Z0-9-]+$/.test(root)) throw new Error("expected /tmp/rpaint-<run> output directory")
await mkdir(root, { recursive: true })
const headed = process.env.HEADED === "1"
const browser = await chromium.launch({ headless: !headed })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.addInitScript(() => {
  const probe: Probe = { record: false, socket: null, observer: null, prompt: "", samples: [], sent: "", pending: [], sends: [], wire: [] }
  window.terminalProbe = probe
  const original = WebSocket.prototype.send
  WebSocket.prototype.send = function(data) {
    if (!probe.socket) {
      probe.socket = this
      this.addEventListener("message", (event) => {
        if (probe.record) probe.wire.push({ at: performance.now(), data: typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data) })
      })
    }
    if (probe.record && typeof data === "string" && /^[a-z]$/.test(data)) {
      probe.sent += data
      const item = { prefix: probe.sent, at: performance.now() }
      probe.pending.push(item)
      probe.sends.push(item)
    }
    return original.call(this, data)
  }
})
const text = "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwx"
const results: Array<{ name: string; delay: number; samples: number[]; pending: number; sends: Sent[]; wire: Wire[] }> = []
const buffer = page.getByTestId("opentui-buffer")
async function waitFor(needle: string) {
  await page.waitForFunction((value) => document.querySelector('[data-testid="opentui-buffer"]')?.textContent?.includes(value), needle, { timeout: 45000 })
}
async function measure(name: string, prompt: string, delay: number) {
  await page.evaluate((prompt) => {
    const p = window.terminalProbe
    p.samples = []; p.sent = ""; p.pending = []; p.record = true; p.wire = []; p.sends = []; p.prompt = prompt
    p.observer = new MutationObserver(() => {
      const text = document.querySelector('[data-testid="opentui-buffer"]')?.textContent ?? ""
      const now = performance.now()
      p.pending = p.pending.filter((item) => {
        if (!text.includes(p.prompt + item.prefix)) return true
        p.samples.push(now - item.at)
        return false
      })
    })
    const el = document.querySelector('[data-testid="opentui-buffer"]')
    if (!el) throw new Error("missing harness buffer")
    p.observer.observe(el, { childList: true, subtree: true, characterData: true })
  }, prompt)
  await page.keyboard.type(text, { delay })
  await waitFor(prompt + text)
  await page.waitForTimeout(300)
  const sample = await page.evaluate(() => {
    const p = window.terminalProbe
    p.observer?.disconnect(); p.record = false
    return { samples: p.samples, pending: p.pending.length, sends: p.sends, wire: p.wire }
  })
  if (sample.samples.length !== text.length || sample.pending) throw new Error(`${name}: missing echoes`)
  results.push({ name, delay, ...sample })
  await page.screenshot({ path: `${root}/${name}.png` })
  await page.keyboard.press("Control+u")
  await page.waitForTimeout(300)
}
try {
  await page.goto(`${process.env.TEST_URL ?? "http://localhost:5273"}/harness?run=latency`)
  await waitFor("fixture-repo")
  // Fixture task, then its auto-created shell tab, in the 1280x800 grid.
  await page.mouse.click(120, 152)
  await page.keyboard.press("Enter")
  await page.waitForTimeout(400)
  await page.mouse.click(110, 168)
  await page.keyboard.press("Enter")
  await page.waitForTimeout(800)
  await page.mouse.click(600, 300)
  await page.keyboard.press("Control+c")
  await page.waitForTimeout(400)
  await page.keyboard.type("PS1='PERF> '; clear")
  await page.keyboard.press("Enter")
  await waitFor("PERF>")
  await page.waitForTimeout(500)
  await measure("idle", "PERF> ", 100)
  await measure("typing", "PERF> ", 12)
  const workload = resolve(import.meta.dirname, "terminal-stream.py")
  await page.keyboard.type(`python3 '${workload.replaceAll("'", "'\\''")}'`)
  await page.keyboard.press("Enter")
  await waitFor("STREAM FRAME")
  await waitFor("中文 e\u0301 🦊")
  await measure("streaming", "STREAM> ", 12)
  await page.keyboard.type("abcdef", { delay: 20 })
  for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace")
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-testid="opentui-buffer"]')?.textContent ?? ""
    return text.includes("STREAM> abc") && !text.includes("STREAM> abcd")
  })
  await page.screenshot({ path: `${root}/backspace.png` })
  await page.keyboard.press("Control+c")
  await waitFor("PERF>")
  await page.keyboard.type("printf 'UNICODE 中文 🦊\\n'")
  await page.keyboard.press("Enter")
  await waitFor("UNICODE 中文 🦊")
  await page.screenshot({ path: `${root}/unicode.png` })
  await writeFile(`${root}/buffer.txt`, await buffer.textContent() ?? "")
  const summary = results.map((result) => {
    const samples = [...result.samples].sort((a, b) => a - b)
    return { name: result.name, n: samples.length, p50: samples[Math.floor(samples.length * .5)], p95: samples[Math.floor(samples.length * .95)] }
  })
  await writeFile(`${root}/latency.json`, JSON.stringify({ headed, viewport: { width: 1280, height: 800 }, summary, results }, null, 2))
  console.log(JSON.stringify(summary))
} finally {
  await browser.close()
}
