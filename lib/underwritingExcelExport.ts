import ExcelJS from "exceljs";
import type { RoiProjectionResult } from "./roiProjection";

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
 *  - Subject To and Subject To & Seller Finance Hybrid load the supplied
 *    template workbook (public/templates/underwriting-subject-to-template.xlsx)
 *    and populate it in place, preserving its fonts, fills, borders,
 *    column widths, and number formats. A handful of the template's
 *    original formulas were broken (a literal #REF!, stale cell
 *    references, a hard-coded management-fee percentage) or simply
 *    incomplete (the right-hand "Financing Information" area was an
 *    unlabeled placeholder merged cell) -- those are corrected/rebuilt
 *    here, everything else in the template is left as designed.
 *  - Traditional Financing, Seller Financing, and Stack Method build a
 *    new workbook from scratch (their layouts do not match the
 *    Subject-To-shaped template), using the same visual language
 *    (bold labels, accounting-style currency, a green highlighted
 *    final result) so the output still looks like one consistent,
 *    professional underwriting workbook.
 *
 * Every workbook also gets a "Supporting Documents" worksheet (property
 * file names/types/counts, never binary data or object URLs) and, when
 * any Scope of Work line items exist, a "Scope of Work" worksheet.
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
}

export interface ExportScopeOfWorkItem {
  name: string;
  cost: number;
}

export interface ExportSupportingDocuments {
  propertyFileCount: number;
  propertyImageCount: number;
  propertyPdfCount: number;
  propertyFilenames: string[];
  floorPlanUploaded: boolean;
  floorPlanFileType: "PDF" | "Image" | null;
  floorPlanFilename: string | null;
  padSplitUploaded: boolean;
  padSplitFileType: "PDF" | "Image" | null;
  padSplitFilename: string | null;
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

  // Subject To / Seller Financing (shared fields)
  loanBalance: number;
  sellerDownPayment: number;
  monthlyPayment: number;
  loanInterestRatePct: number;
  loanRemainingAmortizationYears: number;

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
  hybridExistingMortgageAmortizationYears: number;
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

  // Supporting documents
  supportingDocuments: ExportSupportingDocuments;

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
const TEMPLATE_CURRENCY_FMT = '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)';

const COLOR_INK = "FF12181C";
const COLOR_BRASS = "FFC08A3E";
const COLOR_WHITE = "FFFFFFFF";
const FILL_INPUT: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
const FILL_RESULT: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF9BE8A6" } };
const FILL_HEADER: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_INK } };
const BORDER_THIN_BOTTOM: Partial<ExcelJS.Borders> = { bottom: { style: "thin" } };

function fmtLabel(cell: ExcelJS.Cell, opts?: { bold?: boolean }) {
  cell.font = { bold: opts?.bold ?? true, size: 11, name: "Calibri" };
}
function fmtValue(cell: ExcelJS.Cell, format?: string, opts?: { emphasis?: boolean; input?: boolean }) {
  cell.font = { bold: !!opts?.emphasis, size: 11, name: "Calibri" };
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
// "Supporting Documents" worksheet -- always added. Filenames, file
// types, counts, and upload status only. Never binary data, base64
// strings, or temporary object/blob URLs.
// ---------------------------------------------------------------------
function addSupportingDocumentsSheet(wb: ExcelJS.Workbook, data: UnderwritingExportData) {
  const docs = data.supportingDocuments;
  const ws = wb.addWorksheet("Supporting Documents", { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 2.5;
  ws.getColumn(2).width = 34;
  ws.getColumn(3).width = 34;

  let row = 2;
  const header = ws.getCell(row, 2);
  header.value = "Property Files";
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
    v.alignment = { horizontal: "left" };
    row++;
  };

  writeRow("Property File Count", String(docs.propertyFileCount));
  writeRow("Property Image Count", String(docs.propertyImageCount));
  writeRow("Property PDF Count", String(docs.propertyPdfCount));
  if (docs.propertyFilenames.length > 0) {
    docs.propertyFilenames.forEach((name, i) => writeRow(`Property File ${i + 1}`, name));
  } else {
    writeRow("Property Files", "None uploaded");
  }

  row++;
  const floorHeader = ws.getCell(row, 2);
  floorHeader.value = "Floor Plan";
  floorHeader.font = { bold: true, size: 13, color: { argb: COLOR_WHITE }, name: "Calibri" };
  floorHeader.fill = FILL_HEADER;
  ws.mergeCells(row, 2, row, 3);
  ws.getRow(row).height = 22;
  row++;
  writeRow("Floor Plan Uploaded", docs.floorPlanUploaded ? "Yes" : "No");
  writeRow("Floor Plan File Type", docs.floorPlanFileType || "Not Applicable");
  writeRow("Floor Plan Filename", docs.floorPlanFilename || "Not entered");

  row++;
  const padHeader = ws.getCell(row, 2);
  padHeader.value = "PadSplit Rental Data";
  padHeader.font = { bold: true, size: 13, color: { argb: COLOR_WHITE }, name: "Calibri" };
  padHeader.fill = FILL_HEADER;
  ws.mergeCells(row, 2, row, 3);
  ws.getRow(row).height = 22;
  row++;
  writeRow("PadSplit Rental Data Uploaded", docs.padSplitUploaded ? "Yes" : "No");
  writeRow("PadSplit Rental Data File Type", docs.padSplitFileType || "Not Applicable");
  writeRow("PadSplit Rental Data Filename", docs.padSplitFilename || "Not entered");
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

  writeSummaryRow("Annual Appreciation Assumption", pct(data.roiAppreciationPct), FMT_PERCENT);
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

    ws.getCell(r, colIndex.begPropVal).value = money(yearRow.beginningPropertyValue);
    fmtValue(ws.getCell(r, colIndex.begPropVal), FMT_CURRENCY);
    ws.getCell(r, colIndex.appreciation).value = money(yearRow.annualAppreciation);
    fmtValue(ws.getCell(r, colIndex.appreciation), FMT_CURRENCY);
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
      rows: balloonRows(data.stackBalloon, [
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
// TEMPLATE-BASED PATH: Subject To and Subject To & Seller Finance Hybrid
// ---------------------------------------------------------------------
const TEMPLATE_URL = "/templates/underwriting-subject-to-template.xlsx";

async function fetchTemplateBuffer(): Promise<ArrayBuffer> {
  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) {
    throw new Error("Could not load the underwriting Excel template. Please try again.");
  }
  return res.arrayBuffer();
}

function populateTemplateWorkbook(ws: ExcelJS.Worksheet, data: UnderwritingExportData) {
  const isHybrid = data.financingMode === "hybrid";

  // ---- Clear the old, partially-built right-hand skeleton -----------
  // (E2/F3/F4/E6/E7/F7/E9/E11 plus the broken =#REF!-F6 formula, and the
  // single giant E12:F35 merged placeholder cell) so the rebuilt
  // Financing Information panel below starts from a clean area. F3/F4/
  // F7 are overwritten by the new panel itself; the rest are explicitly
  // cleared here.
  try {
    ws.unMergeCells("E12:F35");
  } catch {
    // Already unmerged (e.g. a re-export in the same session) -- safe to ignore.
  }
  ["E2", "E6", "E7", "E9", "E11", "D2", "D5"].forEach((addr) => {
    const cell = ws.getCell(addr);
    if (addr !== "D2") cell.value = null;
  });
  ws.getColumn(6).width = 34; // F
  ws.getColumn(7).width = 20; // G

  // ---- Operating Underwriting (rows 2-17, template's original layout) ----
  ws.getCell("C3").value = money(data.purchasePrice);

  ws.getCell("D4").value = pct(data.vacancyPct);
  ws.getCell("C4").value = { formula: "C14*12*D4" } as ExcelJS.CellFormulaValue; // Annual Vacancy (unchanged, already correct)

  ws.getCell("C5").value = { formula: "(C14*12)-C4" } as ExcelJS.CellFormulaValue; // Effective Gross Income (unchanged)

  // Annual Maintenance stays the template's original formula: it is a
  // fixed, non-editable $400/month assumption throughout the site, so
  // =400*12 is already correct, not broken.
  ws.getCell("C6").value = { formula: "400*12" } as ExcelJS.CellFormulaValue;

  ws.getCell("B7").value = "Annual Mgmt/Platform Fees";
  // Was hard-coded to a fixed "=15%+5%" (20%) regardless of the actual
  // platform/management percentages entered on the website. Corrected to
  // the real combined percentage so this cell (and everything computed
  // from it) always matches the site.
  ws.getCell("D7").value = pct(data.platformFeePct + data.propertyManagementPct);
  ws.getCell("C7").value = { formula: "(C5*D7)" } as ExcelJS.CellFormulaValue; // unchanged, already correct

  ws.getCell("B8").value = "Annual Utilities, Cleaning, Lawn Care & Pest Control";
  ws.getCell("C8").value = money(
    (data.utilitiesMonthly + data.cleaningMonthly + data.lawnCareMonthly + data.pestControlMonthly) * 12
  );

  // Annual Insurance / Annual Taxes / Annual P&I: for Subject To these
  // decompose the entered monthly payment (PITI or P&I-only) into its
  // component parts so Monthly Operating Cost (C13) below never double-
  // counts taxes or insurance. Hybrid does not collect a separate
  // taxes/insurance figure at all (its Subject-To PITI payment is
  // entered as one all-in figure and the website never adds a second
  // taxes/insurance line on top of it), so Annual Insurance/Taxes are
  // $0 here and the complete payment is carried entirely in Annual P&I.
  if (isHybrid) {
    ws.getCell("C9").value = 0;
    ws.getCell("C10").value = 0;
    ws.getCell("C11").value = money(data.hybridTotalMonthlyHousingPayment * 12);
  } else {
    ws.getCell("C9").value = money(data.annualPropertyInsurance);
    ws.getCell("C10").value = money(data.annualPropertyTaxes);
    const annualPI = Math.max(
      0,
      round2(data.monthlyHousingPayment * 12 - data.annualPropertyTaxes - data.annualPropertyInsurance)
    );
    ws.getCell("C11").value = money(annualPI);
  }
  [ws.getCell("C9"), ws.getCell("C10")].forEach((c) => (c.fill = FILL_INPUT));

  ws.getCell("B11").value = "Annual P&I";
  // Monthly Operating Cost -- unchanged, already correct once C4/C6-C11
  // above are populated.
  ws.getCell("C13").value = { formula: "(C4+C6+C7+C8+C9+C10+C11)/12" } as ExcelJS.CellFormulaValue;

  ws.getCell("C14").value = money(data.grossMonthlyRent);

  // Monthly Cash Flow: the template's original formula referenced two
  // undefined cells (F8, E5) and would have shown a #REF!/0 error. Fixed
  // to Gross Monthly Room Revenue - Monthly Operating Cost, exactly
  // matching the website's results.monthlyCashFlow (before financing-
  // specific capital adjustments, which only apply to Stack Method).
  ws.getCell("C15").value = { formula: "C14-C13" } as ExcelJS.CellFormulaValue;

  ws.getCell("B16").value = bedroomSummaryString(data);

  ws.getCell("B17").value = "Monthly PITI";
  // Monthly PITI: previously referenced undefined E3:E4. Fixed to the
  // annualized Insurance + Taxes + P&I already built above (identical to
  // results.monthlyHousingPayment).
  ws.getCell("C17").value = { formula: "(C9+C10+C11)/12" } as ExcelJS.CellFormulaValue;

  // ---- Capital Required (rows 19-36) ---------------------------------
  // The original template had no Arrears line at all; Arrears is
  // applicable to both Subject To and Hybrid (it was only removed from
  // Traditional Financing and Seller Financing), so a new row is added
  // here rather than silently leaving it out of Total Capital Required.
  ws.getCell("B19").value = "Arrears";
  ws.getCell("C19").value = money(data.arrears);
  ws.getCell("C19").fill = FILL_INPUT;

  ws.getCell("B20").value = "Down Payment";
  ws.getCell("C20").value = money(data.downPaymentForCapital);
  ws.getCell("C20").fill = FILL_INPUT;

  ws.getCell("B21").value = "Renovations";
  ws.getCell("C21").value = money(data.renovationCost);

  ws.getCell("B22").value = "Furniture";
  ws.getCell("C22").value = money(data.furniture);

  ws.getCell("B23").value = "Appliances";
  ws.getCell("C23").value = money(data.appliances);

  ws.getCell("B24").value = "Photos";
  ws.getCell("C24").value = money(data.photos);

  ws.getCell("B25").value = "Holding Costs";
  ws.getCell("C25").value = money(data.holdingCosts);

  ws.getCell("B26").value = "Reserves";
  ws.getCell("C26").value = money(data.reserves);

  ws.getCell("B27").value = "Upfront Insurance Cost";
  ws.getCell("C27").value = money(data.upfrontInsurance);

  ws.getCell("B28").value = "Acquisition Cost";
  ws.getCell("C28").value = money(data.acquisitionFee);

  ws.getCell("B29").value = "TC Fee";
  ws.getCell("C29").value = money(data.tcFee);

  ws.getCell("B30").value = "LLC Entity Formation Cost";
  ws.getCell("C30").value = money(data.llcFee);

  ws.getCell("B31").value = "Closing Costs";
  ws.getCell("D31").value = pct(data.closingCostPct);
  ws.getCell("C31").value = { formula: "C3*D31" } as ExcelJS.CellFormulaValue;

  ws.getCell("B32").value = "Agent Fee";
  ws.getCell("C32").value = money(data.agentFee);

  ws.getCell("B33").value = "Assignment Fee";
  ws.getCell("C33").value = money(data.assignmentFee);

  ws.getCell("B34").value = "Total Capital Required";
  ws.getCell("C34").value = { formula: "SUM(C19:C33)" } as ExcelJS.CellFormulaValue;
  fmtLabel(ws.getCell("B34"), { bold: true });
  fmtValue(ws.getCell("C34"), TEMPLATE_CURRENCY_FMT, { emphasis: false });
  ws.getCell("C34").border = BORDER_THIN_BOTTOM;
  ws.getCell("B34").border = BORDER_THIN_BOTTOM;

  ws.getCell("B36").value = "C on C Return";
  ws.getCell("C36").value = { formula: "(C15*12)/C34" } as ExcelJS.CellFormulaValue;
  fmtLabel(ws.getCell("B36"), { bold: true });
  fmtValue(ws.getCell("C36"), FMT_PERCENT, { emphasis: true });
  ws.getCell("B36").border = BORDER_THIN_BOTTOM;
  ws.getRow(34).height = 15.75;
  ws.getRow(36).height = 15.75;

  // Every C-column currency cell that doesn't already carry the
  // template's own accounting format (freshly written rows below the
  // original row 35) gets it applied explicitly so the whole capital
  // section looks consistent.
  for (let r = 19; r <= 33; r++) {
    const cell = ws.getCell(r, 3);
    if (!cell.numFmt) cell.numFmt = TEMPLATE_CURRENCY_FMT;
    ws.getRow(r).height = 15.75;
  }

  // ---- Financing Information panel (columns F/G), rebuilt from what ----
  // was an incomplete, unlabeled placeholder (a single merged blank
  // cell spanning E12:F35 plus a handful of orphaned header fragments
  // and the #REF! Equity formula noted above).
  const headerCell = ws.getCell("F2");
  ws.mergeCells("F2:G2");
  headerCell.value = "FINANCING INFORMATION";
  headerCell.font = { bold: true, size: 12, name: "Calibri" };
  headerCell.border = { bottom: { style: "double" } };
  headerCell.alignment = { horizontal: "left" };

  let nextRow: number;
  if (isHybrid) {
    nextRow = writeKVBlock(ws, 3, 6, 7, [
      { label: "Purchase Price", formula: "C3", format: TEMPLATE_CURRENCY_FMT },
      { label: "Existing Mortgage Balance", value: money(data.hybridExistingMortgageBalance), format: FMT_CURRENCY, input: true },
      { label: "Existing Mortgage Interest Rate", value: pct(data.hybridExistingMortgageRatePct), format: FMT_PERCENT, input: true },
      { label: "Existing Mortgage Remaining Amortization", value: data.hybridExistingMortgageAmortizationYears, format: FMT_YEARS, input: true },
      { label: "Monthly Subject-To PITI Payment", value: money(data.hybridSubjectToPITI), format: FMT_CURRENCY, input: true },
      { label: "Suggested Seller-Financed Balance", value: money(data.hybridSuggestedSellerFinancedBalance), format: FMT_CURRENCY },
      { label: "Seller-Financed Balance Used", value: money(data.hybridSellerFinancedBalanceUsed), format: FMT_CURRENCY, input: true },
      { label: "Manual Seller-Financed Balance Override", value: data.hybridSellerFinancedBalanceIsManual ? "Yes" : "No" },
      { label: "Are Monthly Seller-Finance Payments Required?", value: data.hybridSellerFinancePaymentsRequired ? "Yes" : "No" },
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
      { label: "Monthly Seller-Finance Payment", value: money(data.hybridMonthlySellerFinancePayment), format: FMT_CURRENCY },
      { label: "Total Monthly Housing Payment (Total PITI)", formula: "C17", format: TEMPLATE_CURRENCY_FMT },
      { label: "Seller Down Payment", value: money(data.sellerDownPayment), format: FMT_CURRENCY, input: true },
      { label: "Arrears", formula: "C19", format: TEMPLATE_CURRENCY_FMT },
      {
        label: "Estimated Equity",
        formula: "C3-G4-G9",
        format: FMT_CURRENCY,
        emphasis: true,
      },
    ]);
  } else {
    nextRow = writeKVBlock(ws, 3, 6, 7, [
      { label: "Purchase Price", formula: "C3", format: TEMPLATE_CURRENCY_FMT },
      { label: "Existing Mortgage Balance", value: money(data.loanBalance), format: FMT_CURRENCY, input: true },
      { label: "Existing Mortgage Interest Rate", value: pct(data.loanInterestRatePct), format: FMT_PERCENT, input: true },
      { label: "Existing Mortgage Remaining Amortization", value: data.loanRemainingAmortizationYears, format: FMT_YEARS, input: true },
      { label: "Monthly Payment Type", value: data.paymentType === "piti" ? "PITI" : "Principal and Interest Only" },
      { label: data.housingPaymentLabel, value: money(data.monthlyPayment), format: FMT_CURRENCY, input: true },
      { label: "Monthly PITI (Total)", formula: "C17", format: TEMPLATE_CURRENCY_FMT },
      { label: "Seller Down Payment", value: money(data.sellerDownPayment), format: FMT_CURRENCY, input: true },
      { label: "Arrears", formula: "C19", format: TEMPLATE_CURRENCY_FMT },
      { label: "Estimated Equity", formula: "C3-G4", format: FMT_CURRENCY, emphasis: true },
    ]);
  }

  const balloon = activeBalloon(data);
  if (balloon) {
    nextRow += 1;
    const balloonHeader = ws.getCell(nextRow, 6);
    ws.mergeCells(nextRow, 6, nextRow, 7);
    balloonHeader.value = "BALLOON REFINANCE ANALYSIS";
    balloonHeader.font = { bold: true, size: 12, name: "Calibri" };
    balloonHeader.border = { bottom: { style: "double" } };
    nextRow += 1;
    writeKVBlock(ws, nextRow, 6, 7, balloon.rows);
  }
}

export async function buildTemplateWorkbook(data: UnderwritingExportData): Promise<ExcelJS.Workbook> {
  const buffer = await fetchTemplateBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  populateTemplateWorkbook(ws, data);
  addScopeOfWorkSheet(wb, data);
  addRoiProjectionSheet(wb, data);
  addSupportingDocumentsSheet(wb, data);
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

function financingDetailsRows(data: UnderwritingExportData): KVRow[] {
  if (data.financingMode === "traditional") {
    return [
      { label: "Purchase Price", value: money(data.purchasePrice), format: FMT_CURRENCY, input: true },
      { label: "Down Payment Percentage", value: pct(data.traditionalDownPaymentPct), format: FMT_PERCENT, input: true },
      { label: "Estimated Down Payment", value: money(data.traditionalDownPaymentAmount), format: FMT_CURRENCY },
      { label: "Estimated Loan Balance", value: money(data.traditionalLoanBalance), format: FMT_CURRENCY },
      { label: "Interest Rate", value: pct(data.traditionalInterestRatePct), format: FMT_PERCENT, input: true },
      { label: "Amortization Term", value: "30 Years (360 Monthly Payments)" },
      { label: "Monthly Principal and Interest", value: money(data.traditionalMonthlyPI), format: FMT_CURRENCY },
      { label: "Annual Property Taxes", value: money(data.annualPropertyTaxes), format: FMT_CURRENCY, input: true },
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
      { label: "Purchase Price", value: money(data.purchasePrice), format: FMT_CURRENCY, input: true },
      { label: "Loan Balance", value: money(data.loanBalance), format: FMT_CURRENCY, input: true },
      { label: "Seller Down Payment", value: money(data.sellerDownPayment), format: FMT_CURRENCY, input: true },
      { label: "Monthly Payment Type", value: data.paymentType === "piti" ? "PITI" : "Principal and Interest Only" },
      { label: data.housingPaymentLabel, value: money(data.monthlyPayment), format: FMT_CURRENCY, input: true },
      { label: "Annual Property Taxes", value: money(data.annualPropertyTaxes), format: FMT_CURRENCY, input: true },
      { label: "Annual Property Insurance", value: money(data.annualPropertyInsurance), format: FMT_CURRENCY, input: true },
      { label: "Loan Interest Rate", value: pct(data.loanInterestRatePct), format: FMT_PERCENT, input: true },
      { label: "Remaining Amortization", value: data.loanRemainingAmortizationYears, format: FMT_YEARS, input: true },
      { label: "Estimated Closing Cost Percentage", value: pct(data.closingCostPct), format: FMT_PERCENT, input: true },
      { label: "Estimated Equity", value: money(data.equity), format: FMT_CURRENCY, emphasis: true },
    ];
  }
  // Stack Method
  return [
    { label: "Purchase Price", value: money(data.purchasePrice), format: FMT_CURRENCY, input: true },
    { label: "Seller's Current First Loan Balance", value: money(data.stackSellerFirstLoanBalance), format: FMT_CURRENCY, input: true },
    { label: "Existing Second Lien", value: money(data.stackSellerSecondLien), format: FMT_CURRENCY, input: true },
    { label: "Miscellaneous Liens", value: money(data.stackMiscLiens), format: FMT_CURRENCY, input: true },
    { label: "Down Payment to Seller", value: money(data.stackDownPaymentToSeller), format: FMT_CURRENCY, input: true },
    { label: "Bank Loan-to-Value Percentage", value: pct(data.stackEffectiveBankLtvPct), format: FMT_PERCENT },
    { label: "Estimated First-Position Bank Loan", value: money(data.stackBankLoanAmount), format: FMT_CURRENCY },
    { label: "Bank Interest Rate", value: pct(data.stackBankInterestRatePct), format: FMT_PERCENT, input: true },
    { label: "Bank Amortization", value: data.stackBankAmortizationYears, format: FMT_YEARS, input: true },
    { label: "Monthly Bank Principal and Interest", value: money(data.stackBankMonthlyPI), format: FMT_CURRENCY },
    { label: "Annual Property Taxes", value: money(data.annualPropertyTaxes), format: FMT_CURRENCY, input: true },
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
  // Arrears applies only to Subject To and Hybrid (the template-based
  // export path); this generated path only ever covers Traditional
  // Financing, Seller Financing, and Stack Method, none of which
  // include an Arrears line, matching the on-page/CSV/print behavior.
  rows.push({ label: "Renovation Cost", value: money(data.renovationCost), format: FMT_CURRENCY });
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

  // Balloon Analysis (only when the active mode actually has one).
  const balloon = activeBalloon(data);
  if (balloon) {
    writeKeyValueSheet(wb, "Balloon Analysis", [{ title: "Balloon Refinance Analysis", rows: balloon.rows }]);
  }

  addScopeOfWorkSheet(wb, data);
  addRoiProjectionSheet(wb, data);
  addSupportingDocumentsSheet(wb, data);

  return wb;
}

// ---------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------
export async function exportUnderwritingToExcel(data: UnderwritingExportData): Promise<void> {
  const wb =
    data.financingMode === "subjectTo" || data.financingMode === "hybrid"
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
