"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import DashboardGate from "@/app/components/DashboardGate";
import Sidebar from "./components/Sidebar";
import ProfessionalDetailsPanel from "./components/ProfessionalDetailsPanel";
import styles from "./components/dashboard.module.css";

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [fullName, setFullName] = useState("Professionnel");
  const [email, setEmail] = useState("");
  const [professionalDetailsOpen, setProfessionalDetailsOpen] = useState(false);

  const openProfessionalDetails = useCallback(() => {
    setProfessionalDetailsOpen(true);
  }, []);

  const closeProfessionalDetails = useCallback(() => {
    setProfessionalDetailsOpen(false);
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
      <div className={styles.layout}>
        <Sidebar
          fullName={fullName}
          email={email}
          onEditProfessionalDetails={openProfessionalDetails}
        />

        <main className={styles.main}>
          {children}
        </main>

        <ProfessionalDetailsPanel
          open={professionalDetailsOpen}
          onClose={closeProfessionalDetails}
          onSaved={setFullName}
        />
      </div>
    </DashboardGate>
  );
}
