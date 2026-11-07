/** A file tab in the side panel: a markdown, image, SVG, PDF or HTML file opens rendered, with `[ source ]` for its diff or code; any other file, and `.`, is the diff view alone. */

import { useState } from "react"
import { ArtifactView } from "./artifact-view.tsx"
import { artifactKind } from "./artifact.ts"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { PreviewView } from "./preview-view.tsx"
import { useStore } from "./store.ts"
import type { Preview } from "./ui.ts"
import { Button } from "./ui/button.tsx"

export function PreviewHost(props: {
  model: AppModel
  view: Preview
  active: boolean
  restored: boolean
  onClose: () => void
}) {
  useLocale()
  const { model, view } = props
  const kind = view.path === "." ? null : artifactKind(view.path)
  // The path whose source is on screen: another file starts on its preview again.
  const [sourceOf, setSourceOf] = useState<string | null>(null)
  const payload = useStore(model.tasks)
  if (!kind) return <PreviewView {...props} />
  const source = sourceOf === view.path
  const changeKey = JSON.stringify(payload?.tasks.find((task) => task.id === view.taskId)?.changes ?? null)
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex gap-x-3 px-2.5 py-1">
        <Button variant="pill" hit="tight" aria-current={!source} onClick={() => setSourceOf(null)}>
          {`[ ${t("artifact.preview")} ]`}
        </Button>
        <Button variant="pill" hit="tight" aria-current={source} onClick={() => setSourceOf(view.path)}>
          {`[ ${t("artifact.source")} ]`}
        </Button>
      </div>
      {source ? (
        <PreviewView {...props} />
      ) : (
        <ArtifactView model={model} taskId={view.taskId} path={view.path} kind={kind} changeKey={changeKey} />
      )}
    </div>
  )
}
