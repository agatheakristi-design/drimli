import Link from "next/link";
import Button from "@/app/components/ui/Button";
import Card from "@/app/components/ui/Card";

export default function Home() {
  return (
    <main className="py-12">
{/* TOP BAR */}
<div className="w-full flex justify-between items-center px-6 py-6">
  <div className="text-lg font-semibold">
    Drimli
  </div>

  <div className="flex items-center gap-4">
    <a
      href="/login"
      className="text-sm font-medium text-foreground hover:opacity-70 transition"
    >
      Log in
    </a>

    <a
      href="/login"
      className="bg-primary text-primary-foreground px-5 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition"
    >
      Create account
    </a>
  </div>
</div>

      {/* HERO MOCKUP (au-dessus du reste) */}
      <section className="w-full bg-[#f6f6f3] pt-16 pb-10">
        <div className="max-w-6xl mx-auto px-6">
          <div className="rounded-3xl bg-white shadow-xl p-6 md:p-10 overflow-hidden">
            <div className="grid md:grid-cols-3 gap-6 items-center">

              {/* Left (profil + calendrier) */}
              <div className="bg-[#f3f3f0] rounded-2xl p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-12 w-12 rounded-xl bg-muted" />
                  <div>
                    <div className="font-semibold">Dr. Emma Martin</div>
                    <div className="text-sm text-muted-foreground">Psychologue</div>
                  </div>
                </div>

                <div className="text-sm font-medium mb-2">May 2024</div>
                <div className="flex gap-3 text-sm items-center">
                  <span className="bg-primary text-primary-foreground rounded-full px-3 py-1 text-xs font-semibold">
                    13
                  </span>
                  <span>10</span>
                  <span>11</span>
                  <span>12</span>
                  <span>14</span>
                  <span>16</span>
                </div>

                <div className="mt-4 text-sm text-muted-foreground">
                  Select a date and time to book.
                </div>
              </div>

              {/* Center (form design only) */}
              <div className="bg-white rounded-2xl shadow-lg p-6 text-center">
                <div className="text-xl font-semibold mb-4">Your name</div>

                <div className="space-y-3 mb-5">
                  <div className="bg-[#f3f3f0] rounded-lg h-10" />
                  <div className="bg-[#f3f3f0] rounded-lg h-10" />
                  <div className="bg-[#f3f3f0] rounded-lg h-10" />
                </div>

                <a
                  href="/login"
                  className="block w-full bg-primary text-primary-foreground rounded-xl py-3 font-semibold hover:opacity-90 transition"
                >
                  Create my account
                </a>

                <div className="text-xs text-muted-foreground mt-2">
                  Free. No subscription. No setup.
                </div>
              </div>

              {/* Right (paiement) */}
              <div className="bg-[#f3f3f0] rounded-2xl p-5">
                <div className="font-semibold mb-1">Psychology session</div>
                <div className="text-lg font-bold mb-3">€60</div>

                <div className="text-sm text-muted-foreground mb-4">
                  Secure card payment
                </div>

                <div className="w-full bg-primary text-primary-foreground rounded-xl py-3 font-semibold text-center">
                  Pay by card
                </div>

                <div className="mt-2 text-xs text-muted-foreground text-center">
                  Encrypted & secure
                </div>
              </div>

            </div>
          </div>
        </div>
      </section>

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
