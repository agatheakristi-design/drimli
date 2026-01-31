"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Container from "@/app/components/ui/Container";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";
import LogoutButton from "@/app/components/LogoutButton";

type AppointmentRow = {
  id: string;
  access_token: string;
  provider_id: string;
  product_id: string | null;
  start_datetime: string;
  end_datetime: string;
  status: string | null;
  created_at?: string | null;
};

type ProductRow = {
  id: string;
  title: string | null;
};

function formatParis(dtIso: string) {
  const d = new Date(dtIso);
  const date = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(d);

  const time = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);

  return { date, time };
}

export default function RendezVousPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [serviceTitles, setServiceTitles] = useState<Record<string, string>>({});
  const [providerId, setProviderId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function loadServiceTitles(productIds: string[]) {
    if (productIds.length === 0) return;

    const unique = Array.from(new Set(productIds)).filter(Boolean);
    const { data, error } = await supabase
      .from("products")
      .select("id, title")
      .in("id", unique);

    if (error) return;

    const map: Record<string, string> = {};
    (data as ProductRow[]).forEach((p) => {
      map[p.id] = p.title ?? "Service";
    });

    setServiceTitles(map);
  }

  async function loadAppointments(uid: string) {
    setStatus("");

    const { data, error } = await supabase
      .from("appointments")
      .select("id, access_token, provider_id, product_id, start_datetime, end_datetime, status, created_at")
      .eq("provider_id", uid)
      .eq("status", "confirmed")
      .gte("start_datetime", new Date().toISOString())
      .order("start_datetime", { ascending: true });

    if (error) {
      setStatus("❌ Erreur chargement : " + error.message);
      return;
    }

    const list = (data ?? []) as AppointmentRow[];
    setRows(list);

    const ids = list.map((a) => a.product_id || "").filter(Boolean);
    await loadServiceTitles(ids);
  }

  async function cancelAppointment(apptId: string) {
    if (!providerId) {
      setStatus("❌ Tu dois être connectée.");
      return;
    }

    const ok = window.confirm("Annuler ce rendez-vous ? (le créneau redeviendra disponible)");
    if (!ok) return;

    setCancellingId(apptId);
    setStatus("");

    const { error } = await supabase
      .from("appointments")
      .update({ status: "cancelled_by_provider" })
      .eq("id", apptId)
      .eq("provider_id", providerId);

    setCancellingId(null);

    if (error) {
      setStatus("❌ Erreur annulation : " + error.message);
      return;
    }

    setStatus("✅ Rendez-vous annulé");
    await loadAppointments(providerId);
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setStatus("");

      const { data, error } = await supabase.auth.getSession();
      if (cancelled) return;

      if (error || !data.session?.user) {
        setStatus("❌ Tu dois être connectée.");
        setLoading(false);
        return;
      }

      const uid = data.session.user.id;
      setProviderId(uid);
      await loadAppointments(uid);

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <Container>
        <Card>
          <p>Chargement…</p>
        </Card>
      </Container>
    );
  }

  return (
    <Container>
      <div className="flex justify-end">
        <LogoutButton />
      </div>

      <div className="mt-4">
        <h1 className="text-2xl font-black">Rendez-vous confirmés</h1>
        <p className="text-muted-foreground">
          Voici vos rendez-vous validés (paiement confirmé).
        </p>
      </div>

      {status ? (
        <div className="mt-4">
          <Card>
            <p>{status}</p>
          </Card>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="mt-6">
          <Card>
            <div className="space-y-3">
              <h2 className="text-lg font-extrabold">Aucun rendez-vous pour l’instant</h2>
              <p className="text-muted-foreground">
                Dès qu’un patient paie et confirme, le rendez-vous apparaîtra ici.
              </p>
              <Button variant="secondary" onClick={() => providerId && loadAppointments(providerId)}>
                Rafraîchir
              </Button>
            </div>
          </Card>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {rows.map((a) => {
            const start = formatParis(a.start_datetime);
            const end = formatParis(a.end_datetime);
            const title = a.product_id ? serviceTitles[a.product_id] : "Service";

            const isCancelling = cancellingId === a.id;

            return (
              <Card key={a.id}>
                <div className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-extrabold">{title || "Service"}</div>
                      <div className="text-sm text-muted-foreground">
                        {start.date} — {start.time} → {end.time} (Paris)
                      </div>
                    </div>

                    <span className="text-sm font-semibold">✅ Confirmé</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => router.push(`/attente/${a.access_token}`)}
                      disabled={isCancelling || !a.access_token}
                    >
                      Rejoindre
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => cancelAppointment(a.id)}
                      disabled={isCancelling}
                    >
                      {isCancelling ? "Annulation…" : "Annuler"}
                    </Button>

                    <Button
                      variant="secondary"
                      onClick={() => providerId && loadAppointments(providerId)}
                      disabled={isCancelling}
                    >
                      Rafraîchir
                    </Button>
                  </div>

                  <div className="text-xs text-muted-foreground">ID : {a.id}</div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Container>
  );
}
