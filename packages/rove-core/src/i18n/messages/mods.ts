/**
 * `mods.*` messages — the rail's Mods page, where every open mod pane draws.
 * English is the source of truth; `zh: typeof en` keeps the shapes locked.
 */

export const en = {
  title: "Mods",
  empty: "No mod is drawing anything.",
  emptyHint: "A plugin with a [mod] entry draws its panes here, in the TUI and the web alike.",
  keys: "↑↓/tab move · enter press · esc back",
  pressFailed: "{plugin}: the press did not reach the mod ({reason})",
}

export const zh: typeof en = {
  title: "Mods",
  empty: "当前没有 mod 在绘制内容。",
  emptyHint: "声明了 [mod] 的插件会在这里绘制面板，TUI 和 web 显示的是同一份。",
  keys: "↑↓/tab 移动 · enter 按下 · esc 返回",
  pressFailed: "{plugin}：按键没有送达 mod（{reason}）",
}
