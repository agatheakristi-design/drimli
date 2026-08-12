"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./home/home.module.css";

type Language = "en" | "fr";
type MenuName = "solutions" | "product" | "pricing";

const copy = {
  en: {
    pageTitle: "Drimli — Create your account",
    solutions: "Solutions",
    product: "Product",
    pricing: "Pricing",
    login: "Log in",
    signup: "Sign up",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    solutionsHeading: "For independent professionals",
    solutionsItems: [
      ["Coaches", "Sell and manage sessions without administrative friction."],
      ["Consultants", "Turn expertise into bookable, paid remote consultations."],
      ["Therapists", "Manage appointments, payments and video consultations in one place."],
      ["Psychologists", "Offer a seamless experience before, during and after each session."],
      ["Nutritionists", "Manage bookings, follow-ups and remote consultations."],
      ["Trainers", "Schedule, sell and deliver training sessions online."],
      ["Lawyers", "Offer secure remote consultations and get paid in advance."],
      ["Architects", "Organise project consultations and client meetings online."],
    ],
    solutionsFooter: "...and anyone who wants to grow their business remotely",
    productItems: [
      ["Calendar", "Clients book online. Your calendar stays automatically up to date."],
      ["Video", "Unlimited HD video consultations, built in."],
      ["Payments", "Secure remote payments before every consultation."],
      ["Automatic invoicing", "Compliant e-invoices generated and sent automatically."],
      ["Google review generation", "Automatically invite clients to leave Google reviews."],
    ],
    productFooter: "Everything you need to sell remote sessions",
    free: "Free.",
    pricingPromise: "We only succeed when you do.",
    pricingLines: ["No subscription.", "No monthly fee.", "5% per transaction."],
    pricingFooter: "Start today",
    hero: "Your business. Worldwide.",
    promise: "Everything you need to sell remote sessions",
    google: "Continue with Google",
    apple: "Continue with Apple",
    email: "Continue with email",
    freeStatement: "Free. No subscription. We only succeed when you do.",
    privacy: "Privacy",
    terms: "Terms",
    comingSoon: "Coming soon",
    googleError: "Unable to continue with Google.",
  },
  fr: {
    pageTitle: "Drimli — Créer votre compte",
    solutions: "Solutions",
    product: "Produit",
    pricing: "Tarifs",
    login: "Se connecter",
    signup: "Créer un compte",
    openMenu: "Ouvrir le menu",
    closeMenu: "Fermer le menu",
    solutionsHeading: "Pour les professionnels indépendants",
    solutionsItems: [
      ["Coachs", "Vendez et gérez vos séances sans friction administrative."],
      ["Consultants", "Transformez votre expertise en consultations réservables et payées."],
      ["Thérapeutes", "Gérez rendez-vous, paiements et visio au même endroit."],
      ["Psychologues", "Offrez une expérience fluide avant, pendant et après chaque séance."],
      ["Nutritionnistes", "Gérez réservations, suivis et consultations à distance."],
      ["Formateurs", "Planifiez, vendez et animez vos formations en ligne."],
      ["Avocats", "Proposez des consultations sécurisées et payées à l’avance."],
      ["Architectes", "Organisez vos consultations de projet et rendez-vous clients."],
    ],
    solutionsFooter:
      "...et plus largement tous les professionnels qui développent leur activité à distance",
    productItems: [
      ["Calendrier", "Vos clients réservent en ligne. Votre agenda se met à jour automatiquement."],
      ["Visio illimitée", "Consultations vidéo HD intégrées, sans limite."],
      ["Paiement à distance", "Encaissez en toute sécurité avant chaque consultation."],
      ["Facturation électronique automatique", "Factures conformes générées et envoyées automatiquement."],
      ["Générateur automatique d’avis Google", "Invitez automatiquement vos clients et multipliez vos avis."],
    ],
    productFooter: "Tout ce qu’il faut pour vendre vos consultations à distance",
    free: "Gratuit.",
    pricingPromise: "Nous ne réussissons que lorsque vous réussissez.",
    pricingLines: ["Sans abonnement.", "Sans frais mensuels.", "5 % par transaction."],
    pricingFooter: "Commencer aujourd’hui",
    hero: "Ton business. Partout.",
    promise: "Tout ce dont vous avez besoin pour vendre vos consultations à distance.",
    google: "Continuer avec Google",
    apple: "Continuer avec Apple",
    email: "Continuer avec l’e-mail",
    freeStatement: "Gratuit. Sans abonnement. Nous ne réussissons que lorsque vous réussissez.",
    privacy: "Confidentialité",
    terms: "Conditions",
    comingSoon: "Bientôt disponible",
    googleError: "Impossible de continuer avec Google.",
  },
} satisfies Record<Language, Record<string, string | string[] | string[][]>>;

function GoogleIcon() {
  return (
    <svg className={styles.googleIcon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-2 3.02v2.53h3.24c1.9-1.75 2.98-4.33 2.98-7.39Z" fill="#4285F4" />
      <path d="M12 22c2.7 0 4.98-.9 6.64-2.38l-3.24-2.53c-.9.6-2.05.96-3.4.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.6A10 10 0 0 0 12 22Z" fill="#34A853" />
      <path d="M6.39 13.92A6.02 6.02 0 0 1 6.08 12c0-.67.11-1.32.31-1.92v-2.6H3.04A10 10 0 0 0 2 12c0 1.61.39 3.13 1.04 4.52l3.35-2.6Z" fill="#FBBC05" />
      <path d="M12 5.95c1.47 0 2.78.5 3.82 1.49l2.86-2.87A9.59 9.59 0 0 0 12 2a10 10 0 0 0-8.96 5.48l3.35 2.6C7.18 7.71 9.39 5.95 12 5.95Z" fill="#EA4335" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg className={styles.appleIcon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16.74 12.53c.02-2.08 1.7-3.08 1.78-3.13-.97-1.42-2.49-1.61-3.03-1.63-1.29-.13-2.52.76-3.17.76-.65 0-1.65-.74-2.71-.72-1.4.02-2.69.81-3.41 2.06-1.46 2.53-.37 6.27 1.05 8.32.7 1.01 1.53 2.14 2.62 2.1 1.05-.04 1.45-.68 2.72-.68 1.27 0 1.63.68 2.74.66 1.13-.02 1.85-1.03 2.54-2.04.8-1.17 1.13-2.3 1.15-2.36-.03-.01-2.2-.84-2.28-3.34Zm-2.1-6.12c.58-.7.97-1.67.86-2.64-.84.03-1.85.56-2.45 1.26-.54.62-1.01 1.61-.88 2.55.93.07 1.89-.47 2.47-1.17Z" />
    </svg>
  );
}

export default function LandingContent() {
  const [language, setLanguage] = useState<Language>("en");
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authStatus, setAuthStatus] = useState("");
  const headerRef = useRef<HTMLElement>(null);
  const t = copy[language];

  useEffect(() => {
    const saved = window.localStorage.getItem("drimliLanguage");
    if (saved !== "fr") return;
    const frame = window.requestAnimationFrame(() => setLanguage("fr"));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = t.pageTitle as string;
    window.localStorage.setItem("drimliLanguage", language);
  }, [language, t.pageTitle]);

  useEffect(() => {
    function closeAll(event: MouseEvent) {
      if (headerRef.current?.contains(event.target as Node)) return;
      setOpenMenu(null);
      setMobileOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const activeTrigger = headerRef.current?.querySelector<HTMLButtonElement>(
        '[aria-expanded="true"]'
      );
      setOpenMenu(null);
      setMobileOpen(false);
      activeTrigger?.focus();
    }

    document.addEventListener("mousedown", closeAll);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeAll);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function chooseLanguage(value: Language) {
    setLanguage(value);
    setAuthStatus("");
  }

  function toggleMenu(menu: MenuName) {
    setOpenMenu((current) => (current === menu ? null : menu));
  }

  async function continueWithGoogle() {
    setAuthStatus("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setAuthStatus(t.googleError as string);
  }

  const solutionsItems = t.solutionsItems as string[][];
  const productItems = t.productItems as string[][];
  const pricingLines = t.pricingLines as string[];

  return (
    <main className={styles.home}>
      <div className={styles.page}>
        <header ref={headerRef} className={styles.topbar} data-mobile-open={mobileOpen}>
          <Link href="/" className={styles.brand} aria-label="Drimli home">
            drimli.
          </Link>

          <nav id="home-primary-navigation" className={styles.nav} aria-label="Primary navigation">
            <div
              className={styles.navItem}
              onMouseEnter={() => setOpenMenu("solutions")}
              onMouseLeave={() => setOpenMenu(null)}
            >
              <button
                type="button"
                className={styles.navTrigger}
                aria-haspopup="menu"
                aria-expanded={openMenu === "solutions"}
                aria-controls="home-solutions-menu"
                onClick={() => toggleMenu("solutions")}
              >
                {t.solutions as string}
              </button>
              <div
                id="home-solutions-menu"
                role="menu"
                aria-label={t.solutions as string}
                className={`${styles.popover} ${styles.solutionsPopover}`}
                data-open={openMenu === "solutions"}
              >
                <div className={styles.popoverHeading}>{t.solutionsHeading as string}</div>
                <div className={styles.entries}>
                  {solutionsItems.map(([title, description]) => (
                    <button type="button" role="menuitem" className={styles.entry} key={title}>
                      <strong>{title}</strong>
                      <small>{description}</small>
                    </button>
                  ))}
                </div>
                <div className={styles.solutionsFooter}>
                  <span>{t.solutionsFooter as string}</span>
                  <span aria-hidden="true">→</span>
                </div>
              </div>
            </div>

            <div
              className={styles.navItem}
              onMouseEnter={() => setOpenMenu("product")}
              onMouseLeave={() => setOpenMenu(null)}
            >
              <button
                type="button"
                className={styles.navTrigger}
                aria-haspopup="menu"
                aria-expanded={openMenu === "product"}
                aria-controls="home-product-menu"
                onClick={() => toggleMenu("product")}
              >
                {t.product as string}
              </button>
              <div
                id="home-product-menu"
                role="menu"
                aria-label={t.product as string}
                className={`${styles.popover} ${styles.productPopover}`}
                data-open={openMenu === "product"}
              >
                <div className={styles.entries}>
                  {productItems.map(([title, description]) => (
                    <button type="button" role="menuitem" className={styles.entry} key={title}>
                      <strong>{title}</strong>
                      <small>{description}</small>
                    </button>
                  ))}
                </div>
                <div className={styles.popoverFooter}>
                  <span>{t.productFooter as string}</span>
                  <span aria-hidden="true">→</span>
                </div>
              </div>
            </div>

            <div
              className={styles.navItem}
              onMouseEnter={() => setOpenMenu("pricing")}
              onMouseLeave={() => setOpenMenu(null)}
            >
              <button
                type="button"
                className={styles.navTrigger}
                aria-haspopup="menu"
                aria-expanded={openMenu === "pricing"}
                aria-controls="home-pricing-menu"
                onClick={() => toggleMenu("pricing")}
              >
                {t.pricing as string}
              </button>
              <div
                id="home-pricing-menu"
                role="menu"
                aria-label={t.pricing as string}
                className={`${styles.popover} ${styles.pricingPopover}`}
                data-open={openMenu === "pricing"}
              >
                <div className={styles.pricingMessage}>
                  <strong>{t.free as string}</strong>
                  <p>{t.pricingPromise as string}</p>
                  <div className={styles.pricingLines}>
                    {pricingLines.map((line) => <span key={line}>{line}</span>)}
                  </div>
                </div>
                <Link href="/signup" className={styles.pricingFooter} role="menuitem">
                  <span>{t.pricingFooter as string}</span>
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>

            <div className={styles.languageSwitch} aria-label="Language">
              <button type="button" aria-pressed={language === "en"} data-active={language === "en"} onClick={() => chooseLanguage("en")}>EN</button>
              <span aria-hidden="true">|</span>
              <button type="button" aria-pressed={language === "fr"} data-active={language === "fr"} onClick={() => chooseLanguage("fr")}>FR</button>
            </div>
            <Link href="/login" className={styles.login}>{t.login as string}</Link>
            <Link href="/signup" className={styles.signup}>{t.signup as string}</Link>
          </nav>

          <button
            type="button"
            className={styles.mobileToggle}
            aria-expanded={mobileOpen}
            aria-controls="home-primary-navigation"
            aria-label={(mobileOpen ? t.closeMenu : t.openMenu) as string}
            onClick={() => {
              setMobileOpen((value) => !value);
              setOpenMenu(null);
            }}
          >
            <span />
            <span />
          </button>
        </header>

        <section className={styles.hero} aria-labelledby="home-title">
          <div className={styles.heroContent}>
            <h1 id="home-title">{t.hero as string}</h1>
            <p className={styles.promise}>{t.promise as string}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.authButton} onClick={continueWithGoogle}>
                <GoogleIcon />
                <span>{t.google as string}</span>
              </button>
              <button
                type="button"
                className={styles.authButton}
                disabled
                aria-label={`${t.apple as string} — ${t.comingSoon as string}`}
              >
                <AppleIcon />
                <span>{t.apple as string}</span>
              </button>
              <Link href="/signup" className={styles.emailLink}>{t.email as string}</Link>
            </div>
            <p className={styles.freeStatement}>{t.freeStatement as string}</p>
            <p className={styles.status} role="status" aria-live="polite">{authStatus}</p>
          </div>
        </section>

        <footer className={styles.footer}>
          <span>{t.privacy as string}</span>
          <span aria-hidden="true">·</span>
          <span>{t.terms as string}</span>
        </footer>
      </div>
    </main>
  );
}
