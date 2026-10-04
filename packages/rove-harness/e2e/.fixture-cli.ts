// Scratch (not committed): run the rove CLI against the visual fixture's own env.
import { resolve } from "node:path"
import { KOBE_DIR, VISUAL_ENV } from "./visual-fixture.ts"
const r = Bun.spawnSync(["bun", "--conditions=browser", resolve(KOBE_DIR, "src/cli/rove.ts"), ...process.argv.slice(2)], {
  cwd: KOBE_DIR,
  env: { ...VISUAL_ENV },
})
console.log(r.stdout.toString(), r.stderr.toString())
