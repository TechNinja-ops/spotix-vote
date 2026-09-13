/**
 * src/lib/election/sale-window.ts
 *
 * hasSaleEnded() used to live inside components/SaleCountdown.tsx, but
 * that file is "use client" — the directive marks every export of the
 * module as client-only, so nothing in it can be called directly from
 * a Server Component (only rendered as JSX). hasSaleEnded() is pure
 * boolean math with zero browser/React dependency, so it lives here
 * instead: both the client SaleCountdown component and any Server
 * Component (e.g. app/election/[electionId]/office/page.tsx) can call
 * it directly, with no boundary crossing either way.
 */
export function hasSaleEnded(endsAt: string | null): boolean {
  if (!endsAt) return false
  return new Date(endsAt).getTime() - Date.now() <= 0
}
