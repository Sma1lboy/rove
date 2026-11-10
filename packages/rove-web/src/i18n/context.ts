export const en = {
  context: {
    used: "{percent} used",
    usedTokens: "{tokens} used",
    loading: "Reading context…",
    none: "No context reading for this conversation: its engine records none, or it has not answered yet.",
    failed: "Couldn't read context: {error}",
    probing: "Reading what fills it…",
    more: "+{count} more",
    part: {
      system: "System prompt & tools",
      system_prompt: "System prompt",
      system_tools: "System tools",
      mcp_tools: "MCP tools",
      custom_agents: "Custom agents",
      memory_files: "Memory files",
      skills: "Skills",
      messages: "Messages",
      used: "Used",
      free: "Free space",
    },
  },
}

export const zh: typeof en = {
  context: {
    used: "已用 {percent}",
    usedTokens: "已用 {tokens}",
    loading: "正在读取上下文…",
    none: "这个会话没有上下文读数：它的引擎不记录，或者还没回复过。",
    failed: "读取上下文失败：{error}",
    probing: "正在读取构成…",
    more: "另有 {count} 项",
    part: {
      system: "系统提示与工具",
      system_prompt: "系统提示",
      system_tools: "系统工具",
      mcp_tools: "MCP 工具",
      custom_agents: "自定义 agent",
      memory_files: "记忆文件",
      skills: "技能",
      messages: "消息",
      used: "已用",
      free: "剩余空间",
    },
  },
}
