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
import { Info, Upload } from "lucide-react";

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

// Floor Plan: a single optional file, processed and stored entirely
// client-side like Property Images. Accepts image formats plus PDF,
// since floor plans are commonly distributed as PDFs.
const ACCEPTED_FLOOR_PLAN_TYPES = [...ACCEPTED_IMAGE_TYPES, "application/pdf"];

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

// Floor Plan file: either a processed image data URL or a PDF read
// directly as a data URL (PDFs are not resized/compressed, only images
// are, since canvas-based processing cannot rasterize a PDF).
type FloorPlanFile = { dataUrl: string; name: string; isImage: boolean };

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

// Financing Structure: Seller Financing and Subject To are independent
// checkboxes, so all four combinations are possible.
function getFinancingStructureLabel(sellerFinancing: boolean, subjectTo: boolean): string {
  if (sellerFinancing && subjectTo) return "Subject To and Seller Financing";
  if (subjectTo) return "Subject To";
  if (sellerFinancing) return "Seller Financing";
  return "Not Specified";
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
  | "annualPropertyInsurance";

const FINANCING_DEFAULTS: Record<FinancingKey, number> = {
  purchasePrice: 0,
  loanBalance: 0,
  sellerDownPayment: 0,
  monthlyPayment: 0,
  annualPropertyTaxes: 0,
  annualPropertyInsurance: 0,
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

type PercentKey = "vacancyPct" | "propertyManagementPct" | "platformFeePct" | "closingCostPct";

const PERCENT_DEFAULTS: Record<PercentKey, number> = {
  vacancyPct: 10,
  propertyManagementPct: 8,
  platformFeePct: 15,
  closingCostPct: 1.5,
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
  const [financingStructure, setFinancingStructure] = useState({
    sellerFinancing: false,
    subjectTo: false,
  });

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

  // Floor Plan handler: a single optional file, processed entirely
  // client-side. Images are resized/compressed like Property Images;
  // PDFs are read directly as a data URL (no canvas processing, since a
  // PDF cannot be rasterized that way). Uploading a new file always
  // replaces whatever floor plan was there before.
  async function handleFloorPlanFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    if (!ACCEPTED_FLOOR_PLAN_TYPES.includes(file.type)) {
      setFloorPlanError("That file is not supported. Please choose a JPG, PNG, WEBP, or PDF file.");
      return;
    }
    setFloorPlanError("");
    setProcessingFloorPlan(true);
    try {
      const isImage = ACCEPTED_IMAGE_TYPES.includes(file.type);
      const dataUrl = isImage
        ? await processImageFile(file)
        : await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error("Could not read the selected file."));
            reader.readAsDataURL(file);
          });
      setFloorPlan({ dataUrl, name: file.name, isImage });
    } catch {
      setFloorPlanError("That file could not be processed. Please try a different file.");
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
    setFinancingStructure({ sellerFinancing: false, subjectTo: false });
  }

  // ---------------------------------------------------------------------
  // Monthly housing payment and the automatically calculated Holding
  // Costs are broken out of the main underwriting engine below (rather
  // than computed inline) so the Holding Costs override effect further
  // down can depend on them directly, without duplicating the PITI vs.
  // P&I-plus-taxes-and-insurance formula in two places.
  // ---------------------------------------------------------------------
  const monthlyHousingPayment = useMemo(() => {
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
  }, [paymentType, financing.monthlyPayment, financing.annualPropertyTaxes, financing.annualPropertyInsurance]);

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

    // Estimated Equity = Purchase Price - Loan Balance. The Seller Down
    // Payment is a separate cash requirement (used in Total Capital
    // Required) and is not subtracted here.
    const equityRaw = financing.purchasePrice - financing.loanBalance;
    const equity = Math.max(0, round2(equityRaw));
    const equityIsNegative = equityRaw < 0;

    // Holding Costs default to the automatic three-month calculation
    // (monthlyHousingPayment x HOLDING_MONTHS, computed above) but use
    // the visitor's manually entered value once the field is overridden.
    const holdingCosts = effectiveHoldingCosts;

    // Closing Costs default to 1.5% of the purchase price but use
    // whatever Closing Cost Percentage the visitor has entered.
    const closingCosts = round2(financing.purchasePrice * (percent.closingCostPct / 100));

    const totalCapitalRequired = round2(
      financing.sellerDownPayment +
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
  ]);

  const monthlyPaymentLabel =
    paymentType === "piti" ? "Monthly PITI Payment" : "Monthly Principal and Interest Payment";

  // Financing Structure: Seller Financing and Subject To are independent
  // checkboxes (see getFinancingStructureLabel above), computed once here
  // so the breakdown, CSV, and print report all read the same label.
  const financingStructureLabel = getFinancingStructureLabel(
    financingStructure.sellerFinancing,
    financingStructure.subjectTo
  );

  // ---------------------------------------------------------------------
  // Shared breakdown data: the on-page "View Full Underwriting Breakdown"
  // table uses these five sections directly. The CSV/print summary uses
  // the same five sections with an "Inputs" section prepended.
  // ---------------------------------------------------------------------
  const breakdownSections: BreakdownSection[] = useMemo(
    () => [
      {
        title: "Property and Financing",
        rows: [
          { label: "Property Address", value: propertyAddress.trim() || "Not entered" },
          { label: "Financing Structure", value: financingStructureLabel },
          { label: "Purchase Price", value: formatCents(financing.purchasePrice) },
          { label: "Loan Balance", value: formatCents(financing.loanBalance) },
          { label: "Estimated Equity", value: formatCents(results.equity) },
          { label: "Seller Down Payment", value: formatCents(financing.sellerDownPayment) },
          { label: "Monthly Housing Payment", value: formatCents(results.monthlyHousingPayment) },
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
          { label: "Housing Payment", value: formatCents(results.monthlyHousingPayment) },
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
          { label: "Seller Down Payment", value: formatCents(financing.sellerDownPayment) },
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
          { label: "Estimated Closing Cost Percentage", value: formatPercent(percent.closingCostPct) },
          { label: "Closing Costs", value: formatCents(results.closingCosts) },
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
    [results, financing, capital, percent, propertyAddress, financingStructureLabel]
  );

  const inputsSection: BreakdownSection = useMemo(
    () => ({
      title: "Inputs",
      rows: [
        { label: "Property Address", value: propertyAddress.trim() || "Not entered" },
        { label: "Video Walkthrough Link", value: videoWalkthroughLink.trim() || "Not entered" },
        { label: "Purchase Price", value: formatWhole(financing.purchasePrice) },
        { label: "Loan Balance", value: formatWhole(financing.loanBalance) },
        { label: "Seller Down Payment", value: formatWhole(financing.sellerDownPayment) },
        { label: "Estimated Equity", value: formatWhole(results.equity) },
        { label: "Monthly Payment Type", value: paymentType === "piti" ? "PITI" : "Principal and Interest Only" },
        { label: monthlyPaymentLabel, value: formatCents(financing.monthlyPayment) },
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
        { label: "Estimated Closing Cost Percentage", value: formatPercent(percent.closingCostPct) },
        {
          label: "Holding Costs Source",
          value: results.holdingCostsIsManual ? "Manually overridden" : "Automatically calculated",
        },
      ],
    }),
    [financing, results, paymentType, monthlyPaymentLabel, sharedBathBedrooms, weeklySharedBathRent, ensuiteBedrooms, weeklyEnsuiteRent, percent, maintenanceExpenses, propertyAddress, videoWalkthroughLink]
  );

  const csvSections = [inputsSection, ...breakdownSections];

  // ---------------------------------------------------------------------
  // Dedicated print-report data: a self-contained set of sections built
  // specifically for the printed/PDF underwriting summary rendered near
  // the end of this component. Deliberately separate from
  // breakdownSections/inputsSection (which drive the on-page breakdown
  // toggle and the CSV export): the printed report only shows
  // calculated figures, never input controls, and Annual Property Taxes
  // and Annual Property Insurance appear only when the payment type is
  // Principal and Interest Only. PITI already includes taxes and
  // insurance in the single monthly payment, so the report shows just
  // the Monthly PITI Payment in that case, with no separate tax/
  // insurance lines and no note about them being included.
  // ---------------------------------------------------------------------
  const printSections: BreakdownSection[] = useMemo(() => {
    const propertyAndFinancingRows: BreakdownRow[] = [
      { label: "Financing Structure", value: financingStructureLabel },
      { label: "Purchase Price", value: formatCents(financing.purchasePrice) },
      { label: "Loan Balance", value: formatCents(financing.loanBalance) },
      { label: "Estimated Equity", value: formatCents(results.equity) },
      { label: "Seller Down Payment", value: formatCents(financing.sellerDownPayment) },
      ...(paymentType === "piti"
        ? [{ label: "Monthly PITI Payment", value: formatCents(financing.monthlyPayment) }]
        : [
            { label: "Monthly Principal and Interest Payment", value: formatCents(financing.monthlyPayment) },
            { label: "Annual Property Taxes", value: formatCents(financing.annualPropertyTaxes) },
            { label: "Annual Property Insurance", value: formatCents(financing.annualPropertyInsurance) },
            { label: "Monthly Housing Payment", value: formatCents(results.monthlyHousingPayment) },
          ]),
    ];

    return [
      { title: "Property and Financing", rows: propertyAndFinancingRows },
      {
        title: "Rental Income",
        rows: [
          { label: "Shared-Bath Bedroom Income", value: formatCents(results.monthlySharedBathRent) },
          { label: "Ensuite Bedroom Income", value: formatCents(results.monthlyEnsuiteRent) },
          { label: "Gross Monthly Rent", value: formatCents(results.grossMonthlyRent) },
          { label: "Vacancy", value: formatCents(results.vacancyExpense) },
          { label: "Effective Monthly Rent", value: formatCents(results.effectiveRentAfterVacancy) },
        ],
      },
      {
        title: "Monthly Operating Expenses",
        rows: [
          { label: "Housing Payment", value: formatCents(results.monthlyHousingPayment) },
          { label: "Platform Fee Percentage", value: formatPercent(percent.platformFeePct) },
          { label: "Platform Fees", value: formatCents(results.platformFees) },
          { label: "Property Management", value: formatCents(results.propertyManagementFee) },
          { label: "Maintenance", value: formatCents(results.maintenanceMonthly) },
          { label: "Utilities", value: formatCents(results.utilitiesMonthly) },
          { label: "Cleaning", value: formatCents(results.cleaningMonthly) },
          { label: "Lawn Care", value: formatCents(results.lawnCareMonthly) },
          { label: "Pest Control", value: formatCents(results.pestControlMonthly) },
          {
            label: "Total Monthly Operating Expenses",
            value: formatCents(results.totalMonthlyOperatingExpenses),
            isTotal: true,
          },
        ],
      },
      {
        title: "Upfront Capital Required",
        rows: [
          { label: "Seller Down Payment", value: formatCents(financing.sellerDownPayment) },
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
          { label: "Estimated Closing Cost Percentage", value: formatPercent(percent.closingCostPct) },
          { label: "Closing Costs", value: formatCents(results.closingCosts) },
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
        title: "Estimated Returns",
        rows: [
          { label: "Estimated Monthly Cash Flow", value: formatCents(results.monthlyCashFlow) },
          { label: "Estimated Annual Cash Flow", value: formatCents(results.annualCashFlow) },
          {
            label: "Estimated Cash-on-Cash Return",
            value: results.cashOnCashReturn === null ? "N/A" : formatPercent(results.cashOnCashReturn),
            isTotal: true,
          },
        ],
      },
    ];
  }, [paymentType, financing, capital, percent, results, financingStructureLabel]);

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
              {floorPlan.isImage ? (
                <img
                  src={floorPlan.dataUrl}
                  alt={floorPlan.name || "Floor plan"}
                  className="w-full h-40 object-contain"
                />
              ) : (
                <div className="py-6 px-2">
                  <span className="text-sm text-ink/70 break-all">{floorPlan.name}</span>
                  <p className="mt-1 text-xs text-ink/50">PDF floor plan</p>
                </div>
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <label className="text-xs text-brass underline decoration-brass/50 underline-offset-2 hover:text-brass-light transition-colors cursor-pointer">
                  Replace
                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
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
                accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
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
            Supported formats: JPG, PNG, WEBP, and PDF. One floor plan.
            Appears at the bottom of the printable underwriting summary.
          </p>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Section 1: Property and financing                          */}
        {/* ---------------------------------------------------------- */}
        <div className="print:hidden mt-6 bg-paper text-ink p-6 sm:p-8 md:p-10">
          <p className="eyebrow text-brass mb-5">Property and Financing</p>
          <div className="grid sm:grid-cols-2 gap-5">
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

          <div className="mt-8 pt-6 border-t border-line-dark">
            <ReadOnlyStat
              label="Estimated Equity"
              value={formatWhole(results.equity)}
              helperText="Estimated equity is calculated by subtracting the loan balance from the purchase price."
            />
            {results.equityIsNegative && (
              <p className="mt-3 text-sm text-red-700">
                The loan balance exceeds the purchase price.
              </p>
            )}
          </div>

          <div className="mt-8 pt-6 border-t border-line-dark">
            <p className="eyebrow text-brass mb-3">Financing Structure</p>
            <div className="flex flex-wrap gap-6">
              <label className="inline-flex items-center gap-2 text-sm text-ink/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={financingStructure.sellerFinancing}
                  onChange={(e) =>
                    setFinancingStructure((prev) => ({ ...prev, sellerFinancing: e.target.checked }))
                  }
                  className="h-4 w-4 accent-brass"
                />
                Seller Financing
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-ink/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={financingStructure.subjectTo}
                  onChange={(e) =>
                    setFinancingStructure((prev) => ({ ...prev, subjectTo: e.target.checked }))
                  }
                  className="h-4 w-4 accent-brass"
                />
                Subject To
              </label>
            </div>
            <p className="mt-3 text-xs text-ink/50 leading-relaxed">
              Select all financing structures that apply to the proposed transaction.
            </p>
            <p className="mt-3 text-sm text-ink/70">
              Selected: <span className="font-medium text-ink">{financingStructureLabel}</span>
            </p>
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
                <span className="text-ink/70">Monthly Housing Payment</span>
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
              label="Seller Down Payment"
              value={formatWhole(financing.sellerDownPayment)}
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
            when printing or saving as PDF from the print dialog. Titled
            "Co-Living Underwriting Summary", styled with the site's
            cream/charcoal/brass identity, and ordered exactly as required:
            title, property address (if entered), financing structure,
            source, generated date, video walkthrough (if entered), property
            photo gallery (if uploaded), investment and return summary
            cards, then the five printSections (Property and Financing,
            Rental Income, Monthly Operating Expenses, Upfront Capital
            Required, Estimated Returns), and finally the floor plan (if
            uploaded) at the very bottom. The illustrative-use disclaimer is
            intentionally not printed here; it still appears on the
            interactive calculator page above. Built from printSections
            (defined above) rather than the on-page breakdown or CSV data,
            since this report has its own rules: only calculated figures,
            no input controls, tooltips, or buttons, and Annual Property
            Taxes/Insurance appear only for Principal and Interest Only
            (see printSections). */}
        <div className="hidden print:block bg-paper text-ink text-[10.5pt] leading-snug p-6">
          {/* 1-5. Report header: title, property address (if entered),
              financing structure, source, generated date */}
          <div className="mb-6 print:break-inside-avoid-page border-b-4 border-brass pb-4">
            <h1 className="text-[20pt] font-display font-semibold leading-tight text-ink">
              Co-Living Underwriting Summary
            </h1>
            {propertyAddress.trim() && (
              <p className="mt-2 text-[10pt] text-ink/80">
                Property Address: {propertyAddress.trim()}
              </p>
            )}
            <p className="mt-1 text-[9pt] text-ink/80">
              Financing Structure: {financingStructureLabel}
            </p>
            <p className="mt-1 text-[9pt] text-ink/60">Source: michaelaylett.com</p>
            <p className="text-[9pt] text-ink/60">
              Generated:{" "}
              {new Date().toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>

          {/* 6. Video Walkthrough, only if a link was entered. No video
              player is embedded; the label is a clickable hyperlink in
              saved PDF versions, with the full URL printed beneath it so
              the link is still usable from a physical printed copy. */}
          {videoWalkthroughLink.trim() !== "" && (
            <div className="mb-6 print:break-inside-avoid-page">
              <p className="text-[10pt] font-semibold uppercase tracking-wide text-ink border-b border-brass/60 pb-1 mb-2 print:break-after-avoid-page">
                Video Walkthrough
              </p>
              <a href={videoWalkthroughLink.trim()} className="text-[11pt] font-semibold text-brass underline">
                View Property Walkthrough
              </a>
              <p className="mt-1 text-[9pt] text-ink/60 break-all">{videoWalkthroughLink.trim()}</p>
            </div>
          )}

          {/* 7. Property photo gallery, only if images were uploaded */}
          {propertyImages.length > 0 && (
            <div className="mb-6 print:break-inside-avoid-page">
              <p className="text-[10pt] font-semibold uppercase tracking-wide text-ink border-b border-brass/60 pb-1 mb-2 print:break-after-avoid-page">
                Property Photos
              </p>
              <div className={`grid ${getGalleryLayout(propertyImages.length).gridClass} gap-2`}>
                {propertyImages.map((img) => (
                  <div
                    key={img.id}
                    className={`overflow-hidden rounded border border-ink/15 print:break-inside-avoid ${
                      getGalleryLayout(propertyImages.length).imgHeightClass
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
            </div>
          )}

          {/* 8. Investment and return summary: the five headline figures,
              with Total Capital Required and Estimated Cash-on-Cash Return
              made the most visually prominent. The Cash-on-Cash Return card
              always uses the same bright-green treatment regardless of the
              value, with a bold dark border and bold, very dark text so the
              figure stays readable even if the printer omits background
              colors. */}
          <div className="mb-6 print:break-inside-avoid-page">
            <p className="text-[10pt] font-semibold uppercase tracking-wide text-ink border-b border-brass/60 pb-1 mb-2 print:break-after-avoid-page">
              Investment and Return Summary
            </p>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="border border-ink/25 bg-paper-2 rounded px-3 py-2">
                <p className="text-[8pt] uppercase tracking-wide text-ink/60">Purchase Price</p>
                <p className="text-[13pt] font-semibold text-ink">{formatCents(financing.purchasePrice)}</p>
              </div>
              <div className="border border-ink/25 bg-paper-2 rounded px-3 py-2">
                <p className="text-[8pt] uppercase tracking-wide text-ink/60">
                  Estimated Monthly Cash Flow
                </p>
                <p className="text-[13pt] font-semibold text-ink">{formatCents(results.monthlyCashFlow)}</p>
              </div>
              <div className="border border-ink/25 bg-paper-2 rounded px-3 py-2">
                <p className="text-[8pt] uppercase tracking-wide text-ink/60">
                  Estimated Annual Cash Flow
                </p>
                <p className="text-[13pt] font-semibold text-ink">{formatCents(results.annualCashFlow)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="border-2 border-brass bg-white rounded px-3 py-3">
                <p className="text-[8pt] uppercase tracking-wide text-ink/60">
                  Total Capital Required
                </p>
                <p className="text-[20pt] font-bold text-ink">
                  {formatCents(results.totalCapitalRequired)}
                </p>
              </div>
              <div
                className="border-4 border-ink rounded px-3 py-3"
                style={{ backgroundColor: "#00FF00" }}
              >
                <p className="text-[8pt] uppercase tracking-wide text-ink font-bold">
                  Estimated Cash-on-Cash Return
                </p>
                <p className="text-[20pt] font-bold text-ink">
                  {results.cashOnCashReturn === null ? "N/A" : formatPercent(results.cashOnCashReturn)}
                </p>
              </div>
            </div>
          </div>

          {/* 9-13. Property and Financing, Rental Income, Monthly
              Operating Expenses, Upfront Capital Required, Estimated
              Returns */}
          {printSections.map((section) => (
            <div key={section.title} className="mb-4 print:break-inside-avoid-page">
              <p className="text-[10pt] font-semibold uppercase tracking-wide text-ink border-b border-brass/60 pb-1 mb-1.5 print:break-after-avoid-page">
                {section.title}
              </p>
              {section.rows.map((row) => (
                <div
                  key={row.label}
                  className={`flex justify-between gap-4 text-[10pt] py-0.5 print:break-inside-avoid ${
                    row.isTotal ? "font-semibold border-t border-brass/50 mt-1 pt-1 text-ink" : "text-ink/85"
                  }`}
                >
                  <span>{row.label}</span>
                  <span>{row.value}</span>
                </div>
              ))}
            </div>
          ))}

          {/* 14. Floor Plan, only if one was uploaded. Uses object-contain
              (not object-cover, unlike the photo gallery) so the plan is
              never cropped or stretched, and print:break-inside-avoid-page
              keeps it from splitting across two pages, which naturally
              pushes it onto a new page if it does not fit on the current
              one. PDF floor plans cannot be reliably embedded inline
              across browsers, so they are shown as a clearly labeled,
              clickable file link instead. */}
          {floorPlan && (
            <div className="mt-6 print:break-inside-avoid-page">
              <p className="text-[10pt] font-semibold uppercase tracking-wide text-ink border-b border-brass/60 pb-1 mb-2 print:break-after-avoid-page">
                Floor Plan
              </p>
              {floorPlan.isImage ? (
                <img
                  src={floorPlan.dataUrl}
                  alt={floorPlan.name || "Floor plan"}
                  className="w-full h-auto max-h-[8.5in] object-contain rounded border border-ink/15"
                />
              ) : (
                <div className="border border-ink/25 bg-paper-2 rounded px-4 py-4">
                  <p className="text-[10pt] text-ink break-all">{floorPlan.name}</p>
                  <a href={floorPlan.dataUrl} className="mt-1 inline-block text-[9pt] text-brass underline">
                    Open Floor Plan PDF
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
