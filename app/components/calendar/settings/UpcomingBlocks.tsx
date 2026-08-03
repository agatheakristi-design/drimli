"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Button from "@/app/components/ui/Button";
import type { ProviderBlock } from "../types";
import styles from "../calendar.module.css";

type UpcomingBlocksProps = {
  providerId: string;
  refreshKey: number;
  selectedBlockId: string | null;
  onDeleted: () => void;
};

function formatBlockDate(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

function formatBlockTime(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default function UpcomingBlocks({
  providerId,
  refreshKey,
  selectedBlockId,
  onDeleted,
}: UpcomingBlocksProps) {
  const [blocks, setBlocks] = useState<ProviderBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const selectedBlockRef = useRef<HTMLElement | null>(null);

  const loadBlocks = useCallback(async () => {
    const { data, error } = await supabase
      .from("provider_blocks")
      .select("id, start_datetime, end_datetime, reason")
      .eq("provider_id", providerId)
      .gte("end_datetime", new Date().toISOString())
      .order("start_datetime", { ascending: true });

    if (error) {
      setBlocks([]);
      setStatus(`Erreur : ${error.message}`);
    } else {
      setBlocks((data as ProviderBlock[]) ?? []);
    }

    setLoading(false);
  }, [providerId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      loadBlocks();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadBlocks, refreshKey]);

  useEffect(() => {
    selectedBlockRef.current?.scrollIntoView({ block: "nearest" });
  }, [blocks, selectedBlockId]);

  async function deleteBlock(id: string) {
    setDeletingId(id);
    setStatus("");

    const { error } = await supabase
      .from("provider_blocks")
      .delete()
      .eq("id", id)
      .eq("provider_id", providerId);

    setDeletingId(null);

    if (error) {
      setStatus(`Erreur : ${error.message}`);
      return;
    }

    onDeleted();
  }

  return (
    <section className={styles.settingsSection}>
      <div>
        <h3 className={styles.settingsTitle}>Blocages à venir</h3>
        <p className={styles.settingsIntro}>
          Consultez ou supprimez vos prochaines indisponibilités.
        </p>
      </div>

      {loading ? (
        <p className={styles.settingsStatus}>Chargement des blocages…</p>
      ) : blocks.length === 0 && !status ? (
        <p className={styles.settingsStatus}>Aucun blocage à venir.</p>
      ) : (
        <div className={styles.settingsBlocks}>
          {blocks.map((block) => (
            <article
              key={block.id}
              ref={block.id === selectedBlockId ? selectedBlockRef : null}
              className={`${styles.settingsBlock} ${
                block.id === selectedBlockId
                  ? styles.settingsBlockSelected
                  : ""
              }`}
            >
              <div className={styles.settingsBlockDetails}>
                <strong>{formatBlockDate(block.start_datetime)}</strong>
                <span>
                  {formatBlockTime(block.start_datetime)} à{" "}
                  {formatBlockTime(block.end_datetime)}
                </span>
                {block.reason ? <span>{block.reason}</span> : null}
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => deleteBlock(block.id)}
                disabled={deletingId === block.id}
              >
                {deletingId === block.id ? "Suppression…" : "Supprimer"}
              </Button>
            </article>
          ))}
        </div>
      )}

      {status ? (
        <p className={styles.settingsStatus} role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}
