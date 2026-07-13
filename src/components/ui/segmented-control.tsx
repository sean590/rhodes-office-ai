"use client";

/**
 * SegmentedControl — a pill-group toggle (e.g. Home's Needs you / Suggested /
 * Done lanes). New shared primitive on the UX-refresh tokens. Each option can
 * carry an optional count badge.
 */

import React from "react";

export interface SegmentOption {
  value: string;
  label: string;
  count?: number;
}

export function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: SegmentOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 3,
        background: "var(--hover)",
        border: "1px solid var(--line)",
        borderRadius: 10,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 13px",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              color: active ? "var(--ink)" : "var(--muted)",
              background: active ? "var(--card)" : "transparent",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
              transition: "background 0.12s",
            }}
          >
            {o.label}
            {o.count != null && o.count > 0 && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  minWidth: 16,
                  textAlign: "center",
                  padding: "1px 5px",
                  borderRadius: 999,
                  background: active ? "var(--green-50)" : "var(--line)",
                  color: active ? "var(--green)" : "var(--muted)",
                }}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
