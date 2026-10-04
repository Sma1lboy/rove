import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "../../../..")
const harnessDir = resolve(root, "packages/rove-harness")
const require = createRequire(resolve(harnessDir, "package.json"))
const { chromium } = await import(require.resolve("@playwright/test"))
const output = resolve(root, "packages/rove/.scratch/issue-1206-ui")
const home = "/private/tmp/rove-1206-evidence"
const token = randomBytes(32).toString("hex")
mkdirSync(`${home}/.rove`, { recursive: true })
mkdirSync(`${home}/.config/rove`, { recursive: true })
writeFileSync(`${home}/.rove/web-token`, token, { mode: 0o600 })
writeFileSync(
  `${home}/.config/rove/state.json`,
  JSON.stringify({
    activeTheme: "claude",
    themeMode: "dark",
    transparentBackground: false,
    savedRepos: [],
  }),
)
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(ROVE_|KOBE_|CLAUDE)/.test(key)))
Object.assign(env, {
  HOME: home,
  XDG_CONFIG_HOME: `${home}/.config`,
  XDG_CACHE_HOME: `${home}/.cache`,
  ROVE_HOME_DIR: home,
  ROVE_DAEMON_SOCKET_PATH: `${home}/unused.sock`,
  ROVE_PTY_PORT: "5575",
  VITE_ROVE_WEB_TOKEN: token,
  TMPDIR: "/private/tmp",
})
const viteLog = Bun.file(`${output}/vite.log`)
const vite = Bun.spawn(["bun", "run", "vite", "dev", "--port", "5573", "--strictPort"], {
  cwd: harnessDir,
  env,
  stdout: viteLog,
  stderr: viteLog,
})
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const browser = await chromium.launch({ headless: true })
const metadata: unknown[] = []
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await fetch("http://localhost:5573/harness")
        .then((r) => r.ok)
        .catch(() => false)
    )
      break
    await Bun.sleep(100)
  }
  for (const state of ["before", "after"]) {
    const sidecarLog = Bun.file(`${output}/${state}-sidecar.log`)
    const sidecar = Bun.spawn(["node", "pty-server.mjs"], {
      cwd: harnessDir,
      env: {
        ...env,
        ROVE_PTY_PARENT_PIPE: "1",
        ROVE_PTY_DEV_CWD: resolve(root, "packages/rove"),
        ROVE_PTY_DEV_COMMAND: `exec env HOME=${quote(home)} XDG_CONFIG_HOME=${quote(`${home}/.config`)} ROVE_HOME_DIR=${quote(home)} ROVE_DAEMON_SOCKET_PATH=${quote(`${home}/unused.sock`)} bun ${quote(`${output}/${state}.js`)}`,
      },
      stdin: "pipe",
      stdout: sidecarLog,
      stderr: sidecarLog,
    })
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          await fetch("http://localhost:5575/__rove_harness")
            .then((r) => r.ok)
            .catch(() => false)
        )
          break
        await Bun.sleep(100)
      }
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
      await page.goto(`http://localhost:5573/harness?run=issue-1206-${state}-${Date.now()}`)
      const buffer = page.getByTestId("opentui-buffer")
      await page.waitForFunction(
        (expected: string) => document.querySelector('[data-testid="opentui-buffer"]')?.textContent?.includes(expected),
        state === "before" ? "1/6" : "2/3",
        { timeout: 30000 },
      )
      await page.waitForTimeout(700)
      const text = await buffer.textContent()
      assert.ok(text?.includes(state === "before" ? "alpha 1/6" : "orbit-sdk 2/3"))
      writeFileSync(`${import.meta.dirname}/${state}.txt`, text ?? "")
      await page.screenshot({ path: `${import.meta.dirname}/${state}.png` })
      metadata.push({
        state,
        viewport: "1280x800",
        dpr: 1,
        sidecarPid: sidecar.pid,
        page: page.url(),
        expectedBoard: state === "before" ? "alpha 1/6" : "orbit-sdk 2/3",
        screenshotSha256: createHash("sha256")
          .update(readFileSync(`${import.meta.dirname}/${state}.png`))
          .digest("hex"),
      })
      // Enter opens the highlighted card through xterm -> PTY keyboard input.
      await page.getByTestId("opentui-terminal").click({ position: { x: 1100, y: 700 } })
      await page.keyboard.press("Enter")
      await page.waitForTimeout(500)
      const detail = (await buffer.textContent()) ?? ""
      assert.equal(detail.includes("#7  open  created 2026-10-04"), state === "after")
      writeFileSync(`${import.meta.dirname}/${state}-detail.txt`, detail)
      await page.screenshot({ path: `${import.meta.dirname}/${state}-detail.png` })
      await page.close()
    } finally {
      sidecar.stdin.end()
      await sidecar.exited
    }
  }
} finally {
  await browser.close()
  vite.kill()
  await vite.exited
  writeFileSync(
    `${import.meta.dirname}/capture.json`,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        build: JSON.parse(readFileSync(`${output}/build.json`, "utf8")),
        capture: "/harness -> xterm.js -> node-pty sidecar -> Bun -> real OpenTUI KanbanPage",
        fixture:
          "Three Windows-shaped repository roots; active/focused task T1; linked story 7; no saved repos. Fixed orchestrator responses; no native Windows filesystem or live daemon.",
        theme: "claude, dark, opaque",
        vitePid: vite.pid,
        metadata,
      },
      null,
      2,
    ),
  )
}
