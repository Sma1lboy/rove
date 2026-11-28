import React, { type ReactNode } from "react"

interface InspectorProps {
  readonly data: {
    readonly kind: string
    readonly title: string
    readonly branch?: string
    readonly engineName?: string
    readonly statusKind: string
    readonly diffStats?: { readonly added: number; readonly removed: number }
    readonly pr?: { readonly number: number; readonly state: string }
  }
  readonly defaultNode: ReactNode
}

export default function InspectorSection({ data, defaultNode }: InspectorProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div
        style={{
          margin: "8px",
          padding: "10px 12px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--line)",
          background: "var(--inset)",
          fontFamily: "var(--mono)",
          fontSize: "12px",
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "4px 12px",
        }}
      >
        <span style={{ color: "var(--subtle)" }}>SESSION</span>
        <span style={{ color: "var(--ink)", fontWeight: 600 }}>{data.title}</span>
        <span style={{ color: "var(--subtle)" }}>BRANCH</span>
        <span style={{ color: "var(--accent)" }}>{data.branch || "main"}</span>
        <span style={{ color: "var(--subtle)" }}>STATUS</span>
        <span style={{ color: "var(--success)" }}>{data.statusKind}</span>
        {data.diffStats && (
          <>
            <span style={{ color: "var(--subtle)" }}>DIFF</span>
            <span style={{ color: "var(--muted)" }}>
              +{data.diffStats.added} -{data.diffStats.removed}
            </span>
          </>
        )}
        {data.pr && (
          <>
            <span style={{ color: "var(--subtle)" }}>PR</span>
            <span style={{ color: "var(--info)" }}>
              #{data.pr.number} ({data.pr.state})
            </span>
          </>
        )}
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>{defaultNode}</div>
    </div>
  )
}
