/** Bundle the main process for Electron: one CJS file, `electron` left to the runtime. */

const result = await Bun.build({
  entrypoints: ["src/main.ts"],
  outdir: "dist",
  target: "node",
  format: "cjs",
  external: ["electron"],
  sourcemap: "linked",
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
console.log(`built ${result.outputs.map((o) => o.path.replace(`${process.cwd()}/`, "")).join(", ")}`)
