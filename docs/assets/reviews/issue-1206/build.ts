import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "../../../..")
const output = resolve(root, "packages/rove/.scratch/issue-1206-ui")
const hook = "packages/rove/src/tui-react/component/use-kanban-boards.ts"
const beforeRef = "08981ed99^"
mkdirSync(output, { recursive: true })
const before = execFileSync("git", ["show", `${beforeRef}:${hook}`], { cwd: root, encoding: "utf8" })
for (const state of ["before", "after"]) {
  const result = await Bun.build({
    entrypoints: [resolve(import.meta.dirname, "fixture.tsx")],
    outdir: output,
    naming: `${state}.js`,
    target: "bun",
    packages: "external",
    tsconfig: resolve(root, "packages/rove/tsconfig.json"),
    plugins:
      state === "before"
        ? [
            {
              name: "baseline-kanban-hook",
              setup(build) {
                build.onLoad({ filter: /\/use-kanban-boards\.ts$/ }, () => ({
                  contents: before,
                  loader: "ts",
                  resolveDir: resolve(root, "packages/rove/src/tui-react/component"),
                }))
              },
            },
          ]
        : [],
  })
  if (!result.success) throw new AggregateError(result.logs, `Failed to build ${state}`)
}
writeFileSync(
  resolve(output, "build.json"),
  JSON.stringify(
    {
      before: execFileSync("git", ["rev-parse", beforeRef], { cwd: root, encoding: "utf8" }).trim(),
      after: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      replacedModule: hook,
    },
    null,
    2,
  ),
)
