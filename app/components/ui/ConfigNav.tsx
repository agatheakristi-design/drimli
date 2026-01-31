"use client";

import { useRouter } from "next/navigation";
import Button from "@/app/components/ui/Button";

type Item = {
  label: string;
  href: string;
};

export default function ConfigNav({ items }: { items: Item[] }) {
  const router = useRouter();

  return (
    <div className="config-nav">
      {items.map((it) => (
        <Button key={it.href} variant="secondary" onClick={() => router.push(it.href)}>
          {it.label}
        </Button>
      ))}
    </div>
  );
}
