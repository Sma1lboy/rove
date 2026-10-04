/**
 * Record a film's take: drive the live TUI through `/harness` on the warm hero
 * stack and save what the PTY printed, redacted, as `films/<name>.cast.gz`.
 * No video is recorded here — `render.ts` makes every frame from the cast.
 */

import { writeFile } from "node:fs/promises"
import { gzipSync } from "node:zlib"
import { chromium } from "@playwright/test"
import { look } from "../hero-capture.ts"
import { fixtureAuthHeaders, HERO_PTY_PORT, HERO_WEB_PORT } from "../hero-env.ts"
import { castPath, type Film, type TakeSession, VIEWPORT } from "./film.ts"
import { assertCastClean, redactCast } from "./redact.ts"

/**
 * Exact strings a take must never show, registered at RUN time — a real API
 * key a storyboard needs cannot be written into this committed file.
 * Short strings are ignored: a two-character "secret" matches half the screen.
 */
const forbiddenLiterals: string[] = []

export function forbidLiteral(value: string): void {
  const v = value.trim()
  if (v.length >= 12) forbiddenLiterals.push(v)
}

async function pty(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`http://127.0.0.1:${HERO_PTY_PORT}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...fixtureAuthHeaders() },
  })
  if (!res.ok && res.status !== 404) throw new Error(`${path}: HTTP ${res.status}`)
  return res
}

export async function take(film: Film): Promise<string> {
  const runId = `take-${film.name}-${Date.now()}`
  const tab = `visual-${runId}`
  const wallpaper = film.wallpaper ? `&wallpaper=${encodeURIComponent(film.wallpaper)}` : ""
  const url = `http://localhost:${HERO_WEB_PORT}/harness?run=${runId}${wallpaper}`
  const browser = await chromium.launch({ headless: true })
  let cast: string | null = null
  try {
    const page = await browser.newPage({ viewport: film.viewport ?? VIEWPORT })
    await page.goto(url)
    await page.getByTestId("opentui-harness").waitFor({ timeout: 15_000 })
    // Until the TUI has taken the terminal over, keys land in a shell.
    await look(page, film.ready ?? "orbit-sdk", 60_000)
    await page.getByTestId("opentui-terminal").click({ position: { x: 24, y: 400 } })
    await page.waitForTimeout(2_000)
    const cue = async (label: string): Promise<void> => {
      const res = await pty("/pty/mark", { method: "POST", body: JSON.stringify({ tab, label }) })
      if (res.status === 404) throw new Error("the PTY sidecar is not recording — restart hero-serve.ts")
    }
    const session: TakeSession = {
      async close() {
        await pty("/pty/close", { method: "POST", body: JSON.stringify({ tab }) })
      },
      async reopen() {
        await page.goto(url)
        await page.getByTestId("opentui-harness").waitFor({ timeout: 15_000 })
      },
    }
    await film.take(page, cue, session)
  } finally {
    // Read the recording before the close; the close must happen on EVERY exit
    // so a failed take cannot leave a TUI running on the fixture.
    cast = await (await pty(`/pty/cast?tab=${tab}`)).text()
    await pty("/pty/close", { method: "POST", body: JSON.stringify({ tab }) })
    await browser.close()
  }
  if (!cast) throw new Error(`no recording for ${tab}`)
  const redacted = redactCast(cast, forbiddenLiterals)
  await assertCastClean(redacted, forbiddenLiterals)
  const path = castPath(film.name)
  await writeFile(path, gzipSync(redacted, { level: 9 }))
  await film.afterTake?.()
  return path
}
