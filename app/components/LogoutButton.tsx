"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Button from "./ui/Button";

export default function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    setLoading(true);
    setError("");

    const { error } = await supabase.auth.signOut();

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.replace("/login");
  }

  return (
    <div className="grid gap-2 justify-items-end">
      <Button onClick={logout} disabled={loading}>
        {loading ? "Déconnexion…" : "Se déconnecter"}
      </Button>

      {error && (
        <p className="text-sm text-destructive m-0">❌ {error}</p>
      )}
    </div>
  );
}