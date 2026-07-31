"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import WelcomeCard from "./components/WelcomeCard";
import ProgressCard from "./components/ProgressCard";
import PublicLinkCard from "./components/PublicLinkCard";
import TaskList from "./components/TaskList";
import StatsPanel from "./components/StatsPanel";

import styles from "./components/dashboard.module.css";

export default function DashboardPage() {
  const [fullName, setFullName] = useState("Professionnel");
  const [email, setEmail] = useState("");
  const [slug, setSlug] = useState("");

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      setEmail(user.email ?? "");

      const { data } = await supabase
        .from("profiles")
        .select("full_name, slug")
        .eq("id", user.id)
        .single();

      if (data?.full_name) {
      if (data?.slug) {
        setSlug(data.slug);
      }
        setFullName(data.full_name);
      }
    }

    load();
  }, []);

  return (
    <div className={styles.layout}>
      <Sidebar fullName={fullName} email={email} />

      <main className={styles.main}>
        <TopBar />

        <WelcomeCard fullName={fullName} />

        <div className={styles.metaGrid}>
          <ProgressCard />
          <PublicLinkCard slug={slug} />
        </div>

        <div className={styles.contentGrid}>
          <TaskList />
          <StatsPanel />
        </div>
      </main>
    </div>
  );
}
