"use client";

import { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
}

export function Button({ children, variant = "secondary", size = "md", className: _className, style, ...props }: ButtonProps) {
  const isPrimary = variant === "primary";
  const isSmall = size === "sm";
  return (
    <button
      {...props}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: isSmall ? "6px 11px" : "8px 14px",
        background: isPrimary ? "var(--green)" : "var(--card)",
        color: isPrimary ? "#fff" : "var(--ink)",
        border: `1px solid ${isPrimary ? "var(--green)" : "var(--line-2)"}`,
        borderRadius: isSmall ? 8 : 9,
        fontSize: isSmall ? 12.5 : 13,
        fontWeight: 500,
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
