interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}

export function StatCard({ label, value, sub, color }: StatCardProps) {
  return (
    <div style={{ background: "#ffffff", border: "1px solid #e8e6df", borderRadius: 12, padding: "16px 20px" }}>
      <div style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, fontFamily: "'DM Mono', monospace", color: color || "#1a1a1f" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: "#9494a0", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
