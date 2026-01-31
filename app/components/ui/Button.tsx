"use client";

import { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md";
};

export default function Button({
  variant = "primary",
  size = "md",
  disabled,
  className = "",
  children,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center select-none whitespace-nowrap " +
    "rounded-lg font-semibold transition " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 " +
    "disabled:opacity-60 disabled:cursor-not-allowed";

  const sizes = {
    sm: "h-9 px-3 text-sm",
    md: "h-10 px-4 text-sm",
  };

  const variants = {
    primary:
      "bg-primary text-primary-foreground border border-primary " +
      "hover:opacity-95 active:opacity-90",
    secondary:
      "bg-card text-foreground border border-border " +
      "hover:bg-muted active:bg-muted",
    danger:
      "bg-destructive text-destructive-foreground border border-destructive " +
      "hover:opacity-95 active:opacity-90",
  };

  return (
    <button
      {...props}
      disabled={disabled}
      className={[base, sizes[size], variants[variant], className].join(" ")}
    >
      {children}
    </button>
  );
}
