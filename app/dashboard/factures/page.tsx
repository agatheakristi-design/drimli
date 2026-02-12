"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function fmtMoney(amount?: any, currency?: any) {
  if (amount === null || amount === undefined) return "—";
  const cur = typeof currency === "string" ? currency.toUpperCase() : "EUR";
  const value = typeof amount === "number" ? amount : Number(amount);
  if (Number.isNaN(value)) return "—";
  // Hypothèse: montant en centimes (si ce n'est pas le cas, on ajustera après)
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur }).format(value / 100);
}

type TryQuery = {
  filterCol?: string | null; // ex: provider_id
  orderCol?: string | null;  // ex: issued_at
};

export default function FacturesPage() {
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErrorText("");

      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;

      if (!user) {
        setErrorText("❌ Tu dois être connectée.");
        setLoading(false);
        return;
      }

      // On essaye plusieurs combinaisons, car le schéma peut varier :
      // - certaines tables ont provider_id / pro_id
      // - certaines ont issued_at / date / created_at, etc.
      const tries: TryQuery[] = [
        { filterCol: "provider_id", orderCol: "created_at" },
        { filterCol: "provider_id", orderCol: "issued_at" },
        { filterCol: "provider_id", orderCol: "date" },
        { filterCol: "provider_id", orderCol: "start_datetime" },
        { filterCol: "provider_id", orderCol: null },

        { filterCol: "pro_id", orderCol: "created_at" },
        { filterCol: "pro_id", orderCol: "issued_at" },
        { filterCol: "pro_id", orderCol: "date" },
        { filterCol: "pro_id", orderCol: null },

        // Fallback: sans filtre (au cas où la table n'a pas de colonne pro)
        { filterCol: null, orderCol: "issued_at" },
        { filterCol: null, orderCol: "date" },
        { filterCol: null, orderCol: "created_at" },
        { filterCol: null, orderCol: null },
      ];

      let lastErr: any = null;
      for (const t of tries) {
        let q = supabase.from("invoices").select("*").limit(50);

        if (t.filterCol) q = q.eq(t.filterCol, user.id);
        if (t.orderCol) q = q.order(t.orderCol, { ascending: false });

        const { data, error } = await q;

        if (!error) {
          setRows(data ?? []);
          setLoading(false);
          return;
        }

        lastErr = error;
        // si colonne inexistante, on tente juste la prochaine combinaison
        // (on ne spam pas l'utilisateur avec ces détails)
      }

      setErrorText("❌ Impossible de charger les factures : " + (lastErr?.message ?? "erreur inconnue"));
      setRows([]);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return <div className="py-10 text-sm text-muted-foreground">Chargement…</div>;
  }

  if (errorText) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-3xl font-black">Factures</h1>
        <Card>
          <p className="text-sm">{errorText}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-black">Factures</h1>
        <p className="text-muted-foreground">
          Liste de tes factures générées automatiquement après paiement.
        </p>
      </div>

      <Card>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune facture pour le moment.</p>
        ) : (
          <div className="space-y-4">
            {rows.map((inv) => {
              const id = inv.id ?? inv.invoice_id ?? "—";

              const createdAt =
                inv.created_at ??
                inv.issued_at ??
                inv.date ??
                inv.created ??
                inv.inserted_at ??
                null;

              const number =
                inv.number ??
                inv.invoice_number ??
                inv.sequence ??
                inv.invoice_no ??
                null;

              const client =
                inv.patient_email ??
                inv.customer_email ??
                inv.client_email ??
                inv.patient_name ??
                inv.customer_name ??
                null;

              const amount =
                inv.amount_total ??
                inv.total_amount ??
                inv.amount ??
                inv.total ??
                null;

              const currency = inv.currency ?? "EUR";

              const pdfUrl =
                inv.pdf_url ??
                inv.file_url ??
                inv.public_url ??
                inv.download_url ??
                inv.hosted_invoice_url ??
                null;

              return (
                <div
                  key={String(id)}
                  className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="font-semibold">
                      {number ? `Facture ${number}` : "Facture"}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {fmtDate(createdAt)}
                      {client ? ` • ${client}` : ""}
                      {amount !== null ? ` • ${fmtMoney(amount, currency)}` : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">ID : {String(id)}</div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {pdfUrl ? (
                      <Button onClick={() => window.open(String(pdfUrl), "_blank", "noopener,noreferrer")}>
                        Télécharger
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          navigator.clipboard.writeText(String(id)).catch(() => {});
                        }}
                      >
                        Copier l’ID
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <p className="text-xs text-muted-foreground">
        Si “Télécharger” n’apparaît pas, c’est que ta table ne stocke pas encore l’URL du PDF (ce n’est pas grave : on peut
        brancher le téléchargement ensuite sans doublons).
      </p>
    </div>
  );
}
