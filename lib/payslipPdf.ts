"use client";

import jsPDF from "jspdf";

/**
 * Payslip PDF.
 *
 * The old slip was the on-screen card sent to the printer: web colours, no
 * company block, no amount in words, nothing an employee could take to a
 * bank. This draws a proper document — letterhead with the logo, employee
 * and statutory identity, earnings against deductions in two columns, the
 * net in figures and in words, and the employer's own contributions kept
 * visually separate so nobody reads them as a deduction.
 *
 * Built with jsPDF rather than the browser's print dialog because a print
 * stylesheet renders differently on every machine, and a payslip that comes
 * out differently for two employees invites exactly the argument it should
 * prevent.
 */

export interface SlipLine { label: string; amount: number; }

export interface SlipData {
  code: string;
  name: string;
  designation: string;
  department?: string;
  plant: string;
  workLocation?: string;
  month: string;
  monthDays: number;
  paidDays: number;
  daysWorked: number;
  overtimeHours: number;
  dateOfJoining?: string;
  uan?: string;
  esicNumber?: string;
  pan?: string;
  bankName?: string;
  bankAccount?: string;
  earnings: SlipLine[];
  grossEarnings: number;
  deductions: SlipLine[];
  totalDeductions: number;
  employerContributions: SlipLine[];
  employerCost: number;
  netPay: number;
}

const INK: [number, number, number] = [11, 31, 39];
const LEAF: [number, number, number] = [31, 122, 76];
const MUTED: [number, number, number] = [110, 125, 122];
const RULE: [number, number, number] = [203, 216, 211];

const money = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Indian numbering, because "Rupees One Lakh" is what a bank expects. */
export function amountInWords(value: number): string {
  const n = Math.floor(Math.abs(value));
  const paise = Math.round((Math.abs(value) - n) * 100);
  if (n === 0 && paise === 0) return "Zero Rupees Only";

  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const two = (x: number): string =>
    x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? " " + ones[x % 10] : ""}`;
  const three = (x: number): string =>
    x >= 100 ? `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? " " + two(x % 100) : ""}` : two(x);

  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;

  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${three(lakh)} Lakh`);
  if (thousand) parts.push(`${three(thousand)} Thousand`);
  if (rest) parts.push(three(rest));

  let out = parts.join(" ") + " Rupees";
  if (paise > 0) out += ` and ${two(paise)} Paise`;
  return out + " Only";
}

/**
 * `logoDataUrl` is optional: the slip must still print if the logo can't be
 * read, so a missing image degrades to the wordmark rather than throwing.
 */
export function buildPayslipPdf(slip: SlipData, logoDataUrl?: string | null): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const M = 14;
  let y = 0;

  const setFont = (size: number, style: "normal" | "bold" = "normal", colour = INK) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(colour[0], colour[1], colour[2]);
  };

  // ---------- Letterhead ----------
  doc.setFillColor(INK[0], INK[1], INK[2]);
  doc.rect(0, 0, W, 26, "F");

  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, "PNG", M, 5.5, 15, 15); } catch { /* wordmark carries it */ }
  }

  setFont(14, "bold", [255, 255, 255]);
  doc.text("BIOME INDUSTRIA PRIVATE LIMITED", logoDataUrl ? M + 19 : M, 12);
  setFont(7.5, "normal", [176, 200, 194]);
  doc.text("Biomass supply and pellet manufacturing", logoDataUrl ? M + 19 : M, 17);
  doc.text(slip.workLocation || (slip.plant ? `${slip.plant} unit` : "Head office"), logoDataUrl ? M + 19 : M, 21);

  const monthLabel = new Date(slip.month + "-01").toLocaleDateString("en-IN", {
    month: "long", year: "numeric",
  });
  setFont(9, "bold", [255, 255, 255]);
  doc.text("PAYSLIP", W - M, 12, { align: "right" });
  setFont(8, "normal", [176, 200, 194]);
  doc.text(monthLabel, W - M, 17, { align: "right" });

  doc.setFillColor(LEAF[0], LEAF[1], LEAF[2]);
  doc.rect(0, 26, W, 1.6, "F");
  y = 34;

  // ---------- Employee identity ----------
  const pair = (label: string, value: string, x: number, yy: number, labelW = 26) => {
    setFont(7.5, "normal", MUTED);
    doc.text(label.toUpperCase(), x, yy);
    setFont(9, "bold", INK);
    doc.text(value || "—", x + labelW, yy);
  };

  doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
  doc.setLineWidth(0.2);
  doc.roundedRect(M, y, W - M * 2, 30, 1.5, 1.5, "S");

  const colA = M + 4;
  const colB = W / 2 + 2;
  let ry = y + 7;
  pair("Name", slip.name, colA, ry);
  pair("Code", slip.code, colB, ry);
  ry += 6;
  pair("Designation", slip.designation, colA, ry);
  pair("Department", slip.department || "—", colB, ry);
  ry += 6;
  pair("Joined", slip.dateOfJoining || "—", colA, ry);
  pair("UAN", slip.uan || "—", colB, ry);
  ry += 6;
  pair("PAN", slip.pan || "—", colA, ry);
  pair("ESIC no.", slip.esicNumber || "—", colB, ry);
  y += 35;

  // ---------- Attendance strip ----------
  doc.setFillColor(239, 244, 242);
  doc.rect(M, y, W - M * 2, 9, "F");
  const strip = [
    ["Days in month", String(slip.monthDays)],
    ["Paid days", String(slip.paidDays)],
    ["Days worked", String(slip.daysWorked)],
    ["Overtime", slip.overtimeHours ? `${slip.overtimeHours} hrs` : "—"],
  ];
  strip.forEach(([label, value], i) => {
    const x = M + 4 + i * ((W - M * 2 - 8) / strip.length);
    setFont(7, "normal", MUTED);
    doc.text(label.toUpperCase(), x, y + 3.6);
    setFont(9, "bold", INK);
    doc.text(value, x, y + 7.6);
  });
  y += 15;

  // ---------- Earnings and deductions ----------
  const half = (W - M * 2 - 4) / 2;
  const rows = Math.max(slip.earnings.length, slip.deductions.length);
  const tableH = 9 + rows * 6 + 9;

  const column = (x: number, title: string, lines: SlipLine[], total: number, totalLabel: string, accent: [number, number, number]) => {
    doc.setFillColor(accent[0], accent[1], accent[2]);
    doc.rect(x, y, half, 7, "F");
    setFont(8, "bold", [255, 255, 255]);
    doc.text(title.toUpperCase(), x + 3, y + 4.8);
    doc.text("AMOUNT", x + half - 3, y + 4.8, { align: "right" });

    let ly = y + 12.5;
    lines.forEach((l) => {
      setFont(8.5, "normal", INK);
      // Long labels are clipped rather than wrapped, so the two columns
      // stay row-aligned across the page.
      doc.text(doc.splitTextToSize(l.label, half - 30)[0], x + 3, ly);
      setFont(8.5, "normal", INK);
      doc.text(money(l.amount), x + half - 3, ly, { align: "right" });
      ly += 6;
    });

    const ty = y + 9 + rows * 6;
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.line(x, ty, x + half, ty);
    setFont(9, "bold", INK);
    doc.text(totalLabel, x + 3, ty + 6);
    doc.text(money(total), x + half - 3, ty + 6, { align: "right" });

    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.roundedRect(x, y, half, tableH, 1.5, 1.5, "S");
  };

  column(M, "Earnings", slip.earnings, slip.grossEarnings, "Gross earnings", LEAF);
  column(M + half + 4, "Deductions", slip.deductions, slip.totalDeductions, "Total deductions", [166, 80, 30]);
  y += tableH + 6;

  // ---------- Net pay ----------
  doc.setFillColor(INK[0], INK[1], INK[2]);
  doc.roundedRect(M, y, W - M * 2, 18, 2, 2, "F");
  setFont(8, "normal", [176, 200, 194]);
  doc.text("NET PAY FOR THE MONTH", M + 5, y + 6.5);
  setFont(16, "bold", [255, 255, 255]);
  doc.text(`Rs. ${money(slip.netPay)}`, W - M - 5, y + 9, { align: "right" });
  setFont(7.5, "normal", [176, 200, 194]);
  doc.text(
    doc.splitTextToSize(amountInWords(slip.netPay), W - M * 2 - 10)[0],
    M + 5, y + 13.5
  );
  y += 24;

  // ---------- Employer contributions ----------
  if (slip.employerContributions.length > 0) {
    setFont(7.5, "bold", MUTED);
    doc.text("EMPLOYER CONTRIBUTIONS — PAID BY THE COMPANY, NOT DEDUCTED FROM YOU", M, y);
    y += 4;
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.roundedRect(M, y, W - M * 2, slip.employerContributions.length * 5 + 11, 1.5, 1.5, "S");
    y += 6;
    slip.employerContributions.forEach((c) => {
      setFont(8, "normal", MUTED);
      doc.text(c.label, M + 4, y);
      doc.text(money(c.amount), W - M - 4, y, { align: "right" });
      y += 5;
    });
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.line(M + 4, y - 2, W - M - 4, y - 2);
    setFont(8.5, "bold", INK);
    doc.text("Cost to company", M + 4, y + 2);
    doc.text(money(slip.employerCost), W - M - 4, y + 2, { align: "right" });
    y += 10;
  }

  // ---------- Payment and footer ----------
  if (slip.bankAccount) {
    setFont(7.5, "normal", MUTED);
    const masked = slip.bankAccount.length > 4
      ? `${"X".repeat(Math.max(0, slip.bankAccount.length - 4))}${slip.bankAccount.slice(-4)}`
      : slip.bankAccount;
    doc.text(`Credited to ${slip.bankName || "bank"} a/c ${masked}`, M, y);
    y += 5;
  }

  const footerY = 283;
  doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
  doc.line(M, footerY - 5, W - M, footerY - 5);
  setFont(7, "normal", MUTED);
  doc.text("This is a computer-generated payslip and does not require a signature.", M, footerY);
  doc.text(
    `Generated ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`,
    W - M, footerY, { align: "right" }
  );
  doc.text("Queries: raise them under Help & Support in the app.", M, footerY + 4);

  return doc;
}

export function payslipFileName(slip: SlipData): string {
  return `Payslip-${slip.code}-${slip.month}.pdf`;
}
