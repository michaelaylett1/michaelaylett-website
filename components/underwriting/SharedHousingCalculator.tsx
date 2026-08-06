"use client";

/**
 * Shared Housing Calculator: a self-contained underwriting tool for
 * shared-housing / co-living properties. Everything here is illustrative
 * and computed entirely client-side; nothing is submitted anywhere.
 *
 * The calculation engine lives in one place (buildUnderwriting, below)
 * and produces a single result object that every part of the UI reads
 * from: the headline stat tiles, the "View Full Underwriting Breakdown"
 * table, the CSV export, and the printable summary. That keeps the
 * numbers you see in every one of those places guaranteed to match, and
 * means a future formula change only has to happen in one function.
 *
 * Fixed, non-editable amounts:
 *   - Annual maintenance: $4,800 ($400/month)
 *   - Utilities: $80 per bedroom per month
 *   - Reserves: $10,000, an estimate set aside for the property
 *
 * Defaults that remain fully editable (the figure below is only the
 * starting value shown on load and after "Reset to Defaults"):
 *   - Platform fees: defaults to 15% of effective rent after vacancy
 *     (estimated PadSplit-style platform fees; actual charges may vary)
 *   - Cleaning: defaults to $80 per month
 *   - Lawn care: defaults to $125 per month
 *   - Pest control: defaults to $0 per month
 *   - Closing costs: defaults to 1.5% of purchase price
 *   - Holding costs: defaults to 3 months of the full monthly housing
 *     payment, automatically recalculated whenever the payment type,
 *     PITI/P&I payment, taxes, or insurance change, but the field itself
 *     stays editable so a visitor can override the estimate
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Info,
  Upload,
  Home,
  MapPin,
  Users,
  Calendar,
  Landmark,
  Play,
  DollarSign,
  TrendingUp,
  Percent,
  Wallet,
  PiggyBank,
  CheckCircle2,
  XCircle,
  HelpCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  FileText,
  ExternalLink,
  Bus,
  RefreshCw,
  Loader2,
} from "lucide-react";
import {
  exportUnderwritingToExcel,
  type ExportAmortizationSchedule,
  type ExportFinancingMode,
  type ExportTransitResult,
  type UnderwritingExportData,
} from "@/lib/underwritingExcelExport";
import {
  buildRoiProjection,
  ROI_PROJECTION_YEARS,
  ROI_REPLACEMENT_LOAN_LABEL,
  type RoiBalloonConfig,
  type RoiDebtLeg,
  type RoiProjectionResult,
  type RoiYearRow,
} from "@/lib/roiProjection";
import {
  looksLikeUsableAddress,
  looksLikeCompleteAddress,
  buildMapsEmbedUrl,
  buildMapsSearchUrl,
  buildMapsDirectionsEmbedUrl,
  buildMapsDirectionsSearchUrl,
} from "@/lib/transit/manual";
import type { TransitResult } from "@/lib/transit/manual";
// Type-only import -- the actual lookup logic in googleLookup.ts only
// ever runs server-side (from app/api/transit/auto-lookup/route.ts),
// but its response shapes are useful here to type the fetch() call
// below without redeclaring them.
import type { AutoTransitLookupResult } from "@/lib/transit/googleLookup";
// Type-only import -- the actual county lookup logic in
// lib/propertyTax/countyLookup.ts only ever runs server-side (from
// app/api/property-tax/county-lookup/route.ts), but its response shapes
// are useful here to type the fetch() call below without redeclaring
// them.
import type { CountyLookupResult } from "@/lib/propertyTax/countyLookup";
// The one authoritative state-to-default mapping for the Cleaning/Lawn
// Care/Pest Control operating expense fields, shared with
// lib/underwritingExcelExport.ts so the website and the Excel export
// always agree.
import {
  getOperatingDefaultsForState,
  operatingDefaultsSourceLabel,
  type OperatingExpenseKey,
} from "@/lib/operatingExpenseDefaults";
import { loadGooglePlacesLibrary } from "@/lib/transit/googleMapsLoader";
import type { GoogleAutocompleteSessionToken, GoogleAutocompleteSuggestion } from "@/lib/transit/googlePlacesTypes";
import {
  AUTOCOMPLETE_DEBOUNCE_MS,
  buildAutocompleteRequest,
  isStaleAutocompleteResponse,
  shouldFetchSuggestions,
} from "@/lib/transit/addressAutocomplete";
import {
  buildAmortizationScheduleForTerm,
  buildAnnualAmortizationSummary,
  calculateMonthlyPaymentForTerm,
  remainingBalanceAfterMonths,
  resolveEffectiveAmortizationTerm,
  SUBJECT_TO_AMORTIZATION_DISCLOSURE,
  type AmortizationRow,
  type AnnualAmortizationRow,
  type EffectiveAmortizationTerm,
} from "@/lib/amortization";

// ---------------------------------------------------------------------
// Fixed, non-editable amounts. Platform fees, cleaning, lawn care, pest
// control, and the closing cost percentage used to be here too, but are
// now editable defaults tracked in component state instead (see
// PERCENT_DEFAULTS and MAINTENANCE_EXPENSE_DEFAULTS below).
// ---------------------------------------------------------------------
const MAINTENANCE_ANNUAL = 4800;
const UTILITIES_PER_BEDROOM = 80;
const HOLDING_MONTHS = 3;

// Property Files: processed and stored entirely client-side (never
// uploaded anywhere). Images are compressed, orientation-corrected data
// URLs so they can be previewed on screen and embedded directly in the
// printable report; PDFs are kept as their original file, referenced by
// a temporary object URL (see processMediaFile below), since a browser
// print view cannot reliably re-embed another PDF's pages -- PDFs are
// instead shown as a linked document card, both on screen and in the
// printable report. One shared limit applies to the combined total of
// images and PDFs.
const MAX_PROPERTY_FILES = 5;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const ACCEPTED_DOCUMENT_TYPES = ["application/pdf"];
const ACCEPTED_MEDIA_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_DOCUMENT_TYPES];
const MEDIA_FILE_ERROR_MESSAGE = "Please upload a PNG, JPG, JPEG, WEBP, or PDF file.";
const MAX_IMAGE_DIMENSION = 1600;

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------
// Formatting and parsing helpers
// ---------------------------------------------------------------------
function formatWhole(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatCents(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(n: number) {
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

// Used for the interest rate(s) shown beside Cash-on-Cash Return on the
// printable report's first page: every "*InterestRatePct"/"*RatePct"
// field is normally a real, clamped number, but this guards against
// the rare not-a-number case (e.g. a field never touched/initialized
// for a given financing structure) so the report shows "Not Provided"
// rather than a misleading "0.00%".
function formatRateOrNotProvided(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Not Provided";
  return formatPercent(value);
}

// Stack Method's Current Leverage Ratio is displayed as both a decimal
// (the standard metric lenders use, e.g. 1.15x) and a percentage
// (e.g. 115.00%), decimal shown first. `decimal` is Total Debt at
// Acquisition / Purchase Price (never multiplied by 100); null (from a
// $0 Purchase Price) renders as "N/A".
function formatLeverageRatio(decimal: number | null): string {
  if (decimal === null || !Number.isFinite(decimal)) return "N/A";
  return `${decimal.toFixed(2)}x (${formatPercent(decimal * 100)})`;
}

function round2(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Parses a free-typed currency string into a number, preserving decimal
 * cents rather than stripping the decimal point. "1922.46" must parse to
 * 1922.46, not 192246: the previous version of this function stripped
 * every non-digit character (including the decimal point itself), which
 * silently multiplied any value with cents by 100. Only the first
 * decimal point is kept (a second one a visitor might type by accident
 * is dropped), and the result is never negative, NaN, or Infinite.
 */
function parseTypedAmount(raw: string): number {
  let cleaned = raw.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
  }
  if (!cleaned || cleaned === ".") return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function parseTypedInt(raw: string): number {
  const digitsOnly = raw.replace(/[^0-9]/g, "");
  if (!digitsOnly) return 0;
  const n = parseInt(digitsOnly, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function parseTypedPercent(raw: string): number {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100, n);
}

// Appreciation-rate specific parser: unlike every other percent field on
// this page, Annual Property Appreciation must allow negative values (a
// property can depreciate), so this keeps a leading "-" instead of
// stripping it, and clamps to a realistic +/-20% band rather than 0-100.
function parseSignedPercent(raw: string, min: number, max: number): number {
  const isNegative = /^\s*-/.test(raw);
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned) * (isNegative ? -1 : 1);
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, n));
}

// ---------------------------------------------------------------------
// Property Images: type, client-side processing, and print gallery
// layout. Everything here runs entirely in the browser; no image is
// ever uploaded to a server. Orientation is auto-corrected and the
// image is resized/compressed via an off-screen canvas before being
// stored as a data URL, both for on-screen previews and for the
// printable report.
// ---------------------------------------------------------------------
// A single uploaded media file, shared by Property Files, Floor Plan,
// and PadSplit Rental Data. `dataUrl` holds a compressed, orientation-
// corrected base64 data URL for images (so it can be embedded directly
// in an <img> both on screen and in the printable report), or a
// temporary object URL (via URL.createObjectURL) for PDFs, which is
// never embedded as an image and must be revoked with
// URL.revokeObjectURL when the file is removed, replaced, or cleared by
// Reset to Defaults, to avoid leaking memory. `size` is the original
// file's byte size, used only for the "PDF document card" preview.
type MediaFile = { id: string; kind: "image" | "pdf"; dataUrl: string; name: string; size: number };
type PropertyImage = MediaFile;

async function processImageFile(file: File): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    } as ImageBitmapOptions);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not supported in this browser.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    // Fallback for browsers that do not support createImageBitmap/canvas:
    // read the file directly as a data URL with no resizing or
    // orientation correction, so the upload still works.
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read the selected file."));
      reader.readAsDataURL(file);
    });
  }
}

// Processes any accepted media file (image or PDF) into a MediaFile.
// Images go through the exact same compress/orientation-correct
// pipeline as before (processImageFile above); PDFs are never converted
// into an image and are instead referenced by a temporary object URL,
// used only to open the original PDF in a new tab or embed it as a
// document-card link -- never rendered inside an <img> tag.
async function processMediaFile(file: File): Promise<Omit<MediaFile, "id" | "name">> {
  if (file.type === "application/pdf") {
    return { kind: "pdf", dataUrl: URL.createObjectURL(file), size: file.size };
  }
  const dataUrl = await processImageFile(file);
  return { kind: "image", dataUrl, size: file.size };
}

// Revokes a MediaFile's object URL if (and only if) it is a PDF -- image
// data URLs are plain base64 strings and are never registered with
// URL.createObjectURL, so calling revokeObjectURL on one would be a
// no-op at best. Safe to call on `null`/`undefined`.
function revokeMediaFile(file: { kind: "image" | "pdf"; dataUrl: string } | null | undefined) {
  if (file && file.kind === "pdf" && file.dataUrl.startsWith("blob:")) {
    URL.revokeObjectURL(file.dataUrl);
  }
}

// Determines the printable report's secondary-photo gallery grid --
// everything after the large hero photo -- based on how many secondary
// photos there are (0-4, since the hero always takes one of the 5
// available Property Files slots). Each tier trades column count for
// row height so every secondary photo stays as large as the layout can
// afford: a single secondary photo gets one full-width row, two get a
// two-column row, three get a three-column row, and four fill a
// balanced 2x2 grid rather than being squeezed into one cramped row of
// four tiny thumbnails.
function getSecondaryGalleryLayout(secondaryCount: number): { gridClass: string; imgHeightClass: string } {
  if (secondaryCount <= 1) return { gridClass: "grid-cols-1", imgHeightClass: "h-[2.1in]" };
  if (secondaryCount === 2) return { gridClass: "grid-cols-2", imgHeightClass: "h-[1.7in]" };
  if (secondaryCount === 3) return { gridClass: "grid-cols-3", imgHeightClass: "h-[1.35in]" };
  return { gridClass: "grid-cols-2", imgHeightClass: "h-[1.4in]" };
}

// Determines the printable report's image-gallery grid based on how
// many photos were uploaded: 1 = large featured image, 2 = side by
// side, 3-4 = a balanced grid, 5-6 = a compact multi-row gallery.
function getGalleryLayout(count: number): { gridClass: string; imgHeightClass: string } {
  if (count <= 1) return { gridClass: "grid-cols-1", imgHeightClass: "h-[3.2in]" };
  if (count === 2) return { gridClass: "grid-cols-2", imgHeightClass: "h-[2.4in]" };
  if (count <= 4) return { gridClass: "grid-cols-2", imgHeightClass: "h-[1.8in]" };
  return { gridClass: "grid-cols-3", imgHeightClass: "h-[1.3in]" };
}

// Floor Plan file and PadSplit Rental Data file: a single optional
// upload each (image or PDF), processed exactly like a Property File
// (see MediaFile above) so an image renders directly, as an actual
// image, in the printable report, while a PDF renders as a linked
// document card instead.
type FloorPlanFile = MediaFile;

// One Scope of Work line item: a free-text work item name and its
// estimated cost, tracked as both a parsed number (for the running
// total) and a draft string (so decimals and in-progress typing behave
// exactly like every other currency field in this calculator). Shared
// across every financing structure -- not tied to financingMode -- so
// it never disappears when the selected structure changes.
type ScopeOfWorkItem = { id: string; name: string; cost: number; costDraft: string };

// A lightweight, non-blocking check that the Video Walkthrough Link
// looks like a real web address. Empty is treated as valid since the
// field is optional.
function isLikelyValidUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Financing Structure is a single-select choice among four mutually
// exclusive modes (see the FinancingMode type below): Traditional
// Financing, Subject To, Seller Financing, and the Subject To & Seller
// Finance Hybrid, which replaces the older behavior of selecting
// Subject To and Seller Financing independently at the same time.
function getFinancingStructureLabel(mode: FinancingMode): string {
  switch (mode) {
    case "traditional":
      return "Traditional Financing";
    case "subjectTo":
      return "Subject To";
    case "sellerFinancing":
      return "Seller Financing";
    case "hybrid":
      return "Subject To & Seller Finance Hybrid";
    case "stackMethod":
      return "Stack Method";
    default:
      return "Not Specified";
  }
}

// Strips characters that are invalid in filenames on Windows/macOS (and
// awkward on most other systems) from the auto-generated print/PDF
// filename, replacing each run with a single hyphen so addresses like
// "7027 Hunnicut Rd, Dallas, TX 75227" still read cleanly.
function sanitizeForFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "-").trim();
}

// A small brass badge used to visually emphasize the word "Hybrid"
// everywhere the Subject To & Seller Finance Hybrid structure's name is
// displayed on screen or in the printable report (never in the CSV
// export or other plain-text contexts, where the plain label from
// getFinancingStructureLabel is used instead).
function HybridBadge() {
  return (
    <span className="inline-flex items-center rounded bg-brass px-1.5 py-0.5 text-ink font-bold tracking-wide align-middle">
      Hybrid
    </span>
  );
}

// Renders the current Financing Structure label as JSX, with the word
// "Hybrid" visually emphasized via HybridBadge when that structure is
// selected. Every other mode renders as plain text (getFinancingStructureLabel).
function FinancingStructureLabelDisplay({ mode }: { mode: FinancingMode }) {
  if (mode === "hybrid") {
    return (
      <>
        Subject To &amp; Seller Finance <HybridBadge />
      </>
    );
  }
  return <>{getFinancingStructureLabel(mode)}</>;
}

// Stack Method's "Can this be purchased for an estimated $0 out of
// pocket?" result, color-coded (green for Yes, red for No, neutral gray
// for TBD) with a status icon alongside the text label -- the color is
// never the only way the result is conveyed, and the text label always
// stays visible so the result reads correctly in black-and-white print
// too. `size` lets the same component be reused at a slightly smaller
// scale in the printable report.
function ZeroOutOfPocketBadge({
  value,
  size = "default",
}: {
  value: "Yes" | "No" | "TBD";
  size?: "default" | "print";
}) {
  const iconSize = size === "print" ? 13 : 16;
  const textClass = size === "print" ? "text-[9.5pt] font-semibold" : "text-sm font-semibold";
  const paddingClass = size === "print" ? "px-2 py-1" : "px-3 py-1.5";
  if (value === "Yes") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded border border-green-700 bg-green-50 text-green-800 ${paddingClass} ${textClass}`}
      >
        <CheckCircle2 size={iconSize} aria-hidden="true" />
        Yes
      </span>
    );
  }
  if (value === "No") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded border border-red-700 bg-red-50 text-red-800 ${paddingClass} ${textClass}`}
      >
        <XCircle size={iconSize} aria-hidden="true" />
        No
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border border-ink/30 bg-paper-2 text-ink/60 ${paddingClass} ${textClass}`}
    >
      <HelpCircle size={iconSize} aria-hidden="true" />
      TBD
    </span>
  );
}

// One row of a Balloon Refinance Analysis results panel: a label on the
// left, its value right-aligned, matching the row style used throughout
// the rest of the on-page calculator.
function BalloonStatRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <span className="text-ink/70">{label}</span>
      <span className={`text-right ${valueClassName ?? ""}`}>{value}</span>
    </div>
  );
}

// The on-page Balloon Refinance Analysis section, shared by Stack
// Method, Subject To, Seller Financing, and Hybrid (never Traditional
// Financing, which never renders this component). Every prop is
// supplied by the parent, which owns all of the actual state -- this
// component is purely presentational, reading no state and performing
// no calculations of its own, exactly like the printable report
// components below.
function BalloonRefinanceAnalysisPanel({
  balloonExists,
  onToggleExists,
  balloonYearsDraft,
  onBalloonYearsChange,
  onBalloonYearsBlur,
  appreciationDraft,
  onAppreciationChange,
  onAppreciationBlur,
  has70LtvContingency,
  onToggleContingency,
  analysis,
  loanBalanceRows,
  stackRefinanceDetail,
}: {
  balloonExists: boolean;
  onToggleExists: (value: boolean) => void;
  balloonYearsDraft: string;
  onBalloonYearsChange: (raw: string) => void;
  onBalloonYearsBlur: () => void;
  appreciationDraft: string;
  onAppreciationChange: (raw: string) => void;
  onAppreciationBlur: () => void;
  has70LtvContingency: boolean;
  onToggleContingency: (value: boolean) => void;
  analysis: BalloonAnalysis | null;
  loanBalanceRows: { label: string; value: number }[];
  // Stack Method only (for now): swaps in the refinance-shortfall
  // relabeled rows and the new red/green messaging logic below. Every
  // other financing structure omits this prop (defaults to false/
  // undefined) and renders exactly as before.
  stackRefinanceDetail?: boolean;
}) {
  return (
    <div className="mt-8 pt-6 border-t border-line-dark">
      <p className="eyebrow text-brass mb-1">Balloon Refinance Analysis</p>
      <p className="text-xs text-ink/50 leading-relaxed mb-5">
        Does this financing structure have a balloon payment? Most Subject To and Seller
        Financing deals do not -- only select Yes if one actually applies.
      </p>
      <div className="inline-flex border border-line-dark divide-x divide-line-dark">
        <button
          type="button"
          onClick={() => onToggleExists(false)}
          aria-pressed={!balloonExists}
          className={`px-4 py-2 text-sm transition-colors ${
            !balloonExists ? "bg-brass/10 text-ink" : "text-ink/60 hover:text-ink"
          }`}
        >
          No
        </button>
        <button
          type="button"
          onClick={() => onToggleExists(true)}
          aria-pressed={balloonExists}
          className={`px-4 py-2 text-sm transition-colors ${
            balloonExists ? "bg-brass/10 text-ink" : "text-ink/60 hover:text-ink"
          }`}
        >
          Yes
        </button>
      </div>

      {balloonExists && (
        <>
          <div className="mt-6 grid sm:grid-cols-2 gap-5">
            <IntegerField
              id="balloonYears"
              label="Balloon Due in Years"
              draft={balloonYearsDraft}
              onChange={onBalloonYearsChange}
              onBlur={onBalloonYearsBlur}
              info="Must be greater than 0."
            />
            <PercentField
              id="balloonAppreciationPct"
              label="Annual Property Appreciation"
              draft={appreciationDraft}
              onChange={onAppreciationChange}
              onBlur={onAppreciationBlur}
              info="Decimals allowed, e.g. 2.5%. Defaults to 2%, fully editable."
            />
          </div>
          <div className="mt-5">
            <div className="mb-2">
              <FieldLabel>Is There a 70% LTV Refinance Contingency?</FieldLabel>
            </div>
            <div
              className="grid grid-cols-2 gap-2 max-w-sm"
              role="group"
              aria-label="Is There a 70% LTV Refinance Contingency?"
            >
              <button
                type="button"
                onClick={() => onToggleContingency(false)}
                aria-pressed={!has70LtvContingency}
                className={`px-3 py-2.5 border text-sm transition-colors ${
                  !has70LtvContingency
                    ? "border-brass bg-brass/10 text-ink"
                    : "border-line-dark text-ink/60 hover:border-brass/60"
                }`}
              >
                No
              </button>
              <button
                type="button"
                onClick={() => onToggleContingency(true)}
                aria-pressed={has70LtvContingency}
                className={`px-3 py-2.5 border text-sm transition-colors ${
                  has70LtvContingency
                    ? "border-brass bg-brass/10 text-ink"
                    : "border-line-dark text-ink/60 hover:border-brass/60"
                }`}
              >
                Yes
              </button>
            </div>
          </div>

          {analysis && (
            <div className="mt-6 rounded border border-line-dark bg-white p-6">
              <p className="eyebrow text-brass mb-1.5">Balloon Refinance Analysis Results</p>
              <div className="divide-y divide-line-dark border-t border-b border-line-dark">
                <BalloonStatRow label="Balloon Due in" value={`${analysis.balloonYears} Years`} />
                <BalloonStatRow label="Annual Property Appreciation" value={formatPercent(analysis.appreciationPct)} />
                <BalloonStatRow label="Current Purchase Price" value={formatCents(analysis.purchasePrice)} />
                <BalloonStatRow
                  label="Projected Appraised Value at Balloon"
                  value={formatCents(analysis.projectedAppraisedValue)}
                />
                {loanBalanceRows.map((row) => (
                  <BalloonStatRow key={row.label} label={row.label} value={formatCents(row.value)} />
                ))}
                <BalloonStatRow
                  label="Total Projected Debt at Balloon"
                  value={formatCents(analysis.projectedDebtAtBalloon)}
                />
                {stackRefinanceDetail ? (
                  <>
                    <BalloonStatRow
                      label="Maximum Refinance Proceeds at 70% LTV"
                      value={formatCents(analysis.maxDebtAt70Ltv)}
                    />
                    <BalloonStatRow
                      label="Projected LTV at Balloon"
                      value={analysis.projectedLtv === null ? "N/A" : formatPercent(analysis.projectedLtv * 100)}
                    />
                    <BalloonStatRow
                      label="Estimated Refinance Surplus / Shortfall"
                      value={
                        analysis.equityCushion < 0
                          ? `-${formatCents(Math.abs(analysis.equityCushion))} shortfall`
                          : `${formatCents(analysis.equityCushion)} surplus`
                      }
                      valueClassName={analysis.equityCushion < 0 ? "text-red-700 font-medium" : undefined}
                    />
                    <BalloonStatRow
                      label="Estimated Cash Required to Refinance"
                      value={formatCents(stackEstimatedCashRequiredToRefinance(analysis))}
                    />
                  </>
                ) : (
                  <>
                    <BalloonStatRow label="Maximum Debt at 70% LTV" value={formatCents(analysis.maxDebtAt70Ltv)} />
                    <BalloonStatRow
                      label="Projected LTV at Balloon"
                      value={analysis.projectedLtv === null ? "N/A" : formatPercent(analysis.projectedLtv * 100)}
                    />
                    <BalloonStatRow label="Estimated Equity Cushion" value={formatCents(analysis.equityCushion)} />
                  </>
                )}
              </div>

              <div className="mt-4">
                {stackRefinanceDetail ? (
                  (() => {
                    const message = stackRefinanceMessage(analysis);
                    const isRed = message.tone === "red";
                    return (
                      <div
                        className={
                          isRed
                            ? "rounded border-2 border-red-700 bg-red-50 p-4"
                            : "rounded border border-green-700 bg-green-50 p-4"
                        }
                      >
                        <div
                          className={`text-sm leading-relaxed flex items-start gap-2 ${
                            isRed ? "text-red-800" : "text-green-800"
                          }`}
                        >
                          {isRed ? (
                            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                          ) : (
                            <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                          )}
                          <div className="space-y-2">
                            {message.lines.map((line, i) => (
                              <p key={i}>{line}</p>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : !analysis.has70LtvContingency ? (
                  <div className="rounded border border-ink/30 bg-paper-2 p-4">
                    <p className="text-sm text-ink/70 leading-relaxed inline-flex items-start gap-2">
                      <HelpCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                      <span>
                        No 70% LTV refinance contingency has been selected. Projected LTV at Balloon:{" "}
                        {analysis.projectedLtv === null ? "N/A" : formatPercent(analysis.projectedLtv * 100)}.
                      </span>
                    </p>
                  </div>
                ) : analysis.meets70Ltv ? (
                  <div className="rounded border border-green-700 bg-green-50 p-4">
                    <p className="text-sm text-green-800 leading-relaxed inline-flex items-start gap-2">
                      <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                      <span>
                        Projected refinance LTV is at or below 70%. The modeled balloon term meets the 70% LTV
                        refinance contingency.
                      </span>
                    </p>
                  </div>
                ) : (
                  <div className="rounded border border-red-700 bg-red-50 p-4">
                    <p className="text-sm text-red-800 leading-relaxed inline-flex items-start gap-2">
                      <XCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                      <span>
                        Projected refinance LTV is above 70%. The modeled balloon term does not meet the 70% LTV
                        refinance contingency.
                      </span>
                    </p>
                    <p className="mt-2 text-sm text-red-800">
                      {analysis.recommendedYears !== null
                        ? `Recommended Minimum Balloon Term: ${analysis.recommendedYears} Years (Projected LTV at Recommended Term: ${
                            analysis.projectedLtvAtRecommended === null
                              ? "N/A"
                              : formatPercent(analysis.projectedLtvAtRecommended * 100)
                          }).`
                        : "The projected LTV does not reach 70% within the modeled amortization period."}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// The printable-report counterpart to BalloonRefinanceAnalysisPanel
// above: same underlying BalloonAnalysis data and the same exact
// status wording, laid out as a compact two-column card matching the
// other printable Financing cards. Rendered only when the caller
// passes a non-null analysis (i.e. only when that mode's balloon
// toggle is Yes), so no blank or near-blank balloon section or page
// ever appears for a financing structure without a balloon. Status is
// conveyed with a colored panel AND an icon AND written text, so it
// stays understandable if printed in grayscale.
function BalloonRefinancePrintCard({
  analysis,
  loanBalanceRows,
  extraTextRows = [],
  stackRefinanceDetail,
}: {
  analysis: BalloonAnalysis;
  loanBalanceRows: { label: string; value: number }[];
  extraTextRows?: { label: string; value: string }[];
  // Stack Method only (for now): see BalloonRefinanceAnalysisPanel above.
  stackRefinanceDetail?: boolean;
}) {
  const statusPass = analysis.has70LtvContingency && analysis.meets70Ltv === true;
  const statusFail = analysis.has70LtvContingency && analysis.meets70Ltv === false;
  return (
    <div className="mb-4 print:break-inside-avoid-page rounded-xl border border-ink/15 bg-white p-3">
      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-brass/40">
        <Landmark size={14} className="text-brass" />
        <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink">
          Balloon Refinance Analysis
        </p>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[9.5pt]">
        <div className="flex justify-between gap-3">
          <span className="text-ink/60 min-w-0">Does the Financing Have a Balloon?</span>
          <span className="text-ink flex-shrink-0 text-right">Yes</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-ink/60 min-w-0">Balloon Due in Years</span>
          <span className="text-ink flex-shrink-0 text-right">{analysis.balloonYears} Years</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-ink/60 min-w-0">Annual Property Appreciation</span>
          <span className="text-ink flex-shrink-0 text-right">{formatPercent(analysis.appreciationPct)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-ink/60 min-w-0">70% LTV Refinance Contingency</span>
          <span className="text-ink flex-shrink-0 text-right">
            {analysis.has70LtvContingency ? "Yes" : "No"}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-ink/60 min-w-0">Projected Appraised Value at Balloon</span>
          <span className="text-ink flex-shrink-0 text-right">
            {formatCents(analysis.projectedAppraisedValue)}
          </span>
        </div>
        {loanBalanceRows.map((row) => (
          <div className="flex justify-between gap-3" key={row.label}>
            <span className="text-ink/60 min-w-0">{row.label}</span>
            <span className="text-ink flex-shrink-0 text-right">{formatCents(row.value)}</span>
          </div>
        ))}
        {extraTextRows.map((row) => (
          <div className="flex justify-between gap-3" key={row.label}>
            <span className="text-ink/60 min-w-0">{row.label}</span>
            <span className="text-ink flex-shrink-0 text-right">{row.value}</span>
          </div>
        ))}
        <div className="flex justify-between gap-3">
          <span className="text-ink/60 min-w-0">Total Projected Debt at Balloon</span>
          <span className="text-ink flex-shrink-0 text-right">
            {formatCents(analysis.projectedDebtAtBalloon)}
          </span>
        </div>
        {stackRefinanceDetail ? (
          <>
            <div className="flex justify-between gap-3">
              <span className="text-ink/60 min-w-0">Maximum Refinance Proceeds at 70% LTV</span>
              <span className="text-ink flex-shrink-0 text-right">{formatCents(analysis.maxDebtAt70Ltv)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-ink/60 min-w-0">Projected LTV at Balloon</span>
              <span className="text-ink flex-shrink-0 text-right">
                {analysis.projectedLtv === null ? "N/A" : formatPercent(analysis.projectedLtv * 100)}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-ink/60 min-w-0">Estimated Refinance Surplus / Shortfall</span>
              <span className={`flex-shrink-0 text-right ${analysis.equityCushion < 0 ? "text-red-700" : "text-ink"}`}>
                {analysis.equityCushion < 0
                  ? `-${formatCents(Math.abs(analysis.equityCushion))} shortfall`
                  : `${formatCents(analysis.equityCushion)} surplus`}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-ink/60 min-w-0">Estimated Cash Required to Refinance</span>
              <span className="text-ink flex-shrink-0 text-right">
                {formatCents(stackEstimatedCashRequiredToRefinance(analysis))}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between gap-3">
              <span className="text-ink/60 min-w-0">Maximum Debt at 70% LTV</span>
              <span className="text-ink flex-shrink-0 text-right">{formatCents(analysis.maxDebtAt70Ltv)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-ink/60 min-w-0">Projected LTV at Balloon</span>
              <span className="text-ink flex-shrink-0 text-right">
                {analysis.projectedLtv === null ? "N/A" : formatPercent(analysis.projectedLtv * 100)}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-ink/60 min-w-0">Estimated Equity Cushion</span>
              <span className="text-ink flex-shrink-0 text-right">{formatCents(analysis.equityCushion)}</span>
            </div>
          </>
        )}
      </div>

      <div className="mt-2 pt-2 border-t border-ink/10">
        {stackRefinanceDetail ? (
          (() => {
            const message = stackRefinanceMessage(analysis);
            const isRed = message.tone === "red";
            return (
              <div
                className={
                  isRed ? "rounded border-2 border-red-700 bg-red-50 p-2.5" : "rounded border border-green-700 bg-green-50 p-2.5"
                }
              >
                <div className={`text-[9pt] leading-relaxed flex items-start gap-1.5 ${isRed ? "text-red-800" : "text-green-800"}`}>
                  {isRed ? (
                    <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                  )}
                  <div className="space-y-1">
                    {message.lines.map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()
        ) : !analysis.has70LtvContingency ? (
          <div className="rounded border border-ink/30 bg-paper-2 p-2.5">
            <p className="text-[9pt] text-ink/70 leading-relaxed inline-flex items-start gap-1.5">
              <HelpCircle size={13} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>No 70% LTV refinance contingency has been selected.</span>
            </p>
          </div>
        ) : statusPass ? (
          <div className="rounded border border-green-700 bg-green-50 p-2.5">
            <p className="text-[9pt] text-green-800 leading-relaxed inline-flex items-start gap-1.5">
              <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>
                Projected refinance LTV is at or below 70%. The modeled balloon term meets the 70% LTV
                refinance contingency.
              </span>
            </p>
          </div>
        ) : (
          <div className="rounded border border-red-700 bg-red-50 p-2.5">
            <p className="text-[9pt] text-red-800 leading-relaxed inline-flex items-start gap-1.5">
              <XCircle size={13} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>
                Projected refinance LTV is above 70%. The modeled balloon term does not meet the 70% LTV
                refinance contingency.
              </span>
            </p>
            {statusFail && (
              <p className="mt-1 text-[9pt] text-red-800">
                {analysis.recommendedYears !== null
                  ? `Recommended Minimum Balloon Term: ${analysis.recommendedYears} Years (Projected LTV at Recommended Term: ${
                      analysis.projectedLtvAtRecommended === null
                        ? "N/A"
                        : formatPercent(analysis.projectedLtvAtRecommended * 100)
                    }).`
                  : "The projected LTV does not reach 70% within the modeled amortization period."}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// The printable-report counterpart to the on-page
// <AmortizationScheduleBlock>: a compact annual summary table (Year,
// Beginning Balance, Total Payments, Principal Paid, Interest Paid,
// Ending Balance) for one loan leg, matching the same annual figures
// shown on-page by default. `disclosure`, when provided, renders the
// required estimation notice for Subject-To and Hybrid's
// existing-mortgage schedules directly above the table. Renders nothing
// for an empty schedule (e.g. a $0 balance).
function AmortizationPrintCard({
  title,
  schedule,
  disclosure,
}: {
  title: string;
  schedule: AmortizationRow[];
  disclosure?: string;
}) {
  if (schedule.length === 0) return null;
  const annualRows = buildAnnualAmortizationSummary(schedule);
  return (
    <div className="mb-4 print:break-inside-avoid-page rounded-xl border border-ink/15 bg-white p-3">
      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-brass/40">
        <Landmark size={14} className="text-brass" />
        <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink">{title}</p>
      </div>
      {disclosure && (
        <p className="text-[8pt] text-ink bg-brass/5 border border-brass/50 rounded p-2 mb-2 leading-relaxed">
          {disclosure}
        </p>
      )}
      <table className="w-full text-[8.5pt] border-collapse">
        <thead>
          <tr className="border-b border-ink/20 text-left text-ink/60">
            <th className="py-1 pr-2 font-medium">Year</th>
            <th className="py-1 pr-2 font-medium">Beginning Balance</th>
            <th className="py-1 pr-2 font-medium">Total Payments</th>
            <th className="py-1 pr-2 font-medium">Principal Paid</th>
            <th className="py-1 pr-2 font-medium">Interest Paid</th>
            <th className="py-1 pr-2 font-medium">Ending Balance</th>
          </tr>
        </thead>
        <tbody>
          {annualRows.map((row) => (
            <tr key={row.year} className="border-b border-ink/10">
              <td className="py-1 pr-2">{row.year}</td>
              <td className="py-1 pr-2">{formatCents(row.beginningBalance)}</td>
              <td className="py-1 pr-2">{formatCents(row.totalPayments)}</td>
              <td className="py-1 pr-2">{formatCents(row.principalPaid)}</td>
              <td className="py-1 pr-2">{formatCents(row.interestPaid)}</td>
              <td className="py-1 pr-2">{formatCents(row.endingBalance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------
// 30-Year ROI Projection: presentational components shared by the
// on-page panel and the printable report. Every figure comes from a
// RoiProjectionResult built by lib/roiProjection.ts's buildRoiProjection
// (see activeRoiProjection in the main component below) -- nothing here
// recalculates any underwriting math of its own.
// ---------------------------------------------------------------------

const ROI_DISCLOSURE_TEXT =
  "Total ROI includes modeled net cash flow, principal paydown, and property appreciation.";

function roiPct(value: number | null): string {
  return value === null ? "N/A" : formatPercent(value * 100);
}

// Compact Year 1 / Year 5 / Year 10 / Year 30 summary cards (spec
// section 11). Year 1 uses Annual ROI (a single year's return); Years
// 5/10/30 use Cumulative ROI (the running total through that year).
function RoiSummaryCards({ projection }: { projection: RoiProjectionResult }) {
  const byYear = (year: number) => projection.rows.find((r) => r.year === year) ?? null;
  const cards = [
    { label: "Year 1 Total ROI", value: roiPct(projection.year1TotalRoi) },
    { label: "Year 5 Cumulative ROI", value: roiPct(byYear(5)?.cumulativeRoi ?? null) },
    { label: "Year 10 Cumulative ROI", value: roiPct(byYear(10)?.cumulativeRoi ?? null) },
    { label: "Year 30 Cumulative ROI", value: roiPct(byYear(30)?.cumulativeRoi ?? null) },
  ];
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="border border-line-dark bg-ink-2/60 px-4 py-3">
          <p className="eyebrow text-bone/50 mb-1 text-[10px] leading-tight">{c.label}</p>
          <p className="font-display text-xl text-brass-light">{c.value}</p>
        </div>
      ))}
    </div>
  );
}

// Hand-rolled SVG chart (this project has no charting library): a
// stacked bar per year for the three return components -- Net Cash
// Flow, Principal Paydown, Appreciation -- with an overlaid line for
// Annual Total Return (which, by definition, always sits exactly at
// the top of each stack, since it is the sum of the three). Never
// plots a cumulative value here, only the true per-year figures, so
// this annual-return chart is never misleading about scale. Works
// identically on screen and in print (plain inline SVG, no JS-driven
// canvas).
function RoiComponentsChart({ rows }: { rows: RoiYearRow[] }) {
  const width = 780;
  const height = 240;
  const marginLeft = 46;
  const marginRight = 8;
  const marginTop = 14;
  const marginBottom = 22;
  const plotW = width - marginLeft - marginRight;
  const plotH = height - marginTop - marginBottom;
  const slot = plotW / Math.max(1, rows.length);
  const barW = Math.max(2, slot - 2);
  const zeroY = marginTop + plotH;

  const colors = { cashFlow: "#4E9C6C", paydown: "#C08A3E", appreciation: "#8B9795", line: "#12181C" };

  const maxStack = Math.max(
    1,
    ...rows.map(
      (r) => Math.max(0, r.annualNetCashFlow) + Math.max(0, r.totalPrincipalPaydown) + Math.max(0, r.annualAppreciation)
    ),
    ...rows.map((r) => Math.abs(r.annualTotalReturn))
  );
  const yScale = (v: number) => (Math.max(0, v) / maxStack) * plotH;

  const linePoints = rows
    .map((r, i) => {
      const x = marginLeft + i * slot + slot / 2;
      const y = zeroY - (r.annualTotalReturn / maxStack) * plotH;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label="Annual return components (net cash flow, principal paydown, appreciation) and annual total return, by year"
      >
        <line x1={marginLeft} y1={zeroY} x2={width - marginRight} y2={zeroY} stroke="#12181C" strokeOpacity={0.25} />
        {rows.map((r, i) => {
          const x = marginLeft + i * slot + (slot - barW) / 2;
          const segs = [
            { h: yScale(r.annualNetCashFlow), color: colors.cashFlow },
            { h: yScale(r.totalPrincipalPaydown), color: colors.paydown },
            { h: yScale(r.annualAppreciation), color: colors.appreciation },
          ];
          let cursorY = zeroY;
          return (
            <g key={r.year}>
              {segs.map((s, si) => {
                const y = cursorY - s.h;
                cursorY = y;
                if (s.h <= 0) return null;
                return <rect key={si} x={x} y={y} width={barW} height={s.h} fill={s.color} />;
              })}
              {(r.year === 1 || r.year % 5 === 0) && (
                <text x={x + barW / 2} y={height - 6} fontSize="8" textAnchor="middle" fill="#12181C" opacity={0.55}>
                  {r.year}
                </text>
              )}
            </g>
          );
        })}
        <polyline points={linePoints} fill="none" stroke={colors.line} strokeWidth={1.5} />
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[9.5pt] print:text-[7pt] text-ink/60">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 inline-block" style={{ backgroundColor: colors.cashFlow }} />
          Net Cash Flow
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 inline-block" style={{ backgroundColor: colors.paydown }} />
          Principal Paydown
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 inline-block" style={{ backgroundColor: colors.appreciation }} />
          Appreciation
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3 inline-block" style={{ backgroundColor: colors.line }} />
          Annual Total Return
        </span>
      </div>
    </div>
  );
}

// The 30-row projection table, shared verbatim by the on-page panel and
// the printable report (only the wrapping element differs -- the
// on-page copy scrolls horizontally on narrow screens, the print copy
// never does, since an overflow container would clip content across
// printed pages; a plain <table>'s <thead> already repeats on every
// printed page in every major browser without any extra markup).
// Combined loan-balance columns are used throughout (Beginning/Ending
// Loan Balance, Principal Paydown), per spec: "For financing structures
// with more than one debt, use combined balances where applicable."
function RoiProjectionTable({ rows, dense }: { rows: RoiYearRow[]; dense?: boolean }) {
  const cellClass = dense ? "py-1 pr-2.5 text-[7.5pt]" : "py-1.5 pr-3 text-xs";
  const headClass = dense
    ? "py-1.5 pr-2.5 text-[7.5pt] font-semibold text-ink/70 text-right"
    : "py-2 pr-3 text-xs font-semibold text-ink/70 text-right";
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="text-left border-b-2 border-ink/20">
          <th className={headClass.replace("text-right", "text-left")}>Year</th>
          <th className={headClass}>Beg. Property Value</th>
          <th className={headClass}>Appreciation</th>
          <th className={headClass}>End. Property Value</th>
          <th className={headClass}>Beg. Loan Balance</th>
          <th className={headClass}>Principal Paydown</th>
          <th className={headClass}>End. Loan Balance</th>
          <th className={headClass}>Net Cash Flow</th>
          <th className={headClass}>Total Return</th>
          <th className={headClass}>Annual ROI</th>
          <th className={headClass}>Cumulative Return</th>
          <th className={headClass}>Cumulative ROI</th>
          <th className={headClass}>Est. Ending Equity</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const beginningLoanBalance = r.legs.reduce((s, l) => s + l.beginningBalance, 0);
          return (
            <tr key={r.year} className={`border-b border-ink/10 ${r.isBalloonYear ? "bg-amber-50" : ""}`}>
              <td className={cellClass}>
                {r.year}
                {r.isBalloonYear && <span className="ml-1 text-brass font-semibold">Balloon</span>}
                {r.isRefinanceYear && <span className="ml-1 text-ink/50">(Refinanced)</span>}
                {r.balloonUnresolved && <span className="ml-1 text-red-600 font-semibold">Balloon Due</span>}
              </td>
              <td className={`${cellClass} text-right`}>{formatCents(r.beginningPropertyValue)}</td>
              <td className={`${cellClass} text-right`}>{formatCents(r.annualAppreciation)}</td>
              <td className={`${cellClass} text-right`}>{formatCents(r.endingPropertyValue)}</td>
              <td className={`${cellClass} text-right`}>{formatCents(beginningLoanBalance)}</td>
              <td className={`${cellClass} text-right`}>{formatCents(r.totalPrincipalPaydown)}</td>
              <td className={`${cellClass} text-right`}>{formatCents(r.endingTotalDebt)}</td>
              <td className={`${cellClass} text-right`}>{formatCents(r.annualNetCashFlow)}</td>
              <td className={`${cellClass} text-right font-medium`}>{formatCents(r.annualTotalReturn)}</td>
              <td className={`${cellClass} text-right`}>{roiPct(r.annualRoi)}</td>
              <td className={`${cellClass} text-right`}>{formatCents(r.cumulativeTotalReturn)}</td>
              <td className={`${cellClass} text-right font-medium`}>{roiPct(r.cumulativeRoi)}</td>
              <td className={`${cellClass} text-right`}>{formatCents(r.estimatedEndingEquity)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// The complete on-page "30-Year ROI Projection" expandable section:
// the Annual Appreciation input, Refinance at Balloon controls (only
// when this structure actually has a balloon), the four summary cards,
// the chart, and the full table. Purely presentational, like every
// other panel in this file -- all state lives in and is owned by the
// parent.
function RoiProjectionPanel({
  isOpen,
  onToggleOpen,
  appreciationPct,
  appreciationDraft,
  onAppreciationChange,
  onAppreciationBlur,
  hasBalloon,
  balloonYears,
  refinanceAtBalloon,
  onToggleRefinance,
  refinanceRateDraft,
  onRefinanceRateChange,
  onRefinanceRateBlur,
  refinanceRateIsManual,
  onResetRefinanceRate,
  projection,
}: {
  isOpen: boolean;
  onToggleOpen: () => void;
  appreciationPct: number;
  appreciationDraft: string;
  onAppreciationChange: (raw: string) => void;
  onAppreciationBlur: () => void;
  hasBalloon: boolean;
  balloonYears: number;
  refinanceAtBalloon: boolean;
  onToggleRefinance: (value: boolean) => void;
  refinanceRateDraft: string;
  onRefinanceRateChange: (raw: string) => void;
  onRefinanceRateBlur: () => void;
  refinanceRateIsManual: boolean;
  onResetRefinanceRate: () => void;
  projection: RoiProjectionResult;
}) {
  return (
    <div className="print:hidden mt-10 pt-8 border-t border-line">
      <p className="eyebrow text-brass mb-1">30-Year ROI Projection</p>
      <p className="text-sm text-bone leading-[1.45] mb-2 max-w-3xl">{ROI_DISCLOSURE_TEXT}</p>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <label htmlFor="roiAppreciationPctTop" className="text-sm text-bone/80">
          Annual Property Appreciation:
        </label>
        <div className="relative inline-flex items-center">
          <input
            id="roiAppreciationPctTop"
            type="text"
            inputMode="decimal"
            value={appreciationDraft}
            onChange={(e) => onAppreciationChange(e.target.value)}
            onBlur={onAppreciationBlur}
            aria-label="Annual Property Appreciation"
            className="w-20 bg-white border border-line-dark pl-2.5 pr-6 py-1.5 text-ink text-sm outline-none focus:border-brass"
          />
          <span className="pointer-events-none absolute right-2.5 text-ink/40 text-sm" aria-hidden="true">
            %
          </span>
        </div>
        <span className="text-xs text-bone/50">
          Shared with Balloon Refinance Analysis -- editing it here or there updates both.
        </span>
      </div>

      <RoiSummaryCards projection={projection} />

      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={isOpen}
        className="mt-5 inline-flex items-center gap-2 border border-line-dark px-5 py-2.5 eyebrow text-bone/70 hover:border-brass hover:text-bone transition-colors"
      >
        {isOpen ? "Hide" : "View"} 30-Year ROI Projection
      </button>

      {isOpen && (
        <div className="mt-6 bg-paper text-ink p-6 sm:p-8">
          <div className="grid sm:grid-cols-2 gap-5 max-w-2xl">
            <PercentField
              id="roiAppreciationPct"
              label="Annual Property Appreciation"
              draft={appreciationDraft}
              onChange={onAppreciationChange}
              onBlur={onAppreciationBlur}
              info="Compound annual appreciation. Shares the same assumption as Balloon Refinance Analysis above -- editing it here or there updates both. Decimals and negative values allowed (-20 to 20). Defaults to 2%."
            />
          </div>

          {hasBalloon && (
            <div className="mt-6 max-w-2xl">
              <div className="mb-2">
                <FieldLabel info="A balloon in this structure means its debt comes due partway through the 30-year projection. Choose how the projection should continue past that date.">
                  Refinance at Balloon
                </FieldLabel>
              </div>
              <div className="inline-flex border border-line-dark divide-x divide-line-dark">
                <button
                  type="button"
                  onClick={() => onToggleRefinance(false)}
                  aria-pressed={!refinanceAtBalloon}
                  className={`px-4 py-2 text-sm transition-colors ${
                    !refinanceAtBalloon ? "bg-brass/10 text-ink" : "text-ink/60 hover:text-ink"
                  }`}
                >
                  No
                </button>
                <button
                  type="button"
                  onClick={() => onToggleRefinance(true)}
                  aria-pressed={refinanceAtBalloon}
                  className={`px-4 py-2 text-sm transition-colors ${
                    refinanceAtBalloon ? "bg-brass/10 text-ink" : "text-ink/60 hover:text-ink"
                  }`}
                >
                  Yes
                </button>
              </div>

              {refinanceAtBalloon ? (
                <div className="mt-5 max-w-sm">
                  <PercentField
                    id="roiRefinanceRatePct"
                    label="Replacement Interest Rate"
                    draft={refinanceRateDraft}
                    onChange={onRefinanceRateChange}
                    onBlur={onRefinanceRateBlur}
                    info="Defaults to this structure's current first-position interest rate. Fully editable."
                  />
                  {refinanceRateIsManual && (
                    <button
                      type="button"
                      onClick={onResetRefinanceRate}
                      className="mt-2 text-xs text-brass hover:underline"
                    >
                      Reset to Suggested Rate
                    </button>
                  )}
                  <p className="mt-2 text-xs text-ink/50 leading-relaxed">
                    At Year {balloonYears}, the balloon balance is modeled as refinanced into a new 30-year
                    amortizing loan at this rate. Refinance proceeds are never counted as income or return.
                  </p>
                </div>
              ) : (
                <div className="mt-4 rounded border border-red-700 bg-red-50 p-4 max-w-xl">
                  <p className="text-sm text-red-800 leading-relaxed inline-flex items-start gap-2">
                    <HelpCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                    <span>
                      Balloon Due in Year {balloonYears}: this financing is modeled as unresolved after that date.
                      Appreciation and modeled cash flow continue, but no further principal paydown is projected and
                      the outstanding balance is carried unchanged for the remainder of the 30-year period.
                    </span>
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="mt-8">
            <p className="eyebrow text-brass mb-3">Annual Return Components</p>
            <RoiComponentsChart rows={projection.rows} />
          </div>

          <div className="mt-8 overflow-x-auto">
            <RoiProjectionTable rows={projection.rows} />
          </div>
        </div>
      )}
    </div>
  );
}

// The printable-report counterpart to RoiProjectionPanel above -- same
// underlying RoiProjectionResult, laid out to match the rest of the
// print report's cards, with the full 30-row table (which may span
// multiple printed pages) and the same return-components chart.
function RoiProjectionPrintSection({
  appreciationPct,
  totalCapitalRequired,
  hasBalloon,
  balloonYears,
  refinanceAtBalloon,
  refinanceRatePct,
  projection,
}: {
  appreciationPct: number;
  totalCapitalRequired: number;
  hasBalloon: boolean;
  balloonYears: number;
  refinanceAtBalloon: boolean;
  refinanceRatePct: number;
  projection: RoiProjectionResult;
}) {
  const byYear = (year: number) => projection.rows.find((r) => r.year === year) ?? null;
  return (
    <div className="hidden print:block mt-4">
      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-brass/40">
        <TrendingUp size={14} className="text-brass" />
        <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink">30-Year ROI Projection</p>
      </div>
      <p className="text-[8.5pt] text-ink leading-relaxed mb-2 max-w-2xl">{ROI_DISCLOSURE_TEXT}</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[9pt] mb-3">
        <div className="flex justify-between gap-3">
          <span className="text-ink/60 min-w-0">Annual Appreciation Assumption</span>
          <span className="text-ink flex-shrink-0 text-right">{formatPercent(appreciationPct)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-ink/60 min-w-0">Initial Total Capital Required</span>
          <span className="text-ink flex-shrink-0 text-right">{formatCents(totalCapitalRequired)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-ink/60 min-w-0">Year 1 Total ROI</span>
          <span className="text-ink flex-shrink-0 text-right">{roiPct(projection.year1TotalRoi)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-ink/60 min-w-0">Year 5 Cumulative ROI</span>
          <span className="text-ink flex-shrink-0 text-right">{roiPct(byYear(5)?.cumulativeRoi ?? null)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-ink/60 min-w-0">Year 10 Cumulative ROI</span>
          <span className="text-ink flex-shrink-0 text-right">{roiPct(byYear(10)?.cumulativeRoi ?? null)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-ink/60 min-w-0">Year 30 Cumulative ROI</span>
          <span className="text-ink flex-shrink-0 text-right">{roiPct(byYear(30)?.cumulativeRoi ?? null)}</span>
        </div>
        {hasBalloon && (
          <>
            <div className="flex justify-between gap-3">
              <span className="text-ink/60 min-w-0">Refinance at Balloon (Year {balloonYears})</span>
              <span className="text-ink flex-shrink-0 text-right">{refinanceAtBalloon ? "Yes" : "No"}</span>
            </div>
            {refinanceAtBalloon && (
              <div className="flex justify-between gap-3">
                <span className="text-ink/60 min-w-0">Replacement Interest Rate</span>
                <span className="text-ink flex-shrink-0 text-right">{formatPercent(refinanceRatePct)}</span>
              </div>
            )}
          </>
        )}
      </div>

      {hasBalloon && !refinanceAtBalloon && (
        <p className="text-[8pt] text-red-800 bg-red-50 border border-red-700 rounded p-2 mb-3 max-w-2xl leading-relaxed">
          Balloon Due in Year {balloonYears}: this financing is modeled as unresolved after that date. No further
          principal paydown is projected once the balloon comes due.
        </p>
      )}

      <div className="mb-4 print:break-inside-avoid-page">
        <RoiComponentsChart rows={projection.rows} />
      </div>

      <div className="text-ink">
        <RoiProjectionTable rows={projection.rows} dense />
      </div>
    </div>
  );
}

// The printable-report card for Traditional Financing's Long-Term Rent
// LTV Qualification, matching BalloonRefinancePrintCard's pattern:
// purely presentational, same status wording as the on-page panel, and
// rendered by the caller only when a Long-Term Rent was actually
// entered -- when it is blank, the caller renders nothing at all here,
// so no blank or near-blank section or stray page is ever created.
function TraditionalLtvPrintCard({
  longTermRent,
  piti,
  selectedLtvPct,
  requiredDownPaymentPct,
  meetsRentTest,
}: {
  longTermRent: number;
  piti: number;
  selectedLtvPct: number;
  requiredDownPaymentPct: number;
  meetsRentTest: boolean;
}) {
  return (
    <div className="mb-3 print:break-inside-avoid-page rounded-xl border border-ink/15 bg-white p-2.5">
      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-brass/40">
        <Landmark size={14} className="text-brass" />
        <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink">
          Long-Term Rent LTV Qualification
        </p>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[9.5pt]">
        <div className="flex justify-between gap-3">
          <span className="text-ink/60 min-w-0">Estimated Monthly Long-Term Rent</span>
          <span className="text-ink flex-shrink-0 text-right">{formatCents(longTermRent)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-ink/60 min-w-0">Estimated Monthly PITI</span>
          <span className="text-ink flex-shrink-0 text-right">{formatCents(piti)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-ink/60 min-w-0">Selected LTV</span>
          <span className="text-ink flex-shrink-0 text-right">{formatPercent(selectedLtvPct)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-ink/60 min-w-0">Required Down Payment Percentage</span>
          <span className="text-ink flex-shrink-0 text-right">{formatPercent(requiredDownPaymentPct)}</span>
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-ink/10">
        {meetsRentTest ? (
          <div className="rounded border border-green-700 bg-green-50 p-2.5">
            <p className="text-[9pt] text-green-800 leading-relaxed inline-flex items-start gap-1.5">
              <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>
                Estimated long-term rent supports the monthly PITI. Proceeding with an 80% LTV
                assumption.
              </span>
            </p>
          </div>
        ) : (
          <div className="rounded border border-red-700 bg-red-50 p-2.5">
            <p className="text-[9pt] text-red-800 leading-relaxed inline-flex items-start gap-1.5">
              <XCircle size={13} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>
                Estimated long-term rent is below the monthly PITI. Using a more conservative 75%
                LTV assumption.
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Traditional Financing: a true fixed-rate, fully amortizing 30-year
// loan schedule (principal and interest only, no balloon payment). The
// same standard amortization formula is used for the headline "Estimated
// Monthly Principal and Interest Payment" figure and for generating the
// full 360-payment schedule below, so the two are always guaranteed to
// agree with each other.
//
//   M = P x [r(1 + r)^n] / [(1 + r)^n - 1]
//
// where P is the loan amount, r is the monthly interest rate (the
// entered annual rate divided by 12), and n is the number of monthly
// payments (360, fixed). A 0% interest rate is handled as a special
// case (Loan Amount / 360) to avoid dividing by zero.
const TRADITIONAL_TERM_YEARS = 30;
const TRADITIONAL_NUM_PAYMENTS = 360;

function calculateMonthlyPrincipalAndInterest(loanAmount: number, annualRatePct: number): number {
  if (!Number.isFinite(loanAmount) || loanAmount <= 0) return 0;
  const monthlyRate = annualRatePct / 100 / 12;
  if (!Number.isFinite(monthlyRate) || monthlyRate <= 0) {
    return loanAmount / TRADITIONAL_NUM_PAYMENTS;
  }
  const factor = Math.pow(1 + monthlyRate, TRADITIONAL_NUM_PAYMENTS);
  const payment = (loanAmount * (monthlyRate * factor)) / (factor - 1);
  return Number.isFinite(payment) ? payment : 0;
}

// Builds the complete month-by-month amortization schedule for
// Traditional Financing's fixed 30-year / 360-payment loan. A thin
// wrapper around the shared buildAmortizationScheduleForTerm (imported
// from lib/amortization.ts -- see the import block above) so every
// financing structure's schedule, Traditional included, comes from
// exactly one declining-balance implementation.
function buildAmortizationSchedule(
  loanAmount: number,
  annualRatePct: number
): { schedule: AmortizationRow[]; monthlyPayment: number } {
  return buildAmortizationScheduleForTerm(loanAmount, annualRatePct, TRADITIONAL_NUM_PAYMENTS);
}

// ---------------------------------------------------------------------
// Balloon Refinance Analysis: shared math used by every financing
// structure's balloon feature (Stack Method, Subject To, Seller
// Financing, and Subject To & Seller Finance Hybrid). Every function
// here works in unrounded values internally -- only the values actually
// displayed are rounded to cents/percent, per the "use unrounded values
// internally" requirement.
//
// calculateMonthlyPaymentForTerm, buildAmortizationScheduleForTerm, and
// remainingBalanceAfterMonths are the shared implementations imported
// from lib/amortization.ts (see the import block above), not defined
// locally, so this component, the ROI projection (lib/roiProjection.ts),
// and the Excel export (lib/underwritingExcelExport.ts) all resolve a
// loan's balance/schedule identically.
// ---------------------------------------------------------------------

// Projected appraised value at the balloon date, using compound annual
// appreciation (never simple/linear appreciation): Purchase Price x
// (1 + Appreciation Rate)^Years.
function projectedAppraisedValue(purchasePrice: number, annualAppreciationPct: number, years: number): number {
  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) return 0;
  const rate = annualAppreciationPct / 100;
  const y = Math.max(0, years);
  const value = purchasePrice * Math.pow(1 + rate, y);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

// Searches forward, one whole year at a time, starting at the currently
// entered balloon year, for the earliest year at which the projected LTV
// (combined remaining debt / projected appraised value) is at or below
// 70%. `debtAtYear` supplies the structure-specific combined remaining
// principal balance for a given balloon year (e.g. bank + seller-finance
// for Stack Method). Both the debt (amortizing down) and the appraised
// value (compounding up) move in the direction that helps the search
// converge, but a hard `maxYear` ceiling (the underlying amortization
// term) plus a 100-year absolute safety limit guarantee this can never
// loop indefinitely. Returns null if 70% LTV is never reached within
// that window.
function findRecommendedBalloonYears(
  startYear: number,
  maxYear: number,
  purchasePrice: number,
  annualAppreciationPct: number,
  debtAtYear: (year: number) => number
): { recommendedYears: number; projectedLtvAtRecommended: number } | null {
  const ceiling = Math.max(1, Math.min(Math.round(maxYear), 100));
  const start = Math.max(1, Math.ceil(startYear));
  if (purchasePrice <= 0) return null;
  for (let year = start; year <= ceiling; year++) {
    const value = projectedAppraisedValue(purchasePrice, annualAppreciationPct, year);
    if (value <= 0) continue;
    const debt = Math.max(0, debtAtYear(year));
    const ltv = debt / value;
    if (ltv <= 0.7) {
      return { recommendedYears: year, projectedLtvAtRecommended: ltv };
    }
  }
  return null;
}

// Shared shape for a fully-computed Balloon Refinance Analysis result,
// used identically by all four financing structures so the on-page
// panel, printable report section, and CSV export can all read from one
// consistent set of fields regardless of which structure produced them.
type BalloonAnalysis = {
  balloonYears: number;
  appreciationPct: number;
  has70LtvContingency: boolean;
  purchasePrice: number;
  projectedAppraisedValue: number;
  projectedDebtAtBalloon: number;
  maxDebtAt70Ltv: number;
  projectedLtv: number | null;
  equityCushion: number;
  meets70Ltv: boolean | null;
  recommendedYears: number | null;
  projectedLtvAtRecommended: number | null;
  amortizationCeilingYears: number;
};

// Assembles a complete BalloonAnalysis from a structure's already
// mode-specific projected debt at the entered balloon year and a
// `debtAtYear` function for the recommended-term search. Never
// recalculates the underlying loan balances itself -- those are always
// computed by the caller using that structure's own true amortization
// terms.
function buildBalloonAnalysis({
  balloonYears,
  appreciationPct,
  has70LtvContingency,
  purchasePrice,
  projectedDebtAtBalloon,
  amortizationCeilingYears,
  debtAtYear,
}: {
  balloonYears: number;
  appreciationPct: number;
  has70LtvContingency: boolean;
  purchasePrice: number;
  projectedDebtAtBalloon: number;
  amortizationCeilingYears: number;
  debtAtYear: (year: number) => number;
}): BalloonAnalysis {
  const appraisedValue = projectedAppraisedValue(purchasePrice, appreciationPct, balloonYears);
  const maxDebtAt70Ltv = appraisedValue * 0.7;
  const projectedLtv = appraisedValue > 0 ? projectedDebtAtBalloon / appraisedValue : null;
  const equityCushion = maxDebtAt70Ltv - projectedDebtAtBalloon;
  const meets70Ltv = projectedLtv === null ? null : projectedLtv <= 0.7;

  let recommendedYears: number | null = null;
  let projectedLtvAtRecommended: number | null = null;
  if (meets70Ltv === false) {
    const found = findRecommendedBalloonYears(
      balloonYears + 1,
      amortizationCeilingYears,
      purchasePrice,
      appreciationPct,
      debtAtYear
    );
    if (found) {
      recommendedYears = found.recommendedYears;
      projectedLtvAtRecommended = found.projectedLtvAtRecommended;
    }
  }

  return {
    balloonYears,
    appreciationPct,
    has70LtvContingency,
    purchasePrice,
    projectedAppraisedValue: appraisedValue,
    projectedDebtAtBalloon,
    maxDebtAt70Ltv,
    projectedLtv,
    equityCushion,
    meets70Ltv,
    recommendedYears,
    projectedLtvAtRecommended,
    amortizationCeilingYears,
  };
}

// Stack Method only (for now): the estimated cash the buyer would need
// to bring to closing to pay off the balloon using a refinance capped
// at 70% LTV. Never negative -- a surplus is not displayed as a
// negative "requirement". Maximum Refinance Proceeds at 70% LTV is the
// exact same figure as maxDebtAt70Ltv (Projected Appraised Value x
// 70%); Estimated Refinance Surplus / Shortfall is the exact same
// figure as equityCushion (Maximum Refinance Proceeds - Total
// Projected Debt) -- both are simply relabeled/re-signed for this
// structure's messaging rather than recalculated.
function stackEstimatedCashRequiredToRefinance(analysis: BalloonAnalysis): number {
  return Math.max(0, -analysis.equityCushion);
}

// Stack Method only (for now): builds the exact warning/success message
// text (as an array of paragraphs) for the four combinations of 70%
// LTV contingency (Yes/No) x projected LTV (above/at-or-below 70%), per
// spec. Shared verbatim by the on-page panel, the printable report
// card, and the Excel export, so the wording and dynamic values can
// never drift between them.
function stackRefinanceMessage(analysis: BalloonAnalysis): { tone: "red" | "green"; lines: string[] } {
  const ltvText = analysis.projectedLtv === null ? "N/A" : formatPercent(analysis.projectedLtv * 100);
  const cashRequired = stackEstimatedCashRequiredToRefinance(analysis);
  const aboveSeventy = analysis.meets70Ltv === false;

  if (aboveSeventy) {
    const lines: string[] = [
      `Warning: The projected LTV at the ${analysis.balloonYears}-year balloon is ${ltvText}, which is above 70%. Based on a refinance limited to 70% LTV, the estimated refinance proceeds would be ${formatCents(
        analysis.maxDebtAt70Ltv
      )} and the projected debt due would be ${formatCents(
        analysis.projectedDebtAtBalloon
      )}. You may need to bring approximately ${formatCents(cashRequired)} to closing to pay off the balloon, before lender fees and other refinance costs.`,
    ];
    if (analysis.has70LtvContingency) {
      lines.push("This financing structure does not currently satisfy the selected 70% LTV refinance contingency.");
      if (analysis.recommendedYears !== null) {
        lines.push(
          `To reach a projected LTV of 70% or less under the current assumptions, the estimated minimum balloon term is ${
            analysis.recommendedYears
          } years, with a projected LTV of ${
            analysis.projectedLtvAtRecommended === null ? "N/A" : formatPercent(analysis.projectedLtvAtRecommended * 100)
          }.`
        );
      } else {
        lines.push(
          `Projected LTV does not reach 70% within ${analysis.amortizationCeilingYears} years under the current assumptions.`
        );
      }
    } else {
      lines.push("No 70% LTV refinance contingency has been selected, but the projected refinance shortfall still exists.");
    }
    return { tone: "red", lines };
  }

  const lines: string[] = [
    analysis.has70LtvContingency
      ? `Projected LTV at the ${analysis.balloonYears}-year balloon is ${ltvText}, which is at or below the selected 70% LTV refinance contingency. Based on the current assumptions, a lender approving a 70% LTV refinance should provide enough proceeds to pay off the projected balloon balance without requiring additional cash from you at closing.`
      : `Projected LTV at the ${analysis.balloonYears}-year balloon is ${ltvText}. Based on the current assumptions, a refinance at 70% LTV should provide sufficient proceeds to pay off the projected balloon balance without additional payoff funds, subject to lender approval and refinance costs. No contractual 70% LTV refinance contingency has been selected.`,
  ];
  if (analysis.has70LtvContingency) {
    lines.push(
      "This is subject to lender approval, the future appraised value, property condition, income qualification, interest rates, refinance costs, and other lender requirements."
    );
  }
  return { tone: "green", lines };
}

// Turns a completed BalloonAnalysis into the exact same ordered list of
// {label, value} rows used by the on-page Full Underwriting Breakdown,
// the CSV export, and (restyled, not re-derived) the printable report --
// one single source of truth for every place the Balloon Refinance
// Analysis is displayed. `loanBalanceRows` supplies the structure-
// specific balance line(s) (e.g. First-Position Loan Balance at Balloon
// + Seller-Finance Balance at Balloon for Stack Method, or just the
// Existing Mortgage Balance at Balloon for Subject To), inserted between
// the projected appraised value and the combined total.
function balloonAnalysisRows(
  analysis: BalloonAnalysis,
  loanBalanceRows: { label: string; value: number }[],
  // Stack Method only (for now): swaps in the refinance-shortfall
  // relabeled rows/status text below. Every other financing structure
  // omits this argument and gets the original rows unchanged.
  stackRefinanceDetail?: boolean
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [
    { label: "Balloon Exists", value: "Yes" },
    { label: "Balloon Due in Years", value: `${analysis.balloonYears} Years` },
    { label: "Annual Property Appreciation", value: formatPercent(analysis.appreciationPct) },
    { label: "Current Purchase Price", value: formatCents(analysis.purchasePrice) },
    { label: "Projected Appraised Value at Balloon", value: formatCents(analysis.projectedAppraisedValue) },
  ];
  for (const row of loanBalanceRows) {
    rows.push({ label: row.label, value: formatCents(row.value) });
  }
  rows.push({ label: "Total Projected Debt at Balloon", value: formatCents(analysis.projectedDebtAtBalloon) });

  if (stackRefinanceDetail) {
    rows.push(
      { label: "Maximum Refinance Proceeds at 70% LTV", value: formatCents(analysis.maxDebtAt70Ltv) },
      {
        label: "Projected LTV at Balloon",
        value: analysis.projectedLtv === null ? "N/A" : formatPercent(analysis.projectedLtv * 100),
      },
      {
        label: "Estimated Refinance Surplus / Shortfall",
        value:
          analysis.equityCushion < 0
            ? `-${formatCents(Math.abs(analysis.equityCushion))} shortfall`
            : `${formatCents(analysis.equityCushion)} surplus`,
      },
      {
        label: "Estimated Cash Required to Refinance",
        value: formatCents(stackEstimatedCashRequiredToRefinance(analysis)),
      },
      { label: "70% LTV Refinance Contingency", value: analysis.has70LtvContingency ? "Yes" : "No" }
    );
    const message = stackRefinanceMessage(analysis);
    rows.push({ label: "70% LTV Refinance Status", value: message.lines.join(" ") });
    if (message.tone === "red" && analysis.has70LtvContingency) {
      if (analysis.recommendedYears !== null) {
        rows.push(
          { label: "Recommended Minimum Balloon Term", value: `${analysis.recommendedYears} Years` },
          {
            label: "Projected LTV at Recommended Term",
            value:
              analysis.projectedLtvAtRecommended === null
                ? "N/A"
                : formatPercent(analysis.projectedLtvAtRecommended * 100),
          }
        );
      } else {
        rows.push({
          label: "Recommended Minimum Balloon Term",
          value: `Projected LTV does not reach 70% within ${analysis.amortizationCeilingYears} years under the current assumptions.`,
        });
      }
    }
    return rows;
  }

  rows.push(
    { label: "Maximum Debt at 70% LTV", value: formatCents(analysis.maxDebtAt70Ltv) },
    {
      label: "Projected LTV at Balloon",
      value: analysis.projectedLtv === null ? "N/A" : formatPercent(analysis.projectedLtv * 100),
    },
    { label: "Estimated Equity Cushion", value: formatCents(analysis.equityCushion) },
    { label: "70% LTV Refinance Contingency", value: analysis.has70LtvContingency ? "Yes" : "No" }
  );
  if (!analysis.has70LtvContingency) {
    rows.push({
      label: "70% LTV Refinance Status",
      value: "No 70% LTV refinance contingency has been selected.",
    });
  } else if (analysis.meets70Ltv) {
    rows.push({
      label: "70% LTV Refinance Status",
      value: "Meets the 70% LTV refinance contingency.",
    });
  } else {
    rows.push({
      label: "70% LTV Refinance Status",
      value: "Does not meet the 70% LTV refinance contingency.",
    });
    if (analysis.recommendedYears !== null) {
      rows.push(
        { label: "Recommended Minimum Balloon Term", value: `${analysis.recommendedYears} Years` },
        {
          label: "Projected LTV at Recommended Term",
          value:
            analysis.projectedLtvAtRecommended === null
              ? "N/A"
              : formatPercent(analysis.projectedLtvAtRecommended * 100),
        }
      );
    } else {
      rows.push({
        label: "Recommended Minimum Balloon Term",
        value: "The projected LTV does not reach 70% within the modeled amortization period.",
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------
// Printable report presentation components. These are purely
// presentational (props in, JSX out): they read no state and perform no
// calculations of their own, so the printed report's figures always
// come straight from the same `results`/`financing`/`capital` values
// used everywhere else in this component.
// ---------------------------------------------------------------------

// A single large KPI card for the print report's executive-summary row.
// `highlight` is used only for the Estimated Cash-on-Cash Return card,
// which always renders with the same bright-green (#00FF00) treatment,
// a bold dark border, and bold dark text so the figure stays readable
// even if a printer omits background colors.
// KPI cards are laid out five across a single print row, which leaves
// each card only around an inch of width -- not enough room for a
// long formatted dollar figure (e.g. "$2,845,750.00") at a large fixed
// font size without it spilling past the card's edges. To guarantee no
// overflow regardless of how large the underlying numbers are:
//   - the value's font size responds to how long the formatted string
//     actually is (a lighter-weight, print-safe stand-in for a CSS
//     container query, which Tailwind 3.4 does not support), so a
//     seven-figure purchase price automatically renders smaller than a
//     five-figure one instead of overflowing;
//   - `break-words` plus a percentage-based width let the value wrap
//     onto a second line as an explicit last resort if it still does
//     not fit, rather than ever escaping the card's borders;
//   - the card is a flex column stretched to the full height of the
//     tallest card in the row (CSS Grid's default `align-items:
//     stretch`) with `justify-center`, so short and wrapped values both
//     stay vertically centered and every card in the row lines up.
function PrintKpiCard({
  icon,
  label,
  value,
  highlight,
  rateLines,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
  // Only used on the highlighted Cash-on-Cash Return card: the
  // financing-specific interest rate(s) shown immediately beside COCR
  // so both are visible together on the report's first page (Hybrid
  // and Stack Method can supply two lines, one per applicable rate).
  // Deliberately its own small block below the COCR figure rather than
  // a 6th grid column -- keeps the five-card row from squeezing and
  // keeps the pairing visually anchored to COCR specifically.
  rateLines?: { label: string; value: string }[];
}) {
  const isLongValue = value.length > 10;
  if (highlight) {
    const valueSize = isLongValue ? "text-[15pt]" : "text-[19pt]";
    return (
      <div
        className="h-full rounded-xl border-4 border-ink px-2 py-4 flex flex-col items-center justify-center text-center"
        style={{ backgroundColor: "#00FF00" }}
      >
        <div className="h-8 w-8 rounded-full bg-ink text-white flex items-center justify-center mb-2 flex-shrink-0">
          {icon}
        </div>
        <p className="text-[7pt] font-bold uppercase tracking-wide text-ink">{label}</p>
        <p
          className={`mt-1 w-full font-bold text-ink leading-tight tracking-tight break-words ${valueSize}`}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {value}
        </p>
        {rateLines && rateLines.length > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-ink/30 w-full">
            {rateLines.map((r) => {
              // Mirrors the COCR value's own long-value fallback above
              // (isLongValue), one typographic step down on this
              // design system's scale (13pt/10.5pt is the same pairing
              // PrintKpiCard's non-highlighted cards use for their own
              // value text) -- large and bold enough to read at a
              // glance next to COCR, never competing with COCR's own
              // 15pt/19pt figure for primary emphasis.
              const isLongRateValue = r.value.length > 10;
              const rateValueSize = isLongRateValue ? "text-[10.5pt]" : "text-[13pt]";
              return (
                <div key={r.label} className="mt-1 first:mt-0">
                  <p className="text-[7pt] font-semibold uppercase tracking-wide text-ink/70 leading-snug">
                    {r.label}
                  </p>
                  <p
                    className={`font-bold text-ink leading-tight tracking-tight break-words ${rateValueSize}`}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {r.value}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }
  const valueSize = isLongValue ? "text-[10.5pt]" : "text-[13pt]";
  return (
    <div className="h-full rounded-xl border border-ink/15 bg-white px-2 py-4 flex flex-col items-center justify-center text-center">
      <div className="h-8 w-8 rounded-full bg-ink text-white flex items-center justify-center mb-2 flex-shrink-0">
        {icon}
      </div>
      <p className="text-[7pt] font-semibold uppercase tracking-wide text-ink/60">{label}</p>
      <p
        className={`mt-1 w-full font-bold text-ink leading-tight tracking-tight break-words ${valueSize}`}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </p>
    </div>
  );
}

// One row of the Investment Highlights card: an icon badge, a bold
// headline, and a short supporting detail line. `detail` accepts a
// ReactNode (not just a string) so callers that need a stacked,
// multi-line breakdown -- like the bedroom/room-rate bullet below --
// can pass structured block content instead of a single sentence, while
// every other caller continues to just pass a plain string as before.
function HighlightBullet({
  icon,
  label,
  detail,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  detail: React.ReactNode;
  accent?: "brass" | "green";
}) {
  const badgeClass = accent === "brass" ? "bg-brass" : "bg-ink";
  const badgeStyle = accent === "green" ? { backgroundColor: "#1E8E3E" } : undefined;
  return (
    <div className="flex items-start gap-3 py-2 border-b border-ink/10 last:border-b-0">
      <div
        className={`h-7 w-7 flex-shrink-0 rounded-full text-white flex items-center justify-center ${
          accent === "green" ? "" : badgeClass
        }`}
        style={badgeStyle}
      >
        {icon}
      </div>
      <div>
        <p className="text-[9.5pt] font-semibold text-ink leading-snug">{label}</p>
        <div className="text-[8.5pt] text-ink/60 leading-snug">{detail}</div>
      </div>
    </div>
  );
}

// A simple, print/grayscale-safe horizontal bar chart used for both the
// "Monthly Income and Expense Breakdown" and "Capital Required Breakdown"
// charts in the printable report. Plain HTML/CSS rather than SVG (a
// label column, a filled-and-bordered bar track, and a right-aligned
// dollar figure per row): every bar is independently labeled and its
// exact dollar amount is always printed next to it, so the chart stays
// fully readable even if a printer omits color entirely -- it never
// depends on color alone to distinguish one bar/category from another.
// `bars` should already be in the exact order they should display,
// top to bottom.
function HorizontalBarChart({
  bars,
}: {
  bars: { label: string; value: number; color?: string }[];
}) {
  const max = Math.max(1, ...bars.map((b) => Math.abs(b.value)));
  return (
    <div className="space-y-1">
      {bars.map((b) => {
        const widthPct = Math.max(2, Math.min(100, (Math.abs(b.value) / max) * 100));
        return (
          <div key={b.label} className="flex items-center gap-2">
            <span className="w-[40%] flex-shrink-0 text-[7pt] text-ink/70 leading-tight">
              {b.label}
            </span>
            <div className="flex-1 h-2.5 rounded-sm bg-paper-2 border border-ink/15 overflow-hidden">
              <div
                className="h-full rounded-sm"
                style={{ width: `${widthPct}%`, backgroundColor: b.color ?? "#12181C" }}
              />
            </div>
            <span className="w-[54px] flex-shrink-0 text-right text-[7pt] font-semibold text-ink">
              {formatCents(b.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
// Field defaults
// ---------------------------------------------------------------------
type FinancingKey =
  | "purchasePrice"
  | "loanBalance"
  | "sellerDownPayment"
  | "monthlyPayment"
  | "annualPropertyTaxes"
  | "annualPropertyInsurance"
  | "hybridExistingMortgageBalance"
  | "hybridSubjectToPITI"
  | "stackSellerFirstLoanBalance"
  | "stackSellerSecondLien"
  | "stackMiscLiens"
  | "stackDownPaymentToSeller";

const FINANCING_DEFAULTS: Record<FinancingKey, number> = {
  purchasePrice: 0,
  loanBalance: 0,
  sellerDownPayment: 0,
  monthlyPayment: 0,
  annualPropertyTaxes: 0,
  annualPropertyInsurance: 0,
  hybridExistingMortgageBalance: 0,
  hybridSubjectToPITI: 0,
  stackSellerFirstLoanBalance: 0,
  stackSellerSecondLien: 0,
  stackMiscLiens: 0,
  stackDownPaymentToSeller: 0,
};

type CapitalKey =
  | "arrears"
  | "renovationCost"
  | "reserves"
  | "furniture"
  | "appliances"
  | "photos"
  | "upfrontInsurance"
  | "acquisitionFee"
  | "stackTcFee"
  | "stackLlcFee"
  | "traditionalTcFee"
  | "traditionalLlcFee"
  | "subjectToTcFee"
  | "subjectToLlcFee"
  | "hybridTcFee"
  | "hybridLlcFee"
  | "sellerFinancingTcFee"
  | "sellerFinancingLlcFee"
  | "agentFee"
  | "assignmentFee";

const CAPITAL_DEFAULTS: Record<CapitalKey, number> = {
  arrears: 0,
  renovationCost: 0,
  // Reserves: editable per financing structure, defaulting to $10,000
  // for every one of them (Traditional Financing, Subject To, Seller
  // Financing, Subject To & Seller Finance Hybrid, and Stack Method).
  // Replaces the previous fixed, non-editable RESERVES_AMOUNT constant.
  reserves: 10000,
  furniture: 10000,
  appliances: 3000,
  photos: 300,
  upfrontInsurance: 3000,
  acquisitionFee: 10000,
  // Every financing structure has its own fully independent TC Fee /
  // LLC Entity Formation Cost pair, so editing one structure's fees
  // never affects another's, and each fee is included exactly once in
  // that structure's Total Capital Required. Stack Method is the only
  // structure with a $2,500 TC Fee default; Traditional Financing
  // defaults its TC Fee to $0 (still fully editable); every other
  // structure defaults to $1,500. LLC Entity Formation Cost defaults to
  // $1,000 everywhere.
  stackTcFee: 2500,
  stackLlcFee: 1000,
  traditionalTcFee: 0,
  traditionalLlcFee: 1000,
  subjectToTcFee: 1500,
  subjectToLlcFee: 1000,
  hybridTcFee: 1500,
  hybridLlcFee: 1000,
  sellerFinancingTcFee: 1500,
  sellerFinancingLlcFee: 1000,
  agentFee: 0,
  assignmentFee: 0,
};

type PercentKey =
  | "vacancyPct"
  | "propertyManagementPct"
  | "platformFeePct"
  | "closingCostPct"
  | "traditionalDownPaymentPct"
  | "traditionalInterestRatePct"
  | "traditionalClosingCostPct"
  | "hybridSellerFinanceRatePct"
  | "stackBankLtvPct"
  | "stackClosingCostPct"
  | "stackAgentCommissionPct"
  | "stackTransactionalFundingFeePct"
  | "stackBankInterestRatePct"
  | "stackSellerFinanceRatePct"
  // Shared by Subject To and Seller Financing (the two modes already
  // share the same underlying loan-balance/monthly-payment fields):
  // the existing/seller-financed loan's interest rate, used only for
  // the Balloon Refinance Analysis's projected-balance calculation,
  // never for the existing PITI/operating-expense math.
  | "loanInterestRatePct"
  // Seller Financing's own interest rate -- fully independent from
  // Subject To's loanInterestRatePct above (Seller Financing represents
  // a brand-new loan, never an existing one), used for the automatically
  // calculated Monthly Principal & Interest payment, the amortization
  // schedule, principal paydown, Balloon Refinance Analysis, and ROI
  // projection.
  | "sellerFinancingInterestRatePct"
  // Hybrid's existing subject-to first mortgage rate, used the same way
  // -- only for its Balloon Refinance Analysis.
  | "hybridExistingMortgageRatePct"
  // Annual Property Appreciation: ONE shared assumption per financing
  // structure, used by both Balloon Refinance Analysis and the 30-Year
  // ROI Projection -- editing it in either place updates both, since
  // both features read/write this exact same key. Allows negative
  // values (see parseSignedPercent / APPRECIATION_PERCENT_KEYS below).
  | "stackBalloonAppreciationPct"
  | "subjectToBalloonAppreciationPct"
  | "sellerFinancingBalloonAppreciationPct"
  | "hybridBalloonAppreciationPct"
  // Traditional Financing has no balloon feature, so it gets its own
  // dedicated Annual Property Appreciation assumption, used only by its
  // 30-Year ROI Projection.
  | "traditionalAppreciationPct";

const PERCENT_DEFAULTS: Record<PercentKey, number> = {
  vacancyPct: 10,
  propertyManagementPct: 8,
  platformFeePct: 15,
  closingCostPct: 1.5,
  traditionalDownPaymentPct: 20,
  traditionalInterestRatePct: 7,
  traditionalClosingCostPct: 5,
  hybridSellerFinanceRatePct: 2,
  stackBankLtvPct: 80,
  stackClosingCostPct: 6,
  stackAgentCommissionPct: 0,
  stackTransactionalFundingFeePct: 2.5,
  stackBankInterestRatePct: 7,
  stackSellerFinanceRatePct: 0,
  loanInterestRatePct: 6,
  sellerFinancingInterestRatePct: 5,
  hybridExistingMortgageRatePct: 6,
  stackBalloonAppreciationPct: 2,
  subjectToBalloonAppreciationPct: 2,
  sellerFinancingBalloonAppreciationPct: 2,
  hybridBalloonAppreciationPct: 2,
  traditionalAppreciationPct: 2,
};

// ---------------------------------------------------------------------
// Effective Tax Rate: one shared county rate table, used identically by
// every financing structure (Traditional, Subject To, Seller Financing,
// Hybrid, Stack Method). Centralized here -- never duplicated per
// structure -- so adding, removing, or re-pricing a county only ever
// requires one edit.
// ---------------------------------------------------------------------
interface CountyTaxEntry {
  state: string;
  city: string;
  county: string;
  rate: number;
}
// Every supported county, state + city included so the dropdown below
// can be grouped and labeled by market. Order here does not matter --
// the grouped/sorted structure used for rendering (COUNTY_TAX_GROUPS)
// and the flat lookup used for calculations (COUNTY_EFFECTIVE_TAX_RATES)
// are both derived from this single list, so adding, removing, or
// re-pricing a county only ever requires one edit, here.
const COUNTY_TAX_TABLE: CountyTaxEntry[] = [
  { state: "Arizona", city: "Phoenix", county: "Maricopa County, AZ", rate: 0.3 },
  { state: "Florida", city: "Jacksonville", county: "Duval County, FL", rate: 2.3 },
  { state: "Florida", city: "Orlando", county: "Orange County, FL", rate: 1.81 },
  { state: "Florida", city: "Orlando", county: "Seminole County, FL", rate: 1.54 },
  { state: "Florida", city: "Tampa", county: "Hillsborough County, FL", rate: 1.84 },
  { state: "Florida", city: "Tampa", county: "Pasco County, FL", rate: 1.34 },
  { state: "Florida", city: "Tampa", county: "Pinellas County, FL", rate: 1.61 },
  { state: "Georgia", city: "Atlanta", county: "Clayton County, GA", rate: 1.57 },
  { state: "Georgia", city: "Atlanta", county: "Cobb County, GA", rate: 0.82 },
  { state: "Georgia", city: "Atlanta", county: "DeKalb County, GA", rate: 1.95 },
  { state: "Georgia", city: "Atlanta", county: "Fulton County, GA", rate: 1.25 },
  { state: "Nevada", city: "Las Vegas", county: "Clark County, NV", rate: 0.8 },
  { state: "North Carolina", city: "Charlotte", county: "Mecklenburg County, NC", rate: 0.8 },
  { state: "North Carolina", city: "Raleigh", county: "Wake County, NC", rate: 0.89 },
  { state: "Texas", city: "Dallas", county: "Dallas County, TX", rate: 2.23 },
  { state: "Texas", city: "Fort Worth", county: "Tarrant County, TX", rate: 2.34 },
  { state: "Texas", city: "Plano", county: "Collin County, TX", rate: 1.71 },
];
const COUNTY_EFFECTIVE_TAX_RATES: Record<string, number> = Object.fromEntries(
  COUNTY_TAX_TABLE.map((entry) => [entry.county, entry.rate])
);
// Grouped for <optgroup> rendering: states alphabetical, cities
// alphabetical within each state, counties alphabetical within each
// city -- computed once from COUNTY_TAX_TABLE above rather than
// hand-ordered, so the sort order can never drift out of sync with the
// underlying data.
interface CountyTaxCityGroup {
  label: string;
  counties: CountyTaxEntry[];
}
const COUNTY_TAX_GROUPS: CountyTaxCityGroup[] = (() => {
  const byState = new Map<string, Map<string, CountyTaxEntry[]>>();
  for (const entry of COUNTY_TAX_TABLE) {
    if (!byState.has(entry.state)) byState.set(entry.state, new Map());
    const byCity = byState.get(entry.state)!;
    if (!byCity.has(entry.city)) byCity.set(entry.city, []);
    byCity.get(entry.city)!.push(entry);
  }
  const groups: CountyTaxCityGroup[] = [];
  for (const state of Array.from(byState.keys()).sort()) {
    const byCity = byState.get(state)!;
    for (const city of Array.from(byCity.keys()).sort()) {
      const counties = byCity
        .get(city)!
        .slice()
        .sort((a, b) => a.county.localeCompare(b.county));
      groups.push({ label: `${state} - ${city}`, counties });
    }
  }
  return groups;
})();

// The subset of PercentKey that represent an Annual Property
// Appreciation assumption: these allow negative values (a property can
// depreciate) and clamp to +/-20% instead of the 0-100% used by every
// other percent field on this page. See parseSignedPercent above.
const APPRECIATION_PERCENT_KEYS = new Set<PercentKey>([
  "stackBalloonAppreciationPct",
  "subjectToBalloonAppreciationPct",
  "sellerFinancingBalloonAppreciationPct",
  "hybridBalloonAppreciationPct",
  "traditionalAppreciationPct",
]);

// Cleaning, Lawn Care, and Pest Control replace the old combined
// "Cleaning and Lawn Care" field: three separate, fully editable
// monthly expenses. Each one's default automatically follows the state
// identified from the property address (see
// lib/operatingExpenseDefaults.ts, the single authoritative
// state-to-default mapping shared with the Excel export) until the
// user edits that specific field by hand.
type MaintenanceExpenseKey = OperatingExpenseKey;

// Before any address has been entered/geocoded, no state is known yet,
// so this uses the same "all other states" fallback the shared
// function returns for an unrecognized/blank state code -- one source
// of truth, no separately hand-maintained default object.
const MAINTENANCE_EXPENSE_DEFAULTS: Record<MaintenanceExpenseKey, number> = getOperatingDefaultsForState(undefined);

const BEDROOM_DEFAULTS = {
  sharedBathBedrooms: 0,
  weeklySharedBathRent: 0,
  ensuiteBedrooms: 0,
  weeklyEnsuiteRent: 0,
};

type PaymentType = "piti" | "pi";
const PAYMENT_TYPE_DEFAULT: PaymentType = "piti";

// Financing Structure: a single-select mode. "" is "Not Specified" (no
// structure chosen yet).
type FinancingMode = "" | "traditional" | "subjectTo" | "sellerFinancing" | "hybrid" | "stackMethod";
const FINANCING_MODE_DEFAULT: FinancingMode = "";

// Editable currency fields always display and reformat with cents (see
// CurrencyField below), so drafts are built with formatCents, not
// formatWhole, to keep the displayed value consistent with what was
// typed (e.g. a default of $300,000 still needs to show as
// "$300,000.00" once the field is blurred, and a typed "1922.46" must
// come back as "$1,922.46", not get rounded down to whole dollars).
function makeDraft<K extends string>(values: Record<K, number>): Record<K, string> {
  const draft = {} as Record<K, string>;
  (Object.keys(values) as K[]).forEach((k) => {
    draft[k] = formatCents(values[k]);
  });
  return draft;
}

// Same idea as makeDraft above, but formatted as a plain two-decimal
// percentage string (e.g. "2.00") rather than currency, for PercentKey
// draft state. Generating this generically from PERCENT_DEFAULTS (rather
// than a hand-written object literal) means every new percent field
// automatically gets a correct initial/reset draft value with no risk of
// a forgotten key.
function makePercentDraft<K extends string>(values: Record<K, number>): Record<K, string> {
  const draft = {} as Record<K, string>;
  (Object.keys(values) as K[]).forEach((k) => {
    draft[k] = values[k].toFixed(2);
  });
  return draft;
}

// ---------------------------------------------------------------------
// Small presentational fields (fully controlled, no internal state, so
// "Reset to Defaults" and typed input always stay perfectly in sync)
// ---------------------------------------------------------------------
function InfoTip({ text }: { text: string }) {
  return (
    <button
      type="button"
      title={text}
      aria-label={text}
      className="inline-flex items-center justify-center text-ink/40 hover:text-brass transition-colors align-middle ml-1.5"
    >
      <Info size={14} aria-hidden="true" />
    </button>
  );
}

function FieldLabel({ children, info }: { children: React.ReactNode; info?: string }) {
  return (
    <span className="eyebrow text-ink/50 inline-flex items-center">
      {children}
      {info && <InfoTip text={info} />}
    </span>
  );
}

function CurrencyField({
  id,
  label,
  draft,
  onChange,
  onBlur,
  disabled,
  helperText,
  info,
}: {
  id: string;
  label: string;
  draft: string;
  onChange: (raw: string) => void;
  onBlur: () => void;
  disabled?: boolean;
  helperText?: string;
  info?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block mb-2">
        <FieldLabel info={info}>{label}</FieldLabel>
      </label>
      <div className="relative">
        <span
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40"
          aria-hidden="true"
        >
          $
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          className="w-full bg-white border border-line-dark pl-7 pr-3 py-2.5 text-ink outline-none focus:border-brass disabled:bg-paper-2 disabled:text-ink/40 disabled:cursor-not-allowed"
        />
      </div>
      {helperText && <p className="mt-1.5 text-xs text-ink/50 leading-relaxed">{helperText}</p>}
    </div>
  );
}

function IntegerField({
  id,
  label,
  draft,
  onChange,
  onBlur,
  info,
}: {
  id: string;
  label: string;
  draft: string;
  onChange: (raw: string) => void;
  onBlur: () => void;
  info?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block mb-2">
        <FieldLabel info={info}>{label}</FieldLabel>
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="w-full bg-white border border-line-dark px-3 py-2.5 text-ink outline-none focus:border-brass"
      />
    </div>
  );
}

function PercentField({
  id,
  label,
  draft,
  onChange,
  onBlur,
  fixed,
  info,
}: {
  id: string;
  label: string;
  draft: string;
  onChange: (raw: string) => void;
  onBlur: () => void;
  fixed?: boolean;
  info?: string;
}) {
  if (fixed) {
    return (
      <div>
        <div className="mb-2">
          <FieldLabel info={info}>{label}</FieldLabel>
        </div>
        <div className="w-full bg-paper-2 border border-line-dark px-3 py-2.5 text-ink/60">
          {draft}%
        </div>
      </div>
    );
  }
  return (
    <div>
      <label htmlFor={id} className="block mb-2">
        <FieldLabel info={info}>{label}</FieldLabel>
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className="w-full bg-white border border-line-dark pl-3 pr-8 py-2.5 text-ink outline-none focus:border-brass"
        />
        <span
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink/40"
          aria-hidden="true"
        >
          %
        </span>
      </div>
    </div>
  );
}

function ReadOnlyStat({
  label,
  value,
  helperText,
  info,
}: {
  label: string;
  value: string;
  helperText?: string;
  info?: string;
}) {
  return (
    <div>
      <div className="mb-2">
        <FieldLabel info={info}>{label}</FieldLabel>
      </div>
      <div className="w-full bg-paper-2 border border-line-dark px-3 py-2.5 text-ink/70">
        {value}
      </div>
      {helperText && <p className="mt-1.5 text-xs text-ink/50 leading-relaxed">{helperText}</p>}
    </div>
  );
}

// The Effective Tax Rate feature's on-page section, shared verbatim by
// all five financing structures (Traditional, Subject To, Seller
// Financing, Hybrid, Stack Method). Purely presentational -- every value
// and handler is owned by the parent, exactly like every other panel in
// this file. `idPrefix` keeps DOM ids unique across the (up to four)
// simultaneously-mounted copies of this section.
function PropertyTaxSection({
  idPrefix,
  county,
  onCountyChange,
  rateDraft,
  onRateChange,
  onRateBlur,
  rateSource,
  calculatedTax,
  usedTaxDraft,
  onUsedTaxChange,
  onUsedTaxBlur,
  taxSource,
  onUseCalculated,
  usedTaxDisabled,
  usedTaxHelperText,
  countyIsAutoIdentified,
  countyAutoStatus,
  countySuggestion,
  countySuggestionInTable,
  countySuggestionDiffersFromCurrent,
  onUseSuggestedCounty,
  onRetryCountyLookup,
}: {
  idPrefix: string;
  county: string;
  onCountyChange: (county: string) => void;
  rateDraft: string;
  onRateChange: (raw: string) => void;
  onRateBlur: () => void;
  rateSource: string;
  calculatedTax: number;
  usedTaxDraft: string;
  onUsedTaxChange: (raw: string) => void;
  onUsedTaxBlur: () => void;
  taxSource: string;
  onUseCalculated: () => void;
  usedTaxDisabled?: boolean;
  usedTaxHelperText?: string;
  // Automatic county suggestion (spec: "Automatically identify and
  // suggest the property's county"). All optional so this component
  // still works if a future call site never wires the feature in.
  countyIsAutoIdentified?: boolean;
  countyAutoStatus?: "idle" | "loading" | "found" | "notFound" | "notConfigured" | "error";
  countySuggestion?: string | null;
  countySuggestionInTable?: boolean;
  countySuggestionDiffersFromCurrent?: boolean;
  onUseSuggestedCounty?: () => void;
  onRetryCountyLookup?: () => void;
}) {
  return (
    <div className="mt-6 pt-5 border-t border-line-dark">
      <p className="eyebrow text-brass mb-1">Property Tax</p>
      <p className="text-sm text-ink/70 leading-[1.45] mb-4 max-w-2xl">
        Effective tax rates are estimates and may not equal the property&apos;s actual tax bill.
        Actual taxes may vary due to assessed value, exemptions, taxing districts, reassessment
        rules, and future rate changes.
      </p>
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor={`${idPrefix}County`} className="block mb-2">
            <FieldLabel info="Selecting a county populates Effective Tax Rate with that county's stored rate and recalculates immediately. Choose Custom to enter any rate freely.">
              County
            </FieldLabel>
          </label>
          <select
            id={`${idPrefix}County`}
            value={county}
            onChange={(e) => onCountyChange(e.target.value)}
            className="w-full bg-white border border-line-dark px-3 py-2.5 text-ink outline-none focus:border-brass"
          >
            <option value="">Select County</option>
            {COUNTY_TAX_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.counties.map((entry) => (
                  <option key={entry.county} value={entry.county}>
                    {entry.county} - {entry.rate.toFixed(2)}%
                  </option>
                ))}
              </optgroup>
            ))}
            <option value="Custom">Custom</option>
          </select>
          {/* Automatic county suggestion (spec: "Automatically identify
              and suggest the property's county"). Purely advisory --
              the select above is the only thing the rest of this form
              ever reads, and this block never writes to it except
              through the explicit "Use Suggested County" click. */}
          {countyAutoStatus === "loading" && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-ink/50">
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
              Looking up county from property address...
            </p>
          )}
          {countyAutoStatus === "found" && countySuggestion && countySuggestionDiffersFromCurrent && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="text-ink/50">
                Suggested from property address:{" "}
                <span className="font-medium text-ink/80">{countySuggestion}</span>
              </span>
              {countySuggestionInTable ? (
                <button
                  type="button"
                  onClick={onUseSuggestedCounty}
                  className="inline-flex items-center gap-1 text-brass hover:text-ink underline underline-offset-2"
                >
                  Use Suggested County
                </button>
              ) : (
                <span className="text-ink/40">(not in the supported county-rate list -- select manually or choose Custom)</span>
              )}
            </div>
          )}
          {(countyAutoStatus === "notFound" || countyAutoStatus === "error") && county === "" && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink/50">
              <span className="flex items-center gap-1.5">
                <HelpCircle size={12} aria-hidden="true" />
                County could not be identified automatically. Please select it manually.
              </span>
              <button
                type="button"
                onClick={onRetryCountyLookup}
                className="inline-flex items-center gap-1 text-brass hover:text-ink underline underline-offset-2"
              >
                <RefreshCw size={11} aria-hidden="true" />
                Retry
              </button>
            </div>
          )}
          {/* Always-visible status of the field's own value: never
              re-derived from the live lookup, so it stays accurate even
              after the suggestion above has been dismissed or a new
              (different) lookup has since run for an edited address. */}
          {county !== "" && county !== "Custom" && countyAutoStatus !== "loading" && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-ink/40">
              <CheckCircle2 size={12} className={countyIsAutoIdentified ? "text-brass" : ""} aria-hidden="true" />
              {countyIsAutoIdentified ? "Automatically identified from the property address" : "Manually entered"}
            </p>
          )}
        </div>
        <PercentField
          id={`${idPrefix}EffectiveTaxRate`}
          label="Effective Tax Rate"
          draft={rateDraft}
          onChange={onRateChange}
          onBlur={onRateBlur}
          info="Enter as a percentage, e.g. 2.23 for 2.23%, never 0.0223. Decimals allowed, 0-10%."
        />
        <ReadOnlyStat
          label="Calculated Annual Property Taxes"
          value={formatCents(calculatedTax)}
          helperText="Purchase Price x Effective Tax Rate."
        />
        <div>
          <div className="mb-2">
            <FieldLabel>Rate Source</FieldLabel>
          </div>
          <div className="w-full bg-paper-2 border border-line-dark px-3 py-2.5 text-ink/70">{rateSource}</div>
        </div>
        <CurrencyField
          id={`${idPrefix}UsedInUnderwriting`}
          label="Property Taxes Used in Underwriting"
          draft={usedTaxDraft}
          onChange={onUsedTaxChange}
          onBlur={onUsedTaxBlur}
          disabled={usedTaxDisabled}
          helperText={
            usedTaxHelperText ??
            "Used in every underwriting calculation below. Edit directly to override the calculated amount."
          }
          info="Preserves the calculated amount separately -- editing this field only overrides the figure actually used in the underwriting."
        />
        <div>
          <div className="mb-2">
            <FieldLabel>Property Tax Source</FieldLabel>
          </div>
          <div className="w-full bg-paper-2 border border-line-dark px-3 py-2.5 text-ink/70">{taxSource}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={onUseCalculated}
        className="mt-4 inline-flex items-center gap-2 border border-line-dark px-4 py-2 text-sm text-ink/70 hover:border-brass hover:text-ink transition-colors"
      >
        Use Calculated Tax Amount
      </button>
    </div>
  );
}

// The printable-report counterpart to PropertyTaxSection: the same six
// figures (County, Effective Tax Rate, Rate Source, Calculated Annual
// Property Taxes, Property Taxes Used in Underwriting, Property Tax
// Source) plus the tax-rate disclosure note, in whichever of this
// report's two row styles the surrounding card already uses. Never
// shows the county dropdown itself in print (per spec) -- only the
// selected county's name as plain text. Omitted entirely while no
// county has been selected and no rate has been entered, so a property
// with no tax-rate assumption modeled doesn't print six empty-looking
// rows.
function PropertyTaxPrintRows({
  dense,
  county,
  ratePct,
  rateSource,
  calculatedTax,
  usedTax,
  taxSource,
}: {
  dense?: boolean;
  county: string;
  ratePct: number;
  rateSource: string;
  calculatedTax: number;
  usedTax: number;
  taxSource: string;
}) {
  if (county === "" && ratePct <= 0) return null;
  const rowClass = dense ? "flex justify-between gap-3" : "flex justify-between";
  const labelClass = dense ? "text-ink/60 min-w-0" : "text-ink/60";
  const valueClass = dense ? "text-ink flex-shrink-0 text-right" : "font-medium text-ink";
  const row = (label: string, value: string) => (
    <div className={rowClass} key={label}>
      <span className={labelClass}>{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
  return (
    <>
      {row("County", county === "" ? "Not Selected" : county)}
      {row("Effective Tax Rate", `${ratePct.toFixed(2)}%`)}
      {row("Rate Source", rateSource)}
      {row("Calculated Annual Property Taxes", formatCents(calculatedTax))}
      {row("Property Taxes Used in Underwriting", formatCents(usedTax))}
      {row("Property Tax Source", taxSource)}
      <p className={`col-span-2 text-[8pt] text-ink leading-relaxed ${dense ? "" : "mt-1"}`}>
        Effective tax rates are estimates and may not equal the property&apos;s actual tax bill.
        Actual taxes may vary due to assessed value, exemptions, taxing districts, reassessment
        rules, and future rate changes.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------
// Property Address autocomplete -- Google Places Autocomplete (Data)
// API, the current (non-deprecated) client-side autocomplete surface
// (google.maps.places.AutocompleteSuggestion, which replaced the
// legacy AutocompleteService/Autocomplete widget for new integrations
// as of March 2025). Built as a custom-styled suggestion list rather
// than Google's own PlaceAutocompleteElement web component so it can
// match this site's existing paper/ink/brass visual language exactly
// (hover, selected, and keyboard-focus states included).
//
// Loaded via NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY -- the same public
// key already used for the Transit section's embedded map -- rather
// than the server-only GOOGLE_MAPS_API_KEY, since this runs entirely in
// the browser. That key needs the Places API (New) enabled and its API
// restrictions widened to include it; see the README's "Transit and
// Bus Stop Access" section for the exact Google Cloud Console steps.
// This component never touches GOOGLE_MAPS_API_KEY at all.
//
// Selecting a suggestion just calls onChange() with the resolved
// address text -- the same setter the input's onChange already uses --
// so the existing debounced automatic transit lookup (keyed on
// propertyAddress in the parent component) picks it up exactly as if
// the full address had been typed by hand. No separate "trigger the
// lookup" plumbing is needed here.
function PropertyAddressAutocomplete({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<GoogleAutocompleteSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [notConfigured, setNotConfigured] = useState(false);
  // Distinct from notConfigured: the key is present, but loading the
  // Maps JavaScript API or fetching suggestions actually failed (e.g.
  // Places API (New) not enabled, key not authorized for this domain,
  // network error). The specific reason is always logged to the
  // browser console (see loadGooglePlacesLibrary and the catch blocks
  // below) so a broken deployment is diagnosable rather than silently
  // showing nothing.
  const [loadError, setLoadError] = useState(false);

  const sessionTokenRef = useRef<GoogleAutocompleteSessionToken | null>(null);
  // Bumped on every new fetch and every time the input drops below the
  // 3-character threshold -- a response is only applied if this still
  // matches the value captured when that particular request started,
  // so a slow response for an earlier keystroke can never clobber
  // suggestions for what the person has since typed.
  const requestSeqRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  function closeSuggestions() {
    setOpen(false);
    setActiveIndex(-1);
  }

  // Close on a click/tap outside the field or its dropdown, and on Escape.
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeSuggestions();
      }
    }
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeSuggestions();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, []);

  function fetchSuggestions(query: string) {
    const embedApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY || null;
    if (!embedApiKey) {
      setNotConfigured(true);
      return;
    }
    const seq = ++requestSeqRef.current;
    loadGooglePlacesLibrary(embedApiKey)
      .then(({ AutocompleteSuggestion, AutocompleteSessionToken }) => {
        // One session token covers the whole run of keystrokes from
        // the first request until a selection resolves a Place (or the
        // field is cleared) -- reused across requests, not recreated
        // per keystroke, per Google's session-based billing guidance.
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new AutocompleteSessionToken();
        }
        return AutocompleteSuggestion.fetchAutocompleteSuggestions(
          buildAutocompleteRequest(query, sessionTokenRef.current)
        );
      })
      .then(({ suggestions: results }) => {
        if (isStaleAutocompleteResponse(seq, requestSeqRef.current)) return; // superseded by a newer keystroke
        setNotConfigured(false);
        setLoadError(false);
        setSuggestions(results);
        setOpen(results.length > 0);
        setActiveIndex(-1);
      })
      .catch((err) => {
        if (isStaleAutocompleteResponse(seq, requestSeqRef.current)) return;
        // loadGooglePlacesLibrary already logs the specific failure
        // reason (script/key/API-enablement problem); this logs the
        // query that triggered it so the two log lines can be matched
        // up in the console.
        console.error(`[PropertyAddressAutocomplete] Suggestion fetch failed for "${query}":`, err);
        setSuggestions([]);
        setLoadError(true);
        closeSuggestions();
      });
  }

  function handleInputChange(next: string) {
    onChange(next);

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    if (!shouldFetchSuggestions(next)) {
      requestSeqRef.current++; // invalidate any request already in flight
      setSuggestions([]);
      setLoadError(false);
      closeSuggestions();
      return;
    }

    const trimmed = next.trim();
    debounceTimerRef.current = setTimeout(() => fetchSuggestions(trimmed), AUTOCOMPLETE_DEBOUNCE_MS);
  }

  function selectSuggestion(suggestion: GoogleAutocompleteSuggestion) {
    const prediction = suggestion.placePrediction;
    if (!prediction) return;

    onChange(prediction.text.toString());
    closeSuggestions();
    setSuggestions([]);

    // Resolving to a Place and calling fetchFields() gets Google's own
    // canonical formatted address (rather than relying solely on the
    // prediction's display text) and is also what properly closes out
    // the autocomplete session for billing, per Google's documented
    // best practice -- the next keystroke starts a fresh session.
    prediction
      .toPlace()
      .fetchFields({ fields: ["formattedAddress"] })
      .then(({ place }) => {
        if (place.formattedAddress) onChange(place.formattedAddress);
      })
      .catch(() => {
        // Keep the prediction's display text already applied above --
        // still a complete, human-readable address even if this
        // follow-up call fails.
      })
      .finally(() => {
        sessionTokenRef.current = null;
      });
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        id="propertyAddress"
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls="propertyAddressSuggestions"
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `propertyAddressSuggestion-${activeIndex}` : undefined}
        value={value}
        onChange={(e) => handleInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => (i + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
          } else if (e.key === "Enter") {
            // Spec: never auto-select the first suggestion -- Enter
            // only picks one if the person has actually highlighted it
            // with the arrow keys first.
            if (activeIndex >= 0 && activeIndex < suggestions.length) {
              e.preventDefault();
              selectSuggestion(suggestions[activeIndex]);
            }
          } else if (e.key === "Escape") {
            closeSuggestions();
          }
        }}
        placeholder="Enter the property address"
        className="w-full bg-white border border-line-dark px-3 py-2.5 text-ink outline-none focus:border-brass"
      />
      {open && suggestions.length > 0 && (
        <ul
          id="propertyAddressSuggestions"
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto border border-line-dark bg-white shadow-lg"
        >
          {suggestions.map((suggestion, index) => {
            const prediction = suggestion.placePrediction;
            if (!prediction) return null;
            const text = prediction.text.toString();
            const active = index === activeIndex;
            return (
              <li
                key={`${text}-${index}`}
                id={`propertyAddressSuggestion-${index}`}
                role="option"
                aria-selected={active}
                onMouseDown={(e) => {
                  // mousedown, not click -- fires before the document
                  // pointerdown listener above would otherwise close
                  // the list first.
                  e.preventDefault();
                  selectSuggestion(suggestion);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={`px-3 py-2.5 text-sm cursor-pointer border-b border-line-dark/30 last:border-b-0 ${
                  active ? "bg-brass/10 text-ink" : "text-ink/80 hover:bg-paper-2"
                }`}
              >
                {text}
              </li>
            );
          })}
        </ul>
      )}
      {notConfigured && (
        <p className="mt-1.5 text-xs text-ink/40">
          Address autocomplete is not configured for this site -- you can still type the address by hand.
        </p>
      )}
      {loadError && !notConfigured && (
        <p className="mt-1.5 text-xs text-ink/40">
          Address suggestions are temporarily unavailable -- you can still type the address by hand. (Details
          logged to the browser console.)
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Transit and Bus Stop Access: on-page section. Purely presentational
// like PropertyTaxSection above -- all state and handlers live on the
// parent component. Rendered exactly once (Property Address itself is a
// single, financing-mode-independent field, not duplicated per
// structure), which is what satisfies "apply consistently across all
// five financing structures": the section is always visible regardless
// of which structure is selected.
//
// Automatic-lookup architecture (see lib/transit/manual.ts and
// lib/transit/googleLookup.ts for the full rationale): the nearest bus
// stop, walking time, and walking distance are found automatically via
// Google's Places + Directions APIs and pre-fill the fields below, but
// the person underwriting the deal always has the final say -- every
// field stays editable and the embedded map is a visible check on what
// was found. This section is purely informational: it reports the
// transit data it finds and does not judge whether the property passes
// or fails any distance/time threshold.
// ---------------------------------------------------------------------

// Status of the automatic Places + Directions lookup that pre-fills the
// fields below. "idle" covers both "no address yet" and "an address is
// entered but it's already been auto-looked-up or a saved result exists
// for it," so the UI only needs to show something while a lookup is
// actually in flight or just finished.
type TransitAutoStatus = "idle" | "loading" | "found" | "notFound" | "notConfigured" | "error";

function TransitAndBusStopAccessSection({
  address,
  nearestStopDraft,
  onNearestStopDraftChange,
  walkingTimeDraft,
  onWalkingTimeDraftChange,
  walkingDistanceDraft,
  onWalkingDistanceDraftChange,
  notesDraft,
  onNotesDraftChange,
  autoStatus,
  autoStopCoords,
}: {
  address: string;
  nearestStopDraft: string;
  onNearestStopDraftChange: (value: string) => void;
  walkingTimeDraft: string;
  onWalkingTimeDraftChange: (value: string) => void;
  walkingDistanceDraft: string;
  onWalkingDistanceDraftChange: (value: string) => void;
  notesDraft: string;
  onNotesDraftChange: (value: string) => void;
  autoStatus: TransitAutoStatus;
  autoStopCoords: { lat: number; lng: number } | null;
}) {
  const embedApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY || null;
  const hasAddress = looksLikeUsableAddress(address);
  const directionsEmbedUrl = autoStopCoords
    ? buildMapsDirectionsEmbedUrl(address, autoStopCoords.lat, autoStopCoords.lng, embedApiKey)
    : null;
  const embedUrl = hasAddress ? directionsEmbedUrl || buildMapsEmbedUrl(address, embedApiKey) : null;
  const searchUrl = autoStopCoords
    ? buildMapsDirectionsSearchUrl(address, autoStopCoords.lat, autoStopCoords.lng)
    : buildMapsSearchUrl(address);

  return (
    <div className="print:hidden mt-6 bg-paper text-ink p-6 sm:p-8 md:p-10">
      <p className="eyebrow text-brass mb-1">Transit and Bus Stop Access</p>
      <p className="text-sm text-ink/70 leading-[1.45] mb-5 max-w-2xl">
        Enter a Property Address above and the nearest bus stop, walking time, and walking distance
        are looked up automatically using Google Maps and filled in below. Edit any field directly
        at any time -- changes are used immediately, with no separate save step.
      </p>

      {/* Embedded Google Maps panel -- shows a walking-directions route
          once the automatic lookup finds a nearest stop, otherwise a
          plain search panel (spec: Maps Embed API only -- never a
          scraped/embedded google.com search-results page, and the app
          never reads anything back out of the iframe itself). */}
      <div className="mb-2 flex justify-center">
        <div className="w-full max-w-[850px]">
          {!hasAddress ? (
            <div className="w-full h-[350px] sm:h-[450px] flex items-center justify-center border border-line-dark bg-paper-2 text-sm text-ink/60 text-center px-6">
              Enter a Property Address above to search for nearby bus stops.
            </div>
          ) : embedUrl ? (
            <iframe
              title={
                directionsEmbedUrl
                  ? "Walking route to the nearest bus stop (Google Maps)"
                  : "Bus stops near this property (Google Maps)"
              }
              src={embedUrl}
              className="w-full h-[350px] sm:h-[450px] border border-line-dark"
              style={{ border: 0 }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : (
            <div className="w-full h-[350px] sm:h-[450px] flex items-center justify-center border border-line-dark bg-paper-2 text-sm text-ink/60 text-center px-6">
              The embedded Google Maps view is not configured.
            </div>
          )}
        </div>
      </div>

      <div className="mb-3 flex justify-center">
        <p className="text-xs text-ink/50 text-center max-w-[850px]">
          {autoStatus === "loading" && "Looking up the nearest bus stop..."}
          {autoStatus === "found" && "Automatically detected. Review and edit the fields below if needed."}
          {autoStatus === "notFound" &&
            "Automatic lookup did not find a nearby bus stop for this address. Enter the details manually below."}
          {autoStatus === "notConfigured" &&
            "Automatic bus stop lookup is not configured for this site. Enter the details manually below."}
          {autoStatus === "error" &&
            "Automatic bus stop lookup could not be completed right now. Enter the details manually below."}
        </p>
      </div>

      <div className="mb-6 flex justify-center">
        <a
          href={searchUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            if (!hasAddress) e.preventDefault();
          }}
          aria-disabled={!hasAddress}
          className={`inline-flex items-center gap-2 border px-4 py-2.5 text-sm transition-colors w-full sm:w-auto justify-center ${
            hasAddress
              ? "border-line-dark text-ink hover:border-brass"
              : "border-line-dark/50 text-ink/40 cursor-not-allowed"
          }`}
        >
          Open Bus Stop Search in Google Maps
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      </div>

      {/* Nearest Bus Stop full width, Walking Time/Distance side by side,
          Transit Notes full width. No Transit Agency, Bus Route Numbers,
          or Date Verified fields, no maximum walking distance/time
          setting, and no Pass/Fail judgment of any kind -- this section
          only reports the actual transit data found, filled in
          automatically and editable by hand at any time. */}
      <div className="grid sm:grid-cols-2 gap-5 mb-5">
        <div className="sm:col-span-2">
          <label htmlFor="transitNearestStop" className="block mb-2">
            <FieldLabel>Nearest Bus Stop</FieldLabel>
          </label>
          <input
            id="transitNearestStop"
            type="text"
            value={nearestStopDraft}
            onChange={(e) => onNearestStopDraftChange(e.target.value)}
            placeholder="e.g. Benfield Rd @ Shads Landing"
            className="w-full bg-white border border-line-dark px-3 py-2.5 text-ink outline-none focus:border-brass"
          />
        </div>
        <div>
          <label htmlFor="transitWalkingTime" className="block mb-2">
            <FieldLabel>Walking Time</FieldLabel>
          </label>
          <input
            id="transitWalkingTime"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={walkingTimeDraft}
            onChange={(e) => onWalkingTimeDraftChange(e.target.value)}
            placeholder="13"
            className="w-full bg-white border border-line-dark px-3 py-2.5 text-ink outline-none focus:border-brass"
          />
          <p className="mt-1 text-xs text-ink/50">Minutes</p>
        </div>
        <div>
          <label htmlFor="transitWalkingDistance" className="block mb-2">
            <FieldLabel>Walking Distance</FieldLabel>
          </label>
          <input
            id="transitWalkingDistance"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={walkingDistanceDraft}
            onChange={(e) => onWalkingDistanceDraftChange(e.target.value)}
            placeholder="0.60"
            className="w-full bg-white border border-line-dark px-3 py-2.5 text-ink outline-none focus:border-brass"
          />
          <p className="mt-1 text-xs text-ink/50">Miles</p>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="transitNotesField" className="block mb-2">
            <FieldLabel>Transit Notes</FieldLabel>
          </label>
          <textarea
            id="transitNotesField"
            value={notesDraft}
            onChange={(e) => onNotesDraftChange(e.target.value)}
            rows={3}
            placeholder="e.g. Bus stop has no sidewalk access, route requires crossing a major highway..."
            className="w-full bg-white border border-line-dark px-3 py-2.5 text-ink outline-none focus:border-brass resize-y"
          />
        </div>
      </div>

      <p className="text-xs text-ink/50 leading-relaxed max-w-2xl">
        Nearest bus stop, walking time, and walking distance are looked up automatically using
        Google Maps and update the underwriting result immediately -- edits to any field take
        effect right away, with no separate save step. Verify sidewalks, road crossings, lighting,
        terrain, accessibility, stop activity, route schedules, and current bus service before
        acquiring the property.
      </p>

      {/* Temporary deployment marker -- confirms which build/component is
          actually live. Safe to remove once the correct deployment has
          been confirmed. */}
      <p className="print:hidden mt-4 text-[10px] text-ink/30">
        Transit Interface Version: Google Maps Embed + Automatic Lookup 2.0
      </p>
    </div>
  );
}

// The printable-report counterpart to TransitAndBusStopAccessSection.
// Never includes the embedded map, lookup buttons, or loading indicators
// -- only the current transit figures, found automatically and editable
// by hand at any time on the underwriting page.
function TransitPrintSection({
  propertyAddress,
  data,
  mapData,
}: {
  propertyAddress: string;
  data: TransitResult | null;
  // The same property/stop coordinates and route polyline captured
  // when the automatic lookup succeeded (see transitPrintMapData in
  // the main component) -- null whenever no lookup has completed, in
  // which case the map is omitted entirely rather than showing an
  // empty placeholder or a broken image.
  mapData: { propertyLat: number; propertyLng: number; stopLat: number; stopLng: number; polyline: string | null } | null;
}) {
  if (!data) return null;

  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-3" key={label}>
      <span className="text-ink/60 min-w-0">{label}</span>
      <span className="text-ink flex-shrink-0 text-right">{value}</span>
    </div>
  );

  // Static Maps API image, proxied through our own /api/transit/
  // static-map route so the private GOOGLE_MAPS_API_KEY never reaches
  // the browser -- see that route for how the URL is built server-side.
  // A plain <img> (not the live page's iframe) so it rasterizes
  // reliably in browser print preview and saved PDFs. Fixed 640x400
  // (8:5) intrinsic size plus `w-full h-auto` keeps the aspect ratio
  // correct at any print width, and `print:break-inside-avoid-page` on
  // this whole card (already applied below) keeps the map from
  // splitting across two printed pages.
  const mapImageUrl = mapData
    ? `/api/transit/static-map?propertyLat=${mapData.propertyLat}&propertyLng=${mapData.propertyLng}&stopLat=${mapData.stopLat}&stopLng=${mapData.stopLng}${
        mapData.polyline ? `&polyline=${encodeURIComponent(mapData.polyline)}` : ""
      }`
    : null;

  return (
    <div className="mb-3 print:break-inside-avoid-page rounded-xl border border-ink/15 bg-white p-2.5">
      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-brass/40">
        <Bus size={14} className="text-brass" />
        <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink">
          Transit and Bus Stop Access
        </p>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[9.5pt]">
        {row("Property Address", propertyAddress.trim() || "Not entered")}
        {row("Nearest Bus Stop", data.nearestStop.trim() || "Not entered")}
        {row(
          "Walking Time",
          data.walkingTimeMinutes !== null ? `${data.walkingTimeMinutes} minutes` : "Not entered"
        )}
        {row(
          "Walking Distance",
          data.walkingDistanceMiles !== null ? `${data.walkingDistanceMiles} miles` : "Not entered"
        )}
        {row("Data Source", "Google Maps (Automatic Lookup)")}
      </div>
      {mapImageUrl && (
        <div
          className="mt-2 print:break-inside-avoid-page rounded-lg overflow-hidden border border-ink/10 bg-ink/5"
          style={{ maxHeight: "3.1in" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a
              plain <img> is required here (not next/image) so the
              static map rasterizes as a normal image in browser print
              output; next/image's lazy-loading and layout wrapper are
              unnecessary for a single server-proxied print image and
              have caused print-omission issues with other tools. */}
          <img
            src={mapImageUrl}
            width={640}
            height={400}
            alt="Map showing the property, the nearest bus stop, and the walking route between them"
            className="block w-full h-auto"
            style={{ aspectRatio: "640 / 400", objectFit: "contain", maxHeight: "3.1in" }}
          />
        </div>
      )}
      {data.notes.trim() && (
        <p className="mt-2 pt-2 border-t border-ink/10 text-[9pt] text-ink leading-relaxed">
          Transit Notes: {data.notes.trim()}
        </p>
      )}
      <p className="mt-2 text-[8pt] text-ink leading-relaxed">
        Nearest bus stop, walking time, and walking distance are looked up automatically using
        Google Maps and can be edited on the underwriting page. Verify sidewalks, road crossings,
        lighting, terrain, accessibility, stop activity, route schedules, and current bus service
        before acquiring the property.
      </p>
    </div>
  );
}


// ---------------------------------------------------------------------
// Amortization Schedule display: one reusable block used by every
// financing structure (Traditional, Subject To, Seller Financing,
// Hybrid's two legs, Stack Method's two legs). Defaults to a clean
// annual summary (Year, Beginning Balance, Total Payments, Principal
// Paid, Interest Paid, Ending Balance) rather than hundreds of monthly
// rows, with an option to expand to the full monthly detail or download
// the complete monthly schedule as a CSV. `disclosure`, when provided,
// renders the required estimation notice for Subject-To and Hybrid's
// existing-mortgage schedules. `note`, when provided, renders a short
// plain-text clarification (e.g. that the schedule is based on the
// entered interest rate and amortization term, never on a PITI figure).
function AmortizationScheduleBlock({
  title,
  schedule,
  disclosure,
  note,
  csvFilename,
}: {
  title: string;
  schedule: AmortizationRow[];
  disclosure?: string;
  note?: string;
  csvFilename: string;
}) {
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"annual" | "monthly">("annual");
  const [showAllMonths, setShowAllMonths] = useState(false);
  const annualRows = useMemo(() => buildAnnualAmortizationSummary(schedule), [schedule]);

  function downloadCsv() {
    const lines: string[] = [
      "Payment Number,Beginning Balance,Principal Paid,Interest Paid,Total Payment,Ending Balance",
    ];
    for (const row of schedule) {
      lines.push(
        [
          row.paymentNumber,
          row.beginningBalance.toFixed(2),
          row.principalPaid.toFixed(2),
          row.interestPaid.toFixed(2),
          row.totalPayment.toFixed(2),
          row.endingBalance.toFixed(2),
        ].join(",")
      );
    }
    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = csvFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (schedule.length === 0) {
    return null;
  }

  return (
    <div className="mt-8 pt-6 border-t border-line-dark">
      <p className="eyebrow text-ink/70 mb-2">{title}</p>
      {note && <p className="text-xs text-ink/50 leading-relaxed mb-3">{note}</p>}
      {disclosure && (
        <p className="text-xs text-ink/70 leading-relaxed mb-4 rounded border border-brass/50 bg-brass/5 p-3">
          {disclosure}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 border border-line-dark px-4 py-2 eyebrow text-ink/70 hover:border-brass hover:text-ink transition-colors"
        >
          {open ? "Hide" : "View"} Amortization Schedule
        </button>
        <button
          type="button"
          onClick={downloadCsv}
          className="inline-flex items-center gap-2 border border-line-dark px-4 py-2 eyebrow text-ink/70 hover:border-brass hover:text-ink transition-colors"
        >
          Download Full Monthly Schedule as CSV
        </button>
      </div>

      {open && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <p className="text-xs text-ink/50">
              {viewMode === "annual"
                ? `Annual summary (${annualRows.length} year${annualRows.length === 1 ? "" : "s"})`
                : `Full monthly detail (${schedule.length} payment${schedule.length === 1 ? "" : "s"})`}
            </p>
            <button
              type="button"
              onClick={() => setViewMode((v) => (v === "annual" ? "monthly" : "annual"))}
              className="text-xs text-brass underline decoration-brass/50 underline-offset-2 hover:text-brass-light transition-colors"
            >
              {viewMode === "annual" ? "View Monthly Detail" : "View Annual Summary"}
            </button>
          </div>

          {viewMode === "annual" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm border-collapse">
                <thead>
                  <tr className="border-b border-line-dark text-left text-ink/60">
                    <th className="py-2 pr-3 font-medium">Year</th>
                    <th className="py-2 pr-3 font-medium">Beginning Balance</th>
                    <th className="py-2 pr-3 font-medium">Total Payments</th>
                    <th className="py-2 pr-3 font-medium">Principal Paid</th>
                    <th className="py-2 pr-3 font-medium">Interest Paid</th>
                    <th className="py-2 pr-3 font-medium">Ending Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {annualRows.map((row) => (
                    <tr key={row.year} className="border-b border-line-dark/40">
                      <td className="py-1.5 pr-3">{row.year}</td>
                      <td className="py-1.5 pr-3">{formatCents(row.beginningBalance)}</td>
                      <td className="py-1.5 pr-3">{formatCents(row.totalPayments)}</td>
                      <td className="py-1.5 pr-3">{formatCents(row.principalPaid)}</td>
                      <td className="py-1.5 pr-3">{formatCents(row.interestPaid)}</td>
                      <td className="py-1.5 pr-3">{formatCents(row.endingBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-line-dark text-left text-ink/60">
                      <th className="py-2 pr-3 font-medium">Payment #</th>
                      <th className="py-2 pr-3 font-medium">Beginning Balance</th>
                      <th className="py-2 pr-3 font-medium">Principal Paid</th>
                      <th className="py-2 pr-3 font-medium">Interest Paid</th>
                      <th className="py-2 pr-3 font-medium">Total Payment</th>
                      <th className="py-2 pr-3 font-medium">Ending Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllMonths ? schedule : schedule.slice(0, 12)).map((row) => (
                      <tr key={row.paymentNumber} className="border-b border-line-dark/40">
                        <td className="py-1.5 pr-3">{row.paymentNumber}</td>
                        <td className="py-1.5 pr-3">{formatCents(row.beginningBalance)}</td>
                        <td className="py-1.5 pr-3">{formatCents(row.principalPaid)}</td>
                        <td className="py-1.5 pr-3">{formatCents(row.interestPaid)}</td>
                        <td className="py-1.5 pr-3">{formatCents(row.totalPayment)}</td>
                        <td className="py-1.5 pr-3">{formatCents(row.endingBalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {schedule.length > 12 && (
                <button
                  type="button"
                  onClick={() => setShowAllMonths((v) => !v)}
                  className="mt-4 text-xs text-brass underline decoration-brass/50 underline-offset-2 hover:text-brass-light transition-colors"
                >
                  {showAllMonths ? "Show First 12 Payments" : `View All ${schedule.length} Payments`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Shown alongside <AmortizationScheduleBlock> for Subject To and
// Hybrid's existing-mortgage leg specifically, since the remaining
// amortization term for those loans is optional (see
// resolveEffectiveAmortizationTerm in lib/amortization.ts). Renders
// nothing at all once a usable term exists -- either entered directly
// or successfully estimated -- since <AmortizationScheduleBlock>
// already renders the schedule itself (with an "(Estimated)" note) in
// that case. This component only covers the two "no schedule" cases:
// an entered payment that mathematically can never pay the loan off
// (a real problem worth a clear warning, per spec), or simply not
// enough information yet (a neutral note, never a silently assumed
// term such as 30 years). Print-safe: the print: classes are inert
// outside of print media, so the same markup works on-page and in the
// printable report without a second copy.
function AmortizationEstimateStatus({ term }: { term: EffectiveAmortizationTerm }) {
  if (term.months !== null) return null;
  if (term.insufficientPayment) {
    return (
      <p className="mt-6 print:mt-2 text-xs print:text-[8pt] text-red-700 bg-red-50 border border-red-200 rounded p-3 print:p-2 leading-relaxed print:break-inside-avoid-page">
        <span className="font-semibold">Amortization schedule unavailable: </span>
        the entered monthly principal and interest payment does not cover interest on this balance at
        the entered rate, so the loan would never amortize at that payment. Enter the actual remaining
        amortization term instead, or double-check the payment and interest rate.
      </p>
    );
  }
  return (
    <p className="mt-6 print:mt-2 text-xs print:text-[8pt] text-ink/60 bg-paper-2 border border-line-dark rounded p-3 print:p-2 leading-relaxed print:break-inside-avoid-page">
      The remaining amortization schedule cannot be calculated accurately until more loan information
      is provided. Enter the remaining amortization term if it is known, or the loan&apos;s actual
      monthly principal and interest payment so the term can be estimated.
    </p>
  );
}

// ---------------------------------------------------------------------
// Breakdown row types, shared by the on-page table, CSV export, and the
// printable summary
// ---------------------------------------------------------------------
type BreakdownRow = { label: string; value: string; isTotal?: boolean };
type BreakdownSection = { title: string; rows: BreakdownRow[] };

export default function SharedHousingCalculator() {
  const [paymentType, setPaymentType] = useState<PaymentType>(PAYMENT_TYPE_DEFAULT);

  const [financing, setFinancing] = useState<Record<FinancingKey, number>>(FINANCING_DEFAULTS);
  const [financingDraft, setFinancingDraft] = useState<Record<FinancingKey, string>>(
    makeDraft(FINANCING_DEFAULTS)
  );

  // Effective Tax Rate: one shared assumption (county + rate), used by
  // every financing structure, that drives Calculated Annual Property
  // Taxes = Purchase Price x Effective Tax Rate. "" is "Select County".
  // The Effective Tax Rate itself allows decimals and is never forced
  // back to the county default once the user edits it (see the derived
  // propertyTaxRateSource / stackEstimatedCash-style comparison below).
  const [propertyTaxCounty, setPropertyTaxCounty] = useState<string>("");
  const [propertyTaxRatePct, setPropertyTaxRatePct] = useState<number>(0);
  const [propertyTaxRateDraft, setPropertyTaxRateDraft] = useState<string>("");
  // Whether the current County value was populated by accepting the
  // automatic "Suggested from property address" result (true) or chosen
  // directly from the dropdown / left unset (false). Purely a display
  // concern -- "Automatically Identified" vs "Manually Entered" next to
  // the County field -- and never affects which rate is actually used.
  const [countyIsAutoIdentified, setCountyIsAutoIdentified] = useState<boolean>(false);
  // Property Taxes Used in Underwriting (financing.annualPropertyTaxes,
  // the same pre-existing field every downstream calculation already
  // reads) normally tracks the calculated amount automatically. Once the
  // user edits that field directly, this flips true and the field stops
  // following the calculation until "Use Calculated Tax Amount" is
  // pressed (or Reset to Defaults runs).
  const [propertyTaxManualOverride, setPropertyTaxManualOverride] = useState<boolean>(false);

  const [capital, setCapital] = useState<Record<CapitalKey, number>>(CAPITAL_DEFAULTS);
  const [capitalDraft, setCapitalDraft] = useState<Record<CapitalKey, string>>(
    makeDraft(CAPITAL_DEFAULTS)
  );

  // Scope of Work: an optional itemized breakdown of Renovation Cost,
  // shared across every financing structure. useItemizedScopeOfWork
  // defaults to Yes (true), matching the spec's default -- while true,
  // Renovation Cost is kept in sync with the Scope of Work Total by the
  // effect below; while false, Renovation Cost is a normal, freely
  // editable currency field and the Scope of Work Total is shown only
  // for reference.
  const [scopeOfWorkItems, setScopeOfWorkItems] = useState<ScopeOfWorkItem[]>([]);
  const [useItemizedScopeOfWork, setUseItemizedScopeOfWork] = useState(true);

  const [percent, setPercent] = useState<Record<PercentKey, number>>(PERCENT_DEFAULTS);
  const [percentDraft, setPercentDraft] = useState<Record<PercentKey, string>>(
    makePercentDraft(PERCENT_DEFAULTS)
  );

  // Stack Method: Bank Amortization Term and Seller Finance Amortization
  // Term are both entered in years (not currency or percent), so they
  // follow the same plain integer draft-string pattern used for the
  // bedroom counts below rather than the currency/percent field
  // patterns. The narrower "Seller Finance Balloon Term" that used to
  // live here has been replaced by the comprehensive, whole-structure
  // Balloon Refinance Analysis feature below (see stackBalloonExists).
  const [stackBankAmortizationYears, setStackBankAmortizationYears] = useState(30);
  const [stackBankAmortizationYearsDraft, setStackBankAmortizationYearsDraft] = useState("30");
  const [stackSellerFinanceAmortizationYears, setStackSellerFinanceAmortizationYears] = useState(30);
  const [stackSellerFinanceAmortizationYearsDraft, setStackSellerFinanceAmortizationYearsDraft] =
    useState("30");

  // Are Monthly Seller Finance Payments Required?: the Stack Method's
  // seller-financed balance can exist without any monthly seller-finance
  // payment (deferred, interest-free, or due at a balloon/negotiated
  // date instead). Defaults to No/false, matching the requirement that
  // no monthly seller-finance payment is ever automatically assumed.
  const [stackSellerFinancePaymentsRequired, setStackSellerFinancePaymentsRequired] = useState(false);

  // Are Monthly Seller Finance Payments Required? (Hybrid): the same
  // optional-payment pattern as Stack Method above, applied to the
  // Hybrid structure's seller-financed balance. Defaults to No/false --
  // no monthly seller-finance payment is assumed until the user
  // explicitly selects Yes. While No, the balance is assumed to carry
  // in full, unamortized, until the balloon date.
  const [hybridSellerFinancePaymentsRequired, setHybridSellerFinancePaymentsRequired] = useState(false);

  // Hybrid Seller-Financed Balance override: null while the field is
  // following the automatically calculated Suggested Seller-Financed
  // Balance (Purchase Price - Existing Mortgage Balance - Seller Down
  // Payment); once the user types into the field, it holds their
  // entered amount instead and stops following the suggestion, exactly
  // like holdingCostsOverride above.
  const [hybridSellerFinancedBalanceOverride, setHybridSellerFinancedBalanceOverride] = useState<
    number | null
  >(null);
  const [hybridSellerFinancedBalanceDraft, setHybridSellerFinancedBalanceDraft] = useState("");

  // Estimated Monthly Long-Term Rent: optional, left blank (null) by
  // default rather than defaulting to $0, so a blank field can be told
  // apart from a deliberately entered $0. While blank, the manually
  // selected Bank Loan-to-Value Percentage is used unchanged; once a
  // value is entered, it is compared against the Bank PITI at an 80%
  // LTV assumption to automatically select 80% or 75% (see
  // stackLtvAutoSelected below).
  const [stackLongTermRent, setStackLongTermRent] = useState<number | null>(null);
  const [stackLongTermRentDraft, setStackLongTermRentDraft] = useState("");

  // Estimated Monthly Long-Term Rent (Traditional Financing): the same
  // optional, blank-by-default pattern as Stack Method's Long-Term Rent
  // Qualification above. While blank, the manually selected Down
  // Payment Percentage is used unchanged; once a value is entered, it
  // is compared against the Estimated Monthly PITI at an 80% LTV
  // assumption to automatically select an 80% or 75% Selected LTV (see
  // traditionalLtvAutoSelected above).
  const [traditionalLongTermRent, setTraditionalLongTermRent] = useState<number | null>(null);
  const [traditionalLongTermRentDraft, setTraditionalLongTermRentDraft] = useState("");

  // ---------------------------------------------------------------------
  // Balloon Refinance Analysis: one independent Yes/No + terms + 70% LTV
  // contingency set per applicable financing structure (Stack Method,
  // Subject To, Seller Financing, and Hybrid -- never Traditional
  // Financing). Every "Exists" flag defaults to No/false; Balloon Due in
  // Years defaults to 5 (must be > 0 whenever a balloon exists); the 70%
  // LTV contingency defaults to Yes/true. Annual Property Appreciation
  // defaults are in PERCENT_DEFAULTS above (2% each, independently
  // editable per structure).
  // ---------------------------------------------------------------------
  const [stackBalloonExists, setStackBalloonExists] = useState(false);
  const [stackBalloonYears, setStackBalloonYears] = useState(5);
  const [stackBalloonYearsDraft, setStackBalloonYearsDraft] = useState("5");
  const [stackBalloonHas70LtvContingency, setStackBalloonHas70LtvContingency] = useState(true);

  const [subjectToBalloonExists, setSubjectToBalloonExists] = useState(false);
  const [subjectToBalloonYears, setSubjectToBalloonYears] = useState(5);
  const [subjectToBalloonYearsDraft, setSubjectToBalloonYearsDraft] = useState("5");
  const [subjectToBalloonHas70LtvContingency, setSubjectToBalloonHas70LtvContingency] = useState(true);

  const [sellerFinancingBalloonExists, setSellerFinancingBalloonExists] = useState(false);
  const [sellerFinancingBalloonYears, setSellerFinancingBalloonYears] = useState(5);
  const [sellerFinancingBalloonYearsDraft, setSellerFinancingBalloonYearsDraft] = useState("5");
  const [sellerFinancingBalloonHas70LtvContingency, setSellerFinancingBalloonHas70LtvContingency] =
    useState(true);

  const [hybridBalloonExists, setHybridBalloonExists] = useState(false);
  const [hybridBalloonYears, setHybridBalloonYears] = useState(5);
  const [hybridBalloonYearsDraft, setHybridBalloonYearsDraft] = useState("5");
  const [hybridBalloonHas70LtvContingency, setHybridBalloonHas70LtvContingency] = useState(true);

  // 30-Year ROI Projection -- Refinance at Balloon: only meaningful for
  // the four structures that can have a balloon (never Traditional
  // Financing, which has no balloon feature at all). Defaults to
  // Yes/true per spec. The refinance interest rate follows the same
  // "suggested unless manually overridden" pattern already used for
  // Hybrid's Seller-Financed Balance above: null while it is still
  // following the suggested rate (that structure's own first-position
  // interest rate), a number once a visitor types their own rate in.
  const [subjectToRefinanceAtBalloon, setSubjectToRefinanceAtBalloon] = useState(true);
  const [subjectToRefinanceRateOverride, setSubjectToRefinanceRateOverride] = useState<number | null>(null);
  const [subjectToRefinanceRateDraft, setSubjectToRefinanceRateDraft] = useState("");

  const [sellerFinancingRefinanceAtBalloon, setSellerFinancingRefinanceAtBalloon] = useState(true);
  const [sellerFinancingRefinanceRateOverride, setSellerFinancingRefinanceRateOverride] = useState<number | null>(
    null
  );
  const [sellerFinancingRefinanceRateDraft, setSellerFinancingRefinanceRateDraft] = useState("");

  const [hybridRefinanceAtBalloon, setHybridRefinanceAtBalloon] = useState(true);
  const [hybridRefinanceRateOverride, setHybridRefinanceRateOverride] = useState<number | null>(null);
  const [hybridRefinanceRateDraft, setHybridRefinanceRateDraft] = useState("");

  const [stackRefinanceAtBalloon, setStackRefinanceAtBalloon] = useState(true);
  const [stackRefinanceRateOverride, setStackRefinanceRateOverride] = useState<number | null>(null);
  const [stackRefinanceRateDraft, setStackRefinanceRateDraft] = useState("");

  // Suggested Replacement Interest Rate: each structure's own current
  // underlying first-position interest rate, per spec ("default the
  // refinance interest rate to the current underlying first-position
  // interest rate where practical"). Seller Financing has its own fully
  // independent Interest Rate field (percent.sellerFinancingInterestRatePct),
  // separate from Subject To's percent.loanInterestRatePct.
  const subjectToSuggestedRefinanceRate = percent.loanInterestRatePct;
  const sellerFinancingSuggestedRefinanceRate = percent.sellerFinancingInterestRatePct;
  const hybridSuggestedRefinanceRate = percent.hybridExistingMortgageRatePct;
  const stackSuggestedRefinanceRate = percent.stackBankInterestRatePct;

  const subjectToRefinanceRateIsManual = subjectToRefinanceRateOverride !== null;
  const subjectToRefinanceRateUsed = subjectToRefinanceRateIsManual
    ? subjectToRefinanceRateOverride!
    : subjectToSuggestedRefinanceRate;
  const sellerFinancingRefinanceRateIsManual = sellerFinancingRefinanceRateOverride !== null;
  const sellerFinancingRefinanceRateUsed = sellerFinancingRefinanceRateIsManual
    ? sellerFinancingRefinanceRateOverride!
    : sellerFinancingSuggestedRefinanceRate;
  const hybridRefinanceRateIsManual = hybridRefinanceRateOverride !== null;
  const hybridRefinanceRateUsed = hybridRefinanceRateIsManual ? hybridRefinanceRateOverride! : hybridSuggestedRefinanceRate;
  const stackRefinanceRateIsManual = stackRefinanceRateOverride !== null;
  const stackRefinanceRateUsed = stackRefinanceRateIsManual ? stackRefinanceRateOverride! : stackSuggestedRefinanceRate;

  // Keeps each Replacement Interest Rate field showing (and using) the
  // live suggested first-position rate as long as it hasn't been
  // manually overridden, exactly like Hybrid's Seller-Financed Balance
  // above.
  useEffect(() => {
    if (!subjectToRefinanceRateIsManual) setSubjectToRefinanceRateDraft(subjectToSuggestedRefinanceRate.toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectToSuggestedRefinanceRate, subjectToRefinanceRateIsManual]);
  useEffect(() => {
    if (!sellerFinancingRefinanceRateIsManual)
      setSellerFinancingRefinanceRateDraft(sellerFinancingSuggestedRefinanceRate.toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellerFinancingSuggestedRefinanceRate, sellerFinancingRefinanceRateIsManual]);
  useEffect(() => {
    if (!hybridRefinanceRateIsManual) setHybridRefinanceRateDraft(hybridSuggestedRefinanceRate.toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hybridSuggestedRefinanceRate, hybridRefinanceRateIsManual]);
  useEffect(() => {
    if (!stackRefinanceRateIsManual) setStackRefinanceRateDraft(stackSuggestedRefinanceRate.toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stackSuggestedRefinanceRate, stackRefinanceRateIsManual]);

  // Shared change/blur/reset handlers for a Replacement Interest Rate
  // field, following the exact same "typing marks it as an override
  // immediately, blur rounds and reformats it" pattern as Hybrid's
  // Seller-Financed Balance above.
  function makeRefinanceRateHandlers(
    setOverride: React.Dispatch<React.SetStateAction<number | null>>,
    setDraft: React.Dispatch<React.SetStateAction<string>>,
    suggested: number
  ) {
    return {
      onChange: (raw: string) => {
        setDraft(raw);
        setOverride(parseTypedPercent(raw));
      },
      onBlur: () => {
        setOverride((prev) => {
          const clamped = prev === null ? suggested : prev;
          setDraft(clamped.toFixed(2));
          return clamped;
        });
      },
      reset: () => {
        setOverride(null);
        setDraft(suggested.toFixed(2));
      },
    };
  }

  const subjectToRefinanceRateHandlers = makeRefinanceRateHandlers(
    setSubjectToRefinanceRateOverride,
    setSubjectToRefinanceRateDraft,
    subjectToSuggestedRefinanceRate
  );
  const sellerFinancingRefinanceRateHandlers = makeRefinanceRateHandlers(
    setSellerFinancingRefinanceRateOverride,
    setSellerFinancingRefinanceRateDraft,
    sellerFinancingSuggestedRefinanceRate
  );
  const hybridRefinanceRateHandlers = makeRefinanceRateHandlers(
    setHybridRefinanceRateOverride,
    setHybridRefinanceRateDraft,
    hybridSuggestedRefinanceRate
  );
  const stackRefinanceRateHandlers = makeRefinanceRateHandlers(
    setStackRefinanceRateOverride,
    setStackRefinanceRateDraft,
    stackSuggestedRefinanceRate
  );

  // Expand/collapse state for the on-page "30-Year ROI Projection"
  // section, one per financing structure so switching structures never
  // carries the expanded state over from a different one.
  const [roiProjectionOpen, setRoiProjectionOpen] = useState(false);

  // Subject To and Seller Financing already share the same underlying
  // loan-balance/monthly-payment fields (see the FinancingKey block
  // above and the shared input section below); they now also share
  // these two fields, used by the amortization schedule, Balloon
  // Refinance Analysis, and 30-Year ROI Projection to project that same
  // loan's remaining balance over time via its true amortization
  // schedule. Never used for the existing PITI/operating-expense math,
  // which continues to read only financing.monthlyPayment exactly as
  // before.
  //
  // Both null (blank) by default -- the remaining term on an existing,
  // assumed loan is very often simply not known, and this calculator
  // must never silently assume a specific term (e.g. 30 years) on the
  // person's behalf. If left blank, resolveEffectiveAmortizationTerm
  // (see subjectToEffectiveAmortization below) falls back to
  // mathematically estimating the term from loanKnownMonthlyPIPayment
  // when that is entered, and otherwise the amortization schedule/
  // balloon projection/ROI paydown for this leg simply is not shown,
  // without blocking the rest of the underwriting calculation.
  const [loanRemainingAmortizationYears, setLoanRemainingAmortizationYears] = useState<number | null>(
    null
  );
  const [loanRemainingAmortizationYearsDraft, setLoanRemainingAmortizationYearsDraft] = useState("");
  // The loan's actual monthly principal-and-interest payment (never
  // PITI), entered only when the remaining term itself is not known --
  // used solely to solve for that remaining term mathematically. Kept
  // completely separate from financing.monthlyPayment (which may be a
  // PITI figure and drives the real PITI/operating-expense math) so
  // this estimate can never be contaminated by taxes or insurance.
  const [loanKnownMonthlyPIPayment, setLoanKnownMonthlyPIPayment] = useState<number | null>(null);
  const [loanKnownMonthlyPIPaymentDraft, setLoanKnownMonthlyPIPaymentDraft] = useState("");

  // Hybrid's existing subject-to first mortgage has the same gap: only
  // a monthly PITI payment is collected (financing.hybridSubjectToPITI),
  // never a rate or remaining term, so this pair (plus the known-payment
  // pair below) exists to project that mortgage's remaining balance over
  // time. Same blank-by-default, never-assume-30-years rule as above.
  const [hybridExistingMortgageAmortizationYears, setHybridExistingMortgageAmortizationYears] = useState<
    number | null
  >(null);
  const [
    hybridExistingMortgageAmortizationYearsDraft,
    setHybridExistingMortgageAmortizationYearsDraft,
  ] = useState("");
  const [hybridExistingMortgageKnownMonthlyPIPayment, setHybridExistingMortgageKnownMonthlyPIPayment] =
    useState<number | null>(null);
  const [
    hybridExistingMortgageKnownMonthlyPIPaymentDraft,
    setHybridExistingMortgageKnownMonthlyPIPaymentDraft,
  ] = useState("");

  // The single resolved answer for "how many months are left on this
  // loan" that every Subject To / Seller Financing consumer (the
  // on-page/print amortization schedule, Balloon Refinance Analysis,
  // 30-Year ROI Projection, and Excel export) reads instead of each
  // reimplementing its own fallback -- see resolveEffectiveAmortizationTerm
  // in lib/amortization.ts for the exact precedence (entered term wins;
  // otherwise estimate from the known payment; otherwise null).
  const subjectToEffectiveAmortization: EffectiveAmortizationTerm = useMemo(
    () =>
      resolveEffectiveAmortizationTerm(
        financing.loanBalance,
        percent.loanInterestRatePct,
        loanRemainingAmortizationYears,
        loanKnownMonthlyPIPayment
      ),
    [financing.loanBalance, percent.loanInterestRatePct, loanRemainingAmortizationYears, loanKnownMonthlyPIPayment]
  );

  // Same resolution, independently, for Hybrid's existing mortgage leg.
  const hybridExistingMortgageEffectiveAmortization: EffectiveAmortizationTerm = useMemo(
    () =>
      resolveEffectiveAmortizationTerm(
        financing.hybridExistingMortgageBalance,
        percent.hybridExistingMortgageRatePct,
        hybridExistingMortgageAmortizationYears,
        hybridExistingMortgageKnownMonthlyPIPayment
      ),
    [
      financing.hybridExistingMortgageBalance,
      percent.hybridExistingMortgageRatePct,
      hybridExistingMortgageAmortizationYears,
      hybridExistingMortgageKnownMonthlyPIPayment,
    ]
  );

  // ---------------------------------------------------------------------
  // Seller Financing: fully independent from Subject To's shared loan
  // fields above. Seller Financing always represents a brand-new loan
  // (never an existing one), so it gets its own Down Payment Percentage /
  // Dollar Amount pair (synchronized, with a "last edited" tracker so
  // editing either field never fights the other or loops -- see the
  // resolved memos below), its own Loan Balance (automatically
  // calculated as Purchase Price - Down Payment, with a manual-override
  // escape hatch identical in spirit to Property Taxes Used in
  // Underwriting above), its own Interest Rate, a required Amortization
  // Term (never optional, unlike Subject To's Remaining Amortization
  // Years, since this is a brand-new loan, not an existing mortgage with
  // an unknown remaining term), and an automatically calculated,
  // read-only Monthly Principal & Interest -- never PITI, since Seller
  // Financing never bundles taxes/insurance into the loan payment itself
  // (Annual Property Taxes and Annual Property Insurance stay separate,
  // shared fields, added to Total Monthly Housing Payment exactly once).
  // ---------------------------------------------------------------------
  const [sellerFinancingDownPaymentPct, setSellerFinancingDownPaymentPct] = useState(10);
  const [sellerFinancingDownPaymentPctDraft, setSellerFinancingDownPaymentPctDraft] = useState("10.00");
  const [sellerFinancingDownPaymentAmount, setSellerFinancingDownPaymentAmount] = useState(0);
  const [sellerFinancingDownPaymentAmountDraft, setSellerFinancingDownPaymentAmountDraft] = useState(
    formatCents(0)
  );
  // "pct" (the default) means Down Payment Percentage is the controlling
  // input and Down Payment Dollar Amount follows it; "amount" means the
  // opposite. Whichever field the visitor typed into most recently wins,
  // and a Purchase Price change always recalculates whichever field is
  // NOT the current source of truth -- never both, never a loop.
  const [sellerFinancingDownPaymentLastEdited, setSellerFinancingDownPaymentLastEdited] = useState<
    "pct" | "amount"
  >("pct");

  // null while Seller-Finance Loan Balance is following the automatic
  // calculation (Purchase Price - Down Payment Dollar Amount); a number
  // once the visitor types directly into that field, exactly like
  // Holding Costs / Hybrid Seller-Financed Balance above.
  const [sellerFinancingLoanBalanceOverride, setSellerFinancingLoanBalanceOverride] = useState<
    number | null
  >(null);
  const [sellerFinancingLoanBalanceDraft, setSellerFinancingLoanBalanceDraft] = useState(formatCents(0));

  const [sellerFinancingAmortizationYears, setSellerFinancingAmortizationYears] = useState(30);
  const [sellerFinancingAmortizationYearsDraft, setSellerFinancingAmortizationYearsDraft] = useState("30");

  // Down Payment Dollar Amount: derived from Purchase Price x Down
  // Payment Percentage unless the dollar field itself is the currently
  // controlling input (see sellerFinancingDownPaymentLastEdited above).
  const sellerFinancingDownPaymentAmountResolved = useMemo(() => {
    if (sellerFinancingDownPaymentLastEdited === "amount") return sellerFinancingDownPaymentAmount;
    return round2(Math.max(0, financing.purchasePrice) * (sellerFinancingDownPaymentPct / 100));
  }, [
    sellerFinancingDownPaymentLastEdited,
    sellerFinancingDownPaymentAmount,
    sellerFinancingDownPaymentPct,
    financing.purchasePrice,
  ]);

  // Down Payment Percentage: derived from Down Payment Dollar Amount /
  // Purchase Price unless the percentage field itself is the currently
  // controlling input. A blank/zero Purchase Price leaves the percentage
  // at whatever was last entered rather than dividing by zero.
  const sellerFinancingDownPaymentPctResolved = useMemo(() => {
    if (sellerFinancingDownPaymentLastEdited === "pct") return sellerFinancingDownPaymentPct;
    if (financing.purchasePrice <= 0) return sellerFinancingDownPaymentPct;
    return (sellerFinancingDownPaymentAmount / financing.purchasePrice) * 100;
  }, [
    sellerFinancingDownPaymentLastEdited,
    sellerFinancingDownPaymentAmount,
    sellerFinancingDownPaymentPct,
    financing.purchasePrice,
  ]);

  // Keeps each non-controlling field's displayed draft synced to its
  // resolved value, exactly like every other "suggested unless
  // overridden" field pattern in this calculator (e.g. Hybrid's
  // Seller-Financed Balance above).
  useEffect(() => {
    if (sellerFinancingDownPaymentLastEdited !== "pct") {
      setSellerFinancingDownPaymentPctDraft(sellerFinancingDownPaymentPctResolved.toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellerFinancingDownPaymentPctResolved, sellerFinancingDownPaymentLastEdited]);
  useEffect(() => {
    if (sellerFinancingDownPaymentLastEdited !== "amount") {
      setSellerFinancingDownPaymentAmountDraft(formatCents(sellerFinancingDownPaymentAmountResolved));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellerFinancingDownPaymentAmountResolved, sellerFinancingDownPaymentLastEdited]);

  // Seller-Finance Loan Balance = Purchase Price - Down Payment Dollar
  // Amount, never negative.
  const sellerFinancingCalculatedLoanBalance = useMemo(
    () => Math.max(0, round2(financing.purchasePrice - sellerFinancingDownPaymentAmountResolved)),
    [financing.purchasePrice, sellerFinancingDownPaymentAmountResolved]
  );
  const sellerFinancingLoanBalanceIsManual = sellerFinancingLoanBalanceOverride !== null;
  const sellerFinancingLoanBalanceUsed = sellerFinancingLoanBalanceIsManual
    ? sellerFinancingLoanBalanceOverride!
    : sellerFinancingCalculatedLoanBalance;

  // Keeps the Seller-Finance Loan Balance field showing (and using) the
  // live automatic calculation as long as it hasn't been manually
  // overridden, exactly like Holding Costs / Hybrid Seller-Financed
  // Balance above.
  useEffect(() => {
    if (!sellerFinancingLoanBalanceIsManual) {
      setSellerFinancingLoanBalanceDraft(formatCents(sellerFinancingCalculatedLoanBalance));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellerFinancingCalculatedLoanBalance, sellerFinancingLoanBalanceIsManual]);

  // Monthly Principal & Interest: the standard fixed-rate amortizing-loan
  // payment (0% interest reduces to straight-line division -- see
  // calculateMonthlyPaymentForTerm in lib/amortization.ts), calculated
  // from the actual loan balance in use (calculated or manually
  // overridden), the entered Seller Financing Interest Rate, and the
  // required Amortization Term -- never manually entered, and never a
  // PITI figure.
  const sellerFinancingMonthlyPI = useMemo(
    () =>
      round2(
        calculateMonthlyPaymentForTerm(
          sellerFinancingLoanBalanceUsed,
          percent.sellerFinancingInterestRatePct,
          Math.max(1, Math.round(sellerFinancingAmortizationYears * 12))
        )
      ),
    [sellerFinancingLoanBalanceUsed, percent.sellerFinancingInterestRatePct, sellerFinancingAmortizationYears]
  );

  // The full month-by-month amortization schedule for the seller-financed
  // loan, using the actual loan balance in use, its interest rate, and
  // its required amortization term -- principal and interest only, never
  // taxes or insurance.
  const sellerFinancingAmortization = useMemo(
    () =>
      buildAmortizationScheduleForTerm(
        sellerFinancingLoanBalanceUsed,
        percent.sellerFinancingInterestRatePct,
        Math.max(1, Math.round(sellerFinancingAmortizationYears * 12))
      ),
    [sellerFinancingLoanBalanceUsed, percent.sellerFinancingInterestRatePct, sellerFinancingAmortizationYears]
  );

  const [sharedBathBedrooms, setSharedBathBedrooms] = useState(BEDROOM_DEFAULTS.sharedBathBedrooms);
  const [sharedBathBedroomsDraft, setSharedBathBedroomsDraft] = useState(
    String(BEDROOM_DEFAULTS.sharedBathBedrooms)
  );
  const [weeklySharedBathRent, setWeeklySharedBathRent] = useState(
    BEDROOM_DEFAULTS.weeklySharedBathRent
  );
  const [weeklySharedBathRentDraft, setWeeklySharedBathRentDraft] = useState(
    formatCents(BEDROOM_DEFAULTS.weeklySharedBathRent)
  );
  const [ensuiteBedrooms, setEnsuiteBedrooms] = useState(BEDROOM_DEFAULTS.ensuiteBedrooms);
  const [ensuiteBedroomsDraft, setEnsuiteBedroomsDraft] = useState(
    String(BEDROOM_DEFAULTS.ensuiteBedrooms)
  );
  const [weeklyEnsuiteRent, setWeeklyEnsuiteRent] = useState(BEDROOM_DEFAULTS.weeklyEnsuiteRent);
  const [weeklyEnsuiteRentDraft, setWeeklyEnsuiteRentDraft] = useState(
    formatCents(BEDROOM_DEFAULTS.weeklyEnsuiteRent)
  );

  // Cleaning, Lawn Care, and Pest Control: three separate, fully
  // editable monthly expenses (each with its own default), following
  // the same keyed draft-string + parsed-number pattern used for
  // capital and financing fields elsewhere in this calculator.
  const [maintenanceExpenses, setMaintenanceExpenses] = useState<Record<MaintenanceExpenseKey, number>>(
    MAINTENANCE_EXPENSE_DEFAULTS
  );
  const [maintenanceExpensesDraft, setMaintenanceExpensesDraft] = useState<
    Record<MaintenanceExpenseKey, string>
  >(makeDraft(MAINTENANCE_EXPENSE_DEFAULTS));
  // Whether each of the three fields is still following the automatic
  // state-based default (true) or has been hand-edited by the user
  // (false). All three start out auto-defaulted; editing a specific
  // field flips only that field's flag to false (handleMaintenance
  // ExpenseChange below), so the other two keep auto-updating. The
  // effect a few hundred lines down (keyed on addressStateAbbreviation)
  // only ever touches fields where this is still true, and
  // applyStateDefaultsToMaintenanceExpenses() (the "Use State Defaults"
  // button) sets all three back to true at once.
  const [maintenanceExpenseIsAutoDefaulted, setMaintenanceExpenseIsAutoDefaulted] = useState<
    Record<MaintenanceExpenseKey, boolean>
  >({ cleaning: true, lawnCare: true, pestControl: true });

  // Holding Costs: initially and automatically calculated (3 months of
  // the complete monthly housing payment), but the field stays editable.
  // `holdingCostsOverride` is null while the field is following the
  // automatic calculation, and becomes a number the moment a visitor
  // types into it, at which point that manually entered value is used
  // everywhere (Total Capital Required, the breakdown, CSV, and print)
  // instead of the calculated amount, until "Reset to Calculated Amount"
  // is clicked or the whole calculator is reset to defaults.
  const [holdingCostsOverride, setHoldingCostsOverride] = useState<number | null>(null);
  const [holdingCostsDraft, setHoldingCostsDraft] = useState(formatCents(0));

  const [breakdownOpen, setBreakdownOpen] = useState(false);

  // Excel export: true only while the workbook (template fetch, for
  // Subject To/Hybrid, plus population/serialization) is being built, so
  // the "Export to Excel" button can show its own brief loading state
  // and never be double-clicked into two overlapping downloads.
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [exportExcelError, setExportExcelError] = useState("");

  // Property Address and Property Images stay local to the current
  // browser session: plain in-memory state only, never written to
  // localStorage/sessionStorage, never uploaded anywhere, and cleared on
  // refresh or Reset to Defaults.
  const [propertyAddress, setPropertyAddress] = useState("");

  // Transit and Bus Stop Access: single, financing-mode-independent state
  // block (Property Address itself is not duplicated per structure, so
  // neither is this). Fully automatic -- as soon as the Property
  // Address looks complete, the effect below fills these fields in from
  // Google Maps. Every field stays editable by hand at any time, and
  // whatever is currently in them is used immediately: there is no
  // separate save or verification step, and no committed snapshot
  // distinct from these live fields.
  const [transitNearestStopDraft, setTransitNearestStopDraft] = useState("");
  const [transitWalkingTimeDraft, setTransitWalkingTimeDraft] = useState("");
  const [transitWalkingDistanceDraft, setTransitWalkingDistanceDraft] = useState("");
  const [transitNotes, setTransitNotes] = useState("");

  // The current transit result, derived directly from the fields above
  // -- null once all of them are empty, so the summary strip, print
  // report, and Excel export can skip the section entirely rather than
  // showing an all-blank card.
  const transitResult: TransitResult | null = useMemo(() => {
    const nearestStop = transitNearestStopDraft.trim();
    const notes = transitNotes.trim();
    const parsedTime = transitWalkingTimeDraft.trim() === "" ? null : Number(transitWalkingTimeDraft);
    const parsedDistance = transitWalkingDistanceDraft.trim() === "" ? null : Number(transitWalkingDistanceDraft);
    const walkingTimeMinutes = parsedTime !== null && Number.isFinite(parsedTime) ? parsedTime : null;
    const walkingDistanceMiles = parsedDistance !== null && Number.isFinite(parsedDistance) ? parsedDistance : null;
    if (!nearestStop && !notes && walkingTimeMinutes === null && walkingDistanceMiles === null) return null;
    return { nearestStop, walkingTimeMinutes, walkingDistanceMiles, notes };
  }, [transitNearestStopDraft, transitWalkingTimeDraft, transitWalkingDistanceDraft, transitNotes]);

  // Automatic bus-stop lookup (Places + Directions "walking" route,
  // server-side via app/api/transit/auto-lookup -- see lib/transit/
  // googleLookup.ts). Runs once per distinct, complete-looking Property
  // Address and writes straight into the fields above. The per-address
  // ref below is what keeps this from re-firing (and clobbering any
  // hand edits) on every render for an address it has already looked
  // up; a genuine address change clears the ref and triggers a fresh
  // lookup for the new property.
  const [transitAutoStatus, setTransitAutoStatus] = useState<TransitAutoStatus>("idle");
  const [transitAutoStopCoords, setTransitAutoStopCoords] = useState<{ lat: number; lng: number } | null>(null);
  // Everything the printable report's static transit map needs, kept
  // separate from transitAutoStopCoords (which only feeds the live
  // directions iframe): the property's own coordinates, the winning
  // stop's coordinates, and the encoded walking-route polyline from
  // that same Directions API response. Captured once when the
  // automatic lookup succeeds and never recomputed at print time, so
  // the printed map always matches "the most recently completed
  // transit lookup" shown on the live page -- never a different route
  // or a different bus stop.
  const [transitPrintMapData, setTransitPrintMapData] = useState<{
    propertyLat: number;
    propertyLng: number;
    stopLat: number;
    stopLng: number;
    polyline: string | null;
  } | null>(null);
  const transitAutoLookupAddressRef = useRef("");

  useEffect(() => {
    const trimmed = propertyAddress.trim();

    if (!looksLikeCompleteAddress(trimmed)) {
      transitAutoLookupAddressRef.current = "";
      setTransitAutoStopCoords(null);
      setTransitPrintMapData(null);
      setTransitAutoStatus("idle");
      return;
    }

    // Already ran (or attempted) a lookup for this exact address --
    // avoid re-firing on every render/keystroke once it has settled,
    // and avoid clobbering any edits the person has since made.
    if (transitAutoLookupAddressRef.current === trimmed) {
      return;
    }
    transitAutoLookupAddressRef.current = trimmed;
    // Fall back to the plain search-mode map immediately so a route
    // drawn for the previous address never lingers while a new lookup
    // is in flight for this one, and clear the previous property's
    // Nearest Bus Stop / Walking Time / Walking Distance right away too
    // (rather than leaving them on screen until the new lookup
    // resolves) -- most noticeable right after picking a new address
    // from the autocomplete dropdown. Transit Notes is left alone since
    // it is hand-written commentary, not an automatic lookup result.
    setTransitAutoStopCoords(null);
    setTransitPrintMapData(null);
    setTransitNearestStopDraft("");
    setTransitWalkingTimeDraft("");
    setTransitWalkingDistanceDraft("");

    let cancelled = false;
    setTransitAutoStatus("loading");

    const timer = setTimeout(() => {
      fetch("/api/transit/auto-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: trimmed }),
      })
        .then((res) => res.json() as Promise<AutoTransitLookupResult>)
        .then((data) => {
          if (cancelled) return;
          if (data.status === "found") {
            setTransitNearestStopDraft(data.nearestStop.name);
            setTransitWalkingTimeDraft(String(data.walkingTimeMinutes));
            setTransitWalkingDistanceDraft(data.walkingDistanceMiles.toFixed(2));
            setTransitAutoStopCoords({ lat: data.nearestStop.latitude, lng: data.nearestStop.longitude });
            setTransitPrintMapData({
              propertyLat: data.propertyLatitude,
              propertyLng: data.propertyLongitude,
              stopLat: data.nearestStop.latitude,
              stopLng: data.nearestStop.longitude,
              polyline: data.routePolyline,
            });
            setTransitAutoStatus("found");
          } else if (data.status === "notFound") {
            setTransitAutoStatus("notFound");
          } else if (data.status === "error" && data.reason === "not_configured") {
            setTransitAutoStatus("notConfigured");
          } else {
            setTransitAutoStatus("error");
          }
        })
        .catch(() => {
          if (!cancelled) setTransitAutoStatus("error");
        });
    }, 700);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [propertyAddress]);

  // Automatic County suggestion (Geocoding API's administrative_area_
  // level_2 component, server-side via app/api/property-tax/
  // county-lookup -- see lib/propertyTax/countyLookup.ts). Runs on the
  // same trigger as the transit auto-lookup above (a complete-looking
  // Property Address, short-debounced, refiring whenever the address
  // genuinely changes), but is intentionally a separate effect/ref pair
  // so a county-lookup failure can never affect the transit lookup or
  // vice versa. The result is only ever offered as a suggestion here --
  // it never writes into propertyTaxCounty itself, so a manual
  // selection (or a manual override of an earlier accepted suggestion)
  // is never silently overwritten. See acceptSuggestedCounty() below for
  // the one place that does write it, on explicit user action.
  const [countyAutoStatus, setCountyAutoStatus] = useState<
    "idle" | "loading" | "found" | "notFound" | "notConfigured" | "error"
  >("idle");
  // Raw suggestion in "<County Name>, <ST>" form (matching
  // COUNTY_EFFECTIVE_TAX_RATES' key format) so it can be looked up
  // directly against the supported rate table; null whenever there is
  // no current suggestion to show.
  const [countySuggestion, setCountySuggestion] = useState<string | null>(null);
  const countyAutoLookupAddressRef = useRef("");

  // The state abbreviation (administrative_area_level_1 short_name)
  // from the same geocoding lookup used for the County suggestion above
  // -- reused here rather than geocoding a second time -- drives the
  // state-based Cleaning/Lawn Care/Pest Control defaults below. Set
  // whenever the lookup returns a state, even on an otherwise
  // "notFound" county outcome (some addresses only resolve to
  // state-level accuracy); cleared on every other outcome (no result,
  // not configured, or a request/geocode failure) so the fields fall
  // back to the "all other states" defaults rather than keeping a stale
  // state from a previous address.
  const [addressStateAbbreviation, setAddressStateAbbreviation] = useState<string | null>(null);

  function runCountyLookup(address: string) {
    setCountyAutoStatus("loading");
    return fetch("/api/property-tax/county-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    })
      .then((res) => res.json() as Promise<CountyLookupResult>)
      .then((data) => {
        if (data.status === "found") {
          const suggestion = data.stateAbbreviation ? `${data.county}, ${data.stateAbbreviation}` : data.county;
          setCountySuggestion(suggestion);
          setCountyAutoStatus("found");
          setAddressStateAbbreviation(data.stateAbbreviation || null);
        } else if (data.status === "notFound") {
          setCountySuggestion(null);
          setCountyAutoStatus("notFound");
          setAddressStateAbbreviation(data.stateAbbreviation || null);
        } else if (data.status === "error" && data.reason === "not_configured") {
          setCountySuggestion(null);
          setCountyAutoStatus("notConfigured");
          setAddressStateAbbreviation(null);
        } else {
          setCountySuggestion(null);
          setCountyAutoStatus("error");
          setAddressStateAbbreviation(null);
        }
      })
      .catch(() => {
        setCountySuggestion(null);
        setCountyAutoStatus("error");
        setAddressStateAbbreviation(null);
      });
  }

  useEffect(() => {
    const trimmed = propertyAddress.trim();

    if (!looksLikeCompleteAddress(trimmed)) {
      countyAutoLookupAddressRef.current = "";
      setCountySuggestion(null);
      setCountyAutoStatus("idle");
      return;
    }

    // Already ran (or attempted) a lookup for this exact address --
    // avoid re-firing on every render/keystroke once it has settled.
    // Unlike the transit lookup, a settled county suggestion is left on
    // screen rather than cleared while a new one is in flight, since it
    // is purely a passive suggestion (never auto-applied) and clearing
    // it would just flicker the "Use Suggested County" control for no
    // benefit.
    if (countyAutoLookupAddressRef.current === trimmed) {
      return;
    }
    countyAutoLookupAddressRef.current = trimmed;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) runCountyLookup(trimmed);
    }, 700);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyAddress]);

  // Retry control for a failed/inconclusive lookup (spec: "a small retry
  // or refresh control, if the initial lookup fails"). Re-runs
  // immediately, bypassing the debounce and the already-attempted ref
  // check, since this is an explicit user action, not an automatic
  // re-fire.
  function retryCountyLookup() {
    const trimmed = propertyAddress.trim();
    if (!looksLikeCompleteAddress(trimmed)) return;
    countyAutoLookupAddressRef.current = trimmed;
    void runCountyLookup(trimmed);
  }

  // Keeps Cleaning/Lawn Care/Pest Control in sync with the state
  // identified from the property address (lib/operatingExpenseDefaults.
  // ts), for every field that is still following its automatic default.
  // Fires whenever addressStateAbbreviation changes -- i.e. whenever a
  // new address is selected from autocomplete, a valid address is
  // geocoded, or the detected state otherwise changes (all of which
  // already update addressStateAbbreviation via the county lookup
  // above, so no separate address-change wiring is needed here). A
  // manually edited field is left untouched: only keys where
  // maintenanceExpenseIsAutoDefaulted[key] is still true are updated.
  useEffect(() => {
    const defaults = getOperatingDefaultsForState(addressStateAbbreviation);
    const keys = Object.keys(defaults) as MaintenanceExpenseKey[];

    setMaintenanceExpenses((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of keys) {
        if (maintenanceExpenseIsAutoDefaulted[key] && next[key] !== defaults[key]) {
          next[key] = defaults[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setMaintenanceExpensesDraft((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of keys) {
        if (maintenanceExpenseIsAutoDefaulted[key]) {
          const formatted = formatCents(defaults[key]);
          if (next[key] !== formatted) {
            next[key] = formatted;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [addressStateAbbreviation, maintenanceExpenseIsAutoDefaulted]);

  // Whether the current suggestion matches one of the counties this
  // calculator actually has a stored tax rate for -- "Use Suggested
  // County" only ever writes a value the County dropdown can display and
  // that immediately populates a real rate; a suggestion outside the
  // supported list is still shown (per spec: identify the county from
  // geocoding, not a static list), just without a one-click apply.
  const countySuggestionInTable = countySuggestion !== null && COUNTY_EFFECTIVE_TAX_RATES[countySuggestion] !== undefined;

  // Only worth showing "Use Suggested County" when it would actually
  // change something.
  const countySuggestionDiffersFromCurrent = countySuggestion !== null && countySuggestion !== propertyTaxCounty;

  function acceptSuggestedCounty() {
    if (!countySuggestion || !countySuggestionInTable) return;
    handlePropertyTaxCountyChange(countySuggestion);
    setCountyIsAutoIdentified(true);
  }

  const [propertyImages, setPropertyImages] = useState<PropertyImage[]>([]);
  const [imageError, setImageError] = useState("");
  const [processingImages, setProcessingImages] = useState(false);
  // Tracks whether a drag is currently over the property photo drop
  // zone, purely for the highlighted border/background treatment below
  // -- it never affects which files are actually accepted (that is
  // still handleAddImageFiles's job, reused identically for both
  // click-to-upload and drag-and-drop).
  const [isDraggingPhotos, setIsDraggingPhotos] = useState(false);
  // Refs to each upload area's hidden file input, used only so the
  // drop zone can be operated from the keyboard: focusing the drop
  // zone and pressing Enter or Space opens the same native file picker
  // that clicking the tile would.
  const propertyFilesInputRef = useRef<HTMLInputElement>(null);
  const [videoWalkthroughLink, setVideoWalkthroughLink] = useState("");
  const [floorPlan, setFloorPlan] = useState<FloorPlanFile | null>(null);
  const [floorPlanError, setFloorPlanError] = useState("");
  const [processingFloorPlan, setProcessingFloorPlan] = useState(false);
  const [isDraggingFloorPlan, setIsDraggingFloorPlan] = useState(false);
  const floorPlanInputRef = useRef<HTMLInputElement>(null);
  // PadSplit Rental Data Screenshot: a single optional supporting image
  // (comparable PadSplit rental data or room-rate research), processed
  // and stored exactly like the Floor Plan above -- entirely
  // client-side, never automatically read or used in any calculation.
  // Shared across every financing structure (not tied to financingMode)
  // so it never disappears when the selected structure changes.
  const [padSplitScreenshot, setPadSplitScreenshot] = useState<FloorPlanFile | null>(null);
  const [padSplitScreenshotError, setPadSplitScreenshotError] = useState("");
  const [processingPadSplitScreenshot, setProcessingPadSplitScreenshot] = useState(false);
  const [isDraggingPadSplit, setIsDraggingPadSplit] = useState(false);
  const padSplitInputRef = useRef<HTMLInputElement>(null);
  // Financing Structure is a single-select choice among four mutually
  // exclusive modes, each with its own inputs and calculations: only one
  // may ever be active. "" means no structure has been selected yet
  // (the "Not Specified" state). Subject To and Seller Financing can no
  // longer be selected together independently -- a transaction that
  // combines both uses the dedicated Hybrid option instead, which has
  // its own dedicated inputs (see the Hybrid section further down).
  const [financingMode, setFinancingMode] = useState<FinancingMode>("");

  // Seller Financing input validation: every message below is checked
  // against the actual resolved/used values (never the raw draft
  // strings), so it reflects exactly what the calculations downstream
  // will use. Showing a clear message here -- rather than silently
  // clamping or defaulting -- is what keeps the loan balance, amortization
  // schedule, and Excel export from ever producing NaN, Infinity, a
  // negative balance, or a broken schedule.
  const sellerFinancingValidationErrors = useMemo(() => {
    const errors: string[] = [];
    if (financingMode !== "sellerFinancing") return errors;

    const purchasePrice = financing.purchasePrice;
    const downPaymentAmount = sellerFinancingDownPaymentAmountResolved;
    const downPaymentPct = sellerFinancingDownPaymentPctResolved;

    if (
      sellerFinancingDownPaymentLastEdited === "amount" &&
      purchasePrice <= 0 &&
      sellerFinancingDownPaymentAmount > 0
    ) {
      errors.push("Enter a Purchase Price before Down Payment Percentage can be calculated from the dollar amount.");
    }
    if (downPaymentAmount < 0) {
      errors.push("Down payment cannot be negative.");
    }
    if (downPaymentPct < 0) {
      errors.push("Down payment percentage cannot be negative.");
    }
    if (downPaymentPct > 100) {
      errors.push("Down payment percentage cannot exceed 100%.");
    }
    if (purchasePrice > 0 && downPaymentAmount > purchasePrice) {
      errors.push("Down payment cannot exceed the purchase price.");
    }
    if (sellerFinancingLoanBalanceIsManual && (sellerFinancingLoanBalanceOverride as number) < 0) {
      errors.push("Seller-Finance Loan Balance cannot be negative.");
    }
    if (percent.sellerFinancingInterestRatePct < 0) {
      errors.push("Seller-Finance Interest Rate cannot be negative.");
    }
    if (!sellerFinancingAmortizationYears || sellerFinancingAmortizationYears <= 0) {
      errors.push("Amortization Term is required and must be greater than 0 years.");
    }
    if (
      errors.length === 0 &&
      sellerFinancingLoanBalanceUsed > 0 &&
      sellerFinancingAmortizationYears > 0 &&
      !(sellerFinancingMonthlyPI > 0)
    ) {
      errors.push("Unable to calculate Monthly Principal & Interest with the current inputs.");
    }
    return errors;
  }, [
    financingMode,
    financing.purchasePrice,
    sellerFinancingDownPaymentAmountResolved,
    sellerFinancingDownPaymentPctResolved,
    sellerFinancingDownPaymentLastEdited,
    sellerFinancingDownPaymentAmount,
    sellerFinancingLoanBalanceIsManual,
    sellerFinancingLoanBalanceOverride,
    percent.sellerFinancingInterestRatePct,
    sellerFinancingAmortizationYears,
    sellerFinancingLoanBalanceUsed,
    sellerFinancingMonthlyPI,
  ]);

  // Selecting a financing structure option deselects whichever one was
  // previously active; clicking the already-active option deselects it
  // and returns to "Not Specified", matching the toggle behavior visitors
  // are used to from the previous checkbox-style selector.
  function selectFinancingMode(mode: Exclude<FinancingMode, "">) {
    setFinancingMode((prev) => (prev === mode ? "" : mode));
  }

  // Amortization schedule expand/collapse and annual/monthly view state
  // is now owned internally by the shared <AmortizationScheduleBlock>
  // component (one per loan leg) rather than by top-level state here --
  // each block naturally resets when it unmounts on a financing-mode
  // switch, so there is nothing left to reset centrally.

  // --- generic currency/percent/integer handlers, keyed by field name ---
  function handleFinancingChange(key: FinancingKey, raw: string) {
    setFinancingDraft((prev) => ({ ...prev, [key]: raw }));
    setFinancing((prev) => ({ ...prev, [key]: parseTypedAmount(raw) }));
  }
  function handleFinancingBlur(key: FinancingKey) {
    setFinancing((prev) => {
      const clamped = round2(Math.max(0, prev[key]));
      setFinancingDraft((d) => ({ ...d, [key]: formatCents(clamped) }));
      return { ...prev, [key]: clamped };
    });
  }

  // Property Taxes Used in Underwriting (financing.annualPropertyTaxes)
  // has its own change handler -- identical to handleFinancingChange,
  // except it also flips propertyTaxManualOverride to true, since typing
  // directly into that field is exactly what "manually edits Annual
  // Property Taxes after it has been calculated" means.
  function handlePropertyTaxUsedChange(raw: string) {
    setPropertyTaxManualOverride(true);
    handleFinancingChange("annualPropertyTaxes", raw);
  }

  // Effective Tax Rate: 0-10%, decimals allowed, never negative.
  function handlePropertyTaxRateChange(raw: string) {
    setPropertyTaxRateDraft(raw);
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const n = cleaned ? Number(cleaned) : 0;
    setPropertyTaxRatePct(!Number.isFinite(n) || n < 0 ? 0 : Math.min(10, n));
  }
  function handlePropertyTaxRateBlur() {
    setPropertyTaxRatePct((prev) => {
      const clamped = Math.min(10, Math.max(0, prev));
      setPropertyTaxRateDraft(clamped.toFixed(2));
      return clamped;
    });
  }
  function handlePropertyTaxCountyChange(county: string) {
    setPropertyTaxCounty(county);
    // A direct dropdown selection is always a manual choice, even if it
    // happens to match the current auto-suggestion -- only
    // acceptSuggestedCounty() (below) marks the value as automatically
    // identified.
    setCountyIsAutoIdentified(false);
    // Selecting a real county populates the rate from the table and
    // recalculates immediately; selecting "Select County" or "Custom"
    // never auto-populates a rate (spec sections 3 and 6) -- whatever
    // rate is currently entered is left exactly as-is.
    const rate = COUNTY_EFFECTIVE_TAX_RATES[county];
    if (rate !== undefined) {
      setPropertyTaxRatePct(rate);
      setPropertyTaxRateDraft(rate.toFixed(2));
    }
  }
  function useCalculatedPropertyTax() {
    setPropertyTaxManualOverride(false);
    const calculated = round2(financing.purchasePrice * (propertyTaxRatePct / 100));
    setFinancing((prev) => ({ ...prev, annualPropertyTaxes: calculated }));
    setFinancingDraft((prev) => ({ ...prev, annualPropertyTaxes: formatCents(calculated) }));
  }

  // Calculated Annual Property Taxes = Purchase Price x Effective Tax
  // Rate, unrounded internally until this single rounding step.
  const calculatedAnnualPropertyTaxes = useMemo(
    () => round2(financing.purchasePrice * (propertyTaxRatePct / 100)),
    [financing.purchasePrice, propertyTaxRatePct]
  );

  // Rate Source: "Custom" once that option is selected; "County Default"
  // only while the entered rate still matches that county's stored
  // rate exactly; "Manual Override" the moment it diverges (including
  // a rate typed in before any county was ever selected).
  const propertyTaxRateSource: "County Default" | "Manual Override" | "Custom" | "N/A" = (() => {
    if (propertyTaxCounty === "Custom") return "Custom";
    if (propertyTaxCounty === "") return propertyTaxRatePct > 0 ? "Manual Override" : "N/A";
    const countyRate = COUNTY_EFFECTIVE_TAX_RATES[propertyTaxCounty];
    return countyRate !== undefined && Math.abs(propertyTaxRatePct - countyRate) < 0.005
      ? "County Default"
      : "Manual Override";
  })();

  const propertyTaxSource: "Calculated" | "Manual Override" = propertyTaxManualOverride ? "Manual Override" : "Calculated";

  // Live recalculation (spec section 8): whenever Purchase Price, County,
  // or Effective Tax Rate changes, Property Taxes Used in Underwriting
  // (financing.annualPropertyTaxes, read by every downstream calculation
  // already) is kept in sync with the freshly calculated amount -- unless
  // the user has manually overridden it, in which case this effect does
  // nothing until "Use Calculated Tax Amount" is pressed or Reset to
  // Defaults runs.
  useEffect(() => {
    if (propertyTaxManualOverride) return;
    setFinancing((prev) =>
      prev.annualPropertyTaxes === calculatedAnnualPropertyTaxes
        ? prev
        : { ...prev, annualPropertyTaxes: calculatedAnnualPropertyTaxes }
    );
    setFinancingDraft((prev) =>
      prev.annualPropertyTaxes === formatCents(calculatedAnnualPropertyTaxes)
        ? prev
        : { ...prev, annualPropertyTaxes: formatCents(calculatedAnnualPropertyTaxes) }
    );
  }, [calculatedAnnualPropertyTaxes, propertyTaxManualOverride]);

  function handleCapitalChange(key: CapitalKey, raw: string) {
    setCapitalDraft((prev) => ({ ...prev, [key]: raw }));
    setCapital((prev) => ({ ...prev, [key]: parseTypedAmount(raw) }));
  }
  function handleCapitalBlur(key: CapitalKey) {
    setCapital((prev) => {
      const clamped = round2(Math.max(0, prev[key]));
      setCapitalDraft((d) => ({ ...d, [key]: formatCents(clamped) }));
      return { ...prev, [key]: clamped };
    });
  }

  // Scope of Work line item handlers. Each item is added with a blank
  // name and $0 cost -- the user must type a custom name and amount;
  // nothing is pre-filled or hard-coded as required. Costs use the same
  // draft-string/parsed-number/blur-clamp pattern as every other
  // currency field in this calculator.
  function handleAddScopeOfWorkItem() {
    setScopeOfWorkItems((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: "", cost: 0, costDraft: "0.00" },
    ]);
  }
  function handleRemoveScopeOfWorkItem(id: string) {
    setScopeOfWorkItems((prev) => prev.filter((item) => item.id !== id));
  }
  function handleScopeOfWorkNameChange(id: string, name: string) {
    setScopeOfWorkItems((prev) => prev.map((item) => (item.id === id ? { ...item, name } : item)));
  }
  function handleScopeOfWorkCostChange(id: string, raw: string) {
    setScopeOfWorkItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, costDraft: raw, cost: parseTypedAmount(raw) } : item))
    );
  }
  function handleScopeOfWorkCostBlur(id: string) {
    setScopeOfWorkItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const clamped = round2(Math.max(0, item.cost));
        return { ...item, cost: clamped, costDraft: formatCents(clamped) };
      })
    );
  }

  function handlePercentChange(key: PercentKey, raw: string) {
    setPercentDraft((prev) => ({ ...prev, [key]: raw }));
    setPercent((prev) => ({
      ...prev,
      [key]: APPRECIATION_PERCENT_KEYS.has(key) ? parseSignedPercent(raw, -20, 20) : parseTypedPercent(raw),
    }));
  }
  function handlePercentBlur(key: PercentKey) {
    setPercent((prev) => {
      const clamped = APPRECIATION_PERCENT_KEYS.has(key)
        ? Math.min(20, Math.max(-20, prev[key]))
        : Math.min(100, Math.max(0, prev[key]));
      setPercentDraft((d) => ({ ...d, [key]: clamped.toFixed(2) }));
      return { ...prev, [key]: clamped };
    });
  }

  // Estimated Monthly Long-Term Rent: unlike every other currency field,
  // an empty input must be tracked as "not entered" (null), not
  // silently coerced to $0, since blank vs. $0 changes the DSCR
  // qualification behavior (see stackLtvAutoSelected below).
  function handleStackLongTermRentChange(raw: string) {
    setStackLongTermRentDraft(raw);
    setStackLongTermRent(raw.trim() === "" ? null : parseTypedAmount(raw));
  }
  function handleStackLongTermRentBlur() {
    if (stackLongTermRentDraft.trim() === "") {
      setStackLongTermRent(null);
      setStackLongTermRentDraft("");
      return;
    }
    const clamped = round2(Math.max(0, parseTypedAmount(stackLongTermRentDraft)));
    setStackLongTermRent(clamped);
    setStackLongTermRentDraft(formatCents(clamped));
  }

  // Estimated Monthly Long-Term Rent (Traditional Financing): same
  // blank-vs-$0 handling as handleStackLongTermRentChange/Blur above.
  function handleTraditionalLongTermRentChange(raw: string) {
    setTraditionalLongTermRentDraft(raw);
    setTraditionalLongTermRent(raw.trim() === "" ? null : parseTypedAmount(raw));
  }
  function handleTraditionalLongTermRentBlur() {
    if (traditionalLongTermRentDraft.trim() === "") {
      setTraditionalLongTermRent(null);
      setTraditionalLongTermRentDraft("");
      return;
    }
    const clamped = round2(Math.max(0, parseTypedAmount(traditionalLongTermRentDraft)));
    setTraditionalLongTermRent(clamped);
    setTraditionalLongTermRentDraft(formatCents(clamped));
  }

  function handleMaintenanceExpenseChange(key: MaintenanceExpenseKey, raw: string) {
    setMaintenanceExpensesDraft((prev) => ({ ...prev, [key]: raw }));
    setMaintenanceExpenses((prev) => ({ ...prev, [key]: parseTypedAmount(raw) }));
    // A direct edit is always a manual choice -- only
    // applyStateDefaultsToMaintenanceExpenses() (the "Use State
    // Defaults" button) marks a field as automatically defaulted again.
    setMaintenanceExpenseIsAutoDefaulted((prev) => ({ ...prev, [key]: false }));
  }
  // Resets all three fields to the recommended defaults for the
  // currently detected state (or the "all other states" fallback when
  // no state has been identified yet) and marks all three as
  // auto-defaulted again, so they resume following future address/state
  // changes -- the "Use State Defaults" button's handler.
  function applyStateDefaultsToMaintenanceExpenses() {
    const defaults = getOperatingDefaultsForState(addressStateAbbreviation);
    setMaintenanceExpenses(defaults);
    setMaintenanceExpensesDraft(makeDraft(defaults));
    setMaintenanceExpenseIsAutoDefaulted({ cleaning: true, lawnCare: true, pestControl: true });
  }
  function handleMaintenanceExpenseBlur(key: MaintenanceExpenseKey) {
    setMaintenanceExpenses((prev) => {
      const clamped = round2(Math.max(0, prev[key]));
      setMaintenanceExpensesDraft((d) => ({ ...d, [key]: formatCents(clamped) }));
      return { ...prev, [key]: clamped };
    });
  }

  // Holding Costs input handlers. Typing into the field marks it as a
  // manual override immediately (parsed the same way every other
  // currency field is, so decimals work correctly); the automatic
  // three-month calculation resumes only via resetHoldingCostsToCalculated
  // or resetToDefaults.
  function handleHoldingCostsChange(raw: string) {
    setHoldingCostsDraft(raw);
    setHoldingCostsOverride(parseTypedAmount(raw));
  }
  function handleHoldingCostsBlur() {
    setHoldingCostsOverride((prev) => {
      const clamped = round2(Math.max(0, prev ?? 0));
      setHoldingCostsDraft(formatCents(clamped));
      return clamped;
    });
  }
  function resetHoldingCostsToCalculated() {
    setHoldingCostsOverride(null);
    setHoldingCostsDraft(formatCents(calculatedHoldingCosts));
  }

  // Hybrid Seller-Financed Balance Used: typing into the field marks it
  // as a manual override immediately, exactly like Holding Costs above.
  // The suggested amount resumes being followed only via
  // resetHybridSellerFinancedBalanceToSuggested or resetToDefaults.
  // Never allowed to go negative.
  function handleHybridSellerFinancedBalanceChange(raw: string) {
    setHybridSellerFinancedBalanceDraft(raw);
    setHybridSellerFinancedBalanceOverride(Math.max(0, parseTypedAmount(raw)));
  }
  function handleHybridSellerFinancedBalanceBlur() {
    setHybridSellerFinancedBalanceOverride((prev) => {
      const clamped = round2(Math.max(0, prev ?? 0));
      setHybridSellerFinancedBalanceDraft(formatCents(clamped));
      return clamped;
    });
  }
  function resetHybridSellerFinancedBalanceToSuggested() {
    setHybridSellerFinancedBalanceOverride(null);
    setHybridSellerFinancedBalanceDraft(formatCents(hybridSuggestedSellerFinancedBalance));
  }

  // Seller Financing Down Payment Percentage / Dollar Amount: typing
  // into either field marks it as the controlling input immediately
  // (see sellerFinancingDownPaymentLastEdited above) -- the other
  // field's draft is kept in sync by the effects above, never both at
  // once, and never in an infinite loop, since only the actually-edited
  // field's raw number is ever written from these handlers.
  function handleSellerFinancingDownPaymentPctChange(raw: string) {
    setSellerFinancingDownPaymentPctDraft(raw);
    setSellerFinancingDownPaymentPct(parseTypedPercent(raw));
    setSellerFinancingDownPaymentLastEdited("pct");
  }
  function handleSellerFinancingDownPaymentPctBlur() {
    setSellerFinancingDownPaymentPct((prev) => {
      const clamped = Math.min(100, Math.max(0, prev));
      setSellerFinancingDownPaymentPctDraft(clamped.toFixed(2));
      return clamped;
    });
  }
  function handleSellerFinancingDownPaymentAmountChange(raw: string) {
    setSellerFinancingDownPaymentAmountDraft(raw);
    setSellerFinancingDownPaymentAmount(Math.max(0, parseTypedAmount(raw)));
    setSellerFinancingDownPaymentLastEdited("amount");
  }
  function handleSellerFinancingDownPaymentAmountBlur() {
    setSellerFinancingDownPaymentAmount((prev) => {
      const clamped = round2(Math.max(0, prev));
      setSellerFinancingDownPaymentAmountDraft(formatCents(clamped));
      return clamped;
    });
  }

  // Seller-Finance Loan Balance: typing into the field marks it as a
  // manual override immediately, exactly like Holding Costs above. The
  // automatic calculation resumes only via
  // resetSellerFinancingLoanBalanceToCalculated ("Use Calculated Loan
  // Balance") or Reset to Defaults. Never allowed to go negative.
  function handleSellerFinancingLoanBalanceChange(raw: string) {
    setSellerFinancingLoanBalanceDraft(raw);
    setSellerFinancingLoanBalanceOverride(Math.max(0, parseTypedAmount(raw)));
  }
  function handleSellerFinancingLoanBalanceBlur() {
    setSellerFinancingLoanBalanceOverride((prev) => {
      const clamped = round2(Math.max(0, prev ?? 0));
      setSellerFinancingLoanBalanceDraft(formatCents(clamped));
      return clamped;
    });
  }
  function resetSellerFinancingLoanBalanceToCalculated() {
    setSellerFinancingLoanBalanceOverride(null);
    setSellerFinancingLoanBalanceDraft(formatCents(sellerFinancingCalculatedLoanBalance));
  }

  // Amortization Term (Years): required, never blank -- unlike Subject
  // To's optional Remaining Amortization (Years), a blank entry here
  // simply resets back to the 30-year default rather than being allowed
  // to represent "unknown", since Seller Financing is always a brand-new
  // loan whose full term is always known/selected by the parties.
  function handleSellerFinancingAmortizationYearsChange(raw: string) {
    setSellerFinancingAmortizationYearsDraft(raw);
    setSellerFinancingAmortizationYears(Math.max(1, parseTypedInt(raw)));
  }
  function handleSellerFinancingAmortizationYearsBlur() {
    if (sellerFinancingAmortizationYearsDraft.trim() === "") {
      setSellerFinancingAmortizationYears(30);
      setSellerFinancingAmortizationYearsDraft("30");
      return;
    }
    setSellerFinancingAmortizationYearsDraft(String(Math.max(1, sellerFinancingAmortizationYears)));
  }

  // Property Files handlers: adding, removing, and replacing all run
  // entirely client-side (see processMediaFile above). Unsupported file
  // types are rejected with a clear error message instead of breaking
  // the calculator, and selection is capped at MAX_PROPERTY_FILES -- one
  // shared limit covering any combination of images and PDFs.
  // Accepts the complete FileList from either the click-to-upload input
  // (multi-select, via the `multiple` attribute) or a multi-file drag-
  // and-drop, converts it to an array once, and validates every file
  // individually -- Array.from(fileList) up front, never fileList[0],
  // so a batch of several files is never silently reduced to just the
  // first one. New files are always appended to the existing
  // propertyImages array (Existing Property Files + Newly Selected
  // Files), never replacing it, and MAX_PROPERTY_FILES is the one
  // shared cap applied here regardless of how many of the newly
  // selected files are images versus PDFs.
  async function handleAddImageFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    const valid = files.filter((f) => ACCEPTED_MEDIA_TYPES.includes(f.type));
    const invalidCount = files.length - valid.length;

    const remainingSlots = Math.max(0, MAX_PROPERTY_FILES - propertyImages.length);
    const toProcess = valid.slice(0, remainingSlots);
    const skippedForCapCount = valid.length - toProcess.length;

    // One combined, accurate summary covering every reason a selected
    // or dropped file might not have been added, rather than reporting
    // only the first problem encountered and leaving the rest
    // unexplained (e.g. a mixed batch of valid, unsupported, and over-
    // the-cap files all in a single selection).
    const messageParts: string[] = [];
    if (toProcess.length > 0) {
      messageParts.push(`${toProcess.length} file${toProcess.length === 1 ? "" : "s"} added.`);
    }
    if (invalidCount > 0) {
      messageParts.push(
        `${invalidCount} unsupported file${invalidCount === 1 ? "" : "s"} ${
          invalidCount === 1 ? "was" : "were"
        } skipped.`
      );
    }
    if (skippedForCapCount > 0) {
      messageParts.push(
        `${skippedForCapCount} additional file${skippedForCapCount === 1 ? "" : "s"} ${
          skippedForCapCount === 1 ? "was" : "were"
        } not added because the maximum is ${MAX_PROPERTY_FILES} property files.`
      );
    }
    setImageError(messageParts.join(" "));

    if (toProcess.length === 0) return;

    setProcessingImages(true);
    try {
      const processed = await Promise.all(
        toProcess.map(async (file) => {
          const media = await processMediaFile(file);
          return {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name: file.name,
            ...media,
          };
        })
      );
      setPropertyImages((prev) => [...prev, ...processed]);
    } catch {
      setImageError((prev) =>
        prev
          ? `${prev} One or more files could not be processed.`
          : "One or more files could not be processed. Please try a different file."
      );
    } finally {
      setProcessingImages(false);
    }
  }

  function handleRemoveImage(id: string) {
    setPropertyImages((prev) => {
      const removed = prev.find((img) => img.id === id);
      revokeMediaFile(removed);
      return prev.filter((img) => img.id !== id);
    });
  }

  // Drag-and-drop for property files: reuses handleAddImageFiles
  // exactly, so dropped files go through the identical type-checking,
  // 5-file cap, and append-not-replace logic as files chosen through
  // the click-to-upload input. Dragging is purely a second way to reach
  // the same handler; nothing about file validation or storage differs.
  function handlePhotoDragEnter(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (propertyImages.length >= MAX_PROPERTY_FILES) return;
    setIsDraggingPhotos(true);
  }
  function handlePhotoDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (propertyImages.length >= MAX_PROPERTY_FILES) return;
    setIsDraggingPhotos(true);
  }
  function handlePhotoDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    // Only clear the highlight once the drag has actually left the
    // drop zone's own bounds, not when it moves over a child element
    // inside it (which also fires dragleave on the parent).
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingPhotos(false);
  }
  function handlePhotoDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPhotos(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      handleAddImageFiles(e.dataTransfer.files);
    }
  }

  // Reorders property files by swapping the file at `id` with its
  // immediate left/right neighbor. The array order here is exactly the
  // order used everywhere the files are displayed -- the on-page
  // preview grid, the featured/thumbnail brochure layout in the
  // printable report (index 0 is always the large featured photo, when
  // it is an image), and the printable gallery -- so reordering on-page
  // reorders the printed report identically.
  function handleMoveImage(id: string, direction: "left" | "right") {
    setPropertyImages((prev) => {
      const index = prev.findIndex((img) => img.id === id);
      if (index === -1) return prev;
      const targetIndex = direction === "left" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }

  async function handleReplaceImage(id: string, fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    if (!ACCEPTED_MEDIA_TYPES.includes(file.type)) {
      setImageError(MEDIA_FILE_ERROR_MESSAGE);
      return;
    }
    setImageError("");
    setProcessingImages(true);
    try {
      const media = await processMediaFile(file);
      setPropertyImages((prev) =>
        prev.map((img) => {
          if (img.id !== id) return img;
          revokeMediaFile(img);
          return { ...img, name: file.name, ...media };
        })
      );
    } catch {
      setImageError("That file could not be processed. Please try a different file.");
    } finally {
      setProcessingImages(false);
    }
  }

  // Floor Plan handler: a single optional file (image or PDF), processed
  // entirely client-side exactly like a Property File (see
  // processMediaFile above), so an image renders as an actual image both
  // on screen and in the printable report, while a PDF renders as a
  // linked document card instead. Uploading a new file always replaces
  // whatever floor plan was there before, revoking its object URL first
  // if it was a PDF.
  async function handleFloorPlanFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    if (!ACCEPTED_MEDIA_TYPES.includes(file.type)) {
      setFloorPlanError(MEDIA_FILE_ERROR_MESSAGE);
      return;
    }
    setFloorPlanError("");
    setProcessingFloorPlan(true);
    try {
      const media = await processMediaFile(file);
      setFloorPlan((prev) => {
        revokeMediaFile(prev);
        return { id: "floor-plan", name: file.name, ...media };
      });
    } catch {
      setFloorPlanError("That file could not be processed. Please try a different file.");
    } finally {
      setProcessingFloorPlan(false);
    }
  }

  function handleRemoveFloorPlan() {
    setFloorPlan((prev) => {
      revokeMediaFile(prev);
      return null;
    });
    setFloorPlanError("");
  }

  // Drag-and-drop for the Floor Plan: a single-file drop zone, otherwise
  // identical in spirit to the property-file drag handlers above.
  // Dropping more than one file is fine -- handleFloorPlanFile only ever
  // reads fileList[0], so a multi-file drop simply uses the first file
  // and silently ignores the rest, matching a single-file field's
  // expected behavior.
  function handleFloorPlanDragEnter(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFloorPlan(true);
  }
  function handleFloorPlanDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFloorPlan(true);
  }
  function handleFloorPlanDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingFloorPlan(false);
  }
  function handleFloorPlanDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFloorPlan(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      handleFloorPlanFile(e.dataTransfer.files);
    }
  }

  // PadSplit Rental Data handler: a single optional file (image or PDF),
  // processed exactly like the Floor Plan above. Supporting
  // documentation only -- never read or used in any calculation, and
  // uploading a new file always replaces whatever file was there before,
  // revoking its object URL first if it was a PDF.
  async function handlePadSplitScreenshotFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    if (!ACCEPTED_MEDIA_TYPES.includes(file.type)) {
      setPadSplitScreenshotError(MEDIA_FILE_ERROR_MESSAGE);
      return;
    }
    setPadSplitScreenshotError("");
    setProcessingPadSplitScreenshot(true);
    try {
      const media = await processMediaFile(file);
      setPadSplitScreenshot((prev) => {
        revokeMediaFile(prev);
        return { id: "padsplit-screenshot", name: file.name, ...media };
      });
    } catch {
      setPadSplitScreenshotError("That file could not be processed. Please try a different file.");
    } finally {
      setProcessingPadSplitScreenshot(false);
    }
  }

  function handleRemovePadSplitScreenshot() {
    setPadSplitScreenshot((prev) => {
      revokeMediaFile(prev);
      return null;
    });
    setPadSplitScreenshotError("");
  }

  // Drag-and-drop for the PadSplit Rental Data upload: a single-file
  // drop zone, identical in spirit to the Floor Plan's above.
  function handlePadSplitDragEnter(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPadSplit(true);
  }
  function handlePadSplitDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPadSplit(true);
  }
  function handlePadSplitDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingPadSplit(false);
  }
  function handlePadSplitDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPadSplit(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      handlePadSplitScreenshotFile(e.dataTransfer.files);
    }
  }

  function resetToDefaults() {
    setPaymentType(PAYMENT_TYPE_DEFAULT);
    setFinancing(FINANCING_DEFAULTS);
    setFinancingDraft(makeDraft(FINANCING_DEFAULTS));
    // Effective Tax Rate: County goes back to "Select County" (never
    // auto-selects a county), the rate clears, and the manual override
    // on Property Taxes Used in Underwriting clears -- financing.
    // annualPropertyTaxes is already restored to its existing default
    // (0) by setFinancing(FINANCING_DEFAULTS) above.
    setPropertyTaxCounty("");
    setCountyIsAutoIdentified(false);
    setCountyAutoStatus("idle");
    setCountySuggestion(null);
    countyAutoLookupAddressRef.current = "";
    setPropertyTaxRatePct(0);
    setPropertyTaxRateDraft("");
    setPropertyTaxManualOverride(false);
    setCapital(CAPITAL_DEFAULTS);
    setCapitalDraft(makeDraft(CAPITAL_DEFAULTS));
    setPercent(PERCENT_DEFAULTS);
    setPercentDraft(makePercentDraft(PERCENT_DEFAULTS));
    setStackBankAmortizationYears(30);
    setStackBankAmortizationYearsDraft("30");
    setStackSellerFinanceAmortizationYears(30);
    setStackSellerFinanceAmortizationYearsDraft("30");
    // Are Monthly Seller Finance Payments Required? resets to No, its
    // default, so no monthly seller-finance payment is assumed after a
    // reset.
    setStackSellerFinancePaymentsRequired(false);
    // Are Monthly Seller Finance Payments Required? (Hybrid) resets to
    // No, its default, so the seller-financed balance is once again
    // assumed to carry unamortized until the balloon date after a reset.
    setHybridSellerFinancePaymentsRequired(false);
    // Seller-Financed Balance Used (Hybrid): clearing the override lets
    // the field follow the Suggested Seller-Financed Balance calculation
    // again instead of keeping a stale manually entered amount.
    setHybridSellerFinancedBalanceOverride(null);
    setHybridSellerFinancedBalanceDraft(formatCents(0));
    // Long-Term Rent Qualification: blank/null is the default, meaning
    // Bank Loan-to-Value Percentage goes back to being manually selected.
    setStackLongTermRent(null);
    setStackLongTermRentDraft("");
    // Long-Term Rent LTV Qualification (Traditional Financing): blank/
    // null is the default, meaning Down Payment Percentage goes back to
    // being manually selected.
    setTraditionalLongTermRent(null);
    setTraditionalLongTermRentDraft("");
    // Balloon Refinance Analysis: every "Exists" flag resets to No, the
    // year fields reset to their 5-year default, and every 70% LTV
    // contingency resets to Yes, for all four applicable structures.
    setStackBalloonExists(false);
    setStackBalloonYears(5);
    setStackBalloonYearsDraft("5");
    setStackBalloonHas70LtvContingency(true);
    setSubjectToBalloonExists(false);
    setSubjectToBalloonYears(5);
    setSubjectToBalloonYearsDraft("5");
    setSubjectToBalloonHas70LtvContingency(true);
    setSellerFinancingBalloonExists(false);
    setSellerFinancingBalloonYears(5);
    setSellerFinancingBalloonYearsDraft("5");
    setSellerFinancingBalloonHas70LtvContingency(true);
    setHybridBalloonExists(false);
    setHybridBalloonYears(5);
    setHybridBalloonYearsDraft("5");
    setHybridBalloonHas70LtvContingency(true);
    // 30-Year ROI Projection: Refinance at Balloon resets to Yes (its
    // default) for every applicable structure, and every Replacement
    // Interest Rate override clears so the field goes back to following
    // that structure's own first-position interest rate.
    setSubjectToRefinanceAtBalloon(true);
    setSubjectToRefinanceRateOverride(null);
    setSubjectToRefinanceRateDraft(PERCENT_DEFAULTS.loanInterestRatePct.toFixed(2));
    setSellerFinancingRefinanceAtBalloon(true);
    setSellerFinancingRefinanceRateOverride(null);
    setSellerFinancingRefinanceRateDraft(PERCENT_DEFAULTS.sellerFinancingInterestRatePct.toFixed(2));
    // Seller Financing: Down Payment Percentage/Amount go back to the
    // 10% default with Percentage as the controlling field, the Loan
    // Balance override clears so it follows the calculated value again,
    // and Amortization Term resets to 30 years.
    setSellerFinancingDownPaymentPct(10);
    setSellerFinancingDownPaymentPctDraft("10.00");
    setSellerFinancingDownPaymentAmount(0);
    setSellerFinancingDownPaymentAmountDraft(formatCents(0));
    setSellerFinancingDownPaymentLastEdited("pct");
    setSellerFinancingLoanBalanceOverride(null);
    setSellerFinancingLoanBalanceDraft(formatCents(0));
    setSellerFinancingAmortizationYears(30);
    setSellerFinancingAmortizationYearsDraft("30");
    setHybridRefinanceAtBalloon(true);
    setHybridRefinanceRateOverride(null);
    setHybridRefinanceRateDraft(PERCENT_DEFAULTS.hybridExistingMortgageRatePct.toFixed(2));
    setStackRefinanceAtBalloon(true);
    setStackRefinanceRateOverride(null);
    setStackRefinanceRateDraft(PERCENT_DEFAULTS.stackBankInterestRatePct.toFixed(2));
    setRoiProjectionOpen(false);
    setLoanRemainingAmortizationYears(null);
    setLoanRemainingAmortizationYearsDraft("");
    setLoanKnownMonthlyPIPayment(null);
    setLoanKnownMonthlyPIPaymentDraft("");
    setHybridExistingMortgageAmortizationYears(null);
    setHybridExistingMortgageAmortizationYearsDraft("");
    setHybridExistingMortgageKnownMonthlyPIPayment(null);
    setHybridExistingMortgageKnownMonthlyPIPaymentDraft("");
    setMaintenanceExpenses(MAINTENANCE_EXPENSE_DEFAULTS);
    setMaintenanceExpensesDraft(makeDraft(MAINTENANCE_EXPENSE_DEFAULTS));
    setMaintenanceExpenseIsAutoDefaulted({ cleaning: true, lawnCare: true, pestControl: true });
    setAddressStateAbbreviation(null);
    setSharedBathBedrooms(BEDROOM_DEFAULTS.sharedBathBedrooms);
    setSharedBathBedroomsDraft(String(BEDROOM_DEFAULTS.sharedBathBedrooms));
    setWeeklySharedBathRent(BEDROOM_DEFAULTS.weeklySharedBathRent);
    setWeeklySharedBathRentDraft(formatCents(BEDROOM_DEFAULTS.weeklySharedBathRent));
    setEnsuiteBedrooms(BEDROOM_DEFAULTS.ensuiteBedrooms);
    setEnsuiteBedroomsDraft(String(BEDROOM_DEFAULTS.ensuiteBedrooms));
    setWeeklyEnsuiteRent(BEDROOM_DEFAULTS.weeklyEnsuiteRent);
    setWeeklyEnsuiteRentDraft(formatCents(BEDROOM_DEFAULTS.weeklyEnsuiteRent));
    // Every default above is $0, so the automatic Holding Costs
    // calculation resets to $0 too; clearing the override lets the
    // field follow that calculation again instead of keeping a stale
    // manually entered amount.
    setHoldingCostsOverride(null);
    setHoldingCostsDraft(formatCents(0));
    // Property Address, Property Files, Video Walkthrough Link, Floor
    // Plan, and Financing Structure are all cleared on reset, same as
    // every other field. Any PDF among them has a temporary object URL
    // that must be revoked before it is discarded, or it would leak for
    // the rest of the browser session -- image data URLs need no such
    // cleanup.
    setPropertyAddress("");
    setTransitNearestStopDraft("");
    setTransitWalkingTimeDraft("");
    setTransitWalkingDistanceDraft("");
    setTransitNotes("");
    setTransitAutoStatus("idle");
    setTransitAutoStopCoords(null);
    transitAutoLookupAddressRef.current = "";
    setPropertyImages((prev) => {
      prev.forEach(revokeMediaFile);
      return [];
    });
    setImageError("");
    setVideoWalkthroughLink("");
    setFloorPlan((prev) => {
      revokeMediaFile(prev);
      return null;
    });
    setFloorPlanError("");
    setPadSplitScreenshot((prev) => {
      revokeMediaFile(prev);
      return null;
    });
    setPadSplitScreenshotError("");
    // Scope of Work: clears every line item and restores the standard
    // itemized-by-default Renovation Cost behavior (Yes). Renovation
    // Cost itself is already reset to its $0 default above via
    // setCapital(CAPITAL_DEFAULTS).
    setScopeOfWorkItems([]);
    setUseItemizedScopeOfWork(true);
    // Financing Structure resets to its default of no selection, which
    // also clears the Traditional Financing and Hybrid inputs (Purchase
    // Price and the Hybrid Existing Mortgage Balance / Subject-To PITI
    // are reset above via `financing`; Down Payment Percentage 20%,
    // Interest Rate 7%, Traditional Closing Cost Percentage 5%, and
    // Seller Finance Interest Rate 2% are reset above via `percent`),
    // and every amortization schedule -- being derived entirely from
    // that state, and their expand/collapse UI state living inside the
    // shared <AmortizationScheduleBlock> component itself -- reset
    // automatically along with it.
    setFinancingMode(FINANCING_MODE_DEFAULT);
  }

  // ---------------------------------------------------------------------
  // Traditional Financing: Estimated Down Payment, Estimated Loan
  // Balance, Estimated Monthly Principal and Interest Payment, Estimated
  // Monthly PITI, Traditional Financing Closing Costs, and the full
  // 360-payment amortization schedule. All are computed here (rather
  // than inline) so they can feed both the Property and Financing
  // section and the dedicated Traditional Financing section below,
  // always in sync.
  // ---------------------------------------------------------------------

  // Long-Term Rent LTV qualification check: compares the optional
  // Estimated Monthly Long-Term Rent against the Estimated Monthly PITI
  // evaluated hypothetically at an 80% LTV (20% down) -- a fixed
  // reference point that never itself depends on which LTV ends up
  // selected, avoiding a circular calculation -- to decide whether an
  // 80% or a more conservative 75% LTV assumption should be used.
  // Always uses the fixed 30-year/360-payment amortization. Only takes
  // effect once a Long-Term Rent has been entered; while the field is
  // blank (null), the manually entered percent.traditionalDownPaymentPct
  // is used unchanged instead, matching the same pattern already used
  // for Stack Method's Long-Term Rent Qualification check.
  const traditionalLoanAmountAt80 = useMemo(
    () => Math.max(0, round2(financing.purchasePrice * 0.8)),
    [financing.purchasePrice]
  );
  const traditionalPITIAt80 = useMemo(() => {
    const monthlyPI = calculateMonthlyPrincipalAndInterest(
      traditionalLoanAmountAt80,
      percent.traditionalInterestRatePct
    );
    return round2(monthlyPI + financing.annualPropertyTaxes / 12 + financing.annualPropertyInsurance / 12);
  }, [
    traditionalLoanAmountAt80,
    percent.traditionalInterestRatePct,
    financing.annualPropertyTaxes,
    financing.annualPropertyInsurance,
  ]);
  // null while Long-Term Rent is blank (no automatic adjustment); 80 or
  // 75 once a value has been entered.
  const traditionalLtvAutoSelected: 75 | 80 | null = useMemo(() => {
    if (traditionalLongTermRent === null) return null;
    return traditionalLongTermRent >= traditionalPITIAt80 ? 80 : 75;
  }, [traditionalLongTermRent, traditionalPITIAt80]);
  // Selected LTV actually used for every calculation below: the
  // auto-selected value once a Long-Term Rent has been entered,
  // otherwise 100 - the manually entered Down Payment Percentage,
  // unchanged.
  const traditionalSelectedLtvPct =
    traditionalLtvAutoSelected !== null ? traditionalLtvAutoSelected : 100 - percent.traditionalDownPaymentPct;
  // Required Down Payment Percentage: the complement of Selected LTV.
  const traditionalEffectiveDownPaymentPct =
    traditionalLtvAutoSelected !== null ? 100 - traditionalLtvAutoSelected : percent.traditionalDownPaymentPct;

  // Down Payment is entered as a percentage of the Purchase Price
  // (Down Payment Percentage), not a dollar amount. Estimated Down
  // Payment = Purchase Price x effective Down Payment Percentage (see
  // traditionalEffectiveDownPaymentPct above -- automatically 20% or
  // 25% once a Long-Term Rent has been entered, otherwise the manually
  // selected percentage).
  const traditionalDownPaymentAmount = useMemo(
    () => round2(financing.purchasePrice * (traditionalEffectiveDownPaymentPct / 100)),
    [financing.purchasePrice, traditionalEffectiveDownPaymentPct]
  );

  // Loan Balance = Purchase Price - Estimated Down Payment, never
  // allowed below $0.
  const traditionalLoanBalance = useMemo(
    () => Math.max(0, round2(financing.purchasePrice - traditionalDownPaymentAmount)),
    [financing.purchasePrice, traditionalDownPaymentAmount]
  );

  // Estimated Monthly Principal and Interest Payment: a true fixed-rate,
  // fully amortizing 30-year (360-payment) loan, principal and interest
  // only, no balloon payment. Handles a 0% interest rate as a special
  // case (Loan Balance / 360) and a $0 loan balance as a $0 payment.
  const traditionalMonthlyPI = useMemo(
    () => round2(calculateMonthlyPrincipalAndInterest(traditionalLoanBalance, percent.traditionalInterestRatePct)),
    [traditionalLoanBalance, percent.traditionalInterestRatePct]
  );

  // Monthly Property Taxes and Monthly Property Insurance: the entered
  // annual figures divided by 12. Estimated Monthly PITI = Monthly
  // Principal and Interest + Monthly Property Taxes + Monthly Property
  // Insurance, computed once here (see monthlyHousingPayment below) so
  // taxes and insurance are never counted twice anywhere downstream.
  const traditionalMonthlyTaxes = useMemo(
    () => round2(financing.annualPropertyTaxes / 12),
    [financing.annualPropertyTaxes]
  );
  const traditionalMonthlyInsurance = useMemo(
    () => round2(financing.annualPropertyInsurance / 12),
    [financing.annualPropertyInsurance]
  );

  // Traditional Financing Closing Costs = Estimated Loan Balance x
  // Closing Cost Percentage -- calculated from the loan balance, not
  // the purchase price, and used instead of the general purchase-price-
  // based Closing Costs whenever Traditional Financing is selected.
  const traditionalClosingCosts = useMemo(
    () => round2(traditionalLoanBalance * (percent.traditionalClosingCostPct / 100)),
    [traditionalLoanBalance, percent.traditionalClosingCostPct]
  );

  // The complete month-by-month amortization schedule, generated once
  // here so the on-page "View Estimated Amortization Schedule" section
  // and its CSV download always show the exact same 360 rows. Taxes and
  // insurance are never part of this schedule -- they do not reduce the
  // principal balance.
  const traditionalAmortization = useMemo(
    () => buildAmortizationSchedule(traditionalLoanBalance, percent.traditionalInterestRatePct),
    [traditionalLoanBalance, percent.traditionalInterestRatePct]
  );

  // ---------------------------------------------------------------------
  // Subject To / Seller Financing: the full month-by-month amortization
  // schedule for the existing/seller-financed loan, using the Existing
  // Mortgage Interest Rate (or Seller Financing Interest Rate) and
  // Remaining Amortization (Years) fields shared by both modes. Deriving
  // the payment from balance/rate/term via buildAmortizationScheduleForTerm
  // (never from the entered Monthly Payment field, which may be a PITI
  // figure) structurally guarantees taxes and insurance can never be
  // mistaken for principal or interest here, and that Subject To never
  // uses a full PITI payment as the amortizing payment.
  // ---------------------------------------------------------------------
  const existingMortgageAmortization = useMemo(() => {
    if (subjectToEffectiveAmortization.months === null) return { schedule: [], monthlyPayment: 0 };
    return buildAmortizationScheduleForTerm(
      financing.loanBalance,
      percent.loanInterestRatePct,
      subjectToEffectiveAmortization.months
    );
  }, [financing.loanBalance, percent.loanInterestRatePct, subjectToEffectiveAmortization.months]);

  // ---------------------------------------------------------------------
  // Hybrid (Subject To & Seller Finance Hybrid): the buyer takes over
  // making the existing mortgage's monthly Subject-To PITI payment
  // (entered directly, since the existing loan's own terms are not
  // otherwise modeled) and separately makes a seller-financed payment
  // covering the remaining equity gap. Seller-Financed Balance and its
  // amortization reuse the exact same standard formula and schedule
  // builder as Traditional Financing above, just with a different
  // principal and rate.
  // ---------------------------------------------------------------------

  // Suggested Seller-Financed Balance = Purchase Price - Existing
  // Mortgage Balance - Seller Down Payment, never allowed below $0. This
  // is only a suggestion -- see hybridSellerFinancedBalanceUsed below
  // for the value actually used everywhere in Hybrid's calculations,
  // which may be manually overridden when the actual transaction terms
  // differ (arrears, seller concessions, extra cash at closing,
  // negotiated equity adjustments, or other transaction credits).
  const hybridSuggestedSellerFinancedBalance = useMemo(
    () =>
      Math.max(
        0,
        round2(financing.purchasePrice - financing.hybridExistingMortgageBalance - financing.sellerDownPayment)
      ),
    [financing.purchasePrice, financing.hybridExistingMortgageBalance, financing.sellerDownPayment]
  );

  // Seller-Financed Balance Used: the suggested amount above, unless the
  // user has manually overridden it (hybridSellerFinancedBalanceOverride
  // stops being null), in which case their entered amount is used
  // instead and is never silently overwritten by later changes to
  // Purchase Price, Existing Mortgage Balance, or Seller Down Payment.
  const hybridSellerFinancedBalanceIsManual = hybridSellerFinancedBalanceOverride !== null;
  const hybridSellerFinancedBalanceUsed = hybridSellerFinancedBalanceIsManual
    ? hybridSellerFinancedBalanceOverride!
    : hybridSuggestedSellerFinancedBalance;

  // Estimated Equity = Purchase Price - Existing Mortgage Balance -
  // Seller-Financed Balance Used. The seller-financed balance is a lien
  // against the property, not buyer equity, so it must always be
  // subtracted here just like the existing mortgage balance -- always
  // using the actual negotiated Seller-Financed Balance Used (including
  // any manual override), never the Suggested Seller-Financed Balance.
  // Never floored at $0: negative equity is a real, meaningful result
  // (the property is over-leveraged relative to its purchase price) and
  // must be displayed as a negative value rather than hidden.
  const hybridEquityRaw = useMemo(
    () =>
      financing.purchasePrice - financing.hybridExistingMortgageBalance - hybridSellerFinancedBalanceUsed,
    [financing.purchasePrice, financing.hybridExistingMortgageBalance, hybridSellerFinancedBalanceUsed]
  );

  // Keeps the Seller-Financed Balance Used field showing (and using) the
  // live suggested calculation as long as the field hasn't been
  // manually overridden, exactly like the Holding Costs pattern above.
  useEffect(() => {
    if (!hybridSellerFinancedBalanceIsManual) {
      setHybridSellerFinancedBalanceDraft(formatCents(hybridSuggestedSellerFinancedBalance));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hybridSuggestedSellerFinancedBalance, hybridSellerFinancedBalanceIsManual]);

  // Estimated Monthly Seller Finance Payment: $0 whenever monthly
  // seller-finance payments are not required (the default, No) -- the
  // Seller-Financed Balance Used then simply carries, unamortized, until
  // the balloon date instead. When required (Yes), a true fixed-rate,
  // fully amortizing 30-year (360-payment) loan on the Seller-Financed
  // Balance Used, at the entered Seller Finance Interest Rate.
  const hybridMonthlySellerFinancePayment = useMemo(() => {
    if (!hybridSellerFinancePaymentsRequired) return 0;
    return round2(
      calculateMonthlyPrincipalAndInterest(hybridSellerFinancedBalanceUsed, percent.hybridSellerFinanceRatePct)
    );
  }, [hybridSellerFinancePaymentsRequired, hybridSellerFinancedBalanceUsed, percent.hybridSellerFinanceRatePct]);

  // The full month-by-month amortization schedule for the seller-financed
  // balance only (used only when monthly payments are required). The
  // existing subject-to mortgage is deliberately never part of this
  // schedule, since its original loan terms may differ.
  const hybridAmortization = useMemo(
    () => buildAmortizationSchedule(hybridSellerFinancedBalanceUsed, percent.hybridSellerFinanceRatePct),
    [hybridSellerFinancedBalanceUsed, percent.hybridSellerFinanceRatePct]
  );

  // The full month-by-month amortization schedule for the existing
  // subject-to mortgage leg of a Hybrid deal only -- kept completely
  // separate from the seller-finance schedule above, using its own
  // Existing Mortgage Interest Rate and Remaining Amortization (Years),
  // never blended with the seller-finance rate or term.
  const hybridExistingMortgageAmortization = useMemo(() => {
    if (hybridExistingMortgageEffectiveAmortization.months === null) {
      return { schedule: [], monthlyPayment: 0 };
    }
    return buildAmortizationScheduleForTerm(
      financing.hybridExistingMortgageBalance,
      percent.hybridExistingMortgageRatePct,
      hybridExistingMortgageEffectiveAmortization.months
    );
  }, [
    financing.hybridExistingMortgageBalance,
    percent.hybridExistingMortgageRatePct,
    hybridExistingMortgageEffectiveAmortization.months,
  ]);

  // Total Monthly Housing Payment (Total PITI) = Monthly Subject-To PITI
  // Payment + Included Monthly Seller Finance Payment. The entered
  // Subject-To payment is already a complete PITI figure for the
  // existing mortgage, so taxes and insurance are never added again on
  // top of it. hybridMonthlySellerFinancePayment above is already $0
  // whenever monthly payments are not required, so this formula never
  // needs its own separate Yes/No branch.
  const hybridTotalMonthlyHousingPayment = useMemo(
    () => round2(financing.hybridSubjectToPITI + hybridMonthlySellerFinancePayment),
    [financing.hybridSubjectToPITI, hybridMonthlySellerFinancePayment]
  );

  // ---------------------------------------------------------------------
  // Stack Method: a two-position creative-finance structure combining a
  // first-position bank/DSCR loan (typically around half the purchase
  // price, though the Bank Loan-to-Value Percentage is fully editable)
  // with second-position seller financing carrying the seller's
  // remaining equity. This reproduces, term for term, the acquisition
  // and cash-to-close formulas reviewed in the attached workbook's
  // "Cash Back" sheet:
  //   Loan Amount            = Purchase Price x LTV
  //   Proposed Seller Carry  = Purchase Price - Seller's Current First
  //                            Loan Balance - 2nd Lien - Misc. Liens -
  //                            Down Payment to Seller
  //   Debt Owed Day 1        = Loan Amount + Seller Carry Amount
  //   Current Leverage Ratio = Debt Owed Day 1 / Purchase Price
  //   DSCR Down Payment      = Purchase Price - Loan Amount
  //   Closing Costs          = Purchase Price x Closing Cost %
  //   Agent Fees             = Purchase Price x Agent Commission %
  //   Cash To Close (Leg 1)  = DSCR Down Payment + Closing Costs +
  //                            Agent Fees + Assignment Fee
  //   Transactional Funding Fee = Cash To Close (Leg 1) x Funding Fee %
  //   Est. Buyer Cash At Close  = Seller Carry - Cash To Close (Leg 1) -
  //                               Transactional Funding Fee
  //   Est. Seller Cash At Close = Purchase Price - Seller's Current
  //                               First Loan Balance - Seller Carry
  // The monthly Bank PITI and Seller Finance payment calculations below
  // are new additions, not present in the workbook, needed to feed the
  // combined Total Monthly Housing Payment into the co-living
  // underwriting further down; both reuse the same standard fixed-rate
  // amortization formula as Traditional Financing and the Hybrid
  // structure, generalized to an editable number of payments.
  // ---------------------------------------------------------------------

  // Long-Term Rent DSCR qualification check: compares the optional
  // Estimated Monthly Long-Term Rent against the Bank PITI evaluated
  // hypothetically at an 80% LTV (the standard DSCR-style test) to
  // decide whether an 80% or a more conservative 75% Bank Loan-to-Value
  // assumption should be used. Always uses the fixed 30-year/360-payment
  // amortization, since Bank Amortization is no longer editable. Only
  // takes effect once a Long-Term Rent has been entered; while the field
  // is blank (null), the manually entered percent.stackBankLtvPct is
  // used unchanged instead.
  const stackBankLoanAmountAt80 = useMemo(
    () => Math.max(0, round2(financing.purchasePrice * 0.8)),
    [financing.purchasePrice]
  );
  const stackBankPITIAt80 = useMemo(() => {
    const monthlyPI = calculateMonthlyPaymentForTerm(stackBankLoanAmountAt80, percent.stackBankInterestRatePct, 360);
    return round2(monthlyPI + financing.annualPropertyTaxes / 12 + financing.annualPropertyInsurance / 12);
  }, [
    stackBankLoanAmountAt80,
    percent.stackBankInterestRatePct,
    financing.annualPropertyTaxes,
    financing.annualPropertyInsurance,
  ]);
  // null while Long-Term Rent is blank (no automatic adjustment); 80 or
  // 75 once a value has been entered.
  const stackLtvAutoSelected: 75 | 80 | null = useMemo(() => {
    if (stackLongTermRent === null) return null;
    return stackLongTermRent >= stackBankPITIAt80 ? 80 : 75;
  }, [stackLongTermRent, stackBankPITIAt80]);
  // The Bank Loan-to-Value % actually used for every calculation below:
  // the auto-selected value once a Long-Term Rent has been entered,
  // otherwise the manually entered percent.stackBankLtvPct, unchanged.
  const stackEffectiveBankLtvPct = stackLtvAutoSelected !== null ? stackLtvAutoSelected : percent.stackBankLtvPct;

  // First-Position Bank Loan = Purchase Price x effective Bank
  // Loan-to-Value %.
  const stackBankLoanAmount = useMemo(
    () => Math.max(0, round2(financing.purchasePrice * (stackEffectiveBankLtvPct / 100))),
    [financing.purchasePrice, stackEffectiveBankLtvPct]
  );

  // Estimated Seller-Financed Balance (workbook: "Proposed Seller
  // Carry") = Purchase Price - Seller's Current First Loan Balance -
  // Existing Second Lien - Miscellaneous Liens - Down Payment to
  // Seller, floored at $0 for display and every downstream use.
  const stackSellerFinancedBalanceRaw = useMemo(
    () =>
      financing.purchasePrice -
      financing.stackSellerFirstLoanBalance -
      financing.stackSellerSecondLien -
      financing.stackMiscLiens -
      financing.stackDownPaymentToSeller,
    [
      financing.purchasePrice,
      financing.stackSellerFirstLoanBalance,
      financing.stackSellerSecondLien,
      financing.stackMiscLiens,
      financing.stackDownPaymentToSeller,
    ]
  );
  const stackSellerFinancedBalance = Math.max(0, round2(stackSellerFinancedBalanceRaw));

  // Total Debt at Acquisition = First-Position Bank Loan + Seller-
  // Financed Balance.
  const stackTotalDebtAtAcquisition = useMemo(
    () => round2(stackBankLoanAmount + stackSellerFinancedBalance),
    [stackBankLoanAmount, stackSellerFinancedBalance]
  );

  // Current Leverage Ratio = Total Debt at Acquisition / Purchase Price
  // x 100. Intentionally never capped at 100%, matching the workbook.
  // null (displayed as "N/A") when the Purchase Price is $0, matching
  // the workbook's IFERROR(...,"") behavior.
  // Leverage Ratio (Decimal) = Total Debt at Acquisition / Purchase
  // Price -- the standard metric lenders use (e.g. 1.15x). Leverage
  // Ratio (%) is simply that decimal x 100. Both are derived from the
  // same underlying null-when-$0-Purchase-Price value so the two
  // displayed figures can never disagree with each other.
  const stackLeverageRatioDecimal = useMemo(() => {
    if (financing.purchasePrice <= 0) return null;
    return stackTotalDebtAtAcquisition / financing.purchasePrice;
  }, [stackTotalDebtAtAcquisition, financing.purchasePrice]);
  const stackLeverageRatio = useMemo(
    () => (stackLeverageRatioDecimal === null ? null : stackLeverageRatioDecimal * 100),
    [stackLeverageRatioDecimal]
  );

  // Bank Loan Down Payment (workbook: "DSCR Down Payment") = Purchase
  // Price - First-Position Bank Loan.
  const stackBankLoanDownPayment = useMemo(
    () => round2(financing.purchasePrice - stackBankLoanAmount),
    [financing.purchasePrice, stackBankLoanAmount]
  );

  // Stack Method Closing Costs = Purchase Price x Closing Cost %.
  const stackClosingCosts = useMemo(
    () => round2(financing.purchasePrice * (percent.stackClosingCostPct / 100)),
    [financing.purchasePrice, percent.stackClosingCostPct]
  );

  // Agent Fees = Purchase Price x Agent Commission %.
  const stackAgentFees = useMemo(
    () => round2(financing.purchasePrice * (percent.stackAgentCommissionPct / 100)),
    [financing.purchasePrice, percent.stackAgentCommissionPct]
  );

  // Cash to Close, Leg 1 = Bank Loan Down Payment + Stack Method Closing
  // Costs + Agent Fees + Assignment Fee. The Assignment Fee reuses the
  // same capital.assignmentFee field already used in the Total Capital
  // Required section (see the dedicated Stack Method UI section below)
  // instead of creating a second, independent input. Does not yet
  // include the Transactional Funding Fee, matching the workbook.
  const stackCashToCloseLeg1 = useMemo(
    () => round2(stackBankLoanDownPayment + stackClosingCosts + stackAgentFees + capital.assignmentFee),
    [stackBankLoanDownPayment, stackClosingCosts, stackAgentFees, capital.assignmentFee]
  );

  // Transactional Funding Fee = Cash to Close, Leg 1 x Transactional
  // Funding Fee %.
  const stackTransactionalFundingFee = useMemo(
    () => round2(stackCashToCloseLeg1 * (percent.stackTransactionalFundingFeePct / 100)),
    [stackCashToCloseLeg1, percent.stackTransactionalFundingFeePct]
  );

  // Estimated Buyer Cash at Closing = Seller-Financed Balance - Cash to
  // Close, Leg 1 - Transactional Funding Fee. Positive, zero, and
  // negative results are all preserved unmodified, since the sign is
  // itself meaningful (see the contextual label logic in the UI below).
  const stackEstimatedBuyerCashAtClosing = useMemo(
    () => round2(stackSellerFinancedBalance - stackCashToCloseLeg1 - stackTransactionalFundingFee),
    [stackSellerFinancedBalance, stackCashToCloseLeg1, stackTransactionalFundingFee]
  );

  // Net Stack Method Buyer Cash Requirement: the amount actually
  // required out of the buyer's own pocket for Total Capital Required
  // purposes. Never negative (a positive cash-back result must never
  // become a negative capital contribution), and mathematically the
  // same result as taking the absolute value of a negative Estimated
  // Buyer Cash at Closing.
  const stackNetBuyerCashRequirement = useMemo(
    () =>
      Math.max(
        0,
        round2(stackCashToCloseLeg1 + stackTransactionalFundingFee - stackSellerFinancedBalance)
      ),
    [stackCashToCloseLeg1, stackTransactionalFundingFee, stackSellerFinancedBalance]
  );

  // Can this be purchased for an estimated $0 out of pocket? Yes if the
  // buyer's cash at closing is $0 or positive, No if negative, TBD if
  // the Purchase Price has not been entered yet.
  const stackZeroOutOfPocket: "Yes" | "No" | "TBD" = useMemo(() => {
    if (financing.purchasePrice <= 0) return "TBD";
    return stackEstimatedBuyerCashAtClosing >= 0 ? "Yes" : "No";
  }, [financing.purchasePrice, stackEstimatedBuyerCashAtClosing]);

  // Estimated Seller Cash at Closing (workbook formula) = Purchase
  // Price - Seller's Current First Loan Balance - Seller-Financed
  // Balance. This is the workbook's own formula; the fuller
  // reconciliation against the Second Lien, Misc. Liens, and Down
  // Payment to Seller is shown separately in the UI below.
  const stackEstimatedSellerCashAtClosing = useMemo(
    () => round2(financing.purchasePrice - financing.stackSellerFirstLoanBalance - stackSellerFinancedBalance),
    [financing.purchasePrice, financing.stackSellerFirstLoanBalance, stackSellerFinancedBalance]
  );

  // Monthly Bank Principal and Interest: a true fixed-rate amortizing
  // loan on the First-Position Bank Loan, using the entered Bank
  // Interest Rate and Bank Amortization Term (editable, in years, unlike
  // Traditional Financing and the Hybrid structure's fixed 30 years).
  const stackBankAmortMonths = Math.max(1, Math.round(stackBankAmortizationYears * 12));
  const stackBankMonthlyPI = useMemo(
    () =>
      round2(
        calculateMonthlyPaymentForTerm(stackBankLoanAmount, percent.stackBankInterestRatePct, stackBankAmortMonths)
      ),
    [stackBankLoanAmount, percent.stackBankInterestRatePct, stackBankAmortMonths]
  );
  const stackBankAmortization = useMemo(
    () =>
      buildAmortizationScheduleForTerm(stackBankLoanAmount, percent.stackBankInterestRatePct, stackBankAmortMonths),
    [stackBankLoanAmount, percent.stackBankInterestRatePct, stackBankAmortMonths]
  );

  // Monthly Property Taxes and Monthly Property Insurance reuse the
  // same shared Annual Property Taxes / Annual Property Insurance
  // fields as Traditional Financing (only one financing structure is
  // ever active at a time, so there is no conflict). Estimated Monthly
  // Bank PITI = Monthly Bank P&I + Monthly Property Taxes + Monthly
  // Property Insurance; taxes and insurance are never counted again
  // anywhere else once they are part of Bank PITI.
  const stackMonthlyPropertyTaxes = useMemo(
    () => round2(financing.annualPropertyTaxes / 12),
    [financing.annualPropertyTaxes]
  );
  const stackMonthlyPropertyInsurance = useMemo(
    () => round2(financing.annualPropertyInsurance / 12),
    [financing.annualPropertyInsurance]
  );
  const stackMonthlyBankPITI = useMemo(
    () => round2(stackBankMonthlyPI + stackMonthlyPropertyTaxes + stackMonthlyPropertyInsurance),
    [stackBankMonthlyPI, stackMonthlyPropertyTaxes, stackMonthlyPropertyInsurance]
  );

  // Estimated Monthly Seller Finance Payment: a true fixed-rate
  // amortizing loan on the Seller-Financed Balance, using the entered
  // Seller Finance Interest Rate and Seller Finance Amortization Term.
  // If a balloon term is entered, the monthly payment is still based on
  // the full selected amortization term; only the remaining balance due
  // at the balloon date is additionally calculated below. The Stack
  // Method's seller-financed balance does not always carry a monthly
  // payment -- it may instead be deferred, interest-free, or due at a
  // balloon date -- so this is $0 whenever "Are Monthly Seller Finance
  // Payments Required?" is set to No, regardless of what the rate and
  // amortization fields (hidden in that state) contain.
  const stackSellerAmortMonths = Math.max(1, Math.round(stackSellerFinanceAmortizationYears * 12));
  const stackMonthlySellerFinancePayment = useMemo(() => {
    if (!stackSellerFinancePaymentsRequired) return 0;
    return round2(
      calculateMonthlyPaymentForTerm(
        stackSellerFinancedBalance,
        percent.stackSellerFinanceRatePct,
        stackSellerAmortMonths
      )
    );
  }, [
    stackSellerFinancePaymentsRequired,
    stackSellerFinancedBalance,
    percent.stackSellerFinanceRatePct,
    stackSellerAmortMonths,
  ]);
  const stackSellerAmortization = useMemo(
    () =>
      buildAmortizationScheduleForTerm(
        stackSellerFinancedBalance,
        percent.stackSellerFinanceRatePct,
        stackSellerAmortMonths
      ),
    [stackSellerFinancedBalance, percent.stackSellerFinanceRatePct, stackSellerAmortMonths]
  );

  // Stack Method Balloon Refinance Analysis: projected first-position
  // bank loan balance and seller-finance balance at the entered balloon
  // year, using true amortization (never simple division), then the
  // combined projected LTV against the projected appraised value. Only
  // computed when stackBalloonExists is true; otherwise this is null and
  // no balloon information is shown anywhere (on-page, print, or CSV).
  const stackBalloonAnalysis = useMemo(() => {
    if (!stackBalloonExists) return null;
    const balloonMonths = Math.max(0, Math.round(stackBalloonYears * 12));
    const bankBalanceAtBalloon = remainingBalanceAfterMonths(
      stackBankLoanAmount,
      percent.stackBankInterestRatePct,
      stackBankAmortMonths,
      balloonMonths
    );
    const sellerBalanceAtBalloon = stackSellerFinancePaymentsRequired
      ? remainingBalanceAfterMonths(
          stackSellerFinancedBalance,
          percent.stackSellerFinanceRatePct,
          stackSellerAmortMonths,
          balloonMonths
        )
      : stackSellerFinancedBalance;
    const projectedDebtAtBalloon = bankBalanceAtBalloon + sellerBalanceAtBalloon;
    const debtAtYear = (year: number) => {
      const months = Math.max(0, Math.round(year * 12));
      const bank = remainingBalanceAfterMonths(
        stackBankLoanAmount,
        percent.stackBankInterestRatePct,
        stackBankAmortMonths,
        months
      );
      const seller = stackSellerFinancePaymentsRequired
        ? remainingBalanceAfterMonths(
            stackSellerFinancedBalance,
            percent.stackSellerFinanceRatePct,
            stackSellerAmortMonths,
            months
          )
        : stackSellerFinancedBalance;
      return bank + seller;
    };
    return {
      ...buildBalloonAnalysis({
        balloonYears: stackBalloonYears,
        appreciationPct: percent.stackBalloonAppreciationPct,
        has70LtvContingency: stackBalloonHas70LtvContingency,
        purchasePrice: financing.purchasePrice,
        projectedDebtAtBalloon,
        amortizationCeilingYears: stackBankAmortizationYears,
        debtAtYear,
      }),
      bankBalanceAtBalloon,
      sellerBalanceAtBalloon,
    };
  }, [
    stackBalloonExists,
    stackBalloonYears,
    stackBalloonHas70LtvContingency,
    percent.stackBalloonAppreciationPct,
    stackBankLoanAmount,
    percent.stackBankInterestRatePct,
    stackBankAmortMonths,
    stackBankAmortizationYears,
    stackSellerFinancePaymentsRequired,
    stackSellerFinancedBalance,
    percent.stackSellerFinanceRatePct,
    stackSellerAmortMonths,
    financing.purchasePrice,
  ]);

  // Subject To Balloon Refinance Analysis: projects the existing
  // mortgage's remaining balance at the balloon date using its true
  // amortization schedule (financing.loanBalance as the starting
  // principal, percent.loanInterestRatePct and
  // loanRemainingAmortizationYears as its terms -- see the shared
  // Subject To / Seller Financing input section above). Standalone
  // Subject To has no separate seller-carried balance, so the projected
  // debt is this mortgage balance alone.
  const subjectToBalloonAnalysis = useMemo(() => {
    if (!subjectToBalloonExists || subjectToEffectiveAmortization.months === null) return null;
    const totalMonths = subjectToEffectiveAmortization.months;
    const balloonMonths = Math.max(0, Math.round(subjectToBalloonYears * 12));
    const mortgageBalanceAtBalloon = remainingBalanceAfterMonths(
      financing.loanBalance,
      percent.loanInterestRatePct,
      totalMonths,
      balloonMonths
    );
    const debtAtYear = (year: number) =>
      remainingBalanceAfterMonths(
        financing.loanBalance,
        percent.loanInterestRatePct,
        totalMonths,
        Math.max(0, Math.round(year * 12))
      );
    return {
      ...buildBalloonAnalysis({
        balloonYears: subjectToBalloonYears,
        appreciationPct: percent.subjectToBalloonAppreciationPct,
        has70LtvContingency: subjectToBalloonHas70LtvContingency,
        purchasePrice: financing.purchasePrice,
        projectedDebtAtBalloon: mortgageBalanceAtBalloon,
        amortizationCeilingYears: totalMonths / 12,
        debtAtYear,
      }),
      mortgageBalanceAtBalloon,
    };
  }, [
    subjectToBalloonExists,
    subjectToEffectiveAmortization.months,
    subjectToBalloonYears,
    subjectToBalloonHas70LtvContingency,
    percent.subjectToBalloonAppreciationPct,
    financing.loanBalance,
    percent.loanInterestRatePct,
    financing.purchasePrice,
  ]);

  // Seller Financing Balloon Refinance Analysis: identical math to
  // Subject To above (the two modes share the same underlying
  // loan-balance/rate/amortization fields), computed completely
  // independently since each mode's balloon Yes/No, years, appreciation,
  // and 70% LTV contingency are all separate state.
  // Seller Financing's amortization term is always known (a required
  // field, never optional like Subject To's Remaining Amortization
  // Years), so this analysis is never blocked by a missing term -- only
  // by the balloon feature itself being off. Uses Seller Financing's own
  // dedicated loan balance (calculated or manually overridden), interest
  // rate, and amortization term, fully independent from Subject To's
  // shared fields.
  const sellerFinancingBalloonAnalysis = useMemo(() => {
    if (!sellerFinancingBalloonExists) return null;
    const totalMonths = Math.max(1, Math.round(sellerFinancingAmortizationYears * 12));
    const balloonMonths = Math.max(0, Math.round(sellerFinancingBalloonYears * 12));
    const sellerFinanceBalanceAtBalloon = remainingBalanceAfterMonths(
      sellerFinancingLoanBalanceUsed,
      percent.sellerFinancingInterestRatePct,
      totalMonths,
      balloonMonths
    );
    const debtAtYear = (year: number) =>
      remainingBalanceAfterMonths(
        sellerFinancingLoanBalanceUsed,
        percent.sellerFinancingInterestRatePct,
        totalMonths,
        Math.max(0, Math.round(year * 12))
      );
    return {
      ...buildBalloonAnalysis({
        balloonYears: sellerFinancingBalloonYears,
        appreciationPct: percent.sellerFinancingBalloonAppreciationPct,
        has70LtvContingency: sellerFinancingBalloonHas70LtvContingency,
        purchasePrice: financing.purchasePrice,
        projectedDebtAtBalloon: sellerFinanceBalanceAtBalloon,
        amortizationCeilingYears: totalMonths / 12,
        debtAtYear,
      }),
      sellerFinanceBalanceAtBalloon,
    };
  }, [
    sellerFinancingBalloonExists,
    sellerFinancingAmortizationYears,
    sellerFinancingBalloonYears,
    sellerFinancingBalloonHas70LtvContingency,
    percent.sellerFinancingBalloonAppreciationPct,
    sellerFinancingLoanBalanceUsed,
    percent.sellerFinancingInterestRatePct,
    financing.purchasePrice,
  ]);

  // Seller-Finance Repayment Structure: a short label describing how the
  // Seller-Financed Balance Used behaves between now and the balloon
  // date, printed and exported wherever the balloon analysis appears.
  const hybridSellerFinanceRepaymentStructure = hybridSellerFinancePaymentsRequired
    ? "Monthly Amortizing Payments"
    : "Carried to Balloon";

  // Hybrid Balloon Refinance Analysis: combines the projected existing
  // subject-to first mortgage balance (financing.hybridExistingMortgageBalance
  // as starting principal, its own dedicated rate/amortization fields)
  // with the projected seller-finance balance. When monthly seller-finance
  // payments are required, the seller-finance balance amortizes down using
  // the standard fixed 30-year schedule against hybridSellerFinancedBalanceUsed.
  // When they are not required (the default), no principal reduction is
  // assumed before the balloon -- the full hybridSellerFinancedBalanceUsed
  // is carried and is still due in full at the balloon date.
  const hybridBalloonAnalysis = useMemo(() => {
    if (!hybridBalloonExists || hybridExistingMortgageEffectiveAmortization.months === null) return null;
    const mortgageTotalMonths = hybridExistingMortgageEffectiveAmortization.months;
    const balloonMonths = Math.max(0, Math.round(hybridBalloonYears * 12));
    const mortgageBalanceAtBalloon = remainingBalanceAfterMonths(
      financing.hybridExistingMortgageBalance,
      percent.hybridExistingMortgageRatePct,
      mortgageTotalMonths,
      balloonMonths
    );
    const sellerFinanceBalanceAtBalloon = hybridSellerFinancePaymentsRequired
      ? remainingBalanceAfterMonths(
          hybridSellerFinancedBalanceUsed,
          percent.hybridSellerFinanceRatePct,
          TRADITIONAL_NUM_PAYMENTS,
          balloonMonths
        )
      : hybridSellerFinancedBalanceUsed;
    const projectedDebtAtBalloon = mortgageBalanceAtBalloon + sellerFinanceBalanceAtBalloon;
    const debtAtYear = (year: number) => {
      const months = Math.max(0, Math.round(year * 12));
      const mortgage = remainingBalanceAfterMonths(
        financing.hybridExistingMortgageBalance,
        percent.hybridExistingMortgageRatePct,
        mortgageTotalMonths,
        months
      );
      const sellerFinance = hybridSellerFinancePaymentsRequired
        ? remainingBalanceAfterMonths(
            hybridSellerFinancedBalanceUsed,
            percent.hybridSellerFinanceRatePct,
            TRADITIONAL_NUM_PAYMENTS,
            months
          )
        : hybridSellerFinancedBalanceUsed;
      return mortgage + sellerFinance;
    };
    return {
      ...buildBalloonAnalysis({
        balloonYears: hybridBalloonYears,
        appreciationPct: percent.hybridBalloonAppreciationPct,
        has70LtvContingency: hybridBalloonHas70LtvContingency,
        purchasePrice: financing.purchasePrice,
        projectedDebtAtBalloon,
        amortizationCeilingYears: Math.max(mortgageTotalMonths / 12, TRADITIONAL_NUM_PAYMENTS / 12),
        debtAtYear,
      }),
      mortgageBalanceAtBalloon,
      sellerFinanceBalanceAtBalloon,
    };
  }, [
    hybridBalloonExists,
    hybridExistingMortgageEffectiveAmortization.months,
    hybridBalloonYears,
    hybridBalloonHas70LtvContingency,
    percent.hybridBalloonAppreciationPct,
    financing.hybridExistingMortgageBalance,
    percent.hybridExistingMortgageRatePct,
    hybridSellerFinancedBalanceUsed,
    hybridSellerFinancePaymentsRequired,
    percent.hybridSellerFinanceRatePct,
    financing.purchasePrice,
  ]);

  // Total Monthly Housing Payment = Estimated Monthly Bank PITI +
  // Estimated Monthly Seller Finance Payment.
  const stackTotalMonthlyHousingPayment = useMemo(
    () => round2(stackMonthlyBankPITI + stackMonthlySellerFinancePayment),
    [stackMonthlyBankPITI, stackMonthlySellerFinancePayment]
  );

  // ---------------------------------------------------------------------
  // Monthly housing payment and the automatically calculated Holding
  // Costs are broken out of the main underwriting engine below (rather
  // than computed inline) so the Holding Costs override effect further
  // down can depend on them directly, without duplicating the PITI vs.
  // P&I-plus-taxes-and-insurance formula in two places.
  // ---------------------------------------------------------------------
  const monthlyHousingPayment = useMemo(() => {
    // Traditional Financing always quotes principal and interest
    // separately from taxes and insurance (never combined the way a
    // manually entered PITI payment can be), so the complete monthly
    // housing payment is always Monthly P&I + taxes/12 + insurance/12,
    // regardless of the Monthly Loan Payment Type toggle below (which
    // only applies to Seller Financing / Subject To's manually entered
    // payment).
    if (financingMode === "traditional") {
      return round2(
        traditionalMonthlyPI + financing.annualPropertyTaxes / 12 + financing.annualPropertyInsurance / 12
      );
    }
    // Hybrid: the Subject-To PITI payment plus the separate seller
    // finance payment, computed above. The Subject-To payment is
    // already PITI, so taxes/insurance are never added a second time.
    if (financingMode === "hybrid") {
      return hybridTotalMonthlyHousingPayment;
    }
    // Stack Method: the Bank PITI payment plus the separate seller
    // finance payment, computed above. Taxes/insurance are already part
    // of Bank PITI, so they are never added a second time.
    if (financingMode === "stackMethod") {
      return stackTotalMonthlyHousingPayment;
    }
    // Seller Financing: always Monthly Principal & Interest plus Annual
    // Property Taxes / 12 plus Annual Property Insurance / 12, added
    // separately and exactly once -- Seller Financing never has a PITI
    // option, so this branch never consults paymentType.
    if (financingMode === "sellerFinancing") {
      return round2(
        sellerFinancingMonthlyPI + financing.annualPropertyTaxes / 12 + financing.annualPropertyInsurance / 12
      );
    }
    // Prevents taxes/insurance from ever being counted twice: PITI
    // already includes them, so only Principal-and-Interest-Only adds
    // them separately.
    return paymentType === "piti"
      ? financing.monthlyPayment
      : round2(
          financing.monthlyPayment +
            financing.annualPropertyTaxes / 12 +
            financing.annualPropertyInsurance / 12
        );
  }, [
    financingMode,
    traditionalMonthlyPI,
    hybridTotalMonthlyHousingPayment,
    stackTotalMonthlyHousingPayment,
    sellerFinancingMonthlyPI,
    paymentType,
    financing.monthlyPayment,
    financing.annualPropertyTaxes,
    financing.annualPropertyInsurance,
  ]);

  // Calculated Holding Costs = complete monthly housing payment x 3.
  const calculatedHoldingCosts = useMemo(
    () => round2(monthlyHousingPayment * HOLDING_MONTHS),
    [monthlyHousingPayment]
  );

  const holdingCostsIsManual = holdingCostsOverride !== null;
  const effectiveHoldingCosts = holdingCostsIsManual ? holdingCostsOverride! : calculatedHoldingCosts;

  // Keeps the Holding Costs field showing (and using) the live automatic
  // calculation whenever PITI, P&I, taxes, insurance, or payment type
  // change, as long as the field hasn't been manually overridden. Once a
  // visitor types into the field, holdingCostsOverride stops being null
  // and this effect leaves their entry alone.
  useEffect(() => {
    if (!holdingCostsIsManual) {
      setHoldingCostsDraft(formatCents(calculatedHoldingCosts));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculatedHoldingCosts, holdingCostsIsManual]);

  // Scope of Work Total = sum of every line item's cost, using
  // unrounded internal values (round2 only rounds for currency display
  // purposes, matching every other total in this calculator). Only cost
  // changes affect this total -- editing a line item's name never
  // changes it.
  const scopeOfWorkTotal = useMemo(
    () => round2(scopeOfWorkItems.reduce((sum, item) => sum + item.cost, 0)),
    [scopeOfWorkItems]
  );

  // Keeps Renovation Cost synced to the Scope of Work Total whenever
  // itemized calculation is active (the default, Yes) -- updating
  // immediately whenever a line item is added, removed, or its cost is
  // edited. Selecting manual override (useItemizedScopeOfWork = No)
  // stops this sync, so Renovation Cost becomes a normal, freely
  // editable field again while the Scope of Work Total continues to be
  // shown for reference only.
  useEffect(() => {
    if (useItemizedScopeOfWork) {
      setCapital((prev) => ({ ...prev, renovationCost: scopeOfWorkTotal }));
      setCapitalDraft((prev) => ({ ...prev, renovationCost: formatCents(scopeOfWorkTotal) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeOfWorkTotal, useItemizedScopeOfWork]);

  // ---------------------------------------------------------------------
  // The underwriting engine: every number shown anywhere on this page,
  // in the breakdown table, the CSV, and the print summary comes from
  // this single computation.
  // ---------------------------------------------------------------------
  const results = useMemo(() => {
    const totalBedrooms = sharedBathBedrooms + ensuiteBedrooms;

    const monthlySharedBathRent = round2((sharedBathBedrooms * weeklySharedBathRent * 52) / 12);
    const monthlyEnsuiteRent = round2((ensuiteBedrooms * weeklyEnsuiteRent * 52) / 12);
    const grossMonthlyRent = round2(monthlySharedBathRent + monthlyEnsuiteRent);
    const annualGrossRent = round2(grossMonthlyRent * 12);

    const vacancyExpense = round2(grossMonthlyRent * (percent.vacancyPct / 100));
    const effectiveRentAfterVacancy = round2(grossMonthlyRent - vacancyExpense);

    // Platform Fees are an estimate of PadSplit-style platform charges,
    // defaulting to 15% of effective monthly rent after vacancy but
    // fully editable (percent.platformFeePct). Actual platform charges
    // may vary; this is not presented as exact or fixed.
    const platformFees = round2(effectiveRentAfterVacancy * (percent.platformFeePct / 100));
    const propertyManagementFee = round2(
      effectiveRentAfterVacancy * (percent.propertyManagementPct / 100)
    );
    const maintenanceMonthly = round2(MAINTENANCE_ANNUAL / 12);
    const utilitiesMonthly = round2(totalBedrooms * UTILITIES_PER_BEDROOM);
    // Cleaning, Lawn Care, and Pest Control are three separate, fully
    // editable monthly expenses (each defaulting to its own starting
    // value), not a combined or fixed assumption.
    const cleaningMonthly = maintenanceExpenses.cleaning;
    const lawnCareMonthly = maintenanceExpenses.lawnCare;
    const pestControlMonthly = maintenanceExpenses.pestControl;

    const totalMonthlyOperatingExpenses = round2(
      monthlyHousingPayment +
        vacancyExpense +
        platformFees +
        propertyManagementFee +
        maintenanceMonthly +
        utilitiesMonthly +
        cleaningMonthly +
        lawnCareMonthly +
        pestControlMonthly
    );

    // Estimated Equity. For Traditional Financing: Purchase Price -
    // Estimated Loan Balance (which, since Loan Balance = Purchase Price
    // - Estimated Down Payment, ordinarily equals the calculated Down
    // Payment amount). For Hybrid: Purchase Price - Existing Mortgage
    // Balance - Seller-Financed Balance Used (both liens against the
    // property are subtracted, since the seller-financed balance is
    // debt, not buyer equity -- see hybridEquityRaw above). For Seller
    // Financing / Subject To, the existing calculation is preserved:
    // Purchase Price - Loan Balance. The Seller Down Payment (or, for
    // Traditional Financing, the Estimated Down Payment) is a separate
    // cash requirement (used in Total Capital Required) and is not
    // subtracted here, and is never added to Total Capital Required a
    // second time as part of equity.
    const equityRaw =
      financingMode === "traditional"
        ? financing.purchasePrice - traditionalLoanBalance
        : financingMode === "hybrid"
          ? hybridEquityRaw
          : financingMode === "stackMethod"
            ? financing.purchasePrice - stackTotalDebtAtAcquisition
            : financingMode === "sellerFinancing"
              ? financing.purchasePrice - sellerFinancingLoanBalanceUsed
              : financing.purchasePrice - financing.loanBalance;
    // Hybrid's Estimated Equity is never floored at $0 -- a negative
    // result is a real, meaningful outcome (the existing mortgage plus
    // the seller-financed balance exceed the purchase price) and must be
    // displayed as entered, not hidden behind a $0 floor. Every other
    // financing structure keeps its original floor-at-$0 behavior,
    // unchanged.
    const equity =
      financingMode === "hybrid" ? round2(equityRaw) : Math.max(0, round2(equityRaw));
    const equityIsNegative = equityRaw < 0;

    // Holding Costs default to the automatic three-month calculation
    // (monthlyHousingPayment x HOLDING_MONTHS, computed above) but use
    // the visitor's manually entered value once the field is overridden.
    const holdingCosts = effectiveHoldingCosts;

    // Closing Costs. Traditional Financing uses its own Traditional
    // Financing Closing Costs (Estimated Loan Balance x Traditional
    // Closing Cost Percentage, computed above), never the general
    // purchase-price-based calculation, so only one closing-cost amount
    // is ever included anywhere. Every other structure -- Seller
    // Financing, Subject To, Hybrid, or no structure selected -- keeps
    // the existing calculation: 1.5% of the purchase price by default,
    // or whatever Closing Cost Percentage the visitor has entered.
    const closingCosts =
      financingMode === "traditional"
        ? traditionalClosingCosts
        : financingMode === "stackMethod"
          ? stackClosingCosts
          : round2(financing.purchasePrice * (percent.closingCostPct / 100));

    // The acquisition down payment included in Total Capital Required:
    // the calculated Estimated Down Payment (Purchase Price x Down
    // Payment Percentage) when Traditional Financing is selected,
    // otherwise the existing Seller Down Payment (reused as-is for
    // Hybrid, so it is included exactly once). Stack Method does not use
    // this line item at all -- see stackBaseCapitalRequired and
    // stackClosingCashAdjustment below instead, which replace it with a
    // signed adjustment against the Estimated Cash to Buyer at Closing
    // result. Only one of these is ever included, never more than one.
    const downPaymentForCapital =
      financingMode === "traditional"
        ? traditionalDownPaymentAmount
        : financingMode === "sellerFinancing"
          ? sellerFinancingDownPaymentAmountResolved
          : financing.sellerDownPayment;

    // Stack Method: Base Capital Required is every applicable capital
    // item EXCEPT the ones already fully accounted for inside Cash to
    // Close, Leg 1 (Bank Loan Down Payment, Stack Method Closing Costs,
    // Agent Fees, Assignment Fee) -- none of those are added again here,
    // avoiding double-counting. Adjusted Total Capital Required then
    // applies the Estimated Cash to Buyer at Closing result as a signed
    // adjustment: a positive cash-to-buyer result reduces Base Capital
    // Required (the seller-financed proceeds offset some or all of the
    // buyer's other cash needs); a negative result (cash required)
    // increases it. Never allowed to fall below $0.
    // Stack Method uses its own two separate fees (stackTcFee,
    // stackLlcFee), just like every other financing structure uses its
    // own independent TC Fee / LLC Entity Formation Cost pair, and never
    // includes Upfront Insurance as a
    // separate capital item (Annual Property Insurance is still fully
    // accounted for inside Estimated Monthly Bank PITI above -- this
    // only removes the separate upfront capital line item). Traditional
    // Financing also excludes Upfront Insurance as a separate capital
    // item for the same reason (Annual/Monthly Property Insurance is
    // still fully accounted for inside its PITI payment).
    const stackBaseCapitalRequired = round2(
      capital.renovationCost +
        capital.furniture +
        capital.appliances +
        capital.photos +
        holdingCosts +
        capital.reserves +
        capital.acquisitionFee +
        capital.stackTcFee +
        capital.stackLlcFee
    );
    // Positive when it adds to Base Capital Required (buyer cash
    // required at closing), negative when it reduces it (cash to buyer).
    const stackClosingCashAdjustment = round2(-stackEstimatedBuyerCashAtClosing);
    // Signed net capital requirement -- Base Capital Required minus the
    // cash the buyer actually receives at closing (equivalently, Base
    // Capital Required plus the signed closing adjustment above).
    // Positive means capital is still required from the buyer; negative
    // means the closing cash more than covers every modeled project
    // cost, and the buyer walks away with net cash left over. This one
    // signed number is never discarded -- Total Capital Required and Net
    // Cash to Buyer After Project Costs below are just its two
    // non-negative halves, never both positive at once.
    const stackNetCapitalRequirement = round2(stackBaseCapitalRequired + stackClosingCashAdjustment);
    const stackAdjustedTotalCapitalRequired = Math.max(0, stackNetCapitalRequirement);
    // The amount by which cash received at closing exceeds every
    // modeled project cost, once Total Capital Required has already
    // been floored at $0 above. Previously this excess was silently
    // discarded by the Math.max(0, ...) floor; surfacing it here is
    // what lets the UI, printable report, and Excel export show "Net
    // Cash to Buyer After Project Costs" instead of just a flat $0 that
    // hides how much cash the buyer is actually walking away with.
    const stackNetCashToBuyerAfterProjectCosts = Math.max(0, round2(-stackNetCapitalRequirement));

    // TC Fee + LLC Entity Formation Cost: every financing structure uses
    // its own fully independent fee pair. Stack Method never reaches
    // this branch (it uses stackTcFee/stackLlcFee above instead). Each
    // fee is included exactly once.
    const tcAndLlcTotal =
      financingMode === "traditional"
        ? capital.traditionalTcFee + capital.traditionalLlcFee
        : financingMode === "subjectTo"
          ? capital.subjectToTcFee + capital.subjectToLlcFee
          : financingMode === "hybrid"
            ? capital.hybridTcFee + capital.hybridLlcFee
            : capital.sellerFinancingTcFee + capital.sellerFinancingLlcFee;

    const totalCapitalRequired =
      financingMode === "stackMethod"
        ? stackAdjustedTotalCapitalRequired
        : round2(
            downPaymentForCapital +
              (financingMode === "traditional" || financingMode === "sellerFinancing"
                ? 0
                : capital.arrears) +
              capital.renovationCost +
              capital.furniture +
              capital.appliances +
              capital.photos +
              holdingCosts +
              capital.reserves +
              (financingMode === "traditional" ? 0 : capital.upfrontInsurance) +
              capital.acquisitionFee +
              tcAndLlcTotal +
              closingCosts +
              capital.agentFee +
              capital.assignmentFee
          );

    const monthlyCashFlow = round2(grossMonthlyRent - totalMonthlyOperatingExpenses);
    const annualCashFlow = round2(monthlyCashFlow * 12);

    const cashOnCashReturn =
      totalCapitalRequired > 0 ? round2((annualCashFlow / totalCapitalRequired) * 100) : null;

    return {
      totalBedrooms,
      monthlySharedBathRent,
      monthlyEnsuiteRent,
      grossMonthlyRent,
      annualGrossRent,
      vacancyExpense,
      effectiveRentAfterVacancy,
      platformFees,
      propertyManagementFee,
      maintenanceMonthly,
      utilitiesMonthly,
      cleaningMonthly,
      lawnCareMonthly,
      pestControlMonthly,
      monthlyHousingPayment,
      totalMonthlyOperatingExpenses,
      equity,
      equityIsNegative,
      holdingCosts,
      calculatedHoldingCosts,
      holdingCostsIsManual,
      closingCosts,
      downPaymentForCapital,
      stackBaseCapitalRequired,
      stackClosingCashAdjustment,
      stackNetCashToBuyerAfterProjectCosts,
      totalCapitalRequired,
      monthlyCashFlow,
      annualCashFlow,
      cashOnCashReturn,
    };
  }, [
    financing,
    capital,
    percent,
    sharedBathBedrooms,
    weeklySharedBathRent,
    ensuiteBedrooms,
    weeklyEnsuiteRent,
    maintenanceExpenses,
    monthlyHousingPayment,
    effectiveHoldingCosts,
    calculatedHoldingCosts,
    holdingCostsIsManual,
    financingMode,
    traditionalLoanBalance,
    traditionalClosingCosts,
    traditionalDownPaymentAmount,
    hybridEquityRaw,
    stackTotalDebtAtAcquisition,
    stackClosingCosts,
    stackEstimatedBuyerCashAtClosing,
    sellerFinancingLoanBalanceUsed,
    sellerFinancingDownPaymentAmountResolved,
  ]);

  // Cash-on-Cash Return display label whenever results.cashOnCashReturn
  // is null (Total Capital Required is $0, so the ratio is undefined,
  // not infinite or zero). Distinguishes the Stack Method's "the buyer
  // walks away with net cash after every modeled project cost" case --
  // which gets its own explicit status text, per spec, rather than a
  // bare "N/A" that could be misread as a missing/broken calculation --
  // from every other zero-capital case (e.g. every cost input left at
  // $0), which keeps the plain "N/A" it always showed.
  const stackCocrLabel =
    financingMode === "stackMethod" && results.stackNetCashToBuyerAfterProjectCosts > 0
      ? "N/A -- No Net Capital Invested"
      : "N/A";

  // ---------------------------------------------------------------------
  // 30-Year ROI Projection: the debt legs and (if applicable) balloon
  // configuration for whichever financing structure is currently
  // selected, fed into the shared buildRoiProjection engine (see
  // lib/roiProjection.ts, also used by the Excel export). Only one
  // structure is ever active at a time, exactly like every other
  // calculation in this file, so only that structure's legs/balloon are
  // ever assembled.
  // ---------------------------------------------------------------------
  const activeRoiLegs: RoiDebtLeg[] = useMemo(() => {
    if (financingMode === "traditional") {
      return [
        {
          label: "First Mortgage",
          balance: traditionalLoanBalance,
          ratePct: percent.traditionalInterestRatePct,
          amortMonths: TRADITIONAL_NUM_PAYMENTS,
          active: true,
        },
      ];
    }
    if (financingMode === "subjectTo") {
      return [
        {
          label: "Existing Mortgage",
          balance: financing.loanBalance,
          ratePct: percent.loanInterestRatePct,
          amortMonths: subjectToEffectiveAmortization.months ?? 1,
          // When the remaining term is neither entered nor estimable
          // (no balance/rate/known-payment to solve from), this leg is
          // simply held flat in the projection -- never silently
          // assumed to amortize over an invented term such as 30 years.
          active: subjectToEffectiveAmortization.months !== null,
        },
      ];
    }
    // Seller Financing: its own dedicated loan balance, interest rate,
    // and required (never optional) amortization term -- always active,
    // since the term is always known.
    if (financingMode === "sellerFinancing") {
      return [
        {
          label: "Seller-Financed Loan",
          balance: sellerFinancingLoanBalanceUsed,
          ratePct: percent.sellerFinancingInterestRatePct,
          amortMonths: Math.max(1, Math.round(sellerFinancingAmortizationYears * 12)),
          active: true,
        },
      ];
    }
    if (financingMode === "hybrid") {
      return [
        {
          label: "Existing Mortgage",
          balance: financing.hybridExistingMortgageBalance,
          ratePct: percent.hybridExistingMortgageRatePct,
          amortMonths: hybridExistingMortgageEffectiveAmortization.months ?? 1,
          active: hybridExistingMortgageEffectiveAmortization.months !== null,
        },
        {
          label: "Seller-Financed Balance",
          balance: hybridSellerFinancedBalanceUsed,
          ratePct: percent.hybridSellerFinanceRatePct,
          amortMonths: TRADITIONAL_NUM_PAYMENTS,
          // Never amortizes on its own while monthly seller-finance
          // payments are disabled -- the full balance simply carries,
          // exactly like everywhere else Hybrid's optional payment is
          // modeled.
          active: hybridSellerFinancePaymentsRequired,
        },
      ];
    }
    if (financingMode === "stackMethod") {
      return [
        {
          label: "First-Position Bank Loan",
          balance: stackBankLoanAmount,
          ratePct: percent.stackBankInterestRatePct,
          amortMonths: stackBankAmortMonths,
          active: true,
        },
        {
          label: "Seller-Financed Balance",
          balance: stackSellerFinancedBalance,
          ratePct: percent.stackSellerFinanceRatePct,
          amortMonths: stackSellerAmortMonths,
          active: stackSellerFinancePaymentsRequired,
        },
      ];
    }
    return [];
  }, [
    financingMode,
    traditionalLoanBalance,
    percent.traditionalInterestRatePct,
    financing.loanBalance,
    percent.loanInterestRatePct,
    subjectToEffectiveAmortization.months,
    sellerFinancingLoanBalanceUsed,
    percent.sellerFinancingInterestRatePct,
    sellerFinancingAmortizationYears,
    financing.hybridExistingMortgageBalance,
    percent.hybridExistingMortgageRatePct,
    hybridExistingMortgageEffectiveAmortization.months,
    hybridSellerFinancedBalanceUsed,
    percent.hybridSellerFinanceRatePct,
    hybridSellerFinancePaymentsRequired,
    stackBankLoanAmount,
    percent.stackBankInterestRatePct,
    stackBankAmortMonths,
    stackSellerFinancedBalance,
    percent.stackSellerFinanceRatePct,
    stackSellerAmortMonths,
    stackSellerFinancePaymentsRequired,
  ]);

  // Traditional Financing never has a balloon at all, so this is always
  // null for that structure; the other four are null unless that
  // structure's own Balloon Exists toggle is Yes.
  const activeRoiBalloon: RoiBalloonConfig | null = useMemo(() => {
    if (financingMode === "subjectTo" && subjectToBalloonExists) {
      return {
        balloonYears: subjectToBalloonYears,
        refinanceAtBalloon: subjectToRefinanceAtBalloon,
        refinanceRatePct: subjectToRefinanceRateUsed,
      };
    }
    if (financingMode === "sellerFinancing" && sellerFinancingBalloonExists) {
      return {
        balloonYears: sellerFinancingBalloonYears,
        refinanceAtBalloon: sellerFinancingRefinanceAtBalloon,
        refinanceRatePct: sellerFinancingRefinanceRateUsed,
      };
    }
    if (financingMode === "hybrid" && hybridBalloonExists) {
      return {
        balloonYears: hybridBalloonYears,
        refinanceAtBalloon: hybridRefinanceAtBalloon,
        refinanceRatePct: hybridRefinanceRateUsed,
      };
    }
    if (financingMode === "stackMethod" && stackBalloonExists) {
      return {
        balloonYears: stackBalloonYears,
        refinanceAtBalloon: stackRefinanceAtBalloon,
        refinanceRatePct: stackRefinanceRateUsed,
      };
    }
    return null;
  }, [
    financingMode,
    subjectToBalloonExists,
    subjectToBalloonYears,
    subjectToRefinanceAtBalloon,
    subjectToRefinanceRateUsed,
    sellerFinancingBalloonExists,
    sellerFinancingBalloonYears,
    sellerFinancingRefinanceAtBalloon,
    sellerFinancingRefinanceRateUsed,
    hybridBalloonExists,
    hybridBalloonYears,
    hybridRefinanceAtBalloon,
    hybridRefinanceRateUsed,
    stackBalloonExists,
    stackBalloonYears,
    stackRefinanceAtBalloon,
    stackRefinanceRateUsed,
  ]);

  // ONE shared Annual Property Appreciation assumption per structure --
  // the same percent key used by Balloon Refinance Analysis above, so
  // editing it in either place updates both features everywhere
  // (website, print, and Excel export).
  const activeRoiAppreciationPct =
    financingMode === "traditional"
      ? percent.traditionalAppreciationPct
      : financingMode === "subjectTo"
        ? percent.subjectToBalloonAppreciationPct
        : financingMode === "sellerFinancing"
          ? percent.sellerFinancingBalloonAppreciationPct
          : financingMode === "hybrid"
            ? percent.hybridBalloonAppreciationPct
            : financingMode === "stackMethod"
              ? percent.stackBalloonAppreciationPct
              : 2;

  // The single source of truth for every 30-Year ROI Projection figure
  // shown anywhere (on-page summary cards/table/chart, the printable
  // report, and the Excel export): built once here via the shared
  // buildRoiProjection engine.
  const activeRoiProjection: RoiProjectionResult | null = useMemo(() => {
    if (financingMode === "") return null;
    return buildRoiProjection({
      purchasePrice: financing.purchasePrice,
      appreciationPct: activeRoiAppreciationPct,
      totalCapitalRequired: results.totalCapitalRequired,
      annualNetCashFlow: results.annualCashFlow,
      legs: activeRoiLegs,
      balloon: activeRoiBalloon,
    });
  }, [
    financingMode,
    financing.purchasePrice,
    activeRoiAppreciationPct,
    results.totalCapitalRequired,
    results.annualCashFlow,
    activeRoiLegs,
    activeRoiBalloon,
  ]);

  // Traditional Financing always labels its calculated loan payment
  // "Estimated Monthly Principal and Interest Payment" (never PITI,
  // since taxes and insurance are always shown and added separately, not
  // folded into the payment itself).
  const monthlyPaymentLabel =
    financingMode === "traditional"
      ? "Estimated Monthly Principal and Interest Payment"
      : financingMode === "sellerFinancing"
        ? "Monthly Principal & Interest"
        : paymentType === "piti"
          ? "Monthly PITI Payment"
          : "Monthly Principal and Interest Payment";

  // The complete monthly housing cost (loan payment, plus taxes and
  // insurance when the payment type is Principal and Interest Only, or
  // always for Traditional Financing) is used as a single line item in
  // several places (the Expenses/Operating Expenses breakdown, the
  // on-screen expense summary, and the print report). It is never
  // labeled with the generic term "Housing Payment": in PITI mode this
  // figure literally is the PITI payment, so it is labeled "Monthly PITI
  // Payment"; in Principal and Interest Only mode it is the P&I payment
  // plus taxes and insurance combined, so it keeps the more precise
  // "Monthly Housing Payment" label already used elsewhere in this
  // report for that same combined figure (calling it "Monthly Principal
  // & Interest Payment" would be inaccurate, since that label is
  // reserved for the P&I-only amount shown separately); for Traditional
  // Financing that same combined figure is principal, interest, taxes,
  // and insurance together, so it is labeled "Estimated Monthly PITI";
  // for Hybrid it combines the Subject-To PITI payment with a separate
  // seller-finance payment, so it is labeled "Total Monthly Housing
  // Payment" rather than PITI, since PITI alone would be inaccurate.
  const housingPaymentLabel =
    financingMode === "traditional"
      ? "Estimated Monthly PITI"
      : financingMode === "hybrid" || financingMode === "stackMethod" || financingMode === "sellerFinancing"
        ? "Total Monthly Housing Payment"
        : paymentType === "piti"
          ? "Monthly PITI Payment"
          : "Monthly Housing Payment";

  // Print-only label: the printable report shows "Total PITI" wherever
  // the on-page/CSV label would read "Total Monthly Housing Payment"
  // (Hybrid and Stack Method). Seller Financing is deliberately excluded
  // from this PITI relabeling -- its loan payment is always principal
  // and interest only, taxes and insurance are always shown and added
  // separately, and it must never be described as PITI anywhere,
  // including print. Every other mode's label (e.g. "Estimated Monthly
  // PITI", "Monthly Housing Payment") is unchanged in print. This is
  // deliberately separate from housingPaymentLabel, which continues to
  // drive the on-page Monthly Expense Summary and the CSV/on-page Full
  // Underwriting Breakdown unchanged.
  const printHousingPaymentLabel =
    financingMode !== "sellerFinancing" && housingPaymentLabel === "Total Monthly Housing Payment"
      ? "Total PITI"
      : housingPaymentLabel;

  // Financing Structure is a single-select mode (see getFinancingStructureLabel
  // above), computed once here so the breakdown, CSV, and print report
  // all read the same label.
  const financingStructureLabel = getFinancingStructureLabel(financingMode);

  // The down payment label shown alongside downPaymentForCapital
  // (results.downPaymentForCapital): "Estimated Down Payment" for
  // Traditional Financing (the calculated Purchase Price x Down Payment
  // Percentage amount), or "Seller Down Payment" otherwise, matching
  // whichever field is actually in use.
  // Stack Method no longer uses a single down-payment-style line item in
  // Total Capital Required (see stackBaseCapitalRequired and
  // stackClosingCashAdjustment in the results calculation above, and the
  // dedicated Capital Required Reconciliation in the breakdown/print
  // sections), so this label is never actually shown for that structure.
  const downPaymentLabel = financingMode === "traditional" ? "Estimated Down Payment" : "Seller Down Payment";

  // ---------------------------------------------------------------------
  // Shared breakdown data: the on-page "View Full Underwriting Breakdown"
  // table uses these five sections directly. The CSV/print summary uses
  // the same five sections with an "Inputs" section prepended.
  // ---------------------------------------------------------------------
  const breakdownSections: BreakdownSection[] = useMemo(
    () => [
      {
        title: "Property and Financing",
        rows:
          financingMode === "traditional"
            ? [
                { label: "Property Address", value: propertyAddress.trim() || "Not entered" },
                { label: "Financing Structure", value: financingStructureLabel },
                { label: "Purchase Price", value: formatCents(financing.purchasePrice) },
                {
                  label: "Down Payment Percentage",
                  value: formatPercent(traditionalEffectiveDownPaymentPct),
                },
                { label: "Estimated Down Payment", value: formatCents(traditionalDownPaymentAmount) },
                { label: "Estimated Loan Balance", value: formatCents(traditionalLoanBalance) },
                { label: "Interest Rate", value: formatPercent(percent.traditionalInterestRatePct) },
                { label: "Amortization Term", value: "30 Years (360 Monthly Payments)" },
                {
                  label: "Monthly Principal and Interest",
                  value: formatCents(traditionalMonthlyPI),
                },
                { label: "Annual Property Taxes", value: formatCents(financing.annualPropertyTaxes) },
                {
                  label: "Annual Property Insurance",
                  value: formatCents(financing.annualPropertyInsurance),
                },
                { label: "Estimated Monthly PITI", value: formatCents(results.monthlyHousingPayment) },
                { label: "Estimated Equity", value: formatCents(results.equity) },
              ]
            : financingMode === "hybrid"
              ? [
                  { label: "Property Address", value: propertyAddress.trim() || "Not entered" },
                  { label: "Financing Structure", value: financingStructureLabel },
                  { label: "Purchase Price", value: formatCents(financing.purchasePrice) },
                  {
                    label: "Existing Mortgage Balance",
                    value: formatCents(financing.hybridExistingMortgageBalance),
                  },
                  { label: "Estimated Equity", value: formatCents(results.equity) },
                  { label: "Seller Down Payment", value: formatCents(financing.sellerDownPayment) },
                  {
                    label: "Suggested Seller-Financed Balance",
                    value: formatCents(hybridSuggestedSellerFinancedBalance),
                  },
                  {
                    label: "Seller-Financed Balance Used",
                    value: formatCents(hybridSellerFinancedBalanceUsed),
                  },
                  {
                    label: "Monthly Subject-To PITI Payment",
                    value: formatCents(financing.hybridSubjectToPITI),
                  },
                  {
                    label: "Are Monthly Seller Finance Payments Required?",
                    value: hybridSellerFinancePaymentsRequired ? "Yes" : "No",
                  },
                  ...(hybridSellerFinancePaymentsRequired
                    ? [
                        {
                          label: "Seller Finance Interest Rate",
                          value: formatPercent(percent.hybridSellerFinanceRatePct),
                        },
                        { label: "Seller Finance Amortization Term", value: "30 Years (360 Monthly Payments)" },
                      ]
                    : []),
                  {
                    label: "Monthly Seller Finance Payment",
                    value: hybridSellerFinancePaymentsRequired
                      ? formatCents(hybridMonthlySellerFinancePayment)
                      : "Not Included",
                  },
                  { label: "Total PITI", value: formatCents(results.monthlyHousingPayment) },
                ]
              : financingMode === "stackMethod"
                ? [
                    { label: "Property Address", value: propertyAddress.trim() || "Not entered" },
                    { label: "Financing Structure", value: financingStructureLabel },
                    { label: "Purchase Price", value: formatCents(financing.purchasePrice) },
                    { label: "Bank Loan-to-Value Percentage", value: formatPercent(stackEffectiveBankLtvPct) },
                    { label: "Estimated First-Position Bank Loan", value: formatCents(stackBankLoanAmount) },
                    { label: "Estimated Seller-Financed Balance", value: formatCents(stackSellerFinancedBalance) },
                    { label: "Total Debt at Acquisition", value: formatCents(stackTotalDebtAtAcquisition) },
                    {
                      label: "Current Leverage Ratio",
                      value: formatLeverageRatio(stackLeverageRatioDecimal),
                    },
                    { label: "Bank Interest Rate", value: formatPercent(percent.stackBankInterestRatePct) },
                    {
                      label: "Bank Amortization",
                      value: `${stackBankAmortizationYears} Years (${stackBankAmortMonths} Monthly Payments)`,
                    },
                    { label: "Monthly Bank Principal and Interest", value: formatCents(stackBankMonthlyPI) },
                    { label: "Annual Property Taxes", value: formatCents(financing.annualPropertyTaxes) },
                    { label: "Annual Property Insurance", value: formatCents(financing.annualPropertyInsurance) },
                    { label: "Estimated Monthly Bank PITI", value: formatCents(stackMonthlyBankPITI) },
                    { label: "Down Payment to Seller", value: formatCents(financing.stackDownPaymentToSeller) },
                    {
                      label: "Are Monthly Seller Finance Payments Required?",
                      value: stackSellerFinancePaymentsRequired ? "Yes" : "No",
                    },
                    ...(stackSellerFinancePaymentsRequired
                      ? [
                          {
                            label: "Seller Finance Interest Rate",
                            value: formatPercent(percent.stackSellerFinanceRatePct),
                          },
                          {
                            label: "Seller Finance Amortization",
                            value: `${stackSellerFinanceAmortizationYears} Years (${stackSellerAmortMonths} Monthly Payments)`,
                          },
                        ]
                      : []),
                    {
                      label: "Monthly Seller Finance Payment",
                      value: stackSellerFinancePaymentsRequired
                        ? formatCents(stackMonthlySellerFinancePayment)
                        : "Not Included",
                    },
                    { label: "Total Monthly Housing Payment", value: formatCents(results.monthlyHousingPayment) },
                    { label: "Cash to Close, Leg 1", value: formatCents(stackCashToCloseLeg1) },
                    { label: "Transactional Funding Fee", value: formatCents(stackTransactionalFundingFee) },
                    {
                      label:
                        stackEstimatedBuyerCashAtClosing < 0
                          ? "Estimated Buyer Cash Required"
                          : "Estimated Cash to Buyer at Closing",
                      value: formatCents(Math.abs(stackEstimatedBuyerCashAtClosing)),
                    },
                    {
                      label: "Can This Be Purchased for an Estimated $0 Out of Pocket?",
                      value: stackZeroOutOfPocket,
                    },
                    { label: "Base Capital Required", value: formatCents(results.stackBaseCapitalRequired) },
                    {
                      label: "Closing Cash Adjustment",
                      value:
                        stackEstimatedBuyerCashAtClosing >= 0
                          ? `-${formatCents(stackEstimatedBuyerCashAtClosing)}`
                          : `+${formatCents(Math.abs(stackEstimatedBuyerCashAtClosing))}`,
                    },
                    {
                      label: "Adjusted Total Capital Required",
                      value: formatCents(results.totalCapitalRequired),
                    },
                  ]
                : financingMode === "sellerFinancing"
                  ? [
                      { label: "Property Address", value: propertyAddress.trim() || "Not entered" },
                      { label: "Financing Structure", value: financingStructureLabel },
                      { label: "Purchase Price", value: formatCents(financing.purchasePrice) },
                      {
                        label: "Down Payment Percentage",
                        value: formatPercent(sellerFinancingDownPaymentPctResolved),
                      },
                      {
                        label: "Down Payment Dollar Amount",
                        value: formatCents(sellerFinancingDownPaymentAmountResolved),
                      },
                      { label: "Seller-Finance Loan Balance", value: formatCents(sellerFinancingLoanBalanceUsed) },
                      {
                        label: "Loan Balance Source",
                        value: sellerFinancingLoanBalanceIsManual
                          ? "Manual Override"
                          : "Automatically Calculated",
                      },
                      { label: "Estimated Equity", value: formatCents(results.equity) },
                      {
                        label: "Seller Financing Interest Rate",
                        value: formatPercent(percent.sellerFinancingInterestRatePct),
                      },
                      { label: "Amortization Term", value: `${sellerFinancingAmortizationYears} Years` },
                      { label: "Monthly Principal & Interest", value: formatCents(sellerFinancingMonthlyPI) },
                      { label: "Annual Property Taxes", value: formatCents(financing.annualPropertyTaxes) },
                      { label: "Annual Property Insurance", value: formatCents(financing.annualPropertyInsurance) },
                      { label: housingPaymentLabel, value: formatCents(results.monthlyHousingPayment) },
                    ]
                  : [
                      { label: "Property Address", value: propertyAddress.trim() || "Not entered" },
                      { label: "Financing Structure", value: financingStructureLabel },
                      { label: "Purchase Price", value: formatCents(financing.purchasePrice) },
                      { label: "Loan Balance", value: formatCents(financing.loanBalance) },
                      { label: "Estimated Equity", value: formatCents(results.equity) },
                      { label: "Seller Down Payment", value: formatCents(financing.sellerDownPayment) },
                      { label: housingPaymentLabel, value: formatCents(results.monthlyHousingPayment) },
                    ],
      },
      {
        title: "Income",
        rows: [
          { label: "Shared-Bath Bedroom Income", value: formatCents(results.monthlySharedBathRent) },
          { label: "Ensuite Bedroom Income", value: formatCents(results.monthlyEnsuiteRent) },
          { label: "Gross Monthly Rent", value: formatCents(results.grossMonthlyRent) },
          { label: "Vacancy", value: formatCents(results.vacancyExpense) },
          { label: "Effective Monthly Rent", value: formatCents(results.effectiveRentAfterVacancy) },
        ],
      },
      {
        title: "Expenses",
        rows: [
          { label: housingPaymentLabel, value: formatCents(results.monthlyHousingPayment) },
          { label: "Platform Fee Percentage", value: formatPercent(percent.platformFeePct) },
          { label: "Platform Fees", value: formatCents(results.platformFees) },
          { label: "Property Management", value: formatCents(results.propertyManagementFee) },
          { label: "Maintenance", value: formatCents(results.maintenanceMonthly) },
          { label: "Utilities", value: formatCents(results.utilitiesMonthly) },
          { label: "Cleaning", value: formatCents(results.cleaningMonthly) },
          { label: "Lawn Care", value: formatCents(results.lawnCareMonthly) },
          { label: "Pest Control", value: formatCents(results.pestControlMonthly) },
          {
            label: "Total Monthly Expenses",
            value: formatCents(results.totalMonthlyOperatingExpenses),
            isTotal: true,
          },
        ],
      },
      {
        title: "Capital Required",
        rows:
          financingMode === "stackMethod"
            ? [
                { label: "Renovation Cost", value: formatCents(capital.renovationCost) },
                { label: "Furniture", value: formatCents(capital.furniture) },
                { label: "Appliances", value: formatCents(capital.appliances) },
                { label: "Photos", value: formatCents(capital.photos) },
                { label: "Holding Costs", value: formatCents(results.holdingCosts) },
                { label: "Reserves", value: formatCents(capital.reserves) },
                { label: "Acquisition Fee", value: formatCents(capital.acquisitionFee) },
                { label: "TC Fee", value: formatCents(capital.stackTcFee) },
                { label: "LLC Entity Formation Cost", value: formatCents(capital.stackLlcFee) },
                {
                  label: "Bank Loan Down Payment, Stack Method Closing Costs, Agent Fees, and Assignment Fee",
                  value: "Included in Cash to Close, Leg 1 above",
                },
                { label: "Base Capital Required", value: formatCents(results.stackBaseCapitalRequired) },
                {
                  label:
                    stackEstimatedBuyerCashAtClosing >= 0
                      ? "Estimated Cash to Buyer at Closing"
                      : "Estimated Buyer Cash Required",
                  value:
                    stackEstimatedBuyerCashAtClosing >= 0
                      ? `-${formatCents(stackEstimatedBuyerCashAtClosing)}`
                      : `+${formatCents(Math.abs(stackEstimatedBuyerCashAtClosing))}`,
                },
                {
                  label: "Total Capital Required",
                  value: formatCents(results.totalCapitalRequired),
                  isTotal: true,
                },
                ...(results.stackNetCashToBuyerAfterProjectCosts > 0
                  ? [
                      {
                        label: "Net Cash to Buyer After Project Costs",
                        value: formatCents(results.stackNetCashToBuyerAfterProjectCosts),
                      },
                    ]
                  : []),
              ]
            : [
                { label: downPaymentLabel, value: formatCents(results.downPaymentForCapital) },
                ...(financingMode === "traditional" || financingMode === "sellerFinancing"
                  ? []
                  : [{ label: "Arrears", value: formatCents(capital.arrears) }]),
                { label: "Renovation Cost", value: formatCents(capital.renovationCost) },
                { label: "Furniture", value: formatCents(capital.furniture) },
                { label: "Appliances", value: formatCents(capital.appliances) },
                { label: "Photos", value: formatCents(capital.photos) },
                { label: "Holding Costs", value: formatCents(results.holdingCosts) },
                { label: "Reserves", value: formatCents(capital.reserves) },
                ...(financingMode === "traditional"
                  ? []
                  : [{ label: "Upfront Insurance", value: formatCents(capital.upfrontInsurance) }]),
                { label: "Acquisition Fee", value: formatCents(capital.acquisitionFee) },
                ...(financingMode === "traditional"
                  ? [
                      { label: "TC Fee", value: formatCents(capital.traditionalTcFee) },
                      { label: "LLC Entity Formation Cost", value: formatCents(capital.traditionalLlcFee) },
                    ]
                  : financingMode === "subjectTo"
                    ? [
                        { label: "TC Fee", value: formatCents(capital.subjectToTcFee) },
                        { label: "LLC Entity Formation Cost", value: formatCents(capital.subjectToLlcFee) },
                      ]
                    : financingMode === "hybrid"
                      ? [
                          { label: "TC Fee", value: formatCents(capital.hybridTcFee) },
                          { label: "LLC Entity Formation Cost", value: formatCents(capital.hybridLlcFee) },
                        ]
                      : [
                          { label: "TC Fee", value: formatCents(capital.sellerFinancingTcFee) },
                          {
                            label: "LLC Entity Formation Cost",
                            value: formatCents(capital.sellerFinancingLlcFee),
                          },
                        ]),
                ...(financingMode === "traditional"
                  ? [
                      {
                        label: "Traditional Closing Cost Percentage",
                        value: formatPercent(percent.traditionalClosingCostPct),
                      },
                      {
                        label: "Traditional Financing Closing Costs",
                        value: formatCents(results.closingCosts),
                      },
                      { label: "Agent Fee", value: formatCents(capital.agentFee) },
                      { label: "Assignment Fee", value: formatCents(capital.assignmentFee) },
                    ]
                  : [
                      {
                        label: "Estimated Closing Cost Percentage",
                        value: formatPercent(percent.closingCostPct),
                      },
                      { label: "Closing Costs", value: formatCents(results.closingCosts) },
                      { label: "Agent Fee", value: formatCents(capital.agentFee) },
                      { label: "Assignment Fee", value: formatCents(capital.assignmentFee) },
                    ]),
                {
                  label: "Total Capital Required",
                  value: formatCents(results.totalCapitalRequired),
                  isTotal: true,
                },
              ],
      },
      {
        title: "Returns",
        rows: [
          { label: "Monthly Cash Flow", value: formatCents(results.monthlyCashFlow) },
          { label: "Annual Cash Flow", value: formatCents(results.annualCashFlow) },
          {
            label: "Cash-on-Cash Return",
            value: results.cashOnCashReturn === null ? stackCocrLabel : formatPercent(results.cashOnCashReturn),
            isTotal: true,
          },
        ],
      },
    ],
    [
      results,
      financing,
      capital,
      percent,
      propertyAddress,
      financingStructureLabel,
      housingPaymentLabel,
      downPaymentLabel,
      financingMode,
      traditionalDownPaymentAmount,
      traditionalLoanBalance,
      traditionalMonthlyPI,
      hybridSuggestedSellerFinancedBalance,
      hybridSellerFinancedBalanceUsed,
      hybridSellerFinancePaymentsRequired,
      hybridMonthlySellerFinancePayment,
      stackBankLoanAmount,
      stackSellerFinancedBalance,
      stackTotalDebtAtAcquisition,
      stackLeverageRatio,
      stackLeverageRatioDecimal,
      stackBankAmortizationYears,
      stackBankAmortMonths,
      stackBankMonthlyPI,
      stackMonthlyBankPITI,
      stackSellerFinanceAmortizationYears,
      stackSellerAmortMonths,
      stackMonthlySellerFinancePayment,
      stackCashToCloseLeg1,
      stackTransactionalFundingFee,
      stackEstimatedBuyerCashAtClosing,
      stackSellerFinancePaymentsRequired,
      stackZeroOutOfPocket,
      stackEffectiveBankLtvPct,
      traditionalEffectiveDownPaymentPct,
      sellerFinancingDownPaymentPctResolved,
      sellerFinancingDownPaymentAmountResolved,
      sellerFinancingLoanBalanceUsed,
      sellerFinancingLoanBalanceIsManual,
      sellerFinancingAmortizationYears,
      sellerFinancingMonthlyPI,
    ]
  );

  const inputsSection: BreakdownSection = useMemo(
    () => ({
      title: "Inputs",
      rows: [
        { label: "Property Address", value: propertyAddress.trim() || "Not entered" },
        { label: "Video Walkthrough Link", value: videoWalkthroughLink.trim() || "Not entered" },
        // Property Files: never exports binary data, base64 strings, or
        // temporary object URLs -- only the counts (total, image-kind,
        // and PDF-kind) that describe what was uploaded.
        { label: "Property File Count", value: String(propertyImages.length) },
        {
          label: "Property Image Count",
          value: String(propertyImages.filter((f) => f.kind === "image").length),
        },
        {
          label: "Property PDF Count",
          value: String(propertyImages.filter((f) => f.kind === "pdf").length),
        },
        { label: "Floor Plan Uploaded", value: floorPlan ? "Yes" : "No" },
        {
          label: "Floor Plan File Type",
          value: floorPlan ? (floorPlan.kind === "pdf" ? "PDF" : "Image") : "Not Applicable",
        },
        { label: "Floor Plan Filename", value: floorPlan?.name || "Not entered" },
        {
          label: "PadSplit Rental Data Uploaded",
          value: padSplitScreenshot ? "Yes" : "No",
        },
        {
          label: "PadSplit Rental Data File Type",
          value: padSplitScreenshot
            ? padSplitScreenshot.kind === "pdf"
              ? "PDF"
              : "Image"
            : "Not Applicable",
        },
        { label: "PadSplit Rental Data Filename", value: padSplitScreenshot?.name || "Not entered" },
        { label: "Purchase Price", value: formatWhole(financing.purchasePrice) },
        ...(financingMode === "traditional"
          ? [
              {
                label: "Down Payment Percentage",
                value: formatPercent(traditionalEffectiveDownPaymentPct),
              },
              { label: "Estimated Down Payment", value: formatWhole(traditionalDownPaymentAmount) },
              { label: "Estimated Loan Balance", value: formatWhole(traditionalLoanBalance) },
              { label: "Interest Rate", value: formatPercent(percent.traditionalInterestRatePct) },
              { label: "Amortization Term", value: "30 Years (360 Monthly Payments)" },
              { label: "Estimated Equity", value: formatWhole(results.equity) },
              {
                label: "Monthly Principal and Interest",
                value: formatCents(traditionalMonthlyPI),
              },
              {
                label: "Traditional Closing Cost Percentage",
                value: formatPercent(percent.traditionalClosingCostPct),
              },
              {
                label: "Estimated Monthly Long-Term Rent",
                value:
                  traditionalLongTermRent === null ? "Not entered" : formatCents(traditionalLongTermRent),
              },
              { label: "Estimated Monthly PITI", value: formatCents(results.monthlyHousingPayment) },
              { label: "Selected LTV", value: formatPercent(traditionalSelectedLtvPct) },
              {
                label: "Required Down Payment Percentage",
                value: formatPercent(traditionalEffectiveDownPaymentPct),
              },
              {
                label: "Long-Term Rent LTV Status",
                value:
                  traditionalLongTermRent === null
                    ? "No long-term rent entered."
                    : traditionalLongTermRent >= traditionalPITIAt80
                      ? "Estimated long-term rent supports the monthly PITI. Proceeding with an 80% LTV assumption."
                      : "Estimated long-term rent is below the monthly PITI. Using a more conservative 75% LTV assumption.",
              },
            ]
          : financingMode === "hybrid"
            ? [
                {
                  label: "Existing Mortgage Balance",
                  value: formatWhole(financing.hybridExistingMortgageBalance),
                },
                { label: "Seller Down Payment", value: formatWhole(financing.sellerDownPayment) },
                { label: "Estimated Equity", value: formatWhole(results.equity) },
                {
                  label: "Suggested Seller-Financed Balance",
                  value: formatWhole(hybridSuggestedSellerFinancedBalance),
                },
                {
                  label: "Seller-Financed Balance Used",
                  value: formatWhole(hybridSellerFinancedBalanceUsed),
                },
                {
                  label: "Manual Seller-Financed Balance Override",
                  value: hybridSellerFinancedBalanceIsManual ? "Yes" : "No",
                },
                {
                  label: "Monthly Subject-To PITI Payment",
                  value: formatCents(financing.hybridSubjectToPITI),
                },
                {
                  label: "Are Monthly Seller Finance Payments Required?",
                  value: hybridSellerFinancePaymentsRequired ? "Yes" : "No",
                },
                {
                  label: "Seller-Finance Repayment Structure",
                  value: hybridSellerFinanceRepaymentStructure,
                },
                ...(hybridSellerFinancePaymentsRequired
                  ? [
                      {
                        label: "Seller Finance Interest Rate",
                        value: formatPercent(percent.hybridSellerFinanceRatePct),
                      },
                      { label: "Seller Finance Amortization Term", value: "30 Years (360 Monthly Payments)" },
                    ]
                  : []),
                {
                  label: "Monthly Seller Finance Payment",
                  value: hybridSellerFinancePaymentsRequired
                    ? formatCents(hybridMonthlySellerFinancePayment)
                    : formatCents(0),
                },
                { label: "Estimated Closing Cost Percentage", value: formatPercent(percent.closingCostPct) },
                ...(hybridBalloonAnalysis
                  ? balloonAnalysisRows(hybridBalloonAnalysis, [
                      {
                        label: "Existing Subject-To Balance at Balloon",
                        value: hybridBalloonAnalysis.mortgageBalanceAtBalloon,
                      },
                      {
                        label: "Seller-Finance Balance at Balloon",
                        value: hybridBalloonAnalysis.sellerFinanceBalanceAtBalloon,
                      },
                    ])
                  : [{ label: "Balloon Exists", value: "No" }]),
              ]
            : financingMode === "stackMethod"
              ? [
                  { label: "Bank Loan-to-Value Percentage", value: formatPercent(stackEffectiveBankLtvPct) },
                  {
                    label: "Stack Method Closing Cost Percentage",
                    value: formatPercent(percent.stackClosingCostPct),
                  },
                  {
                    label: "Agent Commission Percentage",
                    value: formatPercent(percent.stackAgentCommissionPct),
                  },
                  { label: "Assignment Fee", value: formatWhole(capital.assignmentFee) },
                  {
                    label: "Transactional Funding Fee Percentage",
                    value: formatPercent(percent.stackTransactionalFundingFeePct),
                  },
                  {
                    label: "Seller's Current First Loan Balance",
                    value: formatWhole(financing.stackSellerFirstLoanBalance),
                  },
                  { label: "Existing Second Lien", value: formatWhole(financing.stackSellerSecondLien) },
                  { label: "Miscellaneous Liens", value: formatWhole(financing.stackMiscLiens) },
                  { label: "Down Payment to Seller", value: formatWhole(financing.stackDownPaymentToSeller) },
                  { label: "Estimated First-Position Bank Loan", value: formatWhole(stackBankLoanAmount) },
                  {
                    label: "Estimated Seller-Financed Balance",
                    value: formatWhole(stackSellerFinancedBalance),
                  },
                  { label: "Total Debt at Acquisition", value: formatWhole(stackTotalDebtAtAcquisition) },
                  {
                    label: "Current Leverage Ratio",
                    value: formatLeverageRatio(stackLeverageRatioDecimal),
                  },
                  { label: "Bank Interest Rate", value: formatPercent(percent.stackBankInterestRatePct) },
                  { label: "Bank Amortization", value: `${stackBankAmortizationYears} Years` },
                  {
                    label: "Are Monthly Seller Finance Payments Required?",
                    value: stackSellerFinancePaymentsRequired ? "Yes" : "No",
                  },
                  ...(stackSellerFinancePaymentsRequired
                    ? [
                        {
                          label: "Seller Finance Interest Rate",
                          value: formatPercent(percent.stackSellerFinanceRatePct),
                        },
                        {
                          label: "Seller Finance Amortization",
                          value: `${stackSellerFinanceAmortizationYears} Years`,
                        },
                      ]
                    : []),
                  {
                    label: "Estimated Monthly Seller Finance Payment",
                    value: stackSellerFinancePaymentsRequired
                      ? formatCents(stackMonthlySellerFinancePayment)
                      : "Not Included",
                  },
                  { label: "Base Capital Required", value: formatWhole(results.stackBaseCapitalRequired) },
                  {
                    label: "Signed Buyer Closing Result",
                    value: formatCents(stackEstimatedBuyerCashAtClosing),
                  },
                  {
                    label: "Estimated Cash to Buyer at Closing",
                    value:
                      stackEstimatedBuyerCashAtClosing >= 0
                        ? formatCents(stackEstimatedBuyerCashAtClosing)
                        : formatCents(0),
                  },
                  {
                    label: "Estimated Buyer Cash Required",
                    value:
                      stackEstimatedBuyerCashAtClosing < 0
                        ? formatCents(Math.abs(stackEstimatedBuyerCashAtClosing))
                        : formatCents(0),
                  },
                  {
                    label: "Can This Be Purchased for an Estimated $0 Out of Pocket?",
                    value: stackZeroOutOfPocket,
                  },
                  { label: "Adjusted Total Capital Required", value: formatWhole(results.totalCapitalRequired) },
                  ...(stackBalloonAnalysis
                    ? balloonAnalysisRows(
                        stackBalloonAnalysis,
                        [
                          { label: "First-Position Loan Balance at Balloon", value: stackBalloonAnalysis.bankBalanceAtBalloon },
                          { label: "Seller-Finance Balance at Balloon", value: stackBalloonAnalysis.sellerBalanceAtBalloon },
                        ],
                        true
                      )
                    : [{ label: "Balloon Exists", value: "No" }]),
                ]
              : [
                  { label: "Loan Balance", value: formatWhole(financing.loanBalance) },
                  { label: "Seller Down Payment", value: formatWhole(financing.sellerDownPayment) },
                  { label: "Estimated Equity", value: formatWhole(results.equity) },
                  {
                    label: "Monthly Payment Type",
                    value: paymentType === "piti" ? "PITI" : "Principal and Interest Only",
                  },
                  { label: monthlyPaymentLabel, value: formatCents(financing.monthlyPayment) },
                  { label: "Estimated Closing Cost Percentage", value: formatPercent(percent.closingCostPct) },
                  ...(financingMode === "subjectTo" && subjectToBalloonAnalysis
                    ? balloonAnalysisRows(subjectToBalloonAnalysis, [
                        {
                          label: "Projected Existing Mortgage Balance at Balloon",
                          value: subjectToBalloonAnalysis.mortgageBalanceAtBalloon,
                        },
                      ])
                    : financingMode === "sellerFinancing" && sellerFinancingBalloonAnalysis
                      ? balloonAnalysisRows(sellerFinancingBalloonAnalysis, [
                          {
                            label: "Projected Seller-Finance Balance at Balloon",
                            value: sellerFinancingBalloonAnalysis.sellerFinanceBalanceAtBalloon,
                          },
                        ])
                      : financingMode === "subjectTo" || financingMode === "sellerFinancing"
                        ? [{ label: "Balloon Exists", value: "No" }]
                        : []),
                ]),
        { label: "Annual Property Taxes", value: formatWhole(financing.annualPropertyTaxes) },
        { label: "Annual Property Insurance", value: formatWhole(financing.annualPropertyInsurance) },
        { label: "Shared-Bath Bedrooms", value: String(sharedBathBedrooms) },
        { label: "Weekly Shared-Bath Rent", value: formatCents(weeklySharedBathRent) },
        { label: "Ensuite Bedrooms", value: String(ensuiteBedrooms) },
        { label: "Weekly Ensuite Rent", value: formatCents(weeklyEnsuiteRent) },
        { label: "Total Bedrooms", value: String(results.totalBedrooms) },
        { label: "Vacancy", value: formatPercent(percent.vacancyPct) },
        { label: "Platform Fee Percentage", value: formatPercent(percent.platformFeePct) },
        { label: "Local Property Manager", value: formatPercent(percent.propertyManagementPct) },
        { label: "Cleaning", value: formatCents(maintenanceExpenses.cleaning) },
        { label: "Lawn Care", value: formatCents(maintenanceExpenses.lawnCare) },
        { label: "Pest Control", value: formatCents(maintenanceExpenses.pestControl) },
        {
          label: "Holding Costs Source",
          value: results.holdingCostsIsManual ? "Manually overridden" : "Automatically calculated",
        },
        ...scopeOfWorkItems.flatMap((item, index) => [
          { label: `Scope of Work Item ${index + 1} Name`, value: item.name.trim() || "Untitled Item" },
          { label: `Scope of Work Item ${index + 1} Cost`, value: formatCents(item.cost) },
        ]),
        { label: "Total Scope of Work", value: formatCents(scopeOfWorkTotal) },
        {
          label: "Use Itemized Scope of Work Total",
          value: useItemizedScopeOfWork ? "Yes" : "No",
        },
        {
          label: "Renovation Cost Used in Underwriting",
          value: formatCents(capital.renovationCost),
        },
      ],
    }),
    [
      financing,
      results,
      paymentType,
      monthlyPaymentLabel,
      sharedBathBedrooms,
      weeklySharedBathRent,
      ensuiteBedrooms,
      weeklyEnsuiteRent,
      percent,
      maintenanceExpenses,
      propertyAddress,
      videoWalkthroughLink,
      financingMode,
      traditionalDownPaymentAmount,
      traditionalLoanBalance,
      traditionalMonthlyPI,
      hybridSuggestedSellerFinancedBalance,
      hybridSellerFinancedBalanceUsed,
      hybridSellerFinancedBalanceIsManual,
      hybridSellerFinancePaymentsRequired,
      hybridSellerFinanceRepaymentStructure,
      hybridMonthlySellerFinancePayment,
      capital,
      stackBankLoanAmount,
      stackSellerFinancedBalance,
      stackTotalDebtAtAcquisition,
      stackLeverageRatio,
      stackLeverageRatioDecimal,
      stackBankAmortizationYears,
      stackSellerFinanceAmortizationYears,
      stackSellerFinancePaymentsRequired,
      stackMonthlySellerFinancePayment,
      stackEstimatedBuyerCashAtClosing,
      stackZeroOutOfPocket,
      stackEffectiveBankLtvPct,
      stackBalloonAnalysis,
      subjectToBalloonAnalysis,
      sellerFinancingBalloonAnalysis,
      hybridBalloonAnalysis,
      traditionalLongTermRent,
      traditionalSelectedLtvPct,
      traditionalEffectiveDownPaymentPct,
      traditionalPITIAt80,
      propertyImages,
      floorPlan,
      padSplitScreenshot,
      scopeOfWorkItems,
      scopeOfWorkTotal,
      useItemizedScopeOfWork,
    ]
  );

  // inputsSection above fed the old CSV export (now replaced by the
  // Excel export in lib/underwritingExcelExport.ts, see
  // handleExportExcel); the on-page "View Full Underwriting Breakdown"
  // table reads directly from breakdownSections, unaffected.

  // Monthly Income and Expense Breakdown chart data for the printable
  // report: every figure that makes up the monthly cash flow picture, as
  // its own labeled horizontal bar, always in this same order regardless
  // of financing structure. "Total PITI" here always refers to
  // results.monthlyHousingPayment -- the exact same figure printed
  // elsewhere in the report as "Total PITI" (see printHousingPaymentLabel
  // above) -- so this chart never introduces a second, different monthly
  // housing figure.
  const monthlyIncomeExpenseBars = useMemo(
    () => [
      { label: "Gross Monthly Rent", value: results.grossMonthlyRent, color: "#12181C" },
      { label: "Effective Monthly Rent", value: results.effectiveRentAfterVacancy, color: "#12181C" },
      { label: "Total PITI", value: results.monthlyHousingPayment, color: "#C08A3E" },
      { label: "Platform Fees", value: results.platformFees, color: "#C08A3E" },
      { label: "Property Management", value: results.propertyManagementFee, color: "#C08A3E" },
      { label: "Maintenance", value: results.maintenanceMonthly, color: "#C08A3E" },
      { label: "Utilities", value: results.utilitiesMonthly, color: "#C08A3E" },
      { label: "Cleaning", value: results.cleaningMonthly, color: "#C08A3E" },
      { label: "Lawn Care", value: results.lawnCareMonthly, color: "#C08A3E" },
      { label: "Pest Control", value: results.pestControlMonthly, color: "#C08A3E" },
      { label: "Estimated Monthly Cash Flow", value: results.monthlyCashFlow, color: "#1E8E3E" },
    ],
    [
      results.grossMonthlyRent,
      results.effectiveRentAfterVacancy,
      results.monthlyHousingPayment,
      results.platformFees,
      results.propertyManagementFee,
      results.maintenanceMonthly,
      results.utilitiesMonthly,
      results.cleaningMonthly,
      results.lawnCareMonthly,
      results.pestControlMonthly,
      results.monthlyCashFlow,
    ]
  );

  // Capital Required Breakdown chart data for the printable report: the
  // same figures that make up Total Capital Required (see the
  // totalCapitalRequired calculation above), itemized as individual bars
  // rather than a donut chart. "Other Applicable Costs" is the sum of
  // every remaining small capital line item, so the bars here always add
  // up to exactly results.totalCapitalRequired (Stack Method: exactly
  // results.stackBaseCapitalRequired, before the separate signed closing
  // adjustment shown in the Capital Required Reconciliation). Zero-value
  // bars are omitted.
  const capitalRequiredBreakdownBars = useMemo(() => {
    if (financingMode === "stackMethod") {
      const otherApplicableCosts = round2(capital.photos + capital.acquisitionFee);
      return [
        { label: "Renovation", value: capital.renovationCost, color: "#4E9C6C" },
        { label: "Furniture", value: capital.furniture, color: "#4E9C6C" },
        { label: "Appliances", value: capital.appliances, color: "#4E9C6C" },
        { label: "Holding Costs", value: results.holdingCosts, color: "#8B9795" },
        { label: "Reserves", value: capital.reserves, color: "#7C9070" },
        { label: "TC Fee", value: capital.stackTcFee, color: "#C08A3E" },
        { label: "LLC Entity Formation Cost", value: capital.stackLlcFee, color: "#C08A3E" },
        { label: "Other Applicable Costs", value: otherApplicableCosts, color: "#C9BFA6" },
      ].filter((bar) => bar.value > 0);
    }
    const otherApplicableCosts = round2(
      (financingMode === "traditional" || financingMode === "sellerFinancing" ? 0 : capital.arrears) +
        (financingMode === "traditional" ? 0 : capital.upfrontInsurance) +
        capital.acquisitionFee +
        capital.photos
    );
    const tcAndLlcBars =
      financingMode === "traditional"
        ? [
            { label: "TC Fee", value: capital.traditionalTcFee, color: "#C08A3E" },
            { label: "LLC Entity Formation Cost", value: capital.traditionalLlcFee, color: "#C08A3E" },
          ]
        : financingMode === "subjectTo"
          ? [
              { label: "TC Fee", value: capital.subjectToTcFee, color: "#C08A3E" },
              { label: "LLC Entity Formation Cost", value: capital.subjectToLlcFee, color: "#C08A3E" },
            ]
          : financingMode === "hybrid"
            ? [
                { label: "TC Fee", value: capital.hybridTcFee, color: "#C08A3E" },
                { label: "LLC Entity Formation Cost", value: capital.hybridLlcFee, color: "#C08A3E" },
              ]
            : [
                { label: "TC Fee", value: capital.sellerFinancingTcFee, color: "#C08A3E" },
                { label: "LLC Entity Formation Cost", value: capital.sellerFinancingLlcFee, color: "#C08A3E" },
              ];
    return [
      { label: downPaymentLabel, value: results.downPaymentForCapital, color: "#12181C" },
      { label: "Renovation", value: capital.renovationCost, color: "#4E9C6C" },
      { label: "Furniture", value: capital.furniture, color: "#4E9C6C" },
      { label: "Appliances", value: capital.appliances, color: "#4E9C6C" },
      { label: "Holding Costs", value: results.holdingCosts, color: "#8B9795" },
      { label: "Reserves", value: capital.reserves, color: "#7C9070" },
      ...tcAndLlcBars,
      { label: "Closing Costs", value: results.closingCosts, color: "#C08A3E" },
      { label: "Agent Fee", value: capital.agentFee, color: "#C08A3E" },
      { label: "Assignment Fee", value: capital.assignmentFee, color: "#C08A3E" },
      { label: "Other Applicable Costs", value: otherApplicableCosts, color: "#C9BFA6" },
    ].filter((bar) => bar.value > 0);
  }, [
    downPaymentLabel,
    results.downPaymentForCapital,
    capital,
    results.holdingCosts,
    results.closingCosts,
    financingMode,
  ]);

  // Builds the complete export payload for the Excel workbook (see
  // lib/underwritingExcelExport.ts) from the exact same state and
  // `results`/derived values that drive the on-page UI, the printable
  // report, and (previously) the CSV export -- so the workbook always
  // matches the website exactly. Replaces the old CSV export entirely.
  async function handleExportExcel() {
    if (financingMode === "") {
      setExportExcelError("Please select a Financing Structure before exporting.");
      return;
    }
    setExportExcelError("");
    setIsExportingExcel(true);
    try {
      const tcLlc =
        financingMode === "traditional"
          ? { tcFee: capital.traditionalTcFee, llcFee: capital.traditionalLlcFee }
          : financingMode === "subjectTo"
            ? { tcFee: capital.subjectToTcFee, llcFee: capital.subjectToLlcFee }
            : financingMode === "hybrid"
              ? { tcFee: capital.hybridTcFee, llcFee: capital.hybridLlcFee }
              : financingMode === "sellerFinancing"
                ? { tcFee: capital.sellerFinancingTcFee, llcFee: capital.sellerFinancingLlcFee }
                : { tcFee: capital.stackTcFee, llcFee: capital.stackLlcFee };

      // Amortization schedules for the Excel export: one leg per loan for
      // the active financing structure, built from the exact same
      // schedules (traditionalAmortization / existingMortgageAmortization
      // / hybridExistingMortgageAmortization / hybridAmortization /
      // stackBankAmortization / stackSellerAmortization) already driving
      // the on-page <AmortizationScheduleBlock> panels above, so the
      // Excel figures always match the website exactly. The disclosure
      // is attached only to Subject-To's leg and Hybrid's
      // existing-mortgage leg, matching the on-page/print placement.
      const amortizationSchedules: ExportAmortizationSchedule[] = (() => {
        if (financingMode === "traditional") {
          return [
            {
              sheetName: "Amortization Schedule",
              title: "Amortization Schedule",
              rows: traditionalAmortization.schedule,
            },
          ];
        }
        if (financingMode === "subjectTo") {
          return [
            {
              sheetName: "Existing Mortgage Amort",
              title: "Existing Mortgage Amortization Schedule",
              disclosure: SUBJECT_TO_AMORTIZATION_DISCLOSURE,
              balloonAtPaymentNumber: subjectToBalloonExists ? Math.round(subjectToBalloonYears * 12) : null,
              rows: existingMortgageAmortization.schedule,
            },
          ];
        }
        if (financingMode === "sellerFinancing") {
          return [
            {
              sheetName: "Seller Finance Amort",
              title: "Seller Financing Amortization Schedule",
              balloonAtPaymentNumber: sellerFinancingBalloonExists
                ? Math.round(sellerFinancingBalloonYears * 12)
                : null,
              rows: sellerFinancingAmortization.schedule,
            },
          ];
        }
        if (financingMode === "hybrid") {
          const schedules: ExportAmortizationSchedule[] = [
            {
              sheetName: "Existing Mortgage Amort",
              title: "Existing Subject-To Mortgage Amortization Schedule",
              disclosure: SUBJECT_TO_AMORTIZATION_DISCLOSURE,
              balloonAtPaymentNumber: hybridBalloonExists ? Math.round(hybridBalloonYears * 12) : null,
              rows: hybridExistingMortgageAmortization.schedule,
            },
          ];
          if (hybridSellerFinancePaymentsRequired) {
            schedules.push({
              sheetName: "Hybrid Seller Fin Amort",
              title: "Hybrid Seller-Finance Amortization Schedule",
              balloonAtPaymentNumber: hybridBalloonExists ? Math.round(hybridBalloonYears * 12) : null,
              rows: hybridAmortization.schedule,
            });
          }
          return schedules;
        }
        // Stack Method
        const schedules: ExportAmortizationSchedule[] = [
          {
            sheetName: "Primary Loan Amort",
            title: "Primary Bank/DSCR Loan Amortization Schedule",
            balloonAtPaymentNumber: stackBalloonExists ? Math.round(stackBalloonYears * 12) : null,
            rows: stackBankAmortization.schedule,
          },
        ];
        if (stackSellerFinancePaymentsRequired) {
          schedules.push({
            sheetName: "Seller-Carried 2nd Amort",
            title: "Seller-Carried Second Amortization Schedule",
            balloonAtPaymentNumber: stackBalloonExists ? Math.round(stackBalloonYears * 12) : null,
            rows: stackSellerAmortization.schedule,
          });
        }
        return schedules;
      })();

      const exportData: UnderwritingExportData = {
        financingMode: financingMode as ExportFinancingMode,
        propertyAddress,
        videoWalkthroughLink,

        sharedBathBedrooms,
        weeklySharedBathRent,
        ensuiteBedrooms,
        weeklyEnsuiteRent,
        totalBedrooms: results.totalBedrooms,
        grossMonthlyRent: results.grossMonthlyRent,

        vacancyPct: percent.vacancyPct,
        platformFeePct: percent.platformFeePct,
        propertyManagementPct: percent.propertyManagementPct,
        closingCostPct: percent.closingCostPct,
        vacancyExpense: results.vacancyExpense,
        effectiveRentAfterVacancy: results.effectiveRentAfterVacancy,
        platformFees: results.platformFees,
        propertyManagementFee: results.propertyManagementFee,
        maintenanceMonthly: results.maintenanceMonthly,
        utilitiesMonthly: results.utilitiesMonthly,
        cleaningMonthly: results.cleaningMonthly,
        lawnCareMonthly: results.lawnCareMonthly,
        pestControlMonthly: results.pestControlMonthly,
        operatingExpenseDefaultsSource: operatingDefaultsSourceLabel(
          addressStateAbbreviation,
          maintenanceExpenseIsAutoDefaulted.cleaning &&
            maintenanceExpenseIsAutoDefaulted.lawnCare &&
            maintenanceExpenseIsAutoDefaulted.pestControl
        ),
        totalMonthlyOperatingExpenses: results.totalMonthlyOperatingExpenses,
        monthlyHousingPayment: results.monthlyHousingPayment,
        housingPaymentLabel,
        annualPropertyTaxes: financing.annualPropertyTaxes,
        annualPropertyInsurance: financing.annualPropertyInsurance,

        propertyTaxCounty: propertyTaxCounty,
        propertyTaxRatePct: propertyTaxRatePct,
        propertyTaxRateSource: propertyTaxRateSource,
        calculatedAnnualPropertyTaxes: calculatedAnnualPropertyTaxes,
        propertyTaxSource: propertyTaxSource,

        purchasePrice: financing.purchasePrice,
        paymentType,

        loanBalance: financing.loanBalance,
        sellerDownPayment: financing.sellerDownPayment,
        monthlyPayment: financing.monthlyPayment,
        loanInterestRatePct: percent.loanInterestRatePct,
        loanRemainingAmortizationYears,
        loanKnownMonthlyPIPayment,
        subjectToEffectiveAmortization,

        sellerFinancingDownPaymentPct: sellerFinancingDownPaymentPctResolved,
        sellerFinancingDownPaymentAmount: sellerFinancingDownPaymentAmountResolved,
        sellerFinancingLoanBalance: sellerFinancingLoanBalanceUsed,
        sellerFinancingLoanBalanceIsManual,
        sellerFinancingInterestRatePct: percent.sellerFinancingInterestRatePct,
        sellerFinancingAmortizationYears,
        sellerFinancingMonthlyPI,

        traditionalDownPaymentPct: traditionalEffectiveDownPaymentPct,
        traditionalDownPaymentAmount,
        traditionalLoanBalance,
        traditionalInterestRatePct: percent.traditionalInterestRatePct,
        traditionalMonthlyPI,
        traditionalClosingCostPct: percent.traditionalClosingCostPct,
        traditionalClosingCosts,
        traditionalLongTermRent,
        traditionalSelectedLtvPct,

        hybridExistingMortgageBalance: financing.hybridExistingMortgageBalance,
        hybridExistingMortgageRatePct: percent.hybridExistingMortgageRatePct,
        hybridExistingMortgageAmortizationYears,
        hybridExistingMortgageKnownMonthlyPIPayment,
        hybridExistingMortgageEffectiveAmortization,
        hybridSubjectToPITI: financing.hybridSubjectToPITI,
        hybridSuggestedSellerFinancedBalance,
        hybridSellerFinancedBalanceUsed,
        hybridSellerFinancedBalanceIsManual,
        hybridSellerFinancePaymentsRequired,
        hybridSellerFinanceRatePct: percent.hybridSellerFinanceRatePct,
        hybridMonthlySellerFinancePayment,
        hybridSellerFinanceRepaymentStructure,
        hybridTotalMonthlyHousingPayment,

        stackBankLoanAmount,
        stackEffectiveBankLtvPct,
        stackBankInterestRatePct: percent.stackBankInterestRatePct,
        stackBankAmortizationYears,
        stackBankMonthlyPI,
        stackMonthlyBankPITI,
        stackSellerFirstLoanBalance: financing.stackSellerFirstLoanBalance,
        stackSellerSecondLien: financing.stackSellerSecondLien,
        stackMiscLiens: financing.stackMiscLiens,
        stackDownPaymentToSeller: financing.stackDownPaymentToSeller,
        stackSellerFinancedBalance,
        stackTotalDebtAtAcquisition,
        stackLeverageRatioDecimal,
        stackClosingCostPct: percent.stackClosingCostPct,
        stackClosingCosts,
        stackAgentCommissionPct: percent.stackAgentCommissionPct,
        stackAgentFees,
        stackTransactionalFundingFeePct: percent.stackTransactionalFundingFeePct,
        stackTransactionalFundingFee,
        stackCashToCloseLeg1,
        stackSellerFinancePaymentsRequired,
        stackSellerFinanceRatePct: percent.stackSellerFinanceRatePct,
        stackSellerFinanceAmortizationYears,
        stackMonthlySellerFinancePayment,
        stackEstimatedBuyerCashAtClosing,
        stackZeroOutOfPocket,
        stackBaseCapitalRequired: results.stackBaseCapitalRequired,
        stackAdjustedTotalCapitalRequired: results.totalCapitalRequired,
        stackNetCashToBuyerAfterProjectCosts: results.stackNetCashToBuyerAfterProjectCosts,

        subjectToBalloon: subjectToBalloonAnalysis,
        sellerFinancingBalloon: sellerFinancingBalloonAnalysis,
        hybridBalloon: hybridBalloonAnalysis,
        stackBalloon: stackBalloonAnalysis,

        arrears: capital.arrears,
        renovationCost: capital.renovationCost,
        reserves: capital.reserves,
        furniture: capital.furniture,
        appliances: capital.appliances,
        photos: capital.photos,
        upfrontInsurance: capital.upfrontInsurance,
        acquisitionFee: capital.acquisitionFee,
        tcFee: tcLlc.tcFee,
        llcFee: tcLlc.llcFee,
        agentFee: capital.agentFee,
        assignmentFee: capital.assignmentFee,
        closingCosts: results.closingCosts,
        downPaymentForCapital: results.downPaymentForCapital,
        downPaymentLabel,
        holdingCosts: results.holdingCosts,
        totalCapitalRequired: results.totalCapitalRequired,
        equity: results.equity,
        equityIsNegative: results.equityIsNegative,
        monthlyCashFlow: results.monthlyCashFlow,
        annualCashFlow: results.annualCashFlow,
        cashOnCashReturn: results.cashOnCashReturn,

        scopeOfWorkItems: scopeOfWorkItems.map((item) => ({ name: item.name, cost: item.cost })),
        scopeOfWorkTotal,
        useItemizedScopeOfWork,

        amortizationSchedules,

        roiAppreciationPct: activeRoiAppreciationPct,
        roiProjection: activeRoiProjection,
        roiHasBalloon: activeRoiBalloon !== null,
        roiBalloonYears: activeRoiBalloon?.balloonYears ?? 0,
        roiRefinanceAtBalloon: roiRefinanceControls?.atBalloon ?? true,
        roiRefinanceRatePct: roiRefinanceControls?.rateUsed ?? 0,

        transit: ((): ExportTransitResult | null => {
          if (!transitResult) return null;
          return {
            propertyAddress,
            nearestBusStop: transitResult.nearestStop || null,
            walkingTimeMinutes: transitResult.walkingTimeMinutes,
            walkingDistanceMiles: transitResult.walkingDistanceMiles,
            transitNotes: transitResult.notes,
            dataSource: "Google Maps (Automatic Lookup)",
          };
        })(),
      };

      await exportUnderwritingToExcel(exportData);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong while building the Excel file.";
      setExportExcelError(message);
    } finally {
      setIsExportingExcel(false);
    }
  }

  // Every amortization schedule's CSV download is now handled inside the
  // shared <AmortizationScheduleBlock> component itself (one "Download
  // Full Monthly Schedule as CSV" button per loan leg), so the four
  // separate download*AmortizationCsv functions that used to live here
  // have been removed.

  // Browsers that offer "Save as PDF" in the print dialog (Chrome, Edge,
  // etc.) suggest document.title as the default filename. Setting it just
  // before print, then restoring the page's normal title once the print
  // dialog closes (via the "afterprint" event), gives every saved PDF a
  // predictable name without ever changing the browser tab title outside
  // of the print flow itself. The ".pdf" extension is intentionally left
  // off of document.title, since browsers that use this behavior already
  // append it automatically -- including it here would risk a
  // "....pdf.pdf" filename in those browsers.
  function printSummary() {
    const originalTitle = document.title;
    const addressPart = propertyAddress.trim();
    const rawFileTitle = addressPart
      ? `Underwriting - ${financingStructureLabel} - ${addressPart}`
      : `Underwriting - ${financingStructureLabel}`;
    document.title = sanitizeForFilename(rawFileTitle);
    const restoreTitle = () => {
      document.title = originalTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    window.addEventListener("afterprint", restoreTitle);
    window.print();
  }

  // 30-Year ROI Projection: resolves which per-structure Annual
  // Appreciation field and (when applicable) Refinance at Balloon
  // controls apply to whichever financing structure is currently
  // selected, so the JSX below can stay generic instead of repeating
  // near-identical blocks five times.
  const roiAppreciationDraft =
    financingMode === "traditional"
      ? percentDraft.traditionalAppreciationPct
      : financingMode === "subjectTo"
        ? percentDraft.subjectToBalloonAppreciationPct
        : financingMode === "sellerFinancing"
          ? percentDraft.sellerFinancingBalloonAppreciationPct
          : financingMode === "hybrid"
            ? percentDraft.hybridBalloonAppreciationPct
            : financingMode === "stackMethod"
              ? percentDraft.stackBalloonAppreciationPct
              : "2.00";
  const roiAppreciationKey: PercentKey | null =
    financingMode === "traditional"
      ? "traditionalAppreciationPct"
      : financingMode === "subjectTo"
        ? "subjectToBalloonAppreciationPct"
        : financingMode === "sellerFinancing"
          ? "sellerFinancingBalloonAppreciationPct"
          : financingMode === "hybrid"
            ? "hybridBalloonAppreciationPct"
            : financingMode === "stackMethod"
              ? "stackBalloonAppreciationPct"
              : null;
  const roiRefinanceControls =
    financingMode === "subjectTo"
      ? {
          atBalloon: subjectToRefinanceAtBalloon,
          setAtBalloon: setSubjectToRefinanceAtBalloon,
          rateDraft: subjectToRefinanceRateDraft,
          rateHandlers: subjectToRefinanceRateHandlers,
          rateIsManual: subjectToRefinanceRateIsManual,
          rateUsed: subjectToRefinanceRateUsed,
        }
      : financingMode === "sellerFinancing"
        ? {
            atBalloon: sellerFinancingRefinanceAtBalloon,
            setAtBalloon: setSellerFinancingRefinanceAtBalloon,
            rateDraft: sellerFinancingRefinanceRateDraft,
            rateHandlers: sellerFinancingRefinanceRateHandlers,
            rateIsManual: sellerFinancingRefinanceRateIsManual,
            rateUsed: sellerFinancingRefinanceRateUsed,
          }
        : financingMode === "hybrid"
          ? {
              atBalloon: hybridRefinanceAtBalloon,
              setAtBalloon: setHybridRefinanceAtBalloon,
              rateDraft: hybridRefinanceRateDraft,
              rateHandlers: hybridRefinanceRateHandlers,
              rateIsManual: hybridRefinanceRateIsManual,
              rateUsed: hybridRefinanceRateUsed,
            }
          : financingMode === "stackMethod"
            ? {
                atBalloon: stackRefinanceAtBalloon,
                setAtBalloon: setStackRefinanceAtBalloon,
                rateDraft: stackRefinanceRateDraft,
                rateHandlers: stackRefinanceRateHandlers,
                rateIsManual: stackRefinanceRateIsManual,
                rateUsed: stackRefinanceRateUsed,
              }
            : null;

  return (
    <section className="bg-ink text-bone py-16 md:py-20 print:bg-white print:text-black print:py-0">
      <div className="mx-auto max-w-content px-6 md:px-10 print:max-w-none print:px-0">
        {/* Key results band: the four headline figures, always visible,
            always up to date, before any of the input sections. */}
        <div className="print:hidden grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="border border-line bg-ink-2 p-6">
            <p className="eyebrow text-brass-light mb-1.5">Estimated Monthly Cash Flow</p>
            <p className="font-display text-3xl text-brass-light">
              {formatCents(results.monthlyCashFlow)}
            </p>
          </div>
          <div className="border border-line bg-ink-2 p-6">
            <p className="eyebrow text-brass-light mb-1.5">Estimated Annual Cash Flow</p>
            <p className="font-display text-3xl text-brass-light">
              {formatCents(results.annualCashFlow)}
            </p>
          </div>
          <div className="border border-line bg-ink-2 p-6">
            <p className="eyebrow text-brass-light mb-1.5 inline-flex items-center">
              Estimated Cash-on-Cash Return
              <InfoTip text="Cash-on-cash return is the estimated annual cash flow divided by the total cash invested in the project." />
            </p>
            <p className="font-display text-3xl text-brass-light">
              {results.cashOnCashReturn === null ? stackCocrLabel : formatPercent(results.cashOnCashReturn)}
            </p>
            {results.cashOnCashReturn === null && financingMode === "stackMethod" && (
              <p className="mt-2 text-xs text-bone/50 leading-relaxed">
                {results.stackNetCashToBuyerAfterProjectCosts > 0
                  ? `Cash received at closing more than covers every modeled project cost, so there is no net capital invested and a traditional cash-on-cash percentage is not applicable. Net Cash to Buyer After Project Costs: ${formatCents(results.stackNetCashToBuyerAfterProjectCosts)}.`
                  : "This structure models no net buyer capital contribution after the closing adjustment, so a traditional cash-on-cash percentage is not applicable."}
              </p>
            )}
          </div>
          <div className="border border-line bg-ink-2 p-6">
            <p className="eyebrow text-brass-light mb-1.5 inline-flex items-center">
              Year 1 Total ROI
              <InfoTip text="Year 1 Total Return (annual net cash flow + annual principal paydown + annual property appreciation) divided by Total Capital Required." />
            </p>
            <p className="font-display text-3xl text-brass-light">
              {financingMode === "" || !activeRoiProjection ? "N/A" : roiPct(activeRoiProjection.year1TotalRoi)}
            </p>
          </div>
          <div className="border border-brass bg-ink-2 p-6">
            {/* Stack Method: once cash received at closing covers every
                modeled project cost, Total Capital Required is always
                $0 -- so the headline card switches to showing the net
                cash the buyer actually walks away with instead of a
                flat, uninformative $0. Every other structure (and Stack
                Method whenever capital is still required) keeps showing
                Total Capital Required exactly as before. */}
            {financingMode === "stackMethod" &&
            results.totalCapitalRequired === 0 &&
            results.stackNetCashToBuyerAfterProjectCosts > 0 ? (
              <>
                <p className="eyebrow text-brass-light mb-1.5 inline-flex items-center">
                  Net Cash to Buyer After Project Costs
                  <InfoTip text="Cash received at closing minus every modeled project cost (Base Project Capital Required). Shown in place of Total Capital Required once cash received at closing covers every modeled cost." />
                </p>
                <p className="font-display text-3xl text-brass-light">
                  {formatCents(results.stackNetCashToBuyerAfterProjectCosts)}
                </p>
              </>
            ) : (
              <>
                <p className="eyebrow text-brass-light mb-1.5 inline-flex items-center">
                  Total Capital Required
                  <InfoTip text="Every cash cost paid at or around closing: down payment, holding costs, reserves, renovation, and the other upfront items below. Does not include the loan balance, equity, or purchase price." />
                </p>
                <p className="font-display text-3xl text-brass-light">
                  {formatCents(results.totalCapitalRequired)}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Transit summary: purely informational reference data -- never
            feeds cash flow or ROI math, so it is a separate strip rather
            than a sixth headline tile. Shown once the automatic lookup
            (or a hand-typed entry) has produced any transit data; hidden
            before that so the summary band isn't cluttered for a
            property that hasn't been looked up yet. Reports the actual
            transit figures found -- no Pass/Fail judgment or threshold
            comparison. */}
        {transitResult && (
          <div className="print:hidden mt-4 border border-line bg-ink-2 p-5 sm:p-6">
            <p className="eyebrow text-brass-light mb-3">Transit and Bus Stop Access</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2 text-sm text-bone/80">
              <div className="flex justify-between gap-3 lg:block">
                <span className="text-bone/50">Nearest Bus Stop</span>
                <span className="lg:block font-medium text-bone break-words">
                  {transitResult.nearestStop || "Not entered"}
                </span>
              </div>
              <div className="flex justify-between gap-3 lg:block">
                <span className="text-bone/50">Walking Time</span>
                <span className="lg:block font-medium text-bone">
                  {transitResult.walkingTimeMinutes !== null ? `${transitResult.walkingTimeMinutes} minutes` : "Not entered"}
                </span>
              </div>
              <div className="flex justify-between gap-3 lg:block">
                <span className="text-bone/50">Walking Distance</span>
                <span className="lg:block font-medium text-bone">
                  {transitResult.walkingDistanceMiles !== null ? `${transitResult.walkingDistanceMiles} miles` : "Not entered"}
                </span>
              </div>
              <div className="flex justify-between gap-3 lg:block">
                <span className="text-bone/50">Data Source</span>
                <span className="lg:block font-medium text-bone">Google Maps (Automatic Lookup)</span>
              </div>
              {transitResult.notes.trim() && (
                <div className="sm:col-span-2 lg:col-span-2 flex justify-between gap-3 lg:block">
                  <span className="text-bone/50">Transit Notes</span>
                  <span className="lg:block font-medium text-bone break-words">{transitResult.notes.trim()}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="print:hidden mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={resetToDefaults}
            className="border border-line-dark px-4 py-2 eyebrow text-bone/70 hover:border-brass hover:text-bone transition-colors"
          >
            Reset to Defaults
          </button>
          <button
            type="button"
            onClick={printSummary}
            className="border border-line-dark px-4 py-2 eyebrow text-bone/70 hover:border-brass hover:text-bone transition-colors"
          >
            Print or Save Summary
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={isExportingExcel}
            className="border border-line-dark px-4 py-2 eyebrow text-bone/70 hover:border-brass hover:text-bone transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExportingExcel ? "Building Excel File..." : "Export to Excel"}
          </button>
        </div>
        {exportExcelError && (
          <p className="print:hidden mt-2 text-xs text-red-400">{exportExcelError}</p>
        )}

        {/* ---------------------------------------------------------- */}
        {/* Property Address                                            */}
        {/* ---------------------------------------------------------- */}
        <div className="print:hidden mt-10 bg-paper text-ink p-6 sm:p-8 md:p-10">
          <p className="eyebrow text-brass mb-5">Property Address</p>
          <div>
            <label htmlFor="propertyAddress" className="block mb-2">
              <FieldLabel>Property Address</FieldLabel>
            </label>
            <PropertyAddressAutocomplete value={propertyAddress} onChange={setPropertyAddress} />
            <p className="mt-1.5 text-xs text-ink/50 leading-relaxed">
              Start typing to see suggested addresses, or type the full address by hand. Optional --
              appears near the top of the printable underwriting summary. Left blank, the address
              line is omitted from the report rather than shown empty.
            </p>
          </div>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Transit and Bus Stop Access                                 */}
        {/* ---------------------------------------------------------- */}
        <TransitAndBusStopAccessSection
          address={propertyAddress}
          nearestStopDraft={transitNearestStopDraft}
          onNearestStopDraftChange={setTransitNearestStopDraft}
          walkingTimeDraft={transitWalkingTimeDraft}
          onWalkingTimeDraftChange={setTransitWalkingTimeDraft}
          walkingDistanceDraft={transitWalkingDistanceDraft}
          onWalkingDistanceDraftChange={setTransitWalkingDistanceDraft}
          notesDraft={transitNotes}
          onNotesDraftChange={setTransitNotes}
          autoStatus={transitAutoStatus}
          autoStopCoords={transitAutoStopCoords}
        />

        {/* ---------------------------------------------------------- */}
        {/* Property Files (images and/or PDFs)                        */}
        {/* ---------------------------------------------------------- */}
        <div
          className={`print:hidden mt-6 p-6 sm:p-8 md:p-10 text-ink transition-colors ${
            isDraggingPhotos ? "bg-brass/10 border-2 border-dashed border-brass" : "bg-paper"
          }`}
          onDragEnter={handlePhotoDragEnter}
          onDragOver={handlePhotoDragOver}
          onDragLeave={handlePhotoDragLeave}
          onDrop={handlePhotoDrop}
        >
          <p className="eyebrow text-brass mb-2">Property Images</p>
          <p className="text-sm text-ink/60 leading-relaxed mb-5">
            Drag and drop property photos or PDFs here, or click to browse.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {propertyImages.map((img, index) => {
              const firstImageIndex = propertyImages.findIndex((f) => f.kind === "image");
              return (
                <div key={img.id} className="relative border border-line-dark bg-white p-2">
                  {img.kind === "image" ? (
                    <img
                      src={img.dataUrl}
                      alt={img.name || "Property photo"}
                      className="w-full h-32 object-contain bg-paper-2"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-1.5 w-full h-32 bg-paper-2 px-2 text-center">
                      <FileText size={26} className="text-ink/40" aria-hidden="true" />
                      <span className="text-[11px] text-ink/70 leading-snug break-all line-clamp-2">
                        {img.name || "Document.pdf"}
                      </span>
                      {img.size > 0 && (
                        <span className="text-[10px] text-ink/40">{formatFileSize(img.size)}</span>
                      )}
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleMoveImage(img.id, "left")}
                        disabled={index === 0}
                        aria-label={`Move ${img.kind === "pdf" ? "document" : "photo"} earlier`}
                        title="Move earlier"
                        className="p-1 border border-line-dark text-ink/50 hover:text-brass hover:border-brass transition-colors disabled:opacity-30 disabled:pointer-events-none"
                      >
                        <ArrowLeft size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveImage(img.id, "right")}
                        disabled={index === propertyImages.length - 1}
                        aria-label={`Move ${img.kind === "pdf" ? "document" : "photo"} later`}
                        title="Move later"
                        className="p-1 border border-line-dark text-ink/50 hover:text-brass hover:border-brass transition-colors disabled:opacity-30 disabled:pointer-events-none"
                      >
                        <ArrowRight size={12} />
                      </button>
                    </div>
                    {img.kind === "pdf" && (
                      <a
                        href={img.dataUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brass underline decoration-brass/50 underline-offset-2 hover:text-brass-light transition-colors inline-flex items-center gap-1"
                      >
                        Open <ExternalLink size={10} aria-hidden="true" />
                      </a>
                    )}
                    <label className="text-xs text-brass underline decoration-brass/50 underline-offset-2 hover:text-brass-light transition-colors cursor-pointer">
                      Replace
                      <input
                        type="file"
                        accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
                        className="hidden"
                        aria-label={`Replace ${img.name || (img.kind === "pdf" ? "document" : "photo")}`}
                        onChange={(e) => {
                          handleReplaceImage(img.id, e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(img.id)}
                      aria-label={`Remove ${img.name || (img.kind === "pdf" ? "document" : "photo")}`}
                      className="text-xs text-ink/50 hover:text-red-700 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                  {img.kind === "image" && index === firstImageIndex && propertyImages.length > 1 && (
                    <p className="mt-1.5 text-[10px] uppercase tracking-wide text-brass/80">
                      Featured Photo
                    </p>
                  )}
                </div>
              );
            })}

            {propertyImages.length < MAX_PROPERTY_FILES && (
              <div
                role="button"
                tabIndex={0}
                aria-label="Add property photos or PDFs. Accepts PNG, JPG, JPEG, WEBP, or PDF files, up to 5 total."
                onClick={() => propertyFilesInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    propertyFilesInputRef.current?.click();
                  }
                }}
                className={`flex flex-col items-center justify-center gap-2 border border-dashed h-full min-h-[128px] p-4 text-center cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-brass ${
                  isDraggingPhotos
                    ? "border-brass bg-brass/10"
                    : "border-line-dark bg-white/60 hover:border-brass"
                }`}
              >
                <Upload size={18} className={isDraggingPhotos ? "text-brass" : "text-ink/40"} aria-hidden="true" />
                <span className="text-xs text-ink/60">
                  {processingImages
                    ? "Processing..."
                    : isDraggingPhotos
                      ? "Drop property photos here"
                      : "Add Photos or PDFs"}
                </span>
                {!isDraggingPhotos && !processingImages && (
                  <span className="text-[10px] text-ink/40">
                    Click to browse, or drag and drop. PNG, JPG, JPEG, WEBP, or PDF.
                  </span>
                )}
                <input
                  ref={propertyFilesInputRef}
                  id="propertyImagesInput"
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
                  multiple
                  className="hidden"
                  disabled={processingImages}
                  onChange={(e) => {
                    handleAddImageFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
            )}
          </div>

          {imageError && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {imageError}
            </p>
          )}

          <p className="mt-4 text-xs text-ink/50 leading-relaxed">
            {propertyImages.length >= MAX_PROPERTY_FILES
              ? `Maximum of ${MAX_PROPERTY_FILES} property files reached.`
              : `You can upload up to ${MAX_PROPERTY_FILES} property images or PDFs. Click to browse or drag and drop. Supported formats: PNG, JPG, JPEG, WEBP, and PDF.`}{" "}
            Files are used only to personalize the underwriting summary generated from this
            calculator.
          </p>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Video Walkthrough Link                                      */}
        {/* ---------------------------------------------------------- */}
        <div className="print:hidden mt-6 bg-paper text-ink p-6 sm:p-8 md:p-10">
          <p className="eyebrow text-brass mb-5">Video Walkthrough Link</p>
          <div>
            <label htmlFor="videoWalkthroughLink" className="block mb-2">
              <FieldLabel>Video Walkthrough Link</FieldLabel>
            </label>
            <input
              id="videoWalkthroughLink"
              type="url"
              value={videoWalkthroughLink}
              onChange={(e) => setVideoWalkthroughLink(e.target.value)}
              placeholder="https://"
              className="w-full bg-white border border-line-dark px-3 py-2.5 text-ink outline-none focus:border-brass"
            />
            <p className="mt-1.5 text-xs text-ink/50 leading-relaxed">
              Add a link to a property walkthrough video. Optional. Links
              from YouTube, Vimeo, Google Drive, Dropbox, Loom, and similar
              services are all supported.
            </p>
            {videoWalkthroughLink.trim() !== "" && !isLikelyValidUrl(videoWalkthroughLink) && (
              <p className="mt-1.5 text-xs text-red-700">
                Enter a complete web address starting with http:// or https://.
              </p>
            )}
          </div>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Floor Plan                                                   */}
        {/* ---------------------------------------------------------- */}
        <div
          className={`print:hidden mt-6 p-6 sm:p-8 md:p-10 text-ink transition-colors ${
            isDraggingFloorPlan ? "bg-brass/10 border-2 border-dashed border-brass" : "bg-paper"
          }`}
          onDragEnter={handleFloorPlanDragEnter}
          onDragOver={handleFloorPlanDragOver}
          onDragLeave={handleFloorPlanDragLeave}
          onDrop={handleFloorPlanDrop}
        >
          <p className="eyebrow text-brass mb-2">Floor Plan</p>
          <p className="text-sm text-ink/60 leading-relaxed mb-5">
            Drag and drop a floor plan image or PDF here, or click to browse. Uploading a new
            file replaces the current one.
          </p>

          {floorPlan ? (
            <div className="border border-line-dark bg-white p-3 max-w-sm">
              {floorPlan.kind === "image" ? (
                <div className="flex items-center justify-center bg-paper-2">
                  <img
                    src={floorPlan.dataUrl}
                    alt={floorPlan.name || "Floor plan"}
                    className="w-full h-40 object-contain"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-1.5 bg-paper-2 h-40 px-3 text-center">
                  <FileText size={28} className="text-ink/40" aria-hidden="true" />
                  <span className="text-xs text-ink/70 leading-snug break-all line-clamp-2">
                    {floorPlan.name || "Floor Plan.pdf"}
                  </span>
                  {floorPlan.size > 0 && (
                    <span className="text-[10px] text-ink/40">{formatFileSize(floorPlan.size)}</span>
                  )}
                  <a
                    href={floorPlan.dataUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-brass underline decoration-brass/50 underline-offset-2 hover:text-brass-light transition-colors inline-flex items-center gap-1"
                  >
                    Open Floor Plan PDF <ExternalLink size={10} aria-hidden="true" />
                  </a>
                </div>
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <label className="text-xs text-brass underline decoration-brass/50 underline-offset-2 hover:text-brass-light transition-colors cursor-pointer">
                  Replace
                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
                    className="hidden"
                    aria-label="Replace floor plan"
                    onChange={(e) => {
                      handleFloorPlanFile(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={handleRemoveFloorPlan}
                  aria-label="Remove floor plan"
                  className="text-xs text-ink/50 hover:text-red-700 transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              aria-label="Add a floor plan. Accepts PNG, JPG, JPEG, WEBP, or PDF files, one file."
              onClick={() => floorPlanInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  floorPlanInputRef.current?.click();
                }
              }}
              className={`flex flex-col items-center justify-center gap-2 border border-dashed min-h-[128px] max-w-sm p-4 text-center cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-brass ${
                isDraggingFloorPlan
                  ? "border-brass bg-brass/10"
                  : "border-line-dark bg-white/60 hover:border-brass"
              }`}
            >
              <Upload size={18} className={isDraggingFloorPlan ? "text-brass" : "text-ink/40"} aria-hidden="true" />
              <span className="text-xs text-ink/60">
                {processingFloorPlan
                  ? "Processing..."
                  : isDraggingFloorPlan
                    ? "Drop floor plan here"
                    : "Add Floor Plan"}
              </span>
              {!isDraggingFloorPlan && !processingFloorPlan && (
                <span className="text-[10px] text-ink/40">
                  Click to browse, or drag and drop. PNG, JPG, JPEG, WEBP, or PDF.
                </span>
              )}
              <input
                ref={floorPlanInputRef}
                id="floorPlanInput"
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
                className="hidden"
                disabled={processingFloorPlan}
                onChange={(e) => {
                  handleFloorPlanFile(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          {floorPlanError && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {floorPlanError}
            </p>
          )}

          <p className="mt-4 text-xs text-ink/50 leading-relaxed">
            Supported formats: PNG, JPG, JPEG, WEBP, and PDF. One floor plan.
            Appears at the bottom of the printable underwriting summary.
          </p>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Section 1: Property and financing                          */}
        {/* ---------------------------------------------------------- */}
        <div className="print:hidden mt-6 bg-paper text-ink p-6 sm:p-8 md:p-10">
          <p className="eyebrow text-brass mb-5">Property and Financing</p>

          {/* Financing Structure: a single-select choice among five
              mutually exclusive options. Subject To and Seller Financing
              can no longer be selected together independently -- a deal
              that combines both uses the dedicated Subject To & Seller
              Finance Hybrid option instead, which has its own inputs and
              calculations (see below). Stack Method is a fifth,
              separate option (a first-position bank/DSCR loan combined
              with second-position seller financing) with its own
              dedicated inputs and calculations further down. Selecting
              any option deselects whichever one was previously active. */}
          <div>
            <p className="eyebrow text-brass mb-3">Financing Structure</p>
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2"
              role="group"
              aria-label="Financing Structure"
            >
              <button
                type="button"
                onClick={() => selectFinancingMode("traditional")}
                aria-pressed={financingMode === "traditional"}
                className={`px-3 py-2.5 border text-sm transition-colors ${
                  financingMode === "traditional"
                    ? "border-brass bg-brass/10 text-ink"
                    : "border-line-dark text-ink/60 hover:border-brass/60"
                }`}
              >
                Traditional Financing
              </button>
              <button
                type="button"
                onClick={() => selectFinancingMode("subjectTo")}
                aria-pressed={financingMode === "subjectTo"}
                className={`px-3 py-2.5 border text-sm transition-colors ${
                  financingMode === "subjectTo"
                    ? "border-brass bg-brass/10 text-ink"
                    : "border-line-dark text-ink/60 hover:border-brass/60"
                }`}
              >
                Subject To
              </button>
              <button
                type="button"
                onClick={() => selectFinancingMode("sellerFinancing")}
                aria-pressed={financingMode === "sellerFinancing"}
                className={`px-3 py-2.5 border text-sm transition-colors ${
                  financingMode === "sellerFinancing"
                    ? "border-brass bg-brass/10 text-ink"
                    : "border-line-dark text-ink/60 hover:border-brass/60"
                }`}
              >
                Seller Financing
              </button>
              <button
                type="button"
                onClick={() => selectFinancingMode("hybrid")}
                aria-pressed={financingMode === "hybrid"}
                className={`px-3 py-2.5 border text-sm transition-colors ${
                  financingMode === "hybrid"
                    ? "border-brass bg-brass/10 text-ink"
                    : "border-line-dark text-ink/60 hover:border-brass/60"
                }`}
              >
                Subject To &amp; Seller Finance <HybridBadge />
              </button>
              <button
                type="button"
                onClick={() => selectFinancingMode("stackMethod")}
                aria-pressed={financingMode === "stackMethod"}
                className={`px-3 py-2.5 border text-sm transition-colors ${
                  financingMode === "stackMethod"
                    ? "border-brass bg-brass/10 text-ink"
                    : "border-line-dark text-ink/60 hover:border-brass/60"
                }`}
              >
                Stack Method
              </button>
            </div>
            <p className="mt-3 text-xs text-ink/50 leading-relaxed">
              Select the financing structure that applies to the proposed acquisition. Only one may be
              selected at a time.
            </p>
            <p className="mt-3 text-sm text-ink/70">
              Selected:{" "}
              <span className="font-medium text-ink">
                <FinancingStructureLabelDisplay mode={financingMode} />
              </span>
            </p>
          </div>

          {/* Purchase Price is shared by every financing structure (it
              drives Estimated Equity, Closing Costs, and the printable
              report regardless of mode), so outside of Traditional
              Financing, Hybrid, and Stack Method it lives here, at the
              top of this section. When Traditional Financing, Hybrid,
              or Stack Method is selected it moves into that structure's
              dedicated section below instead -- it is still the exact
              same field either way. */}
          {(financingMode === "subjectTo" || financingMode === "") && (
            <>
            <div className="mt-8 pt-6 border-t border-line-dark grid sm:grid-cols-2 gap-5">
              <CurrencyField
                id="purchasePrice"
                label="Purchase Price"
                draft={financingDraft.purchasePrice}
                onChange={(raw) => handleFinancingChange("purchasePrice", raw)}
                onBlur={() => handleFinancingBlur("purchasePrice")}
              />
              <CurrencyField
                id="loanBalance"
                label="Loan Balance"
                draft={financingDraft.loanBalance}
                onChange={(raw) => handleFinancingChange("loanBalance", raw)}
                onBlur={() => handleFinancingBlur("loanBalance")}
              />
              <CurrencyField
                id="sellerDownPayment"
                label="Seller Down Payment"
                draft={financingDraft.sellerDownPayment}
                onChange={(raw) => handleFinancingChange("sellerDownPayment", raw)}
                onBlur={() => handleFinancingBlur("sellerDownPayment")}
                helperText="Cash paid to the seller at closing."
              />

              <div>
                <div className="mb-2">
                  <FieldLabel>Monthly Loan Payment Type</FieldLabel>
                </div>
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="Monthly Loan Payment Type">
                  <button
                    type="button"
                    onClick={() => setPaymentType("piti")}
                    aria-pressed={paymentType === "piti"}
                    className={`px-3 py-2.5 border text-sm transition-colors ${
                      paymentType === "piti"
                        ? "border-brass bg-brass/10 text-ink"
                        : "border-line-dark text-ink/60 hover:border-brass/60"
                    }`}
                  >
                    PITI
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentType("pi")}
                    aria-pressed={paymentType === "pi"}
                    className={`px-3 py-2.5 border text-sm transition-colors ${
                      paymentType === "pi"
                        ? "border-brass bg-brass/10 text-ink"
                        : "border-line-dark text-ink/60 hover:border-brass/60"
                    }`}
                  >
                    Principal and Interest Only
                  </button>
                </div>
              </div>

              <CurrencyField
                id="monthlyPayment"
                label={monthlyPaymentLabel}
                draft={financingDraft.monthlyPayment}
                onChange={(raw) => handleFinancingChange("monthlyPayment", raw)}
                onBlur={() => handleFinancingBlur("monthlyPayment")}
              />

              <CurrencyField
                id="annualPropertyInsurance"
                label="Annual Property Insurance"
                draft={financingDraft.annualPropertyInsurance}
                onChange={(raw) => handleFinancingChange("annualPropertyInsurance", raw)}
                onBlur={() => handleFinancingBlur("annualPropertyInsurance")}
                disabled={paymentType === "piti"}
                helperText={
                  paymentType === "piti"
                    ? "Already included in the PITI payment above, not counted separately."
                    : "Added to the monthly housing payment."
                }
              />

              <PercentField
                id="loanInterestRatePct"
                label="Existing Mortgage Interest Rate"
                draft={percentDraft.loanInterestRatePct}
                onChange={(raw) => handlePercentChange("loanInterestRatePct", raw)}
                onBlur={() => handlePercentBlur("loanInterestRatePct")}
                info="Decimals are allowed. Drives the amortization schedule, principal-paydown and ROI projections, the Balloon Refinance Analysis below, the printable report, and the Excel export -- never the monthly payment field above."
              />
              <IntegerField
                id="loanRemainingAmortizationYears"
                label="Remaining Amortization (Years) -- Optional"
                draft={loanRemainingAmortizationYearsDraft}
                onChange={(raw) => {
                  setLoanRemainingAmortizationYearsDraft(raw);
                  setLoanRemainingAmortizationYears(raw.trim() === "" ? null : Math.max(1, parseTypedInt(raw)));
                }}
                onBlur={() => {
                  if (loanRemainingAmortizationYearsDraft.trim() === "") {
                    setLoanRemainingAmortizationYears(null);
                    setLoanRemainingAmortizationYearsDraft("");
                    return;
                  }
                  setLoanRemainingAmortizationYearsDraft(
                    String(Math.max(1, loanRemainingAmortizationYears ?? 1))
                  );
                }}
                info="Optional -- leave blank if you don't know exactly how many years remain on this loan. Drives the amortization schedule, ROI projection, Balloon Refinance Analysis, and Excel export. If left blank and the loan's actual monthly principal and interest payment is entered below, the remaining term is estimated mathematically instead."
              />
              <CurrencyField
                id="loanKnownMonthlyPIPayment"
                label="Known Monthly Principal & Interest Payment -- Optional"
                draft={loanKnownMonthlyPIPaymentDraft}
                onChange={(raw) => {
                  setLoanKnownMonthlyPIPaymentDraft(raw);
                  setLoanKnownMonthlyPIPayment(raw.trim() === "" ? null : parseTypedAmount(raw));
                }}
                onBlur={() => {
                  if (loanKnownMonthlyPIPaymentDraft.trim() === "") {
                    setLoanKnownMonthlyPIPayment(null);
                    setLoanKnownMonthlyPIPaymentDraft("");
                    return;
                  }
                  const clamped = round2(Math.max(0, parseTypedAmount(loanKnownMonthlyPIPaymentDraft)));
                  setLoanKnownMonthlyPIPayment(clamped);
                  setLoanKnownMonthlyPIPaymentDraft(formatCents(clamped));
                }}
                helperText="Only used when Remaining Amortization (Years) above is left blank, to estimate the remaining term mathematically from the balance, interest rate, and this payment. Principal and interest only -- never a PITI figure."
              />
              <div className="sm:col-span-2">
                <AmortizationEstimateStatus term={subjectToEffectiveAmortization} />
              </div>
            </div>

            <PropertyTaxSection
              idPrefix="subjectToSeller"
              county={propertyTaxCounty}
              onCountyChange={handlePropertyTaxCountyChange}
              rateDraft={propertyTaxRateDraft}
              onRateChange={handlePropertyTaxRateChange}
              onRateBlur={handlePropertyTaxRateBlur}
              rateSource={propertyTaxRateSource}
              calculatedTax={calculatedAnnualPropertyTaxes}
              usedTaxDraft={financingDraft.annualPropertyTaxes}
              onUsedTaxChange={handlePropertyTaxUsedChange}
              onUsedTaxBlur={() => handleFinancingBlur("annualPropertyTaxes")}
              taxSource={propertyTaxSource}
              onUseCalculated={useCalculatedPropertyTax}
              countyIsAutoIdentified={countyIsAutoIdentified}
              countyAutoStatus={countyAutoStatus}
              countySuggestion={countySuggestion}
              countySuggestionInTable={countySuggestionInTable}
              countySuggestionDiffersFromCurrent={countySuggestionDiffersFromCurrent}
              onUseSuggestedCounty={acceptSuggestedCounty}
              onRetryCountyLookup={retryCountyLookup}
              usedTaxDisabled={paymentType === "piti"}
              usedTaxHelperText={
                paymentType === "piti"
                  ? "Already included in the PITI payment above, not counted separately."
                  : "Added to the monthly housing payment."
              }
            />
            </>
          )}

          {/* Seller Financing: a brand-new loan, so this section is
              entirely independent from Subject To's shared fields above
              -- its own Down Payment Percentage / Dollar Amount pair
              (synchronized, see the handlers above), its own
              automatically-calculated-or-overridden Loan Balance, its
              own Interest Rate, a required (never optional) Amortization
              Term, and an automatically calculated, read-only Monthly
              Principal & Interest. No PITI/Payment Type selector, no
              Known Monthly Principal & Interest Payment, and no
              Remaining Amortization (Years) -- Seller Financing always
              calculates its own payment from balance, rate, and term. */}
          {financingMode === "sellerFinancing" && (
            <>
            {sellerFinancingValidationErrors.length > 0 && (
              <div className="mt-8 rounded border border-red-700 bg-red-50 p-4">
                <ul className="space-y-1.5">
                  {sellerFinancingValidationErrors.map((message) => (
                    <li key={message} className="text-sm text-red-800 leading-relaxed inline-flex items-start gap-2">
                      <XCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                      <span>{message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-8 pt-6 border-t border-line-dark grid sm:grid-cols-2 gap-5">
              <CurrencyField
                id="sellerFinancingPurchasePrice"
                label="Purchase Price"
                draft={financingDraft.purchasePrice}
                onChange={(raw) => handleFinancingChange("purchasePrice", raw)}
                onBlur={() => handleFinancingBlur("purchasePrice")}
              />
              <div />
              <PercentField
                id="sellerFinancingDownPaymentPct"
                label="Down Payment Percentage"
                draft={sellerFinancingDownPaymentPctDraft}
                onChange={handleSellerFinancingDownPaymentPctChange}
                onBlur={handleSellerFinancingDownPaymentPctBlur}
                info="Enter as a percentage, e.g. 10 for 10%, never 0.10. Automatically calculates Down Payment Dollar Amount as Purchase Price x this percentage. Editing the dollar amount instead automatically updates this percentage -- whichever field was most recently edited stays in control."
              />
              <CurrencyField
                id="sellerFinancingDownPaymentAmount"
                label="Down Payment Dollar Amount"
                draft={sellerFinancingDownPaymentAmountDraft}
                onChange={handleSellerFinancingDownPaymentAmountChange}
                onBlur={handleSellerFinancingDownPaymentAmountBlur}
                helperText="Cash paid to the seller at closing. Kept in sync with Down Payment Percentage above."
              />
              <CurrencyField
                id="sellerFinancingLoanBalance"
                label="Seller-Finance Loan Balance"
                draft={sellerFinancingLoanBalanceDraft}
                onChange={handleSellerFinancingLoanBalanceChange}
                onBlur={handleSellerFinancingLoanBalanceBlur}
                helperText="Automatically calculated as Purchase Price minus Down Payment. Editing this field directly overrides the calculated amount until “Use Calculated Loan Balance” is pressed."
              />
              <div>
                <div className="mb-2">
                  <FieldLabel>Loan Balance Source</FieldLabel>
                </div>
                <div className="w-full bg-paper-2 border border-line-dark px-3 py-2.5 text-ink/70">
                  {sellerFinancingLoanBalanceIsManual ? "Manual Override" : "Automatically Calculated"}
                </div>
                {sellerFinancingLoanBalanceIsManual && (
                  <button
                    type="button"
                    onClick={resetSellerFinancingLoanBalanceToCalculated}
                    className="mt-2 inline-flex items-center gap-2 border border-line-dark px-4 py-2 text-sm text-ink/70 hover:border-brass hover:text-ink transition-colors"
                  >
                    Use Calculated Loan Balance
                  </button>
                )}
              </div>
              <PercentField
                id="sellerFinancingInterestRatePct"
                label="Seller-Finance Interest Rate"
                draft={percentDraft.sellerFinancingInterestRatePct}
                onChange={(raw) => handlePercentChange("sellerFinancingInterestRatePct", raw)}
                onBlur={() => handlePercentBlur("sellerFinancingInterestRatePct")}
                info="Decimals and 0% are both allowed. Drives the automatically calculated Monthly Principal & Interest below, the amortization schedule, principal paydown, Balloon Refinance Analysis, and 30-Year ROI Projection."
              />
              <IntegerField
                id="sellerFinancingAmortizationYears"
                label="Amortization Term (Years)"
                draft={sellerFinancingAmortizationYearsDraft}
                onChange={handleSellerFinancingAmortizationYearsChange}
                onBlur={handleSellerFinancingAmortizationYearsBlur}
                info="Required -- Seller Financing represents a brand-new loan, so its full amortization term is always selected by the parties. Drives the automatically calculated Monthly Principal & Interest below, the amortization schedule, principal paydown, Balloon Refinance Analysis, and 30-Year ROI Projection."
              />
              <ReadOnlyStat
                label="Monthly Principal & Interest"
                value={formatCents(sellerFinancingMonthlyPI)}
                helperText="Calculated automatically from the Seller-Finance Loan Balance, Interest Rate, and Amortization Term above using the standard amortizing-loan formula. Principal and interest only -- never PITI, and never manually entered."
              />
              <CurrencyField
                id="sellerFinancingAnnualPropertyInsurance"
                label="Annual Property Insurance"
                draft={financingDraft.annualPropertyInsurance}
                onChange={(raw) => handleFinancingChange("annualPropertyInsurance", raw)}
                onBlur={() => handleFinancingBlur("annualPropertyInsurance")}
                helperText="Added to Total Monthly Housing Payment separately from Monthly Principal & Interest -- never bundled into the loan payment."
              />
            </div>

            <PropertyTaxSection
              idPrefix="sellerFinancing"
              county={propertyTaxCounty}
              onCountyChange={handlePropertyTaxCountyChange}
              rateDraft={propertyTaxRateDraft}
              onRateChange={handlePropertyTaxRateChange}
              onRateBlur={handlePropertyTaxRateBlur}
              rateSource={propertyTaxRateSource}
              calculatedTax={calculatedAnnualPropertyTaxes}
              usedTaxDraft={financingDraft.annualPropertyTaxes}
              onUsedTaxChange={handlePropertyTaxUsedChange}
              onUsedTaxBlur={() => handleFinancingBlur("annualPropertyTaxes")}
              taxSource={propertyTaxSource}
              onUseCalculated={useCalculatedPropertyTax}
              countyIsAutoIdentified={countyIsAutoIdentified}
              countyAutoStatus={countyAutoStatus}
              countySuggestion={countySuggestion}
              countySuggestionInTable={countySuggestionInTable}
              countySuggestionDiffersFromCurrent={countySuggestionDiffersFromCurrent}
              onUseSuggestedCounty={acceptSuggestedCounty}
              onRetryCountyLookup={retryCountyLookup}
              usedTaxHelperText="Added to the monthly housing payment separately from Monthly Principal & Interest."
            />
            </>
          )}

          {financingMode === "subjectTo" && (
            <AmortizationScheduleBlock
              title={
                "Existing Mortgage Amortization Schedule" +
                (subjectToEffectiveAmortization.isEstimated ? " (Estimated Remaining Term)" : "")
              }
              schedule={existingMortgageAmortization.schedule}
              disclosure={SUBJECT_TO_AMORTIZATION_DISCLOSURE}
              note={
                subjectToEffectiveAmortization.isEstimated
                  ? "Remaining term estimated mathematically from the entered balance, interest rate, and known monthly principal and interest payment, since Remaining Amortization (Years) was left blank."
                  : "Calculated from the Existing Mortgage Interest Rate and Remaining Amortization (Years) above -- never from the entered PITI payment, so taxes and insurance are never mistaken for principal or interest here."
              }
              csvFilename="subject-to-existing-mortgage-amortization-schedule.csv"
            />
          )}

          {financingMode === "sellerFinancing" && (
            <AmortizationScheduleBlock
              title="Seller Financing Amortization Schedule"
              schedule={sellerFinancingAmortization.schedule}
              note="Calculated from the Seller-Finance Loan Balance, Seller-Finance Interest Rate, and Amortization Term above. Principal and interest only -- taxes and insurance never appear in this schedule."
              csvFilename="seller-financing-amortization-schedule.csv"
            />
          )}

          {financingMode === "subjectTo" && (
            <BalloonRefinanceAnalysisPanel
              balloonExists={subjectToBalloonExists}
              onToggleExists={setSubjectToBalloonExists}
              balloonYearsDraft={subjectToBalloonYearsDraft}
              onBalloonYearsChange={(raw) => {
                setSubjectToBalloonYearsDraft(raw);
                setSubjectToBalloonYears(Math.max(1, parseTypedInt(raw)));
              }}
              onBalloonYearsBlur={() =>
                setSubjectToBalloonYearsDraft(String(Math.max(1, subjectToBalloonYears)))
              }
              appreciationDraft={percentDraft.subjectToBalloonAppreciationPct}
              onAppreciationChange={(raw) => handlePercentChange("subjectToBalloonAppreciationPct", raw)}
              onAppreciationBlur={() => handlePercentBlur("subjectToBalloonAppreciationPct")}
              has70LtvContingency={subjectToBalloonHas70LtvContingency}
              onToggleContingency={setSubjectToBalloonHas70LtvContingency}
              analysis={subjectToBalloonAnalysis}
              loanBalanceRows={
                subjectToBalloonAnalysis
                  ? [
                      {
                        label: "Projected Existing Mortgage Balance at Balloon",
                        value: subjectToBalloonAnalysis.mortgageBalanceAtBalloon,
                      },
                    ]
                  : []
              }
            />
          )}

          {financingMode === "sellerFinancing" && (
            <BalloonRefinanceAnalysisPanel
              balloonExists={sellerFinancingBalloonExists}
              onToggleExists={setSellerFinancingBalloonExists}
              balloonYearsDraft={sellerFinancingBalloonYearsDraft}
              onBalloonYearsChange={(raw) => {
                setSellerFinancingBalloonYearsDraft(raw);
                setSellerFinancingBalloonYears(Math.max(1, parseTypedInt(raw)));
              }}
              onBalloonYearsBlur={() =>
                setSellerFinancingBalloonYearsDraft(String(Math.max(1, sellerFinancingBalloonYears)))
              }
              appreciationDraft={percentDraft.sellerFinancingBalloonAppreciationPct}
              onAppreciationChange={(raw) => handlePercentChange("sellerFinancingBalloonAppreciationPct", raw)}
              onAppreciationBlur={() => handlePercentBlur("sellerFinancingBalloonAppreciationPct")}
              has70LtvContingency={sellerFinancingBalloonHas70LtvContingency}
              onToggleContingency={setSellerFinancingBalloonHas70LtvContingency}
              analysis={sellerFinancingBalloonAnalysis}
              loanBalanceRows={
                sellerFinancingBalloonAnalysis
                  ? [
                      {
                        label: "Projected Seller-Finance Balance at Balloon",
                        value: sellerFinancingBalloonAnalysis.sellerFinanceBalanceAtBalloon,
                      },
                    ]
                  : []
              }
            />
          )}

          {/* ------------------------------------------------------ */}
          {/* Traditional Financing: a dedicated section with its own
              inputs and calculations (Purchase Price, Down Payment
              Percentage, Interest Rate, Closing Cost Percentage, and a
              fixed 30-year/360-payment amortization term), since a
              conventional mortgage is structured very differently from
              Seller Financing or Subject To above. */}
          {/* ------------------------------------------------------ */}
          {financingMode === "traditional" && (
            <div className="mt-8 pt-6 border-t border-line-dark">
              <p className="eyebrow text-brass mb-1">Traditional Financing</p>
              <p className="text-xs text-ink/50 leading-relaxed mb-5">
                A traditional, fully amortizing 30-year mortgage. The
                monthly principal and interest payment below is
                calculated automatically from the purchase price, down
                payment percentage, and interest rate entered here.
              </p>
              <div className="grid sm:grid-cols-2 gap-5">
                <CurrencyField
                  id="purchasePriceTraditional"
                  label="Purchase Price"
                  draft={financingDraft.purchasePrice}
                  onChange={(raw) => handleFinancingChange("purchasePrice", raw)}
                  onBlur={() => handleFinancingBlur("purchasePrice")}
                />
                {traditionalLtvAutoSelected !== null ? (
                  <ReadOnlyStat
                    label="Down Payment Percentage"
                    value={formatPercent(traditionalEffectiveDownPaymentPct)}
                    helperText="Automatically set by the Long-Term Rent LTV Qualification check below. Clear the Estimated Monthly Long-Term Rent field to select a percentage manually again."
                    info="Applied to the purchase price to calculate the down payment."
                  />
                ) : (
                  <PercentField
                    id="traditionalDownPaymentPct"
                    label="Down Payment Percentage"
                    draft={percentDraft.traditionalDownPaymentPct}
                    onChange={(raw) => handlePercentChange("traditionalDownPaymentPct", raw)}
                    onBlur={() => handlePercentBlur("traditionalDownPaymentPct")}
                    info="Allows decimals, e.g. 15.5%. Applied to the purchase price to calculate the down payment."
                  />
                )}
                <ReadOnlyStat
                  label="Estimated Down Payment"
                  value={formatWhole(traditionalDownPaymentAmount)}
                  helperText="Purchase Price x Down Payment Percentage."
                />
                <ReadOnlyStat
                  label="Estimated Loan Balance"
                  value={formatWhole(traditionalLoanBalance)}
                  helperText="Purchase Price minus Estimated Down Payment. Never falls below $0."
                />
                <PercentField
                  id="traditionalInterestRatePct"
                  label="Interest Rate"
                  draft={percentDraft.traditionalInterestRatePct}
                  onChange={(raw) => handlePercentChange("traditionalInterestRatePct", raw)}
                  onBlur={() => handlePercentBlur("traditionalInterestRatePct")}
                  info="Annual interest rate. Decimals are supported, e.g. 6.75%."
                />
                <ReadOnlyStat
                  label="Amortization Term"
                  value="30 Years (360 Monthly Payments)"
                />
                <CurrencyField
                  id="annualPropertyInsuranceTraditional"
                  label="Annual Property Insurance"
                  draft={financingDraft.annualPropertyInsurance}
                  onChange={(raw) => handleFinancingChange("annualPropertyInsurance", raw)}
                  onBlur={() => handleFinancingBlur("annualPropertyInsurance")}
                  helperText="Added to the monthly principal and interest payment below."
                />
                <PercentField
                  id="traditionalClosingCostPct"
                  label="Closing Cost Percentage"
                  draft={percentDraft.traditionalClosingCostPct}
                  onChange={(raw) => handlePercentChange("traditionalClosingCostPct", raw)}
                  onBlur={() => handlePercentBlur("traditionalClosingCostPct")}
                  info="Applied to the Estimated Loan Balance, not the purchase price, to estimate closing costs."
                />
                <ReadOnlyStat
                  label="Estimated Closing Costs"
                  value={formatWhole(traditionalClosingCosts)}
                  helperText="Estimated Loan Balance x Closing Cost Percentage."
                />
              </div>

              <PropertyTaxSection
                idPrefix="traditional"
                county={propertyTaxCounty}
                onCountyChange={handlePropertyTaxCountyChange}
                rateDraft={propertyTaxRateDraft}
                onRateChange={handlePropertyTaxRateChange}
                onRateBlur={handlePropertyTaxRateBlur}
                rateSource={propertyTaxRateSource}
                calculatedTax={calculatedAnnualPropertyTaxes}
                usedTaxDraft={financingDraft.annualPropertyTaxes}
                onUsedTaxChange={handlePropertyTaxUsedChange}
                onUsedTaxBlur={() => handleFinancingBlur("annualPropertyTaxes")}
                taxSource={propertyTaxSource}
                onUseCalculated={useCalculatedPropertyTax}
              countyIsAutoIdentified={countyIsAutoIdentified}
              countyAutoStatus={countyAutoStatus}
              countySuggestion={countySuggestion}
              countySuggestionInTable={countySuggestionInTable}
              countySuggestionDiffersFromCurrent={countySuggestionDiffersFromCurrent}
              onUseSuggestedCounty={acceptSuggestedCounty}
              onRetryCountyLookup={retryCountyLookup}
                usedTaxHelperText="Added to the monthly principal and interest payment below."
              />

              {/* Long-Term Rent LTV Qualification: an optional check
                  comparing what the property could rent for on a
                  traditional long-term lease against the Estimated
                  Monthly PITI at an 80% LTV assumption, to decide whether
                  an 80% or a more conservative 75% LTV (20% or 25% down
                  payment) should be used. Only takes effect once a
                  Long-Term Rent has been entered; leaving it blank keeps
                  the manually selected Down Payment Percentage above
                  unchanged. Mirrors the same check already used for
                  Stack Method's Bank Loan-to-Value Percentage. */}
              <div className="mt-8 pt-6 border-t border-line-dark">
                <p className="eyebrow text-ink/50 mb-3">Long-Term Rent LTV Qualification</p>
                <div className="grid sm:grid-cols-2 gap-5">
                  <CurrencyField
                    id="traditionalLongTermRent"
                    label="Estimated Monthly Long-Term Rent"
                    draft={traditionalLongTermRentDraft}
                    onChange={handleTraditionalLongTermRentChange}
                    onBlur={handleTraditionalLongTermRentBlur}
                    helperText="Optional. The property's projected monthly rent on a traditional long-term lease (not co-living). Leave blank to select the Down Payment Percentage above manually instead."
                  />
                  <div className="grid grid-cols-2 gap-5">
                    <ReadOnlyStat label="Selected LTV" value={formatPercent(traditionalSelectedLtvPct)} />
                    <ReadOnlyStat
                      label="Required Down Payment"
                      value={formatPercent(traditionalEffectiveDownPaymentPct)}
                    />
                  </div>
                </div>

                {traditionalLongTermRent === null ? (
                  <div className="mt-4 rounded border border-ink/30 bg-paper-2 p-4">
                    <p className="text-sm text-ink/70 leading-relaxed inline-flex items-start gap-2">
                      <HelpCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                      <span>
                        Enter an estimated monthly long-term rent to evaluate the 80% or 75% LTV
                        assumption.
                      </span>
                    </p>
                  </div>
                ) : traditionalLongTermRent >= traditionalPITIAt80 ? (
                  <div className="mt-4 rounded border border-green-700 bg-green-50 p-4">
                    <p className="text-sm text-green-800 leading-relaxed inline-flex items-start gap-2">
                      <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                      <span>
                        Estimated long-term rent supports the monthly PITI. Proceeding with an 80% LTV
                        assumption.
                      </span>
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 rounded border border-red-700 bg-red-50 p-4">
                    <p className="text-sm text-red-800 leading-relaxed inline-flex items-start gap-2">
                      <XCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                      <span>
                        Estimated long-term rent is below the monthly PITI. Using a more conservative
                        75% LTV assumption.
                      </span>
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-8 pt-6 border-t border-line-dark">
                <div className="border border-brass bg-paper-2 p-6">
                  <p className="eyebrow text-brass mb-1.5">
                    Estimated Monthly Principal and Interest Payment
                  </p>
                  <p className="font-display text-3xl">{formatCents(traditionalMonthlyPI)}</p>
                </div>
              </div>

              {/* Monthly PITI: principal and interest (calculated above),
                  plus monthly property taxes and insurance (the entered
                  annual figures divided by 12), combined into a single,
                  visually prominent Estimated Monthly PITI figure. This
                  is the housing expense used everywhere else in this
                  calculator -- monthly operating expenses, cash flow,
                  holding costs, cash-on-cash return, the full breakdown,
                  the printed report, and the CSV export -- so taxes and
                  insurance are never counted twice. */}
              <div className="mt-6 rounded border border-line-dark bg-white p-6">
                <p className="eyebrow text-brass mb-4">Estimated Monthly PITI</p>
                <div className="divide-y divide-line-dark border-t border-b border-line-dark">
                  <div className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-ink/70">Monthly Principal and Interest</span>
                    <span>{formatCents(traditionalMonthlyPI)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-ink/70">Monthly Property Taxes</span>
                    <span>{formatCents(traditionalMonthlyTaxes)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-ink/70">Monthly Property Insurance</span>
                    <span>{formatCents(traditionalMonthlyInsurance)}</span>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between rounded bg-brass/10 border border-brass px-4 py-4">
                  <span className="eyebrow text-brass">Estimated Monthly PITI</span>
                  <span className="font-display text-2xl text-ink">
                    {formatCents(results.monthlyHousingPayment)}
                  </span>
                </div>
              </div>

              {/* Amortization schedule: a complete, internally generated
                  360-payment schedule, shown as a clean annual summary
                  by default with an option to expand to the full
                  monthly detail or download it as a CSV. */}
              <AmortizationScheduleBlock
                title="Amortization Schedule"
                schedule={traditionalAmortization.schedule}
                csvFilename="traditional-financing-amortization-schedule.csv"
              />
            </div>
          )}

          {/* ------------------------------------------------------ */}
          {/* Subject To & Seller Finance Hybrid: a dedicated section
              combining a subject-to purchase of the existing mortgage
              with separate seller financing for the remaining equity.
              The buyer takes over making the existing mortgage's
              monthly Subject-To PITI payment and separately makes a
              seller-financed payment on the Seller-Financed Balance. */}
          {/* ------------------------------------------------------ */}
          {financingMode === "hybrid" && (
            <div className="mt-8 pt-6 border-t border-line-dark">
              <p className="eyebrow text-brass mb-1 inline-flex items-center gap-2">
                Subject To &amp; Seller Finance <HybridBadge />
              </p>
              <p className="text-xs text-ink/50 leading-relaxed mb-2">
                A hybrid transaction combines a subject-to purchase of the existing mortgage with
                separate seller financing for the remaining equity. The buyer takes responsibility
                for making the existing mortgage payment and also makes a separate monthly payment
                to the seller under the agreed seller-financing terms.
              </p>
              <p className="text-xs text-ink/40 leading-relaxed mb-5">
                The existing mortgage generally remains in the seller&apos;s name and is not
                formally assumed by the buyer.
              </p>

              <p className="eyebrow text-ink/50 mb-3">Property and Equity</p>
              <div className="grid sm:grid-cols-2 gap-5">
                <CurrencyField
                  id="purchasePriceHybrid"
                  label="Purchase Price"
                  draft={financingDraft.purchasePrice}
                  onChange={(raw) => handleFinancingChange("purchasePrice", raw)}
                  onBlur={() => handleFinancingBlur("purchasePrice")}
                />
                <CurrencyField
                  id="hybridExistingMortgageBalance"
                  label="Existing Mortgage Balance"
                  draft={financingDraft.hybridExistingMortgageBalance}
                  onChange={(raw) => handleFinancingChange("hybridExistingMortgageBalance", raw)}
                  onBlur={() => handleFinancingBlur("hybridExistingMortgageBalance")}
                  helperText="The seller's remaining balance on the existing mortgage being taken subject to."
                />
                <CurrencyField
                  id="sellerDownPaymentHybrid"
                  label="Seller Down Payment"
                  draft={financingDraft.sellerDownPayment}
                  onChange={(raw) => handleFinancingChange("sellerDownPayment", raw)}
                  onBlur={() => handleFinancingBlur("sellerDownPayment")}
                  helperText="Cash paid to the seller at closing."
                />
              </div>

              <PropertyTaxSection
                idPrefix="hybrid"
                county={propertyTaxCounty}
                onCountyChange={handlePropertyTaxCountyChange}
                rateDraft={propertyTaxRateDraft}
                onRateChange={handlePropertyTaxRateChange}
                onRateBlur={handlePropertyTaxRateBlur}
                rateSource={propertyTaxRateSource}
                calculatedTax={calculatedAnnualPropertyTaxes}
                usedTaxDraft={financingDraft.annualPropertyTaxes}
                onUsedTaxChange={handlePropertyTaxUsedChange}
                onUsedTaxBlur={() => handleFinancingBlur("annualPropertyTaxes")}
                taxSource={propertyTaxSource}
                onUseCalculated={useCalculatedPropertyTax}
              countyIsAutoIdentified={countyIsAutoIdentified}
              countyAutoStatus={countyAutoStatus}
              countySuggestion={countySuggestion}
              countySuggestionInTable={countySuggestionInTable}
              countySuggestionDiffersFromCurrent={countySuggestionDiffersFromCurrent}
              onUseSuggestedCounty={acceptSuggestedCounty}
              onRetryCountyLookup={retryCountyLookup}
                usedTaxHelperText="Reference only -- the Total Monthly Housing Payment above already uses the existing mortgage's full PITI payment entered directly, which already includes property taxes."
              />

              {financing.hybridExistingMortgageBalance +
                financing.sellerDownPayment +
                hybridSellerFinancedBalanceUsed >
                financing.purchasePrice && (
                <p className="mt-4 text-sm text-red-700">
                  The entered mortgage balance, seller down payment, and seller-financed balance
                  exceed the purchase price. Please review the transaction amounts.
                </p>
              )}

              <div className="mt-8 pt-6 border-t border-line-dark">
                <p className="eyebrow text-ink/50 mb-3">Existing Mortgage</p>
                <div className="grid sm:grid-cols-2 gap-5">
                  <CurrencyField
                    id="hybridSubjectToPITI"
                    label="Monthly Subject-To PITI Payment"
                    draft={financingDraft.hybridSubjectToPITI}
                    onChange={(raw) => handleFinancingChange("hybridSubjectToPITI", raw)}
                    onBlur={() => handleFinancingBlur("hybridSubjectToPITI")}
                    helperText="The buyer takes over making this existing monthly payment."
                  />
                  <PercentField
                    id="hybridExistingMortgageRatePct"
                    label="Existing Mortgage Interest Rate"
                    draft={percentDraft.hybridExistingMortgageRatePct}
                    onChange={(raw) => handlePercentChange("hybridExistingMortgageRatePct", raw)}
                    onBlur={() => handlePercentBlur("hybridExistingMortgageRatePct")}
                    info="Decimals are allowed. Kept separate from the Hybrid Seller-Finance Interest Rate below -- drives this loan's own amortization schedule, principal-paydown and ROI projections, the Balloon Refinance Analysis below, the printable report, and the Excel export, never the monthly payment above."
                  />
                  <IntegerField
                    id="hybridExistingMortgageAmortizationYears"
                    label="Remaining Amortization (Years) -- Optional"
                    draft={hybridExistingMortgageAmortizationYearsDraft}
                    onChange={(raw) => {
                      setHybridExistingMortgageAmortizationYearsDraft(raw);
                      setHybridExistingMortgageAmortizationYears(
                        raw.trim() === "" ? null : Math.max(1, parseTypedInt(raw))
                      );
                    }}
                    onBlur={() => {
                      if (hybridExistingMortgageAmortizationYearsDraft.trim() === "") {
                        setHybridExistingMortgageAmortizationYears(null);
                        setHybridExistingMortgageAmortizationYearsDraft("");
                        return;
                      }
                      setHybridExistingMortgageAmortizationYearsDraft(
                        String(Math.max(1, hybridExistingMortgageAmortizationYears ?? 1))
                      );
                    }}
                    info="Optional -- leave blank if you don't know exactly how many years remain on the existing mortgage. Drives this loan's own amortization schedule, ROI projection, Balloon Refinance Analysis, and Excel export. If left blank and the loan's actual monthly principal and interest payment is entered below, the remaining term is estimated mathematically instead."
                  />
                  <CurrencyField
                    id="hybridExistingMortgageKnownMonthlyPIPayment"
                    label="Known Monthly Principal & Interest Payment -- Optional"
                    draft={hybridExistingMortgageKnownMonthlyPIPaymentDraft}
                    onChange={(raw) => {
                      setHybridExistingMortgageKnownMonthlyPIPaymentDraft(raw);
                      setHybridExistingMortgageKnownMonthlyPIPayment(
                        raw.trim() === "" ? null : parseTypedAmount(raw)
                      );
                    }}
                    onBlur={() => {
                      if (hybridExistingMortgageKnownMonthlyPIPaymentDraft.trim() === "") {
                        setHybridExistingMortgageKnownMonthlyPIPayment(null);
                        setHybridExistingMortgageKnownMonthlyPIPaymentDraft("");
                        return;
                      }
                      const clamped = round2(
                        Math.max(0, parseTypedAmount(hybridExistingMortgageKnownMonthlyPIPaymentDraft))
                      );
                      setHybridExistingMortgageKnownMonthlyPIPayment(clamped);
                      setHybridExistingMortgageKnownMonthlyPIPaymentDraft(formatCents(clamped));
                    }}
                    helperText="Only used when Remaining Amortization (Years) above is left blank, to estimate the remaining term mathematically from the balance, interest rate, and this payment. Principal and interest only -- never the Monthly Subject-To PITI Payment above."
                  />
                  <div className="sm:col-span-2">
                    <AmortizationEstimateStatus term={hybridExistingMortgageEffectiveAmortization} />
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-line-dark">
                <p className="eyebrow text-ink/50 mb-3">Seller Financing</p>
                <div className="grid sm:grid-cols-2 gap-5">
                  <ReadOnlyStat
                    label="Suggested Seller-Financed Balance"
                    value={formatWhole(hybridSuggestedSellerFinancedBalance)}
                    helperText="Purchase Price minus Existing Mortgage Balance minus Seller Down Payment. Never falls below $0."
                  />
                  <div>
                    <CurrencyField
                      id="hybridSellerFinancedBalanceUsed"
                      label="Seller-Financed Balance Used"
                      draft={hybridSellerFinancedBalanceDraft}
                      onChange={handleHybridSellerFinancedBalanceChange}
                      onBlur={handleHybridSellerFinancedBalanceBlur}
                      helperText="Defaults to the Suggested Seller-Financed Balance above. Edit if the actual transaction terms differ (arrears, seller concessions, extra cash at closing, negotiated equity adjustments, or other transaction credits)."
                    />
                    {hybridSellerFinancedBalanceIsManual && (
                      <button
                        type="button"
                        onClick={resetHybridSellerFinancedBalanceToSuggested}
                        className="mt-2 text-xs text-brass underline decoration-brass/50 underline-offset-2 hover:text-brass-light transition-colors"
                      >
                        Reset to Suggested Balance
                      </button>
                    )}
                  </div>
                </div>

                {/* Are Monthly Seller Finance Payments Required?: mirrors
                    Stack Method's toggle exactly. No (the default) means
                    the Seller-Financed Balance Used carries in full,
                    unamortized, until the balloon date -- no monthly
                    payment is added to Total PITI. Yes calculates a
                    monthly payment using the rate and amortization
                    entered below. */}
                <div className="mt-6">
                  <p className="eyebrow text-ink/50 mb-3 inline-flex items-center">
                    Are Monthly Seller Finance Payments Required?
                    <InfoTip text="No means the seller-financed balance is not amortized with a monthly payment here -- it carries in full until the balloon date. Yes calculates a monthly payment using the terms below." />
                  </p>
                  <div
                    className="inline-flex border border-line-dark"
                    role="group"
                    aria-label="Are Monthly Seller Finance Payments Required?"
                  >
                    <button
                      type="button"
                      onClick={() => setHybridSellerFinancePaymentsRequired(false)}
                      aria-pressed={!hybridSellerFinancePaymentsRequired}
                      className={`px-4 py-2 text-sm transition-colors ${
                        !hybridSellerFinancePaymentsRequired
                          ? "bg-brass/10 text-ink border-r border-line-dark"
                          : "text-ink/60 hover:text-ink border-r border-line-dark"
                      }`}
                    >
                      No
                    </button>
                    <button
                      type="button"
                      onClick={() => setHybridSellerFinancePaymentsRequired(true)}
                      aria-pressed={hybridSellerFinancePaymentsRequired}
                      className={`px-4 py-2 text-sm transition-colors ${
                        hybridSellerFinancePaymentsRequired
                          ? "bg-brass/10 text-ink"
                          : "text-ink/60 hover:text-ink"
                      }`}
                    >
                      Yes
                    </button>
                  </div>
                </div>

                {hybridSellerFinancePaymentsRequired ? (
                  <>
                    <div className="mt-6 grid sm:grid-cols-2 gap-5">
                      <PercentField
                        id="hybridSellerFinanceRatePct"
                        label="Hybrid Seller-Finance Interest Rate"
                        draft={percentDraft.hybridSellerFinanceRatePct}
                        onChange={(raw) => handlePercentChange("hybridSellerFinanceRatePct", raw)}
                        onBlur={() => handlePercentBlur("hybridSellerFinanceRatePct")}
                        info="Allows decimals, e.g. 2.5%. Kept separate from the Existing Mortgage Interest Rate above -- drives this loan's own amortization schedule, ROI projection, and Excel export."
                      />
                      <ReadOnlyStat
                        label="Seller Finance Amortization Term"
                        value="30 Years (360 Monthly Payments)"
                      />
                    </div>
                    <div className="mt-6 rounded border border-brass bg-paper-2 p-6">
                      <p className="eyebrow text-brass mb-1.5">Estimated Monthly Seller Finance Payment</p>
                      <p className="font-display text-3xl">
                        {formatCents(hybridMonthlySellerFinancePayment)}
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="mt-4 text-xs text-ink/50 leading-relaxed">
                    No monthly seller-finance payments are included. The seller-financed balance is
                    carried until the balloon is due.
                  </p>
                )}
              </div>

              {/* Total Monthly Housing Payment: the Subject-To PITI
                  payment plus the included seller finance payment
                  ($0 when payments are not required), combined into a
                  single, visually prominent figure. This is the housing
                  expense used everywhere else in this calculator --
                  monthly operating expenses, cash flow, holding costs,
                  cash-on-cash return, the full breakdown, the printed
                  report, and the CSV export. */}
              <div className="mt-6 rounded border border-line-dark bg-white p-6">
                <p className="eyebrow text-brass mb-4">Total Monthly Housing Payment</p>
                <div className="divide-y divide-line-dark border-t border-b border-line-dark">
                  <div className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-ink/70">Monthly Subject-To PITI Payment</span>
                    <span>{formatCents(financing.hybridSubjectToPITI)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-ink/70">Monthly Seller Finance Payment</span>
                    <span>
                      {hybridSellerFinancePaymentsRequired
                        ? formatCents(hybridMonthlySellerFinancePayment)
                        : "Not Included"}
                    </span>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between rounded bg-brass/10 border border-brass px-4 py-4">
                  <span className="eyebrow text-brass">Total Monthly Housing Payment</span>
                  <span className="font-display text-2xl text-ink">
                    {formatCents(results.monthlyHousingPayment)}
                  </span>
                </div>
              </div>

              {/* Existing Subject-To Mortgage Amortization Schedule: this
                  loan originated before the acquisition date, so it is
                  always shown with the estimation disclosure and kept
                  completely separate from the Hybrid Seller-Finance
                  Amortization Schedule below -- its own Existing Mortgage
                  Interest Rate and Remaining Amortization (Years), never
                  the seller-finance rate or term. */}
              <AmortizationScheduleBlock
                title={
                  "Existing Subject-To Mortgage Amortization Schedule" +
                  (hybridExistingMortgageEffectiveAmortization.isEstimated ? " (Estimated Remaining Term)" : "")
                }
                schedule={hybridExistingMortgageAmortization.schedule}
                disclosure={SUBJECT_TO_AMORTIZATION_DISCLOSURE}
                note={
                  hybridExistingMortgageEffectiveAmortization.isEstimated
                    ? "Remaining term estimated mathematically from the entered balance, interest rate, and known monthly principal and interest payment, since Remaining Amortization (Years) was left blank."
                    : undefined
                }
                csvFilename="hybrid-existing-mortgage-amortization-schedule.csv"
              />
              <AmortizationEstimateStatus term={hybridExistingMortgageEffectiveAmortization} />

              <BalloonRefinanceAnalysisPanel
                balloonExists={hybridBalloonExists}
                onToggleExists={setHybridBalloonExists}
                balloonYearsDraft={hybridBalloonYearsDraft}
                onBalloonYearsChange={(raw) => {
                  setHybridBalloonYearsDraft(raw);
                  setHybridBalloonYears(Math.max(1, parseTypedInt(raw)));
                }}
                onBalloonYearsBlur={() => setHybridBalloonYearsDraft(String(Math.max(1, hybridBalloonYears)))}
                appreciationDraft={percentDraft.hybridBalloonAppreciationPct}
                onAppreciationChange={(raw) => handlePercentChange("hybridBalloonAppreciationPct", raw)}
                onAppreciationBlur={() => handlePercentBlur("hybridBalloonAppreciationPct")}
                has70LtvContingency={hybridBalloonHas70LtvContingency}
                onToggleContingency={setHybridBalloonHas70LtvContingency}
                analysis={hybridBalloonAnalysis}
                loanBalanceRows={
                  hybridBalloonAnalysis
                    ? [
                        {
                          label: "Existing Subject-To Balance at Balloon",
                          value: hybridBalloonAnalysis.mortgageBalanceAtBalloon,
                        },
                        {
                          label: "Seller-Finance Balance at Balloon",
                          value: hybridBalloonAnalysis.sellerFinanceBalanceAtBalloon,
                        },
                      ]
                    : []
                }
              />

              {/* Hybrid Seller-Finance Amortization Schedule: covers only
                  the seller-financed balance, using the Hybrid
                  Seller-Finance Interest Rate (never the Existing
                  Mortgage Interest Rate above), and only appears when
                  monthly seller-finance payments are required -- when
                  they are not required, the balance simply carries
                  unamortized to the balloon date, so there is no
                  schedule to show. */}
              {hybridSellerFinancePaymentsRequired ? (
                <AmortizationScheduleBlock
                  title="Hybrid Seller-Finance Amortization Schedule"
                  schedule={hybridAmortization.schedule}
                  csvFilename="hybrid-seller-finance-amortization-schedule.csv"
                />
              ) : (
                <div className="mt-8 pt-6 border-t border-line-dark">
                  <p className="eyebrow text-ink/70 mb-2">Hybrid Seller-Finance Amortization Schedule</p>
                  <p className="text-xs text-ink/50 leading-relaxed">
                    No monthly seller-finance payments are required for this deal, so the
                    seller-financed balance is not amortized -- it carries in full, unchanged, until
                    the balloon date.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ------------------------------------------------------ */}
          {/* Stack Method: a two-position creative-finance structure
              combining a first-position bank/DSCR loan with second-
              position seller financing carrying the seller's remaining
              equity. Reproduces the acquisition and cash-to-close
              formulas reviewed in the attached workbook, plus new
              monthly-payment calculations needed to feed the combined
              housing payment into the co-living underwriting below. */}
          {/* ------------------------------------------------------ */}
          {financingMode === "stackMethod" && (
            <div className="mt-8 pt-6 border-t border-line-dark">
              <p className="eyebrow text-brass mb-3">Stack Method</p>
              <p className="text-xs text-ink/50 leading-relaxed mb-2">
                Stack Method is a creative finance structure for sellers who want a big down
                payment. You split the deal into two parts:
              </p>
              <ul className="mb-3 space-y-1.5 text-xs text-ink/50 leading-relaxed list-disc pl-5">
                <li>A first-position bank or DSCR loan, typically around half of the purchase price</li>
                <li>
                  The seller may carry the remaining balance in second position. Depending on the
                  negotiated terms, that balance may include monthly payments, deferred payments, a
                  balloon payment, or another repayment structure.
                </li>
              </ul>
              <p className="text-xs text-ink/40 leading-relaxed mb-6">
                Because a lender is involved, the property must appraise and the numbers have to
                pencil. It is the only creative strategy taught here that requires a bank, which is
                why it is called a higher-tier skill set. The upside is you can conserve or even
                eliminate your own out-of-pocket by letting the bank fund most of what the seller
                wants upfront, while the seller carries the rest on terms.
              </p>

              <p className="eyebrow text-ink/50 mb-3">Acquisition Data</p>
              <div className="grid sm:grid-cols-2 gap-5">
                <CurrencyField
                  id="purchasePriceStack"
                  label="Purchase Price"
                  draft={financingDraft.purchasePrice}
                  onChange={(raw) => handleFinancingChange("purchasePrice", raw)}
                  onBlur={() => handleFinancingBlur("purchasePrice")}
                />
                {stackLtvAutoSelected !== null ? (
                  <ReadOnlyStat
                    label="Bank Loan-to-Value Percentage"
                    value={formatPercent(stackEffectiveBankLtvPct)}
                    helperText="Automatically set by the Long-Term Rent Qualification check below. Clear the Estimated Monthly Long-Term Rent field to select a percentage manually again."
                    info="The share of the purchase price a bank or DSCR lender is estimated to finance in first position. A higher percentage means a larger first-position loan and a smaller cash-to-close requirement."
                  />
                ) : (
                  <PercentField
                    id="stackBankLtvPct"
                    label="Bank Loan-to-Value Percentage"
                    draft={percentDraft.stackBankLtvPct}
                    onChange={(raw) => handlePercentChange("stackBankLtvPct", raw)}
                    onBlur={() => handlePercentBlur("stackBankLtvPct")}
                    info="The share of the purchase price a bank or DSCR lender is estimated to finance in first position. A higher percentage means a larger first-position loan and a smaller cash-to-close requirement."
                  />
                )}
                <PercentField
                  id="stackClosingCostPct"
                  label="Closing Cost Percentage"
                  draft={percentDraft.stackClosingCostPct}
                  onChange={(raw) => handlePercentChange("stackClosingCostPct", raw)}
                  onBlur={() => handlePercentBlur("stackClosingCostPct")}
                  info="Applied to the purchase price to estimate closing costs for the first-position bank loan."
                />
                <PercentField
                  id="stackAgentCommissionPct"
                  label="Agent Commission Percentage"
                  draft={percentDraft.stackAgentCommissionPct}
                  onChange={(raw) => handlePercentChange("stackAgentCommissionPct", raw)}
                  onBlur={() => handlePercentBlur("stackAgentCommissionPct")}
                  info="Applied to the purchase price to estimate agent commission, if any."
                />
                <CurrencyField
                  id="assignmentFeeStack"
                  label="Assignment Fee"
                  draft={capitalDraft.assignmentFee}
                  onChange={(raw) => handleCapitalChange("assignmentFee", raw)}
                  onBlur={() => handleCapitalBlur("assignmentFee")}
                  helperText="Shared with the Assignment Fee entered in Total Capital Required below; editing it in either place updates both."
                />
                <PercentField
                  id="stackTransactionalFundingFeePct"
                  label="Transactional Funding Fee Percentage"
                  draft={percentDraft.stackTransactionalFundingFeePct}
                  onChange={(raw) => handlePercentChange("stackTransactionalFundingFeePct", raw)}
                  onBlur={() => handlePercentBlur("stackTransactionalFundingFeePct")}
                  info="A short-term funding fee sometimes used to help cover the cash-to-close gap for a brief period. This is an estimate only, not a lending commitment, and not legal, lending, or tax advice."
                />
              </div>

              {/* Long-Term Rent Qualification: an optional check comparing
                  what the property could rent for on a traditional
                  long-term lease against the Bank PITI at an 80% LTV
                  assumption, to decide whether an 80% or a more
                  conservative 75% Bank Loan-to-Value Percentage should be
                  used. Only takes effect once a Long-Term Rent has been
                  entered; leaving it blank keeps the manually selected
                  percentage above unchanged. */}
              <div className="mt-8 pt-6 border-t border-line-dark">
                <p className="eyebrow text-ink/50 mb-3">Long-Term Rent Qualification</p>
                <div className="grid sm:grid-cols-2 gap-5">
                  <CurrencyField
                    id="stackLongTermRent"
                    label="Estimated Monthly Long-Term Rent"
                    draft={stackLongTermRentDraft}
                    onChange={handleStackLongTermRentChange}
                    onBlur={handleStackLongTermRentBlur}
                    helperText="Optional. The property's projected monthly rent on a traditional long-term lease (not co-living). Leave blank to select the Bank Loan-to-Value Percentage above manually instead."
                  />
                  <ReadOnlyStat label="Selected LTV" value={formatPercent(stackEffectiveBankLtvPct)} />
                </div>

                {stackLongTermRent === null ? (
                  <p className="mt-4 text-sm text-ink/50 leading-relaxed">
                    Enter an estimated long-term monthly rent to evaluate DSCR loan leverage.
                  </p>
                ) : stackLongTermRent >= stackBankPITIAt80 ? (
                  <div className="mt-4 rounded border border-green-700 bg-green-50 p-4">
                    <p className="text-sm text-green-800 leading-relaxed">
                      Estimated long-term rent supports the bank payment. Proceeding with an 80% LTV
                      assumption.
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 rounded border border-red-700 bg-red-50 p-4">
                    <p className="text-sm text-red-800 leading-relaxed">
                      Estimated long-term rent does not fully support the bank payment. Using a more
                      conservative 75% LTV assumption.
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-8 pt-6 border-t border-line-dark">
                <p className="eyebrow text-ink/50 mb-3">Property Information</p>
                <div className="grid sm:grid-cols-2 gap-5">
                  <CurrencyField
                    id="stackSellerFirstLoanBalance"
                    label="Seller's Current First Loan Balance"
                    draft={financingDraft.stackSellerFirstLoanBalance}
                    onChange={(raw) => handleFinancingChange("stackSellerFirstLoanBalance", raw)}
                    onBlur={() => handleFinancingBlur("stackSellerFirstLoanBalance")}
                  />
                  <CurrencyField
                    id="stackSellerSecondLien"
                    label="Existing Second Lien"
                    draft={financingDraft.stackSellerSecondLien}
                    onChange={(raw) => handleFinancingChange("stackSellerSecondLien", raw)}
                    onBlur={() => handleFinancingBlur("stackSellerSecondLien")}
                  />
                  <CurrencyField
                    id="stackMiscLiens"
                    label="Miscellaneous Liens"
                    draft={financingDraft.stackMiscLiens}
                    onChange={(raw) => handleFinancingChange("stackMiscLiens", raw)}
                    onBlur={() => handleFinancingBlur("stackMiscLiens")}
                  />
                  <CurrencyField
                    id="stackDownPaymentToSeller"
                    label="Down Payment to Seller"
                    draft={financingDraft.stackDownPaymentToSeller}
                    onChange={(raw) => handleFinancingChange("stackDownPaymentToSeller", raw)}
                    onBlur={() => handleFinancingBlur("stackDownPaymentToSeller")}
                    helperText="The cash the seller is to receive toward their equity at closing. Not the bank loan down payment."
                  />
                </div>
              </div>

              {financing.stackSellerFirstLoanBalance +
                financing.stackSellerSecondLien +
                financing.stackMiscLiens +
                financing.stackDownPaymentToSeller >
                financing.purchasePrice && (
                <p className="mt-4 text-sm text-red-700">
                  The existing debt, liens, and seller down payment exceed the purchase price. Please
                  review the entered amounts.
                </p>
              )}

              {/* Acquisition Structure */}
              <div className="mt-8 pt-6 border-t border-line-dark">
                <p className="eyebrow text-ink/50 mb-3">Acquisition Structure</p>
                <div className="grid sm:grid-cols-2 gap-5">
                  <ReadOnlyStat
                    label="Estimated First-Position Bank Loan"
                    value={formatWhole(stackBankLoanAmount)}
                    helperText="Purchase Price x Bank Loan-to-Value Percentage."
                    info="The primary loan, typically from a bank or DSCR lender, repaid first if the property is ever sold or foreclosed on."
                  />
                  <ReadOnlyStat
                    label="Estimated Seller-Financed Balance"
                    value={formatWhole(stackSellerFinancedBalance)}
                    helperText="Purchase Price minus Seller's Current First Loan Balance, Existing Second Lien, Miscellaneous Liens, and Down Payment to Seller. Never falls below $0."
                    info="Second-position financing provided directly by the seller for the remaining balance, repaid after the first-position loan. Not legal, lending, or tax advice."
                  />
                  <ReadOnlyStat label="Total Debt at Acquisition" value={formatWhole(stackTotalDebtAtAcquisition)} />
                  <ReadOnlyStat
                    label="Current Leverage Ratio"
                    value={formatLeverageRatio(stackLeverageRatioDecimal)}
                    helperText="Total Debt at Acquisition divided by Purchase Price. May exceed 100%."
                    info="Total debt (bank loan plus seller financing) as a percentage of the purchase price. A ratio above 100% means the total financing exceeds the purchase price."
                  />
                </div>
                {stackTotalDebtAtAcquisition > financing.purchasePrice && financing.purchasePrice > 0 && (
                  <p className="mt-4 text-sm text-amber-700">
                    This structure creates total acquisition debt above the purchase price. Confirm
                    that the lender, appraisal, title company, and all parties will permit the
                    proposed structure.
                  </p>
                )}
              </div>

              {/* Closing Structure */}
              <div className="mt-8 pt-6 border-t border-line-dark">
                <p className="eyebrow text-ink/50 mb-3">Closing Structure</p>
                <div className="grid sm:grid-cols-2 gap-5">
                  <ReadOnlyStat label="Bank Loan Down Payment" value={formatWhole(stackBankLoanDownPayment)} />
                  <ReadOnlyStat label="Stack Method Closing Costs" value={formatWhole(stackClosingCosts)} />
                  <ReadOnlyStat label="Agent Fees" value={formatWhole(stackAgentFees)} />
                  <ReadOnlyStat label="Assignment Fee" value={formatWhole(capital.assignmentFee)} />
                  <ReadOnlyStat
                    label="Cash to Close, Leg 1"
                    value={formatWhole(stackCashToCloseLeg1)}
                    helperText="Bank Loan Down Payment + Stack Method Closing Costs + Agent Fees + Assignment Fee. Does not yet include the Transactional Funding Fee."
                    info="The estimated cash needed to close the first-position bank loan, before the transactional funding fee or the seller-financed proceeds are factored in."
                  />
                  <ReadOnlyStat
                    label="Transactional Funding Fee"
                    value={formatWhole(stackTransactionalFundingFee)}
                    helperText="Cash to Close, Leg 1 x Transactional Funding Fee Percentage."
                  />
                </div>

                <div className="mt-6 rounded border border-line-dark bg-white p-6">
                  <p className="eyebrow text-brass mb-1.5">
                    {stackEstimatedBuyerCashAtClosing < 0
                      ? "Estimated Buyer Cash Required"
                      : "Estimated Cash to Buyer at Closing"}
                  </p>
                  <p className="font-display text-2xl text-ink">
                    {formatCents(Math.abs(stackEstimatedBuyerCashAtClosing))}
                  </p>
                  <p className="mt-2 text-xs text-ink/50 leading-relaxed">
                    Calculation: Seller-Financed Balance {formatCents(stackSellerFinancedBalance)} minus Cash to
                    Close, Leg 1 {formatCents(stackCashToCloseLeg1)} minus Transactional Funding Fee{" "}
                    {formatCents(stackTransactionalFundingFee)} = {formatCents(stackEstimatedBuyerCashAtClosing)}
                  </p>
                  <p className="mt-3 text-xs text-ink/50 leading-relaxed">
                    A positive result is estimated cash available to the buyer at closing after the
                    modeled costs. $0 means an estimated $0-out-of-pocket structure. A negative result
                    means the buyer must contribute that amount out of pocket.
                  </p>
                </div>

                <div className="mt-4">
                  <p className="mb-2">
                    <FieldLabel>Can this be purchased for an estimated $0 out of pocket?</FieldLabel>
                  </p>
                  <ZeroOutOfPocketBadge value={stackZeroOutOfPocket} />
                </div>
              </div>

              {/* Estimated Seller Cash at Closing + reconciliation */}
              <div className="mt-8 pt-6 border-t border-line-dark">
                <ReadOnlyStat
                  label="Estimated Seller Cash at Closing"
                  value={formatWhole(stackEstimatedSellerCashAtClosing)}
                  helperText="Purchase Price minus Seller's Current First Loan Balance minus Estimated Seller-Financed Balance."
                />
                <p className="mt-4 mb-2 eyebrow text-ink/50">Seller Cash and Payoff Reconciliation</p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between border-b border-line-dark/40 py-1.5">
                    <span className="text-ink/60">Down Payment to Seller</span>
                    <span>{formatCents(financing.stackDownPaymentToSeller)}</span>
                  </div>
                  <div className="flex justify-between border-b border-line-dark/40 py-1.5">
                    <span className="text-ink/60">Seller's Current First Loan Payoff</span>
                    <span>{formatCents(financing.stackSellerFirstLoanBalance)}</span>
                  </div>
                  <div className="flex justify-between border-b border-line-dark/40 py-1.5">
                    <span className="text-ink/60">Existing Second Lien Payoff</span>
                    <span>{formatCents(financing.stackSellerSecondLien)}</span>
                  </div>
                  <div className="flex justify-between border-b border-line-dark/40 py-1.5">
                    <span className="text-ink/60">Miscellaneous Lien Payoff</span>
                    <span>{formatCents(financing.stackMiscLiens)}</span>
                  </div>
                  <div className="flex justify-between border-b border-line-dark/40 py-1.5">
                    <span className="text-ink/60">Seller-Financed Balance</span>
                    <span>{formatCents(stackSellerFinancedBalance)}</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-ink/60">Purchase Price</span>
                    <span>{formatCents(financing.purchasePrice)}</span>
                  </div>
                </div>
              </div>

              {/* Monthly Bank Financing */}
              <div className="mt-8 pt-6 border-t border-line-dark">
                <p className="eyebrow text-ink/50 mb-3">First-Position Bank or DSCR Loan Payment</p>
                <div className="grid sm:grid-cols-2 gap-5">
                  <PercentField
                    id="stackBankInterestRatePct"
                    label="Bank Interest Rate"
                    draft={percentDraft.stackBankInterestRatePct}
                    onChange={(raw) => handlePercentChange("stackBankInterestRatePct", raw)}
                    onBlur={() => handlePercentBlur("stackBankInterestRatePct")}
                  />
                  <ReadOnlyStat
                    label="Bank Amortization"
                    value="30 Years"
                    helperText="Fixed at a standard 30-year (360 monthly payment) amortization; not editable."
                  />
                  <CurrencyField
                    id="annualPropertyInsuranceStack"
                    label="Annual Property Insurance"
                    draft={financingDraft.annualPropertyInsurance}
                    onChange={(raw) => handleFinancingChange("annualPropertyInsurance", raw)}
                    onBlur={() => handleFinancingBlur("annualPropertyInsurance")}
                  />
                </div>

                <PropertyTaxSection
                  idPrefix="stack"
                  county={propertyTaxCounty}
                  onCountyChange={handlePropertyTaxCountyChange}
                  rateDraft={propertyTaxRateDraft}
                  onRateChange={handlePropertyTaxRateChange}
                  onRateBlur={handlePropertyTaxRateBlur}
                  rateSource={propertyTaxRateSource}
                  calculatedTax={calculatedAnnualPropertyTaxes}
                  usedTaxDraft={financingDraft.annualPropertyTaxes}
                  onUsedTaxChange={handlePropertyTaxUsedChange}
                  onUsedTaxBlur={() => handleFinancingBlur("annualPropertyTaxes")}
                  taxSource={propertyTaxSource}
                  onUseCalculated={useCalculatedPropertyTax}
              countyIsAutoIdentified={countyIsAutoIdentified}
              countyAutoStatus={countyAutoStatus}
              countySuggestion={countySuggestion}
              countySuggestionInTable={countySuggestionInTable}
              countySuggestionDiffersFromCurrent={countySuggestionDiffersFromCurrent}
              onUseSuggestedCounty={acceptSuggestedCounty}
              onRetryCountyLookup={retryCountyLookup}
                />

                <div className="mt-6 grid sm:grid-cols-2 gap-5">
                  <ReadOnlyStat
                    label="Monthly Bank Principal and Interest"
                    value={formatCents(stackBankMonthlyPI)}
                  />
                  <ReadOnlyStat label="Monthly Property Taxes" value={formatCents(stackMonthlyPropertyTaxes)} />
                  <ReadOnlyStat
                    label="Monthly Property Insurance"
                    value={formatCents(stackMonthlyPropertyInsurance)}
                  />
                  <ReadOnlyStat
                    label="Estimated Monthly Bank PITI"
                    value={formatCents(stackMonthlyBankPITI)}
                    helperText="Monthly Bank Principal and Interest + Monthly Property Taxes + Monthly Property Insurance."
                  />
                </div>
              </div>

              {/* Seller Financing Terms */}
              <div className="mt-8 pt-6 border-t border-line-dark">
                <p className="eyebrow text-ink/50 mb-3">Seller Financing Terms</p>
                <div className="grid sm:grid-cols-2 gap-5">
                  <ReadOnlyStat
                    label="Estimated Seller-Financed Balance"
                    value={formatCents(stackSellerFinancedBalance)}
                  />
                </div>

                {/* Are Monthly Seller Finance Payments Required?: the
                    seller-financed balance can exist without any monthly
                    payment on it at all (deferred, interest-free, or due
                    at a balloon/negotiated date instead). Defaults to No,
                    so no monthly seller-finance payment is ever
                    automatically assumed. */}
                <div className="mt-6">
                  <p className="eyebrow text-ink/50 mb-3 inline-flex items-center">
                    Are Monthly Seller Finance Payments Required?
                    <InfoTip text="No means the seller-financed balance is not amortized with a monthly payment here (it may be deferred, interest-free, or due at a balloon/negotiated date). Yes calculates a monthly payment using the terms below." />
                  </p>
                  <div className="inline-flex border border-line-dark" role="group" aria-label="Are Monthly Seller Finance Payments Required?">
                    <button
                      type="button"
                      onClick={() => setStackSellerFinancePaymentsRequired(false)}
                      aria-pressed={!stackSellerFinancePaymentsRequired}
                      className={`px-4 py-2 text-sm transition-colors ${
                        !stackSellerFinancePaymentsRequired
                          ? "bg-brass/10 text-ink border-r border-line-dark"
                          : "text-ink/60 hover:text-ink border-r border-line-dark"
                      }`}
                    >
                      No
                    </button>
                    <button
                      type="button"
                      onClick={() => setStackSellerFinancePaymentsRequired(true)}
                      aria-pressed={stackSellerFinancePaymentsRequired}
                      className={`px-4 py-2 text-sm transition-colors ${
                        stackSellerFinancePaymentsRequired ? "bg-brass/10 text-ink" : "text-ink/60 hover:text-ink"
                      }`}
                    >
                      Yes
                    </button>
                  </div>
                </div>

                {stackSellerFinancePaymentsRequired ? (
                  <>
                    <div className="mt-6 grid sm:grid-cols-2 gap-5">
                      <PercentField
                        id="stackSellerFinanceRatePct"
                        label="Seller Finance Interest Rate"
                        draft={percentDraft.stackSellerFinanceRatePct}
                        onChange={(raw) => handlePercentChange("stackSellerFinanceRatePct", raw)}
                        onBlur={() => handlePercentBlur("stackSellerFinanceRatePct")}
                        info="Decimals and 0% are both allowed."
                      />
                      <ReadOnlyStat
                        label="Seller Finance Amortization"
                        value="30 Years"
                        helperText="Fixed at a standard 30-year (360 monthly payment) amortization; not editable."
                      />
                    </div>
                    <div className="mt-6 rounded border border-brass bg-paper-2 p-6">
                      <p className="eyebrow text-brass mb-1.5">Estimated Monthly Seller Finance Payment</p>
                      <p className="font-display text-2xl text-ink">
                        {formatCents(stackMonthlySellerFinancePayment)}
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="mt-4 text-xs text-ink/50 leading-relaxed">
                    No monthly seller-finance payment is included in this underwriting. The
                    seller-financed balance may be deferred or paid according to separately
                    negotiated terms.
                  </p>
                )}
              </div>

              {/* Total Monthly Housing Payment */}
              <div className="mt-8 pt-6 border-t border-line-dark rounded border border-line-dark bg-white p-6">
                <p className="eyebrow text-brass mb-4">Total Monthly Housing Payment</p>
                <div className="divide-y divide-line-dark border-t border-b border-line-dark">
                  <div className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-ink/70">Estimated Monthly Bank PITI</span>
                    <span>{formatCents(stackMonthlyBankPITI)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-ink/70">Monthly Seller Finance Payment</span>
                    <span>
                      {stackSellerFinancePaymentsRequired
                        ? formatCents(stackMonthlySellerFinancePayment)
                        : "Not Included"}
                    </span>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between rounded bg-brass/10 border border-brass px-4 py-4">
                  <span className="eyebrow text-brass">Total Monthly Housing Payment</span>
                  <span className="font-display text-2xl text-ink">
                    {formatCents(results.monthlyHousingPayment)}
                  </span>
                </div>
              </div>

              {/* Capital Required Reconciliation: shows how the signed
                  Estimated Cash to Buyer at Closing result adjusts Base
                  Capital Required (every other applicable capital item,
                  since Cash to Close, Leg 1 already contains the Bank
                  Loan Down Payment, Stack Method Closing Costs, Agent
                  Fees, and Assignment Fee) down to the final Adjusted
                  Total Capital Required, floored at $0. */}
              <div className="mt-8 pt-6 border-t border-line-dark">
                <p className="eyebrow text-ink/50 mb-3">Capital Required Reconciliation</p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between border-b border-line-dark/40 py-1.5">
                    <span className="text-ink/60">Base Capital Required</span>
                    <span>{formatCents(results.stackBaseCapitalRequired)}</span>
                  </div>
                  <div className="flex justify-between border-b border-line-dark/40 py-1.5">
                    <span className="text-ink/60">
                      {stackEstimatedBuyerCashAtClosing >= 0
                        ? "Estimated Cash to Buyer at Closing"
                        : "Estimated Buyer Cash Required"}
                    </span>
                    <span>
                      {stackEstimatedBuyerCashAtClosing >= 0
                        ? `-${formatCents(stackEstimatedBuyerCashAtClosing)}`
                        : `+${formatCents(Math.abs(stackEstimatedBuyerCashAtClosing))}`}
                    </span>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between rounded bg-brass/10 border border-brass px-4 py-4">
                  <span className="eyebrow text-brass">Adjusted Total Capital Required</span>
                  <span className="font-display text-2xl text-ink">
                    {formatCents(results.totalCapitalRequired)}
                  </span>
                </div>
                {results.stackNetCashToBuyerAfterProjectCosts > 0 ? (
                  <>
                    <div className="mt-3 flex items-center justify-between rounded bg-brass/5 border border-brass/40 px-4 py-4">
                      <span className="eyebrow text-brass">Net Cash to Buyer After Project Costs</span>
                      <span className="font-display text-2xl text-ink">
                        {formatCents(results.stackNetCashToBuyerAfterProjectCosts)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-ink/40 leading-relaxed">
                      Adjusted Total Capital Required never falls below $0. When cash received at
                      closing exceeds Base Capital Required, the excess is shown here instead of
                      being discarded.
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-ink/40 leading-relaxed">
                    Never falls below $0, even if Base Capital Required is fully offset by the cash to
                    buyer.
                  </p>
                )}
              </div>

              <BalloonRefinanceAnalysisPanel
                balloonExists={stackBalloonExists}
                onToggleExists={setStackBalloonExists}
                balloonYearsDraft={stackBalloonYearsDraft}
                onBalloonYearsChange={(raw) => {
                  setStackBalloonYearsDraft(raw);
                  setStackBalloonYears(Math.max(1, parseTypedInt(raw)));
                }}
                onBalloonYearsBlur={() => setStackBalloonYearsDraft(String(Math.max(1, stackBalloonYears)))}
                appreciationDraft={percentDraft.stackBalloonAppreciationPct}
                onAppreciationChange={(raw) => handlePercentChange("stackBalloonAppreciationPct", raw)}
                onAppreciationBlur={() => handlePercentBlur("stackBalloonAppreciationPct")}
                has70LtvContingency={stackBalloonHas70LtvContingency}
                onToggleContingency={setStackBalloonHas70LtvContingency}
                analysis={stackBalloonAnalysis}
                loanBalanceRows={
                  stackBalloonAnalysis
                    ? [
                        { label: "First-Position Loan Balance at Balloon", value: stackBalloonAnalysis.bankBalanceAtBalloon },
                        { label: "Seller-Finance Balance at Balloon", value: stackBalloonAnalysis.sellerBalanceAtBalloon },
                      ]
                    : []
                }
                stackRefinanceDetail
              />

              {/* Bank Loan Amortization Schedule: the first-position
                  bank/DSCR loan, always shown separately from the
                  second-position seller-carried loan below -- never
                  blended. */}
              <AmortizationScheduleBlock
                title="Bank Loan Amortization Schedule"
                schedule={stackBankAmortization.schedule}
                csvFilename="stack-method-bank-loan-amortization-schedule.csv"
              />

              {/* Seller Finance Amortization Schedule: the second-position
                  seller-carried loan, and only appears when monthly
                  seller-finance payments are required -- when they are
                  not required, the balance simply carries unamortized to
                  the balloon date, so there is no schedule to show. */}
              {stackSellerFinancePaymentsRequired ? (
                <AmortizationScheduleBlock
                  title="Seller-Carried Second Amortization Schedule"
                  schedule={stackSellerAmortization.schedule}
                  csvFilename="stack-method-seller-finance-amortization-schedule.csv"
                />
              ) : (
                <div className="mt-8 pt-6 border-t border-line-dark">
                  <p className="eyebrow text-ink/70 mb-2">Seller-Carried Second Amortization Schedule</p>
                  <p className="text-xs text-ink/50 leading-relaxed">
                    No monthly seller-finance payments are required for this deal, so the
                    seller-financed balance is not amortized -- it carries in full, unchanged, until
                    the balloon date.
                  </p>
                </div>
              )}

              {/* Co-Living Underwriting note: the existing shared-housing
                  underwriting fields and results immediately below this
                  section automatically use Total Monthly Housing Payment
                  as the housing expense -- no financing figures need to
                  be re-entered. */}
              {results.totalCapitalRequired === 0 && (
                <div className="mt-8 pt-6 border-t border-line-dark">
                  <p className="text-sm text-ink/60 leading-relaxed">
                    Cash-on-Cash Return: {stackCocrLabel}.{" "}
                    {results.stackNetCashToBuyerAfterProjectCosts > 0
                      ? `Cash received at closing more than covers every modeled project cost, so there is no net capital invested and a traditional cash-on-cash percentage is not applicable. Net Cash to Buyer After Project Costs: ${formatCents(results.stackNetCashToBuyerAfterProjectCosts)}.`
                      : "This structure models no net buyer capital contribution after the closing adjustment, so a traditional cash-on-cash percentage is not applicable."}
                  </p>
                </div>
              )}
            </div>
          )}

          {financingMode !== "stackMethod" && (
          <div className="mt-8 pt-6 border-t border-line-dark">
            <ReadOnlyStat
              label="Estimated Equity"
              value={formatWhole(results.equity)}
              helperText={
                financingMode === "traditional"
                  ? "Estimated equity is calculated by subtracting the estimated loan balance from the purchase price."
                  : financingMode === "hybrid"
                    ? "Estimated equity is calculated by subtracting the existing mortgage balance and the Seller-Financed Balance Used from the purchase price."
                    : "Estimated equity is calculated by subtracting the loan balance from the purchase price."
              }
            />
            {financingMode !== "traditional" && financingMode !== "hybrid" && results.equityIsNegative && (
              <p className="mt-3 text-sm text-red-700">
                The loan balance exceeds the purchase price.
              </p>
            )}
            {financingMode === "hybrid" && results.equityIsNegative && (
              <p className="mt-3 text-sm text-red-700">
                The existing mortgage balance and Seller-Financed Balance Used exceed the purchase
                price.
              </p>
            )}
          </div>
          )}
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Section 2: Bedrooms and rental income                      */}
        {/* ---------------------------------------------------------- */}
        <div className="print:hidden mt-6 bg-paper text-ink p-6 sm:p-8 md:p-10">
          <p className="eyebrow text-brass mb-5">Bedrooms and Rental Income</p>
          <div className="grid sm:grid-cols-2 gap-5">
            <IntegerField
              id="sharedBathBedrooms"
              label="Bedrooms With Shared Bathrooms"
              draft={sharedBathBedroomsDraft}
              onChange={(raw) => {
                setSharedBathBedroomsDraft(raw);
                setSharedBathBedrooms(parseTypedInt(raw));
              }}
              onBlur={() => setSharedBathBedroomsDraft(String(sharedBathBedrooms))}
            />
            <CurrencyField
              id="weeklySharedBathRent"
              label="Average Weekly Rent Per Shared-Bath Bedroom"
              draft={weeklySharedBathRentDraft}
              onChange={(raw) => {
                setWeeklySharedBathRentDraft(raw);
                setWeeklySharedBathRent(parseTypedAmount(raw));
              }}
              onBlur={() => {
                const clamped = round2(Math.max(0, weeklySharedBathRent));
                setWeeklySharedBathRent(clamped);
                setWeeklySharedBathRentDraft(formatCents(clamped));
              }}
            />
            <IntegerField
              id="ensuiteBedrooms"
              label="Number of Ensuite Bedrooms"
              draft={ensuiteBedroomsDraft}
              onChange={(raw) => {
                setEnsuiteBedroomsDraft(raw);
                setEnsuiteBedrooms(parseTypedInt(raw));
              }}
              onBlur={() => setEnsuiteBedroomsDraft(String(ensuiteBedrooms))}
            />
            <CurrencyField
              id="weeklyEnsuiteRent"
              label="Average Weekly Rent Per Ensuite Bedroom"
              draft={weeklyEnsuiteRentDraft}
              onChange={(raw) => {
                setWeeklyEnsuiteRentDraft(raw);
                setWeeklyEnsuiteRent(parseTypedAmount(raw));
              }}
              onBlur={() => {
                const clamped = round2(Math.max(0, weeklyEnsuiteRent));
                setWeeklyEnsuiteRent(clamped);
                setWeeklyEnsuiteRentDraft(formatCents(clamped));
              }}
            />
          </div>

          <div className="mt-8 pt-6 border-t border-line-dark grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <ReadOnlyStat label="Total Bedrooms" value={String(results.totalBedrooms)} />
            <ReadOnlyStat
              label="Monthly Rent From Shared-Bath Bedrooms"
              value={formatCents(results.monthlySharedBathRent)}
            />
            <ReadOnlyStat
              label="Monthly Rent From Ensuite Bedrooms"
              value={formatCents(results.monthlyEnsuiteRent)}
            />
            <div className="sm:col-span-2 lg:col-span-2 border border-brass bg-paper-2 p-6">
              <p className="eyebrow text-brass mb-1.5">Estimated Monthly Gross Rent</p>
              <p className="font-display text-3xl">{formatCents(results.grossMonthlyRent)}</p>
            </div>
            <ReadOnlyStat
              label="Estimated Annual Gross Rent"
              value={formatCents(results.annualGrossRent)}
            />
          </div>

          {/* PadSplit Rental Data: a single optional supporting file
              (image or PDF), shared across every financing structure
              (not cleared by switching financing modes), processed
              exactly like the Floor Plan upload. Never read or used in
              any calculation -- documentation only. */}
          <div
            className={`mt-8 pt-6 border-t border-line-dark transition-colors ${
              isDraggingPadSplit ? "bg-brass/10 border-2 border-dashed border-brass -m-2 p-2" : ""
            }`}
            onDragEnter={handlePadSplitDragEnter}
            onDragOver={handlePadSplitDragOver}
            onDragLeave={handlePadSplitDragLeave}
            onDrop={handlePadSplitDrop}
          >
            <p className="eyebrow text-brass mb-2">PadSplit Rental Data</p>
            <p className="text-sm text-ink/60 leading-relaxed mb-5">
              Drag and drop a PadSplit rental-data image or PDF here, or click to browse.
            </p>

            {padSplitScreenshot ? (
              <div className="border border-line-dark bg-white p-3 max-w-sm">
                {padSplitScreenshot.kind === "image" ? (
                  <div className="flex items-center justify-center bg-paper-2">
                    <img
                      src={padSplitScreenshot.dataUrl}
                      alt={padSplitScreenshot.name || "PadSplit rental data screenshot"}
                      className="w-full h-40 object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-1.5 bg-paper-2 h-40 px-3 text-center">
                    <FileText size={28} className="text-ink/40" aria-hidden="true" />
                    <span className="text-xs text-ink/70 leading-snug break-all line-clamp-2">
                      {padSplitScreenshot.name || "PadSplit Rental Data.pdf"}
                    </span>
                    {padSplitScreenshot.size > 0 && (
                      <span className="text-[10px] text-ink/40">
                        {formatFileSize(padSplitScreenshot.size)}
                      </span>
                    )}
                    <a
                      href={padSplitScreenshot.dataUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-brass underline decoration-brass/50 underline-offset-2 hover:text-brass-light transition-colors inline-flex items-center gap-1"
                    >
                      Open PadSplit Rental Data PDF <ExternalLink size={10} aria-hidden="true" />
                    </a>
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <label className="text-xs text-brass underline decoration-brass/50 underline-offset-2 hover:text-brass-light transition-colors cursor-pointer">
                    Replace
                    <input
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
                      className="hidden"
                      aria-label="Replace PadSplit rental data file"
                      onChange={(e) => {
                        handlePadSplitScreenshotFile(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleRemovePadSplitScreenshot}
                    aria-label="Remove PadSplit rental data file"
                    className="text-xs text-ink/50 hover:text-red-700 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                aria-label="Add PadSplit rental data. Accepts PNG, JPG, JPEG, WEBP, or PDF files, one file."
                onClick={() => padSplitInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    padSplitInputRef.current?.click();
                  }
                }}
                className={`flex flex-col items-center justify-center gap-2 border border-dashed min-h-[128px] max-w-sm p-4 text-center cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-brass ${
                  isDraggingPadSplit
                    ? "border-brass bg-brass/10"
                    : "border-line-dark bg-white/60 hover:border-brass"
                }`}
              >
                <Upload size={18} className={isDraggingPadSplit ? "text-brass" : "text-ink/40"} aria-hidden="true" />
                <span className="text-xs text-ink/60">
                  {processingPadSplitScreenshot
                    ? "Processing..."
                    : isDraggingPadSplit
                      ? "Drop PadSplit rental data here"
                      : "Add Screenshot or PDF"}
                </span>
                {!isDraggingPadSplit && !processingPadSplitScreenshot && (
                  <span className="text-[10px] text-ink/40">
                    Click to browse, or drag and drop. PNG, JPG, JPEG, WEBP, or PDF.
                  </span>
                )}
                <input
                  ref={padSplitInputRef}
                  id="padSplitScreenshotInput"
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
                  className="hidden"
                  disabled={processingPadSplitScreenshot}
                  onChange={(e) => {
                    handlePadSplitScreenshotFile(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
            )}

            {padSplitScreenshotError && (
              <p role="alert" className="mt-4 text-sm text-red-700">
                {padSplitScreenshotError}
              </p>
            )}

            <p className="mt-4 text-xs text-ink/50 leading-relaxed">
              Supported formats: PNG, JPG, JPEG, WEBP, and PDF. One file. Supporting
              documentation only -- room rates are never automatically read or calculated from
              this file. Appears in the printable underwriting summary near the Rental Income
              section when uploaded.
            </p>
          </div>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Section 3: Operating expenses                               */}
        {/* ---------------------------------------------------------- */}
        <div className="print:hidden mt-6 bg-paper text-ink p-6 sm:p-8 md:p-10">
          <p className="eyebrow text-brass mb-5">Operating Expenses</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <PercentField
              id="vacancyPct"
              label="Vacancy"
              draft={percentDraft.vacancyPct}
              onChange={(raw) => handlePercentChange("vacancyPct", raw)}
              onBlur={() => handlePercentBlur("vacancyPct")}
              info="Applied to Estimated Monthly Gross Rent to account for months the property may sit unrented."
            />
            <PercentField
              id="platformFeePct"
              label="Platform Fees"
              draft={percentDraft.platformFeePct}
              onChange={(raw) => handlePercentChange("platformFeePct", raw)}
              onBlur={() => handlePercentBlur("platformFeePct")}
              info="Estimated PadSplit platform fees. Actual platform charges may vary based on the applicable agreement, services, property, and market."
            />
            <PercentField
              id="propertyManagementPct"
              label="Local Property Manager"
              draft={percentDraft.propertyManagementPct}
              onChange={(raw) => handlePercentChange("propertyManagementPct", raw)}
              onBlur={() => handlePercentBlur("propertyManagementPct")}
              info="Applied to effective rent after vacancy."
            />
            <CurrencyField
              id="cleaning"
              label="Cleaning"
              draft={maintenanceExpensesDraft.cleaning}
              onChange={(raw) => handleMaintenanceExpenseChange("cleaning", raw)}
              onBlur={() => handleMaintenanceExpenseBlur("cleaning")}
              helperText="Estimated monthly cleaning expense."
            />
            <CurrencyField
              id="lawnCare"
              label="Lawn Care"
              draft={maintenanceExpensesDraft.lawnCare}
              onChange={(raw) => handleMaintenanceExpenseChange("lawnCare", raw)}
              onBlur={() => handleMaintenanceExpenseBlur("lawnCare")}
              helperText="Estimated monthly lawn care expense."
            />
            <CurrencyField
              id="pestControl"
              label="Pest Control"
              draft={maintenanceExpensesDraft.pestControl}
              onChange={(raw) => handleMaintenanceExpenseChange("pestControl", raw)}
              onBlur={() => handleMaintenanceExpenseBlur("pestControl")}
              helperText="Estimated monthly pest control expense."
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="text-ink/40">
              {operatingDefaultsSourceLabel(
                addressStateAbbreviation,
                maintenanceExpenseIsAutoDefaulted.cleaning &&
                  maintenanceExpenseIsAutoDefaulted.lawnCare &&
                  maintenanceExpenseIsAutoDefaulted.pestControl
              )}
            </span>
            <button
              type="button"
              onClick={applyStateDefaultsToMaintenanceExpenses}
              className="inline-flex items-center gap-1 text-brass hover:text-ink underline underline-offset-2"
            >
              Use State Defaults
            </button>
          </div>

          <div className="mt-8 pt-6 border-t border-line-dark">
            <p className="eyebrow text-ink/50 mb-4">Monthly Expense Summary</p>
            <div className="divide-y divide-line-dark border-t border-b border-line-dark">
              <div className="flex items-center justify-between py-3">
                <span className="text-ink/70">{housingPaymentLabel}</span>
                <span className="font-display">{formatCents(results.monthlyHousingPayment)}</span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-ink/70">Vacancy</span>
                <span className="font-display">{formatCents(results.vacancyExpense)}</span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-ink/70 inline-flex items-center">
                  Platform Fees
                  <InfoTip text="Estimated PadSplit platform fees. Actual platform charges may vary based on the applicable agreement, services, property, and market." />
                </span>
                <span className="font-display">{formatCents(results.platformFees)}</span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-ink/70">Property Management</span>
                <span className="font-display">{formatCents(results.propertyManagementFee)}</span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-ink/70">
                  Maintenance{" "}
                  <span className="text-ink/40 text-xs">
                    ({formatWhole(MAINTENANCE_ANNUAL)}/year)
                  </span>
                </span>
                <span className="font-display">{formatCents(results.maintenanceMonthly)}</span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-ink/70">
                  Utilities{" "}
                  <span className="text-ink/40 text-xs">
                    ({formatWhole(UTILITIES_PER_BEDROOM)}/bedroom)
                  </span>
                </span>
                <span className="font-display">{formatCents(results.utilitiesMonthly)}</span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-ink/70">Cleaning</span>
                <span className="font-display">{formatCents(results.cleaningMonthly)}</span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-ink/70">Lawn Care</span>
                <span className="font-display">{formatCents(results.lawnCareMonthly)}</span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-ink/70">Pest Control</span>
                <span className="font-display">{formatCents(results.pestControlMonthly)}</span>
              </div>
              <div className="flex items-center justify-between py-4">
                <span className="eyebrow text-ink">Total Monthly Operating Expenses</span>
                <span className="font-display text-xl text-brass">
                  {formatCents(results.totalMonthlyOperatingExpenses)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Section 4: Upfront capital required                         */}
        {/* ---------------------------------------------------------- */}
        <div className="print:hidden mt-6 bg-paper text-ink p-6 sm:p-8 md:p-10">
          <p className="eyebrow text-brass mb-5">Upfront Capital Required</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {financingMode === "stackMethod" ? (
              <>
                <ReadOnlyStat
                  label="Base Capital Required"
                  value={formatWhole(results.stackBaseCapitalRequired)}
                  helperText="Every item below, before the Estimated Cash to Buyer at Closing / Estimated Buyer Cash Required adjustment. Does not include the Bank Loan Down Payment, Stack Method Closing Costs, Agent Fees, or Assignment Fee, which are already in Cash to Close, Leg 1."
                />
                <ReadOnlyStat
                  label={
                    stackEstimatedBuyerCashAtClosing >= 0
                      ? "Estimated Cash to Buyer at Closing (Reduces Total)"
                      : "Estimated Buyer Cash Required (Adds to Total)"
                  }
                  value={formatWhole(Math.abs(stackEstimatedBuyerCashAtClosing))}
                  helperText="Reused from the Stack Method section above."
                />
              </>
            ) : (
              <ReadOnlyStat
                label={downPaymentLabel}
                value={formatWhole(results.downPaymentForCapital)}
                helperText="Reused from Property and Financing above."
              />
            )}
            {financingMode !== "stackMethod" &&
              financingMode !== "traditional" &&
              financingMode !== "sellerFinancing" && (
                <CurrencyField
                  id="arrears"
                  label="Arrears"
                  draft={capitalDraft.arrears}
                  onChange={(raw) => handleCapitalChange("arrears", raw)}
                  onBlur={() => handleCapitalBlur("arrears")}
                />
              )}
            {useItemizedScopeOfWork ? (
              <ReadOnlyStat
                label="Renovation Cost"
                value={formatWhole(capital.renovationCost)}
                helperText="Automatically calculated from the Scope of Work Total below. Select No under Use Itemized Scope of Work Total to enter this manually instead."
              />
            ) : (
              <CurrencyField
                id="renovationCost"
                label="Renovation Cost"
                draft={capitalDraft.renovationCost}
                onChange={(raw) => handleCapitalChange("renovationCost", raw)}
                onBlur={() => handleCapitalBlur("renovationCost")}
                helperText="Entered manually. The Scope of Work Total below is shown for reference only."
              />
            )}
            <CurrencyField
              id="furniture"
              label="Furniture"
              draft={capitalDraft.furniture}
              onChange={(raw) => handleCapitalChange("furniture", raw)}
              onBlur={() => handleCapitalBlur("furniture")}
            />
            <CurrencyField
              id="appliances"
              label="Appliances"
              draft={capitalDraft.appliances}
              onChange={(raw) => handleCapitalChange("appliances", raw)}
              onBlur={() => handleCapitalBlur("appliances")}
            />
            <CurrencyField
              id="photos"
              label="Photos"
              draft={capitalDraft.photos}
              onChange={(raw) => handleCapitalChange("photos", raw)}
              onBlur={() => handleCapitalBlur("photos")}
            />
            <div>
              <label htmlFor="holdingCosts" className="block mb-2">
                <FieldLabel info="Three months of the full monthly housing payment (PITI, or principal and interest plus taxes and insurance). Editable: you may override this estimate.">
                  Holding Costs
                </FieldLabel>
                {holdingCostsIsManual && (
                  <span className="ml-2 inline-block eyebrow text-[10px] text-brass border border-brass/50 px-1.5 py-0.5 align-middle">
                    Manual override
                  </span>
                )}
              </label>
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40"
                  aria-hidden="true"
                >
                  $
                </span>
                <input
                  id="holdingCosts"
                  type="text"
                  inputMode="decimal"
                  value={holdingCostsDraft}
                  onChange={(e) => handleHoldingCostsChange(e.target.value)}
                  onBlur={handleHoldingCostsBlur}
                  className="w-full bg-white border border-line-dark pl-7 pr-3 py-2.5 text-ink outline-none focus:border-brass"
                />
              </div>
              <p className="mt-1.5 text-xs text-ink/50 leading-relaxed">
                Defaults to three months of the complete monthly housing
                payment. You may override this estimate.
              </p>
              {holdingCostsIsManual && (
                <button
                  type="button"
                  onClick={resetHoldingCostsToCalculated}
                  className="mt-2 text-xs text-brass underline decoration-brass/50 underline-offset-2 hover:text-brass-light transition-colors"
                >
                  Reset to Calculated Amount
                </button>
              )}
            </div>
            <CurrencyField
              id="reserves"
              label="Reserves"
              draft={capitalDraft.reserves}
              onChange={(raw) => handleCapitalChange("reserves", raw)}
              onBlur={() => handleCapitalBlur("reserves")}
              helperText="Estimated reserve funds set aside for the property. Defaults to $10,000, fully editable."
            />
            {financingMode !== "stackMethod" && financingMode !== "traditional" && (
              <CurrencyField
                id="upfrontInsurance"
                label="Upfront Insurance"
                draft={capitalDraft.upfrontInsurance}
                onChange={(raw) => handleCapitalChange("upfrontInsurance", raw)}
                onBlur={() => handleCapitalBlur("upfrontInsurance")}
                helperText="Prepaid or upfront insurance premium, separate from the annual insurance used in monthly operating expenses."
              />
            )}
            <CurrencyField
              id="acquisitionFee"
              label="Acquisition Fee"
              draft={capitalDraft.acquisitionFee}
              onChange={(raw) => handleCapitalChange("acquisitionFee", raw)}
              onBlur={() => handleCapitalBlur("acquisitionFee")}
            />
            {financingMode === "stackMethod" ? (
              <>
                <CurrencyField
                  id="stackTcFee"
                  label="TC Fee"
                  draft={capitalDraft.stackTcFee}
                  onChange={(raw) => handleCapitalChange("stackTcFee", raw)}
                  onBlur={() => handleCapitalBlur("stackTcFee")}
                  helperText="Transaction coordination cost."
                />
                <CurrencyField
                  id="stackLlcFee"
                  label="LLC Entity Formation Cost"
                  draft={capitalDraft.stackLlcFee}
                  onChange={(raw) => handleCapitalChange("stackLlcFee", raw)}
                  onBlur={() => handleCapitalBlur("stackLlcFee")}
                  helperText="Entity formation cost."
                />
              </>
            ) : financingMode === "traditional" ? (
              <>
                <CurrencyField
                  id="traditionalTcFee"
                  label="TC Fee"
                  draft={capitalDraft.traditionalTcFee}
                  onChange={(raw) => handleCapitalChange("traditionalTcFee", raw)}
                  onBlur={() => handleCapitalBlur("traditionalTcFee")}
                  helperText="Transaction coordination cost."
                />
                <CurrencyField
                  id="traditionalLlcFee"
                  label="LLC Entity Formation Cost"
                  draft={capitalDraft.traditionalLlcFee}
                  onChange={(raw) => handleCapitalChange("traditionalLlcFee", raw)}
                  onBlur={() => handleCapitalBlur("traditionalLlcFee")}
                  helperText="Entity formation cost."
                />
              </>
            ) : financingMode === "subjectTo" ? (
              <>
                <CurrencyField
                  id="subjectToTcFee"
                  label="TC Fee"
                  draft={capitalDraft.subjectToTcFee}
                  onChange={(raw) => handleCapitalChange("subjectToTcFee", raw)}
                  onBlur={() => handleCapitalBlur("subjectToTcFee")}
                  helperText="Transaction coordination cost."
                />
                <CurrencyField
                  id="subjectToLlcFee"
                  label="LLC Entity Formation Cost"
                  draft={capitalDraft.subjectToLlcFee}
                  onChange={(raw) => handleCapitalChange("subjectToLlcFee", raw)}
                  onBlur={() => handleCapitalBlur("subjectToLlcFee")}
                  helperText="Entity formation cost."
                />
              </>
            ) : financingMode === "hybrid" ? (
              <>
                <CurrencyField
                  id="hybridTcFee"
                  label="TC Fee"
                  draft={capitalDraft.hybridTcFee}
                  onChange={(raw) => handleCapitalChange("hybridTcFee", raw)}
                  onBlur={() => handleCapitalBlur("hybridTcFee")}
                  helperText="Transaction coordination cost."
                />
                <CurrencyField
                  id="hybridLlcFee"
                  label="LLC Entity Formation Cost"
                  draft={capitalDraft.hybridLlcFee}
                  onChange={(raw) => handleCapitalChange("hybridLlcFee", raw)}
                  onBlur={() => handleCapitalBlur("hybridLlcFee")}
                  helperText="Entity formation cost."
                />
              </>
            ) : (
              <>
                <CurrencyField
                  id="sellerFinancingTcFee"
                  label="TC Fee"
                  draft={capitalDraft.sellerFinancingTcFee}
                  onChange={(raw) => handleCapitalChange("sellerFinancingTcFee", raw)}
                  onBlur={() => handleCapitalBlur("sellerFinancingTcFee")}
                  helperText="Transaction coordination cost."
                />
                <CurrencyField
                  id="sellerFinancingLlcFee"
                  label="LLC Entity Formation Cost"
                  draft={capitalDraft.sellerFinancingLlcFee}
                  onChange={(raw) => handleCapitalChange("sellerFinancingLlcFee", raw)}
                  onBlur={() => handleCapitalBlur("sellerFinancingLlcFee")}
                  helperText="Entity formation cost."
                />
              </>
            )}
            {financingMode === "traditional" ? (
              <>
                <ReadOnlyStat
                  label="Traditional Closing Cost Percentage"
                  value={formatPercent(percent.traditionalClosingCostPct)}
                  helperText="Editable in the Traditional Financing section above. Applied to the Estimated Loan Balance, not the purchase price."
                />
                <ReadOnlyStat
                  label="Traditional Financing Closing Costs"
                  value={formatCents(results.closingCosts)}
                  helperText="Estimated Loan Balance x Traditional Closing Cost Percentage."
                />
              </>
            ) : financingMode === "stackMethod" ? (
              <>
                <ReadOnlyStat
                  label="Stack Method Closing Costs and Agent Fees"
                  value={`${formatCents(stackClosingCosts)} + ${formatCents(stackAgentFees)}`}
                  helperText="Editable in the Stack Method section above (Closing Cost Percentage and Agent Commission Percentage). Already included in the Net Stack Method Buyer Cash Requirement above, so not added again here."
                />
                <CurrencyField
                  id="agentFeeStackDisabled"
                  label="Agent Fee"
                  draft={capitalDraft.agentFee}
                  onChange={(raw) => handleCapitalChange("agentFee", raw)}
                  onBlur={() => handleCapitalBlur("agentFee")}
                  disabled
                  helperText="Not used for Stack Method. Agent Fees are calculated automatically from the Agent Commission Percentage entered in the Stack Method section above."
                />
              </>
            ) : (
              <>
                <PercentField
                  id="closingCostPct"
                  label="Estimated Closing Cost Percentage"
                  draft={percentDraft.closingCostPct}
                  onChange={(raw) => handlePercentChange("closingCostPct", raw)}
                  onBlur={() => handlePercentBlur("closingCostPct")}
                  info="Applied to the purchase price to estimate closing costs."
                />
                <ReadOnlyStat
                  label="Closing Costs"
                  value={formatCents(results.closingCosts)}
                  helperText="Calculated using the estimated closing cost percentage entered above."
                />
                <CurrencyField
                  id="agentFee"
                  label="Agent Fee"
                  draft={capitalDraft.agentFee}
                  onChange={(raw) => handleCapitalChange("agentFee", raw)}
                  onBlur={() => handleCapitalBlur("agentFee")}
                />
              </>
            )}
            <CurrencyField
              id="assignmentFee"
              label="Assignment Fee"
              draft={capitalDraft.assignmentFee}
              onChange={(raw) => handleCapitalChange("assignmentFee", raw)}
              onBlur={() => handleCapitalBlur("assignmentFee")}
              helperText={
                financingMode === "stackMethod"
                  ? "Shared with the Assignment Fee entered in the Stack Method section above; editing it in either place updates both."
                  : undefined
              }
            />
          </div>

          {/* Scope of Work: an optional itemized breakdown of Renovation
              Cost, shared across every financing structure. When Use
              Itemized Scope of Work Total is Yes (the default),
              Renovation Cost above is automatically kept equal to the
              Total Scope of Work; when No, Renovation Cost is entered
              manually and this total is shown for reference only. */}
          <div className="mt-8 pt-6 border-t border-line-dark">
            <p className="eyebrow text-brass mb-1">Scope of Work</p>
            <p className="text-xs text-ink/50 leading-relaxed mb-5">
              Add each renovation item and its estimated cost. The total will automatically
              populate the Renovation Cost.
            </p>

            <div className="mb-2">
              <FieldLabel>Use Itemized Scope of Work Total</FieldLabel>
            </div>
            <div
              className="grid grid-cols-2 gap-2 max-w-sm"
              role="group"
              aria-label="Use Itemized Scope of Work Total"
            >
              <button
                type="button"
                onClick={() => setUseItemizedScopeOfWork(false)}
                aria-pressed={!useItemizedScopeOfWork}
                className={`px-3 py-2.5 border text-sm transition-colors ${
                  !useItemizedScopeOfWork
                    ? "border-brass bg-brass/10 text-ink"
                    : "border-line-dark text-ink/60 hover:border-brass/60"
                }`}
              >
                No
              </button>
              <button
                type="button"
                onClick={() => setUseItemizedScopeOfWork(true)}
                aria-pressed={useItemizedScopeOfWork}
                className={`px-3 py-2.5 border text-sm transition-colors ${
                  useItemizedScopeOfWork
                    ? "border-brass bg-brass/10 text-ink"
                    : "border-line-dark text-ink/60 hover:border-brass/60"
                }`}
              >
                Yes
              </button>
            </div>

            {scopeOfWorkItems.length > 0 && (
              <div className="mt-6 space-y-3">
                {scopeOfWorkItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row sm:items-end gap-3 border border-line-dark bg-white p-3 max-w-full overflow-hidden"
                  >
                    <div className="flex-1 min-w-0">
                      <label
                        htmlFor={`scopeOfWorkName-${item.id}`}
                        className="block text-xs uppercase tracking-wide text-ink/50 mb-1.5"
                      >
                        Work Item
                      </label>
                      <input
                        id={`scopeOfWorkName-${item.id}`}
                        type="text"
                        value={item.name}
                        onChange={(e) => handleScopeOfWorkNameChange(item.id, e.target.value)}
                        placeholder="e.g. Interior Paint"
                        className="w-full bg-white border border-line-dark px-3 py-2.5 text-ink outline-none focus:border-brass"
                      />
                    </div>
                    <div className="sm:w-48 flex-shrink-0">
                      <CurrencyField
                        id={`scopeOfWorkCost-${item.id}`}
                        label="Estimated Cost"
                        draft={item.costDraft}
                        onChange={(raw) => handleScopeOfWorkCostChange(item.id, raw)}
                        onBlur={() => handleScopeOfWorkCostBlur(item.id)}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveScopeOfWorkItem(item.id)}
                      className="flex-shrink-0 text-xs text-ink/50 hover:text-red-700 transition-colors sm:pb-3 self-start sm:self-auto"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={handleAddScopeOfWorkItem}
              className="mt-4 inline-flex items-center gap-2 border border-line-dark px-4 py-2 eyebrow text-ink/70 hover:border-brass hover:text-ink transition-colors"
            >
              Add Line Item
            </button>

            <div className="mt-6 flex items-center justify-between rounded bg-brass/10 border border-brass px-4 py-4">
              <span className="eyebrow text-brass">Total Scope of Work</span>
              <span className="font-display text-2xl text-ink">{formatCents(scopeOfWorkTotal)}</span>
            </div>

            {!useItemizedScopeOfWork &&
              Math.round(capital.renovationCost * 100) !== Math.round(scopeOfWorkTotal * 100) && (
                <p className="mt-3 text-sm text-amber-700">
                  The manually entered renovation cost differs from the itemized scope of work
                  total.
                </p>
              )}
          </div>

          <div className="mt-8 pt-6 border-t border-brass flex items-center justify-between">
            <span className="eyebrow text-brass inline-flex items-center">
              Total Capital Required
              <InfoTip text="Every cash cost paid at or around closing. Does not include the loan balance, equity, or purchase price." />
            </span>
            <span className="font-display text-3xl text-brass">
              {formatCents(results.totalCapitalRequired)}
            </span>
          </div>
          {/* Stack Method only: once cash received at closing covers
              every modeled project cost, Total Capital Required above
              is always $0 -- this row shows the excess instead of
              letting it silently disappear. Same prominent gold styling
              as Total Capital Required, directly beneath it, always
              visible on this page (never only in the printable report,
              the Excel export, or the collapsed Full Underwriting
              Breakdown below). */}
          {financingMode === "stackMethod" && results.stackNetCashToBuyerAfterProjectCosts > 0 && (
            <div className="mt-3 pt-6 border-t border-brass flex items-center justify-between">
              <span className="eyebrow text-brass inline-flex items-center">
                Net Cash to Buyer After Project Costs
                <InfoTip text="Cash received at closing minus Base Project Capital Required. Shown once cash received at closing covers every modeled project cost, so Total Capital Required is $0." />
              </span>
              <span className="font-display text-3xl text-brass">
                {formatCents(results.stackNetCashToBuyerAfterProjectCosts)}
              </span>
            </div>
          )}
          {financingMode === "stackMethod" && results.stackNetCashToBuyerAfterProjectCosts > 0 && (
            <p className="mt-2 text-xs text-ink/50 leading-relaxed">
              Cash remaining after all modeled acquisition, renovation, furnishing, holding, reserve, and
              stabilization costs.
            </p>
          )}
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Section 5: Returns (repeated here at full width, in context
            with everything that feeds them)                          */}
        {/* ---------------------------------------------------------- */}
        <div className="print:hidden mt-6 bg-ink-2 border border-line p-6 sm:p-8 md:p-10">
          <p className="eyebrow text-brass-light mb-5">Returns</p>
          <div
            className={`grid sm:grid-cols-3 gap-6${
              financingMode === "stackMethod" && results.stackNetCashToBuyerAfterProjectCosts > 0
                ? " lg:grid-cols-4"
                : ""
            }`}
          >
            <div>
              <p className="eyebrow text-bone/50 mb-1.5">Estimated Monthly Cash Flow</p>
              <p className="font-display text-3xl md:text-4xl text-brass-light">
                {formatCents(results.monthlyCashFlow)}
              </p>
            </div>
            <div>
              <p className="eyebrow text-bone/50 mb-1.5">Estimated Annual Cash Flow</p>
              <p className="font-display text-3xl md:text-4xl text-brass-light">
                {formatCents(results.annualCashFlow)}
              </p>
            </div>
            <div>
              <p className="eyebrow text-bone/50 mb-1.5 inline-flex items-center">
                Estimated Cash-on-Cash Return
                <InfoTip text="Cash-on-cash return is the estimated annual cash flow divided by the total cash invested in the project." />
              </p>
              <p className="font-display text-3xl md:text-4xl text-brass-light">
                {results.cashOnCashReturn === null ? stackCocrLabel : formatPercent(results.cashOnCashReturn)}
              </p>
            </div>
            {financingMode === "stackMethod" && results.stackNetCashToBuyerAfterProjectCosts > 0 && (
              <div>
                <p className="eyebrow text-bone/50 mb-1.5 inline-flex items-center">
                  Net Cash to Buyer After Project Costs
                  <InfoTip text="Cash received at closing minus Base Project Capital Required, once Total Capital Required is $0." />
                </p>
                <p className="font-display text-3xl md:text-4xl text-brass-light">
                  {formatCents(results.stackNetCashToBuyerAfterProjectCosts)}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Full breakdown                                              */}
        {/* ---------------------------------------------------------- */}
        <div className="print:hidden mt-10 pt-8 border-t border-line">
          <button
            type="button"
            onClick={() => setBreakdownOpen((v) => !v)}
            aria-expanded={breakdownOpen}
            className="inline-flex items-center gap-2 border border-line-dark px-5 py-2.5 eyebrow text-bone/70 hover:border-brass hover:text-bone transition-colors"
          >
            {breakdownOpen ? "Hide" : "View"} Full Underwriting Breakdown
          </button>

          {breakdownOpen && (
            <div className="mt-6 grid md:grid-cols-2 gap-6">
              {breakdownSections.map((section) => (
                <div key={section.title} className="bg-paper text-ink p-6">
                  <p className="eyebrow text-brass mb-4">{section.title}</p>
                  <div className="divide-y divide-line-dark">
                    {section.rows.map((row) => (
                      <div
                        key={row.label}
                        className={`flex items-center justify-between gap-4 py-2.5 text-sm ${
                          row.isTotal ? "font-medium" : ""
                        }`}
                      >
                        <span className="text-ink/70">{row.label}</span>
                        <span className={row.isTotal ? "text-brass" : ""}>{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {financingMode !== "" && activeRoiProjection && (
          <RoiProjectionPanel
            isOpen={roiProjectionOpen}
            onToggleOpen={() => setRoiProjectionOpen((v) => !v)}
            appreciationPct={activeRoiAppreciationPct}
            appreciationDraft={roiAppreciationDraft}
            onAppreciationChange={(raw) => roiAppreciationKey && handlePercentChange(roiAppreciationKey, raw)}
            onAppreciationBlur={() => roiAppreciationKey && handlePercentBlur(roiAppreciationKey)}
            hasBalloon={activeRoiBalloon !== null}
            balloonYears={activeRoiBalloon?.balloonYears ?? 0}
            refinanceAtBalloon={roiRefinanceControls?.atBalloon ?? true}
            onToggleRefinance={(v) => roiRefinanceControls?.setAtBalloon(v)}
            refinanceRateDraft={roiRefinanceControls?.rateDraft ?? ""}
            onRefinanceRateChange={(raw) => roiRefinanceControls?.rateHandlers.onChange(raw)}
            onRefinanceRateBlur={() => roiRefinanceControls?.rateHandlers.onBlur()}
            refinanceRateIsManual={roiRefinanceControls?.rateIsManual ?? false}
            onResetRefinanceRate={() => roiRefinanceControls?.rateHandlers.reset()}
            projection={activeRoiProjection}
          />
        )}

        <p className="print:hidden mt-8 max-w-3xl text-slate/70 leading-relaxed text-xs">
          This calculator is provided for illustrative and educational
          purposes only. Results are estimates based on the information
          entered and the assumptions displayed. Actual rents, occupancy,
          expenses, financing costs, renovation costs, operating
          performance, and investment returns may vary. This calculator
          does not constitute an offer, appraisal, projection, guarantee,
          legal advice, tax advice, or investment advice. Users should
          independently verify all assumptions and consult qualified
          professionals before making an investment decision.
        </p>

        {/* Printable underwriting summary: hidden on screen, shown only
            when printing or saving as PDF from the print dialog. Redesigned
            as a polished, brochure-style investment presentation (brand
            header, listing-style media, large KPI cards, an Investment
            Highlights card, SVG bar/donut charts, and card-based detail
            sections) rather than a plain data table. Every figure below is
            read directly from `results`/`financing`/`capital`/`percent`, the
            exact same values driving the on-page calculator, the CSV
            export, and the underwriting breakdown -- this redesign only
            changes how the numbers are presented, never how they are
            calculated. The illustrative-use disclaimer is intentionally
            not printed here; it still appears on the interactive
            calculator page above. PITI vs. Principal and Interest Only
            handling is preserved exactly: Annual Property Taxes/Insurance
            appear only for Principal and Interest Only. The Floor Plan (if
            uploaded) is pushed onto its own page with
            print:break-before-page, sized to reliably fit under its
            heading on that single page. A branded footer appears once,
            in normal document flow, at the very end of the report (see
            the note near the Floor Plan section below for why this is
            not a page-repeating position:fixed footer): Chrome's print
            engine has no supported way to render a dynamic "page X of Y"
            total outside of a paged-media polyfill, and reserves/
            duplicates space for fixed-position elements unpredictably
            during print pagination, so a single static footer is the
            reliable choice here. */}
        <div className="hidden print:block bg-paper text-ink text-[10.5pt] leading-snug pt-4 px-6 pb-1.5">
          {/* Report header: brand lockup, title, and a meta row with
              property address (if entered), bedroom count, financing
              structure, generated date, and source. */}
          <div className="mb-3 print:break-inside-avoid-page">
            <div className="flex items-start justify-between gap-6 pb-3 border-b-4 border-brass">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-lg border-2 border-brass flex items-center justify-center flex-shrink-0">
                  <Home size={22} className="text-brass" />
                </div>
                <div>
                  <p className="text-[11pt] font-display font-semibold text-ink leading-tight">
                    MICHAEL AYLETT&apos;S
                  </p>
                  <p className="text-[7pt] tracking-widest uppercase text-brass">
                    Underwriting Tool
                  </p>
                </div>
              </div>
              <h1 className="text-[22pt] font-display font-bold leading-tight text-ink text-right">
                Co-Living Underwriting Summary
              </h1>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-[8.5pt] text-ink/70">
              {propertyAddress.trim() && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={12} className="text-brass" />
                  {propertyAddress.trim()}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Users size={12} className="text-brass" />
                {results.totalBedrooms} Bedrooms
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Landmark size={12} className="text-brass" />
                Financing Structure:{" "}
                {financingMode === "hybrid" ? (
                  <>
                    Subject To &amp; Seller Finance <strong>Hybrid</strong>
                  </>
                ) : (
                  financingStructureLabel
                )}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Calendar size={12} className="text-brass" />
                Generated{" "}
                {new Date().toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
              <span className="text-ink/50">Source: michaelaylett.com</span>
            </div>
          </div>

          {/* Listing-brochure media: a large featured photo with smaller
              gallery thumbnails, plus a Video Walkthrough button, if
              either was provided. Only image-kind Property Files ever
              appear in this gallery -- PDFs are never embedded as an
              <img> (their object URL is not an image source); they are
              instead shown as linked "Property Document" cards in the
              section just below. Omitted entirely when there is no
              image and no video link. */}
          {(propertyImages.some((f) => f.kind === "image") || videoWalkthroughLink.trim() !== "") && (
            <div className="mb-3 print:break-inside-avoid-page grid grid-cols-3 gap-3">
              {propertyImages.some((f) => f.kind === "image") && (
                <div className={videoWalkthroughLink.trim() !== "" ? "col-span-2" : "col-span-3"}>
                  <div className="rounded-xl overflow-hidden border border-ink/15 h-[2.2in]">
                    <img
                      src={propertyImages.filter((f) => f.kind === "image")[0].dataUrl}
                      alt={propertyImages.filter((f) => f.kind === "image")[0].name || "Featured property photo"}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {propertyImages.filter((f) => f.kind === "image").length > 1 && (
                    <div
                      className={`mt-2 grid gap-2 ${
                        getSecondaryGalleryLayout(
                          propertyImages.filter((f) => f.kind === "image").length - 1
                        ).gridClass
                      }`}
                    >
                      {propertyImages
                        .filter((f) => f.kind === "image")
                        .slice(1, MAX_PROPERTY_FILES)
                        .map((img) => (
                          <div
                            key={img.id}
                            className={`rounded-xl overflow-hidden border border-ink/15 ${
                              getSecondaryGalleryLayout(
                                propertyImages.filter((f) => f.kind === "image").length - 1
                              ).imgHeightClass
                            }`}
                          >
                            <img
                              src={img.dataUrl}
                              alt={img.name || "Property photo"}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
              {videoWalkthroughLink.trim() !== "" && (
                <a
                  href={videoWalkthroughLink.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${
                    propertyImages.some((f) => f.kind === "image") ? "col-span-1" : "col-span-3"
                  } h-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-brass bg-white text-center px-3 py-6`}
                >
                  <div className="h-10 w-10 rounded-full bg-brass text-white flex items-center justify-center">
                    <Play size={16} fill="currentColor" />
                  </div>
                  <p className="text-[10pt] font-semibold text-brass underline">
                    View Video Walkthrough
                  </p>
                </a>
              )}
            </div>
          )}

          {/* Property Documents: one linked document card per uploaded
              Property File PDF. A browser print view cannot reliably
              re-embed another PDF's pages, so each PDF is represented by
              its filename and a clickable "Open Property PDF" link
              instead, rather than attempting to render its contents. */}
          {propertyImages.some((f) => f.kind === "pdf") && (
            <div className="mb-3 print:break-inside-avoid-page grid grid-cols-2 gap-3">
              {propertyImages
                .filter((f) => f.kind === "pdf")
                .map((pdf) => (
                  <div
                    key={pdf.id}
                    className="rounded-xl border border-ink/15 bg-white p-3 flex items-center gap-3"
                  >
                    <FileText size={22} className="text-brass flex-shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-[7.5pt] uppercase tracking-wide text-ink/50">
                        Property Document
                      </p>
                      <p className="text-[9.5pt] font-medium text-ink truncate">
                        {pdf.name || "Document.pdf"}
                      </p>
                      <a
                        href={pdf.dataUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9pt] text-brass underline decoration-brass/50 underline-offset-2"
                      >
                        Open Property PDF
                      </a>
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* Executive summary: five large KPI cards. Total Capital
              Required and Estimated Cash-on-Cash Return are the strongest
              visual elements, with the COCR card always using the same
              bright-green (#00FF00) treatment regardless of the value. */}
          <div className="mb-3 print:break-inside-avoid-page grid grid-cols-5 gap-2 items-stretch">
            <PrintKpiCard
              icon={<Home size={16} />}
              label="Purchase Price"
              value={formatCents(financing.purchasePrice)}
            />
            <PrintKpiCard
              icon={<Wallet size={16} />}
              label={
                financingMode === "stackMethod" &&
                results.totalCapitalRequired === 0 &&
                results.stackNetCashToBuyerAfterProjectCosts > 0
                  ? "Net Cash to Buyer After Project Costs"
                  : "Total Capital Required"
              }
              value={
                financingMode === "stackMethod" &&
                results.totalCapitalRequired === 0 &&
                results.stackNetCashToBuyerAfterProjectCosts > 0
                  ? formatCents(results.stackNetCashToBuyerAfterProjectCosts)
                  : formatCents(results.totalCapitalRequired)
              }
            />
            <PrintKpiCard
              icon={<TrendingUp size={16} />}
              label="Est. Monthly Cash Flow"
              value={formatCents(results.monthlyCashFlow)}
            />
            <PrintKpiCard
              icon={<Calendar size={16} />}
              label="Est. Annual Cash Flow"
              value={formatCents(results.annualCashFlow)}
            />
            <PrintKpiCard
              icon={<Percent size={16} />}
              label="Est. Cash-on-Cash Return"
              value={results.cashOnCashReturn === null ? stackCocrLabel : formatPercent(results.cashOnCashReturn)}
              highlight
              rateLines={
                financingMode === "traditional"
                  ? [{ label: "Interest Rate", value: formatRateOrNotProvided(percent.traditionalInterestRatePct) }]
                  : financingMode === "subjectTo"
                    ? [{ label: "Interest Rate", value: formatRateOrNotProvided(percent.loanInterestRatePct) }]
                    : financingMode === "sellerFinancing"
                      ? [{ label: "Interest Rate", value: formatRateOrNotProvided(percent.loanInterestRatePct) }]
                      : financingMode === "hybrid"
                        ? [
                            {
                              label: "Existing Mortgage Rate",
                              value: formatRateOrNotProvided(percent.hybridExistingMortgageRatePct),
                            },
                            ...(hybridSellerFinancePaymentsRequired
                              ? [
                                  {
                                    label: "Seller-Finance Rate",
                                    value: formatRateOrNotProvided(percent.hybridSellerFinanceRatePct),
                                  },
                                ]
                              : []),
                          ]
                        : financingMode === "stackMethod"
                          ? [
                              {
                                label: "Primary Loan Rate",
                                value: formatRateOrNotProvided(percent.stackBankInterestRatePct),
                              },
                              ...(stackSellerFinancePaymentsRequired
                                ? [
                                    {
                                      label: "Seller-Carried 2nd Rate",
                                      value: formatRateOrNotProvided(percent.stackSellerFinanceRatePct),
                                    },
                                  ]
                                : []),
                            ]
                          : []
              }
            />
          </div>

          {/* Investment Highlights: a concise, scannable card summarizing
              the deal before the detailed sections below. */}
          <div className="mb-3 print:break-inside-avoid-page rounded-xl border border-ink/15 bg-white p-2.5">
            <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink mb-1 pb-2 border-b border-brass/40">
              Investment Highlights
            </p>
            <div>
              <HighlightBullet
                icon={<Users size={13} />}
                label={`${results.totalBedrooms} Total Bedrooms`}
                detail={
                  <>
                    <div>Shared-Bath Bedrooms: {sharedBathBedrooms}</div>
                    <div className="pl-3 text-ink/45">
                      • Shared-Bath Weekly Room Rate: {formatCents(weeklySharedBathRent)}
                    </div>
                    <div className="mt-1.5">Ensuite Bedrooms: {ensuiteBedrooms}</div>
                    <div className="pl-3 text-ink/45">
                      • Ensuite Weekly Room Rate: {formatCents(weeklyEnsuiteRent)}
                    </div>
                  </>
                }
              />
              <HighlightBullet
                icon={<Landmark size={13} />}
                label={
                  financingMode === "hybrid" ? "Subject To & Seller Finance Hybrid" : financingStructureLabel
                }
                detail="Proposed financing structure for this acquisition."
              />
              <HighlightBullet
                icon={<DollarSign size={13} />}
                label={`${formatCents(results.grossMonthlyRent)} Estimated Monthly Rent`}
                detail={`${formatCents(results.grossMonthlyRent)} gross / ${formatCents(
                  results.effectiveRentAfterVacancy
                )} effective after vacancy`}
              />
              <HighlightBullet
                icon={<TrendingUp size={13} />}
                label={`${formatCents(results.monthlyCashFlow)} Estimated Monthly Cash Flow`}
                detail={`${formatCents(results.annualCashFlow)} estimated annually`}
              />
              <HighlightBullet
                icon={<Percent size={13} />}
                label={`${
                  results.cashOnCashReturn === null ? stackCocrLabel : formatPercent(results.cashOnCashReturn)
                } Estimated Cash-on-Cash Return`}
                detail="Annual cash flow relative to total capital invested."
                accent="green"
              />
              <HighlightBullet
                icon={<Wallet size={13} />}
                label={`${formatCents(results.totalCapitalRequired)} Capital Required`}
                detail="Total cash needed to acquire and stabilize the property."
              />
            </div>
          </div>

          {/* Charts: Monthly Income and Expense Breakdown and Capital
              Required Breakdown, both plain horizontal bar charts (see
              HorizontalBarChart above) generated automatically from the
              calculator's own figures. Deliberately not a donut chart --
              every bar is individually labeled with its exact dollar
              amount printed alongside it, so nothing here depends on
              color alone to stay readable, including in grayscale. */}
          <div className="mb-3 print:break-inside-avoid-page grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-ink/15 bg-white p-2.5">
              <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink mb-2 pb-1.5 border-b border-brass/40">
                Monthly Income and Expense Breakdown
              </p>
              <HorizontalBarChart bars={monthlyIncomeExpenseBars} />
            </div>
            <div className="rounded-xl border border-ink/15 bg-white p-2.5">
              <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink mb-2 pb-1.5 border-b border-brass/40">
                Capital Required Breakdown
              </p>
              <HorizontalBarChart bars={capitalRequiredBreakdownBars} />
            </div>
          </div>

          {/* Property and Financing, presented as two side-by-side cards.
              Reads financing/results/paymentType/financingStructureLabel
              directly, and keeps the exact same PITI vs. Principal and
              Interest Only
              conditional logic: PITI shows a single combined payment line,
              Principal and Interest Only shows the payment plus taxes,
              insurance, and the full monthly housing payment. */}
          <div className="mb-3 print:break-inside-avoid-page grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-ink/15 bg-white p-2.5">
              <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-brass/40">
                <Home size={14} className="text-brass" />
                <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink">Property</p>
              </div>
              <div className="space-y-1.5 text-[9.5pt]">
                <div className="flex justify-between">
                  <span className="text-ink/60">Purchase Price</span>
                  <span className="font-medium text-ink">{formatCents(financing.purchasePrice)}</span>
                </div>
                {financingMode === "hybrid" ? (
                  <div className="flex justify-between">
                    <span className="text-ink/60">Existing Mortgage Balance</span>
                    <span className="font-medium text-ink">
                      {formatCents(financing.hybridExistingMortgageBalance)}
                    </span>
                  </div>
                ) : financingMode === "stackMethod" ? (
                  <div className="flex justify-between">
                    <span className="text-ink/60">First-Position Bank Loan</span>
                    <span className="font-medium text-ink">{formatCents(stackBankLoanAmount)}</span>
                  </div>
                ) : financingMode === "sellerFinancing" ? (
                  <div className="flex justify-between">
                    <span className="text-ink/60">Seller-Finance Loan Balance</span>
                    <span className="font-medium text-ink">{formatCents(sellerFinancingLoanBalanceUsed)}</span>
                  </div>
                ) : (
                  financingMode !== "traditional" && (
                    <div className="flex justify-between">
                      <span className="text-ink/60">Loan Balance</span>
                      <span className="font-medium text-ink">{formatCents(financing.loanBalance)}</span>
                    </div>
                  )
                )}
                <div className="flex justify-between pt-1.5 border-t border-ink/10">
                  <span className="font-semibold text-ink">Estimated Equity</span>
                  <span className="font-semibold text-ink">{formatCents(results.equity)}</span>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-ink/15 bg-white p-2.5">
              <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-brass/40">
                <Landmark size={14} className="text-brass" />
                <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink">Financing</p>
              </div>
              <div className="space-y-1.5 text-[9.5pt]">
                <div className="flex justify-between">
                  <span className="text-ink/60">Financing Structure</span>
                  <span className="font-medium text-ink">
                    {financingMode === "hybrid" ? (
                      <>
                        Subject To &amp; Seller Finance <strong>Hybrid</strong>
                      </>
                    ) : (
                      financingStructureLabel
                    )}
                  </span>
                </div>
                {financingMode === "traditional" ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Down Payment Percentage</span>
                      <span className="font-medium text-ink">
                        {formatPercent(traditionalEffectiveDownPaymentPct)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Estimated Down Payment</span>
                      <span className="font-medium text-ink">
                        {formatCents(traditionalDownPaymentAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Estimated Loan Balance</span>
                      <span className="font-medium text-ink">{formatCents(traditionalLoanBalance)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Interest Rate</span>
                      <span className="font-medium text-ink">
                        {formatPercent(percent.traditionalInterestRatePct)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Amortization Term</span>
                      <span className="font-medium text-ink">30 Years</span>
                    </div>
                    <div className="flex justify-between pt-1.5 border-t border-ink/10">
                      <span className="font-semibold text-ink">Monthly Principal and Interest</span>
                      <span className="font-semibold text-ink">{formatCents(traditionalMonthlyPI)}</span>
                    </div>
                    <PropertyTaxPrintRows
                      county={propertyTaxCounty}
                      ratePct={propertyTaxRatePct}
                      rateSource={propertyTaxRateSource}
                      calculatedTax={calculatedAnnualPropertyTaxes}
                      usedTax={financing.annualPropertyTaxes}
                      taxSource={propertyTaxSource}
                    />
                    <div className="flex justify-between">
                      <span className="text-ink/60">Annual Property Insurance</span>
                      <span className="font-medium text-ink">
                        {formatCents(financing.annualPropertyInsurance)}
                      </span>
                    </div>
                    <div className="flex justify-between pt-1.5 border-t border-ink/10">
                      <span className="font-semibold text-ink">Estimated Monthly PITI</span>
                      <span className="font-semibold text-ink">
                        {formatCents(results.monthlyHousingPayment)}
                      </span>
                    </div>
                  </>
                ) : financingMode === "hybrid" ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Seller Down Payment</span>
                      <span className="font-medium text-ink">
                        {formatCents(financing.sellerDownPayment)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Suggested Seller-Financed Balance</span>
                      <span className="font-medium text-ink">
                        {formatCents(hybridSuggestedSellerFinancedBalance)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Seller-Financed Balance Used</span>
                      <span className="font-medium text-ink">
                        {formatCents(hybridSellerFinancedBalanceUsed)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Monthly Subject-To PITI Payment</span>
                      <span className="font-medium text-ink">
                        {formatCents(financing.hybridSubjectToPITI)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Are Monthly Seller Finance Payments Required?</span>
                      <span className="font-medium text-ink">
                        {hybridSellerFinancePaymentsRequired ? "Yes" : "No"}
                      </span>
                    </div>
                    {hybridSellerFinancePaymentsRequired && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-ink/60">Seller Finance Interest Rate</span>
                          <span className="font-medium text-ink">
                            {formatPercent(percent.hybridSellerFinanceRatePct)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink/60">Seller Finance Amortization Term</span>
                          <span className="font-medium text-ink">30 Years (360 Monthly Payments)</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink/60">Monthly Seller Finance Payment</span>
                          <span className="font-medium text-ink">
                            {formatCents(hybridMonthlySellerFinancePayment)}
                          </span>
                        </div>
                      </>
                    )}
                    <PropertyTaxPrintRows
                      county={propertyTaxCounty}
                      ratePct={propertyTaxRatePct}
                      rateSource={propertyTaxRateSource}
                      calculatedTax={calculatedAnnualPropertyTaxes}
                      usedTax={financing.annualPropertyTaxes}
                      taxSource={propertyTaxSource}
                    />
                    <div className="flex justify-between pt-1.5 border-t border-ink/10">
                      <span className="font-semibold text-ink">Total PITI</span>
                      <span className="font-semibold text-ink">
                        {formatCents(results.monthlyHousingPayment)}
                      </span>
                    </div>
                  </>
                ) : financingMode === "stackMethod" ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Bank Loan-to-Value Percentage</span>
                      <span className="font-medium text-ink">{formatPercent(stackEffectiveBankLtvPct)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Seller-Financed Balance</span>
                      <span className="font-medium text-ink">{formatCents(stackSellerFinancedBalance)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Total Debt at Acquisition</span>
                      <span className="font-medium text-ink">{formatCents(stackTotalDebtAtAcquisition)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Current Leverage Ratio</span>
                      <span className="font-medium text-ink">
                        {formatLeverageRatio(stackLeverageRatioDecimal)}
                      </span>
                    </div>
                    <PropertyTaxPrintRows
                      county={propertyTaxCounty}
                      ratePct={propertyTaxRatePct}
                      rateSource={propertyTaxRateSource}
                      calculatedTax={calculatedAnnualPropertyTaxes}
                      usedTax={financing.annualPropertyTaxes}
                      taxSource={propertyTaxSource}
                    />
                    <div className="flex justify-between pt-1.5 border-t border-ink/10">
                      <span className="font-semibold text-ink">Total PITI</span>
                      <span className="font-semibold text-ink">
                        {formatCents(results.monthlyHousingPayment)}
                      </span>
                    </div>
                  </>
                ) : financingMode === "sellerFinancing" ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Down Payment Percentage</span>
                      <span className="font-medium text-ink">
                        {formatPercent(sellerFinancingDownPaymentPctResolved)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Down Payment Amount</span>
                      <span className="font-medium text-ink">
                        {formatCents(sellerFinancingDownPaymentAmountResolved)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Loan Balance Source</span>
                      <span className="font-medium text-ink">
                        {sellerFinancingLoanBalanceIsManual ? "Manual Override" : "Automatically Calculated"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Interest Rate</span>
                      <span className="font-medium text-ink">
                        {formatPercent(percent.sellerFinancingInterestRatePct)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Amortization Term</span>
                      <span className="font-medium text-ink">
                        {sellerFinancingAmortizationYears} Years
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Monthly Principal &amp; Interest</span>
                      <span className="font-medium text-ink">{formatCents(sellerFinancingMonthlyPI)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Annual Property Insurance</span>
                      <span className="font-medium text-ink">
                        {formatCents(financing.annualPropertyInsurance)}
                      </span>
                    </div>
                    <PropertyTaxPrintRows
                      county={propertyTaxCounty}
                      ratePct={propertyTaxRatePct}
                      rateSource={propertyTaxRateSource}
                      calculatedTax={calculatedAnnualPropertyTaxes}
                      usedTax={financing.annualPropertyTaxes}
                      taxSource={propertyTaxSource}
                    />
                    <div className="flex justify-between pt-1.5 border-t border-ink/10">
                      <span className="font-semibold text-ink">Total Monthly Housing Payment</span>
                      <span className="font-semibold text-ink">
                        {formatCents(results.monthlyHousingPayment)}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Seller Down Payment</span>
                      <span className="font-medium text-ink">
                        {formatCents(financing.sellerDownPayment)}
                      </span>
                    </div>
                    {paymentType === "piti" ? (
                      <div className="flex justify-between pt-1.5 border-t border-ink/10">
                        <span className="font-semibold text-ink">Monthly PITI Payment</span>
                        <span className="font-semibold text-ink">{formatCents(financing.monthlyPayment)}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between">
                          <span className="text-ink/60">Monthly Principal and Interest</span>
                          <span className="font-medium text-ink">{formatCents(financing.monthlyPayment)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink/60">Annual Property Insurance</span>
                          <span className="font-medium text-ink">
                            {formatCents(financing.annualPropertyInsurance)}
                          </span>
                        </div>
                        <PropertyTaxPrintRows
                          county={propertyTaxCounty}
                          ratePct={propertyTaxRatePct}
                          rateSource={propertyTaxRateSource}
                          calculatedTax={calculatedAnnualPropertyTaxes}
                          usedTax={financing.annualPropertyTaxes}
                          taxSource={propertyTaxSource}
                        />
                        <div className="flex justify-between pt-1.5 border-t border-ink/10">
                          <span className="font-semibold text-ink">Monthly Housing Payment</span>
                          <span className="font-semibold text-ink">
                            {formatCents(results.monthlyHousingPayment)}
                          </span>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          <TransitPrintSection
            propertyAddress={propertyAddress}
            data={transitResult}
            mapData={transitPrintMapData}
          />

          {financingMode === "traditional" && traditionalLongTermRent !== null && (
            <TraditionalLtvPrintCard
              longTermRent={traditionalLongTermRent}
              piti={results.monthlyHousingPayment}
              selectedLtvPct={traditionalSelectedLtvPct}
              requiredDownPaymentPct={traditionalEffectiveDownPaymentPct}
              meetsRentTest={traditionalLongTermRent >= traditionalPITIAt80}
            />
          )}

          {financingMode === "traditional" && (
            <AmortizationPrintCard title="Amortization Schedule" schedule={traditionalAmortization.schedule} />
          )}

          {financingMode === "subjectTo" && (
            <>
              <AmortizationPrintCard
                title={
                  subjectToEffectiveAmortization.isEstimated
                    ? "Existing Mortgage Amortization Schedule (Estimated Remaining Term)"
                    : "Existing Mortgage Amortization Schedule"
                }
                schedule={existingMortgageAmortization.schedule}
                disclosure={SUBJECT_TO_AMORTIZATION_DISCLOSURE}
              />
              <AmortizationEstimateStatus term={subjectToEffectiveAmortization} />
            </>
          )}

          {financingMode === "subjectTo" && subjectToBalloonAnalysis && (
            <BalloonRefinancePrintCard
              analysis={subjectToBalloonAnalysis}
              loanBalanceRows={[
                {
                  label: "Projected Existing Mortgage Balance at Balloon",
                  value: subjectToBalloonAnalysis.mortgageBalanceAtBalloon,
                },
              ]}
            />
          )}

          {financingMode === "sellerFinancing" && (
            <AmortizationPrintCard
              title="Seller Financing Amortization Schedule"
              schedule={sellerFinancingAmortization.schedule}
            />
          )}

          {financingMode === "sellerFinancing" && sellerFinancingBalloonAnalysis && (
            <BalloonRefinancePrintCard
              analysis={sellerFinancingBalloonAnalysis}
              loanBalanceRows={[
                {
                  label: "Projected Seller-Finance Balance at Balloon",
                  value: sellerFinancingBalloonAnalysis.sellerFinanceBalanceAtBalloon,
                },
              ]}
            />
          )}

          {financingMode === "hybrid" && (
            <>
              <AmortizationPrintCard
                title={
                  hybridExistingMortgageEffectiveAmortization.isEstimated
                    ? "Existing Subject-To Mortgage Amortization Schedule (Estimated Remaining Term)"
                    : "Existing Subject-To Mortgage Amortization Schedule"
                }
                schedule={hybridExistingMortgageAmortization.schedule}
                disclosure={SUBJECT_TO_AMORTIZATION_DISCLOSURE}
              />
              <AmortizationEstimateStatus term={hybridExistingMortgageEffectiveAmortization} />
            </>
          )}

          {financingMode === "hybrid" && hybridSellerFinancePaymentsRequired && (
            <AmortizationPrintCard
              title="Hybrid Seller-Finance Amortization Schedule"
              schedule={hybridAmortization.schedule}
            />
          )}

          {financingMode === "hybrid" && hybridBalloonAnalysis && (
            <BalloonRefinancePrintCard
              analysis={hybridBalloonAnalysis}
              loanBalanceRows={[
                {
                  label: "Existing Subject-To Balance at Balloon",
                  value: hybridBalloonAnalysis.mortgageBalanceAtBalloon,
                },
                {
                  label: "Seller-Finance Balance at Balloon",
                  value: hybridBalloonAnalysis.sellerFinanceBalanceAtBalloon,
                },
              ]}
              extraTextRows={[
                {
                  label: "Seller-Finance Repayment Structure",
                  value: hybridSellerFinanceRepaymentStructure,
                },
              ]}
            />
          )}

          {/* Stack Method Financing: a dedicated full-width card covering
              every acquisition, closing, and monthly-financing figure
              from the Stack Method calculation, printed only when Stack
              Method is the selected Financing Structure. */}
          {financingMode === "stackMethod" && (
            <div className="mb-3 print:break-inside-avoid-page rounded-xl border border-ink/15 bg-white p-2.5">
              <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-brass/40">
                <Landmark size={14} className="text-brass" />
                <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink">
                  Stack Method Financing
                </p>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[9.5pt]">
                <div className="flex justify-between gap-3">
                  <span className="text-ink/60 min-w-0">Purchase Price</span>
                  <span className="text-ink flex-shrink-0 text-right">{formatCents(financing.purchasePrice)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink/60 min-w-0">Bank Loan-to-Value Percentage</span>
                  <span className="text-ink flex-shrink-0 text-right">{formatPercent(stackEffectiveBankLtvPct)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink/60 min-w-0">First-Position Bank Loan</span>
                  <span className="text-ink flex-shrink-0 text-right">{formatCents(stackBankLoanAmount)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink/60 min-w-0">Bank Interest Rate</span>
                  <span className="text-ink flex-shrink-0 text-right">{formatPercent(percent.stackBankInterestRatePct)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink/60 min-w-0">Amortization</span>
                  <span className="text-ink flex-shrink-0 text-right">30-years</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink/60 min-w-0">Monthly Bank Principal and Interest</span>
                  <span className="text-ink flex-shrink-0 text-right">{formatCents(stackBankMonthlyPI)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink/60 min-w-0">Annual Property Insurance</span>
                  <span className="text-ink flex-shrink-0 text-right">{formatCents(financing.annualPropertyInsurance)}</span>
                </div>
                <PropertyTaxPrintRows
                  dense
                  county={propertyTaxCounty}
                  ratePct={propertyTaxRatePct}
                  rateSource={propertyTaxRateSource}
                  calculatedTax={calculatedAnnualPropertyTaxes}
                  usedTax={financing.annualPropertyTaxes}
                  taxSource={propertyTaxSource}
                />
                <div className="flex justify-between gap-3">
                  <span className="text-ink/60 min-w-0">Estimated Monthly Bank PITI</span>
                  <span className="text-ink flex-shrink-0 text-right">{formatCents(stackMonthlyBankPITI)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink/60 min-w-0">Down Payment to Seller</span>
                  <span className="text-ink flex-shrink-0 text-right">{formatCents(financing.stackDownPaymentToSeller)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink/60 min-w-0">Estimated Seller-Financed Balance</span>
                  <span className="text-ink flex-shrink-0 text-right">{formatCents(stackSellerFinancedBalance)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink/60 min-w-0">Are Monthly Seller Finance Payments Required?</span>
                  <span className="text-ink flex-shrink-0 text-right">{stackSellerFinancePaymentsRequired ? "Yes" : "No"}</span>
                </div>
                {stackSellerFinancePaymentsRequired ? (
                  <>
                    <div className="flex justify-between gap-3">
                      <span className="text-ink/60 min-w-0">Seller Finance Interest Rate</span>
                      <span className="text-ink flex-shrink-0 text-right">{formatPercent(percent.stackSellerFinanceRatePct)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-ink/60 min-w-0">Seller Finance Amortization</span>
                      <span className="text-ink flex-shrink-0 text-right">30-years</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-ink/60 min-w-0">Estimated Monthly Seller Finance Payment</span>
                      <span className="text-ink flex-shrink-0 text-right">{formatCents(stackMonthlySellerFinancePayment)}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between gap-3">
                    <span className="text-ink/60 min-w-0">Monthly Seller Finance Payment</span>
                    <span className="text-ink flex-shrink-0 text-right">Not Included</span>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <span className="text-ink/60 min-w-0">Cash to Close, Leg 1</span>
                  <span className="text-ink flex-shrink-0 text-right">{formatCents(stackCashToCloseLeg1)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink/60 min-w-0">Transactional Funding Fee</span>
                  <span className="text-ink flex-shrink-0 text-right">{formatCents(stackTransactionalFundingFee)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink/60 min-w-0">
                    {stackEstimatedBuyerCashAtClosing < 0
                      ? "Estimated Buyer Cash Required"
                      : "Estimated Cash to Buyer at Closing"}
                  </span>
                  <span className="text-ink flex-shrink-0 text-right">{formatCents(Math.abs(stackEstimatedBuyerCashAtClosing))}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink/60 min-w-0">Total Debt at Acquisition</span>
                  <span className="text-ink flex-shrink-0 text-right">{formatCents(stackTotalDebtAtAcquisition)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink/60 min-w-0">Current Leverage Ratio</span>
                  <span className="text-ink flex-shrink-0 text-right">
                    {formatLeverageRatio(stackLeverageRatioDecimal)}
                  </span>
                </div>
              </div>

              <div className="mt-2 pt-2 border-t border-ink/10 flex items-center justify-between">
                <span className="text-[9.5pt] text-ink/60">
                  Can this be purchased for an estimated $0 out of pocket?
                </span>
                <ZeroOutOfPocketBadge value={stackZeroOutOfPocket} size="print" />
              </div>

              <div className="mt-2 pt-2 border-t border-ink/10">
                <p className="text-[8.5pt] font-semibold uppercase tracking-wide text-ink/60 mb-1.5">
                  Capital Required Reconciliation
                </p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[9.5pt]">
                  <div className="flex justify-between gap-3">
                    <span className="text-ink/60 min-w-0">Base Capital Required</span>
                    <span className="text-ink flex-shrink-0 text-right">{formatCents(results.stackBaseCapitalRequired)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-ink/60 min-w-0">Closing Cash Adjustment</span>
                    <span className="text-ink flex-shrink-0 text-right">
                      {stackEstimatedBuyerCashAtClosing >= 0
                        ? `-${formatCents(stackEstimatedBuyerCashAtClosing)}`
                        : `+${formatCents(Math.abs(stackEstimatedBuyerCashAtClosing))}`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex justify-between items-center rounded-lg bg-ink text-white px-3 py-2.5">
                <span className="text-[9.5pt] font-semibold uppercase tracking-wide">
                  Adjusted Total Capital Required
                </span>
                <span className="text-[13pt] font-bold">{formatCents(results.totalCapitalRequired)}</span>
              </div>
              {results.stackNetCashToBuyerAfterProjectCosts > 0 && (
                <div className="mt-2 flex justify-between items-center rounded-lg bg-brass/10 border border-brass px-3 py-2.5">
                  <span className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink">
                    Net Cash to Buyer After Project Costs
                  </span>
                  <span className="text-[13pt] font-bold text-ink">
                    {formatCents(results.stackNetCashToBuyerAfterProjectCosts)}
                  </span>
                </div>
              )}
              <div className="mt-2 flex justify-between items-center rounded-lg bg-ink text-white px-3 py-2.5">
                <span className="text-[9.5pt] font-semibold uppercase tracking-wide">
                  Total PITI
                </span>
                <span className="text-[13pt] font-bold">{formatCents(results.monthlyHousingPayment)}</span>
              </div>
            </div>
          )}

          {financingMode === "stackMethod" && (
            <AmortizationPrintCard title="Bank Loan Amortization Schedule" schedule={stackBankAmortization.schedule} />
          )}

          {financingMode === "stackMethod" && stackSellerFinancePaymentsRequired && (
            <AmortizationPrintCard
              title="Seller-Carried Second Amortization Schedule"
              schedule={stackSellerAmortization.schedule}
            />
          )}

          {financingMode === "stackMethod" && stackBalloonAnalysis && (
            <BalloonRefinancePrintCard
              analysis={stackBalloonAnalysis}
              loanBalanceRows={[
                { label: "First-Position Loan Balance at Balloon", value: stackBalloonAnalysis.bankBalanceAtBalloon },
                { label: "Seller-Finance Balance at Balloon", value: stackBalloonAnalysis.sellerBalanceAtBalloon },
              ]}
              stackRefinanceDetail
            />
          )}

          {financingMode !== "" && activeRoiProjection && (
            <RoiProjectionPrintSection
              appreciationPct={activeRoiAppreciationPct}
              totalCapitalRequired={results.totalCapitalRequired}
              hasBalloon={activeRoiBalloon !== null}
              balloonYears={activeRoiBalloon?.balloonYears ?? 0}
              refinanceAtBalloon={roiRefinanceControls?.atBalloon ?? true}
              refinanceRatePct={roiRefinanceControls?.rateUsed ?? 0}
              projection={activeRoiProjection}
            />
          )}

          {/* Rental Income card: Gross and Effective Monthly Rent called
              out as large highlight tiles (Effective Monthly Rent uses a
              subtle green tint, since it is the positive, spendable
              figure), with the supporting line items below. */}
          <div className="mb-3 print:break-inside-avoid-page rounded-xl border border-ink/15 bg-white p-2.5">
            <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-brass/40">
              <DollarSign size={14} className="text-brass" />
              <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink">Rental Income</p>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="rounded-lg bg-paper-2 px-3 py-2.5">
                <p className="text-[7.5pt] uppercase tracking-wide text-ink/60">Gross Monthly Rent</p>
                <p className="text-[14pt] font-bold text-ink">{formatCents(results.grossMonthlyRent)}</p>
              </div>
              <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor: "#E4F3E8" }}>
                <p className="text-[7.5pt] uppercase tracking-wide text-ink/60">Effective Monthly Rent</p>
                <p className="text-[14pt] font-bold" style={{ color: "#1E8E3E" }}>
                  {formatCents(results.effectiveRentAfterVacancy)}
                </p>
              </div>
            </div>
            {/* Room-Rate Summary: Room Type, Number of Rooms, Weekly Rate
                per Room, and Estimated Monthly Revenue for each room type
                plus a Total row. Reuses results.monthlySharedBathRent /
                results.monthlyEnsuiteRent exactly as computed by the
                underwriting engine above, so the printed monthly revenue
                always matches the calculator's own figures -- no separate
                or duplicate weekly-to-monthly conversion is introduced
                here. */}
            <table className="w-full text-[9pt] border-collapse mb-3">
              <thead>
                <tr className="text-left text-ink/60 border-b border-ink/15">
                  <th className="py-1 font-medium">Room Type</th>
                  <th className="py-1 font-medium text-right">Rooms</th>
                  <th className="py-1 font-medium text-right">Weekly Rate</th>
                  <th className="py-1 font-medium text-right">Monthly Revenue</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-ink/10 print:break-inside-avoid-page">
                  <td className="py-1 text-ink">Shared Bath</td>
                  <td className="py-1 text-ink text-right">{sharedBathBedrooms}</td>
                  <td className="py-1 text-ink text-right">{formatCents(weeklySharedBathRent)}</td>
                  <td className="py-1 text-ink text-right">{formatCents(results.monthlySharedBathRent)}</td>
                </tr>
                <tr className="border-b border-ink/10 print:break-inside-avoid-page">
                  <td className="py-1 text-ink">Ensuite</td>
                  <td className="py-1 text-ink text-right">{ensuiteBedrooms}</td>
                  <td className="py-1 text-ink text-right">{formatCents(weeklyEnsuiteRent)}</td>
                  <td className="py-1 text-ink text-right">{formatCents(results.monthlyEnsuiteRent)}</td>
                </tr>
                <tr className="print:break-inside-avoid-page">
                  <td className="py-1 text-ink font-semibold">Total</td>
                  <td className="py-1 text-ink text-right font-semibold">{results.totalBedrooms}</td>
                  <td className="py-1 text-ink text-right"></td>
                  <td className="py-1 text-ink text-right font-semibold">
                    {formatCents(results.grossMonthlyRent)}
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="space-y-1.5 text-[9.5pt]">
              <div className="flex justify-between">
                <span className="text-ink/60">Vacancy ({formatPercent(percent.vacancyPct)})</span>
                <span className="text-ink">-{formatCents(results.vacancyExpense)}</span>
              </div>
            </div>
          </div>

          {/* PadSplit Rental Data: supporting documentation only,
              rendered only when one was actually uploaded so no blank or
              near-blank section is ever created. An image renders
              directly (object-contain preserves its original aspect
              ratio without cropping or stretching); a PDF instead
              renders as a linked "PadSplit Rental Data PDF" document
              card, since a browser print view cannot reliably re-embed
              another PDF's pages. */}
          {padSplitScreenshot && (
            <div className="mb-3 print:break-inside-avoid-page rounded-xl border border-ink/15 bg-white p-2.5">
              <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-brass/40">
                <DollarSign size={14} className="text-brass" />
                <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink">
                  PadSplit Rental Data
                </p>
              </div>
              {padSplitScreenshot.kind === "image" ? (
                <div className="flex justify-center bg-paper-2 rounded-lg border border-ink/15 p-2">
                  <img
                    src={padSplitScreenshot.dataUrl}
                    alt={padSplitScreenshot.name || "PadSplit rental data screenshot"}
                    className="w-full h-auto max-h-[3.4in] object-contain"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-3 bg-paper-2 rounded-lg border border-ink/15 p-3">
                  <FileText size={22} className="text-brass flex-shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-[7.5pt] uppercase tracking-wide text-ink/50">
                      PadSplit Rental Data PDF
                    </p>
                    <p className="text-[9.5pt] font-medium text-ink truncate">
                      {padSplitScreenshot.name || "PadSplit Rental Data.pdf"}
                    </p>
                    <a
                      href={padSplitScreenshot.dataUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[9pt] text-brass underline decoration-brass/50 underline-offset-2"
                    >
                      Open PadSplit Rental Data PDF
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Monthly Operating Expenses card: alternating row backgrounds,
              Total Monthly Operating Expenses called out at the bottom. */}
          <div className="mb-3 print:break-inside-avoid-page rounded-xl border border-ink/15 bg-white p-2.5">
            <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-brass/40">
              <Wallet size={14} className="text-brass" />
              <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink">
                Monthly Operating Expenses
              </p>
            </div>
            <div className="text-[9.5pt]">
              {[
                { label: printHousingPaymentLabel, value: results.monthlyHousingPayment },
                {
                  label: `Platform Fees (${formatPercent(percent.platformFeePct)})`,
                  value: results.platformFees,
                },
                {
                  label: `Property Management (${formatPercent(percent.propertyManagementPct)})`,
                  value: results.propertyManagementFee,
                },
                { label: "Maintenance", value: results.maintenanceMonthly },
                { label: "Utilities", value: results.utilitiesMonthly },
                { label: "Cleaning", value: results.cleaningMonthly },
                { label: "Lawn Care", value: results.lawnCareMonthly },
                { label: "Pest Control", value: results.pestControlMonthly },
              ].map((row, i) => (
                <div
                  key={row.label}
                  className={`flex justify-between px-2 py-1.5 rounded ${i % 2 === 1 ? "bg-paper-2" : ""}`}
                >
                  <span className="text-ink/70">{row.label}</span>
                  <span className="text-ink">{formatCents(row.value)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between items-center rounded-lg bg-ink text-white px-3 py-2.5">
              <span className="text-[9.5pt] font-semibold uppercase tracking-wide">
                Total Monthly Operating Expenses
              </span>
              <span className="text-[13pt] font-bold">
                {formatCents(results.totalMonthlyOperatingExpenses)}
              </span>
            </div>
          </div>

          {/* Capital Required card: the same fourteen line items that make
              up the Total Capital Required calculation, laid out as a
              two-column list with Total Capital Required called out
              below. */}
          <div className="mb-3 print:break-inside-avoid-page rounded-xl border border-ink/15 bg-white p-2.5">
            <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-brass/40">
              <PiggyBank size={14} className="text-brass" />
              <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink">Capital Required</p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[9.5pt]">
              {financingMode !== "stackMethod" && (
                <div className="flex justify-between">
                  <span className="text-ink/60">{downPaymentLabel}</span>
                  <span className="text-ink">{formatCents(results.downPaymentForCapital)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-ink/60">Reserves</span>
                <span className="text-ink">{formatCents(capital.reserves)}</span>
              </div>
              {financingMode !== "stackMethod" &&
                financingMode !== "traditional" &&
                financingMode !== "sellerFinancing" && (
                  <div className="flex justify-between">
                    <span className="text-ink/60">Arrears</span>
                    <span className="text-ink">{formatCents(capital.arrears)}</span>
                  </div>
                )}
              {financingMode !== "stackMethod" && financingMode !== "traditional" && (
                <div className="flex justify-between">
                  <span className="text-ink/60">Upfront Insurance</span>
                  <span className="text-ink">{formatCents(capital.upfrontInsurance)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-ink/60">Renovation Cost</span>
                <span className="text-ink">{formatCents(capital.renovationCost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/60">Acquisition Fee</span>
                <span className="text-ink">{formatCents(capital.acquisitionFee)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/60">Furniture</span>
                <span className="text-ink">{formatCents(capital.furniture)}</span>
              </div>
              {financingMode === "stackMethod" ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-ink/60">TC Fee</span>
                    <span className="text-ink">{formatCents(capital.stackTcFee)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink/60">LLC Entity Formation Cost</span>
                    <span className="text-ink">{formatCents(capital.stackLlcFee)}</span>
                  </div>
                </>
              ) : financingMode === "traditional" ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-ink/60">TC Fee</span>
                    <span className="text-ink">{formatCents(capital.traditionalTcFee)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink/60">LLC Entity Formation Cost</span>
                    <span className="text-ink">{formatCents(capital.traditionalLlcFee)}</span>
                  </div>
                </>
              ) : financingMode === "subjectTo" ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-ink/60">TC Fee</span>
                    <span className="text-ink">{formatCents(capital.subjectToTcFee)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink/60">LLC Entity Formation Cost</span>
                    <span className="text-ink">{formatCents(capital.subjectToLlcFee)}</span>
                  </div>
                </>
              ) : financingMode === "hybrid" ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-ink/60">TC Fee</span>
                    <span className="text-ink">{formatCents(capital.hybridTcFee)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink/60">LLC Entity Formation Cost</span>
                    <span className="text-ink">{formatCents(capital.hybridLlcFee)}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-ink/60">TC Fee</span>
                    <span className="text-ink">{formatCents(capital.sellerFinancingTcFee)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink/60">LLC Entity Formation Cost</span>
                    <span className="text-ink">{formatCents(capital.sellerFinancingLlcFee)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <span className="text-ink/60">Appliances</span>
                <span className="text-ink">{formatCents(capital.appliances)}</span>
              </div>
              {financingMode === "stackMethod" ? (
                <div className="flex justify-between">
                  <span className="text-ink/60">Closing Costs, Agent Fees, and Assignment Fee</span>
                  <span className="text-ink">Included above</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-ink/60">
                      {financingMode === "traditional"
                        ? `Traditional Closing Cost Percentage (${formatPercent(percent.traditionalClosingCostPct)})`
                        : `Closing Costs (${formatPercent(percent.closingCostPct)})`}
                    </span>
                    <span className="text-ink">{formatCents(results.closingCosts)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink/60">Agent Fee</span>
                    <span className="text-ink">{formatCents(capital.agentFee)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink/60">Assignment Fee</span>
                    <span className="text-ink">{formatCents(capital.assignmentFee)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <span className="text-ink/60">Photos</span>
                <span className="text-ink">{formatCents(capital.photos)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/60">Holding Costs</span>
                <span className="text-ink">{formatCents(results.holdingCosts)}</span>
              </div>
            </div>
            {financingMode === "stackMethod" && (
              <div className="mt-2 pt-2 border-t border-ink/10">
                <p className="text-[8.5pt] font-semibold uppercase tracking-wide text-ink/60 mb-1.5">
                  Capital Required Reconciliation
                </p>
                <div className="space-y-1 text-[9.5pt]">
                  <div className="flex justify-between">
                    <span className="text-ink/60">Base Capital Required</span>
                    <span className="text-ink">{formatCents(results.stackBaseCapitalRequired)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink/60">
                      {stackEstimatedBuyerCashAtClosing >= 0
                        ? "Estimated Cash to Buyer at Closing"
                        : "Estimated Buyer Cash Required"}
                    </span>
                    <span className="text-ink">
                      {stackEstimatedBuyerCashAtClosing >= 0
                        ? `-${formatCents(stackEstimatedBuyerCashAtClosing)}`
                        : `+${formatCents(Math.abs(stackEstimatedBuyerCashAtClosing))}`}
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div
              className="mt-3 flex justify-between items-center rounded-lg px-3 py-3"
              style={{ backgroundColor: "#FBEBC7" }}
            >
              <span className="text-[10pt] font-bold uppercase tracking-wide text-ink">
                {financingMode === "stackMethod" ? "Adjusted Total Capital Required" : "Total Capital Required"}
              </span>
              <span className="text-[16pt] font-bold text-ink">
                {formatCents(results.totalCapitalRequired)}
              </span>
            </div>
            {financingMode === "stackMethod" && results.stackNetCashToBuyerAfterProjectCosts > 0 && (
              <div
                className="mt-2 flex justify-between items-center rounded-lg px-3 py-3 border border-ink/15"
              >
                <span className="text-[10pt] font-bold uppercase tracking-wide text-ink">
                  Net Cash to Buyer After Project Costs
                </span>
                <span className="text-[16pt] font-bold text-ink">
                  {formatCents(results.stackNetCashToBuyerAfterProjectCosts)}
                </span>
              </div>
            )}
          </div>

          {/* Scope of Work: rendered only when at least one line item was
              entered, so no blank or near-blank section is ever created.
              Each row stays intact (print:break-inside-avoid-page) rather
              than splitting across a page break. */}
          {scopeOfWorkItems.length > 0 && (
            <div className="mb-3 print:break-inside-avoid-page rounded-xl border border-ink/15 bg-white p-2.5">
              <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-brass/40">
                <PiggyBank size={14} className="text-brass" />
                <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink">Scope of Work</p>
              </div>
              <table className="w-full text-[9.5pt] border-collapse">
                <thead>
                  <tr className="text-left text-ink/60 border-b border-ink/15">
                    <th className="py-1.5 font-medium">Work Item</th>
                    <th className="py-1.5 font-medium text-right">Estimated Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {scopeOfWorkItems.map((item) => (
                    <tr key={item.id} className="border-b border-ink/10 print:break-inside-avoid-page">
                      <td className="py-1.5 text-ink">{item.name.trim() || "Untitled Item"}</td>
                      <td className="py-1.5 text-ink text-right">{formatCents(item.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 pt-2 border-t border-ink/10 flex justify-between text-[9.5pt]">
                <span className="text-ink/60 font-semibold">Total Scope of Work</span>
                <span className="text-ink font-semibold">{formatCents(scopeOfWorkTotal)}</span>
              </div>
              <div className="mt-1 flex justify-between text-[9.5pt]">
                <span className="text-ink/60">Renovation Cost Used in Underwriting</span>
                <span className="text-ink">{formatCents(capital.renovationCost)}</span>
              </div>
              {Math.round(capital.renovationCost * 100) !== Math.round(scopeOfWorkTotal * 100) && (
                <p className="mt-2 text-[8.5pt] text-amber-700">
                  Renovation Cost was manually overridden.
                </p>
              )}
            </div>
          )}

          {/* Estimated Returns: Monthly and Annual Cash Flow as supporting
              cards, Estimated Cash-on-Cash Return repeated as a large
              green summary card, matching the executive-summary treatment. */}
          <div className="mb-2 print:break-inside-avoid-page">
            <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink border-b border-brass/60 pb-1 mb-2">
              Estimated Returns
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-ink/15 bg-white p-2.5 text-center">
                <p className="text-[7.5pt] uppercase tracking-wide text-ink/60">
                  Estimated Monthly Cash Flow
                </p>
                <p className="mt-1 text-[16pt] font-bold text-ink">{formatCents(results.monthlyCashFlow)}</p>
              </div>
              <div className="rounded-xl border border-ink/15 bg-white p-2.5 text-center">
                <p className="text-[7.5pt] uppercase tracking-wide text-ink/60">
                  Estimated Annual Cash Flow
                </p>
                <p className="mt-1 text-[16pt] font-bold text-ink">{formatCents(results.annualCashFlow)}</p>
              </div>
              <div
                className="rounded-xl border-4 border-ink p-4 text-center"
                style={{ backgroundColor: "#00FF00" }}
              >
                <p className="text-[7.5pt] font-bold uppercase tracking-wide text-ink">
                  Estimated Cash-on-Cash Return
                </p>
                <p className="mt-1 text-[22pt] font-bold text-ink">
                  {results.cashOnCashReturn === null ? stackCocrLabel : formatPercent(results.cashOnCashReturn)}
                </p>
              </div>
            </div>
          </div>

          {/* Floor Plan, only if one was uploaded, on its own page. An
              image is shown directly (never a filename or file link),
              centered, using object-contain so the plan's full aspect
              ratio is preserved and nothing is cropped or stretched. A
              PDF instead renders as a linked "Floor Plan PDF" document
              card, since a browser print view cannot reliably re-embed
              another PDF's pages. print:break-before-page starts it on a
              fresh page every time, and print:break-inside-avoid-page
              keeps it from splitting if it is taller than a single page.
              No top padding and a tight ~24px heading-to-image gap keep
              the image directly beneath the heading instead of drifting
              toward the bottom of the page; the image's own max-height
              is kept comfortably under a full page's usable height
              (after the heading and this container's padding) so the
              whole block reliably fits on one page rather than being
              bumped, nearly in its entirety, onto the next one. */}
          {floorPlan && (
            <div className="print:break-before-page print:break-inside-avoid-page">
              <p className="text-[16pt] font-display font-bold text-ink mb-6 pb-2 border-b-4 border-brass">
                Floor Plan
              </p>
              {floorPlan.kind === "image" ? (
                <div className="flex justify-center bg-paper-2 rounded-xl border border-ink/15 p-4">
                  <img
                    src={floorPlan.dataUrl}
                    alt={floorPlan.name || "Floor plan"}
                    className="w-full h-auto max-h-[8.2in] object-contain"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-3 bg-paper-2 rounded-xl border border-ink/15 p-4">
                  <FileText size={26} className="text-brass flex-shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-[8pt] uppercase tracking-wide text-ink/50">Floor Plan PDF</p>
                    <p className="text-[11pt] font-medium text-ink truncate">
                      {floorPlan.name || "Floor Plan.pdf"}
                    </p>
                    <a
                      href={floorPlan.dataUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10pt] text-brass underline decoration-brass/50 underline-offset-2"
                    >
                      Open Floor Plan PDF
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Capital Partner call-to-action. Sits at the very bottom of
              every printed/PDF report, after all underwriting sections
              and calculations, for every financing structure -- this
              is the shared JSX tree all five modes render through, so
              nothing mode-specific is needed here. Generous top margin
              plus a border separates it visually from the report
              content above so it reads as its own footer section
              rather than a continuation of the last card.
              print:break-inside-avoid-page keeps the whole block
              together: if it does not fit in the remaining space on
              the last page, the browser's print engine pushes the
              entire block onto a fresh page rather than splitting the
              heading from the link across two pages. The link uses the
              full https://michaelaylett.com URL (not an internal
              /capital-partners anchor) specifically so it still
              resolves correctly once the report is downloaded/emailed
              as a standalone PDF, disconnected from the site itself. */}
          <div className="hidden print:block mt-10 pt-6 border-t border-ink/15 text-center print:break-inside-avoid-page">
            <p className="text-[11pt] font-display font-bold text-ink mb-1.5">
              Interested in being a Capital Partner?
            </p>
            <p className="text-[9pt] text-ink/70 leading-relaxed max-w-[5in] mx-auto">
              If you&apos;d like to partner with us on future co-living investments, we&apos;d love
              to hear from you.
            </p>
            <p className="text-[9pt] text-ink mt-2">
              Fill out an application{" "}
              <a
                href="https://michaelaylett.com/capital-partners"
                className="text-blue-600 underline underline-offset-2"
              >
                here
              </a>
              .
            </p>
          </div>

          {/* Branded footer. Rendered once, in normal document flow, at
              the very end of the report. An earlier version used
              position:fixed to try to repeat this on every printed page,
              but Chrome's print engine reserves/duplicates space for
              fixed-position elements unpredictably, which was throwing
              off pagination throughout the report (including pushing the
              Floor Plan image onto a stray extra page). A single static
              footer here is reliable and does not affect layout above
              it. */}
          <div className="hidden print:flex mt-2 items-center justify-between px-4 py-1.5 border-t border-ink/15 bg-paper text-[7.5pt] text-ink/60 print:break-inside-avoid-page">
            <span className="font-semibold text-ink">Michael Aylett</span>
            <span>Co-Living Investment Analysis</span>
            <span>michaelaylett.com</span>
          </div>
        </div>
      </div>
    </section>
  );
}
