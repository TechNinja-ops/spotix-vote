"use client"

/**
 * src/components/SaleCountdown.tsx
 *
 * "Sale of forms end in dd:hh:mm:ss" — ticks every second via
 * setInterval. Mirrors spotix-booker's FormSaleCountdown
 * (app/elections/[electionId]/components/OfficesTab.tsx) so organisers
 * and candidates see identical wording on either side of the same
 * deadline (election_offices.form_sale_ends_at) — deliberately
 * duplicated rather than shared across repos, same convention as every
 * other small cross-repo-but-not-cross-package helper in this app
 * (e.g. lib/dicebear.ts / lib/election/wat-date.js-style helpers).
 *
 * Renders nothing once the deadline has passed and `hideWhenEnded` is
 * true — callers that need to react to "sale closed" (disabling a
 * form, say) should check the deadline themselves rather than inferring
 * it from this component disappearing.
 */

import { useEffect, useState } from "react"
import { hasSaleEnded } from "@/lib/election/sale-window"

export { hasSaleEnded }

export function SaleCountdown({ endsAt, hideWhenEnded = false }: { endsAt: string; hideWhenEnded?: boolean }) {
  const [remainingMs, setRemainingMs] = useState(() => new Date(endsAt).getTime() - Date.now())

  useEffect(() => {
    const id = setInterval(() => setRemainingMs(new Date(endsAt).getTime() - Date.now()), 1000)
    return () => clearInterval(id)
  }, [endsAt])

  if (remainingMs <= 0) {
    if (hideWhenEnded) return null
    return <span className="rounded-full border border-line bg-ink-2 px-3 py-1 text-xs font-medium text-muted">Sale of forms ended</span>
  }

  const totalSeconds = Math.floor(remainingMs / 1000)
  const dd = Math.floor(totalSeconds / 86400)
  const hh = Math.floor((totalSeconds % 86400) / 3600)
  const mm = Math.floor((totalSeconds % 3600) / 60)
  const ss = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, "0")

  return (
    <span className="rounded-full border border-brass/60 bg-brass/10 px-3 py-1 text-xs font-medium text-brass-soft">
      Sale of forms end in {pad(dd)}:{pad(hh)}:{pad(mm)}:{pad(ss)}
    </span>
  )
}

