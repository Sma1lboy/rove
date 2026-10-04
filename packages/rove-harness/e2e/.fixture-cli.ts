// Scratch (not committed): run the rove CLI against the visual fixture's own env.
import { resolve } from "node:path"
import { ROVE_DIR, VISUAL_ENV } from "./visual-fixture.ts"
const r = Bun.spawnSync(["bun", "--conditions=browser", resolve(ROVE_DIR, "src/cli/rove.ts"), ...process.argv.slice(2)], {
  cwd: ROVE_DIR,
  env: { ...VISUAL_ENV },
})
console.log(r.stdout.toString(), r.stderr.toString())
