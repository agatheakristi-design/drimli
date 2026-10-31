"use client";

import { useState } from "react";

export function usePageShare(slug?: string | null, published = false) {
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const pageUrl = slug && published
    ? `https://www.drimli.io/${encodeURIComponent(slug)}`
    : "";

  const shareMessage =
    `Bonjour, vous pouvez consulter mes prestations et réserver directement un rendez-vous sur ma page DRIMLI : ${pageUrl}`;

  async function sharePage() {
    if (!pageUrl) return;

    if (typeof navigator.share === "function" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      try {
        await navigator.share({
          title: "Ma page DRIMLI",
          text: "Découvrez mes prestations et réservez un rendez-vous.",
          url: pageUrl,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    setShareOpen((current) => !current);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
    } catch {
      setCopied(false);
      window.prompt("Copiez le lien de votre page :", pageUrl);
    }
  }

  return { pageUrl, shareMessage, shareOpen, copied, sharePage, copyLink };
}
