"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Toolbar from "./Toolbar";
import WeekGrid from "./WeekGrid";
import CalendarPanel from "./CalendarPanel";
import type {
  Availability,
  CalendarAppointment,
  CalendarPanelMode,
  CalendarSettingsSection,
  ProviderBlock,
} from "./types";
import {
  addDays,
  dateToYMD,
  getCalendarHourRange,
  parisDateTimeToIso,
} from "./utils";
import styles from "./calendar.module.css";

type AppointmentRow = {
  id: string;
  product_id: string | null;
  client_name: string | null;
  client_email: string | null;
  start_datetime: string;
  end_datetime: string;
  status: string | null;
  video_provider: string | null;
  video_join_url: string | null;
  video_room_status: "closed" | "open" | "locked";
};

type ProductRow = {
  id: string;
  title: string | null;
};

function startOfWeek(date: Date) {
  const result = new Date(date);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;

  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);

  return result;
}

function formatWeekLabel(start: Date) {
  const end = addDays(start, 6);

  const startLabel = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
  }).format(start);

  const endLabel = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(end);

  return `Semaine du ${startLabel} au ${endLabel}`;
}

export default function Calendar() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [panelMode, setPanelMode] = useState<CalendarPanelMode | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [blocks, setBlocks] = useState<ProviderBlock[]>([]);
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [settingsSection, setSettingsSection] =
    useState<CalendarSettingsSection | null>("availability");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedAppointment, setSelectedAppointment] =
    useState<CalendarAppointment | null>(null);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        setProviderId(data.session?.user.id ?? null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!providerId) return;

    let cancelled = false;
    const weekEnd = addDays(weekStart, 7);
    const weekStartIso = parisDateTimeToIso(dateToYMD(weekStart), "00:00");
    const weekEndIso = parisDateTimeToIso(dateToYMD(weekEnd), "00:00");

    async function loadCalendarData() {
      const [profileResult, blocksResult, appointmentsResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("availability")
          .eq("provider_id", providerId)
          .maybeSingle<{ availability: Availability | null }>(),
        supabase
          .from("provider_blocks")
          .select("id, start_datetime, end_datetime, reason")
          .eq("provider_id", providerId)
          .lt("start_datetime", weekEndIso)
          .gt("end_datetime", weekStartIso)
          .order("start_datetime", { ascending: true }),
        supabase
          .from("appointments")
          .select(
            "id, product_id, client_name, client_email, start_datetime, end_datetime, status, video_provider, video_join_url, video_room_status"
          )
          .eq("provider_id", providerId)
          .eq("status", "confirmed")
          .lt("start_datetime", weekEndIso)
          .gt("end_datetime", weekStartIso)
          .order("start_datetime", { ascending: true }),
      ]);

      if (cancelled) return;

      const appointmentRows = appointmentsResult.error
        ? []
        : ((appointmentsResult.data as AppointmentRow[]) ?? []);
      const productIds = Array.from(
        new Set(
          appointmentRows
            .map((appointment) => appointment.product_id)
            .filter((id): id is string => Boolean(id))
        )
      );
      const productResult =
        productIds.length > 0
          ? await supabase
              .from("products")
              .select("id, title")
              .in("id", productIds)
          : { data: [], error: null };

      if (cancelled) return;

      const serviceNames = new Map(
        ((productResult.data as ProductRow[] | null) ?? []).map((product) => [
          product.id,
          product.title ?? "Service",
        ])
      );

      setAvailability(profileResult.data?.availability ?? null);
      setBlocks(
        blocksResult.error
          ? []
          : ((blocksResult.data as ProviderBlock[]) ?? [])
      );
      setAppointments(
        appointmentRows.map((appointment) => ({
          id: appointment.id,
          product_id: appointment.product_id,
          serviceName:
            (appointment.product_id
              ? serviceNames.get(appointment.product_id)
              : null) ?? "Prestation indisponible",
          clientName:
            appointment.client_name?.trim() || "Client non renseigné",
          clientEmail: appointment.client_email?.trim() || null,
          start_datetime: appointment.start_datetime,
          end_datetime: appointment.end_datetime,
          status: "confirmed" as const,
          videoProvider: appointment.video_provider,
          videoJoinUrl: appointment.video_join_url,
          videoRoomStatus: appointment.video_room_status,
        }))
      );
    }

    loadCalendarData();

    return () => {
      cancelled = true;
    };
  }, [providerId, refreshKey, weekStart]);

  const weekLabel = useMemo(
    () => formatWeekLabel(weekStart),
    [weekStart]
  );

  const { startHour, endHour } = useMemo(
    () => getCalendarHourRange(availability, appointments),
    [appointments, availability]
  );

  return (
    <section className={styles.calendar}>
      <Toolbar
        label={weekLabel}
        onPrevious={() => {
          setWeekStart((current) => addDays(current, -7));
          if (panelMode === "appointment") setPanelMode(null);
        }}
        onNext={() => {
          setWeekStart((current) => addDays(current, 7));
          if (panelMode === "appointment") setPanelMode(null);
        }}
        onToday={() => {
          setWeekStart(startOfWeek(new Date()));
          setPanelMode(null);
        }}
        onSettings={() => {
          if (panelMode !== "settings") {
            setSettingsSection("availability");
            setSelectedBlockId(null);
            setSelectedAppointment(null);
          }
          setPanelMode(panelMode === "settings" ? null : "settings");
        }}
        onRefunds={() => {
          setSelectedAppointment(null);
          setPanelMode(panelMode === "refunds" ? null : "refunds");
        }}
      />

      <main className={styles.calendarContent}>
        <WeekGrid
          weekStart={weekStart}
          startHour={startHour}
          endHour={endHour}
          availability={availability}
          blocks={blocks}
          appointments={appointments}
          onBlockSelect={(blockId) => {
            setSelectedBlockId(blockId);
            setSettingsSection("upcoming-blocks");
            setSelectedAppointment(null);
            setPanelMode("settings");
          }}
          onAppointmentSelect={(appointment) => {
            setSelectedAppointment(appointment);
            setPanelMode("appointment");
          }}
        />

        <CalendarPanel
          open={panelMode !== null}
          mode={panelMode ?? "settings"}
          appointment={selectedAppointment}
          onClose={() => setPanelMode(null)}
          onCalendarChanged={() =>
            setRefreshKey((current) => current + 1)
          }
          availability={availability}
          openSection={settingsSection}
          onSectionChange={setSettingsSection}
          selectedBlockId={selectedBlockId}
        />
      </main>
    </section>
  );
}
