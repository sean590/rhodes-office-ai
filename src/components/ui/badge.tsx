interface BadgeProps {
  label: string;
  color: string;
  bg: string;
}

export function Badge({ label, color, bg }: BadgeProps) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 6, background: bg, color }}>
      {label}
    </span>
  );
}
