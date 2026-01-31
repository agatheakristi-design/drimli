"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function NouveauServiceRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/services");
  }, [router]);

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <p>Redirection…</p>
    </main>
  );
}
