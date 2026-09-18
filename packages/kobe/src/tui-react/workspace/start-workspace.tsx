/** @jsxImportSource @opentui/react */
/**
 * Booting the workspace: what has to exist before `WorkspaceRoot` can render,
 * and what has to be let go of when it stops.
 *
 * Split from `host.tsx`, which owns the COMPONENT. The two jobs share only the
 * orchestrator: this file has no JSX beyond handing the root back, and the
 * component knows nothing about daemons, machines or PTY registries.
 *
 * Nothing here is reachable from a render test, and that is the point of the
 * split rather than a gap in it: every line opens a real daemon socket, a real
 * SSH tunnel or the PTY registry whose teardown it owns. `WorkspaceRoot` next
 * door IS mountable and is covered as such; what is left over here is the
 * process entry point (see `docs/HARNESS.md` on the coverage gate).
 */

import { connectOrStartDaemon } from "@sma1lboy/kobe-daemon/client/daemon-process"
import { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { queryCellPixelSize } from "../../tui/lib/cell-pixel-size"
import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import { bootPaneHost } from "../lib/host-boot"
import { WorkspaceRoot } from "./host"

export async function startWorkspaceHost(): Promise<void> {
  await bootPaneHost({
    logContext: "workspace",
    providers: { kv: true, focus: true, notifications: true },
    setup: async () => {
      // Measure this terminal BEFORE the renderer takes stdin — `setup` runs
      // ahead of `createCliRenderer`, and the query needs stdin in raw mode
      // for a few milliseconds. It lives here rather than in the shared boot
      // helper because this is its only consumer: the size rides the `gui`
      // subscribe, and the daemon ignores a pane's (a pane has no terminal of
      // its own to measure).
      const cellPixelSize = await queryCellPixelSize({ stdin: process.stdin, stdout: process.stdout })
      const client = await connectOrStartDaemon()
      const orchestrator = new RemoteOrchestrator(client, { role: "gui", cellPixelSize })
      await orchestrator.init()
      process.env.KOBE_DAEMON_SOCKET_PATH = client.socketPath
      // Other computers running Rove. `attach()` is synchronous and a no-op
      // when none are registered, so an install without machines pays one map
      // lookup and boots exactly as before. Imported lazily for the same
      // reason: nothing about machines is loaded on a machine-free install.
      const { MachineHub } = await import("../../machines/hub.ts")
      const { setMachineHub } = await import("../../machines/hub-singleton.ts")
      const machines = new MachineHub(orchestrator)
      machines.attach()
      setMachineHub(machines)
      return {
        root: () => <WorkspaceRoot orchestrator={orchestrator} />,
        onDestroy: () => {
          setMachineHub(null)
          machines.dispose()
          orchestrator.dispose()
          // Detach, don't kill: hosted PTYs (the `kobe pty-host` process)
          // keep their engine sessions RUNNING in the background and
          // reattach on next boot. Local-backend PTYs (no detach()) are
          // still killed — a child of this process can't outlive it usefully.
          getDefaultPtyRegistry().detachAll()
        },
      }
    },
  })
}
