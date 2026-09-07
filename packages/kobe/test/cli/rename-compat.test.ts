import {
  installRoveEnvCompatibility,
  legacyKobeEnvKey,
  readRoveEnv,
  readRoveHomeDirEnv,
  setRoveEnv,
} from "@sma1lboy/kobe-daemon/compat-env"
import {
  defaultDaemonPidPath,
  defaultDaemonSocketPath,
  defaultPtyHostPidPath,
  defaultPtyHostSocketPath,
} from "@sma1lboy/kobe-daemon/daemon/paths"
import { afterEach, describe, expect, test } from "vitest"
import { roveCliInvocation } from "../../src/cli/invocation.ts"
import {
  activeCliName,
  markKobeInvocation,
  markRoveInvocation,
  prepareCliEnvironment,
} from "../../src/cli/rename-compat.ts"

describe("rove environment compatibility", () => {
  test("ROVE_* overrides the matching legacy KOBE_* value", () => {
    const env: NodeJS.ProcessEnv = {
      ROVE_HOME_DIR: "/new-home",
      KOBE_HOME_DIR: "/old-home",
      ROVE_DEBUG: "1",
    }

    installRoveEnvCompatibility(env)

    expect(env.KOBE_HOME_DIR).toBe("/new-home")
    expect(env.KOBE_DEBUG).toBe("1")
    expect(env.ROVE_HOME_DIR).toBe("/new-home")
  })

  test("an existing KOBE_* value survives when no ROVE_* value exists", () => {
    const env: NodeJS.ProcessEnv = { KOBE_HOME_DIR: "/legacy-home" }
    installRoveEnvCompatibility(env)
    expect(env.KOBE_HOME_DIR).toBe("/legacy-home")
    expect(readRoveEnv("HOME_DIR", env)).toBe("/legacy-home")
  })

  test("an explicit internal override stamps both names over ambient values", () => {
    const env: NodeJS.ProcessEnv = {
      ROVE_HOME_DIR: "/ambient-rove-home",
      KOBE_HOME_DIR: "/ambient-kobe-home",
    }
    setRoveEnv("HOME_DIR", "/isolated-home", env)
    expect(readRoveEnv("HOME_DIR", env)).toBe("/isolated-home")
    expect(env.ROVE_HOME_DIR).toBe("/isolated-home")
    expect(env.KOBE_HOME_DIR).toBe("/isolated-home")
  })

  test("the internal invoked-as marker is not exposed as a KOBE_* control", () => {
    const env: NodeJS.ProcessEnv = {}
    markRoveInvocation(env)
    prepareCliEnvironment(env)

    expect(activeCliName(env)).toBe("rove")
    expect(env.KOBE_INVOKED_AS).toBeUndefined()
  })

  test("the shared kobe entry stays the legacy alias by default", () => {
    expect(activeCliName({})).toBe("kobe")
    expect(legacyKobeEnvKey("ROVE_TASK_ID")).toBe("KOBE_TASK_ID")
    expect(legacyKobeEnvKey("OTHER_TASK_ID")).toBeUndefined()
  })

  test("the kobe wrapper overrides a stale inherited invocation marker", () => {
    const env: NodeJS.ProcessEnv = { ROVE_INVOKED_AS: "rove" }
    markKobeInvocation(env)
    expect(activeCliName(env)).toBe("kobe")
  })

  test("source-mode child invocations follow the active public wrapper", () => {
    const original = process.env.ROVE_INVOKED_AS
    try {
      markRoveInvocation()
      expect(roveCliInvocation()).toEqual([
        process.execPath,
        "--conditions=browser",
        expect.stringMatching(/\/cli\/rove\.ts$/),
      ])

      markKobeInvocation()
      expect(roveCliInvocation()).toEqual([
        process.execPath,
        "--conditions=browser",
        expect.stringMatching(/\/cli\/kobe\.ts$/),
      ])
    } finally {
      if (original === undefined) Reflect.deleteProperty(process.env, "ROVE_INVOKED_AS")
      else process.env.ROVE_INVOKED_AS = original
    }
  })
})

/**
 * `VAR=` is how a shell says "unset", and this repo's own fixtures spell it
 * that way (`compat-env.ts` names the visual fixture's `ROVE_TASK_ID=`). Read
 * through a bare `??` chain a DEFINED empty `ROVE_*` is a value, so it shadows
 * the real `KOBE_*` beside it — and the two consumers that matters for are the
 * ones that decide WHERE things are written: the state home, and the daemon /
 * PTY socket + pid paths that are the whole of an isolated run's isolation.
 */
describe("a blank ROVE_* value is unset, not a value", () => {
  /** Every suffix `readRoveEnv` serves. Blank must fall through for all of
   *  them — the guard belongs to the reader, not to each call site. */
  const SUFFIXES = [
    "DAEMON_SOCKET_PATH",
    "DAEMON_PID_PATH",
    "PTY_SOCKET_PATH",
    "PTY_PID_PATH",
    "DAEMON_IDLE_GRACE_MS",
    "RPC_TIMEOUT_MS",
    "DEV",
    "FILETREE_WATCH",
    "HOOK_DEBUG",
    "OPEN_EDITOR",
    "HOME_DIR",
  ] as const

  test.each(SUFFIXES)("%s: blank ROVE_* falls through to KOBE_*", (suffix) => {
    const env: NodeJS.ProcessEnv = { [`ROVE_${suffix}`]: "", [`KOBE_${suffix}`]: "isolated" }
    expect(readRoveEnv(suffix, env)).toBe("isolated")
  })

  test.each(SUFFIXES)("%s: blank in both namespaces reads as absent", (suffix) => {
    expect(readRoveEnv(suffix, { [`ROVE_${suffix}`]: "", [`KOBE_${suffix}`]: "   " })).toBeUndefined()
  })

  test("the home accessor answers the same, so a caller's `?? homedir()` takes over", () => {
    expect(readRoveHomeDirEnv({ ROVE_HOME_DIR: "", KOBE_HOME_DIR: "/isolated-home" })).toBe("/isolated-home")
    expect(readRoveHomeDirEnv({ ROVE_HOME_DIR: "" })).toBeUndefined()
  })

  test("mirroring does not overwrite a real KOBE_* with a blank ROVE_*", () => {
    const env: NodeJS.ProcessEnv = { ROVE_HOME_DIR: "", KOBE_HOME_DIR: "/isolated-home" }
    installRoveEnvCompatibility(env)
    // The other half of the same bug: the mirror ran before any read, so it
    // destroyed the one namespace that still held the isolated value.
    expect(env.KOBE_HOME_DIR).toBe("/isolated-home")
    expect(readRoveEnv("HOME_DIR", env)).toBe("/isolated-home")
  })
})

describe("blank ROVE_* overrides keep an isolated daemon isolated", () => {
  const saved = new Map<string, string | undefined>()

  function stub(key: string, value: string): void {
    if (!saved.has(key)) saved.set(key, process.env[key])
    process.env[key] = value
  }

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
    saved.clear()
  })

  // The exact shape a harness writes: `ROVE_*=` for "unset", `KOBE_*` pointing
  // at the isolated runtime. Resolving to the DEFAULT path here is not a
  // cosmetic miss — it connects the run to the user's production daemon.
  test.each([
    ["DAEMON_SOCKET_PATH", "/tmp/iso-daemon.sock", () => defaultDaemonSocketPath()],
    ["DAEMON_PID_PATH", "/tmp/iso-daemon.pid", () => defaultDaemonPidPath()],
    ["PTY_SOCKET_PATH", "/tmp/iso-pty.sock", () => defaultPtyHostSocketPath()],
    ["PTY_PID_PATH", "/tmp/iso-pty.pid", () => defaultPtyHostPidPath()],
  ] as const)("%s", (suffix, isolated, resolve) => {
    stub(`ROVE_${suffix}`, "")
    stub(`KOBE_${suffix}`, isolated)
    expect(resolve()).toBe(isolated)
  })
})
