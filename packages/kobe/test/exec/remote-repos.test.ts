import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { kvStatePath } from "../../src/env.ts"
import {
  execHostForRepo,
  execHostForWorktreePath,
  localSpawnCwd,
  remoteKeyForRepo,
  remoteSpecFromConfig,
  worktreeUsable,
} from "../../src/exec/resolve.ts"
import {
  addRemoteRepo,
  getRemoteRepoConfig,
  getSavedRepos,
  isRemoteProjectsEnabled,
  isRemoteRepoKey,
  remoteRepoKey,
  resolveRepoRoot,
} from "../../src/state/repos.ts"

let home: string
const ORIGINAL = process.env.KOBE_HOME_DIR

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kobe-remote-"))
  process.env.KOBE_HOME_DIR = home
})

afterEach(() => {
  if (ORIGINAL === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = ORIGINAL
})

describe("remoteRepoKey / isRemoteRepoKey", () => {
  it("encodes ssh://user@host[:port][/basePath] and round-trips through resolveRepoRoot", () => {
    expect(remoteRepoKey("box", "dev", 2222)).toBe("ssh://dev@box:2222")
    expect(remoteRepoKey("box", "dev")).toBe("ssh://dev@box")
    // The base path is part of the identity: it is the only thing that tells
    // two projects on one host+user apart.
    expect(remoteRepoKey("box", "dev", 2222, "/srv/work")).toBe("ssh://dev@box:2222/srv/work")
    expect(remoteRepoKey("box", "dev", undefined, "srv/work")).toBe("ssh://dev@box/srv/work")
    expect(remoteRepoKey("box", "dev", undefined, "/srv/work/")).toBe("ssh://dev@box/srv/work")
    expect(isRemoteRepoKey("ssh://dev@box")).toBe(true)
    expect(isRemoteRepoKey("/Users/dev/proj")).toBe(false)
    // resolveRepoRoot must NOT canonicalize a remote key (no local path to ask git about).
    expect(resolveRepoRoot("ssh://dev@box:2222")).toBe("ssh://dev@box:2222")
  })
})

describe("addRemoteRepo", () => {
  it("stores the config and adds the synthetic key to savedRepos", () => {
    const { key, added } = addRemoteRepo({
      host: "box",
      user: "dev",
      port: 2222,
      basePath: "/srv/work",
      auth: { kind: "key", keyPath: "/home/dev/.ssh/id" },
    })
    expect(key).toBe("ssh://dev@box:2222/srv/work")
    expect(added).toBe(true)
    expect(getSavedRepos()).toContain("ssh://dev@box:2222/srv/work")
    expect(getRemoteRepoConfig(key)?.basePath).toBe("/srv/work")
  })

  it("is idempotent for the same base path", () => {
    addRemoteRepo({ host: "box", user: "dev", basePath: "/a", auth: { kind: "key" } })
    const second = addRemoteRepo({ host: "box", user: "dev", basePath: "/a", auth: { kind: "key" } })
    expect(second.added).toBe(false)
    expect(getSavedRepos().filter((r) => r === "ssh://dev@box/a")).toHaveLength(1)
  })

  // Two repos on one host+user are two projects. Keying without the base path
  // made the second registration overwrite the first's config in place and
  // report it as "updated remote project" — the user asked for a second
  // project and silently lost the first, and repoA's tasks then resolved
  // their worktree root under repoB.
  it("keeps two projects on one host+user distinct", () => {
    const a = addRemoteRepo({ host: "box", user: "dev", basePath: "/a", auth: { kind: "key" } })
    const b = addRemoteRepo({ host: "box", user: "dev", basePath: "/b", auth: { kind: "key" } })
    expect(a.added).toBe(true)
    expect(b.added).toBe(true)
    expect(a.key).not.toBe(b.key)
    expect(getRemoteRepoConfig(a.key)?.basePath).toBe("/a")
    expect(getRemoteRepoConfig(b.key)?.basePath).toBe("/b")
    expect(getSavedRepos().filter((r) => r.startsWith("ssh://dev@box"))).toHaveLength(2)
  })

  // A project registered before the key carried its base path keeps its
  // pathless key — its tasks store that string as `task.repo`, so minting the
  // new key would strand them behind a second, config-less sidebar row.
  it("updates a legacy pathless registration in place", () => {
    mkdirSync(dirname(kvStatePath()), { recursive: true })
    writeFileSync(
      kvStatePath(),
      JSON.stringify({
        savedRepos: ["ssh://dev@box"],
        remoteRepos: { "ssh://dev@box": { host: "box", user: "dev", basePath: "/srv", auth: { kind: "key" } } },
      }),
      "utf8",
    )
    const { key, added } = addRemoteRepo({
      host: "box",
      user: "dev",
      basePath: "/srv",
      auth: { kind: "password", keychainRef: { service: "s", account: "a" } },
    })
    expect(key).toBe("ssh://dev@box")
    expect(added).toBe(false)
    expect(getSavedRepos()).toEqual(["ssh://dev@box"])
    expect(getRemoteRepoConfig("ssh://dev@box")?.auth.kind).toBe("password")
  })
})

describe("isRemoteProjectsEnabled", () => {
  function writeState(obj: Record<string, unknown>): void {
    const p = kvStatePath()
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(obj), "utf8")
  }

  it("is false by default / when the key is absent or not exactly true", () => {
    expect(isRemoteProjectsEnabled()).toBe(false)
    writeState({ "experimental.remoteProjects": false })
    expect(isRemoteProjectsEnabled()).toBe(false)
    writeState({ "experimental.remoteProjects": "1" })
    expect(isRemoteProjectsEnabled()).toBe(false)
  })

  it("is true only when the flag is the boolean true", () => {
    writeState({ "experimental.remoteProjects": true })
    expect(isRemoteProjectsEnabled()).toBe(true)
  })
})

describe("execHostForRepo", () => {
  it("returns a LocalExecHost for an ordinary path", () => {
    expect(execHostForRepo("/Users/dev/proj").isRemote).toBe(false)
  })

  it("returns a RemoteExecHost for a registered remote key", () => {
    const { key } = addRemoteRepo({ host: "box", user: "dev", basePath: "/srv", auth: { kind: "key" } })
    expect(execHostForRepo(key).isRemote).toBe(true)
  })

  it("falls back to local for an ssh:// key with no stored config", () => {
    expect(execHostForRepo("ssh://ghost@nowhere").isRemote).toBe(false)
  })

  // The whole point of the controlPath cache (exec/resolve.ts) is that repeat
  // calls for the same remote project reuse ONE RemoteExecHost instance
  // instead of paying its sync ControlMaster `-O check` (see exec-host.ts)
  // on every git operation.
  it("caches the RemoteExecHost instance by controlPath across repeat calls", () => {
    const { key } = addRemoteRepo({ host: "box", user: "dev", basePath: "/srv", auth: { kind: "key" } })
    const first = execHostForRepo(key)
    const second = execHostForRepo(key)
    expect(second).toBe(first)
  })

  it("execHostForRepo and execHostForWorktreePath share the same cached instance", () => {
    const { key } = addRemoteRepo({ host: "box", user: "dev", basePath: "/srv/work", auth: { kind: "key" } })
    const byRepo = execHostForRepo(key)
    const byPath = execHostForWorktreePath("/srv/work/kobe-task-1")
    expect(byPath).toBe(byRepo)
  })
})

// The intent-named seam queries: callers around ensureSession/spawning ask
// these instead of deriving remoteness per call site (`isRemoteRepoKey(...)
// ? repo : undefined`, `.isRemote || existsSync`, `.isRemote ? homeDir() :
// cwd`). A third adapter must only change `exec/`, never the call sites.
describe("remoteKeyForRepo", () => {
  it("passes a remote ssh:// key through and drops local/absent repos", () => {
    expect(remoteKeyForRepo("ssh://dev@box:2222")).toBe("ssh://dev@box:2222")
    expect(remoteKeyForRepo("/Users/dev/proj")).toBeUndefined()
    expect(remoteKeyForRepo(undefined)).toBeUndefined()
    expect(remoteKeyForRepo("")).toBeUndefined()
  })
})

describe("worktreeUsable", () => {
  it("local paths keep the real on-disk check", () => {
    expect(worktreeUsable(home)).toBe(true) // the temp home exists
    expect(worktreeUsable(join(home, "definitely-missing"))).toBe(false)
  })

  it("a path under a remote project's basePath is trusted without a local stat", () => {
    addRemoteRepo({ host: "box", user: "dev", basePath: "/srv/work", auth: { kind: "key" } })
    // Doesn't exist locally — must still be usable (it lives on the remote).
    expect(worktreeUsable("/srv/work/kobe-task-1")).toBe(true)
  })
})

describe("localSpawnCwd", () => {
  it("is the identity for a local worktree", () => {
    expect(localSpawnCwd(home)).toBe(home)
  })

  it("falls back to the local home dir for a remote worktree path", () => {
    addRemoteRepo({ host: "box", user: "dev", basePath: "/srv/work", auth: { kind: "key" } })
    // KOBE_HOME_DIR (= the temp home) overrides os.homedir() in env.homeDir().
    expect(localSpawnCwd("/srv/work/kobe-task-1")).toBe(home)
  })
})

describe("remoteSpecFromConfig", () => {
  it("derives the control socket under KOBE_HOME and maps key auth", () => {
    const spec = remoteSpecFromConfig({
      host: "box",
      user: "dev",
      port: 22,
      basePath: "/srv",
      auth: { kind: "key", keyPath: "/k" },
    })
    expect(spec.controlPath.startsWith(home)).toBe(true)
    expect(spec.controlPath.endsWith(".sock")).toBe(true)
    expect(spec.auth).toEqual({ kind: "key", keyPath: "/k" })
  })

  it("password auth exposes a lazy getter, not the secret", () => {
    const spec = remoteSpecFromConfig({
      host: "box",
      user: "dev",
      basePath: "/srv",
      auth: { kind: "password", keychainRef: { service: "kobe-remote-ssh", account: "dev@box" } },
    })
    expect(spec.auth.kind).toBe("password")
    if (spec.auth.kind === "password") {
      // No keychain item exists in this temp env → getter yields null, never throws.
      expect(spec.auth.getPassword()).toBeNull()
    }
  })
})
