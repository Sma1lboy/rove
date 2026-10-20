/**
 * What went wrong, read from ssh's own stderr. ssh exits 255 for every one of
 * these, and each has a different remedy: "ssh to narwhal failed" sends the
 * user to search for the cause Rove already had in hand.
 */

export type SshFailureKind =
  | "unresolved"
  | "refused"
  | "timeout"
  | "host-key-changed"
  | "host-key-unverified"
  | "auth-denied"
  | "unknown"

/** Ordered: a changed host key also prints `Host key verification failed`. */
const PATTERNS: readonly (readonly [SshFailureKind, RegExp])[] = [
  ["host-key-changed", /REMOTE HOST IDENTIFICATION HAS CHANGED|Host key for .* has changed/i],
  ["host-key-unverified", /Host key verification failed|No .*host key is known for/i],
  ["auth-denied", /Permission denied \(|Too many authentication failures|no matching host key type/i],
  ["unresolved", /Could not resolve hostname|Name or service not known|nodename nor servname/i],
  ["refused", /Connection refused/i],
  ["timeout", /timed out|Operation timed out|No route to host|Network is unreachable/i],
]

export function classifySshFailure(stderr: string): SshFailureKind {
  for (const [kind, pattern] of PATTERNS) if (pattern.test(stderr)) return kind
  return "unknown"
}

/** One line naming the cause and the next step. `target` is what the user typed. */
export function sshFailureRemedy(kind: SshFailureKind, target: string): string {
  switch (kind) {
    case "unresolved":
      return `${target} does not resolve to an address. Check the name, or the Host block in ~/.ssh/config; on a tailnet, check \`tailscale status\`.`
    case "refused":
      return `${target} refused the connection: nothing listens for ssh there. Enable Remote Login / start sshd on it, or pass the right --port.`
    case "timeout":
      return `${target} did not answer. Is it awake and on this network (or VPN / tailnet)?`
    case "host-key-changed":
      return `${target}'s host key CHANGED since you last connected. That is either a reinstall or someone in the middle. If you reinstalled it, remove the old key with \`ssh-keygen -R <host>\` and retry; otherwise stop here.`
    case "host-key-unverified":
      return `${target}'s host key is not trusted yet. Run \`rove machine add\` in a terminal to confirm its fingerprint, or connect once with \`ssh ${target}\`.`
    case "auth-denied":
      return `${target} rejected every key ssh offered. Load your key into ssh-agent, pass --identity <key>, or install a key there with \`ssh-copy-id ${target}\`.`
    case "unknown":
      return `ssh to ${target} failed. Run \`ssh ${target} true\` to see why.`
  }
}
