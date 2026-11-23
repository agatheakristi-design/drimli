"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { LogOut } from "lucide-react";
import styles from "@/app/dashboard/components/dashboard.module.css";

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
    <div className={styles.signOut}>
      <button type="button" className={styles.navigationItem} onClick={logout} disabled={loading}>
        <LogOut className={styles.navigationIcon} aria-hidden="true" />
        <span>
          {loading ? "Déconnexion…" : "Se déconnecter"}
        </span>
      </button>

      {error && (
        <p className="text-sm text-destructive m-0">❌ {error}</p>
      )}
    </div>
  );
}