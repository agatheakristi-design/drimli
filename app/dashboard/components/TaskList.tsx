"use client";

import {
  ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Check,
  ChevronRight,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import DrimpayOnboarding from "./DrimpayOnboarding";
import GoogleMeetOnboarding from "./GoogleMeetOnboarding";
import GoogleReviewsOnboarding from "./GoogleReviewsOnboarding";
import GoogleReviewRequestAdminTest from "./GoogleReviewRequestAdminTest";
import BillingSettingsOnboarding from "./BillingSettingsOnboarding";
import ServicesManager from "./ServicesManager";
import { tasks } from "./tasks";
import styles from "./dashboard.module.css";

export default function TaskList({
  onCompletedTasksChange,
}: {
  onCompletedTasksChange: (completedTasks: number) => void;
}) {
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const [userId, setUserId] = useState<string | null>(null);

  const [photoDone, setPhotoDone] = useState(false);
  const [paymentReady, setPaymentReady] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleReviewsReady, setGoogleReviewsReady] = useState(false);
  const [billingReady, setBillingReady] = useState(false);
  const [googleReviewsOpen, setGoogleReviewsOpen] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoStatus, setPhotoStatus] = useState("");

  const [description, setDescription] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [openTask, setOpenTask] = useState<
    "services" | "description" | "payments" | "billing" | null
  >(null);
  const [savingDescription, setSavingDescription] = useState(false);
  const [descriptionStatus, setDescriptionStatus] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadProfileStatus() {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;

      if (!user || cancelled) return;

      setUserId(user.id);

      const { data } = await supabase
        .from("profiles")
        .select("avatar_url, description")
        .eq("provider_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      setPhotoDone(Boolean(data?.avatar_url));

      const savedDescription = data?.description?.trim() ?? "";
      setDescription(savedDescription);
      setDescriptionDraft(savedDescription);

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      if (accessToken) {
        const response = await fetch("/api/onboarding/status", {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });

        if (response.ok) {
          const status = (await response.json()) as {
            paymentComplete?: boolean;
          };
          setPaymentReady(Boolean(status.paymentComplete));
        }
      }
    }

    loadProfileStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  function isTaskDone(label: string, defaultValue: boolean) {
    if (label === "Ajouter une photo") {
      return photoDone;
    }

    if (label === "Écrire une description") {
      return Boolean(description.trim());
    }

    if (label === "Connecter les paiements") {
      return paymentReady;
    }

    if (label === "Connecter Google Meet") {
      return googleReady;
    }

    if (label === "Booster mes avis Google") {
      return googleReviewsReady;
    }

    if (label === "Facturation") {
      return billingReady;
    }

    return defaultValue;
  }

  const handleGoogleCompletion = useCallback((connected: boolean) => {
    setGoogleReady(connected);
  }, []);

  const handleGoogleReviewsCompletion = useCallback((enabled: boolean) => {
    setGoogleReviewsReady(enabled);
  }, []);

  async function uploadPhoto(file: File) {
    if (!userId) {
      setPhotoStatus("Vous devez être connecté.");
      return;
    }

    if (!file.type.startsWith("image/")) {
      setPhotoStatus("Sélectionnez un fichier image.");
      return;
    }

    setUploadingPhoto(true);
    setPhotoStatus("Importation…");

    try {
      const extension =
        (file.name.split(".").pop() || "png").toLowerCase();

      const storagePath = `avatars/${userId}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("drimli-public")
        .upload(storagePath, file, { upsert: true });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { data: publicData } = supabase.storage
        .from("drimli-public")
        .getPublicUrl(storagePath);

      const publicUrl = publicData.publicUrl;

      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          avatar_url: publicUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("provider_id", userId);

      if (profileError) {
        throw new Error(profileError.message);
      }

      setPhotoDone(true);
      setPhotoStatus("Photo ajoutée.");
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Une erreur est survenue.";

      setPhotoStatus(`Erreur : ${message}`);
    } finally {
      setUploadingPhoto(false);

      if (photoInputRef.current) {
        photoInputRef.current.value = "";
      }
    }
  }

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (file) {
      uploadPhoto(file);
    }
  }

  async function saveDescription() {
    if (!userId) {
      setDescriptionStatus("Vous devez être connecté.");
      return;
    }

    const value = descriptionDraft.trim();

    if (!value) {
      setDescriptionStatus("Écrivez quelques lignes sur votre activité.");
      return;
    }

    setSavingDescription(true);
    setDescriptionStatus("Enregistrement…");

    const { error } = await supabase
      .from("profiles")
      .update({
        description: value,
        updated_at: new Date().toISOString(),
      })
      .eq("provider_id", userId);

    setSavingDescription(false);

    if (error) {
      setDescriptionStatus(`Erreur : ${error.message}`);
      return;
    }

    setDescription(value);
    setDescriptionDraft(value);
    setDescriptionStatus("");
    setOpenTask(null);
  }

  function cancelDescription() {
    setDescriptionDraft(description);
    setDescriptionStatus("");
    setOpenTask(null);
  }

  const completedTasks = tasks.filter((task) =>
    isTaskDone(task.label, task.done)
  ).length;

  useEffect(() => {
    onCompletedTasksChange(completedTasks);
  }, [completedTasks, onCompletedTasksChange]);

  return (
    <section className={styles.tasksPanel}>
      <div className={styles.sectionHeading}>
        <h2>Complétez votre page</h2>
        <span>
          {completedTasks} sur {tasks.length}
        </span>
      </div>

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={handlePhotoChange}
      />

      <div className={styles.tasksList}>
        {tasks.map((task) => {
          const done = isTaskDone(task.label, task.done);

          const descriptionText =
            task.label === "Ajouter une photo" && photoStatus
              ? photoStatus
              : task.label === "Écrire une description" && description
                ? "Votre présentation est enregistrée."
                : task.label === "Connecter les paiements"
                  ? paymentReady
                    ? "Votre compte de paiement est activé."
                    : "Stripe n’est pas prêt. Terminez la configuration pour recevoir des paiements."
                : task.description;
          const taskLabel =
            task.label === "Connecter les paiements" && !paymentReady
              ? "Terminer la configuration des paiements"
              : task.label;

          const content = (
            <>
              <span className={styles.taskIcon}>
                {done ? <Check size={16} /> : <Plus size={16} />}
              </span>

              <span className={styles.taskCopy}>
                <strong>{taskLabel}</strong>
                <span>{descriptionText}</span>
              </span>

              <ChevronRight
                className={styles.taskArrow}
                size={18}
              />
            </>
          );

          const className = `${styles.taskRow} ${
            done ? styles.taskRowDone : ""
          }`;

          if (task.label === "Connecter Google Meet") {
            return (
              <GoogleMeetOnboarding
                key={task.label}
                onCompletionChange={handleGoogleCompletion}
              />
            );
          }

          if (task.label === "Booster mes avis Google") {
            return (
              <GoogleReviewsOnboarding
                key={task.label}
                open={googleReviewsOpen}
                onOpenChange={setGoogleReviewsOpen}
                onCompletionChange={handleGoogleReviewsCompletion}
              />
            );
          }

          if (task.label === "Premier service créé") {
            return (
              <div
                key={task.label}
                className={`${className} ${styles.taskStatic}`}
              >
                <span className={styles.taskIcon}>
                  <Check size={16} />
                </span>

                <span className={styles.taskCopy}>
                  <strong>{task.label}</strong>
                  <span>{task.description}</span>
                </span>
              </div>
            );
          }

          if (task.label === "Ajouter des services") {
            const servicesOpen = openTask === "services";

            return (
              <div
                key={task.label}
                className={`${className} ${styles.taskRowExpanded} ${
                  servicesOpen ? styles.taskRowExpandedOpen : ""
                }`}
              >
                <button
                  type="button"
                  className={styles.taskRowHeader}
                  aria-expanded={servicesOpen}
                  onClick={() =>
                    setOpenTask(servicesOpen ? null : "services")
                  }
                >
                  {content}
                </button>

                {servicesOpen && (
                  <div className={styles.inlineEditor}>
                    <ServicesManager embedded />
                  </div>
                )}
              </div>
            );
          }

          if (task.label === "Ajouter une photo") {
            return (
              <button
                key={task.label}
                type="button"
                className={className}
                disabled={uploadingPhoto}
                onClick={() => photoInputRef.current?.click()}
              >
                {content}
              </button>
            );
          }

          if (task.label === "Écrire une description") {
            return (
              <div
                key={task.label}
                className={`${className} ${styles.taskRowExpanded} ${
                  openTask === "description" ? styles.taskRowExpandedOpen : ""
                }`}
              >
                <button
                  type="button"
                  className={styles.taskRowHeader}
                  onClick={() => {
                    setDescriptionDraft(description);
                    setDescriptionStatus("");
                    setOpenTask(
                      openTask === "description" ? null : "description"
                    );
                  }}
                >
                  {content}
                </button>

                {openTask === "description" && (
                  <div className={styles.inlineEditor}>
                    <textarea
                      id="dashboard-description"
                      className={styles.inlineTextarea}
                      value={descriptionDraft}
                      onChange={(event) =>
                        setDescriptionDraft(event.target.value)
                      }
                      placeholder="Décrivez votre activité, votre approche et ce que vous proposez à vos clients…"
                      rows={6}
                      maxLength={1200}
                      autoFocus
                    />

                    <div className={styles.inlineEditorFooter}>
                      <span className={styles.inlineEditorStatus}>
                        {descriptionStatus ||
                          `${descriptionDraft.length} / 1200 caractères`}
                      </span>

                      <div className={styles.inlineEditorActions}>
                        <button
                          type="button"
                          className={styles.inlineSecondaryButton}
                          onClick={cancelDescription}
                          disabled={savingDescription}
                        >
                          Annuler
                        </button>

                        <button
                          type="button"
                          className={styles.inlinePrimaryButton}
                          onClick={saveDescription}
                          disabled={savingDescription}
                        >
                          {savingDescription
                            ? "Enregistrement…"
                            : "Enregistrer"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          }

          if (task.label === "Connecter les paiements") {
            const paymentsOpen = openTask === "payments";

            return (
              <div
                key={task.label}
                className={`${className} ${styles.taskRowExpanded} ${
                  paymentsOpen ? styles.taskRowExpandedOpen : ""
                }`}
              >
                <button
                  type="button"
                  className={styles.taskRowHeader}
                  onClick={() =>
                    setOpenTask(paymentsOpen ? null : "payments")
                  }
                >
                  {content}
                </button>

                {paymentsOpen && (
                  <div className={styles.inlineEditor}>
                    <DrimpayOnboarding
                      paymentReady={paymentReady}
                      onBack={() => setOpenTask(null)}
                    />
                  </div>
                )}
              </div>
            );
          }

          if (task.label === "Facturation") {
            const billingOpen = openTask === "billing";
            return (
              <div key={task.label} className={`${className} ${styles.taskRowExpanded} ${billingOpen ? styles.taskRowExpandedOpen : ""}`}>
                <button type="button" className={styles.taskRowHeader} aria-expanded={billingOpen} onClick={() => setOpenTask(billingOpen ? null : "billing")}>{content}</button>
                {billingOpen && <div className={styles.inlineEditor}><BillingSettingsOnboarding onCompletionChange={setBillingReady} /></div>}
              </div>
            );
          }

          if (!task.href) {
            return (
              <div
                key={task.label}
                className={className}
                aria-disabled="true"
              >
                {content}
              </div>
            );
          }

          return (
            <Link
              key={task.label}
              href={task.href}
              className={className}
            >
              {content}
            </Link>
          );
        })}
      </div>
      <GoogleReviewRequestAdminTest />
    </section>
  );
}
