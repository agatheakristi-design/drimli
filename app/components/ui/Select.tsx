import * as React from "react";

type Props = React.SelectHTMLAttributes<HTMLSelectElement>;

export default function Select({ className = "", ...props }: Props) {
  return (
    <select
      {...props}
      className={["select", className].filter(Boolean).join(" ")}
    />
  );
}
