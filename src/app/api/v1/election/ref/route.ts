/**
 * src/app/api/v1/election/ref/route.ts
 *
 * POST /api/v1/election/ref
 *
 * Body: { electionId, officeId, fullName, email, phone, photoUrl, answers }
 *
 * Two outcomes:
 *   1. Office is free to contest (form_fee = 0) → candidate is inserted
 *      immediately via lib/election/register.ts, no payment involved.
 *      Response: { free: true, candidateId }
 *   2. Office has a fee → creates Reference/{reference} in Firestore
 *      (reference format SPTX-ELE-{timestampMs}-{2 letters}), pending
 *      payment. The candidate row is only attached once spotix-backend's
 *      webhook confirms the charge (see spotix-backend's
 *      v1/lib/election/index.js). Response carries everything the
 *      client needs to open Paystack checkout.
 *      Response: { free: false, reference, formFee, serviceFee, totalAmount }
 *
 * The fee is ALWAYS computed here from the office's stored form_fee —
 * never trusted from the request body — so a candidate can't under-pay
 * by tampering with the client.
 *
 * NOTE for the paid path: bioDataPath is stashed on the Reference doc
 * below, but spotix-backend's webhook (v1/lib/election/index.js, not in
 * this repo) needs its candidate-allocation insert updated to also copy
 * `bio_data_path` from the Reference doc onto the new election_candidates
 * row — mirroring how it already copies photo_url — or a paid office's
 * bio data upload will silently get dropped on confirmation.
 */

import { NextRequest, NextResponse } from "next/server"
import { adminDb } from "@/lib/firebase-admin"
import { fetchOffice, fetchElection } from "@/lib/election/db"
import { computeElectionFormFee } from "@/lib/election/fees"
import { buildElectionReference } from "@/lib/election/reference-id"
import { registerFreeCandidate } from "@/lib/election/register"

export async function POST(req: NextRequest) {
  let body: Record<string, any>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { electionId, officeId, fullName, email, phone, photoUrl, answers, bioDataPath, payLater } = body

  if (!electionId || !officeId || !fullName?.trim() || !email?.trim()) {
    return NextResponse.json({ error: "electionId, officeId, fullName, and email are required" }, { status: 400 })
  }

  const [election, office] = await Promise.all([fetchElection(electionId), fetchOffice(officeId)])

  if (!election) return NextResponse.json({ error: "Election not found" }, { status: 404 })
  if (!office || office.election_id !== electionId) {
    return NextResponse.json({ error: "Office not found for this election" }, { status: 404 })
  }
  if (election.status === "ended") {
    return NextResponse.json({ error: "This election has ended and is no longer accepting candidates" }, { status: 403 })
  }
  if (office.form_sale_ends_at && new Date(office.form_sale_ends_at) < new Date()) {
    return NextResponse.json({ error: "Sale of forms for this office has ended" }, { status: 403 })
  }

  const formFee = Number(office.form_fee ?? 0)

  // ── Free office — attach the candidate directly, no payment step ────────
  if (formFee <= 0) {
    const result = await registerFreeCandidate({
      electionId,
      officeId,
      fullName: fullName.trim(),
      email: email.trim(),
      phone: phone?.trim() ?? "",
      photoUrl: photoUrl ?? "",
      answers: answers ?? {},
      bioDataPath: bioDataPath ?? undefined,
    })

    if (!result.ok) {
      return NextResponse.json({ error: "You've already submitted a form for this office with this email" }, { status: 409 })
    }
    return NextResponse.json({ free: true, candidateId: result.candidateId })
  }

  // ── Paid office — create the pending Reference ──────────────────────────
  // netAmount and paystackFeePayer are resolved here (from THIS
  // ELECTION's current platform-fee settings — see lib/election/fees.ts,
  // configured per election from the Admin Dashboard) and stashed on
  // the Reference doc so spotix-backend's webhook credits the office
  // the right amount later without needing to re-read settings itself
  // (settings could change between purchase and webhook delivery — the
  // amount actually charged/payable must stay pinned to what was quoted).
  const { serviceFee, totalAmount, netAmount, paystackFeePayer } = await computeElectionFormFee(formFee, electionId)
  const reference = buildElectionReference()

  await adminDb.collection("Reference").doc(reference).set({
    reference,
    transactionType: "election_form_purchase",
    status: "pending",
    electionId,
    electionName: election.name,
    officeId,
    officeName: office.name,
    fullName: fullName.trim(),
    email: email.trim(),
    phone: phone?.trim() ?? "",
    photoUrl: photoUrl ?? "",
    answers: answers ?? {},
    bioDataPath: bioDataPath ?? "",
    formFee,
    serviceFee,
    totalAmount,
    netAmount,
    paystackFeePayer,
    createdAt: new Date().toISOString(),
  })

  // "Pay later" — fire-and-forget the reminder email, never block the
  // response on it (a slow/down mail route shouldn't stop the candidate
  // from getting their reference back). spotix-backend's route is the
  // one source of truth for the resume link's shape — see
  // v1/mail-routes/election-form-pay-later.js.
  if (payLater) {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL
    if (backendUrl) {
      fetch(`${backendUrl}/v1/notify/election-form-pay-later`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          recipientName: fullName.trim(),
          electionName: election.name,
          officeName: office.name,
          reference,
          totalAmount,
          resumeUrl: `${process.env.NEXT_PUBLIC_VOTE_APP_URL ?? ""}/election/${electionId}/office/${officeId}/payment-resume?completed=0&ref=${encodeURIComponent(reference)}`,
        }),
      }).catch((err) => console.error("[ref] pay-later email trigger failed (non-blocking):", err))
    }
  }

  return NextResponse.json({ free: false, payLater: !!payLater, reference, formFee, serviceFee, totalAmount })
}
