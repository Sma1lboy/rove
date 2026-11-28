/**
 * `rove machine mcp <alias> [<name> <url> | <name> --clear]`: HTTP MCP servers on that machine's loopback,
 * forwarded into each session whose workspace is there (`machines/remote-mcp.ts`). With no name, lists them.
 */

import { argvHasFlag } from "@sma1lboy/rove-core/lib/argv.ts"
import { getMachine, updateMachine } from "@sma1lboy/rove-core/machines/registry.ts"
import { forwardedMcp } from "@sma1lboy/rove-core/machines/remote-mcp.ts"
import { ROVE_PRODUCT_NAME } from "@sma1lboy/rove-core/product.ts"

export function machineMcp(argv: readonly string[], fail: (message: string) => never): void {
  const [alias, name, url] = argv.filter((a) => !a.startsWith("--"))
  if (!alias) fail("mcp: name the machine: mcp <alias> [<name> <url> | <name> --clear]")
  const config = getMachine(alias)
  if (!config) fail(`no machine named "${alias}" (see \`${ROVE_PRODUCT_NAME} machine list\`)`)
  const servers = config.mcp ?? []
  if (!name) {
    if (servers.length === 0) process.stdout.write(`No MCP servers forwarded from ${alias}.\n`)
    for (const [i, fwd] of forwardedMcp(alias, servers).entries()) {
      process.stdout.write(`${fwd.server}  ${servers[i]?.url} → ${fwd.url}\n`)
    }
    return
  }
  if (!/^[A-Za-z0-9_-]+$/.test(name)) fail(`mcp: "${name}" is not a server name (letters, digits, _ and -)`)
  const rest = servers.filter((s) => s.name !== name)
  if (argvHasFlag(argv, "--clear")) {
    updateMachine(alias, { mcp: rest })
    process.stdout.write(`${ROVE_PRODUCT_NAME} machine: ${alias} no longer forwards ${name}\n`)
    return
  }
  if (!url || forwardedMcp(alias, [{ name, url }]).length === 0) {
    fail(`mcp: give the server's http(s) URL as ${alias} reaches it, e.g. http://127.0.0.1:12306/mcp`)
  }
  updateMachine(alias, { mcp: [...rest, { name, url }] })
  const [fwd] = forwardedMcp(alias, [{ name, url }])
  process.stdout.write(
    `${ROVE_PRODUCT_NAME} machine: new sessions with a workspace on ${alias} get ${fwd?.server} (${url} there, ${fwd?.url} here)\n`,
  )
}
