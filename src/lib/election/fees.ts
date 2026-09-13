/**
 * src/lib/election/fees.ts
 *
 * Mirrors spotix-backend's v1/lib/election/fees.js — keep both in sync.
 * The api/v1/election/ref route is the authoritative source of the
 * charged amount (it recomputes this server-side from the office's
 * form_fee, never trusting a client-supplied total); this copy exists
 * for display estimates on the candidate form before checkout opens.
 *
 * serviceFee (what the candidate actually pays on top of the office's
 * form fee) is two components added together:
 *   - platformFee: Spotix's own cut — ELECTION_ROYALTY_PERCENT + a flat
 *     ELECTION_FLAT_FEE
 *   - paystackFee: passed straight through, not absorbed by the
 *     platform — Paystack's standard Nigeria local-transaction pricing
 *     (1.5% + ₦100, the ₦100 waived under ₦2,500, capped at ₦2,000
 *     total), charged on the amount that actually runs through
 *     checkout (formFee + platformFee)
 */

export const ELECTION_ROYALTY_PERCENT = 7
export const ELECTION_FLAT_FEE = 100

// Paystack's own published Nigeria local-transaction rate. If Paystack
// changes their pricing, update these — they're independent of
// ELECTION_ROYALTY_PERCENT/ELECTION_FLAT_FEE above.
export const PAYSTACK_PERCENT = 1.5
export const PAYSTACK_FLAT_FEE = 100
export const PAYSTACK_FLAT_FEE_WAIVER_THRESHOLD = 2500
export const PAYSTACK_FEE_CAP = 2000

/** Spotix's own platform fee — 7% of the office's form fee, plus a flat ₦100. */
export function calcElectionPlatformFee(formFee: number): number {
  return Math.round(formFee * (ELECTION_ROYALTY_PERCENT / 100)) + ELECTION_FLAT_FEE
}

/**
 * What Paystack itself deducts, estimated on `amount` (the sum that
 * will actually run through checkout). 1.5% + ₦100, ₦100 waived below
 * the waiver threshold, whole thing capped at PAYSTACK_FEE_CAP.
 */
export function calcPaystackFee(amount: number): number {
  if (amount <= 0) return 0
  const percentFee = amount * (PAYSTACK_PERCENT / 100)
  const flatFee = amount < PAYSTACK_FLAT_FEE_WAIVER_THRESHOLD ? 0 : PAYSTACK_FLAT_FEE
  return Math.min(Math.round(percentFee + flatFee), PAYSTACK_FEE_CAP)
}

export interface ElectionFormFee {
  /** platformFee + paystackFee — the full markup on top of the office's form fee. */
  serviceFee: number
  totalAmount: number
  netAmount: number
  /** Spotix's own cut alone (no Paystack fee). */
  platformFee: number
  /** Paystack's processing fee alone, passed through. */
  paystackFee: number
}

export function computeElectionFormFee(formFee: number): ElectionFormFee {
  const platformFee = calcElectionPlatformFee(formFee)
  const paystackFee = calcPaystackFee(formFee + platformFee)
  const serviceFee = platformFee + paystackFee
  return { serviceFee, totalAmount: formFee + serviceFee, netAmount: formFee, platformFee, paystackFee }
}
