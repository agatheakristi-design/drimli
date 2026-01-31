"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

const DAYS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "Lundi" },
  { key: "tue", label: "Mardi" },
  { key: "wed", label: "Mercredi" },
  { key: "thu", label: "Jeudi" },
  { key: "fri", label: "Vendredi" },
  { key: "sat", label: "Samedi" },
  { key: "sun", label: "Dimanche" },
];

type Availability = {
  [key in DayKey]: { start: string; end: string } | null;
};

const DEFAULT_AVAILABILITY: Availability = {
  mon: { start: "09:00", end: "18:00" },
  tue: { start: "09:00", end: "18:00" },
  wed: { start: "09:00", end: "18:00" },
  thu: { start: "09:00", end: "18:00" },
  fri: { start: "09:00", end: "18:00" },
  sat: null,
  sun: null,
};

export default function DisponibilitesPage() {
  const [availability, setAvailability] = useState<Availability>(DEFAULT_AVAILABILITY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setStatus("❌ Tu dois être connectée.");
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("availability")
        .eq("provider_id", userData.user.id)
        .maybeSingle();

      if (data?.availability) {
        setAvailability(data.availability as Availability);
      }

      setLoading(false);
    })();
  }, []);

  async function saveAvailability() {
    setSaving(true);
    setStatus("");

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setStatus("❌ Non connectée.");
      setSaving(false);
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({ availability })
      .eq("provider_id", userData.user.id);

    if (error) {
      setStatus("❌ " + error.message);
    } else {
      setStatus("✅ Disponibilités enregistrées");
    }

    setSaving(false);
  }

  if (loading) {
    return <main style={{ padding: 24 }}>Chargement…</main>;
  }

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ fontSize: 28, fontWeight: 900 }}>Mes disponibilités</h1>

      <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
        {DAYS.map((day) => {
          const slot = availability[day.key];

          return (
            <div
              key={day.key}
              style={{
                display: "grid",
                gridTemplateColumns: "120px 1fr",
                alignItems: "center",
                gap: 12,
              }}
            >
              <strong>{day.label}</strong>

              {slot ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="time"
                    value={slot.start}
                    onChange={(e) =>
                      setAvailability({
                        ...availability,
                        [day.key]: { ...slot, start: e.target.value },
                      })
                    }
                  />
                  <span>–</span>
                  <input
                    type="time"
                    value={slot.end}
                    onChange={(e) =>
                      setAvailability({
                        ...availability,
                        [day.key]: { ...slot, end: e.target.value },
                      })
                    }
                  />
                  <button
                    onClick={() =>
                      setAvailability({ ...availability, [day.key]: null })
                    }
                  >
                    Fermé
                  </button>
                </div>
              ) : (
                <button
                  onClick={() =>
                    setAvailability({
                      ...availability,
                      [day.key]: { start: "09:00", end: "18:00" },
                    })
                  }
                >
                  Ouvrir
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={saveAvailability}
        disabled={saving}
        style={{
          marginTop: 24,
          padding: "14px 18px",
          borderRadius: 12,
          border: "none",
          backgroundColor: "#2563eb",
          color: "#fff",
          fontWeight: 800,
          cursor: "pointer",
        }}
      >
        {saving ? "Enregistrement…" : "Enregistrer mes disponibilités"}
      </button>

      {status && <p style={{ marginTop: 12 }}>{status}</p>}
    </main>
  );
}
