/**
 * `help.*` messages. English is the source of truth; `zh: typeof en` keeps
 * the shapes locked together. Filled during the TUI i18n migration.
 */

export const en = {
  /** Dialog title */
  title: "Rove — keybindings",
  palette: "Search commands",
  search: "Type an action name or chord…",
  filter: "/ filter actions",
  noResults: "No matching actions. Try another name or clear the filter.",
  run: "↑↓ select · enter run · esc cancel",
  reportProblem: "Report a problem",
  reportPrompt:
    "You are helping the user report a problem with Rove itself (not their own project) as a GitHub issue. First ask what they were doing and what felt wrong: one to three short questions, one at a time. Then collect context: run `rove --version` and `rove daemon status`, and read the last ~50 lines of {logPath} only if the problem could involve the daemon. Draft an issue title and body (what happened, what they expected, steps, relevant output) and show it to the user. Only after they say OK, file it with a heredoc: `rove feedback --kind bug|idea|question --title \"...\" --body-file - <<'EOF'` followed by the body and `EOF`. Then share the issue URL. If it prints a prefilled link instead (gh missing or signed out), give the user that link and tell them to run `gh auth login`.",
  unavailable: "This action is no longer available. Close and reopen the palette.",
  /** Close / cancel hint */
  esc: "esc",
  /** Corner hint next to `esc`. The list is a scrollbox and routinely runs
   *  two thirds below the fold behind a one-cell scrollbar thumb, with
   *  nothing on screen naming the keys that move it. */
  scrollKeys: "↑↓ ⇞⇟ scroll",
  commandLayer: "{prefix} — more Rove commands",
  escCancel: "esc cancel",
  directLayer: "Hold ctrl — Rove shortcuts",
  releaseCtrl: "release ctrl to close",
  overflow: "… F1 for all shortcuts",
  moreCommandsPrefix: "More commands (prefix)",
  focused: "Focused: {surface}",
  allBindings: "All keybinding contexts",
  /** The sentence that names every way to drive Rove. Right-click belongs in
   *  it: six sidebar verbs (set status, the two copies, run again, field
   *  notes, sync with base) have no chord at all, and until this line nothing
   *  in the running TUI said the menu existed. */
  grammar: "Use keys here · one-press Rove shortcuts · {prefix} for more commands · right-click a row for its menu",
  disabled: "prefix disabled",
  here: "HERE — only in {surface}",
  direct: "ONE PRESS — Rove shortcuts",
  afterPrefix: "AFTER PREFIX — more Rove commands",
  otherPane: "OTHER PANE — {surface}",
  /** Legend section titles, below the keybinding sections. */
  marks: {
    rows: "MARKS — task and tab rows",
    inbox: "MARKS — tab strip and Inbox",
    pr: "MARKS — pull request chip",
  },
  mark: {
    spinner: "working: an engine turn or a task job is running",
    needsInput: "waiting on your answer: a permission prompt or a question",
    attention: "needs you: an error, a rate limit, an exited engine or a failed deletion",
    unseen: "a turn finished and you have not looked yet",
    idle: "quiet",
    subagent: "running subagents, in front of the branch",
    remote: "the task lives on another machine",
    done: "the turn finished",
    rateLimited: "rate limited; it resumes on its own",
    dead: "the engine process exited",
    routineFailed: "a routine run failed",
    conflict: "merge conflicts",
    checksFailing: "checks failing",
    checksPassing: "checks passing",
  },
}

export const zh: typeof en = {
  title: "Rove — 快捷键",
  palette: "搜索命令",
  search: "输入操作名称或快捷键…",
  filter: "/ 筛选操作",
  noResults: "没有匹配的操作。请换个名称或清空筛选。",
  run: "↑↓ 选择 · enter 执行 · esc 取消",
  reportProblem: "报告问题",
  reportPrompt:
    "你在帮用户把 Rove 本身的问题（不是他们自己项目的问题）提成一个 GitHub issue。先问清楚他们当时在做什么、哪里不对劲：一到三个简短的问题，一次问一个。然后收集上下文：运行 `rove --version` 和 `rove daemon status`，只有问题可能和 daemon 有关时才读 {logPath} 的最后约 50 行。起草 issue 的标题和正文（发生了什么、期望什么、复现步骤、相关输出）并展示给用户。用户确认之后才提交，用 heredoc：`rove feedback --kind bug|idea|question --title \"...\" --body-file - <<'EOF'`，接正文，最后一行 `EOF`。然后把 issue 链接发给用户。如果输出的是预填链接（没装 gh 或没登录），把链接给用户，并告诉他运行 `gh auth login`。",
  unavailable: "此操作已不可用。请关闭并重新打开命令面板。",
  esc: "esc",
  scrollKeys: "↑↓ ⇞⇟ 滚动",
  commandLayer: "{prefix} — 更多 Rove 命令",
  escCancel: "esc 取消",
  directLayer: "按住 ctrl — Rove 快捷键",
  releaseCtrl: "松开 ctrl 关闭",
  overflow: "… 按 F1 查看全部快捷键",
  moreCommandsPrefix: "更多命令（prefix）",
  focused: "当前焦点：{surface}",
  allBindings: "所有快捷键上下文",
  grammar: "当前区域直接按 · Rove 单次快捷键 · {prefix} 打开更多命令 · 右键任务行打开菜单",
  disabled: "Prefix 已禁用",
  here: "当前区域 — 仅在{surface}",
  direct: "一次按下 — Rove 快捷键",
  afterPrefix: "按下 Prefix 后 — 更多 Rove 命令",
  otherPane: "其他区域 — {surface}",
  marks: {
    rows: "标记 — 任务行和标签行",
    inbox: "标记 — 标签栏和收件箱",
    pr: "标记 — PR 标记",
  },
  mark: {
    spinner: "运行中：引擎正在执行一轮，或任务作业正在运行",
    needsInput: "等你回答：权限确认或提问",
    attention: "需要你处理：出错、限流、引擎已退出或删除失败",
    unseen: "一轮已结束，你还没看过",
    idle: "空闲",
    subagent: "正在运行的子代理，显示在分支名前",
    remote: "任务在另一台机器上",
    done: "这一轮已结束",
    rateLimited: "被限流，会自动恢复",
    dead: "引擎进程已退出",
    routineFailed: "例行任务运行失败",
    conflict: "存在合并冲突",
    checksFailing: "检查未通过",
    checksPassing: "检查已通过",
  },
}
