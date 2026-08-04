"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import Button from "@/app/components/ui/Button";
import styles from "./ServiceBookingCalendar.module.css";

type Slot = {
  start: string;
  end: string;
};

const TIME_ZONE = "Europe/Paris";
const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

function parisDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parseDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month: month - 1, day };
}

function dateString(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthLabel(year: number, month: number) {
  const label = new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function longDateLabel(date: string) {
  const { year, month, day } = parseDate(date);
  const label = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month, day)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function timeLabel(isoDate: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIME_ZONE,
  }).format(new Date(isoDate));
}

export default function ServiceBookingCalendar({
  providerId,
  serviceId,
}: {
  providerId: string;
  serviceId: string;
}) {
  const router = useRouter();
  const today = useMemo(() => parisDateString(), []);
  const todayParts = useMemo(() => parseDate(today), [today]);
  const [visibleMonth, setVisibleMonth] = useState({
    year: todayParts.year,
    month: todayParts.month,
  });
  const [selectedDate, setSelectedDate] = useState(today);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const days = useMemo(() => {
    const { year, month } = visibleMonth;
    const dayCount = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const mondayOffset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
    return Array.from({ length: mondayOffset + dayCount }, (_, index) =>
      index < mondayOffset ? null : index - mondayOffset + 1
    );
  }, [visibleMonth]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ providerId, serviceId, date: selectedDate });

    async function loadSlots() {
      setIsLoading(true);
      setLoadError(false);
      setSelectedSlot(null);

      try {
        const response = await fetch(`/api/slots?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Slots request failed");
        const payload: unknown = await response.json();
        setSlots(Array.isArray(payload) ? (payload as Slot[]) : []);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSlots([]);
        setLoadError(true);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void loadSlots();
    return () => controller.abort();
  }, [providerId, selectedDate, serviceId]);

  const isCurrentMonth =
    visibleMonth.year === todayParts.year && visibleMonth.month === todayParts.month;

  function changeMonth(offset: number) {
    const next = new Date(Date.UTC(visibleMonth.year, visibleMonth.month + offset, 1));
    const year = next.getUTCFullYear();
    const month = next.getUTCMonth();
    setVisibleMonth({ year, month });
    setSelectedDate(
      year === todayParts.year && month === todayParts.month
        ? today
        : dateString(year, month, 1)
    );
  }

  function reserveSelectedSlot() {
    if (!selectedSlot) return;
    const query = new URLSearchParams({
      date: selectedDate,
      start: selectedSlot.start,
      end: selectedSlot.end,
    });
    router.push(`/reserver/${serviceId}?${query.toString()}`);
  }

  return (
    <section aria-label="Choisir un créneau">
      <div className={styles.heading}>
        <h3>Choisir un créneau</h3>
        <span>Fuseau : {TIME_ZONE}</span>
      </div>

      <div className={styles.bookingModule}>
        <div className={styles.calendarColumn}>
          <div className={styles.monthHeader}>
            <strong>{monthLabel(visibleMonth.year, visibleMonth.month)}</strong>
            <div className={styles.monthNavigation}>
              <button
                type="button"
                aria-label="Mois précédent"
                disabled={isCurrentMonth}
                onClick={() => changeMonth(-1)}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Mois suivant"
                onClick={() => changeMonth(1)}
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className={styles.weekdays} aria-hidden="true">
            {WEEKDAYS.map((day, index) => (
              <span key={`${day}-${index}`}>{day}</span>
            ))}
          </div>

          <div className={styles.days}>
            {days.map((day, index) => {
              if (day === null) return <span key={`empty-${index}`} />;
              const value = dateString(visibleMonth.year, visibleMonth.month, day);
              const isPast = value < today;
              const isSelected = value === selectedDate;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={isPast}
                  aria-label={longDateLabel(value)}
                  aria-pressed={isSelected}
                  className={isSelected ? styles.selectedDay : undefined}
                  onClick={() => setSelectedDate(value)}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.slotsColumn}>
          <h4>{longDateLabel(selectedDate)}</h4>
          <div className={styles.slotList} aria-live="polite" aria-busy={isLoading}>
            {isLoading ? <p className={styles.state}>Chargement des créneaux…</p> : null}
            {!isLoading && loadError ? (
              <p className={styles.state}>Impossible de charger les créneaux.</p>
            ) : null}
            {!isLoading && !loadError && slots.length === 0 ? (
              <p className={styles.state}>Aucun créneau disponible ce jour.</p>
            ) : null}
            {!isLoading && !loadError
              ? slots.map((slot) => {
                  const isSelected = selectedSlot?.start === slot.start;
                  return (
                    <button
                      key={`${slot.start}-${slot.end}`}
                      type="button"
                      aria-pressed={isSelected}
                      className={`${styles.slot} ${isSelected ? styles.selectedSlot : ""}`}
                      onClick={() => setSelectedSlot(slot)}
                    >
                      {timeLabel(slot.start)}
                    </button>
                  );
                })
              : null}
          </div>

          <Button
            type="button"
            disabled={!selectedSlot}
            className={styles.reserveButton}
            onClick={reserveSelectedSlot}
          >
            Réserver ce créneau
          </Button>
        </div>
      </div>
    </section>
  );
}
