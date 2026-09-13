"use client"

/**
 * src/components/FileDropzone.tsx
 *
 * Replaces the bare `<input type="file">` (which renders as the
 * browser's own "Choose File / No file chosen" button — plain, tiny,
 * and inconsistent across browsers) used across the elections forms
 * (candidate photo, bio data document). Click-to-browse AND
 * drag-and-drop onto the same styled dropzone, with a clear
 * empty/selected/error state.
 *
 * Two variants:
 *   - "avatar"   — a round preview thumbnail (candidate photo)
 *   - "document" — a file-icon card, showing the picked filename once
 *                  chosen (bio data upload)
 *
 * Deliberately dumb/controlled: this component doesn't validate size or
 * type itself (callers already do that — see CandidateFormPage's
 * handlePhotoChange/handleBioDataChange) — it just reports the raw
 * `File` back via onFileSelected and renders whatever `file`/`previewUrl`
 * it's handed.
 */

import { useRef, useState } from "react"
import { UploadCloud, FileText, ImageIcon, X } from "lucide-react"

interface FileDropzoneProps {
  label: React.ReactNode
  required?: boolean
  hint?: string
  accept: string
  file: File | null
  /** Object URL for an image preview — only meaningful for variant="avatar". */
  previewUrl?: string | null
  onFileSelected: (file: File) => void
  onClear?: () => void
  error?: string | null
  variant?: "avatar" | "document"
  className?: string
}

export function FileDropzone({
  label,
  required,
  hint,
  accept,
  file,
  previewUrl,
  onFileSelected,
  onClear,
  error,
  variant = "document",
  className = "",
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  function handleFiles(files: FileList | null) {
    const picked = files?.[0]
    if (picked) onFileSelected(picked)
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-sm text-paper">
        {label} {required && <span className="text-danger">*</span>}
      </span>

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragActive(false)
          handleFiles(e.dataTransfer.files)
        }}
        className={`flex cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed px-4 py-4 transition-colors ${
          dragActive ? "border-brass bg-brass/5" : error ? "border-danger/50 bg-ink" : "border-line bg-ink hover:border-brass/60"
        }`}
      >
        {variant === "avatar" ? (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-ink-2">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Preview" className="h-full w-full object-cover" />
            ) : (
              <ImageIcon size={20} className="text-muted" />
            )}
          </div>
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-ink-2">
            <FileText size={20} className="text-muted" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          {file ? (
            <>
              <p className="truncate text-sm text-paper">{file.name}</p>
              <p className="text-xs text-muted">{(file.size / (1024 * 1024)).toFixed(1)}MB — click or drop to replace</p>
            </>
          ) : (
            <>
              <p className="text-sm text-paper">
                <span className="inline-flex items-center gap-1.5 text-brass">
                  <UploadCloud size={14} /> Click to upload
                </span>{" "}
                or drag and drop
              </p>
              <p className="text-xs text-muted">{hint}</p>
            </>
          )}
        </div>

        {file && onClear && (
          <button
            type="button"
            aria-label="Remove file"
            onClick={(e) => {
              e.stopPropagation()
              onClear()
            }}
            className="shrink-0 rounded-full p-1.5 text-muted transition-colors hover:bg-ink-2 hover:text-paper"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files)
          // Let selecting the same file twice in a row (after Clear) still fire onChange.
          e.target.value = ""
        }}
      />

      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  )
}
