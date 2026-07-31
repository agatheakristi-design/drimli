import { TextareaHTMLAttributes } from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement>;

export default function Textarea({
  className = "",
  ...props
}: Props) {
  return (
    <textarea
      {...props}
      className={["textarea", className].filter(Boolean).join(" ")}
    />
  );
}
