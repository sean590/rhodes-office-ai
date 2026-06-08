import { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, style, ...props }: CardProps) {
  return (
    <div
      {...props}
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius)",
        padding: 20,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
