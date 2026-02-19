import { ReactNode } from "react";

export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <h3 style={{ fontSize: 13, fontWeight: 600, color: "#6b6b76", margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
      {children}
    </h3>
  );
}
