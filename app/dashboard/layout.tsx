"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import DashboardGate from "@/app/components/DashboardGate";
import HelpPanel from "./components/HelpPanel";
import Sidebar from "./components/Sidebar";
import DrimliInvoicesPanel from "./components/DrimliInvoicesPanel";
import { DashboardIdentityContext } from "./components/DashboardIdentityContext";
import styles from "./components/dashboard.module.css";

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [fullName, setFullName] = useState("Professionnel");
  const [email, setEmail] = useState("");
  const [drimliInvoicesOpen, setDrimliInvoicesOpen] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("aide") === "1") {
      const timer = window.setTimeout(() => setHelpOpen(true), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAccount() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || cancelled) return;

      setEmail(user.email ?? "");

      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("provider_id", user.id)
        .maybeSingle();

      if (!cancelled && data?.full_name) {
        setFullName(data.full_name);
      }
    }

    loadAccount();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <DashboardGate>
      <DashboardIdentityContext.Provider value={fullName}>
        <div className={styles.layout}>
          <Sidebar
            onOpenHelp={() => { setDrimliInvoicesOpen(false); setHelpOpen(true); }}
            fullName={fullName}
            email={email}
            onOpenDrimliInvoices={() => { setHelpOpen(false); setDrimliInvoicesOpen(true); }}
          />

          <main className={styles.main}>
            {children}
          </main>

          {helpOpen ? <HelpPanel onClose={() => setHelpOpen(false)} /> : null}
          <DrimliInvoicesPanel
            open={drimliInvoicesOpen}
            onClose={() => setDrimliInvoicesOpen(false)}
            onProfileSaved={setFullName}
          />
        </div>
      </DashboardIdentityContext.Provider>
    </DashboardGate>
  );
}
