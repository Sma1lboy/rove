/** @jsxImportSource @opentui/react */
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import type { AppearanceSetting, AppearanceSnapshot } from "../../../tui/component/settings-dialog/appearance"
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
  const folded = [
    { id: "ui", label: { glyphs: "▌●", initials: "▌● UI", hairline: "█" }[fold] },
    { id: "api", label: { glyphs: " ✓", initials: " ✓ API", hairline: "▎" }[fold] },
    { id: "review", label: { glyphs: " ○", initials: " ○ QA", hairline: "▎" }[fold] },
  ]
  const box = current.splitStyle === "box"
  const railActive = props.active === "tabRowHeight"
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
            border={box ? true : ["right"]}
            borderColor={railActive ? theme.focusAccent : theme.border}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={theme.backgroundPanel}
          >
            <text fg={railActive ? theme.focusAccent : theme.textMuted}>{t("settings.appearance.tasks")}</text>
            <text fg={theme.textMuted} wrapMode="none">
              demo / workspace
            </text>
            <text fg={theme.focusAccent} attributes={TextAttributes.BOLD} wrapMode="none">
              ▌ UI polish ●
            </text>
            {current.tabRowHeight === 2 && (
              <text fg={theme.textMuted} wrapMode="none">
                {" "}
                {t("settings.appearance.modelDetail")}
              </text>
            )}
            <text fg={theme.text} wrapMode="none">
              {" "}
              API tests ✓
            </text>
            {current.tabRowHeight === 2 && (
              <text fg={theme.textMuted} wrapMode="none">
                {" "}
                {t("settings.appearance.modelDetail")}
              </text>
            )}
            {!short && (
              <text fg={theme.textMuted} wrapMode="none">
                {" "}
                Review ○
              </text>
            )}
          </box>
        }
        <box
          flexGrow={5}
          flexBasis={0}
          flexShrink={1}
          flexDirection="column"
          border={box ? true : ["right"]}
          borderColor={theme.focusAccent}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={theme.focusAccent} attributes={TextAttributes.BOLD} wrapMode="none">
            ▌ {t("settings.appearance.terminal")}
          </text>
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
            border={box}
            borderColor={theme.border}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={theme.textMuted} wrapMode="none">
              {t("settings.appearance.files")}
            </text>
            <text fg={theme.text} wrapMode="none">
              ▾ src
            </text>
            <text fg={theme.success} wrapMode="none">
              {" "}
              app.ts +8
            </text>
            <text fg={theme.text} wrapMode="none">
              {" "}
              ui.tsx
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
