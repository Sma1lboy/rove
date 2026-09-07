/** @jsxImportSource @opentui/react */
import { expect, spyOn, test } from "bun:test"
import { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { useEffect, useState } from "react"
import type { LiveSession } from "../../src/tui-react/panes/sidebar/orphan-tabs"
import { useHostSessions } from "../../src/tui-react/panes/sidebar/use-host-sessions"
import * as hostedClient from "../../src/tui/panes/terminal/pty-hosted-client"
import { act, renderComponent } from "./harness"

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 4000
  while (!predicate() && Date.now() < deadline) await act(async () => Bun.sleep(20))
  expect(predicate()).toBe(true)
}

test("inventory polling publishes PID changes, skips identical snapshots, and stops on unmount", async () => {
  const client = new KobeDaemonClient("/unused-host-sessions-test.sock")
  const getClient = spyOn(hostedClient, "getSharedPtyClient").mockResolvedValue(client)
  const request = spyOn(client, "request")
  const first = { key: "task::tab-1", alive: true, title: "shell", pid: 101 }
  request.mockResolvedValue({ sessions: [first] })
  const snapshots: Array<readonly LiveSession[]> = []
  let unmount = () => {}
  function Reader() {
    const sessions = useHostSessions(true)
    useEffect(() => {
      snapshots.push(sessions)
    }, [sessions])
    return <text>{sessions[0]?.pid ?? "empty"}</text>
  }
  function Host() {
    const [mounted, setMounted] = useState(true)
    unmount = () => setMounted(false)
    return mounted ? <Reader /> : <text>unmounted</text>
  }
  const rendered = await renderComponent(<Host />)
  try {
    await until(() => snapshots.at(-1)?.[0]?.pid === 101)
    const published = snapshots.length
    request.mockResolvedValue({ sessions: [{ ...first }] })
    await until(() => request.mock.calls.length >= 2)
    expect(snapshots).toHaveLength(published)

    request.mockResolvedValue({ sessions: [{ ...first, pid: 202 }] })
    await until(() => snapshots.at(-1)?.[0]?.pid === 202)
    expect(snapshots).toHaveLength(published + 1)

    request.mockRejectedValue(new Error("host offline"))
    await until(() => snapshots.at(-1)?.length === 0)

    let resolve!: (value: { sessions: LiveSession[] }) => void
    const pending = new Promise<{ sessions: LiveSession[] }>((done) => {
      resolve = done
    })
    request.mockReturnValue(pending)
    const calls = request.mock.calls.length
    await until(() => request.mock.calls.length > calls)
    await act(async () => unmount())
    expect(await rendered.frame()).toContain("unmounted")
    const atUnmount = snapshots.length
    const requestsAtUnmount = request.mock.calls.length
    await act(async () => resolve({ sessions: [first] }))
    await act(async () => Bun.sleep(2100))
    expect(snapshots).toHaveLength(atUnmount)
    expect(request).toHaveBeenCalledTimes(requestsAtUnmount)
  } finally {
    await act(async () => rendered.destroy())
    request.mockRestore()
    getClient.mockRestore()
    client.close()
  }
}, 18_000)
