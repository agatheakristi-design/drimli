"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";

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

const DEFAULT_OPEN = { start: "07:00", end: "22:00" };
const DEFAULT_STANDARD = { start: "09:00", end: "18:00" };

const DEFAULT_AVAILABILITY: Availability = {
  mon: { ...DEFAULT_OPEN },
  tue: { ...DEFAULT_OPEN },
  wed: { ...DEFAULT_OPEN },
  thu: { ...DEFAULT_OPEN },
  fri: { ...DEFAULT_OPEN },
  sat: null,
  sun: null,
};

type BlockRow = {
  id: string;
  provider_id: string;
  start_datetime: string;
  end_datetime: string;
  reason: string | null;
  created_at: string;
};

function parisTodayYMD() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatParis(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function isValidYMD(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function isValidTimeRange(start: string, end: string) {
  return start && end && start < end;
}

export default function DisponibilitesPage() {
  const [availability, setAvailability] = useState<Availability>(DEFAULT_AVAILABILITY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const [providerId, setProviderId] = useState<string>("");

  // Blocages
  const todayParis = useMemo(() => parisTodayYMD(), []);
  const [blockDate, setBlockDate] = useState<string>(todayParis);
  const [blockStart, setBlockStart] = useState<string>("12:30");
  const [blockEnd, setBlockEnd] = useState<string>("14:00");
  const [blockReason, setBlockReason] = useState<string>("Pause / Indisponible");
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [blocksLoading, setBlocksLoading] = useState(false);
  const [blocksSaving, setBlocksSaving] = useState(false);
  const [blocksStatus, setBlocksStatus] = useState("");

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setStatus("❌ Tu dois être connectée.");
        setLoading(false);
        return;
      }

      setProviderId(userData.user.id);

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

  useEffect(() => {
    if (!providerId) return;
    (async () => {
      await loadBlocks(providerId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  async function loadBlocks(pid: string) {
    setBlocksLoading(true);
    setBlocksStatus("");

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("provider_blocks")
      .select("id, provider_id, start_datetime, end_datetime, reason, created_at")
      .eq("provider_id", pid)
      .gte("end_datetime", now)
      .order("start_datetime", { ascending: true })
      .limit(50);

    if (error) {
      setBlocksStatus("❌ " + error.message);
      setBlocks([]);
    } else {
      setBlocks((data as BlockRow[]) ?? []);
    }

    setBlocksLoading(false);
  }

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

    setStatus(error ? "❌ " + error.message : "✅ Disponibilités enregistrées");
    setSaving(false);
  }

  function setAllWeekdays(open: { start: string; end: string }) {
    setAvailability((prev) => ({
      ...prev,
      mon: { ...open },
      tue: { ...open },
      wed: { ...open },
      thu: { ...open },
      fri: { ...open },
    }));
  }

  async function addBlock(startTime: string, endTime: string, reasonOverride?: string) {
    setBlocksSaving(true);
    setBlocksStatus("");

    if (!providerId) {
      setBlocksStatus("❌ Non connectée.");
      setBlocksSaving(false);
      return;
    }

    if (!blockDate || !isValidYMD(blockDate)) {
      setBlocksStatus("❌ Date invalide.");
      setBlocksSaving(false);
      return;
    }

    // ✅ Interdire passé (Paris)
    const today = parisTodayYMD();
    if (blockDate < today) {
      setBlocksStatus("❌ Impossible de bloquer une date passée.");
      setBlocksSaving(false);
      return;
    }

    if (!isValidTimeRange(startTime, endTime)) {
      setBlocksStatus("❌ L’heure de fin doit être après l’heure de début.");
      setBlocksSaving(false);
      return;
    }

    // ✅ Empêcher les "journées bizarres" (ex: 22:00 → 01:00)
    // Ici on refuse simplement si end <= start (déjà fait) donc pas de cross-day.

    const startIso = new Date(`${blockDate}T${startTime}:00`).toISOString();
    const endIso = new Date(`${blockDate}T${endTime}:00`).toISOString();

    const { error } = await supabase.from("provider_blocks").insert({
      provider_id: providerId,
      start_datetime: startIso,
      end_datetime: endIso,
      reason: (reasonOverride ?? blockReason) || null,
    });

    if (error) {
      setBlocksStatus("❌ " + error.message);
    } else {
      setBlocksStatus("✅ Créneau bloqué");
      await loadBlocks(providerId);
    }

    setBlocksSaving(false);
  }

  async function deleteBlock(id: string) {
    setBlocksStatus("");
    const { error } = await supabase.from("provider_blocks").delete().eq("id", id);
    if (error) {
      setBlocksStatus("❌ " + error.message);
    } else {
      setBlocksStatus("✅ Blocage supprimé");
      await loadBlocks(providerId);
    }
  }

  if (loading) {
    return <div className="py-10 text-sm text-muted-foreground">Chargement…</div>;
  }

  return (
    <div className="max-w-2xl space-y-8">
      {/* Disponibilités hebdo */}
      <div className="space-y-2">
        <h1 className="text-3xl font-black">Agenda</h1>
        <p className="text-muted-foreground">
          Définis quand tu acceptes des rendez-vous. Tu peux aussi bloquer des créneaux (pause déjeuner, RDV téléphone…).
        </p>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="secondary" onClick={() => setAllWeekdays(DEFAULT_OPEN)}>
            Semaine large (07:00–22:00)
          </Button>
          <Button variant="secondary" onClick={() => setAllWeekdays(DEFAULT_STANDARD)}>
            Standard (09:00–18:00)
          </Button>
        </div>
      </div>

      <Card>
        <div className="space-y-4">
          {DAYS.map((day) => {
            const slot = availability[day.key];

            return (
              <div key={day.key} className="grid grid-cols-[120px_1fr] items-center gap-3">
                <div className="font-semibold">{day.label}</div>

                {slot ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      type="time"
                      value={slot.start}
                      onChange={(e) =>
                        setAvailability({
                          ...availability,
                          [day.key]: { ...slot, start: e.target.value },
                        })
                      }
                    />
                    <span className="text-muted-foreground">–</span>
                    <input
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      type="time"
                      value={slot.end}
                      onChange={(e) =>
                        setAvailability({
                          ...availability,
                          [day.key]: { ...slot, end: e.target.value },
                        })
                      }
                    />
                    <Button variant="secondary" onClick={() => setAvailability({ ...availability, [day.key]: null })}>
                      Fermé
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setAvailability({
                        ...availability,
                        [day.key]: { ...DEFAULT_OPEN },
                      })
                    }
                  >
                    Ouvrir
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Button onClick={saveAvailability} disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
          {status && <p className="text-sm text-muted-foreground">{status}</p>}
        </div>
      </Card>

      {/* Blocages */}
      <div className="space-y-2">
        <h2 className="text-xl font-black">Bloquer un créneau</h2>
        <p className="text-sm text-muted-foreground">
          Exemple : pause déjeuner, RDV téléphone, indisponibilité. Ces heures ne seront plus proposées aux clients.
        </p>
      </div>

      <Card>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <div className="text-sm font-semibold">Date</div>
              <input
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                type="date"
                value={blockDate}
                min={todayParis}
                onChange={(e) => setBlockDate(e.target.value)}
              />
            </label>

            <label className="space-y-1">
              <div className="text-sm font-semibold">Raison (optionnel)</div>
              <input
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                type="text"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                placeholder="Pause déjeuner / Indisponible"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <div className="text-sm font-semibold">De</div>
              <input
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                type="time"
                value={blockStart}
                onChange={(e) => setBlockStart(e.target.value)}
              />
            </label>

            <label className="space-y-1">
              <div className="text-sm font-semibold">À</div>
              <input
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                type="time"
                value={blockEnd}
                onChange={(e) => setBlockEnd(e.target.value)}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => addBlock(blockStart, blockEnd)} disabled={blocksSaving}>
              {blocksSaving ? "Ajout…" : "Bloquer"}
            </Button>

            <Button
              variant="secondary"
              onClick={() => addBlock(DEFAULT_OPEN.start, DEFAULT_OPEN.end, "Indisponible (journée)")}
              disabled={blocksSaving}
            >
              Bloquer la journée entière
            </Button>

            {blocksStatus && <p className="text-sm text-muted-foreground">{blocksStatus}</p>}
          </div>

          <p className="text-xs text-muted-foreground">
            Astuce : “Bloquer la journée entière” sert pour un déplacement, une urgence, une journée off.
          </p>
        </div>
      </Card>

      <div className="space-y-2">
        <h3 className="text-lg font-black">Mes blocages à venir</h3>
        <p className="text-sm text-muted-foreground">Tu peux les supprimer si tu changes d’avis.</p>
      </div>

      <Card>
        {blocksLoading ? (
          <div className="text-sm text-muted-foreground">Chargement…</div>
        ) : blocks.length === 0 ? (
          <div className="text-sm text-muted-foreground">Aucun blocage pour le moment.</div>
        ) : (
          <div className="space-y-3">
            {blocks.map((b) => (
              <div key={b.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="font-semibold">
                    {formatParis(b.start_datetime)} → {formatParis(b.end_datetime)}
                  </div>
                  {b.reason ? <div className="text-sm text-muted-foreground">{b.reason}</div> : null}
                </div>

                <Button variant="secondary" onClick={() => deleteBlock(b.id)}>
                  Supprimer
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
