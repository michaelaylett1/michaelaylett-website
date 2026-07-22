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
 * Fixed assumptions (not user-editable, per the calculator's design):
 *   - Marketing fees: 15% of effective rent after vacancy
 *   - Annual maintenance: $4,800 ($400/month)
 *   - Utilities: $80 per bedroom per month
 *   - Cleaning and lawn care: $205 per month
 *   - Reserves: $10,000
 *   - Closing costs: 1.5% of purchase price
 *   - Holding costs: 3 months of the full monthly housing payment
 */

import { useMemo, useState } from "react";
import { Info } from "lucide-react";

// ---------------------------------------------------------------------
// Fixed assumptions
// ---------------------------------------------------------------------
const MARKETING_FEE_RATE = 0.15;
const MAINTENANCE_ANNUAL = 4800;
const UTILITIES_PER_BEDROOM = 80;
const CLEANING_LAWN_MONTHLY = 205;
const RESERVES_FIXED = 10000;
const CLOSING_COST_RATE = 0.015;
const HOLDING_MONTHS = 3;

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
  purchasePrice: 300000,
  loanBalance: 270000,
  sellerDownPayment: 21000,
  monthlyPayment: 2000,
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
  renovationCost: 50000,
  furniture: 13000,
  appliances: 3000,
  photos: 300,
  upfrontInsurance: 3000,
  acquisitionFee: 10000,
  tcAndLlc: 2000,
  agentFee: 0,
  assignmentFee: 0,
};

type PercentKey = "vacancyPct" | "propertyManagementPct";

const PERCENT_DEFAULTS: Record<PercentKey, number> = {
  vacancyPct: 10,
  propertyManagementPct: 8,
};

const BEDROOM_DEFAULTS = {
  sharedBathBedrooms: 7,
  weeklySharedBathRent: 190,
  ensuiteBedrooms: 2,
  weeklyEnsuiteRent: 250,
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

  const [breakdownOpen, setBreakdownOpen] = useState(false);

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
    });
    setSharedBathBedrooms(BEDROOM_DEFAULTS.sharedBathBedrooms);
    setSharedBathBedroomsDraft(String(BEDROOM_DEFAULTS.sharedBathBedrooms));
    setWeeklySharedBathRent(BEDROOM_DEFAULTS.weeklySharedBathRent);
    setWeeklySharedBathRentDraft(formatCents(BEDROOM_DEFAULTS.weeklySharedBathRent));
    setEnsuiteBedrooms(BEDROOM_DEFAULTS.ensuiteBedrooms);
    setEnsuiteBedroomsDraft(String(BEDROOM_DEFAULTS.ensuiteBedrooms));
    setWeeklyEnsuiteRent(BEDROOM_DEFAULTS.weeklyEnsuiteRent);
    setWeeklyEnsuiteRentDraft(formatCents(BEDROOM_DEFAULTS.weeklyEnsuiteRent));
  }

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

    const marketingFees = round2(effectiveRentAfterVacancy * MARKETING_FEE_RATE);
    const propertyManagementFee = round2(
      effectiveRentAfterVacancy * (percent.propertyManagementPct / 100)
    );
    const maintenanceMonthly = round2(MAINTENANCE_ANNUAL / 12);
    const utilitiesMonthly = round2(totalBedrooms * UTILITIES_PER_BEDROOM);
    const cleaningLawnMonthly = CLEANING_LAWN_MONTHLY;

    // Prevents taxes/insurance from ever being counted twice: PITI
    // already includes them, so only Principal-and-Interest-Only adds
    // them separately.
    const monthlyHousingPayment =
      paymentType === "piti"
        ? financing.monthlyPayment
        : round2(
            financing.monthlyPayment +
              financing.annualPropertyTaxes / 12 +
              financing.annualPropertyInsurance / 12
          );

    const totalMonthlyOperatingExpenses = round2(
      monthlyHousingPayment +
        vacancyExpense +
        marketingFees +
        propertyManagementFee +
        maintenanceMonthly +
        utilitiesMonthly +
        cleaningLawnMonthly
    );

    const sellerCarriedEquityRaw =
      financing.purchasePrice - financing.loanBalance - financing.sellerDownPayment;
    const sellerCarriedEquity = Math.max(0, round2(sellerCarriedEquityRaw));
    const sellerCarriedEquityNegative = sellerCarriedEquityRaw < 0;

    // Holding costs use the exact same monthly housing payment formula
    // (PITI, or P&I plus taxes and insurance) so there is only ever one
    // definition of "the full monthly housing expense" in this file.
    const holdingCostMonthly = monthlyHousingPayment;
    const holdingCosts = round2(holdingCostMonthly * HOLDING_MONTHS);

    const closingCosts = round2(financing.purchasePrice * CLOSING_COST_RATE);

    const totalCapitalRequired = round2(
      financing.sellerDownPayment +
        capital.arrears +
        capital.renovationCost +
        capital.furniture +
        capital.appliances +
        capital.photos +
        holdingCosts +
        RESERVES_FIXED +
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
      marketingFees,
      propertyManagementFee,
      maintenanceMonthly,
      utilitiesMonthly,
      cleaningLawnMonthly,
      monthlyHousingPayment,
      totalMonthlyOperatingExpenses,
      sellerCarriedEquity,
      sellerCarriedEquityNegative,
      holdingCosts,
      closingCosts,
      totalCapitalRequired,
      monthlyCashFlow,
      annualCashFlow,
      cashOnCashReturn,
    };
  }, [paymentType, financing, capital, percent, sharedBathBedrooms, weeklySharedBathRent, ensuiteBedrooms, weeklyEnsuiteRent]);

  const monthlyPaymentLabel =
    paymentType === "piti" ? "Monthly PITI Payment" : "Monthly Principal and Interest Payment";

  // ---------------------------------------------------------------------
  // Shared breakdown data: the on-page "View Full Underwriting Breakdown"
  // table uses these four sections directly. The CSV/print summary uses
  // the same four sections with an "Inputs" section prepended.
  // ---------------------------------------------------------------------
  const breakdownSections: BreakdownSection[] = useMemo(
    () => [
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
        title: "Monthly Expenses",
        rows: [
          { label: "Housing Payment", value: formatCents(results.monthlyHousingPayment) },
          { label: "Marketing", value: formatCents(results.marketingFees) },
          { label: "Property Management", value: formatCents(results.propertyManagementFee) },
          { label: "Maintenance", value: formatCents(results.maintenanceMonthly) },
          { label: "Utilities", value: formatCents(results.utilitiesMonthly) },
          { label: "Cleaning and Lawn Care", value: formatCents(results.cleaningLawnMonthly) },
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
          { label: "Reserves", value: formatCents(RESERVES_FIXED) },
          { label: "Upfront Insurance", value: formatCents(capital.upfrontInsurance) },
          { label: "Acquisition Fee", value: formatCents(capital.acquisitionFee) },
          { label: "TC and LLC", value: formatCents(capital.tcAndLlc) },
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
    [results, financing.sellerDownPayment, capital]
  );

  const inputsSection: BreakdownSection = useMemo(
    () => ({
      title: "Inputs",
      rows: [
        { label: "Purchase Price", value: formatWhole(financing.purchasePrice) },
        { label: "Loan Balance", value: formatWhole(financing.loanBalance) },
        { label: "Seller Down Payment", value: formatWhole(financing.sellerDownPayment) },
        { label: "Estimated Seller-Carried Equity", value: formatWhole(results.sellerCarriedEquity) },
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
        { label: "Local Property Manager", value: formatPercent(percent.propertyManagementPct) },
      ],
    }),
    [financing, results, paymentType, monthlyPaymentLabel, sharedBathBedrooms, weeklySharedBathRent, ensuiteBedrooms, weeklyEnsuiteRent, percent]
  );

  const csvSections = [inputsSection, ...breakdownSections];

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
    <section className="bg-ink text-bone py-16 md:py-20">
      <div className="mx-auto max-w-content px-6 md:px-10">
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
              <InfoTip text="Every cash cost paid at or around closing: down payment, holding costs, reserves, renovation, and the other upfront items below. Does not include the loan balance, seller-carried equity, or purchase price." />
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
        {/* Section 1: Property and financing                          */}
        {/* ---------------------------------------------------------- */}
        <div className="print:hidden mt-10 bg-paper text-ink p-6 sm:p-8 md:p-10">
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
              label="Estimated Seller-Carried Equity"
              value={formatWhole(results.sellerCarriedEquity)}
              info="Purchase price minus the loan balance minus the seller down payment. Financed, not paid in cash at closing, so it is not part of Total Capital Required."
              helperText="This estimates the remaining portion of the purchase price after subtracting the existing or new loan balance and the cash paid to the seller at closing."
            />
            {results.sellerCarriedEquityNegative && (
              <p className="mt-3 text-sm text-red-700">
                The loan balance and down payment exceed the purchase
                price, so seller-carried equity is shown as $0.
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
              id="marketingFeePct"
              label="Marketing Fees"
              draft="15.00"
              onChange={() => {}}
              onBlur={() => {}}
              fixed
              info="Fixed at 15% of effective rent after vacancy."
            />
            <PercentField
              id="propertyManagementPct"
              label="Local Property Manager"
              draft={percentDraft.propertyManagementPct}
              onChange={(raw) => handlePercentChange("propertyManagementPct", raw)}
              onBlur={() => handlePercentBlur("propertyManagementPct")}
              info="Applied to effective rent after vacancy."
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
                <span className="text-ink/70">Marketing Fees</span>
                <span className="font-display">{formatCents(results.marketingFees)}</span>
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
                <span className="text-ink/70">Cleaning and Lawn Care</span>
                <span className="font-display">{formatCents(results.cleaningLawnMonthly)}</span>
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
            <ReadOnlyStat
              label="Holding Costs"
              value={formatCents(results.holdingCosts)}
              info="Three months of the full monthly housing payment (PITI, or principal and interest plus taxes and insurance)."
              helperText="Calculated automatically as 3 months of the monthly housing payment."
            />
            <ReadOnlyStat label="Reserves" value={formatWhole(RESERVES_FIXED)} helperText="Fixed." />
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
            <ReadOnlyStat
              label="Closing Costs"
              value={formatCents(results.closingCosts)}
              helperText="Fixed at 1.5% of the purchase price."
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
              <InfoTip text="Every cash cost paid at or around closing. Does not include the loan balance, seller-carried equity, or purchase price." />
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

        {/* Printable summary: hidden on screen, shown only when printing
            (or saving as PDF from the print dialog), since the
            interactive form controls above aren't meaningful on paper. */}
        <div className="hidden print:block text-ink">
          <h2 className="font-display text-2xl mb-6">Shared Housing Underwriting Summary</h2>
          {csvSections.map((section) => (
            <div key={section.title} className="mb-6">
              <p className="font-medium mb-2">{section.title}</p>
              {section.rows.map((row) => (
                <div key={row.label} className="flex justify-between text-sm py-1">
                  <span>{row.label}</span>
                  <span>{row.value}</span>
                </div>
              ))}
            </div>
          ))}
          <p className="mt-6 text-xs leading-relaxed">
            This calculator is provided for illustrative and educational
            purposes only. Results are estimates based on the information
            entered and the assumptions displayed. Actual rents,
            occupancy, expenses, financing costs, renovation costs,
            operating performance, and investment returns may vary. This
            calculator does not constitute an offer, appraisal,
            projection, guarantee, legal advice, tax advice, or
            investment advice. Users should independently verify all
            assumptions and consult qualified professionals before
            making an investment decision.
          </p>
        </div>
      </div>
    </section>
  );
}
