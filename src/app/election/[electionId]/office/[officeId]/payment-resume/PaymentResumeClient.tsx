"use client"

/**
 * app/election/[electionId]/office/[officeId]/payment-resume/page.tsx
 *
 * Landing page for the "Pay later" flow's reminder email/link:
 *   ?completed=0&ref={reference} → PaymentReadyView ("Howdy X, ready to
 *     complete payment?" + a Ready button that opens the same
 *     PaymentMethodDialog used everywhere else)
 *   ?completed=1&ref={reference} → ReceiptView (only ever shown once
 *     /api/v1/election/receipt has independently confirmed the
 *     Reference doc's status is "successful" — completed=1 in the URL
 *     is just routing, never trusted as proof of payment on its own)
 *
 * `completed` is a plain 0/1 flag rather than deriving the view from
 * payment status alone so the URL itself stays meaningful and
 * bookmarkable even before this page has fetched anything.
 *
 * This file only decides WHICH view to render and owns the top-level
 * fetch — the two views and the PDF builder are their own modules
 * (PaymentReadyView.tsx, ReceiptView.tsx, eform-pdf/) so each piece
 * stays small and independently readable.
 */

import { useEffect, useState } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { SiteHeader } from "@/components/SiteHeader"
import { Footer } from "@/components/Footer"
import { PaymentReadyView } from "./PaymentReadyView"
import { ReceiptView, type ReceiptData } from "./ReceiptView"

export function PaymentResumeClient() {
  const { electionId, officeId } = useParams<{ electionId: string; officeId: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()

  const completed = searchParams.get("completed") === "1"
  const reference = searchParams.get("ref") ?? ""

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [readyData, setReadyData] = useState<null | {
    fullName: string
    email: string
    phone: string
    electionName: string
    officeName: string
    totalAmount: number
    reference: string
  }>(null)
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null)

  useEffect(() => {
    if (!reference) {
      setError("Missing reference in the link.")
      setLoading(false)
      return
    }

    const endpoint = completed ? "/api/v1/election/receipt" : "/api/v1/election/resume"

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // currentOfficeId is ignored by /receipt (it doesn't cross-check),
      // and is exactly what /resume needs to catch a candidate who
      // followed a "pay later" link for one office but is somehow
      // resuming a reference that belongs to a different one.
      body: JSON.stringify({ reference, currentOfficeId: officeId }),
    })
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Could not load this form")
        return data
      })
      .then((data) => {
        if (completed) {
          setReceiptData(data)
        } else {
          setReadyData(data)
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [completed, reference])

  return (
    <main className="min-h-screen bg-ink">
      <SiteHeader title={completed ? "Payment receipt" : "Complete payment"} />

      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        {loading && <p className="text-center text-sm text-muted">Loading…</p>}

        {!loading && error && (
          <div className="rounded-2xl border border-line bg-ink-2 p-6 text-center">
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        {!loading && !error && !completed && readyData && (
          <PaymentReadyView
            electionId={electionId}
            officeId={officeId}
            reference={reference}
            data={readyData}
            onCompleted={() =>
              router.push(`/election/${electionId}/office/${officeId}/payment-resume?completed=1&ref=${encodeURIComponent(reference)}`)
            }
          />
        )}

        {!loading && !error && completed && receiptData && <ReceiptView data={receiptData} />}
      </div>

      <Footer />
    </main>
  )
}
