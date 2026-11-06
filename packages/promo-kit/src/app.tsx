import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { Detail } from "./detail.tsx"
import { type Item, fmtDur, videoWarnings, vurl } from "./lib.ts"
import { TokenPage } from "./token.tsx"

const subscribe = (cb: () => void) => {
  addEventListener("hashchange", cb)
  return () => removeEventListener("hashchange", cb)
}
const useRoute = () => useSyncExternalStore(subscribe, () => location.hash.replace(/^#\/?/, ""))

export function App() {
  const route = useRoute()
  const [data, setData] = useState<{ me: string; items: Item[] } | null>(null)
  const [error, setError] = useState("")

  const reload = useCallback(
    () =>
      fetch("/api/items")
        .then(async (r) => (r.ok ? setData(await r.json()) : setError(`${r.status} ${await r.text()}`)))
        .catch((e) => setError(String(e))),
    [],
  )
  useEffect(() => {
    reload()
  }, [reload])
  // Braces matter: newer Chrome's scrollTo returns a Promise, which React would call as the cleanup and crash.
  useEffect(() => {
    scrollTo(0, 0)
  }, [route])

  const item = data?.items.find((x) => x.id === route)
  let body: React.ReactNode = null
  if (route === "token") body = <TokenPage />
  else if (error) body = <p className="text-meta text-error">加载失败：{error}。刷新重试，还不行就重新登录。</p>
  else if (!data) body = null
  else if (item) body = <Detail key={item.id} item={item} me={data.me} onChange={reload} />
  else if (route)
    body = (
      <p className="text-meta text-muted">
        这条素材已下架。<a className="text-accent hover:underline" href="#/">看其他素材</a>
      </p>
    )
  else body = <Home items={data.items} />

  // Below md one pane at a time: the sidebar is the home screen, a detail gets a back link.
  const home = route === ""
  return (
    <div className="md:grid md:min-h-dvh md:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
      <Sidebar items={data?.items ?? []} me={data?.me ?? ""} route={route} className={home ? "flex" : "hidden md:flex"} />
      <main className={`min-w-0 px-5 pt-5 pb-16 md:px-8 md:pt-8 ${home ? "hidden md:block" : ""}`}>
        <a href="#/" className="mb-4 inline-block text-meta text-muted hover:underline md:hidden">
          ← 全部素材
        </a>
        <div className="mx-auto max-w-5xl">{body}</div>
      </main>
      <Toast />
    </div>
  )
}

function Sidebar({ items, me, route, className }: { items: Item[]; me: string; route: string; className: string }) {
  return (
    <aside className={`${className} min-h-dvh flex-col border-line bg-paper md:sticky md:top-0 md:h-dvh md:border-r`}>
      <a href="#/" className="flex h-12 flex-none items-center gap-2 px-4 hover:no-underline">
        <span className="font-mono text-title font-bold tracking-[.02em] whitespace-nowrap">
          <span className="text-accent">[</span> rove <span className="text-accent">]</span>
        </span>
        <span className="text-meta text-subtle">宣发包</span>
      </a>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="px-2 pt-2 pb-1 font-mono text-meta font-semibold text-subtle">素材</div>
        {items.map((it) => {
          const mine = it.sends.some((e) => e.by === me)
          const people = new Set(it.sends.map((e) => e.by)).size
          return (
            <a
              key={it.id}
              href={`#/${it.id}`}
              aria-current={route === it.id ? "page" : undefined}
              className="block rounded-sm px-2 py-1.5 hover:bg-hover aria-[current=page]:bg-menu touch:py-2.5"
            >
              <div className="truncate text-title text-ink">{it.title}</div>
              <div className="mt-0.5 flex gap-2 font-mono text-meta text-subtle">
                <span>{fmtDur(it.video.duration)}</span>
                {it.posts.length > 1 && <span>{it.posts.length} 条</span>}
                {mine ? (
                  <span className="text-success">✓ 你已发</span>
                ) : (
                  people > 0 && <span>{people} 人已发</span>
                )}
                {videoWarnings(it.video).length > 0 && <span className="text-warning">!</span>}
              </div>
            </a>
          )
        })}
        {items.length === 0 && <p className="px-2 text-meta text-subtle">还没有素材</p>}
      </nav>
      <div className="flex flex-none items-center gap-3 border-t border-line px-4 py-3 text-meta">
        <span className="min-w-0 flex-1 truncate text-subtle">{me}</span>
        <a href="#/token" className="text-accent hover:underline">
          上传令牌
        </a>
      </div>
    </aside>
  )
}

function Home({ items }: { items: Item[] }) {
  useEffect(() => {
    document.title = "Rove 宣发包"
  }, [])
  return (
    <>
      <h1 className="text-display font-semibold">挑一条，用你自己的 X 发出去</h1>
      <p className="mt-1 text-meta text-muted">视频和文案都调好了。网站不碰你的 X 账号，只把东西交给你的 X。</p>
      <div className="mt-6 grid gap-x-4 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((it) => (
          <a key={it.id} href={`#/${it.id}`} className="group block min-w-0 hover:no-underline">
            <div className="relative aspect-video overflow-hidden rounded-md border border-line bg-inset group-hover:border-line-active">
              {it.cover ? (
                <img className="size-full object-cover" src={vurl(it.cover)} alt="" loading="lazy" />
              ) : (
                <video className="size-full object-cover" src={`${vurl(it.video.key)}#t=0.5`} preload="metadata" muted playsInline />
              )}
            </div>
            <div className="mt-2 truncate text-title font-semibold text-ink">{it.title}</div>
          </a>
        ))}
      </div>
    </>
  )
}

function Toast() {
  const [msg, setMsg] = useState("")
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const on = (e: Event) => {
      const { msg, ms } = (e as CustomEvent).detail
      setMsg(msg)
      clearTimeout(t)
      t = setTimeout(() => setMsg(""), ms)
    }
    addEventListener("kit-toast", on)
    return () => {
      removeEventListener("kit-toast", on)
      clearTimeout(t)
    }
  }, [])
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-[calc(84px+env(safe-area-inset-bottom))] left-1/2 z-40 max-w-[min(92vw,420px)] -translate-x-1/2 rounded-sm border border-line bg-inset px-3 py-1.5 text-meta text-ink transition duration-150 motion-reduce:transition-none lg:bottom-6 ${
        msg ? "opacity-100" : "pointer-events-none translate-y-1 opacity-0"
      }`}
    >
      {msg}
    </div>
  )
}
