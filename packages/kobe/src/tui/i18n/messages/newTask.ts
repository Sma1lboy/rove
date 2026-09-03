/**
 * `newTask.*` messages. English is the source of truth; `zh: typeof en` keeps
 * the shapes locked together. Filled during the TUI i18n migration.
 */

export const en = {
  title: "New task",
  legend: "enter create · tab complete/fields · ctrl+[ ] mode · ctrl+e engine · esc cancel",

  tabs: {
    existing: "For Existing",
    clone: "For New Repo",
    adopt: "Adopt Worktree",
  },

  field: {
    mode: "MODE",
    engine: "ENGINE",
    repo: "REPO",
    fromBranch: "FROM BRANCH",
    gitUrl: "GIT URL",
    parentDir: "PARENT DIR",
    folderName: "FOLDER NAME",
    baseBranch: "BASE BRANCH",
    adoptFilter: "FILTER (PATH GLOB)",
    /** Existing tab: task vs project — only for a repo with a main row. */
    opens: "OPENS",
  },

  /** Existing-tab intent labels. */
  intent: {
    task: "a new task worktree",
    project: "the project itself",
  },

  placeholder: {
    folderName: "auto from url",
    adoptFilter: "* — type e.g. feature-* to narrow",
  },

  hint: {
    modeCycle: "ctrl+[ ]",
    engineCycle: "ctrl+e",
    remembered: "(remembered — next clone defaults to this dir)",
    currentDir: "(current dir)",
    noBranchesFound: "(no local branches found — typed text will be used as ref)",
    noMatchBranch: "(no match — typed text will be used as ref)",
    scanningWorktrees: "scanning worktrees…",
  },

  picker: {
    moreAbove: "↑ {count} more",
    moreBelow: "↓ {count} more",
  },

  /** "Open the project" failures. {error} is the daemon's message. */
  open: {
    failed: "Couldn't open the project: {error}",
  },

  adopt: {
    repoLine: "repo: {path}",
    repoNone: "(none)",
    noUnlinked: "no unlinked worktrees — every git worktree here is already a task",
    noMatch: "no worktrees match the filter",
    hintSelected: "{count} selected · enter toggles · ctrl+a all · Create imports",
    hintDefault: "enter toggles · ctrl+a all · Create imports the highlighted row",
    summaryAll: "Adopted {count} worktree(s)",
    summaryPartial: "Adopted {done}/{total} worktrees — the rest failed (see log)",
    summaryNone: "Couldn't adopt any worktree: {error}",
  },

  clone: {
    progressFallback: "Cloning…",
    progressInto: "Cloning into {target}…",
  },

  button: {
    create: "Create",
    cloning: "Cloning…",
  },

  error: {
    gitUrlRequired: "git URL is required",
    gitUrlInvalid: "does not look like a git URL: {url}",
    folderRequired: "folder name is required",
    folderHasSeparator: "folder name cannot contain path separators",
    parentRequired: "parent directory is required",
    parentNotFound: "parent directory does not exist: {path}",
    parentNotDir: "not a directory: {path}",
    targetExists: "target already exists: {path}",
    cloneFailed: "git clone failed: {error}",
    noAdoptable: "no adoptable worktrees to import",
    /** Two saved repos share this basename — the name alone can't pick one. */
    repoAmbiguous: "more than one saved repo is named {name} — pick the one you mean from the list",
  },
}

export const zh: typeof en = {
  title: "新建任务",
  legend: "enter 创建 · tab 补全/切字段 · ctrl+[ ] 切模式 · ctrl+e 引擎 · esc 取消",

  tabs: {
    existing: "已有仓库",
    clone: "克隆新仓库",
    adopt: "接管 Worktree",
  },

  field: {
    mode: "模式",
    engine: "引擎",
    repo: "仓库",
    fromBranch: "基准分支",
    gitUrl: "git 地址",
    parentDir: "父目录",
    folderName: "文件夹名",
    baseBranch: "基准分支",
    adoptFilter: "过滤（路径 glob）",
    /** Existing tab: task vs project — only for a repo with a main row. */
    opens: "打开",
  },

  /** Existing-tab intent labels. */
  intent: {
    task: "新建任务 worktree",
    project: "项目本身",
  },

  placeholder: {
    folderName: "自动从地址推导",
    adoptFilter: "* — 输入如 feature-* 来缩小范围",
  },

  hint: {
    modeCycle: "ctrl+[ ]",
    engineCycle: "ctrl+e",
    remembered: "（已记住 — 下次克隆默认使用此目录）",
    currentDir: "（当前目录）",
    noBranchesFound: "（未找到本地分支 — 将直接使用输入文本作为 ref）",
    noMatchBranch: "（无匹配 — 将直接使用输入文本作为 ref）",
    scanningWorktrees: "正在扫描 worktree…",
  },

  picker: {
    moreAbove: "↑ 还有 {count} 项",
    moreBelow: "↓ 还有 {count} 项",
  },

  /** "Open the project" failures. {error} is the daemon's message. */
  open: {
    failed: "无法打开项目：{error}",
  },

  adopt: {
    repoLine: "仓库：{path}",
    repoNone: "（无）",
    noUnlinked: "没有未关联的 worktree — 此仓库所有 git worktree 均已是任务",
    noMatch: "没有 worktree 匹配此过滤条件",
    hintSelected: "已选 {count} 项 · enter 切换选中 · ctrl+a 全选 · 创建 导入",
    hintDefault: "enter 切换选中 · ctrl+a 全选 · 创建 将导入高亮行",
    summaryAll: "已接管 {count} 个 worktree",
    summaryPartial: "已接管 {done}/{total} 个 worktree — 其余失败（详见日志）",
    summaryNone: "没有 worktree 接管成功：{error}",
  },

  clone: {
    progressFallback: "克隆中…",
    progressInto: "正在克隆到 {target}…",
  },

  button: {
    create: "创建",
    cloning: "克隆中…",
  },

  error: {
    gitUrlRequired: "git 地址不能为空",
    gitUrlInvalid: "不像是有效的 git 地址：{url}",
    folderRequired: "文件夹名不能为空",
    folderHasSeparator: "文件夹名不能包含路径分隔符",
    parentRequired: "父目录不能为空",
    parentNotFound: "父目录不存在：{path}",
    parentNotDir: "不是目录：{path}",
    targetExists: "目标路径已存在：{path}",
    cloneFailed: "git clone 失败：{error}",
    noAdoptable: "没有可接管的 worktree",
    /** Two saved repos share this basename — the name alone can't pick one. */
    repoAmbiguous: "有多个已保存仓库都叫 {name} — 请从列表中选择你要的那个",
  },
}
