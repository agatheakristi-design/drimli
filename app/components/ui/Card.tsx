import { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  className?: string;
};

export default function Card({ children, className = "" }: CardProps) {
  return (
    <div className={["card", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: CardProps) {
  return (
    <div className={["card-header", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className = "" }: CardProps) {
  return (
    <h2 className={["card-title", className].filter(Boolean).join(" ")}>
      {children}
    </h2>
  );
}

export function CardDescription({ children, className = "" }: CardProps) {
  return (
    <p className={["card-description", className].filter(Boolean).join(" ")}>
      {children}
    </p>
  );
}

export function CardContent({ children, className = "" }: CardProps) {
  return (
    <div className={["card-content", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

export function CardFooter({ children, className = "" }: CardProps) {
  return (
    <div className={["card-footer", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
