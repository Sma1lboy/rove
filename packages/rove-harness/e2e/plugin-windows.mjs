import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir, release } from "node:os"
import { join, resolve } from "node:path"
import { buildFixtureEnv, writeFixtureWebToken } from "../../rove/scripts/fixture-core.ts"
import { savePluginRegistry } from "../../rove-daemon/src/plugins/registry.ts"

const baseline = process.argv.includes("--baseline")
const repo = resolve(import.meta.dirname, "../../..")
const root = mkdtempSync(join(tmpdir(), "rove-plugin-clients-"))
const home = join(root, "home")
const evidence = process.env.ROVE_PLUGIN_REPORT ? resolve(process.env.ROVE_PLUGIN_REPORT, "..") : join(root, "evidence")
mkdirSync(evidence, { recursive: true })
const label = baseline ? "baseline" : "head"
const env = buildFixtureEnv({ root, home, homePolicy: "redirect", ports: { webPort: 5273, ptyPort: 5274 } })
const cli = join(repo, "packages/rove/src/cli/rove.ts")
const child = join(repo, "packages/rove/test/behavior/plugin-process/child.mjs")
const configDir = join(home, ".config/rove")
mkdirSync(configDir, { recursive: true })
writeFileSync(join(configDir, "state.json"), JSON.stringify({
  welcomed: true, "app.lastRunVersion": JSON.parse(readFileSync(join(repo, "packages/rove/package.json"))).version,
  skillHintSeen: "1", ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`skillHintSeen:v${i}`, "1"])),
}))
await writeFixtureWebToken(home)
writeFileSync(join(root, "rove-plugin.toml"), `id = "test.native"\nname = "Native counter"\nversion = "0.1.0"\nmin_rove_version = "0.1.0"\n[mod]\ncommand = ${JSON.stringify([process.execPath, child, "mod", root])}\n`)
savePluginRegistry({ plugins: [{ id: "test.native", root, source: { kind: "link" }, enabled: true, version: "0.1.0", installedAt: 1 }] }, home)
const processes = []
function start(name, command, args, cwd, extra = {}) {
  const fd = openSync(join(evidence, `${label}-${name}.log`), "w")
  const proc = spawn(command, args, { cwd, env: { ...env, ...extra }, stdio: ["ignore", fd, fd] })
  processes.push(proc)
  return proc
}
async function ready(url) {
  for (let i = 0; i < 240; i++) {
    try { if ((await fetch(url)).ok) return } catch {}
    await Bun.sleep(250)
  }
  throw new Error(`server did not start: ${url}`)
}
try {
  start("daemon", "node", [join(import.meta.dirname, "plugin-windows-console.mjs"), process.execPath, cli, "daemon", "start"], repo)
  // The real registry entry must have started before checking either client.
  for (let i = 0; i < 240; i++) {
    try { if (Number(readFileSync(join(root, "initial-mod.pid"), "utf8")) > 0) break } catch {}
    if (i === 239) throw new Error("daemon did not start the linked mod")
    await Bun.sleep(250)
  }
  start("web", process.execPath, [cli, "--web", "--host", "127.0.0.1", "--port", "5276"], repo)
  const quote = (path) => `'${path.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`
  start("pty", "node", ["pty-server.mjs"], join(repo, "packages/rove-harness"), {
    ROVE_PTY_DEV_CWD: repo,
    ROVE_PTY_DEV_COMMAND: `${quote(process.execPath)} ${quote(cli)}`,
    ROVE_PTY_DEV_SHELL: process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "/bin/sh",
  })
  start("vite", process.execPath, ["x", "vite", "dev", "--host", "127.0.0.1", "--port", "5273", "--strictPort"], join(repo, "packages/rove-harness"))
  await Promise.all([ready("http://127.0.0.1:5273/harness"), ready("http://127.0.0.1:5276/")])
  const browser = start("browser", "node", [join(import.meta.dirname, "plugin-windows-browser.mjs")], repo, {
    HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
    PLUGIN_BASELINE: String(baseline), PLUGIN_EVIDENCE: evidence, PLUGIN_LABEL: label,
    PLUGIN_TOKEN: readFileSync(join(home, ".rove/bridge/token"), "utf8").trim(),
  })
  const code = await new Promise((resolve) => browser.once("exit", resolve))
  assert.equal(code, 0, `client acceptance failed; see ${evidence}`)
  writeFileSync(process.env.ROVE_PLUGIN_REPORT ?? join(evidence, "clients.json"), JSON.stringify({ baseline, platform: process.platform, os: release(), bun: process.versions.bun, clients: ["TUI /harness", "web"], pass: true }, null, 2))
} finally {
  for (const proc of processes.reverse()) {
    if (!proc.pid || proc.exitCode !== null) continue
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" })
      else proc.kill("SIGTERM")
    } catch {}
  }
  for (const role of ["mod", "descendant", "leaf"]) {
    try { process.kill(Number(readFileSync(join(root, `initial-${role}.pid`), "utf8")), "SIGKILL") } catch {}
  }
}
