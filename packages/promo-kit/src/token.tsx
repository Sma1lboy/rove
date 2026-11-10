import { useEffect, useState } from "react"
import { copy, primaryBtn, toast } from "./lib.ts"

const setupPrompt = (token: string) => `帮我配置 promo-kit（Rove 宣发包 ${location.origin}）的上传令牌：

1. 把下面这一行写进 ~/.env。已经有 PROMO_KIT_TOKEN 的话只替换那一行，没有就追加到文件末尾。别的行不要动，不要把令牌打印出来，也不要提交进任何仓库。
PROMO_KIT_TOKEN=${token}

2. 验证：用 ~/.env 里的值跑
curl -s -o /dev/null -w '%{http_code}\\n' -H "Authorization: Bearer $PROMO_KIT_TOKEN" ${location.origin}/api/items
返回 200 就配好了。

3. 以后推素材，在 rove 仓库的 packages/promo-kit 目录里跑：
bun run kit push 视频.mp4 --title "标题" --copy copy.md
copy.md 里一条推文一段，段之间用单独一行 --- 隔开。改文案：bun run kit copy <id> --copy copy.md；下架：bun run kit rm <id>；列表：bun run kit ls。`

export function TokenPage() {
  const [prompt, setPrompt] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    document.title = "上传令牌 · Rove 宣发包"
  }, [])

  const mint = async () => {
    setBusy(true)
    try {
      const r = await fetch("/api/token", { method: "POST" })
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
      setPrompt(setupPrompt((await r.json()).token))
    } catch (e) {
      toast(`生成失败：${(e as Error).message}`, 6000)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <a href="#/" className="text-meta text-muted hover:underline">
        ← 全部素材
      </a>
      <h1 className="mt-3 text-display font-semibold">上传令牌</h1>
      <p className="mt-1 text-meta text-muted">把生成的 prompt 交给你的 agent，它会把令牌写进 ~/.env。令牌只显示一次，重新生成后旧的作废。</p>
      <button type="button" className={`${primaryBtn} mt-4`} disabled={busy} onClick={mint}>
        {prompt ? "重新生成" : "生成我的令牌"}
      </button>
      {prompt && (
        <div className="mt-5 rounded-md border border-line bg-surface">
          <textarea
            readOnly
            value={prompt}
            aria-label="配置 prompt"
            className="block h-72 w-full resize-none rounded-t-md bg-transparent p-4 font-mono text-meta leading-relaxed text-ink outline-none"
          />
          <div className="border-t border-line px-4 py-3">
            <button
              type="button"
              className={primaryBtn}
              onClick={async () => toast((await copy(prompt)) ? "已复制，粘贴给你的 agent" : "复制失败，手动全选复制")}
            >
              复制 prompt
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
