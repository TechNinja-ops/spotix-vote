"use client"

/**
 * app/election/[electionId]/open/OpenEnlistForm.tsx
 *
 * The interactive part of /open — collects email/name/phone plus
 * whatever custom fields the organiser configured for this election's
 * voter list (fieldSpec, from election_voter_fields — same spec
 * spotix-booker's CSV template and manual-entry form use), then POSTs
 * to /api/v1/election/self-enlist.
 */

import { useState } from "react"
import { Button } from "@/components/Button"
import { CheckCircle2 } from "lucide-react"

interface VoterFieldSpec {
  key: string
  label: string
  required: boolean
}

const inputClass = "rounded-lg border border-line bg-ink-2 px-3 py-2.5 text-sm text-paper outline-none focus:border-brass"

export function OpenEnlistForm({ electionId, fieldSpec }: { electionId: string; fieldSpec: VoterFieldSpec[] }) {
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [meta, setMeta] = useState<Record<string, string>>(() => Object.fromEntries(fieldSpec.map((f) => [f.key, ""])))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ alreadyEnlisted: boolean } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/election/self-enlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ electionId, email, name, phone, meta }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error ?? "Could not register you — please try again")
      setDone({ alreadyEnlisted: data.alreadyEnlisted })
    } catch (err: any) {
      setError(err.message ?? "Could not register you — please try again")
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-ink-2 py-10 text-center">
        <CheckCircle2 size={28} className="text-brass" />
        <p className="font-display text-lg text-paper">
          {done.alreadyEnlisted ? "You're already on the voter list" : "You're on the voter list"}
        </p>
        <p className="max-w-xs text-sm text-muted">
          Sign in with <span className="text-paper">{email}</span> once voting opens to cast your vote.
        </p>
        <a href="/auth/login" className="mt-1 text-sm font-medium text-brass hover:text-brass-soft">
          Go to sign in →
        </a>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm text-paper">
        Full name
        <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>

      <label className="flex flex-col gap-1.5 text-sm text-paper">
        Email
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
      </label>

      <label className="flex flex-col gap-1.5 text-sm text-paper">
        Phone <span className="text-muted">(optional)</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
      </label>

      {fieldSpec.map((field) => (
        <label key={field.key} className="flex flex-col gap-1.5 text-sm text-paper">
          {field.label}
          {!field.required && <span className="text-muted"> (optional)</span>}
          <input
            required={field.required}
            value={meta[field.key] ?? ""}
            onChange={(e) => setMeta((m) => ({ ...m, [field.key]: e.target.value }))}
            className={inputClass}
          />
        </label>
      ))}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Button type="submit" disabled={submitting} className="mt-1 w-full">
        {submitting ? "Registering…" : "Register to vote"}
      </Button>
    </form>
  )
}
