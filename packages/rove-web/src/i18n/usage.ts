/** `usage` messages: the Usage page. English is the source of truth; `zh: typeof en` keeps the shapes locked together. */
export const en = {
  usage: {
    title: "Usage",
    open: "Open usage",
    range: "last {days} days · tokens are input + output",
    perDay: "Per day",
    byModel: "By engine and model",
    topTasks: "Top tasks",
    quota: "Quota",
    turns: "{count} turns",
    loading: "Loading…",
    empty: "No turns recorded in this window.",
    failed: "Could not read usage: {error}",
    cutoff: "The daemon returns at most {count} turns: {day} and earlier are partial.",
    noReader: "{engines}: no turn reader, so their work is not counted here.",
    removedTask: "(removed task)",
    full: "{engine} {label} {percent}% · at this pace full around {time}, before it resets",
    lasts: "{engine} {label} {percent}% · at this pace it lasts until the reset",
    window: "{engine} {label} {percent}%",
  },
}

export const zh: typeof en = {
  usage: {
    title: "用量",
    open: "打开用量",
    range: "最近 {days} 天 · token 为输入加输出",
    perDay: "按天",
    byModel: "按引擎和模型",
    topTasks: "用量最高的任务",
    quota: "额度",
    turns: "{count} 轮",
    loading: "加载中…",
    empty: "这段时间没有记录到任何一轮。",
    failed: "无法读取用量：{error}",
    cutoff: "守护进程最多返回 {count} 轮：{day} 及更早的数据不完整。",
    noReader: "{engines}：没有轮次读取器，这里不统计它们的工作。",
    removedTask: "（已删除的任务）",
    full: "{engine} {label} {percent}% · 按当前速度约 {time} 用完，早于重置时间",
    lasts: "{engine} {label} {percent}% · 按当前速度可撑到重置",
    window: "{engine} {label} {percent}%",
  },
}
