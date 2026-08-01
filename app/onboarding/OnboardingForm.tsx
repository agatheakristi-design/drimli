"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Button from "@/app/components/ui/Button";
import Input from "@/app/components/ui/Input";
import Logo from "@/app/components/ui/Logo";
import Select from "@/app/components/ui/Select";
import styles from "./onboarding.module.css";

type Availability = {
  mon: { start: string; end: string } | null;
  tue: { start: string; end: string } | null;
  wed: { start: string; end: string } | null;
  thu: { start: string; end: string } | null;
  fri: { start: string; end: string } | null;
  sat: { start: string; end: string } | null;
  sun: { start: string; end: string } | null;
};

type OnboardingFormState = {
  profession: string;
  firstName: string;
  lastName: string;
  serviceTitle: string;
  durationMinutes: string;
  priceEuros: string;
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

const INITIAL_FORM: OnboardingFormState = {
  profession: "",
  firstName: "",
  lastName: "",
  serviceTitle: "",
  durationMinutes: "60",
  priceEuros: "80",
};

function createSlug(firstName: string, lastName: string) {
  const fullName = `${firstName} ${lastName}`.trim();

  return fullName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function OnboardingForm() {
  const router = useRouter();

  const [form, setForm] = useState<OnboardingFormState>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadIdentity() {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;

      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("first_name, last_name")
        .eq("provider_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      const firstName =
        profile?.first_name ??
        user.user_metadata?.first_name ??
        "";

      const lastName =
        profile?.last_name ??
        user.user_metadata?.last_name ??
        "";

      setForm((current) => ({
        ...current,
        firstName: current.firstName || firstName,
        lastName: current.lastName || lastName,
      }));
    }

    loadIdentity();

    return () => {
      cancelled = true;
    };
  }, []);

  function updateField<Key extends keyof OnboardingFormState>(
    key: Key,
    value: OnboardingFormState[Key]
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function validateForm() {
    if (!form.profession.trim()) {
      return "Merci de renseigner votre métier.";
    }

    if (!form.firstName.trim()) {
      return "Merci de renseigner votre prénom.";
    }

    if (!form.lastName.trim()) {
      return "Merci de renseigner votre nom.";
    }

    if (!form.serviceTitle.trim()) {
      return "Merci de renseigner votre prestation.";
    }

    const durationMinutes = Number(form.durationMinutes);

    if (
      !Number.isFinite(durationMinutes) ||
      durationMinutes <= 0 ||
      !Number.isInteger(durationMinutes)
    ) {
      return "La durée doit être un nombre entier supérieur à zéro.";
    }

    const priceEuros = Number(form.priceEuros);

    if (!Number.isFinite(priceEuros) || priceEuros < 0) {
      return "Le prix doit être un nombre valide.";
    }

    return null;
  }

  async function ensureDefaultAvailability(providerId: string) {
    const { data, error } = await supabase
      .from("profiles")
      .select("availability")
      .eq("provider_id", providerId)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Impossible de vérifier les disponibilités : ${error.message}`
      );
    }

    const currentAvailability = data?.availability as
      | Availability
      | null
      | undefined;

    if (currentAvailability) {
      return;
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        availability: DEFAULT_STANDARD_AVAILABILITY,
      })
      .eq("provider_id", providerId);

    if (updateError) {
      throw new Error(
        `Impossible d'initialiser les disponibilités : ${updateError.message}`
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    console.log("SUBMIT");
    event.preventDefault();

    if (saving) {
      return;
    }

    setStatus("");

    const validationError = validateForm();

    if (validationError) {
      setStatus(validationError);
      return;
    }

    setSaving(true);
    setStatus("Création de votre espace en cours…");
    console.log("ETAPE 1");

    try {
      const { data: userData, error: userError } =
        await supabase.auth.getUser();

      const user = userData.user;

      if (userError || !user) {
        setStatus(
          "Votre session a expiré. Reconnectez-vous puis recommencez."
        );
        return;
      }

      const profession = form.profession.trim();
      const firstName = form.firstName.trim();
      const lastName = form.lastName.trim();
      const fullName = `${firstName} ${lastName}`.trim();
      const slug =
        createSlug(firstName, lastName) || `professionnel-${user.id.slice(0, 8)}`;

      const durationMinutes = Math.round(Number(form.durationMinutes));
      const priceCents = Math.round(Number(form.priceEuros) * 100);

      const { error: profileError } = await supabase
        .from("profiles")
        .upsert(
          {
            provider_id: user.id,
            profession,
            first_name: firstName,
            last_name: lastName,
            full_name: fullName,
            slug,
          },
          {
            onConflict: "provider_id",
          }
        );

      console.log("ETAPE 2", profileError);
      if (profileError) {
        throw new Error(
          `Impossible d'enregistrer votre profil : ${profileError.message}`
        );
      }

      const { error: productError } = await supabase.from("products").insert({
        provider_id: user.id,
        title: form.serviceTitle.trim(),
        duration_minutes: durationMinutes,
        price_cents: priceCents,
        active: true,
      });

      console.log("ETAPE 3", productError);
      if (productError) {
        throw new Error(
          `Impossible de créer votre prestation : ${productError.message}`
        );
      }

      console.log("ETAPE 4");
      await ensureDefaultAvailability(user.id);

      setStatus("Votre page est prête.");

      console.log("ETAPE 5");
      router.push("/dashboard");
      
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Une erreur inattendue est survenue.";

      setStatus(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.screen}>
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.logoLink}>
            <Logo className={styles.logo} />
          </div>
        </header>

        <main className={styles.main}>
          <div className={styles.content}>
            <h1 className={styles.title}>Créez votre page.</h1>

            <p className={styles.intro}>
              En moins de 10 secondes.
            </p>

            <form className={styles.formCard} onSubmit={handleSubmit}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="profession">
                  Métier
                </label>

                <Input
                  id="profession"
                  name="profession"
                  type="text"
                  placeholder="Coach, thérapeute, consultant…"
                  autoComplete="organization-title"
                  value={form.profession}
                  onChange={(event) =>
                    updateField("profession", event.target.value)
                  }
                  className={styles.control}
                  disabled={saving}
                  required
                />
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="firstName">
                    Prénom
                  </label>

                  <Input
                    id="firstName"
                    name="firstName"
                    type="text"
                    placeholder="Votre prénom"
                    autoComplete="given-name"
                    value={form.firstName}
                    onChange={(event) =>
                      updateField("firstName", event.target.value)
                    }
                    className={styles.control}
                    disabled={saving}
                    required
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="lastName">
                    Nom
                  </label>

                  <Input
                    id="lastName"
                    name="lastName"
                    type="text"
                    placeholder="Votre nom"
                    autoComplete="family-name"
                    value={form.lastName}
                    onChange={(event) =>
                      updateField("lastName", event.target.value)
                    }
                    className={styles.control}
                    disabled={saving}
                    required
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="serviceTitle">
                  Votre prestation
                </label>

                <Input
                  id="serviceTitle"
                  name="serviceTitle"
                  type="text"
                  placeholder="Séance individuelle, audit, cours particulier…"
                  value={form.serviceTitle}
                  onChange={(event) =>
                    updateField("serviceTitle", event.target.value)
                  }
                  className={styles.control}
                  disabled={saving}
                  required
                />
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="durationMinutes">
                    Durée
                  </label>

                  <Select
                    id="durationMinutes"
                    name="durationMinutes"
                    value={form.durationMinutes}
                    onChange={(event) =>
                      updateField("durationMinutes", event.target.value)
                    }
                    className={`${styles.control} ${styles.select}`}
                    disabled={saving}
                  >
                    <option value="30">30 min</option>
                    <option value="45">45 min</option>
                    <option value="60">60 min</option>
                    <option value="90">90 min</option>
                  </Select>
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="priceEuros">
                    Prix
                  </label>

                  <div className={styles.priceWrap}>
                    <Input
                      id="priceEuros"
                      name="priceEuros"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={form.priceEuros}
                      onChange={(event) =>
                        updateField("priceEuros", event.target.value)
                      }
                      className={`${styles.control} ${styles.priceInput}`}
                      disabled={saving}
                      required
                    />

                    <Select
                      id="currency"
                      name="currency"
                      value="EUR"
                      className={`${styles.control} ${styles.select} ${styles.currencySelect}`}
                      disabled
                      aria-label="Devise"
                    >
                      <option value="EUR">€ EUR</option>
                    </Select>
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                className={styles.submitButton}
                disabled={saving}
              >
                {saving ? "Création en cours…" : "Créer ma page"}
              </Button>

              {status ? (
                <p role="status" aria-live="polite" className={styles.note}>
                  {status}
                </p>
              ) : null}
            </form>

            {!status ? (
              <p className={styles.note}>
                Vous pourrez tout modifier plus tard.
              </p>
            ) : null}
          </div>
        </main>
      </div>
    </section>
  );
}