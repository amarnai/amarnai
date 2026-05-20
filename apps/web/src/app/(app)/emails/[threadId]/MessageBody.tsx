"use client";

import { useState } from "react";

const PREVIEW_LENGTH = 300;

export function MessageBody({ bodyText }: { bodyText: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = bodyText.length > PREVIEW_LENGTH;

  return (
    <div style={{ marginTop: "10px" }}>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: 13,
          lineHeight: 1.6,
          color: "var(--color-text-primary)",
          margin: 0,
        }}
      >
        {expanded || !isLong ? bodyText : bodyText.slice(0, PREVIEW_LENGTH) + "…"}
      </pre>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            marginTop: "8px",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontSize: 12,
            color: "var(--color-text-secondary)",
            textDecoration: "underline",
          }}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
