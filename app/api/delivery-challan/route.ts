import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import path from "path";

/**
 * Delivery Challan and Annexure-II generator.
 *
 * WHY THIS FILLS A TEMPLATE RATHER THAN BUILDING A SHEET
 * These challans go to NTPC. Their layout, the four copies down the
 * right-hand side, the bank block, the logo and the Annexure-II tag are
 * all things the plant expects to see exactly as they are. Rebuilding
 * that from code would be weeks of fiddling and would still differ in
 * ways someone at the gate would notice.
 *
 * So the company's own workbook IS the template. Only the values that
 * change from one consignment to the next are written into it, and every
 * piece of formatting — including the logo — is carried through
 * untouched.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nodeRequire: NodeRequire = eval("require");

/**
 * The form sends dates as DD-MM-YYYY, which `new Date()` reads as an
 * American month-first date or not at all. Parsed explicitly so a
 * challan dated 05-08-2026 is the fifth of August, not the eighth of May.
 */
function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const dmy = value.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? undefined : fallback;
}

const TEMPLATES: Record<string, { file: string; sheet: string; annexure?: string; label: string }> = {
  mouda: {
    file: "ntpc-mouda.xlsx",
    sheet: "Table 1",
    annexure: "Table 1 (3)",
    label: "NTPC Mouda",
  },
  solapur: {
    file: "ntpc-solapur.xlsx",
    sheet: "Delivery Challans",
    annexure: "Annexure",
    label: "NTPC Solapur",
  },
};

/**
 * Where each value lives in the Mouda template. Found by reading the
 * workbook rather than assumed, and kept here so a template change is a
 * one-line fix instead of a hunt through code.
 */
const MOUDA_CELLS: Record<string, string> = {
  challanNo: "E6",
  date: "H6",
  transporter: "E10",
  lorryNo: "E11",
  ewayBillNo: "E17",
  quantity: "D21",
};

interface ChallanRequest {
  plant: keyof typeof TEMPLATES;
  challanNo?: string;
  date?: string;
  transporter?: string;
  lorryNo?: string;
  ewayBillNo?: string;
  quantity?: number | string;
  grossWeight?: number | string;
  tareWeight?: number | string;
  materialWeight?: number | string;
  lrNo?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "finance");
  if ("response" in auth) return auth.response;

  let body: ChallanRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const template = TEMPLATES[body.plant];
  if (!template) {
    return NextResponse.json(
      { error: `Unknown plant "${body.plant}". Available: ${Object.keys(TEMPLATES).join(", ")}` },
      { status: 400 }
    );
  }

  let ExcelJS: any;
  try {
    ExcelJS = nodeRequire("exceljs");
  } catch {
    return NextResponse.json(
      {
        error:
          "The spreadsheet library isn't installed. Run `npm install exceljs` in the project folder, then try again.",
      },
      { status: 500 }
    );
  }

  const templatePath = path.join(process.cwd(), "templates", "challan", template.file);

  try {
    const workbook = new ExcelJS.Workbook();
    // ExcelJS preserves images, merged cells and print settings when a
    // workbook is read and written back — which is the whole reason for
    // going through it rather than generating a sheet.
    await workbook.xlsx.readFile(templatePath);

    const sheet = workbook.getWorksheet(template.sheet);
    if (!sheet) {
      return NextResponse.json(
        { error: `The template has no sheet called "${template.sheet}".` },
        { status: 500 }
      );
    }

    /** Write only where a value was actually supplied. */
    const put = (cell: string, value: any) => {
      if (value === undefined || value === null || value === "") return;
      sheet.getCell(cell).value = value;
    };

    if (body.plant === "mouda") {
      put(MOUDA_CELLS.challanNo, body.challanNo);
      put(MOUDA_CELLS.date, parseDate(body.date));
      put(MOUDA_CELLS.transporter, body.transporter);
      put(MOUDA_CELLS.lorryNo, body.lorryNo);
      put(MOUDA_CELLS.ewayBillNo, body.ewayBillNo);
      put(MOUDA_CELLS.quantity, Number(body.quantity) || undefined);
    } else {
      // The Solapur sheet uses the same labels in different places, so
      // the cells are located by their label rather than hard-coded.
      const findRight = (label: string): string | null => {
        let found: string | null = null;
        sheet.eachRow((row: any) => {
          row.eachCell((cell: any) => {
            if (found) return;
            if (String(cell.value ?? "").trim().toLowerCase() === label.toLowerCase()) {
              found = sheet.getCell(cell.row, cell.col + 1).address;
            }
          });
        });
        return found;
      };
      const map: Record<string, any> = {
        "Challan No.": body.challanNo,
        "Date :": parseDate(body.date),
        "Lorry No. :": body.lorryNo,
        "Transporter's Name :": body.transporter,
        "Eway bill No.": body.ewayBillNo,
        "L.R/R.R. No. :": body.lrNo,
      };
      for (const [label, value] of Object.entries(map)) {
        const cell = findRight(label);
        if (cell) put(cell, value);
      }
    }

    // ---- Annexure-II: the consignment tag ----
    if (template.annexure) {
      const annexure = workbook.getWorksheet(template.annexure);
      if (annexure) {
        const setAfter = (label: string, value: any) => {
          if (value === undefined || value === null || value === "") return;
          annexure.eachRow((row: any) => {
            row.eachCell((cell: any) => {
              if (String(cell.value ?? "").trim().toLowerCase() === label.toLowerCase()) {
                annexure.getCell(cell.row, cell.col + 1).value = value;
              }
            });
          });
        };
        setAfter("Date of Dispatch", parseDate(body.date));
        setAfter("Batch Number", body.challanNo);
        setAfter("Carriage Vehicle Type / Number", body.lorryNo);
        setAfter("Gross Weight", Number(body.grossWeight) || undefined);
        setAfter("Tare Weight", Number(body.tareWeight) || undefined);
        setAfter("Material Weight", Number(body.materialWeight) || undefined);
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const name = `${body.challanNo || "Delivery Challan"} - ${template.label}.xlsx`.replace(
      /[\\/:*?"<>|]/g,
      "-"
    );

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Couldn't build the challan: ${err?.message || err}` },
      { status: 500 }
    );
  }
}

/** Which plants have a template, for the form to offer. */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "finance");
  if ("response" in auth) return auth.response;

  return NextResponse.json({
    plants: Object.entries(TEMPLATES).map(([id, t]) => ({
      id,
      label: t.label,
      hasAnnexure: Boolean(t.annexure),
    })),
    note:
      "Each challan is produced from the company's own workbook, so the layout, the four copies " +
      "and the logo come through exactly as the plant expects them.",
  });
}
