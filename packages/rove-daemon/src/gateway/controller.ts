/**
 * Daemon-owned lifecycle controller for the optional local provider gateway.
 *
 * Keeps `server.ts` slim: reads config via the injected loader, starts the
 * loopback HTTP server only when `enabled: true`, supports live reload without
 * restarting the daemon, and always answers `status()` / `sessionEnv()` safely
 * (even when disabled).
 */

import { DEFAULT_PROVIDER_GATEWAY_CONFIG, parseProviderGatewayConfig } from "./config.ts"
import { type GatewayCredentialDeps, isGatewayKeychainSupported } from "./keychain.ts"
import { ProviderGatewayRouter } from "./router.ts"
import { type GatewayFetch, type ProviderGatewayHandle, startProviderGateway } from "./server.ts"
import type {
  GatewayLogEvent,
  ProviderGatewayConfig,
  ProviderGatewaySessionEnv,
  ProviderGatewayStatus,
} from "./types.ts"

export interface ProviderGatewayControllerOptions {
  readonly loadConfig: () => unknown
  readonly log?: (line: string) => void
  readonly logError?: (err: unknown) => void
  readonly credentialDeps?: GatewayCredentialDeps
  readonly fetchImpl?: GatewayFetch
  readonly now?: () => number
}

export class ProviderGatewayController {
  private config: ProviderGatewayConfig = DEFAULT_PROVIDER_GATEWAY_CONFIG
  private handle: ProviderGatewayHandle | null = null
  private closed = false
  private readonly options: ProviderGatewayControllerOptions

  constructor(options: ProviderGatewayControllerOptions) {
    this.options = options
  }

  private onGatewayLog = (event: GatewayLogEvent): void => {
    this.options.log?.(JSON.stringify(event))
  }

  async start(): Promise<void> {
    if (this.closed) return
    await this.reload()
  }

  /** Re-read config and start, stop, or rebind the loopback server as needed. */
  async reload(): Promise<ProviderGatewayStatus> {
    if (this.closed) return this.status()
    let raw: unknown
    try {
      raw = this.options.loadConfig()
    } catch (err) {
      this.options.logError?.(err)
      return this.status()
    }
    const { config: next, warnings } = parseProviderGatewayConfig(raw)
    for (const warning of warnings) {
      this.options.log?.(JSON.stringify({ event: "config_warning", ts: new Date().toISOString(), warning }))
    }

    const prev = this.config
    this.config = next

    if (!next.enabled) {
      if (this.handle) {
        await this.handle.close()
        this.handle = null
      }
      return this.status()
    }

    const bindChanged =
      this.handle !== null && (this.handle.host !== next.host || (next.port !== 0 && this.handle.port !== next.port))
    if (this.handle && !bindChanged && prev.enabled) {
      this.handle.updateConfig(next)
      return this.status()
    }

    if (this.handle) {
      await this.handle.close()
      this.handle = null
    }

    try {
      this.handle = await startProviderGateway({
        config: next,
        credentialDeps: this.options.credentialDeps,
        fetchImpl: this.options.fetchImpl,
        onLog: this.onGatewayLog,
        now: this.options.now,
      })
    } catch (err) {
      this.options.logError?.(err)
      this.handle = null
    }
    return this.status()
  }

  status(): ProviderGatewayStatus {
    if (this.handle) return this.handle.status()
    const router = new ProviderGatewayRouter(this.config, {
      credentialDeps: this.options.credentialDeps,
      now: this.options.now,
    })
    return {
      enabled: this.config.enabled,
      running: false,
      host: this.config.host,
      port: null,
      baseUrl: null,
      injectMode: this.config.injectMode,
      keychainSupported: isGatewayKeychainSupported(this.options.credentialDeps),
      providers: router.providerStatuses(),
    }
  }

  sessionEnv(): ProviderGatewaySessionEnv {
    if (this.handle) return this.handle.sessionEnv()
    return {
      enabled: this.config.enabled,
      running: false,
      baseUrl: null,
      token: null,
      injectMode: this.config.injectMode,
    }
  }

  resetCooldown(providerId?: string): number {
    return this.handle ? this.handle.resetCooldown(providerId) : 0
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.handle) {
      const h = this.handle
      this.handle = null
      await h.close()
    }
  }
}
