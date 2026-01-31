"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import LogoutButton from "@/app/components/LogoutButton";

type Range = { start: string; end: string };
type Availability = {
  timezone: string;
  slot_minutes: number;
  week: Record<string, Range[]>;
  exceptions: any[];
};

const DAYS: { key: keyof Availability["week"]; label: string }[] = [
  { key: "mon", label: "Lundi" },
  { key: "tue", label: "Mardi" },
  { key: "wed", label: "Mercredi" },
  { key: "thu", label: "Jeudi" },
  { key: "fri", label: "Vendredi" },
  { key: "sat", label: "Samedi" },
  { key: "sun", label: "Dimanche" },
];

function defaultAvailability(): Availability {
  return {
    timezone: "Europe/Paris",
    slot_minutes: 30,
    week: {
      mon: [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "18:00" }],
      tue: [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "18:00" }],
      wed: [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "18:00" }],
      thu: [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "18:00" }],
      fri: [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "18:00" }],
      sat: [],
      sun: [],
    },
    exceptions: [],
  };
}

export default function DisponibilitesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Availability>(defaultAvailability());

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setStatus("");

      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;

      if (!session) {
        setStatus("❌ Tu dois etre connectee.");
        setLoading(false);
        return;
      }

      const uid = session.user.id;
      if (!cancelled) setUserId(uid);

      const { data, error } = await supabase
        .from("profiles")
        .select("availability")
        .eq("provider_id", uid)
        .maybeSingle<{ availability: Availability | null }>();

      if (cancelled) return;

      if (error) {
        setStatus("❌ Erreur chargement: " + error.message);
        setLoading(false);
        return;
      }

      const av = data?.availability ?? null;
      setAvailability(av ?? defaultAvailability());
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function updateRange(dayKey: string, idx: number, field: "start" | "end", value: string) {
    setAvailability((prev) => {
      const next = { ...prev, week: { ...prev.week } };
      const arr = [...(next.week[dayKey] ?? [])];
      const r = { ...(arr[idx] ?? { start: "09:00", end: "12:00" }) };
      r[field] = value;
      arr[idx] = r;
      next.week[dayKey] = arr;
      return next;
    });
  }

  function addRange(dayKey: string) {
    setAvailability((prev) => {
      const next = { ...prev, week: { ...prev.week } };
      const arr = [...(next.week[dayKey] ?? [])];
      arr.push({ start: "09:00", end: "12:00" });
      next.week[dayKey] = arr;
      return next;
    });
  }

  function removeRange(dayKey: string, idx: number) {
    setAvailability((prev) => {
      const next = { ...prev, week: { ...prev.week } };
      const arr = [...(next.week[dayKey] ?? [])];
      arr.splice(idx, 1);
      next.week[dayKey] = arr;
      return next;
    });
  }

  async function save() {
    setStatus("");

    if (!userId) {
      setStatus("❌ Tu dois etre connectee.");
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from("profiles")
      .update({ availability })
      .eq("provider_id", userId);

    setSaving(false);

    if (error) {
      setStatus("❌ Erreur sauvegarde: " + error.message);
      return;
    }

    setStatus("✅ Disponibilites enregistrees.");
  }

  if (loading) return <main style={{ padding: 24 }}>Chargement...</main>;

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <LogoutButton />
      </div>

      <h1 style={{ fontSize: 32, fontWeight: 900 }}>Mes disponibilites</h1>
      <p style={{ marginTop: 8, opacity: 0.85 }}>
        Choisis tes horaires. Les patients ne pourront reserver que sur ces creneaux.
      </p>

      <section style={{ marginTop: 18, border: "1px solid #eee", borderRadius: 14, padding: 16 }}>
        <label style={{ display: "grid", gap: 6, maxWidth: 320 }}>
          <span style={{ fontWeight: 800 }}>Duree des creneaux</span>
          <select
            value={availability.slot_minutes}
            onChange={(e) =>
              setAvailability((prev) => ({ ...prev, slot_minutes: Number(e.target.value) }))
            }
            style={{ padding: 12, borderRadius: 10, border: "1px solid #ddd" }}
          >
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={45}>45 min</option>
            <option value={60}>60 min</option>
          </select>
        </label>

        <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
          {DAYS.map((d) => {
            const ranges = availability.week[d.key] ?? [];
            return (
              <div key={d.key} style={{ borderTop: "1px solid #f2f2f2", paddingTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h3 style={{ margin: 0 }}>{d.label}</h3>
                  <button
                    onClick={() => addRange(d.key)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: "1px solid #ddd",
                      background: "transparent",
                      cursor: "pointer",
                      fontWeight: 800,
                    }}
                  >
                    + Ajouter
                  </button>
                </div>

                {ranges.length === 0 ? (
                  <p style={{ marginTop: 8, opacity: 0.75 }}>Indisponible</p>
                ) : (
                  <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                    {ranges.map((r, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr auto",
                          gap: 10,
                          alignItems: "center",
                          maxWidth: 520,
                        }}
                      >
                        <input
                          type="time"
                          value={r.start}
                          onChange={(e) => updateRange(d.key, idx, "start", e.target.value)}
                          style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
                        />
                        <input
                          type="time"
                          value={r.end}
                          onChange={(e) => updateRange(d.key, idx, "end", e.target.value)}
                          style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
                        />
                        <button
                          onClick={() => removeRange(d.key, idx)}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 10,
                            border: "1px solid #ddd",
                            background: "transparent",
                            cursor: "pointer",
                            fontWeight: 800,
                          }}
                        >
                          Supprimer
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 18, display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={save}
            disabled={saving}
            style={{
              padding: "12px 16px",
              borderRadius: 12,
              border: "none",
              background: "#2563eb",
              color: "#fff",
              fontWeight: 900,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
          {status ? <p style={{ margin: 0 }}>{status}</p> : null}
        </div>
      </section>
    </main>
  );
}