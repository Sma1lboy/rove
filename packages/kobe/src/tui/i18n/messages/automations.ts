/**
 * `automations.*` messages — the scheduled-automations page. English is the
 * source of truth; `zh: typeof en` keeps the shapes locked together.
 */

export const en = {
  title: "ROUTINES",
  holdingDaemon: "keeping the daemon awake",
  notHolding: "none active",
  /** Header count of routines whose latest run needs a human. `{count}` of `{total}`. */
  needAttention: "{count} of {total} need you ·",
  paused: "paused",
  newTitle: "New routine",
  composerLegend: "enter create · tab fields · ←→ ↑↓ edit the focused field · esc cancel",
  fieldName: "NAME",
  fieldRepo: "REPO",
  fieldTarget: "DELIVER TO",
  fieldTargetTab: "EXISTING ENGINE TAB",
  targetFresh: "New task on each run",
  targetStanding: "Routine-owned standing task",
  targetExisting: "Existing conversation: {task} / {tab}. Never creates or revives a session.",
  fieldPrompt: "PROMPT",
  fieldSchedule: "SCHEDULE (FIVE-FIELD CRON)",
  namePlaceholder: "weekday dependency audit",
  promptPlaceholder: "Audit dependencies and summarize risky changes.",
  needRepo: "Open a project first — a routine runs in one.",
  cronInvalid: "not a five-field cron",
  cronField: {
    minute: "min",
    hour: "hour",
    dayOfMonth: "day",
    month: "month",
    dayOfWeek: "weekday",
  },

  /**
   * The schedule preview — the one line that answers "when does this fire".
   * `describeCron` names the recurrence, `when.*` the next occurrence. Word
   * order is part of the translation, so each phrase is ONE key with slots
   * rather than fragments the caller concatenates.
   */
  schedule: {
    everyDay: "every day {at}",
    weekdays: "weekdays {at}",
    weekends: "weekends {at}",
    onWeekday: "{weekday} {at}",
    everyMinute: "every minute",
    everyMinutes: "every {n}m",
    everyHours: "every {n}h",
    hourlyAt: "hourly at :{minute}",
    atClock: "at {time}",
    /** Recurring weekday phrase — English pluralises, Chinese prefixes. */
    dow: {
      MON: "Mondays",
      TUE: "Tuesdays",
      WED: "Wednesdays",
      THU: "Thursdays",
      FRI: "Fridays",
      SAT: "Saturdays",
      SUN: "Sundays",
    },
  },
  /** Next-run and last-run clocks. `{n}` is already a coarse bucket. */
  when: {
    inMinutes: "in {n}m",
    inHours: "in {n}h",
    inDays: "in {n}d",
    minutesAgo: "{n}m ago",
    hoursAgo: "{n}h ago",
    now: "now",
    justNow: "just now",
    /** `{date}` is `Intl`-formatted for the UI locale, so it carries its own
     *  word order; only the comma before the clock is ours. */
    dateTime: "{date}, {time}",
  },
  /**
   * The daemon's `AutomationRunStatus` enum, so a run row is not half English
   * in a Chinese page. `run.error` beside it stays untranslated on purpose —
   * it is a machine message the user searches for and pastes into an issue,
   * and a translated copy of it matches nothing.
   */
  runStatus: {
    dispatched: "dispatched",
    revived: "revived",
    skipped_cancelled: "cancelled before delivery",
    skipped_precheck: "skipped (precheck)",
    skipped_missed: "skipped (missed)",
    skipped_unavailable: "skipped (unavailable)",
    dispatch_failed: "dispatch failed",
  },
  cronNever: "valid, but never fires",
  missing: {
    target: "Choose an existing task.",
    targetTab: "Enter an existing tab id, e.g. tab-2.",
    name: "Give it a name.",
    repo: "Pick a project.",
    prompt: "Say what it should do.",
    schedule: "That schedule will not run.",
  },

  empty: "No routines scheduled.",
  emptyHint: "Press n to create one.",
  precheck: "precheck: {command}",
  recentRuns: "RECENT RUNS",
  /** Header of the latest run's precheck detail. `{exit}` is `exited 1` or `timed out`. */
  precheckDetail: "WHY IT SKIPPED — precheck {exit} in {duration}ms",
  precheckExited: "exited {code}",
  precheckTimedOut: "timed out",
  precheckStdout: "stdout",
  precheckStderr: "stderr",
  precheckNoOutput: "(no output)",
  noRuns: "Not run yet.",
  noSelection: "A routine runs its prompt in a project on a schedule.",
  running: "Running {name}…",
  ranWith: "{name}: {status}",
  latestRunNoTask: "The latest run created no task.",
  runNow: "[ run now ]",
  deleteTitle: "Delete routine?",
  deleteBody: "{name} and its run history will be removed. Tasks it already created are untouched.",
  deleteButton: "Delete",
  /** Error toasts for a failed create/delete/toggle/run. Each names the action
   *  that failed, then carries the daemon's own `{error}`. Kept short on
   *  purpose: the toast is ONE truncated line — about 38 cells at 90 columns —
   *  so a longer clause buys nothing and costs the cause. The toggle pair
   *  states the surviving state because that is what separates the two. */
  createFailed: "Couldn't create the routine: {error}",
  deleteFailed: 'Couldn\'t delete "{name}": {error}',
  enableFailed: '"{name}" stays paused: {error}',
  disableFailed: '"{name}" stays enabled: {error}',
  runFailed: 'Couldn\'t run "{name}" now — schedule unchanged: {error}',
}

export const zh: typeof en = {
  title: "例行任务",
  holdingDaemon: "正在保持守护进程常驻",
  notHolding: "无启用项",
  needAttention: "{total} 个中有 {count} 个需要处理 ·",
  paused: "已暂停",
  newTitle: "新建例行任务",
  composerLegend: "enter 创建 · tab 切字段 · ←→ ↑↓ 编辑当前字段 · esc 取消",
  fieldName: "名称",
  fieldTarget: "投递目标",
  fieldTargetTab: "既有引擎标签页",
  targetFresh: "每次新建任务",
  targetStanding: "例行任务自有的常驻任务",
  targetExisting: "既有会话：{task} / {tab}。不会创建或重启会话。",
  fieldRepo: "仓库",
  fieldPrompt: "提示词",
  fieldSchedule: "调度（五段 cron）",
  namePlaceholder: "工作日依赖审计",
  promptPlaceholder: "审计依赖并总结有风险的变更。",
  needRepo: "先打开一个项目——例行任务要跑在某个项目里。",
  cronInvalid: "不是合法的五段 cron",
  cronField: {
    minute: "分",
    hour: "时",
    dayOfMonth: "日",
    month: "月",
    dayOfWeek: "星期",
  },

  schedule: {
    everyDay: "每天{at}",
    weekdays: "工作日{at}",
    weekends: "周末{at}",
    onWeekday: "{weekday}{at}",
    everyMinute: "每分钟",
    everyMinutes: "每 {n} 分钟",
    everyHours: "每 {n} 小时",
    hourlyAt: "每小时的 :{minute}",
    atClock: "{time}",
    dow: {
      MON: "每周一",
      TUE: "每周二",
      WED: "每周三",
      THU: "每周四",
      FRI: "每周五",
      SAT: "每周六",
      SUN: "每周日",
    },
  },
  when: {
    inMinutes: "{n} 分钟后",
    inHours: "{n} 小时后",
    inDays: "{n} 天后",
    minutesAgo: "{n} 分钟前",
    hoursAgo: "{n} 小时前",
    now: "即将",
    justNow: "刚刚",
    dateTime: "{date} {time}",
  },
  runStatus: {
    dispatched: "已派发",
    revived: "已重启会话",
    skipped_cancelled: "交付前已取消",
    skipped_precheck: "已跳过（预检）",
    skipped_missed: "已跳过（错过时间）",
    skipped_unavailable: "已跳过（不可用）",
    dispatch_failed: "派发失败",
  },
  cronNever: "语法合法，但永远不会触发",
  missing: {
    target: "请选择既有任务。",
    targetTab: "请输入既有标签页 ID，例如 tab-2。",
    name: "起个名字。",
    repo: "选一个项目。",
    prompt: "说明它要做什么。",
    schedule: "这个调度不会触发。",
  },

  empty: "还没有例行任务。",
  emptyHint: "按 n 新建一条。",
  precheck: "预检：{command}",
  recentRuns: "最近执行",
  /** 最近一次执行的预检详情标题。`{exit}` 为“退出码 1”或“超时”。 */
  precheckDetail: "为什么跳过 —— 预检{exit}，耗时 {duration}ms",
  precheckExited: "退出码 {code}",
  precheckTimedOut: "超时",
  precheckStdout: "标准输出",
  precheckStderr: "标准错误",
  precheckNoOutput: "（无输出）",
  noRuns: "尚未执行。",
  noSelection: "例行任务会按调度在某个项目里跑它的提示词。",
  running: "正在运行 {name}…",
  ranWith: "{name}：{status}",
  latestRunNoTask: "最近一次执行没有创建任务。",
  runNow: "[ 立即运行 ]",
  deleteTitle: "删除这条例行任务？",
  deleteBody: "将删除 {name} 及其执行记录。它已经创建的任务不受影响。",
  deleteButton: "删除",
  /** 创建/删除/开关/立即运行失败时的错误 toast。`{error}` = daemon 返回的信息。 */
  createFailed: "创建例行任务失败：{error}",
  deleteFailed: "删除“{name}”失败：{error}",
  enableFailed: "“{name}”仍处于暂停状态：{error}",
  disableFailed: "“{name}”仍处于启用状态：{error}",
  runFailed: "无法立即运行“{name}”——排程未受影响：{error}",
}
