/** Every TUI entry releases the renderer before applying accepted setup. */
let welcomeWrite: Promise<unknown> = Promise.resolve()

export function trackWelcomeWrite(write: Promise<unknown>): void {
  welcomeWrite = write
}

export async function launchTui(): Promise<void> {
  const { startTui } = await import("../tui/index.tsx")
  await startTui()
  await welcomeWrite
  const { runPendingWelcomeInstalls } = await import("./onboarding.ts")
  runPendingWelcomeInstalls()
}
