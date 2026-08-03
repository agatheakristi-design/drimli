"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Accordion, { type AccordionItem } from "@/app/components/ui/Accordion";
import AvailabilitySettings from "./settings/AvailabilitySettings";
import BlocksSettings from "./settings/BlocksSettings";
import UpcomingBlocks from "./settings/UpcomingBlocks";
import type { Availability, CalendarSettingsSection } from "./types";
import styles from "./calendar.module.css";

type SettingsProps = {
  onCalendarChanged?: () => void;
  availability: Availability | null;
  openSection: CalendarSettingsSection | null;
  onSectionChange: (section: CalendarSettingsSection | null) => void;
  selectedBlockId: string | null;
};

export default function Settings({
  onCalendarChanged,
  availability,
  openSection,
  onSectionChange,
  selectedBlockId,
}: SettingsProps) {
  const [providerId, setProviderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      const { data, error } = await supabase.auth.getSession();

      if (cancelled) return;

      if (error) {
        setAuthError(`Impossible de vérifier votre session : ${error.message}`);
      } else if (!data.session) {
        setAuthError("Vous devez être connecté pour configurer le calendrier.");
      } else {
        setProviderId(data.session.user.id);
      }

      setLoading(false);
    }

    loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className={styles.settingsStatus}>Chargement…</p>;
  }

  if (!providerId) {
    return <p className={styles.settingsMessage}>{authError}</p>;
  }

  const items: AccordionItem[] = [
    {
      id: "availability",
      title: "Horaires",
      children: (
        <AvailabilitySettings
          providerId={providerId}
          onSaved={onCalendarChanged}
        />
      ),
    },
    {
      id: "blocks",
      title: "Bloquer un créneau",
      children: (
        <BlocksSettings
          providerId={providerId}
          availability={availability}
          onCreated={() => {
            setRefreshKey((current) => current + 1);
            onCalendarChanged?.();
          }}
        />
      ),
    },
    {
      id: "upcoming-blocks",
      title: "Blocages à venir",
      children: (
        <UpcomingBlocks
          providerId={providerId}
          refreshKey={refreshKey}
          selectedBlockId={selectedBlockId}
          onDeleted={() => {
            setRefreshKey((current) => current + 1);
            onCalendarChanged?.();
          }}
        />
      ),
    },
  ];

  return (
    <Accordion
      items={items}
      defaultOpen="availability"
      openItem={openSection}
      onOpenChange={(itemId) =>
        onSectionChange(itemId as CalendarSettingsSection | null)
      }
    />
  );
}
