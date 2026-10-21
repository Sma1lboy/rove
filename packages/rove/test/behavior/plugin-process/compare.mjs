import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const repo = resolve(import.meta.dirname, "../../../../..")
const evidence = join(repo, "plugin-evidence")
mkdirSync(evidence, { recursive: true })
const paths = ["mod-host", "hook-run"].map((name) => `packages/rove-daemon/src/plugins/${name}.ts`)
const saved = paths.map((path) => readFileSync(join(repo, path)))
const base = process.env.BASE_SHA
assert.ok(base, "BASE_SHA must identify the unfixed revision")
function run(label) {
  const child = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "native.mjs"), ...(label === "baseline" ? ["--baseline"] : [])],
    {
      cwd: repo,
      env: { ...process.env, ROVE_PLUGIN_REPORT: join(evidence, `${label}.json`) },
      encoding: "utf8",
      timeout: 240000,
    },
  )
  writeFileSync(join(evidence, `${label}.log`), `${child.stdout}\n${child.stderr}`)
  console.log(child.stdout, child.stderr)
  assert.equal(child.status, 0, `${label} native run failed: ${child.error ?? "see report"}`)
}
try {
  for (const path of paths)
    writeFileSync(join(repo, path), execFileSync("git", ["show", `${base}:${path}`], { cwd: repo }))
  run("baseline")
} finally {
  paths.forEach((path, i) => writeFileSync(join(repo, path), saved[i]))
}
run("head")
writeFileSync(
  join(evidence, "revisions.json"),
  JSON.stringify(
    { baseline: base, head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim() },
    null,
    2,
  ),
)
