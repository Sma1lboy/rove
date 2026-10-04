/**
 * `bun e2e/atlas/contact-sheet.ts [--dir=…] [--cols=N] [--thumb=N]`
 *
 * Stitches the atlas frames into ONE tall PNG — every flow a labelled row, every
 * step a labelled cell — so the whole product can be reviewed in one scroll.
 *
 * There is no ImageMagick on this machine and ffmpeg's build is `--disable-filters`
 * (no `tile`, no `drawtext`), so the montage is laid out as HTML and photographed
 * with the Playwright already installed for the captures. It also writes the same
 * layout as `contact-sheet.html`, which stays interactive: click a frame for the
 * full-resolution original.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { chromium } from "@playwright/test"

const REPO_ROOT = resolve(import.meta.dirname, "../../../..")
const args = process.argv.slice(2)
function flag(name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
}
const DIR = resolve(flag("dir") ?? join(REPO_ROOT, ".scratch", "atlas"))
const COLS = Number(flag("cols") ?? 5)
const THUMB = Number(flag("thumb") ?? 420)

const manifestPath = join(DIR, "manifest.json")
if (!existsSync(manifestPath)) throw new Error(`no manifest at ${manifestPath} — run \`bun e2e/atlas/shoot.ts\` first`)

type Shot = {
  flow: string
  step: string
  index: number
  file: string
  subject: string
  failed?: string
  /** Byte-identical to the previous step — the step changed nothing on screen. */
  unchanged?: boolean
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  shotAt: string
  flows: ReadonlyArray<{ name: string; summary: string }>
  shots: readonly Shot[]
}

const byFlow = new Map<string, Shot[]>()
for (const shot of manifest.shots) {
  if (!shot.file) continue
  const list = byFlow.get(shot.flow) ?? []
  list.push(shot)
  byFlow.set(shot.flow, list)
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

const rows = manifest.flows
  .filter((flow) => byFlow.has(flow.name))
  .map((flow) => {
    const cells = byFlow
      .get(flow.name)!
      .map(
        (shot) => `
      <a class="cell${shot.failed ? " failed" : ""}${shot.unchanged ? " unchanged" : ""}" href="${esc(shot.file)}" target="_blank">
        <div class="shot"><img src="${esc(shot.file)}" loading="eager" /></div>
        <div class="cap">
          <span class="n">${shot.index + 1}</span>
          <span class="step">${esc(shot.step)}</span>
        </div>
        <div class="subject">${esc(shot.subject)}</div>
        ${shot.failed ? `<div class="err">step threw: ${esc(shot.failed)}</div>` : ""}
        ${shot.unchanged ? `<div class="dup">identical to the previous frame — this step changed nothing</div>` : ""}
      </a>`,
      )
      .join("")
    return `
    <section>
      <h2>${esc(flow.name)}<span class="sum">${esc(flow.summary)}</span></h2>
      <div class="grid">${cells}</div>
    </section>`
  })
  .join("")

const failedCount = manifest.shots.filter((s) => s.failed).length
const dupCount = manifest.shots.filter((s) => s.unchanged).length
const html = `<!doctype html>
<meta charset="utf-8" />
<title>Rove TUI atlas</title>
<style>
  :root { color-scheme: dark; --bg:#141210; --fg:#e8e2da; --dim:#8a8079; --line:#2c2722; --accent:#d98f6a; }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px 28px 56px; background:var(--bg); color:var(--fg);
         font:14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  h1 { font-size:22px; margin:0 0 4px; letter-spacing:.02em; }
  .meta { color:var(--dim); margin:0 0 28px; font-size:12px; }
  .meta b { color:var(--accent); font-weight:400; }
  section { margin:0 0 34px; }
  h2 { font-size:15px; margin:0 0 12px; padding-bottom:7px; border-bottom:1px solid var(--line);
       display:flex; align-items:baseline; gap:12px; color:var(--accent); }
  .sum { color:var(--dim); font-size:12px; font-weight:400; }
  .grid { display:grid; grid-template-columns:repeat(${COLS}, ${THUMB}px); gap:14px; }
  .cell { display:block; text-decoration:none; color:inherit; }
  .shot { border:1px solid var(--line); border-radius:3px; overflow:hidden; background:#0d0b0a; }
  .cell.failed .shot { border-color:#a5502f; }
  /* A duplicate frame is the failure the runner cannot throw on: it looks like
     a successful step. Mark it here too, or the sheet reads as 48 good frames. */
  .cell.unchanged .shot { border-color:#7a6a3a; }
  .cell.unchanged img { opacity:.55; }
  .dup { color:#c9a94e; font-size:11px; margin-top:3px; }
  img { display:block; width:100%; height:auto; }
  .cap { display:flex; gap:7px; align-items:baseline; margin-top:6px; font-size:12px; }
  .n { color:var(--bg); background:var(--dim); border-radius:2px; padding:0 5px; font-size:11px; }
  .cell.failed .n { background:#a5502f; color:#fff; }
  .step { color:var(--fg); }
  .subject { color:var(--dim); font-size:11px; line-height:1.4; margin-top:2px; }
  .err { color:#e08663; font-size:11px; margin-top:3px; }
</style>
<h1>Rove TUI atlas</h1>
<p class="meta">${manifest.shots.filter((s) => s.file).length} frames across <b>${byFlow.size}</b> flows · shot ${esc(manifest.shotAt)}${failedCount ? ` · <b>${failedCount} step(s) threw</b>` : ""}${dupCount ? ` · <b>${dupCount} unchanged</b>` : ""}</p>
${rows}
`

writeFileSync(join(DIR, "contact-sheet.html"), html)

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: COLS * (THUMB + 14) + 56, height: 1200 } })
  await page.goto(`file://${join(DIR, "contact-sheet.html")}`)
  await page.waitForLoadState("networkidle")
  const out = join(DIR, "contact-sheet.png")
  await page.screenshot({ path: out, fullPage: true })
  console.log(`${out}\n${join(DIR, "contact-sheet.html")}  (interactive — click a frame for full size)`)
} finally {
  await browser.close()
}
