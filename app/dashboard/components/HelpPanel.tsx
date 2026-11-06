"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import Button from "@/app/components/ui/Button";
import Input from "@/app/components/ui/Input";
import Textarea from "@/app/components/ui/Textarea";
import styles from "./dashboard.module.css";

const faq = [
  { question: "Comment partager ma page de réservation ?", answer: "Dans la vue d’ensemble, utilisez « Copier le lien ». Le lien est disponible lorsque votre page publique est publiée." },
  { question: "Où retrouver mes rendez-vous ?", answer: "Ouvrez « Mes rendez-vous » dans le menu, puis sélectionnez un rendez-vous pour consulter ses détails." },
  { question: "Comment déplacer ou annuler un rendez-vous ?", answer: "Dans les détails d’un rendez-vous confirmé, utilisez « Déplacer le rendez-vous » ou « Annuler le rendez-vous ». Consultez les informations affichées avant de confirmer l’annulation." },
  { question: "Où télécharger les factures ?", answer: "La facture client, lorsqu’elle est disponible, se trouve dans les détails du rendez-vous. Pour vos factures de commissions Drimli, cliquez sur votre nom en bas du menu." },
];
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
type RequestRow = { id: string; subject: string; message: string; created_at: string; help_replies: { id: string; message: string; created_at: string }[] };

export default function HelpPanel({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(typeof document === "undefined" ? null : document.activeElement as HTMLElement | null);
  const submitting = useRef(false);
  const [query, setQuery] = useState("");
  const [contact, setContact] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const previous = previousFocus.current;
    dialog.current?.showModal();
    return () => { previous?.focus(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data, error } = await supabase.from("help_requests")
          .select("id,subject,message,created_at,help_replies(id,message,created_at)")
          .order("created_at", { ascending: false }).limit(50);
        if (error) throw error;
        if (!cancelled) setRequests(data ?? []);
      } catch {
        if (!cancelled) setError("Historique indisponible. Fermez puis rouvrez l’aide pour réessayer.");
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !subject.trim() || !message.trim()) return;
    submitting.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Session unavailable");
      const response = await fetch("/api/dashboard/help-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ subject: subject.trim(), message: message.trim() }),
      });
      const result = await response.json();
      const data = result.request;
      if (!response.ok || !data?.id) throw new Error("Envoi non confirmé");
      setRequests((previous) => [{ ...data, help_replies: [] }, ...previous].slice(0, 50));
      setSubject(""); setMessage(""); setContact(false);
      setNotice("Message envoyé. Vous recevrez un e-mail lorsqu’une réponse sera disponible ici.");
    } catch { setError("Envoi non confirmé. Consultez vos demandes avant de réessayer ; votre texte est conservé."); }
    finally { submitting.current = false; setBusy(false); }
  }

  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  const results = faq.filter((item) => words.every((word) => normalize(`${item.question} ${item.answer}`).includes(word)));
  return (
    <dialog ref={dialog} className={`${styles.professionalPanel} ${styles.helpDialog}`} aria-labelledby="help-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); } }}>
      <header className={styles.professionalPanelHeader}>
        <div><h2 id="help-title">Aide</h2><p>Comment pouvons-nous vous aider ?</p></div>
        <button type="button" className={styles.professionalPanelClose} onClick={onClose} aria-label="Fermer l’aide"><X size={20} aria-hidden="true" /></button>
      </header>
      <div className={`${styles.professionalPanelBody} ${styles.helpBody}`}>
        <label htmlFor="help-search">Rechercher une réponse</label>
        <Input id="help-search" type="search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rendez-vous, facture…" />
        <div aria-live="polite">{results.length === 0 ? <p>Aucune réponse trouvée.</p> : null}</div>
        {results.map((item) => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}
        <p>Vous n’avez pas trouvé votre réponse ?</p>
        {!contact ? <Button variant="secondary" onClick={() => { setContact(true); setNotice(""); }}>Nous écrire</Button> : (
          <form onSubmit={send} className={styles.helpBody}>
            <label htmlFor="help-subject">Sujet</label>
            <Input id="help-subject" required maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} />
            <label htmlFor="help-message">Votre message</label>
            <Textarea id="help-message" required maxLength={4000} rows={5} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Expliquez-nous ce qui se passe…" />
            <small>N’indiquez pas de mot de passe ni de coordonnées bancaires.</small>
            <Button type="submit" disabled={busy || !subject.trim() || !message.trim()}>{busy ? "Envoi…" : "Envoyer"}</Button>
          </form>
        )}
        {error ? <p role="alert">{error}</p> : null}
        <p role="status">{notice}</p>
        <h3>Mes demandes</h3>
        <p>Les 50 demandes les plus récentes. Vous recevrez un e-mail lorsqu’une réponse sera disponible ici.</p>
        {loading ? <p>Chargement…</p> : requests.length === 0 ? <p>Aucune demande chargée.</p> : null}
        {requests.map((request) => <details key={request.id}>
          <summary>{request.subject} — {request.help_replies.length ? "Répondu" : "En attente de réponse"}</summary>
          <small>{new Date(request.created_at).toLocaleString("fr-FR")}</small>
          <p className={styles.helpMessage}>{request.message}</p>
          {[...request.help_replies].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((reply) => <article key={reply.id}><strong>Réponse Drimli</strong><p className={styles.helpMessage}>{reply.message}</p><small>{new Date(reply.created_at).toLocaleString("fr-FR")}</small></article>)}
        </details>)}
      </div>
    </dialog>
  );
}
