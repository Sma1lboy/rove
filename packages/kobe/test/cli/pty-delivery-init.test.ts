import { mkdtempSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { type PtyHostRpc, deliverHostedPrompt } from "../../src/cli/api/pty-delivery.ts"

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rove-cli-init-"))
  const marker = join(directory, "init")
  const request = vi
    .fn<PtyHostRpc["request"]>()
    .mockResolvedValue({ sessions: [{ key: "task::tab-1", alive: true, pid: 123, command: ["codex"], title: "" }] })
    .mockResolvedValueOnce({ sessions: [] })
    .mockResolvedValueOnce({ alive: true, created: true })
  const launch = { key: "task::tab-1", command: ["/bin/sh", "-lc", "init; codex prompt"], initMarkerPath: marker }
  return {
    marker,
    request,
    deliver: (snapshot: () => Promise<string>) =>
      deliverHostedPrompt(
        { request: async <T>(name: string, payload?: unknown) => (await request(name, payload)) as T },
        { id: "task", engineBin: "codex" },
        directory,
        "prompt",
        launch,
        { snapshot },
      ),
  }
}

afterEach(() => vi.useRealTimers())

it("reports init as unconfirmed immediately when its marker is absent", async () => {
  const { deliver, request } = fixture()
  const snapshot = vi.fn(async () => "123 1 -sh\n")
  expect(await deliver(snapshot)).toMatchObject({ started: true, engineReady: false, delivered: true })
  expect(snapshot).not.toHaveBeenCalled()
  expect(request.mock.calls.map(([name]) => name)).toEqual(["pty.list", "pty.open", "pty.detach"])
})

it("rechecks init after the launch shell replaces an old failed marker during the process probe", async () => {
  vi.useFakeTimers()
  const { marker, deliver } = fixture()
  writeFileSync(marker, "1")
  let restarted = false
  const result = deliver(async () => {
    if (!restarted) {
      renameSync(marker, `${marker}.previous`)
      restarted = true
    }
    return "123 1 -sh\n456 123 bun install\n"
  })
  await vi.advanceTimersByTimeAsync(3300)
  expect(await result).toMatchObject({
    started: true,
    engineReady: false,
    delivered: true,
    reason: "repo init script is still running; the engine has not started yet",
  })
})

it("still reports a missing engine as failed after init completes", async () => {
  vi.useFakeTimers()
  const { marker, deliver } = fixture()
  writeFileSync(marker, "0")
  const result = deliver(async () => "123 1 -sh\n")
  await vi.advanceTimersByTimeAsync(3300)
  expect(await result).toMatchObject({ started: true, engineReady: false, delivered: false })
})

it.each(["0", "1"])("does not call a rebuilt marker with exit code %s pending init", async (code) => {
  vi.useFakeTimers()
  const { marker, deliver } = fixture()
  writeFileSync(marker, "1")
  let probe = 0
  const result = deliver(async () => {
    if (probe++ === 0) renameSync(marker, `${marker}.previous`)
    else writeFileSync(marker, code)
    return "123 1 -sh\n"
  })
  await vi.advanceTimersByTimeAsync(3300)
  expect(await result).toMatchObject({ engineReady: false, delivered: false })
})

it("does not call a dead PTY pending init even when the marker disappeared", async () => {
  vi.useFakeTimers()
  const { marker, deliver, request } = fixture()
  writeFileSync(marker, "1")
  const result = deliver(async () => {
    renameSync(marker, `${marker}.previous`)
    request.mockResolvedValue({ sessions: [] })
    return "123 1 -sh\n"
  })
  await vi.advanceTimersByTimeAsync(3300)
  expect(await result).toMatchObject({ engineReady: false, delivered: false })
})

it("observes an engine that starts after retrying init without pasting the argv prompt again", async () => {
  vi.useFakeTimers()
  const { marker, deliver, request } = fixture()
  writeFileSync(marker, "1")
  let probe = 0
  const result = deliver(async () => {
    if (probe++ === 0) {
      renameSync(marker, `${marker}.previous`)
      return "123 1 -sh\n"
    }
    writeFileSync(marker, "0")
    return "123 1 -sh\n456 123 codex\n"
  })
  await vi.advanceTimersByTimeAsync(3300)
  expect(await result).toMatchObject({ engineReady: true, delivered: true })
  expect(request.mock.calls.some(([name]) => name === "pty.write")).toBe(false)
})
