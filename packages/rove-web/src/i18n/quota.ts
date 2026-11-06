export const en = {
  quota: {
    used: "{percent}% used",
    resets: "resets {when}",
    loading: "Reading usage…",
    empty: "No meter to show yet: an engine reports its quota after its first turn, and E2B needs E2B_API_KEY.",
    failed: "Couldn't read usage: {error}",
    noEngineYet: "Engine quotas appear after an engine's first turn.",
    title: { context: "Context", e2b: "E2B sandboxes" },
    part: {
      used: "Used",
      free: "Free space",
      input: "Input (session)",
      output: "Output (session)",
      cpu: "vCPU",
      memory: "Memory",
      running: "Running sandboxes",
      left: "Left (est.)",
    },
    note: {
      estimated: "Estimated from sandboxes Rove has seen running since {since}; E2B has no balance API.",
      approximate: "Approximate.",
      error: "Last check failed: {error}",
    },
  },
}

export const zh: typeof en = {
  quota: {
    used: "已用 {percent}%",
    resets: "{when} 重置",
    loading: "正在读取用量…",
    empty: "还没有可显示的额度：引擎跑完第一轮后才会报告额度，E2B 需要配置 E2B_API_KEY。",
    failed: "读取用量失败：{error}",
    noEngineYet: "引擎跑完第一轮后才会显示它的额度。",
    title: { context: "上下文", e2b: "E2B 沙箱" },
    part: {
      used: "已用",
      free: "剩余空间",
      input: "输入（本会话）",
      output: "输出（本会话）",
      cpu: "vCPU",
      memory: "内存",
      running: "运行中的沙箱",
      left: "剩余（估算）",
    },
    note: {
      estimated: "根据 {since} 以来 Rove 看到在跑的沙箱估算；E2B 没有查余额的接口。",
      approximate: "近似值。",
      error: "上次检查失败：{error}",
    },
  },
}
