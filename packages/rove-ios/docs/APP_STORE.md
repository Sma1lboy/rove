# App Store listing and release copy

Everything App Store Connect, External TestFlight, and the 1.0 launch need for **Rove Mobile** (`run.rove.mobile`). Copy-paste the plain-text blocks as-is (no Markdown is rendered in App Store Connect fields). Check every `TODO(owner):` before submitting.

For App Review instructions and reviewer walkthrough, see [`REVIEW_NOTES.md`](./REVIEW_NOTES.md).

---

## 1. App Store listing fields

### App name (limit: 30)

- **English (11 / 30):**
  ```text
  Rove Mobile
  ```
- **Simplified Chinese (11 / 30):**
  ```text
  Rove Mobile
  ```

Home-screen display name (`CFBundleDisplayName` in `Info.plist`) is `Rove`.

`TODO(owner):` Confirm "Rove Mobile" (or "Rove", if preferred) is available as a global App Store name in App Store Connect before locking the listing.

### Subtitle (limit: 30)

- **English (28 / 30):**
  ```text
  Your coding agents on iPhone
  ```
- **Simplified Chinese (12 / 30):**
  ```text
  用手机看电脑上的编程助手
  ```

### Promotional text (limit: 170)

- **English (164 / 170):**
  ```text
  Away from your desk while coding agents run? Open your computer's Rove sessions on iPhone to read code changes, answer questions, or start a new task—no VPN needed.
  ```
- **Simplified Chinese (75 / 170):**
  ```text
  离开电脑时编程助手还在干活？在 iPhone 上直接查看进度、逐行看代码改动、回复提问或新建任务。扫个二维码就能连，不用配 VPN，也内置免电脑演示。
  ```

### Description (limit: 4000)

- **English (2435 / 4000):**
  ```text
  You started a few coding tasks on your computer and stepped away from your desk. An agent finishes a fix, or stops to ask before running a command. With Rove Mobile, you open that session on your iPhone, read what changed line by line, answer the question, or start another task—without walking back to your computer.

  Rove is a free, open-source tool you run on your own computer (macOS, Linux, or Windows) to run many AI coding agents—such as Claude Code and Codex—at the same time. Rove Mobile is its iPhone companion. It pairs with your computer and opens your Rove workspace full screen.

  PAIR IN SECONDS, USE AWAY FROM HOME
  Run rove --web on your computer, open Settings → Connectors → Phone, and scan the QR code with this app—or paste the pairing link. You can connect over your local Wi-Fi, Tailscale, your own tunnel, or Rove's optional hosted relay. The relay is end-to-end encrypted so your code and messages stay between your phone and your computer, with no VPN to install.

  WHAT YOU CAN DO FROM YOUR PHONE
  - See every running session across your projects in one list, including which agents finished or are waiting for your reply.
  - Open a session's terminal output, read what the agent did, and type or answer permission prompts.
  - Review code changes file by file and line by line.
  - Start a new coding task on a project right from your phone.
  - Hold to talk when you would rather speak a reply than type on a small screen. The microphone records only while you hold the button and sends audio to your computer to turn into text (requires an HTTPS, relay, or tunnel connection).

  ON IPHONE
  - Save links for several computers in your iOS Keychain. Hold two fingers anywhere on the screen to switch computers, pair another, or forget one.
  - Haptic feedback on buttons, swipes, and hold-to-talk.
  - Clear offline screen with one-tap retry and your computer list when a computer is asleep or unreachable.
  - Built-in demo: tap "try a demo" on the first screen to explore sample coding sessions, diffs, and the inbox without setting up a computer first.

  PRIVACY
  - No account, no sign-up, no analytics, and no ads.
  - Your sessions and code stay on your own computer. Pairing links stay in your iPhone's Keychain.

  REQUIREMENTS
  To connect to real sessions, install the free, open-source Rove app on your computer (rove.run) and run rove --web. Want to look around first? Launch the app and tap "try a demo"—no computer needed.
  ```

- **Simplified Chinese (954 / 4000):**
  ```text
  你在电脑上同时跑了几个编程任务，临时离开了工位。某个助手改完了代码，或者停下来等你确认一条命令。打开 Rove Mobile，就能在 iPhone 上直接看到它刚做了什么、逐行查看代码改动、回复它的提问，或者顺手再开一个新任务，不用跑回电脑前。

  Rove 是一款运行在你自己电脑上（macOS、Linux、Windows）的免费开源工具，可以同时运行 Claude Code、Codex 等多个 AI 编程助手。Rove Mobile 是它的 iPhone 客户端，与你的电脑配对后全屏打开你电脑上的 Rove 工作区。

  扫码即连，出门也能用
  在电脑上运行 rove --web，打开「设置 → 连接器 → 手机」显示二维码，用这个 App 扫一下（或直接粘贴链接）就能连上。你可以在局域网、Tailscale、自建隧道下使用，也可以直接走 Rove 提供的可选托管中继——全程端到端加密，代码和对话只在你的手机和电脑之间传输，不用装 VPN，也不用折腾端口转发。

  在手机上能做什么
  - 在一个列表里查看各个项目正在跑的会话，一眼看出哪个助手已完成、哪个正在等你回复。
  - 打开会话终端，查看助手的输出记录，直接打字或回复权限确认。
  - 按文件逐行查看代码改动。
  - 直接从手机上给指定项目新建编程任务。
  - 不方便打字时，按住说话按钮把想法说出来。麦克风只在按住时录音，音频发到你的电脑转成文字（需通过 HTTPS、中继或隧道连接）。

  iPhone 上的细节
  - 可在 iOS 钥匙串里保存多台电脑的配对链接；在页面上双指长按，随时切换电脑、配对新电脑或移除旧电脑。
  - 按钮、滑动操作和按住说话都带有触感反馈。
  - 电脑休眠或连不上时，提供清晰的离线界面，支持一键重试或切换到其他电脑。
  - 内置免电脑演示：首次打开点「先看看」，不用先装电脑端就能浏览示例任务、代码改动和收件箱。

  隐私
  - 无需账号、无需登录、没有统计追踪、没有广告。
  - 代码和会话留在你自己的电脑上，配对链接只保存在你 iPhone 的钥匙串里。

  使用条件
  连接真实任务前，需要在自己的电脑上安装免费开源的 Rove（rove.run）并运行 rove --web。想先看看效果？打开 App 点「先看看」即可直接体验。
  ```

### Keywords (limit: 100)

Comma-separated, no spaces, no words repeated from Name or Subtitle, and no third-party trademarks (Guideline 2.3.7).

- **English (96 / 100):**
  ```text
  terminal,developer,git,diff,remote,cli,code,review,ai,programming,pair,voice,dictation,tasks,dev
  ```
- **Simplified Chinese (63 / 100):**
  ```text
  代码,终端,开发者,远程,工具,语音,输入,审查,任务,配对,开源,效率,命令行,差异,AI,程序员,项目,研发,二维码,中继
  ```

### What's New for 1.0 (limit: 4000)

Note: App Store Connect hides the "What's New in This Version" field on an initial 1.0 submission and starts showing it from the next update (1.0.1 / 1.1). Keep this text ready for release notes or the first update.

- **English (640 / 4000):**
  ```text
  First release of Rove Mobile.

  - Pair with your computer by scanning the QR code in rove --web's Settings → Connectors → Phone (or printed by rove --web --preset relay), or by pasting the link.
  - Connect away from home through Rove's optional end-to-end encrypted relay with no VPN or tunnel setup, or use your local network, Tailscale, or your own tunnel.
  - Keep links for several computers in your iOS Keychain and hold two fingers on the screen to switch or forget one.
  - Dictate replies with hold-to-talk (the microphone turns on only while held).
  - Tap "try a demo" on first launch to explore sample sessions with no computer required.
  ```

- **Simplified Chinese (282 / 4000):**
  ```text
  Rove Mobile 首个正式版本。

  - 在电脑上运行 rove --web，在页面「设置 → 连接器 → 手机」中查看二维码（或用 rove --web --preset relay 在终端生成），用手机扫码或粘贴链接即可配对。
  - 支持通过 Rove 可选的端到端加密中继远程连接，出门在外无需配置 VPN 或隧道；也支持局域网、Tailscale 或自建隧道。
  - 多台电脑的配对链接保存在 iOS 钥匙串里，双指长按屏幕即可切换或移除电脑。
  - 支持按住说话语音输入回复（仅在按住时录音）。
  - 首次打开可直接点「先看看」体验内置演示，无需先连接电脑。
  ```

---

## 2. App information, categories, and URLs

| Field | English | Simplified Chinese |
| --- | --- | --- |
| Primary Category | Developer Tools | 开发者工具 |
| Secondary Category | Productivity | 效率 |
| Support URL | `https://github.com/Sma1lboy/rove/issues` | `https://github.com/Sma1lboy/rove/issues` |
| Marketing URL | `https://rove.run` | `https://rove.run` |
| Privacy Policy URL | `https://rove.run/privacy` | `https://rove.run/privacy` |
| Copyright | `© 2026 Jackson Chen` | `© 2026 Jackson Chen` |

- `TODO(owner):` Confirm the Copyright line matches the legal individual or organization name on your Apple Developer Program account (`LICENSE` says `Jackson Chen`; `privacy.html` footer says `Sma1lboy`).
- `TODO(owner):` Confirm whether you prefer `https://github.com/Sma1lboy/rove/issues` (linked under "Questions" on `privacy.html`) or `https://docs.rove.run` as the Support URL.

---

## 3. App Privacy ("Nutrition Label")

**Expected App Store Connect result:** **Data Not Collected** (`不收集数据`).

Matches `Sources/RoveMobile/PrivacyInfo.xcprivacy` (`NSPrivacyTracking: false`, `NSPrivacyCollectedDataTypes: []`, `NSPrivacyAccessedAPICategoryUserDefaults` reason `CA92.1`).

| App Store Connect question | Answer (EN / ZH) | Justification from source |
| --- | --- | --- |
| Do you or your third-party partners collect data from this app? | **No, we do not collect data from this app** / **否，我们不从此 App 收集数据** | No user accounts, no login, no analytics SDK, no crash reporting SDK, no advertising SDK, and no tracking. The only third-party Swift dependency is SwiftTerm (`project.yml:18-20`), a local terminal view. |
| Audio Data (Microphone — hold-to-talk) | **Not Collected** / **不收集** | `NSMicrophoneUsageDescription` + `WebShellView.swift:100-107`: microphone capture only runs while the user holds the talk button, never in the background. Audio goes directly to the user's own computer (`rove --web`), which transcribes it locally or via an endpoint the user configured on their computer. Rove's developer never receives, accesses, or stores audio. |
| Photos or Videos (Camera — QR scanner) | **Not Collected** / **不收集** | `NSCameraUsageDescription` + `QRScannerView.swift`: camera frames are decoded on-device solely to read the pairing QR code. Nothing is recorded, saved, or transmitted. Pasting the link works without camera access. |
| User Content / Identifiers / Browsing History (Pairing links & web storage) | **Not Collected** / **不收集** | `ShellRoot.swift:5-43` stores pairing URLs (including tokens) exclusively on-device in the iOS Keychain (`KeychainStore`), deletable via **forget**. `WKWebView` keeps page preferences/storage locally in `WKWebsiteDataStore.default()`. |
| Network traffic via optional hosted relay (`relay.sma1lboy.me`) | **Not Collected** / **不收集** | Verified in `packages/rove-relay/src/index.ts` and `packages/rove-relay/wrangler.toml`: traffic is end-to-end encrypted (`relay-e2e/v1`) before leaving the phone, so the relay sees only ciphertext and never receives the `#code=` or `#token=` URL fragment. `[observability]` / Workers logs are not enabled in `wrangler.toml`. The per-IP connect rate limit (`CONNECTS` binding: 60/min on `CF-Connecting-IP`) is ephemeral in Cloudflare's rate-limit runtime and never written to storage or logs by the Worker. Durable Object storage holds only: (1) up to 64 KiB / 256 frames of buffered handshake ciphertext (`early:<pid>`) for at most 60 seconds while waiting for the computer, deleted immediately when the tunnel opens (`src/index.ts:325-332`); and (2) a per-UTC-day byte counter (`bytes:<YYYY-MM-DD>`) keyed by `SHA-256(routingToken)` solely to enforce the 2 GiB/day abuse cap (`src/index.ts:373-398`), unlinked to any user, account, or device. Under Apple's App Privacy definitions, ephemeral in-transit routing and unlinked abuse-prevention counters are not "collected" data. |
| Built-in demo (`try a demo`) | **Not Collected** / **不收集** | `DemoWeb.swift` + `packages/rove-web/src/demo/transport.ts`: served entirely from the app bundle (`rove-demo://app/`), makes zero network requests, and persists nothing across launches. |
| Third-party AI providers on the user's computer | **Not Collected by this app** / **本 App 不收集** | Coding agents (Claude Code, Codex, etc.) run on the user's own computer under the user's own accounts and provider policies; the iPhone app never talks to AI provider APIs directly. |

`TODO(owner):` Confirm in the Cloudflare dashboard for `relay.sma1lboy.me` that Workers Logs / Trace Events / Analytics Engine retention is off (matching `wrangler.toml`); rove.run/privacy says the relay writes no logs.

---

## 4. Age rating (2026 questionnaire)

The app is a developer tool showing the user's own coding sessions with no bundled editorial or social content.

| Question | English | Simplified Chinese |
| --- | --- | --- |
| Cartoon or fantasy violence | None | 无 |
| Realistic violence | None | 无 |
| Prolonged graphic or sadistic realistic violence | None | 无 |
| Profanity or crude humor | None | 无 |
| Mature or suggestive themes | None | 无 |
| Horror or fear themes | None | 无 |
| Medical or treatment information | None | 无 |
| Alcohol, tobacco or drug use or references | None | 无 |
| Simulated gambling | None | 无 |
| Sexual content or nudity | None | 无 |
| Graphic sexual content and nudity | None | 无 |
| Guns or other weapons | None | 无 |
| Contests | None | 无 |
| Unrestricted web access | `TODO(owner):` See note below (currently **No** in `REVIEW_NOTES.md`, which yields **4+**; **Yes** if arbitrary external iframes stay enabled on iPhone) | `TODO(owner):` 见下方说明（`REVIEW_NOTES.md` 目前填**否**，对应 **4+**；若 iPhone 端保留加载任意外部网页的 iframe，可能需要填**是**） |
| User-generated content | No — shows only the user's own sessions; nothing is shared with other users | 否 — 仅显示用户自己的会话，不与其他用户共享内容 |
| Messaging and chat | No — messages go to the user's own coding agents, not to other people | 否 — 消息只发给用户自己的编程助手，不与其他人聊天 |
| Advertising | No | 否 |
| Gambling | No | 否 |
| Loot boxes | No | 否 |
| Shared location | No | 否 |
| Dating and relationships | No | 否 |
| Health or wellness topics | No | 否 |
| Parental controls | No | 否 |
| Age assurance | No | 否 |
| Made for Kids | No | 否 |
| Age rating override | None — keep computed rating | 无 — 使用系统计算结果 |

**Result:** **4+** if Unrestricted web access is **No**; **17+** (or Apple's 2026 unrestricted-web tier) if **Yes**.

`TODO(owner):` **Verify Unrestricted web access before submitting.** `WebShellView.swift:82-88` sends main-frame navigations to other origins to Safari, **but** explicitly allows subframes (`!mainFrame`) so `rove-web`'s Browser preview panel (`browser-view.tsx:235`, reachable on iPhone via the top-right view switcher → **Browser**, `rail-chrome.tsx:165-198`, `workspace-view.tsx:123`) can load arbitrary frameable `https` sites in an `<iframe>`. Decide before submission whether to (a) disable arbitrary external `https` URLs in the iPhone Browser panel (keeping **No** / **4+** cleanly accurate), or (b) answer **Yes** to Unrestricted web access (and reconcile `REVIEW_NOTES.md:89` accordingly).

---

## 5. Export compliance

- **`Info.plist` / `project.yml` setting:** `ITSAppUsesNonExemptEncryption = false` (`Sources/RoveMobile/Info.plist:36-37`, `project.yml:69`).
- **App Store Connect answer (EN):** Uses **only standard encryption algorithms built into Apple's operating system** (exempt — `ITSAppUsesNonExemptEncryption = false` remains accurate).
- **App Store Connect answer (ZH):** **仅使用 Apple 操作系统内置的标准加密算法**（符合豁免条件，`ITSAppUsesNonExemptEncryption = false` 仍然正确）。

**Why `false` is still right with the hosted encrypted relay:**

1. **No encryption code in the native iOS binary:** Grep of `packages/rove-ios/Sources/` confirms zero imports of `CryptoKit`, `CommonCrypto`, or third-party cryptography. The native app uses only iOS Keychain (`Security`) and `WKWebView` / system TLS.
2. **No relay code in the bundled demo:** `packages/rove-ios/scripts/build-demo-web.sh` builds `packages/rove-web/src/demo/main.ts` → `src/main.tsx` with `demoTransport`. Neither `relay-shell.ts` nor `@hsinsekai-nanami/client` is imported or bundled in `DemoWeb/`.
3. **Relay end-to-end encryption runs solely on WebKit's OS-backed WebCrypto:** When paired through `relay.sma1lboy.me`, `WKWebView` loads the remote loader page (`packages/rove-web/src/relay-shell.ts` / `@hsinsekai-nanami/core/dist/crypto.js`), whose `relay-e2e/v1` protocol calls exclusively `globalThis.crypto.subtle` (ECDH P-256, HKDF-SHA-256, AES-GCM, SHA-256) and `crypto.getRandomValues` over system HTTPS/WSS TLS — no custom or bundled JavaScript cryptographic algorithms. All components (`rove-ios`, `rove-web`, `rove-relay`, `relay-kit`) are also publicly available MIT open-source software.

`TODO(owner):` At submission time in App Store Connect, confirm Apple's exact wording for the OS-only standard encryption option ("Standard encryption algorithms within Apple's operating system") and check whether distribution in France requires an extra declaration in App Store Connect if Apple prompts for it.

---

## 6. Screenshot captions (5 shots, iPhone 6.9")

Capture note: in built-in demo mode (`try a demo` / `先看看`), the top bar renders `demo · not connected to a computer` (`演示 · 未连接电脑`). Either frame/crop around that strip in your screenshot templates, or capture the same fixture against a live local `rove --web` run so the strip is absent. Capture EN with locale `en` and ZH-Hans with locale `zh`.

### Shot 1 — Session list
- **Demo screen to capture:** Tap **try a demo** (`先看看`) on the pairing screen; capture the initial session list showing `payments-api` (`Verify refund webhook signatures` waiting on you, `Retry failed charges` PR #231 passing, `Document idempotency keys` PR #229, `Add pagination to invoices` running) and `marketing-site` (`Fix layout shift on the pricing page`), plus the bottom bar (Settings/Inbox capsule + **New task**).
- **What it shows:** All active coding sessions across multiple projects and engines in one scrollable list, with live status and line-change counts.
- **Caption (EN — 49 chars):**
  ```text
  See every coding session running on your computer
  ```
- **Caption (ZH — 17 chars):**
  ```text
  电脑上所有在跑的编程会话，一屏看完
  ```

### Shot 2 — Agent conversation and reply / hold-to-talk
- **Demo screen to capture:** Tap **Verify refund webhook signatures** (`T-WAIT`). Capture the terminal conversation showing the Codex edits (`src/refunds/signature.ts`, `src/refunds/webhook.ts`), the passing `bun test` run, the command approval prompt (`git push origin fix/refund-webhook-sig`), and the bottom message / **Hold to talk** (`按住说话`) bar.
- **What it shows:** Reading what the agent just did and answering a permission prompt or dictating a follow-up right from iPhone.
- **Caption (EN — 46 chars):**
  ```text
  Read what an agent did and reply from anywhere
  ```
- **Caption (ZH — 19 chars):**
  ```text
  随时看助手干了什么，直接回复或语音口述
  ```

### Shot 3 — Line-by-line code diff
- **Demo screen to capture:** Inside **Verify refund webhook signatures**, tap the top-right view switcher button (`NarrowBackBar`) → **Diff** (`差异`), then open `src/refunds/webhook.ts` (or `src/refunds/signature.ts`).
- **What it shows:** File-by-file, line-by-line additions and removals written by the coding agent.
- **Caption (EN — 36 chars):**
  ```text
  Check every code change line by line
  ```
- **Caption (ZH — 11 chars):**
  ```text
  按文件逐行查看代码改动
  ```

### Shot 4 — Inbox (agents waiting on you)
- **Demo screen to capture:** Return to the session list and tap the **Inbox** tray button in the bottom-left capsule (`收件箱`) to open the Inbox sheet, showing `Verify refund webhook signatures` (needs permission), `Document idempotency keys` (finished turn), and `flaky test hunter` (failed routine).
- **What it shows:** Every session that stopped for your reply or finished a turn gathered in one sheet.
- **Caption (EN — 41 chars):**
  ```text
  Catch every agent waiting for your answer
  ```
- **Caption (ZH — 18 chars):**
  ```text
  哪些助手在等你确认，收件箱里一目了然
  ```

### Shot 5 — Start a new task
- **Demo screen to capture:** Return to the session list and tap **New task** (`新建任务`) in the bottom bar to open the new-task composer showing the project picker, agent selector, and prompt box.
- **What it shows:** Kicking off a fresh coding task on your computer without walking back to your desk.
- **Caption (EN — 55 chars):**
  ```text
  Start a new coding task without going back to your desk
  ```
- **Caption (ZH — 17 chars):**
  ```text
  不用回电脑前，在手机上直接新建任务
  ```

---

## 7. External TestFlight copy

### Beta App Description (limit: 4000)

- **English (344 / 4000):**
  ```text
  Rove Mobile lets you check on the AI coding agents running on your computer from your iPhone. Scan a QR code from rove --web (no VPN needed with the optional end-to-end encrypted relay) to read code changes, answer agent questions, dictate replies with hold-to-talk, or start a new task. No computer handy? Tap "try a demo" on the first screen.
  ```
- **Simplified Chinese (148 / 4000):**
  ```text
  Rove Mobile 让你在 iPhone 上随时查看电脑里正在运行的 AI 编程助手。运行 rove --web 后扫码即可配对（通过可选的端到端加密中继，无需配 VPN），在手机上逐行看代码改动、回复助手提问、按住说话语音输入，或新建任务。手边没电脑？首次打开点「先看看」即可体验内置演示。
  ```

### What to Test (limit: 4000)

- **English (743 / 4000):**
  ```text
  1. Demo without a computer: launch the app and tap "try a demo". Open "Verify refund webhook signatures", tap the top-right view button to switch to Diff, go back to the list and open Inbox at the bottom left, then tap New task.
  2. Pairing with your computer: run rove --web, open Settings → Connectors → Phone → Show QR code, and scan it (or paste the link). Check that switching apps and relaunching stays paired.
  3. Multiple computers and offline screen: hold two fingers on the page to open the computers list, test switching or forgetting, and stop rove --web to verify the offline retry screen.
  4. Hold-to-talk and haptics: over an HTTPS or relay link, hold the talk button in a session and confirm recording stops as soon as you let go.
  ```
- **Simplified Chinese (300 / 4000):**
  ```text
  1. 免电脑演示：打开 App 点「先看看」，进入「Verify refund webhook signatures」，点右上角视图按钮切到差异（Diff），再回到列表打开左下角收件箱和底部新建任务。
  2. 配对真实电脑：在电脑运行 rove --web，打开「设置 → 连接器 → 手机 → 显示二维码」扫码（或粘贴链接），确认切换 App 和重启后保持连接。
  3. 多台电脑与离线页面：在页面上双指长按打开电脑列表，测试切换和移除电脑；停掉 rove --web 确认离线重试页面正常显示。
  4. 按住说话与触感反馈：在 HTTPS 或中继连接下按住说话按钮，确认松手后立刻停止录音并正常转文字。
  ```

---

## 8. Launch posts and 1.0 changeset

### X post (limit: 280)

- **English (260 / 280 chars; 267 / 280 X-weighted):**
  ```text
  Stepped away from your desk while coding agents are still running? Rove Mobile is on the App Store. Scan a QR code from your computer—no VPN needed—to read code changes, answer agent prompts, or start a new task from iPhone. Free, open source: https://rove.run
  ```
- **Simplified Chinese (131 / 280 chars; 219 / 280 X-weighted):**
  ```text
  离开电脑时，编程助手还在继续干活？Rove Mobile 现已上架 App Store。扫个二维码连上你自己的电脑，不用配 VPN，就能在 iPhone 上看进度、逐行看代码改动、回复提问或新建任务。免费开源，支持先试用内置演示：https://rove.run
  ```

### README / rove.run blurb (3–4 sentences)

- **English (597 chars):**
  ```text
  When you step away from your desk while coding agents are still running, Rove Mobile lets you follow along from your iPhone. Run `rove --web` on your computer and scan the QR code in Settings → Connectors → Phone to connect through an optional end-to-end encrypted relay with no VPN setup, or pair over your local network or Tailscale. From your phone, you can read code changes line by line, answer agent prompts by typing or hold-to-talk, and start new tasks across your projects. It requires no account, collects no analytics, and includes a built-in demo you can try before pairing a computer.
  ```
- **Simplified Chinese (212 chars):**
  ```text
  离开工位时，电脑上的编程助手还在继续干活，你可以用 Rove Mobile 在 iPhone 上随时跟进。在电脑运行 `rove --web`，打开「设置 → 连接器 → 手机」扫描二维码，即可通过可选的端到端加密中继连接，无需配置 VPN，也支持局域网或 Tailscale。在手机上可以逐行查看代码改动、打字或按住说话回复助手提问，也能直接新建任务。App 无需账号、没有统计追踪，还内置了免电脑演示，没配对也能先体验。
  ```

### 1.0 release `[ios]` changeset body (one line)

Use the English line in `.changeset/*.md` when cutting the 1.0 release.

- **English (260 chars):**
  ```text
  [ios] Rove Mobile 1.0 launches on the App Store: pair your iPhone with `rove --web` over QR or link (including the optional end-to-end encrypted relay), switch computers from Keychain, dictate with hold-to-talk, or explore the built-in demo without a computer.
  ```
- **Simplified Chinese (115 chars):**
  ```text
  [ios] Rove Mobile 1.0 上架 App Store：支持通过二维码或链接与 `rove --web` 配对（含可选端到端加密中继）、在钥匙串中保存并切换多台电脑、按住说话语音输入，以及无需电脑即可体验的内置演示。
  ```
