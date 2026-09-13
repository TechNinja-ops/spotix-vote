/**
 * app/elections/page.tsx
 *
 * "Elections you can vote in" — server component. Requires a signed-in
 * session; cross-references the session email against election_voters
 * (fetchElectionsForVoterEmail) to build the list, exactly like the
 * rest of this app keeps the anon key out of table access entirely.
 *
 * Styling follows the same "ballot stub" shell used by the poll and
 * nominate pages (SiteHeader + hero + pulled-up card) — see
 * PollClient.tsx's Shell for the pattern this mirrors.
 */

import Link from "next/link"
import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/election/auth-server"
import { fetchElectionsForVoterEmail } from "@/lib/election/db"
import { Pill } from "@/components/Pill"
import { SiteHeader } from "@/components/SiteHeader"
import { Footer } from "@/components/Footer"

export default async function ElectionsPage() {
  const supabaseServer = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabaseServer.auth.getUser()

  if (!user?.email) {
    redirect("/auth/login")
  }

  const entries = await fetchElectionsForVoterEmail(user.email)

  return (
    <main className="min-h-screen bg-ink">
      <SiteHeader title="Elections" />

      <div className="relative h-40 w-full sm:h-52">
        <div className="h-full w-full bg-gradient-to-br from-purple/40 via-ink to-ink" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent" />
      </div>

      <div className="mx-auto max-w-2xl px-4 -mt-16 pb-24 sm:px-6">
        <div className="rounded-2xl border border-line bg-ink-2/90 p-6 backdrop-blur">
          <p className="font-mono text-xs uppercase tracking-widest text-brass-soft">Ballot box</p>
          <h1 className="mt-1 font-display text-3xl text-paper sm:text-4xl">Your elections</h1>
          <p className="mt-2 text-sm text-muted">
            Elections you&apos;re accredited to vote in, signed in as {user.email}.
          </p>
        </div>

        {entries.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-line px-6 py-10 text-center">
            <p className="text-sm text-muted">
              No elections found for this email yet. If you were expecting one, check with your organiser
              that this is the address they accredited.
            </p>
          </div>
        ) : (
          <ul className="mt-8 flex flex-col gap-3">
            {entries.map((entry) => {
              const { election } = entry
              const closed = election.status === "ended"
              const notYetOpen = election.status !== "active" && !closed
              return (
                <li key={entry.electionId} className="overflow-hidden rounded-2xl border border-line bg-ink-2">
                  <div className="flex items-center justify-between gap-4 p-5">
                    <div className="min-w-0">
                      <p className="truncate font-display text-lg text-paper">{election.name}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {entry.hasVotedAll && <Pill tone="success">Voted</Pill>}
                        {!entry.hasVotedAll && entry.votedOfficeCount > 0 && (
                          <Pill tone="muted">
                            Voted {entry.votedOfficeCount}/{entry.totalOfficeCount}
                          </Pill>
                        )}
                        {closed && <Pill tone="muted">Ended</Pill>}
                        {notYetOpen && <Pill tone="muted">Not open yet</Pill>}
                        {election.status === "active" && !closed && <Pill tone="brass">Open now</Pill>}
                        {election.resultsPublished && <Pill tone="brass">Results published</Pill>}
                      </div>
                    </div>
                    <Link
                      href={`/election/${entry.electionId}`}
                      className="shrink-0 rounded-full bg-brass px-4 py-2.5 text-sm font-medium text-on-accent transition-colors hover:bg-brass-soft"
                    >
                      {election.resultsPublished
                        ? "View results"
                        : entry.hasVotedAll
                          ? "View"
                          : notYetOpen
                            ? "View"
                            : "Vote"}
                    </Link>
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
