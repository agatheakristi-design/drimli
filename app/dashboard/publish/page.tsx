"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

function makeSlug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function slugExists(slug: string, currentProviderId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("provider_id")
    .eq("slug", slug)
    .neq("provider_id", currentProviderId)
    .limit(1);

  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

async function ensureUniqueSlug(baseSlug: string, currentProviderId: string) {
  const base = makeSlug(baseSlug);
  if (!base) return "";

  let candidate = base;
  for (let i = 1; i <= 50; i++) {
    const exists = await slugExists(candidate, currentProviderId);
    if (!exists) return candidate;
    candidate = `${base}-${i + 1}`;
  }

  return `${base}-${Date.now()}`;
}

export default function PublishPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const [userId, setUserId] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [profession, setProfession] = useState("");
  const [slug, setSlug] = useState("");
  const [published, setPublished] = useState(false);

  const [bookingUrl, setBookingUrl] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactWhatsapp, setContactWhatsapp] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) {
        setLoading(false);
        return;
      }

      const uid = auth.user.id;
      setUserId(uid);

      const { data } = await supabase
        .from("profiles")
        .select(
          "full_name, profession, slug, published, booking_url, contact_phone, contact_whatsapp, contact_email"
        )
        .eq("provider_id", uid)
        .maybeSingle();

      const name = data?.full_name ?? "";
      const prof = data?.profession ?? "";

      setFullName(name);
      setProfession(prof);
      setPublished(!!data?.published);

      const proposed = makeSlug(`${name} ${prof}`) || makeSlug(name);
      setSlug(data?.slug ?? proposed);

      setBookingUrl(data?.booking_url ?? "");
      setContactPhone(data?.contact_phone ?? "");
      setContactWhatsapp(data?.contact_whatsapp ?? "");
      setContactEmail(data?.contact_email ?? "");

      setLoading(false);
    })();
  }, []);

  async function save() {
    if (!userId) return;

    setSaving(true);
    setStatus("");

    try {
      const base =
        slug.trim() ||
        makeSlug(`${fullName} ${profession}`) ||
        makeSlug(fullName);

      const uniqueSlug = await ensureUniqueSlug(base, userId);
      if (!uniqueSlug) throw new Error("Slug invalide");

      const { error } = await supabase
        .from("profiles")
        .update({
          slug: uniqueSlug,
          published,
          booking_url: bookingUrl,
          contact_phone: contactPhone,
          contact_whatsapp: contactWhatsapp,
          contact_email: contactEmail,
          updated_at: new Date().toISOString(),
        })
        .eq("provider_id", userId);

      if (error) throw new Error(error.message);

      setSlug(uniqueSlug);
      setStatus("✅ Enregistré !");
    } catch (e: any) {
      setStatus("❌ " + (e?.message ?? "Erreur"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main style={{ padding: 24 }}>Chargement…</main>;

  const publicUrl = slug ? `${window.location.origin}/${makeSlug(slug)}` : "";

  const labelStyle: React.CSSProperties = { fontWeight: 900, marginBottom: 6 };
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: 10,
    borderRadius: 10,
    border: "1px solid #ddd",
  };

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ fontSize: 28, fontWeight: 900 }}>Publier ma page</h1>

      <p style={{ marginTop: 8, opacity: 0.8 }}>
        Nom : <strong>{fullName || "—"}</strong>
        {profession && (
          <>
            {" "}
            • Profession : <strong>{profession}</strong>
          </>
        )}
      </p>

      <section
        style={{
          marginTop: 16,
          border: "1px solid #eee",
          borderRadius: 14,
          padding: 16,
          display: "grid",
          gap: 14,
        }}
      >
        <label>
          <div style={labelStyle}>Lien public</div>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            style={inputStyle}
          />
          {publicUrl && (
            <p style={{ marginTop: 8 }}>
              URL :{" "}
              <a href={publicUrl} target="_blank" rel="noreferrer">
                {publicUrl}
              </a>
            </p>
          )}
        </label>

        <label>
          <div style={labelStyle}>Lien de réservation (Calendly)</div>
          <input
            value={bookingUrl}
            onChange={(e) => setBookingUrl(e.target.value)}
            style={inputStyle}
          />
        </label>

        <div style={{ fontWeight: 900 }}>Contact</div>

        <label>
          <div style={labelStyle}>WhatsApp</div>
          <input
            value={contactWhatsapp}
            onChange={(e) => setContactWhatsapp(e.target.value)}
            style={inputStyle}
          />
        </label>

        <label>
          <div style={labelStyle}>Téléphone</div>
          <input
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            style={inputStyle}
          />
        </label>

        <label>
          <div style={labelStyle}>Email</div>
          <input
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
          />
          <span style={{ fontWeight: 800 }}>
            Publier ma page (visible publiquement)
          </span>
        </label>

        <button
          onClick={save}
          disabled={saving}
          style={{
            padding: "14px 18px",
            borderRadius: 12,
            border: "none",
            backgroundColor: "#2563eb",
            color: "#fff",
            fontWeight: 900,
            fontSize: 16,
          }}
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>

        {status && <p>{status}</p>}
      </section>
    </main>
  );
}
