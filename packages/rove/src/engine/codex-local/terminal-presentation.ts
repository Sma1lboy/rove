import type {
  EngineTerminalPresentation,
  TerminalPresentationPalette,
  TerminalRgb,
  TerminalStyleRewrite,
} from "@/types/terminal-presentation"

const HEX_RE = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i

function parseHex(value: `#${string}`): TerminalRgb {
  const match = HEX_RE.exec(value)
  if (!match) return [0, 0, 0]
  return [
    Number.parseInt(match[1] as string, 16),
    Number.parseInt(match[2] as string, 16),
    Number.parseInt(match[3] as string, 16),
  ]
}

function luminance([red, green, blue]: TerminalRgb): number {
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255
}

function blend(from: TerminalRgb, to: TerminalRgb, amount: number): TerminalRgb {
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount),
  ]
}

function codexUserMessageBackground(background: TerminalRgb): TerminalRgb {
  return luminance(background) > 0.5 ? blend(background, [0, 0, 0], 0.04) : blend(background, [255, 255, 255], 0.12)
}

function transcriptRewrite(palette: TerminalPresentationPalette): TerminalStyleRewrite {
  const foreground = parseHex(palette.foreground)
  const background = parseHex(palette.background)
  const backgroundIsLight = luminance(background) > 0.5
  return {
    matchBackground: codexUserMessageBackground(background),
    foreground: backgroundIsLight ? foreground : background,
    background: backgroundIsLight ? background : foreground,
  }
}

/** Codex uses one adaptive style for both its composer and historical user messages. */
export const codexTerminalPresentation: EngineTerminalPresentation = {
  alternateScreenStyleRewrites: (palette) => [transcriptRewrite(palette)],
}
