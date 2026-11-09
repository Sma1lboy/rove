/**
 * Repeating conditions (a routine whose precheck keeps failing, a task whose
 * repo has no GitHub remote) were re-logged on every tick — nine of the ten
 * most frequent daemon.log lines. Log once per distinct message; passing
 * `undefined` clears the key so the next change logs again.
 */

import { logDaemonInfo } from "./crash-log.ts"

const lastLogged = new Map<string, string>()

export function logOncePerChange(key: string, subsystem: string, message: string | undefined): void {
  if (message === undefined) {
    lastLogged.delete(key)
    return
  }
  if (lastLogged.get(key) === message) return
  lastLogged.set(key, message)
  logDaemonInfo(subsystem, message)
}
