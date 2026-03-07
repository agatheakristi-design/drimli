"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Container from "@/app/components/ui/Container";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";
import { useRouter } from "next/navigation";

type Product = {
  id: string;
  provider_id: string;
  title: string | null;
  description: string | null;
  duration_minutes: number | null;
  price_cents: number | null;
  active: boolean | null;
  created_at?: string | null;
};

type Availability = {
  mon: { start: string; end: string } | null;
  tue: { start: string; end: string } | null;
  wed: { start: string; end: string } | null;
  thu: { start: string; end: string } | null;
  fri: { start: string; end: string } | null;
  sat: { start: string; end: string } | null;
  sun: { start: string; end: string } | null;
};

const DEFAULT_STANDARD_AVAILABILITY: Availability = {
  mon: { start: "09:00", end: "18:00" },
  tue: { start: "09:00", end: "18:00" },
  wed: { start: "09:00", end: "18:00" },
  thu: { start: "09:00", end: "18:00" },
  fri: { start: "09:00", end: "18:00" },
  sat: null,
  sun: null,
};

export default function ServicesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [isOnboarding, setIsOnboarding] = useState(true);
  const router = useRouter();

  const [form, setForm] = useState({
    title: "",
    description: "",
    duration_minutes: 60,
    price_euros: 60,
  });

  async function loadProducts(uid: string) {
    const { data, error } = await supabase
      .from("products")
      .select("id, provider_id, title, description, duration_minutes, price_cents, active, created_at")
      .eq("provider_id", uid)
      .order("created_at", { ascending: false });

    if (error) {
      setStatus("❌ Erreur chargement : " + error.message);
      return [];
    }

    const rows = (data ?? []) as Product[];
    setProducts(rows);
    return rows;
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        const uid = data.session?.user?.id;

        if (cancelled) return;

        if (error || !uid) {
          setLoading(false);
          return;
        }

        setUserId(uid);
        const rows = await loadProducts(uid);

        if (cancelled) return;

        const onboarding = rows.length === 0;
        setIsOnboarding(onboarding);
        setShowForm(onboarding ? true : false);
        setLoading(false);
      } catch (e: any) {
        if (!cancelled) {
          setStatus("❌ Erreur inattendue : " + (e?.message || "unknown"));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function resetForm() {
    setEditingId(null);
    setForm({ title: "", description: "", duration_minutes: 60, price_euros: 60 });
  }

  function startEdit(p: Product) {
    setEditingId(p.id);
    setShowForm(true);
    setForm({
      title: p.title ?? "",
      description: p.description ?? "",
      duration_minutes: p.duration_minutes ?? 60,
      price_euros: p.price_cents != null ? p.price_cents / 100 : 60,
    });

    setTimeout(() => {
      document.getElementById("service-title")?.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 50);
  }

  async function ensureDefaultAvailability(uid: string) {
    const { data, error } = await supabase
      .from("profiles")
      .select("availability")
      .eq("provider_id", uid)
      .maybeSingle();

    if (error) return;

    const currentAvailability = data?.availability as Availability | null | undefined;

    if (!currentAvailability) {
      await supabase
        .from("profiles")
        .update({ availability: DEFAULT_STANDARD_AVAILABILITY })
        .eq("provider_id", uid);
    }
  }

  async function save() {
    setStatus("");

    let uid = userId;
    if (!uid) {
      const { data, error } = await supabase.auth.getSession();
      const sessionUid = data.session?.user?.id;

      if (error || !sessionUid) {
        setStatus("❌ Session expirée. Reconnecte-toi puis réessaie.");
        return;
      }

      uid = sessionUid;
      setUserId(uid);
    }

    if (!form.title.trim()) {
      setStatus("❌ Ajoute un nom de service.");
      return;
    }

    if (form.duration_minutes <= 0) {
      setStatus("❌ La durée doit être supérieure à 0.");
      return;
    }

    if (form.price_euros < 0) {
      setStatus("❌ Le tarif doit être valide.");
      return;
    }

    setSaving(true);
    setStatus(editingId ? "⏳ Mise à jour…" : "⏳ Enregistrement…");

    if (editingId) {
      const { error } = await supabase
        .from("products")
        .update({
          title: form.title.trim(),
          description: form.description.trim(),
          duration_minutes: Math.round(form.duration_minutes),
          price_cents: Math.round(form.price_euros * 100),
        })
        .eq("id", editingId)
        .eq("provider_id", uid);

      setSaving(false);

      if (error) {
        setStatus("❌ " + error.message);
        return;
      }

      setStatus("✅ Service mis à jour");
      resetForm();
      await loadProducts(uid);
      return;
    }

    const { error } = await supabase.from("products").insert({
      provider_id: uid,
      title: form.title.trim(),
      description: form.description.trim(),
      duration_minutes: Math.round(form.duration_minutes),
      price_cents: Math.round(form.price_euros * 100),
      active: true,
    });

    setSaving(false);

    if (error) {
      setStatus("❌ " + error.message);
      return;
    }

    await ensureDefaultAvailability(uid);

    if (isOnboarding) {
      router.push("/paiements");
      return;
    }

    setStatus("✅ Service ajouté");
    setShowForm(true);
    resetForm();
    await loadProducts(uid);
  }

  async function toggleActive(p: Product) {
    if (!userId) return;

    const next = !(p.active ?? true);

    const { error } = await supabase
      .from("products")
      .update({ active: next })
      .eq("id", p.id)
      .eq("provider_id", userId);

    if (error) {
      setStatus("❌ " + error.message);
      return;
    }

    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, active: next } : x)));
    setStatus(next ? "✅ Activé" : "✅ Désactivé");
  }

  async function deleteProduct(id: string) {
    if (!userId) return;

    const ok = window.confirm("Supprimer ce service ? (irréversible)");
    if (!ok) return;

    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", id)
      .eq("provider_id", userId);

    if (error) {
      setStatus("❌ Erreur suppression : " + error.message);
      return;
    }

    const nextProducts = products.filter((p) => p.id !== id);
    setProducts(nextProducts);
    setStatus("🗑️ Service supprimé");

    if (editingId === id) resetForm();

    const nowOnboarding = nextProducts.length === 0;
    setIsOnboarding(nowOnboarding);
    if (nowOnboarding) setShowForm(true);
  }

  if (loading) return <main style={{ padding: 24 }}>Chargement…</main>;

  const showEmptyState = !isOnboarding && products.length === 0 && !showForm;
  const showFormArea = isOnboarding || products.length > 0 || showForm;

  return (
    <Container>
      <Card>
        <div className="space-y-4">
          <h1 style={{ fontSize: 32, fontWeight: 900 }}>
            {isOnboarding ? "Créer un service" : "Mes services"}
          </h1>

          {isOnboarding ? (
            <div style={{ opacity: 0.85, lineHeight: 1.6 }}>
              <p>Vous pourrez modifier ce service et en créer d&apos;autres plus tard.</p>
              <p style={{ marginTop: 8 }}>
                Des disponibilités par défaut ont été activées : lundi au vendredi, de 9h à 18h.
                Vous pourrez les modifier à tout moment dans Disponibilités.
              </p>
            </div>
          ) : (
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" onClick={() => router.push("/dashboard/rendez-vous")}>
                Voir mes rendez-vous
              </Button>
            </div>
          )}

          {showEmptyState && (
            <div
              style={{
                marginTop: 24,
                padding: 32,
                border: "2px dashed #e5e7eb",
                borderRadius: 16,
                textAlign: "center",
              }}
            >
              <h3 style={{ fontSize: 20, fontWeight: 800 }}>Vous n’avez encore aucun service</h3>
              <p style={{ marginTop: 8, opacity: 0.8 }}>
                Créez votre premier service pour commencer à recevoir des réservations et des paiements.
              </p>

              <Button
                onClick={() => {
                  setShowForm(true);
                  setTimeout(() => {
                    document.getElementById("service-title")?.focus();
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }, 50);
                }}
                className="mt-4"
              >
                Créer mon premier service
              </Button>
            </div>
          )}

          {showFormArea && (
            <>
              <section style={{ marginTop: 20, border: "1px solid #eee", borderRadius: 14, padding: 16 }}>
                <div style={{ display: "grid", gap: 12 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <strong>Nom du service *</strong>
                    <input
                      id="service-title"
                      className="input"
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder="Ex : Consulting"
                    />
                  </label>

                  {!isOnboarding ? (
                    <label style={{ display: "grid", gap: 6 }}>
                      <strong>Description</strong>
                      <textarea
                        className="textarea"
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        rows={3}
                        placeholder="Objectifs, cadre, spécialités…"
                      />
                    </label>
                  ) : null}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <label style={{ display: "grid", gap: 6 }}>
                      <strong>Durée</strong>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          type="number"
                          className="input"
                          value={form.duration_minutes}
                          onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })}
                        />
                        <span>min</span>
                      </div>
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <strong>Tarif</strong>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          type="number"
                          className="input"
                          value={form.price_euros}
                          onChange={(e) => setForm({ ...form, price_euros: Number(e.target.value) })}
                        />
                        <span>€</span>
                      </div>
                    </label>
                  </div>

                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <Button onClick={save} disabled={saving}>
                      {saving
                        ? "Enregistrement…"
                        : isOnboarding
                        ? "Continuer"
                        : editingId
                        ? "Mettre à jour le service"
                        : "Ajouter le service"}
                    </Button>

                    {!isOnboarding && editingId ? (
                      <Button variant="secondary" onClick={resetForm}>
                        Annuler
                      </Button>
                    ) : null}
                  </div>

                  {status ? <p style={{ marginTop: 6 }}>{status}</p> : null}
                </div>
              </section>

              {!isOnboarding && products.length > 0 && (
                <section style={{ marginTop: 28 }}>
                  <div style={{ display: "grid", gap: 12 }}>
                    {products.map((p) => (
                      <div
                        key={p.id}
                        style={{
                          border: "1px solid #eee",
                          borderRadius: 14,
                          padding: 16,
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          opacity: p.active === false ? 0.55 : 1,
                        }}
                      >
                        <div>
                          <strong>{p.title}</strong>
                          <div style={{ opacity: 0.8, marginTop: 4 }}>
                            {p.duration_minutes} min — {p.price_cents != null ? `${p.price_cents / 100} €` : "—"}
                          </div>
                          {p.description && <p style={{ marginTop: 8 }}>{p.description}</p>}
                        </div>

                        <div style={{ display: "flex", gap: 8, alignItems: "start", flexWrap: "wrap" }}>
                          <Button variant="secondary" onClick={() => startEdit(p)}>
                            Modifier
                          </Button>

                          <Button variant="secondary" onClick={() => toggleActive(p)}>
                            {p.active === false ? "Activer" : "Désactiver"}
                          </Button>

                          <Button variant="secondary" onClick={() => deleteProduct(p.id)}>
                            Supprimer
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {!isOnboarding && (
            <div className="pt-4 border-t">
              <Button variant="secondary" onClick={() => router.push("/dashboard")}>
                OK
              </Button>
            </div>
          )}
        </div>
      </Card>
    </Container>
  );
}
