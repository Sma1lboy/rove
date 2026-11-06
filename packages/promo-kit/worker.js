// promo-kit: team X promo library. Static page + R2 videos + a tiny JSON index.
// Reads need a verified Cloudflare Access JWT (header, or the CF_Authorization
// cookie on /api/*, which Access bypasses at the edge) or an upload token.
// Writes need an upload token: the UPLOAD_TOKEN secret, or a per-user token a
// logged-in member mints at POST /api/token. The site never talks to X.
//
// Gate: with ACCESS_TEAM / ACCESS_AUD unset every browser request is denied,
// so the domain stays closed until the Access app exists.

const INDEX = "index.json"
// ':' can't appear in item ids or upload keys, so writers can never reach these.
const TOK = "auth:tok/"
const USER = "auth:user/"

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })

const b64u = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))

// Returns the Access identity (email, or "(service)" for service tokens) or null.
async function accessUser(req, env) {
  if (env.DEV_NO_ACCESS === "1") return "dev@local"
  const jwt =
    req.headers.get("cf-access-jwt-assertion") ||
    req.headers.get("cookie")?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1]
  if (!jwt || !env.ACCESS_TEAM || !env.ACCESS_AUD) return null
  try {
    const [h, p, s] = jwt.split(".")
    const head = JSON.parse(new TextDecoder().decode(b64u(h)))
    const body = JSON.parse(new TextDecoder().decode(b64u(p)))
    const certs = await fetch(`https://${env.ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`, {
      cf: { cacheTtl: 3600 },
    }).then((r) => r.json())
    const jwk = certs.keys.find((k) => k.kid === head.kid)
    if (!jwk) return null
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"])
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(s), new TextEncoder().encode(`${h}.${p}`))
    const aud = [].concat(body.aud)
    const ok = valid && aud.includes(env.ACCESS_AUD) && body.exp * 1000 > Date.now()
    return ok ? body.email || "(service)" : null
  } catch {
    return null
  }
}

// Returns who owns the bearer upload token, or null.
async function tokenUser(req, env) {
  const t = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1]
  if (!t) return null
  if (env.UPLOAD_TOKEN && t === env.UPLOAD_TOKEN) return "owner"
  const o = await env.BUCKET.get(TOK + (await sha256(t)))
  return o ? (await o.json()).email : null
}

// One token per email: minting again revokes the previous one.
async function mintToken(env, email) {
  const token = "pk_" + hex(crypto.getRandomValues(new Uint8Array(32)))
  const hash = await sha256(token)
  const old = await env.BUCKET.get(USER + email)
  if (old) await env.BUCKET.delete(TOK + (await old.json()).hash)
  await env.BUCKET.put(TOK + hash, JSON.stringify({ email, created: new Date().toISOString() }))
  await env.BUCKET.put(USER + email, JSON.stringify({ hash }))
  return token
}

async function readIndex(env) {
  const o = await env.BUCKET.get(INDEX)
  return o ? o.json() : { items: [] }
}
// ponytail: read-modify-write on one JSON object; fine for one uploader, move to per-item keys if several push at once.
const writeIndex = (env, idx) =>
  env.BUCKET.put(INDEX, JSON.stringify(idx), { httpMetadata: { contentType: "application/json" } })

const validKey = (k) => k && /^[\w-]+\/[\w.-]+$/.test(k)

async function serveObject(req, env, key, url) {
  const obj = await env.BUCKET.get(key, { range: req.headers, onlyIf: req.headers })
  if (!obj) return new Response("not found", { status: 404 })
  const h = new Headers()
  obj.writeHttpMetadata(h)
  h.set("etag", obj.httpEtag)
  h.set("accept-ranges", "bytes")
  h.set("cache-control", "private, max-age=3600")
  const dl = url.searchParams.get("dl")
  if (dl) h.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(dl)}`)
  if (!("body" in obj)) return new Response(null, { status: 304, headers: h })
  if (req.headers.has("range") && obj.range) {
    const { offset = 0, length = obj.size - offset } = obj.range
    h.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`)
    h.set("content-length", String(length))
    return new Response(obj.body, { status: 206, headers: h })
  }
  h.set("content-length", String(obj.size))
  return new Response(obj.body, { headers: h })
}

async function api(req, env, url, writer, viewer) {
  const path = url.pathname
  const m = path.match(/^\/api\/items\/([\w-]+)$/)

  if (path === "/api/items" && req.method === "GET") return json(await readIndex(env))

  if (path === "/api/token" && req.method === "POST") {
    if (!viewer?.includes("@") || req.headers.get("sec-fetch-site") === "cross-site")
      return json({ error: "log in through Access in a browser first" }, 403)
    return json({ token: await mintToken(env, viewer) })
  }

  if (!writer) return json({ error: "upload token required" }, 401)

  if (m && req.method === "PUT") {
    const item = await req.json()
    if (!item.title || !validKey(item.video?.key) || !Array.isArray(item.posts))
      return json({ error: "need title, video.key, posts[]" }, 400)
    item.id = m[1]
    item.updated = new Date().toISOString()
    const idx = await readIndex(env)
    const i = idx.items.findIndex((x) => x.id === item.id)
    if (i >= 0) idx.items[i] = { ...idx.items[i], ...item }
    else idx.items.unshift(item)
    await writeIndex(env, idx)
    return json(item)
  }
  if (m && req.method === "PATCH") {
    const idx = await readIndex(env)
    const item = idx.items.find((x) => x.id === m[1])
    if (!item) return json({ error: "no such item" }, 404)
    const { title, posts } = await req.json()
    if (title) item.title = title
    if (Array.isArray(posts)) item.posts = posts
    item.updated = new Date().toISOString()
    await writeIndex(env, idx)
    return json(item)
  }
  if (m && req.method === "DELETE") {
    const idx = await readIndex(env)
    idx.items = idx.items.filter((x) => x.id !== m[1])
    await writeIndex(env, idx)
    const objs = await env.BUCKET.list({ prefix: `${m[1]}/` })
    if (objs.objects.length) await env.BUCKET.delete(objs.objects.map((o) => o.key))
    return json({ ok: true })
  }

  // Multipart upload through the Worker (request bodies cap at 100MB, videos go to 512MB).
  const key = url.searchParams.get("key")
  if (path.startsWith("/api/upload") && !validKey(key)) return json({ error: "bad key" }, 400)
  if (path === "/api/upload" && req.method === "POST") {
    const up = await env.BUCKET.createMultipartUpload(key, {
      httpMetadata: { contentType: url.searchParams.get("type") || "application/octet-stream" },
    })
    return json({ uploadId: up.uploadId })
  }
  const up = env.BUCKET.resumeMultipartUpload(key, url.searchParams.get("uploadId") || "")
  if (path === "/api/upload" && req.method === "PUT") {
    return json(await up.uploadPart(Number(url.searchParams.get("part")), req.body))
  }
  if (path === "/api/upload/complete" && req.method === "POST") {
    const { parts } = await req.json()
    const obj = await up.complete(parts)
    return json({ key: obj.key, size: obj.size })
  }
  return json({ error: "not found" }, 404)
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const isApi = url.pathname.startsWith("/api/")
    const writer = isApi ? await tokenUser(req, env) : null
    const viewer = writer ? null : await accessUser(req, env)
    if (!writer && !viewer) return new Response("需要通过 Cloudflare Access 登录。", { status: 403 })
    if (isApi) return api(req, env, url, writer, viewer)
    if (url.pathname.startsWith("/v/")) {
      const key = decodeURIComponent(url.pathname.slice(3))
      return validKey(key) ? serveObject(req, env, key, url) : new Response("bad key", { status: 400 })
    }
    return env.ASSETS.fetch(req)
  },
}
