/**
 * app/election/[electionId]/office/page.tsx
 *
 * Candidate registration hub — deliberately auth-free (no session check,
 * no voter-accreditation lookup), unlike app/election/[electionId]/page.tsx
 * which IS the voter ballot and requires a signed-in, accredited voter.
 * Anyone can land here from a link an organiser shares and see what's
 * open to contest, then click through to the specific office's form at
 * ./office/[officeId] (also auth-free — see that page's header comment).
 *
 * This is the ONE link spotix-booker's OfficesTab should hand out for
 * "register to contest this election" — no more sharing a separate
 * per-office link for every single office. See the "Copy candidate
 * registration link" button added to OfficesTab.
 */

import Link from "next/link"
import { notFound } from "next/navigation"
import { fetchElection, fetchOffices } from "@/lib/election/db"
import { Pill } from "@/components/Pill"
import { SiteHeader } from "@/components/SiteHeader"
import { Footer } from "@/components/Footer"
import { SaleCountdown } from "@/components/SaleCountdown"
import { hasSaleEnded } from "@/lib/election/sale-window"

export default async function ElectionOfficesPage({ params }: { params: Promise<{ electionId: string }> }) {
  const { electionId } = await params

  const election = await fetchElection(electionId)
  if (!election) notFound()

  const offices = await fetchOffices(electionId)
  const votingStarted = election.votingStartsAt !== null && new Date(election.votingStartsAt) < new Date()

  return (
    <main className="min-h-screen bg-ink">
      <SiteHeader title="Contest an office" />

      <div className="relative h-40 w-full sm:h-52">
        <div className="h-full w-full bg-gradient-to-br from-purple/40 via-ink to-ink" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent" />
      </div>

      <div className="mx-auto max-w-2xl px-4 -mt-16 pb-24 sm:px-6">
        <div className="rounded-2xl border border-line bg-ink-2/90 p-6 backdrop-blur">
          <p className="font-mono text-xs uppercase tracking-widest text-brass-soft">Candidate registration</p>
          <h1 className="mt-1 font-display text-3xl text-paper sm:text-4xl">{election.name}</h1>
          <p className="mt-2 text-sm text-muted">
            Pick the office you want to contest and fill out its form. No Spotix Vote account needed.
          </p>

          {(election.status === "ended" || votingStarted) && (
            <div className="mt-4">
              <Pill tone="muted">{election.status === "ended" ? "Election ended" : "Voting is already underway"}</Pill>
            </div>
          )}
        </div>

        {offices.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-line px-6 py-10 text-center">
            <p className="text-sm text-muted">No offices are open to contest yet — check back soon.</p>
          </div>
        ) : (
          <ul className="mt-8 flex flex-col gap-3">
            {offices.map((office) => {
              const closed = hasSaleEnded(office.formSaleEndsAt)
              return (
                <li key={office.officeId} className="overflow-hidden rounded-2xl border border-line bg-ink-2">
                  <div className="flex items-center justify-between gap-4 p-5">
                    <div className="min-w-0">
                      <p className="truncate font-display text-lg text-paper">{office.name}</p>
                      {office.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{office.description}</p>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Pill tone={office.formFee > 0 ? "brass" : "success"}>
                          {office.formFee > 0 ? `₦${office.formFee.toLocaleString()} form fee` : "Free to contest"}
                        </Pill>
                        {office.seatsAvailable > 1 && <Pill tone="muted">{office.seatsAvailable} seats</Pill>}
                        {office.bioDataRequired && <Pill tone="muted">Bio data required</Pill>}
                        {office.formSaleEndsAt && <SaleCountdown endsAt={office.formSaleEndsAt} />}
                      </div>
                    </div>
                    {closed ? (
                      <span className="shrink-0 rounded-full border border-line px-4 py-2.5 text-sm font-medium text-muted">
                        Closed
                      </span>
                    ) : (
                      <Link
                        href={`/election/${electionId}/office/${office.officeId}`}
                        className="shrink-0 rounded-full bg-brass px-4 py-2.5 text-sm font-medium text-on-accent transition-colors hover:bg-brass-soft"
                      >
                        Register
                      </Link>
                    )}
                  </div>
                  <div className="stub-divider" />
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <Footer />
    </main>
  )
}
