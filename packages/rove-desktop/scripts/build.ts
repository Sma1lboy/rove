/** Bundle the main process and sandboxed preload for Electron: CJS files, `electron` left to the runtime. */

const result = await Bun.build({
  entrypoints: ["src/main.ts", "src/preload.ts"],
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
