"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

import TopBar from "./components/TopBar";
import WelcomeCard from "./components/WelcomeCard";
import ProgressCard from "./components/ProgressCard";
import PublicLinkCard from "./components/PublicLinkCard";
import TaskList from "./components/TaskList";
import StatsPanel from "./components/StatsPanel";

import styles from "./components/dashboard.module.css";

export default function DashboardPage() {
  const [fullName, setFullName] = useState("Professionnel");
  const [slug, setSlug] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setProfileLoading(false);
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("full_name, slug, published")
        .eq("provider_id", user.id)
        .maybeSingle();

      if (data?.full_name) {
        setFullName(data.full_name);
      }

      setSlug(data?.slug ?? null);
      setPublished(Boolean(data?.published));
      setProfileLoading(false);
    }

    load();
  }, []);

  return (
    <>
      <TopBar slug={slug} published={published} />

      <WelcomeCard fullName={fullName} />

      <div className={styles.metaGrid}>
        <ProgressCard />
        <PublicLinkCard
          slug={slug}
          published={published}
          loading={profileLoading}
        />
      </div>

      <div className={styles.contentGrid}>
        <TaskList />
        <StatsPanel />
      </div>
    </>
  );
}
