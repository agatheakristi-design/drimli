type LogoProps = {
  className?: string;
};

export default function Logo({ className = "" }: LogoProps) {
  return <Image src="/drimli-logo.png" width="238" height="83" alt="Drimli" className={className} priority />;
}
import Image from "next/image";
