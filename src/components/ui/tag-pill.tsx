"use client";

interface TagPillProps {
  label: string;
  onRemove?: () => void;
  color?: string;
  textColor?: string;
  onClick?: () => void;
}

export function TagPill({ label, onRemove, color, textColor, onClick }: TagPillProps) {
  return (
    <span
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 12,
        fontWeight: 500,
        padding: "3px 10px",
        borderRadius: 6,
        background: color || "#e8e6df",
        color: textColor || "#1a1a1f",
        cursor: onClick ? "pointer" : onRemove ? "default" : "default",
      }}
    >
      {label}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#9494a0", padding: 0, display: "flex", fontSize: 10, lineHeight: 1 }}
        >
          <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </span>
  );
}
