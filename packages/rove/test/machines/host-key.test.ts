import { describe, expect, it } from "vitest"
import { parseSshG } from "../../src/machines/host-key.ts"

const G = (lines: Record<string, string>): string =>
  Object.entries(lines)
    .map(([k, v]) => `${k} ${v}`)
    .join("\n")

const BASE = {
  hostname: "127.0.0.1",
  port: "22",
  userknownhostsfile: "~/.ssh/known_hosts ~/.ssh/known_hosts2",
  globalknownhostsfile: "/etc/ssh/ssh_known_hosts",
  proxyjump: "none",
}

/** `ssh -G` decides which known_hosts entry ssh will check; the confirmation must look up the same one. */
describe("parseSshG", () => {
  it("names a non-default port the way known_hosts stores it", () => {
    const d = parseSshG(G({ ...BASE, port: "2222" }), "/home/me")
    expect(d.knownHostsName).toBe("[127.0.0.1]:2222")
    expect(d.userKnownHosts).toEqual(["/home/me/.ssh/known_hosts", "/home/me/.ssh/known_hosts2"])
    expect(d.proxied).toBe(false)
  })

  it("uses a HostKeyAlias verbatim and the bare host on port 22", () => {
    expect(parseSshG(G(BASE)).knownHostsName).toBe("127.0.0.1")
    expect(parseSshG(G({ ...BASE, port: "2222", hostkeyalias: "narwhal-box" })).knownHostsName).toBe("narwhal-box")
  })

  it("marks a proxied destination, which ssh-keyscan cannot reach the same way", () => {
    expect(parseSshG(G({ ...BASE, proxyjump: "bastion" })).proxied).toBe(true)
    expect(parseSshG(G({ ...BASE, proxycommand: "tailscale nc %h %p" })).proxied).toBe(true)
  })
})
