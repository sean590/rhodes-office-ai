import { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, style, ...props }: CardProps) {
  return (
    <div
      {...props}
      style={{
        background: "#ffffff",
        border: "1px solid #e8e6df",
        borderRadius: 12,
        padding: 22,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
