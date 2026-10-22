/** Run with Bun: checkout-progress-capture.mjs <source-root> <output-dir> <before|after> <port>. */
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { chromium } from "@playwright/test"

const [sourceArg, outputArg, mode, portArg = "5573"] = process.argv.slice(2)
if (!sourceArg || !outputArg || !["before", "after"].includes(mode)) {
  throw new Error("usage: bun checkout-progress-capture.mjs <source-root> <output-dir> <before|after> [port]")
}
const source = resolve(sourceArg)
const output = resolve(outputArg)
const port = Number(portArg)
const root = mkdtempSync(join(tmpdir(), "rove-meter-"))
const home = join(root, "home")
const repo = join(root, "checkout-fixture")
const rove = join(source, "packages/rove")
const cli = join(rove, "dist/cli/rove.js")
const { buildFixtureEnv, writeFixtureWebToken, fixtureAuthHeaders } = await import(join(rove, "scripts/fixture-core.ts"))
const env = buildFixtureEnv({ root, home, ports: { webPort: port, ptyPort: port + 1 }, homePolicy: "redirect", extra: {
  LC_ALL: "C", LC_CTYPE: "C", LANG: "C", GIT_PROGRESS_DELAY: "0",
} })
for (const dir of [output, repo, join(home, ".config/rove"), join(home, ".runtime")]) mkdirSync(dir, { recursive: true })
await writeFixtureWebToken(home)
const version = JSON.parse(readFileSync(join(rove, "package.json"))).version
const skillVersion = readFileSync(join(rove, "dist/skills/rove/SKILL.md"), "utf8").match(/rove-skill-version:\s*(\d+)/)[1]
writeFileSync(join(home, ".config/rove/state.json"), JSON.stringify({
  "app.lastRunVersion": version, welcomed: true, skillHintSeen: "1", [`skillHintSeen:v${skillVersion}`]: "1", savedRepos: [repo],
}))
function run(command, args, cwd = rove) {
  return execFileSync(command, args, { cwd, env, encoding: "utf8" }).trim()
}
function api(...args) { return JSON.parse(run("bun", [cli, "api", ...args])) }
function git(...args) { return run("git", args, repo) }
git("init", "-q", "-b", "main")
git("config", "user.name", "Rove visual fixture")
git("config", "user.email", "visual@rove.local")
writeFileSync(join(repo, ".gitattributes"), "*.txt filter=slow\n")
for (let i = 0; i < 300; i++) writeFileSync(join(repo, `file-${i}.txt`), `Fixture file ${i}\n`)
git("add", ".")
git("commit", "-qm", "Seed checkout fixture")
// Delay actual blob checkout; Git still produces every progress frame itself.
const filter = join(root, "slow-smudge.py")
writeFileSync(filter, "import sys,time\ntime.sleep(0.06)\nsys.stdout.buffer.write(sys.stdin.buffer.read())\n")
git("config", "filter.slow.smudge", `python3 ${filter}`)
git("config", "filter.slow.clean", "cat")
git("config", "filter.slow.required", "true")
const { taskId } = api("add", `--repo=${repo}`, "--title=Slow checkout", "--command=claude", "--activate")
const launch = join(root, "launch.sh")
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
writeFileSync(launch, `#!/bin/sh\n${Object.entries(env).filter(([key]) => /^(HOME|XDG_|ROVE_)/.test(key)).map(([key, value]) => `export ${key}=${quote(value)}`).join("\n")}\ncd ${quote(rove)}\nexec bun run dev:sandbox\n`)
const serverLog = Bun.file(join(output, `${mode}-server.log`))
const server = Bun.spawn(["bun", "run", "dev.ts"], {
  cwd: join(source, "packages/rove-harness"), env: { ...env, ROVE_PTY_DEV_CWD: rove, ROVE_PTY_DEV_COMMAND: `/bin/sh ${quote(launch)}` },
  stdout: serverLog, stderr: serverLog,
})
let browser
let checkout
try {
  for (let i = 0; i < 100; i++) {
    if (await fetch(`http://localhost:${port}/harness`).then((r) => r.ok).catch(() => false)) break
    if (server.exitCode !== null) throw new Error("harness server exited")
    await Bun.sleep(200)
  }
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  const runId = `checkout-${mode}`
  await page.goto(`http://localhost:${port}/harness?run=${runId}`)
  const buffer = page.getByTestId("opentui-buffer")
  await page.waitForFunction(() => document.querySelector('[data-testid="opentui-buffer"]')?.textContent?.includes("checkout-fixture"), null, { timeout: 45000 })
  checkout = Bun.spawn(["bun", cli, "api", "ensure-worktree", `--task-id=${taskId}`], { cwd: rove, env, stdout: "pipe", stderr: "pipe" })
  if (mode === "after") {
    await page.waitForFunction(() => /[2-8]\d%/.test(document.querySelector('[data-testid="opentui-buffer"]')?.textContent ?? ""), null, { timeout: 45000 })
  } else {
    // The base has no numeric meter. Wait until checkout is underway and prove it remains active.
    await Bun.sleep(6000)
  }
  if (checkout.exitCode !== null) throw new Error("checkout finished before screenshot")
  await page.screenshot({ path: join(output, `${mode}.png`) })
  const text = await buffer.textContent()
  writeFileSync(join(output, `${mode}-buffer.txt`), text)
  if (mode === "after" && !/[2-8]\d%/.test(text)) throw new Error("screenshot missed progress")
  if (mode === "before" && /\d+%/.test(text)) throw new Error("baseline unexpectedly has a percentage")
  const code = await checkout.exited
  const result = await new Response(checkout.stdout).text()
  const error = await new Response(checkout.stderr).text()
  writeFileSync(join(output, `${mode}-checkout.json`), JSON.stringify({ code, result, error, root }, null, 2))
  if (code !== 0) throw new Error(`checkout failed: ${error}`)
  const { worktreePath } = JSON.parse(result)
  if (readFileSync(join(worktreePath, "file-299.txt"), "utf8") !== "Fixture file 299\n") throw new Error("checkout content mismatch")
  await page.request.post(`http://localhost:${port + 1}/pty/close`, { data: { tab: `visual-${runId}` }, headers: fixtureAuthHeaders() })
  console.log(JSON.stringify({ mode, root, output, taskId }))
} finally {
  if (checkout && checkout.exitCode === null) await checkout.exited
  await browser?.close()
  server.kill()
  await server.exited
  run("bun", [cli, "daemon", "stop"])
}
