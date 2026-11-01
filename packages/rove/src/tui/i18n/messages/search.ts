/**
 * `search.*` messages — the rail's Search page: what you and the agents wrote in any task's conversation.
 * English is the source of truth; `zh: typeof en` keeps the shapes locked.
 */

export const en = {
  title: "Search",
  placeholder: "Find something said in any task",
  hint: "Searches what you and the agents wrote, newest first; tool output is left out.",
  searching: "searching…",
  none: "Nothing said matches “{query}”.",
  you: "you",
  agent: "agent",
  truncated: "Stopped early to stay fast; add a word to narrow it.",
  skipped: "{count} task(s) not searched: another machine's, or an engine Rove cannot read.",
  failed: "Search failed: {reason}",
  keys: "type to search · ↑↓ move · enter open · esc back",
}

export const zh: typeof en = {
  title: "搜索",
  placeholder: "在所有任务的对话里找",
  hint: "搜你和 agent 写过的话，新的在前；不含工具输出。",
  searching: "搜索中…",
  none: "没有说过「{query}」。",
  you: "你",
  agent: "agent",
  truncated: "为了快提前停了；多加一个词缩小范围。",
  skipped: "有 {count} 个任务没搜：在别的机器上，或 Rove 读不了它的引擎记录。",
  failed: "搜索失败：{reason}",
  keys: "输入即搜 · ↑↓ 移动 · enter 打开 · esc 返回",
}
