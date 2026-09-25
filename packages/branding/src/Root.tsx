import { Composition } from "remotion"
import { BANNER } from "./banner/primitives"
import { BannerCaret } from "./BannerCaret"
import { BracketChip } from "./BracketChip"
import { BracketChipA2 } from "./BracketChipA2"
import { DemoNarrated, demoDurationInFrames } from "./demo/DemoNarrated"
import { DesktopFrame, FRAME as DESKTOP_FRAME } from "./demo/DesktopFrame"
import { DocsDetachSurvives } from "./docs/DocsDetachSurvives"
import { DocsFanOut } from "./docs/DocsFanOut"
import { DocsTaskModel } from "./docs/DocsTaskModel"
import { GlyphK } from "./GlyphK"
import { RoveLife } from "./life/RoveLife"
import { LIFE } from "./life/timeline"
import { FPS as MULTIREPO_FPS, MultiRepoCut, TOTAL_SECONDS as MULTIREPO_SECONDS } from "./multirepo/MultiRepoCut"
import { PaneGrid } from "./PaneGrid"
import { PromoDetach } from "./promo/PromoDetach"
import { PromoEngines } from "./promo/PromoEngines"
import { PromoPlugins } from "./promo/PromoPlugins"
import { PromoSocial } from "./promo/PromoSocial"
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
      {/* `bracket-chip` is the README banner slot: the composition behind it is
          whatever ships as `docs/assets/brand/bracket-chip.gif`. The two older
          directions stay registered so they remain renderable from source. */}
      <Composition
        id="bracket-chip"
        component={BannerCaret}
        durationInFrames={BANNER.durationInFrames}
        fps={BANNER.fps}
        width={BANNER.width}
        height={BANNER.height}
      />
      <Composition
        id="bracket-chip-vortex"
        component={BracketChipA2}
        durationInFrames={BANNER.durationInFrames}
        fps={BANNER.fps}
        width={BANNER.width}
        height={BANNER.height}
      />
      <Composition
        id="bracket-chip-original"
        component={BracketChip}
        durationInFrames={BANNER.durationInFrames}
        fps={BANNER.fps}
        width={BANNER.width}
        height={BANNER.height}
      />
      <Composition id="pane-grid" component={PaneGrid} durationInFrames={150} fps={30} width={1200} height={800} />
      <Composition id="task-streams" component={TaskStreams} durationInFrames={120} fps={30} width={1200} height={630} />
      <Composition id="glyph-k" component={GlyphK} durationInFrames={150} fps={30} width={800} height={800} />
      {/* Rove's history inked stroke by stroke, day 0 to the current release, with its score. */}
      <Composition id="rove-life" component={RoveLife} {...LIFE} />
      {/* The landing hero: three repos, three agents, detach and reattach. Cut
          from the real take `kobe-harness/e2e/hero-multirepo.ts` records. */}
      <Composition
        id="multirepo-cut"
        component={MultiRepoCut}
        durationInFrames={Math.round(MULTIREPO_SECONDS * MULTIREPO_FPS)}
        fps={MULTIREPO_FPS}
        width={1920}
        height={1080}
      />
      <Composition id="rove-life-cyanotype" component={RoveLife} {...LIFE} defaultProps={{ theme: "cyanotype" }} />
      <Composition id="docs-fan-out" component={DocsFanOut} durationInFrames={1} fps={30} width={1600} height={900} />
      <Composition id="docs-task-model" component={DocsTaskModel} durationInFrames={1} fps={30} width={1600} height={900} />
      <Composition id="docs-detach-survives" component={DocsDetachSurvives} durationInFrames={1} fps={30} width={1600} height={900} />
      <Composition id="promo-social" component={PromoSocial} durationInFrames={1} fps={30} width={1280} height={640} />
      <Composition id="promo-engines" component={PromoEngines} durationInFrames={1} fps={30} width={1600} height={900} />
      <Composition id="promo-plugins" component={PromoPlugins} durationInFrames={1} fps={30} width={1600} height={900} />
      <Composition id="promo-detach" component={PromoDetach} durationInFrames={1} fps={30} width={1600} height={900} />
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
