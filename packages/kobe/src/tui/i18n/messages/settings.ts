/**
 * `settings.*` messages — the Settings dialog (sidebar, footer, every
 * section). English is the source of truth; `zh` mirrors its shape exactly
 * (`zh: typeof en`). One namespace per surface keeps parallel translation
 * work conflict-free — see `../catalog.ts` for how the namespaces compose.
 *
 * The namespace is still one surface; it is assembled from two files. The
 * engine card's copy lives in `./settings-engines.ts` and is spread back in
 * below, so every call site still spells its key `settings.engines.*` and never has to
 * know which file a key came from. That card is the part of this dialog that
 * grows — it gained a whole line per engine when Rove learned to say which
 * reporting layers an engine uses — and growing it should not push the other
 * five sections' copy around.
 */

import { en as autoRoutingEn, zh as autoRoutingZh } from "./settings-auto-routing"
import { en as engineCard, zh as engineCardZh } from "./settings-engines"
import { en as pluginsEn, zh as pluginsZh } from "./settings-plugins"

export const en = {
  appearance: {
    enabled: "On",
    disabled: "Off",
    singleRow: "Single row",
    doubleRow: "Two rows",
    preview: "Workspace preview",
    tasks: "Tasks",
    terminal: "Terminal",
    files: "Files",
    testsPassed: "Tests passed",
    modelDetail: "model · effort",
    transparent: "Transparent background",
    opaque: "Opaque background",
    modeDark: "Dark",
    modeLight: "Light",
    modeAuto: "Auto (follow the terminal)",
    openHint: "Enter to choose an option and preview it.",
    chooseHint: "↑/↓ or j/k preview · enter apply · esc cancel",
  },
  title: "Settings",
  esc: "esc",
  nav: {
    default: "j/k pick · h/l switch level · enter activate · esc close",
    feedback: "tab next field · enter sends on Send · esc close",
  },
  sections: {
    general: "General",
    engines: "Engines",
    autoRouting: "Auto routing",
    plugins: "Plugins",
    marketplace: "Marketplace",
    keys: "Keybindings",
    feedback: "Feedback",
    dev: "Dev",
  },
  general: {
    usage: "USAGE",
    theme: "Theme",
    themeMode: "Mode",
    themeHint: "l to enter list · j/k to highlight · enter to apply",
    language: "Language",
    languageHint: "Display language for Rove's UI. l to enter list · j/k to highlight · enter to apply.",
    transparent: "Transparent background",
    transparentHint: "Drops the renderer's bg fill so the host terminal shows through. enter toggles.",
    on: "[x] on",
    off: "[ ] off",
    focusAccent: "Focus accent",
    focusAccentHint: "Color of focused pane title, ▌ marker, and split borders.",
    accentPrimary: "Primary (brand accent)",
    accentSuccess: "Success (legacy green)",
    accentInfo: "Info (cool blue)",
    /** Heading of the group that holds theme, transparency, accent, split
     *  style and rail fold — everything the sample above them shows. */
    appearance: "Appearance",
    appearanceHint: "How split panes draw.",
    /** The split-style rows inside that group. */
    splitStyle: "Split panes",
    /** How tall an agent tab row is in the sidebar tree. */
    tabRowHeight: "Tab row height",
    tabRowHeightHint: "Two cells adds the model and reasoning level under an agent tab, and halves how many rows fit.",
    tabRowHeightRow: "{cells}-cell agent tab rows",
    tabRowHeightRowHint: "enter cycles",
    splitBox: "Box frames",
    splitLine: "Divider line",
    notifications: "Notifications",
    notificationsHint: "When a background tab finishes or pauses on an approval.",
    toast: "Toast",
    toastHint: "bottom-right popup",
    sound: "Sound",
    soundHint: "bell + chime + an OSC 9 desktop notification (rides SSH)",
    soundVolume: "Chime volume — {percent}%",
    soundVolumeHint: "enter cycles; applies to the next chime",
    crossTask: "Cross-task",
    crossTaskHint: "also for a task you switched away from",
    /** SubSection title for the keyboard-hints toggle */
    keyHints: "Keyboard hints",
    keyHintsHint: "The status-bar reminder and the first-use hints in the sidebar and files panes.",
    /** Checkbox row label */
    keyHintsShow: "Show keyboard hints",
    keyHintsShowHint: "re-enabling relights hints dismissed by use",
    zen: "Zen mode",
    zenHint: "The `zen` chip and `prefix`+z hide Files, keeping the Tasks rail and workspace.",
    zenDefaultOn: "Start in zen mode",
    railFold: "Folded task rail",
    railFoldHint: "What the rail shows once folded away from its corner control.",
    railFoldRow: "Folded rail shows: {style}",
    railFoldRowHint: "enter cycles",
    railFoldGlyphs: "status glyphs",
    railFoldInitials: "glyph + initials",
    railFoldHairline: "colour band only",
    editor: "Editor",
    editorHint:
      "What enter opens a file with in the file tree — diff mode when the editor supports it, the read-only preview when it isn't installed.",
    editorRow: "editor: < {kind} >",
    editorRowHint: "auto follows $VISUAL / $EDITOR, else nvim / vim / emacs / nano",
    editorCustom: "custom: {cmd}",
    editorCustomUnset: "(unset — enter to edit)",
    worktree: "Worktree location",
    worktreeHint: "Where new task worktrees are created. New tasks only.",
    worktreeBase: "location: < {kind} >",
    worktreeBaseHint: "custom takes `~`, a relative path, or a leading `$project_dir`",
    worktreeKindDefault: "default ~/.rove/worktrees",
    worktreeKindNext: "next to project",
    worktreeKindCustom: "custom",
    worktreeCustom: "custom: {path}",
    worktreeCustomUnset: "(unset — enter to edit)",
    worktreeBaseTitle: "Custom worktree location (blank = default; $project_dir = project root)",
    worktreeBaseField: "PATH",
    editorCustomTitle: "Custom editor command (use {file} for the path)",
    worktreeBaseInvalidTitle: "Can't use that worktree location",
    /** `{token}` is the literal `$project_dir`, not a translatable word. */
    worktreeBaseTokenBody:
      "{token} only expands as the leading path segment (e.g. {token}/../kobe-worktrees). Keeping the previous setting.",
    worktreeBaseUnusableBody:
      "{path} isn't usable ({error}). Keeping the previous setting — pick a writable directory.",
    terminal: "Terminal",
    terminalHint: "Applies to terminals opened after the change.",
    scrollbackRow: "scrollback: {rows} rows",
    scrollbackRowHint: "100–100000 · larger costs proportionally more CPU per redraw",
    scrollbackTitle: "Terminal scrollback rows (100–100000)",
    scrollbackField: "ROWS",
    scrollbackInvalidTitle: "Not a number",
    scrollbackInvalidBody: "Scrollback must be a number of rows (e.g. 1000). Keeping the previous setting.",
    /** `{mode}` = one of tabStripMode.* below. */
    tabStripRow: "tab strip: {mode}",
    tabStripMode: {
      never: "off — the sidebar tree lists tabs",
      multipleOnly: "only with 2+ tabs",
      always: "always",
    },
  },
  /**
   * Copy for the modals the Settings screen opens — `DialogConfirm` bodies
   * and the field labels / submit captions of the `RenameTaskDialog` it
   * reuses per field. These sit INSIDE a translated dialog, so leaving them
   * as literals produced a Chinese screen with an English modal on top.
   */
  field: {
    command: "COMMAND",
    name: "NAME",
    id: "ID",
  },
  action: {
    save: "save",
    next: "next",
    add: "add",
  },
  reset: {
    title: "Reset UI state?",
    body: "Wipes ~/.config/rove/state.json and ~/.rove/tasks.json, then quits Rove — relaunch for a fresh start with an empty working session list. Worktrees on disk and engine session history are NOT touched.",
    /** Printed to stderr AFTER the TUI is torn down — the user reads it in
     *  their shell, so it is UI copy despite not going through a pane. */
    done: "Rove: UI state reset. Relaunch Rove to start fresh.",
    failedTitle: "UI state was not reset",
    failedBody: "Could not write the settings file. Your settings and tasks have been kept. Try resetting again.",
  },
  restart: {
    title: "Restart backend?",
    body: "Stops the daemon and relaunches this Rove on the installed build, so daemon / orchestrator / engine edits take effect. Running engine sessions live in the PTY host and keep going; open tabs come back. Any other attached windows reconnect on their own.",
    done: "Rove: restarting the backend...",
  },
  /** Error toast when the debounced `state.json` write throws. Nothing awaits
   *  that write, so without the toast a settings change looks saved for the
   *  whole session and reverts at the next launch. */
  stateWrite: {
    failedTitle: "Settings were not saved",
    failedBody: "{file} could not be written ({keys}) — the change applies to this session only.",
  },
  ...autoRoutingEn,
  ...engineCard,
  ...pluginsEn,
  keybindings: {
    title: "Keybindings",
    hint: "Rebind direct and prefix chords in your own YAML file; changes reload live. Press F1 anywhere for the live keymap with every binding id.",
    configFile: "Config file",
    notCreated: "  (not created yet)",
    /** Heading for the prefix/grammar block; {prefix} is the live first stroke */
    prefixTitle: "Command layer ({prefix})",
    /** One-paragraph grammar summary; {prefix} live first stroke, {timeout} live second-stroke window in ms */
    prefixHint:
      "Bare keys act in the focused pane; a small one-press set covers frequent Rove actions; {prefix} opens the command layer ({timeout}ms second-stroke window). Prefix bindings keep their pane scope and modal rules.",
    tapPresentation: "Prefix tap",
    tapPresentationHint: "Choose whether the complete guide also marks controls already on screen.",
    tapPresentationLocal: "On-screen entries + complete guide (default)",
    tapPresentationGuide: "Complete guide only",
    /** Shown as the {prefix} value when the user disabled the prefix in YAML */
    prefixDisabled: "disabled",
    /** Trailing note listing non-rebindable ids; hidden when there are none */
    fixed: "Fixed (not rebindable): {ids}.",
    createHint:
      "No overrides file yet. Rove can write one for you, fully commented — nothing is rebound until you uncomment a line.",
    createFile: "[enter] Create keybindings.yaml",
    overridesApplied: "Overrides applied",
    none: "none",
    unbound: "(unbound)",
    defaultKeys: "default: {keys}",
    warnings: "Warnings",
  },
  feedback: {
    title: "Feedback",
    hint: "Sends a GitHub Discussion to the Rove repo through `gh`. Requires `gh auth login`; category defaults to Feedback.",
    titleLabel: "title",
    titlePlaceholder: "Short summary",
    descriptionLabel: "description",
    descriptionPlaceholder: "What happened? (enter for a new line · tab to Send)",
    send: "[enter] Send to GitHub Discussions",
  },
  dev: {
    reset: "Reset UI state",
    resetHint:
      "Clears ~/.config/rove/state.json and ~/.rove/tasks.json, then quits Rove — relaunch to start fresh. Working session list, pane sizes, theme, model picks all reset. Worktrees on disk and engine session history are not touched.",
    resetButton: "[enter] Reset",
    restart: "Restart backend",
    restartHint:
      "Stops the Rove daemon and relaunches this window on the installed build — picks up daemon / orchestrator / engine edits without quitting by hand. Running engine sessions live in the PTY host and survive it; other attached Rove windows reconnect on their own.",
    restartButton: "[enter] Restart",
    doctorHint:
      "Daemon wedged or unresponsive? Restart backend above does it from here; from a shell it is `rove daemon restart`. Hosted engine sessions stay alive across a daemon restart.",
    experimental: "Experimental",
    remoteHint:
      "Remote projects (SSH): register a project whose git worktrees live on another host, driven from this local Rove. Unfinished — Hosted PTY engine launch over SSH is not implemented, and file/diff panes still degrade. Enables `rove add --remote`.",
    remote: "Remote projects",
    autoStatusHint:
      "Auto status flow: a backlog task moves to in_progress when its engine starts a turn, and new sessions get a system-prompt note telling the agent to set in_review itself when the work is done. Never touches done/canceled.",
    autoStatus: "Auto status flow",
    dispatcherHint:
      "Field-notes dispatcher: task sessions file one-line gotchas (`rove api note`), the daemon forwards each to the repo's main session, and that session relays them to the in-flight tasks that benefit (`rove api dispatch`). Web-hosted sessions receive the relays today.",
    dispatcher: "Field-notes dispatcher",
  },
}

export const zh: typeof en = {
  appearance: {
    enabled: "开启",
    disabled: "关闭",
    singleRow: "单行",
    doubleRow: "双行",
    preview: "工作区预览",
    tasks: "任务",
    terminal: "终端",
    files: "文件",
    testsPassed: "测试通过",
    modelDetail: "模型 · 推理强度",
    transparent: "透明背景",
    opaque: "不透明背景",
    modeDark: "深色",
    modeLight: "浅色",
    modeAuto: "自动（跟随终端）",
    openHint: "按 Enter 打开选项和预览。",
    chooseHint: "↑/↓ 或 j/k 预览 · enter 应用 · esc 取消",
  },
  title: "设置",
  esc: "esc",
  nav: {
    default: "j/k 选择 · h/l 切换层级 · enter 确认 · esc 关闭",
    feedback: "tab 下一项 · enter 在发送项发送 · esc 关闭",
  },
  sections: {
    general: "通用",
    autoRouting: "自动路由",
    engines: "引擎",
    plugins: "插件",
    marketplace: "插件市场",
    keys: "快捷键",
    feedback: "反馈",
    dev: "开发",
  },
  general: {
    usage: "用量",
    theme: "主题",
    themeMode: "明暗",
    themeHint: "l 进入列表 · j/k 高亮 · enter 应用",
    language: "语言",
    languageHint: "Rove 界面的显示语言。l 进入列表 · j/k 高亮 · enter 应用。",
    transparent: "透明背景",
    transparentHint: "去掉渲染器的背景填充，让宿主终端透出来。按 enter 切换。",
    on: "[x] 开",
    off: "[ ] 关",
    focusAccent: "聚焦强调色",
    focusAccentHint: "聚焦面板标题、▌ 标记和分隔边框的颜色。",
    accentPrimary: "主色（品牌强调色）",
    accentSuccess: "成功色（传统绿）",
    accentInfo: "信息色（冷蓝）",
    appearance: "外观",
    appearanceHint: "分屏面板怎么画边。",
    splitStyle: "分屏面板",
    tabRowHeight: "Tab 行高",
    tabRowHeightHint: "两格会在引擎 tab 下面加一行模型和推理档位，可见行数减半。",
    tabRowHeightRow: "引擎 tab 行占 {cells} 格",
    tabRowHeightRowHint: "enter 切换",
    splitBox: "方框边框",
    splitLine: "单线分隔",
    notifications: "通知",
    notificationsHint: "后台标签完成或在审批处暂停时触发。",
    toast: "Toast 弹窗",
    toastHint: "右下角弹窗",
    sound: "声音",
    soundHint: "响铃 + 提示音 + OSC 9 桌面通知（经 SSH 直达本地）",
    soundVolume: "提示音音量 — {percent}%",
    soundVolumeHint: "回车循环切换；下一声提示音生效",
    crossTask: "跨任务",
    crossTaskHint: "你已切走的任务也通知",
    keyHints: "键盘提示",
    keyHintsHint: "状态栏提醒，以及侧栏和文件面板的首用提示。",
    keyHintsShow: "显示键盘提示",
    keyHintsShowHint: "重新开启会点亮已因使用而熄灭的提示",
    zen: "禅模式",
    zenHint: "`zen` 标记和 `prefix`+z 隐藏 Files，保留 Tasks 侧栏与 workspace。",
    zenDefaultOn: "启动即进入禅模式",
    railFold: "折叠后的任务栏",
    railFoldHint: "任务栏从角标折叠之后显示什么。",
    railFoldRow: "折叠后显示：{style}",
    railFoldRowHint: "enter 切换",
    railFoldGlyphs: "状态字形",
    railFoldInitials: "字形 + 首字母",
    railFoldHairline: "仅色带",
    editor: "编辑器",
    editorHint: "文件树里按 enter 用什么打开文件——支持时走编辑器 diff 模式，未安装时回退到只读预览。",
    editorRow: "编辑器: < {kind} >",
    editorRowHint: "auto 跟随 $VISUAL / $EDITOR，否则 nvim / vim / emacs / nano",
    editorCustom: "自定义: {cmd}",
    editorCustomUnset: "(未设置 — enter 编辑)",
    worktree: "工作树位置",
    worktreeHint: "新任务工作树的创建位置。仅对新任务生效。",
    worktreeBase: "位置: < {kind} >",
    worktreeBaseHint: "自定义可填 `~`、相对路径或以 `$project_dir` 开头",
    worktreeKindDefault: "默认 ~/.rove/worktrees",
    worktreeKindNext: "项目旁边",
    worktreeKindCustom: "自定义",
    worktreeCustom: "自定义: {path}",
    worktreeCustomUnset: "(未设置 — enter 编辑)",
    worktreeBaseTitle: "自定义工作树位置（留空 = 默认；$project_dir = 项目根目录）",
    worktreeBaseField: "路径",
    editorCustomTitle: "自定义编辑器命令（用 {file} 代表文件路径）",
    worktreeBaseInvalidTitle: "无法使用该工作树位置",
    worktreeBaseTokenBody: "{token} 只能作为路径的第一段展开（如 {token}/../kobe-worktrees）。保留原设置。",
    worktreeBaseUnusableBody: "{path} 不可用（{error}）。保留原设置 —— 请选择一个可写目录。",
    terminal: "终端",
    terminalHint: "对修改后新打开的终端生效。",
    scrollbackRow: "回滚行数: {rows} 行",
    scrollbackRowHint: "100–100000 · 调大会按比例增加每次重绘的 CPU",
    scrollbackTitle: "终端回滚行数（100–100000）",
    scrollbackField: "行数",
    scrollbackInvalidTitle: "不是数字",
    scrollbackInvalidBody: "回滚行数必须是数字（如 1000）。保留原设置。",
    tabStripRow: "标签栏: {mode}",
    tabStripMode: {
      never: "关闭 — 标签在左侧树里",
      multipleOnly: "仅 2 个以上标签时显示",
      always: "始终显示",
    },
  },
  field: {
    command: "命令",
    name: "名称",
    id: "标识",
  },
  action: {
    save: "保存",
    next: "下一步",
    add: "添加",
  },
  reset: {
    title: "重置界面状态？",
    body: "将清除 ~/.config/rove/state.json 和 ~/.rove/tasks.json 并退出 Rove —— 重新启动后会是一个干净的开始，工作会话列表为空。磁盘上的工作树和引擎会话历史不受影响。",
    done: "Rove：界面状态已重置。重新启动 Rove 即可从头开始。",
    failedTitle: "UI 状态未能重置",
    failedBody: "无法写入设置文件。设置和任务均已保留，请稍后重新尝试重置。",
  },
  restart: {
    title: "重启后端？",
    body: "会停掉 daemon，并以已安装的版本重新启动当前 Rove 窗口，从而让 daemon / orchestrator / 引擎的改动生效。正在运行的引擎会话由 PTY host 托管，不会中断；已打开的标签页会恢复。其他已连接的窗口会自行重连。",
    done: "Rove：正在重启后端……",
  },
  /** 防抖写入 `state.json` 抛错时的错误 toast。 */
  stateWrite: {
    failedTitle: "设置未能保存",
    failedBody: "{file} 写入失败（{keys}）—— 改动只在本次会话生效。",
  },
  ...autoRoutingZh,
  ...engineCardZh,
  ...pluginsZh,
  keybindings: {
    title: "快捷键",
    hint: "在你自己的 YAML 文件里重绑定直接按键和 prefix 组合；修改会实时加载。任意位置按 F1 查看带每个绑定 id 的实时键位表。",
    configFile: "配置文件",
    notCreated: "  (尚未创建)",
    prefixTitle: "命令层（{prefix}）",
    prefixHint:
      "裸键作用于当前聚焦面板；少量单次快捷键覆盖高频 Rove 操作；{prefix} 打开命令层（第二击窗口 {timeout}ms）。Prefix 绑定保持原有的面板作用域和 modal 规则。",
    tapPresentation: "点按 Prefix",
    tapPresentationHint: "选择完整指南是否同时标记当前屏幕上的入口。",
    tapPresentationLocal: "屏幕入口 + 完整指南（默认）",
    tapPresentationGuide: "仅完整指南",
    prefixDisabled: "已禁用",
    fixed: "固定（不可重绑定）：{ids}。",
    createHint: "还没有覆盖文件。Rove 可以帮你写一份带完整注释的——在你取消注释之前不会改动任何按键。",
    createFile: "[enter] 创建 keybindings.yaml",
    overridesApplied: "已应用的覆盖",
    none: "无",
    unbound: "(已解绑)",
    defaultKeys: "默认: {keys}",
    warnings: "警告",
  },
  feedback: {
    title: "反馈",
    hint: "通过 `gh` 向 Rove 仓库发一条 GitHub Discussion。需要 `gh auth login`；分类默认为 Feedback。",
    titleLabel: "标题",
    titlePlaceholder: "简短概括",
    descriptionLabel: "描述",
    descriptionPlaceholder: "发生了什么？(enter 换行 · tab 跳到发送)",
    send: "[enter] 发送到 GitHub Discussions",
  },
  dev: {
    reset: "重置 UI 状态",
    resetHint:
      "清空 ~/.config/rove/state.json 和 ~/.rove/tasks.json，然后退出 Rove——重新启动即可从头开始。工作会话列表、面板尺寸、主题、模型选择都会重置。磁盘上的 worktree 和引擎会话历史不受影响。",
    resetButton: "[enter] 重置",
    restart: "重启后端",
    restartHint:
      "停止 Rove daemon，并以已安装的版本重新启动当前窗口——无需手动退出即可应用 daemon / orchestrator / engine 的改动。正在运行的引擎会话由 PTY host 托管，不受影响；其他已连接的 Rove 窗口会自行重连。",
    restartButton: "[enter] 重启",
    doctorHint:
      "daemon 卡住或无响应？上面的「重启后端」就能在这里完成；在 shell 里则是 `rove daemon restart`。Hosted PTY 引擎会话不会因 daemon 重启而退出。",
    experimental: "实验性",
    remoteHint:
      "远程项目（SSH）：注册一个 git worktree + 引擎都通过 SSH 跑在另一台主机上、由本地 Rove 驱动的项目。尚未完成——文件/diff 面板对远程仍会降级。启用 `rove add --remote`。",
    remote: "远程项目",
    autoStatusHint:
      "自动状态流转：backlog 任务在其引擎开始一轮时移到 in_progress，新会话会拿到一条系统提示，告诉 agent 完成后自行设为 in_review。绝不触碰 done/canceled。",
    autoStatus: "自动状态流转",
    dispatcherHint:
      "现场笔记调度器：任务会话提交一行经验（`rove api note`），daemon 将每条转发给仓库的主会话，主会话再把它们转达给能受益的进行中任务（`rove api dispatch`）。目前由 Web 托管的会话会收到转达。",
    dispatcher: "现场笔记调度器",
  },
}
