"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

import Container from "@/app/components/ui/Container";
import Card from "@/app/components/ui/Card";import Button from "@/app/components/ui/Button";
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

export default function ServicesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const router = useRouter();

  // UX: on cache le formulaire tant qu'il n'y a aucun service, jusqu'au clic
  const [showForm, setShowForm] = useState(false);

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
      return;
    }

    setProducts((data ?? []) as Product[]);
  }

  // Pas de redirect ici. On charge si on a une session.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        const uid = data.session?.user?.id;

        if (cancelled) return;

        if (error || !uid) {
          // Pas de session → on affiche la page sans données (le dashboard gère l'accès)
          setLoading(false);
          return;
        }

        setUserId(uid);
        await loadProducts(uid);

        if (!cancelled) setLoading(false);
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

  async function save() {
    setStatus("");

    // ✅ userId peut être null au moment du clic → on récupère la session ici
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
      setStatus("❌ Ajoute un titre de service.");
      return;
    }

    if (form.duration_minutes <= 0) {
      setStatus("❌ La durée doit être > 0.");
      return;
    }

    if (form.price_euros < 0) {
      setStatus("❌ Le tarif doit être valide.");
      return;
    }

    setSaving(true);
    setStatus(editingId ? "⏳ Mise à jour…" : "⏳ Création…");

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

    const { error } = await supabase.from("products").delete().eq("id", id).eq("provider_id", userId);

    if (error) {
      setStatus("❌ Erreur suppression : " + error.message);
      return;
    }

    setProducts((prev) => prev.filter((p) => p.id !== id));
    setStatus("🗑️ Service supprimé");
    if (editingId === id) resetForm();
  }

  if (loading) return <main style={{ padding: 24 }}>Chargement…</main>;

  const showEmptyState = products.length === 0 && !showForm;
  const showFormArea = products.length > 0 || showForm;

  return (
    <Container>
      <Card>
        <div className="space-y-4">
<div style={{ display: "flex", justifyContent: "flex-end" }}></div>
      <div className="mt-4 flex gap-2">
  <Button variant="secondary" onClick={() => router.push("/dashboard/rendez-vous")}>
    Voir mes rendez-vous
  </Button>
</div>

      <h1 style={{ fontSize: 32, fontWeight: 900 }}>Mes services</h1>
{/* ✅ ÉTAT VIDE SEUL */}
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

          <button
            onClick={() => {
              setShowForm(true);
              setTimeout(() => {
                document.getElementById("service-title")?.focus();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }, 50);
            }}
            style={{
              marginTop: 16,
              padding: "14px 18px",
              borderRadius: 12,
              border: "none",
              backgroundColor: "#2563eb",
              color: "#fff",
              fontWeight: 800,
              fontSize: 16,
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(37, 99, 235, 0.35)",
            }}
          >
            ➕ Créer mon premier service
          </button>
        </div>
      )}

      {/* ✅ FORMULAIRE + LISTE */}
      {showFormArea && (
        <>
          <section style={{ marginTop: 20, border: "1px solid #eee", borderRadius: 14, padding: 16 }}>
            {/* On a retiré le titre "Ajouter un service" comme tu le souhaites */}
            <div style={{ display: "grid", gap: 12 }}>
              <label>
                <strong>Titre *</strong>
                <input
                  id="service-title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Ex : Consultation cabinet"
                  style={{ width: "100%", padding: 10 }}
                />
              </label>

              <label>
                <strong>Description</strong>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  placeholder="Objectifs, cadre, spécialités…"
                  style={{ width: "100%", padding: 10 }}
                />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  <strong>Durée</strong>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="number"
                      value={form.duration_minutes}
                      onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })}
                      style={{ flex: 1, padding: 10 }}
                    />
                    <span>min</span>
                  </div>
                </label>

                <label>
                  <strong>Tarif</strong>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="number"
                      value={form.price_euros}
                      onChange={(e) => setForm({ ...form, price_euros: Number(e.target.value) })}
                      style={{ flex: 1, padding: 10 }}
                    />
                    <span>€</span>
                  </div>
                </label>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  onClick={save}
                  disabled={saving}
                  style={{
                    marginTop: 8,
                    padding: "14px 18px",
                    borderRadius: 12,
                    border: "none",
                    backgroundColor: saving ? "#93c5fd" : "#2563eb",
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: 16,
                    cursor: saving ? "not-allowed" : "pointer",
                    boxShadow: "0 4px 12px rgba(37, 99, 235, 0.35)",
                  }}
                >
                  {saving ? "Enregistrement…" : editingId ? "Mettre à jour le service" : "➕ Ajouter le service"}
                </button>

                {editingId && (
                  <button
                    onClick={resetForm}
                    style={{
                      marginTop: 6,
                      padding: 12,
                      fontWeight: 800,
                      border: "1px solid #ddd",
                      background: "transparent",
                      cursor: "pointer",
                    }}
                  >
                    Annuler
                  </button>
                )}
              </div>

              {status && <p style={{ marginTop: 6 }}>{status}</p>}
            </div>
          </section>

          {/* Liste uniquement si products.length > 0 (on a supprimé les phrases qui brouillaient) */}
          {products.length > 0 && (
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

                    <div style={{ display: "flex", gap: 8, alignItems: "start" }}>
                      <button
                        onClick={() => startEdit(p)}
                        style={{
                          border: "1px solid #ddd",
                          background: "transparent",
                          borderRadius: 10,
                          padding: "8px 12px",
                          cursor: "pointer",
                          fontWeight: 700,
                        }}
                      >
                        Modifier
                      </button>

                      <button
                        onClick={() => toggleActive(p)}
                        style={{
                          border: "1px solid #ddd",
                          background: "transparent",
                          borderRadius: 10,
                          padding: "8px 12px",
                          cursor: "pointer",
                          fontWeight: 700,
                        }}
                      >
                        {p.active === false ? "Activer" : "Désactiver"}
                      </button>

                      <button
                        onClick={() => deleteProduct(p.id)}
                        style={{
                          border: "1px solid #ddd",
                          background: "transparent",
                          borderRadius: 10,
                          padding: "8px 12px",
                          cursor: "pointer",
                          fontWeight: 700,
                        }}
                      >
                        Supprimer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    

          <div className="pt-4 border-t">
            <Button variant="secondary" onClick={() => router.push("/dashboard")}>
              Revenir au dashboard
            </Button>
          </div>
        </div>
      </Card>
    </Container>

  );
}