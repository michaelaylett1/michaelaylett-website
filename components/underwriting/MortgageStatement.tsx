"use client";

/**
 * Optional "Mortgage Statement" upload for the Underwriting page.
 *
 * - useMortgageStatement(): state + handlers (local processing only;
 *   see lib/mortgageStatement.ts). Held in browser memory for the
 *   current session -- this page has no save/restore feature, and the
 *   file is never uploaded or stored anywhere. Reloading the page
 *   clears it.
 * - MortgageStatementSection: on-page upload + preview UI.
 * - MortgageStatementPrintSection: the printable report section, one
 *   statement page per printed page, omitted entirely when nothing is
 *   uploaded.
 *
 * Purely documentation: nothing here is read by any calculation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, FileText, Loader2, Maximize2, Upload, X } from "lucide-react";
import {
  MORTGAGE_ACCEPT_ATTRIBUTE,
  MORTGAGE_SUPPORTED_TEXT,
  MortgageStatementError,
  disposeMortgageStatement,
  processMortgageStatementFile,
  type MortgageStatementDoc,
} from "@/lib/mortgageStatement";

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface MortgageStatementApi {
  doc: MortgageStatementDoc | null;
  error: string;
  processing: boolean;
  /** Processes the first file of a FileList/array (replacing any existing statement). */
  handleFiles: (files: FileList | File[] | null) => Promise<void>;
  remove: () => void;
}

export function useMortgageStatement(): MortgageStatementApi {
  const [doc, setDoc] = useState<MortgageStatementDoc | null>(null);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const docRef = useRef<MortgageStatementDoc | null>(null);
  const seqRef = useRef(0);

  // Keep the latest doc in a ref so unmount cleanup can revoke its URL.
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);
  useEffect(() => () => disposeMortgageStatement(docRef.current), []);

  const handleFiles = useCallback(async (files: FileList | File[] | null) => {
    const file = files && files.length > 0 ? files[0] : null;
    if (!file) return;
    const seq = ++seqRef.current;
    setError("");
    setProcessing(true);
    try {
      const next = await processMortgageStatementFile(file);
      if (seq !== seqRef.current) {
        disposeMortgageStatement(next);
        return;
      }
      setDoc((prev) => {
        disposeMortgageStatement(prev);
        return next;
      });
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err instanceof MortgageStatementError ? err.message : "That file could not be processed. Please try a different file.");
    } finally {
      if (seq === seqRef.current) setProcessing(false);
    }
  }, []);

  const remove = useCallback(() => {
    seqRef.current++; // cancel any in-flight processing
    setDoc((prev) => {
      disposeMortgageStatement(prev);
      return null;
    });
    setError("");
    setProcessing(false);
  }, []);

  return { doc, error, processing, handleFiles, remove };
}

export function MortgageStatementSection({ api }: { api: MortgageStatementApi }) {
  const { doc, error, processing, handleFiles, remove } = api;
  const inputRef = useRef<HTMLInputElement>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [enlarged, setEnlarged] = useState(false);
  const [dragging, setDragging] = useState(false);

  // New document => back to its first page.
  useEffect(() => {
    setPageIndex(0);
    setEnlarged(false);
  }, [doc]);

  // Escape closes the enlarged view.
  useEffect(() => {
    if (!enlarged) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEnlarged(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enlarged]);

  const page = doc ? doc.pages[Math.min(pageIndex, doc.pages.length - 1)] : null;
  const pageCount = doc?.pages.length ?? 0;

  return (
    <div
      className={`print:hidden mt-6 bg-paper text-ink p-6 sm:p-8 md:p-10 transition-colors ${
        dragging ? "bg-brass/10 border-2 border-dashed border-brass" : ""
      }`}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleFiles(e.dataTransfer.files);
      }}
    >
      <p className="eyebrow text-brass mb-2">Mortgage Statement</p>
      <p className="text-sm text-ink/60 leading-relaxed mb-5 max-w-2xl">
        Optional. Upload the property&apos;s mortgage statement to include its pages in the printable
        underwriting report. It is processed locally in your browser and is never uploaded or stored
        on a server. It is not saved between visits, and it does not affect any calculation.
      </p>

      <input
        ref={inputRef}
        id="mortgageStatementInput"
        type="file"
        accept={MORTGAGE_ACCEPT_ATTRIBUTE}
        className="hidden"
        disabled={processing}
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {!doc ? (
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload Mortgage Statement. PDF or image file."
          onClick={() => !processing && inputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !processing) {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          className={`flex flex-col items-center justify-center gap-2 border border-dashed min-h-[128px] max-w-md p-4 text-center cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-brass ${
            dragging ? "border-brass bg-brass/10" : "border-line-dark bg-white/60 hover:border-brass"
          }`}
        >
          {processing ? (
            <Loader2 size={18} className="animate-spin text-brass" aria-hidden="true" />
          ) : (
            <Upload size={18} className={dragging ? "text-brass" : "text-ink/40"} aria-hidden="true" />
          )}
          <span className="text-xs text-ink/60">
            {processing ? "Reading and rendering pages..." : dragging ? "Drop the statement here" : "Upload Mortgage Statement"}
          </span>
          {!processing && (
            <span className="text-[10px] text-ink/40">Click to browse, or drag and drop. PDF, JPG, PNG, WEBP and more.</span>
          )}
        </div>
      ) : (
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3 text-sm">
            <FileText size={16} className="text-brass flex-shrink-0" aria-hidden="true" />
            <span className="font-medium text-ink break-all">{doc.name}</span>
            <span className="text-xs text-ink/50">
              {formatSize(doc.size)}
              {doc.size > 0 ? " · " : ""}
              {pageCount} {pageCount === 1 ? "page" : "pages"}
            </span>
          </div>

          <div className="relative border border-line-dark bg-paper-2 p-2">
            {page && (
              <button
                type="button"
                onClick={() => setEnlarged(true)}
                aria-label="Enlarge mortgage statement page"
                className="block w-full cursor-zoom-in"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={page.dataUrl}
                  alt={`Mortgage statement page ${pageIndex + 1} of ${pageCount}`}
                  className="mx-auto h-auto max-h-[520px] w-auto max-w-full object-contain bg-white"
                />
              </button>
            )}
          </div>

          {pageCount > 1 && (
            <div className="mt-3 flex items-center justify-center gap-4 text-sm">
              <button
                type="button"
                onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
                disabled={pageIndex === 0}
                aria-label="Previous page"
                className="inline-flex items-center gap-1 border border-line-dark px-3 py-1.5 hover:border-brass disabled:opacity-40 disabled:hover:border-line-dark"
              >
                <ArrowLeft size={14} aria-hidden="true" /> Prev
              </button>
              <span className="text-ink/70">
                Page {pageIndex + 1} of {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPageIndex((i) => Math.min(pageCount - 1, i + 1))}
                disabled={pageIndex >= pageCount - 1}
                aria-label="Next page"
                className="inline-flex items-center gap-1 border border-line-dark px-3 py-1.5 hover:border-brass disabled:opacity-40 disabled:hover:border-line-dark"
              >
                Next <ArrowRight size={14} aria-hidden="true" />
              </button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setEnlarged(true)}
              className="inline-flex items-center gap-2 border border-line-dark px-4 py-2 text-sm hover:border-brass transition-colors"
            >
              <Maximize2 size={14} aria-hidden="true" /> Enlarge
            </button>
            <a
              href={doc.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 border border-line-dark px-4 py-2 text-sm hover:border-brass transition-colors"
            >
              View Original Document <ExternalLink size={14} aria-hidden="true" />
            </a>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={processing}
              className="inline-flex items-center gap-2 border border-line-dark px-4 py-2 text-sm hover:border-brass transition-colors disabled:opacity-50"
            >
              {processing ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />}
              Replace
            </button>
            <button
              type="button"
              onClick={remove}
              className="inline-flex items-center gap-2 border border-line-dark px-4 py-2 text-sm text-red-700 hover:border-red-700 transition-colors"
            >
              <X size={14} aria-hidden="true" /> Remove
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700 max-w-2xl">
          {error}
        </p>
      )}

      <p className="mt-4 text-xs text-ink/50 leading-relaxed max-w-2xl">{MORTGAGE_SUPPORTED_TEXT}</p>

      {enlarged && page && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Mortgage statement, enlarged"
          className="fixed inset-0 z-50 flex flex-col bg-black/80 print:hidden"
          onClick={() => setEnlarged(false)}
        >
          <div className="flex items-center justify-between px-4 py-3 text-white text-sm">
            <span>
              {doc?.name} · Page {pageIndex + 1} of {pageCount}
            </span>
            <div className="flex items-center gap-2">
              {pageCount > 1 && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPageIndex((i) => Math.max(0, i - 1));
                    }}
                    disabled={pageIndex === 0}
                    aria-label="Previous page"
                    className="border border-white/40 px-3 py-1 disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPageIndex((i) => Math.min(pageCount - 1, i + 1));
                    }}
                    disabled={pageIndex >= pageCount - 1}
                    aria-label="Next page"
                    className="border border-white/40 px-3 py-1 disabled:opacity-40"
                  >
                    Next
                  </button>
                </>
              )}
              <button type="button" onClick={() => setEnlarged(false)} aria-label="Close" className="border border-white/40 px-3 py-1">
                Close
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={page.dataUrl}
              alt={`Mortgage statement page ${pageIndex + 1} of ${pageCount}, enlarged`}
              className="mx-auto h-auto w-full max-w-[1100px] bg-white"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Printable report section: a "Mortgage Statement" heading, then every
 * page in order, each on its own printed page and scaled to fit
 * (object-contain: never stretched or cropped, never split across two
 * printed pages). Renders nothing at all when no statement is uploaded.
 * The page images are pre-rendered JPEG data URLs, so there is no
 * rendering work left to finish when the browser's Print dialog opens
 * (and printSummary() additionally awaits image decoding first).
 */
export function MortgageStatementPrintSection({ doc }: { doc: MortgageStatementDoc | null }) {
  if (!doc || doc.pages.length === 0) return null;
  const total = doc.pages.length;
  return (
    <div className="hidden print:block">
      {doc.pages.map((p, i) => (
        <div key={p.id} className="print:break-before-page print:break-inside-avoid-page">
          <p className="text-[16pt] font-display font-bold text-ink mb-3 pb-2 border-b-4 border-brass">
            Mortgage Statement
            {total > 1 && (
              <span className="ml-3 text-[10pt] font-normal text-ink/60">
                Page {i + 1} of {total}
              </span>
            )}
          </p>
          <div className="flex items-start justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              data-mortgage-page
              src={p.dataUrl}
              alt={`Mortgage statement page ${i + 1} of ${total}`}
              loading="eager"
              decoding="sync"
              className="block h-auto w-auto max-w-full max-h-[8.4in] object-contain bg-white"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
