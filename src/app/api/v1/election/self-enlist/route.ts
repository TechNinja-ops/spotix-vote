/**
 * src/app/api/v1/election/self-enlist/route.ts
 *
 * POST /api/v1/election/self-enlist
 * Body: { electionId, email, name, phone?, meta? }
 *
 * Backs the public /election/{electionId}/open page — lets a voter add
 * themselves to an election's voter list, the same `election_voters`
 * table spotix-booker's organiser-side CSV/manual upload writes to (see
 * lib/election/db.ts's selfEnlistVoter).
 *
 * Refuses outright unless the organiser has explicitly turned on
 * "Allow Voters Pre-fill" for this election (elections.allow_voter_prefill
 * — see spotix-booker's AllowVoterPrefillCard). This is re-checked here
 * server-side rather than trusted from the page's own load-time check,
 * since the flag could change between the page loading and the form
 * being submitted, and a client can hit this route directly regardless
 * of what the page renders.
 */

import { NextRequest, NextResponse } from "next/server"
import { fetchElection, fetchVoterFieldsSpec, selfEnlistVoter } from "@/lib/election/db"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  let body: Record<string, any>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const electionId = body.electionId?.trim()
  if (!electionId) {
    return NextResponse.json({ error: "electionId is required" }, { status: 400 })
  }

  const election = await fetchElection(electionId)
  if (!election) {
    return NextResponse.json({ error: "Election not found" }, { status: 404 })
  }

  if (!election.allowVoterPrefill) {
    return NextResponse.json({ error: "The organizer has not allowed this action" }, { status: 403 })
  }

  const email = String(body.email ?? "").trim()
  const name = String(body.name ?? "").trim()
  const phone = body.phone ? String(body.phone).trim() : ""
  const meta = typeof body.meta === "object" && body.meta !== null ? body.meta : {}

  const errors: string[] = []
  if (!email) errors.push("Email is required")
  else if (!EMAIL_RE.test(email)) errors.push("Enter a valid email address")
  if (!name) errors.push("Name is required")

  const fieldSpec = await fetchVoterFieldsSpec(electionId)
  for (const field of fieldSpec) {
    if (field.required && !String(meta[field.key] ?? "").trim()) {
      errors.push(`"${field.label}" is required`)
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors[0], details: errors }, { status: 400 })
  }

  const result = await selfEnlistVoter(electionId, { email, name, phone, meta })

  if (!result.ok) {
    // Not an error the voter needs to fix — they're already on the
    // list, so treat it as a success path that skips straight to "go
    // sign in".
    return NextResponse.json({ success: true, alreadyEnlisted: true })
  }

  return NextResponse.json({ success: true, alreadyEnlisted: false })
}
