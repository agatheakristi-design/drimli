"use client";

import Link from "next/link";
import { useState } from "react";
import Logo from "@/app/components/ui/Logo";

type Language = "en" | "fr";

const translations = {
  en: {
    titleFirst: "Your business.",
    titleSecond: "Everywhere.",
    book: "Book",
    pay: "Pay",
    meet: "Meet",
    google: "Continue with Google",
    apple: "Continue with Apple",
    email: "Continue with email",
    free: "Free. No subscription.",
    signIn: "Sign in",
    comingSoon: "Coming soon",
    tagline:
      "Drimli is the all-in-one platform to manage your appointments, payments and video meetings.",
    privacy: "Privacy",
    terms: "Terms",
  },
  fr: {
    titleFirst: "Ton business.",
    titleSecond: "Partout.",
    book: "Réserver",
    pay: "Payer",
    meet: "Échanger",
    google: "Continuer avec Google",
    apple: "Continuer avec Apple",
    email: "Continuer avec l’e-mail",
    free: "Gratuit. Sans abonnement.",
    signIn: "Se connecter",
    comingSoon: "Bientôt disponible",
    tagline:
      "Drimli, la plateforme gratuite qui réunit réservation, paiement et visio pour développer son business en ligne.",
    privacy: "Confidentialité",
    terms: "Conditions",
  },
} satisfies Record<Language, Record<string, string>>;

export default function LandingContent() {
  const [language, setLanguage] = useState<Language>("en");
  const [status, setStatus] = useState("");

  const t = translations[language];

  function showComingSoon() {
    setStatus(t.comingSoon);
  }

  return (
    <main className="min-h-[100svh] bg-white text-[#101010]">
      <div className="grid min-h-[100svh] grid-rows-[auto_1fr_auto] px-[34px] pb-[22px] pt-7 max-sm:px-[18px] max-sm:pb-[18px] max-sm:pt-[22px]">
        <header className="flex min-h-9 items-center justify-between">
          <Logo className="text-[23px] leading-none tracking-[-0.02em]" />

          <div className="flex items-center gap-4">
            <div
              className="inline-flex items-center gap-1 rounded-full border border-black/[0.015] bg-[#f4f4f6] p-[3px]"
              aria-label="Language"
            >
              {(["en", "fr"] as const).map((value) => {
                const active = language === value;

                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setLanguage(value);
                      setStatus("");
                    }}
                    aria-pressed={active}
                    className={[
                      "min-h-[29px] rounded-full px-[10px] text-[10px] font-semibold transition",
                      active
                        ? "bg-white text-[#111] shadow-[0_1px_5px_rgba(0,0,0,0.08)]"
                        : "text-[#929298] hover:text-[#111]",
                    ].join(" ")}
                  >
                    {value.toUpperCase()}
                  </button>
                );
              })}
            </div>

            <Link
              href="/login"
              className="text-[13px] font-medium text-[#8b8b90] transition hover:text-[#111]"
            >
              {t.signIn}
            </Link>
          </div>
        </header>

        <section className="grid place-items-center py-[68px] max-sm:py-[54px]">
          <div className="w-full max-w-[900px] text-center">
            <h1 className="drimli-rise m-0 text-[clamp(58px,7.6vw,92px)] font-semibold leading-[0.93] tracking-[-0.04em] max-sm:text-[clamp(44px,13vw,64px)] max-sm:leading-[0.94]">
              <span className="block">{t.titleFirst}</span>
              <span className="block">{t.titleSecond}</span>
            </h1>

            <p className="drimli-rise-delay mt-8 inline-flex items-center justify-center gap-[13px] whitespace-nowrap text-[clamp(19px,2vw,23px)] font-semibold leading-none tracking-[-0.035em] max-sm:mt-[25px] max-sm:text-[clamp(18px,5.4vw,21px)]">
              <span>{t.book}</span>
              <span className="translate-y-[-0.02em] text-[0.72em] font-medium text-[#555]">
                •
              </span>
              <span>{t.pay}</span>
              <span className="translate-y-[-0.02em] text-[0.72em] font-medium text-[#555]">
                •
              </span>
              <span>{t.meet}</span>
            </p>

            <div className="drimli-actions mx-auto mt-11 grid w-full max-w-[372px] gap-[10px] max-sm:mt-[38px]">
              <button
                type="button"
                onClick={showComingSoon}
                className="flex min-h-[58px] w-full items-center justify-center gap-[10px] rounded-[17px] border-0 bg-[#111] px-5 text-[13px] font-semibold text-white shadow-[0_12px_28px_rgba(0,0,0,0.115)] transition hover:-translate-y-px hover:bg-black hover:shadow-[0_16px_34px_rgba(0,0,0,0.15)] active:translate-y-0 active:scale-[0.994]"
              >
                <svg
                  className="h-[18px] w-[18px] shrink-0"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    fill="#4285F4"
                    d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-2 3.02v2.53h3.24c1.9-1.75 2.98-4.33 2.98-7.39Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 22c2.7 0 4.98-.9 6.64-2.38l-3.24-2.53c-.9.6-2.05.96-3.4.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.6A10 10 0 0 0 12 22Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M6.39 13.92A6.02 6.02 0 0 1 6.08 12c0-.67.11-1.32.31-1.92v-2.6H3.04A10 10 0 0 0 2 12c0 1.61.39 3.13 1.04 4.52l3.35-2.6Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.95c1.47 0 2.78.5 3.82 1.49l2.86-2.87A9.59 9.59 0 0 0 12 2a10 10 0 0 0-8.96 5.48l3.35 2.6C7.18 7.71 9.39 5.95 12 5.95Z"
                  />
                </svg>

                <span>{t.google}</span>
              </button>

              <button
                type="button"
                onClick={showComingSoon}
                className="flex min-h-[50px] w-full items-center justify-center gap-[9px] rounded-[18px] border border-[#ececef] bg-white px-5 text-[13px] font-semibold text-[#66666c] shadow-[0_1px_3px_rgba(0,0,0,0.025)] transition hover:-translate-y-px hover:border-[#e1e1e5] hover:bg-[#f8f8f9] hover:text-[#111] active:translate-y-0 active:scale-[0.994]"
              >
                <svg
                  className="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M17.05 12.54c-.03-3.12 2.55-4.64 2.67-4.71a5.72 5.72 0 0 0-4.5-2.43c-1.89-.2-3.72 1.13-4.68 1.13-.98 0-2.46-1.11-4.05-1.08a5.95 5.95 0 0 0-5 3.05c-2.18 3.77-.55 9.31 1.53 12.36 1.04 1.49 2.25 3.15 3.84 3.09 1.55-.06 2.13-.99 4-.99 1.84 0 2.39.99 4.01.95 1.67-.03 2.72-1.49 3.72-2.99a12.3 12.3 0 0 0 1.7-3.47 5.36 5.36 0 0 1-3.24-4.91ZM13.98 3.4A5.45 5.45 0 0 0 15.23-.5a5.55 5.55 0 0 0-3.59 1.85 5.2 5.2 0 0 0-1.28 3.75 4.59 4.59 0 0 0 3.62-1.7Z" />
                </svg>

                <span>{t.apple}</span>
              </button>

              <Link
                href="/signup"
                className="flex min-h-[50px] w-full items-center justify-center rounded-[18px] border border-[#ececef] bg-white px-5 text-[13px] font-semibold text-[#66666c] shadow-[0_1px_3px_rgba(0,0,0,0.025)] transition hover:-translate-y-px hover:border-[#e1e1e5] hover:bg-[#f8f8f9] hover:text-[#111] active:translate-y-0 active:scale-[0.994]"
              >
                {t.email}
              </Link>
            </div>

            <div className="mt-[17px] min-h-[16px] text-[10px] tracking-[0.01em] text-[#9c9ca2]">
              {status || t.free}
            </div>
          </div>
        </section>

        <footer className="flex flex-col items-center pt-2 text-center">
          <p className="mb-[18px] max-w-[820px] text-[16px] font-medium leading-[1.5] tracking-[-0.024em] text-[#4b4b52] max-sm:text-[14px]">
            {t.tagline}
          </p>

          <div className="text-[9px] text-[#b3b3b8]">
            <span>{t.privacy}</span>
            <span className="px-2">·</span>
            <span>{t.terms}</span>
          </div>
        </footer>
      </div>

      <style jsx>{`
        .drimli-rise {
          opacity: 0;
          transform: translateY(16px);
          animation: rise-in 760ms cubic-bezier(0.22, 1, 0.36, 1) 120ms
            forwards;
        }

        .drimli-rise-delay {
          opacity: 0;
          transform: translateY(10px);
          animation: rise-in 680ms cubic-bezier(0.22, 1, 0.36, 1) 250ms
            forwards;
        }

        .drimli-actions {
          opacity: 0;
          transform: translateY(10px);
          animation: rise-in 680ms cubic-bezier(0.22, 1, 0.36, 1) 360ms
            forwards;
        }

        @keyframes rise-in {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .drimli-rise,
          .drimli-rise-delay,
          .drimli-actions {
            animation-duration: 0.01ms;
            animation-delay: 0ms;
          }
        }
      `}</style>
    </main>
  );
}
