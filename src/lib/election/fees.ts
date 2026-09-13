/**
 * src/lib/election/fees.ts
 *
 * serviceFee (what the candidate actually pays on top of the office's
 * form fee) is made of two components:
 *   - platformFee: Spotix's own cut — a percent of the form fee plus a
 *     flat amount. Configured PER ELECTION from the Admin Dashboard's
 *     Election Management page (elections.platform_fee_percent /
 *     platform_fee_flat — see /supabase/election-per-election-fees-schema.sql).
 *     Falls back to 7% + ₦100 for any election that hasn't been
 *     individually customized (those columns are null).
 *   - paystackFee: Paystack's standard Nigeria local-transaction pricing
 *     (1.5% + ₦100, the ₦100 waived under ₦2,500, capped at ₦2,000
 *     total), charged on the amount that actually runs through checkout
 *     (formFee + platformFee). WHO bears this cost — the candidate, the
 *     organizer, or neither (Spotix absorbs it) — is also configured
 *     per election (elections.paystack_fee_payer), same null-means-default
 *     fallback ("voter").
 *
 * This file is the one place both the ref route (authoritative — what's
 * actually charged) and the office route (display estimate before
 * checkout opens) read fee settings from, so the two can never drift.
 */

import { supabaseAdmin } from "@/lib/supabase"

export const DEFAULT_ELECTION_ROYALTY_PERCENT = 7
export const DEFAULT_ELECTION_FLAT_FEE = 100
export const DEFAULT_PAYSTACK_FEE_PAYER: ElectionPaystackFeePayer = "voter"

// Paystack's own published Nigeria local-transaction rate. If Paystack
// changes their pricing, update these — they're independent of the
// per-election platform fee above.
export const PAYSTACK_PERCENT = 1.5
export const PAYSTACK_FLAT_FEE = 100
export const PAYSTACK_FLAT_FEE_WAIVER_THRESHOLD = 2500
export const PAYSTACK_FEE_CAP = 2000

/**
 * "voter"     → the candidate pays Paystack's fee on top of the form fee
 *                and platform fee (current/legacy behaviour).
 * "organizer" → the candidate never sees Paystack's fee in their total;
 *                it's deducted from the office's payable net instead.
 * "none"      → Paystack's fee is charged to neither side — Spotix
 *                absorbs it out of its own platformFee cut.
 */
export type ElectionPaystackFeePayer = "voter" | "organizer" | "none"

export interface ElectionPlatformSettings {
  platformFeePercent: number
  platformFeeFlat: number
  paystackFeePayer: ElectionPaystackFeePayer
}

const DEFAULT_SETTINGS: ElectionPlatformSettings = {
  platformFeePercent: DEFAULT_ELECTION_ROYALTY_PERCENT,
  platformFeeFlat: DEFAULT_ELECTION_FLAT_FEE,
  paystackFeePayer: DEFAULT_PAYSTACK_FEE_PAYER,
}

/**
 * Reads this specific election's platform fee overrides from Supabase.
 * Each of the three fields falls back to the platform default
 * independently (an election can customize just the payer and leave
 * percent/flat alone, for instance). Also falls back entirely whenever
 * the election row can't be read for any reason — pricing should never
 * hard-fail just because this lookup is momentarily unreachable; the
 * ref/office routes already fetch the election elsewhere and would
 * surface a real "not found" themselves.
 */
export async function getElectionPlatformSettings(electionId: string): Promise<ElectionPlatformSettings> {
  try {
    const { data, error } = await supabaseAdmin
      .from("elections")
      .select("platform_fee_percent, platform_fee_flat, paystack_fee_payer")
      .eq("id", electionId)
      .maybeSingle()

    if (error || !data) return DEFAULT_SETTINGS

    return {
      platformFeePercent: data.platform_fee_percent === null || data.platform_fee_percent === undefined
        ? DEFAULT_SETTINGS.platformFeePercent
        : Number(data.platform_fee_percent),
      platformFeeFlat: data.platform_fee_flat === null || data.platform_fee_flat === undefined
        ? DEFAULT_SETTINGS.platformFeeFlat
        : Number(data.platform_fee_flat),
      paystackFeePayer: (data.paystack_fee_payer as ElectionPaystackFeePayer | null) ?? DEFAULT_SETTINGS.paystackFeePayer,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** Spotix's own platform fee — this election's configured percent of the office's form fee, plus its configured flat amount. */
export function calcElectionPlatformFee(formFee: number, settings: ElectionPlatformSettings): number {
  return Math.round(formFee * (settings.platformFeePercent / 100)) + settings.platformFeeFlat
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
  /** The markup actually added to the candidate's total (varies by paystackFeePayer). */
  serviceFee: number
  /** What the candidate is charged at checkout. */
  totalAmount: number
  /** What's actually payable out to the office/organizer once Paystack's cut (if they bear it) is removed. */
  netAmount: number
  /** Spotix's own cut alone (no Paystack fee). Always charged to the candidate. */
  platformFee: number
  /** Paystack's processing fee alone. */
  paystackFee: number
  /** Who bears paystackFee, resolved at computation time — stashed on the Reference doc for the webhook to honour later. */
  paystackFeePayer: ElectionPaystackFeePayer
}

/**
 * Computes the full fee breakdown for an office's form fee, honouring
 * THIS ELECTION's current platform-fee settings (see
 * getElectionPlatformSettings above — falls back to 7% + ₦100 /
 * "voter" for any election that hasn't customized its own fees).
 * Always re-reads settings from Supabase rather than trusting a
 * caller-supplied value, so an admin's edit to one election's fee takes
 * effect on that election's very next quote/charge without touching
 * any other election.
 */
export async function computeElectionFormFee(formFee: number, electionId: string): Promise<ElectionFormFee> {
  const settings = await getElectionPlatformSettings(electionId)

  const platformFee = calcElectionPlatformFee(formFee, settings)
  const checkoutBase = formFee + platformFee // amount before Paystack's own fee
  const paystackFee = calcPaystackFee(checkoutBase)

  switch (settings.paystackFeePayer) {
    case "organizer":
      // Candidate never sees Paystack's fee — it comes off the office's
      // payable net instead. Never let netAmount go negative on a tiny
      // form fee with a disproportionate Paystack fee.
      return {
        serviceFee: platformFee,
        totalAmount: checkoutBase,
        netAmount: Math.max(0, formFee - paystackFee),
        platformFee,
        paystackFee,
        paystackFeePayer: "organizer",
      }
    case "none":
      // Paystack's fee is charged to nobody — Spotix eats it out of its
      // own platformFee cut. Candidate pays the same as "organizer"
      // mode, but the office still gets the full form fee.
      return {
        serviceFee: platformFee,
        totalAmount: checkoutBase,
        netAmount: formFee,
        platformFee,
        paystackFee,
        paystackFeePayer: "none",
      }
    case "voter":
    default:
      // Candidate pays platform fee + Paystack fee on top of the form
      // fee (legacy/default behaviour) — the office nets the full form fee.
      return {
        serviceFee: platformFee + paystackFee,
        totalAmount: checkoutBase + paystackFee,
        netAmount: formFee,
        platformFee,
        paystackFee,
        paystackFeePayer: "voter",
      }
  }
}
