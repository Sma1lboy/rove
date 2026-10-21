// Publishes renders/hero.mp4: the landing hero as-is, and the README gif
// (960x540, 10 fps, one palette for the whole film), then checks that the
// colours the film is about survived the gif's palette.
import { execFileSync } from "node:child_process"
import { copyFileSync, statSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "./build.mjs"

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const render = resolve(dir, "renders/hero.mp4")
// FILM_PUBLISH_DIR redirects both files for a trial run that must not touch the committed assets.
const trial = process.env.FILM_PUBLISH_DIR && resolve(process.env.FILM_PUBLISH_DIR)
const landing = trial ? resolve(trial, "hero-multirepo.mp4") : resolve(dir, "../../../rove-landing/assets/hero-multirepo.mp4")
const gif = trial ? resolve(trial, "demo.gif") : resolve(dir, "../../../../docs/assets/demo.gif")

const GIF_WIDTH = 960
const GIF_HEIGHT = 540
const GIF_FPS = 10

/**
 * Colours that must own a palette entry. palettegen keeps what is common, and
 * the diff's thin +N / -M glyphs are a few hundred pixels against a whole
 * film of wallpaper, so a plain palette drops the green. Each colour is
 * stacked under every frame as a swatch for palettegen only; the encoded
 * frames never carry it.
 */
const SWATCHES = ["0xD77757" /* Claude orange */, "0x97C683" /* diff green */, "0xD47563" /* diff red */]
const swatchInputs = SWATCHES.map((c, i) => `color=c=${c}:s=${GIF_WIDTH}x24:r=${GIF_FPS}[s${i}];`).join("")
const GIF_FILTER =
  `fps=${GIF_FPS},scale=${GIF_WIDTH}:${GIF_HEIGHT}:flags=lanczos,split[a][b];${swatchInputs}` +
  `[a]${SWATCHES.map((_, i) => `[s${i}]`).join("")}vstack=inputs=${SWATCHES.length + 1}:shortest=1[pal];` +
  // 96 colours, no dither: at 64 the diff red merges into Rove's clay; dithering a
  // glyph edge trades crispness for noise a gif cannot compress.
  "[pal]palettegen=stats_mode=full:max_colors=96[p];" +
  "[b][p]paletteuse=dither=none:diff_mode=rectangle"

/** The terminal window inside the 1920x1080 composition (film.css #win), as fractions. */
const WINDOW = { x0: 240 / 1920, y0: 148 / 1080, x1: 1680 / 1920, y1: 992 / 1080 }

/**
 * Colours the gif must still show inside the window, in at least one sampled
 * frame. Orange and red are matched exactly, within a few units: Rove's clay
 * (204,120,92) sits between Claude orange (215,119,87) and the diff red
 * (212,117,99), so a palette that merges any two must fail. Green has no
 * neighbour and is matched by hue, which antialiased glyphs keep.
 */
const near = (rgb, tol) => (r, g, b) => Math.abs(r - rgb[0]) <= tol && Math.abs(g - rgb[1]) <= tol && Math.abs(b - rgb[2]) <= tol
const KEEP = [
  { label: "Claude orange", minPixels: 200, test: near([215, 119, 87], 5) },
  { label: "diff green", minPixels: 20, test: (r, g, b) => g >= 110 && g - r >= 30 && g - b >= 45 },
  { label: "diff red", minPixels: 10, test: near([212, 117, 99], 4) },
]

/**
 * Seconds at which the window is fully on screen: inside every take scene,
 * clear of its open/close moves. Elsewhere the window rect is wallpaper, and
 * the wallpaper's gradient passes for orange and red.
 */
function windowTimes() {
  const times = []
  for (const scene of build().scenes.filter((s) => s.kind === "take")) {
    const [from, to] = [scene.start / 30 + 0.7, (scene.start + scene.frames) / 30 - 0.7]
    for (let t = from; t < to; t += 0.5) times.push(t)
  }
  return times
}

/** Most matches of each KEEP colour inside WINDOW in any sampled frame of `path`. */
function keptColours(path) {
  const pick = windowTimes()
    .map((t) => `between(t,${t.toFixed(3)},${(t + 0.05).toFixed(3)})`)
    .join("+")
  const raw = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-vf", `select='${pick}'`, "-fps_mode", "vfr", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 1 << 30 },
  )
  const frame = GIF_WIDTH * GIF_HEIGHT * 3
  const [x0, x1] = [Math.round(WINDOW.x0 * GIF_WIDTH), Math.round(WINDOW.x1 * GIF_WIDTH)]
  const [y0, y1] = [Math.round(WINDOW.y0 * GIF_HEIGHT), Math.round(WINDOW.y1 * GIF_HEIGHT)]
  const best = KEEP.map(() => 0)
  for (let at = 0; at + frame <= raw.length; at += frame) {
    const hits = KEEP.map(() => 0)
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = at + (y * GIF_WIDTH + x) * 3
        for (const [k, keep] of KEEP.entries()) if (keep.test(raw[i], raw[i + 1], raw[i + 2])) hits[k] += 1
      }
    }
    for (const k of hits.keys()) best[k] = Math.max(best[k], hits[k])
  }
  return best
}

copyFileSync(render, landing)
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", render, "-filter_complex", GIF_FILTER, "-loop", "0", gif], { stdio: "inherit" })

const mb = (path) => `${(statSync(path).size / 1e6).toFixed(2)} MB`
console.log(`landing ${landing} ${mb(landing)}\ngif     ${gif} ${mb(gif)}`)

const best = keptColours(gif)
for (const [k, keep] of KEEP.entries()) console.log(`gif colour ${keep.label}: ${best[k]} px (needs ${keep.minPixels})`)
const lost = KEEP.filter((keep, k) => best[k] < keep.minPixels)
if (lost.length > 0) throw new Error(`the gif's palette lost ${lost.map((keep) => keep.label).join(", ")}`)
