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
export const relayed = relay !== undefined

export function bridgeFetch(path: string, init?: RequestInit): Promise<Response> {
  return relay ? relay.fetch(path, init) : fetch(path, init)
}

/**
 * A bridge script the page loads by URL (an AudioWorklet). Through the relay the page's origin is the Worker,
 * which serves only the loader and allows `blob:` scripts, not `'self'`: the file comes through the tunnel as a blob.
 * A transport without it (the demo) keeps the plain path.
 */
export async function bridgeScriptUrl(path: string): Promise<string> {
  if (!relay) return path
  const res = await relay.fetch(path)
  if (!res.ok) return path
  return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: "text/javascript" }))
}

export function openBridgeSocket(url: string, protocols: string[]): WebSocket {
  return relay ? new relay.WebSocket(url, protocols) : new WebSocket(url, protocols)
}
