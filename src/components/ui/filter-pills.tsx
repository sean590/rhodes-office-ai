"use client";

interface FilterPillsProps {
  options: { value: string; label: string; count?: number }[];
  selected: string;
  onChange: (value: string) => void;
}

export function FilterPills({ options, selected, onChange }: FilterPillsProps) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {options.map((opt) => {
        const active = selected === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              border: `1px solid ${active ? "#2d5a3d" : "#ddd9d0"}`,
              background: active ? "rgba(45,90,61,0.08)" : "transparent",
              color: active ? "#2d5a3d" : "#6b6b76",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span style={{ marginLeft: 5, fontSize: 11, color: "#9494a0" }}>({opt.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
