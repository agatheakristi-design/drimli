"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Button from "@/app/components/ui/Button";
import styles from "@/app/components/calendar/calendar.module.css";

type Names = { first_name: string; last_name: string };

export default function ProfileNameForm({ onSaved }: { onSaved: (fullName: string) => void }) {
  const [names, setNames] = useState<Names>({ first_name: "", last_name: "" });
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError || !auth.user) throw new Error("Session expirée. Veuillez vous reconnecter.");
        const { data, error } = await supabase.from("profiles")
          .select("first_name, last_name").eq("provider_id", auth.user.id).maybeSingle();
        if (error || !data) throw new Error("Impossible de charger votre profil.");
        if (!cancelled) {
          setNames({ first_name: data.first_name ?? "", last_name: data.last_name ?? "" });
          setLoadedUserId(auth.user.id);
        }
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "Impossible de charger votre profil.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || loading || !loadedUserId) return;
    const firstName = names.first_name.trim();
    const lastName = names.last_name.trim();
    if (!firstName || !lastName) {
      setStatus("Le prénom et le nom sont obligatoires.");
      return;
    }
    setSaving(true);
    setStatus("Enregistrement…");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user || auth.user.id !== loadedUserId) {
        throw new Error("Votre session a changé. Fermez puis rouvrez ce panneau.");
      }
      const fullName = `${firstName} ${lastName}`;
      const { data, error } = await supabase.from("profiles")
        .update({ first_name: firstName, last_name: lastName, full_name: fullName })
        .eq("provider_id", auth.user.id).select("provider_id").maybeSingle();
      if (error || data?.provider_id !== auth.user.id) throw new Error("Impossible d’enregistrer votre profil.");
      setNames({ first_name: firstName, last_name: lastName });
      onSaved(fullName);
      setStatus("Votre profil a été enregistré.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Impossible d’enregistrer votre profil.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.settingsSection} onSubmit={save}>
        {([["first_name", "Prénom"], ["last_name", "Nom"]] as const).map(([key, label]) => (
          <div key={key} className={styles.settingsField}>
            <label htmlFor={`profile-${key}`}>{label}</label>
            <input id={`profile-${key}`} required autoComplete={key === "first_name" ? "given-name" : "family-name"}
              value={names[key]} disabled={loading || saving || !loadedUserId}
              onChange={(event) => setNames((current) => ({ ...current, [key]: event.target.value }))} />
          </div>
        ))}
      <div className={styles.settingsActions}>
        <Button type="submit" disabled={loading || saving || !loadedUserId}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
      <p className={styles.settingsStatus} role="status" aria-live="polite">{loading ? "Chargement…" : status}</p>
    </form>
  );
}
