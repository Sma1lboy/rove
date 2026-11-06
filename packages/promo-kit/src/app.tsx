import { useEffect, useState, useSyncExternalStore } from "react"
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
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/items")
      .then(async (r) => (r.ok ? setItems((await r.json()).items) : setError(`${r.status} ${await r.text()}`)))
      .catch((e) => setError(String(e)))
  }, [])
  useEffect(() => scrollTo(0, 0), [route])

  const item = items?.find((x) => x.id === route)
  let body: React.ReactNode
  if (route === "token") body = <TokenPage />
  else if (error) body = <p className="text-meta text-error">加载失败：{error}。刷新重试，还不行就重新登录。</p>
  else if (!items) body = null
  else if (route && !item)
    body = (
      <p className="text-meta text-muted">
        这条素材已下架。<a className="text-accent hover:underline" href="#/">看其他素材</a>
      </p>
    )
  else if (item) body = <Detail key={item.id} item={item} />
  else body = <List items={items} />

  return (
    <>
      <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-line bg-paper px-5">
        <a href="#/" className="font-mono text-title font-bold tracking-[.02em] whitespace-nowrap">
          <span className="text-accent">[</span> rove <span className="text-accent">]</span>
        </a>
        <span className="text-meta text-subtle">宣发包</span>
        <a href="#/token" className="ml-auto text-meta text-accent hover:underline">
          上传令牌
        </a>
      </header>
      <main className="mx-auto max-w-5xl px-5 pt-6 pb-16">{body}</main>
      <Toast />
    </>
  )
}

function List({ items }: { items: Item[] }) {
  useEffect(() => {
    document.title = "Rove 宣发包"
  }, [])
  return (
    <>
      <h1 className="text-display font-semibold">挑一条，用你自己的 X 发出去</h1>
      <p className="mt-1 text-meta text-muted">视频和文案都调好了。网站不碰你的 X 账号，只把东西交给你的 X。</p>
      {items.length === 0 ? (
        <p className="mt-6 text-meta text-subtle">还没有素材。上传方用 bun run kit push 推第一条。</p>
      ) : (
        <div className="mt-6 grid gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <a key={it.id} href={`#/${it.id}`} className="group block min-w-0">
              <div className="relative aspect-video overflow-hidden rounded-md border border-line bg-inset group-hover:border-line-active">
                {it.cover ? (
                  <img className="size-full object-cover" src={vurl(it.cover)} alt="" loading="lazy" />
                ) : (
                  <video className="size-full object-cover" src={`${vurl(it.video.key)}#t=0.5`} preload="metadata" muted playsInline />
                )}
                <span className="absolute right-2 bottom-2 rounded-xs bg-paper/85 px-1.5 py-0.5 font-mono text-meta text-ink">
                  {fmtDur(it.video.duration)}
                </span>
              </div>
              <div className="mt-2 truncate text-title font-semibold">{it.title}</div>
              <div className="mt-0.5 flex gap-3 font-mono text-meta text-subtle">
                {it.posts.length > 1 && <span>{it.posts.length} 条串推</span>}
                {videoWarnings(it.video).length > 0 && <span className="text-warning">! 视频规格有问题</span>}
              </div>
            </a>
          ))}
        </div>
      )}
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
