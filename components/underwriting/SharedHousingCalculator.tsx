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
} from "lucide-react";

// ---------------------------------------------------------------------
// Fixed, non-editable amounts. Platform fees, cleaning, lawn care, pest
// control, and the closing cost percentage used to be here too, but are
// now editable defaults tracked in component state instead (see
// PERCENT_DEFAULTS and MAINTENANCE_EXPENSE_DEFAULTS below).
// ---------------------------------------------------------------------
const MAINTENANCE_ANNUAL = 4800;
const UTILITIES_PER_BEDROOM = 80;
const RESERVES_AMOUNT = 10000;
const HOLDING_MONTHS = 3;

// Property Images: processed and stored entirely client-side (never
// uploaded anywhere) as compressed, orientation-corrected data URLs so
// they can be previewed on screen and embedded directly in the
// printable report.
const MAX_PROPERTY_IMAGES = 6;
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
    default:
      return "Not Specified";
  }
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
// headline, and a short supporting detail line.
function HighlightBullet({
  icon,
  label,
  detail,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  accent?: "brass" | "green";
}) {
  const badgeClass = accent === "brass" ? "bg-brass" : "bg-ink";
  const badgeStyle = accent === "green" ? { backgroundColor: "#1E8E3E" } : undefined;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-ink/10 last:border-b-0">
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
        <p className="text-[8.5pt] text-ink/60 leading-snug">{detail}</p>
      </div>
    </div>
  );
}

// A simple SVG bar chart (Income vs. Expenses) generated directly from
// the calculator's own computed figures. Pure SVG, no charting library,
// so it renders crisply and reliably in print/PDF output.
function IncomeExpenseChart({
  effectiveRent,
  operatingExpenses,
  cashFlow,
}: {
  effectiveRent: number;
  operatingExpenses: number;
  cashFlow: number;
}) {
  const bars = [
    { label: "Effective Rent", value: Math.max(0, effectiveRent), color: "#12181C" },
    { label: "Operating Expenses", value: Math.max(0, operatingExpenses), color: "#C08A3E" },
    { label: "Cash Flow", value: Math.max(0, cashFlow), color: "#1E8E3E" },
  ];
  const max = Math.max(1, ...bars.map((b) => b.value));
  const chartHeight = 130;
  const barWidth = 54;
  const gap = 34;
  const width = bars.length * barWidth + (bars.length + 1) * gap;
  const totalHeight = chartHeight + 46;
  return (
    <svg viewBox={`0 0 ${width} ${totalHeight}`} className="w-full h-auto" role="img" aria-label="Income versus expenses chart">
      {bars.map((b, i) => {
        const h = (b.value / max) * chartHeight;
        const x = gap + i * (barWidth + gap);
        const y = 20 + (chartHeight - h);
        return (
          <g key={b.label}>
            <text x={x + barWidth / 2} y={14} textAnchor="middle" fontSize="10" fontWeight="700" fill="#12181C">
              {formatCents(b.value)}
            </text>
            <rect x={x} y={y} width={barWidth} height={h} rx="5" fill={b.color} />
            <text x={x + barWidth / 2} y={chartHeight + 38} textAnchor="middle" fontSize="8" fill="#12181C" opacity="0.6">
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// A pure-SVG donut chart for Capital Allocation, built with the classic
// stroke-dasharray technique (no charting library). `segments` should
// already sum to the exact Total Capital Required figure; this
// component only visualizes the same numbers, it never recalculates
// them.
function CapitalAllocationDonut({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offsetAccum = 0;
  return (
    <div className="relative w-[140px] h-[140px] flex-shrink-0">
      <svg viewBox="0 0 140 140" className="w-full h-full" role="img" aria-label="Capital allocation donut chart">
        <g transform="translate(70,70) rotate(-90)">
          <circle r={radius} fill="none" stroke="#EAE3D3" strokeWidth="20" />
          {total > 0 &&
            segments.map((s) => {
              const fraction = s.value / total;
              const dash = fraction * circumference;
              const seg = (
                <circle
                  key={s.label}
                  r={radius}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="20"
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offsetAccum}
                />
              );
              offsetAccum += dash;
              return seg;
            })}
        </g>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-10 w-10 rounded-full bg-paper flex items-center justify-center border border-ink/10">
          <Home size={16} className="text-brass" />
        </div>
      </div>
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
  | "hybridSubjectToPITI";

const FINANCING_DEFAULTS: Record<FinancingKey, number> = {
  purchasePrice: 0,
  loanBalance: 0,
  sellerDownPayment: 0,
  monthlyPayment: 0,
  annualPropertyTaxes: 0,
  annualPropertyInsurance: 0,
  hybridExistingMortgageBalance: 0,
  hybridSubjectToPITI: 0,
};

type CapitalKey =
  | "arrears"
  | "renovationCost"
  | "furniture"
  | "appliances"
  | "photos"
  | "upfrontInsurance"
  | "acquisitionFee"
  | "tcAndLlc"
  | "agentFee"
  | "assignmentFee";

const CAPITAL_DEFAULTS: Record<CapitalKey, number> = {
  arrears: 0,
  renovationCost: 0,
  furniture: 13000,
  appliances: 3000,
  photos: 300,
  upfrontInsurance: 3000,
  acquisitionFee: 10000,
  tcAndLlc: 2000,
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
  | "hybridSellerFinanceRatePct";

const PERCENT_DEFAULTS: Record<PercentKey, number> = {
  vacancyPct: 10,
  propertyManagementPct: 8,
  platformFeePct: 15,
  closingCostPct: 1.5,
  traditionalDownPaymentPct: 20,
  traditionalInterestRatePct: 7,
  traditionalClosingCostPct: 5,
  hybridSellerFinanceRatePct: 2,
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
type FinancingMode = "" | "traditional" | "subjectTo" | "sellerFinancing" | "hybrid";
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

  const [percent, setPercent] = useState<Record<PercentKey, number>>(PERCENT_DEFAULTS);
  const [percentDraft, setPercentDraft] = useState<Record<PercentKey, string>>({
    vacancyPct: PERCENT_DEFAULTS.vacancyPct.toFixed(2),
    propertyManagementPct: PERCENT_DEFAULTS.propertyManagementPct.toFixed(2),
    platformFeePct: PERCENT_DEFAULTS.platformFeePct.toFixed(2),
    closingCostPct: PERCENT_DEFAULTS.closingCostPct.toFixed(2),
    traditionalDownPaymentPct: PERCENT_DEFAULTS.traditionalDownPaymentPct.toFixed(2),
    traditionalInterestRatePct: PERCENT_DEFAULTS.traditionalInterestRatePct.toFixed(2),
    traditionalClosingCostPct: PERCENT_DEFAULTS.traditionalClosingCostPct.toFixed(2),
    hybridSellerFinanceRatePct: PERCENT_DEFAULTS.hybridSellerFinanceRatePct.toFixed(2),
  });

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
  const [videoWalkthroughLink, setVideoWalkthroughLink] = useState("");
  const [floorPlan, setFloorPlan] = useState<FloorPlanFile | null>(null);
  const [floorPlanError, setFloorPlanError] = useState("");
  const [processingFloorPlan, setProcessingFloorPlan] = useState(false);
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

  // Property Images handlers: adding, removing, and replacing all run
  // entirely client-side (see processImageFile above). Unsupported file
  // types are rejected with a clear error message instead of breaking
  // the calculator, and selection is capped at MAX_PROPERTY_IMAGES.
  async function handleAddImageFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setImageError("");

    const valid = files.filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type));
    const invalid = files.filter((f) => !ACCEPTED_IMAGE_TYPES.includes(f.type));

    if (invalid.length > 0) {
      setImageError("Some files were not added. Only JPG, PNG, and WEBP images are supported.");
    }
    if (valid.length === 0) return;

    const remainingSlots = MAX_PROPERTY_IMAGES - propertyImages.length;
    if (remainingSlots <= 0) {
      setImageError(
        `Up to ${MAX_PROPERTY_IMAGES} images are supported. Remove an image before adding another.`
      );
      return;
    }

    const toProcess = valid.slice(0, remainingSlots);
    if (valid.length > toProcess.length) {
      setImageError(
        `Up to ${MAX_PROPERTY_IMAGES} images are supported. Only the first ${toProcess.length} of the selected images were added.`
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

  async function handleReplaceImage(id: string, fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setImageError("That file is not a supported image type. Please choose a JPG, PNG, or WEBP image.");
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

  function resetToDefaults() {
    setPaymentType(PAYMENT_TYPE_DEFAULT);
    setFinancing(FINANCING_DEFAULTS);
    setFinancingDraft(makeDraft(FINANCING_DEFAULTS));
    setCapital(CAPITAL_DEFAULTS);
    setCapitalDraft(makeDraft(CAPITAL_DEFAULTS));
    setPercent(PERCENT_DEFAULTS);
    setPercentDraft({
      vacancyPct: PERCENT_DEFAULTS.vacancyPct.toFixed(2),
      propertyManagementPct: PERCENT_DEFAULTS.propertyManagementPct.toFixed(2),
      platformFeePct: PERCENT_DEFAULTS.platformFeePct.toFixed(2),
      closingCostPct: PERCENT_DEFAULTS.closingCostPct.toFixed(2),
      traditionalDownPaymentPct: PERCENT_DEFAULTS.traditionalDownPaymentPct.toFixed(2),
      traditionalInterestRatePct: PERCENT_DEFAULTS.traditionalInterestRatePct.toFixed(2),
      traditionalClosingCostPct: PERCENT_DEFAULTS.traditionalClosingCostPct.toFixed(2),
      hybridSellerFinanceRatePct: PERCENT_DEFAULTS.hybridSellerFinanceRatePct.toFixed(2),
    });
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

  // Down Payment is entered as a percentage of the Purchase Price
  // (Down Payment Percentage), not a dollar amount. Estimated Down
  // Payment = Purchase Price x Down Payment Percentage.
  const traditionalDownPaymentAmount = useMemo(
    () => round2(financing.purchasePrice * (percent.traditionalDownPaymentPct / 100)),
    [financing.purchasePrice, percent.traditionalDownPaymentPct]
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

  // Estimated Equity = Purchase Price - Existing Mortgage Balance (the
  // total equity in the property, independent of how the remainder --
  // the Seller-Financed Balance below -- is financed).
  const hybridEquityRaw = useMemo(
    () => financing.purchasePrice - financing.hybridExistingMortgageBalance,
    [financing.purchasePrice, financing.hybridExistingMortgageBalance]
  );
  const hybridEquity = Math.max(0, round2(hybridEquityRaw));

  // Seller-Financed Balance = Purchase Price - Existing Mortgage Balance
  // - Seller Down Payment, never allowed below $0.
  const hybridSellerFinancedBalance = useMemo(
    () =>
      Math.max(
        0,
        round2(financing.purchasePrice - financing.hybridExistingMortgageBalance - financing.sellerDownPayment)
      ),
    [financing.purchasePrice, financing.hybridExistingMortgageBalance, financing.sellerDownPayment]
  );

  // Estimated Monthly Seller Finance Payment: a true fixed-rate, fully
  // amortizing 30-year (360-payment) loan on the Seller-Financed
  // Balance, at the entered Seller Finance Interest Rate.
  const hybridMonthlySellerFinancePayment = useMemo(
    () =>
      round2(
        calculateMonthlyPrincipalAndInterest(hybridSellerFinancedBalance, percent.hybridSellerFinanceRatePct)
      ),
    [hybridSellerFinancedBalance, percent.hybridSellerFinanceRatePct]
  );

  // The full month-by-month amortization schedule for the seller-financed
  // balance only. The existing subject-to mortgage is deliberately never
  // part of this schedule, since its original loan terms may differ.
  const hybridAmortization = useMemo(
    () => buildAmortizationSchedule(hybridSellerFinancedBalance, percent.hybridSellerFinanceRatePct),
    [hybridSellerFinancedBalance, percent.hybridSellerFinanceRatePct]
  );

  // Total Monthly Housing Payment = Monthly Subject-To PITI Payment +
  // Estimated Monthly Seller Finance Payment. The entered Subject-To
  // payment is already a complete PITI figure for the existing mortgage,
  // so taxes and insurance are never added again on top of it.
  const hybridTotalMonthlyHousingPayment = useMemo(
    () => round2(financing.hybridSubjectToPITI + hybridMonthlySellerFinancePayment),
    [financing.hybridSubjectToPITI, hybridMonthlySellerFinancePayment]
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
    // Balance (the total equity in the property, independent of how the
    // remainder is seller-financed). For Seller Financing / Subject To,
    // the existing calculation is preserved: Purchase Price - Loan
    // Balance. The Seller Down Payment (or, for Traditional Financing,
    // the Estimated Down Payment) is a separate cash requirement (used
    // in Total Capital Required) and is not subtracted here, and is
    // never added to Total Capital Required a second time as part of
    // equity.
    const equityRaw =
      financingMode === "traditional"
        ? financing.purchasePrice - traditionalLoanBalance
        : financingMode === "hybrid"
          ? hybridEquityRaw
          : financing.purchasePrice - financing.loanBalance;
    const equity = Math.max(0, round2(equityRaw));
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
        : round2(financing.purchasePrice * (percent.closingCostPct / 100));

    // The acquisition down payment included in Total Capital Required:
    // the calculated Estimated Down Payment (Purchase Price x Down
    // Payment Percentage) when Traditional Financing is selected,
    // otherwise the existing Seller Down Payment (reused as-is for
    // Hybrid, so it is included exactly once). Only one of the two is
    // ever included, never both.
    const downPaymentForCapital =
      financingMode === "traditional" ? traditionalDownPaymentAmount : financing.sellerDownPayment;

    const totalCapitalRequired = round2(
      downPaymentForCapital +
        capital.arrears +
        capital.renovationCost +
        capital.furniture +
        capital.appliances +
        capital.photos +
        holdingCosts +
        RESERVES_AMOUNT +
        capital.upfrontInsurance +
        capital.acquisitionFee +
        capital.tcAndLlc +
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
      : financingMode === "hybrid"
        ? "Total Monthly Housing Payment"
        : paymentType === "piti"
          ? "Monthly PITI Payment"
          : "Monthly Housing Payment";

  // Financing Structure is a single-select mode (see getFinancingStructureLabel
  // above), computed once here so the breakdown, CSV, and print report
  // all read the same label.
  const financingStructureLabel = getFinancingStructureLabel(financingMode);

  // The down payment label shown alongside downPaymentForCapital
  // (results.downPaymentForCapital): "Estimated Down Payment" for
  // Traditional Financing (the calculated Purchase Price x Down Payment
  // Percentage amount), or "Seller Down Payment" otherwise, matching
  // whichever field is actually in use.
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
                { label: "Down Payment Percentage", value: formatPercent(percent.traditionalDownPaymentPct) },
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
                    label: "Seller-Financed Balance",
                    value: formatCents(hybridSellerFinancedBalance),
                  },
                  {
                    label: "Monthly Subject-To PITI Payment",
                    value: formatCents(financing.hybridSubjectToPITI),
                  },
                  {
                    label: "Seller Finance Interest Rate",
                    value: formatPercent(percent.hybridSellerFinanceRatePct),
                  },
                  { label: "Seller Finance Amortization Term", value: "30 Years (360 Monthly Payments)" },
                  {
                    label: "Estimated Monthly Seller Finance Payment",
                    value: formatCents(hybridMonthlySellerFinancePayment),
                  },
                  { label: "Total Monthly Housing Payment", value: formatCents(results.monthlyHousingPayment) },
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
        rows: [
          { label: downPaymentLabel, value: formatCents(results.downPaymentForCapital) },
          { label: "Arrears", value: formatCents(capital.arrears) },
          { label: "Renovation Cost", value: formatCents(capital.renovationCost) },
          { label: "Furniture", value: formatCents(capital.furniture) },
          { label: "Appliances", value: formatCents(capital.appliances) },
          { label: "Photos", value: formatCents(capital.photos) },
          { label: "Holding Costs", value: formatCents(results.holdingCosts) },
          { label: "Reserves", value: formatCents(RESERVES_AMOUNT) },
          { label: "Upfront Insurance", value: formatCents(capital.upfrontInsurance) },
          { label: "Acquisition Fee", value: formatCents(capital.acquisitionFee) },
          { label: "TC and LLC", value: formatCents(capital.tcAndLlc) },
          ...(financingMode === "traditional"
            ? [
                {
                  label: "Traditional Closing Cost Percentage",
                  value: formatPercent(percent.traditionalClosingCostPct),
                },
                { label: "Traditional Financing Closing Costs", value: formatCents(results.closingCosts) },
              ]
            : [
                { label: "Estimated Closing Cost Percentage", value: formatPercent(percent.closingCostPct) },
                { label: "Closing Costs", value: formatCents(results.closingCosts) },
              ]),
          { label: "Agent Fee", value: formatCents(capital.agentFee) },
          { label: "Assignment Fee", value: formatCents(capital.assignmentFee) },
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
      hybridSellerFinancedBalance,
      hybridMonthlySellerFinancePayment,
    ]
  );

  const inputsSection: BreakdownSection = useMemo(
    () => ({
      title: "Inputs",
      rows: [
        { label: "Property Address", value: propertyAddress.trim() || "Not entered" },
        { label: "Video Walkthrough Link", value: videoWalkthroughLink.trim() || "Not entered" },
        { label: "Purchase Price", value: formatWhole(financing.purchasePrice) },
        ...(financingMode === "traditional"
          ? [
              { label: "Down Payment Percentage", value: formatPercent(percent.traditionalDownPaymentPct) },
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
            ]
          : financingMode === "hybrid"
            ? [
                {
                  label: "Existing Mortgage Balance",
                  value: formatWhole(financing.hybridExistingMortgageBalance),
                },
                { label: "Seller Down Payment", value: formatWhole(financing.sellerDownPayment) },
                { label: "Estimated Equity", value: formatWhole(results.equity) },
                { label: "Seller-Financed Balance", value: formatWhole(hybridSellerFinancedBalance) },
                {
                  label: "Monthly Subject-To PITI Payment",
                  value: formatCents(financing.hybridSubjectToPITI),
                },
                {
                  label: "Seller Finance Interest Rate",
                  value: formatPercent(percent.hybridSellerFinanceRatePct),
                },
                { label: "Seller Finance Amortization Term", value: "30 Years (360 Monthly Payments)" },
                {
                  label: "Estimated Monthly Seller Finance Payment",
                  value: formatCents(hybridMonthlySellerFinancePayment),
                },
                { label: "Estimated Closing Cost Percentage", value: formatPercent(percent.closingCostPct) },
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
      hybridSellerFinancedBalance,
      hybridMonthlySellerFinancePayment,
    ]
  );

  const csvSections = [inputsSection, ...breakdownSections];


  // Capital Allocation donut chart data for the printable report: the
  // same figures that make up Total Capital Required (see the
  // totalCapitalRequired calculation above), grouped into six visual
  // categories rather than fourteen individual line items. "Other
  // Costs" is the sum of every remaining capital line item, so the six
  // values here always add up to exactly results.totalCapitalRequired.
  // Zero-value categories are omitted so the chart and legend only show
  // what is actually part of this deal's capital stack.
  const capitalAllocationSegments = useMemo(() => {
    const otherCosts = round2(
      capital.arrears +
        capital.furniture +
        capital.appliances +
        capital.photos +
        results.holdingCosts +
        capital.tcAndLlc +
        results.closingCosts +
        capital.agentFee +
        capital.assignmentFee
    );
    return [
      { label: downPaymentLabel, value: results.downPaymentForCapital, color: "#12181C" },
      { label: "Acquisition Fee", value: capital.acquisitionFee, color: "#C08A3E" },
      { label: "Renovation", value: capital.renovationCost, color: "#4E9C6C" },
      { label: "Reserves", value: RESERVES_AMOUNT, color: "#7C9070" },
      { label: "Upfront Insurance", value: capital.upfrontInsurance, color: "#8B9795" },
      { label: "Other Costs", value: otherCosts, color: "#C9BFA6" },
    ].filter((segment) => segment.value > 0);
  }, [downPaymentLabel, results.downPaymentForCapital, capital, results.holdingCosts, results.closingCosts]);

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

  function printSummary() {
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
        <div className="print:hidden mt-6 bg-paper text-ink p-6 sm:p-8 md:p-10">
          <p className="eyebrow text-brass mb-2">Property Images</p>
          <p className="text-sm text-ink/60 leading-relaxed mb-5">
            Upload property photos to include in the printable underwriting summary.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {propertyImages.map((img) => (
              <div key={img.id} className="relative border border-line-dark bg-white p-2">
                <img
                  src={img.dataUrl}
                  alt={img.name || "Property photo"}
                  className="w-full h-32 object-cover"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
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
              </div>
            ))}

            {propertyImages.length < MAX_PROPERTY_IMAGES && (
              <label
                htmlFor="propertyImagesInput"
                className="flex flex-col items-center justify-center gap-2 border border-dashed border-line-dark bg-white/60 h-full min-h-[128px] p-4 text-center cursor-pointer hover:border-brass transition-colors"
              >
                <Upload size={18} className="text-ink/40" aria-hidden="true" />
                <span className="text-xs text-ink/60">
                  {processingImages ? "Processing..." : "Add Photos"}
                </span>
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
            Up to {MAX_PROPERTY_IMAGES} images. Supported formats: JPG, PNG,
            and WEBP. Images are used only to personalize the underwriting
            summary generated from this calculator.
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

          {/* Financing Structure: a single-select choice among four
              mutually exclusive options. Subject To and Seller Financing
              can no longer be selected together independently -- a deal
              that combines both uses the dedicated Subject To & Seller
              Finance Hybrid option instead, which has its own inputs and
              calculations (see below). Selecting any option deselects
              whichever one was previously active. */}
          <div>
            <p className="eyebrow text-brass mb-3">Financing Structure</p>
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2"
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
              Financing and Hybrid it lives here, at the top of this
              section. When Traditional Financing or Hybrid is selected
              it moves into that structure's dedicated section below
              instead -- it is still the exact same field either way. */}
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
            </div>
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
                <PercentField
                  id="traditionalDownPaymentPct"
                  label="Down Payment Percentage"
                  draft={percentDraft.traditionalDownPaymentPct}
                  onChange={(raw) => handlePercentChange("traditionalDownPaymentPct", raw)}
                  onBlur={() => handlePercentBlur("traditionalDownPaymentPct")}
                  info="Allows decimals, e.g. 15.5%. Applied to the purchase price to calculate the down payment."
                />
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

              {financing.hybridExistingMortgageBalance + financing.sellerDownPayment >
                financing.purchasePrice && (
                <p className="mt-4 text-sm text-red-700">
                  The existing mortgage balance plus the seller down payment exceeds the purchase
                  price. The seller-financed balance is floored at $0.
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
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-line-dark">
                <p className="eyebrow text-ink/50 mb-3">Seller Financing</p>
                <div className="grid sm:grid-cols-2 gap-5">
                  <ReadOnlyStat
                    label="Seller-Financed Balance"
                    value={formatWhole(hybridSellerFinancedBalance)}
                    helperText="Purchase Price minus Existing Mortgage Balance minus Seller Down Payment. Never falls below $0."
                  />
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
              </div>

              <div className="mt-8 pt-6 border-t border-line-dark">
                <div className="border border-brass bg-paper-2 p-6">
                  <p className="eyebrow text-brass mb-1.5">Estimated Monthly Seller Finance Payment</p>
                  <p className="font-display text-3xl">{formatCents(hybridMonthlySellerFinancePayment)}</p>
                </div>
              </div>

              {/* Total Monthly Housing Payment: the Subject-To PITI
                  payment plus the seller finance payment, combined into
                  a single, visually prominent figure. This is the
                  housing expense used everywhere else in this
                  calculator -- monthly operating expenses, cash flow,
                  holding costs, cash-on-cash return, the full breakdown,
                  the printed report, and the CSV export. */}
              <div className="mt-6 rounded border border-line-dark bg-white p-6">
                <p className="eyebrow text-brass mb-4">Total Monthly Housing Payment</p>
                <div className="divide-y divide-line-dark border-t border-b border-line-dark">
                  <div className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-ink/70">Monthly Subject-To PITI Payment</span>
                    <span>{formatCents(financing.hybridSubjectToPITI)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-ink/70">Estimated Monthly Seller Finance Payment</span>
                    <span>{formatCents(hybridMonthlySellerFinancePayment)}</span>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between rounded bg-brass/10 border border-brass px-4 py-4">
                  <span className="eyebrow text-brass">Total Monthly Housing Payment</span>
                  <span className="font-display text-2xl text-ink">
                    {formatCents(results.monthlyHousingPayment)}
                  </span>
                </div>
              </div>

              {/* Seller Finance Amortization Schedule: covers only the
                  seller-financed balance. The existing subject-to
                  mortgage is deliberately never part of this schedule,
                  since its original loan terms may differ. */}
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
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-line-dark">
            <ReadOnlyStat
              label="Estimated Equity"
              value={formatWhole(results.equity)}
              helperText={
                financingMode === "traditional"
                  ? "Estimated equity is calculated by subtracting the estimated loan balance from the purchase price."
                  : financingMode === "hybrid"
                    ? "Estimated equity is calculated by subtracting the existing mortgage balance from the purchase price."
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
                The existing mortgage balance exceeds the purchase price.
              </p>
            )}
          </div>
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
            <ReadOnlyStat
              label={downPaymentLabel}
              value={formatWhole(results.downPaymentForCapital)}
              helperText="Reused from Property and Financing above."
            />
            <CurrencyField
              id="arrears"
              label="Arrears"
              draft={capitalDraft.arrears}
              onChange={(raw) => handleCapitalChange("arrears", raw)}
              onBlur={() => handleCapitalBlur("arrears")}
            />
            <CurrencyField
              id="renovationCost"
              label="Renovation Cost"
              draft={capitalDraft.renovationCost}
              onChange={(raw) => handleCapitalChange("renovationCost", raw)}
              onBlur={() => handleCapitalBlur("renovationCost")}
            />
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
            <ReadOnlyStat
              label="Reserves"
              value={formatWhole(RESERVES_AMOUNT)}
              helperText="Estimated reserve funds set aside for the property."
            />
            <CurrencyField
              id="upfrontInsurance"
              label="Upfront Insurance"
              draft={capitalDraft.upfrontInsurance}
              onChange={(raw) => handleCapitalChange("upfrontInsurance", raw)}
              onBlur={() => handleCapitalBlur("upfrontInsurance")}
              helperText="Prepaid or upfront insurance premium, separate from the annual insurance used in monthly operating expenses."
            />
            <CurrencyField
              id="acquisitionFee"
              label="Acquisition Fee"
              draft={capitalDraft.acquisitionFee}
              onChange={(raw) => handleCapitalChange("acquisitionFee", raw)}
              onBlur={() => handleCapitalBlur("acquisitionFee")}
            />
            <CurrencyField
              id="tcAndLlc"
              label="TC and LLC"
              draft={capitalDraft.tcAndLlc}
              onChange={(raw) => handleCapitalChange("tcAndLlc", raw)}
              onBlur={() => handleCapitalBlur("tcAndLlc")}
              helperText="Transaction coordination and entity formation costs."
            />
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
              </>
            )}
            <CurrencyField
              id="agentFee"
              label="Agent Fee"
              draft={capitalDraft.agentFee}
              onChange={(raw) => handleCapitalChange("agentFee", raw)}
              onBlur={() => handleCapitalBlur("agentFee")}
            />
            <CurrencyField
              id="assignmentFee"
              label="Assignment Fee"
              draft={capitalDraft.assignmentFee}
              onChange={(raw) => handleCapitalChange("assignmentFee", raw)}
              onBlur={() => handleCapitalBlur("assignmentFee")}
            />
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
        <div className="hidden print:block bg-paper text-ink text-[10.5pt] leading-snug p-6">
          {/* Report header: brand lockup, title, and a meta row with
              property address (if entered), bedroom count, financing
              structure, generated date, and source. */}
          <div className="mb-6 print:break-inside-avoid-page">
            <div className="flex items-start justify-between gap-6 pb-4 border-b-4 border-brass">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-lg border-2 border-brass flex items-center justify-center flex-shrink-0">
                  <Home size={22} className="text-brass" />
                </div>
                <div>
                  <p className="text-[11pt] font-display font-semibold text-ink leading-tight">
                    MICHAEL AYLETT
                  </p>
                  <p className="text-[7pt] tracking-widest uppercase text-brass">
                    Real Estate Investments
                  </p>
                </div>
              </div>
              <h1 className="text-[22pt] font-display font-bold leading-tight text-ink text-right">
                Co-Living Underwriting Summary
              </h1>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[8.5pt] text-ink/70">
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
            <div className="mb-6 print:break-inside-avoid-page grid grid-cols-3 gap-3">
              {propertyImages.length > 0 && (
                <div className={videoWalkthroughLink.trim() !== "" ? "col-span-2" : "col-span-3"}>
                  <div className="rounded-xl overflow-hidden border border-ink/15 h-[2.6in]">
                    <img
                      src={propertyImages[0].dataUrl}
                      alt={propertyImages[0].name || "Featured property photo"}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {propertyImages.length > 1 && (
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {propertyImages.slice(1, 5).map((img) => (
                        <div
                          key={img.id}
                          className="rounded-lg overflow-hidden border border-ink/15 h-[0.9in]"
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
                  <p className="text-[7.5pt] font-semibold uppercase tracking-wide text-ink/60">
                    Video Walkthrough
                  </p>
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
          <div className="mb-6 print:break-inside-avoid-page grid grid-cols-5 gap-2 items-stretch">
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
          <div className="mb-6 print:break-inside-avoid-page rounded-xl border border-ink/15 bg-white p-4">
            <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink mb-1 pb-2 border-b border-brass/40">
              Investment Highlights
            </p>
            <div>
              <HighlightBullet
                icon={<Users size={13} />}
                label={`${results.totalBedrooms} Bedrooms`}
                detail="Co-living layout with per-bedroom rental income."
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

          {/* Charts: Income vs. Expenses (bar) and Capital Allocation
              (donut), generated automatically from the calculator's own
              figures via pure SVG, no charting library involved. */}
          <div className="mb-6 print:break-inside-avoid-page grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-ink/15 bg-white p-4">
              <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink mb-3 pb-2 border-b border-brass/40">
                Income vs. Expenses (Monthly)
              </p>
              <IncomeExpenseChart
                effectiveRent={results.effectiveRentAfterVacancy}
                operatingExpenses={results.totalMonthlyOperatingExpenses}
                cashFlow={results.monthlyCashFlow}
              />
            </div>
            <div className="rounded-xl border border-ink/15 bg-white p-4">
              <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink mb-3 pb-2 border-b border-brass/40">
                Capital Allocation
              </p>
              <div className="flex items-center gap-4">
                <CapitalAllocationDonut segments={capitalAllocationSegments} />
                <div className="flex-1 space-y-1.5 text-[8pt]">
                  {capitalAllocationSegments.map((segment) => {
                    const pct =
                      results.totalCapitalRequired > 0
                        ? (segment.value / results.totalCapitalRequired) * 100
                        : 0;
                    return (
                      <div key={segment.label} className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-ink/70">
                          <span
                            className="h-2 w-2 rounded-full inline-block flex-shrink-0"
                            style={{ backgroundColor: segment.color }}
                          />
                          {segment.label}
                        </span>
                        <span className="text-ink font-medium">{pct.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Property and Financing, presented as two side-by-side cards.
              Reads financing/results/paymentType/financingStructureLabel
              directly, and keeps the exact same PITI vs. Principal and
              Interest Only
              conditional logic: PITI shows a single combined payment line,
              Principal and Interest Only shows the payment plus taxes,
              insurance, and the full monthly housing payment. */}
          <div className="mb-6 print:break-inside-avoid-page grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-ink/15 bg-white p-4">
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-brass/40">
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
            <div className="rounded-xl border border-ink/15 bg-white p-4">
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-brass/40">
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
                        {formatPercent(percent.traditionalDownPaymentPct)}
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
                      <span className="text-ink/60">Seller-Financed Balance</span>
                      <span className="font-medium text-ink">
                        {formatCents(hybridSellerFinancedBalance)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/60">Monthly Subject-To PITI Payment</span>
                      <span className="font-medium text-ink">
                        {formatCents(financing.hybridSubjectToPITI)}
                      </span>
                    </div>
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
                    <div className="flex justify-between pt-1.5 border-t border-ink/10">
                      <span className="font-semibold text-ink">Estimated Monthly Seller Finance Payment</span>
                      <span className="font-semibold text-ink">
                        {formatCents(hybridMonthlySellerFinancePayment)}
                      </span>
                    </div>
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

          {/* Rental Income card: Gross and Effective Monthly Rent called
              out as large highlight tiles (Effective Monthly Rent uses a
              subtle green tint, since it is the positive, spendable
              figure), with the supporting line items below. */}
          <div className="mb-6 print:break-inside-avoid-page rounded-xl border border-ink/15 bg-white p-4">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-brass/40">
              <DollarSign size={14} className="text-brass" />
              <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink">Rental Income</p>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-3">
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
            <div className="space-y-1.5 text-[9.5pt]">
              <div className="flex justify-between">
                <span className="text-ink/60">Shared-Bath Bedroom Income</span>
                <span className="text-ink">{formatCents(results.monthlySharedBathRent)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/60">Ensuite Bedroom Income</span>
                <span className="text-ink">{formatCents(results.monthlyEnsuiteRent)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/60">Vacancy ({formatPercent(percent.vacancyPct)})</span>
                <span className="text-ink">-{formatCents(results.vacancyExpense)}</span>
              </div>
            </div>
          </div>

          {/* Monthly Operating Expenses card: alternating row backgrounds,
              Total Monthly Operating Expenses called out at the bottom. */}
          <div className="mb-6 print:break-inside-avoid-page rounded-xl border border-ink/15 bg-white p-4">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-brass/40">
              <Wallet size={14} className="text-brass" />
              <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink">
                Monthly Operating Expenses
              </p>
            </div>
            <div className="text-[9.5pt]">
              {[
                { label: housingPaymentLabel, value: results.monthlyHousingPayment },
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
          <div className="mb-6 print:break-inside-avoid-page rounded-xl border border-ink/15 bg-white p-4">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-brass/40">
              <PiggyBank size={14} className="text-brass" />
              <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink">Capital Required</p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[9.5pt]">
              <div className="flex justify-between">
                <span className="text-ink/60">{downPaymentLabel}</span>
                <span className="text-ink">{formatCents(results.downPaymentForCapital)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/60">Reserves</span>
                <span className="text-ink">{formatCents(RESERVES_AMOUNT)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/60">Arrears</span>
                <span className="text-ink">{formatCents(capital.arrears)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/60">Upfront Insurance</span>
                <span className="text-ink">{formatCents(capital.upfrontInsurance)}</span>
              </div>
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
              <div className="flex justify-between">
                <span className="text-ink/60">TC and LLC</span>
                <span className="text-ink">{formatCents(capital.tcAndLlc)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/60">Appliances</span>
                <span className="text-ink">{formatCents(capital.appliances)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/60">
                  {financingMode === "traditional"
                    ? `Traditional Closing Cost Percentage (${formatPercent(percent.traditionalClosingCostPct)})`
                    : `Closing Costs (${formatPercent(percent.closingCostPct)})`}
                </span>
                <span className="text-ink">{formatCents(results.closingCosts)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/60">Photos</span>
                <span className="text-ink">{formatCents(capital.photos)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/60">Agent Fee</span>
                <span className="text-ink">{formatCents(capital.agentFee)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/60">Holding Costs</span>
                <span className="text-ink">{formatCents(results.holdingCosts)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/60">Assignment Fee</span>
                <span className="text-ink">{formatCents(capital.assignmentFee)}</span>
              </div>
            </div>
            <div
              className="mt-3 flex justify-between items-center rounded-lg px-3 py-3"
              style={{ backgroundColor: "#FBEBC7" }}
            >
              <span className="text-[10pt] font-bold uppercase tracking-wide text-ink">
                Total Capital Required
              </span>
              <span className="text-[16pt] font-bold text-ink">
                {formatCents(results.totalCapitalRequired)}
              </span>
            </div>
          </div>

          {/* Estimated Returns: Monthly and Annual Cash Flow as supporting
              cards, Estimated Cash-on-Cash Return repeated as a large
              green summary card, matching the executive-summary treatment. */}
          <div className="mb-2 print:break-inside-avoid-page">
            <p className="text-[9.5pt] font-semibold uppercase tracking-wide text-ink border-b border-brass/60 pb-1.5 mb-3">
              Estimated Returns
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-ink/15 bg-white p-4 text-center">
                <p className="text-[7.5pt] uppercase tracking-wide text-ink/60">
                  Estimated Monthly Cash Flow
                </p>
                <p className="mt-1 text-[16pt] font-bold text-ink">{formatCents(results.monthlyCashFlow)}</p>
              </div>
              <div className="rounded-xl border border-ink/15 bg-white p-4 text-center">
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
          <div className="hidden print:flex mt-8 items-center justify-between px-4 py-2 border-t border-ink/15 bg-paper text-[7.5pt] text-ink/60 print:break-inside-avoid-page">
            <span className="font-semibold text-ink">Michael Aylett</span>
            <span>Co-Living Investment Analysis</span>
            <span>michaelaylett.com</span>
          </div>
        </div>
      </div>
    </section>
  );
}
