/**
 * `search.*` messages — the command palette's task and conversation sections: what you and the agents wrote in any task's conversation.
 * English is the source of truth; `zh: typeof en` keeps the shapes locked.
 */

export const en = {
  commands: "Commands",
  tasks: "Tasks",
  inConversations: "In conversations",
  searching: "searching…",
  none: "Nothing said matches “{query}”.",
  you: "you",
  agent: "agent",
  truncated: "Stopped early to stay fast; add a word to narrow it.",
  skipped: "{count} task(s) not searched: another machine's, or an engine Rove cannot read.",
  failed: "Search failed: {reason}",
}

export const zh: typeof en = {
  commands: "命令",
  tasks: "任务",
  inConversations: "对话里",
  searching: "搜索中…",
  none: "没有说过「{query}」。",
  you: "你",
  agent: "agent",
  truncated: "为了快提前停了；多加一个词缩小范围。",
  skipped: "有 {count} 个任务没搜：在别的机器上，或 Rove 读不了它的引擎记录。",
  failed: "搜索失败：{reason}",
}
