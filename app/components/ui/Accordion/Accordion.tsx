"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import styles from "./accordion.module.css";

export type AccordionItem = {
  id: string;
  title: string;
  children: ReactNode;
};

type AccordionProps = {
  items: AccordionItem[];
  defaultOpen?: string;
  openItem?: string | null;
  onOpenChange?: (itemId: string | null) => void;
};

export default function Accordion({
  items,
  defaultOpen,
  openItem,
  onOpenChange,
}: AccordionProps) {
  const [internalOpenId, setInternalOpenId] = useState<string | null>(
    defaultOpen ?? null
  );
  const instanceId = useId().replace(/:/g, "");
  const openId = openItem === undefined ? internalOpenId : openItem;

  function changeOpenItem(itemId: string | null) {
    if (openItem === undefined) setInternalOpenId(itemId);
    onOpenChange?.(itemId);
  }

  return (
    <div className={styles.accordion}>
      {items.map((item, index) => {
        const isOpen = openId === item.id;
        const buttonId = `${instanceId}-accordion-button-${index}`;
        const panelId = `${instanceId}-accordion-panel-${index}`;

        return (
          <section key={item.id} className={styles.item}>
            <h3 className={styles.heading}>
              <button
                id={buttonId}
                type="button"
                className={styles.trigger}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => changeOpenItem(isOpen ? null : item.id)}
              >
                <span>{item.title}</span>
                <ChevronDown
                  className={`${styles.chevron} ${
                    isOpen ? styles.chevronOpen : ""
                  }`}
                  size={18}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              </button>
            </h3>

            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              aria-hidden={!isOpen}
              inert={!isOpen}
              className={`${styles.content} ${
                isOpen ? styles.contentOpen : ""
              }`}
            >
              <div className={styles.contentInner}>{item.children}</div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
