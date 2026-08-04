"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import ServiceBookingCalendar from "./ServiceBookingCalendar";
import styles from "./ExpandableServiceList.module.css";

export type PublicService = {
  id: string;
  title: string | null;
  description: string | null;
  duration_minutes: number | null;
  price_cents: number | null;
};

function priceLabel(priceCents: number | null) {
  if (priceCents == null) return null;
  return `${(priceCents / 100).toFixed(0)} €`;
}

function durationLabel(durationMinutes: number | null) {
  if (!durationMinutes) return null;
  return `${durationMinutes} min`;
}

export default function ExpandableServiceList({
  providerId,
  services,
}: {
  providerId: string;
  services: PublicService[];
}) {
  const [openServiceId, setOpenServiceId] = useState<string | null>(null);
  const instanceId = useId().replaceAll(":", "");

  return (
    <div className={styles.list}>
      {services.map((service, index) => {
        const isOpen = openServiceId === service.id;
        const buttonId = `${instanceId}-service-${index}`;
        const panelId = `${instanceId}-service-panel-${index}`;
        const duration = durationLabel(service.duration_minutes);
        const price = priceLabel(service.price_cents);

        return (
          <article
            key={service.id}
            className={`${styles.card} ${isOpen ? styles.cardOpen : ""}`}
          >
            <button
              id={buttonId}
              type="button"
              className={styles.trigger}
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpenServiceId(isOpen ? null : service.id)}
            >
              <span className={styles.triggerContent}>
                <span className={styles.titleRow}>
                  <strong>{service.title ?? "Prestation"}</strong>
                  {price ? <span className={styles.price}>{price}</span> : null}
                </span>

                {service.description ? (
                  <span className={styles.preview}>{service.description}</span>
                ) : null}

                {duration ? <span className={styles.duration}>{duration}</span> : null}
              </span>

              <ChevronDown
                className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ""}`}
                size={18}
                aria-hidden="true"
              />
            </button>

            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              aria-hidden={!isOpen}
              inert={!isOpen}
              className={`${styles.panel} ${isOpen ? styles.panelOpen : ""}`}
            >
              <div className={styles.panelInner}>
                {isOpen ? (
                  <div className={styles.booking}>
                    <ServiceBookingCalendar
                      providerId={providerId}
                      serviceId={service.id}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
