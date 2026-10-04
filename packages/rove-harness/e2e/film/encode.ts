/**
 * Frames → the film's delivered mp4 / gif.
 *
 * Rides Remotion's bundled ffmpeg (`packages/branding`) so a render needs no
 * system install. That build ships `--disable-filters` with a whitelist —
 * `scale`, `palettegen`, `paletteuse` exist; `fps`/`setpts` do not — which is
 * fine here: timing is already baked into the frame sequence by the cut.
 */

import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { REPO_ROOT } from "../hero-capture.ts"
import type { Film } from "./film.ts"

const BRANDING = join(REPO_ROOT, "packages", "branding")

function ffmpeg(argv: readonly string[]): void {
  const proc = Bun.spawnSync(["bun", "x", "remotion", "ffmpeg", "-v", "error", "-y", ...argv], {
    cwd: BRANDING,
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (proc.exitCode !== 0) throw new Error(`ffmpeg failed: ${new TextDecoder().decode(proc.stderr).slice(-2000)}`)
}

/**
 * GIF: 48 colours, no dither. Measured on the shipped TUI clips: a TUI
 * quantises losslessly at 96, and 96 → 48 is −15…−23% at SSIM 0.996 with
 * glyph edges unchanged at 3× zoom, while 32 and below start fringing them.
 * Dithering a glyph edge trades crispness for noise GIF cannot compress.
 */
const GIF_COLORS = 48
const GIF_FPS = 10

export async function encode(opts: {
  readonly framesDir: string
  readonly workDir: string
  readonly fps: number
  readonly out: Film["out"]
}): Promise<void> {
  const input = ["-framerate", String(opts.fps), "-i", join(opts.framesDir, "%05d.png")]
  if (opts.out.mp4) {
    const mp4 = join(REPO_ROOT, opts.out.mp4)
    await mkdir(dirname(mp4), { recursive: true })
    ffmpeg([...input, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "24", "-movflags", "+faststart", mp4])
    console.log(mp4)
  }
  if (opts.out.gif) {
    const gif = join(REPO_ROOT, opts.out.gif)
    await mkdir(dirname(gif), { recursive: true })
    const scale = `scale=${opts.out.gifWidth ?? 800}:-1:flags=lanczos`
    const palette = join(opts.workDir, "palette.png")
    ffmpeg([...input, "-vf", `${scale},palettegen=max_colors=${GIF_COLORS}`, "-update", "1", palette])
    ffmpeg([...input, "-i", palette, "-lavfi", `[0:v]${scale}[x];[x][1:v]paletteuse=dither=none`, "-r", String(GIF_FPS), "-loop", "0", gif])
    console.log(gif)
  }
}

/** Footage a composition re-encodes: near-lossless, so its own encode is the only lossy pass.
 *  A keyframe every second: the composition seeks into clips, and sparse keyframes freeze it. */
export function encodeClip(framesDir: string, fps: number, mp4: string): void {
  ffmpeg([
    "-framerate",
    String(fps),
    "-i",
    join(framesDir, "%05d.png"),
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "12",
    "-pix_fmt",
    "yuv420p",
    "-g",
    String(fps),
    "-keyint_min",
    String(fps),
    "-an",
    "-movflags",
    "+faststart",
    mp4,
  ])
}
