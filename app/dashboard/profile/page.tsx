"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Button from "@/app/components/ui/Button";
import Input from "@/app/components/ui/Input";
import TopBar from "../components/TopBar";
import styles from "./profile.module.css";

type ConsultationType =
  | "whatsapp"
  | "meet"
  | "teams"
  | "phone"
  | "in_person"
  | "";

type ProfileForm = {
  first_name: string;
  last_name: string;
  address: string;
  city: string;
  country: string;
  siret: string;
  vat_number: string;
  phone: string;
  contact_whatsapp: string;
  booking_url: string;
  consultation_type: ConsultationType;
};

type ProfileRow = ProfileForm & {
  provider_id: string;
  full_name: string | null;
  avatar_url: string | null;
};

type OnboardingStatus = {
  accountReady: boolean;
};

type GoogleStatus = {
  connected: boolean;
  reason:
    | "not_connected"
    | "refresh_token_missing"
    | "calendar_scope_missing"
    | null;
  email: string | null;
};

const consultationOptions: Array<{
  value: Exclude<ConsultationType, "">;
  label: string;
}> = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "meet", label: "Google Meet" },
  { value: "phone", label: "Téléphone" },
  { value: "in_person", label: "En présentiel" },
];

export default function ProfilePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [status, setStatus] = useState("");
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleReason, setGoogleReason] = useState<GoogleStatus["reason"]>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isOnboardingMode, setIsOnboardingMode] = useState(true);

  const [form, setForm] = useState<ProfileForm>({
    first_name: "",
    last_name: "",
    address: "",
    city: "",
    country: "",
    siret: "",
    vat_number: "",
    phone: "",
    contact_whatsapp: "",
    booking_url: "",
    consultation_type: "",
  });

  useEffect(() => {
    async function loadProfile() {
      try {
        setStatus("");

        const { data: userData } = await supabase.auth.getUser();
        const user = userData.user;

        if (!user) {
          setLoading(false);
          return;
        }

        setUserId(user.id);

        const { data, error } = await supabase
          .from("profiles")
          .select(
            "provider_id, full_name, first_name, last_name, address, city, country, siret, vat_number, phone, contact_whatsapp, booking_url, consultation_type, avatar_url"
          )
          .eq("provider_id", user.id)
          .maybeSingle<ProfileRow>();

        if (error) {
          setStatus("❌ Erreur chargement profil : " + error.message);
          setLoading(false);
          return;
        }

        if (data) {
          setAvatarUrl(data.avatar_url ?? null);
          setForm({
            first_name: data.first_name ?? "",
            last_name: data.last_name ?? "",
            address: data.address ?? "",
            city: data.city ?? "",
            country: data.country ?? "",
            siret: data.siret ?? "",
            vat_number: data.vat_number ?? "",
            phone: data.phone ?? "",
            contact_whatsapp: data.contact_whatsapp ?? "",
            booking_url: data.booking_url ?? "",
            consultation_type: data.consultation_type ?? "",
          });
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        if (token) {
          const response = await fetch("/api/onboarding/status", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });

          if (response.ok) {
            const onboardingStatus =
              (await response.json()) as OnboardingStatus;

            setIsOnboardingMode(!onboardingStatus.accountReady);

            const googleResponse = await fetch("/api/google/status", {
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
            });

            if (googleResponse.ok) {
              const googleStatus =
                (await googleResponse.json()) as GoogleStatus;

              setGoogleConnected(googleStatus.connected);
              setGoogleReason(googleStatus.reason);
            }


          }
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Erreur inconnue";

        setStatus("❌ Erreur inattendue : " + message);
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, []);

  function updateField<Key extends keyof ProfileForm>(
    key: Key,
    value: ProfileForm[Key]
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function connectGoogle() {
    try {
      setGoogleConnecting(true);
      setStatus("");

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        setStatus("Vous devez être connecté.");
        return;
      }

      const response = await fetch("/api/google/connect", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await response.json();

      if (!response.ok) {
        setStatus(result.error || "Erreur de connexion Google.");
        return;
      }

      window.location.href = result.url;
    } catch {
      setStatus("Erreur de connexion Google.");
    } finally {
      setGoogleConnecting(false);
    }
  }

  async function uploadAvatar(file: File) {
    if (!userId) return;

    setUploadingPhoto(true);
    setStatus("");

    try {
      const extension = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `avatars/${userId}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("drimli-public")
        .upload(path, file, { upsert: true });

      if (uploadError) {
        setStatus("❌ Upload photo : " + uploadError.message);
        return;
      }

      const { data } = supabase.storage
        .from("drimli-public")
        .getPublicUrl(path);

      const publicUrl = data.publicUrl;
      const profileFullName =
        `${form.first_name} ${form.last_name}`.trim();

      const { error: saveError } = await supabase
        .from("profiles")
        .upsert(
          {
            provider_id: userId,
            avatar_url: publicUrl,
            first_name: form.first_name,
            last_name: form.last_name,
            full_name: profileFullName,
          },
          { onConflict: "provider_id" }
        );

      if (saveError) {
        setStatus("❌ Enregistrement photo : " + saveError.message);
        return;
      }

      setAvatarUrl(publicUrl);
      setStatus("✅ Photo enregistrée.");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Erreur inconnue";

      setStatus("❌ Erreur photo : " + message);
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function saveProfile() {
    setStatus("");

    if (!userId) return;

    if (!form.first_name.trim()) {
      setStatus("Merci de renseigner votre prénom.");
      return;
    }

    if (!form.last_name.trim()) {
      setStatus("Merci de renseigner votre nom.");
      return;
    }

    setSaving(true);

    try {
      const profileFullName =
        `${form.first_name} ${form.last_name}`.trim();

      const payload = {
        provider_id: userId,
        slug: profileFullName
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, ""),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        full_name: profileFullName,
        address: form.address.trim(),
        city: form.city.trim(),
        country: form.country.trim(),
        siret: form.siret.trim(),
        vat_number: form.vat_number.trim(),
        phone: form.phone.trim(),
        contact_whatsapp: form.contact_whatsapp.trim(),
        booking_url: form.booking_url.trim(),
        consultation_type: form.consultation_type || null,
      };

      const { error } = await supabase
        .from("profiles")
        .upsert(payload, {
          onConflict: "provider_id",
        });

      if (error) {
        setStatus("❌ Erreur enregistrement : " + error.message);
        return;
      }

      if (isOnboardingMode) {
        router.push("/dashboard/services");
      } else {
        router.push("/dashboard");
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Erreur inconnue";

      setStatus("❌ Erreur inattendue : " + message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p style={{ padding: 24 }}>Chargement…</p>;
  }

  return (
    <div>
      <TopBar />

        <header className={styles.pageHeader}>
          <h1>
            {isOnboardingMode
              ? "Compléter mes informations"
              : "Mon profil"}
          </h1>

          <p>
            Gérez votre identité professionnelle, vos coordonnées et le
            déroulement de vos consultations.
          </p>
        </header>

        <div className={styles.form}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Photo de profil</h2>
              <p>
                Cette photo pourra apparaître sur votre page publique.
              </p>
            </div>

            <div className={styles.avatarRow}>
              <button
                type="button"
                className={styles.avatarButton}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Ajouter ou modifier ma photo"
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Photo de profil" />
                ) : (
                  <span className={styles.avatarPlaceholder}>👤</span>
                )}
              </button>

              <div className={styles.avatarText}>
                {uploadingPhoto
                  ? "Upload en cours…"
                  : "Cliquez sur la photo pour l’ajouter ou la modifier."}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={async (event) => {
                  const file = event.target.files?.[0];

                  if (file) {
                    await uploadAvatar(file);
                  }

                  event.currentTarget.value = "";
                }}
              />
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Identité</h2>
              <p>
                Les informations principales affichées à vos clients.
              </p>
            </div>

            <div className={styles.twoColumns}>
              <label className={styles.field}>
                <span>Prénom</span>
                <Input
                  value={form.first_name}
                  onChange={(event) =>
                    updateField("first_name", event.target.value)
                  }
                />
              </label>

              <label className={styles.field}>
                <span>Nom</span>
                <Input
                  value={form.last_name}
                  onChange={(event) =>
                    updateField("last_name", event.target.value)
                  }
                />
              </label>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Contact</h2>
              <p>
                Les coordonnées utilisées pour organiser vos rendez-vous.
              </p>
            </div>

            <div className={styles.fields}>
              <label className={styles.field}>
                <span>Téléphone</span>
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(event) =>
                    updateField("phone", event.target.value)
                  }
                />
              </label>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Consultation</h2>
              <p>
                Choisissez comment se déroulent vos prestations à distance
                ou en présentiel.
              </p>
            </div>

            <div className={styles.consultationOptions}>
              {consultationOptions.map((option) => {
                const selected =
                  form.consultation_type === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`${styles.consultationOption} ${
                      selected
                        ? styles.consultationOptionSelected
                        : ""
                    }`}
                    onClick={() => {
                      if (option.value === "meet" && !googleConnected) {
                        updateField("consultation_type", option.value);
                        void connectGoogle();
                        return;
                      }
                      updateField("consultation_type", option.value);
                    }}
                    disabled={
                      (option.value === "meet" && googleConnecting)
                    }
                    aria-pressed={selected}
                  >
                    {option.value === "meet" && googleConnected ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: "50%",
                            background: "#22c55e",
                            boxShadow:
                              "0 0 0 3px rgba(34, 197, 94, 0.15)",
                          }}
                        />
                        Google Meet connecté
                      </span>
                    ) : option.value === "meet" &&
                      googleConnecting ? (
                      "Connexion en cours…"
                    ) : option.value === "meet" &&
                      googleReason === "calendar_scope_missing" ? (
                      "Reconnecter Google Calendar"
                    ) : (
                      option.label
                    )}
                  </button>
                );
              })}
            </div>

            {form.consultation_type === "whatsapp" ? (
              <div className={styles.fields} style={{ marginTop: 18 }}>
                <label className={styles.field}>
                  <span>Numéro WhatsApp</span>
                  <Input
                    type="tel"
                    placeholder="+33 6 00 00 00 00"
                    value={form.contact_whatsapp}
                    onChange={(event) =>
                      updateField(
                        "contact_whatsapp",
                        event.target.value
                      )
                    }
                  />
                </label>
              </div>
            ) : null}

            {form.consultation_type === "phone" ? (
              <p className={styles.avatarText} style={{ marginTop: 18 }}>
                Le numéro renseigné dans la section Contact sera utilisé.
              </p>
            ) : null}

            {form.consultation_type === "in_person" ? (
              <p className={styles.avatarText} style={{ marginTop: 18 }}>
                L’adresse renseignée ci-dessous sera communiquée au client.
              </p>
            ) : null}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Adresse</h2>
              <p>
                Votre adresse professionnelle ou votre lieu de consultation.
              </p>
            </div>

            <div className={styles.fields}>
              <label className={styles.field}>
                <span>Adresse</span>
                <Input
                  value={form.address}
                  onChange={(event) =>
                    updateField("address", event.target.value)
                  }
                />
              </label>

              <div className={styles.twoColumns}>
                <label className={styles.field}>
                  <span>Ville</span>
                  <Input
                    value={form.city}
                    onChange={(event) =>
                      updateField("city", event.target.value)
                    }
                  />
                </label>

                <label className={styles.field}>
                  <span>Pays</span>
                  <Input
                    value={form.country}
                    onChange={(event) =>
                      updateField("country", event.target.value)
                    }
                  />
                </label>
              </div>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>Informations légales</h2>
              <p>
                Ces informations sont utilisées pour votre activité
                professionnelle.
              </p>
            </div>

            <div className={styles.twoColumns}>
              <label className={styles.field}>
                <span>SIRET</span>
                <Input
                  value={form.siret}
                  onChange={(event) =>
                    updateField("siret", event.target.value)
                  }
                />
              </label>

              <label className={styles.field}>
                <span>TVA intracommunautaire</span>
                <Input
                  value={form.vat_number}
                  onChange={(event) =>
                    updateField("vat_number", event.target.value)
                  }
                />
              </label>
            </div>
          </section>

          {status ? <p className={styles.status}>{status}</p> : null}

          <div className={styles.actions}>
            <Button
              type="button"
              onClick={saveProfile}
              disabled={saving}
            >
              {saving
                ? "Enregistrement…"
                : isOnboardingMode
                  ? "Continuer"
                  : "Enregistrer les modifications"}
            </Button>
          </div>
        </div>
    </div>
  );
}
