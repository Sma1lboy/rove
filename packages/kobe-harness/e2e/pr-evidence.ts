/** Exact-revision screenshots through /harness → xterm → PTY → dev:sandbox. */
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium, expect, type Page } from "@playwright/test"
import { fixtureAuthHeaders } from "../../kobe/scripts/fixture-core.ts"
import { type EvidenceFixture, makeFixture, OUTPUT, REPO } from "./pr-evidence-fixture.ts"

const label = process.env.EVIDENCE_LABEL ?? "local"
const scope = process.env.EVIDENCE_SCENARIO ?? "all"
const after = label === "after"
const captures: { file: string; scenario: string; description: string }[] = []
const errors: { scenario: string; error: string }[] = []
await mkdir(OUTPUT, { recursive: true })
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim()
if (process.env.EVIDENCE_SHA && !sha.startsWith(process.env.EVIDENCE_SHA)) throw new Error("Unexpected product commit")
const browser = await chromium.launch({ headless: true })

async function waitFor(check: () => Promise<boolean>, message: string, timeout = 45_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(message)
}

async function press(page: Page, key: string) {
  const input = page.locator(".xterm-helper-textarea")
  await input.focus()
  await input.press(key)
  await page.waitForTimeout(250)
}

async function shot(page: Page, name: string, description: string, terminal = true) {
  await page.waitForTimeout(600)
  const file = `${label}-${name}.png`
  await page.screenshot({ path: join(OUTPUT, file), animations: "disabled" })
  const text = terminal ? await page.getByTestId("opentui-buffer").textContent() : await page.locator("body").innerText()
  await writeFile(join(OUTPUT, `${label}-${name}.txt`), text ?? "")
  captures.push({ file, scenario: name, description })
}

async function open(f: EvidenceFixture, page: Page, run: string, ready: string) {
  await waitFor(async () => {
    try { return (await fetch(`http://127.0.0.1:${f.port}/harness`)).ok } catch { return false }
  }, "Vite did not become ready")
  await page.goto(`http://127.0.0.1:${f.port}/harness?run=${run}`)
  await expect(page.getByTestId("opentui-harness")).toHaveAttribute("data-pty-status", "open", { timeout: 45_000 })
  await expect(page.getByTestId("opentui-buffer")).toContainText(ready, { timeout: 45_000 })
}

async function closeTui(f: EvidenceFixture, page: Page, run: string) {
  // Capture the real source TUI's PID before the sidecar's fire-and-forget kill.
  // Its exit handler flushes state and detaches hosted sessions asynchronously.
  const tuiPids = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" }).split("\n")
    .filter((line) => line.trimEnd().endsWith("--conditions=browser ./src/cli/rove.ts"))
    .map((line) => Number(line.trim().split(/\s+/)[0]))
  const response = await page.request.post(`http://127.0.0.1:${f.port + 1}/pty/close`, {
    data: { tab: `visual-${run}` }, headers: fixtureAuthHeaders(),
  })
  if (!response.ok()) throw new Error(`Could not close capture TUI: ${response.status()}`)
  await page.goto("about:blank")
  if (tuiPids.length !== 1) throw new Error(`Expected one capture TUI, found ${tuiPids.length}`)
  await waitFor(async () => tuiPids.every((pid) => {
    try { process.kill(pid, 0); return false } catch { return true }
  }), "Capture TUI did not finish exiting", 12_000)
}

async function withFixture(name: string, port: number, welcome: boolean, action: (f: EvidenceFixture, page: Page) => Promise<void>) {
  const f = await makeFixture(name, port, welcome)
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(String(error)))
  try {
    await f.start()
    await action(f, page)
  } catch (error) {
    await page.screenshot({ path: join(OUTPUT, `${label}-${name}-failure.png`) }).catch(() => {})
    await writeFile(join(OUTPUT, `${label}-${name}-failure.txt`), await page.locator("body").innerText().catch(() => ""))
    throw error
  } finally {
    await writeFile(join(OUTPUT, `${name}-browser-errors.json`), JSON.stringify(pageErrors, null, 2))
    await page.close()
    await f.stop()
  }
}

async function onboarding() {
  await withFixture("onboarding", 5373, true, async (f, page) => {
    const buffer = page.getByTestId("opentui-buffer")
    await open(f, page, "welcome", "Install shell completions")
    await shot(page, "onboarding-completions", "Fresh HOME; first-run completion question")
    await press(page, "ArrowUp")
    await press(page, "Enter")
    await expect(buffer).toContainText("Rove agent skill")
    if (after) await expect(buffer).toContainText("Optional")
    await shot(page, "onboarding-skill", "Completion accepted; skill question at its default selection; queued status visible after change")
    await press(page, "Escape")
    await expect(buffer).not.toContainText("Rove agent skill")
    if (after) await waitFor(async () => {
      const state = JSON.parse(await readFile(join(f.paths.configDir, "rove/state.json"), "utf8"))
      return state.welcomePendingCompletions === "bash"
    }, "Accepted completion choice was not retained after dismissing the skill question")
    await closeTui(f, page, "welcome")
    await writeFile(join(OUTPUT, `${label}-onboarding-dismissed-state.json`), await readFile(join(f.paths.configDir, "rove/state.json"), "utf8"))
  })
  await withFixture("onboarding-keys", 5375, true, async (f, page) => {
    const buffer = page.getByTestId("opentui-buffer")
    await open(f, page, "welcome-keys", "Install shell completions")
    await press(page, "ArrowDown")
    await press(page, "Enter")
    await expect(buffer).toContainText("Rove agent skill")
    // Down assigns No; it never toggles the current yes/no selection.
    await press(page, "ArrowDown")
    await press(page, "Enter")
    await expect(buffer).toContainText("Keyboard basics")
    await shot(page, "onboarding-keys", "Both optional installs skipped; final keyboard guidance")
    await press(page, "Enter")
    await expect(buffer).not.toContainText("Keyboard basics")
    await closeTui(f, page, "welcome-keys")
  })
}

async function isolation() {
  await withFixture("isolation", 5473, false, async (f, page) => {
    await open(f, page, "empty", "Welcome to Rove")
    await expect(page.getByTestId("opentui-buffer")).toContainText("not signed in")
    if (after) await expect(page.getByTestId("opentui-buffer")).toContainText("Directory and project tasks")
    await shot(page, "empty-workspace", "No tasks; Codex fixture binary, no account; managed-task isolation explanation")
    await closeTui(f, page, "empty")
  })
}

async function hooks() {
  await withFixture("hooks", 5573, false, async (f, page) => {
    const buffer = page.getByTestId("opentui-buffer")
    await open(f, page, "hooks-settings", "Welcome to Rove")
    await page.getByTestId("opentui-terminal").click({ position: { x: 24, y: 400 } })
    await press(page, "n")
    await expect(buffer).toContainText("New task")
    if (after) await expect(buffer).toContainText("/hooks")
    await shot(page, "new-task-hooks", "New task; Codex selected; fixture CLI installed and signed out")
    await press(page, "Escape")
    await page.getByTestId("opentui-terminal").click({ position: { x: 24, y: 400 } })
    await press(page, "s")
    await expect(buffer).toContainText("General")
    await press(page, "ArrowDown")
    await expect(buffer).toContainText("Codex")
    if (after) await expect(buffer).toContainText("/hooks")
    await shot(page, "settings-hooks", "Settings → Engines; isolated fixture HOME contains no private accounts")
    await closeTui(f, page, "hooks-settings")
    const task = f.api(["add", "--repo", f.paths.repo, "--branch", "rove/evidence", "--title", "Hook fixture", "--command", "codex", "--prompt", "fixture readiness", "--activate"])
    await open(f, page, "hooks-engine", "fixture engine process")
    if (after) await expect(buffer).toContainText("/hooks")
    await shot(page, "engine-hooks-waiting", "Real fixture PTY attached; no vendor hook event emitted")
    const id = task.taskId ?? task.task.id
    f.run(["hook", "session-start", "--engine", "codex"], JSON.stringify({ session_id: "pr-evidence-session", cwd: task.task.worktreePath }), {
      ROVE_TASK_ID: id, KOBE_TASK_ID: id, ROVE_TAB_ID: "tab-1", KOBE_TAB_ID: "tab-1",
    })
    if (after) await expect(buffer).toContainText("Hook event recorded for this tab")
    await shot(page, "engine-hooks-received", "Fixture SessionStart payload sent through real hook CLI and daemon")
    await writeFile(join(OUTPUT, `${label}-hooks-inspect.json`), JSON.stringify(f.api(["inspect"]), null, 2))
    await closeTui(f, page, "hooks-engine")
  })
}

async function recovery() {
  await withFixture("recovery", 5673, false, async (f, page) => {
    f.api(["add", "--repo", f.paths.repo, "--branch", "rove/evidence", "--title", "Recovery fixture", "--command", "codex", "--prompt", "fixture recovery", "--activate"])
    await open(f, page, "recovery-live", "fixture engine process")
    if (after) await expect(page.getByTestId("opentui-buffer")).toContainText("Live process reattached")
    await shot(page, "recovery-live", "CLI-started real hosted PTY reattached by a fresh TUI")
    await writeFile(join(OUTPUT, `${label}-live-inspect.json`), JSON.stringify(f.api(["inspect"]), null, 2))
    await closeTui(f, page, "recovery-live")
    const pid = Number((await readFile(f.paths.ptyPidPath, "utf8")).trim())
    if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error("Invalid isolated PTY host PID")
    // SIGTERM preserves the real host's freeze records; `rove reset` would discard them.
    process.kill(pid, "SIGTERM")
    await waitFor(async () => {
      try { process.kill(pid, 0); return false } catch { return true }
    }, "Fixture PTY host did not stop")
    await open(f, page, "recovery-relaunch", "fixture engine process")
    if (after) await expect(page.getByTestId("opentui-buffer")).toContainText("Command relaunched in a new process")
    await shot(page, "recovery-relaunched", "Real PTY host terminated after freeze; fresh TUI starts a new process with retained historical output")
    await writeFile(join(OUTPUT, `${label}-relaunched-inspect.json`), JSON.stringify(f.api(["inspect"]), null, 2))
    await closeTui(f, page, "recovery-relaunch")
  })
}

async function landing() {
  const server = Bun.spawn(["python3", "-m", "http.server", "5773", "--bind", "127.0.0.1"], {
    cwd: join(REPO, "packages/kobe-landing"), stdout: Bun.file(join(OUTPUT, "landing-server.log")), stderr: "inherit",
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: "reduce" })
  try {
    await waitFor(async () => { try { return (await fetch("http://127.0.0.1:5773")).ok } catch { return false } }, "Landing server not ready")
    await page.goto("http://127.0.0.1:5773", { waitUntil: "networkidle" })
    await page.locator("#copyBtn").waitFor()
    await shot(page, "install-posix", "Actual landing DOM; macOS/Linux entry point", false)
    const selector = page.locator("#installOs")
    if (await selector.count()) {
      await selector.selectOption("windows")
      await expect(page.locator("#copyBtn")).toContainText("npm install -g")
    }
    await shot(page, "install-windows", "Windows selection after change; previous generic install entry point before change", false)
    if (await selector.count()) await selector.selectOption("wsl")
    await shot(page, "install-wsl", "WSL selection after change; previous generic install entry point before change", false)
  } finally {
    await page.close()
    server.kill()
    await server.exited
  }
}

try {
  for (const [name, action] of Object.entries({ onboarding, hooks, recovery, isolation, install: landing })) {
    if (scope !== "all" && scope !== name) continue
    try { await action() } catch (error) {
      errors.push({ scenario: name, error: error instanceof Error ? error.stack ?? error.message : String(error) })
      console.error(`${name}: ${String(error)}`)
    }
  }
} finally {
  await browser.close()
  await writeFile(join(OUTPUT, "capture.json"), JSON.stringify({
    sha, requestedSha: process.env.EVIDENCE_SHA, label, scope, viewport: "1280x800", deviceScaleFactor: 1,
    capture: "/harness → xterm.js → node-pty sidecar → bun run dev:sandbox → real OpenTUI",
    theme: "claude / dark / opaque", locale: "en", fixture: "isolated HOME, scratch git repo, signed-out Codex fixture process; no account or model",
    toolingFiles: ["pr-evidence.ts", "pr-evidence-fixture.ts"],
    limitations: ["Fixture hook payload proves UI reporting, not real vendor trust or conversation resumption", "Historical-only dead-process frame is not captured by this recipe"],
    captures, errors,
  }, null, 2))
}
if (captures.length === 0 || errors.length > 0) process.exitCode = 1
