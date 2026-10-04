/**
 * Env contract for AUTOSPAWNED daemons (`connectOrStartDaemon`'s spawn).
 *
 * Why this matters: a `kobe` helper running INSIDE an engine tab inherits
 * the session's identity env (ROVE_TASK_ID/ROVE_TAB_ID/ROVE_TUI/
 * ROVE_TERMINAL_PTY, plus their ROVE_* aliases). Passing that straight into a
 * spawned daemon breeds zombies: long-lived shared daemons stamped with one
 * tab's identity, invisible to the idle-stop policy (they never see a gui). The
 * spawn env must drop the session markers and carry the autospawn flag the
 * lifetime policy keys its first-gui grace on.
 */

import { autospawnDaemonEnv } from "@sma1lboy/rove-daemon/client/daemon-process"
import { describe, expect, it } from "vitest"

describe("autospawnDaemonEnv", () => {
  it("drops engine-session identity, keeps overrides, stamps the autospawn flag", () => {
    const env = autospawnDaemonEnv({
      ROVE_TASK_ID: "01ABC",
      ROVE_TAB_ID: "tab-3",
      ROVE_TUI: "1",
      ROVE_TERMINAL_PTY: "1",
      ROVE_DAEMON_AUTOSPAWNED: "0",
      ROVE_INVOKED_AS: "rove",
      ROVE_HOME_DIR: "/tmp/sandbox-home",
      ROVE_DAEMON_SOCKET_PATH: "/tmp/sandbox.sock",
      PATH: "/usr/bin",
    })
    expect(env.ROVE_TASK_ID).toBeUndefined()
    expect(env.ROVE_TAB_ID).toBeUndefined()
    expect(env.ROVE_TUI).toBeUndefined()
    expect(env.ROVE_TERMINAL_PTY).toBeUndefined()
    expect(env.ROVE_TASK_ID).toBeUndefined()
    expect(env.ROVE_TAB_ID).toBeUndefined()
    expect(env.ROVE_TUI).toBeUndefined()
    expect(env.ROVE_TERMINAL_PTY).toBeUndefined()
    expect(env.ROVE_INVOKED_AS).toBe("rove")
    // Explicit isolation overrides (dev:sandbox, captures) must survive.
    expect(env.ROVE_HOME_DIR).toBe("/tmp/sandbox-home")
    expect(env.ROVE_DAEMON_SOCKET_PATH).toBe("/tmp/sandbox.sock")
    expect(env.PATH).toBe("/usr/bin")
    expect(env.ROVE_DAEMON_AUTOSPAWNED).toBe("1")
    expect(env.ROVE_DAEMON_AUTOSPAWNED).toBe("1")
  })
})
