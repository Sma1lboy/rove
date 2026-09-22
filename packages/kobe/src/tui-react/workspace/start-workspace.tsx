/** @jsxImportSource @opentui/react */
/**
 * Workspace boot and teardown; `host.tsx` owns the component. Deliberately
 * outside render tests: every line opens a real daemon socket, SSH tunnel, or
 * owns the PTY registry's teardown (see `docs/HARNESS.md` on the coverage gate).
 */

import { connectOrStartDaemon } from "@sma1lboy/kobe-daemon/client/daemon-process"
import { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { queryCellPixelSize } from "../../tui/lib/cell-pixel-size"
import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import { bootPaneHost } from "../lib/host-boot"
import { WorkspaceRoot } from "./host"
import type { BootDialogs } from "./host-pages"

export async function startWorkspaceHost(opts: BootDialogs = {}): Promise<void> {
  await bootPaneHost({
    logContext: "workspace",
    providers: { kv: true, focus: true, notifications: true },
    setup: async () => {
      // BEFORE the renderer takes stdin (`setup` precedes `createCliRenderer`);
      // raw mode for a few ms. Only consumer: the size rides the `gui` subscribe
      // (the daemon ignores a pane's).
      const cellPixelSize = await queryCellPixelSize({ stdin: process.stdin, stdout: process.stdout })
      const client = await connectOrStartDaemon()
      const orchestrator = new RemoteOrchestrator(client, { role: "gui", cellPixelSize })
      await orchestrator.init()
      process.env.KOBE_DAEMON_SOCKET_PATH = client.socketPath
      // Other machines running Rove. `attach()` is sync and a no-op when none
      // are registered; lazy imports keep machine-free installs from loading any of it.
      const { MachineHub } = await import("../../machines/hub.ts")
      const { setMachineHub } = await import("../../machines/hub-singleton.ts")
      const machines = new MachineHub(orchestrator)
      machines.attach()
      setMachineHub(machines)
      return {
        root: () => (
          <WorkspaceRoot
            orchestrator={orchestrator}
            whatsNewFrom={opts.whatsNewFrom ?? null}
            welcome={opts.welcome ?? null}
          />
        ),
        onDestroy: () => {
          setMachineHub(null)
          machines.dispose()
          orchestrator.dispose()
          // Detach, don't kill: hosted PTYs (`kobe pty-host`) keep sessions
          // running and reattach next boot. Local-backend PTYs (no detach())
          // still die with this process.
          getDefaultPtyRegistry().detachAll()
        },
      }
    },
  })
}
