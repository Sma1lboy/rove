import { describe, expect, test } from "bun:test"
import { pairingUrl } from "../src/auth.ts"
import { parseBridgeArgs } from "../src/cli-args.ts"

const TS = () => ({ ipv4: "100.64.1.2", dnsName: "mac.tail1234.ts.net" })
const NO_TS = () => ({ ipv4: null, dnsName: null })

describe("presets", () => {
  test("no arguments listens on loopback only", () => {
    expect(parseBridgeArgs([], { tailscale: TS })).toMatchObject({ preset: "none", hosts: ["127.0.0.1"], tls: false })
  })

  test("tailscale binds only the tailnet address and pairs over MagicDNS", () => {
    const a = parseBridgeArgs(["--preset", "tailscale"], { tailscale: TS })
    expect(a).toMatchObject({ hosts: ["100.64.1.2"], publicHost: "mac.tail1234.ts.net", tls: false })
    expect(pairingUrl({ host: a.publicHost ?? "", port: a.port, token: "T", tls: a.tls, preset: a.preset })).toBe(
      "ws://mac.tail1234.ts.net:7878/?token=T&preset=tailscale",
    )
  })

  test("tailscale with a `tailscale serve` name pairs over wss on the default port", () => {
    const a = parseBridgeArgs(["--preset", "tailscale", "--public-host", "mac.tail1234.ts.net"], { tailscale: TS })
    expect(pairingUrl({ host: "mac.tail1234.ts.net", port: a.port, token: "T", tls: a.tls, preset: a.preset })).toBe(
      "wss://mac.tail1234.ts.net/?token=T&preset=tailscale",
    )
  })

  test("tailscale without a tailnet fails instead of widening the bind", () => {
    expect(() => parseBridgeArgs(["--preset", "tailscale"], { tailscale: NO_TS })).toThrow("returned no address")
  })

  test("cf listens on loopback for cloudflared and pairs over the public wss hostname", () => {
    const a = parseBridgeArgs([
      "--preset",
      "cf",
      "--cf-team",
      "acme",
      "--cf-aud",
      "aud1",
      "--public-host",
      "rove.example.com",
    ])
    expect(a).toMatchObject({
      preset: "cf",
      hosts: ["127.0.0.1"],
      tls: true,
      cloudflare: { teamDomain: "https://acme.cloudflareaccess.com", aud: "aud1" },
    })
    expect(pairingUrl({ host: "rove.example.com", port: a.port, token: "T", tls: a.tls, preset: a.preset })).toBe(
      "wss://rove.example.com/?token=T&preset=cf",
    )
  })

  test("cf reads team, AUD and hostname from config, and `cloudflare` is an alias", () => {
    const a = parseBridgeArgs(["--preset", "cloudflare"], {
      config: { cfTeam: "acme.cloudflareaccess.com", cfAud: "aud1", publicHost: "rove.example.com" },
    })
    expect(a.cloudflare?.teamDomain).toBe("https://acme.cloudflareaccess.com")
    expect(a.publicHost).toBe("rove.example.com")
  })

  test("cf refuses to start without Access settings or a hostname", () => {
    expect(() => parseBridgeArgs(["--preset", "cf", "--public-host", "r.example.com"])).toThrow(
      "--cf-team and --cf-aud",
    )
    expect(() => parseBridgeArgs(["--preset", "cf", "--cf-team", "acme", "--cf-aud", "a"])).toThrow("--public-host")
  })

  test("a saved tunnel hostname does not leak into the tailscale preset", () => {
    const a = parseBridgeArgs(["--preset", "tailscale"], { tailscale: TS, config: { publicHost: "rove.example.com" } })
    expect(a.publicHost).toBe("mac.tail1234.ts.net")
    expect(a.tls).toBe(false)
  })

  test("a preset owns the listen address; --host alongside it and unknown presets are refused", () => {
    expect(() => parseBridgeArgs(["--preset", "tailscale", "--host", "0.0.0.0"], { tailscale: TS })).toThrow(
      "cannot be combined",
    )
    expect(() => parseBridgeArgs(["--preset", "lan"])).toThrow("tailscale or cf")
    expect(() =>
      parseBridgeArgs(["--preset", "cf", "--cf-team", "acme.evil.com", "--cf-aud", "x", "--public-host", "h"]),
    ).toThrow("--cf-team")
  })
})
