/**
 * Parent-exit watchdog for the PTY sidecar. SIGINT/SIGTERM never reach the
 * sidecar when its launcher dies hard (a killed `dev.ts`, a closed terminal on
 * Windows), and without them the sidecar's PTY children outlive the harness.
 */

/**
 * Whether `pid` still names a live process. EPERM means it exists but belongs
 * to someone else, which still counts as alive.
 *
 * @param {number} pid
 * @param {(pid: number, signal: 0) => unknown} [kill]
 * @returns {boolean}
 */
export function processAlive(pid, kill = process.kill) {
  try {
    kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === "EPERM"
  }
}

/**
 * Poll for the parent and call `onGone` once it is gone. POSIX re-parents an
 * orphan, so a changed ppid is enough; Windows keeps the old ppid, so the pid
 * itself is probed too.
 *
 * @param {object} opts
 * @param {() => void} opts.onGone
 * @param {number} [opts.parentPid]
 * @param {() => number} [opts.currentPpid]
 * @param {(pid: number) => boolean} [opts.isAlive]
 * @param {number} [opts.intervalMs]
 * @returns {() => void} stops the watch
 */
export function watchParent({
  onGone,
  parentPid = process.ppid,
  currentPpid = () => process.ppid,
  isAlive = processAlive,
  intervalMs = 2000,
}) {
  const timer = setInterval(() => {
    if (currentPpid() === parentPid && isAlive(parentPid)) return
    clearInterval(timer)
    onGone()
  }, intervalMs)
  // The watch alone must not keep the sidecar running.
  timer.unref?.()
  return () => clearInterval(timer)
}
