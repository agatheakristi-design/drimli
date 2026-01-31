import Link from "next/link";
import Button from "./components/ui/Button";
import Card from "./components/ui/Card";

export default function Home() {
  return (
    <main className="py-12">
      {/* HERO */}
      <section className="text-center max-w-3xl mx-auto">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-tight">
          Everything you need.{" "}
          <span className="text-muted-foreground">Nothing to manage</span>
        </h1>

        <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed">
          The all-in-one platform to manage clients remotely, worldwide.
          <br />
          Scheduling, online payments, video sessions, and invoicing are fully connected.
          <br />
          Nothing to configure. Everything works together, automatically.
        </p>

        <p className="mt-6 text-sm text-muted-foreground">
          Free. No subscription. No commitment.
        </p>
      </section>

      {/* VISUAL (4 connected cards) */}
      <section className="mt-10">
        {/* “connection line” */}
        <div className="hidden md:block max-w-6xl mx-auto px-6">
          <div className="relative h-10">
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 border-t border-border" />
            <div className="absolute left-[12.5%] top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary/70" />
            <div className="absolute left-[37.5%] top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary/70" />
            <div className="absolute left-[62.5%] top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary/70" />
            <div className="absolute left-[87.5%] top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary/70" />
          </div>
        </div>

        <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Card className="p-6">
            <div className="text-xl font-semibold">Drimline</div>
            <div className="text-sm text-muted-foreground mt-1">Scheduling</div>

            <div className="mt-4 rounded-lg border border-border bg-muted p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Next session</span>
                <span className="font-semibold">10:00</span>
              </div>
              <div className="mt-2 text-muted-foreground">Confirmed</div>
            </div>

            <div className="mt-4 text-sm text-muted-foreground">
              Availability handled automatically.
            </div>
          </Card>

          <Card className="p-6">
            <div className="text-xl font-semibold">Drimpay</div>
            <div className="text-sm text-muted-foreground mt-1">Payments</div>

            <div className="mt-4 rounded-lg border border-border bg-muted p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Secure</span>
                <span className="font-semibold">€60</span>
              </div>
              <div className="mt-3">
                <Button className="w-full">Pay by card</Button>
              </div>
            </div>

            <div className="mt-4 text-sm text-muted-foreground">
              Payment confirms the session.
            </div>
          </Card>

          <Card className="p-6">
            <div className="text-xl font-semibold">Drimcall</div>
            <div className="text-sm text-muted-foreground mt-1">Video</div>

            <div className="mt-4 rounded-lg border border-border bg-muted p-4 text-sm">
              <div className="h-24 rounded-md bg-card border border-border flex items-center justify-center text-muted-foreground">
                Video preview
              </div>
              <div className="mt-3 flex justify-center gap-2">
                <span className="rounded-full border border-border bg-card px-3 py-1 text-xs">
                  🎤
                </span>
                <span className="rounded-full border border-border bg-card px-3 py-1 text-xs">
                  🎥
                </span>
              </div>
            </div>

            <div className="mt-4 text-sm text-muted-foreground">
              The call opens at the right time.
            </div>
          </Card>

          <Card className="p-6">
            <div className="text-xl font-semibold">Drimflow</div>
            <div className="text-sm text-muted-foreground mt-1">Invoicing</div>

            <div className="mt-4 rounded-lg border border-border bg-muted p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Invoice</span>
                <span className="text-muted-foreground">€60</span>
              </div>
              <div className="mt-2 text-muted-foreground">Paid • May 13, 2024</div>
            </div>

            <div className="mt-4 text-sm text-muted-foreground">
              Invoices generated automatically.
            </div>
          </Card>
        </div>
      </section>

      {/* CTA */}
      <section className="mt-10 text-center">
        <Link href="/login">
          <Button size="md" className="px-8 h-11">
            Je crée mon compte
          </Button>
        </Link>
        <div className="mt-3 text-xs text-muted-foreground">
          Gratuit. Sans abonnement. Sans engagement.
        </div>
      </section>
    </main>
  );
}