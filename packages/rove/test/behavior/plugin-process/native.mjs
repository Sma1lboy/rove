// Run with Bun itself: the Windows bug is in the host runtime's spawn implementation.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { release, tmpdir } from "node:os"
import { join } from "node:path"
import { runPluginHook } from "../../../../rove-daemon/src/plugins/hook-run.ts"
import { ModHost } from "../../../../rove-daemon/src/plugins/mod-host.ts"
import { pluginLogPath } from "../../../../rove-daemon/src/plugins/plugin-paths.ts"

assert.ok(process.versions.bun, "The plugin host must run under Bun")
const baseline = process.argv.includes("--baseline")
const root = mkdtempSync(join(tmpdir(), "rove-native-plugins-"))
const fixture = join(import.meta.dirname, "child.mjs")
function command(home, mode, generation = "initial") {
  const args = [process.execPath, fixture, mode, home, generation]
  if (process.platform !== "win32") return args
  const wrapper = join(home, `${generation}-${mode}.cmd`)
  writeFileSync(wrapper, `@echo off\r\n${args.map((arg) => `"${arg}"`).join(" ")}\r\n`)
  return [process.env.ComSpec ?? "cmd.exe", "/d", "/c", wrapper]
}
const results = []
const owners = new Set()
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
async function waitFor(predicate, timeout = 8000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(50)
  }
  assert.ok(predicate(), "condition did not become true before deadline")
}
async function check(name, action) {
  try {
    await action()
    results.push({ name, pass: true })
  } catch (error) {
    results.push({ name, pass: false, error: String(error) })
  }
  console.log(JSON.stringify(results.at(-1)))
}
function pids(dir, generation, mode) {
  return [mode, "descendant", "leaf"].map((role) => {
    try {
      const pid = Number(readFileSync(join(dir, `${generation}-${role}.pid`), "utf8"))
      if (!Number.isInteger(pid) || pid <= 1) return 0
      owners.add(pid)
      return pid
    } catch {
      return 0
    }
  })
}
async function started(dir, generation, mode) {
  await waitFor(() => pids(dir, generation, mode).every((pid) => pid > 0 && alive(pid)))
  return pids(dir, generation, mode)
}
function cleanup() {
  for (const pid of owners) {
    if (!alive(pid)) continue
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" })
      else process.kill(pid, "SIGKILL")
    } catch {}
  }
}
try {
  for (const action of ["stop", "disable", "replacement"]) {
    const home = join(root, action)
    mkdirSync(home)
    const host = new ModHost({ homeDir: home, socketPath: "unused", binPath: "rove", publish() {} })
    const spec = { pluginId: "test.native", root: home, mod: { command: command(home, "mod") } }
    host.sync([spec])
    try {
      const tree = await started(home, "initial", "mod")
      await check(`mod ${action}: pane and press`, async () => {
        await waitFor(() => host.panes()[0]?.tree.children[0]?.text === "Native count: 0")
        assert.equal(host.press("test.native", "counter", "inc"), "sent")
        await waitFor(() => host.panes()[0]?.tree.children[0]?.text === "Native count: 1")
      })
      if (action === "stop") host.stop()
      else if (action === "disable") host.sync([])
      else host.sync([{ ...spec, mod: { command: command(home, "mod", "replacement") } }])
      await check(`mod ${action}: descendants terminated`, () => waitFor(() => tree.every((pid) => !alive(pid))))
      if (action === "replacement") {
        const replacement = await started(home, "replacement", "mod")
        await check("replacement mod publishes", () => waitFor(() => host.panes().length === 1))
        host.stop()
        await check("replacement mod stop reaps descendants", () =>
          waitFor(() => replacement.every((pid) => !alive(pid))),
        )
      }
    } finally {
      host.stop()
      cleanup()
    }
  }
  const outputHome = join(root, "output")
  mkdirSync(outputHome)
  await check("hook captures stdout and stderr", async () => {
    await runPluginHook({
      homeDir: outputHome,
      pluginId: "test.output",
      pluginRoot: outputHome,
      socketPath: "unused",
      binPath: "rove",
      spec: { command: command(outputHome, "output") },
      kind: "startup",
      label: "output",
      extraEnv: {},
    })
    const log = readFileSync(pluginLogPath("test.output", outputHome), "utf8")
    assert.match(log, /hook stdout received/)
    assert.match(log, /hook stderr received/)
  })
  for (const action of ["timeout", "shutdown"]) {
    const home = join(root, action)
    mkdirSync(home)
    const inFlight = new Set()
    const run = runPluginHook({
      homeDir: home,
      pluginId: "test.hook",
      pluginRoot: home,
      socketPath: "unused",
      binPath: "rove",
      spec: {
        command: command(home, "hook"),
        timeoutMs: action === "timeout" ? 4000 : 120000,
      },
      kind: "startup",
      label: action,
      extraEnv: {},
      inFlight,
    })
    try {
      const tree = await started(home, "initial", "hook")
      if (action === "shutdown") for (const kill of inFlight) kill()
      await check(`hook ${action}: descendants terminated`, () => waitFor(() => tree.every((pid) => !alive(pid))))
    } finally {
      cleanup()
      await run
    }
    await check(`hook ${action}: captured output after close`, () => {
      const log = readFileSync(pluginLogPath("test.hook", home), "utf8")
      assert.match(log, /hanging hook ready/)
      if (action === "timeout") assert.match(log, /"timedOut":true/)
      assert.equal(inFlight.size, 0)
    })
  }
} finally {
  cleanup()
}
const report = {
  platform: process.platform,
  os: release(),
  bun: process.versions.bun,
  executable: process.execPath,
  baseline,
  results,
}
const out = process.env.ROVE_PLUGIN_REPORT ?? join(root, "report.json")
writeFileSync(out, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (baseline) {
  assert.equal(process.platform, "win32")
  assert.ok(
    results.some((r) => !r.pass && r.name.includes("pane and press")),
    "baseline must reproduce lost mod stdout",
  )
  assert.ok(
    results.some((r) => !r.pass && r.name === "hook captures stdout and stderr"),
    "baseline must reproduce lost hook output",
  )
  assert.ok(
    results.some((r) => !r.pass && r.name.includes("descendants terminated")),
    "baseline must reproduce orphaned descendants",
  )
} else
  assert.ok(
    results.every((r) => r.pass),
    "native plugin behavior failed",
  )
