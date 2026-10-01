// Publishes renders/hero.mp4: the landing hero as-is, and the README gif
// (960x540, 12 fps, one palette for the whole film).
import { execFileSync } from "node:child_process"
import { copyFileSync, statSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const render = resolve(dir, "renders/hero.mp4")
// FILM_PUBLISH_DIR redirects both files for a trial run that must not touch the committed assets.
const trial = process.env.FILM_PUBLISH_DIR && resolve(process.env.FILM_PUBLISH_DIR)
const landing = trial ? resolve(trial, "hero-multirepo.mp4") : resolve(dir, "../../../kobe-landing/assets/hero-multirepo.mp4")
const gif = trial ? resolve(trial, "demo.gif") : resolve(dir, "../../../../docs/assets/demo.gif")

const GIF_FILTER =
  "fps=12,scale=960:540:flags=lanczos,split[a][b];" +
  "[a]palettegen=stats_mode=diff:max_colors=96[p];" +
  "[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle"

copyFileSync(render, landing)
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", render, "-filter_complex", GIF_FILTER, "-loop", "0", gif], { stdio: "inherit" })

const mb = (path) => `${(statSync(path).size / 1e6).toFixed(2)} MB`
console.log(`landing ${landing} ${mb(landing)}\ngif     ${gif} ${mb(gif)}`)
