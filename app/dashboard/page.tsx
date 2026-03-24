"use client";

import { useEffect, useState } from "react";
import PublicPageLink from "@/app/components/PublicPageLink";
import LogoutButton from "@/app/components/LogoutButton";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";

type ProfileRow = {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  siret?: string | null;
  vat_number?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
};

function isFilled(v?: string | null) {
  return !!(v && v.trim().length > 0);
}

export default function DashboardPage() {
  const router = useRouter();
  const [profileNeedsLove, setProfileNeedsLove] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) return;

      const { data } = await supabase
        .from("profiles")
        .select("first_name,last_name,full_name,address,city,country,siret,vat_number,phone,avatar_url")
        .eq("provider_id", user.id)
        .maybeSingle<ProfileRow>();

      if (!data) {
        setProfileNeedsLove(true);
        return;
      }

      const hasIdentity =
        (isFilled(data.first_name) && isFilled(data.last_name)) ||
        isFilled(data.full_name);

      const hasUsefulExtras =
        isFilled(data.phone) ||
        isFilled(data.city) ||
        isFilled(data.address) ||
        isFilled(data.avatar_url);

      setProfileNeedsLove(!(hasIdentity && hasUsefulExtras));
    })();
  }, []);

  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-black">Tableau de bord</h1>
        <p className="text-muted-foreground">
          Accède à chaque section et modifie ton espace pro à tout moment.
        </p>
      </div>

      <Card>
        <div className="space-y-3">
          <h2 className="text-xl font-bold">Votre compte est prêt</h2>
          <p className="text-sm text-muted-foreground">
            Vous pouvez déjà recevoir des réservations et des paiements.
          </p>

          {profileNeedsLove ? (
            <div className="rounded-xl border border-border bg-background p-4">
              <p className="font-semibold">Améliorez votre profil</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Ajoutez quelques informations pour inspirer confiance aux clients.
              </p>
              <div className="mt-3">
                <Button onClick={() => router.push("/dashboard/profile")}>
                  Compléter mon profil
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      <PublicPageLink />

      <div style={{ marginTop: 12 }}>
        <LogoutButton />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="font-bold">Mes informations</h2>
              {profileNeedsLove ? (
                <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-foreground">
                  À compléter
                </span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              Vos informations visibles par les clients.
            </p>
            <Button onClick={() => router.push("/dashboard/profile")}>Ouvrir</Button>
          </div>
        </Card>

        <Card>
          <div className="space-y-3">
            <h2 className="font-bold">Mes services</h2>
            <p className="text-sm text-muted-foreground">
              Ce que vous proposez : durée, prix, description.
            </p>
            <Button onClick={() => router.push("/dashboard/services")}>Ouvrir</Button>
          </div>
        </Card>

        <Card>
          <div className="space-y-3">
            <h2 className="font-bold">Vos paiements</h2>
            <p className="text-sm text-muted-foreground">
              Activez et gérez vos paiements en ligne.
            </p>
            <Button onClick={() => router.push("/paiements")}>Ouvrir</Button>
          </div>
        </Card>

        <Card>
          <div className="space-y-3">
            <h2 className="font-bold">Disponibilités</h2>
            <p className="text-sm text-muted-foreground">
              Définissez vos créneaux et absences.
            </p>
            <Button onClick={() => router.push("/dashboard/disponibilites")}>
              Ouvrir
            </Button>
          </div>
        </Card>

        <Card className="sm:col-span-2">
          <div className="space-y-3">
            <h2 className="font-bold">Rendez-vous</h2>
            <p className="text-sm text-muted-foreground">
              Gérez vos rendez-vous et vos appels.
            </p>
            <Button onClick={() => router.push("/dashboard/rendez-vous")}>
              Voir les rendez-vous
            </Button>
          </div>
        </Card>

        <Card className="sm:col-span-2">
          <div className="space-y-3">
            <h2 className="font-bold">Factures</h2>
            <p className="text-sm text-muted-foreground">Bientôt disponible</p>
            <Button variant="secondary" disabled>
              Ouvrir
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
