import { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  className?: string;
};

export default function Card({ children, className = "" }: CardProps) {
  return (
    <div
      className={[
        "bg-card text-card-foreground border border-border rounded-lg p-6",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: CardProps) {
  return <div className={["mb-4", className].join(" ")}>{children}</div>;
}

export function CardTitle({ children, className = "" }: CardProps) {
  return (
    <h2
      className={[
        "text-lg font-medium leading-tight tracking-tight",
        className,
      ].join(" ")}
    >
      {children}
    </h2>
  );
}

export function CardDescription({ children, className = "" }: CardProps) {
  return (
    <p
      className={[
        "text-sm text-muted-foreground mt-1 leading-relaxed",
        className,
      ].join(" ")}
    >
      {children}
    </p>
  );
}

export function CardContent({ children, className = "" }: CardProps) {
  return <div className={className}>{children}</div>;
}

export function CardFooter({ children, className = "" }: CardProps) {
  return <div className={["mt-6", className].join(" ")}>{children}</div>;
}
