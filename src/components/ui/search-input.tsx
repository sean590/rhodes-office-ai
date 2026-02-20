"use client";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchInput({ value, onChange, placeholder = "Search..." }: SearchInputProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "#ffffff", border: "1px solid #ddd9d0", borderRadius: 8 }}>
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#9494a0" strokeWidth="2">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ background: "none", border: "none", outline: "none", color: "#1a1a1f", fontSize: 13, fontFamily: "inherit", flex: 1, minWidth: 0 }}
      />
    </div>
  );
}
