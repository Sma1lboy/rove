/** @jsxImportSource @opentui/react */
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import type { AppearanceSetting, AppearanceSnapshot } from "../../../tui/component/settings-dialog/appearance"
import { taskColor } from "../../../tui/lib/task-color"
import { GLYPH_SETS } from "../../../tui/lib/glyphs"
import { diffInks } from "../../../tui/context/theme-core"
import { paneBoxProps, paneChrome } from "../../../tui/workspace/split-chrome"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { COLLAPSED_RAIL_WIDTH } from "../../panes/sidebar/collapsed-rail"

export function AppearancePreview(props: { current: AppearanceSnapshot; active?: AppearanceSetting }) {
  const { current } = props
  const theme = useTheme().preview(current)
  const t = useT()
  const narrow = useTerminalDimensions().width < 75
  const short = useTerminalDimensions().height < 30
  const fold = current.railFoldStyle
  const { unseen, done, idle } = GLYPH_SETS[current.glyphSet]
  const folded = [
    { id: "ui", label: { glyphs: `▌${unseen}`, initials: `▌${unseen} UI`, hairline: "█" }[fold] },
    { id: "api", label: { glyphs: ` ${done}`, initials: ` ${done} API`, hairline: "▎" }[fold] },
    { id: "review", label: { glyphs: ` ${idle}`, initials: ` ${idle} QA`, hairline: "▎" }[fold] },
  ]
  const railActive = props.active === "tabRowHeight"
  // Sample ids; the mark sits where the real rail's indent cell does.
  const marked = current.taskColors === "on"
  const mark = (id: string) => (marked ? <text fg={taskColor(`preview-${id}`, theme)}>▎</text> : null)
  const inks = diffInks(theme, current.colorblind === "on")
  // The three columns stand in for split panes, each after its left sibling.
  const pane = (divider: "left" | undefined, edge: typeof theme.border, name: string, nameInk: typeof theme.border) =>
    paneBoxProps(paneChrome(current.splitStyle, divider), { edge, name, nameInk })
  const namesOnRule = paneChrome(current.splitStyle, undefined).nameOnRule
  const tasksInk = railActive ? theme.focusAccent : theme.textMuted
  return (
    <box flexDirection="column" flexShrink={0} border borderColor={theme.border} backgroundColor={theme.background}>
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.backgroundPanel}
      >
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {t("settings.appearance.preview")}
        </text>
        <text fg={theme.textMuted} wrapMode="none">
          {current.themeName}
        </text>
      </box>
      <box flexDirection="row" flexGrow={1}>
        {/* The collapsed rail uses the real style's cell-width convention. */}
        <box
          width={COLLAPSED_RAIL_WIDTH[fold]}
          flexShrink={0}
          flexDirection="column"
          backgroundColor={theme.backgroundPanel}
        >
          <text fg={props.active === "railFold" ? theme.focusAccent : theme.textMuted}>‹</text>
          {folded.map((row, i) => (
            <text
              key={row.id}
              fg={i === 0 ? theme.focusAccent : i === 1 ? theme.success : theme.textMuted}
              wrapMode="none"
            >
              {row.label}
            </text>
          ))}
        </box>
        {
          <box
            flexGrow={2}
            flexBasis={0}
            flexShrink={1}
            flexDirection="column"
            {...pane(
              undefined,
              railActive ? theme.focusAccent : theme.border,
              t("settings.appearance.tasks"),
              tasksInk,
            )}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={theme.backgroundPanel}
          >
            {!namesOnRule && <text fg={tasksInk}>{t("settings.appearance.tasks")}</text>}
            <text fg={theme.textMuted} wrapMode="none">
              demo / workspace
            </text>
            <box flexDirection="row">
              <text fg={theme.focusAccent} attributes={TextAttributes.BOLD} wrapMode="none">
                {marked ? "▌" : "▌ "}
              </text>
              {mark("ui")}
              <text fg={theme.focusAccent} attributes={TextAttributes.BOLD} wrapMode="none">
                UI polish {unseen}
              </text>
            </box>
            {current.tabRowHeight === 2 && (
              <text fg={theme.textMuted} wrapMode="none">
                {" "}
                {t("settings.appearance.modelDetail")}
              </text>
            )}
            <box flexDirection="row">
              <text wrapMode="none"> </text>
              {mark("api")}
              <text fg={theme.text} wrapMode="none">
                API tests {done}
              </text>
            </box>
            {current.tabRowHeight === 2 && (
              <text fg={theme.textMuted} wrapMode="none">
                {" "}
                {t("settings.appearance.modelDetail")}
              </text>
            )}
            {!short && (
              <box flexDirection="row">
                <text wrapMode="none"> </text>
                {mark("review")}
                <text fg={theme.textMuted} wrapMode="none">
                  Review {idle}
                </text>
              </box>
            )}
          </box>
        }
        <box
          flexGrow={5}
          flexBasis={0}
          flexShrink={1}
          flexDirection="column"
          {...pane("left", theme.focusAccent, t("settings.appearance.terminal"), theme.focusAccent)}
          paddingLeft={1}
          paddingRight={1}
        >
          {!namesOnRule && (
            <text fg={theme.focusAccent} attributes={TextAttributes.BOLD} wrapMode="none">
              ▌ {t("settings.appearance.terminal")}
            </text>
          )}
          <text fg={theme.textMuted} wrapMode="none">
            UI polish / main
          </text>
          {!short && (
            <text fg={theme.text} wrapMode="none">
              $ bun test
            </text>
          )}
          <text fg={theme.success} wrapMode="none">
            ✓ {t("settings.appearance.testsPassed")}
          </text>
          {!short && (
            <text fg={theme.textMuted} wrapMode="none">
              2 pass · 0 fail
            </text>
          )}
          <text fg={theme.text} wrapMode="none">
            $ ▌
          </text>
          {current.tabRowHeight === 2 && !narrow && <text> </text>}
        </box>
        {!narrow && (
          <box
            flexGrow={2}
            flexBasis={0}
            flexShrink={1}
            flexDirection="column"
            {...pane("left", theme.border, t("settings.appearance.files"), theme.textMuted)}
            paddingLeft={1}
            paddingRight={1}
          >
            {!namesOnRule && (
              <text fg={theme.textMuted} wrapMode="none">
                {t("settings.appearance.files")}
              </text>
            )}
            <text fg={theme.text} wrapMode="none">
              ▾ src
            </text>
            <text fg={inks.added} wrapMode="none">
              {" "}
              app.ts +8
            </text>
            <text fg={inks.removed} wrapMode="none">
              {" "}
              ui.tsx −3
            </text>
            {!short && (
              <text fg={theme.textMuted} wrapMode="none">
                {" "}
                README.md
              </text>
            )}
          </box>
        )}
      </box>
      <text
        fg={theme.textMuted}
        bg={theme.backgroundPanel}
        wrapMode="none"
      >{` ● main   ${t(current.transparentBackground ? "settings.appearance.transparent" : "settings.appearance.opaque")}`}</text>
    </box>
  )
}
