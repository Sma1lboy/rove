/** `runLog` messages: the Routines page's run log. English is the source of truth; `zh: typeof en` keeps the shapes locked together. */
export const en = {
  runLog: {
    title: "Runs",
    all: "all",
    outcome: { ok: "ok", blocked: "blocked", failed: "failed", skipped: "skipped" },
    source: { schedule: "schedule", manual: "manual", webhook: "webhook" },
    blocked: {
      "task-missing": "task is gone",
      "awaiting-owner": "waiting on a decision",
      "report-missing": "last run never reported",
      quota: "rate limited",
      "engine-error": "engine error",
      "engine-dead": "engine stopped",
      "awaiting-permission": "waiting on a permission",
      busy: "still working",
    },
    blockedRun: "blocked: {reason}",
    empty: "No runs match.",
    more: "+{count} more",
  },
}

export const zh: typeof en = {
  runLog: {
    title: "运行记录",
    all: "全部",
    outcome: { ok: "成功", blocked: "受阻", failed: "失败", skipped: "跳过" },
    source: { schedule: "定时", manual: "手动", webhook: "Webhook" },
    blocked: {
      "task-missing": "任务已不存在",
      "awaiting-owner": "等你做决定",
      "report-missing": "上次运行没有汇报",
      quota: "触发限流",
      "engine-error": "引擎出错",
      "engine-dead": "引擎已停止",
      "awaiting-permission": "等你授权",
      busy: "仍在运行",
    },
    blockedRun: "受阻：{reason}",
    empty: "没有符合条件的运行。",
    more: "另有 {count} 条",
  },
}
