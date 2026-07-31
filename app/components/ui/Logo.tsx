type LogoProps = {
  className?: string;
};

export default function Logo({ className = "" }: LogoProps) {
  return (
    <div
      className={`text-2xl font-semibold tracking-tight select-none ${className}`}
    >
      Drimli
    </div>
  );
}
