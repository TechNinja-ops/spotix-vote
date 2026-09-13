"use client"

/**
 * app/election/[electionId]/office/[officeId]/page.tsx
 *
 * Public candidate registration form for one office. No sign-in
 * required — anyone contesting a post fills this out. Flow:
 *
 *   1. Fetch office + dynamic questions (GET /api/v1/election/office/{officeId})
 *   2. Fill form (photo is REQUIRED — a candidate without a photo never
 *      reaches step 3), upload photo to Cloudinary (<5MB, client-side)
 *   3. POST /api/v1/election/ref
 *        - free office → candidate attached immediately, done
 *        - paid office → reference returned, open Paystack checkout
 *   4. On checkout success, show a "payment received, we're confirming"
 *      state (the actual candidate row is attached by spotix-backend's
 *      webhook, not by this page)
 *   5. "Pay later" closes the form without opening checkout — the
 *      "Resume Payment" dialog (paste the reference we showed you →
 *      pulls up that Reference doc directly, see
 *      /api/v1/election/resume/route.ts) lets them come back and finish
 *      whenever
 *
 * Styling matches the rest of the app's ballot-stub shell (SiteHeader +
 * hero + pulled-up card — see app/elections/page.tsx for the pattern
 * this mirrors) instead of the bare unstyled form this used to be.
 */

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/Button"
import { Pill } from "@/components/Pill"
import { SiteHeader } from "@/components/SiteHeader"
import { Footer } from "@/components/Footer"
import { uploadCandidatePhoto, PhotoTooLargeError } from "@/lib/election/cloudinary-upload"
import { uploadCandidateBioData, BioDataTooLargeError } from "@/lib/election/bio-data-upload"
import { BIO_DATA_CANDIDATE_NOTICE } from "@/lib/election/bio-data"
import { PaymentMethodDialog } from "@/components/payment/PaymentMethodDialog"
import { SaleCountdown, hasSaleEnded } from "@/components/SaleCountdown"
import { FileDropzone } from "@/components/FileDropzone"

interface OfficeQuestion {
  questionId: string
  questionText: string
  questionType: "short_text" | "long_text" | "select" | "multi_select"
  options: string[] | null
  required: boolean
}

interface OfficeDetail {
  electionId: string
  electionName: string
  officeId: string
  officeName: string
  formFee: number
  fee: { serviceFee: number; totalAmount: number } | null
  questions: OfficeQuestion[]
  editGraceDays: number
  bioDataRequired: boolean
  bioDataLabel: string
  formSaleEndsAt: string | null
}

type AnswerValue = string | string[]

function toggleMultiAnswer(current: AnswerValue | undefined, option: string): string[] {
  const arr = Array.isArray(current) ? current : []
  return arr.includes(option) ? arr.filter((o) => o !== option) : [...arr, option]
}

const inputClass =
  "rounded-lg border border-line bg-ink-2 px-3 py-2.5 text-sm text-paper outline-none focus:border-brass"

type Stage = "loading" | "form" | "submitting" | "method" | "confirming" | "done" | "error"

export default function CandidateFormPage() {
  const { electionId, officeId } = useParams<{ electionId: string; officeId: string }>()
  const router = useRouter()

  const [office, setOffice] = useState<OfficeDetail | null>(null)
  const [stage, setStage] = useState<Stage>("loading")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [payLaterLoading, setPayLaterLoading] = useState(false)
  const [pendingCheckout, setPendingCheckout] = useState<{ reference: string; totalAmount: number } | null>(null)

  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [bioDataFile, setBioDataFile] = useState<File | null>(null)
  const [bioDataError, setBioDataError] = useState<string | null>(null)

  const [resumeOpen, setResumeOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  useEffect(() => {
    fetch(`/api/v1/election/office/${officeId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? "Could not load this office")
        return res.json()
      })
      .then((data: OfficeDetail) => {
        setOffice(data)
        setStage("form")
      })
      .catch((err) => {
        setErrorMsg(err.message)
        setStage("error")
      })
  }, [officeId])

  function handlePhotoChange(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError("Photo must be under 5MB")
      return
    }
    setPhotoError(null)
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  function handleBioDataChange(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      setBioDataError("File must be under 10MB")
      return
    }
    setBioDataError(null)
    setBioDataFile(file)
  }

  async function submitForm(payLater: boolean) {
    if (!office) return
    if (hasSaleEnded(office.formSaleEndsAt)) {
      setErrorMsg("Sale of forms for this office has ended")
      setStage("error")
      return
    }

    // Belt-and-braces alongside the file input's `required` attribute —
    // some browsers (notably older mobile Safari) don't reliably block
    // submission on a required file input.
    if (!photoFile) {
      setPhotoError("A photo is required to contest this office")
      return
    }

    setStage("submitting")
    setErrorMsg(null)
    if (payLater) setPayLaterLoading(true)

    try {
      const photoUrl = await uploadCandidatePhoto(photoFile)

      let bioDataPath = ""
      if (office.bioDataRequired && bioDataFile) {
        bioDataPath = await uploadCandidateBioData(bioDataFile, office.electionId, office.officeId)
      }

      const res = await fetch("/api/v1/election/ref", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          electionId: office.electionId,
          officeId: office.officeId,
          fullName,
          email,
          phone,
          photoUrl,
          answers,
          bioDataPath,
          payLater,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Could not submit your form")

      if (data.free) {
        setStage("done")
        return
      }

      if (payLater) {
        // Reference is saved (status "pending") and the reminder email
        // is already on its way (server-side, see /api/v1/election/ref)
        // — nothing left to do here but hand them the same link the
        // email contains.
        router.push(
          `/election/${office.electionId}/office/${office.officeId}/payment-resume?completed=0&ref=${encodeURIComponent(data.reference)}`
        )
        return
      }

      setPendingCheckout({ reference: data.reference, totalAmount: data.totalAmount })
      setStage("method")
    } catch (err: any) {
      if (err instanceof PhotoTooLargeError) {
        setPhotoError(err.message)
        setStage("form")
        return
      }
      if (err instanceof BioDataTooLargeError) {
        setBioDataError(err.message)
        setStage("form")
        return
      }
      setErrorMsg(err.message ?? "Something went wrong")
      setStage("error")
    } finally {
      if (payLater) setPayLaterLoading(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    submitForm(false)
  }

  if (stage === "loading") {
    return (
      <main className="min-h-screen bg-ink">
        <SiteHeader title="Contest this office" />
        <p className="mx-auto max-w-lg px-6 py-16 text-center text-muted">Loading…</p>
      </main>
    )
  }
  if (stage === "error" && !office) {
    return (
      <main className="min-h-screen bg-ink">
        <SiteHeader title="Contest this office" />
        <p className="mx-auto max-w-lg px-6 py-16 text-center text-danger">{errorMsg}</p>
      </main>
    )
  }
  if (stage === "confirming") {
    return (
      <main className="min-h-screen bg-ink">
        <SiteHeader title={office?.officeName ?? "Contest this office"} />
        <div className="mx-auto max-w-lg px-6 py-16 text-center">
          <Pill tone="success">Payment received</Pill>
          <h1 className="mt-4 font-display text-2xl text-paper">Confirming your form</h1>
          <p className="mt-2 text-sm text-muted">
            We're finalizing your registration — this usually takes a few seconds. You'll be listed as a candidate
            for {office?.officeName} once it clears.
          </p>
        </div>
      </main>
    )
  }
  if (stage === "done") {
    return (
      <main className="min-h-screen bg-ink">
        <SiteHeader title={office?.officeName ?? "Contest this office"} />
        <div className="mx-auto max-w-lg px-6 py-16 text-center">
          <Pill tone="success">Submitted</Pill>
          <h1 className="mt-4 font-display text-2xl text-paper">You're in the race</h1>
          <p className="mt-2 text-sm text-muted">Your form for {office?.officeName} has been received.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-ink">
      <SiteHeader title={office?.officeName ?? "Contest this office"} />

      <div className="relative h-32 w-full sm:h-40">
        <div className="h-full w-full bg-gradient-to-br from-purple/40 via-ink to-ink" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent" />
      </div>

      <div className="mx-auto max-w-3xl px-4 -mt-10 pb-24 sm:px-6">
        <div className="rounded-2xl border border-line bg-ink-2/90 p-6 backdrop-blur sm:p-8 lg:p-10">
          <p className="font-mono text-xs uppercase tracking-widest text-brass-soft">{office?.electionName}</p>
          <h1 className="mt-1 font-display text-2xl text-paper sm:text-3xl">{office?.officeName}</h1>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {office?.fee ? (
              <Pill tone="brass">
                ₦{office.formFee.toLocaleString()} + ₦{office.fee.serviceFee.toLocaleString()} service fee = ₦
                {office.fee.totalAmount.toLocaleString()}
              </Pill>
            ) : (
              <Pill tone="success">Free to contest</Pill>
            )}
            {office?.bioDataRequired && <Pill tone="muted">Bio data required</Pill>}
            {office?.formSaleEndsAt && <SaleCountdown endsAt={office.formSaleEndsAt} />}
          </div>

          <div className="mt-4 rounded-lg border border-line bg-ink px-4 py-3 text-sm text-muted">
            {office && office.editGraceDays > 0 ? (
              <>
                After you submit{office.fee ? " and payment is confirmed" : ""}, you'll have{" "}
                <span className="text-paper">
                  {office.editGraceDays} day{office.editGraceDays === 1 ? "" : "s"}
                </span>{" "}
                to fix your name, phone number, photo, or answers — after that, your details are locked in for good.
              </>
            ) : (
              <>
                Once you submit this form{office?.fee ? " and payment is confirmed" : ""}, your details can't be
                changed — double-check your name, phone number, and photo before continuing.
              </>
            )}
          </div>

          {office && hasSaleEnded(office.formSaleEndsAt) ? (
            <div className="mt-6 rounded-lg border border-line bg-ink px-4 py-6 text-center">
              <p className="text-sm text-paper">Sale of forms for this office has ended.</p>
              <p className="mt-1 text-xs text-muted">Reach out to your election organiser if you think this is a mistake.</p>
            </div>
          ) : (
          <form onSubmit={handleSubmit} className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm text-paper">
              Full name
              <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
            </label>

            <label className="flex flex-col gap-1.5 text-sm text-paper">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm text-paper sm:col-span-2">
              Phone
              <input required value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
            </label>

            <div className="sm:col-span-2">
              <FileDropzone
                label="Photo"
                required
                hint="Under 5MB — voters will see this on the ballot."
                accept="image/*"
                variant="avatar"
                file={photoFile}
                previewUrl={photoPreview}
                onFileSelected={handlePhotoChange}
                error={photoError}
              />
            </div>

            {office?.bioDataRequired && (
              <div className="sm:col-span-2">
                <FileDropzone
                  label={office.bioDataLabel || "Bio data document"}
                  required
                  hint="PDF, JPG, PNG, or HEIC"
                  accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
                  file={bioDataFile}
                  onFileSelected={handleBioDataChange}
                  onClear={() => setBioDataFile(null)}
                  error={bioDataError}
                />
                <span className="mt-1.5 block text-xs text-muted">{BIO_DATA_CANDIDATE_NOTICE}</span>
              </div>
            )}

            {office?.questions.map((q) => (
              <label
                key={q.questionId}
                className={`flex flex-col gap-1.5 text-sm text-paper ${
                  q.questionType === "long_text" || q.questionType === "multi_select" ? "sm:col-span-2" : ""
                }`}
              >
                {q.questionText}
                {q.questionType === "long_text" ? (
                  <textarea
                    required={q.required}
                    rows={4}
                    value={(answers[q.questionId] as string) ?? ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.questionId]: e.target.value }))}
                    className={inputClass}
                  />
                ) : q.questionType === "select" ? (
                  <select
                    required={q.required}
                    value={(answers[q.questionId] as string) ?? ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.questionId]: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    {(q.options ?? []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : q.questionType === "multi_select" ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-line bg-ink-2 px-3 py-2.5">
                    {(q.options ?? []).map((opt) => {
                      const current = answers[q.questionId]
                      const checked = Array.isArray(current) && current.includes(opt)
                      return (
                        <label key={opt} className="flex items-center gap-2 text-sm text-paper">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setAnswers((a) => ({ ...a, [q.questionId]: toggleMultiAnswer(a[q.questionId], opt) }))}
                            className="accent-[var(--color-brass)]"
                          />
                          {opt}
                        </label>
                      )
                    })}
                  </div>
                ) : (
                  <input
                    required={q.required}
                    value={(answers[q.questionId] as string) ?? ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.questionId]: e.target.value }))}
                    className={inputClass}
                  />
                )}
              </label>
            ))}

            {errorMsg && <p className="text-sm text-danger sm:col-span-2">{errorMsg}</p>}

            <Button type="submit" disabled={stage === "submitting"} className="mt-2 w-full sm:col-span-2">
              {stage === "submitting" && !payLaterLoading
                ? "Submitting…"
                : office?.fee
                  ? `Pay ₦${office.fee.totalAmount.toLocaleString()} & submit`
                  : "Submit"}
            </Button>

            {office?.fee && (
              <button
                type="button"
                disabled={stage === "submitting"}
                onClick={() => submitForm(true)}
                className="w-full rounded-lg border border-line py-2.5 text-sm font-medium text-paper transition-colors hover:border-brass disabled:opacity-50 sm:col-span-2"
              >
                {payLaterLoading ? "Saving your form…" : "I'll pay later (save my form)"}
              </button>
            )}

            <div className="flex flex-col items-center gap-1 pt-1 sm:col-span-2">
              {office?.fee && (
                <button
                  type="button"
                  onClick={() => setResumeOpen(true)}
                  className="text-sm text-muted underline hover:text-paper"
                >
                  Already started a form? Resume payment
                </button>
              )}
              {office && office.editGraceDays > 0 && (
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="text-sm text-muted underline hover:text-paper"
                >
                  Already submitted? Edit my details
                </button>
              )}
            </div>
          </form>
          )}
        </div>
      </div>

      {stage === "method" && office && pendingCheckout && (
        <PaymentMethodDialog
          metadata={{
            electionId: office.electionId,
            electionName: office.electionName,
            officeId: office.officeId,
            officeName: office.officeName,
          }}
          email={email}
          fullName={fullName}
          phone={phone}
          pendingCheckout={pendingCheckout}
          onSuccess={() =>
            router.push(
              `/election/${office.electionId}/office/${office.officeId}/payment-resume?completed=1&ref=${encodeURIComponent(pendingCheckout.reference)}`
            )
          }
          onCancel={() => setStage("form")}
        />
      )}

      {resumeOpen && office && <ResumePaymentDialog office={office} onClose={() => setResumeOpen(false)} />}
      {editOpen && office && <EditDetailsDialog office={office} onClose={() => setEditOpen(false)} />}

      <Footer />
    </main>
  )
}


function ResumePaymentDialog({ office, onClose }: { office: OfficeDetail; onClose: () => void }) {
  const router = useRouter()
  const [reference, setReference] = useState("")
  const [status, setStatus] = useState<null | {
    reference: string
    status: string
    candidateCredited: boolean
    totalAmount: number
    fullName: string
    email: string
    phone: string
  }>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function lookup() {
    setLoading(true)
    setLookupError(null)
    try {
      const res = await fetch("/api/v1/election/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: reference.trim(), currentOfficeId: office.officeId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Not found")
      setStatus(data)
    } catch (err: any) {
      setLookupError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const [showMethodPicker, setShowMethodPicker] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6">
      <div className="w-full max-w-sm rounded-xl border border-line bg-ink-2 p-6">
        <h2 className="font-display text-lg text-paper">Resume payment</h2>

        {!status ? (
          <>
            <p className="mt-1 text-sm text-muted">
              Paste the reference we showed you when you started this form (looks like SPTX-ELE-…).
            </p>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="mt-4 w-full rounded-lg border border-line bg-ink px-3 py-2.5 text-sm text-paper outline-none focus:border-brass"
              placeholder="SPTX-ELE-1787500960860-LK"
            />
            {lookupError && <p className="mt-2 text-sm text-danger">{lookupError}</p>}
            <div className="mt-4 flex gap-2">
              <Button onClick={lookup} disabled={loading || !reference.trim()} className="flex-1">
                {loading ? "Looking up…" : "Find my form"}
              </Button>
              <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-muted">
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-3 flex items-center gap-2">
              <Pill tone={status.candidateCredited ? "success" : status.status === "successful" ? "brass" : "muted"}>
                {status.candidateCredited ? "Confirmed" : status.status === "successful" ? "Confirming…" : "Pending payment"}
              </Pill>
            </div>
            <p className="mt-2 text-sm text-muted">Amount due: ₦{status.totalAmount.toLocaleString()}</p>
            <div className="mt-4 flex gap-2">
              {!status.candidateCredited && status.status !== "successful" && (
                <Button onClick={() => setShowMethodPicker(true)} className="flex-1">
                  Pay now
                </Button>
              )}
              <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-muted">
                Close
              </button>
            </div>
          </>
        )}
      </div>

      {showMethodPicker && status && (
        <PaymentMethodDialog
          metadata={{
            electionId: office.electionId,
            electionName: office.electionName,
            officeId: office.officeId,
            officeName: office.officeName,
          }}
          email={status.email}
          fullName={status.fullName}
          phone={status.phone}
          pendingCheckout={{ reference: status.reference, totalAmount: status.totalAmount }}
          onSuccess={() =>
            router.push(
              `/election/${office.electionId}/office/${office.officeId}/payment-resume?completed=1&ref=${encodeURIComponent(status.reference)}`
            )
          }
          onCancel={() => setShowMethodPicker(false)}
        />
      )}
    </div>
  )
}

function EditDetailsDialog({ office, onClose }: { office: OfficeDetail; onClose: () => void }) {
  const [email, setEmail] = useState("")
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [candidate, setCandidate] = useState<null | {
    candidateId: string
    fullName: string
    email: string
    phone: string
    photoUrl: string
    answers: Record<string, AnswerValue>
    bioDataPath: string
    editable: boolean
    editableUntil: string | null
  }>(null)

  const [fullName, setFullName] = useState("")
  const [phone, setPhone] = useState("")
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [bioDataFile, setBioDataFile] = useState<File | null>(null)
  const [bioDataError, setBioDataError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function lookup() {
    setLoading(true)
    setLookupError(null)
    try {
      const res = await fetch("/api/v1/election/candidate/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ officeId: office.officeId, email }),
      })
      const data = await res.json()
      // Also covers a paid submission whose reference isn't "successful"
      // yet (still pending, or reversed) — findCandidateForEdit
      // treats that the same as "not found" server-side, on purpose,
      // so there's nothing more specific to say here.
      if (!res.ok) throw new Error(data.error ?? "Not found")
      setCandidate(data)
      setFullName(data.fullName)
      setPhone(data.phone)
      setPhotoPreview(data.photoUrl || null)
      setAnswers(data.answers ?? {})
      // bioDataFile stays empty on load — re-selecting is opt-in; leaving it
      // unset keeps candidate.bioDataPath (the already-uploaded document) intact
    } catch (err: any) {
      setLookupError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handlePhotoChange(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError("Photo must be under 5MB")
      return
    }
    setPhotoError(null)
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  async function handleSave() {
    if (!candidate) return
    setSaving(true)
    setSaveError(null)
    try {
      let photoUrl = candidate.photoUrl
      if (photoFile) photoUrl = await uploadCandidatePhoto(photoFile)

      let bioDataPath = candidate.bioDataPath
      if (office.bioDataRequired && bioDataFile) {
        bioDataPath = await uploadCandidateBioData(bioDataFile, office.electionId, office.officeId)
      }

      const res = await fetch("/api/v1/election/candidate/edit", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: candidate.candidateId,
          email: candidate.email,
          fullName,
          phone,
          photoUrl,
          answers,
          bioDataPath,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Could not save your changes")
      setSaved(true)
    } catch (err: any) {
      if (err instanceof PhotoTooLargeError) {
        setPhotoError(err.message)
      } else if (err instanceof BioDataTooLargeError) {
        setBioDataError(err.message)
      } else {
        setSaveError(err.message)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6 py-8 overflow-y-auto">
      <div className="w-full max-w-sm rounded-xl border border-line bg-ink-2 p-6 sm:max-w-2xl sm:p-8 lg:max-w-3xl">
        <h2 className="font-display text-lg text-paper">Edit my details</h2>

        {!candidate ? (
          <>
            <p className="mt-1 text-sm text-muted">Enter the email you used on your form.</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-4 w-full rounded-lg border border-line bg-ink px-3 py-2.5 text-sm text-paper outline-none focus:border-brass"
              placeholder="you@example.com"
            />
            {lookupError && <p className="mt-2 text-sm text-danger">{lookupError}</p>}
            <div className="mt-4 flex gap-2">
              <Button onClick={lookup} disabled={loading || !email} className="flex-1">
                {loading ? "Looking up…" : "Find my submission"}
              </Button>
              <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-muted">
                Cancel
              </button>
            </div>
          </>
        ) : saved ? (
          <>
            <Pill tone="success">Saved</Pill>
            <p className="mt-2 text-sm text-muted">Your details have been updated.</p>
            <button onClick={onClose} className="mt-4 rounded-lg border border-line px-4 py-2 text-sm text-muted">
              Close
            </button>
          </>
        ) : !candidate.editable ? (
          <>
            <Pill tone="danger">Edit window closed</Pill>
            <p className="mt-2 text-sm text-muted">
              {candidate.editableUntil
                ? `Editing closed on ${new Date(candidate.editableUntil).toLocaleString()}.`
                : "This election doesn't allow edits after submitting."}
            </p>
            <button onClick={onClose} className="mt-4 rounded-lg border border-line px-4 py-2 text-sm text-muted">
              Close
            </button>
          </>
        ) : (
          <>
            {candidate.editableUntil && (
              <p className="mt-1 text-xs text-muted">You can edit until {new Date(candidate.editableUntil).toLocaleString()}.</p>
            )}

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm text-paper">
                Full name
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-paper">
                Phone
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
              </label>
              <div className="sm:col-span-2">
                <FileDropzone
                  label="Photo"
                  hint="Under 5MB"
                  accept="image/*"
                  variant="avatar"
                  file={photoFile}
                  previewUrl={photoPreview}
                  onFileSelected={handlePhotoChange}
                  error={photoError}
                />
              </div>

              {office.bioDataRequired && (
                <div className="sm:col-span-2">
                  <FileDropzone
                    label={office.bioDataLabel || "Bio data document"}
                    hint="Leave blank to keep your previously uploaded document."
                    accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
                    file={bioDataFile}
                    onFileSelected={(file) => {
                      if (file.size > 10 * 1024 * 1024) {
                        setBioDataError("File must be under 10MB")
                        return
                      }
                      setBioDataError(null)
                      setBioDataFile(file)
                    }}
                    onClear={() => setBioDataFile(null)}
                    error={bioDataError}
                  />
                  {bioDataFile && <span className="mt-1.5 block text-xs text-muted">New file selected: {bioDataFile.name}</span>}
                </div>
              )}

              {office.questions.map((q) => (
                <label
                  key={q.questionId}
                  className={`flex flex-col gap-1.5 text-sm text-paper ${
                    q.questionType === "long_text" || q.questionType === "multi_select" ? "sm:col-span-2" : ""
                  }`}
                >
                  {q.questionText}
                  {q.questionType === "long_text" ? (
                    <textarea
                      rows={3}
                      value={(answers[q.questionId] as string) ?? ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.questionId]: e.target.value }))}
                      className={inputClass}
                    />
                  ) : q.questionType === "select" ? (
                    <select
                      value={(answers[q.questionId] as string) ?? ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.questionId]: e.target.value }))}
                      className={inputClass}
                    >
                      <option value="" disabled>
                        Choose…
                      </option>
                      {(q.options ?? []).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : q.questionType === "multi_select" ? (
                    <div className="flex flex-col gap-2 rounded-lg border border-line bg-ink px-3 py-2.5">
                      {(q.options ?? []).map((opt) => {
                        const current = answers[q.questionId]
                        const checked = Array.isArray(current) && current.includes(opt)
                        return (
                          <label key={opt} className="flex items-center gap-2 text-sm text-paper">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setAnswers((a) => ({ ...a, [q.questionId]: toggleMultiAnswer(a[q.questionId], opt) }))}
                              className="accent-[var(--color-brass)]"
                            />
                            {opt}
                          </label>
                        )
                      })}
                    </div>
                  ) : (
                    <input
                      value={(answers[q.questionId] as string) ?? ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.questionId]: e.target.value }))}
                      className={inputClass}
                    />
                  )}
                </label>
              ))}
            </div>

            {saveError && <p className="mt-2 text-sm text-danger">{saveError}</p>}

            <div className="mt-4 flex gap-2">
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-muted">
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
