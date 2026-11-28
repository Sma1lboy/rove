import React from "react"

interface StatusStripProps {
  readonly data: {
    readonly connection: string
    readonly taskTitle?: string
    readonly branch?: string
    readonly engineName?: string
  }
}

export default function StatusStrip({ data }: StatusStripProps) {
  return (
    <footer
      style={{
        gridColumn: "1 / -1",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "4px 12px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--line)",
        background: "var(--surface)",
        fontFamily: "var(--mono)",
        fontSize: "12px",
        color: "var(--muted)",
      }}
    >
      <span style={{ color: "var(--accent)", fontWeight: 600 }}>TICKET CARDS</span>
      <span style={{ color: "var(--ink)" }}>{data.taskTitle || "No active session"}</span>
      {data.branch && <span>{data.branch}</span>}
      {data.engineName && <span>{data.engineName}</span>}
      <span style={{ marginLeft: "auto" }}>link: {data.connection}</span>
    </footer>
  )
}
