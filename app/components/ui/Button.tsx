"use client";

import Link from "next/link";
import { ButtonHTMLAttributes } from "react";

type BaseProps = {
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md";
  className?: string;
  children: React.ReactNode;
};

type ButtonProps = BaseProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: never;
  };

type LinkProps = BaseProps & {
  href: string;
};

type Props = ButtonProps | LinkProps;

export default function Button(props: Props) {
  const {
    variant = "primary",
    size = "md",
    className = "",
    children,
  } = props;

  const classes = [
    "btn",
    `btn-${size}`,
    `btn-${variant}`,
    className,
  ].join(" ");

  if ("href" in props && typeof props.href === "string") {
    return (
      <Link href={props.href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button
      {...props}
      className={classes}
    >
      {children}
    </button>
  );
}
