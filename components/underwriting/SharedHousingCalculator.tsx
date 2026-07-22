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

import { useEffect, useMemo, useState } from "react";
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
  ArrowLeft,
  ArrowRight,
} from "lucide-react";

// ---------------------------------------------------------------------
// Fixed, non-editable amounts. Platform fees, cleaning, lawn care, pest
// control, and the closing cost percentage used to be here too, but are
// now editable defaults tracked in component state instead (see
// PERCENT_DEFAULTS and MAINTENANCE_EXPENSE_DEFAULTS below).
// ---------------------------------------------------------------------
const MAINTENANCE_ANNUAL = 4800;
const UTILITIES_PER_BEDROOM = 80;
const HOLDING_MONTHS = 3;

// Property Images: processed and stored entirely client-side (never
// uploaded anywhere) as compressed, orientation-corrected data URLs so
// they can be previewed on screen and embedded directly in the
// printable report.
const MAX_PROPERTY_PHOTOS = 5;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_IMAGE_DIMENSION = 1600;

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

// ---------------------------------------------------------------------
// Property Images: type, client-side processing, and print gallery
// layout. Everything here runs entirely in the browser; no image is
// ever uploaded to a server. Orientation is auto-corrected and the
// image is resized/compressed via an off-screen canvas before being
// stored as a data URL, both for on-screen previews and for the
// printable report.
// ---------------------------------------------------------------------
type PropertyImage = { id: string; dataUrl: string; name: string };

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

// Determines the printable report's image-gallery grid based on how
// many photos were uploaded: 1 = large featured image, 2 = side by
// side, 3-4 = a balanced grid, 5-6 = a compact multi-row gallery.
function getGalleryLayout(count: number): { gridClass: string; imgHeightClass: string } {
  if (count <= 1) return { gridClass: "grid-cols-1", imgHeightClass: "h-[3.2in]" };
  if (count === 2) return { gridClass: "grid-cols-2", imgHeightClass: "h-[2.4in]" };
  if (count <= 4) return { gridClass: "grid-cols-2", imgHeightClass: "h-[1.8in]" };
  return { gridClass: "grid-cols-3", imgHeightClass: "h-[1.3in]" };
}

// Floor Plan file: a single optional image, processed exactly like a
// Property Image (resized, orientation-corrected, and stored as a data
// URL) so it can be previewed on screen and embedded directly, as an
// actual image, in the printable report.
type FloorPlanFile = { dataUrl: string; name: string };

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
function BalloonStatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <span className="text-ink/70">{label}</span>
      <span className="text-right">{value}</span>
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
                <BalloonStatRow label="Maximum Debt at 70% LTV" value={formatCents(analysis.maxDebtAt70Ltv)} />
                <BalloonStatRow
                  label="Projected LTV at Balloon"
                  value={analysis.projectedLtv === null ? "N/A" : formatPercent(analysis.projectedLtv * 100)}
                />
                <BalloonStatRow label="Estimated Equity Cushion" value={formatCents(analysis.equityCushion)} />
              </div>

              <div className="mt-4">
                {!analysis.has70LtvContingency ? (
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
}: {
  analysis: BalloonAnalysis;
  loanBalanceRows: { label: string; value: number }[];
  extraTextRows?: { label: string; value: string }[];
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
      </div>

      <div className="mt-2 pt-2 border-t border-ink/10">
        {!analysis.has70LtvContingency ? (
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

type AmortizationRow = {
  paymentNumber: number;
  beginningBalance: number;
  principalPaid: number;
  interestPaid: number;
  totalPayment: number;
  endingBalance: number;
};

// Builds the complete month-by-month amortization schedule using
// declining principal (not simple/flat interest): each payment's
// interest portion is calculated on that month's actual beginning
// balance. The unrounded monthly payment drives every month's math
// internally; only the final, displayed figures are rounded to cents.
// The very last payment is adjusted by whatever a few cents of
// accumulated rounding requires, so the schedule always ends at exactly
// $0.00 rather than a few cents above or below zero.
function buildAmortizationSchedule(
  loanAmount: number,
  annualRatePct: number
): { schedule: AmortizationRow[]; monthlyPayment: number } {
  const roundedLoanAmount = round2(Math.max(0, loanAmount));
  const monthlyPaymentUnrounded = calculateMonthlyPrincipalAndInterest(roundedLoanAmount, annualRatePct);
  const monthlyPayment = round2(monthlyPaymentUnrounded);

  if (roundedLoanAmount <= 0) {
    return { schedule: [], monthlyPayment: 0 };
  }

  const monthlyRate = annualRatePct / 100 / 12;
  const schedule: AmortizationRow[] = [];
  let balance = roundedLoanAmount;

  for (let i = 1; i <= TRADITIONAL_NUM_PAYMENTS; i++) {
    const beginningBalance = balance;
    const interestPaid = round2(beginningBalance * monthlyRate);
    const isFinalPayment = i === TRADITIONAL_NUM_PAYMENTS;
    let principalPaid = round2(monthlyPayment - interestPaid);

    // Guards against rounding ever taking the balance below $0, whether
    // on the scheduled final payment or (in an edge case with a very
    // small loan/high rate) an earlier one.
    if (isFinalPayment || principalPaid >= beginningBalance) {
      principalPaid = beginningBalance;
    }

    const totalPayment = round2(interestPaid + principalPaid);
    const endingBalance = Math.max(0, round2(beginningBalance - principalPaid));

    schedule.push({
      paymentNumber: i,
      beginningBalance,
      principalPaid,
      interestPaid,
      totalPayment,
      endingBalance,
    });

    balance = endingBalance;
    if (balance <= 0) break;
  }

  return { schedule, monthlyPayment };
}

// ---------------------------------------------------------------------
// Stack Method: unlike Traditional Financing and the Hybrid structure
// (both fixed at 30 years / 360 monthly payments), the Stack Method's
// Bank Amortization Term and Seller Finance Amortization Term are both
// editable, so the two functions below generalize the same standard
// fixed-rate amortization formula and schedule builder to accept any
// number of monthly payments rather than the fixed 360.
// ---------------------------------------------------------------------
function calculateMonthlyPaymentForTerm(principal: number, annualRatePct: number, numPayments: number): number {
  if (!Number.isFinite(principal) || principal <= 0) return 0;
  const n = Math.max(1, Math.round(numPayments));
  const monthlyRate = annualRatePct / 100 / 12;
  if (!Number.isFinite(monthlyRate) || monthlyRate <= 0) {
    return principal / n;
  }
  const factor = Math.pow(1 + monthlyRate, n);
  const payment = (principal * (monthlyRate * factor)) / (factor - 1);
  return Number.isFinite(payment) ? payment : 0;
}

function buildAmortizationScheduleForTerm(
  principal: number,
  annualRatePct: number,
  numPayments: number
): { schedule: AmortizationRow[]; monthlyPayment: number } {
  const roundedPrincipal = round2(Math.max(0, principal));
  const n = Math.max(1, Math.round(numPayments));
  const monthlyPaymentUnrounded = calculateMonthlyPaymentForTerm(roundedPrincipal, annualRatePct, n);
  const monthlyPayment = round2(monthlyPaymentUnrounded);

  if (roundedPrincipal <= 0) {
    return { schedule: [], monthlyPayment: 0 };
  }

  const monthlyRate = annualRatePct / 100 / 12;
  const schedule: AmortizationRow[] = [];
  let balance = roundedPrincipal;

  for (let i = 1; i <= n; i++) {
    const beginningBalance = balance;
    const interestPaid = round2(beginningBalance * monthlyRate);
    const isFinalPayment = i === n;
    let principalPaid = round2(monthlyPayment - interestPaid);

    if (isFinalPayment || principalPaid >= beginningBalance) {
      principalPaid = beginningBalance;
    }

    const totalPayment = round2(interestPaid + principalPaid);
    const endingBalance = Math.max(0, round2(beginningBalance - principalPaid));

    schedule.push({
      paymentNumber: i,
      beginningBalance,
      principalPaid,
      interestPaid,
      totalPayment,
      endingBalance,
    });

    balance = endingBalance;
    if (balance <= 0) break;
  }

  return { schedule, monthlyPayment };
}

// ---------------------------------------------------------------------
// Balloon Refinance Analysis: shared math used by every financing
// structure's balloon feature (Stack Method, Subject To, Seller
// Financing, and Subject To & Seller Finance Hybrid). Every function
// here works in unrounded values internally -- only the values actually
// displayed are rounded to cents/percent, per the "use unrounded values
// internally" requirement.
// ---------------------------------------------------------------------

// The remaining principal balance of a fully-amortizing loan after
// `monthsElapsed` of its `totalMonths` term, using the true amortization
// formula (never simple/linear division): B_k = P x [(1+r)^n - (1+r)^k]
// / [(1+r)^n - 1]. At a 0% rate this correctly reduces to equal
// principal payments each month (straight-line), matching how a 0%
// seller-finance note actually pays down.
function remainingBalanceAfterMonths(
  principal: number,
  annualRatePct: number,
  totalMonths: number,
  monthsElapsed: number
): number {
  if (!Number.isFinite(principal) || principal <= 0) return 0;
  const n = Math.max(1, Math.round(totalMonths));
  const k = Math.max(0, Math.min(n, Math.round(monthsElapsed)));
  if (k >= n) return 0;
  const monthlyRate = annualRatePct / 100 / 12;
  if (!Number.isFinite(monthlyRate) || monthlyRate <= 0) {
    return (principal * (n - k)) / n;
  }
  const factor = Math.pow(1 + monthlyRate, n);
  const factorK = Math.pow(1 + monthlyRate, k);
  if (!Number.isFinite(factor) || factor <= 1) return principal;
  const balance = (principal * (factor - factorK)) / (factor - 1);
  return Number.isFinite(balance) ? Math.max(0, balance) : 0;
}

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
  loanBalanceRows: { label: string; value: number }[]
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
  rows.push(
    { label: "Total Projected Debt at Balloon", value: formatCents(analysis.projectedDebtAtBalloon) },
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
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
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
  // structure with a $2,500 TC Fee default; every other structure
  // defaults to $1,500. LLC Entity Formation Cost defaults to $1,000
  // everywhere.
  stackTcFee: 2500,
  stackLlcFee: 1000,
  traditionalTcFee: 1500,
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
  // Hybrid's existing subject-to first mortgage rate, used the same way
  // -- only for its Balloon Refinance Analysis.
  | "hybridExistingMortgageRatePct"
  // Balloon Refinance Analysis: Annual Property Appreciation, one
  // independently editable field per financing structure (each
  // structure's balloon terms are otherwise entirely independent).
  | "stackBalloonAppreciationPct"
  | "subjectToBalloonAppreciationPct"
  | "sellerFinancingBalloonAppreciationPct"
  | "hybridBalloonAppreciationPct";

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
  hybridExistingMortgageRatePct: 6,
  stackBalloonAppreciationPct: 2,
  subjectToBalloonAppreciationPct: 2,
  sellerFinancingBalloonAppreciationPct: 2,
  hybridBalloonAppreciationPct: 2,
};

// Cleaning, Lawn Care, and Pest Control replace the old combined
// "Cleaning and Lawn Care" field: three separate, fully editable
// monthly expenses, each with its own default.
type MaintenanceExpenseKey = "cleaning" | "lawnCare" | "pestControl";

const MAINTENANCE_EXPENSE_DEFAULTS: Record<MaintenanceExpenseKey, number> = {
  cleaning: 80,
  lawnCare: 125,
  pestControl: 0,
};

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

  // Subject To and Seller Financing already share the same underlying
  // loan-balance/monthly-payment fields (see the FinancingKey block
  // above and the shared input section below); they now also share
  // these two fields, used only by the Balloon Refinance Analysis to
  // project that same loan's remaining balance at the balloon date via
  // its true amortization schedule. Never used for the existing
  // PITI/operating-expense math, which continues to read only
  // financing.monthlyPayment exactly as before.
  const [loanRemainingAmortizationYears, setLoanRemainingAmortizationYears] = useState(30);
  const [loanRemainingAmortizationYearsDraft, setLoanRemainingAmortizationYearsDraft] = useState("30");

  // Hybrid's existing subject-to first mortgage has the same gap: only
  // a monthly PITI payment is collected (financing.hybridSubjectToPITI),
  // never a rate or remaining term, so this pair exists solely to
  // project that mortgage's remaining balance at the balloon date.
  const [hybridExistingMortgageAmortizationYears, setHybridExistingMortgageAmortizationYears] =
    useState(30);
  const [
    hybridExistingMortgageAmortizationYearsDraft,
    setHybridExistingMortgageAmortizationYearsDraft,
  ] = useState("30");

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

  // Property Address and Property Images stay local to the current
  // browser session: plain in-memory state only, never written to
  // localStorage/sessionStorage, never uploaded anywhere, and cleared on
  // refresh or Reset to Defaults.
  const [propertyAddress, setPropertyAddress] = useState("");
  const [propertyImages, setPropertyImages] = useState<PropertyImage[]>([]);
  const [imageError, setImageError] = useState("");
  const [processingImages, setProcessingImages] = useState(false);
  // Tracks whether a drag is currently over the property photo drop
  // zone, purely for the highlighted border/background treatment below
  // -- it never affects which files are actually accepted (that is
  // still handleAddImageFiles's job, reused identically for both
  // click-to-upload and drag-and-drop).
  const [isDraggingPhotos, setIsDraggingPhotos] = useState(false);
  const [videoWalkthroughLink, setVideoWalkthroughLink] = useState("");
  const [floorPlan, setFloorPlan] = useState<FloorPlanFile | null>(null);
  const [floorPlanError, setFloorPlanError] = useState("");
  const [processingFloorPlan, setProcessingFloorPlan] = useState(false);
  // PadSplit Rental Data Screenshot: a single optional supporting image
  // (comparable PadSplit rental data or room-rate research), processed
  // and stored exactly like the Floor Plan above -- entirely
  // client-side, never automatically read or used in any calculation.
  // Shared across every financing structure (not tied to financingMode)
  // so it never disappears when the selected structure changes.
  const [padSplitScreenshot, setPadSplitScreenshot] = useState<FloorPlanFile | null>(null);
  const [padSplitScreenshotError, setPadSplitScreenshotError] = useState("");
  const [processingPadSplitScreenshot, setProcessingPadSplitScreenshot] = useState(false);
  // Financing Structure is a single-select choice among four mutually
  // exclusive modes, each with its own inputs and calculations: only one
  // may ever be active. "" means no structure has been selected yet
  // (the "Not Specified" state). Subject To and Seller Financing can no
  // longer be selected together independently -- a transaction that
  // combines both uses the dedicated Hybrid option instead, which has
  // its own dedicated inputs (see the Hybrid section further down).
  const [financingMode, setFinancingMode] = useState<FinancingMode>("");

  // Selecting a financing structure option deselects whichever one was
  // previously active; clicking the already-active option deselects it
  // and returns to "Not Specified", matching the toggle behavior visitors
  // are used to from the previous checkbox-style selector.
  function selectFinancingMode(mode: Exclude<FinancingMode, "">) {
    setFinancingMode((prev) => (prev === mode ? "" : mode));
  }

  // Amortization schedule expand/collapse state for the Traditional
  // Financing section (see the "View Estimated Amortization Schedule"
  // section further down).
  const [amortizationOpen, setAmortizationOpen] = useState(false);
  const [amortizationShowAll, setAmortizationShowAll] = useState(false);

  // Amortization schedule expand/collapse state for the Hybrid
  // structure's Seller Finance Amortization Schedule (see "View Seller
  // Finance Amortization Schedule" further down). Kept separate from
  // the Traditional Financing schedule state above so each behaves
  // independently even though only one is ever visible at a time.
  const [hybridAmortizationOpen, setHybridAmortizationOpen] = useState(false);
  const [hybridAmortizationShowAll, setHybridAmortizationShowAll] = useState(false);

  // Amortization schedule expand/collapse state for the Stack Method's
  // two separate schedules: the first-position Bank Loan and the
  // second-position Seller Finance balance. Kept independent from each
  // other and from the schedules above.
  const [stackBankAmortizationOpen, setStackBankAmortizationOpen] = useState(false);
  const [stackBankAmortizationShowAll, setStackBankAmortizationShowAll] = useState(false);
  const [stackSellerAmortizationOpen, setStackSellerAmortizationOpen] = useState(false);
  const [stackSellerAmortizationShowAll, setStackSellerAmortizationShowAll] = useState(false);

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
    setPercent((prev) => ({ ...prev, [key]: parseTypedPercent(raw) }));
  }
  function handlePercentBlur(key: PercentKey) {
    setPercent((prev) => {
      const clamped = Math.min(100, Math.max(0, prev[key]));
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

  // Property Images handlers: adding, removing, and replacing all run
  // entirely client-side (see processImageFile above). Unsupported file
  // types are rejected with a clear error message instead of breaking
  // the calculator, and selection is capped at MAX_PROPERTY_PHOTOS.
  async function handleAddImageFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setImageError("");

    const valid = files.filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type));
    const invalid = files.filter((f) => !ACCEPTED_IMAGE_TYPES.includes(f.type));

    if (invalid.length > 0) {
      setImageError("Please upload a PNG, JPG, JPEG, or WEBP image.");
    }
    if (valid.length === 0) return;

    const remainingSlots = MAX_PROPERTY_PHOTOS - propertyImages.length;
    if (remainingSlots <= 0) {
      setImageError(
        `Maximum of ${MAX_PROPERTY_PHOTOS} property photos reached. Remove a photo before adding another.`
      );
      return;
    }

    const toProcess = valid.slice(0, remainingSlots);
    if (valid.length > toProcess.length) {
      setImageError(
        `You can upload up to ${MAX_PROPERTY_PHOTOS} property photos. Only the first ${toProcess.length} of the selected images were added.`
      );
    }

    setProcessingImages(true);
    try {
      const processed = await Promise.all(
        toProcess.map(async (file) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          dataUrl: await processImageFile(file),
          name: file.name,
        }))
      );
      setPropertyImages((prev) => [...prev, ...processed]);
    } catch {
      setImageError("One or more images could not be processed. Please try a different file.");
    } finally {
      setProcessingImages(false);
    }
  }

  function handleRemoveImage(id: string) {
    setPropertyImages((prev) => prev.filter((img) => img.id !== id));
  }

  // Drag-and-drop for property photos: reuses handleAddImageFiles
  // exactly, so dropped files go through the identical type-checking,
  // 5-photo cap, and append-not-replace logic as files chosen through
  // the click-to-upload input. Dragging is purely a second way to reach
  // the same handler; nothing about file validation or storage differs.
  function handlePhotoDragEnter(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (propertyImages.length >= MAX_PROPERTY_PHOTOS) return;
    setIsDraggingPhotos(true);
  }
  function handlePhotoDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (propertyImages.length >= MAX_PROPERTY_PHOTOS) return;
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

  // Reorders property photos by swapping the photo at `id` with its
  // immediate left/right neighbor. The array order here is exactly the
  // order used everywhere the photos are displayed -- the on-page
  // preview grid, the featured/thumbnail brochure layout in the
  // printable report (index 0 is always the large featured photo), and
  // the printable gallery -- so reordering on-page reorders the printed
  // report identically.
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
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setImageError("Please upload a PNG, JPG, JPEG, or WEBP image.");
      return;
    }
    setImageError("");
    setProcessingImages(true);
    try {
      const dataUrl = await processImageFile(file);
      setPropertyImages((prev) =>
        prev.map((img) => (img.id === id ? { ...img, dataUrl, name: file.name } : img))
      );
    } catch {
      setImageError("That image could not be processed. Please try a different file.");
    } finally {
      setProcessingImages(false);
    }
  }

  // Floor Plan handler: a single optional image, processed entirely
  // client-side exactly like a Property Image (resized/compressed and
  // orientation-corrected via processImageFile), so it always renders as
  // an actual image both on screen and in the printable report.
  // Uploading a new file always replaces whatever floor plan was there
  // before.
  async function handleFloorPlanFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setFloorPlanError("That file is not supported. Please choose a JPG, PNG, or WEBP image.");
      return;
    }
    setFloorPlanError("");
    setProcessingFloorPlan(true);
    try {
      const dataUrl = await processImageFile(file);
      setFloorPlan({ dataUrl, name: file.name });
    } catch {
      setFloorPlanError("That image could not be processed. Please try a different file.");
    } finally {
      setProcessingFloorPlan(false);
    }
  }

  function handleRemoveFloorPlan() {
    setFloorPlan(null);
    setFloorPlanError("");
  }

  // PadSplit Rental Data Screenshot handler: a single optional image,
  // processed exactly like the Floor Plan above. Supporting
  // documentation only -- never read or used in any calculation, and
  // uploading a new file always replaces whatever screenshot was there
  // before.
  async function handlePadSplitScreenshotFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setPadSplitScreenshotError("Please upload a PNG, JPG, JPEG, or WEBP image.");
      return;
    }
    setPadSplitScreenshotError("");
    setProcessingPadSplitScreenshot(true);
    try {
      const dataUrl = await processImageFile(file);
      setPadSplitScreenshot({ dataUrl, name: file.name });
    } catch {
      setPadSplitScreenshotError("That image could not be processed. Please try a different file.");
    } finally {
      setProcessingPadSplitScreenshot(false);
    }
  }

  function handleRemovePadSplitScreenshot() {
    setPadSplitScreenshot(null);
    setPadSplitScreenshotError("");
  }

  function resetToDefaults() {
    setPaymentType(PAYMENT_TYPE_DEFAULT);
    setFinancing(FINANCING_DEFAULTS);
    setFinancingDraft(makeDraft(FINANCING_DEFAULTS));
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
    setLoanRemainingAmortizationYears(30);
    setLoanRemainingAmortizationYearsDraft("30");
    setHybridExistingMortgageAmortizationYears(30);
    setHybridExistingMortgageAmortizationYearsDraft("30");
    setMaintenanceExpenses(MAINTENANCE_EXPENSE_DEFAULTS);
    setMaintenanceExpensesDraft(makeDraft(MAINTENANCE_EXPENSE_DEFAULTS));
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
    // Property Address, Property Images, Video Walkthrough Link, Floor
    // Plan, and Financing Structure are all cleared on reset, same as
    // every other field.
    setPropertyAddress("");
    setPropertyImages([]);
    setImageError("");
    setVideoWalkthroughLink("");
    setFloorPlan(null);
    setFloorPlanError("");
    setPadSplitScreenshot(null);
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
    // and both amortization schedules -- being derived entirely from
    // that state -- reset automatically along with it.
    setFinancingMode(FINANCING_MODE_DEFAULT);
    setAmortizationOpen(false);
    setAmortizationShowAll(false);
    setHybridAmortizationOpen(false);
    setHybridAmortizationShowAll(false);
    setStackBankAmortizationOpen(false);
    setStackBankAmortizationShowAll(false);
    setStackSellerAmortizationOpen(false);
    setStackSellerAmortizationShowAll(false);
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
    if (!subjectToBalloonExists) return null;
    const totalMonths = Math.max(1, Math.round(loanRemainingAmortizationYears * 12));
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
        amortizationCeilingYears: loanRemainingAmortizationYears,
        debtAtYear,
      }),
      mortgageBalanceAtBalloon,
    };
  }, [
    subjectToBalloonExists,
    subjectToBalloonYears,
    subjectToBalloonHas70LtvContingency,
    percent.subjectToBalloonAppreciationPct,
    financing.loanBalance,
    percent.loanInterestRatePct,
    loanRemainingAmortizationYears,
    financing.purchasePrice,
  ]);

  // Seller Financing Balloon Refinance Analysis: identical math to
  // Subject To above (the two modes share the same underlying
  // loan-balance/rate/amortization fields), computed completely
  // independently since each mode's balloon Yes/No, years, appreciation,
  // and 70% LTV contingency are all separate state.
  const sellerFinancingBalloonAnalysis = useMemo(() => {
    if (!sellerFinancingBalloonExists) return null;
    const totalMonths = Math.max(1, Math.round(loanRemainingAmortizationYears * 12));
    const balloonMonths = Math.max(0, Math.round(sellerFinancingBalloonYears * 12));
    const sellerFinanceBalanceAtBalloon = remainingBalanceAfterMonths(
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
        balloonYears: sellerFinancingBalloonYears,
        appreciationPct: percent.sellerFinancingBalloonAppreciationPct,
        has70LtvContingency: sellerFinancingBalloonHas70LtvContingency,
        purchasePrice: financing.purchasePrice,
        projectedDebtAtBalloon: sellerFinanceBalanceAtBalloon,
        amortizationCeilingYears: loanRemainingAmortizationYears,
        debtAtYear,
      }),
      sellerFinanceBalanceAtBalloon,
    };
  }, [
    sellerFinancingBalloonExists,
    sellerFinancingBalloonYears,
    sellerFinancingBalloonHas70LtvContingency,
    percent.sellerFinancingBalloonAppreciationPct,
    financing.loanBalance,
    percent.loanInterestRatePct,
    loanRemainingAmortizationYears,
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
    if (!hybridBalloonExists) return null;
    const mortgageTotalMonths = Math.max(1, Math.round(hybridExistingMortgageAmortizationYears * 12));
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
        amortizationCeilingYears: Math.max(
          hybridExistingMortgageAmortizationYears,
          TRADITIONAL_NUM_PAYMENTS / 12
        ),
        debtAtYear,
      }),
      mortgageBalanceAtBalloon,
      sellerFinanceBalanceAtBalloon,
    };
  }, [
    hybridBalloonExists,
    hybridBalloonYears,
    hybridBalloonHas70LtvContingency,
    percent.hybridBalloonAppreciationPct,
    financing.hybridExistingMortgageBalance,
    percent.hybridExistingMortgageRatePct,
    hybridExistingMortgageAmortizationYears,
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
      financingMode === "traditional" ? traditionalDownPaymentAmount : financing.sellerDownPayment;

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
    const stackAdjustedTotalCapitalRequired = Math.max(
      0,
      round2(stackBaseCapitalRequired + stackClosingCashAdjustment)
    );

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
              capital.arrears +
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
  ]);

  // Traditional Financing always labels its calculated loan payment
  // "Estimated Monthly Principal and Interest Payment" (never PITI,
  // since taxes and insurance are always shown and added separately, not
  // folded into the payment itself).
  const monthlyPaymentLabel =
    financingMode === "traditional"
      ? "Estimated Monthly Principal and Interest Payment"
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
      : financingMode === "hybrid" || financingMode === "stackMethod"
        ? "Total Monthly Housing Payment"
        : paymentType === "piti"
          ? "Monthly PITI Payment"
          : "Monthly Housing Payment";

  // Print-only label: the printable report shows "Total PITI" wherever
  // the on-page/CSV label would read "Total Monthly Housing Payment"
  // (Hybrid and Stack Method). Every other mode's label (e.g. "Estimated
  // Monthly PITI", "Monthly Housing Payment") is unchanged in print. This
  // is deliberately separate from housingPaymentLabel, which continues to
  // drive the on-page Monthly Expense Summary and the CSV/on-page Full
  // Underwriting Breakdown unchanged.
  const printHousingPaymentLabel =
    housingPaymentLabel === "Total Monthly Housing Payment" ? "Total PITI" : housingPaymentLabel;

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
              ]
            : [
                { label: downPaymentLabel, value: formatCents(results.downPaymentForCapital) },
                { label: "Arrears", value: formatCents(capital.arrears) },
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
            value: results.cashOnCashReturn === null ? "N/A" : formatPercent(results.cashOnCashReturn),
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
    ]
  );

  const inputsSection: BreakdownSection = useMemo(
    () => ({
      title: "Inputs",
      rows: [
        { label: "Property Address", value: propertyAddress.trim() || "Not entered" },
        { label: "Video Walkthrough Link", value: videoWalkthroughLink.trim() || "Not entered" },
        { label: "Property Photo Count", value: String(propertyImages.length) },
        {
          label: "PadSplit Rental Data Screenshot Uploaded",
          value: padSplitScreenshot ? "Yes" : "No",
        },
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
                    ? balloonAnalysisRows(stackBalloonAnalysis, [
                        { label: "First-Position Loan Balance at Balloon", value: stackBalloonAnalysis.bankBalanceAtBalloon },
                        { label: "Seller-Finance Balance at Balloon", value: stackBalloonAnalysis.sellerBalanceAtBalloon },
                      ])
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
      padSplitScreenshot,
      scopeOfWorkItems,
      scopeOfWorkTotal,
      useItemizedScopeOfWork,
    ]
  );

  const csvSections = [inputsSection, ...breakdownSections];


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
      capital.arrears +
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

  function downloadCsv() {
    const lines: string[] = ["Section,Field,Value"];
    for (const section of csvSections) {
      for (const row of section.rows) {
        const safeLabel = row.label.replace(/"/g, '""');
        lines.push(`"${section.title}","${safeLabel}","${row.value}"`);
      }
    }
    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "shared-housing-underwriting-summary.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Downloads the complete 360-payment Traditional Financing
  // amortization schedule as its own CSV, separate from the main
  // underwriting summary CSV above.
  function downloadAmortizationCsv() {
    const lines: string[] = [
      "Payment Number,Beginning Balance,Principal Paid,Interest Paid,Total Payment,Ending Balance",
    ];
    for (const row of traditionalAmortization.schedule) {
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
    a.download = "traditional-financing-amortization-schedule.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Downloads the complete 360-payment Hybrid seller-finance
  // amortization schedule as its own CSV. Covers only the
  // seller-financed balance, not the existing subject-to mortgage.
  function downloadHybridAmortizationCsv() {
    const lines: string[] = [
      "Payment Number,Beginning Balance,Principal Paid,Interest Paid,Total Payment,Ending Balance",
    ];
    for (const row of hybridAmortization.schedule) {
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
    a.download = "hybrid-seller-finance-amortization-schedule.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Downloads the Stack Method's first-position Bank Loan amortization
  // schedule as its own CSV, separate from the second-position Seller
  // Finance schedule below and from the main underwriting summary CSV.
  function downloadStackBankAmortizationCsv() {
    const lines: string[] = [
      "Payment Number,Beginning Balance,Principal Paid,Interest Paid,Principal and Interest Payment,Ending Balance",
    ];
    for (const row of stackBankAmortization.schedule) {
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
    a.download = "stack-method-bank-loan-amortization-schedule.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Downloads the Stack Method's second-position Seller Finance
  // amortization schedule as its own CSV. Covers only the seller-
  // financed balance, never the first-position bank loan.
  function downloadStackSellerAmortizationCsv() {
    const lines: string[] = [
      "Payment Number,Beginning Balance,Principal Paid,Interest Paid,Seller Finance Payment,Ending Balance",
    ];
    for (const row of stackSellerAmortization.schedule) {
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
    a.download = "stack-method-seller-finance-amortization-schedule.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

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

  return (
    <section className="bg-ink text-bone py-16 md:py-20 print:bg-white print:text-black print:py-0">
      <div className="mx-auto max-w-content px-6 md:px-10 print:max-w-none print:px-0">
        {/* Key results band: the four headline figures, always visible,
            always up to date, before any of the input sections. */}
        <div className="print:hidden grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
              {results.cashOnCashReturn === null ? "N/A" : formatPercent(results.cashOnCashReturn)}
            </p>
            {results.cashOnCashReturn === null && financingMode === "stackMethod" && (
              <p className="mt-2 text-xs text-bone/50 leading-relaxed">
                This structure models no net buyer capital contribution after the closing
                adjustment, so a traditional cash-on-cash percentage is not applicable.
              </p>
            )}
          </div>
          <div className="border border-brass bg-ink-2 p-6">
            <p className="eyebrow text-brass-light mb-1.5 inline-flex items-center">
              Total Capital Required
              <InfoTip text="Every cash cost paid at or around closing: down payment, holding costs, reserves, renovation, and the other upfront items below. Does not include the loan balance, equity, or purchase price." />
            </p>
            <p className="font-display text-3xl text-brass-light">
              {formatCents(results.totalCapitalRequired)}
            </p>
          </div>
        </div>

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
            onClick={downloadCsv}
            className="border border-line-dark px-4 py-2 eyebrow text-bone/70 hover:border-brass hover:text-bone transition-colors"
          >
            Download Underwriting as CSV
          </button>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Property Address                                            */}
        {/* ---------------------------------------------------------- */}
        <div className="print:hidden mt-10 bg-paper text-ink p-6 sm:p-8 md:p-10">
          <p className="eyebrow text-brass mb-5">Property Address</p>
          <div>
            <label htmlFor="propertyAddress" className="block mb-2">
              <FieldLabel>Property Address</FieldLabel>
            </label>
            <input
              id="propertyAddress"
              type="text"
              value={propertyAddress}
              onChange={(e) => setPropertyAddress(e.target.value)}
              placeholder="Enter the property address"
              className="w-full bg-white border border-line-dark px-3 py-2.5 text-ink outline-none focus:border-brass"
            />
            <p className="mt-1.5 text-xs text-ink/50 leading-relaxed">
              Optional. Appears near the top of the printable underwriting
              summary. Left blank, the address line is omitted from the
              report rather than shown empty.
            </p>
          </div>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Property Images                                             */}
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
            Upload property photos to include in the printable underwriting summary. Click to
            browse, or drag and drop up to 5 photos at once.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {propertyImages.map((img, index) => (
              <div key={img.id} className="relative border border-line-dark bg-white p-2">
                <img
                  src={img.dataUrl}
                  alt={img.name || "Property photo"}
                  className="w-full h-32 object-cover"
                />
                <div className="mt-2 flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleMoveImage(img.id, "left")}
                      disabled={index === 0}
                      aria-label="Move photo earlier"
                      title="Move earlier"
                      className="p-1 border border-line-dark text-ink/50 hover:text-brass hover:border-brass transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <ArrowLeft size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveImage(img.id, "right")}
                      disabled={index === propertyImages.length - 1}
                      aria-label="Move photo later"
                      title="Move later"
                      className="p-1 border border-line-dark text-ink/50 hover:text-brass hover:border-brass transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <ArrowRight size={12} />
                    </button>
                  </div>
                  <label className="text-xs text-brass underline decoration-brass/50 underline-offset-2 hover:text-brass-light transition-colors cursor-pointer">
                    Replace
                    <input
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        handleReplaceImage(img.id, e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(img.id)}
                    className="text-xs text-ink/50 hover:text-red-700 transition-colors"
                  >
                    Remove
                  </button>
                </div>
                {index === 0 && propertyImages.length > 1 && (
                  <p className="mt-1.5 text-[10px] uppercase tracking-wide text-brass/80">
                    Featured Photo
                  </p>
                )}
              </div>
            ))}

            {propertyImages.length < MAX_PROPERTY_PHOTOS && (
              <label
                htmlFor="propertyImagesInput"
                className={`flex flex-col items-center justify-center gap-2 border border-dashed h-full min-h-[128px] p-4 text-center cursor-pointer transition-colors ${
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
                      : "Add Photos"}
                </span>
                {!isDraggingPhotos && !processingImages && (
                  <span className="text-[10px] text-ink/40 sm:hidden">Tap to upload</span>
                )}
                {!isDraggingPhotos && !processingImages && (
                  <span className="hidden sm:block text-[10px] text-ink/40">
                    Or drag & drop up to {MAX_PROPERTY_PHOTOS} property photos
                  </span>
                )}
                <input
                  id="propertyImagesInput"
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp"
                  multiple
                  className="hidden"
                  disabled={processingImages}
                  onChange={(e) => {
                    handleAddImageFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>

          {imageError && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {imageError}
            </p>
          )}

          <p className="mt-4 text-xs text-ink/50 leading-relaxed">
            {propertyImages.length >= MAX_PROPERTY_PHOTOS
              ? `Maximum of ${MAX_PROPERTY_PHOTOS} property photos reached.`
              : `You can upload up to ${MAX_PROPERTY_PHOTOS} property photos. Click to browse or drag and drop. Supported formats: JPG, PNG, and WEBP.`}{" "}
            Images are used only to personalize the underwriting summary
            generated from this calculator.
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
        <div className="print:hidden mt-6 bg-paper text-ink p-6 sm:p-8 md:p-10">
          <p className="eyebrow text-brass mb-2">Floor Plan</p>
          <p className="text-sm text-ink/60 leading-relaxed mb-5">
            Upload a floor plan to include at the bottom of the printable underwriting summary.
          </p>

          {floorPlan ? (
            <div className="border border-line-dark bg-white p-3 max-w-sm">
              <div className="flex items-center justify-center bg-paper-2">
                <img
                  src={floorPlan.dataUrl}
                  alt={floorPlan.name || "Floor plan"}
                  className="w-full h-40 object-contain"
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <label className="text-xs text-brass underline decoration-brass/50 underline-offset-2 hover:text-brass-light transition-colors cursor-pointer">
                  Replace
                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      handleFloorPlanFile(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={handleRemoveFloorPlan}
                  className="text-xs text-ink/50 hover:text-red-700 transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <label
              htmlFor="floorPlanInput"
              className="flex flex-col items-center justify-center gap-2 border border-dashed border-line-dark bg-white/60 min-h-[128px] max-w-sm p-4 text-center cursor-pointer hover:border-brass transition-colors"
            >
              <Upload size={18} className="text-ink/40" aria-hidden="true" />
              <span className="text-xs text-ink/60">
                {processingFloorPlan ? "Processing..." : "Add Floor Plan"}
              </span>
              <input
                id="floorPlanInput"
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                className="hidden"
                disabled={processingFloorPlan}
                onChange={(e) => {
                  handleFloorPlanFile(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          )}

          {floorPlanError && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {floorPlanError}
            </p>
          )}

          <p className="mt-4 text-xs text-ink/50 leading-relaxed">
            Supported formats: JPG, PNG, and WEBP. One floor plan.
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
          {(financingMode === "sellerFinancing" || financingMode === "subjectTo" || financingMode === "") && (
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
                id="annualPropertyTaxes"
                label="Annual Property Taxes"
                draft={financingDraft.annualPropertyTaxes}
                onChange={(raw) => handleFinancingChange("annualPropertyTaxes", raw)}
                onBlur={() => handleFinancingBlur("annualPropertyTaxes")}
                disabled={paymentType === "piti"}
                helperText={
                  paymentType === "piti"
                    ? "Already included in the PITI payment above, not counted separately."
                    : "Added to the monthly housing payment."
                }
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

              {((financingMode === "subjectTo" && subjectToBalloonExists) ||
                (financingMode === "sellerFinancing" && sellerFinancingBalloonExists)) && (
                <>
                  <PercentField
                    id="loanInterestRatePct"
                    label={
                      financingMode === "subjectTo" ? "Existing Mortgage Interest Rate" : "Seller Financing Interest Rate"
                    }
                    draft={percentDraft.loanInterestRatePct}
                    onChange={(raw) => handlePercentChange("loanInterestRatePct", raw)}
                    onBlur={() => handlePercentBlur("loanInterestRatePct")}
                    info="Decimals are allowed. Used only for the Balloon Refinance Analysis's projected loan-balance calculation below, never for the monthly payment above."
                  />
                  <IntegerField
                    id="loanRemainingAmortizationYears"
                    label="Remaining Amortization (Years)"
                    draft={loanRemainingAmortizationYearsDraft}
                    onChange={(raw) => {
                      setLoanRemainingAmortizationYearsDraft(raw);
                      setLoanRemainingAmortizationYears(Math.max(1, parseTypedInt(raw)));
                    }}
                    onBlur={() =>
                      setLoanRemainingAmortizationYearsDraft(String(Math.max(1, loanRemainingAmortizationYears)))
                    }
                    info="How many years remain on this loan's amortization schedule, starting today. Used only for the Balloon Refinance Analysis below."
                  />
                </>
              )}
            </div>
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
                  id="annualPropertyTaxesTraditional"
                  label="Annual Property Taxes"
                  draft={financingDraft.annualPropertyTaxes}
                  onChange={(raw) => handleFinancingChange("annualPropertyTaxes", raw)}
                  onBlur={() => handleFinancingBlur("annualPropertyTaxes")}
                  helperText="Added to the monthly principal and interest payment below."
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
                  360-payment schedule. The first 12 payments are shown
                  by default; a visitor may expand to all 360, collapse
                  back, or download the complete schedule as a CSV. */}
              <div className="mt-8 pt-6 border-t border-line-dark">
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setAmortizationOpen((v) => !v)}
                    aria-expanded={amortizationOpen}
                    className="inline-flex items-center gap-2 border border-line-dark px-4 py-2 eyebrow text-ink/70 hover:border-brass hover:text-ink transition-colors"
                  >
                    {amortizationOpen ? "Hide" : "View"} Estimated Amortization Schedule
                  </button>
                  <button
                    type="button"
                    onClick={downloadAmortizationCsv}
                    className="inline-flex items-center gap-2 border border-line-dark px-4 py-2 eyebrow text-ink/70 hover:border-brass hover:text-ink transition-colors"
                  >
                    Download Amortization Schedule as CSV
                  </button>
                </div>

                {amortizationOpen && (
                  <div className="mt-5">
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
                          {(amortizationShowAll
                            ? traditionalAmortization.schedule
                            : traditionalAmortization.schedule.slice(0, 12)
                          ).map((row) => (
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
                    {traditionalAmortization.schedule.length > 12 && (
                      <button
                        type="button"
                        onClick={() => setAmortizationShowAll((v) => !v)}
                        className="mt-4 text-xs text-brass underline decoration-brass/50 underline-offset-2 hover:text-brass-light transition-colors"
                      >
                        {amortizationShowAll
                          ? "Show First 12 Payments"
                          : `View All ${traditionalAmortization.schedule.length} Payments`}
                      </button>
                    )}
                  </div>
                )}
              </div>
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
                  {hybridBalloonExists && (
                    <>
                      <PercentField
                        id="hybridExistingMortgageRatePct"
                        label="Existing Mortgage Interest Rate"
                        draft={percentDraft.hybridExistingMortgageRatePct}
                        onChange={(raw) => handlePercentChange("hybridExistingMortgageRatePct", raw)}
                        onBlur={() => handlePercentBlur("hybridExistingMortgageRatePct")}
                        info="Decimals are allowed. Used only for the Balloon Refinance Analysis's projected loan-balance calculation below, never for the monthly payment above."
                      />
                      <IntegerField
                        id="hybridExistingMortgageAmortizationYears"
                        label="Remaining Amortization (Years)"
                        draft={hybridExistingMortgageAmortizationYearsDraft}
                        onChange={(raw) => {
                          setHybridExistingMortgageAmortizationYearsDraft(raw);
                          setHybridExistingMortgageAmortizationYears(Math.max(1, parseTypedInt(raw)));
                        }}
                        onBlur={() =>
                          setHybridExistingMortgageAmortizationYearsDraft(
                            String(Math.max(1, hybridExistingMortgageAmortizationYears))
                          )
                        }
                        info="How many years remain on the existing mortgage's amortization schedule, starting today. Used only for the Balloon Refinance Analysis below."
                      />
                    </>
                  )}
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
                        label="Seller Finance Interest Rate"
                        draft={percentDraft.hybridSellerFinanceRatePct}
                        onChange={(raw) => handlePercentChange("hybridSellerFinanceRatePct", raw)}
                        onBlur={() => handlePercentBlur("hybridSellerFinanceRatePct")}
                        info="Allows decimals, e.g. 2.5%."
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

              {/* Seller Finance Amortization Schedule: covers only the
                  seller-financed balance, and only appears when monthly
                  seller-finance payments are required -- when they are
                  not required, the balance simply carries unamortized
                  to the balloon date, so there is no schedule to show. */}
              {hybridSellerFinancePaymentsRequired && (
                <div className="mt-8 pt-6 border-t border-line-dark">
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => setHybridAmortizationOpen((v) => !v)}
                      aria-expanded={hybridAmortizationOpen}
                      className="inline-flex items-center gap-2 border border-line-dark px-4 py-2 eyebrow text-ink/70 hover:border-brass hover:text-ink transition-colors"
                    >
                      {hybridAmortizationOpen ? "Hide" : "View"} Seller Finance Amortization Schedule
                    </button>
                    <button
                      type="button"
                      onClick={downloadHybridAmortizationCsv}
                      className="inline-flex items-center gap-2 border border-line-dark px-4 py-2 eyebrow text-ink/70 hover:border-brass hover:text-ink transition-colors"
                    >
                      Download Seller Finance Amortization Schedule as CSV
                    </button>
                  </div>

                  {hybridAmortizationOpen && (
                    <div className="mt-5">
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
                            {(hybridAmortizationShowAll
                              ? hybridAmortization.schedule
                              : hybridAmortization.schedule.slice(0, 12)
                            ).map((row) => (
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
                      {hybridAmortization.schedule.length > 12 && (
                        <button
                          type="button"
                          onClick={() => setHybridAmortizationShowAll((v) => !v)}
                          className="mt-4 text-xs text-brass underline decoration-brass/50 underline-offset-2 hover:text-brass-light transition-colors"
                        >
                          {hybridAmortizationShowAll
                            ? "Show First 12 Payments"
                            : `View All ${hybridAmortization.schedule.length} Payments`}
                        </button>
                      )}
                    </div>
                  )}
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
                    id="annualPropertyTaxesStack"
                    label="Annual Property Taxes"
                    draft={financingDraft.annualPropertyTaxes}
                    onChange={(raw) => handleFinancingChange("annualPropertyTaxes", raw)}
                    onBlur={() => handleFinancingBlur("annualPropertyTaxes")}
                  />
                  <CurrencyField
                    id="annualPropertyInsuranceStack"
                    label="Annual Property Insurance"
                    draft={financingDraft.annualPropertyInsurance}
                    onChange={(raw) => handleFinancingChange("annualPropertyInsurance", raw)}
                    onBlur={() => handleFinancingBlur("annualPropertyInsurance")}
                  />
                </div>
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
                <p className="mt-2 text-xs text-ink/40 leading-relaxed">
                  Never falls below $0, even if Base Capital Required is fully offset by the cash to
                  buyer.
                </p>
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
              />

              {/* Bank Loan Amortization Schedule */}
              <div className="mt-8 pt-6 border-t border-line-dark">
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setStackBankAmortizationOpen((v) => !v)}
                    aria-expanded={stackBankAmortizationOpen}
                    className="inline-flex items-center gap-2 border border-line-dark px-4 py-2 eyebrow text-ink/70 hover:border-brass hover:text-ink transition-colors"
                  >
                    {stackBankAmortizationOpen ? "Hide" : "View"} Bank Loan Amortization Schedule
                  </button>
                  <button
                    type="button"
                    onClick={downloadStackBankAmortizationCsv}
                    className="inline-flex items-center gap-2 border border-line-dark px-4 py-2 eyebrow text-ink/70 hover:border-brass hover:text-ink transition-colors"
                  >
                    Download Bank Loan Amortization Schedule as CSV
                  </button>
                </div>
                {stackBankAmortizationOpen && (
                  <div className="mt-5">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs sm:text-sm border-collapse">
                        <thead>
                          <tr className="border-b border-line-dark text-left text-ink/60">
                            <th className="py-2 pr-3 font-medium">Payment #</th>
                            <th className="py-2 pr-3 font-medium">Beginning Balance</th>
                            <th className="py-2 pr-3 font-medium">Principal</th>
                            <th className="py-2 pr-3 font-medium">Interest</th>
                            <th className="py-2 pr-3 font-medium">Principal and Interest Payment</th>
                            <th className="py-2 pr-3 font-medium">Ending Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(stackBankAmortizationShowAll
                            ? stackBankAmortization.schedule
                            : stackBankAmortization.schedule.slice(0, 12)
                          ).map((row) => (
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
                    {stackBankAmortization.schedule.length > 12 && (
                      <button
                        type="button"
                        onClick={() => setStackBankAmortizationShowAll((v) => !v)}
                        className="mt-4 text-xs text-brass underline decoration-brass/50 underline-offset-2 hover:text-brass-light transition-colors"
                      >
                        {stackBankAmortizationShowAll
                          ? "Show First 12 Payments"
                          : `View All ${stackBankAmortization.schedule.length} Payments`}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Seller Finance Amortization Schedule */}
              <div className="mt-8 pt-6 border-t border-line-dark">
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setStackSellerAmortizationOpen((v) => !v)}
                    aria-expanded={stackSellerAmortizationOpen}
                    className="inline-flex items-center gap-2 border border-line-dark px-4 py-2 eyebrow text-ink/70 hover:border-brass hover:text-ink transition-colors"
                  >
                    {stackSellerAmortizationOpen ? "Hide" : "View"} Seller Finance Amortization Schedule
                  </button>
                  <button
                    type="button"
                    onClick={downloadStackSellerAmortizationCsv}
                    className="inline-flex items-center gap-2 border border-line-dark px-4 py-2 eyebrow text-ink/70 hover:border-brass hover:text-ink transition-colors"
                  >
                    Download Seller Finance Amortization Schedule as CSV
                  </button>
                </div>
                {stackSellerAmortizationOpen && (
                  <div className="mt-5">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs sm:text-sm border-collapse">
                        <thead>
                          <tr className="border-b border-line-dark text-left text-ink/60">
                            <th className="py-2 pr-3 font-medium">Payment #</th>
                            <th className="py-2 pr-3 font-medium">Beginning Balance</th>
                            <th className="py-2 pr-3 font-medium">Principal</th>
                            <th className="py-2 pr-3 font-medium">Interest</th>
                            <th className="py-2 pr-3 font-medium">Seller Finance Payment</th>
                            <th className="py-2 pr-3 font-medium">Ending Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(stackSellerAmortizationShowAll
                            ? stackSellerAmortization.schedule
                            : stackSellerAmortization.schedule.slice(0, 12)
                          ).map((row) => (
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
                    {stackSellerAmortization.schedule.length > 12 && (
                      <button
                        type="button"
                        onClick={() => setStackSellerAmortizationShowAll((v) => !v)}
                        className="mt-4 text-xs text-brass underline decoration-brass/50 underline-offset-2 hover:text-brass-light transition-colors"
                      >
                        {stackSellerAmortizationShowAll
                          ? "Show First 12 Payments"
                          : `View All ${stackSellerAmortization.schedule.length} Payments`}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Co-Living Underwriting note: the existing shared-housing
                  underwriting fields and results immediately below this
                  section automatically use Total Monthly Housing Payment
                  as the housing expense -- no financing figures need to
                  be re-entered. */}
              {results.totalCapitalRequired === 0 && (
                <div className="mt-8 pt-6 border-t border-line-dark">
                  <p className="text-sm text-ink/60 leading-relaxed">
                    Cash-on-Cash Return: N/A. This structure models no net buyer capital contribution
                    after the closing adjustment, so a traditional cash-on-cash percentage is not
                    applicable.
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

          {/* PadSplit Rental Data Screenshot: a single optional
              supporting image, shared across every financing structure
              (not cleared by switching financing modes), processed
              exactly like the Floor Plan upload. Never read or used in
              any calculation -- documentation only. */}
          <div className="mt-8 pt-6 border-t border-line-dark">
            <p className="eyebrow text-brass mb-2">PadSplit Rental Data Screenshot</p>
            <p className="text-sm text-ink/60 leading-relaxed mb-5">
              Upload a screenshot of comparable PadSplit rental data or room-rate research.
            </p>

            {padSplitScreenshot ? (
              <div className="border border-line-dark bg-white p-3 max-w-sm">
                <div className="flex items-center justify-center bg-paper-2">
                  <img
                    src={padSplitScreenshot.dataUrl}
                    alt={padSplitScreenshot.name || "PadSplit rental data screenshot"}
                    className="w-full h-40 object-contain"
                  />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <label className="text-xs text-brass underline decoration-brass/50 underline-offset-2 hover:text-brass-light transition-colors cursor-pointer">
                    Replace
                    <input
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        handlePadSplitScreenshotFile(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleRemovePadSplitScreenshot}
                    className="text-xs text-ink/50 hover:text-red-700 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <label
                htmlFor="padSplitScreenshotInput"
                className="flex flex-col items-center justify-center gap-2 border border-dashed border-line-dark bg-white/60 min-h-[128px] max-w-sm p-4 text-center cursor-pointer hover:border-brass transition-colors"
              >
                <Upload size={18} className="text-ink/40" aria-hidden="true" />
                <span className="text-xs text-ink/60">
                  {processingPadSplitScreenshot ? "Processing..." : "Add Screenshot"}
                </span>
                <input
                  id="padSplitScreenshotInput"
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp"
                  className="hidden"
                  disabled={processingPadSplitScreenshot}
                  onChange={(e) => {
                    handlePadSplitScreenshotFile(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            )}

            {padSplitScreenshotError && (
              <p role="alert" className="mt-4 text-sm text-red-700">
                {padSplitScreenshotError}
              </p>
            )}

            <p className="mt-4 text-xs text-ink/50 leading-relaxed">
              Supported formats: PNG, JPG, JPEG, and WEBP. One screenshot. Supporting
              documentation only -- room rates are never automatically read or calculated from
              this image. Appears in the printable underwriting summary near the Rental Income
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
            {financingMode !== "stackMethod" && (
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
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Section 5: Returns (repeated here at full width, in context
            with everything that feeds them)                          */}
        {/* ---------------------------------------------------------- */}
        <div className="print:hidden mt-6 bg-ink-2 border border-line p-6 sm:p-8 md:p-10">
          <p className="eyebrow text-brass-light mb-5">Returns</p>
          <div className="grid sm:grid-cols-3 gap-6">
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
                {results.cashOnCashReturn === null ? "N/A" : formatPercent(results.cashOnCashReturn)}
              </p>
            </div>
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
              either was provided. Omitted entirely when neither exists. */}
          {(propertyImages.length > 0 || videoWalkthroughLink.trim() !== "") && (
            <div className="mb-3 print:break-inside-avoid-page grid grid-cols-3 gap-3">
              {propertyImages.length > 0 && (
                <div className={videoWalkthroughLink.trim() !== "" ? "col-span-2" : "col-span-3"}>
                  <div className="rounded-xl overflow-hidden border border-ink/15 h-[2.2in]">
                    <img
                      src={propertyImages[0].dataUrl}
                      alt={propertyImages[0].name || "Featured property photo"}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {propertyImages.length > 1 && (
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {propertyImages.slice(1, MAX_PROPERTY_PHOTOS).map((img) => (
                        <div
                          key={img.id}
                          className="rounded-lg overflow-hidden border border-ink/15 h-[0.75in]"
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
                    propertyImages.length > 0 ? "col-span-1" : "col-span-3"
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
              label="Total Capital Required"
              value={formatCents(results.totalCapitalRequired)}
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
              value={results.cashOnCashReturn === null ? "N/A" : formatPercent(results.cashOnCashReturn)}
              highlight
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
                  results.cashOnCashReturn === null ? "N/A" : formatPercent(results.cashOnCashReturn)
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
                    <div className="flex justify-between">
                      <span className="text-ink/60">Annual Property Taxes</span>
                      <span className="font-medium text-ink">
                        {formatCents(financing.annualPropertyTaxes)}
                      </span>
                    </div>
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
                    <div className="flex justify-between pt-1.5 border-t border-ink/10">
                      <span className="font-semibold text-ink">Total PITI</span>
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
                          <span className="text-ink/60">Annual Property Taxes</span>
                          <span className="font-medium text-ink">
                            {formatCents(financing.annualPropertyTaxes)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink/60">Annual Property Insurance</span>
                          <span className="font-medium text-ink">
                            {formatCents(financing.annualPropertyInsurance)}
                          </span>
                        </div>
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

          {financingMode === "traditional" && traditionalLongTermRent !== null && (
            <TraditionalLtvPrintCard
              longTermRent={traditionalLongTermRent}
              piti={results.monthlyHousingPayment}
              selectedLtvPct={traditionalSelectedLtvPct}
              requiredDownPaymentPct={traditionalEffectiveDownPaymentPct}
              meetsRentTest={traditionalLongTermRent >= traditionalPITIAt80}
            />
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
                  <span className="text-ink/60 min-w-0">Annual Property Taxes</span>
                  <span className="text-ink flex-shrink-0 text-right">{formatCents(financing.annualPropertyTaxes)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink/60 min-w-0">Annual Property Insurance</span>
                  <span className="text-ink flex-shrink-0 text-right">{formatCents(financing.annualPropertyInsurance)}</span>
                </div>
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
              <div className="mt-2 flex justify-between items-center rounded-lg bg-ink text-white px-3 py-2.5">
                <span className="text-[9.5pt] font-semibold uppercase tracking-wide">
                  Total PITI
                </span>
                <span className="text-[13pt] font-bold">{formatCents(results.monthlyHousingPayment)}</span>
              </div>
            </div>
          )}

          {financingMode === "stackMethod" && stackBalloonAnalysis && (
            <BalloonRefinancePrintCard
              analysis={stackBalloonAnalysis}
              loanBalanceRows={[
                { label: "First-Position Loan Balance at Balloon", value: stackBalloonAnalysis.bankBalanceAtBalloon },
                { label: "Seller-Finance Balance at Balloon", value: stackBalloonAnalysis.sellerBalanceAtBalloon },
              ]}
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

          {/* PadSplit Rental Data screenshot: supporting documentation
              only, rendered only when one was actually uploaded so no
              blank or near-blank section is ever created. object-contain
              preserves the screenshot's original aspect ratio without
              cropping or stretching. */}
          {padSplitScreenshot && (
            <div className="mb-3 print:break-inside-avoid-page rounded-xl border border-ink/15 bg-white p-2.5">
              <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-brass/40">
                <DollarSign size={14} className="text-brass" />
                <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink">
                  PadSplit Rental Data
                </p>
              </div>
              <div className="flex justify-center bg-paper-2 rounded-lg border border-ink/15 p-2">
                <img
                  src={padSplitScreenshot.dataUrl}
                  alt={padSplitScreenshot.name || "PadSplit rental data screenshot"}
                  className="w-full h-auto max-h-[3.4in] object-contain"
                />
              </div>
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
              {financingMode !== "stackMethod" && (
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
                  {results.cashOnCashReturn === null ? "N/A" : formatPercent(results.cashOnCashReturn)}
                </p>
              </div>
            </div>
          </div>

          {/* Floor Plan, only if one was uploaded, on its own page. Shown
              as an actual image (never a filename or file link), centered,
              using object-contain so the plan's full aspect ratio is
              preserved and nothing is cropped or stretched.
              print:break-before-page starts it on a fresh page every
              time, and print:break-inside-avoid-page keeps it from
              splitting if it is taller than a single page. No top padding
              and a tight ~24px heading-to-image gap keep the image
              directly beneath the heading instead of drifting toward the
              bottom of the page; the image's own max-height is kept
              comfortably under a full page's usable height (after the
              heading and this container's padding) so the whole block
              reliably fits on one page rather than being bumped, nearly
              in its entirety, onto the next one. */}
          {floorPlan && (
            <div className="print:break-before-page print:break-inside-avoid-page">
              <p className="text-[16pt] font-display font-bold text-ink mb-6 pb-2 border-b-4 border-brass">
                Floor Plan
              </p>
              <div className="flex justify-center bg-paper-2 rounded-xl border border-ink/15 p-4">
                <img
                  src={floorPlan.dataUrl}
                  alt={floorPlan.name || "Floor plan"}
                  className="w-full h-auto max-h-[8.2in] object-contain"
                />
              </div>
            </div>
          )}

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
