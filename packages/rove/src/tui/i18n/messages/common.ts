/**
 * `common.*` messages. English is the source of truth; `zh: typeof en` keeps
 * the shapes locked together. Filled during the TUI i18n migration.
 */

export const en = {
  cancel: "Cancel",
  /** Placeholder text a page shows while its data is still null. */
  loading: "Loading…",
  /** Footer verb for a step that leads to another prompt. */
  create: "create",
  confirm: "Confirm",
  /** Fallback shown when a render tree throws, instead of dropping the
   *  process to a raw shell. `region*` rows are one Workspace Host region. */
  paneCrash: {
    title: "This pane crashed",
    hint: "The error was logged to client.log. Retry, or restart Rove if it keeps happening.",
    regionTitle: "The {region} hit an error",
    regionHint: "The rest of Rove keeps working. The error was logged to client.log.",
    retry: "[ retry ]",
    region: {
      sidebar: "task list",
      workspace: "workspace",
      files: "file tree",
      page: "page",
    },
  },
  rename: {
    defaultTitle: "Rename task",
    defaultFieldLabel: "TITLE",
    /** Footer hint shown at the bottom of the rename dialog.
     *  `{submitLabel}` is interpolated with the verb (e.g. "rename"). */
    footerHint: "enter {submitLabel} · esc cancel",
    defaultSubmitLabel: "rename",
  },
  /** Host-provided plugin input dialog (`ui.prompt` → the rename dialog reused). */
  prompt: {
    fieldLabel: "input",
    submitLabel: "submit",
  },
}

export const zh: typeof en = {
  cancel: "取消",
  loading: "加载中…",
  create: "创建",
  confirm: "确认",
  paneCrash: {
    title: "此面板已崩溃",
    hint: "错误已记录到 client.log。可重试；若反复出现请重启 Rove。",
    regionTitle: "{region}出错了",
    regionHint: "Rove 的其余部分仍可正常使用。错误已记录到 client.log。",
    retry: "[ 重试 ]",
    region: {
      sidebar: "任务列表",
      workspace: "工作区",
      files: "文件树",
      page: "页面",
    },
  },
  rename: {
    defaultTitle: "重命名任务",
    defaultFieldLabel: "名称",
    footerHint: "enter {submitLabel} · esc 取消",
    defaultSubmitLabel: "重命名",
  },
  prompt: {
    fieldLabel: "输入",
    submitLabel: "提交",
  },
}
