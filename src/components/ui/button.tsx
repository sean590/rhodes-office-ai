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
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: isSmall ? "4px 10px" : isPrimary ? "8px 16px" : "5px 12px",
        background: isPrimary ? "#2d5a3d" : "#e8e6df",
        color: isPrimary ? "#fff" : "#1a1a1f",
        border: isPrimary ? "none" : "1px solid #ddd9d0",
        borderRadius: isPrimary ? 8 : 6,
        fontSize: isSmall ? 11 : isPrimary ? 13 : 12,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
