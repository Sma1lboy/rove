/**
 * `settings.search.*` — the Settings search: its field and result list, and
 * plain names for rows whose on-screen label carries a live value. Spread into
 * `./settings.ts`. `zh: typeof en` mirrors the English shape exactly.
 */

export const en = {
  search: {
    placeholder: "Search settings",
    noResults: "No setting matches.",
    nav: "↑/↓ pick · enter go to setting · esc back",
    soundVolume: "Chime volume",
    editorCustom: "Custom editor command",
    worktreeCustom: "Custom worktree location",
    scrollbackRows: "Scrollback rows",
    tabStrip: "Tab strip",
    hooksInstall: "Install missing engine hooks",
    hooksUninstall: "Remove engine hooks",
  },
}

export const zh: typeof en = {
  search: {
    placeholder: "搜索设置",
    noResults: "没有匹配的设置。",
    nav: "↑/↓ 选择 · enter 跳到该设置 · esc 返回",
    soundVolume: "提示音音量",
    editorCustom: "自定义编辑器命令",
    worktreeCustom: "自定义 worktree 位置",
    scrollbackRows: "回滚行数",
    tabStrip: "标签栏",
    hooksInstall: "安装缺失的引擎 hooks",
    hooksUninstall: "移除引擎 hooks",
  },
}
