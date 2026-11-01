"use client";

import { useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

import { DashboardIdentityContext } from "./components/DashboardIdentityContext";
import TopBar from "./components/TopBar";
import WelcomeCard from "./components/WelcomeCard";
import ProgressCard from "./components/ProgressCard";
import PublicLinkCard from "./components/PublicLinkCard";
import TaskList from "./components/TaskList";
import StatsPanel from "./components/StatsPanel";
import { tasks } from "./components/tasks";

import styles from "./components/dashboard.module.css";

export default function DashboardPage() {
  const fullName = useContext(DashboardIdentityContext);
  const [slug, setSlug] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [completedTasks, setCompletedTasks] = useState(
    tasks.filter((task) => task.done).length
  );

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
        .select("slug, published")
        .eq("provider_id", user.id)
        .maybeSingle();

      setSlug(data?.slug ?? null);
      setPublished(Boolean(data?.published));
      setProfileLoading(false);
    }

    load();
  }, []);

  return (
    <>
      <TopBar />

      <WelcomeCard fullName={fullName} slug={slug} published={published} />

      <div className={styles.metaGrid}>
        <ProgressCard completedTasks={completedTasks} />
        <PublicLinkCard
          slug={slug}
          published={published}
          loading={profileLoading}
        />
      </div>

      <div className={styles.contentGrid}>
        <TaskList onCompletedTasksChange={setCompletedTasks} />
        <StatsPanel />
      </div>
    </>
  );
}
