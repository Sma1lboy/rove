import React from "react"

interface TicketRowProps {
  readonly data: {
    readonly id: string
    readonly title: string
    readonly branch?: string
    readonly engineName?: string
    readonly engineColor?: string
    readonly statusLabel: string
    readonly selected: boolean
    readonly pr?: { readonly number: number; readonly state: string }
    readonly onSelect: () => void
  }
}

export default function TicketRow({ data }: TicketRowProps) {
  const accent = data.engineColor || "var(--accent)"
  const bg = data.selected
    ? `color-mix(in srgb, ${accent} 24%, var(--surface))`
    : `color-mix(in srgb, ${accent} 10%, var(--surface))`

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={data.onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") data.onSelect()
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        padding: "8px 10px",
        marginBottom: "6px",
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${data.selected ? accent : "var(--line)"}`,
        background: bg,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
        <span
          style={{
            fontWeight: 600,
            fontSize: "13px",
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {data.title}
        </span>
        {data.pr && (
          <span
            style={{
              fontSize: "10px",
              fontFamily: "var(--mono)",
              padding: "1px 6px",
              borderRadius: "999px",
              background: accent,
              color: "var(--paper)",
              fontWeight: 700,
            }}
          >
            #{data.pr.number}
          </span>
        )}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "11px",
          fontFamily: "var(--mono)",
          color: "var(--muted)",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {data.branch || "main"}
        </span>
        <span>·</span>
        <span>{data.engineName || "shell"}</span>
        <span style={{ marginLeft: "auto" }}>{data.statusLabel}</span>
      </div>
    </div>
  )
}
