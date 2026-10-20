/**
 * A repo's identity across machines: its `origin` URL, normalized so the
 * ssh and https spellings of one GitHub repo compare equal. A checkout lives
 * at a different path on every machine; its remote is what they share.
 */

import { execFile } from "node:child_process"

/**
 * `git@github.com:o/r.git`, `ssh://git@github.com/o/r`, `https://github.com/o/r.git`
 * → `github.com/o/r`. Null for anything that names no host and path.
 */
export function normalizeRemoteUrl(url: string): string | null {
  let tail = url.trim()
  if (!tail) return null
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(tail)
  if (scheme) {
    tail = tail.slice(scheme[0].length)
  } else {
    // scp-like `user@host:path`; a bare local path has no colon before its first slash.
    const scp = /^([^/:]+):(?!\/)(.+)$/.exec(tail)
    if (!scp) return null
    tail = `${scp[1]}/${scp[2]}`
  }
  tail = tail.replace(/^[^@/]*@/, "")
  const slash = tail.indexOf("/")
  if (slash <= 0) return null
  const host = tail.slice(0, slash).replace(/:\d+$/, "").toLowerCase()
  const path = tail
    .slice(slash + 1)
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
  return path ? `${host}/${path}` : null
}

/** `origin` of the checkout at `repo`, normalized; null when there is none. */
export function readRepoRemote(repo: string, timeoutMs = 3000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["-C", repo, "remote", "get-url", "origin"], { timeout: timeoutMs }, (err, stdout) => {
      resolve(err ? null : normalizeRemoteUrl(String(stdout)))
    })
  })
}
