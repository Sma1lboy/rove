/**
 * OS keychain for remote-project SSH passwords — the only module that touches
 * it. `state.json` holds only a `keychainRef`; the secret is read just-in-time
 * to bring up the SSH ControlMaster (see `exec-host.ts`).
 *
 * macOS only (`security` CLI). Linux (`secret-tool`) / Windows (DPAPI) are not
 * wired; `isKeychainSupported` reports false there so callers can say so.
 *
 * Security:
 *   - Storing passes the password as the argv element after `-w`, briefly
 *     exposing it on this process's argv; accepted because storing is a rare
 *     user action and `security` has no env alternative. Reads never put it on argv.
 *   - Never logged; callers must not echo the returned value.
 */

import { spawnSync } from "node:child_process"
import { platform } from "node:os"

/** Where a secret lives in the keychain — this is what `state.json` stores. */
export interface KeychainRef {
  readonly service: string
  readonly account: string
}

/** Injected so tests don't touch the real keychain. */
export interface KeychainDeps {
  run(argv: readonly string[]): { stdout: string; exitCode: number }
  platform(): string
}

const defaultDeps: KeychainDeps = {
  run(argv) {
    const [cmd, ...rest] = argv
    const proc = spawnSync(cmd ?? "", rest, { encoding: "utf8", shell: false })
    return { stdout: proc.stdout ?? "", exitCode: proc.status ?? -1 }
  },
  platform() {
    return platform()
  },
}

const KOBE_KEYCHAIN_SERVICE = "kobe-remote-ssh"

/** Account is `user@host[:port]`. */
export function remoteKeychainRef(host: string, user: string, port?: number): KeychainRef {
  return { service: KOBE_KEYCHAIN_SERVICE, account: port ? `${user}@${host}:${port}` : `${user}@${host}` }
}

export function isKeychainSupported(deps: KeychainDeps = defaultDeps): boolean {
  return deps.platform() === "darwin"
}

/** Store or overwrite (`-U`) a password. */
export function setKeychainPassword(ref: KeychainRef, password: string, deps: KeychainDeps = defaultDeps): boolean {
  if (deps.platform() !== "darwin") return false
  const { exitCode } = deps.run([
    "security",
    "add-generic-password",
    "-U",
    "-s",
    ref.service,
    "-a",
    ref.account,
    "-w",
    password,
  ])
  return exitCode === 0
}

/** Null if absent / unsupported. */
export function getKeychainPassword(ref: KeychainRef, deps: KeychainDeps = defaultDeps): string | null {
  if (deps.platform() !== "darwin") return null
  const { stdout, exitCode } = deps.run([
    "security",
    "find-generic-password",
    "-s",
    ref.service,
    "-a",
    ref.account,
    "-w",
  ])
  if (exitCode !== 0) return null
  // `security -w` appends a trailing newline; the password itself never has one.
  return stdout.replace(/\n$/, "")
}

/** True if an item was removed. */
export function deleteKeychainPassword(ref: KeychainRef, deps: KeychainDeps = defaultDeps): boolean {
  if (deps.platform() !== "darwin") return false
  const { exitCode } = deps.run(["security", "delete-generic-password", "-s", ref.service, "-a", ref.account])
  return exitCode === 0
}
