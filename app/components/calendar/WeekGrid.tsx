import styles from "./calendar.module.css";
import EventCard from "./EventCard";
import {
  DAY_KEYS,
  type Availability,
  type CalendarAppointment,
  type ProviderBlock,
} from "./types";
import {
  addDays,
  dateToYMD,
  intervalsOverlap,
  isHourWithinAvailability,
  parisDateTimeToIso,
  getParisDateTimeParts,
} from "./utils";

const HOUR_HEIGHT = 66;

type WeekGridProps = {
  weekStart: Date;
  startHour: number;
  endHour: number;
  availability: Availability | null;
  blocks: ProviderBlock[];
  appointments: CalendarAppointment[];
  onBlockSelect: (blockId: string) => void;
  onAppointmentSelect: (appointment: CalendarAppointment) => void;
};

type EventLayout = {
  appointment: CalendarAppointment;
  dayIndex: number;
  startMinutes: number;
  durationMinutes: number;
  lane: number;
  laneCount: number;
};

function layoutAppointments(
  appointments: CalendarAppointment[],
  days: Date[]
): EventLayout[] {
  const dayIndexes = new Map(
    days.map((day, index) => [dateToYMD(day), index])
  );
  const byDay = new Map<number, EventLayout[]>();

  appointments.forEach((appointment) => {
    const startParts = getParisDateTimeParts(appointment.start_datetime);
    const dayIndex = dayIndexes.get(startParts.date);
    const durationMinutes =
      (Date.parse(appointment.end_datetime) -
        Date.parse(appointment.start_datetime)) /
      60000;

    if (dayIndex === undefined || durationMinutes <= 0) return;

    const layouts = byDay.get(dayIndex) ?? [];
    layouts.push({
      appointment,
      dayIndex,
      startMinutes: startParts.minutes,
      durationMinutes,
      lane: 0,
      laneCount: 1,
    });
    byDay.set(dayIndex, layouts);
  });

  return Array.from(byDay.values()).flatMap((dayLayouts) => {
    dayLayouts.sort(
      (first, second) => first.startMinutes - second.startMinutes
    );
    const laneEnds: number[] = [];

    dayLayouts.forEach((layout) => {
      const availableLane = laneEnds.findIndex(
        (endMinutes) => endMinutes <= layout.startMinutes
      );
      layout.lane = availableLane === -1 ? laneEnds.length : availableLane;
      laneEnds[layout.lane] = layout.startMinutes + layout.durationMinutes;
    });

    const laneCount = Math.max(1, laneEnds.length);
    return dayLayouts.map((layout) => ({ ...layout, laneCount }));
  });
}

function isSameDay(first: Date, second: Date) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

export default function WeekGrid({
  weekStart,
  startHour,
  endHour,
  availability,
  blocks,
  appointments,
  onBlockSelect,
  onAppointmentSelect,
}: WeekGridProps) {
  const days = Array.from({ length: 7 }, (_, index) =>
    addDays(weekStart, index)
  );

  const hours = Array.from(
    { length: Math.max(1, endHour - startHour) },
    (_, index) => startHour + index
  );

  const today = new Date();
  const eventLayouts = layoutAppointments(appointments, days);

  return (
    <div className={styles.weekGrid}>
      <div className={styles.weekHeader}>
        <div className={styles.timeHeader} />

        {days.map((day, dayIndex) => {
          const todayClass = isSameDay(day, today)
            ? styles.dayHeaderToday
            : "";
          const unavailableClass = availability?.[DAY_KEYS[dayIndex]]
            ? ""
            : styles.dayHeaderUnavailable;

          return (
            <div
              key={day.toISOString()}
              className={`${styles.dayHeader} ${todayClass} ${unavailableClass}`}
            >
              <span className={styles.dayName}>
                {new Intl.DateTimeFormat("fr-FR", {
                  weekday: "short",
                }).format(day)}
              </span>

              <strong className={styles.dayNumber}>
                {day.getDate()}
              </strong>

              {isSameDay(day, today) ? (
                <span className={styles.todayLabel}>Aujourd’hui</span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div
        className={styles.weekBody}
        style={{
          gridTemplateColumns: "72px repeat(7, minmax(110px, 1fr))",
        }}
      >
        {hours.map((hour) => (
          <div key={hour} className={styles.hourRow}>
            <div className={styles.timeLabel}>
              {String(hour).padStart(2, "0")}:00
            </div>

            {days.map((day, dayIndex) => {
              const dayAvailability = availability?.[DAY_KEYS[dayIndex]] ?? null;
              const isAvailable = isHourWithinAvailability(
                hour,
                dayAvailability
              );
              const dateYMD = dateToYMD(day);
              const cellStart = parisDateTimeToIso(
                dateYMD,
                `${String(hour).padStart(2, "0")}:00`
              );
              const cellEnd = parisDateTimeToIso(
                hour === 23 ? dateToYMD(addDays(day, 1)) : dateYMD,
                `${String((hour + 1) % 24).padStart(2, "0")}:00`
              );
              const block = blocks.find(
                (item) =>
                  intervalsOverlap(
                    item.start_datetime,
                    item.end_datetime,
                    cellStart,
                    cellEnd
                  )
              );
              const classes = [
                styles.timeSlot,
                !isAvailable ? styles.timeSlotUnavailable : "",
                block ? styles.timeSlotBlocked : "",
              ]
                .filter(Boolean)
                .join(" ");
              const stateLabel = block
                ? `, bloqué${block.reason ? ` : ${block.reason}` : ""}`
                : !isAvailable
                  ? ", indisponible"
                  : "";

              const ariaLabel = `${new Intl.DateTimeFormat("fr-FR", {
                weekday: "long",
                day: "numeric",
                month: "long",
              }).format(day)} à ${hour} heures${stateLabel}`;

              return block ? (
                <button
                  key={`${day.toISOString()}-${hour}`}
                  type="button"
                  className={classes}
                  data-state="blocked"
                  aria-label={`${ariaLabel}. Afficher ce blocage`}
                  onClick={() => onBlockSelect(block.id)}
                />
              ) : (
                <div
                  key={`${day.toISOString()}-${hour}`}
                  className={classes}
                  data-state={isAvailable ? "available" : "unavailable"}
                  aria-label={ariaLabel}
                />
              );
            })}
          </div>
        ))}

        <div className={styles.eventsLayer} aria-label="Rendez-vous confirmés">
          <div />
          {days.map((day, dayIndex) => (
            <div key={day.toISOString()} className={styles.eventDay}>
              {eventLayouts
                .filter((layout) => layout.dayIndex === dayIndex)
                .map((layout) => (
                  <EventCard
                    key={layout.appointment.id}
                    appointment={layout.appointment}
                    onSelect={onAppointmentSelect}
                    style={{
                      top:
                        ((layout.startMinutes - startHour * 60) / 60) *
                        HOUR_HEIGHT,
                      height:
                        (layout.durationMinutes / 60) * HOUR_HEIGHT,
                      left: `${(layout.lane / layout.laneCount) * 100}%`,
                      width: `calc(${100 / layout.laneCount}% - 4px)`,
                    }}
                  />
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
