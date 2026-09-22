/**
 * GENERATED — do not edit. Run `bun run build:rubric` instead.
 *
 * The judgement the tier classifier applies, assembled from
 * `docs/design/auto-routing/` by `scripts/build-tier-rubric.ts`:
 *
 *   - the three `what` bodies come from `rubric-annotator-v5.md`;
 *   - the `role`, `criterion` and per-tier `边界` come from `jev-head.py`;
 *   - the examples come from `jev-shots.json`.
 *
 * That is the configuration the design's numbers were measured on: 73.0% on
 * a 94-row human-labelled set whose floor (always answer `standard`) is
 * 48.9%, with deep recall 17/20. The two shapes that are easy to drop and
 * cost the most: each option carries its OWN boundary rule rather than one
 * shared paragraph in the instructions (+3.2 points), and the examples ride
 * along in `state` (swift recall 32% → 62%). See
 * `docs/design/auto-routing-classifier-interface.md`.
 *
 * It is DATA rather than a file read at request time, which is the one place
 * this deliberately differs from upstream. Upstream re-reads the handbook per
 * request so that editing it changes behaviour immediately; shipped in a
 * product, that would mean two runs of the same Rove version could judge the
 * same sentence differently. Here the judgement is pinned to a release, and
 * changing it is a diff someone reviews.
 */

import type { TierRubric } from "./tier-rubric-types.ts"

export const DEFAULT_TIER_RUBRIC: TierRubric = {
  role: "你在给一条「用户新建 coding task 时写的第一句话」打深度档。",
  criterion:
    "只有一个判据：用户的指令里，有多少流程需要模型自己推理出来。不看工作量，不看难度，不看文本长短，不看语言。三档没有目标比例。",
  criteria: {
    swift: {
      what: "- 说了怎么做：step-by-step、指到了文件/配置/选项、给了参考实现（「参考 vuetify 同名 prop」「像 fzf 那样」）。\n- 用户已经定位过了：「profile 了一下发现是 X，缓存一下吧」——原因找到了，剩下照做。\n- 一个**具体到复现就能修的行为**：「Tooltip 在 iframe 里定位错」「深色模式代码块背景和正文一个色」「hero 动画 safari 卡 chrome 不卡」——现象一句话说死、没有条件、没有猜测，打开就能看见。\n- 加一个 flag / prop / 开关，并说了它做什么。文档/文案/链接修正。",
      边界: "和 standard 的分界：用户有没有告诉模型改哪、怎么改，或者现象是不是具体到打开就能看见？有 → swift。**直接提问也算 swift**：问「你是什么模型」「这个文件在哪」「X 是什么意思」，或者打个招呼、道个谢——这些话本身已经完整，答它不需要先想清楚做成什么样，没有任何流程要模型去推。没有要做的事 ≠ 目标要模型自己找。",
    },
    standard: {
      what: "- 说清楚了要做成什么样但没说怎么做：feature 请求、「能不能做成可配置」「改成实时更新」「加个 xlsx 导出」。\n- **症状 + 用户自己猜了一个原因**：「paste 丢字符，是不是 truncate 了」「重复回复，是不是没加去重」「已读不更新，怀疑是订阅丢了」——猜的原因就是目标，模型去验证它。\n- 给了一个链接/外部参考说「照这个做」「能不能接进来」。",
      边界: "和 swift 的分界：用户没说改哪、怎么改 → 不是 swift。和 deep 的分界：用户说了要做成什么（哪怕只是猜了个原因）→ standard。",
    },
    deep: {
      what: "- 开放式：「有什么可以优化」「什么方向值得做」「调查一下瓶颈在哪」「换架构有必要吗」。\n- 只问可不可以、没说要做：「有没有办法让 X 按 Y 不一样」「any ideas on how to…」「could we support…」——先要判断方案。\n- **症状带条件、不稳定复现、没有任何猜测**：「有时候会跑到屏幕外，多屏情况下」「感觉卡一下」「results feel stale」「超过 200 行就空白」——先要找到触发条件才有目标。",
      边界: "和 standard 的分界：用户有没有说要做成什么？没有 → deep。但 deep 说的是「要先调查才知道做成什么样」，不是「这句话里没有活」。一句已经完整、可以直接回答的话不是 deep，是 swift。",
    },
  },
  examples: [
    {
      task: "能不能调查一下为什么审计日志表最近涨得这么快",
      tier: "deep",
    },
    {
      task: "搜索结果点进去经常是死链,404,麻烦查一下是不是构建的时候路由没同步",
      tier: "standard",
    },
    {
      task: "深色模式代码块背景色跟正文背景一个颜色 看不出区别",
      tier: "swift",
    },
    {
      task: "Tooltip 在 iframe 里定位完全是错的",
      tier: "swift",
    },
    {
      task: "Table 组件表头固定之后横向滚动条消失了",
      tier: "standard",
    },
    {
      task: "Preferences window doesn't remember size after quit\n\n`PreferencesWindowController.swift` never persists its frame via `setFrameAutosaveName`. Add an autosave name and call it in `windowDidLoad`, so resizing the window sticks across relaunches like the main status window already does.",
      tier: "swift",
    },
    {
      task: "what would it take to add keyboard-only card creation (no mouse) to the board view?",
      tier: "deep",
    },
    {
      task: "Add a `--json` flag to the `board list` command\n\nRight now `board list` only prints an ASCII table (src/commands/list.ts). Add a `--json` flag that dumps the same data as JSON to stdout instead, and update the `--help` text in `cli.ts` to document it. Useful for piping into `jq` in scripts.",
      tier: "swift",
    },
    {
      task: "Scheduled job leaks DB connections\n\n`ReportGenerationJob.java` opens a `Connection` manually in `run()` but never closes it in the catch block when an exception is thrown mid-query. Under load this exhausts the HikariCP pool within a couple hours. Wrap it in try-with-resources and add a test that simulates a query failure and asserts pool size returns to baseline.",
      tier: "swift",
    },
    {
      task: "跑大表的时候报了个内存错误\n```\nMemoryError: Unable to allocate 3.2 GiB for an array\n```\n看看能不能流式处理不要一次读全部",
      tier: "standard",
    },
    {
      task: "角色权限缓存没有失效机制\n\nPermissionCacheService.java 用 Guava Cache 存权限,没设 TTL,管理员在后台改了某个角色的权限之后,已经登录的用户那边还是读到旧的缓存值,要重启服务才会刷新。想加两块:一是给缓存加个合理的 TTL 兜底,二是在 RoleController.updateRole 保存成功之后主动调用一次缓存失效,把改动立刻生效。顺便补一个覆盖这个失效逻辑的单测。",
      tier: "swift",
    },
    {
      task: "any chance we could speed up the parquet export path? it feels way slower than the csv one for the same row count",
      tier: "deep",
    },
    {
      task: "could we support opening files in $EDITOR from the file manager instead of always using vi?",
      tier: "deep",
    },
    {
      task: "打怪掉钱的几率好像太高了,能不能配置化",
      tier: "standard",
    },
    {
      task: "电量图标在充满电之后没有变绿,看下",
      tier: "standard",
    },
    {
      task: "any ideas on how to make undo/redo work across card moves, not just edits?",
      tier: "deep",
    },
    {
      task: "Getting this on startup after bumping api-version in plugin.yml:\n```\njava.lang.NoSuchMethodError: 'void org.bukkit.entity.Player.sendActionBar(net.md_5.bungee.api.chat.BaseComponent)'\n```\nLooks like a Paper API compat issue, please fix.",
      tier: "standard",
    },
    {
      task: "is there a way to make the Select component support async options loading?",
      tier: "deep",
    },
    {
      task: "websocket 代理老是断连,http 的没问题,是不是 upstream 的 timeout 设置太短了",
      tier: "standard",
    },
    {
      task: "OrderController 的分页接口,pageSize 传超过 1000 会直接 OOM,加个 max pageSize 校验,超过就 400,顺便把 error message 里那句英文改成中文",
      tier: "swift",
    },
    {
      task: "设置面板里加一个「开机自启」的开关,用 SMAppService 那套新 API(macOS 13+),状态存进 UserDefaults 的 launchAtLogin 键,UI 照抄现在「显示秒数」那个 toggle 的样式就行",
      tier: "swift",
    },
    {
      task: "感觉启动速度可以再快点,调查一下瓶颈在哪",
      tier: "deep",
    },
    {
      task: "文件树滚动的时候感觉卡一下 能不能查一下是不是重绘的问题",
      tier: "deep",
    },
    {
      task: "health check 的 interval 现在写死 5s,能不能做成每个 upstream 可配置?",
      tier: "standard",
    },
  ],
}
