# promo-kit

团队的 X 宣发素材库：https://kit.sma1lboy.me。每条素材是一个视频加上调好的文案，团队成员用自己的 X 账号发。站点不接 X API，不存任何人的 X 登录。

## 团队成员怎么用

1. 用白名单里的邮箱打开 https://kit.sma1lboy.me，Cloudflare Access 会往邮箱发验证码。
2. 选一条素材。需要的话先在页面上改文案，改动只留在你这一页。
3. 点「发到 X」。手机上会弹出分享面板，选 X，文案同时复制到剪贴板，发帖框里没带上文字就粘贴。电脑上会下载视频、打开填好文字的 X 发帖页，把视频拖进去。串推的后几条用「复制第 N 条」，在第一条下面逐条回复。

## 上传方怎么推素材

`~/.env` 里需要 `PROMO_KIT_TOKEN`。开了 Access 之后还需要 `CF_ACCESS_CLIENT_ID` 和 `CF_ACCESS_CLIENT_SECRET`（Access 服务令牌）。

```sh
cd packages/promo-kit
bun run kit push video.mp4 --title "标题" --copy copy.md [--cover cover.jpg] [--id slug]
bun run kit copy <id> --copy copy.md [--title "新标题"]   # 只改文案或标题
bun run kit rm <id>                                      # 下架，同时删掉 R2 里的视频
bun run kit ls
```

`copy.md` 里每条推文是一段，段与段之间用单独一行 `---` 隔开。CLI 会按 X 的规则打印每条的字数（中文算 2，链接算 23，上限 280）。视频超过 2:20、大于 512 MB 或者不是 H.264 时，CLI 和网页都会提示。`id` 默认取视频文件名，同一个 id 再 push 一次会覆盖原来那条。

## 部署

```sh
bunx wrangler deploy                    # 走 wrangler OAuth 登录；环境里的 CLOUDFLARE_API_TOKEN 没有 R2 权限，部署前先 unset
bunx wrangler secret put UPLOAD_TOKEN   # 值和 ~/.env 里的 PROMO_KIT_TOKEN 相同
```

Worker 会校验 Cloudflare Access 发的 JWT。`wrangler.toml` 里的 `ACCESS_TEAM`（团队域名的前缀）和 `ACCESS_AUD`（Access 应用的 AUD tag）为空时，所有浏览器请求都返回 403。只有带上传令牌的 `/api/*` 请求能通过。

本地开发：在 `.dev.vars` 里写 `DEV_NO_ACCESS=1` 和 `UPLOAD_TOKEN=devtoken`，跑 `bun run dev`，再用 `KIT_URL=http://localhost:8787 PROMO_KIT_TOKEN=devtoken bun run kit push ...` 推一条测试素材。
