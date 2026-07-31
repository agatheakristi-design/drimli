import { InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement>;

export default function Input({
  className = "",
  ...props
}: Props) {
  return (
    <input
      {...props}
      className={["input", className].join(" ")}
    />
  );
}
