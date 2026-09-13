/**
 * app/election/[electionId]/page.tsx
 *
 * The actual ballot. Server component: checks the session directly
 * (redirects to /auth/login if none), confirms accreditation, then
 * renders one OfficeBallot per office. Vote counts are never fetched
 * here at all pre-publish — fetchCandidatesForOffice already returns
 * null for voteCount until election.resultsPublished, so there's
 * nothing for this page to accidentally leak.
 *
 * Shell (SiteHeader + hero + pulled-up card) mirrors PollClient's
 * Shell so the elections feature reads as the same product as the
 * poll/nominate pages instead of a bolted-on, unstyled corner of it.
 */

import Image from "next/image"
import { redirect, notFound } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/election/auth-server"
import { supabaseAdmin } from "@/lib/supabase"
import { fetchElection, fetchOffices, fetchCandidatesForOffice, fetchVotedOfficeIds } from "@/lib/election/db"
import { OfficeBallot } from "./components/OfficeBallot"
import { ResultsChart } from "./components/ResultsChart"
import { Pill } from "@/components/Pill"
import { SiteHeader } from "@/components/SiteHeader"
import { Footer } from "@/components/Footer"

export default async function ElectionBallotPage({ params }: { params: Promise<{ electionId: string }> }) {
  const { electionId } = await params

  const supabaseServer = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabaseServer.auth.getUser()
  if (!user?.email) redirect("/auth/login")

  const { data: voter } = await supabaseAdmin
    .from("election_voters")
    .select("id, voter_token")
    .eq("election_id", electionId)
    .ilike("email", user.email)
    .maybeSingle()
  if (!voter) notFound()

  const election = await fetchElection(electionId)
  if (!election) notFound()

  const [offices, votedOfficeIds] = await Promise.all([fetchOffices(electionId), fetchVotedOfficeIds(voter.id)])

  const officesWithCandidates = await Promise.all(
    offices.map(async (office) => ({
      ...office,
      hasVoted: votedOfficeIds.includes(office.officeId),
      candidates: await fetchCandidatesForOffice(office.officeId, election.resultsPublished),
    }))
  )

  // Mirrors what cast_election_vote() itself enforces (election.status
  // must be "active" AND voting_starts_at must have passed, else the
  // RPC returns election_not_active / voting_not_started) — without
  // this, a "draft"/"scheduled" election with candidates already
  // loaded would render a live-looking ballot that only fails once the
  // voter actually tries to submit.
  const votingHasStarted =
    election.status === "active" && (election.votingStartsAt === null || new Date(election.votingStartsAt) <= new Date())
  const votingHasEnded =
    election.status === "ended" || (election.votingEndsAt !== null && new Date(election.votingEndsAt) < new Date())
  const votingOpen = votingHasStarted && !votingHasEnded
  const votedCount = officesWithCandidates.filter((o) => o.hasVoted).length

  return (
    <main className="min-h-screen bg-ink">
      <SiteHeader title={election.name} />

      <div className="relative h-56 w-full sm:h-72">
        {election.image ? (
          <Image src={election.image} alt={election.name} fill className="object-cover" priority />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-purple/40 via-ink to-ink" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent" />
      </div>

      <div className="mx-auto max-w-2xl px-4 -mt-16 pb-24 sm:px-6">
        <div className="rounded-2xl border border-line bg-ink-2/90 p-6 backdrop-blur">
          <p className="font-mono text-xs uppercase tracking-widest text-brass-soft">
            {election.resultsPublished ? "Results" : "Ballot"}
          </p>
          <h1 className="mt-1 font-display text-3xl text-paper sm:text-4xl">{election.name}</h1>
          {election.description && <p className="mt-3 max-w-2xl text-sm text-muted">{election.description}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {!votingHasStarted && !votingHasEnded && <Pill tone="muted">Voting hasn&apos;t started yet</Pill>}
            {votingHasEnded && <Pill tone="muted">Voting closed</Pill>}
            {election.resultsPublished && <Pill tone="brass">Results published</Pill>}
            {!election.resultsPublished && offices.length > 0 && (
              <Pill tone={votedCount === offices.length ? "success" : "muted"}>
                Voted {votedCount}/{offices.length}
              </Pill>
            )}
          </div>
        </div>

        {election.resultsPublished ? (
          <div className="mt-8 flex flex-col gap-6">
            {officesWithCandidates.map((office) => (
              <ResultsChart key={office.officeId} officeName={office.name} candidates={office.candidates} />
            ))}
            {officesWithCandidates.length === 0 && (
              <p className="mt-2 text-center text-sm text-muted">No offices were set up for this election.</p>
            )}
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-6">
            {officesWithCandidates.map((office) => (
              <OfficeBallot
                key={office.officeId}
                electionId={electionId}
                officeId={office.officeId}
                officeName={office.name}
                candidates={office.candidates}
                hasVoted={office.hasVoted}
                votingClosed={!votingOpen}
              />
            ))}
            {officesWithCandidates.length === 0 && (
              <p className="mt-2 text-center text-sm text-muted">No offices are open for voting yet — check back soon.</p>
            )}
            {officesWithCandidates.length > 0 && !votingHasStarted && !votingHasEnded && (
              <p className="text-center text-sm text-muted">
                {election.votingStartsAt
                  ? `Voting opens ${new Date(election.votingStartsAt).toLocaleString()}.`
                  : "Voting hasn't opened yet — check back soon."}
              </p>
            )}
            {officesWithCandidates.length > 0 && (
              <p className="stub-divider" />
            )}
            {officesWithCandidates.length > 0 && (
              <p className="text-center text-sm text-muted">
                Results will appear here once the organizer publishes them.
              </p>
            )}
          </div>
        )}
      </div>

      <Footer />
    </main>
  )
}
