"use client";

export function SectionCard({
  title,
  subtitle,
  isMobile,
  headerRight,
  children,
}: {
  title: string;
  subtitle?: string;
  isMobile: boolean;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e8e6df",
        borderRadius: 10,
        padding: isMobile ? 16 : 24,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: subtitle ? 4 : 16,
          gap: 12,
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f", margin: 0 }}>{title}</h2>
        {headerRight}
      </div>
      {subtitle && (
        <p style={{ fontSize: 12, color: "#9494a0", margin: "0 0 16px 0" }}>{subtitle}</p>
      )}
      {children}
    </div>
  );
}
