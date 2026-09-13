/**
 * src/app/api/v1/election/resume/route.ts
 *
 * POST /api/v1/election/resume
 * Body: { reference, currentOfficeId? }
 *
 * Backs the "Resume Payment" dialog: a candidate who paused at checkout
 * pastes the reference they were shown (e.g. SPTX-ELE-1787500960860-LK),
 * and this pulls back its Reference doc so the UI can show status and,
 * if still unpaid, re-open Paystack checkout with the SAME reference and
 * amount (never mints a new one).
 *
 * Previously this queried `.where("electionId","==",...)
 * .where("officeId","==",...).where("email","==",...)` — three fields
 * that all had to match exactly (Firestore `==` is case-sensitive, and
 * a candidate revisiting from a different link/device could easily
 * have a subtly different officeId in the URL, or type their email with
 * different casing than they registered with) for what the candidate
 * actually has in hand: just the reference. Reading Reference/{reference}
 * directly can't spuriously 404 for a real reference — it either exists
 * or it doesn't, full stop.
 *
 * `currentOfficeId` — the officeId of the page the candidate is resuming
 * FROM (see the office page's ResumePaymentDialog and the
 * payment-resume page, both of which know their own URL's officeId) —
 * is compared against the officeId actually stored on the reference.
 * A candidate can easily land on the wrong office's page (an old
 * bookmark, a forwarded link for a different post) and paste a
 * reference that belongs to a different office entirely; rather than
 * silently resuming payment for an office they're not looking at, we
 * tell them to go find the right one. `currentOfficeId` is optional so
 * older clients that don't send it yet still work exactly as before.
 */

import { NextRequest, NextResponse } from "next/server"
import { adminDb } from "@/lib/firebase-admin"

export async function POST(req: NextRequest) {
  let body: Record<string, any>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const reference = body.reference?.trim()
  const currentOfficeId = body.currentOfficeId?.trim()
  if (!reference) {
    return NextResponse.json({ error: "reference is required" }, { status: 400 })
  }

  const doc = await adminDb.collection("Reference").doc(reference).get()
  if (!doc.exists) {
    return NextResponse.json({ error: "No form found for that reference" }, { status: 404 })
  }

  const data = doc.data()!
  if (data.transactionType !== "election_form_purchase") {
    // Same Reference collection ticket.js/voting.js use — a reference
    // that exists but belongs to a ticket or vote purchase isn't ours
    // to resume.
    return NextResponse.json({ error: "No form found for that reference" }, { status: 404 })
  }

  if (currentOfficeId && data.officeId && currentOfficeId !== data.officeId) {
    return NextResponse.json(
      {
        error: `This reference is for "${data.officeName ?? "a different office"}", not the office you're viewing. Please go to the office you're contesting for to resume payment from there.`,
        officeMismatch: true,
        officeId: data.officeId,
        officeName: data.officeName ?? "",
        electionId: data.electionId ?? "",
      },
      { status: 409 }
    )
  }

  return NextResponse.json({
    reference: data.reference ?? reference,
    electionId: data.electionId,
    electionName: data.electionName ?? "",
    officeId: data.officeId,
    officeName: data.officeName,
    status: data.status,
    // Set by spotix-backend's finalizeCandidateCredit once the webhook
    // actually attaches the candidate row — see
    // spotix-backend/v1/lib/election/reference.js.
    candidateCredited: data.candidateCredited === true,
    formFee: data.formFee,
    serviceFee: data.serviceFee,
    totalAmount: data.totalAmount,
    fullName: data.fullName,
    email: data.email,
    phone: data.phone,
  })
}
