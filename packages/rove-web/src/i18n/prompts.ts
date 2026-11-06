/** `quote` (terminal selection into the prompt) and `snippets` (saved `@name` prompts) messages. English is the source of truth. */
export const en = {
  quote: {
    action: "[ quote ]",
    title: "Put the selection in the prompt as a quote",
    atMenu: "The agent is waiting on a choice. Answer it first, then quote.",
    notReady: "The agent's prompt is not taking pasted text yet. Try again in a moment.",
  },
  snippets: {
    empty: "No snippets yet.",
    name: "Name",
    namePlaceholder: "review",
    text: "Text",
    textPlaceholder: "Review this change for bugs and missing tests.",
    add: "[ add ]",
    save: "[ save ]",
    edit: "[ edit ]",
    cancel: "[ cancel ]",
    remove: "[ remove ]",
    removed: "Removed @{name}",
    badName: "A name is letters, digits, - or _, up to 32.",
  },
}

export const zh: typeof en = {
  quote: {
    action: "[ 引用 ]",
    title: "把选中的内容作为引用放进提示词",
    atMenu: "agent 正在等你做选择。先回答它，再引用。",
    notReady: "agent 的输入框暂时还不接受粘贴。稍等一下再试。",
  },
  snippets: {
    empty: "还没有片段。",
    name: "名称",
    namePlaceholder: "review",
    text: "内容",
    textPlaceholder: "检查这次改动有没有 bug，有没有漏掉的测试。",
    add: "[ 添加 ]",
    save: "[ 保存 ]",
    edit: "[ 编辑 ]",
    cancel: "[ 取消 ]",
    remove: "[ 删除 ]",
    removed: "已删除 @{name}",
    badName: "名称只能是字母、数字、- 或 _，最长 32 位。",
  },
}
