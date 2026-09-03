/**
 * `terminal.*` messages — the embedded terminal pane: the
 * in-process PTY running the task's engine CLI (or a plain worktree
 * shell). English is the source of truth; `zh: typeof en` locks shapes.
 */

export const en = {
  noTask: "(no task — press n to create)",
  exited: "process exited — F5 restarts it",
  restoring: "restoring session…",
  tab: {
    // A NORMAL (single) tab's default name is "$process $ordinal" —
    // built in code from the live process identity (e.g. "engine 3",
    // "shell 5"), not translated. Only the SPLIT label lives here.
    groupTitle: "group {n}",
    renameTitle: "Rename tab",
    renameField: "TAB TITLE",
    renameSubmit: "rename",
    chooseEngineHint: "←/→ or h/l choose, enter confirm, esc cancel",
    // Unified new-conversation dialog: the ctrl+e picker plus
    // two footer toggles — tab flips the destination, ctrl+f the context.
    newChat: {
      title: "New conversation",
      engine: "ENGINE",
      destLabel: "DESTINATION",
      destTab: "new tab in this worktree",
      destFork: "fork a child task (new worktree)",
      ctxLabel: "CONTEXT",
      ctxFresh: "fresh conversation",
      ctxContinue: "continue this conversation",
      scratchChoice: "scratch shell",
    },
    cannotCloseLast: "Cannot close the only tab",
    tabGone: "That tab is no longer there",
    nothingToFork: "No conversation in this tab to fork yet",
    noTranscriptToHandOff: "{engine} keeps no readable transcript to hand over",
  },
  split: {
    // F2-while-split rename dialog (each leaf's own name — the corner
    // tag defaults to the basename of what the leaf runs).
    renameTitle: "Rename split",
    renameField: "SPLIT NAME",
  },
  scrolledBack: "↑ scrolled {lines}L (ctrl+pgdn to follow)",
  search: {
    placeholder: "search scrollback — enter/↑ older, ↓ newer, esc close",
    position: "{index}/{total}",
    noMatches: "no matches",
    // The alternate screen belongs to the app: Rove's ring holds the one
    // screen already on display, so there is nothing here a search could find
    // that reading the pane would not.
    unavailable: "this app owns its own scrollback — nothing local to search (esc)",
  },
  unavailable: {
    shellMissing: "terminal unavailable — configured shell is not available",
    spawnFailed: "terminal unavailable — shell could not start",
    // The pane is otherwise a dead end: there is no PTY to key into, so the
    // only way out has to be named on screen.
    retry: "F5 tries again",
  },
  reset: {
    title: "Reset terminal?",
    body: "The running shell will be killed and a fresh one will spawn at the worktree. Any in-flight processes (vim, htop, paused jobs) end immediately.",
  },
}

export const zh: typeof en = {
  noTask: "（无任务 —— 按 n 创建）",
  exited: "进程已退出 —— 按 F5 重启",
  restoring: "正在恢复会话…",
  tab: {
    groupTitle: "group {n}",
    renameTitle: "重命名标签页",
    renameField: "标签页名称",
    renameSubmit: "重命名",
    chooseEngineHint: "←/→ 或 h/l 选择，enter 确认，esc 取消",
    newChat: {
      title: "新建对话",
      engine: "引擎",
      destLabel: "落点",
      destTab: "本 worktree 新标签页",
      destFork: "fork 子任务（新 worktree）",
      ctxLabel: "上下文",
      ctxFresh: "全新对话",
      ctxContinue: "接着当前对话",
      scratchChoice: "临时 shell",
    },
    cannotCloseLast: "无法关闭唯一的标签页",
    tabGone: "这个标签页已经不在了",
    nothingToFork: "这个标签页还没有可派生的对话",
    noTranscriptToHandOff: "{engine} 没有可读的对话记录，无法交接",
  },
  split: {
    renameTitle: "重命名分屏",
    renameField: "分屏名称",
  },
  scrolledBack: "↑ 已回滚 {lines} 行（ctrl+pgdn 回到底部）",
  search: {
    placeholder: "搜索回滚缓冲区 —— enter/↑ 更早，↓ 更晚，esc 关闭",
    position: "{index}/{total}",
    noMatches: "没有匹配",
    unavailable: "这个程序自己管理回滚缓冲区 —— 本地没有可搜索的内容（esc）",
  },
  unavailable: {
    shellMissing: "终端不可用 —— 配置的 shell 不存在",
    spawnFailed: "终端不可用 —— shell 启动失败",
    retry: "按 F5 重试",
  },
  reset: {
    title: "重置终端？",
    body: "正在运行的 shell 会被杀掉并在 worktree 重新启动，进行中的进程（vim、htop、暂停的任务）会立即结束。",
  },
}
