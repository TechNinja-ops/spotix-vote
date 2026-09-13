/**
 * src/app/api/v1/election/office/[officeId]/route.ts
 *
 * GET /api/v1/election/office/{officeId}
 *
 * Feeds the public candidate registration form: office name/fee, its
 * election's name, and the organiser-configured custom questions to
 * ask every candidate contesting this office.
 */

import { NextRequest, NextResponse } from "next/server"
import { fetchOffice, fetchOfficeQuestions, fetchElection } from "@/lib/election/db"
import { computeElectionFormFee } from "@/lib/election/fees"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ officeId: string }> }) {
  const { officeId } = await params

  const office = await fetchOffice(officeId)
  if (!office) return NextResponse.json({ error: "Office not found" }, { status: 404 })

  const [election, questions] = await Promise.all([
    fetchElection(office.election_id),
    fetchOfficeQuestions(officeId),
  ])

  if (!election) return NextResponse.json({ error: "Election not found" }, { status: 404 })
  if (election.status === "ended") {
    return NextResponse.json({ error: "This election has ended and is no longer accepting candidates" }, { status: 403 })
  }

  const formFee = Number(office.form_fee ?? 0)
  const fee = formFee > 0 ? await computeElectionFormFee(formFee, office.election_id) : null

  return NextResponse.json({
    electionId: election.id,
    electionName: election.name,
    officeId: office.id,
    officeName: office.name,
    formFee,
    fee, // null for free offices
    questions,
    editGraceDays: election.editGraceDays,
    bioDataRequired: office.bio_data_required ?? false,
    bioDataLabel: office.bio_data_label ?? "",
    formSaleEndsAt: office.form_sale_ends_at ?? null,
  })
}
