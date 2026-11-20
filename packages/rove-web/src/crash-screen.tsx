import { Component, type ErrorInfo, type ReactNode, useState } from "react"
import { crashLog } from "./crash-log.ts"
import { t } from "./i18n/index.ts"
import { Button } from "./ui/button.tsx"

type State = { error: Error | null; componentStack: string }

/** A render error unmounts the whole tree; show what threw, copyable, instead of an empty page. */
export class CrashBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, componentStack: "" }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(_error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? "" })
  }

  render() {
    const { error, componentStack } = this.state
    if (!error) return this.props.children
    const report = [`${error.message}\n${error.stack ?? ""}`, componentStack, crashLog()].filter(Boolean).join("\n\n")
    return <CrashScreen report={report} />
  }
}

function CrashScreen({ report }: { report: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () =>
    void navigator.clipboard.writeText(report).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-surface p-4 text-ink">
      <p className="font-sans text-title">{t("crash.title")}</p>
      <div className="flex gap-4">
        <Button variant="filled" onClick={copy}>
          {copied ? t("crash.copied") : t("crash.copy")}
        </Button>
        <Button variant="action" onClick={() => location.reload()}>
          {t("crash.reload")}
        </Button>
      </div>
      <pre className="min-h-0 flex-1 select-text overflow-auto whitespace-pre-wrap break-all font-mono text-meta text-muted">
        {report}
      </pre>
    </div>
  )
}
