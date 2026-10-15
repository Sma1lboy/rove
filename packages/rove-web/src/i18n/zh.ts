import type { en } from "./en.ts"

export const zh: typeof en = {
  rail: {
    tasks: "任务",
    inbox: "收件箱 {count}",
    empty: "还没有任务",
    emptyHint: "在 TUI 里或用 `rove api add` 新建一个",
    tabs: "{count} 个标签",
  },
  workspace: {
    pickTask: "从左边选一个任务",
    noTabs: "这个任务没有打开的会话",
    tabNotLive: "这个标签没有在运行的会话",
    restored: "已恢复的会话 · TUI 重新打开前只读",
    exited: "会话已结束 · 退出码 {code}",
    attachFailed: "打不开这个会话：{message}",
  },
  tab: {
    shell: "终端",
    engine: "引擎",
  },
  status: {
    connecting: "连接中",
    open: "已连接",
    retrying: "重连中 · 第 {count} 次",
    retry: "立即重试",
    host: "{host} · rove {version}",
  },
  connect: {
    title: "打开 rove 打印的链接",
    body: "运行 `rove --web`，打开它打印的链接，或者把链接粘贴到这里。",
    placeholder: "http://127.0.0.1:7878/#token=…",
    submit: "连接",
    invalid: "这不是 `rove --web` 打印的链接",
    failing: "连不上 rove。`rove --web` 还在运行吗？用过 `--rotate-token` 的话，请打开新的链接。",
    forget: "忘掉这个链接",
  },
}
