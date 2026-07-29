import ExcelJS from "exceljs";
import type { RoiProjectionResult } from "./roiProjection";
import type { EffectiveAmortizationTerm } from "./amortization";

/**
 * Excel (.xlsx) export for the Underwriting calculator. Replaces the old
 * CSV export entirely. Every number written here is passed in already
 * computed by SharedHousingCalculator.tsx's single underwriting engine
 * (the same `results`/`financing`/`capital`/`percent` values that drive
 * the on-page UI and the printable report), so the exported workbook is
 * guaranteed to match the website exactly -- this module never
 * recalculates underwriting math on its own.
 *
 * Two export paths:
 *  - Subject To, Seller Financing, and Subject To & Seller Finance
 *    Hybrid (buildTemplateWorkbook) build a one-page "Underwriting"
 *    sheet that reproduces the visual design of the reference
 *    underwriting workbook this was modeled on (borders, yellow input
 *    cells, green result cells, accounting-style currency format,
 *    column widths), an "Inputs" sheet the main sheet's formulas
 *    reference (so Annual Utilities / Insurance / Property Taxes /
 *    Cleaning-Lawn-Pest Control are genuine Excel formulas rather than
 *    pasted-in numbers), and a "Financing Details" sheet with the full
 *    itemized breakdown. The reference workbook's broken formulas (a
 *    literal #REF! in the Equity cell, Monthly Cash Flow dividing by
 *    undefined cells, a hard-coded management-fee percentage) are all
 *    corrected here, and Total Capital Required / Cash-on-Cash Return
 *    are guarded against a $0 denominator.
 *  - Traditional Financing and Stack Method (buildGeneratedWorkbook)
 *    build a different-shaped workbook from scratch (their inputs and
 *    capital-required line items do not match the other three
 *    structures), using the same visual language (bold labels,
 *    accounting-style currency, a green highlighted final result) so
 *    the output still looks like one consistent, professional
 *    underwriting workbook.
 *
 * Every workbook also gets, when any Scope of Work line items exist, a
 * "Scope of Work" worksheet.
 */

// ---------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------
export type ExportFinancingMode = "traditional" | "subjectTo" | "sellerFinancing" | "hybrid" | "stackMethod";

export interface ExportBalloonAnalysis {
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
  // Used only by the Stack Method refinance-shortfall rows/messaging
  // below (spec: "Apply this only to the Stack Method section for
  // now"). Always present at runtime on every structure's balloon
  // analysis object (the component's BalloonAnalysis type computes
  // them for all four), just not read outside Stack Method yet.
  recommendedYears: number | null;
  projectedLtvAtRecommended: number | null;
  amortizationCeilingYears: number;
}

export interface ExportScopeOfWorkItem {
  name: string;
  cost: number;
}

// One loan leg's complete month-by-month amortization schedule, built
// from the exact same lib/amortization.ts engine that drives the
// on-page schedule and CSV download -- passed straight through, never
// recalculated here. `sheetName` must be 31 characters or fewer (an
// Excel worksheet tab-name limit) and free of : \ / ? * [ ]; the fuller
// descriptive title is written as the sheet's own header row instead.
// `disclosure`, when present, is the required estimation notice shown
// at the top of every Subject-To and Hybrid-existing-mortgage
// amortization worksheet. `balloonAtPaymentNumber`, when present,
// highlights that row as the balloon due date.
export interface ExportAmortizationRow {
  paymentNumber: number;
  beginningBalance: number;
  principalPaid: number;
  interestPaid: number;
  totalPayment: number;
  endingBalance: number;
}
export interface ExportAmortizationSchedule {
  sheetName: string;
  title: string;
  disclosure?: string;
  balloonAtPaymentNumber?: number | null;
  rows: ExportAmortizationRow[];
}

export interface UnderwritingExportData {
  financingMode: ExportFinancingMode;
  propertyAddress: string;
  videoWalkthroughLink: string;

  // Bedrooms / room rates
  sharedBathBedrooms: number;
  weeklySharedBathRent: number;
  ensuiteBedrooms: number;
  weeklyEnsuiteRent: number;
  totalBedrooms: number;
  grossMonthlyRent: number;

  // Operating assumptions
  vacancyPct: number;
  platformFeePct: number;
  propertyManagementPct: number;
  closingCostPct: number;
  vacancyExpense: number;
  effectiveRentAfterVacancy: number;
  platformFees: number;
  propertyManagementFee: number;
  maintenanceMonthly: number;
  utilitiesMonthly: number;
  cleaningMonthly: number;
  lawnCareMonthly: number;
  pestControlMonthly: number;
  totalMonthlyOperatingExpenses: number;
  monthlyHousingPayment: number;
  housingPaymentLabel: string;
  annualPropertyTaxes: number;
  annualPropertyInsurance: number;

  purchasePrice: number;
  paymentType: "piti" | "pi";

  // Effective Tax Rate feature: annualPropertyTaxes above is always
  // "Property Taxes Used in Underwriting" (drives every downstream
  // calculation, unchanged); these five fields are purely informational/
  // reference figures shown alongside it.
  propertyTaxCounty: string;
  propertyTaxRatePct: number;
  propertyTaxRateSource: string;
  calculatedAnnualPropertyTaxes: number;
  propertyTaxSource: string;

  // Subject To / Seller Financing (shared fields)
  loanBalance: number;
  sellerDownPayment: number;
  monthlyPayment: number;
  loanInterestRatePct: number;
  // Remaining amortization is optional -- null means the user has not
  // entered a remaining term. loanKnownMonthlyPIPayment is the loan's
  // actual monthly principal-and-interest payment, used to mathematically
  // estimate the remaining term when the years above are not entered.
  // subjectToEffectiveAmortization is the single resolved answer (see
  // lib/amortization.ts's resolveEffectiveAmortizationTerm), computed on
  // the website and passed straight through -- never recalculated here.
  loanRemainingAmortizationYears: number | null;
  loanKnownMonthlyPIPayment: number | null;
  subjectToEffectiveAmortization: EffectiveAmortizationTerm;

  // Seller Financing (fully independent from Subject To's shared fields
  // above -- Seller Financing always represents a brand-new loan, never
  // an existing one, so it never uses paymentType, an optional remaining
  // term, or a known-payment estimate). sellerFinancingLoanBalance is
  // the actual balance in use (calculated or manually overridden);
  // sellerFinancingLoanBalanceIsManual says which. sellerFinancingMonthlyPI
  // is always Principal and Interest only, calculated on the website from
  // balance/rate/term via the standard amortizing-loan formula -- never
  // PITI, and never manually entered.
  sellerFinancingDownPaymentPct: number;
  sellerFinancingDownPaymentAmount: number;
  sellerFinancingLoanBalance: number;
  sellerFinancingLoanBalanceIsManual: boolean;
  sellerFinancingInterestRatePct: number;
  sellerFinancingAmortizationYears: number;
  sellerFinancingMonthlyPI: number;

  // Traditional
  traditionalDownPaymentPct: number;
  traditionalDownPaymentAmount: number;
  traditionalLoanBalance: number;
  traditionalInterestRatePct: number;
  traditionalMonthlyPI: number;
  traditionalClosingCostPct: number;
  traditionalClosingCosts: number;
  traditionalLongTermRent: number | null;
  traditionalSelectedLtvPct: number;

  // Hybrid
  hybridExistingMortgageBalance: number;
  hybridExistingMortgageRatePct: number;
  // Same optional-remaining-term pattern as loanRemainingAmortizationYears
  // above, applied to Hybrid's existing-mortgage leg.
  hybridExistingMortgageAmortizationYears: number | null;
  hybridExistingMortgageKnownMonthlyPIPayment: number | null;
  hybridExistingMortgageEffectiveAmortization: EffectiveAmortizationTerm;
  hybridSubjectToPITI: number;
  hybridSuggestedSellerFinancedBalance: number;
  hybridSellerFinancedBalanceUsed: number;
  hybridSellerFinancedBalanceIsManual: boolean;
  hybridSellerFinancePaymentsRequired: boolean;
  hybridSellerFinanceRatePct: number;
  hybridMonthlySellerFinancePayment: number;
  hybridSellerFinanceRepaymentStructure: string;
  hybridTotalMonthlyHousingPayment: number;

  // Stack Method
  stackBankLoanAmount: number;
  stackEffectiveBankLtvPct: number;
  stackBankInterestRatePct: number;
  stackBankAmortizationYears: number;
  stackBankMonthlyPI: number;
  stackMonthlyBankPITI: number;
  stackSellerFirstLoanBalance: number;
  stackSellerSecondLien: number;
  stackMiscLiens: number;
  stackDownPaymentToSeller: number;
  stackSellerFinancedBalance: number;
  stackTotalDebtAtAcquisition: number;
  stackLeverageRatioDecimal: number | null;
  stackClosingCostPct: number;
  stackClosingCosts: number;
  stackAgentCommissionPct: number;
  stackAgentFees: number;
  stackTransactionalFundingFeePct: number;
  stackTransactionalFundingFee: number;
  stackCashToCloseLeg1: number;
  stackSellerFinancePaymentsRequired: boolean;
  stackSellerFinanceRatePct: number;
  stackSellerFinanceAmortizationYears: number;
  stackMonthlySellerFinancePayment: number;
  stackEstimatedBuyerCashAtClosing: number;
  stackZeroOutOfPocket: "Yes" | "No" | "TBD";
  stackBaseCapitalRequired: number;
  stackAdjustedTotalCapitalRequired: number;

  // Balloon analyses (only the one matching financingMode is ever non-null)
  subjectToBalloon: (ExportBalloonAnalysis & { mortgageBalanceAtBalloon: number }) | null;
  sellerFinancingBalloon: (ExportBalloonAnalysis & { sellerFinanceBalanceAtBalloon: number }) | null;
  hybridBalloon:
    | (ExportBalloonAnalysis & { mortgageBalanceAtBalloon: number; sellerFinanceBalanceAtBalloon: number })
    | null;
  stackBalloon:
    | (ExportBalloonAnalysis & { bankBalanceAtBalloon: number; sellerBalanceAtBalloon: number })
    | null;

  // Capital required
  arrears: number;
  renovationCost: number;
  reserves: number;
  furniture: number;
  appliances: number;
  photos: number;
  upfrontInsurance: number;
  acquisitionFee: number;
  tcFee: number;
  llcFee: number;
  agentFee: number;
  assignmentFee: number;
  closingCosts: number;
  downPaymentForCapital: number;
  downPaymentLabel: string;
  holdingCosts: number;
  totalCapitalRequired: number;
  equity: number;
  equityIsNegative: boolean;
  monthlyCashFlow: number;
  annualCashFlow: number;
  cashOnCashReturn: number | null;

  // Scope of Work
  scopeOfWorkItems: ExportScopeOfWorkItem[];
  scopeOfWorkTotal: number;
  useItemizedScopeOfWork: boolean;

  // Amortization schedules: one entry per loan leg for the active
  // financing structure (Traditional/Subject To/Seller Financing: one;
  // Hybrid/Stack Method: up to two), each built from the shared
  // lib/amortization.ts engine and passed straight through -- never
  // recalculated here. Rendered as one full monthly "Amortization"
  // worksheet per leg (see addAmortizationScheduleSheets below).
  amortizationSchedules: ExportAmortizationSchedule[];

  // 30-Year ROI Projection: the same RoiProjectionResult built by
  // lib/roiProjection.ts's buildRoiProjection for the active financing
  // structure, passed straight through (never recalculated here) so the
  // Excel figures are guaranteed to match the website exactly.
  roiAppreciationPct: number;
  roiProjection: RoiProjectionResult | null;
  roiHasBalloon: boolean;
  roiBalloonYears: number;
  roiRefinanceAtBalloon: boolean;
  roiRefinanceRatePct: number;

  // Transit and Bus Stop Access: the current, purely informational
  // transit figures for the property -- found automatically via Google
  // Maps (see lib/transit/manual.ts and lib/transit/googleLookup.ts) and
  // editable by hand at any time. This module never calls any
  // transit/maps API itself and never receives an API key, so there is
  // nothing here that could leak one.
  transit: ExportTransitResult | null;
}

export interface ExportTransitResult {
  propertyAddress: string;
  nearestBusStop: string | null;
  walkingTimeMinutes: number | null;
  walkingDistanceMiles: number | null;
  transitNotes: string;
  dataSource: string; // "Google Maps (Automatic Lookup)"
}

// ---------------------------------------------------------------------
// Number formats (spec section 14)
// ---------------------------------------------------------------------
const FMT_CURRENCY = '$#,##0.00;[Red]-$#,##0.00';
const FMT_PERCENT = "0.00%";
const FMT_WHOLE = "0";
const FMT_YEARS = '0 "years"';
// The template's own accounting-style currency format, preserved as-is
// on every cell that already used it in the original workbook.
// Negative values shown in red and parentheses, zero shown as "-" --
// matches the professional underwriting template's accounting style.
const TEMPLATE_CURRENCY_FMT = '_("$"* #,##0.00_);_("$"* [Red]\\(#,##0.00\\)_);_("$"* "-"??_);_(@_)';

const COLOR_INK = "FF12181C";
const COLOR_BRASS = "FFC08A3E";
const COLOR_WHITE = "FFFFFFFF";
const FILL_INPUT: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
const FILL_RESULT: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF9BE8A6" } };
const FILL_HEADER: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_INK } };
const BORDER_THIN_BOTTOM: Partial<ExcelJS.Borders> = { bottom: { style: "thin" } };

// Standard financial-model font-color convention, applied automatically
// (never needs to be set at each call site): blue for a hardcoded,
// directly-editable input; black (the default, no override) for a
// formula that only references cells on its own sheet; green for a
// formula that links to another worksheet (e.g. 'Inputs'!C4 or
// 'Scope of Work'!C12) -- so at a glance, anyone opening the workbook
// can tell what kind of cell they're looking at without checking the
// formula bar.
const COLOR_INPUT_BLUE = "FF0000FF";
const COLOR_LINKED_GREEN = "FF008000";

function fmtLabel(cell: ExcelJS.Cell, opts?: { bold?: boolean; size?: number }) {
  cell.font = { bold: opts?.bold ?? true, size: opts?.size ?? 11, name: "Calibri" };
}
function fmtValue(cell: ExcelJS.Cell, format?: string, opts?: { emphasis?: boolean; input?: boolean }) {
  let colorArgb: string | undefined;
  const v = cell.value as unknown;
  if (opts?.input) {
    colorArgb = COLOR_INPUT_BLUE;
  } else if (v && typeof v === "object" && "formula" in (v as Record<string, unknown>)) {
    const formulaText = String((v as { formula: unknown }).formula ?? "");
    if (formulaText.includes("!")) colorArgb = COLOR_LINKED_GREEN;
  }
  cell.font = {
    bold: !!opts?.emphasis,
    size: 11,
    name: "Calibri",
    ...(colorArgb ? { color: { argb: colorArgb } } : {}),
  };
  cell.alignment = { horizontal: "right", vertical: "middle" };
  if (format) cell.numFmt = format;
  if (opts?.emphasis) {
    cell.fill = FILL_RESULT;
    cell.border = BORDER_THIN_BOTTOM;
  } else if (opts?.input) {
    cell.fill = FILL_INPUT;
  }
}

// ---------------------------------------------------------------------
// Filename sanitization (spec section 16)
// ---------------------------------------------------------------------
const FINANCING_STRUCTURE_LABELS: Record<ExportFinancingMode, string> = {
  traditional: "Traditional Financing",
  subjectTo: "Subject To",
  sellerFinancing: "Seller Financing",
  hybrid: "Subject To & Seller Finance Hybrid",
  stackMethod: "Stack Method",
};

function sanitizeFilenamePart(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildExportFilename(mode: ExportFinancingMode, propertyAddress: string): string {
  const structureLabel = FINANCING_STRUCTURE_LABELS[mode];
  const address = sanitizeFilenamePart(propertyAddress);
  const base = address ? `Underwriting - ${structureLabel} - ${address}` : `Underwriting - ${structureLabel}`;
  return `${base}.xlsx`;
}

// ---------------------------------------------------------------------
// Formatting helpers shared with the rest of the calculator's display
// logic (kept local so this module has no dependency back on the
// component file).
// ---------------------------------------------------------------------
function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
function money(n: number): number {
  return round2(n);
}
function pct(n: number): number {
  // Excel percent-formatted cells hold the raw decimal (e.g. 0.15 for 15%).
  return Number.isFinite(n) ? n / 100 : 0;
}
function fmtDollars(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtDollarsCents(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------
// Dynamic bedroom / room-rate summary string, using the exact same
// weekly-to-monthly math as the website (sharedBath/ensuite bedrooms x
// weekly rate x 52 / 12) -- never a second, independently maintained
// calculation. Matches the spec's example format:
//   "9 total bedrooms | 7 shared-bath rooms at $236/week | 2 ensuites at $285/week"
// ---------------------------------------------------------------------
function bedroomSummaryString(data: UnderwritingExportData): string {
  const parts: string[] = [`${data.totalBedrooms} total bedrooms`];
  parts.push(
    `${data.sharedBathBedrooms} shared-bath room${data.sharedBathBedrooms === 1 ? "" : "s"} at ${fmtDollarsCents(
      data.weeklySharedBathRent
    )}/week`
  );
  parts.push(
    `${data.ensuiteBedrooms} ensuite${data.ensuiteBedrooms === 1 ? "" : "s"} at ${fmtDollarsCents(
      data.weeklyEnsuiteRent
    )}/week`
  );
  return parts.join(" | ");
}

// ---------------------------------------------------------------------
// Generic key/value section writer, used by every generated (non-
// template) sheet: writes a section header row, then each row's label
// (bold, column B) and value (right-aligned, column C), optionally as a
// live formula instead of a literal value.
// ---------------------------------------------------------------------
interface KVRow {
  label: string;
  value?: number | string | null;
  formula?: string;
  format?: string;
  emphasis?: boolean;
  input?: boolean;
}
interface KVSection {
  title: string;
  rows: KVRow[];
}

function writeKeyValueSheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  sections: KVSection[]
): { ws: ExcelJS.Worksheet; rowAddress: Map<string, string> } {
  const ws = wb.addWorksheet(sheetName, { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 2.5;
  ws.getColumn(2).width = 46;
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 4;

  // Every row's cell address is recorded (by "Section Title|Row Label")
  // so other sheets can build cross-sheet formulas that reference it.
  const rowAddress = new Map<string, string>();

  let row = 2;
  for (const section of sections) {
    ws.mergeCells(row, 2, row, 3);
    const header = ws.getCell(row, 2);
    header.value = section.title;
    header.font = { bold: true, size: 13, color: { argb: COLOR_WHITE }, name: "Calibri" };
    header.fill = FILL_HEADER;
    header.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(row).height = 22;
    row++;

    for (const r of section.rows) {
      const labelCell = ws.getCell(row, 2);
      labelCell.value = r.label;
      fmtLabel(labelCell, { bold: !!r.emphasis });

      const valueCell = ws.getCell(row, 3);
      if (r.formula) {
        valueCell.value = { formula: r.formula } as ExcelJS.CellFormulaValue;
      } else {
        valueCell.value = r.value === undefined || r.value === null ? "" : r.value;
      }
      fmtValue(valueCell, r.format, { emphasis: r.emphasis, input: r.input });
      if (r.emphasis) labelCell.border = BORDER_THIN_BOTTOM;

      rowAddress.set(`${section.title}|${r.label}`, valueCell.address);
      row++;
    }
    row++; // spacer between sections
  }

  return { ws, rowAddress };
}

// ---------------------------------------------------------------------
// "Scope of Work" worksheet -- only added when at least one itemized
// line item exists. Mirrors the app's Scope of Work state exactly (name
// + cost per item), plus the total and which figure (itemized total vs.
// manually entered Renovation Cost) is actually used in underwriting, so
// the two are never double-counted as separate capital items.
// ---------------------------------------------------------------------
function addScopeOfWorkSheet(wb: ExcelJS.Workbook, data: UnderwritingExportData) {
  if (data.scopeOfWorkItems.length === 0) return;
  const ws = wb.addWorksheet("Scope of Work", { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 2.5;
  ws.getColumn(2).width = 40;
  ws.getColumn(3).width = 18;

  const header = ws.getRow(2);
  header.getCell(2).value = "Work Item";
  header.getCell(3).value = "Estimated Cost";
  [2, 3].forEach((c) => {
    const cell = header.getCell(c);
    cell.font = { bold: true, size: 11, color: { argb: COLOR_WHITE }, name: "Calibri" };
    cell.fill = FILL_HEADER;
  });
  header.height = 20;

  let row = 3;
  for (const item of data.scopeOfWorkItems) {
    ws.getCell(row, 2).value = item.name.trim() || "Untitled Item";
    fmtLabel(ws.getCell(row, 2), { bold: false });
    const costCell = ws.getCell(row, 3);
    costCell.value = money(item.cost);
    fmtValue(costCell, FMT_CURRENCY);
    row++;
  }

  const firstDataRow = 3;
  const lastDataRow = row - 1;
  row++;
  const totalLabelCell = ws.getCell(row, 2);
  totalLabelCell.value = "Total Scope of Work";
  fmtLabel(totalLabelCell, { bold: true });
  const totalCell = ws.getCell(row, 3);
  totalCell.value = { formula: `SUM(C${firstDataRow}:C${lastDataRow})` } as ExcelJS.CellFormulaValue;
  fmtValue(totalCell, FMT_CURRENCY, { emphasis: true });
  row += 2;

  const usedLabelCell = ws.getCell(row, 2);
  usedLabelCell.value = "Renovation Cost Used in Underwriting";
  fmtLabel(usedLabelCell, { bold: true });
  const usedCell = ws.getCell(row, 3);
  usedCell.value = money(data.renovationCost);
  fmtValue(usedCell, FMT_CURRENCY);
  row++;

  const sourceLabelCell = ws.getCell(row, 2);
  sourceLabelCell.value = "Renovation Cost Source";
  fmtLabel(sourceLabelCell, { bold: false });
  const sourceCell = ws.getCell(row, 3);
  sourceCell.value = data.useItemizedScopeOfWork
    ? "Automatically synced to Total Scope of Work"
    : "Manually overridden (not synced to Total Scope of Work)";
  sourceCell.font = { size: 10, italic: true, name: "Calibri" };
  sourceCell.alignment = { horizontal: "right", wrapText: true };
}

// ---------------------------------------------------------------------
// "Transit and Bus Stop Access" worksheet -- added to every export path
// whenever the underwriting page has any transit data entered
// (data.transit is non-null). Plain label/value rows only, since this
// is purely informational reference data rather than a cash-flow input
// -- no formulas needed. The nearest bus stop, walking time, and
// walking distance are found automatically via Google Maps and can be
// edited by hand at any time; this module never calls any transit/maps
// API itself and never receives an API key, so there is nothing here
// that could leak one.
// ---------------------------------------------------------------------
function addTransitSheet(wb: ExcelJS.Workbook, data: UnderwritingExportData) {
  const transit = data.transit;
  if (!transit) return;

  const ws = wb.addWorksheet("Transit and Bus Stop Access", { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 2.5;
  ws.getColumn(2).width = 34;
  ws.getColumn(3).width = 40;

  let row = 2;
  const header = ws.getCell(row, 2);
  header.value = "Transit and Bus Stop Access";
  header.font = { bold: true, size: 13, color: { argb: COLOR_WHITE }, name: "Calibri" };
  header.fill = FILL_HEADER;
  ws.mergeCells(row, 2, row, 3);
  ws.getRow(row).height = 22;
  row++;

  const writeRow = (label: string, value: string) => {
    const l = ws.getCell(row, 2);
    l.value = label;
    fmtLabel(l);
    const v = ws.getCell(row, 3);
    v.value = value;
    v.font = { size: 11, name: "Calibri" };
    v.alignment = { horizontal: "left", wrapText: true };
    row++;
  };

  writeRow("Property Address", transit.propertyAddress || "Not entered");
  writeRow("Nearest Bus Stop", transit.nearestBusStop || "Not entered");
  writeRow(
    "Walking Time (Minutes)",
    transit.walkingTimeMinutes === null ? "Not entered" : String(transit.walkingTimeMinutes)
  );
  writeRow(
    "Walking Distance (Miles)",
    transit.walkingDistanceMiles === null ? "Not entered" : String(transit.walkingDistanceMiles)
  );
  writeRow("Transit Notes", transit.transitNotes || "None entered");
  writeRow("Data Source", transit.dataSource);

  row++;
  const notice = ws.getCell(row, 2);
  ws.mergeCells(row, 2, row, 3);
  notice.value =
    "Nearest bus stop, walking time, and walking distance are looked up automatically using Google Maps and can be edited on the underwriting page. Verify sidewalks, road crossings, lighting, terrain, accessibility, stop activity, route schedules, and current bus service before acquiring the property.";
  notice.font = { italic: true, size: 9, name: "Calibri" };
  notice.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(row).height = 45;
}

// ---------------------------------------------------------------------
// "30-Year ROI Projection" worksheet -- added to every export path
// (template-based and generated alike) whenever a projection exists.
// The row-by-row figures (property values, loan balances, principal
// paydown, net cash flow) are written as plain values straight from the
// same RoiProjectionResult the website itself computed (see
// lib/roiProjection.ts), guaranteeing an exact match; the row-level
// arithmetic that is safe to recompute in Excel (Ending Property Value,
// Total Principal Paydown, Annual Total Return, Annual ROI, Cumulative
// Total Return, Cumulative ROI, Ending Total Debt, Estimated Ending
// Equity) is written as live formulas instead.
// ---------------------------------------------------------------------
function addRoiProjectionSheet(wb: ExcelJS.Workbook, data: UnderwritingExportData) {
  const projection = data.roiProjection;
  if (!projection || projection.rows.length === 0) return;

  const ws = wb.addWorksheet("30-Year ROI Projection", { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 2.5;

  const legCount = Math.max(1, projection.rows[0]?.legs.length ?? 1);
  const legLabels = (projection.rows[0]?.legs ?? []).map((l) => l.label);

  let row = 2;
  const sectionHeader = (title: string, span: number) => {
    ws.mergeCells(row, 2, row, 1 + span);
    const cell = ws.getCell(row, 2);
    cell.value = title;
    cell.font = { bold: true, size: 13, color: { argb: COLOR_WHITE }, name: "Calibri" };
    cell.fill = FILL_HEADER;
    cell.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(row).height = 22;
    row++;
  };

  sectionHeader("30-Year ROI Projection", 3);
  const writeSummaryRow = (label: string, value: number | string, format?: string) => {
    ws.getCell(row, 2).value = label;
    fmtLabel(ws.getCell(row, 2));
    const valueCell = ws.getCell(row, 3);
    valueCell.value = value;
    fmtValue(valueCell, format);
    row++;
    return `C${row - 1}`;
  };

  const disclosureCell = ws.getCell(row, 2);
  ws.mergeCells(row, 2, row, 4);
  disclosureCell.value =
    "Total ROI includes modeled net cash flow, principal paydown, and property appreciation.";
  disclosureCell.font = { italic: true, size: 10, name: "Calibri" };
  disclosureCell.alignment = { wrapText: true };
  row += 2;

  const appreciationAddr = writeSummaryRow("Annual Appreciation Assumption", pct(data.roiAppreciationPct), FMT_PERCENT);
  // Marked as an input cell (yellow fill, matching every other editable
  // assumption in this workbook): every year's Annual Appreciation and
  // Beginning Property Value formula below references this cell, so
  // changing it here recalculates the entire 30-year projection.
  ws.getCell(appreciationAddr).fill = FILL_INPUT;
  const initialCapitalAddr = writeSummaryRow(
    "Initial Total Capital Required",
    money(data.totalCapitalRequired),
    FMT_CURRENCY
  );
  writeSummaryRow("Year 1 Total ROI", projection.year1TotalRoi === null ? "N/A" : pct(projection.year1TotalRoi * 100), FMT_PERCENT);
  const yearRoi = (year: number) => projection.rows.find((r) => r.year === year)?.cumulativeRoi ?? null;
  writeSummaryRow("Year 5 Cumulative ROI", yearRoi(5) === null ? "N/A" : pct((yearRoi(5) as number) * 100), FMT_PERCENT);
  writeSummaryRow("Year 10 Cumulative ROI", yearRoi(10) === null ? "N/A" : pct((yearRoi(10) as number) * 100), FMT_PERCENT);
  writeSummaryRow("Year 30 Cumulative ROI", yearRoi(30) === null ? "N/A" : pct((yearRoi(30) as number) * 100), FMT_PERCENT);

  if (data.roiHasBalloon) {
    writeSummaryRow("Balloon Due in Year", data.roiBalloonYears, FMT_WHOLE);
    writeSummaryRow("Refinance at Balloon", data.roiRefinanceAtBalloon ? "Yes" : "No");
    if (data.roiRefinanceAtBalloon) {
      writeSummaryRow("Replacement Interest Rate", pct(data.roiRefinanceRatePct), FMT_PERCENT);
      writeSummaryRow("Replacement Loan Amortization", 30, FMT_YEARS);
    } else {
      const warnCell = ws.getCell(row, 2);
      ws.mergeCells(row, 2, row, 4);
      warnCell.value = `Balloon Due in Year ${data.roiBalloonYears}: financing is modeled as unresolved after that date. No further principal paydown is projected once the balloon comes due.`;
      warnCell.font = { italic: true, size: 10, color: { argb: "FFB00020" }, name: "Calibri" };
      warnCell.alignment = { wrapText: true };
      row++;
    }
  }
  row += 1;

  // ---- Column headers -------------------------------------------------
  const headerRow = row;
  const cols: string[] = ["Year", "Beginning Property Value", "Annual Appreciation", "Ending Property Value"];
  for (let i = 0; i < legCount; i++) {
    const label = legLabels[i] || `Loan ${i + 1}`;
    cols.push(`${label} Beginning Balance`, `${label} Principal Paydown`, `${label} Ending Balance`);
  }
  cols.push(
    "Total Annual Principal Paydown",
    "Annual Net Cash Flow",
    "Annual Total Return",
    "Annual ROI",
    "Cumulative Total Return",
    "Cumulative ROI",
    "Ending Total Debt",
    "Estimated Ending Equity"
  );
  cols.forEach((label, i) => {
    const cell = ws.getCell(headerRow, 2 + i);
    cell.value = label;
    cell.font = { bold: true, size: 9, color: { argb: COLOR_WHITE }, name: "Calibri" };
    cell.fill = FILL_HEADER;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  ws.getRow(headerRow).height = 32;
  // Freeze the header row (and the Year column) so both stay visible
  // while scrolling through all 30 rows.
  ws.views = [{ state: "frozen", ySplit: headerRow, xSplit: 2, showGridLines: false }];

  const colIndex = {
    year: 2,
    begPropVal: 3,
    appreciation: 4,
    endPropVal: 5,
  };
  const legStartCol = 6; // first leg's Beginning Balance column
  const afterLegsCol = legStartCol + legCount * 3;
  const totalPaydownCol = afterLegsCol;
  const netCashFlowCol = afterLegsCol + 1;
  const totalReturnCol = afterLegsCol + 2;
  const annualRoiCol = afterLegsCol + 3;
  const cumReturnCol = afterLegsCol + 4;
  const cumRoiCol = afterLegsCol + 5;
  const endingDebtCol = afterLegsCol + 6;
  const endingEquityCol = afterLegsCol + 7;

  // Absolute reference to the Initial Total Capital Required cell (e.g.
  // "C10" -> "$C$10"), reused unchanged as the denominator for every
  // year's Annual ROI and Cumulative ROI formula, exactly per spec
  // ("Use the original Total Capital Required as the denominator for
  // all 30 years. Do not change the denominator each year.").
  const initialCapitalAbs = initialCapitalAddr.replace("C", "$C$");
  const appreciationAbs = appreciationAddr.replace("C", "$C$");

  let dataRow = headerRow + 1;
  for (const yearRow of projection.rows) {
    const r = dataRow;
    ws.getCell(r, colIndex.year).value = yearRow.year;
    fmtValue(ws.getCell(r, colIndex.year), FMT_WHOLE);
    ws.getCell(r, colIndex.year).alignment = { horizontal: "center" };
    if (yearRow.isBalloonYear) ws.getCell(r, colIndex.year).note = "Balloon due at the end of this year.";
    if (yearRow.balloonUnresolved) {
      ws.getRow(r).eachCell({ includeEmpty: true }, (cell) => {
        if (!cell.fill || (cell.fill as ExcelJS.FillPattern).fgColor?.argb !== COLOR_INK) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDEAEA" } };
        }
      });
    }

    // Beginning Property Value: Year 1 is the purchase price (a plain
    // value); every later year references the PRIOR row's Ending
    // Property Value formula, so the whole chain recalculates whenever
    // the appreciation input cell changes. Annual Appreciation is always
    // a formula (Beginning Property Value x the appreciation input
    // cell) -- never a hard-coded percentage -- so editing that one
    // input cell cascades through every year's appreciation, ending
    // property value, next year's beginning property value, total
    // return, annual ROI, cumulative return/ROI, and estimated equity.
    const begPropCell = ws.getCell(r, colIndex.begPropVal);
    if (r === headerRow + 1) {
      begPropCell.value = money(yearRow.beginningPropertyValue);
    } else {
      begPropCell.value = { formula: `${colLetter(colIndex.endPropVal)}${r - 1}` } as ExcelJS.CellFormulaValue;
    }
    fmtValue(begPropCell, FMT_CURRENCY);

    const appreciationCell = ws.getCell(r, colIndex.appreciation);
    appreciationCell.value = {
      formula: `${colLetter(colIndex.begPropVal)}${r}*${appreciationAbs}`,
    } as ExcelJS.CellFormulaValue;
    fmtValue(appreciationCell, FMT_CURRENCY);

    const endPropCell = ws.getCell(r, colIndex.endPropVal);
    endPropCell.value = { formula: `${colLetter(colIndex.begPropVal)}${r}+${colLetter(colIndex.appreciation)}${r}` } as ExcelJS.CellFormulaValue;
    fmtValue(endPropCell, FMT_CURRENCY);

    for (let i = 0; i < legCount; i++) {
      const leg = yearRow.legs[i];
      const begCol = legStartCol + i * 3;
      const paydownCol = begCol + 1;
      const endCol = begCol + 2;
      const begCell = ws.getCell(r, begCol);
      begCell.value = money(leg?.beginningBalance ?? 0);
      fmtValue(begCell, FMT_CURRENCY);
      const paydownCell = ws.getCell(r, paydownCol);
      paydownCell.value = money(leg?.principalPaydown ?? 0);
      fmtValue(paydownCell, FMT_CURRENCY);
      const endCell = ws.getCell(r, endCol);
      endCell.value = {
        formula: `${colLetter(begCol)}${r}-${colLetter(paydownCol)}${r}`,
      } as ExcelJS.CellFormulaValue;
      fmtValue(endCell, FMT_CURRENCY);
    }

    const paydownRefs = Array.from({ length: legCount }, (_, i) => `${colLetter(legStartCol + i * 3 + 1)}${r}`);
    const totalPaydownCell = ws.getCell(r, totalPaydownCol);
    totalPaydownCell.value = { formula: paydownRefs.join("+") } as ExcelJS.CellFormulaValue;
    fmtValue(totalPaydownCell, FMT_CURRENCY);

    const cashFlowCell = ws.getCell(r, netCashFlowCol);
    cashFlowCell.value = money(yearRow.annualNetCashFlow);
    fmtValue(cashFlowCell, FMT_CURRENCY);

    const totalReturnCell = ws.getCell(r, totalReturnCol);
    totalReturnCell.value = {
      formula: `${colLetter(netCashFlowCol)}${r}+${colLetter(totalPaydownCol)}${r}+${colLetter(colIndex.appreciation)}${r}`,
    } as ExcelJS.CellFormulaValue;
    fmtValue(totalReturnCell, FMT_CURRENCY, { emphasis: true });

    const annualRoiCell = ws.getCell(r, annualRoiCol);
    annualRoiCell.value = {
      formula: `IF(${initialCapitalAbs}=0,"N/A",${colLetter(totalReturnCol)}${r}/${initialCapitalAbs})`,
    } as ExcelJS.CellFormulaValue;
    fmtValue(annualRoiCell, FMT_PERCENT);

    const cumReturnCell = ws.getCell(r, cumReturnCol);
    if (r === headerRow + 1) {
      cumReturnCell.value = { formula: `${colLetter(totalReturnCol)}${r}` } as ExcelJS.CellFormulaValue;
    } else {
      cumReturnCell.value = {
        formula: `${colLetter(cumReturnCol)}${r - 1}+${colLetter(totalReturnCol)}${r}`,
      } as ExcelJS.CellFormulaValue;
    }
    fmtValue(cumReturnCell, FMT_CURRENCY);

    const cumRoiCell = ws.getCell(r, cumRoiCol);
    cumRoiCell.value = {
      formula: `IF(${initialCapitalAbs}=0,"N/A",${colLetter(cumReturnCol)}${r}/${initialCapitalAbs})`,
    } as ExcelJS.CellFormulaValue;
    fmtValue(cumRoiCell, FMT_PERCENT, { emphasis: true });

    const endingDebtRefs = Array.from({ length: legCount }, (_, i) => `${colLetter(legStartCol + i * 3 + 2)}${r}`);
    const endingDebtCell = ws.getCell(r, endingDebtCol);
    endingDebtCell.value = { formula: endingDebtRefs.join("+") } as ExcelJS.CellFormulaValue;
    fmtValue(endingDebtCell, FMT_CURRENCY);

    const endingEquityCell = ws.getCell(r, endingEquityCol);
    endingEquityCell.value = {
      formula: `${colLetter(colIndex.endPropVal)}${r}-${colLetter(endingDebtCol)}${r}`,
    } as ExcelJS.CellFormulaValue;
    fmtValue(endingEquityCell, FMT_CURRENCY);

    dataRow++;
  }

  // Column widths: narrower for Year, generous for everything else.
  ws.getColumn(colIndex.year).width = 8;
  for (let c = 3; c <= endingEquityCol; c++) {
    ws.getColumn(c).width = 15;
  }

  if (legCount < 2) {
    const footnote = ws.getCell(dataRow + 1, 2);
    footnote.value =
      "This structure has a single amortizing debt, so only one loan's beginning/paydown/ending balance columns apply.";
    footnote.font = { italic: true, size: 9, name: "Calibri" };
  }
  if (data.roiHasBalloon && data.roiRefinanceAtBalloon) {
    const footnote = ws.getCell(dataRow + 2, 2);
    footnote.value = `Beginning the year after the Year ${data.roiBalloonYears} balloon, the combined outstanding balance is refinanced into one replacement loan, shown under the first loan's columns; any second loan's columns show $0 from that point forward.`;
    footnote.font = { italic: true, size: 9, name: "Calibri" };
    ws.mergeCells(dataRow + 2, 2, dataRow + 2, 6);
  }
}

// Converts a 1-based column index into its Excel letter (2 -> B, 27 -> AA).
function colLetter(col: number): string {
  let n = col;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

// ---------------------------------------------------------------------
// Amortization Schedule worksheets: one per loan leg (see
// data.amortizationSchedules), added to every exported workbook
// regardless of financing structure. Each worksheet gets the required
// estimation disclosure at the top when the leg is Subject-To or
// Hybrid's existing-mortgage portion, a full monthly schedule (never
// truncated), and a balloon-due highlight row when applicable. Every
// row's Beginning Balance (after the first), Total Payment, and Ending
// Balance are live Excel formulas chained off the prior row and this
// row's own Principal/Interest cells; Principal and Interest themselves
// are written as values, since they come from lib/amortization.ts's
// authoritative declining-balance math (including its final-payment
// rounding adjustment), which this sheet passes through rather than
// re-derives. Taxes and insurance are never part of any of these
// schedules -- they do not reduce principal or count as interest.
// ---------------------------------------------------------------------
function addAmortizationScheduleSheets(wb: ExcelJS.Workbook, data: UnderwritingExportData) {
  for (const leg of data.amortizationSchedules) {
    if (leg.rows.length === 0) continue;
    const ws = wb.addWorksheet(leg.sheetName, { views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 2.5;

    let row = 2;
    const header = ws.getCell(row, 2);
    ws.mergeCells(row, 2, row, 7);
    header.value = leg.title;
    header.font = { bold: true, size: 13, color: { argb: COLOR_WHITE }, name: "Calibri" };
    header.fill = FILL_HEADER;
    header.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(row).height = 22;
    row++;

    if (leg.disclosure) {
      const disclosureCell = ws.getCell(row, 2);
      ws.mergeCells(row, 2, row, 7);
      disclosureCell.value = leg.disclosure;
      disclosureCell.font = { italic: true, size: 9, name: "Calibri" };
      disclosureCell.alignment = { wrapText: true, vertical: "top" };
      ws.getRow(row).height = 45;
      row++;
    }
    row++;

    const headerRow = row;
    const cols = [
      "Payment #",
      "Payment Date (Est.)",
      "Beginning Balance",
      "Scheduled Payment",
      "Principal",
      "Interest",
      "Ending Balance",
    ];
    cols.forEach((label, i) => {
      const cell = ws.getCell(headerRow, 2 + i);
      cell.value = label;
      cell.font = { bold: true, size: 9, color: { argb: COLOR_WHITE }, name: "Calibri" };
      cell.fill = FILL_HEADER;
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
    ws.getRow(headerRow).height = 28;
    ws.views = [{ state: "frozen", ySplit: headerRow, showGridLines: false }];

    const colIndex = { num: 2, date: 3, beg: 4, payment: 5, principal: 6, interest: 7, end: 8 };
    const exportedAt = new Date();
    let dataRow = headerRow + 1;
    for (const r of leg.rows) {
      const rr = dataRow;
      ws.getCell(rr, colIndex.num).value = r.paymentNumber;
      fmtValue(ws.getCell(rr, colIndex.num), FMT_WHOLE);
      ws.getCell(rr, colIndex.num).alignment = { horizontal: "center" };

      const dateCell = ws.getCell(rr, colIndex.date);
      if (rr === headerRow + 1) {
        const startDate = new Date(exportedAt.getFullYear(), exportedAt.getMonth(), 1);
        dateCell.value = startDate;
      } else {
        dateCell.value = { formula: `EDATE(${colLetter(colIndex.date)}${rr - 1},1)` } as ExcelJS.CellFormulaValue;
      }
      dateCell.numFmt = "mm/dd/yyyy";
      dateCell.alignment = { horizontal: "center" };

      const begCell = ws.getCell(rr, colIndex.beg);
      if (rr === headerRow + 1) {
        begCell.value = money(r.beginningBalance);
      } else {
        begCell.value = { formula: `${colLetter(colIndex.end)}${rr - 1}` } as ExcelJS.CellFormulaValue;
      }
      fmtValue(begCell, FMT_CURRENCY);

      const principalCell = ws.getCell(rr, colIndex.principal);
      principalCell.value = money(r.principalPaid);
      fmtValue(principalCell, FMT_CURRENCY);

      const interestCell = ws.getCell(rr, colIndex.interest);
      interestCell.value = money(r.interestPaid);
      fmtValue(interestCell, FMT_CURRENCY);

      const paymentCell = ws.getCell(rr, colIndex.payment);
      paymentCell.value = {
        formula: `${colLetter(colIndex.principal)}${rr}+${colLetter(colIndex.interest)}${rr}`,
      } as ExcelJS.CellFormulaValue;
      fmtValue(paymentCell, FMT_CURRENCY);

      const endCell = ws.getCell(rr, colIndex.end);
      endCell.value = {
        formula: `${colLetter(colIndex.beg)}${rr}-${colLetter(colIndex.principal)}${rr}`,
      } as ExcelJS.CellFormulaValue;
      fmtValue(endCell, FMT_CURRENCY);

      if (leg.balloonAtPaymentNumber != null && r.paymentNumber === leg.balloonAtPaymentNumber) {
        for (let c = 2; c <= 8; c++) {
          ws.getCell(rr, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDEAEA" } };
        }
        ws.getCell(rr, colIndex.num).note = "Balloon due at this payment.";
      }

      dataRow++;
    }

    ws.getColumn(colIndex.num).width = 10;
    ws.getColumn(colIndex.date).width = 15;
    for (let c = colIndex.beg; c <= colIndex.end; c++) {
      ws.getColumn(c).width = 16;
    }
  }
}

// ---------------------------------------------------------------------
// Balloon analysis rows, shared by both export paths -- mirrors
// balloonAnalysisRows() in the component so the same figures, in the
// same order, appear in Excel as on the printable report / on-page
// breakdown.
// ---------------------------------------------------------------------
function balloonRows(
  analysis: ExportBalloonAnalysis,
  loanBalanceRows: { label: string; value: number }[]
): KVRow[] {
  const rows: KVRow[] = [
    { label: "Balloon Exists", value: "Yes" },
    { label: "Balloon Due in Years", value: analysis.balloonYears, format: FMT_YEARS },
    { label: "Annual Property Appreciation", value: pct(analysis.appreciationPct), format: FMT_PERCENT },
    { label: "Current Purchase Price", value: money(analysis.purchasePrice), format: FMT_CURRENCY },
    {
      label: "Projected Appraised Value at Balloon",
      value: money(analysis.projectedAppraisedValue),
      format: FMT_CURRENCY,
    },
  ];
  for (const r of loanBalanceRows) {
    rows.push({ label: r.label, value: money(r.value), format: FMT_CURRENCY });
  }
  rows.push(
    { label: "Total Projected Debt at Balloon", value: money(analysis.projectedDebtAtBalloon), format: FMT_CURRENCY },
    { label: "Maximum Debt at 70% LTV", value: money(analysis.maxDebtAt70Ltv), format: FMT_CURRENCY },
    {
      label: "Projected LTV at Balloon",
      value: analysis.projectedLtv === null ? "N/A" : pct(analysis.projectedLtv * 100),
      format: analysis.projectedLtv === null ? undefined : FMT_PERCENT,
    },
    { label: "Estimated Equity Cushion", value: money(analysis.equityCushion), format: FMT_CURRENCY },
    { label: "70% LTV Refinance Contingency", value: analysis.has70LtvContingency ? "Yes" : "No" }
  );
  if (!analysis.has70LtvContingency) {
    rows.push({ label: "70% LTV Refinance Status", value: "No 70% LTV refinance contingency has been selected." });
  } else if (analysis.meets70Ltv) {
    rows.push({ label: "70% LTV Refinance Status", value: "Meets the 70% LTV refinance contingency." });
  } else {
    rows.push({ label: "70% LTV Refinance Status", value: "Does not meet the 70% LTV refinance contingency." });
  }
  return rows;
}

// Stack Method only (for now): mirrors stackEstimatedCashRequiredToRefinance()
// / stackRefinanceMessage() in SharedHousingCalculator.tsx exactly, kept as
// its own copy here so this module has no dependency back on the component
// file (same pattern as lib/roiProjection.ts's amortization helper).
function stackCashRequiredToRefinance(analysis: ExportBalloonAnalysis): number {
  return Math.max(0, -analysis.equityCushion);
}

function stackRefinanceMessageLines(analysis: ExportBalloonAnalysis): string[] {
  const ltvText = analysis.projectedLtv === null ? "N/A" : `${(analysis.projectedLtv * 100).toFixed(2)}%`;
  const cashRequired = stackCashRequiredToRefinance(analysis);
  const aboveSeventy = analysis.meets70Ltv === false;

  if (aboveSeventy) {
    const lines: string[] = [
      `Warning: The projected LTV at the ${analysis.balloonYears}-year balloon is ${ltvText}, which is above 70%. Based on a refinance limited to 70% LTV, the estimated refinance proceeds would be ${fmtDollarsCents(
        money(analysis.maxDebtAt70Ltv)
      )} and the projected debt due would be ${fmtDollarsCents(
        money(analysis.projectedDebtAtBalloon)
      )}. You may need to bring approximately ${fmtDollarsCents(
        money(cashRequired)
      )} to closing to pay off the balloon, before lender fees and other refinance costs.`,
    ];
    if (analysis.has70LtvContingency) {
      lines.push("This financing structure does not currently satisfy the selected 70% LTV refinance contingency.");
      if (analysis.recommendedYears !== null) {
        lines.push(
          `To reach a projected LTV of 70% or less under the current assumptions, the estimated minimum balloon term is ${
            analysis.recommendedYears
          } years, with a projected LTV of ${
            analysis.projectedLtvAtRecommended === null ? "N/A" : `${(analysis.projectedLtvAtRecommended * 100).toFixed(2)}%`
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
    return lines;
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
  return lines;
}

// Stack Method only (for now): the relabeled/expanded row set from spec
// (Maximum Refinance Proceeds at 70% LTV, Estimated Refinance Surplus /
// Shortfall, Estimated Cash Required to Refinance, Recommended Minimum
// Balloon Term when applicable, and the full warning/success message).
function stackBalloonRows(analysis: ExportBalloonAnalysis, loanBalanceRows: { label: string; value: number }[]): KVRow[] {
  const rows: KVRow[] = [
    { label: "Balloon Exists", value: "Yes" },
    { label: "Balloon Due in Years", value: analysis.balloonYears, format: FMT_YEARS },
    { label: "Annual Property Appreciation", value: pct(analysis.appreciationPct), format: FMT_PERCENT },
    { label: "Current Purchase Price", value: money(analysis.purchasePrice), format: FMT_CURRENCY },
    {
      label: "Projected Appraised Value at Balloon",
      value: money(analysis.projectedAppraisedValue),
      format: FMT_CURRENCY,
    },
  ];
  for (const r of loanBalanceRows) {
    rows.push({ label: r.label, value: money(r.value), format: FMT_CURRENCY });
  }
  rows.push(
    { label: "Total Projected Debt at Balloon", value: money(analysis.projectedDebtAtBalloon), format: FMT_CURRENCY },
    { label: "Maximum Refinance Proceeds at 70% LTV", value: money(analysis.maxDebtAt70Ltv), format: FMT_CURRENCY },
    {
      label: "Projected LTV at Balloon",
      value: analysis.projectedLtv === null ? "N/A" : pct(analysis.projectedLtv * 100),
      format: analysis.projectedLtv === null ? undefined : FMT_PERCENT,
    },
    {
      label: "Estimated Refinance Surplus / Shortfall",
      value: money(analysis.equityCushion),
      format: FMT_CURRENCY,
    },
    {
      label: "Estimated Cash Required to Refinance",
      value: money(stackCashRequiredToRefinance(analysis)),
      format: FMT_CURRENCY,
    },
    { label: "70% LTV Refinance Contingency", value: analysis.has70LtvContingency ? "Yes" : "No" }
  );

  const messageLines = stackRefinanceMessageLines(analysis);
  rows.push({ label: "70% LTV Refinance Status", value: messageLines.join(" ") });

  if (analysis.meets70Ltv === false && analysis.has70LtvContingency) {
    if (analysis.recommendedYears !== null) {
      rows.push(
        { label: "Recommended Minimum Balloon Term", value: analysis.recommendedYears, format: FMT_YEARS },
        {
          label: "Projected LTV at Recommended Term",
          value: analysis.projectedLtvAtRecommended === null ? "N/A" : pct(analysis.projectedLtvAtRecommended * 100),
          format: analysis.projectedLtvAtRecommended === null ? undefined : FMT_PERCENT,
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

function activeBalloon(data: UnderwritingExportData): { rows: KVRow[] } | null {
  if (data.financingMode === "subjectTo" && data.subjectToBalloon) {
    return {
      rows: balloonRows(data.subjectToBalloon, [
        { label: "Projected Existing Mortgage Balance at Balloon", value: data.subjectToBalloon.mortgageBalanceAtBalloon },
      ]),
    };
  }
  if (data.financingMode === "sellerFinancing" && data.sellerFinancingBalloon) {
    return {
      rows: balloonRows(data.sellerFinancingBalloon, [
        { label: "Projected Seller-Finance Balance at Balloon", value: data.sellerFinancingBalloon.sellerFinanceBalanceAtBalloon },
      ]),
    };
  }
  if (data.financingMode === "hybrid" && data.hybridBalloon) {
    return {
      rows: balloonRows(data.hybridBalloon, [
        { label: "Existing Mortgage Balance at Balloon", value: data.hybridBalloon.mortgageBalanceAtBalloon },
        { label: "Seller-Finance Balance at Balloon", value: data.hybridBalloon.sellerFinanceBalanceAtBalloon },
      ]),
    };
  }
  if (data.financingMode === "stackMethod" && data.stackBalloon) {
    return {
      rows: stackBalloonRows(data.stackBalloon, [
        { label: "First-Position Loan Balance at Balloon", value: data.stackBalloon.bankBalanceAtBalloon },
        { label: "Seller-Finance Balance at Balloon", value: data.stackBalloon.sellerBalanceAtBalloon },
      ]),
    };
  }
  return null;
}

// Lower-level row writer used both by writeKeyValueSheet (above, for
// generated-workbook sheets) and by the template's rebuilt right-hand
// "Financing Information" panel (which lives in an existing worksheet,
// at a caller-specified column pair, not its own new sheet).
function writeKVBlock(
  ws: ExcelJS.Worksheet,
  startRow: number,
  labelCol: number,
  valueCol: number,
  rows: KVRow[]
): number {
  let row = startRow;
  for (const r of rows) {
    const labelCell = ws.getCell(row, labelCol);
    labelCell.value = r.label;
    fmtLabel(labelCell, { bold: !!r.emphasis });
    const valueCell = ws.getCell(row, valueCol);
    if (r.formula) {
      valueCell.value = { formula: r.formula } as ExcelJS.CellFormulaValue;
    } else {
      valueCell.value = r.value === undefined || r.value === null ? "" : r.value;
    }
    fmtValue(valueCell, r.format, { emphasis: r.emphasis, input: r.input });
    if (r.emphasis) labelCell.border = BORDER_THIN_BOTTOM;
    row++;
  }
  return row;
}

// ---------------------------------------------------------------------
// TEMPLATE-STYLE PATH: Subject To, Seller Financing, and Subject To &
// Seller Finance Hybrid. Built directly with ExcelJS (rather than
// loading and mutating a static .xlsx template file) so every label,
// formula, fill, border, and column width can be controlled precisely
// and consistently across all three financing structures -- the visual
// design (borders, yellow input cells, green result cells, accounting
// currency format) matches the attached reference workbook exactly,
// while every formula is corrected and, where the reference workbook
// only had a pasted-in number, replaced with a genuine Excel formula
// referencing the "Inputs" worksheet built alongside it.
// ---------------------------------------------------------------------

// Whether the Primary Monthly Payment in E3 already includes taxes and
// insurance (PITI) or is Principal-and-Interest only. Subject To and
// Seller Financing share the exact same "Monthly Loan Payment Type"
// toggle on the website (paymentType), so which one applies is never
// hardcoded by financing structure -- only Hybrid is fixed, since its
// Subject-To payment (hybridSubjectToPITI) is always collected as one
// all-in PITI figure with no separate P&I-only variant.
function underwritingE3IsPiti(data: UnderwritingExportData): boolean {
  if (data.financingMode === "hybrid") return true;
  // Traditional and Stack Method always put a Principal-and-Interest-only
  // figure in E3 (traditionalMonthlyPI / stackBankMonthlyPI) and show
  // Annual Insurance / Annual Property Taxes as their own separate rows
  // instead -- never a blended PITI figure -- so taxes and insurance are
  // added back in below rather than assumed already included.
  if (data.financingMode === "traditional" || data.financingMode === "stackMethod") return false;
  // Seller Financing always uses Monthly Principal & Interest only --
  // there is no PITI/Payment Type option for this structure, and its
  // payment must never be treated as already including taxes/insurance.
  if (data.financingMode === "sellerFinancing") return false;
  return data.paymentType === "piti";
}

// ---------------------------------------------------------------------
// "Inputs" worksheet -- backs the genuine Excel formulas in the main
// Underwriting sheet's Annual Maintenance / Annual Utilities / Annual
// Insurance / Annual Property Taxes / Annual Cleaning-Lawn-Pest cells
// with clearly labeled, traceable source values (matching the
// website's underwriting inputs exactly), so clicking any of those
// cells shows a real calculation or a direct cell link in the formula
// bar rather than a pasted-in final number.
// ---------------------------------------------------------------------
interface InputsSheetAddresses {
  totalBedrooms: string;
  utilityCostPerBedroom: string;
  monthlyMaintenance: string;
  monthlyCleaning: string;
  monthlyLawnCare: string;
  monthlyPestControl: string;
  annualInsurance: string;
  annualPropertyTaxes: string;
  sharedBathBedrooms: string;
  weeklySharedBathRent: string;
  ensuiteBedrooms: string;
  weeklyEnsuiteRent: string;
}

// $80/bedroom/month is a fixed, sitewide utilities assumption (see
// SharedHousingCalculator.tsx's UTILITIES_PER_BEDROOM constant), not a
// per-export input -- written here as its own labeled, traceable
// Inputs-sheet row for the same reason Annual Maintenance's fixed
// $400/month assumption gets one below, rather than being buried
// unlabeled inside a formula.
const UTILITIES_PER_BEDROOM_MONTHLY = 80;

function addInputsSheet(wb: ExcelJS.Workbook, data: UnderwritingExportData): InputsSheetAddresses {
  const ws = wb.addWorksheet("Inputs", { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 2.5;
  ws.getColumn(2).width = 42;
  ws.getColumn(3).width = 18;

  let row = 2;
  const header = ws.getCell(row, 2);
  ws.mergeCells(row, 2, row, 3);
  header.value = "Underwriting Inputs";
  header.font = { bold: true, size: 13, color: { argb: COLOR_WHITE }, name: "Calibri" };
  header.fill = FILL_HEADER;
  header.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(row).height = 22;
  row++;

  const note = ws.getCell(row, 2);
  ws.mergeCells(row, 2, row, 3);
  note.value =
    'Source values referenced by formulas on the "Underwriting" sheet (Annual Maintenance, Annual Utilities, Annual Insurance, Annual Property Taxes, Annual Cleaning / Lawn / Pest Control). Matches the website\'s underwriting inputs exactly.';
  note.font = { italic: true, size: 9, name: "Calibri" };
  note.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(row).height = 30;
  row += 2;

  const addr = {} as InputsSheetAddresses;
  const writeInput = (key: keyof InputsSheetAddresses, label: string, value: number, format: string) => {
    const labelCell = ws.getCell(row, 2);
    labelCell.value = label;
    fmtLabel(labelCell, { bold: false });
    const valueCell = ws.getCell(row, 3);
    valueCell.value = value;
    fmtValue(valueCell, format, { input: true });
    addr[key] = `C${row}`;
    row++;
  };

  writeInput("totalBedrooms", "Total Bedrooms", data.totalBedrooms, FMT_WHOLE);
  writeInput("utilityCostPerBedroom", "Utility Cost per Bedroom (Monthly)", UTILITIES_PER_BEDROOM_MONTHLY, FMT_CURRENCY);
  writeInput("monthlyMaintenance", "Monthly Maintenance", money(data.maintenanceMonthly), FMT_CURRENCY);
  writeInput("monthlyCleaning", "Monthly Cleaning", money(data.cleaningMonthly), FMT_CURRENCY);
  writeInput("monthlyLawnCare", "Monthly Lawn Care", money(data.lawnCareMonthly), FMT_CURRENCY);
  writeInput("monthlyPestControl", "Monthly Pest Control", money(data.pestControlMonthly), FMT_CURRENCY);
  writeInput("annualInsurance", "Annual Property Insurance", money(data.annualPropertyInsurance), FMT_CURRENCY);
  writeInput("annualPropertyTaxes", "Annual Property Taxes", money(data.annualPropertyTaxes), FMT_CURRENCY);
  writeInput("sharedBathBedrooms", "Shared-Bath Bedrooms", data.sharedBathBedrooms, FMT_WHOLE);
  writeInput("weeklySharedBathRent", "Weekly Shared-Bath Rent", money(data.weeklySharedBathRent), FMT_CURRENCY);
  writeInput("ensuiteBedrooms", "Ensuite Bedrooms", data.ensuiteBedrooms, FMT_WHOLE);
  writeInput("weeklyEnsuiteRent", "Weekly Ensuite Rent", money(data.weeklyEnsuiteRent), FMT_CURRENCY);

  return addr;
}

// Turns a resolved EffectiveAmortizationTerm into a short, readable
// phrase for the Financing Notes summary text -- never invents a
// fallback term (e.g. "30 years") when one cannot be determined, per
// the remaining-amortization-is-optional requirement: an explicitly
// entered term is stated plainly, a mathematically estimated term is
// always labeled as an estimate, and an unresolvable term says so
// rather than silently omitting the detail.
function amortizationTermPhrase(term: EffectiveAmortizationTerm): string {
  if (term.months === null) {
    return "remaining amortization not yet provided";
  }
  const years = Math.round((term.months / 12) * 10) / 10;
  return term.isEstimated
    ? `an estimated ${years} years remaining amortization (estimated from the entered payment)`
    : `${years} years remaining amortization`;
}

// Short, readable summary written into the main sheet's Financing Notes
// text box -- the full itemized breakdown always lives on the
// "Financing Details" worksheet; this is just an at-a-glance summary
// visible on the same one-page sheet as the numbers it explains.
function financingNotesText(data: UnderwritingExportData): string {
  const paymentTypeNote =
    data.paymentType === "piti"
      ? "PITI (taxes and insurance included in the payment above)"
      : "Principal and Interest only (taxes and insurance added separately)";

  if (data.financingMode === "subjectTo") {
    return (
      `Subject To existing financing. Existing mortgage balance ${fmtDollarsCents(money(data.loanBalance))} at ` +
      `${data.loanInterestRatePct.toFixed(2)}% interest, ${amortizationTermPhrase(data.subjectToEffectiveAmortization)}. ` +
      `Monthly payment type: ${paymentTypeNote}. Seller down payment: ` +
      `${fmtDollarsCents(money(data.sellerDownPayment))}. See the "Financing Details" worksheet for the complete breakdown.`
    );
  }
  if (data.financingMode === "sellerFinancing") {
    return (
      `Seller-financed purchase. Loan balance ${fmtDollarsCents(money(data.sellerFinancingLoanBalance))} ` +
      `(${data.sellerFinancingLoanBalanceIsManual ? "manually overridden" : "automatically calculated as Purchase Price minus Down Payment"}) at ` +
      `${data.sellerFinancingInterestRatePct.toFixed(2)}% interest, ${data.sellerFinancingAmortizationYears}-year ` +
      `amortization (${data.sellerFinancingAmortizationYears * 12} monthly payments). Monthly Principal & Interest: ` +
      `${fmtDollarsCents(money(data.sellerFinancingMonthlyPI))} (principal and interest only -- taxes and insurance ` +
      `are always shown and added separately, never blended into this payment, and this structure never uses PITI). ` +
      `Down payment: ${fmtDollarsCents(money(data.sellerFinancingDownPaymentAmount))} ` +
      `(${data.sellerFinancingDownPaymentPct.toFixed(2)}% of purchase price). See the "Financing Details" worksheet ` +
      `for the complete breakdown.`
    );
  }
  if (data.financingMode === "traditional") {
    return (
      `Traditional financing. Estimated loan balance ${fmtDollarsCents(money(data.traditionalLoanBalance))} at ` +
      `${data.traditionalInterestRatePct.toFixed(2)}% interest, 30-year amortization (360 monthly payments). ` +
      `Monthly Principal and Interest: ${fmtDollarsCents(money(data.traditionalMonthlyPI))} (taxes and insurance ` +
      `are shown as separate line items above and added to arrive at Total Monthly Housing Payment, never ` +
      `blended into this payment). Estimated down payment: ${fmtDollarsCents(money(data.traditionalDownPaymentAmount))} ` +
      `(${data.traditionalDownPaymentPct.toFixed(2)}% of purchase price). See the "Financing Details" worksheet ` +
      `for the complete breakdown.`
    );
  }
  if (data.financingMode === "stackMethod") {
    const secondPart = data.stackSellerFinancePaymentsRequired
      ? `Seller-carried second: balance ${fmtDollarsCents(money(data.stackSellerFinancedBalance))} at ` +
        `${data.stackSellerFinanceRatePct.toFixed(2)}% interest, monthly payment ` +
        `${fmtDollarsCents(money(data.stackMonthlySellerFinancePayment))}, ${data.stackSellerFinanceAmortizationYears}-year amortization.`
      : `Seller-carried second: balance ${fmtDollarsCents(money(data.stackSellerFinancedBalance))}, with no ` +
        `monthly payments required.`;
    return (
      `Stack Method: two separate, never-blended loans. Primary Bank/DSCR loan: balance ` +
      `${fmtDollarsCents(money(data.stackBankLoanAmount))} at ${data.stackBankInterestRatePct.toFixed(2)}% interest, ` +
      `monthly Principal and Interest ${fmtDollarsCents(money(data.stackBankMonthlyPI))}, ${data.stackBankAmortizationYears}-year ` +
      `amortization (taxes and insurance are shown as separate line items above, never blended into this payment). ` +
      `${secondPart} Combined financing: ${fmtDollarsCents(money(data.stackTotalDebtAtAcquisition))}. Down payment to seller: ` +
      `${fmtDollarsCents(money(data.stackDownPaymentToSeller))}. See the "Financing Details" worksheet for the complete ` +
      `per-loan breakdown, including balloon term and refinance contingency status.`
    );
  }
  // Hybrid
  const sellerFinancePart = data.hybridSellerFinancePaymentsRequired
    ? `Seller-financed balance ${fmtDollarsCents(money(data.hybridSellerFinancedBalanceUsed))} at ` +
      `${data.hybridSellerFinanceRatePct.toFixed(2)}% interest, monthly payment ` +
      `${fmtDollarsCents(money(data.hybridMonthlySellerFinancePayment))} (${data.hybridSellerFinanceRepaymentStructure}).`
    : `Seller-financed balance ${fmtDollarsCents(money(data.hybridSellerFinancedBalanceUsed))}, with no monthly ` +
      `seller-finance payments required.`;
  return (
    `Hybrid structure: Subject To existing mortgage (${fmtDollarsCents(money(data.hybridExistingMortgageBalance))} ` +
    `balance at ${data.hybridExistingMortgageRatePct.toFixed(2)}% interest, ` +
    `${amortizationTermPhrase(data.hybridExistingMortgageEffectiveAmortization)}) plus seller financing. ${sellerFinancePart} ` +
    `See the "Financing Details" worksheet for the complete breakdown.`
  );
}

// The main, one-page "Underwriting" sheet -- visual layout (column
// widths, borders, yellow input fills, green result fills, accounting
// currency format) matches the attached reference workbook. Every
// formula is either corrected from the reference workbook's original
// (the Equity cell was a literal #REF!; Monthly Cash Flow divided by
// two undefined cells) or newly built to satisfy the no-double-counting
// rules for whichever financing structure is active.
function buildUnderwritingSheet(
  wb: ExcelJS.Workbook,
  data: UnderwritingExportData,
  inputs: InputsSheetAddresses,
  // Cell-address lookup for the "Capital Required" worksheet (built by
  // capitalRequiredRows/writeKeyValueSheet in buildGeneratedWorkbook,
  // before this function runs) -- only ever passed for Stack Method, the
  // only structure whose Total Capital Required must reconcile through a
  // separate signed closing adjustment rather than a simple sum of the
  // capital rows below. Undefined for every other structure (and for the
  // template-workbook path, which has no "Capital Required" sheet at all).
  capitalAddr?: Map<string, string>
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet("Underwriting", { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 2.16;
  ws.getColumn(2).width = 36.16;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 11.66;
  ws.getColumn(5).width = 13.83;
  ws.getColumn(6).width = 23.16;
  ws.getColumn(7).width = 3;

  const isHybrid = data.financingMode === "hybrid";
  const isTraditional = data.financingMode === "traditional";
  const isStack = data.financingMode === "stackMethod";
  const isSellerFinancing = data.financingMode === "sellerFinancing";
  const e3IsPiti = underwritingE3IsPiti(data);
  const leftBorder = (addr: string) => {
    ws.getCell(addr).border = { ...ws.getCell(addr).border, left: { style: "thin" } };
  };

  // ---- Row 2: column headers ----
  ws.getCell("C2").value = "Amount";
  ws.getCell("D2").value = "Percentage";
  ws.getCell("E2").value = "Financing";
  ["C2", "D2", "E2"].forEach((addr) => {
    const cell = ws.getCell(addr);
    cell.font = { bold: true, size: 11, name: "Calibri" };
    cell.border = { top: { style: "thin" } };
  });

  // ---- Row 3: Purchase Price / Primary Monthly Payment ----
  // Traditional and Stack Method both always put a Principal-and-Interest
  // -only figure here (never a blended PITI figure -- see
  // underwritingE3IsPiti above), so Annual Insurance and Annual Property
  // Taxes below are never double-counted for those two structures.
  const primaryPaymentValue = isHybrid
    ? data.hybridSubjectToPITI
    : isTraditional
      ? data.traditionalMonthlyPI
      : isStack
        ? data.stackBankMonthlyPI
        : isSellerFinancing
          ? data.sellerFinancingMonthlyPI
          : data.monthlyPayment;
  const primaryPaymentLabel = isHybrid
    ? "Primary Monthly Payment (PITI)"
    : isTraditional
      ? "Primary Monthly Payment (P&I)"
      : isStack
        ? "Primary Loan Monthly Payment (P&I)"
        : isSellerFinancing
          ? "Monthly Principal & Interest"
          : "Primary Monthly Payment (P&I / PITI)";
  ws.getCell("B3").value = "Purchase Price";
  fmtLabel(ws.getCell("B3"));
  leftBorder("B3");
  fmtValue(ws.getCell("C3"), TEMPLATE_CURRENCY_FMT, { input: true });
  ws.getCell("C3").value = money(data.purchasePrice);
  fmtValue(ws.getCell("E3"), TEMPLATE_CURRENCY_FMT, { input: true });
  ws.getCell("E3").value = money(primaryPaymentValue);
  ws.getCell("F3").value = primaryPaymentLabel;
  ws.getCell("F3").font = { size: 10, name: "Calibri" };
  ws.getCell("F3").border = { right: { style: "thin" } };

  // ---- Row 4: Annual Vacancy / Hybrid Seller-Finance Payment ----
  // Annual Gross Scheduled Rent lives at C20 now (see Row 20 below).
  ws.getCell("B4").value = "Annual Vacancy";
  fmtLabel(ws.getCell("B4"));
  leftBorder("B4");
  // References C20 (Annual Gross Scheduled Rent), not C19 -- the Annual
  // Property Management / Annual Platform Fees split below (Row 7-8)
  // inserts one extra row, pushing Annual Gross Scheduled Rent from the
  // old Row 19 down to Row 20.
  ws.getCell("C4").value = { formula: "C20*12*D4" } as ExcelJS.CellFormulaValue;
  fmtValue(ws.getCell("C4"), TEMPLATE_CURRENCY_FMT);
  ws.getCell("D4").value = pct(data.vacancyPct);
  fmtValue(ws.getCell("D4"), FMT_PERCENT, { input: true });
  fmtValue(ws.getCell("E4"), TEMPLATE_CURRENCY_FMT, { input: true });
  // Only Hybrid and Stack Method actually have a second loan payment
  // (Hybrid's seller-financed balance / Stack's seller-carried second) --
  // for Subject To, Seller Financing, and Traditional this cell is left
  // completely empty (no label, no dash, no 0, nothing), even though E4
  // to its left still holds 0 for internal formula consistency (E4 is
  // never displayed on its own; it only ever feeds into C17/Annual Debt
  // Payments and C23/Total Monthly Housing Payment below).
  const secondaryPaymentValue = isHybrid
    ? data.hybridMonthlySellerFinancePayment
    : isStack
      ? data.stackMonthlySellerFinancePayment
      : 0;
  ws.getCell("E4").value = money(secondaryPaymentValue);
  const secondaryPaymentLabel = isHybrid
    ? "Hybrid Seller-Finance Payment"
    : isStack
      ? "Seller-Carried Second Payment"
      : null;
  if (secondaryPaymentLabel) {
    ws.getCell("F4").value = secondaryPaymentLabel;
    ws.getCell("F4").font = { size: 10, name: "Calibri" };
  } else {
    ws.getCell("F4").value = null;
  }

  // ---- Row 5: Effective Gross Income ----
  ws.getCell("B5").value = "Effective Gross Income";
  fmtLabel(ws.getCell("B5"));
  leftBorder("B5");
  ws.getCell("C5").value = { formula: "(C20*12)-C4" } as ExcelJS.CellFormulaValue;
  fmtValue(ws.getCell("C5"), TEMPLATE_CURRENCY_FMT);

  // ---- Row 6: Annual Maintenance / Loan Balance ----
  ws.getCell("B6").value = "Annual Maintenance";
  fmtLabel(ws.getCell("B6"));
  leftBorder("B6");
  ws.getCell("C6").value = { formula: `'Inputs'!${inputs.monthlyMaintenance}*12` } as ExcelJS.CellFormulaValue;
  fmtValue(ws.getCell("C6"), TEMPLATE_CURRENCY_FMT);
  ws.getCell("E6").value = isStack ? "Total Loan Balance" : "Loan Balance";
  ws.getCell("E6").font = { size: 11, name: "Calibri" };
  // Stack Method's per-loan balances (Primary Bank/DSCR vs Seller-Carried
  // Second) are never blended into one rate or one schedule -- this cell
  // is only the combined total for the compact model; the Financing
  // Details worksheet keeps the two balances fully separate.
  const loanBalance = isHybrid
    ? money(data.hybridExistingMortgageBalance + data.hybridSellerFinancedBalanceUsed)
    : isTraditional
      ? money(data.traditionalLoanBalance)
      : isStack
        ? money(data.stackTotalDebtAtAcquisition)
        : isSellerFinancing
          ? money(data.sellerFinancingLoanBalance)
          : money(data.loanBalance);
  ws.getCell("F6").value = loanBalance;
  fmtValue(ws.getCell("F6"), TEMPLATE_CURRENCY_FMT, { input: true });
  ws.getCell("F6").border = { right: { style: "thin" } };

  // ---- Row 7: Annual Property Management / Estimated Equity ----
  // Split from the old combined "Annual Mgmt/Platform Fees" row into two
  // separate, individually-formulated rows (this row and Row 8 below) so
  // Property Management and Platform Fees are never combined into one
  // figure anywhere downstream. Both use the same revenue basis the
  // website itself uses for each fee (Effective Gross Income, C5) --
  // see propertyManagementFee / platformFees in SharedHousingCalculator.tsx,
  // both of which are `effectiveRentAfterVacancy x their own percentage`.
  ws.getCell("B7").value = "Annual Property Management";
  fmtLabel(ws.getCell("B7"));
  leftBorder("B7");
  ws.getCell("C7").value = { formula: "C5*D7" } as ExcelJS.CellFormulaValue;
  fmtValue(ws.getCell("C7"), TEMPLATE_CURRENCY_FMT);
  ws.getCell("D7").value = pct(data.propertyManagementPct);
  fmtValue(ws.getCell("D7"), FMT_PERCENT, { input: true });
  ws.getCell("E7").value = "Estimated Equity";
  ws.getCell("E7").font = { size: 11, name: "Calibri" };
  // Fixed from the reference workbook's literal =#REF!-F6: Estimated
  // Equity is simply Purchase Price minus Loan Balance.
  ws.getCell("F7").value = { formula: "C3-F6" } as ExcelJS.CellFormulaValue;
  fmtValue(ws.getCell("F7"), TEMPLATE_CURRENCY_FMT);
  ws.getCell("F7").border = { right: { style: "thin" } };

  // ---- Row 8: Annual Platform Fees ----
  ws.getCell("B8").value = "Annual Platform Fees";
  fmtLabel(ws.getCell("B8"));
  leftBorder("B8");
  ws.getCell("C8").value = { formula: "C5*D8" } as ExcelJS.CellFormulaValue;
  fmtValue(ws.getCell("C8"), TEMPLATE_CURRENCY_FMT);
  ws.getCell("D8").value = pct(data.platformFeePct);
  fmtValue(ws.getCell("D8"), FMT_PERCENT, { input: true });

  // ---- Rows 9-11: reorganized annual operating-expense rows ----
  ws.getCell("B9").value = "Annual Utilities";
  fmtLabel(ws.getCell("B9"));
  leftBorder("B9");
  ws.getCell("C9").value = {
    formula: `'Inputs'!${inputs.totalBedrooms}*'Inputs'!${inputs.utilityCostPerBedroom}*12`,
  } as ExcelJS.CellFormulaValue;
  fmtValue(ws.getCell("C9"), TEMPLATE_CURRENCY_FMT);

  ws.getCell("B10").value = "Annual Insurance";
  fmtLabel(ws.getCell("B10"));
  leftBorder("B10");
  ws.getCell("C10").value = { formula: `'Inputs'!${inputs.annualInsurance}` } as ExcelJS.CellFormulaValue;
  fmtValue(ws.getCell("C10"), TEMPLATE_CURRENCY_FMT);

  ws.getCell("B11").value = "Annual Property Taxes";
  fmtLabel(ws.getCell("B11"));
  leftBorder("B11");
  ws.getCell("C11").value = { formula: `'Inputs'!${inputs.annualPropertyTaxes}` } as ExcelJS.CellFormulaValue;
  fmtValue(ws.getCell("C11"), TEMPLATE_CURRENCY_FMT);

  // ---- Rows 12-14: Annual Cleaning / Annual Lawn Care / Annual Pest
  // Control, each a genuine formula referencing its own "Inputs" sheet
  // cell rather than one combined, pasted-together row.
  ws.getCell("B12").value = "Annual Cleaning";
  fmtLabel(ws.getCell("B12"));
  leftBorder("B12");
  ws.getCell("C12").value = { formula: `'Inputs'!${inputs.monthlyCleaning}*12` } as ExcelJS.CellFormulaValue;
  fmtValue(ws.getCell("C12"), TEMPLATE_CURRENCY_FMT);

  ws.getCell("B13").value = "Annual Lawn Care";
  fmtLabel(ws.getCell("B13"));
  leftBorder("B13");
  ws.getCell("C13").value = { formula: `'Inputs'!${inputs.monthlyLawnCare}*12` } as ExcelJS.CellFormulaValue;
  fmtValue(ws.getCell("C13"), TEMPLATE_CURRENCY_FMT);

  ws.getCell("B14").value = "Annual Pest Control";
  fmtLabel(ws.getCell("B14"));
  leftBorder("B14");
  ws.getCell("C14").value = { formula: `'Inputs'!${inputs.monthlyPestControl}*12` } as ExcelJS.CellFormulaValue;
  fmtValue(ws.getCell("C14"), TEMPLATE_CURRENCY_FMT);

  // ---- Row 15: Interest Rate (B/C left blank) ----
  // Stack Method shows only its Primary Loan's rate here (to avoid
  // overcrowding the compact model with two rates); the Seller-Carried
  // Second's own rate, amortization, and balloon term are called out in
  // Financing Notes below and fully detailed on the Financing Details
  // worksheet -- never blended into one rate.
  leftBorder("B15");
  ws.getCell("E15").value = isStack ? "Primary Loan Interest Rate" : "Interest Rate";
  ws.getCell("E15").font = { size: 11, name: "Calibri" };
  const rate = isHybrid
    ? pct(data.hybridExistingMortgageRatePct)
    : isTraditional
      ? pct(data.traditionalInterestRatePct)
      : isStack
        ? pct(data.stackBankInterestRatePct)
        : isSellerFinancing
          ? pct(data.sellerFinancingInterestRatePct)
          : pct(data.loanInterestRatePct);
  ws.getCell("F15").value = rate;
  fmtValue(ws.getCell("F15"), FMT_PERCENT, { input: true });

  // ---- Row 16: blank spacer ----
  leftBorder("B16");

  // ---- Row 17: Annual Debt Payments / Financing Notes ----
  ws.getCell("B17").value = "Annual Debt Payments";
  fmtLabel(ws.getCell("B17"));
  leftBorder("B17");
  ws.getCell("C17").value = { formula: "(E3+E4)*12" } as ExcelJS.CellFormulaValue;
  fmtValue(ws.getCell("C17"), TEMPLATE_CURRENCY_FMT);
  ws.getCell("E17").value = "Financing Notes";
  ws.getCell("E17").font = { size: 11, name: "Calibri" };

  ws.mergeCells("E18:F40");
  const notesCell = ws.getCell("E18");
  notesCell.value = financingNotesText(data);
  notesCell.font = { size: 9, name: "Calibri" };
  notesCell.alignment = { wrapText: true, vertical: "top", horizontal: "left" };

  // ---- Row 19: Monthly Operating Cost ----
  // Includes Insurance (C10) and Property Taxes (C11) only when the
  // Primary Monthly Payment in E3 is Principal-and-Interest only --
  // when E3 is already PITI, C10/C11 are already baked into the Annual
  // Debt Payments total (C17) and would otherwise be double-counted.
  // C7+C8 (Property Management + Platform Fees, now two cells instead
  // of the old combined C7) and C12+C13+C14 (Cleaning + Lawn Care +
  // Pest Control) are both included either way.
  ws.getCell("B19").value = "Monthly Operating Cost";
  fmtLabel(ws.getCell("B19"));
  leftBorder("B19");
  const opCostFormula = e3IsPiti
    ? "(C4+C6+C7+C8+C9+C12+C13+C14+C17)/12"
    : "(C4+C6+C7+C8+C9+C10+C11+C12+C13+C14+C17)/12";
  ws.getCell("C19").value = { formula: opCostFormula } as ExcelJS.CellFormulaValue;
  fmtValue(ws.getCell("C19"), TEMPLATE_CURRENCY_FMT);

  // ---- Row 20: Annual Gross Scheduled Rent ----
  // A genuine formula -- room count x weekly rent x 52, annualized then
  // converted to a monthly figure -- referencing the "Inputs" sheet's
  // room-rate cells, rather than a single pasted total. Matches
  // SharedHousingCalculator.tsx's grossMonthlyRent calculation exactly:
  // (Shared-Bath Bedrooms x Weekly Shared-Bath Rent x 52 / 12) +
  // (Ensuite Bedrooms x Weekly Ensuite Rent x 52 / 12).
  ws.getCell("B20").value = "Annual Gross Scheduled Rent (Monthly)";
  fmtLabel(ws.getCell("B20"));
  leftBorder("B20");
  ws.getCell("C20").value = {
    formula:
      `('Inputs'!${inputs.sharedBathBedrooms}*'Inputs'!${inputs.weeklySharedBathRent}*52)/12` +
      `+('Inputs'!${inputs.ensuiteBedrooms}*'Inputs'!${inputs.weeklyEnsuiteRent}*52)/12`,
  } as ExcelJS.CellFormulaValue;
  fmtValue(ws.getCell("C20"), TEMPLATE_CURRENCY_FMT);

  // ---- Row 21: Monthly Cash Flow ----
  // Fixed from the reference workbook's original formula, which divided
  // by an undefined cell (F8) and subtracted another (E5) -- both blank,
  // so the result was #DIV/0! / meaningless. Annual Gross Scheduled Rent
  // minus Monthly Operating Cost already correctly reflects financing
  // costs either way, since C19 above already includes Annual Debt
  // Payments.
  ws.getCell("B21").value = "Monthly Cash Flow";
  fmtLabel(ws.getCell("B21"));
  leftBorder("B21");
  ws.getCell("C21").value = { formula: "C20-C19" } as ExcelJS.CellFormulaValue;
  fmtValue(ws.getCell("C21"), TEMPLATE_CURRENCY_FMT, { emphasis: true });

  // ---- Row 22: bedroom summary (merged B22:D22) ----
  // This is the cell the "font size 10" request refers to (it was B21
  // before the Annual Property Management / Annual Platform Fees split
  // above inserted one additional row, pushing it down to B22).
  ws.mergeCells("B22:D22");
  ws.getCell("B22").value = bedroomSummaryString(data);
  fmtLabel(ws.getCell("B22"), { size: 10 });
  leftBorder("B22");

  // ---- Row 23: Total Monthly Housing Payment ----
  ws.getCell("B23").value = "Total Monthly Housing Payment";
  fmtLabel(ws.getCell("B23"));
  leftBorder("B23");
  const totalHousingFormula = e3IsPiti ? "E3+E4" : "E3+E4+(C10+C11)/12";
  ws.getCell("C23").value = { formula: totalHousingFormula } as ExcelJS.CellFormulaValue;
  fmtValue(ws.getCell("C23"), TEMPLATE_CURRENCY_FMT);

  // ---- Row 24: blank spacer ----
  leftBorder("B24");

  // ---- Rows 25+: Capital Required ----
  // Arrears applies only to Subject To and Hybrid on the website (matching
  // SharedHousingCalculator.tsx's totalCapitalRequired computation) -- it
  // is always written as 0 here for every other structure, regardless of
  // any stale Arrears value left over from switching financing modes.
  const arrearsForExport = data.financingMode === "subjectTo" || isHybrid ? data.arrears : 0;
  // Down Payment: the generic downPaymentLabel/downPaymentForCapital pair
  // (already correctly resolved per structure by the website -- e.g. the
  // calculated Traditional down payment) covers every structure except
  // Stack Method, which never uses this line item on the website (its
  // capital math instead nets a signed Estimated Cash to Buyer at Closing
  // adjustment, added as its own row below) -- Down Payment to Seller is
  // shown here instead, a real Stack Method cash outlay.
  const downPaymentRowLabel = isStack ? "Down Payment to Seller" : data.downPaymentLabel;
  const downPaymentRowValue = isStack ? data.stackDownPaymentToSeller : data.downPaymentForCapital;
  // Closing Costs: Subject To / Seller Financing / Hybrid use the general
  // Purchase Price x Closing Cost Percentage calculation (unchanged).
  // Traditional Financing uses its own Estimated Loan Balance x
  // Traditional Closing Cost Percentage instead (matching
  // traditionalClosingCosts in SharedHousingCalculator.tsx exactly --
  // Loan Balance already sits at F6 above), and Stack Method uses its own
  // Purchase Price x Stack Method Closing Cost Percentage (matching
  // stackClosingCosts). Never the generic percentage for either.
  const closingCostPctForRow = isTraditional
    ? data.traditionalClosingCostPct
    : isStack
      ? data.stackClosingCostPct
      : data.closingCostPct;
  interface CapitalRowDef {
    label: string;
    value?: number;
    formula?: string;
    isClosingCosts?: boolean;
  }
  // Stack Method's capital section is structurally different from every
  // other financing structure: its actual buyer cash required is a
  // reconciliation (Base Capital Required, netted against a signed
  // Estimated Cash to Buyer at Closing adjustment), not a flat sum of
  // every displayed row. Closing Costs, Upfront Insurance, Agent Fee, and
  // Assignment Fee are all already fully embedded inside Cash to Close,
  // Leg 1 (which drives the Estimated Cash to Buyer at Closing result --
  // see stackCashToCloseLeg1/stackEstimatedBuyerCashAtClosing in
  // SharedHousingCalculator.tsx), so none of those may be summed again as
  // separate capital line items here without double-counting them.
  // Arrears and Down Payment to Seller likewise never contribute to Base
  // Capital Required on the website (Down Payment to Seller instead flows
  // into the Seller-Financed Balance that feeds the same reconciliation),
  // so Stack Method's Underwriting-sheet capital section shows only the
  // eleven items that actually make up Base Capital Required, followed by
  // three linked reconciliation rows -- matching the "Capital Required"
  // worksheet's own Base Capital Required / Signed Buyer Closing
  // Adjustment / Adjusted Total Capital Required rows exactly, so the two
  // sheets can never disagree with each other.
  const capitalRowDefs: CapitalRowDef[] = [];
  if (!isStack) {
    capitalRowDefs.push({ label: "Arrears", value: money(arrearsForExport) });
    capitalRowDefs.push({ label: downPaymentRowLabel, value: money(downPaymentRowValue) });
  }
  // Renovations is a genuine cross-sheet formula linked to the "Scope of
  // Work" worksheet's grand total whenever that total is actually the
  // figure driving underwriting (data.useItemizedScopeOfWork) -- so
  // editing a Scope of Work line item automatically updates this cell.
  // The Scope of Work sheet's total always lands at row (item count + 4)
  // (see addScopeOfWorkSheet above: 1 header row + N item rows starting
  // at row 3 + 1 blank spacer row + 1 total row = row N+4) -- never
  // assumed to be a fixed row like C12. When there is no itemized Scope
  // of Work in use (no items, or the figure was manually overridden),
  // there is nothing to link to, so the resolved renovation cost is
  // written as a plain value instead, exactly matching what the website
  // itself used.
  capitalRowDefs.push(
    data.useItemizedScopeOfWork && data.scopeOfWorkItems.length > 0
      ? { label: "Renovations", formula: `'Scope of Work'!C${data.scopeOfWorkItems.length + 4}` }
      : { label: "Renovations", value: money(data.renovationCost) }
  );
  capitalRowDefs.push(
    { label: "Furniture", value: money(data.furniture) },
    { label: "Appliances", value: money(data.appliances) },
    { label: "Photos", value: money(data.photos) },
    { label: "Holding Costs", value: money(data.holdingCosts) },
    { label: "Reserves", value: money(data.reserves) }
  );
  if (!isStack) {
    capitalRowDefs.push({ label: "Upfront Insurance Cost", value: money(data.upfrontInsurance) });
  }
  capitalRowDefs.push(
    { label: "Acquisition Cost", value: money(data.acquisitionFee) },
    { label: "TC Fee", value: money(data.tcFee) },
    { label: "LLC Entity Formation Cost", value: money(data.llcFee) }
  );
  if (!isStack) {
    capitalRowDefs.push({ label: "Closing Costs", isClosingCosts: true });
  }
  capitalRowDefs.push(
    { label: "Agent Fee", value: money(data.agentFee) },
    { label: "Assignment Fee", value: money(data.assignmentFee) }
  );

  let row = 25;
  const firstCapitalRow = row;
  for (const def of capitalRowDefs) {
    const labelCell = ws.getCell(row, 2);
    labelCell.value = def.label;
    fmtLabel(labelCell);
    leftBorder(`B${row}`);
    const valueCell = ws.getCell(row, 3);
    if (def.isClosingCosts) {
      const closingCostFormula = isTraditional ? `F6*D${row}` : `C3*D${row}`;
      valueCell.value = { formula: closingCostFormula } as ExcelJS.CellFormulaValue;
      fmtValue(valueCell, TEMPLATE_CURRENCY_FMT);
      const pctCell = ws.getCell(row, 4);
      pctCell.value = pct(closingCostPctForRow);
      fmtValue(pctCell, FMT_PERCENT, { input: true });
    } else if (def.formula) {
      valueCell.value = { formula: def.formula } as ExcelJS.CellFormulaValue;
      fmtValue(valueCell, TEMPLATE_CURRENCY_FMT);
    } else {
      valueCell.value = def.value ?? 0;
      fmtValue(valueCell, TEMPLATE_CURRENCY_FMT, { input: true });
    }
    ws.getRow(row).height = 15.75;
    row++;
  }
  const lastCapitalRow = row - 1;

  // ---- Total Capital Required ----
  let totalCapitalRow: number;
  if (isStack) {
    // Base Capital Required is a genuine cross-sheet link to the
    // "Capital Required" worksheet's own Base Capital Required row (built
    // earlier in buildGeneratedWorkbook, so its address is already known
    // here). fmtValue automatically colors any formula containing "!"
    // green (the cross-sheet-link convention), so no extra styling is
    // needed. The literal "C14"/"C15" fallback only applies if this sheet
    // is ever built without a Capital Required worksheet present (should
    // never happen for Stack Method in practice).
    const baseAddr = capitalAddr?.get("Capital Required|Base Capital Required") ?? "C14";
    const adjustmentAddr = capitalAddr?.get("Capital Required|Signed Buyer Closing Adjustment") ?? "C15";

    const baseRow = row;
    ws.getCell(baseRow, 2).value = "Base Capital Required";
    fmtLabel(ws.getCell(baseRow, 2), { bold: true });
    ws.getCell(baseRow, 3).value = { formula: `'Capital Required'!${baseAddr}` } as ExcelJS.CellFormulaValue;
    fmtValue(ws.getCell(baseRow, 3), TEMPLATE_CURRENCY_FMT);
    ws.getRow(baseRow).height = 15.75;
    row++;

    // Estimated Cash to Buyer at Closing is displayed here as a positive
    // amount -- the Capital Required sheet's own "Signed Buyer Closing
    // Adjustment" cell stores this negative (money(-stackEstimatedBuyer
    // CashAtClosing), so it reduces Base Capital Required by simple
    // addition there), but showing that same negative number here under a
    // label that says "to Buyer" reads as if the buyer were paying it
    // out, not receiving it. The sign is flipped for display only
    // (still a genuine, live cross-sheet link -- never a hardcoded
    // value), and Total Capital Required below is calculated as Base
    // Capital Required minus this positive figure, which is
    // mathematically identical to Capital Required!C16 (Base + the
    // negative Signed Buyer Closing Adjustment) -- so the two sheets can
    // never disagree with each other even though this row's sign is
    // flipped for readability.
    const adjustmentRow = row;
    ws.getCell(adjustmentRow, 2).value = "Estimated Cash to Buyer at Closing";
    fmtLabel(ws.getCell(adjustmentRow, 2));
    leftBorder(`B${adjustmentRow}`);
    ws.getCell(adjustmentRow, 3).value = {
      formula: `-'Capital Required'!${adjustmentAddr}`,
    } as ExcelJS.CellFormulaValue;
    fmtValue(ws.getCell(adjustmentRow, 3), TEMPLATE_CURRENCY_FMT);
    ws.getRow(adjustmentRow).height = 15.75;
    row++;

    totalCapitalRow = row;
    ws.getCell(totalCapitalRow, 2).value = "Total Capital Required";
    fmtLabel(ws.getCell(totalCapitalRow, 2), { bold: true });
    ws.getCell(totalCapitalRow, 3).value = {
      formula: `C${baseRow}-C${adjustmentRow}`,
    } as ExcelJS.CellFormulaValue;
    fmtValue(ws.getCell(totalCapitalRow, 3), TEMPLATE_CURRENCY_FMT);
    ws.getRow(totalCapitalRow).height = 15.75;
    row++;
  } else {
    totalCapitalRow = row;
    ws.getCell(totalCapitalRow, 2).value = "Total Capital Required";
    fmtLabel(ws.getCell(totalCapitalRow, 2), { bold: true });
    ws.getCell(totalCapitalRow, 3).value = {
      formula: `SUM(C${firstCapitalRow}:C${lastCapitalRow})`,
    } as ExcelJS.CellFormulaValue;
    fmtValue(ws.getCell(totalCapitalRow, 3), TEMPLATE_CURRENCY_FMT);
    ws.getRow(totalCapitalRow).height = 15.75;
    row++;
  }

  // ---- blank spacer ----
  leftBorder(`B${row}`);
  row++;

  // ---- Cash-on-Cash Return ----
  // Guarded against a $0 (or, for Stack Method's linked cell, blank)
  // Total Capital Required -- never produces #DIV/0!. Every non-Stack
  // structure keeps its original "-" display (unchanged by this fix);
  // Stack Method's linked total can momentarily read as a blank string
  // if the "Capital Required" sheet's own cell is ever blank, so its
  // guard also treats "" as the zero case, matching the OR() guard the
  // reconciliation fix calls for.
  const cocRow = row;
  ws.getCell(cocRow, 2).value = "C on C Return";
  fmtLabel(ws.getCell(cocRow, 2), { bold: true });
  ws.getCell(cocRow, 3).value = {
    formula: isStack
      ? `IF(OR(C${totalCapitalRow}="",C${totalCapitalRow}=0),"",(C21*12)/C${totalCapitalRow})`
      : `IF(C${totalCapitalRow}=0,"-",(C21*12)/C${totalCapitalRow})`,
  } as ExcelJS.CellFormulaValue;
  fmtValue(ws.getCell(cocRow, 3), FMT_PERCENT, { emphasis: true });
  ws.getRow(cocRow).height = 15.75;

  const lastRow = cocRow;

  // ---- Full borders across the entire populated table ----
  // Thin borders on every side of every populated cell (B through F,
  // rows 2 through the final populated row), plus a heavier outside
  // border around the whole table, so there are no unbordered gaps
  // anywhere in the model.
  for (let r = 2; r <= lastRow; r++) {
    for (let c = 2; c <= 6; c++) {
      const cell = ws.getCell(r, c);
      const isLeftEdge = c === 2;
      const isRightEdge = c === 6;
      const isTopEdge = r === 2;
      const isBottomEdge = r === lastRow;
      cell.border = {
        top: { style: isTopEdge ? "medium" : "thin" },
        bottom: { style: isBottomEdge ? "medium" : "thin" },
        left: { style: isLeftEdge ? "medium" : "thin" },
        right: { style: isRightEdge ? "medium" : "thin" },
      };
    }
  }

  // Thin white spacer column on the far right (matches the reference
  // workbook's column G) for a clean printable right edge.
  for (let r = 2; r <= lastRow; r++) {
    ws.getCell(r, 7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_WHITE } };
  }

  ws.pageSetup = { fitToPage: true, fitToWidth: 1, fitToHeight: 1, orientation: "landscape" };
  return ws;
}

export async function buildTemplateWorkbook(data: UnderwritingExportData): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Michael Aylett Underwriting Calculator";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const inputs = addInputsSheet(wb, data);
  buildUnderwritingSheet(wb, data, inputs);
  writeKeyValueSheet(wb, "Financing Details", [{ title: "Financing Details", rows: financingDetailsRows(data) }]);
  const balloon = activeBalloon(data);
  if (balloon) {
    writeKeyValueSheet(wb, "Balloon Analysis", [{ title: "Balloon Refinance Analysis", rows: balloon.rows }]);
  }
  addScopeOfWorkSheet(wb, data);
  addAmortizationScheduleSheets(wb, data);
  addRoiProjectionSheet(wb, data);
  addTransitSheet(wb, data);
  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0, visibility: "visible" }];
  return wb;
}

// ---------------------------------------------------------------------
// GENERATED PATH: Traditional Financing, Seller Financing, Stack Method
// ---------------------------------------------------------------------
function operatingAssumptionsRows(data: UnderwritingExportData): KVRow[] {
  return [
    { label: "Shared-Bath Bedrooms", value: data.sharedBathBedrooms, format: FMT_WHOLE, input: true },
    { label: "Weekly Shared-Bath Rent", value: money(data.weeklySharedBathRent), format: FMT_CURRENCY, input: true },
    { label: "Ensuite Bedrooms", value: data.ensuiteBedrooms, format: FMT_WHOLE, input: true },
    { label: "Weekly Ensuite Rent", value: money(data.weeklyEnsuiteRent), format: FMT_CURRENCY, input: true },
    { label: "Total Bedrooms", value: data.totalBedrooms, format: FMT_WHOLE },
    { label: "Room-Rate Summary", value: bedroomSummaryString(data) },
    { label: "Gross Monthly Room Revenue", value: money(data.grossMonthlyRent), format: FMT_CURRENCY },
    { label: "Vacancy Percentage", value: pct(data.vacancyPct), format: FMT_PERCENT, input: true },
    // Row positions below are fixed by this array's own order (row 3 is
    // the first data row, incrementing by one per row, with no blank
    // spacer rows in between): Gross Monthly Room Revenue is row 9,
    // Vacancy Percentage is row 10, so Annual Vacancy (this row, 11) is
    // =C9*12*C10; Effective Gross Income (row 12) is =(C9*12)-C11.
    { label: "Annual Vacancy", formula: "C9*12*C10", format: FMT_CURRENCY },
    { label: "Effective Gross Income", formula: "(C9*12)-C11", format: FMT_CURRENCY },
    { label: "Platform Fee Percentage", value: pct(data.platformFeePct), format: FMT_PERCENT, input: true },
    { label: "Property Management Percentage", value: pct(data.propertyManagementPct), format: FMT_PERCENT, input: true },
    { label: "Monthly Platform Fees", value: money(data.platformFees), format: FMT_CURRENCY },
    { label: "Monthly Property Management Fee", value: money(data.propertyManagementFee), format: FMT_CURRENCY },
    { label: "Monthly Maintenance", value: money(data.maintenanceMonthly), format: FMT_CURRENCY },
    { label: "Monthly Utilities", value: money(data.utilitiesMonthly), format: FMT_CURRENCY },
    { label: "Monthly Cleaning", value: money(data.cleaningMonthly), format: FMT_CURRENCY },
    { label: "Monthly Lawn Care", value: money(data.lawnCareMonthly), format: FMT_CURRENCY },
    { label: "Monthly Pest Control", value: money(data.pestControlMonthly), format: FMT_CURRENCY },
    { label: data.housingPaymentLabel, value: money(data.monthlyHousingPayment), format: FMT_CURRENCY },
    { label: "Monthly Operating Cost", value: money(data.totalMonthlyOperatingExpenses), format: FMT_CURRENCY },
    {
      // Gross Monthly Room Revenue (row 9) - Monthly Operating Cost (row 23).
      label: "Monthly Cash Flow",
      formula: "C9-C23",
      format: FMT_CURRENCY,
      emphasis: true,
    },
    { label: "Annual Cash Flow", formula: "C24*12", format: FMT_CURRENCY },
  ];
}

// Effective Tax Rate detail block, shared across Traditional, Seller
// Financing, and Stack Method (the three financingDetailsRows() paths
// below). Spliced in immediately after "Purchase Price" in each of
// those arrays, since "Purchase Price" is always that section's first
// data row -- fixed at cell C3 on the "Financing Details" sheet -- so
// the Calculated Annual Property Taxes formula below can reference it
// directly (C3) along with the Effective Tax Rate row placed right
// after it (C5), without needing the dynamic rowAddress lookup map.
// "Property Taxes Used in Underwriting" replaces the old bare "Annual
// Property Taxes" row and is the only one of these that ever feeds a
// downstream cash-flow formula elsewhere in the workbook.
function propertyTaxDetailRows(data: UnderwritingExportData): KVRow[] {
  // "N/A" is the exact signal SharedHousingCalculator.tsx uses for "no
  // county selected and no manual rate entered" (propertyTaxRateSource:
  // county === "" ? (ratePct > 0 ? "Manual Override" : "N/A") : ...) --
  // in every other case a real rate is known. When unavailable, both
  // cells are written as a genuine blank ("") rather than 0.00% / $0.00,
  // so they are never mistaken for an actual zero rate or zero expense.
  // Calculated Annual Property Taxes is left as a plain blank value
  // (not a "C3*C5" formula) in that case too, since multiplying by a
  // blank rate cell would otherwise silently evaluate to $0.00.
  const rateUnavailable = data.propertyTaxRateSource === "N/A";
  return [
    { label: "Selected County", value: data.propertyTaxCounty || "Not Selected" },
    {
      label: "Effective Tax Rate",
      value: rateUnavailable ? "" : pct(data.propertyTaxRatePct),
      format: rateUnavailable ? undefined : FMT_PERCENT,
      input: true,
    },
    { label: "Rate Source", value: data.propertyTaxRateSource },
    {
      label: "Calculated Annual Property Taxes",
      value: rateUnavailable ? "" : undefined,
      formula: rateUnavailable ? undefined : "C3*C5",
      format: rateUnavailable ? undefined : FMT_CURRENCY,
    },
    { label: "Property Tax Source", value: data.propertyTaxSource },
    {
      label: "Property Taxes Used in Underwriting",
      value: money(data.annualPropertyTaxes),
      format: FMT_CURRENCY,
      input: true,
    },
  ];
}

// Writes the "Remaining Amortization" row (still a genuine editable
// input, exactly as before, when a term has actually been entered) plus,
// when it has NOT been entered, one extra explanatory row instead of
// silently defaulting to any particular term: the known payment (if any)
// used to estimate it, the mathematically estimated term (clearly
// labeled as an estimate) when one could be solved for, an insufficient-
// payment warning when the entered payment could never amortize the
// loan, or a plain "not provided" status otherwise. Shared by the
// sellerFinancing / subjectTo / hybrid branches of financingDetailsRows
// below so all three stay consistent.
function amortizationYearsRows(
  label: string,
  term: EffectiveAmortizationTerm,
  rawYears: number | null,
  knownMonthlyPIPayment: number | null
): KVRow[] {
  const rows: KVRow[] = [
    {
      label,
      value: rawYears !== null ? rawYears : "",
      format: rawYears !== null ? FMT_YEARS : undefined,
      input: true,
    },
  ];
  if (rawYears === null) {
    if (knownMonthlyPIPayment !== null) {
      rows.push({
        label: `${label} -- Known Monthly Principal & Interest Payment`,
        value: money(knownMonthlyPIPayment),
        format: FMT_CURRENCY,
        input: true,
      });
    }
    if (term.months !== null && term.isEstimated) {
      rows.push({
        label: `${label} (Estimated From Payment)`,
        value: Math.round((term.months / 12) * 100) / 100,
        format: FMT_YEARS,
      });
    } else if (term.insufficientPayment) {
      rows.push({
        label: `${label} Status`,
        value:
          "The entered monthly principal and interest payment does not cover interest on this balance at the entered rate, so the loan would never amortize at that payment.",
      });
    } else {
      rows.push({
        label: `${label} Status`,
        value:
          "Not provided. Enter the remaining amortization term or the loan's known monthly principal and interest payment to calculate an amortization schedule.",
      });
    }
  }
  return rows;
}

function financingDetailsRows(data: UnderwritingExportData): KVRow[] {
  if (data.financingMode === "traditional") {
    return [
      { label: "Purchase Price", value: money(data.purchasePrice), format: FMT_CURRENCY, input: true },
      ...propertyTaxDetailRows(data),
      { label: "Down Payment Percentage", value: pct(data.traditionalDownPaymentPct), format: FMT_PERCENT, input: true },
      { label: "Estimated Down Payment", value: money(data.traditionalDownPaymentAmount), format: FMT_CURRENCY },
      { label: "Estimated Loan Balance", value: money(data.traditionalLoanBalance), format: FMT_CURRENCY },
      { label: "Interest Rate", value: pct(data.traditionalInterestRatePct), format: FMT_PERCENT, input: true },
      { label: "Amortization Term", value: "30 Years (360 Monthly Payments)" },
      { label: "Monthly Principal and Interest", value: money(data.traditionalMonthlyPI), format: FMT_CURRENCY },
      { label: "Annual Property Insurance", value: money(data.annualPropertyInsurance), format: FMT_CURRENCY, input: true },
      { label: "Estimated Monthly PITI", value: money(data.monthlyHousingPayment), format: FMT_CURRENCY },
      { label: "Traditional Closing Cost Percentage", value: pct(data.traditionalClosingCostPct), format: FMT_PERCENT, input: true },
      { label: "Traditional Closing Costs", value: money(data.traditionalClosingCosts), format: FMT_CURRENCY },
      {
        label: "Estimated Monthly Long-Term Rent",
        value: data.traditionalLongTermRent === null ? "Not entered" : money(data.traditionalLongTermRent),
        format: data.traditionalLongTermRent === null ? undefined : FMT_CURRENCY,
      },
      { label: "Selected LTV", value: pct(data.traditionalSelectedLtvPct), format: FMT_PERCENT },
      { label: "Estimated Equity", value: money(data.equity), format: FMT_CURRENCY, emphasis: true },
    ];
  }
  if (data.financingMode === "sellerFinancing") {
    return [
      { label: "Purchase Price", formula: "Underwriting!C3", format: TEMPLATE_CURRENCY_FMT },
      { label: "Down Payment Percentage", value: pct(data.sellerFinancingDownPaymentPct), format: FMT_PERCENT, input: true },
      {
        label: "Down Payment Dollar Amount",
        value: money(data.sellerFinancingDownPaymentAmount),
        format: FMT_CURRENCY,
        input: true,
      },
      {
        label: "Seller-Finance Loan Balance",
        value: money(data.sellerFinancingLoanBalance),
        format: FMT_CURRENCY,
        input: true,
      },
      {
        label: "Loan Balance Source",
        value: data.sellerFinancingLoanBalanceIsManual ? "Manual Override" : "Automatically Calculated",
      },
      ...propertyTaxDetailRows(data),
      { label: "Annual Property Insurance", value: money(data.annualPropertyInsurance), format: FMT_CURRENCY, input: true },
      { label: "Seller-Finance Interest Rate", value: pct(data.sellerFinancingInterestRatePct), format: FMT_PERCENT, input: true },
      { label: "Amortization Term", value: data.sellerFinancingAmortizationYears, format: FMT_YEARS, input: true },
      { label: "Monthly Principal & Interest", value: money(data.sellerFinancingMonthlyPI), format: FMT_CURRENCY },
      { label: "Total Monthly Housing Payment", formula: "Underwriting!C23", format: TEMPLATE_CURRENCY_FMT },
      { label: "Estimated Equity", formula: "Underwriting!F7", format: FMT_CURRENCY, emphasis: true },
    ];
  }
  if (data.financingMode === "subjectTo") {
    return [
      { label: "Purchase Price", formula: "Underwriting!C3", format: TEMPLATE_CURRENCY_FMT },
      ...propertyTaxDetailRows(data),
      { label: "Existing Mortgage Balance", value: money(data.loanBalance), format: FMT_CURRENCY, input: true },
      { label: "Existing Mortgage Interest Rate", value: pct(data.loanInterestRatePct), format: FMT_PERCENT, input: true },
      ...amortizationYearsRows(
        "Existing Mortgage Remaining Amortization",
        data.subjectToEffectiveAmortization,
        data.loanRemainingAmortizationYears,
        data.loanKnownMonthlyPIPayment
      ),
      { label: "Monthly Payment Type", value: data.paymentType === "piti" ? "PITI" : "Principal and Interest Only" },
      { label: data.housingPaymentLabel, value: money(data.monthlyPayment), format: FMT_CURRENCY, input: true },
      { label: "Seller Down Payment", value: money(data.sellerDownPayment), format: FMT_CURRENCY, input: true },
      { label: "Arrears", formula: "Underwriting!C25", format: TEMPLATE_CURRENCY_FMT },
      { label: "Estimated Equity", formula: "Underwriting!F7", format: FMT_CURRENCY, emphasis: true },
    ];
  }
  if (data.financingMode === "hybrid") {
    return [
      { label: "Purchase Price", formula: "Underwriting!C3", format: TEMPLATE_CURRENCY_FMT },
      ...propertyTaxDetailRows(data),
      {
        label: "Existing Mortgage Balance",
        value: money(data.hybridExistingMortgageBalance),
        format: FMT_CURRENCY,
        input: true,
      },
      {
        label: "Existing Mortgage Interest Rate",
        value: pct(data.hybridExistingMortgageRatePct),
        format: FMT_PERCENT,
        input: true,
      },
      ...amortizationYearsRows(
        "Existing Mortgage Remaining Amortization",
        data.hybridExistingMortgageEffectiveAmortization,
        data.hybridExistingMortgageAmortizationYears,
        data.hybridExistingMortgageKnownMonthlyPIPayment
      ),
      { label: "Monthly Subject-To PITI Payment", value: money(data.hybridSubjectToPITI), format: FMT_CURRENCY, input: true },
      {
        label: "Suggested Seller-Financed Balance",
        value: money(data.hybridSuggestedSellerFinancedBalance),
        format: FMT_CURRENCY,
      },
      {
        label: "Seller-Financed Balance Used",
        value: money(data.hybridSellerFinancedBalanceUsed),
        format: FMT_CURRENCY,
        input: true,
      },
      { label: "Manual Seller-Financed Balance Override", value: data.hybridSellerFinancedBalanceIsManual ? "Yes" : "No" },
      {
        label: "Are Monthly Seller-Finance Payments Required?",
        value: data.hybridSellerFinancePaymentsRequired ? "Yes" : "No",
      },
      {
        label: "Seller-Finance Interest Rate",
        value: data.hybridSellerFinancePaymentsRequired ? pct(data.hybridSellerFinanceRatePct) : "Not Applicable",
        format: data.hybridSellerFinancePaymentsRequired ? FMT_PERCENT : undefined,
      },
      {
        label: "Seller-Finance Amortization Term",
        value: data.hybridSellerFinancePaymentsRequired ? "30 Years (360 Monthly Payments)" : "Not Applicable",
      },
      { label: "Seller-Finance Repayment Structure", value: data.hybridSellerFinanceRepaymentStructure },
      {
        label: "Monthly Seller-Finance Payment",
        value: money(data.hybridMonthlySellerFinancePayment),
        format: FMT_CURRENCY,
      },
      { label: "Total Monthly Housing Payment (Total PITI)", formula: "Underwriting!C23", format: TEMPLATE_CURRENCY_FMT },
      { label: "Seller Down Payment", value: money(data.sellerDownPayment), format: FMT_CURRENCY, input: true },
      { label: "Arrears", formula: "Underwriting!C25", format: TEMPLATE_CURRENCY_FMT },
      { label: "Estimated Equity", formula: "Underwriting!F7", format: FMT_CURRENCY, emphasis: true },
    ];
  }
  // Stack Method
  return [
    { label: "Purchase Price", value: money(data.purchasePrice), format: FMT_CURRENCY, input: true },
    ...propertyTaxDetailRows(data),
    { label: "Seller's Current First Loan Balance", value: money(data.stackSellerFirstLoanBalance), format: FMT_CURRENCY, input: true },
    { label: "Existing Second Lien", value: money(data.stackSellerSecondLien), format: FMT_CURRENCY, input: true },
    { label: "Miscellaneous Liens", value: money(data.stackMiscLiens), format: FMT_CURRENCY, input: true },
    { label: "Down Payment to Seller", value: money(data.stackDownPaymentToSeller), format: FMT_CURRENCY, input: true },
    { label: "Bank Loan-to-Value Percentage", value: pct(data.stackEffectiveBankLtvPct), format: FMT_PERCENT },
    { label: "Estimated First-Position Bank Loan", value: money(data.stackBankLoanAmount), format: FMT_CURRENCY },
    { label: "Bank Interest Rate", value: pct(data.stackBankInterestRatePct), format: FMT_PERCENT, input: true },
    { label: "Bank Amortization", value: data.stackBankAmortizationYears, format: FMT_YEARS, input: true },
    { label: "Monthly Bank Principal and Interest", value: money(data.stackBankMonthlyPI), format: FMT_CURRENCY },
    { label: "Annual Property Insurance", value: money(data.annualPropertyInsurance), format: FMT_CURRENCY, input: true },
    { label: "Estimated Monthly Bank PITI", value: money(data.stackMonthlyBankPITI), format: FMT_CURRENCY },
    { label: "Estimated Seller-Financed Balance", value: money(data.stackSellerFinancedBalance), format: FMT_CURRENCY },
    { label: "Total Debt at Acquisition", value: money(data.stackTotalDebtAtAcquisition), format: FMT_CURRENCY },
    {
      label: "Current Leverage Ratio",
      value: data.stackLeverageRatioDecimal === null ? "N/A" : data.stackLeverageRatioDecimal,
      format: data.stackLeverageRatioDecimal === null ? undefined : FMT_PERCENT,
    },
    { label: "Are Monthly Seller Finance Payments Required?", value: data.stackSellerFinancePaymentsRequired ? "Yes" : "No" },
    {
      label: "Seller Finance Interest Rate",
      value: data.stackSellerFinancePaymentsRequired ? pct(data.stackSellerFinanceRatePct) : "Not Applicable",
      format: data.stackSellerFinancePaymentsRequired ? FMT_PERCENT : undefined,
    },
    {
      label: "Seller Finance Amortization",
      value: data.stackSellerFinancePaymentsRequired ? `${data.stackSellerFinanceAmortizationYears} years` : "Not Applicable",
    },
    {
      label: "Estimated Monthly Seller Finance Payment",
      value: data.stackSellerFinancePaymentsRequired ? money(data.stackMonthlySellerFinancePayment) : "Not Included",
      format: data.stackSellerFinancePaymentsRequired ? FMT_CURRENCY : undefined,
    },
    { label: "Stack Method Closing Cost Percentage", value: pct(data.stackClosingCostPct), format: FMT_PERCENT, input: true },
    { label: "Stack Method Closing Costs", value: money(data.stackClosingCosts), format: FMT_CURRENCY },
    { label: "Agent Commission Percentage", value: pct(data.stackAgentCommissionPct), format: FMT_PERCENT, input: true },
    { label: "Agent Fees", value: money(data.stackAgentFees), format: FMT_CURRENCY },
    { label: "Transactional Funding Fee Percentage", value: pct(data.stackTransactionalFundingFeePct), format: FMT_PERCENT, input: true },
    { label: "Transactional Funding Fee", value: money(data.stackTransactionalFundingFee), format: FMT_CURRENCY },
    { label: "Cash to Close, Leg 1", value: money(data.stackCashToCloseLeg1), format: FMT_CURRENCY },
    {
      label: "Estimated Cash to Buyer at Closing",
      value: data.stackEstimatedBuyerCashAtClosing >= 0 ? money(data.stackEstimatedBuyerCashAtClosing) : money(0),
      format: FMT_CURRENCY,
    },
    {
      label: "Estimated Buyer Cash Required",
      value: data.stackEstimatedBuyerCashAtClosing < 0 ? money(Math.abs(data.stackEstimatedBuyerCashAtClosing)) : money(0),
      format: FMT_CURRENCY,
    },
    { label: "Can This Be Purchased for an Estimated $0 Out of Pocket?", value: data.stackZeroOutOfPocket },
    { label: "Estimated Equity", value: money(data.equity), format: FMT_CURRENCY, emphasis: true },
  ];
}

function capitalRequiredRows(data: UnderwritingExportData): { rows: KVRow[]; totalRowIndex: number } {
  const rows: KVRow[] = [];
  if (data.financingMode !== "stackMethod") {
    rows.push({ label: data.downPaymentLabel, value: money(data.downPaymentForCapital), format: FMT_CURRENCY, input: true });
  }
  // Arrears applies only to Subject To and Hybrid (both on the
  // template-style export path, which now also covers Seller
  // Financing); this generated path only ever covers Traditional
  // Financing and Stack Method, neither of which include an Arrears
  // line, matching the on-page/CSV/print behavior.
  // Same live cross-sheet link as the "Underwriting" sheet's Renovations
  // cell (see buildUnderwritingSheet above): genuinely linked to the
  // "Scope of Work" worksheet's total when that total is the actual
  // figure driving underwriting, otherwise a plain resolved value.
  if (data.useItemizedScopeOfWork && data.scopeOfWorkItems.length > 0) {
    rows.push({
      label: "Renovation Cost",
      formula: `'Scope of Work'!C${data.scopeOfWorkItems.length + 4}`,
      format: FMT_CURRENCY,
    });
  } else {
    rows.push({ label: "Renovation Cost", value: money(data.renovationCost), format: FMT_CURRENCY });
  }
  rows.push({ label: "Furniture", value: money(data.furniture), format: FMT_CURRENCY });
  rows.push({ label: "Appliances", value: money(data.appliances), format: FMT_CURRENCY });
  rows.push({ label: "Photos", value: money(data.photos), format: FMT_CURRENCY });
  rows.push({ label: "Holding Costs", value: money(data.holdingCosts), format: FMT_CURRENCY });
  rows.push({ label: "Reserves", value: money(data.reserves), format: FMT_CURRENCY });
  if (data.financingMode !== "traditional" && data.financingMode !== "stackMethod") {
    rows.push({ label: "Upfront Insurance Cost", value: money(data.upfrontInsurance), format: FMT_CURRENCY });
  }
  rows.push({ label: "Acquisition Fee", value: money(data.acquisitionFee), format: FMT_CURRENCY });
  rows.push({ label: "TC Fee", value: money(data.tcFee), format: FMT_CURRENCY });
  rows.push({ label: "LLC Entity Formation Cost", value: money(data.llcFee), format: FMT_CURRENCY });
  if (data.financingMode !== "stackMethod") {
    rows.push({ label: "Closing Costs", value: money(data.closingCosts), format: FMT_CURRENCY });
  }
  rows.push({ label: "Agent Fee", value: money(data.agentFee), format: FMT_CURRENCY });
  rows.push({ label: "Assignment Fee", value: money(data.assignmentFee), format: FMT_CURRENCY });
  if (data.financingMode === "stackMethod") {
    rows.push({ label: "Base Capital Required", value: money(data.stackBaseCapitalRequired), format: FMT_CURRENCY });
    rows.push({
      label: "Signed Buyer Closing Adjustment",
      value: money(-data.stackEstimatedBuyerCashAtClosing),
      format: FMT_CURRENCY,
    });
  }
  const totalRowIndex = rows.length;
  rows.push({
    label: data.financingMode === "stackMethod" ? "Adjusted Total Capital Required" : "Total Capital Required",
    value: money(data.totalCapitalRequired),
    format: FMT_CURRENCY,
    emphasis: true,
  });
  return { rows, totalRowIndex };
}

export async function buildGeneratedWorkbook(data: UnderwritingExportData): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Michael Aylett Underwriting Calculator";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  // Underwriting Summary is added first so it is the workbook's first
  // (and, per the views setting below, active) tab, but its cells are
  // populated last, once the other sheets exist and their cell
  // addresses are known -- so it can reference them directly with live
  // cross-sheet formulas for the results the spec calls out explicitly
  // (Monthly Cash Flow, Total Capital Required, Cash-on-Cash Return).
  const summaryWs = wb.addWorksheet("Underwriting Summary", { views: [{ showGridLines: false }] });
  summaryWs.getColumn(1).width = 2.5;
  summaryWs.getColumn(2).width = 40;
  summaryWs.getColumn(3).width = 22;

  const { rowAddress: opAddr } = writeKeyValueSheet(wb, "Operating Assumptions", [
    { title: "Operating Assumptions", rows: operatingAssumptionsRows(data) },
  ]);
  const { rowAddress: finAddr } = writeKeyValueSheet(wb, "Financing Details", [
    { title: "Financing Details", rows: financingDetailsRows(data) },
  ]);
  const { rows: capRows } = capitalRequiredRows(data);
  const { rowAddress: capAddr } = writeKeyValueSheet(wb, "Capital Required", [
    { title: "Capital Required", rows: capRows },
  ]);

  const totalCapitalAddr = capAddr.get(
    `Capital Required|${data.financingMode === "stackMethod" ? "Adjusted Total Capital Required" : "Total Capital Required"}`
  );
  const monthlyCashFlowAddr = opAddr.get("Operating Assumptions|Monthly Cash Flow");
  const annualCashFlowAddr = opAddr.get("Operating Assumptions|Annual Cash Flow");
  const equityAddr = finAddr.get("Financing Details|Estimated Equity");
  const housingPaymentAddr = opAddr.get(`Operating Assumptions|${data.housingPaymentLabel}`);
  const grossRentAddr = opAddr.get("Operating Assumptions|Gross Monthly Room Revenue");

  const summaryRows: KVRow[] = [
    { label: "Property Address", value: data.propertyAddress.trim() || "Not entered" },
    { label: "Financing Structure", value: FINANCING_STRUCTURE_LABELS[data.financingMode] },
    { label: "Purchase Price", value: money(data.purchasePrice), format: FMT_CURRENCY },
    { label: "Gross Monthly Room Revenue", formula: grossRentAddr ? `'Operating Assumptions'!${grossRentAddr}` : undefined, value: grossRentAddr ? undefined : money(data.grossMonthlyRent), format: FMT_CURRENCY },
    { label: data.housingPaymentLabel, formula: housingPaymentAddr ? `'Operating Assumptions'!${housingPaymentAddr}` : undefined, value: housingPaymentAddr ? undefined : money(data.monthlyHousingPayment), format: FMT_CURRENCY },
    {
      label: "Monthly Cash Flow",
      formula: monthlyCashFlowAddr ? `'Operating Assumptions'!${monthlyCashFlowAddr}` : undefined,
      value: monthlyCashFlowAddr ? undefined : money(data.monthlyCashFlow),
      format: FMT_CURRENCY,
      emphasis: true,
    },
    {
      label: "Annual Cash Flow",
      formula: annualCashFlowAddr ? `'Operating Assumptions'!${annualCashFlowAddr}` : undefined,
      value: annualCashFlowAddr ? undefined : money(data.annualCashFlow),
      format: FMT_CURRENCY,
    },
    {
      label: "Estimated Equity",
      formula: equityAddr ? `'Financing Details'!${equityAddr}` : undefined,
      value: equityAddr ? undefined : money(data.equity),
      format: FMT_CURRENCY,
    },
    {
      label: data.financingMode === "stackMethod" ? "Adjusted Total Capital Required" : "Total Capital Required",
      formula: totalCapitalAddr ? `'Capital Required'!${totalCapitalAddr}` : undefined,
      value: totalCapitalAddr ? undefined : money(data.totalCapitalRequired),
      format: FMT_CURRENCY,
      emphasis: true,
    },
    {
      label: "Cash-on-Cash Return",
      formula:
        monthlyCashFlowAddr && totalCapitalAddr
          ? `('Operating Assumptions'!${monthlyCashFlowAddr}*12)/'Capital Required'!${totalCapitalAddr}`
          : undefined,
      value: monthlyCashFlowAddr && totalCapitalAddr ? undefined : data.cashOnCashReturn === null ? "N/A" : pct(data.cashOnCashReturn),
      format: data.cashOnCashReturn === null && !(monthlyCashFlowAddr && totalCapitalAddr) ? undefined : FMT_PERCENT,
      emphasis: true,
    },
  ];

  // Populate the Underwriting Summary worksheet created above (it was
  // added first purely so it lands as the workbook's first tab; its
  // cells are filled in now that the other sheets' addresses are known).
  let sRow = 2;
  summaryWs.mergeCells(sRow, 2, sRow, 3);
  const summaryHeader = summaryWs.getCell(sRow, 2);
  summaryHeader.value = "Underwriting Summary";
  summaryHeader.font = { bold: true, size: 13, color: { argb: COLOR_WHITE }, name: "Calibri" };
  summaryHeader.fill = FILL_HEADER;
  summaryHeader.alignment = { vertical: "middle", indent: 1 };
  summaryWs.getRow(sRow).height = 22;
  sRow++;
  for (const r of summaryRows) {
    const labelCell = summaryWs.getCell(sRow, 2);
    labelCell.value = r.label;
    fmtLabel(labelCell, { bold: !!r.emphasis });
    const valueCell = summaryWs.getCell(sRow, 3);
    if (r.formula) valueCell.value = { formula: r.formula } as ExcelJS.CellFormulaValue;
    else valueCell.value = r.value === undefined || r.value === null ? "" : r.value;
    fmtValue(valueCell, r.format, { emphasis: r.emphasis });
    if (r.emphasis) labelCell.border = BORDER_THIN_BOTTOM;
    sRow++;
  }
  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0, visibility: "visible" }];

  // The same compact, one-page "Underwriting" sheet used by the
  // template-style exports (Subject To / Seller Financing / Hybrid),
  // built through the identical shared function so every financing
  // structure gets a visually consistent professional layout while
  // still using structure-specific labels and formulas (Traditional's
  // P&I-only primary payment with taxes/insurance broken out, Stack
  // Method's separate Primary Bank/DSCR and Seller-Carried Second
  // payments, etc. -- see buildUnderwritingSheet above). "Underwriting
  // Summary" (above) stays the workbook's first/active tab; this sheet
  // is purely additive.
  const inputs = addInputsSheet(wb, data);
  buildUnderwritingSheet(wb, data, inputs, capAddr);

  // Balloon Analysis (only when the active mode actually has one).
  const balloon = activeBalloon(data);
  if (balloon) {
    writeKeyValueSheet(wb, "Balloon Analysis", [{ title: "Balloon Refinance Analysis", rows: balloon.rows }]);
  }

  addScopeOfWorkSheet(wb, data);
  addAmortizationScheduleSheets(wb, data);
  addRoiProjectionSheet(wb, data);
  addTransitSheet(wb, data);

  return wb;
}

// ---------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------
export async function exportUnderwritingToExcel(data: UnderwritingExportData): Promise<void> {
  const wb =
    data.financingMode === "subjectTo" || data.financingMode === "hybrid" || data.financingMode === "sellerFinancing"
      ? await buildTemplateWorkbook(data)
      : await buildGeneratedWorkbook(data);

  wb.calcProperties.fullCalcOnLoad = true;

  const arrayBuffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([arrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildExportFilename(data.financingMode, data.propertyAddress);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
