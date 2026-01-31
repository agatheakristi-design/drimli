"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function CreerMotDePassePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        // Il faut être connecté(e) pour définir un mot de passe
        router.replace("/login");
        return;
      }
      if (!cancelled) setChecking(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function savePassword() {
    setMsg("");

    if (password.length < 8) {
      setMsg("❌ Mot de passe trop court (minimum 8 caractères).");
      return;
    }
    if (password !== password2) {
      setMsg("❌ Les deux mots de passe ne sont pas identiques.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setMsg("❌ " + error.message);
      setLoading(false);
      return;
    }

    setMsg("✅ Mot de passe enregistré.");
    setLoading(false);

    // retour vers ton espace
    setTimeout(() => router.replace("/dashboard"), 700);
  }

  if (checking) {
    return (
      <main style={{ padding: 24, maxWidth: 520, margin: "0 auto" }}>
        <p>Chargement…</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, maxWidth: 520, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 900 }}>Créer un mot de passe</h1>
      <p style={{ marginTop: 8, opacity: 0.8 }}>
        Tu pourras ensuite te connecter avec ton email + ton mot de passe (sans lien magique).
      </p>

      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        <input
          type="password"
          placeholder="Nouveau mot de passe (min 8 caractères)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: 12, borderRadius: 8, border: "1px solid #ddd" }}
        />

        <input
          type="password"
          placeholder="Confirmer le mot de passe"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
          style={{ padding: 12, borderRadius: 8, border: "1px solid #ddd" }}
        />

        <button
          onClick={savePassword}
          disabled={loading}
          style={{ padding: 12, fontWeight: 800, borderRadius: 10, border: "none" }}
        >
          {loading ? "Enregistrement…" : "Enregistrer mon mot de passe"}
        </button>
      </div>
    </main>
  );
}