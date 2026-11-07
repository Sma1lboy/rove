export const en = {
  context: {
    title: "Context",
    used: "{percent} used",
    usedTokens: "{tokens} used",
    loading: "Reading context…",
    none: "No context reading for this conversation: its engine records none, or it has not answered yet.",
    failed: "Couldn't read context: {error}",
    approximate: "Approximate.",
    part: {
      system: "System prompt & tools",
      messages: "Messages",
      used: "Used",
      free: "Free space",
    },
  },
}

export const zh: typeof en = {
  context: {
    title: "上下文",
    used: "已用 {percent}",
    usedTokens: "已用 {tokens}",
    loading: "正在读取上下文…",
    none: "这个会话没有上下文读数：它的引擎不记录，或者还没回复过。",
    failed: "读取上下文失败：{error}",
    approximate: "近似值。",
    part: {
      system: "系统提示与工具",
      messages: "消息",
      used: "已用",
      free: "剩余空间",
    },
  },
}
