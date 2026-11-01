/**
 * How the page reaches the bridge. Served by `rove --web`, that is this origin. Booted by the relay
 * shell (`relay-shell.ts`, `--preset relay`), it is the shell's end-to-end encrypted tunnel, which
 * the shell installs as `__roveRelay` before this bundle runs. Same `fetch`/`WebSocket` contract
 * either way, so the shell a Worker serves keeps working as this client changes.
 */

export interface RelayTransport {
  readonly fetch: (path: string, init?: RequestInit) => Promise<Response>
  readonly WebSocket: new (url: string, protocols: string[]) => WebSocket
}

const relay = Reflect.get(globalThis, "__roveRelay") as RelayTransport | undefined

export function bridgeFetch(path: string, init?: RequestInit): Promise<Response> {
  return relay ? relay.fetch(path, init) : fetch(path, init)
}

export function openBridgeSocket(url: string, protocols: string[]): WebSocket {
  return relay ? new relay.WebSocket(url, protocols) : new WebSocket(url, protocols)
}
