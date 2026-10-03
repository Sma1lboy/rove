/**
 * Where the pi-family CLI binaries live: `$PATH` first, then homebrew (how
 * both are installed on macOS — `brew install pi` / `omp` drop a symlink in
 * `/opt/homebrew/bin` pointing at the npm package's `dist/cli.js`), then the
 * usual per-user bin dirs. Probing itself lives in `../binary-discovery.ts`.
 *
 * Both binaries are the SAME npm package family (`@earendil-works/pi-coding-agent`
 * 0.80.6 for `pi`, `@oh-my-pi/pi-coding-agent` 18.1.17 for `omp`), so the
 * candidate list is shared and only the name differs.
 */

import path from "node:path"
import { type BinaryFinderSpec, BinaryNotFoundError, createBinaryFinder, npmStyleDirs } from "../binary-discovery.ts"

class PiFamilyBinaryNotFoundError extends BinaryNotFoundError {
  constructor(name: string, checkedPaths: readonly string[]) {
    super(
      `${name} CLI binary`,
      `Ensure '${name}' is on PATH (e.g. \`brew install ${name}\`, or \`npm i -g ${name === "omp" ? "@oh-my-pi/pi-coding-agent" : "@earendil-works/pi-coding-agent"}\`).`,
      checkedPaths,
    )
    this.name = "PiFamilyBinaryNotFoundError"
  }
}

function candidatesFor(name: string, ctx: Parameters<BinaryFinderSpec["candidates"]>[0]): readonly string[] {
  const { home } = ctx
  const out = npmStyleDirs(ctx, ["system", "local", "bun", "bin"]).map((dir) => path.join(dir, name))
  // The npm-global layout, for an install that never got symlinked onto PATH:
  // both packages ship the executable as `dist/cli.js`.
  const packageName = name === "omp" ? "@oh-my-pi/pi-coding-agent" : "@earendil-works/pi-coding-agent"
  for (const prefix of [path.join(home, ".npm-global"), "/usr/local", "/opt/homebrew"]) {
    out.push(path.join(prefix, "bin", name))
    out.push(path.join(prefix, "lib/node_modules", packageName, "dist", "cli.js"))
  }
  return out
}

export const findPiBinary = createBinaryFinder({
  name: "pi",
  candidates: (ctx) => candidatesFor("pi", ctx),
  notFound: (checked) => new PiFamilyBinaryNotFoundError("pi", checked),
})

export const findOmpBinary = createBinaryFinder({
  name: "omp",
  candidates: (ctx) => candidatesFor("omp", ctx),
  notFound: (checked) => new PiFamilyBinaryNotFoundError("omp", checked),
})
