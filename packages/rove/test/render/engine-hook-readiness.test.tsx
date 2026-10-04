/** @jsxImportSource @opentui/react */
import { describe, expect, it } from "bun:test"
import { useState } from "react"
import { EngineIntegrationLine } from "../../src/tui-react/component/settings-dialog/sections-engines-integration"
import { act, renderComponent } from "./harness"

describe("hook setup guidance", () => {
  it("does not present written hooks as trusted", async () => {
    const { frame } = await renderComponent(
      <EngineIntegrationLine
        integration={{
          vendor: "codex",
          hooksSupported: true,
          hookState: "installed",
          hookFile: "/tmp/hooks.json",
          markers: true,
          screen: true,
          setupCommand: "/hooks",
        }}
      />,
    )
    await act(async () => {})
    expect(await frame()).toContain("/hooks")
    expect(await frame()).toContain("not proof of trust")
  })
})

import { EngineHookReadiness, type HookReadiness } from "../../src/tui-react/component/engine-hook-readiness"

const ready: HookReadiness = {
  status: { vendor: "codex", binary: { found: true, path: "/fake/codex" }, account: { kind: "apikey" } },
  integration: {
    vendor: "codex",
    hooksSupported: true,
    hookState: "installed",
    hookFile: "/fake/hooks.json",
    markers: true,
    screen: true,
  },
}
const probeReady = async () => ready

it("separates CLI/login/written hooks from an unobserved event", async () => {
  const { frame } = await renderComponent(<EngineHookReadiness vendor="codex" probe={probeReady} />)
  await act(async () => {})
  const out = await frame()
  expect(out).toContain("CLI: available")
  expect(out).toContain("login: detected")
  expect(out).toContain("hooks: written")
  expect(out).toContain("No hook event received yet")
  expect(out).toContain("/hooks")
  expect(out).not.toContain("activity reporting verified")
})

it("confirms only a session identity from a received hook", async () => {
  const { frame } = await renderComponent(
    <EngineHookReadiness vendor="codex" hookSessionId="reported-session" probe={probeReady} />,
  )
  await act(async () => {})
  const out = await frame()
  expect(out).toContain("Hook event recorded for this tab")
  expect(out).not.toContain("No hook event received yet")
  expect(out).toContain("/hooks")
})

it("does not apply Codex trust requirements to other engines", async () => {
  const { frame } = await renderComponent(<EngineHookReadiness vendor="claude" probe={probeReady} />)
  expect(await frame()).not.toContain("/hooks")
})

it("does not mistake a failed probe for authorization", async () => {
  const { frame } = await renderComponent(
    <EngineHookReadiness
      vendor="codex"
      probe={async () => {
        throw new Error("offline")
      }}
    />,
  )
  await act(async () => {})
  const out = await frame()
  expect(out).toContain("Readiness check unavailable")
  expect(out).toContain("No hook event received yet")
})

it("gives repair steps for missing CLI, login and hooks", async () => {
  const { frame } = await renderComponent(
    <EngineHookReadiness
      vendor="codex"
      probe={async () => ({
        status: { vendor: "codex", binary: { found: false, error: "not found" }, account: { kind: "none" } },
        integration: { ...ready.integration, hookState: "not-installed" },
      })}
    />,
  )
  await act(async () => {})
  const out = await frame()
  expect(out).toContain("install the engine CLI")
  expect(out).toContain("sign in with the engine CLI")
  expect(out).toContain("Settings → Engines")
})

it("returns to unobserved when the current session evidence is cleared", async () => {
  let setSession: (value: string | undefined) => void = () => {}
  function Probe() {
    const [session, update] = useState<string | undefined>("old-session")
    setSession = update
    return <EngineHookReadiness vendor="codex" hookSessionId={session} probe={probeReady} />
  }
  const { frame } = await renderComponent(<Probe />)
  await act(async () => {})
  expect(await frame()).toContain("Hook event recorded for this tab")
  await act(async () => setSession(undefined))
  expect(await frame()).toContain("No hook event received yet")
  expect(await frame()).toContain("/hooks")
  await act(async () => setSession("new-session"))
  expect(await frame()).toContain("Hook event recorded for this tab")
})
