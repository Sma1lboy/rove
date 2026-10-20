/**
 * `rove --web [bridge flags]` — run rove-bridge with the browser client
 * attached, in this process, until killed. Same listener, token and presets as
 * the phone bridge; the page is just its third client.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import { ROVE_PRODUCT_NAME } from "../product.ts"

/**
 * The built client: `dist/web` beside the npm bundle (`dist/cli`), or the
 * workspace build when running from source. The standalone binary embeds
 * neither, and says so.
 */
function webRoot(): string | null {
  const candidates = [join(import.meta.dir, "..", "web"), join(import.meta.dir, "..", "..", "..", "rove-web", "dist")]
  return candidates.find((dir) => existsSync(join(dir, "index.html"))) ?? null
}

export async function runWebSubcommand(args: readonly string[]): Promise<void> {
  const root = webRoot()
  if (!root) {
    console.error(
      `${ROVE_PRODUCT_NAME} --web: the browser client is not in this build. From a checkout, run \`bun --filter rove-web build\` first; the npm package ships it in dist/web.`,
    )
    process.exit(2)
  }
  // Lazy like every heavy command: the bridge pulls in the orchestrator client.
  const { runBridge } = await import("rove-bridge")
  await runBridge(args, { name: `${ROVE_PRODUCT_NAME} --web`, web: { root } })
}
