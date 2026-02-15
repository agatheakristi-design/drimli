"use client";
import PublicPageLink from "@/app/components/PublicPageLink";
import LogoutButton from "@/app/components/LogoutButton";

import { useRouter } from "next/navigation";
import Card from "@/app/components/ui/Card";
import Button from "@/app/components/ui/Button";

export default function DashboardPage() {
  const router = useRouter();

  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-black">Tableau de bord</h1>
        <p className="text-muted-foreground">
          Accède à chaque section et modifie ton espace pro à tout moment.
        </p>
      </div>

<PublicPageLink />

<div style={{ marginTop: 12 }}>
  <LogoutButton />
</div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="space-y-3">
            <h2 className="font-bold">Mon profil</h2>
            <p className="text-sm text-muted-foreground">
              Tes informations visibles par les clients.
            </p>
            <Button onClick={() => router.push("/dashboard/profile")}>Ouvrir</Button>
          </div>
        </Card>

        <Card>
          <div className="space-y-3">
            <h2 className="font-bold">Mes services</h2>
            <p className="text-sm text-muted-foreground">
              Ce que tu proposes : durée, prix, description.
            </p>
            <Button onClick={() => router.push("/dashboard/services")}>Ouvrir</Button>
          </div>
        </Card>

        <Card>
          <div className="space-y-3">
            <h2 className="font-bold">Paiements</h2>
            <p className="text-sm text-muted-foreground">
              Propulsé par <span className="font-semibold">Drimpay</span>
            </p>
            <Button onClick={() => router.push("/paiements")}>
              Ouvrir
            </Button>
          </div>
        </Card>

        <Card>
          <div className="space-y-3">
            <h2 className="font-bold">Mon agenda</h2>
            <p className="text-sm text-muted-foreground">
              Gestion des disponibilités (<span className="font-semibold">Drimflow</span>)
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
              Visio & gestion des appels (<span className="font-semibold">Drimline</span>)
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
