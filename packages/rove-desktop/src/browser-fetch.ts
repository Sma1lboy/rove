/**
 * Authenticated HTTP `fetch` sharing a live browser tab's persistent Electron session/cookies.
 * Same-origin (or relative) URLs run inside the page context (`window.fetch` with `credentials: "include"`);
 * cross-origin absolute URLs run through `webContents.session.fetch` so persistent cookies still apply.
 */

import { type AutomationTab, evalTab } from "./browser-automation"
import { type FetchResult, validateBrowserUrl } from "./browser-protocol"

const MAX_FETCH_BYTES = 512 * 1024

export async function fetchFromTab(
  tab: AutomationTab,
  opts: {
    readonly url: string
    readonly method?: string
    readonly headers?: Readonly<Record<string, string>>
    readonly body?: string
    readonly bridgeOrigin: string | null
  },
): Promise<FetchResult> {
  const wc = tab.webContents
  const currentUrl = wc.getURL()
  let resolved: URL
  try {
    resolved = currentUrl.startsWith("http") ? new URL(opts.url, currentUrl) : new URL(opts.url)
  } catch {
    throw new Error(`invalid fetch URL: ${opts.url}`)
  }
  validateBrowserUrl(resolved.href, opts.bridgeOrigin)
  const method = (opts.method ?? "GET").toUpperCase()
  const sameOrigin = currentUrl.startsWith("http") && new URL(currentUrl).origin === resolved.origin

  if (sameOrigin) {
    const expr = `(async () => {
      const res = await fetch(${JSON.stringify(resolved.href)}, {
        method: ${JSON.stringify(method)},
        credentials: "include",
        ${opts.headers ? `headers: ${JSON.stringify(opts.headers)},` : ""}
        ${opts.body !== undefined ? `body: ${JSON.stringify(opts.body)},` : ""}
      });
      const text = await res.text();
      const headers = {};
      res.headers.forEach((v, k) => { headers[k] = v; });
      return { url: res.url || ${JSON.stringify(resolved.href)}, status: res.status, statusText: res.statusText, ok: res.ok, headers, text };
    })()`
    const out = (await evalTab(tab, expr)).value as {
      url: string
      status: number
      statusText: string
      ok: boolean
      headers: Record<string, string>
      text: string
    }
    return formatFetchResult(tab.id, out)
  }

  const res = await wc.session.fetch(resolved.href, {
    method,
    credentials: "include",
    ...(opts.headers ? { headers: opts.headers } : {}),
    ...(opts.body !== undefined ? { body: opts.body } : {}),
  })
  const text = await res.text()
  const headers: Record<string, string> = {}
  res.headers.forEach((v, k) => {
    headers[k] = v
  })
  return formatFetchResult(tab.id, {
    url: res.url || resolved.href,
    status: res.status,
    statusText: res.statusText,
    ok: res.ok,
    headers,
    text,
  })
}

function formatFetchResult(
  id: string,
  raw: { url: string; status: number; statusText: string; ok: boolean; headers: Record<string, string>; text: string },
): FetchResult {
  const truncated = Buffer.byteLength(raw.text, "utf8") > MAX_FETCH_BYTES
  const body = truncated ? raw.text.slice(0, MAX_FETCH_BYTES) : raw.text
  let json: unknown
  if (!truncated && (raw.headers["content-type"] ?? "").includes("json")) {
    try {
      json = JSON.parse(body)
    } catch {
      /* non-JSON body with JSON content-type: leave json undefined */
    }
  }
  return {
    id,
    url: raw.url,
    status: raw.status,
    statusText: raw.statusText,
    ok: raw.ok,
    headers: raw.headers,
    body,
    ...(json !== undefined ? { json } : {}),
    ...(truncated ? { truncated: true } : {}),
  }
}
