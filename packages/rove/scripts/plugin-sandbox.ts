/**
 * Transitional shim — the named plugin sandbox merged into dev-sandbox
 * (`bun dev:sandbox --name <x> …`), because "a sandbox with plugins" needed
 * no separate machinery: `rove plugin link` already writes the registry of
 * whatever HOME_DIR it runs under. This forwards the old verb surface so
 * in-flight task briefs keep working; new work should call dev:sandbox.
 *
 *   plugin-sandbox <name> link <dir…>  → dev:sandbox --name <name> run plugin link <dir…>
 *   plugin-sandbox <name> api <args…>  → dev:sandbox --name <name> run api <args…>
 *   plugin-sandbox <name> run          → dev:sandbox --name <name> run
 *   plugin-sandbox <name> smoketest|home|reset → same mode, named
 */

const [name, verb, ...rest] = process.argv.slice(2)
if (!name || !verb) {
  console.error("usage: bun run scripts/plugin-sandbox.ts <name> <link <dir…>|run|api <args…>|smoketest|home|reset>")
  process.exit(2)
}

const forwarded =
  verb === "link" ? ["run", "plugin", "link", ...rest] : verb === "api" ? ["run", "api", ...rest] : [verb, ...rest]

const child = Bun.spawn([process.execPath, "run", "scripts/dev-sandbox.ts", "--name", name, ...forwarded], {
  cwd: process.cwd(),
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})
process.exit(await child.exited)
