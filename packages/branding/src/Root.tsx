import { Composition } from "remotion"
import { BracketChip } from "./BracketChip"
import { BracketChipA2 } from "./BracketChipA2"
import { DemoNarrated, demoDurationInFrames } from "./demo/DemoNarrated"
import { DesktopFrame, FRAME as DESKTOP_FRAME } from "./demo/DesktopFrame"
import { DocsDetachSurvives } from "./docs/DocsDetachSurvives"
import { DocsFanOut } from "./docs/DocsFanOut"
import { DocsTaskModel } from "./docs/DocsTaskModel"
import { GlyphK } from "./GlyphK"
import { PaneGrid } from "./PaneGrid"
import { QuickLookReplay } from "./quicklook/QuickLookReplay"
import quicklookCapture from "./quicklook/frames.json"
import quicklookSpec from "./quicklook/quicklook.replay.json"
import { replayDurationSeconds } from "./quicklook/replay-spec"
import { TaskStreams } from "./TaskStreams"

/** Length of `public/demo/demo.mp4`, the capture the narration is timed to. */
const DEMO_CAPTURE_SECONDS = 13.75

export const RemotionRoot: React.FC = () => {
  const quicklookDuration = replayDurationSeconds(quicklookSpec, quicklookCapture)
  const quicklookSpeedCuts = quicklookSpec.delivery?.speedCuts ?? [1, 4]

  return (
    <>
      <Composition id="bracket-chip" component={BracketChipA2} durationInFrames={120} fps={30} width={1600} height={400} />
      <Composition id="bracket-chip-original" component={BracketChip} durationInFrames={120} fps={30} width={1600} height={400} />
      <Composition id="pane-grid" component={PaneGrid} durationInFrames={150} fps={30} width={1200} height={800} />
      <Composition id="task-streams" component={TaskStreams} durationInFrames={120} fps={30} width={1200} height={630} />
      <Composition id="glyph-k" component={GlyphK} durationInFrames={150} fps={30} width={800} height={800} />
      <Composition id="docs-fan-out" component={DocsFanOut} durationInFrames={1} fps={30} width={1600} height={900} />
      <Composition id="docs-task-model" component={DocsTaskModel} durationInFrames={1} fps={30} width={1600} height={900} />
      <Composition id="docs-detach-survives" component={DocsDetachSurvives} durationInFrames={1} fps={30} width={1600} height={900} />
      {/* The README screencast with narration. `captureSeconds` is the raw
          capture's length — re-shoot it and update this one number plus the
          beat timings in `DemoNarrated`. */}
      <Composition
        id="demo-narrated"
        component={DemoNarrated}
        durationInFrames={demoDurationInFrames(DEMO_CAPTURE_SECONDS, 24)}
        fps={24}
        width={1280}
        height={800}
        defaultProps={{ captureSeconds: DEMO_CAPTURE_SECONDS }}
      />
      {/* The same capture as a window on a desktop — see DesktopFrame for why
          this exists alongside the in-frame narration. */}
      <Composition
        id="demo-desktop"
        component={DesktopFrame}
        durationInFrames={Math.round(DEMO_CAPTURE_SECONDS * 24)}
        fps={24}
        width={DESKTOP_FRAME.width}
        height={DESKTOP_FRAME.height}
        defaultProps={{ captureSeconds: DEMO_CAPTURE_SECONDS }}
      />
      {quicklookSpeedCuts.map((speed) => (
        <Composition
          key={speed}
          id={speed === 1 ? "quicklook-replay" : `quicklook-replay-${speed}x`}
          component={QuickLookReplay}
          defaultProps={speed === 1 ? {} : { speed }}
          durationInFrames={Math.round((quicklookDuration / speed) * 30)}
          fps={30}
          width={quicklookSpec.viewport.width}
          height={quicklookSpec.viewport.height}
        />
      ))}
    </>
  )
}
