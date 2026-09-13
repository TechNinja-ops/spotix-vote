/**
 * app/election/[electionId]/open/page.tsx
 *
 * Public "Allow Voters Pre-fill" landing page — lets a voter add
 * themselves to this election's voter list, instead of only ever being
 * added by the organiser's CSV/manual upload (see spotix-booker's
 * VotersTab.tsx). Only reachable in any meaningful way when the
 * organiser has explicitly turned this on for the election
 * (elections.allow_voter_prefill — see spotix-booker's
 * AllowVoterPrefillCard); otherwise this page itself refuses with the
 * organiser's-not-allowed-this notice, same as the API route
 * (/api/v1/election/self-enlist) re-checks server-side on submit.
 *
 * Deliberately auth-free to load (same reasoning as
 * ./office/page.tsx) — a voter doesn't need a Spotix Vote account yet
 * to see this page or the notice; they only need one afterward, to
 * actually cast a vote once enlisted (see ./page.tsx's accreditation
 * check).
 */

import { notFound } from "next/navigation"
import { fetchElection, fetchVoterFieldsSpec } from "@/lib/election/db"
import { SiteHeader } from "@/components/SiteHeader"
import { Footer } from "@/components/Footer"
import { OpenEnlistForm } from "./OpenEnlistForm"
import { TriangleAlert } from "lucide-react"

export default async function VoterOpenEnlistPage({ params }: { params: Promise<{ electionId: string }> }) {
  const { electionId } = await params

  const election = await fetchElection(electionId)
  if (!election) notFound()

  return (
    <main className="min-h-screen bg-ink">
      <SiteHeader title="Register to vote" />

      <div className="relative h-40 w-full sm:h-52">
        <div className="h-full w-full bg-gradient-to-br from-purple/40 via-ink to-ink" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent" />
      </div>

      <div className="mx-auto max-w-lg px-4 -mt-16 pb-24 sm:px-6">
        <div className="rounded-2xl border border-line bg-ink-2/90 p-6 backdrop-blur">
          <p className="font-mono text-xs uppercase tracking-widest text-brass-soft">Voter registration</p>
          <h1 className="mt-1 font-display text-3xl text-paper sm:text-4xl">{election.name}</h1>

          {!election.allowVoterPrefill ? (
            <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              <p>The organizer has not allowed this action.</p>
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted">
                Enter your details below to add yourself to the voter list for this election. Once registered, sign in with the
                same email to cast your vote when voting opens.
              </p>
              <div className="mt-6">
                <OpenEnlistForm electionId={electionId} fieldSpec={await fetchVoterFieldsSpec(electionId)} />
              </div>
            </>
          )}
        </div>
      </div>

      <Footer />
    </main>
  )
}
